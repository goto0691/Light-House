import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { LEGACY_ADAPTER_BY_TABLE, validateAdapterCoverage } from "@/lib/v2/migration/legacy-adapters-v1";

const files = ["0000_graceful_trish_tilby.sql", "0001_notifications.sql", "0004_ui_state_tables.sql", "0005_import_and_backup_tables.sql"].map((name) => fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url)));

const liveSchemaAdditions: Readonly<Record<string, readonly string[]>> = {
  zettels: ["notion_source_id","import_batch_id","source_document_id","status","document_kind","original_created_at","aliases","source_reliability","review_cadence","review_due_at"],
  media_logs: ["notion_source_id","import_batch_id","source_document_id","subtype","relation_note","logged_at"],
  daily_logs: ["notion_source_id","import_batch_id","source_document_id"],
  workouts: ["notion_source_id","import_batch_id","source_document_id","title"],
  projects: ["notion_source_id","import_batch_id","source_document_id","importance","brain_energy","artifact_url"],
  tasks: ["notion_source_id","import_batch_id"],
  career_history: ["notion_source_id","import_batch_id","source_document_id"],
  gifts: ["notion_source_id","import_batch_id"],
  people: ["notion_source_id","import_batch_id","source_document_id","aliases","birthday_memo","profile_body"],
  task_people_relations: ["source_document_id","confidence","raw_value"],
  task_zettel_relations: ["source_document_id","confidence","raw_value"],
  audit_logs: ["import_batch_id"],
  media_people_relations: ["source_document_id","confidence","raw_value"],
  zettel_media_relations: ["source_document_id","confidence","raw_value"],
  zettel_people_relations: ["source_document_id","confidence","raw_value"],
  source_documents: ["id","user_id","source_type","source_id","import_batch_id","source_database","title","document_role","canonical_entity_type","canonical_entity_id","status","url","raw_properties","raw_content_preview","resolved_at","created_at","updated_at","deleted_at","source_path","raw_content","raw_content_hash"],
  media_records: ["id","user_id","media_id","recorded_at","record_kind","status_at_time","progress_text","duration_minutes","rating","note","import_receipt_id","created_at","updated_at","deleted_at"],
  daily_log_entries: ["id","user_id","daily_log_id","source_document_id","kind","title","date","body","emotion","event_summary","verse","background","tags_snapshot","created_at","updated_at","deleted_at"],
  collection_views: ["id","user_id","collection_key","name","slug","layout","density","filter_json","sort_json","group_json","search_query","is_default","is_system","display_order","created_at","updated_at","deleted_at"],
  daily_entry_people_relations: ["daily_entry_id","person_id","context","source_document_id","confidence","raw_value","created_at"],
  daily_log_people_relations: ["daily_log_id","person_id","context","created_at","source_document_id","confidence","raw_value"],
  entity_links: ["id","user_id","source_type","source_id","target_type","target_id","relation_type","context","source_document_id","confidence","raw_value","created_at"],
  entity_property_values: ["id","property_id","entity_type","entity_id","value_text","value_number","value_date","value_json","value_bool","created_at","updated_at","deleted_at"],
  entity_relations: ["id","user_id","from_type","from_id","to_type","to_id","relation_type","context","strength","privacy_level","import_receipt_id","created_at","updated_at","deleted_at"],
  import_batches: ["id","user_id","kind","status","label","input_summary_json","result_summary_json","started_at","finished_at","created_at","updated_at","deleted_at"],
  import_receipts: ["id","user_id","batch_id","native_entity_type","native_entity_id","input_kind","input_title","input_path_hash","input_database_hint","raw_properties_json","raw_body_hash","decision","decision_reason","created_at"],
  migration_review_items: ["id","user_id","source_document_id","entity_type","entity_id","issue_type","suggested_action","confidence","status","reason","payload","resolved_at","created_at","updated_at","deleted_at"],
  project_people_relations: ["project_id","person_id","role_context","source_document_id","confidence","raw_value","created_at"],
  project_zettel_relations: ["project_id","zettel_id","context","source_document_id","confidence","raw_value","created_at"],
  property_definitions: ["id","user_id","collection_key","key","label","type","description","default_hidden","is_archived","display_order","created_at","updated_at","deleted_at"],
  property_options: ["id","property_id","label","value","color","display_order","is_archived","created_at","updated_at","deleted_at"],
  source_document_properties: ["id","source_document_id","property_key","property_name","property_type","value_text","value_json","normalized_value","created_at"],
  source_document_relations: ["id","source_document_id","relation_name","target_source_id","target_title","resolved_entity_type","resolved_entity_id","confidence","created_at"],
  source_property_mappings: ["id","user_id","source_database","canonical_entity_type","property_name","property_type","status","target_field","display_label","reason","confidence","created_at","updated_at","deleted_at"],
  view_columns: ["id","view_id","field_key","field_source","label_override","is_visible","width","display_order","pin","created_at","updated_at","deleted_at"],
};

async function legacySchema() {
  const sql = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  const tables = new Map<string, string[]>();
  for (const match of sql.matchAll(/create table(?: if not exists)?\s+`?([a-z_][a-z0-9_]*)`?\s*\(([\s\S]*?)\);/gi)) {
    const columns = [...match[2].matchAll(/^\s*`?([a-z_][a-z0-9_]*)`?\s+(?:text|integer|real)\b/gim)].map((item) => item[1]);
    tables.set(match[1], columns);
  }
  return tables;
}

describe("I7 legacy adapter schema coverage", () => {
  test("covers every known legacy data table and every column except auth state", async () => {
    const schema = await legacySchema();
    expect([...schema.keys()].sort()).toHaveLength(38);
    const excluded = new Set(["users", "sessions"]);
    const expected = [...schema.keys()].filter((table) => !excluded.has(table)).sort();
    expect([...LEGACY_ADAPTER_BY_TABLE.keys()].filter((table) => schema.has(table)).sort()).toEqual(expected);
    for (const table of expected) expect(validateAdapterCoverage(LEGACY_ADAPTER_BY_TABLE.get(table)!, schema.get(table)!)).toMatchObject({ valid: true, missing: [] });
  });

  test("covers the 2026-08-13 live legacy schema extensions without treating FTS shadows as source data", async () => {
    const schema = await legacySchema();
    for (const [table, additions] of Object.entries(liveSchemaAdditions)) {
      const adapter = LEGACY_ADAPTER_BY_TABLE.get(table);
      expect(adapter, `missing live adapter for ${table}`).toBeDefined();
      const columns = [...new Set([...(schema.get(table) ?? []), ...additions])];
      expect(validateAdapterCoverage(adapter!, columns), table).toMatchObject({ valid: true, missing: [] });
    }
    expect([...LEGACY_ADAPTER_BY_TABLE.keys()]).toHaveLength(56);
  });

  test("declares parent-scoped and composite identities without dynamic SQL input", () => {
    expect(LEGACY_ADAPTER_BY_TABLE.get("place_visits")).toMatchObject({ scopeUserColumn: "scope_parent.user_id" });
    expect(LEGACY_ADAPTER_BY_TABLE.get("task_people_relations")).toMatchObject({ identityColumns: ["task_id", "person_id"], scopeUserColumn: "scope_parent.user_id" });
    expect(LEGACY_ADAPTER_BY_TABLE.get("daily_log_people_relations")).toMatchObject({ identityColumns: ["rowid"], scopeUserColumn: "scope_parent.user_id" });
  });
});
