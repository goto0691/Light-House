import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../../../migrations/0019_v2_resumable_restore_hardening.sql", import.meta.url));
const v2MigrationNames = [
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
const hash = "a".repeat(64);

let db: DatabaseSync;

async function applyMigration() {
  const sql = await readFile(migrationPath, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}

function insertBatch(input: { id: string; workflowVersion?: number; planned?: number; applied?: number; planHash?: string | null; status?: string }) {
  db.prepare(`
    insert into v2_restore_batches (
      id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,
      summary_json,collision_map_json,created_at,workflow_version,source_kind,cursor_json,
      plan_chain_hash,planned_row_count,applied_row_count,last_progress_at
    ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.id,
    "user-a",
    `key-${input.id}`,
    hash,
    hash,
    hash,
    input.status ?? "importing",
    "{}",
    "{}",
    "2026-08-28T00:00:00.000Z",
    input.workflowVersion ?? 2,
    "staged_archive",
    "{}",
    input.planHash ?? null,
    input.planned ?? 0,
    input.applied ?? 0,
    "2026-08-28T00:00:00.000Z",
  );
}

function insertPlannedRow(batchId: string, input: { disposition?: string; applyStatus?: string; rollbackStatus?: string } = {}) {
  db.prepare(`
    insert into v2_restore_rows (
      restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,
      source_row_json,candidate_row_json,restored_row_hash,target_row_hash,plan_position,apply_sequence,
      apply_status,rollback_status,r2_status,updated_at
    ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    batchId,
    "v2_objects",
    '{"id":"source-1"}',
    hash,
    input.disposition ?? "created",
    '{"id":"target-1"}',
    "2026-08-28T00:00:00.000Z",
    '{"id":"source-1"}',
    '{"id":"target-1"}',
    hash,
    hash,
    0,
    0,
    input.applyStatus ?? "planned",
    input.rollbackStatus ?? "pending",
    "not_applicable",
    "2026-08-28T00:00:00.000Z",
  );
}

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    pragma foreign_keys=on;
    create table users (id text primary key not null);
    insert into users (id) values ('user-a'),('user-b');
    create table v2_restore_batches (
      id text primary key not null,
      user_id text not null references users(id) on delete cascade,
      idempotency_key text not null,
      archive_sha256 text not null,
      manifest_root_hash text not null,
      dry_run_hash text not null,
      status text not null default 'verified',
      summary_json text not null,
      collision_map_json text not null default '{}',
      created_at text not null,
      approved_at text,
      started_at text,
      finished_at text,
      rolled_back_at text,
      failure_code text
    );
    create unique index uq_v2_restore_user_idempotency on v2_restore_batches(user_id,idempotency_key);
    create index idx_v2_restore_user_status_time on v2_restore_batches(user_id,status,created_at);
    create table v2_restore_rows (
      restore_batch_id text not null references v2_restore_batches(id) on delete cascade,
      table_name text not null,
      row_key text not null,
      source_row_hash text not null,
      disposition text not null,
      restored_row_key text not null,
      created_at text not null,
      primary key(restore_batch_id,table_name,row_key)
    );
    create index idx_v2_restore_rows_disposition on v2_restore_rows(restore_batch_id,disposition,table_name);
  `);
  await applyMigration();
});

afterEach(() => db.close());

describe("0019 resumable restore schema", () => {
  test("adds resumable state, files, mappings, and compatible v1 defaults", () => {
    const batchColumns = db.prepare("select name,\"notnull\",dflt_value from pragma_table_info('v2_restore_batches')").all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    expect(batchColumns).toEqual(expect.arrayContaining([
      { name: "workflow_version", notnull: 1, dflt_value: "1" },
      { name: "source_kind", notnull: 1, dflt_value: "'legacy_inline'" },
      { name: "cursor_json", notnull: 1, dflt_value: "'{}'" },
      { name: "state_revision", notnull: 1, dflt_value: "0" },
      { name: "lease_token", notnull: 0, dflt_value: null },
    ]));

    const rowColumns = db.prepare("select name,\"notnull\",dflt_value from pragma_table_info('v2_restore_rows')").all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    expect(rowColumns).toEqual(expect.arrayContaining([
      { name: "candidate_row_json", notnull: 0, dflt_value: null },
      { name: "restored_row_hash", notnull: 0, dflt_value: null },
      { name: "apply_status", notnull: 1, dflt_value: "'legacy'" },
      { name: "rollback_status", notnull: 1, dflt_value: "'not_applicable'" },
      { name: "r2_status", notnull: 1, dflt_value: "'not_applicable'" },
    ]));

    expect(db.prepare("select name from sqlite_master where type='table' and name like 'v2_restore_%' order by name").all()).toEqual([
      { name: "v2_restore_batches" },
      { name: "v2_restore_files" },
      { name: "v2_restore_id_mappings" },
      { name: "v2_restore_rows" },
    ]);
    expect(db.prepare("select name from sqlite_master where type='index' and name in ('idx_v2_restore_files_status','idx_v2_restore_id_mapping_target','idx_v2_restore_resume') order by name").all()).toEqual([
      { name: "idx_v2_restore_files_status" },
      { name: "idx_v2_restore_id_mapping_target" },
      { name: "idx_v2_restore_resume" },
    ]);

    db.prepare(`
      insert into v2_restore_batches (
        id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,
        summary_json,collision_map_json,created_at
      ) values (?,?,?,?,?,?,?,?,?,?)
    `).run("legacy-v1", "user-a", "key-legacy-v1", hash, hash, hash, "importing", "{}", "{}", "2026-08-28T00:00:00.000Z");
    expect(db.prepare("select workflow_version,source_kind,cursor_json,state_revision from v2_restore_batches where id='legacy-v1'").get()).toEqual({
      workflow_version: 1,
      source_kind: "legacy_inline",
      cursor_json: "{}",
      state_revision: 0,
    });
    db.prepare("insert into v2_restore_rows (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at) values (?,?,?,?,?,?,?)")
      .run("legacy-v1", "v2_objects", "legacy-key", "legacy-hash", "created", "legacy-key", "2026-08-28T00:00:00.000Z");
    expect(db.prepare("select apply_status,rollback_status,r2_status from v2_restore_rows where restore_batch_id='legacy-v1'").get()).toEqual({
      apply_status: "legacy",
      rollback_status: "not_applicable",
      r2_status: "not_applicable",
    });
    db.prepare("update v2_restore_batches set status='succeeded' where id='legacy-v1'").run();
    db.prepare("update v2_restore_batches set status='rolled_back' where id='legacy-v1'").run();
  });

  test("refuses v2 success until rows and indexed files have terminal receipts", () => {
    insertBatch({ id: "restore-v2", planned: 1, applied: 0 });
    insertPlannedRow("restore-v2");

    expect(() => db.prepare("update v2_restore_batches set status='succeeded' where id='restore-v2'").run()).toThrow(/restore_plan_hash_missing/);
    db.prepare("update v2_restore_batches set plan_chain_hash=? where id='restore-v2'").run(hash);
    expect(() => db.prepare("update v2_restore_batches set status='succeeded' where id='restore-v2'").run()).toThrow(/restore_rows_not_fully_applied/);

    db.prepare("update v2_restore_batches set applied_row_count=1 where id='restore-v2'").run();
    expect(() => db.prepare("update v2_restore_batches set status='succeeded' where id='restore-v2'").run()).toThrow(/restore_rows_not_fully_applied/);
    db.prepare("update v2_restore_rows set apply_status='applied' where restore_batch_id='restore-v2'").run();

    db.prepare(`
      insert into v2_restore_files (
        restore_batch_id,user_id,file_id,ordinal,kind,path,source_object_key,byte_length,
        expected_sha256,expected_records,status,next_byte_offset,next_record,verified_at
      ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run("restore-v2", "user-a", "table-1", 0, "table", "tables/v2_objects.ndjson", "restore/staged.zip", 120, hash, 1, "verified", 120, 1, "2026-08-28T00:01:00.000Z");
    expect(() => db.prepare("update v2_restore_batches set status='succeeded' where id='restore-v2'").run()).toThrow(/restore_files_not_fully_consumed/);

    db.prepare("update v2_restore_files set status='consumed',consumed_at='2026-08-28T00:02:00.000Z' where restore_batch_id='restore-v2'").run();
    db.prepare("update v2_restore_batches set status='succeeded',finished_at='2026-08-28T00:02:00.000Z' where id='restore-v2'").run();
    expect(db.prepare("select status from v2_restore_batches where id='restore-v2'").get()).toEqual({ status: "succeeded" });
  });

  test("requires conflict-free owned-row rollback while preserving rollback_conflicted", () => {
    insertBatch({ id: "rollback-v2", planned: 1, applied: 1, planHash: hash });
    insertPlannedRow("rollback-v2", { applyStatus: "applied", rollbackStatus: "pending" });

    expect(() => db.prepare("update v2_restore_batches set status='rolled_back' where id='rollback-v2'").run()).toThrow(/restore_owned_rows_not_rolled_back/);
    db.prepare("update v2_restore_rows set rollback_status='rolled_back',observed_row_hash=? where restore_batch_id='rollback-v2'").run(hash);
    db.prepare("update v2_restore_batches set rollback_conflict_count=1,status='rollback_conflicted' where id='rollback-v2'").run();
    expect(db.prepare("select status,rollback_conflict_count from v2_restore_batches where id='rollback-v2'").get()).toEqual({ status: "rollback_conflicted", rollback_conflict_count: 1 });
    expect(() => db.prepare("update v2_restore_batches set status='rolled_back' where id='rollback-v2'").run()).toThrow(/restore_rollback_conflicts_present/);

    db.prepare("update v2_restore_batches set rollback_conflict_count=0,status='rolled_back',rolled_back_at='2026-08-28T00:03:00.000Z' where id='rollback-v2'").run();
    expect(db.prepare("select status from v2_restore_batches where id='rollback-v2'").get()).toEqual({ status: "rolled_back" });
  });

  test("keeps staged files and id mappings within their restore owner", () => {
    insertBatch({ id: "owner-v2" });
    expect(() => db.prepare("insert into v2_restore_files (restore_batch_id,user_id,file_id,ordinal,kind,path,source_object_key,byte_length) values (?,?,?,?,?,?,?,?)")
      .run("owner-v2", "user-b", "file-1", 0, "table", "tables/a.ndjson", "restore/a.zip", 1)).toThrow(/restore_file_user_mismatch/);
    expect(() => db.prepare("insert into v2_restore_id_mappings (restore_batch_id,user_id,table_name,source_id,target_id,disposition,created_at) values (?,?,?,?,?,?,?)")
      .run("owner-v2", "user-b", "v2_objects", "source-1", "target-1", "forked", "2026-08-28T00:00:00.000Z")).toThrow(/restore_id_mapping_user_mismatch/);

    db.prepare("insert into v2_restore_id_mappings (restore_batch_id,user_id,table_name,source_id,target_id,disposition,created_at) values (?,?,?,?,?,?,?)")
      .run("owner-v2", "user-a", "v2_objects", "source-1", "target-1", "forked", "2026-08-28T00:00:00.000Z");
    expect(db.prepare("select table_name,source_id,target_id from v2_restore_id_mappings where restore_batch_id='owner-v2'").get()).toEqual({ table_name: "v2_objects", source_id: "source-1", target_id: "target-1" });
  });

  test("applies cleanly after the complete v2 migration chain", async () => {
    const full = new DatabaseSync(":memory:");
    try {
      full.exec("pragma foreign_keys=on; create table users (id text primary key not null);");
      for (const name of v2MigrationNames) {
        const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
        const sql = await readFile(path, "utf8");
        for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) full.exec(statement);
      }
      expect(full.prepare("select count(*) as value from pragma_table_info('v2_restore_batches') where name='workflow_version'").get()).toEqual({ value: 1 });
      expect(full.prepare("select count(*) as value from sqlite_master where type='table' and name in ('v2_restore_files','v2_restore_id_mappings')").get()).toEqual({ value: 2 });
    } finally {
      full.close();
    }
  });
});
