import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { canonicalTablesForSchemaVersion, fullFidelityCanonicalScope } from "@/lib/v2/portability/canonical-table-registry-v1";
import { LIGHTHOUSE_SCHEMA_VERSION, type ExportScopeV1 } from "@/lib/v2/portability/portability-contract-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown> };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationNames = [
  "0006_v2_source_and_document_foundation.sql", "0007_v2_document_authoring.sql", "0008_v2_ai_processing.sql", "0009_v2_grounded_enrichment.sql",
  "0010_v2_ai_runtime_governor.sql", "0011_v2_adaptive_knowledge.sql", "0012_v2_review_actions.sql", "0013_v2_entities_relations_and_presentation.sql",
  "0014_v2_retrieval_and_saved_views.sql", "0015_v2_adaptive_capture_templates.sql", "0016_v2_opt_in_rediscovery.sql", "0017_v2_portability_restore_and_legacy_migration.sql",
  "0018_v2_legacy_migration_hardening.sql", "0019_v2_resumable_restore_hardening.sql", "0020_v2_resumable_legacy_preservation_gate.sql", "0021_v2_resumable_backup_creation.sql",
  "0022_v2_resumable_export_packaging.sql", "0023_v2_resumable_backup_retention.sql",
] as const;
const upgradeMigrationNames = [
  "0024_v2_resumable_restore_uploads.sql", "0025_v2_workflow_lease_fencing.sql", "0026_v2_legacy_terminal_reconciliation_guard.sql",
  "0027_v2_legacy_migration_quarantine.sql", "0028_v2_fts_source_owner_fence.sql", "0029_v2_provider_invocation_lease.sql",
  "0030_v2_object_backup_change_events.sql", "0031_v2_link_snapshot_foundation.sql", "0032_v2_prompt_curations.sql",
] as const;

let platform: Platform;
let ownObjectId: string;
let foreignObjectId: string;

async function applyMigrations(names: readonly string[]) {
  for (const name of names) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await platform.env.DB.prepare(statement).run();
    }
  }
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  await platform.env.DB.exec("create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');");
  await applyMigrations(migrationNames);
  const capture = await prepareCaptureCommit({
    draftId: "canonical-query-owner-closure",
    channel: "web",
    title: "정상 기록",
    bodyMarkdown: "정상 소유자 그래프",
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel: "normal",
    capturedAt: "2026-08-29T00:00:00.000Z",
  }, "canonical-query-owner-closure", "2026-08-29T00:00:01.000Z");
  await new D1SourceFoundationRepository(platform.env.DB, "user-a").commitCapture(capture);
  const foreignCapture = await prepareCaptureCommit({
    draftId: "canonical-query-owner-closure-foreign",
    channel: "web",
    title: "Foreign record",
    bodyMarkdown: "foreign owner graph",
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel: "normal",
    capturedAt: "2026-08-29T00:00:00.000Z",
  }, "canonical-query-owner-closure-foreign", "2026-08-29T00:00:01.000Z");
  await new D1SourceFoundationRepository(platform.env.DB, "user-b").commitCapture(foreignCapture);
  ownObjectId = capture.objectId;
  foreignObjectId = foreignCapture.objectId;

  await platform.env.DB.batch([
    platform.env.DB.prepare(`insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at) values (?,'person','Foreign entity','resolved','2026-08-29T00:01:00.000Z')`).bind(foreignObjectId),
    platform.env.DB.prepare(`insert into v2_review_items (id,user_id,object_id,kind,status,payload_json,created_at) values ('review-valid','user-a',?,'analysis_review','resolved','{}','2026-08-29T00:01:00.000Z')`).bind(ownObjectId),
    platform.env.DB.prepare(`insert into v2_review_items (id,user_id,object_id,kind,status,payload_json,created_at) values ('review-foreign-target','user-a',?,'analysis_review','resolved','{}','2026-08-29T00:01:00.000Z')`).bind(ownObjectId),
    platform.env.DB.prepare(`insert into v2_review_receipts (id,review_item_id,user_id,object_id,action,target_kind,target_id,result_status,created_at) values ('receipt-valid','review-valid','user-a',?,'dismiss','review_item',null,'dismissed','2026-08-29T00:02:00.000Z')`).bind(ownObjectId),
    platform.env.DB.prepare(`insert into v2_review_receipts (id,review_item_id,user_id,object_id,action,target_kind,target_id,result_status,created_at) values ('receipt-foreign-target','review-foreign-target','user-a',?,'accept','entity',?,'accepted','2026-08-29T00:02:00.000Z')`).bind(ownObjectId, foreignObjectId),
  ]);
  await platform.env.DB.batch([
    platform.env.DB.prepare(`insert into v2_document_revisions (id,document_object_id,parent_revision_id,body_markdown,content_hash,author_kind,change_reason,created_at) values ('owner-current-revision-v2',?,?, 'current body','hash-owner-current-v2','user','edit','2026-08-29T00:02:30.000Z')`).bind(ownObjectId, capture.revisionId),
    platform.env.DB.prepare(`update v2_documents set body_markdown='current body',current_revision_id='owner-current-revision-v2',current_version=2,analyzed_revision_id=? where object_id=?`).bind(capture.revisionId, ownObjectId),
  ]);

  const envelopeSql = `insert into v2_legacy_source_envelopes (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id) values (?,?,?,?,?,?,?,?,?,?)`;
  const mappingSql = `insert into v2_legacy_source_mappings (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,created_at,superseded_by_mapping_id,activation_batch_id) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const batchSql = `insert into v2_legacy_migration_batches (id,user_id,legacy_table,adapter_version,mode,dry_run_hash,schema_snapshot,manifest_json,input_rows,expected_mapping_count,next_offset,status,reconciliation_status,summary_json,created_at,approved_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  await platform.env.DB.batch([
    platform.env.DB.prepare(envelopeSql).bind("legacy-envelope-valid", "user-a", "notes", "valid", "{}", "hash-valid", "2026-08-29T00:03:00.000Z", "legacy-v1", "[]", "import-a"),
    platform.env.DB.prepare(envelopeSql).bind("legacy-envelope-predecessor", "user-a", "notes", "predecessor", "{}", "hash-predecessor", "2026-08-29T00:03:00.000Z", "legacy-v1", "[]", "import-a"),
    platform.env.DB.prepare(envelopeSql).bind("legacy-envelope-invalid-successor", "user-a", "notes", "invalid-successor", "{}", "hash-invalid-successor", "2026-08-29T00:03:00.000Z", "legacy-v1", "[]", "import-a"),
    platform.env.DB.prepare(envelopeSql).bind("legacy-envelope-invalid-activation", "user-a", "notes", "invalid-activation", "{}", "hash-invalid-activation", "2026-08-29T00:03:00.000Z", "legacy-v1", "[]", "import-a"),
    platform.env.DB.prepare(envelopeSql).bind("legacy-envelope-foreign", "user-b", "notes", "foreign", "{}", "hash-foreign", "2026-08-29T00:03:00.000Z", "legacy-v1", "[]", "import-b"),
    platform.env.DB.prepare(batchSql).bind("legacy-batch-valid", "user-a", "notes", "adapter-v1", "knowledge", "dry-valid", "legacy-v1", "{}", 1, 1, 0, "approved", "pending", "{}", "2026-08-29T00:03:00.000Z", "2026-08-29T00:03:00.000Z"),
    platform.env.DB.prepare(batchSql).bind("legacy-batch-foreign", "user-b", "notes", "adapter-v1", "knowledge", "dry-foreign", "legacy-v1", "{}", 1, 1, 0, "approved", "pending", "{}", "2026-08-29T00:03:00.000Z", "2026-08-29T00:03:00.000Z"),
  ]);
  await platform.env.DB.batch([
    platform.env.DB.prepare(`insert into v2_legacy_migration_batch_items (batch_id,user_id,position,legacy_envelope_id,legacy_id,row_hash,expected_mapping_count,status) values ('legacy-batch-valid','user-a',0,'legacy-envelope-valid','valid','hash-valid',1,'pending')`),
    platform.env.DB.prepare(`insert into v2_legacy_migration_batch_items (batch_id,user_id,position,legacy_envelope_id,legacy_id,row_hash,expected_mapping_count,status) values ('legacy-batch-foreign','user-a',0,'legacy-envelope-foreign','foreign','hash-foreign',1,'pending')`),
    platform.env.DB.prepare(mappingSql).bind("legacy-mapping-valid", "user-a", "legacy-envelope-valid", "notes", "valid", "adapter-v1", capture.sources[0]!.id, ownObjectId, "document", "projected", "2026-08-29T00:04:00.000Z", null, "legacy-batch-valid"),
    platform.env.DB.prepare(mappingSql).bind("legacy-mapping-predecessor", "user-a", "legacy-envelope-predecessor", "notes", "predecessor", "adapter-v1", capture.sources[0]!.id, null, "document", "superseded", "2026-08-29T00:04:00.000Z", "legacy-mapping-invalid-successor", null),
    platform.env.DB.prepare(mappingSql).bind("legacy-mapping-invalid-successor", "user-a", "legacy-envelope-invalid-successor", "notes", "invalid-successor", "adapter-v1", foreignCapture.sources[0]!.id, foreignObjectId, "document", "projected", "2026-08-29T00:04:00.000Z", null, null),
    platform.env.DB.prepare(mappingSql).bind("legacy-mapping-invalid-activation", "user-a", "legacy-envelope-invalid-activation", "notes", "invalid-activation", "adapter-v1", capture.sources[0]!.id, ownObjectId, "document", "projected", "2026-08-29T00:04:00.000Z", null, "legacy-batch-foreign"),
    platform.env.DB.prepare(mappingSql).bind("legacy-mapping-foreign-envelope", "user-a", "legacy-envelope-foreign", "notes", "foreign-envelope", "adapter-v1", capture.sources[0]!.id, ownObjectId, "document", "projected", "2026-08-29T00:04:00.000Z", null, null),
  ]);
  // Seed historical corrupt ownership edges under their original schema, then
  // apply every later migration. Query exclusion must work on upgraded data;
  // dropping current guards or making these adversarial rows valid would not
  // exercise the original regression.
  await applyMigrations(upgradeMigrationNames);
}, 30_000);

afterAll(async () => platform.dispose());

describe("canonical export query owner closure", () => {
  async function assertCanonicalClosure(scope: ExportScopeV1, label: string) {
    const descriptors = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION);
    const rowsByTable = new Map<string, Record<string, unknown>[]>();
    for (const descriptor of descriptors) {
      const scoped = descriptor.query("user-a", scope);
      expect(scoped.bindings, `${label}: ${descriptor.table} binding count`).toHaveLength((scoped.sql.match(/\?/g) ?? []).length);
      try {
        const rows = await platform.env.DB.prepare(`select * from (${scoped.sql}) as scoped`).bind(...scoped.bindings).all<Record<string, unknown>>();
        rowsByTable.set(descriptor.table, rows.results);
      } catch (error) {
        throw new Error(`${label}: ${descriptor.table}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const ids = new Map(descriptors.map((descriptor) => [
      descriptor.table,
      new Set((rowsByTable.get(descriptor.table) ?? []).map((row) => String(row[descriptor.primaryKey[0]!]))),
    ]));
    for (const descriptor of descriptors) {
      for (const row of rowsByTable.get(descriptor.table) ?? []) {
        for (const [column, targetTable] of Object.entries(descriptor.foreignKeys ?? {})) {
          const value = row[column];
          if (typeof value === "string") expect(ids.get(targetTable), `${label}: ${descriptor.table}.${column} -> ${targetTable}`).toContain(value);
        }
      }
    }

    const softReferences = {
      v2_capture_bundles: { template_version_id: "v2_capture_template_versions" },
      v2_capture_templates: { current_version_id: "v2_capture_template_versions" },
      v2_document_source_links: { extraction_run_id: "v2_processing_runs" },
    } as const;
    for (const [table, references] of Object.entries(softReferences)) {
      for (const row of rowsByTable.get(table) ?? []) {
        for (const [column, targetTable] of Object.entries(references)) {
          const value = row[column];
          if (typeof value === "string") expect(ids.get(targetTable), `${label}: ${table}.${column} -> ${targetTable}`).toContain(value);
        }
      }
    }

    const polymorphicTargets: Record<string, string> = {
      type_assignment: "v2_object_type_assignments", property_value: "v2_property_values", entity: "v2_entity_records",
      event: "v2_event_records", relation: "v2_relation_edges", review_item: "v2_review_items",
    };
    for (const table of ["v2_evidence_refs", "v2_review_receipts"] as const) {
      for (const row of rowsByTable.get(table) ?? []) {
        if (typeof row.target_id !== "string") continue;
        const targetTable = polymorphicTargets[String(row.target_kind)];
        expect(targetTable, `${label}: ${table}.target_kind`).toBeTruthy();
        expect(ids.get(targetTable!), `${label}: ${table}.target_id -> ${targetTable}`).toContain(row.target_id);
      }
    }
    return rowsByTable;
  }

  test("keeps plain and full-fidelity descriptors binding-complete, executable, and referentially closed", async () => {
    await expect(platform.env.DB.prepare(`select id from v2_legacy_source_mappings order by id`).all()).resolves.toMatchObject({ results: [
      { id: "legacy-mapping-foreign-envelope" }, { id: "legacy-mapping-invalid-activation" }, { id: "legacy-mapping-invalid-successor" },
      { id: "legacy-mapping-predecessor" }, { id: "legacy-mapping-valid" },
    ] });
    await expect(platform.env.DB.prepare(`select id from v2_review_receipts order by id`).all()).resolves.toMatchObject({ results: [
      { id: "receipt-foreign-target" }, { id: "receipt-valid" },
    ] });
    const scope: ExportScopeV1 = { objects: "all", privacyLevels: ["normal"], includeTrash: false, includeHistory: true, includeOriginals: true };
    const portable = await assertCanonicalClosure(scope, "plain");
    const fullFidelity = await assertCanonicalClosure(fullFidelityCanonicalScope(scope), "full-fidelity");
    const withoutHistory = await assertCanonicalClosure({ ...scope, includeHistory: false }, "plain-no-history");

    expect(portable.get("v2_review_receipts")?.map((row) => row.id)).toEqual(["receipt-valid"]);
    expect(fullFidelity.get("v2_review_receipts")?.map((row) => row.id)).toEqual(["receipt-valid"]);
    expect(fullFidelity.get("v2_legacy_source_mappings")?.map((row) => row.id)).toEqual(["legacy-mapping-valid"]);
    expect(fullFidelity.get("v2_legacy_migration_batch_items")?.some((row) => row.user_id === "user-a" && row.batch_id === "legacy-batch-foreign")).toBe(false);
    expect(withoutHistory.get("v2_documents")?.find((row) => row.object_id === ownObjectId)?.analyzed_revision_id).toBeNull();
    expect(withoutHistory.get("v2_document_revisions")?.find((row) => row.id === "owner-current-revision-v2")?.parent_revision_id).toBeNull();
  }, 60_000);
});
