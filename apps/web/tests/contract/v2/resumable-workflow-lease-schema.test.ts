import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableName } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { v2WorkflowLeaseAssertions } from "../../../../../packages/db/schema/v2";

const migrationPath = fileURLToPath(new URL("../../../../../migrations/0025_v2_workflow_lease_fencing.sql", import.meta.url));
let db: DatabaseSync;

async function applyMigration() {
  const sql = await readFile(migrationPath, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    pragma foreign_keys=on;
    create table users (id text primary key not null);
    insert into users values ('user-a');
    create table v2_backup_snapshots (
      id text primary key not null,user_id text not null,workflow_version integer not null,status text not null,
      lease_token text,lease_expires_at text,state_revision integer not null
    );
    create table v2_restore_batches (
      id text primary key not null,user_id text not null,workflow_version integer not null,status text not null,
      lease_token text,lease_expires_at text,state_revision integer not null
    );
    create table v2_attachment_reservations (
      id text primary key not null,user_id text not null,status text not null,object_key text not null
    );
  `);
  await applyMigration();
});

afterEach(() => db.close());

describe("0025 workflow lease fence schema", () => {
  test("matches the exported Drizzle table contract", () => {
    expect(getTableName(v2WorkflowLeaseAssertions)).toBe("v2_workflow_lease_assertions");
    const columns = db.prepare(`pragma table_info('v2_workflow_lease_assertions')`).all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual([
      "assertion_id", "workflow_kind", "workflow_id", "user_id", "lease_token", "state_revision", "expected_status", "next_status", "created_at",
    ]);
  });

  test("accepts only the current backup lease and requires its fenced progress before release", () => {
    db.exec(`insert into v2_backup_snapshots values ('backup-a','user-a',2,'building','owner-a','later',4);`);
    expect(() => db.prepare(`insert into v2_workflow_lease_assertions values ('bad','backup','backup-a','user-a','stale-owner',4,'building','building','now')`).run())
      .toThrow(/backup_workflow_lease_lost/);
    db.prepare(`insert into v2_workflow_lease_assertions values ('good','backup','backup-a','user-a','owner-a',4,'building','building','now')`).run();
    expect(() => db.prepare(`delete from v2_workflow_lease_assertions where assertion_id='good'`).run())
      .toThrow(/backup_workflow_progress_not_committed/);
    db.prepare(`update v2_backup_snapshots set lease_token=null,lease_expires_at=null,state_revision=5 where id='backup-a'`).run();
    expect(db.prepare(`delete from v2_workflow_lease_assertions where assertion_id='good'`).run().changes).toBe(1);
  });

  test("provides the same token, revision, status, and release contract for restore", () => {
    db.exec(`insert into v2_restore_batches values ('restore-a','user-a',2,'applying','owner-r','later',8);`);
    db.prepare(`insert into v2_workflow_lease_assertions values ('restore-good','restore','restore-a','user-a','owner-r',8,'applying','validating','now')`).run();
    db.prepare(`update v2_restore_batches set status='validating',lease_token=null,lease_expires_at=null,state_revision=9 where id='restore-a'`).run();
    expect(db.prepare(`delete from v2_workflow_lease_assertions where assertion_id='restore-good'`).run().changes).toBe(1);
  });
});
