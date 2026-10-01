import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { backupFragmentPath, backupRootHash, type BackupManifestV1 } from "@/lib/v2/portability/backup-snapshot-v1";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, LIGHTHOUSE_SCHEMA_VERSION, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { advanceBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrations = [
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

class RaceBucket implements R2BucketBinding {
  private stableManifestPause = false;
  private stableManifestStarted = deferred();
  private stableManifestRelease = deferred();
  private metadataDeletePause = false;
  private metadataDeleteStarted = deferred();
  private metadataDeleteRelease = deferred();

  constructor(readonly inner: R2BucketBinding) {}
  pauseStableManifestPut() { this.stableManifestPause = true; }
  waitStableManifestPut() { return this.stableManifestStarted.promise; }
  releaseStableManifestPut() { this.stableManifestRelease.resolve(); }
  pauseMetadataDelete() { this.metadataDeletePause = true; }
  waitMetadataDelete() { return this.metadataDeleteStarted.promise; }
  releaseMetadataDelete() { this.metadataDeleteRelease.resolve(); }
  head(key: string) { return this.inner.head(key); }
  get(key: string, options?: { range?: { offset: number; length: number } }) { return this.inner.get(key, options); }
  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: Parameters<R2BucketBinding["put"]>[2]) {
    const stored = await this.inner.put(key, value, options);
    if (this.stableManifestPause && key.endsWith("/manifest.json") && !key.includes("/manifest-attempts/")) {
      this.stableManifestPause = false;
      this.stableManifestStarted.resolve();
      await this.stableManifestRelease.promise;
    }
    return stored;
  }
  async delete(key: string | string[]) {
    await this.inner.delete(key);
    const one = Array.isArray(key) ? key[0] : key;
    if (this.metadataDeletePause && one.includes("/metadata/")) {
      this.metadataDeletePause = false;
      this.metadataDeleteStarted.resolve();
      await this.metadataDeleteRelease.promise;
    }
  }
  createMultipartUpload(key: string, options?: Parameters<NonNullable<R2BucketBinding["createMultipartUpload"]>>[1]) { return this.inner.createMultipartUpload!(key, options); }
  resumeMultipartUpload(key: string, uploadId: string) { return this.inner.resumeMultipartUpload!(key, uploadId); }
}

async function apply(db: TestD1) {
  await db.exec("create table users (id text primary key not null); insert into users (id) values ('user-a');");
  for (const name of migrations) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const sql of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
}

let platform: Platform;
let bucket: RaceBucket;
beforeAll(async () => {
  platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(platform.env.DB);
  bucket = new RaceBucket(platform.env.ARCHIVE_ASSETS);
}, 60_000);
afterAll(async () => { await platform.dispose(); });

describe("resumable backup R2 lease races", () => {
  test("a stale stable-manifest publisher cannot damage the winner after verify succeeds", async () => {
    const snapshotId = "backup-manifest-race";
    const createdAt = "2026-08-29T03:00:00.000Z";
    const emptyHash = sha256Hex("");
    const metadataFiles = CANONICAL_TABLES_V1.map((descriptor) => ({
      path: backupFragmentPath(descriptor.path, 0), bytes: 0, mediaType: "application/x-ndjson; charset=utf-8", sha256: emptyHash, records: 0,
    }));
    const metadataModes = Object.fromEntries(metadataFiles.map((file) => [file.path, "full" as const]));
    const base = {
      schemaVersion: LIGHTHOUSE_SCHEMA_VERSION,
      metadataFiles, blobs: [], baseSequence: 0, endSequence: 0, metadataModes, retentionClass: "manual" as const,
    };
    const manifest: BackupManifestV1 = {
      format: "lighthouse-backup", version: 2, snapshotId, snapshotKind: "full", createdAt, baseSnapshotId: null,
      ...base, rootHash: backupRootHash(base), validator: { valid: true, metadataFiles: metadataFiles.length, metadataRecords: 0, blobCount: 0, blobBytes: 0 },
    };
    const bytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
    const contentSha256 = sha256Hex(bytes);
    const attemptKey = `users/test/backups/snapshots/${snapshotId}/manifest-attempts/seed/${manifest.rootHash}/manifest.json`;
    const stableKey = `users/test/backups/snapshots/${snapshotId}/manifest.json`;
    await bucket.put(attemptKey, bytes, { customMetadata: { snapshotId, rootHash: manifest.rootHash, contentSha256 }, sha256: Uint8Array.from(contentSha256.match(/.{2}/g)!, (value) => Number.parseInt(value, 16)) });
    await platform.env.DB.prepare(`insert into v2_backup_snapshots
      (id,user_id,snapshot_kind,status,base_sequence,end_sequence,retention_class,created_at,workflow_version,idempotency_key,build_phase,cursor_json,state_revision,manifest_object_key,manifest_root_hash,validator_json,referenced_blob_count,referenced_blob_bytes,last_progress_at)
      values (?,'user-a','full','building',0,0,'manual',?,2,?,'manifest_publishing',?,0,?,?,?,0,0,?)`)
      .bind(snapshotId, createdAt, `idem-${snapshotId}`, canonicalJson({ manifestPublication: { attemptObjectKey: attemptKey, contentSha256 } }), stableKey, manifest.rootHash, canonicalJson(manifest.validator), createdAt).run();

    bucket.pauseStableManifestPut();
    const old = advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: createdAt })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitStableManifestPut();
    await platform.env.DB.prepare("update v2_backup_snapshots set lease_expires_at='2026-08-29T03:00:30.000Z' where id=?").bind(snapshotId).run();
    await expect(advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: "2026-08-29T03:01:00.000Z" }))
      .resolves.toMatchObject({ phase: "manifest_verifying" });
    await expect(advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: "2026-08-29T03:01:01.000Z" }))
      .resolves.toMatchObject({ status: "succeeded", phase: "complete" });
    bucket.releaseStableManifestPut();
    const stale = await old;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    const winner = await bucket.get(stableKey);
    expect(new Uint8Array(await winner!.arrayBuffer())).toEqual(bytes);
    await expect(platform.env.DB.prepare("select status,build_phase,manifest_root_hash,failure_code from v2_backup_snapshots where id=?").bind(snapshotId).first())
      .resolves.toEqual({ status: "succeeded", build_phase: "complete", manifest_root_hash: manifest.rootHash, failure_code: null });
  }, 60_000);

  test("a stale failure-cleaner cannot overwrite the cleanup adopted by a new owner", async () => {
    const snapshotId = "backup-cleanup-race";
    const now = "2026-08-29T04:00:00.000Z";
    const objectKey = `users/test/backups/snapshots/${snapshotId}/metadata/registries/types.jsonl.parts/00000000.jsonl`;
    const hash = sha256Hex("cleanup metadata");
    await bucket.put(objectKey, new TextEncoder().encode("cleanup metadata"), { customMetadata: { sha256: hash } });
    await platform.env.DB.prepare(`insert into v2_backup_snapshots
      (id,user_id,snapshot_kind,status,base_sequence,end_sequence,retention_class,created_at,workflow_version,idempotency_key,build_phase,cursor_json,state_revision,failure_code,last_progress_at)
      values (?,'user-a','full','building',0,0,'manual',?,2,?,'failure_cleaning','{}',0,'backup_source_changed_retry',?)`)
      .bind(snapshotId, now, `idem-${snapshotId}`, now).run();
    await platform.env.DB.prepare(`insert into v2_backup_metadata_files
      (snapshot_id,user_id,table_name,base_path,part_number,path,object_key,metadata_mode,size_bytes,sha256,record_count,status,created_at)
      values (?,'user-a','v2_type_definitions','registries/types.jsonl',0,'registries/types.jsonl.parts/00000000.jsonl',?,'full',16,?,0,'verified',?)`)
      .bind(snapshotId, objectKey, hash, now).run();

    bucket.pauseMetadataDelete();
    const old = advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await bucket.waitMetadataDelete();
    await platform.env.DB.prepare("update v2_backup_snapshots set lease_expires_at='2026-08-29T04:00:30.000Z' where id=?").bind(snapshotId).run();
    await expect(advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: "2026-08-29T04:01:00.000Z" }))
      .resolves.toMatchObject({ status: "building", phase: "failure_cleaning" });
    bucket.releaseMetadataDelete();
    const stale = await old;
    expect("error" in stale ? stale.error : null).toMatchObject({ message: "backup_workflow_lease_lost" });
    await expect(platform.env.DB.prepare("select count(*) as value from v2_backup_metadata_files where snapshot_id=?").bind(snapshotId).first()).resolves.toEqual({ value: 0 });
    await expect(advanceBackupWorkflow({ db: platform.env.DB, bucket, userId: "user-a", snapshotId, now: "2026-08-29T04:01:01.000Z" }))
      .resolves.toMatchObject({ status: "failed", phase: "complete", failureCode: "backup_source_changed_retry" });
    await expect(bucket.head(objectKey)).resolves.toBeNull();
  }, 60_000);
});
