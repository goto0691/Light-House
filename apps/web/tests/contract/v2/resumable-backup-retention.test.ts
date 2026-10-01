import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import {
  advanceBackupMaintenance,
  advanceBackupRetentionRun,
  stageBackupRetentionRun,
} from "@/lib/v2/portability/backup-retention-v1";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { stageBackupRestore } from "@/lib/v2/portability/resumable-restore-v2";

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

const platforms = new Set<Platform>();

async function createPlatform(users = ["user-a"]) {
  const platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await platform.env.DB.exec(`create table users (id text primary key not null);`);
  for (const user of users) await platform.env.DB.prepare(`insert into users (id) values (?)`).bind(user).run();
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await platform.env.DB.prepare(statement).run();
    }
  }
  platforms.add(platform);
  return platform;
}

afterAll(async () => {
  await Promise.all([...platforms].map((platform) => platform.dispose()));
});

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

class CountingR2 implements R2BucketBinding {
  operations = 0;
  deleteCalls = 0;
  maxDeleteKeys = 0;

  constructor(private readonly inner: R2BucketBinding) {}

  async head(key: string) { this.operations += 1; return this.inner.head(key); }
  async get(key: string, options?: { range?: { offset: number; length: number } }) { this.operations += 1; return this.inner.get(key, options); }
  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: Parameters<R2BucketBinding["put"]>[2]) {
    this.operations += 1;
    return this.inner.put(key, value, options);
  }
  async delete(key: string | string[]) {
    this.operations += 1;
    this.deleteCalls += 1;
    this.maxDeleteKeys = Math.max(this.maxDeleteKeys, Array.isArray(key) ? key.length : 1);
    return this.inner.delete(key);
  }
  createMultipartUpload(key: string, options?: Parameters<NonNullable<R2BucketBinding["createMultipartUpload"]>>[1]) {
    this.operations += 1;
    if (!this.inner.createMultipartUpload) throw new Error("multipart unavailable");
    return this.inner.createMultipartUpload(key, options);
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    this.operations += 1;
    if (!this.inner.resumeMultipartUpload) throw new Error("multipart unavailable");
    return this.inner.resumeMultipartUpload(key, uploadId);
  }
}

class StageRestoreRaceD1 implements D1DatabaseBinding {
  private fired = false;

  constructor(private readonly inner: D1DatabaseBinding, private readonly claim: () => Promise<void>) {}

  prepare(query: string): D1PreparedStatementBinding {
    let prepared = this.inner.prepare(query);
    const owner = this;
    const wrapper: D1PreparedStatementBinding = {
      bind(...values: unknown[]) { prepared = prepared.bind(...values); return wrapper; },
      async first<T>() {
        const result = await prepared.first<T>();
        if (!owner.fired && query.includes("select id from v2_backup_snapshots where id=?")) {
          owner.fired = true;
          await owner.claim();
        }
        return result;
      },
      async all<T>() { return prepared.all<T>(); },
      async run() { return prepared.run(); },
    };
    return wrapper;
  }

  async batch<T>(statements: D1PreparedStatementBinding[]) { return this.inner.batch<T>(statements); }
}

async function insertSnapshot(db: TestD1, input: { id: string; createdAt: string; baseId?: string | null; pinned?: boolean; workflowVersion?: number; manifestKey?: string | null; userId?: string }) {
  await db.prepare(`insert into v2_backup_snapshots
    (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,manifest_object_key,retention_class,pinned,created_at,workflow_version,build_phase,last_progress_at)
    values (?,?,?,'succeeded',?,0,0,?,'daily',?,?,?,'complete',?)`)
    .bind(input.id, input.userId ?? "user-a", input.baseId ? "incremental" : "full", input.baseId ?? null, input.manifestKey ?? null, input.pinned ? 1 : 0, input.createdAt, input.workflowVersion ?? 2, input.createdAt).run();
}

async function driveRetention(input: { db: CountingD1; bucket: CountingR2; userId: string; runId: string; now: string; max?: number }) {
  let view: Awaited<ReturnType<typeof advanceBackupRetentionRun>> | null = null;
  for (let step = 0; step < (input.max ?? 300); step += 1) {
    input.db.statements = 0;
    input.bucket.operations = 0;
    input.bucket.deleteCalls = 0;
    input.bucket.maxDeleteKeys = 0;
    view = await advanceBackupRetentionRun({ db: input.db, bucket: input.bucket, userId: input.userId, runId: input.runId, now: input.now });
    expect(input.db.statements).toBeLessThanOrEqual(12);
    expect(input.bucket.operations).toBeLessThanOrEqual(1);
    expect(input.bucket.deleteCalls).toBeLessThanOrEqual(1);
    expect(input.bucket.maxDeleteKeys).toBeLessThanOrEqual(20);
    if (view.status !== "running") return view;
  }
  throw new Error(`retention did not finish: ${JSON.stringify(view)}`);
}

describe("resumable backup retention and maintenance", () => {
  test("prunes beyond 30 with per-leaf ancestor closure, v1/v2 R2 receipts, restart idempotency, and seven-day blob GC", async () => {
    const platform = await createPlatform();
    const allowedPaths = await platform.env.DB.prepare(`select path from v2_backup_retention_known_metadata_paths order by path`).all<{ path: string }>();
    expect(allowedPaths.results.map((row) => row.path)).toEqual([...new Set(CANONICAL_TABLES_V1.map((descriptor) => descriptor.path))].sort());
    const db = new CountingD1(platform.env.DB);
    const bucket = new CountingR2(platform.env.ARCHIVE_ASSETS);
    const dates = Array.from({ length: 33 }, (_, index) => new Date(Date.UTC(2026, 6, 1 + index)).toISOString());
    const backupOwner = sha256Hex("user-a").slice(0, 24);
    for (let index = 0; index < 33; index += 1) {
      const id = `daily-${String(index).padStart(2, "0")}`;
      await insertSnapshot(platform.env.DB, {
        id,
        createdAt: dates[index],
        baseId: index >= 31 ? "daily-00" : null,
        workflowVersion: index === 1 ? 1 : 2,
        manifestKey: index <= 2 ? `users/${backupOwner}/backups/snapshots/${id}/manifest.json` : null,
      });
    }

    const legacyPath = CANONICAL_TABLES_V1[0].path;
    const legacyMetadataKey = `users/${backupOwner}/backups/snapshots/daily-01/metadata/${legacyPath}`;
    const legacyLinkKeys = [
      "sources/link-snapshots.jsonl",
      "sources/link-snapshot-sources.jsonl",
      "objects/link-fragments.jsonl",
      "objects/link-fragment-evidence.jsonl",
    ].map((path) => `users/${backupOwner}/backups/snapshots/daily-01/metadata/${path}`);
    const modernMetadataKey = `users/${backupOwner}/backups/snapshots/daily-02/metadata/objects/objects.jsonl.parts/00000000.jsonl`;
    await platform.env.ARCHIVE_ASSETS.put(legacyMetadataKey, "legacy");
    for (const key of legacyLinkKeys) {
      await platform.env.ARCHIVE_ASSETS.put(key, "synthetic local link metadata");
      await expect(platform.env.ARCHIVE_ASSETS.head(key)).resolves.not.toBeNull();
    }
    await platform.env.ARCHIVE_ASSETS.put(`users/${backupOwner}/backups/snapshots/daily-01/manifest.json`, "manifest");
    await platform.env.ARCHIVE_ASSETS.put(modernMetadataKey, "modern");
    await platform.env.ARCHIVE_ASSETS.put(`users/${backupOwner}/backups/snapshots/daily-02/manifest.json`, "manifest");
    await platform.env.DB.prepare(`insert into v2_backup_metadata_files
      (snapshot_id,user_id,table_name,base_path,part_number,path,object_key,metadata_mode,size_bytes,sha256,record_count,status,created_at,verified_at)
      values ('daily-02','user-a','v2_objects','objects/objects.jsonl',0,'objects/objects.jsonl.parts/00000000.jsonl',?,'full',6,?,0,'verified',?,?)`)
      .bind(modernMetadataKey, sha256Hex("modern"), dates[2], dates[2]).run();

    const blobBytes = new TextEncoder().encode("retention-grace-blob");
    const blobHash = sha256Hex(blobBytes);
    const blobKey = `retention/blobs/${blobHash}`;
    await platform.env.ARCHIVE_ASSETS.put(blobKey, blobBytes, { customMetadata: { sha256: blobHash } });
    await platform.env.DB.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values ('daily-01','user-a',?,?,?,?,?)`)
      .bind(blobHash, blobKey, blobBytes.byteLength, "application/octet-stream", dates[1]).run();

    const staged = await stageBackupRetentionRun({ db, userId: "user-a", idempotencyKey: "retention:integration:first", now: "2026-08-03T00:00:00.000Z" });
    const replay = await stageBackupRetentionRun({ db, userId: "user-a", idempotencyKey: "retention:integration:first", now: "2026-08-03T00:00:01.000Z" });
    expect(replay.runId).toBe(staged.runId);

    let observedReceiptBeforePrune = false;
    let observedPinRaceBlocked = false;
    let view = replay;
    for (let step = 0; step < 300 && view.status === "running"; step += 1) {
      db.statements = 0;
      bucket.operations = 0;
      bucket.deleteCalls = 0;
      bucket.maxDeleteKeys = 0;
      view = await advanceBackupRetentionRun({ db, bucket, userId: "user-a", runId: staged.runId, now: "2026-08-03T00:00:00.000Z" });
      expect(db.statements).toBeLessThanOrEqual(12);
      expect(bucket.operations).toBeLessThanOrEqual(1);
      expect(bucket.deleteCalls).toBeLessThanOrEqual(1);
      expect(bucket.maxDeleteKeys).toBeLessThanOrEqual(20);
      const receipt = await platform.env.DB.prepare(`select 1 as value from v2_backup_retention_object_receipts where run_id=? and status='deleted' limit 1`).bind(staged.runId).first();
      const pruned = await platform.env.DB.prepare(`select status,pinned from v2_backup_snapshots where id='daily-01'`).first<{ status: string; pinned: number }>();
      if (receipt && pruned?.status === "pruning") observedReceiptBeforePrune = true;
      if (!observedPinRaceBlocked && pruned?.status === "pruning") {
        await platform.env.DB.prepare(`update v2_backup_snapshots set pinned=1 where id='daily-01' and status='succeeded'`).run();
        await expect(platform.env.DB.prepare(`select status,pinned from v2_backup_snapshots where id='daily-01'`).first()).resolves.toEqual({ status: "pruning", pinned: 0 });
        observedPinRaceBlocked = true;
      }
    }
    expect(view.status).toBe("succeeded");
    expect(observedReceiptBeforePrune).toBe(true);
    expect(observedPinRaceBlocked).toBe(true);
    await expect(platform.env.DB.prepare(`select status from v2_backup_snapshots where id='daily-01'`).first()).resolves.toEqual({ status: "pruned" });
    await expect(platform.env.DB.prepare(`select status from v2_backup_snapshots where id='daily-02'`).first()).resolves.toEqual({ status: "pruned" });
    await expect(platform.env.DB.prepare(`select status from v2_backup_snapshots where id='daily-00'`).first()).resolves.toEqual({ status: "succeeded" });
    await expect(platform.env.DB.prepare(`select reason from v2_backup_retention_keep where run_id=? and snapshot_id='daily-00'`).bind(staged.runId).first()).resolves.toEqual({ reason: "ancestor" });
    await expect(platform.env.ARCHIVE_ASSETS.head(legacyMetadataKey)).resolves.toBeNull();
    for (const key of legacyLinkKeys) {
      await expect(platform.env.ARCHIVE_ASSETS.head(key)).resolves.toBeNull();
      await expect(platform.env.DB.prepare(`select snapshot_id,object_kind,status,deleted_at from v2_backup_retention_object_receipts where run_id=? and user_id='user-a' and object_key=?`)
        .bind(staged.runId, key).first()).resolves.toEqual({ snapshot_id: "daily-01", object_kind: "metadata", status: "deleted", deleted_at: "2026-08-03T00:00:00.000Z" });
    }
    await expect(platform.env.ARCHIVE_ASSETS.head(modernMetadataKey)).resolves.toBeNull();
    await expect(platform.env.ARCHIVE_ASSETS.head(blobKey)).resolves.not.toBeNull();
    await expect(platform.env.DB.prepare(`select deleted_at from v2_backup_blob_gc_marks where user_id='user-a' and sha256=?`).bind(blobHash).first()).resolves.toEqual({ deleted_at: null });

    const gcRun = await stageBackupRetentionRun({ db, userId: "user-a", idempotencyKey: "retention:integration:gc", now: "2026-08-10T00:00:01.000Z" });
    const gcView = await driveRetention({ db, bucket, userId: "user-a", runId: gcRun.runId, now: "2026-08-10T00:00:01.000Z" });
    expect(gcView.status).toBe("succeeded");
    await expect(platform.env.ARCHIVE_ASSETS.head(blobKey)).resolves.toBeNull();

    const protectedHash = "a".repeat(64);
    const protectedKey = `retention/blobs/${protectedHash}`;
    await platform.env.ARCHIVE_ASSETS.put(protectedKey, "protected");
    await platform.env.DB.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values ('daily-32','user-a',?,?,9,'text/plain',?)`)
      .bind(protectedHash, protectedKey, dates[32]).run();
    await platform.env.DB.prepare(`insert into v2_backup_blob_gc_marks (user_id,sha256,object_key,unreferenced_since,last_checked_at,deleted_at,delete_token,delete_claimed_at) values ('user-a',?,?,?, ?,null,null,null)`)
      .bind(protectedHash, protectedKey, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z").run();
    const reconcileRun = await stageBackupRetentionRun({ db, userId: "user-a", idempotencyKey: "retention:integration:refs", now: "2026-08-11T00:00:00.000Z" });
    await driveRetention({ db, bucket, userId: "user-a", runId: reconcileRun.runId, now: "2026-08-11T00:00:00.000Z" });
    await expect(platform.env.DB.prepare(`select 1 as value from v2_backup_blob_gc_marks where user_id='user-a' and sha256=?`).bind(protectedHash).first()).resolves.toBeNull();
    await expect(platform.env.ARCHIVE_ASSETS.head(protectedKey)).resolves.not.toBeNull();

    const pinRoute = await readFile(fileURLToPath(new URL("../../../src/app/api/v2/backups/[snapshotId]/route.ts", import.meta.url)), "utf8");
    expect(pinRoute).toContain(`V2HttpError(409, "backup_retention_busy"`);
  }, 180_000);

  test("fails closed on a retained cycle without pruning either member", async () => {
    const platform = await createPlatform();
    await insertSnapshot(platform.env.DB, { id: "cycle-a", createdAt: "2026-08-01T00:00:00.000Z", pinned: true });
    await insertSnapshot(platform.env.DB, { id: "cycle-b", createdAt: "2026-07-01T00:00:00.000Z" });
    await platform.env.DB.prepare(`update v2_backup_snapshots set snapshot_kind='incremental',base_snapshot_id='cycle-b' where id='cycle-a'`).run();
    await platform.env.DB.prepare(`update v2_backup_snapshots set snapshot_kind='incremental',base_snapshot_id='cycle-a' where id='cycle-b'`).run();
    const db = new CountingD1(platform.env.DB);
    const bucket = new CountingR2(platform.env.ARCHIVE_ASSETS);
    const run = await stageBackupRetentionRun({ db, userId: "user-a", idempotencyKey: "retention:cycle:test", now: "2026-08-03T00:00:00.000Z" });
    const result = await driveRetention({ db, bucket, userId: "user-a", runId: run.runId, now: "2026-08-03T00:00:00.000Z", max: 20 });
    expect(result).toMatchObject({ status: "failed", failureCode: "backup_retention_chain_cycle" });
    await expect(platform.env.DB.prepare(`select id,status from v2_backup_snapshots order by id`).all()).resolves.toMatchObject({ results: [{ id: "cycle-a", status: "succeeded" }, { id: "cycle-b", status: "succeeded" }] });

    await insertSnapshot(platform.env.DB, { id: "late-ancestor", createdAt: "2026-06-01T00:00:00.000Z" });
    await insertSnapshot(platform.env.DB, { id: "late-leaf", createdAt: "2026-06-02T00:00:00.000Z", baseId: "late-ancestor" });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('late-pin-run','user-a','retention:late-pin','running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`).run();
    await platform.env.DB.prepare(`update v2_backup_snapshots set pinned=1 where id='late-leaf'`).run();
    await advanceBackupRetentionRun({ db, bucket, userId: "user-a", runId: "late-pin-run", now: "2026-08-03T00:00:01.000Z" });
    await expect(platform.env.DB.prepare(`select phase from v2_backup_retention_runs where id='late-pin-run'`).first()).resolves.toEqual({ phase: "ancestor_closure" });
    await advanceBackupRetentionRun({ db, bucket, userId: "user-a", runId: "late-pin-run", now: "2026-08-03T00:00:02.000Z" });
    await expect(platform.env.DB.prepare(`select snapshot_id,chain_checked from v2_backup_retention_keep where run_id='late-pin-run' order by snapshot_id`).all()).resolves.toMatchObject({
      results: [{ snapshot_id: "late-ancestor", chain_checked: 1 }, { snapshot_id: "late-leaf", chain_checked: 1 }],
    });
  }, 60_000);

  test("allows only one retention run to own a pruning snapshot and advances both run revisions once", async () => {
    const platform = await createPlatform();
    await insertSnapshot(platform.env.DB, { id: "race-prune", createdAt: "2026-07-01T00:00:00.000Z" });
    await insertSnapshot(platform.env.DB, { id: "guard-prune", createdAt: "2026-07-02T00:00:00.000Z" });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('guard-run','user-a','retention:guard-run','running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`).run();
    await expect(
      platform.env.DB.prepare(`update v2_backup_snapshots set status='pruning' where id='guard-prune'`).run(),
    ).rejects.toThrow(/backup_prune_owner_invalid/);
    await expect(
      platform.env.DB.prepare(`insert into v2_backup_retention_snapshot_work
        (run_id,user_id,snapshot_id,status,cursor_json,created_at)
        values ('guard-run','user-a','guard-prune','receipting','{}','2026-08-03T00:00:00.000Z')`).run(),
    ).rejects.toThrow(/backup_retention_work_snapshot_mismatch/);
    await platform.env.DB.prepare(`update v2_backup_snapshots set status='pruning',prune_run_id='guard-run' where id='guard-prune'`).run();
    await platform.env.DB.prepare(`insert into v2_backup_retention_snapshot_work
      (run_id,user_id,snapshot_id,status,cursor_json,created_at)
      values ('guard-run','user-a','guard-prune','receipting','{}','2026-08-03T00:00:00.000Z')`).run();
    await expect(
      platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed' where id='guard-run'`).run(),
    ).rejects.toThrow(/backup_retention_terminal_orphan/);
    await platform.env.DB.batch([
      platform.env.DB.prepare(`update v2_backup_retention_snapshot_work set status='cancelled' where run_id='guard-run' and snapshot_id='guard-prune'`),
      platform.env.DB.prepare(`update v2_backup_snapshots set status='succeeded',prune_run_id=null where id='guard-prune' and prune_run_id='guard-run'`),
      platform.env.DB.prepare(`delete from v2_backup_retention_snapshot_work where run_id='guard-run' and snapshot_id='guard-prune'`),
      platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed',failure_code='guard_complete' where id='guard-run'`),
    ]);
    for (const id of ["race-run-a", "race-run-b"]) {
      await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
        values (?,'user-a',?,'running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`)
        .bind(id, `retention:${id}`).run();
    }
    await Promise.all([
      advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "race-run-a", now: "2026-08-03T00:00:01.000Z" }),
      advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "race-run-b", now: "2026-08-03T00:00:01.000Z" }),
    ]);
    const snapshot = await platform.env.DB.prepare(`select status,prune_run_id from v2_backup_snapshots where id='race-prune'`).first<{ status: string; prune_run_id: string }>();
    expect(snapshot?.status).toBe("pruning");
    expect(["race-run-a", "race-run-b"]).toContain(snapshot?.prune_run_id);
    await expect(platform.env.DB.prepare(`select run_id,snapshot_id from v2_backup_retention_snapshot_work where snapshot_id='race-prune'`).all()).resolves.toMatchObject({
      results: [{ run_id: snapshot?.prune_run_id, snapshot_id: "race-prune" }],
    });
    await expect(platform.env.DB.prepare(`select id,state_revision from v2_backup_retention_runs where id like 'race-run-%' order by id`).all()).resolves.toMatchObject({
      results: [{ id: "race-run-a", state_revision: 1 }, { id: "race-run-b", state_revision: 1 }],
    });

    await platform.env.DB.prepare(`update v2_backup_snapshots set pruned_at='2026-08-03T00:00:02.000Z' where id='race-prune'`).run();
    await advanceBackupRetentionRun({
      db: platform.env.DB,
      bucket: platform.env.ARCHIVE_ASSETS,
      userId: "user-a",
      runId: snapshot!.prune_run_id,
      now: "2026-08-03T00:00:03.000Z",
    });
    await expect(platform.env.DB.prepare(`select status,failure_code from v2_backup_retention_runs where id=?`).bind(snapshot!.prune_run_id).first()).resolves.toEqual({
      status: "failed",
      failure_code: "backup_retention_snapshot_changed",
    });
    await expect(platform.env.DB.prepare(`select status,prune_run_id,pruned_at from v2_backup_snapshots where id='race-prune'`).first()).resolves.toEqual({
      status: "succeeded",
      prune_run_id: null,
      pruned_at: null,
    });
    await expect(platform.env.DB.prepare(`select 1 as value from v2_backup_retention_snapshot_work where run_id=? and status not in ('complete','cancelled')`).bind(snapshot!.prune_run_id).first()).resolves.toBeNull();
    await platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed',failure_code='race_complete' where id in ('race-run-a','race-run-b') and status='running'`).run();

    const repairManifestKey = `users/${sha256Hex("user-a").slice(0, 24)}/backups/snapshots/repair-prune/manifest.json`;
    await insertSnapshot(platform.env.DB, { id: "repair-prune", createdAt: "2026-07-02T00:00:00.000Z", manifestKey: repairManifestKey });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('repair-run','user-a','retention:repair','running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`).run();
    await platform.env.DB.prepare(`update v2_backup_snapshots set status='pruning',prune_run_id='repair-run' where id='repair-prune'`).run();
    await platform.env.DB.prepare(`insert into v2_backup_retention_snapshot_work
      (run_id,user_id,snapshot_id,status,cursor_json,created_at)
      values ('repair-run','user-a','repair-prune','finalizing','{}','2026-08-03T00:00:00.000Z')`).run();
    await platform.env.DB.prepare(`insert into v2_backup_retention_object_receipts
      (run_id,user_id,snapshot_id,object_key,object_kind,status,created_at)
      values ('repair-run','user-a','repair-prune',?,'manifest','pending','2026-08-03T00:00:00.000Z')`).bind(repairManifestKey).run();
    await advanceBackupRetentionRun({
      db: platform.env.DB,
      bucket: platform.env.ARCHIVE_ASSETS,
      userId: "user-a",
      runId: "repair-run",
      now: "2026-08-03T00:00:04.000Z",
    });
    await expect(platform.env.DB.prepare(`select status,state_revision from v2_backup_retention_runs where id='repair-run'`).first()).resolves.toEqual({
      status: "running",
      state_revision: 1,
    });
    await expect(platform.env.DB.prepare(`select status from v2_backup_retention_snapshot_work where run_id='repair-run' and snapshot_id='repair-prune'`).first()).resolves.toEqual({ status: "deleting_objects" });
  }, 60_000);

  test("seeds pre-existing backup and restore dependencies and rechecks late transitive children before deletion", async () => {
    const platform = await createPlatform();
    for (const snapshot of [
      { id: "build-root", createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "build-base", createdAt: "2026-08-02T00:00:00.000Z", baseId: "build-root" },
      { id: "restore-root", createdAt: "2026-08-03T00:00:00.000Z" },
      { id: "restore-source", createdAt: "2026-08-04T00:00:00.000Z", baseId: "restore-root" },
      { id: "terminal-succeeded", createdAt: "2026-08-04T01:00:00.000Z" },
      { id: "terminal-failed", createdAt: "2026-08-04T02:00:00.000Z" },
      { id: "terminal-rolled-back", createdAt: "2026-08-04T03:00:00.000Z" },
      { id: "terminal-conflicted", createdAt: "2026-08-04T04:00:00.000Z" },
    ]) await insertSnapshot(platform.env.DB, snapshot);
    await platform.env.DB.prepare(`update v2_backup_snapshots set retention_class='manual' where id in ('build-root','build-base','restore-root','restore-source')`).run();
    await platform.env.DB.prepare(`insert into v2_backup_snapshots
      (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,created_at,workflow_version,build_phase,cursor_json,state_revision,last_progress_at)
      values ('preexisting-building','user-a','incremental','building','build-base',0,0,'daily','2026-08-05T00:00:00.000Z',2,'metadata','{}',0,'2026-08-05T00:00:00.000Z')`).run();
    await stageBackupRestore({
      db: platform.env.DB,
      bucket: platform.env.ARCHIVE_ASSETS,
      userId: "user-a",
      idempotencyKey: "restore:active-source",
      snapshotId: "restore-source",
      now: "2026-08-05T00:00:00.000Z",
    });
    for (const [status, snapshotId] of [
      ["succeeded", "terminal-succeeded"],
      ["failed", "terminal-failed"],
      ["rolled_back", "terminal-rolled-back"],
      ["rollback_conflicted", "terminal-conflicted"],
    ] as const) {
      await platform.env.DB.prepare(`insert into v2_restore_batches
        (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_ref,cursor_json,state_revision,last_progress_at)
        values (?,'user-a',?,'pending','pending','pending',?,'{}','{}','2026-08-05T00:00:00.000Z',1,'backup',?,'{}',0,'2026-08-05T00:00:00.000Z')`)
        .bind(`terminal-${status}`, `restore:terminal:${status}`, status, snapshotId).run();
    }
    const seeded = await stageBackupRetentionRun({
      db: platform.env.DB,
      userId: "user-a",
      idempotencyKey: "retention:dependency-seed",
      now: "2026-08-06T00:00:00.000Z",
    });
    await expect(platform.env.DB.prepare(`select snapshot_id,reason,chain_checked from v2_backup_retention_keep where run_id=? and snapshot_id in ('build-base','restore-source') order by snapshot_id`).bind(seeded.runId).all()).resolves.toMatchObject({
      results: [
        { snapshot_id: "build-base", reason: "active_backup_base", chain_checked: 0 },
        { snapshot_id: "restore-source", reason: "active_restore_source", chain_checked: 0 },
      ],
    });
    await expect(platform.env.DB.prepare(`select snapshot_id from v2_backup_retention_keep where run_id=? and substr(snapshot_id,1,9)='terminal-'`).bind(seeded.runId).all()).resolves.toMatchObject({ results: [] });
    for (let step = 0; step < 20; step += 1) {
      const view = await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: seeded.runId, now: "2026-08-06T00:00:01.000Z" });
      const unchecked = await platform.env.DB.prepare(`select count(*) as value from v2_backup_retention_keep where run_id=? and chain_checked=0`).bind(seeded.runId).first<{ value: number }>();
      if (view.phase === "pruning" && unchecked?.value === 0) break;
    }
    await expect(platform.env.DB.prepare(`select snapshot_id,chain_checked from v2_backup_retention_keep where run_id=? and snapshot_id in ('build-root','build-base','restore-root','restore-source') order by snapshot_id`).bind(seeded.runId).all()).resolves.toMatchObject({
      results: [
        { snapshot_id: "build-base", chain_checked: 1 },
        { snapshot_id: "build-root", chain_checked: 1 },
        { snapshot_id: "restore-root", chain_checked: 1 },
        { snapshot_id: "restore-source", chain_checked: 1 },
      ],
    });
    await platform.env.DB.prepare(`update v2_backup_snapshots set status='failed' where id='preexisting-building'`).run();
    await platform.env.DB.prepare(`update v2_restore_batches set status='failed' where id=?`).bind((await platform.env.DB.prepare(`select id from v2_restore_batches where source_ref='restore-source'`).first<{ id: string }>())!.id).run();
    await platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed',failure_code='seed_verified' where id=?`).bind(seeded.runId).run();

    await insertSnapshot(platform.env.DB, { id: "late-building-target", createdAt: "2026-01-01T00:00:00.000Z" });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('late-building-run','user-a','retention:late-building','running','pruning','{}',0,'2026-08-06T00:00:00.000Z','2026-08-06T00:00:00.000Z')`).run();
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "late-building-run", now: "2026-08-06T00:00:01.000Z" });
    await platform.env.DB.prepare(`insert into v2_backup_snapshots
      (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,created_at,workflow_version,build_phase,cursor_json,state_revision,last_progress_at)
      values ('late-building-child','user-a','full','building',null,0,0,'daily','2026-08-06T00:00:02.000Z',2,'metadata','{}',0,'2026-08-06T00:00:02.000Z')`).run();
    await platform.env.DB.prepare(`update v2_backup_snapshots set snapshot_kind='incremental',base_snapshot_id='late-building-target' where id='late-building-child'`).run();
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "late-building-run", now: "2026-08-06T00:00:03.000Z" });
    await expect(platform.env.DB.prepare(`select status,prune_run_id from v2_backup_snapshots where id='late-building-target'`).first()).resolves.toEqual({ status: "succeeded", prune_run_id: null });
    await expect(platform.env.DB.prepare(`select phase from v2_backup_retention_runs where id='late-building-run'`).first()).resolves.toEqual({ phase: "ancestor_closure" });
    await platform.env.DB.prepare(`update v2_backup_snapshots set status='failed' where id='late-building-child'`).run();
    await platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed',failure_code='late_building_verified' where id='late-building-run'`).run();

    await insertSnapshot(platform.env.DB, { id: "late-success-target", createdAt: "2025-01-01T00:00:00.000Z" });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('late-success-run','user-a','retention:late-success','running','pruning','{}',0,'2026-08-06T00:00:00.000Z','2026-08-06T00:00:00.000Z')`).run();
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "late-success-run", now: "2026-08-06T00:00:01.000Z" });
    await insertSnapshot(platform.env.DB, { id: "late-success-child", createdAt: "2026-08-06T00:00:02.000Z", baseId: "late-success-target" });
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "late-success-run", now: "2026-08-06T00:00:03.000Z" });
    await expect(platform.env.DB.prepare(`select status,prune_run_id from v2_backup_snapshots where id='late-success-target'`).first()).resolves.toEqual({ status: "succeeded", prune_run_id: null });
    await platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed',failure_code='late_success_verified' where id='late-success-run'`).run();

    await insertSnapshot(platform.env.DB, { id: "destructive-target", createdAt: "2024-01-01T00:00:00.000Z" });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('destructive-run','user-a','retention:destructive','running','pruning','{}',0,'2026-08-06T00:00:00.000Z','2026-08-06T00:00:00.000Z')`).run();
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "destructive-run", now: "2026-08-06T00:00:01.000Z" });
    await platform.env.DB.prepare(`update v2_backup_retention_snapshot_work set status='deleting_objects' where run_id='destructive-run' and snapshot_id='destructive-target'`).run();
    await expect(platform.env.DB.prepare(`insert into v2_backup_snapshots
      (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,created_at,workflow_version,build_phase,cursor_json,state_revision,last_progress_at)
      values ('rejected-child','user-a','incremental','building','destructive-target',0,0,'daily','2026-08-06T00:00:04.000Z',2,'metadata','{}',0,'2026-08-06T00:00:04.000Z')`).run()).rejects.toThrow(/backup_dependency_retention_in_progress/);
  }, 120_000);

  test("blocks backup-restore staging races and rejects cross-owner destructive receipts and blob refs", async () => {
    const platform = await createPlatform(["user-a", "user-b"]);
    const ownerA = sha256Hex("user-a").slice(0, 24);
    const ownerB = sha256Hex("user-b").slice(0, 24);
    await insertSnapshot(platform.env.DB, { id: "restore-race-source", createdAt: "2026-08-01T00:00:00.000Z", manifestKey: `users/${ownerA}/backups/snapshots/restore-race-source/manifest.json` });
    await insertSnapshot(platform.env.DB, { id: "restore-first-root", createdAt: "2026-08-01T01:00:00.000Z" });
    await insertSnapshot(platform.env.DB, { id: "restore-first-source", createdAt: "2026-08-01T02:00:00.000Z", baseId: "restore-first-root" });
    await insertSnapshot(platform.env.DB, { id: "receipt-a", createdAt: "2026-08-02T00:00:00.000Z", manifestKey: `users/${ownerA}/backups/snapshots/receipt-a/manifest.json` });
    await insertSnapshot(platform.env.DB, { id: "receipt-b", userId: "user-b", createdAt: "2026-08-02T00:00:00.000Z", manifestKey: `users/${ownerB}/backups/snapshots/receipt-b/manifest.json` });
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('restore-first-run','user-a','retention:restore-first','running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`).run();
    const restoreFirst = await stageBackupRestore({
      db: platform.env.DB,
      bucket: platform.env.ARCHIVE_ASSETS,
      userId: "user-a",
      idempotencyKey: "restore:first-linearization",
      snapshotId: "restore-first-source",
      now: "2026-08-03T00:00:00.500Z",
    });
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "restore-first-run", now: "2026-08-03T00:00:01.000Z" });
    await advanceBackupRetentionRun({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", runId: "restore-first-run", now: "2026-08-03T00:00:02.000Z" });
    await expect(platform.env.DB.prepare(`select snapshot_id,chain_checked from v2_backup_retention_keep where run_id='restore-first-run' and snapshot_id in ('restore-first-root','restore-first-source') order by snapshot_id`).all()).resolves.toMatchObject({
      results: [{ snapshot_id: "restore-first-root", chain_checked: 1 }, { snapshot_id: "restore-first-source", chain_checked: 1 }],
    });
    await platform.env.DB.prepare(`update v2_restore_batches set status='failed' where id=?`).bind(restoreFirst.batchId).run();
    await platform.env.DB.prepare(`update v2_backup_retention_runs set status='failed',failure_code='restore_first_verified' where id='restore-first-run'`).run();
    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('restore-race-run','user-a','retention:restore-race','running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`).run();
    const raceDb = new StageRestoreRaceD1(platform.env.DB, async () => {
      await platform.env.DB.batch([
        platform.env.DB.prepare(`update v2_backup_snapshots set status='pruning',prune_run_id='restore-race-run' where id='restore-race-source' and status='succeeded'`),
        platform.env.DB.prepare(`insert into v2_backup_retention_snapshot_work (run_id,user_id,snapshot_id,status,cursor_json,created_at)
          select 'restore-race-run','user-a',id,'receipting','{}','2026-08-03T00:00:01.000Z' from v2_backup_snapshots where id='restore-race-source' and status='pruning' and prune_run_id='restore-race-run'`),
      ]);
    });
    await expect(stageBackupRestore({
      db: raceDb,
      bucket: platform.env.ARCHIVE_ASSETS,
      userId: "user-a",
      idempotencyKey: "restore:select-insert-race",
      snapshotId: "restore-race-source",
      now: "2026-08-03T00:00:02.000Z",
    })).rejects.toThrow(/backup_restore_source_unavailable/);
    await expect(platform.env.DB.prepare(`select 1 as value from v2_restore_batches where idempotency_key='restore:select-insert-race'`).first()).resolves.toBeNull();
    await platform.env.DB.prepare(`update v2_backup_retention_snapshot_work set status='deleting_objects' where run_id='restore-race-run' and snapshot_id='restore-race-source'`).run();
    await expect(platform.env.DB.prepare(`insert into v2_restore_batches
      (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_ref,cursor_json,state_revision,last_progress_at)
      values ('restore-after-delete','user-a','restore:after-delete','pending','pending','pending','backup_indexing','{}','{}','2026-08-03T00:00:03.000Z',1,'backup','restore-race-source','{}',0,'2026-08-03T00:00:03.000Z')`).run()).rejects.toThrow(/backup_restore_source_retention_in_progress/);

    await platform.env.DB.prepare(`insert into v2_backup_retention_runs (id,user_id,idempotency_key,status,phase,cursor_json,state_revision,started_at,last_progress_at)
      values ('receipt-run','user-a','retention:receipt-owner','running','pruning','{}',0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z')`).run();
    await platform.env.DB.prepare(`update v2_backup_snapshots set status='pruning',prune_run_id='receipt-run' where id='receipt-a'`).run();
    await platform.env.DB.prepare(`insert into v2_backup_retention_snapshot_work (run_id,user_id,snapshot_id,status,cursor_json,created_at)
      values ('receipt-run','user-a','receipt-a','receipting','{}','2026-08-03T00:00:00.000Z')`).run();
    const manifestA = `users/${ownerA}/backups/snapshots/receipt-a/manifest.json`;
    const manifestB = `users/${ownerB}/backups/snapshots/receipt-b/manifest.json`;
    await expect(platform.env.DB.prepare(`insert into v2_backup_retention_object_receipts
      (run_id,user_id,snapshot_id,object_key,object_kind,status,created_at) values ('receipt-run','user-a','receipt-a',?,'manifest','pending','2026-08-03T00:00:00.000Z')`).bind(manifestB).run()).rejects.toThrow(/backup_retention_object_key_invalid/);
    await platform.env.DB.prepare(`insert into v2_backup_retention_object_receipts
      (run_id,user_id,snapshot_id,object_key,object_kind,status,created_at) values ('receipt-run','user-a','receipt-a',?,'manifest','pending','2026-08-03T00:00:00.000Z')`).bind(manifestA).run();
    await expect(platform.env.DB.prepare(`update v2_backup_retention_object_receipts set object_key=? where run_id='receipt-run' and object_key=?`).bind(manifestB, manifestA).run()).rejects.toThrow(/backup_retention_object_identity_immutable/);
    await expect(platform.env.DB.prepare(`insert into v2_backup_blob_refs
      (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values ('receipt-a','user-b',?,'blobs/cross-owner',1,'text/plain','2026-08-03T00:00:00.000Z')`).bind("b".repeat(64)).run()).rejects.toThrow(/backup_blob_ref_owner_mismatch/);
    await platform.env.DB.prepare(`insert into v2_backup_blob_refs
      (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values ('receipt-a','user-a',?,'blobs/owned',1,'text/plain','2026-08-03T00:00:00.000Z')`).bind("c".repeat(64)).run();
    await expect(platform.env.DB.prepare(`update v2_backup_blob_refs set user_id='user-b' where snapshot_id='receipt-a' and sha256=?`).bind("c".repeat(64)).run()).rejects.toThrow(/backup_blob_ref_owner_mismatch/);
  }, 90_000);

  test("round-robins users and advances an active backup without exceeding one bounded maintenance slice", async () => {
    const platform = await createPlatform(["user-a", "user-b", "user-c"]);
    const db = new CountingD1(platform.env.DB);
    const bucket = new CountingR2(platform.env.ARCHIVE_ASSETS);
    const seen: (string | null)[] = [];
    const actions: unknown[] = [];
    for (let step = 0; step < 4; step += 1) {
      db.statements = 0;
      bucket.operations = 0;
      const result = await advanceBackupMaintenance({ db, bucket, now: `2026-08-28T00:0${step}:00.000Z` });
      seen.push(result.userId);
      actions.push(result.backup.action);
      // Backup lease fencing contributes two assertion statements to the
      // maintenance slice while keeping the same bounded unit of work.
      expect(db.statements).toBeLessThanOrEqual(22);
      expect(bucket.operations).toBeLessThanOrEqual(1);
    }
    expect(seen).toEqual(["user-a", "user-b", "user-c", "user-a"]);
    expect(actions).toEqual(["staged", "staged", "staged", "advanced"]);
    await expect(platform.env.DB.prepare(`select last_user_id,state_revision from v2_backup_maintenance_state where id=1`).first()).resolves.toEqual({ last_user_id: "user-a", state_revision: 4 });
  }, 120_000);
});
