import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { RESTORE_TABLE_ORDER_V2 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, LIGHTHOUSE_SCHEMA_VERSION, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { advanceRestoreWorkflow } from "@/lib/v2/portability/resumable-restore-v2";

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
];

async function apply(db: TestD1) {
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a');`);
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

let platform: Platform;

beforeAll(async () => {
  platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await apply(platform.env.DB);
}, 60_000);

afterAll(async () => { await platform.dispose(); });

describe("resumable restore self-reference planning", () => {
  test("finds a resolvable parent even when more than eight children sort first", async () => {
    const now = "2026-08-28T16:00:00.000Z";
    const summary = {
      sourceKind: "archive",
      counts: { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 },
      tables: RESTORE_TABLE_ORDER_V2.map((descriptor) => ({ table: descriptor.table, rows: 0, create: 0, reuse: 0, fork: 0, conflict: 0 })),
      warnings: [], indexedFiles: 0, verifiedFiles: 0, materializedRows: 10, rollbackPreserved: 0,
    };
    await platform.env.DB.prepare(`insert into v2_restore_batches
      (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_size_bytes,cursor_json,state_revision,last_progress_at)
      values ('self-ref-plan','user-a','self-ref-plan','pending','pending','pending','planning',?,'{}',?,2,'archive',0,'{}',0,?)`)
      .bind(canonicalJson(summary), now, now).run();

    const rows = [
      ...Array.from({ length: 9 }, (_, index) => ({ id: `child-${index}`, canonical_object_id: "root", position: index + 1 })),
      { id: "root", canonical_object_id: null, position: 100 },
    ];
    for (const row of rows) {
      const source = {
        id: row.id,
        user_id: "export-owner",
        object_kind: "entity",
        lifecycle_status: "active",
        canonical_object_id: row.canonical_object_id,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        schema_version: LIGHTHOUSE_SCHEMA_VERSION,
        user_scope_export_id: "self-ref-export",
      };
      const sourceValue = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "schema_version" && key !== "user_scope_export_id"));
      await platform.env.DB.prepare(`insert into v2_restore_rows
        (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,source_row_json,candidate_row_json,plan_position,apply_status,rollback_status,r2_status,updated_at)
        values ('self-ref-plan','v2_objects',?,?,'pending','{}',?,?,'{}',?,'pending','not_applicable','not_applicable',?)`)
        .bind(canonicalJson({ id: row.id }), sha256Hex(canonicalJson(sourceValue)), now, canonicalJson(source), row.position, now).run();
    }

    await expect(advanceRestoreWorkflow({
      db: platform.env.DB,
      bucket: platform.env.ARCHIVE_ASSETS,
      userId: "user-a",
      batchId: "self-ref-plan",
      now: "2026-08-28T16:01:00.000Z",
    })).resolves.toMatchObject({ status: "planning", progress: { rowsPlanned: 1 } });
    await expect(platform.env.DB.prepare(`select source_id,target_id from v2_restore_id_mappings where restore_batch_id='self-ref-plan' and table_name='v2_objects'`).first())
      .resolves.toEqual({ source_id: "root", target_id: "root" });
    await expect(platform.env.DB.prepare(`select apply_status from v2_restore_rows where restore_batch_id='self-ref-plan' and table_name='v2_objects' and row_key=?`).bind(canonicalJson({ id: "root" })).first())
      .resolves.toEqual({ apply_status: "provisional" });
  });
});
