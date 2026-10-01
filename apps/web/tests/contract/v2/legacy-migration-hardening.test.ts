import { readFile } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prepareCaptureCommit, prepareLegacyCaptureCommit } from "@/lib/v2/domain/capture-source";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LEGACY_ADAPTER_BY_TABLE } from "@/lib/v2/migration/legacy-adapters-v1";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";
import { CANONICAL_TABLE_BY_NAME, fullFidelityCanonicalScope } from "@/lib/v2/portability/canonical-table-registry-v1";

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
  "0026_v2_legacy_terminal_reconciliation_guard.sql",
  "0027_v2_legacy_migration_quarantine.sql",
  "0029_v2_provider_invocation_lease.sql",
] as const;

class SqliteD1Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];

  constructor(private readonly owner: SqliteD1, private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }

  async first<T = Record<string, unknown>>() {
    this.owner.queryCount += 1;
    return (this.statement.get(...this.values) ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>() {
    this.owner.queryCount += 1;
    return { results: this.statement.all(...this.values) as T[] };
  }

  async run() {
    this.owner.queryCount += 1;
    return this.statement.run(...this.values);
  }
}

class SqliteD1 implements D1DatabaseBinding {
  readonly sqlite = new DatabaseSync(":memory:");
  queryCount = 0;
  beforeBatch: ((statements: D1PreparedStatementBinding[]) => void) | null = null;

  constructor() {
    this.sqlite.exec("pragma foreign_keys=on");
  }

  prepare(query: string) {
    return new SqliteD1Statement(this, this.sqlite.prepare(query));
  }

  async batch<T = unknown>(statements: D1PreparedStatementBinding[]) {
    this.beforeBatch?.(statements);
    this.sqlite.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("commit");
      return results as T[];
    } catch (error) {
      this.sqlite.exec("rollback");
      throw error;
    }
  }

  exec(sql: string) {
    this.sqlite.exec(sql);
  }

  close() {
    this.sqlite.close();
  }
}

async function applyMigrations(db: SqliteD1) {
  db.exec("create table users (id text primary key not null); insert into users (id) values ('user-a');");
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    const sql = await readFile(path, "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
}

async function runToComplete(input: {
  repository: D1LegacyMigrationRepository;
  table: string;
  batchId: string;
  mode: "source_only" | "knowledge";
  dryRunHash: string;
  now: string;
}) {
  let result;
  do {
    result = await input.repository.runApprovedBatch({
      table: input.table,
      importBatchId: input.batchId,
      mode: input.mode,
      expectedDryRunHash: input.dryRunHash,
      now: input.now,
      limit: 25,
    });
  } while (!result.complete);
  return result;
}

let db: SqliteD1;

function lockedRepository() {
  return new D1LegacyMigrationRepository(db, "user-a", { legacyReadOnly: true });
}

beforeEach(async () => {
  db = new SqliteD1();
  await applyMigrations(db);
});

afterEach(() => db.close());

describe("legacy migration hardening", () => {
  test("installs and uses the partial object-visibility index for legacy read predicates", () => {
    const index = db.sqlite.prepare("select sql from sqlite_master where type='index' and name='idx_v2_legacy_mapping_object_visibility'").get() as { sql: string };
    expect(index.sql).toContain("WHERE `projected_object_id` IS NOT NULL");
    const plan = db.sqlite.prepare(`explain query plan
      select o.id from v2_objects o
      where not exists (
        select 1 from v2_legacy_source_mappings legacy_visibility
        where legacy_visibility.user_id=o.user_id
          and legacy_visibility.projected_object_id=o.id
          and legacy_visibility.status is not 'projected'
      )`).all() as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join("\n")).toContain("idx_v2_legacy_mapping_object_visibility");
  });

  test("rejects a table larger than the bounded 5,000-row approval manifest", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null)");
    const insert = db.sqlite.prepare("insert into quick_captures values (?,?,?,?,?,?,?,?,?,?)");
    db.sqlite.exec("begin");
    for (let index = 0; index < 5_001; index += 1) insert.run(`limit-${String(index).padStart(4, "0")}`, "user-a", `원문 ${index}`, "pending", null, null, null, null, null, "2026-08-28T00:00:00.000Z");
    db.sqlite.exec("commit");
    const repository = lockedRepository();
    await expect(repository.createDryRun("quick_captures")).rejects.toMatchObject({ code: "legacy_dry_run_limit" });
    expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches").first()).toEqual({ value: 0 });
  });

  test("keeps a 488-row dry-run and one source-only row below the free-tier invocation query budget", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null)");
    const insert = db.sqlite.prepare("insert into quick_captures values (?,?,?,?,?,?,?,?,?,?)");
    db.sqlite.exec("begin");
    for (let index = 0; index < 488; index += 1) insert.run(`quick-${String(index).padStart(3, "0")}`, "user-a", `원문 ${index}`, "pending", null, null, null, null, null, "2026-08-28T00:00:00.000Z");
    db.sqlite.exec("commit");
    const repository = lockedRepository();
    db.queryCount = 0;
    const dryRun = await repository.createDryRun("quick_captures");
    expect(dryRun).toMatchObject({ inputRows: 488, projectedDocuments: 488, archivedRows: 0, expectedMappingCount: 488 });
    expect(db.queryCount).toBe(2);
    db.queryCount = 0;
    const first = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "budget-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, limit: 25, now: "2026-08-28T00:01:00.000Z" });
    expect(first).toMatchObject({ processed: 1, nextOffset: 1, complete: false, appliedLimit: 1 });
    expect(db.queryCount).toBeLessThanOrEqual(47);
  });

  test("continues a two-projection daily log at the same row without exceeding the free-tier query budget", async () => {
    db.exec("create table daily_logs (id text primary key,user_id text not null,date text not null,mood integer,energy_level integer,emotions text,gratitude text,journal text,meditation text,meditation_verse text,ai_summary text,created_at text not null,updated_at text not null,deleted_at text,notion_source_id text,import_batch_id text,source_document_id text); insert into daily_logs values ('daily-1','user-a','2026-08-28',4,3,'[]','감사한 하루','오늘의 일기','오늘의 묵상','시편 1:1',null,'2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z',null,null,null,null)");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("daily_logs");
    expect(dryRun).toMatchObject({ inputRows: 1, projectedDocuments: 2, expectedMappingCount: 2 });

    db.queryCount = 0;
    const sourceFirst = await repository.runApprovedBatch({ table: "daily_logs", importBatchId: "daily-source", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:01:00.000Z" });
    expect(sourceFirst).toMatchObject({ processed: 0, processedProjections: 1, rowPending: true, offset: 0, nextOffset: 0, complete: false });
    expect(db.queryCount).toBeLessThanOrEqual(50);

    db.queryCount = 0;
    const sourceSecond = await repository.runApprovedBatch({ table: "daily_logs", importBatchId: "daily-source", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:02:00.000Z" });
    expect(sourceSecond).toMatchObject({ processed: 1, processedProjections: 1, rowPending: false, nextOffset: 1, complete: true, reconciliation: { structurally_valid: true, complete: true, source_only_count: 2 } });
    expect(db.queryCount).toBeLessThanOrEqual(50);

    db.queryCount = 0;
    const knowledgePrepared = await repository.runApprovedBatch({ table: "daily_logs", importBatchId: "daily-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:03:00.000Z" });
    expect(knowledgePrepared).toMatchObject({ processed: 0, processedProjections: 0, batchPrepared: true, rowPending: true, offset: 0, nextOffset: 0, complete: false });
    expect(db.queryCount).toBeLessThanOrEqual(50);

    db.queryCount = 0;
    const knowledgeFirst = await repository.runApprovedBatch({ table: "daily_logs", importBatchId: "daily-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:04:00.000Z" });
    expect(knowledgeFirst).toMatchObject({ processed: 0, processedProjections: 1, rowPending: true, offset: 0, nextOffset: 0, complete: false });
    expect(db.queryCount).toBeLessThanOrEqual(50);

    db.queryCount = 0;
    const knowledgeSecond = await repository.runApprovedBatch({ table: "daily_logs", importBatchId: "daily-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:05:00.000Z" });
    expect(knowledgeSecond).toMatchObject({ processed: 1, processedProjections: 1, rowPending: false, nextOffset: 1, complete: true, reconciliation: { structurally_valid: true, complete: true, projected_count: 2 } });
    expect(db.queryCount).toBeLessThanOrEqual(50);
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 2 });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status='active'").first()).toEqual({ value: 2 });
  });

  test("persists and resumes the global source-preservation cursor without scanning every legacy row in one invocation", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); create table media_logs (id text primary key,user_id text not null,media_type text not null,title text not null,rating real,review text,created_at text not null,updated_at text not null,deleted_at text)");
    const quickInsert = db.sqlite.prepare("insert into quick_captures values (?,?,?,?,?,?,?,?,?,?)");
    const mediaInsert = db.sqlite.prepare("insert into media_logs values (?,?,?,?,?,?,?,?,?)");
    db.sqlite.exec("begin");
    for (let index = 0; index < 20; index += 1) {
      const ordinal = String(index).padStart(2, "0");
      quickInsert.run(`resume-quick-${ordinal}`, "user-a", `빠른 기록 ${ordinal}`, "pending", null, null, null, null, null, "2026-08-28T00:00:00.000Z");
      mediaInsert.run(`resume-media-${ordinal}`, "user-a", "movie", `영화 ${ordinal}`, 4.5, `감상 ${ordinal}`, "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z", null);
    }
    db.sqlite.exec("commit");
    let repository = lockedRepository();
    const quickDryRun = await repository.createDryRun("quick_captures");
    const mediaDryRun = await repository.createDryRun("media_logs");
    await runToComplete({ repository, table: "quick_captures", batchId: "resume-quick-source", mode: "source_only", dryRunHash: quickDryRun.dryRunHash, now: "2026-08-28T00:06:00.000Z" });
    await runToComplete({ repository, table: "media_logs", batchId: "resume-media-source", mode: "source_only", dryRunHash: mediaDryRun.dryRunHash, now: "2026-08-28T00:07:00.000Z" });

    let batchPrepared = false;
    let previousCheckedRows = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      db.queryCount = 0;
      const result = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "resume-knowledge", mode: "knowledge", expectedDryRunHash: quickDryRun.dryRunHash, offset: 0, now: "2026-08-28T00:08:00.000Z" });
      expect(db.queryCount).toBeLessThanOrEqual(40);
      if (result.batchPrepared === true) {
        batchPrepared = true;
        break;
      }
      expect(result).toMatchObject({ gatePending: true, processed: 0, nextOffset: 0, complete: false, reconciliation: null });
      const preservationGate = "preservationGate" in result ? result.preservationGate : undefined;
      if (!preservationGate) throw new Error("Expected persisted preservation gate progress.");
      expect(preservationGate.rowsChecked).toBeGreaterThan(previousCheckedRows);
      expect(preservationGate).toMatchObject({ status: "checking", rowsTotal: 40, tablesTotal: 2 });
      previousCheckedRows = preservationGate.rowsChecked;
      expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches where id='resume-knowledge'").first()).toEqual({ value: 0 });
      repository = lockedRepository();
    }
    expect(batchPrepared).toBe(true);
    expect(await db.prepare("select status,next_table_position,next_row_offset,checked_rows,state_revision,lease_token from v2_legacy_preservation_gates where target_batch_id='resume-knowledge'").first()).toMatchObject({ status: "passed", next_table_position: 2, next_row_offset: 0, checked_rows: 40, lease_token: null });
    expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches where id='resume-knowledge'").first()).toEqual({ value: 1 });
  });

  test("matches rowid identities by the preserved manifest instead of numeric database order", async () => {
    db.exec("create table daily_logs (id text primary key,user_id text not null,date text not null,mood integer,energy_level integer,emotions text,gratitude text,journal text,meditation text,meditation_verse text,ai_summary text,created_at text not null,updated_at text not null,deleted_at text,notion_source_id text,import_batch_id text,source_document_id text); insert into daily_logs values ('rowid-parent','user-a','2026-08-28',null,null,null,null,null,null,null,null,'2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z',null,null,null,null); create table daily_log_people_relations (daily_log_id text not null,person_id text not null,context text,created_at text not null,source_document_id text,confidence real,raw_value text)");
    const insert = db.sqlite.prepare("insert into daily_log_people_relations values ('rowid-parent',?,?,?,null,null,null)");
    for (let index = 1; index <= 12; index += 1) insert.run(`person-${index}`, `관계 ${index}`, "2026-08-28T00:00:00.000Z");
    const repository = lockedRepository();
    const parentDryRun = await repository.createDryRun("daily_logs");
    const relationDryRun = await repository.createDryRun("daily_log_people_relations");
    await runToComplete({ repository, table: "daily_logs", batchId: "rowid-parent-source", mode: "source_only", dryRunHash: parentDryRun.dryRunHash, now: "2026-08-28T00:09:00.000Z" });
    await runToComplete({ repository, table: "daily_log_people_relations", batchId: "rowid-relations-source", mode: "source_only", dryRunHash: relationDryRun.dryRunHash, now: "2026-08-28T00:10:00.000Z" });

    await expect(repository.runApprovedBatch({ table: "daily_log_people_relations", importBatchId: "rowid-relations-knowledge", mode: "knowledge", expectedDryRunHash: relationDryRun.dryRunHash, offset: 0, now: "2026-08-28T00:11:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, complete: false });
    expect(await db.prepare("select status,checked_rows from v2_legacy_preservation_gates where target_batch_id='rowid-relations-knowledge'").first()).toEqual({ status: "passed", checked_rows: 13 });
  });

  test("persists approval, quarantines source-only documents, and requires that pass before knowledge", async () => {
    db.exec("create table media_logs (id text primary key,user_id text not null,media_type text not null,title text not null,rating real,review text,created_at text not null,updated_at text not null,deleted_at text); insert into media_logs values ('media-1','user-a','movie','영화',4.5,'인상적인 결말','2026-01-01','2026-01-01',null)");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("media_logs");
    await expect(repository.runApprovedBatch({ table: "media_logs", importBatchId: "knowledge-too-early", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:02:00.000Z" })).rejects.toMatchObject({ code: "legacy_source_only_incomplete" });
    db.queryCount = 0;
    const sourceOnly = await runToComplete({ repository, table: "media_logs", batchId: "media-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:03:00.000Z" });
    expect(db.queryCount).toBeLessThanOrEqual(50);
    expect(sourceOnly.reconciliation).toMatchObject({ structurally_valid: true, complete: true, source_only_count: 1 });
    const quarantined = await db.prepare("select o.lifecycle_status from v2_objects o join v2_legacy_source_mappings m on m.projected_object_id=o.id where m.legacy_id='media-1'").first<{ lifecycle_status: string }>();
    expect(quarantined).toEqual({ lifecycle_status: "archived" });
    db.exec("insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at) values ('custom-movie-type','user-a','movie_review','기존 영화 리뷰','document','active','user_created','기존 정의',1,0,1,'2026-08-28T00:03:30.000Z','2026-08-28T00:03:30.000Z'); insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,filterable,sortable,facetable,schema_version,usage_count,created_at,updated_at) values ('custom-rating-field','user-a','user_rating','기존 평점','기존 정의','rating','active','user_created',1,1,1,1,0,'2026-08-28T00:03:30.000Z','2026-08-28T00:03:30.000Z')");
    db.queryCount = 0;
    const knowledge = await runToComplete({ repository, table: "media_logs", batchId: "media-knowledge", mode: "knowledge", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:04:00.000Z" });
    expect(knowledge.reconciliation).toMatchObject({ structurally_valid: true, complete: true, projected_count: 1 });
    expect(await db.prepare("select type_definition_id from v2_object_type_assignments where object_id in (select projected_object_id from v2_legacy_source_mappings where legacy_id='media-1')").first()).toEqual({ type_definition_id: "custom-movie-type" });
    expect(await db.prepare("select field_definition_id from v2_property_values where owner_object_id in (select projected_object_id from v2_legacy_source_mappings where legacy_id='media-1')").first()).toEqual({ field_definition_id: "custom-rating-field" });
    const visible = await db.prepare("select o.lifecycle_status from v2_objects o join v2_legacy_source_mappings m on m.projected_object_id=o.id where m.legacy_id='media-1'").first<{ lifecycle_status: string }>();
    expect(visible).toEqual({ lifecycle_status: "active" });
    const replay = await repository.runApprovedBatch({ table: "media_logs", importBatchId: "media-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:05:00.000Z" });
    expect(replay).toMatchObject({ processed: 0, complete: true });
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 1 });
  });

  test.each(["type_definition", "field_definition", "assignment", "property", "evidence"] as const)("rejects a preseeded incompatible %s instead of sealing a knowledge batch", async (collisionKind) => {
    db.exec("create table media_logs (id text primary key,user_id text not null,media_type text not null,title text not null,rating real,review text,created_at text not null,updated_at text not null,deleted_at text); insert into media_logs values ('exact-1','user-a','movie','정확성 검증 영화',4.5,'충돌을 숨기면 안 된다','2026-01-01','2026-01-01',null)");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("media_logs");
    await runToComplete({ repository, table: "media_logs", batchId: `exact-source-${collisionKind}`, mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:06:00.000Z" });
    const mapping = await db.prepare("select source_item_id,projected_object_id from v2_legacy_source_mappings where legacy_id='exact-1'").first<{ source_item_id: string; projected_object_id: string }>();
    const assignmentId = `assignment:import:${mapping!.projected_object_id}:movie_review`;
    const propertyId = `property:import:${mapping!.projected_object_id}:user_rating`;

    if (collisionKind === "type_definition") {
      db.exec("insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at) values ('archived-movie-type','user-a','movie_review','보관된 영화 리뷰','document','archived','user_created','충돌 fixture',1,0,0,'2026-08-28T00:06:30.000Z','2026-08-28T00:06:30.000Z')");
    } else if (collisionKind === "field_definition") {
      db.exec("insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,filterable,sortable,facetable,schema_version,usage_count,created_at,updated_at) values ('incompatible-rating-field','user-a','user_rating','문자열 평점','충돌 fixture','short_text','active','user_created',1,1,1,1,0,'2026-08-28T00:06:30.000Z','2026-08-28T00:06:30.000Z')");
    } else if (collisionKind === "assignment") {
      db.exec("insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at) values ('wrong-import-type','user-a','wrong_import_type','잘못된 타입','document','active','user_created','충돌 fixture',1,0,0,'2026-08-28T00:06:30.000Z','2026-08-28T00:06:30.000Z')");
      await db.prepare("insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at) values (?,?,?,?, 'primary','import','accepted',0,?,?)").bind(assignmentId, "user-a", mapping!.projected_object_id, "wrong-import-type", "2026-08-28T00:06:30.000Z", "2026-08-28T00:06:30.000Z").run();
    } else if (collisionKind === "property") {
      db.exec("insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,filterable,sortable,facetable,schema_version,usage_count,created_at,updated_at) values ('field:import:user-a:user_rating','user-a','user_rating','내 평점','충돌 fixture','rating','active','imported',1,1,1,1,0,'2026-08-28T00:06:30.000Z','2026-08-28T00:06:30.000Z')");
      await db.prepare("insert into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,locked_by_user,created_at) values (?,?,?,'field:import:user-a:user_rating','rating',1,'1','imported','low','accepted',0,?)").bind(propertyId, "user-a", mapping!.projected_object_id, "2026-08-28T00:06:30.000Z").run();
    } else {
      await db.prepare(`insert into v2_evidence_refs (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at) values (?,'user-a','type_assignment',?,?,'text_span','{"start":1,"end":1}','2026-08-28T00:06:30.000Z')`).bind(`evidence:${assignmentId}`, assignmentId, mapping!.source_item_id).run();
    }
    const before = await db.prepare("select (select count(*) from v2_type_definitions) as types,(select count(*) from v2_field_definitions) as fields,(select count(*) from v2_object_type_assignments) as assignments,(select count(*) from v2_property_values) as properties,(select count(*) from v2_evidence_refs) as evidence").first();

    await expect(repository.runApprovedBatch({ table: "media_logs", importBatchId: `exact-knowledge-${collisionKind}`, mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:07:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, complete: false });
    await expect(repository.runApprovedBatch({ table: "media_logs", importBatchId: `exact-knowledge-${collisionKind}`, mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:07:01.000Z" })).rejects.toMatchObject({ code: collisionKind.endsWith("definition") ? "legacy_definition_conflict" : "legacy_projection_conflict" });
    expect(await db.prepare("select (select count(*) from v2_type_definitions) as types,(select count(*) from v2_field_definitions) as fields,(select count(*) from v2_object_type_assignments) as assignments,(select count(*) from v2_property_values) as properties,(select count(*) from v2_evidence_refs) as evidence").first()).toEqual(before);
    expect(await db.prepare("select status from v2_legacy_migration_batches where id=?").bind(`exact-knowledge-${collisionKind}`).first()).toEqual({ status: "approved" });
    expect(await db.prepare("select status from v2_legacy_source_mappings where legacy_id='exact-1'").first()).toEqual({ status: "source_only" });
    expect(await db.prepare("select lifecycle_status from v2_objects where id=?").bind(mapping!.projected_object_id).first()).toEqual({ lifecycle_status: "archived" });
  });

  test("keeps knowledge locked when another preserved table changes without changing its schema or row count", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('gate-quick','user-a','빠른 기록','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'); create table media_logs (id text primary key,user_id text not null,media_type text not null,title text not null,rating real,review text,created_at text not null,updated_at text not null,deleted_at text); insert into media_logs values ('gate-media','user-a','movie','영화',4.5,'보존한 감상','2026-01-01','2026-01-01',null)");
    const repository = lockedRepository();
    const quickDryRun = await repository.createDryRun("quick_captures");
    const mediaDryRun = await repository.createDryRun("media_logs");
    await runToComplete({ repository, table: "quick_captures", batchId: "gate-quick-source", mode: "source_only", dryRunHash: quickDryRun.dryRunHash, now: "2026-08-28T00:10:00.000Z" });
    await runToComplete({ repository, table: "media_logs", batchId: "gate-media-source", mode: "source_only", dryRunHash: mediaDryRun.dryRunHash, now: "2026-08-28T00:11:00.000Z" });
    db.exec("update media_logs set review='보존 뒤 바뀐 감상' where id='gate-media'");

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "gate-knowledge", mode: "knowledge", expectedDryRunHash: quickDryRun.dryRunHash, now: "2026-08-28T00:12:00.000Z" })).rejects.toMatchObject({ code: "legacy_source_preservation_incomplete" });
    expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches where id='gate-knowledge'").first()).toEqual({ value: 0 });
  });

  test("fails closed when a preserved damage receipt is corrupt even though the raw row is unchanged", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('damage-receipt-1','user-a','원문은 그대로 유지된다','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "damage-receipt-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:12:30.000Z" });

    // Simulate a corrupt restored receipt. Production envelopes remain immutable.
    db.exec("drop trigger trg_v2_legacy_envelope_immutable; update v2_legacy_source_envelopes set damage_codes_json='[\"fabricated_damage\"]' where legacy_table='quick_captures' and legacy_id='damage-receipt-1'");

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "damage-receipt-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:13:00.000Z" })).rejects.toMatchObject({ code: "legacy_source_preservation_incomplete" });
    expect(await db.prepare("select status,failure_code from v2_legacy_preservation_gates where target_batch_id='damage-receipt-knowledge'").first()).toEqual({ status: "failed", failure_code: "legacy_source_preservation_incomplete" });
    expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches where id='damage-receipt-knowledge'").first()).toEqual({ value: 0 });
  });

  test("fails closed when a newly appeared non-empty content table has no registered adapter", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('unknown-gate-1','user-a','보존한 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "unknown-gate-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:13:00.000Z" });

    // Auth/session, V2 and the known FTS family are explicit non-content exclusions.
    db.exec("create table sessions (id text primary key,user_id text not null); insert into sessions values ('session-a','user-a'); create table zettels_fts (payload text); insert into zettels_fts values ('derived index'); create table zettels_fts_data (payload text); insert into zettels_fts_data values ('derived shadow'); create table surprise_notes (id text primary key,user_id text not null,body text); insert into surprise_notes values ('surprise-1','user-a','어댑터가 필요한 새 원문')");

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "unknown-gate-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:14:00.000Z" })).rejects.toMatchObject({ code: "legacy_unregistered_source_table", message: expect.stringContaining("surprise_notes") });
    expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches where id='unknown-gate-knowledge'").first()).toEqual({ value: 0 });
  });

  test("the SQL succeeded guard requires both the knowledge receipt and live pending count to be zero", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('direct-guard-1','user-a','직접 SQL 성공 가드','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "direct-guard-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:15:00.000Z" });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "direct-guard-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T00:16:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, complete: false });

    db.exec("insert into v2_legacy_migration_batch_items (batch_id,user_id,position,legacy_envelope_id,legacy_id,row_hash,projection_hash,projections_json,expected_mapping_count,status,processed_at) select 'direct-guard-knowledge',user_id,position,legacy_envelope_id,legacy_id,row_hash,projection_hash,projections_json,expected_mapping_count,'succeeded','2026-08-28T00:16:30.000Z' from v2_legacy_migration_batch_items where batch_id='direct-guard-source'; update v2_legacy_migration_batches set next_offset=input_rows where id='direct-guard-knowledge'; update v2_legacy_source_mappings set status='projected',activation_batch_id=null where legacy_id='direct-guard-1'");
    const forgedPendingReceipt = JSON.stringify({ batch_status: "succeeded", complete: true, knowledge_pending_count: 1 });
    await expect(db.prepare("update v2_legacy_migration_batches set status='succeeded',reconciliation_status='passed',reconciliation_json=?,reconciled_at='2026-08-28T00:17:00.000Z',finished_at='2026-08-28T00:17:00.000Z' where id='direct-guard-knowledge'").bind(forgedPendingReceipt).run()).rejects.toThrow(/legacy_knowledge_pending_not_zero/);

    db.exec("update v2_legacy_source_mappings set status='knowledge_pending',activation_batch_id='direct-guard-knowledge' where legacy_id='direct-guard-1'");
    const forgedZeroReceipt = JSON.stringify({ batch_status: "succeeded", complete: true, knowledge_pending_count: 0 });
    await expect(db.prepare("update v2_legacy_migration_batches set status='succeeded',reconciliation_status='passed',reconciliation_json=?,reconciled_at='2026-08-28T00:18:00.000Z',finished_at='2026-08-28T00:18:00.000Z' where id='direct-guard-knowledge'").bind(forgedZeroReceipt).run()).rejects.toThrow(/legacy_knowledge_pending_not_zero/);
    expect(await db.prepare("select status,reconciliation_status from v2_legacy_migration_batches where id='direct-guard-knowledge'").first()).toEqual({ status: "approved", reconciliation_status: "pending" });
  });

  test("rejects a valid-looking altered projection receipt in reconciliation and the terminal SQL guard", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('receipt-1','user-a','첫 영수증','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'),('receipt-2','user-a','둘째 영수증','pending',null,null,null,null,null,'2026-08-28T00:01:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "projection-receipt-guard", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:19:00.000Z" })).resolves.toMatchObject({ processed: 1, nextOffset: 1, complete: false });

    await db.prepare("update v2_legacy_migration_batch_items set projection_hash=?,projections_json=? where batch_id='projection-receipt-guard' and position=0")
      .bind("b".repeat(64), JSON.stringify([{ key: "forged", lifecycleStatus: "active" }]))
      .run();

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "projection-receipt-guard", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 1, now: "2026-08-28T00:20:00.000Z" })).rejects.toMatchObject({ code: "legacy_reconciliation_failed" });
    const failed = await db.prepare("select status,reconciliation_status,reconciliation_json from v2_legacy_migration_batches where id='projection-receipt-guard'").first<{ status: string; reconciliation_status: string; reconciliation_json: string }>();
    expect(failed).toMatchObject({ status: "failed", reconciliation_status: "failed" });
    expect(JSON.parse(failed!.reconciliation_json)).toMatchObject({ projection_receipt_mismatch_count: 1, deterministic_projection_mismatch_count: 1, structurally_valid: false, complete: false });

    const forgedReceipt = JSON.stringify({ batch_status: "succeeded", complete: true, knowledge_pending_count: 0 });
    await expect(db.prepare("update v2_legacy_migration_batches set status='succeeded',reconciliation_status='passed',reconciliation_json=?,failure_code=null,reconciled_at='2026-08-28T00:21:00.000Z',finished_at='2026-08-28T00:21:00.000Z' where id='projection-receipt-guard'").bind(forgedReceipt).run()).rejects.toThrow(/legacy_projection_receipt_mismatch/);
    expect(await db.prepare("select status,reconciliation_status from v2_legacy_migration_batches where id='projection-receipt-guard'").first()).toEqual({ status: "failed", reconciliation_status: "failed" });
  });

  test("rejects source-only lifecycle drift in reconciliation and the terminal SQL guard", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('lifecycle-1','user-a','격리할 첫 행','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'),('lifecycle-2','user-a','격리할 둘째 행','pending',null,null,null,null,null,'2026-08-28T00:01:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "lifecycle-terminal-guard", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T00:22:00.000Z" })).resolves.toMatchObject({ processed: 1, nextOffset: 1, complete: false });
    const firstMapping = await db.prepare("select projected_object_id from v2_legacy_source_mappings where legacy_id='lifecycle-1'").first<{ projected_object_id: string }>();
    await db.prepare("update v2_objects set lifecycle_status='active' where id=?").bind(firstMapping!.projected_object_id).run();

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "lifecycle-terminal-guard", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 1, now: "2026-08-28T00:23:00.000Z" })).rejects.toMatchObject({ code: "legacy_reconciliation_failed" });
    const failed = await db.prepare("select status,reconciliation_status,reconciliation_json from v2_legacy_migration_batches where id='lifecycle-terminal-guard'").first<{ status: string; reconciliation_status: string; reconciliation_json: string }>();
    expect(failed).toMatchObject({ status: "failed", reconciliation_status: "failed" });
    expect(JSON.parse(failed!.reconciliation_json)).toMatchObject({ invalid_lifecycle_count: 1, invalid_dependency_count: 1, structurally_valid: false, complete: false });

    const forgedReceipt = JSON.stringify({ batch_status: "succeeded", complete: true, knowledge_pending_count: 0 });
    await expect(db.prepare("update v2_legacy_migration_batches set status='succeeded',reconciliation_status='passed',reconciliation_json=?,failure_code=null,reconciled_at='2026-08-28T00:24:00.000Z',finished_at='2026-08-28T00:24:00.000Z' where id='lifecycle-terminal-guard'").bind(forgedReceipt).run()).rejects.toThrow(/legacy_mapping_lifecycle_invalid/);
    expect(await db.prepare("select status,reconciliation_status from v2_legacy_migration_batches where id='lifecycle-terminal-guard'").first()).toEqual({ status: "failed", reconciliation_status: "failed" });
  });

  test("creates versioned mappings for changed rows and supersedes the old visible projection", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('changed-1','user-a','첫 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const firstDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "changed-source-v1", mode: "source_only", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T01:00:00.000Z" });
    const first = await db.prepare("select id,projected_object_id from v2_legacy_source_mappings where legacy_id='changed-1'").first<{ id: string; projected_object_id: string }>();
    db.exec("update quick_captures set raw_text='둘째 원문' where id='changed-1'");
    const secondDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "changed-source-v2", mode: "source_only", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T01:01:00.000Z" });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_envelopes where legacy_id='changed-1'").first()).toEqual({ value: 2 });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where legacy_id='changed-1'").first()).toEqual({ value: 2 });
    await runToComplete({ repository, table: "quick_captures", batchId: "changed-knowledge-v2", mode: "knowledge", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T01:02:00.000Z" });
    const lineage = await db.prepare("select id,status,superseded_by_mapping_id,projected_object_id from v2_legacy_source_mappings where legacy_id='changed-1' order by created_at").all<{ id: string; status: string; superseded_by_mapping_id: string | null; projected_object_id: string }>();
    const old = lineage.results.find((mapping) => mapping.id === first!.id)!;
    const current = lineage.results.find((mapping) => mapping.status === "projected")!;
    expect(old).toMatchObject({ status: "superseded", superseded_by_mapping_id: current.id });
    expect(await db.prepare("select lifecycle_status from v2_objects where id=?").bind(old.projected_object_id).first()).toEqual({ lifecycle_status: "archived" });
    expect(await db.prepare("select lifecycle_status from v2_objects where id=?").bind(current.projected_object_id).first()).toEqual({ lifecycle_status: "active" });
    await expect(repository.reconcileBatch("changed-source-v2")).resolves.toMatchObject({ structurally_valid: true, complete: true, missing_mapping_count: 0, invalid_dependency_count: 0 });
  });

  test("detects an approved-row mutation before writing any envelope", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('stale-1','user-a','승인 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    db.exec("update quick_captures set raw_text='승인 뒤 변경' where id='stale-1'");
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "stale-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T02:00:00.000Z" })).rejects.toMatchObject({ code: "legacy_dry_run_changed" });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_envelopes").first()).toEqual({ value: 0 });
    expect(await db.prepare("select count(*) as value from v2_legacy_migration_batches").first()).toEqual({ value: 0 });
  });

  test("leaves a repairable pending mapping after an injected post-capture failure and converges on retry", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('fault-1','user-a','복구할 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    db.exec("create trigger inject_mapping_failure before update of source_item_id on v2_legacy_source_mappings begin select raise(abort,'injected_mapping_failure'); end");
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "fault-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T03:00:00.000Z" })).rejects.toThrow(/injected_mapping_failure/);
    await expect(repository.reconcileBatch("fault-batch")).resolves.toMatchObject({ pending_item_count: 1, pending_mapping_count: 1, invalid_dependency_count: 1, structurally_valid: false, complete: false });
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 1 });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status<>'archived'").first()).toEqual({ value: 0 });
    const orphan = await db.prepare("select o.id from v2_objects o join v2_documents d on d.object_id=o.id join v2_capture_bundles c on c.id=d.capture_id where c.draft_id like 'legacy:%'").first<{ id: string }>();
    await expect(new D1SourceFoundationRepository(db, "user-a").getRecord(orphan!.id)).resolves.toBeNull();
    const migrationChangeKinds = await db.prepare("select distinct aggregate_kind from v2_change_events where aggregate_kind like 'legacy_%' order by aggregate_kind").all<{ aggregate_kind: string }>();
    expect(migrationChangeKinds.results.map((row) => row.aggregate_kind)).toEqual(["legacy_envelope", "legacy_mapping", "legacy_migration_batch", "legacy_migration_batch_item"]);
    const restrictedScope = { objects: "all", privacyLevels: ["normal", "restricted"], includeTrash: false, includeHistory: true, includeOriginals: true } as const;
    const normalScope = { ...restrictedScope, privacyLevels: ["normal"] } as const;
    const fullFidelityScope = fullFidelityCanonicalScope(restrictedScope);
    for (const table of ["v2_legacy_migration_batches", "v2_legacy_source_envelopes", "v2_legacy_migration_batch_items", "v2_legacy_source_mappings"] as const) {
      const descriptor = CANONICAL_TABLE_BY_NAME.get(table)!;
      const restricted = descriptor.query("user-a", restrictedScope);
      const normal = descriptor.query("user-a", normalScope);
      const fullFidelity = descriptor.query("user-a", fullFidelityScope);
      expect((await db.prepare(fullFidelity.sql).bind(...fullFidelity.bindings).all()).results).toHaveLength(1);
      expect((await db.prepare(restricted.sql).bind(...restricted.bindings).all()).results).toHaveLength(0);
      expect((await db.prepare(normal.sql).bind(...normal.bindings).all()).results).toHaveLength(0);
    }
    const portableObjects = CANONICAL_TABLE_BY_NAME.get("v2_objects")!.query("user-a", normalScope);
    expect((await db.prepare(portableObjects.sql).bind(...portableObjects.bindings).all()).results).toHaveLength(0);
    const idempotency = await db.prepare("select idempotency_key,payload_hash,response_json from v2_idempotency_records limit 1").first<{ idempotency_key: string; payload_hash: string; response_json: string }>();
    const sourceRepository = new D1SourceFoundationRepository(db, "user-a");
    const archivedLegacyPrepared = await prepareLegacyCaptureCommit({
      draftId: idempotency!.idempotency_key,
      channel: "import",
      title: "가져온 빠른 기록",
      bodyMarkdown: "복구할 원문",
      aiEnabled: false,
      clientTimezone: "Asia/Seoul",
      privacyLevel: "normal",
      capturedAt: "2026-08-28T00:00:00.000Z",
    }, idempotency!.idempotency_key, "2026-08-28T03:00:00.000Z");
    await expect(sourceRepository.commitLegacyCapture(archivedLegacyPrepared)).resolves.toMatchObject({ recordId: orphan!.id, disposition: "replayed" });
    await expect(sourceRepository.commitCapture(archivedLegacyPrepared)).rejects.toMatchObject({ code: "capture_source_invalid" });

    const publicPrepared = await prepareCaptureCommit({
      draftId: "public-hidden-replay",
      channel: "web",
      title: "공개 재시도",
      bodyMarkdown: "숨겨진 migration receipt를 공개 경로에서 받을 수 없어야 한다.",
      aiEnabled: false,
      clientTimezone: "Asia/Seoul",
      privacyLevel: "normal",
      capturedAt: "2026-08-28T03:00:00.000Z",
    }, "public-hidden-replay", "2026-08-28T03:00:00.000Z");
    await db.prepare(`insert into v2_idempotency_records
      (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
      values ('user-a','capture.commit',?,?,?,201,'2026-08-28T03:00:00.000Z')`)
      .bind(publicPrepared.idempotencyKey, publicPrepared.payloadHash, idempotency!.response_json).run();
    await expect(sourceRepository.commitCapture(publicPrepared)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await db.prepare("delete from v2_idempotency_records where idempotency_key=?").bind(publicPrepared.idempotencyKey).run();

    const legacyPrepared = await prepareLegacyCaptureCommit({
      draftId: idempotency!.idempotency_key,
      channel: "import",
      title: "가져온 빠른 기록",
      bodyMarkdown: "복구할 원문",
      aiEnabled: false,
      clientTimezone: "Asia/Seoul",
      privacyLevel: "normal",
      capturedAt: "2026-08-28T00:00:00.000Z",
    }, idempotency!.idempotency_key, "2026-08-28T03:00:00.000Z", { compatibilityLifecycleStatus: "active" });
    db.exec("update v2_legacy_source_mappings set target_lifecycle_status=null");
    await db.prepare("update v2_idempotency_records set payload_hash=? where idempotency_key=?").bind(legacyPrepared.payloadHash, idempotency!.idempotency_key).run();
    db.exec("drop trigger inject_mapping_failure");
    const repaired = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "fault-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T03:01:00.000Z" });
    expect(repaired.reconciliation).toMatchObject({ pending_item_count: 0, pending_mapping_count: 0, invalid_dependency_count: 0, structurally_valid: true, complete: true });
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 1 });
  });

  test("backfills and reuses a complete v2-017 mapping without its old idempotency record", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('legacy-017','user-a','복원된 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "legacy-017-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T03:10:00.000Z" });
    db.exec("update v2_legacy_source_mappings set target_lifecycle_status=null where legacy_id='legacy-017'; delete from v2_idempotency_records");

    const knowledge = await runToComplete({ repository, table: "quick_captures", batchId: "legacy-017-knowledge", mode: "knowledge", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T03:11:00.000Z" });

    expect(knowledge.reconciliation).toMatchObject({ complete: true, projected_count: 1 });
    expect(await db.prepare("select target_lifecycle_status,status from v2_legacy_source_mappings where legacy_id='legacy-017'").first()).toEqual({ target_lifecycle_status: "active", status: "projected" });
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 1 });
  });

  test("acknowledges a stale offset after a lost response and resumes from the authoritative server offset", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('retry-1','user-a','첫 행','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'),('retry-2','user-a','둘째 행','pending',null,null,null,null,null,'2026-08-28T00:01:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");

    const first = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "retry-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T04:00:00.000Z" });
    expect(first).toMatchObject({ processed: 1, offset: 0, nextOffset: 1, complete: false });

    const repeated = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "retry-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T04:01:00.000Z" });
    expect(repeated).toMatchObject({ processed: 0, offset: 0, nextOffset: 1, complete: false, batchStatus: "running" });
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 1 });

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "retry-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 2, now: "2026-08-28T04:02:00.000Z" })).rejects.toMatchObject({ code: "legacy_batch_offset_conflict" });
    const completed = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "retry-batch", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: repeated.nextOffset, now: "2026-08-28T04:03:00.000Z" });
    expect(completed).toMatchObject({ processed: 1, offset: 1, nextOffset: 2, complete: true, batchStatus: "succeeded" });
    expect(completed.reconciliation).toMatchObject({ structurally_valid: true, complete: true });
    expect(await db.prepare("select count(*) as value from v2_capture_bundles").first()).toEqual({ value: 2 });
  });

  test("creates a new immutable envelope when the legacy schema changes without changing the row JSON", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('schema-1','user-a','같은 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const firstDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "schema-source-v1", mode: "source_only", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T05:00:00.000Z" });

    db.exec("alter table quick_captures rename to quick_captures_old; create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence text,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures select * from quick_captures_old; drop table quick_captures_old");
    const secondDryRun = await repository.createDryRun("quick_captures");
    expect(secondDryRun.rowsRootHash).toBe(firstDryRun.rowsRootHash);
    expect(secondDryRun.schemaSnapshot).not.toBe(firstDryRun.schemaSnapshot);
    await runToComplete({ repository, table: "quick_captures", batchId: "schema-source-v2", mode: "source_only", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T05:01:00.000Z" });

    expect(await db.prepare("select count(*) as value from v2_legacy_source_envelopes where legacy_id='schema-1'").first()).toEqual({ value: 2 });
    await expect(repository.reconcileBatch("schema-source-v2")).resolves.toMatchObject({ structurally_valid: true, complete: true, manifest_mismatch_count: 0 });
  });

  test("keeps every knowledge object quarantined when a later approved row changes", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('knowledge-1','user-a','첫 행','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'),('knowledge-2','user-a','둘째 행','pending',null,null,null,null,null,'2026-08-28T00:01:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "knowledge-stale-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T06:00:00.000Z" });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "knowledge-stale", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:01:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, complete: false });
    const first = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "knowledge-stale", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:01:01.000Z" });
    expect(first).toMatchObject({ processed: 1, complete: false });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where status='knowledge_pending'").first()).toEqual({ value: 1 });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status='active'").first()).toEqual({ value: 0 });
    db.exec("update quick_captures set raw_text='승인 뒤 변경' where id='knowledge-2'");
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "knowledge-stale", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 1, now: "2026-08-28T06:02:00.000Z" })).rejects.toMatchObject({ code: "legacy_dry_run_changed" });
    expect(await db.prepare("select status from v2_legacy_migration_batches where id='knowledge-stale'").first()).toEqual({ status: "stale" });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status='active'").first()).toEqual({ value: 0 });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where status='projected'").first()).toEqual({ value: 0 });
  });

  test("does not promote quarantined knowledge when the authoritative batch becomes stale before finalization", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('finalize-stale-1','user-a','승격하면 안 되는 원문','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "finalize-stale-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T06:05:00.000Z" });
    db.beforeBatch = (statements) => {
      if (statements.length !== 5) return;
      db.beforeBatch = null;
      db.sqlite.prepare("update v2_legacy_migration_batches set status='stale',failure_code='injected_before_finalize' where id='finalize-stale-knowledge'").run();
    };

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "finalize-stale-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:06:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, complete: false });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "finalize-stale-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:06:01.000Z" })).rejects.toMatchObject({ code: "legacy_dry_run_changed" });
    expect(await db.prepare("select status,reconciliation_status from v2_legacy_migration_batches where id='finalize-stale-knowledge'").first()).toEqual({ status: "stale", reconciliation_status: "pending" });
    expect(await db.prepare("select status,activation_batch_id from v2_legacy_source_mappings where legacy_id='finalize-stale-1'").first()).toEqual({ status: "knowledge_pending", activation_batch_id: "finalize-stale-knowledge" });
    expect(await db.prepare("select lifecycle_status from v2_objects where id in (select projected_object_id from v2_legacy_source_mappings where legacy_id='finalize-stale-1')").first()).toEqual({ lifecycle_status: "archived" });
  });

  test("rejects both stale-offset and current-offset replay when a succeeded batch no longer reconciles", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('damaged-success-1','user-a','사후 훼손 검증','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "damaged-success", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T06:07:00.000Z" });
    db.exec("update v2_legacy_source_mappings set source_item_id=null where legacy_id='damaged-success-1'");

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "damaged-success", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:08:00.000Z" })).rejects.toMatchObject({ code: "legacy_batch_incomplete" });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "damaged-success", mode: "source_only", expectedDryRunHash: dryRun.dryRunHash, offset: 1, now: "2026-08-28T06:09:00.000Z" })).rejects.toMatchObject({ code: "legacy_batch_incomplete" });
    await expect(repository.reconcileBatch("damaged-success")).resolves.toMatchObject({ complete: false, structurally_valid: false, invalid_dependency_count: 1 });
  });

  test("refuses a false knowledge success when mapping ownership changes after reconciliation", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('race-1','user-a','첫 행','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'),('race-2','user-a','둘째 행','pending',null,null,null,null,null,'2026-08-28T00:01:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "race-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T06:10:00.000Z" });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "race-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:11:00.000Z" })).resolves.toMatchObject({ batchPrepared: true, complete: false });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "race-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 0, now: "2026-08-28T06:11:01.000Z" })).resolves.toMatchObject({ processed: 1, nextOffset: 1, complete: false });
    db.beforeBatch = (statements) => {
      if (statements.length !== 5) return;
      db.beforeBatch = null;
      db.sqlite.prepare("update v2_legacy_source_mappings set activation_batch_id='stolen-after-reconciliation' where activation_batch_id='race-knowledge' and status='knowledge_pending'").run();
    };

    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "race-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 1, now: "2026-08-28T06:12:00.000Z" })).rejects.toThrow(/legacy_batch_control_inactive/);
    expect(await db.prepare("select status,reconciliation_status from v2_legacy_migration_batches where id='race-knowledge'").first()).toEqual({ status: "running", reconciliation_status: "pending" });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where status='knowledge_pending'").first()).toEqual({ value: 2 });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status='active'").first()).toEqual({ value: 0 });

    db.exec("update v2_legacy_source_mappings set activation_batch_id='race-knowledge' where activation_batch_id='stolen-after-reconciliation'");
    const repaired = await repository.runApprovedBatch({ table: "quick_captures", importBatchId: "race-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, offset: 2, now: "2026-08-28T06:13:00.000Z" });
    expect(repaired).toMatchObject({ complete: true, batchStatus: "succeeded", reconciliation: { complete: true, knowledge_pending_count: 0, projected_count: 2 } });
    const stored = await db.prepare("select reconciliation_json from v2_legacy_migration_batches where id='race-knowledge'").first<{ reconciliation_json: string }>();
    expect(JSON.parse(stored!.reconciliation_json)).toMatchObject({ batch_status: "succeeded", complete: true, knowledge_pending_count: 0, projected_count: 2 });
  });

  test("supersedes the previously active mapping when an adapter version evolves", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('adapter-1','user-a','버전이 바뀔 글','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const original = LEGACY_ADAPTER_BY_TABLE.get("quick_captures")!;
    try {
    const repository = lockedRepository();
      const firstDryRun = await repository.createDryRun("quick_captures");
      await runToComplete({ repository, table: "quick_captures", batchId: "adapter-source-v1", mode: "source_only", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T07:00:00.000Z" });
      await runToComplete({ repository, table: "quick_captures", batchId: "adapter-knowledge-v1", mode: "knowledge", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T07:01:00.000Z" });
      LEGACY_ADAPTER_BY_TABLE.set("quick_captures", { ...original, version: `${original.version}_next` });
      const secondDryRun = await repository.createDryRun("quick_captures");
      await runToComplete({ repository, table: "quick_captures", batchId: "adapter-source-v2", mode: "source_only", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T07:02:00.000Z" });
      await runToComplete({ repository, table: "quick_captures", batchId: "adapter-knowledge-v2", mode: "knowledge", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T07:03:00.000Z" });
      expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where legacy_id='adapter-1' and status='projected'").first()).toEqual({ value: 1 });
      expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where legacy_id='adapter-1' and status='superseded'").first()).toEqual({ value: 1 });
      expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status='active'").first()).toEqual({ value: 1 });
    } finally {
      LEGACY_ADAPTER_BY_TABLE.set("quick_captures", original);
    }
  });

  test("quarantines a succeeded source-only batch idempotently without deleting source provenance", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('quarantine-source-1','user-a','격리해도 원문은 남는다','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'); insert into users (id) values ('user-b')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "quarantine-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T08:00:00.000Z" });
    const before = await db.prepare("select (select count(*) from v2_legacy_source_envelopes) as envelopes,(select count(*) from v2_legacy_migration_batch_items) as items,(select count(*) from v2_source_items) as sources,(select count(*) from v2_legacy_source_mappings) as mappings").first();
    const batch = await db.prepare("select state_revision,status,control_status from v2_legacy_migration_batches where id='quarantine-source'").first<{ state_revision: number; status: string; control_status: string }>();

    const result = await repository.quarantineBatch({ importBatchId: "quarantine-source", expectedRevision: batch!.state_revision, idempotencyKey: "source-quarantine-key", reason: "운영 검증을 위해 숨김", now: "2026-08-28T08:01:00.000Z" });
    expect(result).toMatchObject({ disposition: "quarantined", batch: { status: "succeeded", controlStatus: "quarantined", stateRevision: batch!.state_revision + 1 }, reconciliation: { structurally_valid: true, complete: false, source_only_count: 1 } });
    expect(await db.prepare("select status,activation_batch_id from v2_legacy_source_mappings where legacy_id='quarantine-source-1'").first()).toEqual({ status: "source_only", activation_batch_id: null });
    expect(await db.prepare("select lifecycle_status from v2_objects where id=(select projected_object_id from v2_legacy_source_mappings where legacy_id='quarantine-source-1')").first()).toEqual({ lifecycle_status: "archived" });
    expect(await db.prepare("select (select count(*) from v2_legacy_source_envelopes) as envelopes,(select count(*) from v2_legacy_migration_batch_items) as items,(select count(*) from v2_source_items) as sources,(select count(*) from v2_legacy_source_mappings) as mappings").first()).toEqual(before);

    await expect(repository.quarantineBatch({ importBatchId: "quarantine-source", expectedRevision: batch!.state_revision, idempotencyKey: "source-quarantine-key", reason: "  운영 검증을 위해 숨김  " })).resolves.toMatchObject({ disposition: "replayed", batch: { controlStatus: "quarantined" } });
    await expect(repository.quarantineBatch({ importBatchId: "quarantine-source", expectedRevision: batch!.state_revision, idempotencyKey: "source-quarantine-key", reason: "different reason" })).rejects.toMatchObject({ code: "legacy_quarantine_idempotency_conflict" });
    await expect(repository.quarantineBatch({ importBatchId: "quarantine-source", expectedRevision: batch!.state_revision + 1, idempotencyKey: "source-quarantine-key", reason: "운영 검증을 위해 숨김" })).rejects.toMatchObject({ code: "legacy_quarantine_idempotency_conflict" });
    await expect(repository.quarantineBatch({ importBatchId: "quarantine-source", expectedRevision: batch!.state_revision + 1, idempotencyKey: "different-key", reason: "conflict" })).rejects.toMatchObject({ code: "legacy_quarantine_idempotency_conflict" });
    await expect(new D1LegacyMigrationRepository(db, "user-b", { legacyReadOnly: true }).quarantineBatch({ importBatchId: "quarantine-source", expectedRevision: batch!.state_revision + 1, idempotencyKey: "cross-user", reason: "must not see it" })).rejects.toMatchObject({ code: "legacy_batch_not_found" });
    expect(await db.prepare("select count(*) as value from v2_legacy_quarantine_assertions").first()).toEqual({ value: 0 });
  });

  test("recovers knowledge-pending mappings, preserves hidden knowledge, and terminates an orphaned checking gate", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('pending-quarantine-1','user-a','첫 지식 후보','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z'),('pending-quarantine-2','user-a','둘째 지식 후보','pending',null,null,null,null,null,'2026-08-28T00:01:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "pending-quarantine-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T08:10:00.000Z" });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "pending-quarantine-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T08:11:00.000Z" })).resolves.toMatchObject({ batchPrepared: true });
    await expect(repository.runApprovedBatch({ table: "quick_captures", importBatchId: "pending-quarantine-knowledge", mode: "knowledge", expectedDryRunHash: dryRun.dryRunHash, now: "2026-08-28T08:12:00.000Z" })).resolves.toMatchObject({ processed: 1, nextOffset: 1, complete: false });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where activation_batch_id='pending-quarantine-knowledge' and status='knowledge_pending'").first()).toEqual({ value: 1 });
    db.exec("update v2_legacy_preservation_gates set status='checking',failure_code=null,failure_detail=null,finished_at=null where target_batch_id='pending-quarantine-knowledge'");
    const beforeKnowledge = await db.prepare("select (select count(*) from v2_object_type_assignments) as assignments,(select count(*) from v2_property_values) as properties,(select count(*) from v2_evidence_refs) as evidence").first();
    const batch = await db.prepare("select state_revision from v2_legacy_migration_batches where id='pending-quarantine-knowledge'").first<{ state_revision: number }>();

    const result = await repository.quarantineBatch({ importBatchId: "pending-quarantine-knowledge", expectedRevision: batch!.state_revision, idempotencyKey: "pending-quarantine-key", reason: "중단된 지식 승격 복구", now: "2026-08-28T08:13:00.000Z" });
    expect(result).toMatchObject({ disposition: "quarantined", batch: { status: "running", controlStatus: "quarantined" }, preservationGate: { status: "failed", failureCode: "legacy_batch_quarantined" } });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where activation_batch_id='pending-quarantine-knowledge' or status='knowledge_pending'").first()).toEqual({ value: 0 });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where legacy_id like 'pending-quarantine-%' and status='source_only'").first()).toEqual({ value: 2 });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status<>'archived'").first()).toEqual({ value: 0 });
    expect(await db.prepare("select (select count(*) from v2_object_type_assignments) as assignments,(select count(*) from v2_property_values) as properties,(select count(*) from v2_evidence_refs) as evidence").first()).toEqual(beforeKnowledge);
  });

  test("rolls a succeeded knowledge batch back to the previous source-only mapping without guessing", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('restore-source-only-1','user-a','첫 버전','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const firstDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-source-only-v1", mode: "source_only", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T08:20:00.000Z" });
    const firstMapping = await db.prepare("select id,projected_object_id from v2_legacy_source_mappings where legacy_id='restore-source-only-1'").first<{ id: string; projected_object_id: string }>();
    db.exec("update quick_captures set raw_text='둘째 버전' where id='restore-source-only-1'");
    const secondDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-source-only-v2", mode: "source_only", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T08:21:00.000Z" });
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-source-only-knowledge-v2", mode: "knowledge", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T08:22:00.000Z" });
    expect(await db.prepare("select status,superseded_from_status from v2_legacy_source_mappings where id=?").bind(firstMapping!.id).first()).toEqual({ status: "superseded", superseded_from_status: "source_only" });
    const batch = await db.prepare("select state_revision from v2_legacy_migration_batches where id='restore-source-only-knowledge-v2'").first<{ state_revision: number }>();

    const result = await repository.quarantineBatch({ importBatchId: "restore-source-only-knowledge-v2", expectedRevision: batch!.state_revision, idempotencyKey: "restore-source-only-key", reason: "이전 source-only 상태 복구", now: "2026-08-28T08:23:00.000Z" });
    expect(result.batch.quarantine?.receipt).toMatchObject({ priorSourceOnlyRestored: 1, priorProjectedRestored: 0, currentMappingsReverted: 1 });
    expect(await db.prepare("select status,superseded_from_status,superseded_by_mapping_id from v2_legacy_source_mappings where id=?").bind(firstMapping!.id).first()).toEqual({ status: "source_only", superseded_from_status: null, superseded_by_mapping_id: null });
    expect(await db.prepare("select count(*) as value from v2_legacy_source_mappings where legacy_id='restore-source-only-1' and status='source_only'").first()).toEqual({ value: 2 });
    expect(await db.prepare("select count(*) as value from v2_objects where lifecycle_status<>'archived'").first()).toEqual({ value: 0 });

  });

  test("restores the previously projected mapping and keeps rolled-back knowledge attached to an archived object", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('restore-projected-1','user-a','활성 첫 버전','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const firstDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-projected-source-v1", mode: "source_only", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T08:30:00.000Z" });
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-projected-knowledge-v1", mode: "knowledge", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T08:31:00.000Z" });
    const old = await db.prepare("select id,projected_object_id from v2_legacy_source_mappings where legacy_id='restore-projected-1' and status='projected'").first<{ id: string; projected_object_id: string }>();
    db.exec("update quick_captures set raw_text='활성 둘째 버전' where id='restore-projected-1'");
    const secondDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-projected-source-v2", mode: "source_only", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T08:32:00.000Z" });
    await runToComplete({ repository, table: "quick_captures", batchId: "restore-projected-knowledge-v2", mode: "knowledge", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T08:33:00.000Z" });
    const current = await db.prepare("select id,projected_object_id from v2_legacy_source_mappings where legacy_id='restore-projected-1' and status='projected'").first<{ id: string; projected_object_id: string }>();
    expect(await db.prepare("select status,superseded_from_status from v2_legacy_source_mappings where id=?").bind(old!.id).first()).toEqual({ status: "superseded", superseded_from_status: "projected" });
    const knowledgeRows = await db.prepare("select (select count(*) from v2_object_type_assignments where object_id=?) as assignments,(select count(*) from v2_evidence_refs where target_id like ?) as evidence").bind(current!.projected_object_id, `%${current!.projected_object_id}%`).first();
    const batch = await db.prepare("select state_revision from v2_legacy_migration_batches where id='restore-projected-knowledge-v2'").first<{ state_revision: number }>();

    const document = await db.prepare("select capture_id,current_revision_id from v2_documents where object_id=?").bind(current!.projected_object_id).first<{ capture_id: string; current_revision_id: string }>();
    db.exec(`
      insert into v2_processing_jobs
        (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,lease_owner,lease_expires_at,input_revision_id,input_hash,created_at)
      values ('quarantine-invocation-job','user-a','${document!.capture_id}','${current!.projected_object_id}','analyze','running','interactive','quarantine-invocation',1,4,'2026-08-28T08:34:00.000Z','quarantine-worker','9999-12-31T23:59:59.999Z','${document!.current_revision_id}','quarantine-input','2026-08-28T08:33:30.000Z');
      insert into v2_processing_runs
        (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
      values ('quarantine-invocation-run','quarantine-invocation-job','user-a','main_analyzer','fake:main_analyzer','analysis-v1','analysis-v1','registry-v1','config-v1','quarantine-input','running','2026-08-28T08:33:31.000Z');
      insert into v2_provider_invocation_leases
        (job_id,run_id,user_id,object_id,lease_owner,stage,expires_at,acquired_at,updated_at)
      values ('quarantine-invocation-job','quarantine-invocation-run','user-a','${current!.projected_object_id}','quarantine-worker','analyze','9999-12-31T23:59:59.999Z','2026-08-28T08:33:32.000Z','2026-08-28T08:33:32.000Z');
    `);
    await expect(repository.quarantineBatch({ importBatchId: "restore-projected-knowledge-v2", expectedRevision: batch!.state_revision, idempotencyKey: "restore-projected-key", reason: "이전 projected 상태 복구", now: "2026-08-28T08:34:00.000Z" })).rejects.toMatchObject({ code: "legacy_quarantine_invocation_conflict" });
    expect(await db.prepare("select control_status from v2_legacy_migration_batches where id='restore-projected-knowledge-v2'").first()).toEqual({ control_status: "complete" });
    expect(await db.prepare("select status from v2_legacy_source_mappings where id=?").bind(current!.id).first()).toEqual({ status: "projected" });
    await db.prepare("delete from v2_provider_invocation_leases where job_id='quarantine-invocation-job'").run();

    const result = await repository.quarantineBatch({ importBatchId: "restore-projected-knowledge-v2", expectedRevision: batch!.state_revision, idempotencyKey: "restore-projected-key", reason: "이전 projected 상태 복구", now: "2026-08-28T08:34:00.000Z" });
    expect(result.batch.quarantine?.receipt).toMatchObject({ priorSourceOnlyRestored: 0, priorProjectedRestored: 1, currentMappingsReverted: 1 });
    expect(await db.prepare("select status,superseded_from_status,superseded_by_mapping_id from v2_legacy_source_mappings where id=?").bind(old!.id).first()).toEqual({ status: "projected", superseded_from_status: null, superseded_by_mapping_id: null });
    expect(await db.prepare("select lifecycle_status from v2_objects where id=?").bind(old!.projected_object_id).first()).toEqual({ lifecycle_status: "active" });
    expect(await db.prepare("select status,activation_batch_id from v2_legacy_source_mappings where id=?").bind(current!.id).first()).toEqual({ status: "source_only", activation_batch_id: null });
    expect(await db.prepare("select lifecycle_status from v2_objects where id=?").bind(current!.projected_object_id).first()).toEqual({ lifecycle_status: "archived" });
    expect(await db.prepare("select (select count(*) from v2_object_type_assignments where object_id=?) as assignments,(select count(*) from v2_evidence_refs where target_id like ?) as evidence").bind(current!.projected_object_id, `%${current!.projected_object_id}%`).first()).toEqual(knowledgeRows);
  });

  test("refuses rollback when a superseded mapping has lost its recorded prior status", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('missing-basis-1','user-a','이전 상태 근거','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const firstDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "missing-basis-source-v1", mode: "source_only", dryRunHash: firstDryRun.dryRunHash, now: "2026-08-28T08:35:00.000Z" });
    db.exec("update quick_captures set raw_text='새 상태' where id='missing-basis-1'");
    const secondDryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "missing-basis-source-v2", mode: "source_only", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T08:36:00.000Z" });
    await runToComplete({ repository, table: "quick_captures", batchId: "missing-basis-knowledge-v2", mode: "knowledge", dryRunHash: secondDryRun.dryRunHash, now: "2026-08-28T08:37:00.000Z" });
    db.exec("update v2_legacy_source_mappings set superseded_from_status=null where legacy_id='missing-basis-1' and status='superseded'");
    const batch = await db.prepare("select state_revision from v2_legacy_migration_batches where id='missing-basis-knowledge-v2'").first<{ state_revision: number }>();
    const before = await db.prepare("select (select count(*) from v2_legacy_source_mappings where status='superseded') as superseded,(select count(*) from v2_objects where lifecycle_status='active') as active,(select count(*) from v2_objects where lifecycle_status='archived') as archived").first();

    await expect(repository.quarantineBatch({ importBatchId: "missing-basis-knowledge-v2", expectedRevision: batch!.state_revision, idempotencyKey: "missing-basis-key", reason: "근거 없는 복원 금지" })).rejects.toMatchObject({ code: "legacy_quarantine_superseded_basis_conflict" });
    expect(await db.prepare("select (select count(*) from v2_legacy_source_mappings where status='superseded') as superseded,(select count(*) from v2_objects where lifecycle_status='active') as active,(select count(*) from v2_objects where lifecycle_status='archived') as archived").first()).toEqual(before);
    expect(await db.prepare("select control_status from v2_legacy_migration_batches where id='missing-basis-knowledge-v2'").first()).toEqual({ control_status: "complete" });
  });

  test("uses the quarantine assertion fence so a stale revision leaves every child untouched", async () => {
    db.exec("create table quick_captures (id text primary key,user_id text not null,raw_text text not null,status text,suggested_domain text,suggested_fields text,confidence real,routed_entity_type text,routed_entity_id text,created_at text not null); insert into quick_captures values ('stale-quarantine-1','user-a','활성 상태를 유지한다','pending',null,null,null,null,null,'2026-08-28T00:00:00.000Z')");
    const repository = lockedRepository();
    const dryRun = await repository.createDryRun("quick_captures");
    await runToComplete({ repository, table: "quick_captures", batchId: "stale-quarantine-source", mode: "source_only", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T08:40:00.000Z" });
    await runToComplete({ repository, table: "quick_captures", batchId: "stale-quarantine-knowledge", mode: "knowledge", dryRunHash: dryRun.dryRunHash, now: "2026-08-28T08:41:00.000Z" });
    const sourceBatch = await db.prepare("select state_revision from v2_legacy_migration_batches where id='stale-quarantine-source'").first<{ state_revision: number }>();
    await expect(repository.quarantineBatch({ importBatchId: "stale-quarantine-source", expectedRevision: sourceBatch!.state_revision, idempotencyKey: "source-owner-conflict", reason: "later knowledge owns this mapping" })).rejects.toMatchObject({ code: "legacy_quarantine_mapping_activation_conflict" });
    const batch = await db.prepare("select state_revision from v2_legacy_migration_batches where id='stale-quarantine-knowledge'").first<{ state_revision: number }>();
    const before = await db.prepare("select m.status,m.activation_batch_id,o.lifecycle_status,(select count(*) from v2_object_type_assignments where object_id=m.projected_object_id) as assignments from v2_legacy_source_mappings m join v2_objects o on o.id=m.projected_object_id where m.legacy_id='stale-quarantine-1'").first();
    db.beforeBatch = () => {
      db.beforeBatch = null;
      db.sqlite.prepare("update v2_legacy_migration_batches set state_revision=state_revision+1 where id='stale-quarantine-knowledge'").run();
    };

    await expect(repository.quarantineBatch({ importBatchId: "stale-quarantine-knowledge", expectedRevision: batch!.state_revision, idempotencyKey: "stale-quarantine-key", reason: "CAS 경합 검증", now: "2026-08-28T08:42:00.000Z" })).rejects.toMatchObject({ code: "legacy_quarantine_revision_conflict" });
    expect(await db.prepare("select m.status,m.activation_batch_id,o.lifecycle_status,(select count(*) from v2_object_type_assignments where object_id=m.projected_object_id) as assignments from v2_legacy_source_mappings m join v2_objects o on o.id=m.projected_object_id where m.legacy_id='stale-quarantine-1'").first()).toEqual(before);
    expect(await db.prepare("select control_status,quarantine_idempotency_key from v2_legacy_migration_batches where id='stale-quarantine-knowledge'").first()).toEqual({ control_status: "complete", quarantine_idempotency_key: null });
    expect(await db.prepare("select count(*) as value from v2_legacy_quarantine_assertions").first()).toEqual({ value: 0 });
  });
});
