import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { writeExportBundle } from "@/lib/v2/portability/export-bundle-v1";
import { createBackupSnapshot, verifyBackupChain } from "@/lib/v2/portability/backup-snapshot-v1";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { applyBackupRetention } from "@/lib/v2/portability/backup-retention-v1";
import { sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { createRestoreDryRun, importVerifiedBundle, rollbackRestoreBatch, verifyExportBundle } from "@/lib/v2/portability/restore-bundle-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type TestPlatform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;
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
const migrations = migrationNames.map((name) => fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url)));
let source: TestPlatform;
const transientPlatforms = new Set<TestPlatform>();

async function apply(db: TestD1) {
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a');`);
  for (const path of migrations) {
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}

async function createAppliedPlatform() {
  const platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(platform.env.DB);
  transientPlatforms.add(platform);
  return platform;
}

beforeAll(async () => {
  source = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(source.env.DB);
}, 45_000);

afterEach(async () => {
  await Promise.all([...transientPlatforms].map((platform) => platform.dispose()));
  transientPlatforms.clear();
});

afterAll(async () => { await source.dispose(); });

async function makeBundle(exportKey: string) {
  const committedAt = "2026-08-12T09:00:01.000Z";
  const normal = await prepareCaptureCommit({ draftId: "portable-normal", channel: "web", title: "왕복할 글", bodyMarkdown: "# 왕복\n\n원문과  공백을 보존한다.\n", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-08-12T09:00:00.000Z" }, "portable-normal-key", committedAt);
  const restricted = await prepareCaptureCommit({ draftId: "portable-restricted", channel: "web", title: "잠긴 글", bodyMarkdown: "내보내면 안 되는 원문", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "restricted", capturedAt: "2026-08-12T09:01:00.000Z" }, "portable-restricted-key", "2026-08-12T09:01:01.000Z");
  const repository = new D1SourceFoundationRepository(source.env.DB, "user-a");
  await repository.commitCapture(normal);
  await repository.commitCapture(restricted);
  const jobs = new D1PortabilityRepository(source.env.DB, "user-a");
  const queued = await jobs.createExport({ profile: "migration", scope: { objects: "all", privacyLevels: ["normal"], includeTrash: false, includeHistory: true, includeOriginals: true }, idempotencyKey: `roundtrip-export-${exportKey}`, now: "2026-08-12T10:00:00.000Z" });
  const claimed = await jobs.claimExport(queued.id, "2026-08-12T10:00:01.000Z");
  const written = await writeExportBundle({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", job: claimed });
  await jobs.completeExport(claimed.id, { ...written, finishedAt: "2026-08-12T10:00:02.000Z" });
  const object = await source.env.ARCHIVE_ASSETS.get(written.objectKey);
  if (!object) throw new Error("Expected export object.");
  return { bytes: new Uint8Array(await object.arrayBuffer()), normal, restricted };
}

describe("I7 migration export and restore", () => {
  test("round-trips source and canonical rows, excludes restricted by scope, stays duplicate-free, and rolls back additively", async () => {
    const target = await createAppliedPlatform();
    const fixture = await makeBundle("round-trip");
    const verified = verifyExportBundle(fixture.bytes);
    expect(verified.manifest.profile).toBe("migration");
    expect(verified.manifest.counts.documents).toBe(1);
    expect(new TextDecoder().decode(verified.entries.get(`documents/${fixture.normal.objectId}/index.md`)?.bytes)).toContain("원문과  공백");
    expect([...verified.entries.keys()].some((path) => path.includes(fixture.restricted.objectId))).toBe(false);

    const firstDryRun = await createRestoreDryRun(target.env.DB, "user-a", verified);
    expect(firstDryRun.counts.conflict).toBe(0);
    expect(firstDryRun.counts.create).toBeGreaterThan(0);
    const first = await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", bundle: verified, expectedDryRunHash: firstDryRun.dryRunHash, idempotencyKey: "restore-one", now: "2026-08-12T11:00:00.000Z" });
    expect(first.status).toBe("succeeded");
    const restored = await new D1SourceFoundationRepository(target.env.DB, "user-a").getRecord(fixture.normal.objectId);
    expect(restored?.bodyMarkdown).toBe("# 왕복\n\n원문과  공백을 보존한다.\n");
    expect(await target.env.DB.prepare(`select count(*) as value from v2_documents`).first()).toEqual({ value: 1 });

    const secondDryRun = await createRestoreDryRun(target.env.DB, "user-a", verified);
    expect(secondDryRun.counts.create).toBe(0);
    expect(secondDryRun.counts.fork).toBe(0);
    const second = await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", bundle: verified, expectedDryRunHash: secondDryRun.dryRunHash, idempotencyKey: "restore-two", now: "2026-08-12T11:05:00.000Z" });
    expect(second.dryRun.counts.reuse).toBeGreaterThan(0);
    expect(await target.env.DB.prepare(`select count(*) as value from v2_documents`).first()).toEqual({ value: 1 });

    await rollbackRestoreBatch({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", batchId: second.batchId, now: "2026-08-12T11:06:00.000Z" });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_documents`).first()).toEqual({ value: 1 });
    const restoredFull = await createBackupSnapshot({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", kind: "full", now: "2026-08-12T11:06:30.000Z" });
    await rollbackRestoreBatch({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", batchId: first.batchId, now: "2026-08-12T11:07:00.000Z" });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_documents`).first()).toEqual({ value: 0 });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_source_items`).first()).toEqual({ value: 0 });
    const rollbackEvents = await target.env.DB.prepare(`select aggregate_kind,operation from v2_change_events where user_id='user-a' and aggregate_id=? order by sequence`).bind(fixture.normal.objectId).all<{ aggregate_kind: string; operation: string }>();
    expect(rollbackEvents.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ aggregate_kind: "document", operation: "upsert" }),
      { aggregate_kind: "document", operation: "tombstone" },
      { aggregate_kind: "object", operation: "tombstone" },
    ]));
    const rollbackIncremental = await createBackupSnapshot({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", kind: "incremental", now: "2026-08-12T11:07:30.000Z" });
    expect(rollbackIncremental).toMatchObject({ baseSnapshotId: restoredFull.snapshotId, baseSequence: restoredFull.endSequence });
    const rolledBackBundle = await materializeVerifiedBackup({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: rollbackIncremental.snapshotId });
    expect(rolledBackBundle.rowsByTable.get("v2_objects")).toHaveLength(0);
    expect(rolledBackBundle.rowsByTable.get("v2_documents")).toHaveLength(0);
    expect(rolledBackBundle.rowsByTable.get("v2_source_items")).toHaveLength(0);

    const faultDryRun = await createRestoreDryRun(target.env.DB, "user-a", verified);
    await target.env.DB.exec(`create trigger inject_restore_failure before insert on v2_documents begin select raise(abort,'injected_restore_failure'); end;`);
    await expect(importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", bundle: verified, expectedDryRunHash: faultDryRun.dryRunHash, idempotencyKey: "restore-fault", now: "2026-08-12T11:08:00.000Z" })).rejects.toThrow();
    await target.env.DB.exec(`drop trigger inject_restore_failure;`);
    expect(await target.env.DB.prepare(`select status from v2_restore_batches where idempotency_key='restore-fault'`).first()).toEqual({ status: "rolled_back" });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_capture_bundles`).first()).toEqual({ value: 0 });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_objects`).first()).toEqual({ value: 0 });
  }, 120_000);

  test("preserves a legacy row as an immutable envelope before deterministic review projection", async () => {
    await source.env.DB.exec(`create table media_logs (id text primary key,user_id text not null,media_type text not null,title text not null,rating real,review text,created_at text not null,updated_at text not null,deleted_at text); insert into media_logs values ('legacy-media-1','user-a','movie','오래된 영화',4.5,'마지막 장면이 오래 남았다.','2024-01-02T00:00:00Z','2024-01-02T00:00:00Z',null);`);
    const migration = new D1LegacyMigrationRepository(source.env.DB, "user-a", { legacyReadOnly: true });
    await expect(migration.adapterCoverage("media_logs")).resolves.toMatchObject({ valid: true, missing: [] });
    const dryRun = await migration.createDryRun("media_logs");
    const sourceOnly = await migration.runApprovedBatch({ table: "media_logs", importBatchId: "legacy-batch-1", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, limit: 25, now: "2026-08-12T12:00:00.000Z" });
    expect(sourceOnly).toMatchObject({ processed: 1, complete: true, appliedLimit: 1 });
    const sourceMapping = await source.env.DB.prepare(`select legacy_envelope_id,projected_object_id from v2_legacy_source_mappings where legacy_id='legacy-media-1' and projection_kind='review'`).first<{ legacy_envelope_id: string; projected_object_id: string }>();
    expect(await source.env.DB.prepare(`select count(*) as value from v2_object_type_assignments where object_id=?`).bind(sourceMapping!.projected_object_id).first()).toEqual({ value: 0 });
    await expect(new D1SourceFoundationRepository(source.env.DB, "user-a").getRecord(sourceMapping!.projected_object_id)).resolves.toBeNull();
    await expect(source.env.DB.prepare(
      `select o.lifecycle_status,d.title,d.body_markdown from v2_objects o
       join v2_documents d on d.object_id=o.id where o.id=? and o.user_id='user-a'`,
    ).bind(sourceMapping!.projected_object_id).first()).resolves.toMatchObject({ lifecycle_status: "archived", title: "오래된 영화", body_markdown: "마지막 장면이 오래 남았다." });
    await expect(migration.reconcileBatch("legacy-batch-1")).resolves.toMatchObject({ envelope_count: 1, distinct_envelope_count: 1, invalid_hash_count: 0, mapping_count: 1, source_only_count: 1, projected_count: 0, structurally_valid: true, complete: true });
    const prepared = await migration.runApprovedBatch({ table: "media_logs", importBatchId: "legacy-knowledge-1", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-12T12:01:00.000Z" });
    expect(prepared).toMatchObject({ batchPrepared: true, processed: 0, complete: false, nextOffset: 0 });
    const first = await migration.runApprovedBatch({ table: "media_logs", importBatchId: "legacy-knowledge-1", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-12T12:01:01.000Z" });
    expect(first).toMatchObject({ processed: 1, complete: true });
    await expect(new D1SourceFoundationRepository(source.env.DB, "user-a").getRecord(sourceMapping!.projected_object_id)).resolves.toMatchObject({ lifecycleStatus: "active", title: "오래된 영화", bodyMarkdown: "마지막 장면이 오래 남았다." });
    await expect(source.env.DB.prepare(`select value_number,source_class,review_status from v2_property_values where owner_object_id=?`).bind(sourceMapping!.projected_object_id).first()).resolves.toMatchObject({ value_number: 4.5, source_class: "imported", review_status: "accepted" });
    await expect(source.env.DB.prepare(`update v2_legacy_source_envelopes set row_json='{}' where id=?`).bind(sourceMapping!.legacy_envelope_id).run()).rejects.toThrow(/immutable/);
    const replay = await migration.runApprovedBatch({ table: "media_logs", importBatchId: "legacy-knowledge-1", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-12T12:02:00.000Z" });
    expect(replay).toMatchObject({ processed: 0, complete: true });
    expect(await source.env.DB.prepare(`select count(*) as value from v2_legacy_source_envelopes where legacy_id='legacy-media-1'`).first()).toEqual({ value: 1 });
    await expect(migration.reconcileBatch("legacy-knowledge-1")).resolves.toMatchObject({ envelope_count: 1, mapping_count: 1, source_only_count: 0, projected_count: 1, structurally_valid: true, complete: true });
  });

  test("creates a new envelope and mapping for a changed row, then explicitly supersedes the old projection", async () => {
    await source.env.DB.exec(`create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('quick-change-1','user-a','첫 번째 원문','pending',null,null,null,null,null,'2026-08-12T12:10:00.000Z');`);
    const migration = new D1LegacyMigrationRepository(source.env.DB, "user-a", { legacyReadOnly: true });
    const firstDryRun = await migration.createDryRun("quick_captures");
    await migration.runApprovedBatch({ table: "quick_captures", importBatchId: "quick-source-v1", mode: "source_only", expectedDryRunHash: firstDryRun.dryRunHash, now: "2026-08-12T12:10:01.000Z" });
    const firstMapping = await source.env.DB.prepare(`select id,legacy_envelope_id,projected_object_id from v2_legacy_source_mappings where legacy_id='quick-change-1'`).first<{ id: string; legacy_envelope_id: string; projected_object_id: string }>();
    await source.env.DB.prepare(`update quick_captures set raw_text='수정된 두 번째 원문' where id='quick-change-1'`).run();
    const secondDryRun = await migration.createDryRun("quick_captures");
    expect(secondDryRun.dryRunHash).not.toBe(firstDryRun.dryRunHash);
    await migration.runApprovedBatch({ table: "quick_captures", importBatchId: "quick-source-v2", mode: "source_only", expectedDryRunHash: secondDryRun.dryRunHash, now: "2026-08-12T12:11:00.000Z" });
    const mappings = await source.env.DB.prepare(`select id,legacy_envelope_id,projected_object_id,status from v2_legacy_source_mappings where legacy_id='quick-change-1' order by created_at`).all<{ id: string; legacy_envelope_id: string; projected_object_id: string; status: string }>();
    expect(mappings.results).toHaveLength(2);
    expect(new Set(mappings.results.map((row) => row.legacy_envelope_id)).size).toBe(2);
    expect(new Set(mappings.results.map((row) => row.projected_object_id)).size).toBe(2);
    expect(await source.env.DB.prepare(`select count(*) as value from v2_legacy_source_envelopes where legacy_id='quick-change-1'`).first()).toEqual({ value: 2 });
    await expect(migration.runApprovedBatch({ table: "quick_captures", importBatchId: "quick-knowledge-v2", mode: "knowledge", expectedDryRunHash: secondDryRun.dryRunHash, now: "2026-08-12T12:12:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, processed: 0, complete: false });
    await migration.runApprovedBatch({ table: "quick_captures", importBatchId: "quick-knowledge-v2", mode: "knowledge", expectedDryRunHash: secondDryRun.dryRunHash, now: "2026-08-12T12:12:01.000Z" });
    const lineage = await source.env.DB.prepare(`select id,status,superseded_by_mapping_id from v2_legacy_source_mappings where legacy_id='quick-change-1' order by created_at`).all<{ id: string; status: string; superseded_by_mapping_id: string | null }>();
    expect(lineage.results.find((row) => row.id === firstMapping!.id)).toMatchObject({ status: "superseded" });
    const current = lineage.results.find((row) => row.status === "projected");
    expect(current).toBeTruthy();
    expect(lineage.results.find((row) => row.id === firstMapping!.id)?.superseded_by_mapping_id).toBe(current!.id);
    await expect(new D1SourceFoundationRepository(source.env.DB, "user-a").getRecord(firstMapping!.projected_object_id)).resolves.toBeNull();
    await expect(source.env.DB.prepare(`select lifecycle_status from v2_objects where id=? and user_id='user-a'`).bind(firstMapping!.projected_object_id).first()).resolves.toEqual({ lifecycle_status: "archived" });
    const currentObject = mappings.results.find((row) => row.id === current!.id)!.projected_object_id;
    await expect(new D1SourceFoundationRepository(source.env.DB, "user-a").getRecord(currentObject)).resolves.toMatchObject({ lifecycleStatus: "active", bodyMarkdown: "수정된 두 번째 원문" });
    await expect(migration.reconcileBatch("quick-source-v2")).resolves.toMatchObject({ envelope_count: 1, mapping_count: 1, missing_mapping_count: 0, unexpected_mapping_count: 0, structurally_valid: true, complete: true });
  });

  test("archives a parent-scoped composite legacy relation without inventing a document", async () => {
    await source.env.DB.exec(`create table tasks (id text primary key,user_id text not null); create table task_people_relations (task_id text not null,person_id text not null,role_context text,created_at text not null); insert into tasks values ('legacy-task-1','user-a'); insert into task_people_relations values ('legacy-task-1','legacy-person-1','함께 검토','2025-01-01T00:00:00Z');`);
    const migration = new D1LegacyMigrationRepository(source.env.DB, "user-a", { legacyReadOnly: true });
    const identity = JSON.stringify(["legacy-task-1", "legacy-person-1"]);
    const dryRun = await migration.createDryRun("task_people_relations");
    expect(dryRun).toMatchObject({ inputRows: 1, projectedDocuments: 0, archivedRows: 1, damageCodes: {} });
    await expect(migration.runApprovedBatch({ table: "task_people_relations", importBatchId: "legacy-archive-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, limit: 25, now: "2026-08-12T12:30:00.000Z" })).resolves.toMatchObject({ processed: 1, complete: true, appliedLimit: 1 });
    await expect(migration.reconcileBatch("legacy-archive-batch")).resolves.toMatchObject({ envelope_count: 1, mapping_count: 1, archived_count: 1, source_only_count: 0, projected_count: 0, structurally_valid: true, complete: true });
    await expect(source.env.DB.prepare(`select projection_kind,status,projected_object_id from v2_legacy_source_mappings where legacy_id=?`).bind(identity).first()).resolves.toEqual({ projection_kind: "archived_only", status: "archived", projected_object_id: null });
    const parentDryRun = await migration.createDryRun("tasks");
    await expect(migration.runApprovedBatch({ table: "tasks", importBatchId: "legacy-task-source", mode: "source_only", expectedDryRunHash: parentDryRun.dryRunHash, offset: 0, limit: 25, now: "2026-08-12T12:30:30.000Z" })).resolves.toMatchObject({ processed: 1, complete: true });
    await expect(migration.runApprovedBatch({ table: "task_people_relations", importBatchId: "legacy-archive-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, limit: 25, now: "2026-08-12T12:31:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, processed: 0, complete: false });
    await expect(migration.runApprovedBatch({ table: "task_people_relations", importBatchId: "legacy-archive-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, limit: 25, now: "2026-08-12T12:31:01.000Z" })).resolves.toMatchObject({ processed: 1, complete: true, reconciliation: { envelope_count: 1, mapping_count: 1, archived_count: 1 } });
  });

  test("rejects and rolls back a restored succeeded legacy batch whose receipt contradicts its manifest and mappings", async () => {
    const target = await createAppliedPlatform();
    const fixture = await makeBundle("corrupt-batch");
    const verified = verifyExportBundle(fixture.bytes);
    const corruptBatch = {
      schema_version: verified.manifest.schemaVersion,
      user_scope_export_id: verified.manifest.exportId,
      id: "corrupt-restored-success",
      user_id: "source-user",
      legacy_table: "notes",
      adapter_version: "notes_v1",
      mode: "source_only",
      dry_run_hash: "dry-run",
      schema_snapshot: "schema",
      manifest_json: "[]",
      input_rows: 0,
      expected_mapping_count: 1,
      next_offset: 0,
      status: "succeeded",
      reconciliation_status: "passed",
      reconciliation_json: JSON.stringify({ batch_status: "succeeded", complete: true, structurally_valid: true, input_rows: 0, next_offset: 0, expected_mapping_count: 1, envelope_count: 0, distinct_envelope_count: 0, mapping_count: 0, expected_processed_mapping_count: 0, processed_item_count: 0, pending_item_count: 0, missing_mapping_count: 0, unexpected_mapping_count: 0, invalid_dependency_count: 0 }),
      summary_json: "{}",
      failure_code: null,
      created_at: "2026-08-12T12:40:00.000Z",
      approved_at: "2026-08-12T12:40:00.000Z",
      started_at: "2026-08-12T12:40:00.000Z",
      finished_at: "2026-08-12T12:40:00.000Z",
      reconciled_at: "2026-08-12T12:40:00.000Z",
    };
    const corrupted = { ...verified, rowsByTable: new Map([["v2_legacy_migration_batches", [corruptBatch]]]) };
    const dryRun = await createRestoreDryRun(target.env.DB, "user-a", corrupted);
    await expect(importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "user-a", bundle: corrupted, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "restore-corrupt-legacy-success", now: "2026-08-12T12:41:00.000Z" })).rejects.toMatchObject({ code: "legacy_batch_semantic_invalid" });
    expect(await target.env.DB.prepare(`select count(*) as value from v2_legacy_migration_batches where id='corrupt-restored-success'`).first()).toEqual({ value: 0 });
    expect(await target.env.DB.prepare(`select status,failure_code from v2_restore_batches where idempotency_key='restore-corrupt-legacy-success'`).first()).toEqual({ status: "rolled_back", failure_code: "legacy_batch_semantic_invalid" });
  }, 120_000);

  test("restores a valid pre-0027 terminal legacy batch with the same control state as the schema backfill", async () => {
    const target = await createAppliedPlatform();
    const fixture = await makeBundle("pre-0027-terminal-batch");
    const verified = verifyExportBundle(fixture.bytes);
    const terminalReceipt = {
      batch_status: "succeeded",
      complete: true,
      structurally_valid: true,
      input_rows: 0,
      next_offset: 0,
      expected_mapping_count: 0,
      envelope_count: 0,
      distinct_envelope_count: 0,
      mapping_count: 0,
      expected_processed_mapping_count: 0,
      processed_item_count: 0,
      pending_item_count: 0,
      knowledge_pending_count: 0,
      missing_mapping_count: 0,
      unexpected_mapping_count: 0,
      invalid_dependency_count: 0,
    };
    const historicalBatch = {
      schema_version: verified.manifest.schemaVersion,
      user_scope_export_id: verified.manifest.exportId,
      id: "pre-0027-terminal-success",
      user_id: "source-user",
      legacy_table: "media_logs",
      adapter_version: "media_logs_v2",
      mode: "source_only",
      dry_run_hash: "historical-dry-run",
      schema_snapshot: "historical-schema",
      manifest_json: "[]",
      input_rows: 0,
      expected_mapping_count: 0,
      next_offset: 0,
      status: "succeeded",
      reconciliation_status: "passed",
      reconciliation_json: JSON.stringify(terminalReceipt),
      summary_json: "{}",
      failure_code: null,
      created_at: "2026-08-12T12:42:00.000Z",
      approved_at: "2026-08-12T12:42:00.000Z",
      started_at: "2026-08-12T12:42:00.000Z",
      finished_at: "2026-08-12T12:42:00.000Z",
      reconciled_at: "2026-08-12T12:42:00.000Z",
    };
    const historical = {
      ...verified,
      rowsByTable: new Map([
        ...verified.rowsByTable,
        ["v2_legacy_migration_batches", [...(verified.rowsByTable.get("v2_legacy_migration_batches") ?? []), historicalBatch]],
      ]),
    };
    const dryRun = await createRestoreDryRun(target.env.DB, "user-a", historical);
    const restored = await importVerifiedBundle({
      db: target.env.DB,
      bucket: target.env.ARCHIVE_ASSETS,
      userId: "user-a",
      bundle: historical,
      expectedDryRunHash: dryRun.dryRunHash,
      idempotencyKey: "restore-pre-0027-terminal-success",
      now: "2026-08-12T12:43:00.000Z",
    });
    expect(restored.status).toBe("succeeded");
    await expect(target.env.DB.prepare(`select status,control_status,state_revision,quarantine_idempotency_key from v2_legacy_migration_batches where id='pre-0027-terminal-success'`).first()).resolves.toEqual({
      status: "succeeded",
      control_status: "complete",
      state_revision: 0,
      quarantine_idempotency_key: null,
    });
    await expect(new D1LegacyMigrationRepository(target.env.DB, "user-a").reconcileBatch("pre-0027-terminal-success")).resolves.toMatchObject({
      structurally_valid: true,
      complete: true,
      control_status: "complete",
    });
  }, 120_000);

  test("marks a backup successful only after metadata validation and content-addressed original verification", async () => {
    const backupTarget = await createAppliedPlatform();
    const prepared = await prepareCaptureCommit({ draftId: "backup-owner", channel: "web", title: "백업할 기록", bodyMarkdown: "원본 첨부가 있는 백업 기록", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-08-12T12:59:00.000Z" }, "backup-owner-key", "2026-08-12T12:59:01.000Z");
    const receipt = await new D1SourceFoundationRepository(source.env.DB, "user-a").commitCapture(prepared);
    const ownerRecord = { object_id: receipt.recordId, source_id: receipt.sourceItemIds[0] };
    const bytes = new TextEncoder().encode("backup-original-fixture");
    const hash = sha256Hex(bytes);
    const key = "users/test/originals/backup-attachment";
    await source.env.ARCHIVE_ASSETS.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { reservationId: "backup-attachment", userId: "user-a" }, sha256: Uint8Array.from(hash.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16)) });
    await source.env.DB.exec(`insert into v2_attachment_reservations (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at,committed_at) values ('backup-attachment','user-a','verified','${key}','fixture.png','image/png',${bytes.byteLength},'${hash}','2026-08-12T13:00:00Z','2026-08-13T13:00:00Z','2026-08-12T13:00:00Z',null); insert into v2_source_attachment_links (user_id,source_item_id,attachment_id,created_at) values ('user-a','${ownerRecord.source_id}','backup-attachment','2026-08-12T13:00:00Z'); update v2_attachment_reservations set status='committed',committed_at='2026-08-12T13:00:00Z' where id='backup-attachment';`);
    const manifest = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", kind: "full", now: "2026-08-12T13:01:00.000Z" });
    expect(manifest.validator).toMatchObject({ valid: true, blobCount: 1, blobBytes: bytes.byteLength });
    expect(manifest.blobs[0]).toMatchObject({ sha256: hash, attachmentIds: ["backup-attachment"] });
    await expect(source.env.ARCHIVE_ASSETS.head(manifest.blobs[0].objectKey)).resolves.toMatchObject({ size: bytes.byteLength });
    await expect(source.env.DB.prepare(`select status,manifest_root_hash,referenced_blob_count,referenced_blob_bytes from v2_backup_snapshots where id=?`).bind(manifest.snapshotId).first()).resolves.toMatchObject({ status: "succeeded", manifest_root_hash: manifest.rootHash, referenced_blob_count: 1, referenced_blob_bytes: bytes.byteLength });
    const deltaCapture = await prepareCaptureCommit({ draftId: "backup-delta", channel: "web", title: "백업 뒤 변경", bodyMarkdown: "변경분에 포함될 기록", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-08-12T13:02:00.000Z" }, "backup-delta-key", "2026-08-12T13:02:01.000Z");
    await new D1SourceFoundationRepository(source.env.DB, "user-a").commitCapture(deltaCapture);
    const incremental = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", kind: "incremental", now: "2026-08-12T13:03:00.000Z" });
    expect(incremental).toMatchObject({ baseSnapshotId: manifest.snapshotId, baseSequence: manifest.endSequence, snapshotKind: "incremental" });
    await expect(verifyBackupChain({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: incremental.snapshotId })).resolves.toMatchObject({ valid: true, snapshots: [{ id: manifest.snapshotId, kind: "full" }, { id: incremental.snapshotId, kind: "incremental" }], endSequence: incremental.endSequence });
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", snapshotId: incremental.snapshotId });
    const dryRun = await createRestoreDryRun(backupTarget.env.DB, "user-a", bundle);
    expect(dryRun.counts.create).toBeGreaterThan(0);
    const restoredBackup = await importVerifiedBundle({ db: backupTarget.env.DB, bucket: backupTarget.env.ARCHIVE_ASSETS, userId: "user-a", bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "backup-restore-one", now: "2026-08-12T13:04:00.000Z" });
    await expect(new D1SourceFoundationRepository(backupTarget.env.DB, "user-a").getRecord(deltaCapture.objectId)).resolves.toMatchObject({ bodyMarkdown: "변경분에 포함될 기록" });
    const restoredAttachment = await backupTarget.env.DB.prepare(`select object_key,sha256,size_bytes from v2_attachment_reservations where id='backup-attachment'`).first<{ object_key: string; sha256: string; size_bytes: number }>();
    expect(restoredAttachment).toMatchObject({ sha256: hash, size_bytes: bytes.byteLength });
    await expect(backupTarget.env.ARCHIVE_ASSETS.head(restoredAttachment!.object_key)).resolves.toMatchObject({ size: bytes.byteLength });
    const duplicateDryRun = await createRestoreDryRun(backupTarget.env.DB, "user-a", bundle);
    expect(duplicateDryRun.counts.create).toBe(0);
    expect(duplicateDryRun.counts.fork).toBe(0);
    const duplicateRestore = await importVerifiedBundle({ db: backupTarget.env.DB, bucket: backupTarget.env.ARCHIVE_ASSETS, userId: "user-a", bundle, expectedDryRunHash: duplicateDryRun.dryRunHash, idempotencyKey: "backup-restore-two", now: "2026-08-12T13:04:30.000Z" });
    expect(duplicateRestore.dryRun.counts.reuse).toBeGreaterThan(0);
    expect(await backupTarget.env.DB.prepare(`select count(*) as value from v2_attachment_reservations where id='backup-attachment'`).first()).toEqual({ value: 1 });
    await rollbackRestoreBatch({ db: backupTarget.env.DB, bucket: backupTarget.env.ARCHIVE_ASSETS, userId: "user-a", batchId: duplicateRestore.batchId, now: "2026-08-12T13:04:45.000Z" });
    await rollbackRestoreBatch({ db: backupTarget.env.DB, bucket: backupTarget.env.ARCHIVE_ASSETS, userId: "user-a", batchId: restoredBackup.batchId, now: "2026-08-12T13:05:00.000Z" });
    expect(await backupTarget.env.DB.prepare(`select count(*) as value from v2_documents`).first()).toEqual({ value: 0 });
  }, 180_000);

  test("prunes beyond retention limits but deletes an unreferenced blob only after the seven-day grace", async () => {
    const statements = Array.from({ length: 31 }, (_, index) => `insert into v2_backup_snapshots (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,pinned,created_at) values ('daily-gc-${String(index).padStart(2, "0")}','user-a','incremental','succeeded',null,0,0,'daily',0,'2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z')`).join(";");
    await source.env.DB.exec(`${statements};`);
    const bytes = new TextEncoder().encode("grace-protected-backup-blob");
    const hash = sha256Hex(bytes);
    const objectKey = `users/test/backups/blobs/sha256/${hash}`;
    await source.env.ARCHIVE_ASSETS.put(objectKey, bytes, { customMetadata: { sha256: hash } });
    await source.env.DB.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values ('daily-gc-00','user-a',?,?,?,?,?)`).bind(hash, objectKey, bytes.byteLength, "application/octet-stream", "2026-07-01T00:00:00.000Z").run();
    const first = await applyBackupRetention({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", now: "2026-08-01T00:00:00.000Z" });
    expect(first.prunedSnapshotIds).toContain("daily-gc-00");
    await expect(source.env.DB.prepare(`select status,pruned_at from v2_backup_snapshots where id='daily-gc-00'`).first()).resolves.toEqual({ status: "pruned", pruned_at: "2026-08-01T00:00:00.000Z" });
    await expect(source.env.ARCHIVE_ASSETS.head(objectKey)).resolves.toMatchObject({ size: bytes.byteLength });
    await expect(source.env.DB.prepare(`select deleted_at from v2_backup_blob_gc_marks where user_id='user-a' and sha256=?`).bind(hash).first()).resolves.toEqual({ deleted_at: null });
    const afterGrace = await applyBackupRetention({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "user-a", now: "2026-08-08T00:00:01.000Z" });
    expect(afterGrace.deletedBlobCount).toBe(1);
    await expect(source.env.ARCHIVE_ASSETS.head(objectKey)).resolves.toBeNull();
  }, 30_000);
});
