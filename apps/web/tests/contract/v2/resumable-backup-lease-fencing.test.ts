import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { runWorkflowLeaseFencedBatch } from "@/lib/v2/infrastructure/d1/workflow-lease-fence-v1";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { advanceBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";
import { advanceBackupRetentionRun } from "@/lib/v2/portability/backup-retention-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;

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
] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class DelayedBackupBucket implements R2BucketBinding {
  private pauseMetadata = false;
  private metadataStarted = deferred();
  private metadataRelease = deferred();
  private pauseMetadataStable = false;
  private metadataStableStarted = deferred();
  private metadataStableRelease = deferred();
  private pauseManifestStable = false;
  private manifestStableStarted = deferred();
  private manifestStableRelease = deferred();
  private pauseComplete = false;
  private completeStarted = deferred();
  private completeRelease = deferred();
  pausedMetadataKey: string | null = null;

  constructor(readonly inner: R2BucketBinding) {}

  pauseNextMetadataAttemptPut() {
    this.pauseMetadata = true;
    this.metadataStarted = deferred();
    this.metadataRelease = deferred();
  }

  waitForMetadataAttemptPut() { return this.metadataStarted.promise; }
  releaseMetadataAttemptPut() { this.metadataRelease.resolve(); }

  pauseNextMetadataStablePut() {
    this.pauseMetadataStable = true;
    this.metadataStableStarted = deferred();
    this.metadataStableRelease = deferred();
  }

  waitForMetadataStablePut() { return this.metadataStableStarted.promise; }
  releaseMetadataStablePut() { this.metadataStableRelease.resolve(); }

  pauseNextManifestStablePut() {
    this.pauseManifestStable = true;
    this.manifestStableStarted = deferred();
    this.manifestStableRelease = deferred();
  }

  waitForManifestStablePut() { return this.manifestStableStarted.promise; }
  releaseManifestStablePut() { this.manifestStableRelease.resolve(); }

  pauseNextMultipartComplete() {
    this.pauseComplete = true;
    this.completeStarted = deferred();
    this.completeRelease = deferred();
  }

  waitForMultipartComplete() { return this.completeStarted.promise; }
  releaseMultipartComplete() { this.completeRelease.resolve(); }

  head(key: string) { return this.inner.head(key); }
  get(key: string, options?: { range?: { offset: number; length: number } }) { return this.inner.get(key, options); }

  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: Parameters<R2BucketBinding["put"]>[2]) {
    // Hold stable writes before storage, so releasing after retention deletion
    // really recreates the key and exercises stale-publisher cleanup.
    if (this.pauseMetadataStable && key.includes("/metadata/") && !key.includes("/metadata-attempts/")) {
      this.pauseMetadataStable = false;
      this.metadataStableStarted.resolve();
      await this.metadataStableRelease.promise;
    }
    if (this.pauseManifestStable && key.endsWith("/manifest.json") && !key.includes("/manifest-attempts/")) {
      this.pauseManifestStable = false;
      this.manifestStableStarted.resolve();
      await this.manifestStableRelease.promise;
    }
    const stored = await this.inner.put(key, value, options);
    if (this.pauseMetadata && key.includes("/metadata-attempts/")) {
      this.pauseMetadata = false;
      this.pausedMetadataKey = key;
      this.metadataStarted.resolve();
      await this.metadataRelease.promise;
    }
    return stored;
  }

  delete(key: string | string[]) { return this.inner.delete(key); }

  private wrapMultipart(upload: {
    uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob): Promise<{ partNumber: number; etag: string }>;
    complete(parts: readonly { partNumber: number; etag: string }[]): Promise<Awaited<ReturnType<R2BucketBinding["put"]>>>;
    abort(): Promise<void>;
  }) {
    return {
      uploadPart: (partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob) => upload.uploadPart(partNumber, value),
      complete: async (parts: readonly { partNumber: number; etag: string }[]) => {
        const stored = await upload.complete(parts);
        if (this.pauseComplete) {
          this.pauseComplete = false;
          this.completeStarted.resolve();
          await this.completeRelease.promise;
        }
        return stored;
      },
      abort: () => upload.abort(),
    };
  }

  async createMultipartUpload(key: string, options?: Parameters<NonNullable<R2BucketBinding["createMultipartUpload"]>>[1]) {
    if (!this.inner.createMultipartUpload) throw new Error("multipart unavailable");
    const upload = await this.inner.createMultipartUpload(key, options);
    return { uploadId: upload.uploadId, ...this.wrapMultipart(upload) };
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    if (!this.inner.resumeMultipartUpload) throw new Error("multipart unavailable");
    return this.wrapMultipart(this.inner.resumeMultipartUpload(key, uploadId));
  }
}

async function apply(db: TestD1) {
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a');`);
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function insertSnapshot(db: TestD1, input: { id: string; phase: string; cursor?: Record<string, unknown>; leaseToken?: string; leaseExpiresAt?: string; revision?: number }) {
  const now = "2026-08-29T00:00:00.000Z";
  await db.prepare(`insert into v2_backup_snapshots
    (id,user_id,snapshot_kind,status,base_sequence,end_sequence,retention_class,created_at,workflow_version,idempotency_key,build_phase,cursor_json,state_revision,last_progress_at,lease_token,lease_expires_at)
    values (?,'user-a','full','building',0,0,'manual',?,2,?,?,?, ?,?,?,?)`)
    .bind(input.id, now, `idem-${input.id}`, input.phase, canonicalJson(input.cursor ?? {}), input.revision ?? 0, now, input.leaseToken ?? null, input.leaseExpiresAt ?? null).run();
}

async function insertBlobWork(db: TestD1, input: { snapshotId: string; sha256: string; sourceKey: string; objectKey: string; size: number }) {
  const now = "2026-08-29T00:00:00.000Z";
  await db.batch([
    db.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values (?,'user-a',?,?,?,'application/octet-stream',?)`)
      .bind(input.snapshotId, input.sha256, input.objectKey, input.size, now),
    db.prepare(`insert into v2_backup_blob_work_items (snapshot_id,user_id,sha256,source_object_key,object_key,size_bytes,media_type,status,created_at) values (?,'user-a',?,?,?,?,?,'pending',?)`)
      .bind(input.snapshotId, input.sha256, input.sourceKey, input.objectKey, input.size, "application/octet-stream", now),
  ]);
}

async function handOffToRetention(snapshotId: string, now: string) {
  const db = platform.env.DB;
  const runId = `retention-${snapshotId}`;
  // Seed the later completed checkpoint: this test isolates a delayed PUT
  // across retention, not the intervening full backup/retention inventory.
  await db.prepare(`update v2_backup_snapshots set status='succeeded',build_phase='complete',retention_class='daily',lease_token=null,lease_expires_at=null where id=? and user_id='user-a'`)
    .bind(snapshotId).run();
  await expect(db.prepare(`update v2_backup_snapshots set status='pruning' where id=?`).bind(snapshotId).run())
    .rejects.toThrow("backup_prune_owner_invalid");
  await db.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,started_at,last_progress_at)
    values (?,'user-a',?,'running','pruning',?,?)`).bind(runId, runId, now, now).run();
  await advanceBackupRetentionRun({ db, bucket, userId: "user-a", runId, now });
  await expect(db.prepare(`select status,prune_run_id from v2_backup_snapshots where id=?`).bind(snapshotId).first())
    .resolves.toEqual({ status: "pruning", prune_run_id: runId });
  await expect(db.prepare(`select status from v2_backup_retention_snapshot_work where run_id=? and snapshot_id=?`).bind(runId, snapshotId).first())
    .resolves.toEqual({ status: "receipting" });
}

async function finishRetention(snapshotId: string, now: string) {
  // Finish the real run so its concurrent-snapshot protection does not pin
  // the next test's newly completed backup. Never delete protection rows.
  for (let step = 0; step < 16; step++) {
    const view = await advanceBackupRetentionRun({ db: platform.env.DB, bucket, userId: "user-a", runId: `retention-${snapshotId}`, now });
    if (view?.status !== "running") {
      expect(view).toMatchObject({ status: "succeeded", failureCode: null });
      await expect(platform.env.DB.prepare(`select status,prune_run_id from v2_backup_snapshots where id=?`).bind(snapshotId).first())
        .resolves.toEqual({ status: "pruned", prune_run_id: null });
      return;
    }
  }
  throw new Error("Retention fixture did not reach its terminal checkpoint.");
}

let platform: Platform;
let bucket: DelayedBackupBucket;

beforeAll(async () => {
  platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(platform.env.DB);
  bucket = new DelayedBackupBucket(platform.env.ARCHIVE_ASSETS);
}, 60_000);

afterAll(async () => { await platform.dispose(); });

describe("resumable backup lease fencing", () => {
  test("rolls child mutations back when the parent progress CAS affects zero rows", async () => {
    await insertSnapshot(platform.env.DB, {
      id: "backup-parent-zero-cas",
      phase: "metadata",
      leaseToken: "current-owner",
      leaseExpiresAt: "2026-08-29T00:02:00.000Z",
    });
    const child = platform.env.DB.prepare(`insert into v2_backup_metadata_files
      (snapshot_id,user_id,table_name,base_path,part_number,path,object_key,metadata_mode,size_bytes,sha256,record_count,status,created_at)
      values ('backup-parent-zero-cas','user-a','v2_type_definitions','registries/types.jsonl',0,'registries/types.jsonl.parts/00000000.jsonl','attempt','full',0,?,0,'publishing','2026-08-29T00:00:00.000Z')`)
      .bind(sha256Hex(""));
    const parentProgress = platform.env.DB.prepare(`update v2_backup_snapshots set state_revision=state_revision+1,lease_token=null,lease_expires_at=null where id='backup-parent-zero-cas' and 0`);
    await expect(runWorkflowLeaseFencedBatch({
      db: platform.env.DB,
      fence: { kind: "backup", workflowId: "backup-parent-zero-cas", userId: "user-a", leaseToken: "current-owner", stateRevision: 0, expectedStatus: "building" },
      nextStatus: "building",
      statements: [child],
      parentProgress,
      now: "2026-08-29T00:00:01.000Z",
    })).rejects.toThrow("backup_workflow_lease_lost");
    await expect(platform.env.DB.prepare(`select count(*) as value from v2_backup_metadata_files where snapshot_id='backup-parent-zero-cas'`).first()).resolves.toEqual({ value: 0 });
    await expect(platform.env.DB.prepare(`select state_revision,lease_token from v2_backup_snapshots where id='backup-parent-zero-cas'`).first()).resolves.toEqual({ state_revision: 0, lease_token: "current-owner" });
  });

  test("a delayed metadata writer cannot replace the generation adopted by a new owner", async () => {
    const descriptorIndex = CANONICAL_TABLES_V1.findIndex((descriptor) => descriptor.table === "v2_type_definitions");
    expect(descriptorIndex).toBeGreaterThanOrEqual(0);
    await platform.env.DB.prepare(`insert into v2_type_definitions
      (id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
      values ('lease-type','user-a','lease_type','old label','document','active','user_created','old definition','2026-08-29T00:00:00.000Z','2026-08-29T00:00:00.000Z')`).run();
    await insertSnapshot(platform.env.DB, { id: "backup-delayed-metadata", phase: "metadata", cursor: { descriptorIndex, partNumber: 0 } });
    bucket.pauseNextMetadataAttemptPut();
    const oldOutcome = advanceBackupWorkflow({
      db: platform.env.DB,
      bucket,
      userId: "user-a",
      snapshotId: "backup-delayed-metadata",
      now: "2026-08-29T00:00:00.000Z",
    }).then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitForMetadataAttemptPut();
    const oldAttemptKey = bucket.pausedMetadataKey!;
    await platform.env.DB.batch([
      platform.env.DB.prepare(`update v2_type_definitions set label='winner label',definition='winner definition',updated_at='2026-08-29T00:00:30.000Z' where id='lease-type'`),
      platform.env.DB.prepare(`update v2_backup_snapshots set lease_expires_at='2026-08-29T00:00:30.000Z' where id='backup-delayed-metadata'`),
    ]);
    const winner = await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-delayed-metadata", now: "2026-08-29T00:01:00.000Z" });
    expect(winner.phase).toBe("metadata_publishing");
    const adopted = await platform.env.DB.prepare(`select object_key,sha256,status from v2_backup_metadata_files where snapshot_id='backup-delayed-metadata'`).first<{ object_key: string; sha256: string; status: string }>();
    expect(adopted).toMatchObject({ status: "publishing" });
    expect(adopted!.object_key).not.toBe(oldAttemptKey);
    bucket.releaseMetadataAttemptPut();
    const stale = await oldOutcome;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    await expect(bucket.head(oldAttemptKey)).resolves.toBeNull();
    const adoptedAttempt = await bucket.get(adopted!.object_key);
    expect(await new Response(adoptedAttempt!.body).text()).toContain("winner label");

    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-delayed-metadata", now: "2026-08-29T00:01:01.000Z" });
    const published = await platform.env.DB.prepare(`select object_key,status,sha256 from v2_backup_metadata_files where snapshot_id='backup-delayed-metadata'`).first<{ object_key: string; status: string; sha256: string }>();
    expect(published).toMatchObject({ status: "uploaded", sha256: adopted!.sha256 });
    expect(published!.object_key).toContain("/metadata/");
    expect(published!.object_key).not.toContain("metadata-attempts");
    const stable = await bucket.get(published!.object_key);
    expect(await new Response(stable!.body).text()).toContain("winner label");
  }, 60_000);

  test("a stale stable publisher cannot resurrect metadata after retention handoff", async () => {
    const descriptorIndex = CANONICAL_TABLES_V1.findIndex((descriptor) => descriptor.table === "v2_type_definitions");
    await insertSnapshot(platform.env.DB, { id: "backup-stale-stable-retention", phase: "metadata", cursor: { descriptorIndex, partNumber: 0 } });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-stale-stable-retention", now: "2026-08-29T00:10:00.000Z" });
    bucket.pauseNextMetadataStablePut();
    const oldOutcome = advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-stale-stable-retention", now: "2026-08-29T00:10:01.000Z" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitForMetadataStablePut();
    await platform.env.DB.prepare(`update v2_backup_snapshots set lease_expires_at='2026-08-29T00:10:30.000Z' where id='backup-stale-stable-retention'`).run();
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-stale-stable-retention", now: "2026-08-29T00:11:00.000Z" });
    const published = await platform.env.DB.prepare(`select object_key,status from v2_backup_metadata_files where snapshot_id='backup-stale-stable-retention'`).first<{ object_key: string; status: string }>();
    expect(published).toMatchObject({ status: "uploaded" });
    try {
      await handOffToRetention("backup-stale-stable-retention", "2026-08-29T00:12:00.000Z");
      await bucket.delete(published!.object_key);
      await expect(bucket.head(published!.object_key)).resolves.toBeNull();
    } finally {
      bucket.releaseMetadataStablePut();
    }
    const stale = await oldOutcome;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    await expect(bucket.head(published!.object_key)).resolves.toBeNull();
    await finishRetention("backup-stale-stable-retention", "2026-08-29T00:13:00.000Z");
  }, 60_000);

  test("a stale stable publisher does not delete the live winner copy", async () => {
    const descriptorIndex = CANONICAL_TABLES_V1.findIndex((descriptor) => descriptor.table === "v2_type_definitions");
    await insertSnapshot(platform.env.DB, { id: "backup-stale-stable-winner", phase: "metadata", cursor: { descriptorIndex, partNumber: 0 } });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-stale-stable-winner", now: "2026-08-29T00:20:00.000Z" });
    bucket.pauseNextMetadataStablePut();
    const oldOutcome = advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-stale-stable-winner", now: "2026-08-29T00:20:01.000Z" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitForMetadataStablePut();
    await platform.env.DB.prepare(`update v2_backup_snapshots set lease_expires_at='2026-08-29T00:20:30.000Z' where id='backup-stale-stable-winner'`).run();
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-stale-stable-winner", now: "2026-08-29T00:21:00.000Z" });
    const published = await platform.env.DB.prepare(`select object_key,status from v2_backup_metadata_files where snapshot_id='backup-stale-stable-winner'`).first<{ object_key: string; status: string }>();
    bucket.releaseMetadataStablePut();
    const stale = await oldOutcome;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    await expect(bucket.head(published!.object_key)).resolves.toMatchObject({ size: expect.any(Number) });
  }, 60_000);

  test("a stale manifest publisher cannot resurrect the stable key after retention handoff", async () => {
    const snapshotId = "backup-stale-manifest-retention";
    const rootHash = "b".repeat(64);
    const bytes = new TextEncoder().encode('{"manifest":"checkpoint"}\n');
    const contentSha256 = sha256Hex(bytes);
    const prefix = `users/${sha256Hex("user-a").slice(0, 24)}/backups/snapshots/${snapshotId}`;
    const stableObjectKey = `${prefix}/manifest.json`;
    const attemptObjectKey = `${prefix}/manifest-attempts/adopted/${rootHash}/manifest.json`;
    await insertSnapshot(platform.env.DB, {
      id: snapshotId,
      phase: "manifest_publishing",
      cursor: { manifestPublication: { attemptObjectKey, contentSha256 } },
    });
    await platform.env.DB.prepare(`update v2_backup_snapshots set manifest_object_key=?,manifest_root_hash=? where id=?`).bind(stableObjectKey, rootHash, snapshotId).run();
    await bucket.put(attemptObjectKey, bytes, { customMetadata: { snapshotId, rootHash, contentSha256 } });
    bucket.pauseNextManifestStablePut();
    const oldOutcome = advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: "2026-08-29T00:30:00.000Z" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitForManifestStablePut();
    await platform.env.DB.prepare(`update v2_backup_snapshots set lease_expires_at='2026-08-29T00:30:30.000Z' where id=?`).bind(snapshotId).run();
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: "2026-08-29T00:31:00.000Z" });
    try {
      await handOffToRetention(snapshotId, "2026-08-29T00:32:00.000Z");
      await bucket.delete(stableObjectKey);
      await expect(bucket.head(stableObjectKey)).resolves.toBeNull();
    } finally {
      bucket.releaseManifestStablePut();
    }
    const stale = await oldOutcome;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    await expect(bucket.head(stableObjectKey)).resolves.toBeNull();
    await finishRetention(snapshotId, "2026-08-29T00:33:00.000Z");
  }, 60_000);

  test("does not reuse a blob whose custom hash is forged over different R2 bytes", async () => {
    const bytes = new TextEncoder().encode("forged-content");
    const expectedSha256 = sha256Hex("expected-content");
    const objectKey = `users/test/backups/blobs/sha256/${expectedSha256}`;
    await bucket.put(objectKey, bytes, { customMetadata: { sha256: expectedSha256 } });
    await insertSnapshot(platform.env.DB, { id: "backup-forged-blob", phase: "blob_copying" });
    await insertBlobWork(platform.env.DB, { snapshotId: "backup-forged-blob", sha256: expectedSha256, sourceKey: "unused-source", objectKey, size: bytes.byteLength });
    const view = await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-forged-blob", now: "2026-08-29T01:00:00.000Z" });
    expect(view).toMatchObject({ phase: "failure_cleaning", failureCode: `backup_blob_collision` });
    await expect(platform.env.DB.prepare(`select status,next_offset from v2_backup_blob_work_items where snapshot_id='backup-forged-blob'`).first()).resolves.toEqual({ status: "pending", next_offset: 0 });
  });

  test("detects a same-size source mutation after scan before completing multipart", async () => {
    const scannedBytes = new Uint8Array(1024).fill(0x31);
    const mutatedBytes = new Uint8Array(1024).fill(0x32);
    const scannedSha256 = sha256Hex(scannedBytes);
    const mutatedSha256 = sha256Hex(mutatedBytes);
    const sourceKey = "users/test/originals/source-toctou";
    const sharedKey = `users/test/backups/blobs/sha256/${scannedSha256}`;
    await bucket.put(sourceKey, scannedBytes, {
      customMetadata: { sha256: scannedSha256 },
      sha256: Uint8Array.from(scannedSha256.match(/.{2}/g)!, (value) => Number.parseInt(value, 16)),
    });
    await insertSnapshot(platform.env.DB, { id: "backup-source-toctou", phase: "blob_copying" });
    await insertBlobWork(platform.env.DB, { snapshotId: "backup-source-toctou", sha256: scannedSha256, sourceKey, objectKey: sharedKey, size: scannedBytes.byteLength });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-source-toctou", now: "2026-08-29T01:30:00.000Z" });
    const generation = await platform.env.DB.prepare(`select object_key from v2_backup_blob_work_items where snapshot_id='backup-source-toctou'`).first<{ object_key: string }>();
    await bucket.put(sourceKey, mutatedBytes, {
      customMetadata: { sha256: mutatedSha256 },
      sha256: Uint8Array.from(mutatedSha256.match(/.{2}/g)!, (value) => Number.parseInt(value, 16)),
    });
    const failed = await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-source-toctou", now: "2026-08-29T01:30:01.000Z" });
    expect(failed).toMatchObject({ phase: "failure_cleaning", failureCode: "backup_source_changed_retry" });
    await expect(bucket.head(generation!.object_key)).resolves.toBeNull();
    await expect(platform.env.DB.prepare(`select status,next_offset from v2_backup_blob_work_items where snapshot_id='backup-source-toctou'`).first()).resolves.toEqual({ status: "uploading", next_offset: 0 });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-source-toctou", now: "2026-08-29T01:30:02.000Z" });
    await expect(platform.env.DB.prepare(`select status,upload_id from v2_backup_blob_work_items where snapshot_id='backup-source-toctou'`).first()).resolves.toEqual({ status: "aborted", upload_id: null });
  });

  test("persists and resumes a bounded SHA-256 state across multipart advances", async () => {
    const partBytes = 8 * 1024 * 1024;
    const bytes = new Uint8Array(partBytes + 17);
    for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = (index * 13 + 11) & 0xff;
    const sha256 = sha256Hex(bytes);
    const sourceKey = "users/test/originals/resumable-sha-state";
    const sharedKey = `users/test/backups/blobs/sha256/${sha256}`;
    await bucket.put(sourceKey, bytes, {
      customMetadata: { sha256 },
      sha256: Uint8Array.from(sha256.match(/.{2}/g)!, (value) => Number.parseInt(value, 16)),
    });
    await insertSnapshot(platform.env.DB, { id: "backup-resumable-sha-state", phase: "blob_copying" });
    await insertBlobWork(platform.env.DB, { snapshotId: "backup-resumable-sha-state", sha256, sourceKey, objectKey: sharedKey, size: bytes.byteLength });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-resumable-sha-state", now: "2026-08-29T01:40:00.000Z" });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-resumable-sha-state", now: "2026-08-29T01:40:01.000Z" });
    const checkpointed = await platform.env.DB.prepare(`select object_key,status,next_offset,parts_json from v2_backup_blob_work_items where snapshot_id='backup-resumable-sha-state'`).first<{ object_key: string; status: string; next_offset: number; parts_json: string }>();
    expect(checkpointed).toMatchObject({ status: "uploading", next_offset: partBytes });
    expect(JSON.parse(checkpointed!.parts_json)).toMatchObject({ version: 1, sha256State: { version: 1, length: partBytes } });
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-resumable-sha-state", now: "2026-08-29T01:40:02.000Z" });
    await expect(platform.env.DB.prepare(`select status,next_offset from v2_backup_blob_work_items where snapshot_id='backup-resumable-sha-state'`).first()).resolves.toEqual({ status: "verified", next_offset: bytes.byteLength });
    await expect(bucket.head(checkpointed!.object_key)).resolves.toMatchObject({ size: bytes.byteLength, customMetadata: { sha256 } });
  }, 60_000);

  test("rotates a legacy multipart receipt that has no resumable hash state", async () => {
    const sha256 = sha256Hex("legacy-multipart-source");
    const oldKey = `users/test/backups/blob-generations/backup-legacy-multipart/legacy/${sha256}`;
    const oldUpload = await bucket.createMultipartUpload!(oldKey, { customMetadata: { sha256 } });
    const oldPart = await oldUpload.uploadPart(1, new TextEncoder().encode("legacy-part"));
    await insertSnapshot(platform.env.DB, { id: "backup-legacy-multipart", phase: "blob_copying" });
    const now = "2026-08-29T01:50:00.000Z";
    await platform.env.DB.batch([
      platform.env.DB.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values ('backup-legacy-multipart','user-a',?,?,20,'application/octet-stream',?)`).bind(sha256, oldKey, now),
      platform.env.DB.prepare(`insert into v2_backup_blob_work_items (snapshot_id,user_id,sha256,source_object_key,object_key,size_bytes,media_type,status,upload_id,next_offset,next_part_number,parts_json,created_at) values ('backup-legacy-multipart','user-a',?,'legacy-source',?,20,'application/octet-stream','uploading',?,11,2,?,?)`).bind(sha256, oldKey, oldUpload.uploadId, canonicalJson([oldPart]), now),
    ]);
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-legacy-multipart", now: "2026-08-29T01:50:01.000Z" });
    const recovered = await platform.env.DB.prepare(`select object_key,upload_id,next_offset,next_part_number,parts_json,status from v2_backup_blob_work_items where snapshot_id='backup-legacy-multipart'`).first<{ object_key: string; upload_id: string; next_offset: number; next_part_number: number; parts_json: string; status: string }>();
    expect(recovered).toMatchObject({ status: "uploading", next_offset: 0, next_part_number: 1, parts_json: "[]" });
    expect(recovered!.object_key).not.toBe(oldKey);
    expect(recovered!.upload_id).not.toBe(oldUpload.uploadId);
    await expect(bucket.head(oldKey)).resolves.toBeNull();
  });

  test("rotates a lost-complete multipart generation and reclaims only the old key", async () => {
    const bytes = new Uint8Array(1024);
    for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = (index * 17 + 3) & 0xff;
    const sha256 = sha256Hex(bytes);
    const sourceKey = "users/test/originals/lost-complete";
    const sharedKey = `users/test/backups/blobs/sha256/${sha256}`;
    await bucket.put(sourceKey, bytes, { customMetadata: { sha256 }, sha256: Uint8Array.from(sha256.match(/.{2}/g)!, (value) => Number.parseInt(value, 16)) });
    await insertSnapshot(platform.env.DB, { id: "backup-lost-complete", phase: "blob_copying" });
    await insertBlobWork(platform.env.DB, { snapshotId: "backup-lost-complete", sha256, sourceKey, objectKey: sharedKey, size: bytes.byteLength });

    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-lost-complete", now: "2026-08-29T02:00:00.000Z" });
    const oldWork = await platform.env.DB.prepare(`select object_key,upload_id from v2_backup_blob_work_items where snapshot_id='backup-lost-complete'`).first<{ object_key: string; upload_id: string }>();
    expect(oldWork!.object_key).toContain("/blob-generations/backup-lost-complete/");
    bucket.pauseNextMultipartComplete();
    const oldOutcome = advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-lost-complete", now: "2026-08-29T02:00:01.000Z" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitForMultipartComplete();
    await platform.env.DB.prepare(`update v2_backup_snapshots set lease_expires_at='2026-08-29T02:00:30.000Z' where id='backup-lost-complete'`).run();
    await advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId: "backup-lost-complete", now: "2026-08-29T02:01:00.000Z" });
    const winner = await platform.env.DB.prepare(`select object_key,upload_id,status,next_offset from v2_backup_blob_work_items where snapshot_id='backup-lost-complete'`).first<{ object_key: string; upload_id: string; status: string; next_offset: number }>();
    expect(winner).toMatchObject({ status: "uploading", next_offset: 0 });
    expect(winner!.object_key).not.toBe(oldWork!.object_key);
    await expect(bucket.head(oldWork!.object_key)).resolves.toBeNull();
    bucket.releaseMultipartComplete();
    const stale = await oldOutcome;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    await expect(bucket.head(oldWork!.object_key)).resolves.toBeNull();
    await expect(bucket.head(winner!.object_key)).resolves.toBeNull();
  }, 60_000);
});
