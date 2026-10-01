import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import {
  advanceExpiredRestoreUpload,
  advanceRestoreUpload,
  completeRestoreUpload,
  createRestoreUpload,
  getRestoreUpload,
  RESTORE_UPLOAD_PART_BYTES,
  requestRestoreUploadAbort,
  uploadRestorePart,
} from "@/lib/v2/portability/resumable-restore-upload-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown> };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;

type StoredObject = {
  bytes: Uint8Array;
  contentType?: string;
  customMetadata?: Record<string, string>;
};

type MultipartState = {
  key: string;
  contentType?: string;
  customMetadata?: Record<string, string>;
  parts: Map<number, { bytes: Uint8Array; etag: string }>;
};

type Deferred = {
  promise: Promise<void>;
  resolve(): void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function streamOf(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readBody(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  const reader = value.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = new Uint8Array(item.value);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function checksumBuffer(bytes: Uint8Array) {
  const digest = createHash("sha256").update(bytes).digest();
  return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) as ArrayBuffer;
}

class MemoryMultipartBucket implements R2BucketBinding {
  readonly objects = new Map<string, StoredObject>();
  readonly multipart = new Map<string, MultipartState>();
  readonly createdKeys: string[] = [];
  delayFirstTempComplete: { stored: Deferred; release: Deferred } | null = null;
  delayFirstAssemblyPart: { stored: Deferred; release: Deferred } | null = null;
  delayFirstRangeGetError: { started: Deferred; release: Deferred } | null = null;
  delayNextHead: { key: string; started: Deferred; release: Deferred } | null = null;
  failFirstFinalCompleteAfterStore = false;
  private nextUpload = 1;
  private tempCompleteDelayed = false;
  private assemblyPartDelayed = false;
  private rangeGetDelayed = false;
  private headDelayed = false;
  private finalCompleteFailed = false;

  private objectView(key: string, value: StoredObject) {
    return {
      key,
      size: value.bytes.byteLength,
      httpMetadata: { contentType: value.contentType },
      customMetadata: value.customMetadata,
      checksums: { sha256: checksumBuffer(value.bytes) },
    };
  }

  async head(key: string) {
    const value = this.objects.get(key);
    if (value && this.delayNextHead?.key === key && !this.headDelayed) {
      this.headDelayed = true;
      this.delayNextHead.started.resolve();
      await this.delayNextHead.release.promise;
    }
    return value ? this.objectView(key, value) : null;
  }

  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const value = this.objects.get(key);
    if (!value) return null;
    if (options?.range && this.delayFirstRangeGetError && !this.rangeGetDelayed) {
      this.rangeGetDelayed = true;
      this.delayFirstRangeGetError.started.resolve();
      await this.delayFirstRangeGetError.release.promise;
      throw new Error("injected_unknown_r2_failure");
    }
    const bytes = options?.range
      ? value.bytes.slice(options.range.offset, options.range.offset + options.range.length)
      : value.bytes.slice();
    return {
      ...this.objectView(key, { ...value, bytes }),
      body: streamOf(bytes),
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    };
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) {
    const bytes = await readBody(value);
    const stored = { bytes, contentType: options?.httpMetadata?.contentType, customMetadata: options?.customMetadata };
    this.objects.set(key, stored);
    return this.objectView(key, stored);
  }

  async delete(key: string | string[]) {
    for (const item of Array.isArray(key) ? key : [key]) this.objects.delete(item);
  }

  async createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) {
    const uploadId = `multipart-${this.nextUpload++}`;
    this.createdKeys.push(key);
    this.multipart.set(uploadId, {
      key,
      contentType: options?.httpMetadata?.contentType,
      customMetadata: options?.customMetadata,
      parts: new Map(),
    });
    return { uploadId, ...this.multipartOperations(key, uploadId) };
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    return this.multipartOperations(key, uploadId);
  }

  private multipartOperations(key: string, uploadId: string) {
    return {
      uploadPart: async (partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob) => {
        const session = this.multipart.get(uploadId);
        if (!session || session.key !== key) throw new Error("multipart_not_found");
        const bytes = await readBody(value);
        const etag = sha256Hex(bytes);
        session.parts.set(partNumber, { bytes, etag });
        if (!key.includes("/parts/") && this.delayFirstAssemblyPart && !this.assemblyPartDelayed) {
          this.assemblyPartDelayed = true;
          this.delayFirstAssemblyPart.stored.resolve();
          await this.delayFirstAssemblyPart.release.promise;
        }
        return { partNumber, etag };
      },
      complete: async (parts: readonly { partNumber: number; etag: string }[]) => {
        const session = this.multipart.get(uploadId);
        if (!session || session.key !== key) throw new Error("multipart_not_found");
        const chunks = parts.map((receipt, index) => {
          const part = session.parts.get(receipt.partNumber);
          if (!part || part.etag !== receipt.etag || receipt.partNumber !== index + 1) throw new Error("multipart_receipt_invalid");
          if (index < parts.length - 1 && part.bytes.byteLength < 5 * 1024 * 1024) throw new Error("multipart_part_too_small");
          return part.bytes;
        });
        const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const stored = { bytes, contentType: session.contentType, customMetadata: session.customMetadata };
        this.objects.set(key, stored);
        this.multipart.delete(uploadId);
        if (key.includes("/parts/") && this.delayFirstTempComplete && !this.tempCompleteDelayed) {
          this.tempCompleteDelayed = true;
          this.delayFirstTempComplete.stored.resolve();
          await this.delayFirstTempComplete.release.promise;
        }
        if (!key.includes("/parts/") && this.failFirstFinalCompleteAfterStore && !this.finalCompleteFailed) {
          this.finalCompleteFailed = true;
          throw new Error("injected_complete_response_loss");
        }
        return this.objectView(key, stored);
      },
      abort: async () => {
        this.multipart.delete(uploadId);
      },
    };
  }
}

class FailFirstBatchD1 implements TestD1 {
  private armed = true;

  constructor(private readonly inner: TestD1) {}

  prepare(query: string) {
    return this.inner.prepare(query);
  }

  exec(query: string) {
    return this.inner.exec(query);
  }

  batch<T>(statements: D1PreparedStatementBinding[]) {
    if (this.armed) {
      this.armed = false;
      return Promise.reject(new Error("injected_restore_part_receipt_failure"));
    }
    return this.inner.batch<T>(statements);
  }
}

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationNames = [
  "0006_v2_source_and_document_foundation.sql",
  "0007_v2_document_authoring.sql",
  "0008_v2_ai_processing.sql",
  "0009_v2_grounded_enrichment.sql",
  "0010_v2_ai_runtime_governor.sql",
  "0011_v2_adaptive_knowledge.sql",
  "0012_v2_review_actions.sql",
  "0013_v2_entities_relations_and_presentation.sql",
  "0014_v2_retrieval_and_saved_views.sql",
  "0015_v2_adaptive_capture_templates.sql",
  "0016_v2_opt_in_rediscovery.sql",
  "0017_v2_portability_restore_and_legacy_migration.sql",
  "0018_v2_legacy_migration_hardening.sql",
  "0019_v2_resumable_restore_hardening.sql",
  "0020_v2_resumable_legacy_preservation_gate.sql",
  "0021_v2_resumable_backup_creation.sql",
  "0022_v2_resumable_export_packaging.sql",
  "0023_v2_resumable_backup_retention.sql",
  "0024_v2_resumable_restore_uploads.sql",
  "0025_v2_workflow_lease_fencing.sql",
  "0026_v2_legacy_terminal_reconciliation_guard.sql",
  "0027_v2_legacy_migration_quarantine.sql",
  "0028_v2_fts_source_owner_fence.sql",
  "0029_v2_provider_invocation_lease.sql",
  "0030_v2_object_backup_change_events.sql",
  "0031_v2_link_snapshot_foundation.sql", "0032_v2_prompt_curations.sql",
];

async function apply(db: TestD1) {
  await db.exec("create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');");
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

function fixtureBytes(size: number, seed: number) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + seed) & 0xff;
  return bytes;
}

async function uploadPart(input: {
  db: TestD1;
  bucket: R2BucketBinding;
  uploadId: string;
  partNumber: number;
  bytes: Uint8Array;
  expectedRevision?: number;
  now: string;
}) {
  return uploadRestorePart({
    ...input,
    userId: "user-a",
    sizeBytes: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
    body: streamOf(input.bytes),
  });
}

async function advanceUntil(input: {
  db: TestD1;
  bucket: R2BucketBinding;
  uploadId: string;
  phase?: string;
  status?: string;
  startHour?: number;
  startMinute?: number;
}) {
  let view = await getRestoreUpload(input.db, "user-a", input.uploadId);
  for (let step = 0; step < 40; step += 1) {
    if ((input.phase === undefined || view.phase === input.phase) && (input.status === undefined || view.status === input.status)) return view;
    const second = (input.startMinute ?? 20) * 60 + step;
    view = await advanceRestoreUpload({
      db: input.db,
      bucket: input.bucket,
      userId: "user-a",
      uploadId: input.uploadId,
      expectedRevision: view.stateRevision,
      now: new Date(Date.UTC(2026, 7, 28, input.startHour ?? 12, 0, second)).toISOString(),
    });
  }
  throw new Error(`Upload did not reach ${input.status ?? "*"}/${input.phase ?? "*"}: ${view.status}/${view.phase}`);
}

let platform: Platform;

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  await apply(platform.env.DB);
}, 60_000);

afterAll(async () => {
  await platform.dispose();
});

describe("resumable restore upload workflow", () => {
  test("removes its lease-scoped object when the D1 part receipt fails after R2 storage", async () => {
    const bucket = new MemoryMultipartBucket();
    const bytes = fixtureBytes(257, 5);
    let view = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-receipt-failure-cleanup",
      fileName: "receipt-failure.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T09:40:00.000Z",
    });

    const failingDb = new FailFirstBatchD1(platform.env.DB);
    await expect(uploadPart({
      db: failingDb,
      bucket,
      uploadId: view.uploadId,
      partNumber: 1,
      bytes,
      expectedRevision: view.stateRevision,
      now: "2026-08-28T09:40:01.000Z",
    })).rejects.toThrow("injected_restore_part_receipt_failure");

    await expect(platform.env.DB.prepare("select count(*) as value from v2_restore_upload_parts where upload_id=?").bind(view.uploadId).first())
      .resolves.toEqual({ value: 0 });
    await expect(platform.env.DB.prepare("select uploaded_bytes,lease_token from v2_restore_uploads where id=?").bind(view.uploadId).first())
      .resolves.toEqual({ uploaded_bytes: 0, lease_token: null });
    expect(bucket.objects.size).toBe(0);

    view = await uploadPart({
      db: platform.env.DB,
      bucket,
      uploadId: view.uploadId,
      partNumber: 1,
      bytes,
      expectedRevision: view.stateRevision,
      now: "2026-08-28T09:40:02.000Z",
    });
    expect(view).toMatchObject({ receivedParts: 1, uploadedBytes: bytes.byteLength });
  });

  test("uploads once, verifies the whole hash, stages the restore, and preserves the handed-off ZIP", async () => {
    const bucket = new MemoryMultipartBucket();
    const first = fixtureBytes(RESTORE_UPLOAD_PART_BYTES, 7);
    const last = fixtureBytes(257, 11);
    const archive = new Uint8Array(first.byteLength + last.byteLength);
    archive.set(first);
    archive.set(last, first.byteLength);
    let view = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-complete",
      fileName: "large-archive.zip",
      sizeBytes: archive.byteLength,
      archiveSha256: sha256Hex(archive),
      now: "2026-08-28T10:00:00.000Z",
    });
    view = await uploadPart({ db: platform.env.DB, bucket, uploadId: view.uploadId, partNumber: 1, bytes: first, expectedRevision: view.stateRevision, now: "2026-08-28T10:01:00.000Z" });
    const replay = await uploadPart({ db: platform.env.DB, bucket, uploadId: view.uploadId, partNumber: 1, bytes: first, expectedRevision: view.stateRevision, now: "2026-08-28T10:01:01.000Z" });
    expect(replay).toMatchObject({ receivedParts: 1, uploadedBytes: first.byteLength, stateRevision: view.stateRevision });
    view = await uploadPart({ db: platform.env.DB, bucket, uploadId: view.uploadId, partNumber: 2, bytes: last, expectedRevision: view.stateRevision, now: "2026-08-28T10:02:00.000Z" });
    view = await completeRestoreUpload({ db: platform.env.DB, userId: "user-a", uploadId: view.uploadId, expectedRevision: view.stateRevision, now: "2026-08-28T10:03:00.000Z" });
    view = await advanceUntil({ db: platform.env.DB, bucket, uploadId: view.uploadId, status: "staged" });

    expect(view).toMatchObject({ status: "staged", phase: "complete", uploadedBytes: archive.byteLength, hashVerifiedBytes: archive.byteLength });
    expect(view.restoreId).toEqual(expect.any(String));
    const row = await platform.env.DB.prepare("select final_object_key from v2_restore_uploads where id=?").bind(view.uploadId).first<{ final_object_key: string }>();
    const final = await bucket.get(row!.final_object_key);
    const finalBytes = new Uint8Array(await final!.arrayBuffer());
    // Preserve exact equality without expanding an 8 MiB typed array into
    // the test matcher's heap-heavy object comparison/diff representation.
    expect(finalBytes.byteLength).toBe(archive.byteLength);
    expect(finalBytes.findIndex((byte, index) => byte !== archive[index])).toBe(-1);
    expect(final?.customMetadata).toMatchObject({ userId: "user-a", restoreUploadId: view.uploadId, sha256: sha256Hex(archive) });
    const parts = await platform.env.DB.prepare("select temp_object_key,temp_deleted_at from v2_restore_upload_parts where upload_id=? order by part_number").bind(view.uploadId).all<{ temp_object_key: string; temp_deleted_at: string | null }>();
    expect(parts.results.every((part) => part.temp_deleted_at !== null)).toBe(true);
    await Promise.all(parts.results.map(async (part) => expect(await bucket.head(part.temp_object_key)).toBeNull()));
    await expect(platform.env.DB.prepare("select source_object_key from v2_restore_batches where id=? and user_id='user-a'").bind(view.restoreId).first())
      .resolves.toEqual({ source_object_key: row!.final_object_key });
  }, 60_000);

  test("a stale part request deletes only its attempt object after the newer lease wins", async () => {
    const bucket = new MemoryMultipartBucket();
    bucket.delayFirstTempComplete = { stored: deferred(), release: deferred() };
    const bytes = fixtureBytes(RESTORE_UPLOAD_PART_BYTES, 19);
    const created = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-part-race",
      fileName: "part-race.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T11:00:00.000Z",
    });
    const first = uploadPart({ db: platform.env.DB, bucket, uploadId: created.uploadId, partNumber: 1, bytes, expectedRevision: 0, now: "2026-08-28T11:01:00.000Z" });
    await bucket.delayFirstTempComplete.stored.promise;
    await platform.env.DB.prepare("update v2_restore_uploads set lease_expires_at='2026-08-28T11:01:30.000Z' where id=?").bind(created.uploadId).run();
    const second = await uploadPart({ db: platform.env.DB, bucket, uploadId: created.uploadId, partNumber: 1, bytes, expectedRevision: 0, now: "2026-08-28T11:02:00.000Z" });
    bucket.delayFirstTempComplete.release.resolve();
    const stale = await first;

    expect(second).toMatchObject({ receivedParts: 1, uploadedBytes: bytes.byteLength });
    expect(stale).toMatchObject({ receivedParts: 1, uploadedBytes: bytes.byteLength });
    const receipt = await platform.env.DB.prepare("select temp_object_key,sha256,size_bytes from v2_restore_upload_parts where upload_id=? and part_number=1").bind(created.uploadId)
      .first<{ temp_object_key: string; sha256: string; size_bytes: number }>();
    const attemptKeys = bucket.createdKeys.filter((key) => key.includes(`/${created.uploadId}/parts/`));
    expect(attemptKeys).toHaveLength(2);
    expect(receipt).toMatchObject({ sha256: sha256Hex(bytes), size_bytes: bytes.byteLength });
    expect(await bucket.head(receipt!.temp_object_key)).toMatchObject({ size: bytes.byteLength, customMetadata: { restoreUploadId: created.uploadId, sha256: sha256Hex(bytes) } });
    const loser = attemptKeys.find((key) => key !== receipt!.temp_object_key)!;
    expect(await bucket.head(loser)).toBeNull();
  }, 60_000);

  test("rotates multipart generations when the assembly lease expires mid-part", async () => {
    const bucket = new MemoryMultipartBucket();
    const bytes = fixtureBytes(RESTORE_UPLOAD_PART_BYTES, 23);
    let view = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-assembly-race",
      fileName: "assembly-race.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T12:00:00.000Z",
    });
    view = await uploadPart({ db: platform.env.DB, bucket, uploadId: view.uploadId, partNumber: 1, bytes, expectedRevision: view.stateRevision, now: "2026-08-28T12:01:00.000Z" });
    view = await completeRestoreUpload({ db: platform.env.DB, userId: "user-a", uploadId: view.uploadId, expectedRevision: view.stateRevision, now: "2026-08-28T12:02:00.000Z" });
    view = await advanceUntil({ db: platform.env.DB, bucket, uploadId: view.uploadId, status: "assembling", phase: "uploading_parts", startMinute: 3 });

    bucket.delayFirstAssemblyPart = { stored: deferred(), release: deferred() };
    const revision = view.stateRevision;
    const first = advanceRestoreUpload({ db: platform.env.DB, bucket, userId: "user-a", uploadId: view.uploadId, expectedRevision: revision, now: "2026-08-28T12:10:00.000Z" })
      .then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    await bucket.delayFirstAssemblyPart.stored.promise;
    await platform.env.DB.prepare("update v2_restore_uploads set lease_expires_at='2026-08-28T12:10:30.000Z' where id=?").bind(view.uploadId).run();
    const second = await advanceRestoreUpload({ db: platform.env.DB, bucket, userId: "user-a", uploadId: view.uploadId, expectedRevision: revision, now: "2026-08-28T12:11:00.000Z" });
    bucket.delayFirstAssemblyPart.release.resolve();
    const stale = await first;

    expect(second.stateRevision).toBe(revision + 1);
    expect(second).toMatchObject({ status: "assembling", phase: "creating_multipart" });
    expect(stale.value).toBeNull();
    expect(stale.error).toMatchObject({ code: "restore_upload_revision_conflict" });
    const receipt = await platform.env.DB.prepare("select multipart_etag from v2_restore_upload_parts where upload_id=? and part_number=1").bind(view.uploadId).first<{ multipart_etag: string | null }>();
    expect(receipt?.multipart_etag).toBeNull();
    await expect(platform.env.DB.prepare("select lease_token,lease_expires_at from v2_restore_uploads where id=?").bind(view.uploadId).first())
      .resolves.toEqual({ lease_token: null, lease_expires_at: null });
    await expect(advanceUntil({ db: platform.env.DB, bucket, uploadId: view.uploadId, status: "staged", startMinute: 12 }))
      .resolves.toMatchObject({ status: "staged", restoreId: expect.any(String) });
  }, 60_000);

  test("recovers a lost multipart completion response and CAS-gates a stale restore handoff", async () => {
    const bucket = new MemoryMultipartBucket();
    const bytes = fixtureBytes(257, 27);
    let view = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-stale-handoff",
      fileName: "stale-handoff.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T17:00:00.000Z",
    });
    view = await uploadPart({ db: platform.env.DB, bucket, uploadId: view.uploadId, partNumber: 1, bytes, expectedRevision: view.stateRevision, now: "2026-08-28T17:01:00.000Z" });
    view = await completeRestoreUpload({ db: platform.env.DB, userId: "user-a", uploadId: view.uploadId, expectedRevision: view.stateRevision, now: "2026-08-28T17:02:00.000Z" });
    view = await advanceUntil({ db: platform.env.DB, bucket, uploadId: view.uploadId, status: "assembling", phase: "completing", startHour: 17, startMinute: 3 });
    bucket.failFirstFinalCompleteAfterStore = true;
    view = await advanceRestoreUpload({ db: platform.env.DB, bucket, userId: "user-a", uploadId: view.uploadId, expectedRevision: view.stateRevision, now: "2026-08-28T17:08:00.000Z" });
    expect(view).toMatchObject({ status: "assembling", phase: "staging", failureCode: null });

    const row = await platform.env.DB.prepare("select final_object_key from v2_restore_uploads where id=?").bind(view.uploadId).first<{ final_object_key: string }>();
    bucket.delayNextHead = { key: row!.final_object_key, started: deferred(), release: deferred() };
    const staleStage = advanceRestoreUpload({ db: platform.env.DB, bucket, userId: "user-a", uploadId: view.uploadId, expectedRevision: view.stateRevision, now: "2026-08-28T17:10:00.000Z" })
      .then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    await bucket.delayNextHead.started.promise;
    await platform.env.DB.prepare("update v2_restore_uploads set lease_expires_at='2026-08-28T17:10:30.000Z' where id=?").bind(view.uploadId).run();
    let aborted = await requestRestoreUploadAbort({ db: platform.env.DB, userId: "user-a", uploadId: view.uploadId, expectedRevision: view.stateRevision, now: "2026-08-28T17:11:00.000Z" });
    aborted = await advanceRestoreUpload({ db: platform.env.DB, bucket, userId: "user-a", uploadId: view.uploadId, expectedRevision: aborted.stateRevision, now: "2026-08-28T17:11:01.000Z" });
    bucket.delayNextHead.release.resolve();
    const stale = await staleStage;

    expect(stale.value).toBeNull();
    expect(stale.error).toMatchObject({ code: "restore_upload_revision_conflict" });
    expect(aborted).toMatchObject({ status: "aborting", phase: "aborting" });
    expect(await bucket.head(row!.final_object_key)).toBeNull();
    await expect(platform.env.DB.prepare("select count(*) as value from v2_restore_batches where user_id='user-a' and idempotency_key='restore-upload-stale-handoff'").first())
      .resolves.toEqual({ value: 0 });
    await expect(advanceUntil({ db: platform.env.DB, bucket, uploadId: view.uploadId, status: "aborted", startHour: 17, startMinute: 12 }))
      .resolves.toMatchObject({ status: "aborted", phase: "complete" });
  }, 60_000);

  test("an old unknown failure cannot overwrite newer progress, while the current owner fails closed", async () => {
    const racedBucket = new MemoryMultipartBucket();
    racedBucket.delayFirstRangeGetError = { started: deferred(), release: deferred() };
    const bytes = fixtureBytes(257, 29);
    let raced = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-failure-race",
      fileName: "failure-race.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T13:00:00.000Z",
    });
    raced = await uploadPart({ db: platform.env.DB, bucket: racedBucket, uploadId: raced.uploadId, partNumber: 1, bytes, expectedRevision: raced.stateRevision, now: "2026-08-28T13:01:00.000Z" });
    raced = await completeRestoreUpload({ db: platform.env.DB, userId: "user-a", uploadId: raced.uploadId, expectedRevision: raced.stateRevision, now: "2026-08-28T13:02:00.000Z" });
    const staleFailure = advanceRestoreUpload({ db: platform.env.DB, bucket: racedBucket, userId: "user-a", uploadId: raced.uploadId, expectedRevision: raced.stateRevision, now: "2026-08-28T13:03:00.000Z" })
      .then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    await racedBucket.delayFirstRangeGetError.started.promise;
    await platform.env.DB.prepare("update v2_restore_uploads set lease_expires_at='2026-08-28T13:03:30.000Z' where id=?").bind(raced.uploadId).run();
    const winner = await advanceRestoreUpload({ db: platform.env.DB, bucket: racedBucket, userId: "user-a", uploadId: raced.uploadId, expectedRevision: raced.stateRevision, now: "2026-08-28T13:04:00.000Z" });
    racedBucket.delayFirstRangeGetError.release.resolve();
    const stale = await staleFailure;
    expect(stale.value).toBeNull();
    expect(stale.error).toBeInstanceOf(Error);
    expect(winner).toMatchObject({ status: "assembling", phase: "creating_multipart", failureCode: null });
    await expect(getRestoreUpload(platform.env.DB, "user-a", raced.uploadId)).resolves.toMatchObject({
      status: "assembling",
      phase: "creating_multipart",
      stateRevision: winner.stateRevision,
      failureCode: null,
    });

    const ownerBucket = new MemoryMultipartBucket();
    ownerBucket.delayFirstRangeGetError = { started: deferred(), release: deferred() };
    let owned = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-owned-failure",
      fileName: "owned-failure.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T14:00:00.000Z",
    });
    owned = await uploadPart({ db: platform.env.DB, bucket: ownerBucket, uploadId: owned.uploadId, partNumber: 1, bytes, expectedRevision: owned.stateRevision, now: "2026-08-28T14:01:00.000Z" });
    owned = await completeRestoreUpload({ db: platform.env.DB, userId: "user-a", uploadId: owned.uploadId, expectedRevision: owned.stateRevision, now: "2026-08-28T14:02:00.000Z" });
    const failed = advanceRestoreUpload({ db: platform.env.DB, bucket: ownerBucket, userId: "user-a", uploadId: owned.uploadId, expectedRevision: owned.stateRevision, now: "2026-08-28T14:03:00.000Z" });
    await ownerBucket.delayFirstRangeGetError.started.promise;
    ownerBucket.delayFirstRangeGetError.release.resolve();
    await expect(failed).rejects.toThrow("injected_unknown_r2_failure");
    await expect(getRestoreUpload(platform.env.DB, "user-a", owned.uploadId)).resolves.toMatchObject({
      status: "aborting",
      phase: "aborting",
      failureCode: "restore_upload_internal_error",
    });
    await expect(advanceUntil({ db: platform.env.DB, bucket: ownerBucket, uploadId: owned.uploadId, status: "failed", startHour: 14, startMinute: 4 }))
      .resolves.toMatchObject({ status: "failed", phase: "complete", failureCode: "restore_upload_internal_error" });
  }, 60_000);

  test("aborts on request or TTL in bounded cleanup steps without exposing another owner", async () => {
    const bytes = fixtureBytes(257, 31);
    const abortBucket = new MemoryMultipartBucket();
    let aborted = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-user-abort",
      fileName: "user-abort.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-28T15:00:00.000Z",
    });
    await expect(getRestoreUpload(platform.env.DB, "user-b", aborted.uploadId)).rejects.toMatchObject({ code: "restore_upload_not_found" });
    aborted = await uploadPart({ db: platform.env.DB, bucket: abortBucket, uploadId: aborted.uploadId, partNumber: 1, bytes, expectedRevision: aborted.stateRevision, now: "2026-08-28T15:01:00.000Z" });
    const abortReceipt = await platform.env.DB.prepare("select temp_object_key from v2_restore_upload_parts where upload_id=?").bind(aborted.uploadId).first<{ temp_object_key: string }>();
    aborted = await requestRestoreUploadAbort({ db: platform.env.DB, userId: "user-a", uploadId: aborted.uploadId, expectedRevision: aborted.stateRevision, now: "2026-08-28T15:02:00.000Z" });
    expect(aborted.status).toBe("aborting");
    aborted = await advanceUntil({ db: platform.env.DB, bucket: abortBucket, uploadId: aborted.uploadId, status: "aborted", startHour: 15, startMinute: 3 });
    expect(aborted).toMatchObject({ status: "aborted", phase: "complete" });
    expect(await abortBucket.head(abortReceipt!.temp_object_key)).toBeNull();

    const expiryBucket = new MemoryMultipartBucket();
    let expired = await createRestoreUpload({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "restore-upload-expiry",
      fileName: "expiry.zip",
      sizeBytes: bytes.byteLength,
      archiveSha256: sha256Hex(bytes),
      now: "2026-08-27T16:00:00.000Z",
    });
    expired = await uploadPart({ db: platform.env.DB, bucket: expiryBucket, uploadId: expired.uploadId, partNumber: 1, bytes, expectedRevision: expired.stateRevision, now: "2026-08-27T16:01:00.000Z" });
    const expiryReceipt = await platform.env.DB.prepare("select temp_object_key from v2_restore_upload_parts where upload_id=?").bind(expired.uploadId).first<{ temp_object_key: string }>();
    const firstCleanup = await advanceExpiredRestoreUpload({ db: platform.env.DB, bucket: expiryBucket, now: "2026-08-28T16:00:01.000Z" });
    expect(firstCleanup).toMatchObject({ processed: true, upload: { uploadId: expired.uploadId, status: "aborting" } });
    const secondCleanup = await advanceExpiredRestoreUpload({ db: platform.env.DB, bucket: expiryBucket, now: "2026-08-28T16:00:02.000Z" });
    expect(secondCleanup).toMatchObject({ processed: true, upload: { uploadId: expired.uploadId, status: "expired", phase: "complete" } });
    expect(await expiryBucket.head(expiryReceipt!.temp_object_key)).toBeNull();
  }, 60_000);
});
