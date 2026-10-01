import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const priorMigrationNames = [
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
] as const;

const migrationPath = fileURLToPath(new URL("../../../../../migrations/0020_v2_resumable_legacy_preservation_gate.sql", import.meta.url));

function applySql(db: DatabaseSync, path: string) {
  for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys=on; create table users (id text primary key not null); insert into users values ('user-a')");
  for (const name of priorMigrationNames) applySql(db, fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url)));
});

afterEach(() => db.close());

describe("resumable legacy preservation schema", () => {
  test("backfills normalized projection receipts for pre-0020 batch items", () => {
    const rowHash = "a".repeat(64);
    const projectionHash = "b".repeat(64);
    const dryRunHash = "c".repeat(64);
    const projections = [{ key: "review", lifecycleStatus: "active" }];
    const manifest = [{ legacyId: "legacy-1", rowHash, projectionHash, projections, expectedMappingCount: 1 }];
    db.prepare("insert into v2_legacy_source_envelopes (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id) values (?,?,?,?,?,?,?,?,?,?)")
      .run("envelope-1", "user-a", "quick_captures", "legacy-1", "{}", rowHash, "2026-08-28T00:00:00.000Z", "legacy-schema:test", "[]", "source-batch");
    db.prepare("insert into v2_legacy_migration_batches (id,user_id,legacy_table,adapter_version,mode,dry_run_hash,schema_snapshot,manifest_json,input_rows,expected_mapping_count,next_offset,status,reconciliation_status,summary_json,created_at,approved_at) values (?,?,?,?,?,?,?,?,?,?,0,'approved','pending','{}',?,?)")
      .run("source-batch", "user-a", "quick_captures", "quick_captures_v1", "source_only", dryRunHash, "legacy-schema:test", JSON.stringify(manifest), 1, 1, "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z");
    db.prepare("insert into v2_legacy_migration_batch_items (batch_id,user_id,position,legacy_envelope_id,legacy_id,row_hash,expected_mapping_count,status) values (?,?,?,?,?,?,1,'succeeded')")
      .run("source-batch", "user-a", 0, "envelope-1", "legacy-1", rowHash);

    applySql(db, migrationPath);

    expect(db.prepare("select projection_hash,projections_json from v2_legacy_migration_batch_items where batch_id='source-batch'").get()).toEqual({
      projection_hash: projectionHash,
      projections_json: JSON.stringify(projections),
    });
  });

  test("guards a passed gate until every persisted table and row cursor is complete", () => {
    applySql(db, migrationPath);
    const hash = "d".repeat(64);
    const required = JSON.stringify([{ table: "quick_captures", adapterVersion: "quick_captures_v1", schemaSnapshot: "legacy-schema:test", dryRunHash: hash, sourceBatchId: "source-batch", inputRows: 1 }]);
    db.prepare("insert into v2_legacy_preservation_gates (id,user_id,target_batch_id,target_table,target_adapter_version,target_dry_run_hash,basis_hash,required_tables_json,created_at,last_progress_at) values (?,?,?,?,?,?,?,?,?,?)")
      .run("gate-1", "user-a", "knowledge-batch", "quick_captures", "quick_captures_v1", hash, "e".repeat(64), required, "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z");

    expect(() => db.exec("update v2_legacy_preservation_gates set status='passed' where id='gate-1'")).toThrow(/legacy_preservation_gate_incomplete/);
    db.exec("update v2_legacy_preservation_gates set next_table_position=1,next_row_offset=0,checked_rows=1,status='passed',finished_at='2026-08-28T00:01:00.000Z' where id='gate-1'");
    expect(db.prepare("select status,next_table_position,next_row_offset,checked_rows from v2_legacy_preservation_gates where id='gate-1'").get()).toEqual({ status: "passed", next_table_position: 1, next_row_offset: 0, checked_rows: 1 });
  });
});
