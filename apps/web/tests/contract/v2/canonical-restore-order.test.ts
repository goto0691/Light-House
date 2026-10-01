import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  CANONICAL_TABLES_V1,
  RESTORE_SELF_REFERENCES_V2,
  RESTORE_TABLE_ORDER_V2,
} from "@/lib/v2/portability/canonical-table-registry-v1";

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
  "0031_v2_link_snapshot_foundation.sql",
  "0032_v2_prompt_curations.sql",
] as const;

type ForeignKeyRow = Readonly<{
  table: string;
  from: string;
}>;

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys=on; create table users (id text primary key not null);");
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    const statements = readFileSync(path, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) db.exec(statement);
  }
});

afterAll(() => db.close());

describe("canonical restore dependency order", () => {
  test("covers every canonical D1 foreign key with the real target table", () => {
    const canonicalNames = new Set(CANONICAL_TABLES_V1.map((descriptor) => descriptor.table));
    for (const descriptor of CANONICAL_TABLES_V1) {
      const columns = new Set((db.prepare(`pragma table_info('${descriptor.table}')`).all() as { name: string }[]).map((column) => column.name));
      expect(columns.size, `${descriptor.table} must exist in the applied schema`).toBeGreaterThan(0);
      for (const column of Object.keys(descriptor.foreignKeys ?? {})) {
        expect(columns.has(column), `${descriptor.table}.${column} must be a real column`).toBe(true);
      }
      const actual = db.prepare(`pragma foreign_key_list('${descriptor.table}')`).all() as unknown as ForeignKeyRow[];
      for (const foreignKey of actual.filter((item) => canonicalNames.has(item.table))) {
        expect(
          descriptor.foreignKeys?.[foreignKey.from],
          `${descriptor.table}.${foreignKey.from} must match its D1 foreign key target`,
        ).toBe(foreignKey.table);
      }
    }
  });

  test("orders every non-self dependency before its dependent table", () => {
    const orderedNames = RESTORE_TABLE_ORDER_V2.map((descriptor) => descriptor.table);
    expect(orderedNames).toHaveLength(CANONICAL_TABLES_V1.length);
    expect(new Set(orderedNames).size).toBe(CANONICAL_TABLES_V1.length);
    expect(new Set(orderedNames)).toEqual(new Set(CANONICAL_TABLES_V1.map((descriptor) => descriptor.table)));

    const position = new Map(orderedNames.map((table, index) => [table, index]));
    for (const descriptor of CANONICAL_TABLES_V1) {
      for (const targetTable of [...Object.values(descriptor.foreignKeys ?? {}), ...(descriptor.restoreDependencies ?? [])]) {
        if (targetTable === descriptor.table) continue;
        expect(
          position.get(targetTable),
          `${targetTable} must be restored before ${descriptor.table}`,
        ).toBeLessThan(position.get(descriptor.table)!);
      }
    }
  });

  test("exposes self references separately instead of treating them as table cycles", () => {
    expect(RESTORE_SELF_REFERENCES_V2).toEqual([
      { table: "v2_capture_template_versions", column: "previous_version_id" },
      { table: "v2_document_revisions", column: "parent_revision_id" },
      { table: "v2_legacy_source_mappings", column: "superseded_by_mapping_id" },
      { table: "v2_link_curation_revisions", column: "based_on_revision_id" },
      { table: "v2_link_curation_revisions", column: "parent_revision_id" },
      { table: "v2_link_snapshots", column: "parent_snapshot_id" },
      { table: "v2_objects", column: "canonical_object_id" },
      { table: "v2_processing_jobs", column: "dependency_job_id" },
      { table: "v2_property_values", column: "supersedes_value_id" },
    ]);

    const actualSelfReferences = CANONICAL_TABLES_V1.flatMap((descriptor) =>
      (db.prepare(`pragma foreign_key_list('${descriptor.table}')`).all() as unknown as ForeignKeyRow[])
        .filter((foreignKey) => foreignKey.table === descriptor.table)
        .map((foreignKey) => `${descriptor.table}.${foreignKey.from}`),
    ).sort();
    expect(actualSelfReferences).toEqual([
      "v2_capture_template_versions.previous_version_id",
      "v2_link_curation_revisions.based_on_revision_id",
      "v2_link_curation_revisions.parent_revision_id",
      "v2_link_snapshots.parent_snapshot_id",
      "v2_property_values.supersedes_value_id",
    ]);
  });
});
