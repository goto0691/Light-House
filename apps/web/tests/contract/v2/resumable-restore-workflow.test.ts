import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { WorkflowLeaseLostError } from "@/lib/v2/infrastructure/d1/workflow-lease-fence-v1";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { writeExportBundle } from "@/lib/v2/portability/export-bundle-v1";
import { createBackupSnapshot } from "@/lib/v2/portability/backup-snapshot-v1";
import { advanceBackupWorkflow, stageBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";
import { CANONICAL_TABLES_V1, canonicalTablesForSchemaVersion } from "@/lib/v2/portability/canonical-table-registry-v1";
import {
  canonicalJson,
  exportRootHash,
  LIGHTHOUSE_EXPORT_FORMAT,
  LIGHTHOUSE_EXPORT_VERSION,
  LIGHTHOUSE_SCHEMA_VERSION,
  sha256Hex,
  type ExportFileManifestV1,
  type ExportManifestV1,
} from "@/lib/v2/portability/portability-contract-v1";
import {
  advanceRestoreWorkflow,
  approveRestoreWorkflow,
  cleanupNextRestoreGeneration,
  getRestoreWorkflow,
  requestRestoreRollback,
  stageArchiveRestore,
  stageBackupRestore,
} from "@/lib/v2/portability/resumable-restore-v2";
import { createStoredZipStream, type StreamingZipEntry } from "@/lib/v2/portability/zip-stream-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;

const ATTACHMENT_ID = "resumable-attachment";
const ATTACHMENT_KEY = "users/test/originals/resumable-attachment";
const ATTACHMENT_BYTES = new TextEncoder().encode("resumable-restore-original-fixture");
const ATTACHMENT_HASH = sha256Hex(ATTACHMENT_BYTES);

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
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a');`);
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}

class CountingD1 implements D1DatabaseBinding {
  statements = 0;
  private readonly prepared = new WeakMap<D1PreparedStatementBinding, D1PreparedStatementBinding>();
  constructor(private readonly inner: D1DatabaseBinding) {}
  prepare(query: string): D1PreparedStatementBinding {
    let prepared = this.inner.prepare(query);
    const owner = this;
    const wrapper: D1PreparedStatementBinding = {
      bind(...values: unknown[]) { prepared = prepared.bind(...values); owner.prepared.set(wrapper, prepared); return wrapper; },
      async first<T>() { owner.statements += 1; return prepared.first<T>(); },
      async all<T>() { owner.statements += 1; return prepared.all<T>(); },
      async run() { owner.statements += 1; return prepared.run(); },
    };
    this.prepared.set(wrapper, prepared);
    return wrapper;
  }
  async batch<T>(statements: D1PreparedStatementBinding[]) {
    this.statements += statements.length;
    return this.inner.batch<T>(statements.map((statement) => this.prepared.get(statement) ?? statement));
  }
}

class FailNextWriteD1 implements D1DatabaseBinding {
  private readonly prepared = new WeakMap<D1PreparedStatementBinding, D1PreparedStatementBinding>();
  private armed = true;

  constructor(private readonly inner: D1DatabaseBinding, private writesBeforeFailure = 1) {}

  private failOnce() {
    if (this.writesBeforeFailure > 0) { this.writesBeforeFailure -= 1; return; }
    if (!this.armed) return;
    this.armed = false;
    throw new Error("restore_injected_failure");
  }

  prepare(query: string): D1PreparedStatementBinding {
    let prepared = this.inner.prepare(query);
    const owner = this;
    const wrapper: D1PreparedStatementBinding = {
      bind(...values: unknown[]) { prepared = prepared.bind(...values); owner.prepared.set(wrapper, prepared); return wrapper; },
      first<T>() { return prepared.first<T>(); },
      all<T>() { return prepared.all<T>(); },
      async run() { owner.failOnce(); return prepared.run(); },
    };
    this.prepared.set(wrapper, prepared);
    return wrapper;
  }

  async batch<T>(statements: D1PreparedStatementBinding[]) {
    this.failOnce();
    return this.inner.batch<T>(statements.map((statement) => this.prepared.get(statement) ?? statement));
  }
}

class ThrowAfterCommittedBatchD1 implements D1DatabaseBinding {
  private armed = true;

  constructor(private readonly inner: D1DatabaseBinding) {}

  prepare(query: string) { return this.inner.prepare(query); }

  async batch<T>(statements: D1PreparedStatementBinding[]) {
    const result = await this.inner.batch<T>(statements);
    if (this.armed) {
      this.armed = false;
      throw new Error("restore_simulated_lost_commit_response");
    }
    return result;
  }
}

class DelayRestoreGenerationPut implements R2BucketBinding {
  private startedResolve!: () => void;
  private releaseResolve!: () => void;
  readonly started = new Promise<void>((resolve) => { this.startedResolve = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.releaseResolve = resolve; });
  generationKey: string | null = null;
  constructor(private readonly inner: R2BucketBinding) {}
  release() { this.releaseResolve(); }
  head(key: string) { return this.inner.head(key); }
  get(key: string, options?: { range?: { offset: number; length: number } }) { return this.inner.get(key, options); }
  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: Parameters<R2BucketBinding["put"]>[2]) {
    if (key.includes("/restore-generations/")) {
      // Drain the source before pausing the destination PUT. This models a late
      // network completion without keeping the restore archive stream open,
      // allowing rollback cleanup to reach its terminal state first.
      if (value instanceof ReadableStream) value = new Uint8Array(await new Response(value).arrayBuffer());
      this.generationKey = key;
      this.startedResolve();
      await this.released;
    }
    return this.inner.put(key, value, options);
  }
  delete(key: string | string[]) { return this.inner.delete(key); }
  async createMultipartUpload(key: string, options?: Parameters<NonNullable<R2BucketBinding["createMultipartUpload"]>>[1]) {
    const upload = await this.inner.createMultipartUpload!(key, options);
    if (!key.includes("/restore-generations/")) return upload;
    this.generationKey = key;
    return {
      uploadId: upload.uploadId,
      uploadPart: (partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob) => upload.uploadPart(partNumber, value),
      complete: async (parts: readonly { partNumber: number; etag: string }[]) => {
        const stored = await upload.complete(parts);
        this.startedResolve();
        await this.released;
        return stored;
      },
      abort: () => upload.abort(),
    };
  }
  resumeMultipartUpload(key: string, uploadId: string) { return this.inner.resumeMultipartUpload!(key, uploadId); }
}

let source: Platform;
let target: Platform;

beforeAll(async () => {
  source = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  target = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(source.env.DB);
  await apply(target.env.DB);
}, 60_000);

afterAll(async () => { await Promise.all([source.dispose(), target.dispose()]); });

async function migrationArchive() {
  await source.env.ARCHIVE_ASSETS.put(ATTACHMENT_KEY, ATTACHMENT_BYTES, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { reservationId: ATTACHMENT_ID, userId: "user-a", sha256: ATTACHMENT_HASH },
    sha256: Uint8Array.from(ATTACHMENT_HASH.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16)),
  });
  await source.env.DB.prepare(`insert or ignore into v2_attachment_reservations
    (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at,committed_at)
    values (?,'user-a','verified',?,'fixture.png','image/png',?,?,?,'2026-08-29T10:00:00.000Z',?,null)`)
    .bind(ATTACHMENT_ID, ATTACHMENT_KEY, ATTACHMENT_BYTES.byteLength, ATTACHMENT_HASH, "2026-08-28T09:59:00.000Z", "2026-08-28T09:59:30.000Z").run();
  const committed = await prepareCaptureCommit({
    draftId: "resumable-restore-draft", channel: "web", title: "중단 가능한 복원", bodyMarkdown: "# 안전한 복원\n\n작은 단계로 이어간다.\n",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-08-28T10:00:00.000Z",
    sources: [{ kind: "image", contentHash: ATTACHMENT_HASH, attachmentId: ATTACHMENT_ID, metadata: { source: "restore-test" } }],
  }, "resumable-restore-capture", "2026-08-28T10:00:01.000Z");
  const receipt = await new D1SourceFoundationRepository(source.env.DB, "user-a").commitCapture(committed);
  const jobs = new D1PortabilityRepository(source.env.DB, "user-a");
  const queued = await jobs.createExport({
    profile: "migration",
    scope: { objects: "all", privacyLevels: ["normal"], includeTrash: false, includeHistory: true, includeOriginals: true },
    idempotencyKey: "resumable-restore-export",
    now: "2026-08-28T10:01:00.000Z",
  });
  const claimed = await jobs.claimExport(queued.id, "2026-08-28T10:01:01.000Z");
  const written = await writeExportBundle({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", job: claimed });
  const object = await source.env.ARCHIVE_ASSETS.get(written.objectKey);
  if (!object) throw new Error("Expected migration archive.");
  return {
    bytes: new Uint8Array(await object.arrayBuffer()),
    // The fixture is intentionally idempotent and is called by multiple tests.
    // On replay, the prepared IDs are new but the stored export still points at
    // the canonical IDs returned by the original commit receipt.
    objectId: receipt.recordId,
    attachmentId: ATTACHMENT_ID,
    attachmentBytes: ATTACHMENT_BYTES,
    attachmentHash: ATTACHMENT_HASH,
    attachmentSourceItemId: receipt.sourceItemIds.at(-1)!,
  };
}

async function collectStream(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      chunks.push(item.value);
      length += item.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined;
}

function insertBeforeZipEndRecord(bytes: Uint8Array, hidden: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endRecordOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endRecordOffset = offset;
      break;
    }
  }
  if (endRecordOffset < 0) throw new Error("ZIP end record fixture is missing.");
  const result = new Uint8Array(bytes.byteLength + hidden.byteLength);
  result.set(bytes.subarray(0, endRecordOffset));
  result.set(hidden, endRecordOffset);
  result.set(bytes.subarray(endRecordOffset), endRecordOffset + hidden.byteLength);
  return result;
}

async function minimalAttachmentArchive(includeOriginals: boolean, options: { missingCommittedOriginal?: boolean } = {}) {
  const exportId = includeOriginals ? "minimal-attachment-with-original" : "minimal-attachment-without-original";
  const createdAt = "2026-08-28T15:00:00.000Z";
  const captureId = `${exportId}-capture`;
  const sourceItemId = `${exportId}-source`;
  const attachmentId = `${exportId}-attachment`;
  const attachmentBytes = new TextEncoder().encode(`original:${exportId}`);
  const attachmentHash = sha256Hex(attachmentBytes);
  const envelope = (row: Record<string, unknown>) => `${canonicalJson({ ...row, schema_version: LIGHTHOUSE_SCHEMA_VERSION, user_scope_export_id: exportId })}\n`;
  const attachmentRows: Record<string, unknown>[] = [{
    id: attachmentId, user_id: "user-a", status: "committed", object_key: `legacy/${attachmentId}`, filename: "fixture.png",
    mime_type: "image/png", size_bytes: attachmentBytes.byteLength, sha256: attachmentHash, created_at: createdAt,
    expires_at: "2026-08-29T15:00:00.000Z", verified_at: createdAt, committed_at: createdAt,
  }];
  if (options.missingCommittedOriginal) {
    const missingBytes = new TextEncoder().encode(`missing:${exportId}`);
    attachmentRows.push({
      id: `${attachmentId}-missing`, user_id: "user-a", status: "committed", object_key: `legacy/${attachmentId}-missing`, filename: "missing.png",
      mime_type: "image/png", size_bytes: missingBytes.byteLength, sha256: sha256Hex(missingBytes), created_at: createdAt,
      expires_at: "2026-08-29T15:00:00.000Z", verified_at: createdAt, committed_at: createdAt,
    });
  }
  const payloads: { path: string; mediaType: string; bytes: Uint8Array; records: number }[] = [
    { path: "README.md", mediaType: "text/markdown; charset=utf-8", bytes: new TextEncoder().encode("# Minimal restore fixture\n"), records: 0 },
    {
      path: "sources/captures.jsonl",
      mediaType: "application/x-ndjson; charset=utf-8",
      bytes: new TextEncoder().encode(envelope({
        id: captureId, user_id: "user-a", draft_id: `${exportId}-draft`, capture_channel: "import", user_note: "attachment restore fixture",
        ai_enabled: 0, client_timezone: "Asia/Seoul", processing_status: "completed", processing_priority: "migration",
        content_hash: `sha256:${sha256Hex(exportId)}`, template_version_id: null, captured_at: createdAt, committed_at: createdAt, created_at: createdAt,
      })),
      records: 1,
    },
    {
      path: "attachments/metadata.jsonl",
      mediaType: "application/x-ndjson; charset=utf-8",
      bytes: new TextEncoder().encode(attachmentRows.map(envelope).join("")),
      records: attachmentRows.length,
    },
    {
      path: "sources/source-items.jsonl",
      mediaType: "application/x-ndjson; charset=utf-8",
      bytes: new TextEncoder().encode(envelope({
        id: sourceItemId, user_id: "user-a", capture_id: captureId, item_kind: "image", display_order: 0, raw_text: null,
        content_hash: `sha256:${attachmentHash}`, source_metadata: "{}", immutability_version: 1, created_at: createdAt,
      })),
      records: 1,
    },
    {
      path: "sources/source-attachment-links.jsonl",
      mediaType: "application/x-ndjson; charset=utf-8",
      bytes: new TextEncoder().encode(envelope({ user_id: "user-a", source_item_id: sourceItemId, attachment_id: attachmentId, created_at: createdAt })),
      records: 1,
    },
  ];
  // A minimal fixture still represents the complete declared schema. Empty
  // canonical files distinguish an empty table from omitted backup data.
  const canonicalTables = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION);
  for (const descriptor of canonicalTables) {
    if (!payloads.some((payload) => payload.path === descriptor.path)) {
      payloads.push({ path: descriptor.path, mediaType: "application/x-ndjson; charset=utf-8", bytes: new Uint8Array(), records: 0 });
    }
  }
  if (includeOriginals) payloads.push({
    path: `attachments/originals/${attachmentId}/fixture.png`,
    mediaType: "image/png",
    bytes: attachmentBytes,
    records: 1,
  });
  const files: ExportFileManifestV1[] = payloads.map((payload) => ({
    path: payload.path,
    bytes: payload.bytes.byteLength,
    mediaType: payload.mediaType,
    sha256: sha256Hex(payload.bytes),
    records: payload.records,
  }));
  const manifest: ExportManifestV1 = {
    format: LIGHTHOUSE_EXPORT_FORMAT,
    version: LIGHTHOUSE_EXPORT_VERSION,
    profile: "migration",
    exportId,
    createdAt,
    sourceAppVersion: "test",
    schemaVersion: LIGHTHOUSE_SCHEMA_VERSION,
    userTimezone: "Asia/Seoul",
    scope: { objects: "all", privacyLevels: ["normal"], includeTrash: false, includeHistory: true, includeOriginals },
    counts: Object.fromEntries(canonicalTables.map((descriptor) => [descriptor.table, payloads.find((payload) => payload.path === descriptor.path)!.records])),
    files,
    rootHash: exportRootHash(files),
    baseSequence: 0,
    endSequence: 0,
    warnings: includeOriginals ? [] : ["attachment_originals_excluded_by_scope"],
  };
  const checksums = `${files.slice().sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`;
  const entries: StreamingZipEntry[] = [
    ...payloads.map((payload) => ({ path: payload.path, source: payload.bytes })),
    { path: "checksums.sha256", source: checksums },
    { path: "manifest.json", source: `${canonicalJson(manifest)}\n` },
  ];
  const bytes = await collectStream(createStoredZipStream((async function* () { yield* entries; })()));
  return { bytes, attachmentBytes, attachmentHash, attachmentId, captureId, sourceItemId };
}

async function advanceUntil(bucket: R2BucketBinding, counted: CountingD1, batchId: string, terminal: readonly string[]) {
  let view: Awaited<ReturnType<typeof advanceRestoreWorkflow>> | null = null;
  for (let step = 0; step < 500; step += 1) {
    counted.statements = 0;
    view = await advanceRestoreWorkflow({ db: counted, bucket, userId: "user-a", batchId, now: new Date(Date.UTC(2026, 7, 28, 11, 0, step)).toISOString() });
    expect(counted.statements).toBeLessThanOrEqual(40);
    if (terminal.includes(view.status)) return view;
  }
  throw new Error(`Restore did not reach ${terminal.join("|")}: ${view?.status}`);
}

describe("resumable restore v2", () => {
  test("preserves an adopted generation when the fenced D1 commit response is lost", async () => {
    const fixture = await migrationArchive();
    const destination = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
    try {
      await apply(destination.env.DB);
      const staged = await stageArchiveRestore({ db: destination.env.DB, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", idempotencyKey: "restore-lost-commit-response", archiveSha256: sha256Hex(fixture.bytes), fileName: "lost-response.zip", body: fixture.bytes, sizeBytes: fixture.bytes.byteLength });
      const counted = new CountingD1(destination.env.DB);
      const planned = await advanceUntil(destination.env.ARCHIVE_ASSETS, counted, staged.batchId, ["awaiting_approval", "failed"]);
      await approveRestoreWorkflow({ db: destination.env.DB, userId: "user-a", batchId: staged.batchId, expectedDryRunHash: planned.dryRun!.dryRunHash, expectedRevision: planned.stateRevision });
      await destination.env.DB.prepare(`update v2_restore_rows set plan_position=-1 where restore_batch_id=? and table_name='v2_attachment_reservations' and apply_status='ready'`).bind(staged.batchId).run();

      const uncertainDb = new ThrowAfterCommittedBatchD1(destination.env.DB);
      await expect(advanceRestoreWorkflow({ db: uncertainDb, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId }))
        .rejects.toThrow("restore_simulated_lost_commit_response");

      const adopted = await destination.env.DB.prepare(`select object_key from v2_attachment_reservations where user_id='user-a' and instr(object_key,?)>0 limit 1`)
        .bind(`/restore-generations/${staged.batchId}/`).first<{ object_key: string }>();
      expect(adopted?.object_key).toContain(`/restore-generations/${staged.batchId}/`);
      await expect(destination.env.ARCHIVE_ASSETS.head(adopted!.object_key)).resolves.toBeTruthy();
      await expect(destination.env.DB.prepare(`select count(*) as value from v2_restore_generation_cleanup_receipts where restore_id=?`).bind(staged.batchId).first()).resolves.toEqual({ value: 0 });
    } finally { await destination.dispose(); }
  }, 240_000);

  test("fences an in-flight generation PUT during rollback and leaves no shared-key orphan", async () => {
    const fixture = await migrationArchive();
    const destination = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
    try {
      await apply(destination.env.DB);
      const staged = await stageArchiveRestore({ db: destination.env.DB, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", idempotencyKey: "restore-generation-race", archiveSha256: sha256Hex(fixture.bytes), fileName: "race.zip", body: fixture.bytes, sizeBytes: fixture.bytes.byteLength });
      const counted = new CountingD1(destination.env.DB);
      const planned = await advanceUntil(destination.env.ARCHIVE_ASSETS, counted, staged.batchId, ["awaiting_approval", "failed"]);
      await approveRestoreWorkflow({ db: destination.env.DB, userId: "user-a", batchId: staged.batchId, expectedDryRunHash: planned.dryRun!.dryRunHash, expectedRevision: planned.stateRevision });
      await expect(destination.env.DB.prepare(`select r2_object_key from v2_restore_rows where restore_batch_id=? and table_name='v2_attachment_reservations' and apply_status='ready'`).bind(staged.batchId).first()).resolves.toBeTruthy();
      // Put the attachment at the head of the already-approved journal so the
      // race test does not spend minutes applying unrelated fixture rows.
      await destination.env.DB.prepare(`update v2_restore_rows set plan_position=-1 where restore_batch_id=? and table_name='v2_attachment_reservations' and apply_status='ready'`).bind(staged.batchId).run();
      const delayedBucket = new DelayRestoreGenerationPut(destination.env.ARCHIVE_ASSETS);
      const staleApply = advanceRestoreWorkflow({ db: destination.env.DB, bucket: delayedBucket, userId: "user-a", batchId: staged.batchId })
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      const first = await Promise.race([
        delayedBucket.started.then(() => ({ started: true as const })),
        staleApply.then((result) => ({ started: false as const, result })),
      ]);
      expect(first).toEqual({ started: true });
      const active = await getRestoreWorkflow(destination.env.DB, "user-a", staged.batchId);
      await requestRestoreRollback({ db: destination.env.DB, userId: "user-a", batchId: staged.batchId, expectedRevision: active.stateRevision });
      let rollback = await getRestoreWorkflow(destination.env.DB, "user-a", staged.batchId);
      for (let step = 0; step < 30 && rollback.status !== "rolled_back"; step += 1) {
        rollback = await advanceRestoreWorkflow({ db: destination.env.DB, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId });
      }
      expect(rollback.status).toBe("rolled_back");
      delayedBucket.release();
      const stale = await staleApply;
      expect("error" in stale ? stale.error : null).toBeInstanceOf(WorkflowLeaseLostError);
      expect(delayedBucket.generationKey).toContain(`/restore-generations/${staged.batchId}/`);
      await expect(destination.env.DB.prepare(`select count(*) as value from v2_attachment_reservations where object_key=?`).bind(delayedBucket.generationKey).first()).resolves.toEqual({ value: 0 });
      await expect(destination.env.DB.prepare(`select count(*) as value from v2_restore_generation_cleanup_receipts where restore_id=? and object_key=? and armed_at is not null`).bind(staged.batchId, delayedBucket.generationKey).first()).resolves.toEqual({ value: 1 });
      // The ambiguous catch never deletes directly. A later bounded sweep first
      // confirms that no committed reservation adopted this generation.
      await expect(destination.env.ARCHIVE_ASSETS.head(delayedBucket.generationKey!)).resolves.toBeTruthy();
      await expect(cleanupNextRestoreGeneration({ db: destination.env.DB, bucket: destination.env.ARCHIVE_ASSETS, now: "2099-01-01T00:00:00.000Z" })).resolves.toMatchObject({ cleaned: 1, restoreId: staged.batchId });
      await expect(destination.env.ARCHIVE_ASSETS.head(delayedBucket.generationKey!)).resolves.toBeNull();
      await expect(destination.env.DB.prepare(`select count(*) as value from v2_restore_generation_cleanup_receipts where restore_id=? and object_key=?`).bind(staged.batchId, delayedBucket.generationKey).first()).resolves.toEqual({ value: 1 });
    } finally { await destination.dispose(); }
  }, 240_000);

  test("rejects hidden bytes between the ZIP central directory and end record", async () => {
    const fixture = await minimalAttachmentArchive(false);
    const archive = insertBeforeZipEndRecord(fixture.bytes, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    const staged = await stageArchiveRestore({
      db: target.env.DB,
      bucket: target.env.ARCHIVE_ASSETS,
      userId: "user-a",
      idempotencyKey: "restore-hidden-central-gap",
      archiveSha256: sha256Hex(archive),
      fileName: "hidden-central-gap.zip",
      body: archive,
      sizeBytes: archive.byteLength,
      now: "2026-08-28T07:50:00.000Z",
    });

    await expect(advanceRestoreWorkflow({
      db: target.env.DB,
      bucket: target.env.ARCHIVE_ASSETS,
      userId: "user-a",
      batchId: staged.batchId,
      now: "2026-08-28T07:50:01.000Z",
    })).rejects.toMatchObject({ code: "archive_invalid" });
    await expect(getRestoreWorkflow(target.env.DB, "user-a", staged.batchId)).resolves.toMatchObject({
      status: "failure_cleaning",
      failureCode: "archive_invalid",
    });
  });

  test("creates and verifies a fragmented backup with bounded D1 work per continuation", async () => {
    const platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
    try {
      await apply(platform.env.DB);
      const counted = new CountingD1(platform.env.DB);
      let view = await stageBackupWorkflow({ db: counted, userId: "user-a", kind: "full", retentionClass: "manual", idempotencyKey: "resumable-backup-create-one", now: "2026-08-28T08:00:00.000Z" });
      expect(counted.statements).toBeLessThanOrEqual(10);
      expect(view.status).toBe("building");
      const replay = await stageBackupWorkflow({ db: platform.env.DB, userId: "user-a", kind: "full", retentionClass: "manual", idempotencyKey: "resumable-backup-create-one", now: "2026-08-28T08:00:01.000Z" });
      expect(replay.snapshotId).toBe(view.snapshotId);
      for (let step = 0; step < 200 && view.status === "building"; step += 1) {
        counted.statements = 0;
        const previousRevision = view.stateRevision;
        view = await advanceBackupWorkflow({ db: counted, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: view.snapshotId, now: `2026-08-28T08:${String(Math.floor(step / 60)).padStart(2, "0")}:${String(step % 60).padStart(2, "0")}.000Z` });
        expect(counted.statements).toBeLessThanOrEqual(15);
        expect(view.stateRevision).toBeGreaterThan(previousRevision);
      }
      expect(view).toMatchObject({ status: "succeeded", phase: "complete", progress: { tablesComplete: CANONICAL_TABLES_V1.length, tablesTotal: CANONICAL_TABLES_V1.length } });
      const row = await platform.env.DB.prepare(`select manifest_object_key from v2_backup_snapshots where id=?`).bind(view.snapshotId).first<{ manifest_object_key: string }>();
      const object = await platform.env.ARCHIVE_ASSETS.get(row!.manifest_object_key);
      const manifest = JSON.parse(await new Response(object!.body).text()) as { version: number; metadataFiles: { path: string }[]; metadataModes: Record<string, string> };
      expect(manifest.version).toBe(2);
      expect(manifest.metadataFiles).toHaveLength(CANONICAL_TABLES_V1.length);
      expect(manifest.metadataFiles.every((file) => file.path.includes(".jsonl.parts/00000000.jsonl"))).toBe(true);
      expect(Object.keys(manifest.metadataModes)).toHaveLength(CANONICAL_TABLES_V1.length);
      const restore = await stageBackupRestore({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", idempotencyKey: "fragmented-backup-restore-one", snapshotId: view.snapshotId, now: "2026-08-28T09:00:00.000Z" });
      let restoreView = restore;
      for (let step = 0; step < 5 && restoreView.status === "backup_indexing"; step += 1) {
        restoreView = await advanceRestoreWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", batchId: restore.batchId, now: `2026-08-28T09:00:0${step + 1}.000Z` });
      }
      expect(restoreView.status).toBe("verifying");
      await expect(platform.env.DB.prepare(`select count(*) as value from v2_restore_files where restore_batch_id=? and kind='metadata'`).bind(restore.batchId).first()).resolves.toEqual({ value: CANONICAL_TABLES_V1.length });

      const leaseProbe = await stageBackupWorkflow({ db: platform.env.DB, userId: "user-a", kind: "full", retentionClass: "manual", idempotencyKey: "backup-lease-probe", now: "2026-08-28T09:10:00.000Z" });
      await platform.env.DB.prepare(`update v2_backup_snapshots set lease_token='other-owner',lease_expires_at='2026-08-28T09:12:00.000Z' where id=?`).bind(leaseProbe.snapshotId).run();
      await expect(advanceBackupWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: leaseProbe.snapshotId, now: "2026-08-28T09:11:00.000Z" })).rejects.toThrow("backup_workflow_busy");
      await platform.env.DB.prepare(`update v2_backup_snapshots set lease_expires_at='2026-08-28T09:10:59.000Z' where id=?`).bind(leaseProbe.snapshotId).run();
      await expect(advanceBackupWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: leaseProbe.snapshotId, now: "2026-08-28T09:11:00.000Z" })).resolves.toMatchObject({ stateRevision: 2 });
      await expect(platform.env.DB.prepare(`select lease_token,lease_expires_at from v2_backup_snapshots where id=?`).bind(leaseProbe.snapshotId).first()).resolves.toEqual({ lease_token: null, lease_expires_at: null });

      await platform.env.DB.prepare(`insert into v2_change_events (user_id,aggregate_kind,aggregate_id,operation,occurred_at) values ('user-a','object','changed-after-snapshot','upsert','2026-08-28T09:20:00.000Z')`).run();
      await platform.env.DB.prepare(`update v2_backup_snapshots set status='building',build_phase='manifest_verifying',verified_at=null where id=?`).bind(view.snapshotId).run();
      view = await advanceBackupWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: view.snapshotId, now: "2026-08-28T09:20:01.000Z" });
      expect(view).toMatchObject({ status: "building", phase: "failure_cleaning", failureCode: "backup_source_changed_retry" });
      for (let step = 0; step < 100 && view.status === "building"; step += 1) view = await advanceBackupWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: view.snapshotId, now: new Date(Date.parse("2026-08-28T09:21:00.000Z") + step * 1_000).toISOString() });
      expect(view).toMatchObject({ status: "failed", failureCode: "backup_source_changed_retry" });
      await expect(platform.env.DB.prepare(`select count(*) as value from v2_backup_metadata_files where snapshot_id=?`).bind(view.snapshotId).first()).resolves.toEqual({ value: 0 });
      await expect(platform.env.DB.prepare(`select manifest_object_key from v2_backup_snapshots where id=?`).bind(view.snapshotId).first()).resolves.toEqual({ manifest_object_key: null });

      const cleanupId = "multipart-cleanup-fixture";
      const cleanupKey = "users/test/backups/blobs/sha256/cleanup";
      const upload = await platform.env.ARCHIVE_ASSETS.createMultipartUpload!(cleanupKey, { customMetadata: { sha256: "d".repeat(64) } });
      await platform.env.DB.prepare(`insert into v2_backup_snapshots (id,user_id,snapshot_kind,status,base_sequence,end_sequence,retention_class,created_at,workflow_version,idempotency_key,build_phase,cursor_json,state_revision,failure_code,last_progress_at) values (?,'user-a','full','building',0,0,'manual','2026-08-28T09:30:00.000Z',2,'multipart-cleanup-idempotency','failure_cleaning','{}',0,'backup_blob_validation_failed','2026-08-28T09:30:00.000Z')`).bind(cleanupId).run();
      await platform.env.DB.batch([
        platform.env.DB.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values (?,'user-a',?,?,8,'application/octet-stream','2026-08-28T09:30:00.000Z')`).bind(cleanupId, "d".repeat(64), cleanupKey),
        platform.env.DB.prepare(`insert into v2_backup_blob_work_items (snapshot_id,user_id,sha256,source_object_key,object_key,size_bytes,media_type,status,upload_id,created_at) values (?,'user-a',?, 'source',?,8,'application/octet-stream','uploading',?,'2026-08-28T09:30:00.000Z')`).bind(cleanupId, "d".repeat(64), cleanupKey, upload.uploadId),
        platform.env.DB.prepare(`insert into v2_backup_blob_members (snapshot_id,user_id,sha256,attachment_id) values (?,'user-a',?,'attachment-cleanup')`).bind(cleanupId, "d".repeat(64)),
      ]);
      let cleanup = await advanceBackupWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: cleanupId, now: "2026-08-28T09:30:01.000Z" });
      for (let step = 0; step < 5 && cleanup.status === "building"; step += 1) cleanup = await advanceBackupWorkflow({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: cleanupId, now: `2026-08-28T09:30:0${step + 2}.000Z` });
      expect(cleanup).toMatchObject({ status: "failed", failureCode: "backup_blob_validation_failed" });
      await expect(platform.env.DB.prepare(`select count(*) as value from v2_backup_blob_refs where snapshot_id=?`).bind(cleanupId).first()).resolves.toEqual({ value: 0 });
      await expect(platform.env.DB.prepare(`select object_key,deleted_at from v2_backup_blob_gc_marks where user_id='user-a' and sha256=?`).bind("d".repeat(64)).first()).resolves.toEqual({ object_key: cleanupKey, deleted_at: null });
    } finally { await platform.dispose(); }
  }, 300_000);
  test("stages once, advances below the Free query budget, imports, and preserves later edits during rollback", async () => {
    const fixture = await migrationArchive();
    const hash = sha256Hex(fixture.bytes);
    const staged = await stageArchiveRestore({
      db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", idempotencyKey: "resumable-restore-one",
      archiveSha256: hash, fileName: "restore.zip", body: fixture.bytes, sizeBytes: fixture.bytes.byteLength, now: "2026-08-28T10:30:00.000Z",
    });
    const replay = await stageArchiveRestore({
      db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", idempotencyKey: "resumable-restore-one",
      archiveSha256: hash, fileName: "restore.zip", body: fixture.bytes, sizeBytes: fixture.bytes.byteLength, now: "2026-08-28T10:30:01.000Z",
    });
    expect(replay.batchId).toBe(staged.batchId);

    const counted = new CountingD1(target.env.DB);
    const planned = await advanceUntil(target.env.ARCHIVE_ASSETS, counted, staged.batchId, ["awaiting_approval", "failed"]);
    expect(planned.status).toBe("awaiting_approval");
    expect(planned.dryRun?.counts).toMatchObject({ conflict: 0, invalid: 0 });
    await approveRestoreWorkflow({ db: target.env.DB, userId: "user-a", batchId: staged.batchId, expectedDryRunHash: planned.dryRun!.dryRunHash, expectedRevision: planned.stateRevision, now: "2026-08-28T12:00:00.000Z" });
    const restored = await advanceUntil(target.env.ARCHIVE_ASSETS, counted, staged.batchId, ["succeeded", "failed", "rollback_requested"]);
    expect(restored.status).toBe("succeeded");
    await expect(new D1SourceFoundationRepository(target.env.DB, "user-a").getRecord(fixture.objectId)).resolves.toMatchObject({ title: "중단 가능한 복원" });
    const restoredAttachment = await target.env.DB.prepare(`select status,object_key,filename,mime_type,size_bytes,sha256 from v2_attachment_reservations where id=? and user_id='user-a'`)
      .bind(fixture.attachmentId).first<{ status: string; object_key: string; filename: string; mime_type: string; size_bytes: number; sha256: string }>();
    expect(restoredAttachment).toMatchObject({
      status: "committed",
      filename: "fixture.png",
      mime_type: "image/png",
      size_bytes: fixture.attachmentBytes.byteLength,
      sha256: fixture.attachmentHash,
    });
    expect(restoredAttachment?.object_key).toContain(`/restored-originals/${fixture.attachmentId}/restore-generations/${staged.batchId}/${fixture.attachmentHash}`);
    const restoredOriginal = await target.env.ARCHIVE_ASSETS.get(restoredAttachment!.object_key);
    expect(new Uint8Array(await restoredOriginal!.arrayBuffer())).toEqual(fixture.attachmentBytes);
    expect(restoredOriginal?.customMetadata).toMatchObject({
      userId: "user-a",
      reservationId: fixture.attachmentId,
      restoreBatchId: staged.batchId,
      sha256: fixture.attachmentHash,
    });
    await expect(target.env.DB.prepare(`select source_item_id from v2_source_attachment_links where attachment_id=?`).bind(fixture.attachmentId).first())
      .resolves.toEqual({ source_item_id: fixture.attachmentSourceItemId });
    await expect(target.env.DB.prepare(`select apply_status,r2_status,r2_object_key from v2_restore_rows where restore_batch_id=? and table_name='v2_attachment_reservations'`).bind(staged.batchId).first())
      .resolves.toMatchObject({ apply_status: "applied", r2_status: "committed", r2_object_key: restoredAttachment!.object_key });

    await target.env.DB.prepare(`update v2_objects set updated_at='2026-08-28T13:00:00.000Z' where id=? and user_id='user-a'`).bind(fixture.objectId).run();
    await requestRestoreRollback({ db: target.env.DB, userId: "user-a", batchId: staged.batchId, expectedRevision: (await getRestoreWorkflow(target.env.DB, "user-a", staged.batchId)).stateRevision, now: "2026-08-28T13:01:00.000Z" });
    const rolledBack = await advanceUntil(target.env.ARCHIVE_ASSETS, counted, staged.batchId, ["rolled_back", "rollback_conflicted"]);
    expect(rolledBack.status).toBe("rollback_conflicted");
    expect(rolledBack.progress.rollbackConflicts).toBeGreaterThan(0);
    expect(await target.env.DB.prepare(`select id from v2_objects where id=?`).bind(fixture.objectId).first()).toEqual({ id: fixture.objectId });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_source_attachment_links where attachment_id=?`).bind(fixture.attachmentId).first()).toEqual({ value: 0 });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_attachment_reservations where id=?`).bind(fixture.attachmentId).first()).toEqual({ value: 0 });
    await expect(target.env.ARCHIVE_ASSETS.head(restoredAttachment!.object_key)).resolves.toBeNull();
  }, 180_000);

  test("fails closed when committed attachment metadata is exported without its original", async () => {
    const destination = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
    try {
      await apply(destination.env.DB);
      const fixture = await minimalAttachmentArchive(true, { missingCommittedOriginal: true });
      const staged = await stageArchiveRestore({
        db: destination.env.DB,
        bucket: destination.env.ARCHIVE_ASSETS,
        userId: "user-a",
        idempotencyKey: "resumable-missing-original",
        archiveSha256: sha256Hex(fixture.bytes),
        fileName: "missing-original.zip",
        body: fixture.bytes,
        sizeBytes: fixture.bytes.byteLength,
        now: "2026-08-28T15:01:00.000Z",
      });
      const counted = new CountingD1(destination.env.DB);
      let rejected: unknown;
      // Each declared canonical file is independently verified and then
      // materialized, even when empty; allow the indexing/planning steps too.
      const validationAdvances = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION).length * 2 + 20;
      let lastStatus: string | undefined;
      for (let step = 0; step < validationAdvances; step += 1) {
        counted.statements = 0;
        try {
          lastStatus = (await advanceRestoreWorkflow({ db: counted, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId, now: new Date(Date.UTC(2026, 7, 28, 15, 2, step)).toISOString() })).status;
        } catch (error) {
          rejected = error;
          break;
        }
        expect(counted.statements).toBeLessThanOrEqual(40);
      }
      expect(rejected, `Expected original validation within ${validationAdvances} advances; last phase: ${lastStatus}`).toMatchObject({ code: "attachment_original_invalid" });
      await expect(getRestoreWorkflow(destination.env.DB, "user-a", staged.batchId)).resolves.toMatchObject({ status: "failure_cleaning", failureCode: "attachment_original_invalid" });
      const batchSource = await destination.env.DB.prepare(`select source_object_key from v2_restore_batches where id=?`).bind(staged.batchId).first<{ source_object_key: string }>();
      const verifiedSource = await destination.env.DB.prepare(`select source_object_key from v2_restore_files where restore_batch_id=? and kind='original' and source_object_key<>? limit 1`)
        .bind(staged.batchId, batchSource!.source_object_key).first<{ source_object_key: string }>();
      expect(verifiedSource?.source_object_key).toContain(`/restore-staging/${staged.batchId}/verified/`);

      const extraKeys = Array.from({ length: 81 }, (_, index) => `users/test/restore-staging/${staged.batchId}/cleanup-extra-${index}`);
      await Promise.all(extraKeys.map((key) => destination.env.ARCHIVE_ASSETS.put(key, Uint8Array.of(1), {
        customMetadata: { userId: "user-a", restoreBatchId: staged.batchId },
      })));
      const extraFiles = extraKeys.map((key, index) => destination.env.DB.prepare(`insert into v2_restore_files
        (restore_batch_id,user_id,file_id,ordinal,kind,path,source_object_key,data_offset,byte_length,status)
        values (?,'user-a',?,?, 'original',?,?,0,1,'consumed')`)
        .bind(staged.batchId, `cleanup-extra-${index}`, 10_000 + index, `cleanup-extra-${index}`, key));
      for (let offset = 0; offset < extraFiles.length; offset += 40) await destination.env.DB.batch(extraFiles.slice(offset, offset + 40));
      const remainingTemporaryObjects = () => destination.env.DB.prepare(`select count(distinct source_object_key) as value from v2_restore_files where restore_batch_id=? and kind='original' and source_object_key<>'' and source_object_key<>?`)
        .bind(staged.batchId, batchSource!.source_object_key).first<{ value: number }>();
      await expect(remainingTemporaryObjects()).resolves.toEqual({ value: 82 });

      counted.statements = 0;
      await expect(advanceRestoreWorkflow({ db: counted, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId, now: "2026-08-28T15:05:00.000Z" }))
        .resolves.toMatchObject({ status: "failure_cleaning", failureCode: "attachment_original_invalid" });
      expect(counted.statements).toBeLessThanOrEqual(40);
      await expect(remainingTemporaryObjects()).resolves.toEqual({ value: 2 });
      await expect(destination.env.ARCHIVE_ASSETS.head(batchSource!.source_object_key)).resolves.not.toBeNull();

      counted.statements = 0;
      await expect(advanceRestoreWorkflow({ db: counted, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId, now: "2026-08-28T15:05:01.000Z" }))
        .resolves.toMatchObject({ status: "failure_cleaning" });
      expect(counted.statements).toBeLessThanOrEqual(40);
      await expect(remainingTemporaryObjects()).resolves.toEqual({ value: 0 });

      counted.statements = 0;
      await expect(advanceRestoreWorkflow({ db: counted, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId, now: "2026-08-28T15:05:02.000Z" }))
        .resolves.toMatchObject({ status: "failed", failureCode: "attachment_original_invalid" });
      expect(counted.statements).toBeLessThanOrEqual(40);
      await expect(destination.env.ARCHIVE_ASSETS.head(batchSource!.source_object_key)).resolves.toBeNull();
      await expect(destination.env.ARCHIVE_ASSETS.head(verifiedSource!.source_object_key)).resolves.toBeNull();
      expect((await Promise.all(extraKeys.map((key) => destination.env.ARCHIVE_ASSETS.head(key)))).every((value) => value === null)).toBe(true);
      await expect(destination.env.DB.prepare(`select source_object_key,finished_at from v2_restore_batches where id=?`).bind(staged.batchId).first())
        .resolves.toMatchObject({ source_object_key: null, finished_at: "2026-08-28T15:05:02.000Z" });
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_attachment_reservations where id=?`).bind(fixture.attachmentId).first()).toEqual({ value: 0 });
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_source_attachment_links where attachment_id=?`).bind(fixture.attachmentId).first()).toEqual({ value: 0 });
    } finally {
      await destination.dispose();
    }
  }, 180_000);

  test("automatically removes created attachment rows and owned R2 bytes after a post-link failure", async () => {
    const destination = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
    try {
      await apply(destination.env.DB);
      const fixture = await minimalAttachmentArchive(true);
      const staged = await stageArchiveRestore({
        db: destination.env.DB,
        bucket: destination.env.ARCHIVE_ASSETS,
        userId: "user-a",
        idempotencyKey: "resumable-attachment-auto-rollback",
        archiveSha256: sha256Hex(fixture.bytes),
        fileName: "attachment-auto-rollback.zip",
        body: fixture.bytes,
        sizeBytes: fixture.bytes.byteLength,
        now: "2026-08-28T15:10:00.000Z",
      });
      const counted = new CountingD1(destination.env.DB);
      const planned = await advanceUntil(destination.env.ARCHIVE_ASSETS, counted, staged.batchId, ["awaiting_approval", "failed"]);
      expect(planned.status).toBe("awaiting_approval");
      await approveRestoreWorkflow({
        db: destination.env.DB,
        userId: "user-a",
        batchId: staged.batchId,
        expectedDryRunHash: planned.dryRun!.dryRunHash,
        expectedRevision: planned.stateRevision,
        now: "2026-08-28T15:11:00.000Z",
      });
      let restoredObjectKey: string | null = null;
      for (let step = 0; step < 40; step += 1) {
        await advanceRestoreWorkflow({ db: counted, bucket: destination.env.ARCHIVE_ASSETS, userId: "user-a", batchId: staged.batchId, now: new Date(Date.UTC(2026, 7, 28, 15, 12, step)).toISOString() });
        const link = await destination.env.DB.prepare(`select source_item_id from v2_source_attachment_links where attachment_id=?`).bind(fixture.attachmentId).first<{ source_item_id: string }>();
        if (!link) continue;
        expect(link.source_item_id).toBe(fixture.sourceItemId);
        const attachment = await destination.env.DB.prepare(`select status,object_key from v2_attachment_reservations where id=?`).bind(fixture.attachmentId).first<{ status: string; object_key: string }>();
        expect(attachment?.status).toBe("committed");
        restoredObjectKey = attachment!.object_key;
        break;
      }
      expect(restoredObjectKey).not.toBeNull();
      const restoredOriginal = await destination.env.ARCHIVE_ASSETS.get(restoredObjectKey!);
      expect(new Uint8Array(await restoredOriginal!.arrayBuffer())).toEqual(fixture.attachmentBytes);
      expect(restoredOriginal?.customMetadata).toMatchObject({ userId: "user-a", restoreBatchId: staged.batchId, sha256: fixture.attachmentHash });
      const stagedArchive = await destination.env.DB.prepare(`select source_object_key from v2_restore_batches where id=?`).bind(staged.batchId).first<{ source_object_key: string }>();
      const stagedOriginal = await destination.env.DB.prepare(`select source_object_key from v2_restore_files where restore_batch_id=? and kind='original' and source_object_key<>? and source_object_key<>'' limit 1`)
        .bind(staged.batchId, stagedArchive!.source_object_key).first<{ source_object_key: string }>();
      expect(stagedArchive?.source_object_key).toBeTruthy();
      expect(stagedOriginal?.source_object_key).toBeTruthy();

      await expect(advanceRestoreWorkflow({
        db: new FailNextWriteD1(destination.env.DB),
        bucket: destination.env.ARCHIVE_ASSETS,
        userId: "user-a",
        batchId: staged.batchId,
        now: "2026-08-28T15:13:00.000Z",
      })).rejects.toThrow("restore_injected_failure");
      await expect(getRestoreWorkflow(destination.env.DB, "user-a", staged.batchId)).resolves.toMatchObject({ status: "rollback_requested", failureCode: "restore_injected_failure" });
      const rolledBack = await advanceUntil(destination.env.ARCHIVE_ASSETS, counted, staged.batchId, ["failed", "rollback_conflicted"]);
      expect(rolledBack.status).toBe("failed");
      expect(rolledBack.failureCode).toBe("restore_injected_failure");
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_source_attachment_links where attachment_id=?`).bind(fixture.attachmentId).first()).toEqual({ value: 0 });
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_source_items where id=?`).bind(fixture.sourceItemId).first()).toEqual({ value: 0 });
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_capture_bundles where id=?`).bind(fixture.captureId).first()).toEqual({ value: 0 });
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_attachment_reservations where id=?`).bind(fixture.attachmentId).first()).toEqual({ value: 0 });
      await expect(destination.env.ARCHIVE_ASSETS.head(restoredObjectKey!)).resolves.toBeNull();
      await expect(destination.env.ARCHIVE_ASSETS.head(stagedArchive!.source_object_key)).resolves.toBeNull();
      await expect(destination.env.ARCHIVE_ASSETS.head(stagedOriginal!.source_object_key)).resolves.toBeNull();
      await expect(destination.env.DB.prepare(`select source_object_key,rolled_back_at from v2_restore_batches where id=?`).bind(staged.batchId).first())
        .resolves.toMatchObject({ source_object_key: null, rolled_back_at: expect.any(String) });
      await expect(destination.env.DB.prepare(`select rollback_status,r2_status from v2_restore_rows where restore_batch_id=? and table_name='v2_attachment_reservations'`).bind(staged.batchId).first())
        .resolves.toMatchObject({ rollback_status: "rolled_back", r2_status: "not_applicable" });
    } finally {
      await destination.dispose();
    }
  }, 150_000);

  test("materializes a verified private backup through the same bounded workflow", async () => {
    const destination = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
    try {
      await apply(destination.env.DB);
      const existing = await source.env.DB.prepare(`select count(*) as value from v2_documents`).first<{ value: number }>();
      if (!Number(existing?.value ?? 0)) await migrationArchive();
      const snapshot = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", kind: "full", now: "2026-08-28T14:00:00.000Z" });
      const manifestObjectKey = `users/${sha256Hex("user-a").slice(0, 24)}/backups/snapshots/${snapshot.snapshotId}/manifest.json`;
      await destination.env.DB.prepare(`insert into v2_backup_snapshots
        (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,manifest_object_key,manifest_root_hash,referenced_blob_count,referenced_blob_bytes,retention_class,pinned,validator_json,created_at,verified_at)
        values (?,'user-a','full','succeeded',null,0,?,?,?,?,?,'manual',0,?,?,?)`)
        .bind(snapshot.snapshotId, snapshot.endSequence, manifestObjectKey, snapshot.rootHash, snapshot.blobs.length, snapshot.validator.blobBytes, JSON.stringify(snapshot.validator), snapshot.createdAt, snapshot.createdAt).run();
      const staged = await stageBackupRestore({
        db: destination.env.DB,
        bucket: source.env.ARCHIVE_ASSETS,
        userId: "user-a",
        idempotencyKey: "resumable-backup-one",
        snapshotId: snapshot.snapshotId,
        now: "2026-08-28T14:01:00.000Z",
      });
      const counted = new CountingD1(destination.env.DB);
      const planned = await advanceUntil(source.env.ARCHIVE_ASSETS, counted, staged.batchId, ["awaiting_approval", "failed"]);
      expect(planned.status).toBe("awaiting_approval");
      await approveRestoreWorkflow({ db: destination.env.DB, userId: "user-a", batchId: staged.batchId, expectedDryRunHash: planned.dryRun!.dryRunHash, expectedRevision: planned.stateRevision, now: "2026-08-28T14:02:00.000Z" });
      const restored = await advanceUntil(source.env.ARCHIVE_ASSETS, counted, staged.batchId, ["succeeded", "failed", "rollback_requested"]);
      expect(restored.status).toBe("succeeded");
      expect(await destination.env.DB.prepare(`select count(*) as value from v2_documents`).first()).toEqual({ value: 1 });
      const restoredAttachment = await destination.env.DB.prepare(`select status,object_key,filename,mime_type,size_bytes,sha256 from v2_attachment_reservations where id=?`)
        .bind(ATTACHMENT_ID).first<{ status: string; object_key: string; filename: string; mime_type: string; size_bytes: number; sha256: string }>();
      expect(restoredAttachment).toMatchObject({
        status: "committed",
        filename: "fixture.png",
        mime_type: "image/png",
        size_bytes: ATTACHMENT_BYTES.byteLength,
        sha256: ATTACHMENT_HASH,
      });
      const restoredOriginal = await source.env.ARCHIVE_ASSETS.get(restoredAttachment!.object_key);
      expect(new Uint8Array(await restoredOriginal!.arrayBuffer())).toEqual(ATTACHMENT_BYTES);
      expect(restoredOriginal?.customMetadata).toMatchObject({ userId: "user-a", reservationId: ATTACHMENT_ID, restoreBatchId: staged.batchId, sha256: ATTACHMENT_HASH });
      await expect(destination.env.DB.prepare(`select count(*) as value from v2_source_attachment_links where attachment_id=?`).bind(ATTACHMENT_ID).first())
        .resolves.toEqual({ value: 1 });

      const external = await prepareCaptureCommit({
        draftId: "external-reference-owner", channel: "web", title: "외부 참조", bodyMarkdown: "복원 이후 만들어진 참조",
        aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-08-28T14:03:00.000Z",
      }, "external-reference-owner", "2026-08-28T14:03:01.000Z");
      const externalReceipt = await new D1SourceFoundationRepository(destination.env.DB, "user-a").commitCapture(external);
      await destination.env.DB.batch([
        destination.env.DB.prepare(`delete from v2_source_attachment_links where attachment_id=?`).bind(ATTACHMENT_ID),
        destination.env.DB.prepare(`update v2_attachment_reservations set status='verified' where id=? and user_id='user-a' and status='committed'`).bind(ATTACHMENT_ID),
        destination.env.DB.prepare(`insert into v2_source_attachment_links (user_id,source_item_id,attachment_id,created_at) values ('user-a',?,?,?)`).bind(externalReceipt.sourceItemIds[0], ATTACHMENT_ID, "2026-08-28T14:03:02.000Z"),
        destination.env.DB.prepare(`update v2_attachment_reservations set status='committed' where id=? and user_id='user-a' and status='verified'`).bind(ATTACHMENT_ID),
      ]);
      await requestRestoreRollback({ db: destination.env.DB, userId: "user-a", batchId: staged.batchId, expectedRevision: (await getRestoreWorkflow(destination.env.DB, "user-a", staged.batchId)).stateRevision, now: "2026-08-28T14:04:00.000Z" });
      const rolledBack = await advanceUntil(source.env.ARCHIVE_ASSETS, counted, staged.batchId, ["rolled_back", "rollback_conflicted"]);
      expect(rolledBack.status).toBe("rollback_conflicted");
      await expect(destination.env.DB.prepare(`select rollback_status,r2_status from v2_restore_rows where restore_batch_id=? and table_name='v2_attachment_reservations'`).bind(staged.batchId).first())
        .resolves.toMatchObject({ rollback_status: "preserved_dependency", r2_status: "committed" });
      await expect(destination.env.DB.prepare(`select source_item_id from v2_source_attachment_links where attachment_id=?`).bind(ATTACHMENT_ID).first())
        .resolves.toEqual({ source_item_id: externalReceipt.sourceItemIds[0] });
      const preservedOriginal = await source.env.ARCHIVE_ASSETS.get(restoredAttachment!.object_key);
      expect(new Uint8Array(await preservedOriginal!.arrayBuffer())).toEqual(ATTACHMENT_BYTES);
      expect(preservedOriginal?.customMetadata?.restoreBatchId).toBe(staged.batchId);
    } finally {
      await destination.dispose();
    }
  }, 360_000);
});
