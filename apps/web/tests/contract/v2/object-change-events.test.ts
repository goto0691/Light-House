import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, test } from "vitest";

test("0030 backfills existing parents and tracks inserts, meaningful updates, owner transfers, and deletion", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`pragma foreign_keys=on;
      create table users(id text primary key);
      insert into users values ('owner-a'),('owner-b');
      create table v2_objects(id text primary key,user_id text references users(id) on delete cascade,
        object_kind text,lifecycle_status text,canonical_object_id text,created_at text,updated_at text,deleted_at text);
      create table v2_change_events(sequence integer primary key autoincrement,user_id text references users(id) on delete cascade,
        aggregate_kind text,aggregate_id text,revision_or_version text,operation text,content_hash text,occurred_at text);
      create table v2_processing_outbox(id text primary key,capture_id text,event_type text);
      create unique index uq_v2_outbox_capture_event on v2_processing_outbox(capture_id,event_type);
      insert into v2_objects values ('before','owner-a','entity','active',null,'t0','t0',null);`);
    db.exec(readFileSync(new URL("../../../../../migrations/0030_v2_object_backup_change_events.sql", import.meta.url), "utf8"));
    expect(db.prepare("select aggregate_id,operation from v2_change_events").all()).toEqual([{ aggregate_id: "before", operation: "upsert" }]);
    db.exec(`insert into v2_objects values ('after','owner-a','event','active',null,'t1','t1',null);
      update v2_objects set lifecycle_status='archived',updated_at='t2' where id='after';
      update v2_objects set updated_at=updated_at where id='after';
      update v2_objects set user_id='owner-b',updated_at='t3' where id='after';
      delete from v2_objects where id='after';`);
    expect(db.prepare("select user_id,operation from v2_change_events where aggregate_id='after' order by sequence").all()).toEqual([
      { user_id: "owner-a", operation: "upsert" }, { user_id: "owner-a", operation: "upsert" },
      { user_id: "owner-a", operation: "tombstone" }, { user_id: "owner-b", operation: "upsert" },
      { user_id: "owner-b", operation: "tombstone" },
    ]);
    expect(() => db.exec("delete from users where id='owner-a'")).not.toThrow();
    expect(db.prepare("select count(*) as value from v2_objects where user_id='owner-a'").get()).toEqual({ value: 0 });
    expect(() => db.exec("insert into v2_processing_outbox values ('capture','same','analyze'),('revision','same','analyze')")).not.toThrow();
  } finally {
    db.close();
  }
});
