import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { createRestoreDryRun, importVerifiedBundle, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";

class SqliteStatement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }

  async first<T = Record<string, unknown>>() {
    return (this.statement.get(...this.values) ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>() {
    return { results: this.statement.all(...this.values) as T[] };
  }

  async run() {
    return this.statement.run(...this.values);
  }
}

class SqliteD1 implements D1DatabaseBinding {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(query: string) {
    return new SqliteStatement(this.sqlite.prepare(query));
  }

  async batch<T = unknown>(statements: D1PreparedStatementBinding[]) {
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

  close() {
    this.sqlite.close();
  }
}

const bucket = { delete: async () => undefined } as unknown as R2BucketBinding;
const envelope = (row: Record<string, unknown>) => ({ schema_version: "v2-018", user_scope_export_id: "restore-identity-fixture", ...row });

function bundle(rowsByTable: ReadonlyMap<string, readonly Record<string, unknown>[]>): VerifiedExportBundle {
  return {
    archiveSha256: "a".repeat(64),
    manifest: {
      format: "lighthouse-export",
      version: 1,
      profile: "migration",
      exportId: "restore-identity-fixture",
      createdAt: "2026-08-28T00:00:00.000Z",
      sourceAppVersion: "restore-identity-test",
      schemaVersion: "v2-018",
      userTimezone: "UTC",
      scope: { objects: "all", privacyLevels: ["restricted"], includeTrash: true, includeHistory: true, includeOriginals: false },
      counts: {},
      files: [],
      rootHash: "sha256:fixture",
      baseSequence: 0,
      endSequence: 0,
      warnings: [],
    },
    entries: new Map(),
    rowsByTable,
  };
}

let db: SqliteD1;

beforeEach(() => {
  db = new SqliteD1();
  db.sqlite.exec(`
    create table v2_capture_bundles (
      id text primary key, user_id text not null, draft_id text not null,
      capture_channel text not null, user_note text, ai_enabled integer not null,
      client_timezone text not null, processing_status text not null,
      processing_priority text not null, content_hash text not null,
      template_version_id text, captured_at text not null, committed_at text not null,
      created_at text not null, unique(user_id,draft_id)
    );
    create table v2_restore_batches (
      id text primary key, user_id text not null, idempotency_key text not null,
      archive_sha256 text not null, manifest_root_hash text not null, dry_run_hash text not null,
      status text not null, summary_json text not null, collision_map_json text not null,
      created_at text not null, approved_at text, started_at text, finished_at text,
      rolled_back_at text, failure_code text, unique(user_id,idempotency_key)
    );
    create table v2_restore_rows (
      restore_batch_id text not null, table_name text not null, row_key text not null,
      source_row_hash text not null, disposition text not null, restored_row_key text not null,
      created_at text not null, primary key(restore_batch_id,table_name,row_key)
    );
    create table v2_legacy_migration_batches (
      id text primary key, user_id text not null, legacy_table text not null,
      adapter_version text not null, mode text not null, dry_run_hash text not null,
      schema_snapshot text not null, manifest_json text not null, input_rows integer not null,
      expected_mapping_count integer not null, next_offset integer not null, status text not null,
      reconciliation_status text not null, reconciliation_json text, summary_json text not null,
      failure_code text, created_at text not null, approved_at text not null, started_at text,
      finished_at text, reconciled_at text, state_revision integer not null default 0,
      control_status text not null default 'paused', quarantine_idempotency_key text,
      quarantine_reason text, quarantine_pre_status text, quarantine_pre_control_status text,
      quarantine_receipt_json text, quarantined_at text
    );
    create table v2_legacy_source_envelopes (
      id text primary key, user_id text not null, legacy_table text not null, legacy_id text not null,
      row_json text not null, row_hash text not null, captured_at text not null,
      schema_snapshot text not null, damage_codes_json text not null, import_batch_id text not null,
      unique(user_id,legacy_table,legacy_id,row_hash,schema_snapshot)
    );
    create table v2_legacy_source_mappings (
      id text primary key, user_id text not null, legacy_envelope_id text not null,
      legacy_table text not null, legacy_id text not null, adapter_version text not null,
      source_item_id text, projected_object_id text, projection_kind text not null, status text not null,
      created_at text not null, superseded_at text, superseded_by_mapping_id text,
      target_lifecycle_status text, activation_batch_id text, superseded_from_status text,
      unique(user_id,legacy_envelope_id,adapter_version,projection_kind)
    );
  `);
});

afterEach(() => db.close());

describe("restore alternate identities", () => {
  test("reports mismatched document primary/FK identity as a conflict instead of an isolated fork", async () => {
    db.sqlite.exec(`
      create table v2_objects (id text primary key);
      create table v2_documents (object_id text primary key references v2_objects(id), title text);
      insert into v2_objects values ('same-object');
      insert into v2_documents values ('same-object','Target document must remain');
    `);
    const fixture = bundle(new Map([["v2_documents", [envelope({ object_id: "same-object", title: "Different imported document" })]]]));
    const dryRun = await createRestoreDryRun(db, "user-a", fixture);
    expect(dryRun.counts).toEqual({ create: 0, reuse: 0, fork: 0, conflict: 1, invalid: 0 });
    expect(db.sqlite.prepare("select * from v2_documents").get()).toEqual({ object_id: "same-object", title: "Target document must remain" });
  });

  test("reports an independently migrated capture identity as a dry-run conflict", async () => {
    db.sqlite.exec(`insert into v2_capture_bundles values ('target-capture','user-a','legacy:adapter-v1:legacy-1:row-hash:review','import',null,0,'Asia/Seoul','completed','migration','target-hash',null,'2026-08-28T00:00:00Z','2026-08-28T00:00:00Z','2026-08-28T00:00:00Z');`);
    const fixture = bundle(new Map([
      ["v2_capture_bundles", [envelope({ id: "source-capture", user_id: "source-user", draft_id: "legacy:adapter-v1:legacy-1:row-hash:review", capture_channel: "import", user_note: null, ai_enabled: 0, client_timezone: "Asia/Seoul", processing_status: "completed", processing_priority: "migration", content_hash: "source-hash", template_version_id: null, captured_at: "2026-08-28T00:00:00Z", committed_at: "2026-08-28T00:00:00Z", created_at: "2026-08-28T00:00:00Z" })]],
    ]));

    const dryRun = await createRestoreDryRun(db, "user-a", fixture);
    expect(dryRun.counts).toMatchObject({ conflict: 1, create: 0, reuse: 0, fork: 0 });
    expect(dryRun.warnings).toContain("composite_or_settings_conflicts_require_resolution");
  });

  test("reuses an independently assigned envelope and mapping ID by immutable natural identity", async () => {
    db.sqlite.exec(`
      insert into v2_legacy_source_envelopes values ('target-envelope','user-a','notes','legacy-1','{"body":"same"}','row-hash','2026-08-28T01:00:00Z','schema-hash','[]','target-import');
      insert into v2_legacy_source_mappings (
        id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,
        projected_object_id,projection_kind,status,created_at,superseded_at,
        superseded_by_mapping_id,target_lifecycle_status,activation_batch_id
      ) values ('target-mapping','user-a','target-envelope','notes','legacy-1','adapter-v1',null,null,'archived_only','archived','2026-08-28T01:00:00Z',null,null,null,null);
    `);
    const fixture = bundle(new Map([
      ["v2_legacy_source_envelopes", [envelope({ id: "source-envelope", user_id: "source-user", legacy_table: "notes", legacy_id: "legacy-1", row_json: '{"body":"same"}', row_hash: "row-hash", captured_at: "2026-08-28T00:00:00Z", schema_snapshot: "schema-hash", damage_codes_json: "[]", import_batch_id: "source-import" })]],
      ["v2_legacy_source_mappings", [envelope({ id: "source-mapping", user_id: "source-user", legacy_envelope_id: "source-envelope", legacy_table: "notes", legacy_id: "legacy-1", adapter_version: "adapter-v1", source_item_id: null, projected_object_id: null, projection_kind: "archived_only", status: "archived", created_at: "2026-08-28T00:00:00Z", superseded_at: null, superseded_by_mapping_id: null, target_lifecycle_status: null, activation_batch_id: null })]],
    ]));

    const dryRun = await createRestoreDryRun(db, "user-a", fixture);
    expect(dryRun.counts).toMatchObject({ create: 0, reuse: 2, fork: 0, conflict: 0 });
    const restored = await importVerifiedBundle({ db, bucket, userId: "user-a", bundle: fixture, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "natural-reuse", now: "2026-08-28T02:00:00Z" });
    expect(restored.status).toBe("succeeded");
    expect(db.sqlite.prepare("select count(*) as value from v2_legacy_source_envelopes").get()).toEqual({ value: 1 });
    expect(db.sqlite.prepare("select count(*) as value from v2_legacy_source_mappings").get()).toEqual({ value: 1 });
    expect(db.sqlite.prepare("select restored_row_key from v2_restore_rows where table_name='v2_legacy_source_mappings'").get()).toEqual({ restored_row_key: '{"id":"target-mapping"}' });
  });

  test("rewrites activation_batch_id when a migration batch primary key is forked", async () => {
    db.sqlite.exec(`insert into v2_legacy_migration_batches (
      id,user_id,legacy_table,adapter_version,mode,dry_run_hash,schema_snapshot,manifest_json,
      input_rows,expected_mapping_count,next_offset,status,reconciliation_status,reconciliation_json,
      summary_json,failure_code,created_at,approved_at,started_at,finished_at,reconciled_at
    ) values ('batch-collision','user-a','other_table','other-adapter','source_only','other-dry','other-schema','[]',0,0,0,'approved','pending',null,'{}',null,'2026-08-28T00:00:00Z','2026-08-28T00:00:00Z',null,null,null);`);
    const fixture = bundle(new Map([
      ["v2_legacy_migration_batches", [envelope({ id: "batch-collision", user_id: "source-user", legacy_table: "notes", adapter_version: "adapter-v1", mode: "knowledge", dry_run_hash: "dry", schema_snapshot: "schema", manifest_json: "[]", input_rows: 0, expected_mapping_count: 0, next_offset: 0, status: "approved", reconciliation_status: "pending", reconciliation_json: null, summary_json: "{}", failure_code: null, created_at: "2026-08-28T00:00:00Z", approved_at: "2026-08-28T00:00:00Z", started_at: null, finished_at: null, reconciled_at: null })]],
      ["v2_legacy_source_envelopes", [envelope({ id: "activation-envelope", user_id: "source-user", legacy_table: "notes", legacy_id: "legacy-2", row_json: "{}", row_hash: "row-2", captured_at: "2026-08-28T00:00:00Z", schema_snapshot: "schema", damage_codes_json: "[]", import_batch_id: "batch-collision" })]],
      ["v2_legacy_source_mappings", [envelope({ id: "activation-mapping", user_id: "source-user", legacy_envelope_id: "activation-envelope", legacy_table: "notes", legacy_id: "legacy-2", adapter_version: "adapter-v1", source_item_id: null, projected_object_id: null, projection_kind: "archived_only", status: "archived", created_at: "2026-08-28T00:00:00Z", superseded_at: null, superseded_by_mapping_id: null, target_lifecycle_status: null, activation_batch_id: "batch-collision" })]],
    ]));

    const dryRun = await createRestoreDryRun(db, "user-a", fixture);
    expect(dryRun.counts.fork).toBe(1);
    const restored = await importVerifiedBundle({ db, bucket, userId: "user-a", bundle: fixture, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "activation-rewrite", now: "2026-08-28T02:00:00Z" });
    const importedBatch = db.sqlite.prepare("select id from v2_legacy_migration_batches where legacy_table='notes'").get() as { id: string };
    const mapping = db.sqlite.prepare("select activation_batch_id from v2_legacy_source_mappings where id='activation-mapping'").get();
    expect(importedBatch.id).not.toBe("batch-collision");
    expect(mapping).toEqual({ activation_batch_id: importedBatch.id });
    expect(restored.status).toBe("succeeded");
  });
});
