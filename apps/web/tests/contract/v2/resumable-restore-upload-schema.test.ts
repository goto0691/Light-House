import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../../../migrations/0024_v2_resumable_restore_uploads.sql", import.meta.url));
const hash = "a".repeat(64);
const partBytes = 8 * 1024 * 1024;
let db: DatabaseSync;

async function applyMigration() {
  const sql = await readFile(migrationPath, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}

function insertUpload(id = "upload-a", userId = "user-a") {
  db.prepare(`insert into v2_restore_uploads
    (id,user_id,idempotency_key,file_name,expected_size_bytes,expected_archive_sha256,expected_part_count,final_object_key,created_at,last_progress_at,expires_at)
    values (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, `idem-${id}`, "archive.zip", partBytes + 1, hash, 2, `users/test/${id}.zip`, "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2026-08-29T00:00:00.000Z");
}

function insertPart(uploadId: string, userId: string, partNumber: number, sizeBytes: number) {
  db.prepare(`insert into v2_restore_upload_parts (upload_id,user_id,part_number,size_bytes,sha256,temp_object_key,created_at) values (?,?,?,?,?,?,?)`)
    .run(uploadId, userId, partNumber, sizeBytes, hash, `users/test/${uploadId}/parts/${partNumber}`, "2026-08-28T00:01:00.000Z");
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
      source_kind text not null,
      source_object_key text
    );
  `);
  await applyMigration();
});

afterEach(() => db.close());

describe("0024 resumable restore upload schema", () => {
  test("applies terminal completeness guards to inserts as well as updates", () => {
    expect(() => db.prepare(`insert into v2_restore_uploads
      (id,user_id,idempotency_key,file_name,expected_size_bytes,expected_archive_sha256,expected_part_count,status,phase,final_object_key,created_at,last_progress_at,expires_at)
      values ('insert-staged','user-a','insert-staged','archive.zip',1,?,1,'staged','complete','object','now','now','later')`).run(hash))
      .toThrow(/restore_upload_staged_incomplete/);
    expect(() => db.prepare(`insert into v2_restore_uploads
      (id,user_id,idempotency_key,file_name,expected_size_bytes,expected_archive_sha256,expected_part_count,status,phase,final_object_key,multipart_upload_id,created_at,last_progress_at,expires_at,finished_at)
      values ('insert-aborted','user-a','insert-aborted','archive.zip',1,?,1,'aborted','complete','object','still-open','now','now','later','now')`).run(hash))
      .toThrow(/restore_upload_terminal_incomplete/);
  });

  test("enforces ZIP32 size, fixed non-final parts, owner, and receiving state", () => {
    expect(() => db.prepare(`insert into v2_restore_uploads
      (id,user_id,idempotency_key,file_name,expected_size_bytes,expected_archive_sha256,expected_part_count,final_object_key,created_at,last_progress_at,expires_at)
      values ('too-large','user-a','too-large','archive.zip',4294967296,?,512,'object','now','now','later')`).run(hash))
      .toThrow(/restore_upload_size_invalid/);

    insertUpload();
    expect(() => insertPart("upload-a", "user-a", 1, 1)).toThrow(/restore_upload_part_size_invalid/);
    expect(() => insertPart("upload-a", "user-b", 1, partBytes)).toThrow(/restore_upload_part_user_mismatch/);
    insertPart("upload-a", "user-a", 1, partBytes);
    expect(() => db.prepare("update v2_restore_upload_parts set temp_object_key='users/test/other' where upload_id='upload-a' and part_number=1").run())
      .toThrow(/restore_upload_part_receipt_immutable/);
    insertPart("upload-a", "user-a", 2, 1);
    db.prepare("update v2_restore_uploads set status='verifying',phase='hashing' where id='upload-a'").run();
    expect(() => insertPart("upload-a", "user-a", 2, 1)).toThrow(/restore_upload_part_state_invalid|UNIQUE/);
    expect(() => db.prepare("update v2_restore_uploads set status='assembling',phase='receiving' where id='upload-a'").run()).toThrow(/restore_upload_state_invalid/);
  });

  test("only allows staged after handoff, full hash progress, multipart receipts, and temp cleanup", () => {
    insertUpload();
    insertPart("upload-a", "user-a", 1, partBytes);
    insertPart("upload-a", "user-a", 2, 1);
    expect(() => db.prepare("update v2_restore_uploads set status='staged',phase='complete',finished_at='now' where id='upload-a'").run())
      .toThrow(/restore_upload_staged_incomplete/);

    db.prepare("insert into v2_restore_batches (id,user_id,idempotency_key,source_kind,source_object_key) values ('restore-a','user-a','restore','archive','users/test/upload-a.zip')").run();
    db.prepare("update v2_restore_upload_parts set multipart_etag='etag',temp_deleted_at='now' where upload_id='upload-a'").run();
    db.prepare(`update v2_restore_uploads set status='staged',phase='complete',restore_batch_id='restore-a',uploaded_bytes=?,hash_verified_bytes=?,finished_at='now' where id='upload-a'`)
      .run(partBytes + 1, partBytes + 1);
    expect(db.prepare("select status,restore_batch_id from v2_restore_uploads where id='upload-a'").get()).toEqual({ status: "staged", restore_batch_id: "restore-a" });
  });

  test("only allows aborted terminal state after multipart and temporary objects are gone", () => {
    insertUpload();
    insertPart("upload-a", "user-a", 1, partBytes);
    expect(() => db.prepare("update v2_restore_uploads set status='aborted',phase='complete',finished_at='now' where id='upload-a'").run())
      .toThrow(/restore_upload_terminal_incomplete/);
    db.prepare("update v2_restore_upload_parts set temp_deleted_at='now' where upload_id='upload-a'").run();
    db.prepare("update v2_restore_uploads set status='aborted',phase='complete',finished_at='now' where id='upload-a'").run();
    expect(db.prepare("select status from v2_restore_uploads where id='upload-a'").get()).toEqual({ status: "aborted" });
  });
});
