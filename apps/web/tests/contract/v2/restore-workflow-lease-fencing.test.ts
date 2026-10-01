import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { runWorkflowLeaseFencedBatch, WorkflowLeaseLostError } from "@/lib/v2/infrastructure/d1/workflow-lease-fence-v1";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { advanceRestoreWorkflow, approveRestoreWorkflow, cleanupNextRestoreGeneration, getRestoreWorkflow, requestRestoreRollback } from "@/lib/v2/portability/resumable-restore-v2";
import { canonicalJson, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";

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
];

async function apply(db: TestD1) {
  await db.exec("create table users (id text primary key not null); insert into users (id) values ('user-a');");
  for (const name of migrations) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const sql of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
}

async function seedBatch(db: TestD1, id: string, status: string, revision: number, leaseToken: string, leaseExpiresAt: string) {
  await db.prepare(`insert into v2_restore_batches
    (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_size_bytes,cursor_json,state_revision,lease_token,lease_expires_at,last_progress_at)
    values (?,'user-a',?,'pending','pending','pending',?,'{}','{}','2026-08-29T00:00:00.000Z',2,'archive',0,'{}',?,?,?,'2026-08-29T00:00:00.000Z')`)
    .bind(id, id, status, revision, leaseToken, leaseExpiresAt).run();
  await db.prepare(`insert into v2_restore_files (restore_batch_id,user_id,file_id,ordinal,kind,path,source_object_key,byte_length,status)
    values (?,'user-a','probe',0,'metadata','probe','probe',1,'indexed')`).bind(id).run();
}

let platform: Platform;
beforeAll(async () => {
  platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(platform.env.DB);
}, 60_000);
afterAll(async () => { await platform.dispose(); });

describe("restore workflow lease fencing", () => {
  test("persists a tombstone and reclaims every late generation PUT", async () => {
    const db = platform.env.DB;
    const id = "restore-late-generation";
    const key = `users/test/restored-originals/reservation/restore-generations/${id}/${"a".repeat(64)}/attempts/attempt-a`;
    await seedBatch(db, id, "rolling_back", 0, "attempt-a", "2026-08-29T00:10:00.000Z");
    await db.batch([
      db.prepare(`insert into v2_restore_rows (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,candidate_row_json,restored_row_hash,plan_position,apply_status,rollback_status,r2_object_key,r2_sha256,r2_size_bytes,r2_status,updated_at)
        values (?,'v2_attachment_reservations','row','hash','created','row','2026-08-29T00:00:00.000Z','{}','hash',1,'applied','rolled_back',?,?,1,'delete_pending','2026-08-29T00:00:00.000Z')`).bind(id, key, "a".repeat(64)),
      db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(id, key),
    ]);
    await db.prepare("update v2_restore_batches set lease_token=null,lease_expires_at=null where id=?").bind(id).run();
    await advanceRestoreWorkflow({ db, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", batchId: id, now: "2026-08-29T00:01:00.000Z" });
    await expect(db.prepare("select armed_at,not_before from v2_restore_generation_cleanup_receipts where restore_id=?").bind(id).first()).resolves.toMatchObject({ armed_at: "2026-08-29T00:01:00.000Z" });
    await platform.env.ARCHIVE_ASSETS.put(key, new Uint8Array([7]), { customMetadata: { restoreBatchId: id, userId: "user-a" } });
    await expect(cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-08-30T00:12:00.000Z" })).resolves.toMatchObject({ cleaned: 1, restoreId: id });
    await expect(platform.env.ARCHIVE_ASSETS.head(key)).resolves.toBeNull();
    await expect(db.prepare("select first_deleted_at,delete_attempt_count from v2_restore_generation_cleanup_receipts where restore_id=?").bind(id).first()).resolves.toEqual({ first_deleted_at: "2026-08-30T00:12:00.000Z", delete_attempt_count: 1 });
    await platform.env.ARCHIVE_ASSETS.put(key, new Uint8Array([8]), { customMetadata: { restoreBatchId: id, userId: "user-a" } });
    await cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-08-30T00:23:00.000Z" });
    await expect(platform.env.ARCHIVE_ASSETS.head(key)).resolves.toBeNull();
    await cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-08-31T00:23:00.000Z" });
    await expect(db.prepare("select count(*) as value from v2_restore_generation_cleanup_receipts where restore_id=?").bind(id).first()).resolves.toEqual({ value: 1 });
    await platform.env.ARCHIVE_ASSETS.put(key, new Uint8Array([9]), { customMetadata: { restoreBatchId: id, userId: "user-a" } });
    await cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-09-01T00:24:00.000Z" });
    await expect(platform.env.ARCHIVE_ASSETS.head(key)).resolves.toBeNull();
    await expect(db.prepare("select delete_attempt_count from v2_restore_generation_cleanup_receipts where restore_id=?").bind(id).first()).resolves.toEqual({ delete_attempt_count: 4 });
    await db.exec("insert into users (id) values ('user-b');");
    await expect(db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-b',?,'2026-08-29T00:00:00.000Z')`).bind(id, key).run())
      .rejects.toThrow("restore_generation_owner_invalid");
  });

  test("rejects malformed generation cleanup keys", async () => {
    const db = platform.env.DB;
    const id = "restore-generation-invalid-key";
    await seedBatch(db, id, "applying", 0, "invalid-key-token", "2026-08-29T01:00:00.000Z");
    await expect(db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a','totally-invalid','2026-08-29T00:00:00.000Z')`).bind(id).run())
      .rejects.toThrow("restore_generation_key_invalid");
  });

  test("does not let a live unarmed receipt starve stale cleanup work", async () => {
    const db = platform.env.DB;
    const liveId = "restore-generation-live-fair";
    const staleId = "restore-generation-stale-fair";
    const liveKey = `users/test/restored-originals/live/restore-generations/${liveId}/hash/attempts/live-token`;
    const staleKey = `users/test/restored-originals/stale/restore-generations/${staleId}/hash/attempts/stale-token`;
    await seedBatch(db, liveId, "applying", 0, "live-token", "2026-08-29T01:00:00.000Z");
    await seedBatch(db, staleId, "applying", 0, "stale-token", "2026-08-28T23:00:00.000Z");
    await db.batch([
      db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(liveId, liveKey),
      db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(staleId, staleKey),
    ]);
    await expect(cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-08-29T00:10:00.000Z" })).resolves.toMatchObject({ armed: 1, restoreId: staleId });
    await expect(db.prepare(`select armed_at from v2_restore_generation_cleanup_receipts where restore_id=?`).bind(liveId).first()).resolves.toEqual({ armed_at: null });
  });

  test("does not let a recurring due tombstone starve older unarmed cleanup work", async () => {
    const db = platform.env.DB;
    const dueId = "restore-generation-due-fair";
    const staleId = "restore-generation-unarmed-fair";
    const dueKey = `users/test/restored-originals/due/restore-generations/${dueId}/hash/attempts/due-token`;
    const staleKey = `users/test/restored-originals/unarmed/restore-generations/${staleId}/hash/attempts/stale-token`;
    await seedBatch(db, dueId, "applying", 0, "due-token", "2026-08-29T01:00:00.000Z");
    await seedBatch(db, staleId, "applying", 0, "stale-token", "2026-08-28T23:00:00.000Z");
    await db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:05:00.000Z')`).bind(dueId, dueKey).run();
    await db.prepare(`update v2_restore_generation_cleanup_receipts set armed_at='2026-08-29T00:05:00.000Z',not_before='2026-08-29T00:09:00.000Z' where restore_id=?`).bind(dueId).run();
    await db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(staleId, staleKey).run();

    await expect(cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-08-29T00:10:00.000Z" })).resolves.toMatchObject({ armed: 1, restoreId: staleId });
    await expect(db.prepare(`select armed_at from v2_restore_generation_cleanup_receipts where restore_id=?`).bind(dueId).first()).resolves.toEqual({ armed_at: "2026-08-29T00:05:00.000Z" });
  });

  test("preserves a committed canonical generation and retires only its receipt", async () => {
    const db = platform.env.DB;
    const id = "restore-generation-canonical";
    const key = `users/test/restored-originals/canonical/restore-generations/${id}/hash/attempts/canonical-token`;
    await seedBatch(db, id, "applying", 0, "canonical-token", "2026-08-29T01:00:00.000Z");
    await db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(id, key).run();
    await db.prepare(`insert into v2_attachment_reservations (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at,committed_at)
      values (?,'user-a','committed',?,'canonical.bin','application/octet-stream',1,?,'2026-08-29T00:00:00.000Z','2026-08-30T00:00:00.000Z','2026-08-29T00:00:00.000Z','2026-08-29T00:00:00.000Z')`).bind(id, key, "c".repeat(64)).run();
    await db.prepare(`update v2_restore_generation_cleanup_receipts set armed_at='2026-08-29T00:01:00.000Z',not_before='2026-08-29T00:02:00.000Z' where restore_id=?`).bind(id).run();
    await platform.env.ARCHIVE_ASSETS.put(key, new Uint8Array([9]));
    await expect(cleanupNextRestoreGeneration({ db, bucket: platform.env.ARCHIVE_ASSETS, now: "2026-08-29T00:03:00.000Z" })).resolves.toMatchObject({ preserved: 1 });
    await expect(platform.env.ARCHIVE_ASSETS.head(key)).resolves.toBeTruthy();
    await expect(db.prepare(`select count(*) as value from v2_restore_generation_cleanup_receipts where restore_id=?`).bind(id).first()).resolves.toEqual({ value: 0 });
  });

  test("rollback atomically arms every unarmed generation attempt", async () => {
    const db = platform.env.DB;
    const id = "restore-generation-arm-all";
    await seedBatch(db, id, "applying", 4, "arm-token", "2026-08-29T01:00:00.000Z");
    for (const suffix of ["one", "two"]) {
      const key = `users/test/restored-originals/${suffix}/restore-generations/${id}/hash/attempts/arm-token`;
      await db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(id, key).run();
    }
    await requestRestoreRollback({ db, userId: "user-a", batchId: id, expectedRevision: 4, now: "2026-08-29T00:05:00.000Z" });
    await expect(db.prepare(`select count(*) as value from v2_restore_generation_cleanup_receipts where restore_id=? and armed_at is not null and not_before is not null`).bind(id).first()).resolves.toEqual({ value: 2 });
  });

  test("rollback deletes only its generation and preserves another restore's canonical generation", async () => {
    const db = platform.env.DB;
    const id = "restore-generation-a";
    const loserKey = `users/test/restored-originals/shared/restore-generations/${id}/${"b".repeat(64)}/attempts/attempt-a`;
    const winnerKey = `users/test/restored-originals/shared/restore-generations/restore-generation-b/${"b".repeat(64)}`;
    await seedBatch(db, id, "rolling_back", 0, "attempt-a", "2026-08-29T00:10:00.000Z");
    await platform.env.ARCHIVE_ASSETS.put(loserKey, new Uint8Array([1]), { customMetadata: { restoreBatchId: id, userId: "user-a" } });
    await platform.env.ARCHIVE_ASSETS.put(winnerKey, new Uint8Array([1]), { customMetadata: { restoreBatchId: "restore-generation-b", userId: "user-a" } });
    await db.batch([
      db.prepare(`insert into v2_restore_rows (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,candidate_row_json,restored_row_hash,plan_position,apply_status,rollback_status,r2_object_key,r2_sha256,r2_size_bytes,r2_status,updated_at)
        values (?,'v2_attachment_reservations','row','hash','created','row','2026-08-29T00:00:00.000Z','{}','hash',1,'applied','rolled_back',?,?,1,'delete_pending','2026-08-29T00:00:00.000Z')`).bind(id, loserKey, "b".repeat(64)),
      db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,'user-a',?,'2026-08-29T00:00:00.000Z')`).bind(id, loserKey),
      db.prepare(`insert into v2_attachment_reservations (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at,committed_at)
        values ('winner-reservation','user-a','committed',?,'winner.bin','application/octet-stream',1,?,'2026-08-29T00:00:00.000Z','2026-08-30T00:00:00.000Z','2026-08-29T00:00:00.000Z','2026-08-29T00:00:00.000Z')`).bind(winnerKey, "b".repeat(64)),
    ]);
    await db.prepare("update v2_restore_batches set lease_token=null,lease_expires_at=null where id=?").bind(id).run();
    await advanceRestoreWorkflow({ db, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", batchId: id, now: "2026-08-29T00:01:00.000Z" });
    await expect(platform.env.ARCHIVE_ASSETS.head(loserKey)).resolves.toBeNull();
    await expect(platform.env.ARCHIVE_ASSETS.head(winnerKey)).resolves.toBeTruthy();
    await expect(db.prepare("select object_key from v2_attachment_reservations where id='winner-reservation'").first()).resolves.toEqual({ object_key: winnerKey });
  });

  test("stale approve and rollback transitions cannot mutate rows added after the winning transition", async () => {
    const db = platform.env.DB;
    const delayed = () => {
      let release!: () => void; let started!: () => void;
      const releasePromise = new Promise<void>((resolve) => { release = resolve; });
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      let held = false;
      const wrapped = { prepare: db.prepare.bind(db), batch: async (statements: Parameters<D1DatabaseBinding["batch"]>[0]) => {
        if (!held) { held = true; started(); await releasePromise; }
        return db.batch(statements);
      } } as D1DatabaseBinding;
      return { wrapped, release, startedPromise };
    };
    await seedBatch(db, "restore-approve-transition", "awaiting_approval", 7, "", "");
    const readySummary = JSON.stringify({ sourceKind: "archive", counts: { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 }, tables: [], warnings: [], indexedFiles: 0, verifiedFiles: 0, materializedRows: 0, rollbackPreserved: 0 });
    await db.prepare("update v2_restore_batches set lease_token=null,lease_expires_at=null,dry_run_hash=?,summary_json=? where id='restore-approve-transition'").bind("a".repeat(64), readySummary).run();
    const approveDelay = delayed();
    const staleApprove = approveRestoreWorkflow({ db: approveDelay.wrapped, userId: "user-a", batchId: "restore-approve-transition", expectedDryRunHash: "a".repeat(64), expectedRevision: 7 });
    await approveDelay.startedPromise;
    await approveRestoreWorkflow({ db, userId: "user-a", batchId: "restore-approve-transition", expectedDryRunHash: "a".repeat(64), expectedRevision: 7 });
    await db.prepare(`insert into v2_restore_rows (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,plan_position,apply_status,rollback_status,r2_status,updated_at)
      values ('restore-approve-transition','v2_objects','late','hash','created','late','2026-08-29T00:00:00.000Z',9,'planned','not_applicable','not_applicable','2026-08-29T00:00:00.000Z')`).run();
    approveDelay.release();
    await expect(staleApprove).rejects.toMatchObject({ code: "restore_state_conflict" });
    await expect(db.prepare("select apply_status from v2_restore_rows where restore_batch_id='restore-approve-transition' and row_key='late'").first()).resolves.toEqual({ apply_status: "planned" });

    await seedBatch(db, "restore-rollback-transition", "applying", 11, "active-owner", "2026-08-29T00:10:00.000Z");
    const rollbackDelay = delayed();
    const staleRollback = requestRestoreRollback({ db: rollbackDelay.wrapped, userId: "user-a", batchId: "restore-rollback-transition", expectedRevision: 11 });
    await rollbackDelay.startedPromise;
    await requestRestoreRollback({ db, userId: "user-a", batchId: "restore-rollback-transition", expectedRevision: 11 });
    await db.prepare(`insert into v2_restore_rows (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,plan_position,apply_status,rollback_status,r2_status,updated_at)
      values ('restore-rollback-transition','v2_objects','late','hash','created','late','2026-08-29T00:00:00.000Z',9,'applied','not_applicable','not_applicable','2026-08-29T00:00:00.000Z')`).run();
    rollbackDelay.release();
    await expect(staleRollback).rejects.toMatchObject({ code: "restore_state_conflict" });
    await expect(db.prepare("select rollback_status from v2_restore_rows where restore_batch_id='restore-rollback-transition' and row_key='late'").first()).resolves.toEqual({ rollback_status: "not_applicable" });
  }, 30_000);

  test("a delayed coordinator catch cannot overwrite a new owner's succeeded result", async () => {
    const db = platform.env.DB;
    // A validating backup restore still pins a real, same-owner source.
    // Seed that checkpoint without weakening the source-availability guard.
    await db.prepare(`insert into v2_backup_snapshots
      (id,user_id,snapshot_kind,status,base_sequence,end_sequence,retention_class,created_at,workflow_version,build_phase)
      values ('restore-delayed-source','user-a','full','succeeded',0,0,'manual','2026-08-29T00:00:00.000Z',2,'complete')`).run();
    await db.prepare(`insert into v2_restore_batches
      (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_ref,cursor_json,state_revision,last_progress_at)
      values ('restore-delayed-advance','user-a','restore-delayed-advance','pending','pending','pending','validating','{"sourceKind":"backup","counts":{"create":0,"reuse":0,"fork":0,"conflict":0,"invalid":0},"tables":[],"warnings":[],"indexedFiles":0,"verifiedFiles":0,"materializedRows":0,"rollbackPreserved":0}','{}','2026-08-29T00:00:00.000Z',2,'backup','restore-delayed-source','{}',0,'2026-08-29T00:00:00.000Z')`).run();
    await expect(db.prepare(`update v2_restore_batches set source_ref='missing-backup' where id='restore-delayed-advance'`).run())
      .rejects.toThrow("backup_restore_source_unavailable");
    await db.prepare("update v2_restore_batches set archive_sha256=?,manifest_root_hash=?,dry_run_hash=?,plan_chain_hash=? where id='restore-delayed-advance'")
      .bind("a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)).run();
    let release!: () => void;
    let blocked!: () => void;
    const blockedPromise = new Promise<void>((resolve) => { blocked = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    const delayedDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: Parameters<D1DatabaseBinding["batch"]>[0]) => {
        if (!held) {
          held = true;
          blocked();
          await releasePromise;
        }
        return db.batch(statements);
      },
    } as D1DatabaseBinding;
    const unusedBucket = {} as R2BucketBinding;
    const oldAdvance = advanceRestoreWorkflow({ db: delayedDb, bucket: unusedBucket, userId: "user-a", batchId: "restore-delayed-advance", now: "2026-08-29T00:00:00.000Z" });
    await blockedPromise;
    await expect(advanceRestoreWorkflow({ db, bucket: unusedBucket, userId: "user-a", batchId: "restore-delayed-advance", now: "2026-08-29T00:03:00.000Z" }))
      .resolves.toMatchObject({ status: "succeeded" });
    release();
    await expect(oldAdvance).rejects.toBeInstanceOf(WorkflowLeaseLostError);
    await expect(getRestoreWorkflow(db, "user-a", "restore-delayed-advance")).resolves.toMatchObject({ status: "succeeded", failureCode: null });
  });

  test.each(["restore_validation_probe", "temporary transport outage"])("a delayed failure write preserves the winning result (%s)", async (message) => {
    const db = platform.env.DB;
    const id = message.startsWith("restore_") ? "restore-deterministic-catch" : "restore-transient-catch";
    await seedBatch(db, id, "validating", 0, "", "");
    // Seed a fully applied checkpoint, including the receipts required by the
    // terminal guard. The test injects a coordinator error, not corrupt data.
    const now = "2026-08-29T00:00:00.000Z";
    await db.prepare(`insert into v2_objects (id,user_id,object_kind,created_at,updated_at) values (?,'user-a','entity',?,?)`).bind(id, now, now).run();
    const candidate = await db.prepare(`select * from v2_objects where id=?`).bind(id).first<Record<string, unknown>>();
    const rowJson = canonicalJson(candidate), rowHash = sha256Hex(rowJson);
    const fileText = `${rowJson}\n`, fileBytes = new TextEncoder().encode(fileText).byteLength;
    await db.prepare(`update v2_restore_batches set lease_token=null,lease_expires_at=null,archive_sha256=?,manifest_root_hash=?,dry_run_hash=?,plan_chain_hash=?,planned_row_count=1,applied_row_count=1 where id=?`)
      .bind("a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64), id).run();
    await db.prepare(`insert into v2_restore_rows
      (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,plan_position,apply_sequence,apply_status,rollback_status,r2_status,updated_at,source_row_json,candidate_row_json,restored_row_hash,target_row_hash)
      values (?,'v2_objects','already-applied',?,'created',?,?,1,1,'applied','not_applicable','not_applicable',?,?,?,?,?)`)
      .bind(id, rowHash, id, now, now, rowJson, rowJson, rowHash, rowHash).run();
    await db.prepare(`update v2_restore_files set table_name='v2_objects',status='consumed',byte_length=?,next_byte_offset=?,expected_records=1,next_record=1,expected_sha256=?,verified_at=?,consumed_at=? where restore_batch_id=? and file_id='probe'`)
      .bind(fileBytes, fileBytes, sha256Hex(fileText), now, now, id).run();
    const injected = new Error(message);
    let release!: () => void;
    let blocked!: () => void;
    const blockedPromise = new Promise<void>((resolve) => { blocked = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    let batches = 0;
    const delayedDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: Parameters<D1DatabaseBinding["batch"]>[0]) => {
        batches++;
        // Fail the success batch before commit, then hold the coordinator's
        // real failure-write batch (including a deterministic rollback child).
        if (batches === 1) throw injected;
        if (batches === 2) { blocked(); await releasePromise; }
        return db.batch(statements);
      },
    } as D1DatabaseBinding;
    const oldOutcome = advanceRestoreWorkflow({ db: delayedDb, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", batchId: id, now: "2026-08-29T00:00:00.000Z" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await blockedPromise;
    try {
      await expect(advanceRestoreWorkflow({ db, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", batchId: id, now: "2026-08-29T00:03:00.000Z" }))
        .resolves.toMatchObject({ status: "succeeded", failureCode: null });
    } finally { release(); }
    const stale = await oldOutcome;
    expect("error" in stale ? stale.error : null).toBe(injected);
    expect(batches).toBe(2);
    await expect(db.prepare(`select status,state_revision,lease_token,failure_code from v2_restore_batches where id=?`).bind(id).first())
      .resolves.toEqual({ status: "succeeded", state_revision: 3, lease_token: null, failure_code: null });
    await expect(db.prepare(`select rollback_status from v2_restore_rows where restore_batch_id=? and row_key='already-applied'`).bind(id).first())
      .resolves.toEqual({ rollback_status: "not_applicable" });
    await expect(db.prepare(`select * from v2_objects where id=?`).bind(id).first()).resolves.toEqual(candidate);
    await expect(db.prepare(`select count(*) as value from v2_workflow_lease_assertions where workflow_id=?`).bind(id).first())
      .resolves.toEqual({ value: 0 });
  });

  test("expired takeover rejects the delayed owner and atomically rolls back its child mutation", async () => {
    const db = platform.env.DB;
    await seedBatch(db, "restore-expiry", "planning", 1, "old-owner", "2026-08-29T00:01:00.000Z");
    await db.prepare(`update v2_restore_batches set lease_token='new-owner',lease_expires_at='2026-08-29T00:05:00.000Z',state_revision=state_revision+1
      where id='restore-expiry' and lease_expires_at<='2026-08-29T00:02:00.000Z'`).run();

    await expect(runWorkflowLeaseFencedBatch({
      db,
      fence: { kind: "restore", workflowId: "restore-expiry", userId: "user-a", leaseToken: "old-owner", stateRevision: 1, expectedStatus: "planning" },
      nextStatus: "planning",
      statements: [db.prepare("update v2_restore_files set status='stale' where restore_batch_id='restore-expiry' and file_id='probe'")],
      parentProgress: db.prepare(`update v2_restore_batches set state_revision=2,lease_token=null,lease_expires_at=null where id='restore-expiry' and lease_token='old-owner' and state_revision=1`),
      now: "2026-08-29T00:02:00.000Z",
    })).rejects.toBeInstanceOf(WorkflowLeaseLostError);
    await expect(db.prepare("select status from v2_restore_files where restore_batch_id='restore-expiry' and file_id='probe'").first()).resolves.toEqual({ status: "indexed" });
    await expect(db.prepare("select lease_token,state_revision,status from v2_restore_batches where id='restore-expiry'").first()).resolves.toEqual({ lease_token: "new-owner", state_revision: 2, status: "planning" });
  });

  test("rollback CAS immediately fences in-flight apply and stale failure cannot overwrite it", async () => {
    const db = platform.env.DB;
    await seedBatch(db, "restore-rollback-race", "applying", 7, "apply-owner", "2026-08-29T00:10:00.000Z");
    await requestRestoreRollback({ db, userId: "user-a", batchId: "restore-rollback-race", expectedRevision: 7, now: "2026-08-29T00:03:00.000Z" });

    await expect(runWorkflowLeaseFencedBatch({
      db,
      fence: { kind: "restore", workflowId: "restore-rollback-race", userId: "user-a", leaseToken: "apply-owner", stateRevision: 7, expectedStatus: "applying" },
      nextStatus: "failed",
      statements: [db.prepare("update v2_restore_files set status='stale_failure' where restore_batch_id='restore-rollback-race'")],
      parentProgress: db.prepare(`update v2_restore_batches set status='failed',failure_code='stale',state_revision=8,lease_token=null,lease_expires_at=null where id='restore-rollback-race' and lease_token='apply-owner' and state_revision=7`),
      now: "2026-08-29T00:03:01.000Z",
    })).rejects.toBeInstanceOf(WorkflowLeaseLostError);
    await expect(db.prepare("select status,state_revision,lease_token,failure_code from v2_restore_batches where id='restore-rollback-race'").first())
      .resolves.toEqual({ status: "rollback_requested", state_revision: 8, lease_token: null, failure_code: null });
    await expect(db.prepare("select status from v2_restore_files where restore_batch_id='restore-rollback-race'").first()).resolves.toEqual({ status: "indexed" });
  });
});
