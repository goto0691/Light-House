import { afterEach, describe, expect, test } from "vitest";

import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, envelopeCanonicalRow, exportRootHash, sha256Hex, type ExportFileManifestV1, type ExportScopeV1 } from "@/lib/v2/portability/portability-contract-v1";
import { advanceRestoreWorkflow, approveRestoreWorkflow, getRestoreWorkflow, requestRestoreRollback, stageArchiveRestore } from "@/lib/v2/portability/resumable-restore-v2";
import { verifyExportBundle } from "@/lib/v2/portability/restore-bundle-v1";
import { createStoredZipStream } from "@/lib/v2/portability/zip-stream-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

const owner = "link-owner", secondOwner = "other-owner", now = "2026-10-03T00:00:00.000Z";
const databases: LinkSqlite[] = [];
type View = Awaited<ReturnType<typeof getRestoreWorkflow>>;
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });

/** Actual ZIP bytes and coordinator SQL; no workerd, network or provider. */
function memoryBucket(): R2BucketBinding {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; options: Parameters<R2BucketBinding["put"]>[2] }>();
  const metadata = (key: string, object: NonNullable<ReturnType<typeof objects.get>>) => ({
    key, size: object.bytes.byteLength, checksums: { sha256: new Uint8Array(Buffer.from(sha256Hex(object.bytes), "hex")).buffer },
    httpMetadata: object.options?.httpMetadata, customMetadata: object.options?.customMetadata,
  });
  return {
    async put(key, value, options) {
      const object = { bytes: new Uint8Array(await new Response(value as BodyInit).arrayBuffer()), options };
      objects.set(key, object); return metadata(key, object);
    },
    async head(key) { const object = objects.get(key); return object ? metadata(key, object) : null; },
    async get(key, options) {
      const object = objects.get(key); if (!object) return null;
      const bytes = options?.range ? object.bytes.slice(options.range.offset, options.range.offset + options.range.length) : object.bytes.slice();
      return { ...metadata(key, object), body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer };
    },
    async delete(keys) { for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key); },
  };
}

async function archive(db: LinkSqlite) {
  const scope: ExportScopeV1 = { objects: "all", privacyLevels: ["normal", "sensitive"], includeTrash: true, includeHistory: true, includeOriginals: false };
  const payloads = new Map<string, Uint8Array>(), files: ExportFileManifestV1[] = [], counts: Record<string, number> = {};
  for (const descriptor of CANONICAL_TABLES_V1) {
    const query = descriptor.query(owner, scope), rows = (await db.prepare(query.sql).bind(...query.bindings).all<Record<string, unknown>>()).results;
    const bytes = new TextEncoder().encode(rows.map((row) => JSON.stringify(envelopeCanonicalRow(row, "repeat-workflow"))).join("\n") + (rows.length ? "\n" : ""));
    payloads.set(descriptor.path, bytes);
    files.push({ path: descriptor.path, bytes: bytes.length, sha256: sha256Hex(bytes), records: rows.length, mediaType: "application/x-ndjson" });
    counts[descriptor.table] = rows.length;
  }
  const readme = new TextEncoder().encode("# Synthetic workflow archive\n");
  payloads.set("README.md", readme); files.push({ path: "README.md", bytes: readme.length, sha256: sha256Hex(readme), records: 1, mediaType: "text/markdown" });
  const manifest = { format: "lighthouse-export", version: 1, profile: "migration", exportId: "repeat-workflow", createdAt: now,
    sourceAppVersion: "sqlite-repeat-contract", schemaVersion: "v2-032", userTimezone: "UTC", scope, counts, files,
    rootHash: exportRootHash(files), baseSequence: 0, endSequence: 0, warnings: [] };
  payloads.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
  payloads.set("checksums.sha256", new TextEncoder().encode(files.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n"));
  const bytes = new Uint8Array(await new Response(createStoredZipStream((async function* () {
    for (const [path, source] of payloads) yield { path, source };
  })())).arrayBuffer());
  const verified = verifyExportBundle(bytes);
  return { bytes, rowCount: [...verified.rowsByTable.values()].reduce((total, rows) => total + rows.length, 0) };
}

async function until(db: LinkSqlite, bucket: R2BucketBinding, userId: string, view: View, status: string) {
  for (let step = 0; step < 500 && view.status !== status; step += 1) {
    view = await advanceRestoreWorkflow({ db, bucket, userId, batchId: view.batchId, now });
  }
  expect(view.status).toBe(status); return view;
}

async function plan(db: LinkSqlite, bucket: R2BucketBinding, bytes: Uint8Array, userId: string, key: string) {
  const staged = await stageArchiveRestore({ db, bucket, userId, idempotencyKey: key, archiveSha256: sha256Hex(bytes),
    fileName: "synthetic.zip", body: bytes, sizeBytes: bytes.byteLength, now });
  return until(db, bucket, userId, staged, "awaiting_approval");
}

async function apply(db: LinkSqlite, bucket: R2BucketBinding, userId: string, view: View) {
  const approved = await approveRestoreWorkflow({ db, userId, batchId: view.batchId,
    expectedDryRunHash: view.dryRun!.dryRunHash, expectedRevision: view.stateRevision, now });
  return until(db, bucket, userId, approved, "succeeded");
}

function canonicalState(db: LinkSqlite) {
  return canonicalJson(CANONICAL_TABLES_V1.map((descriptor) => [descriptor.table,
    db.sql.prepare(`select * from ${descriptor.table} order by ${descriptor.primaryKey.map((key) => `"${key}"`).join(",")}`).all()]));
}

async function fixture(snapshot = true) {
  const source = new LinkSqlite(32), target = new LinkSqlite(32), bucket = memoryBucket(); databases.push(source, target);
  const record = await seedLinkRecord(source, { rawText: "  immutable 원문 👀\r\n--ar 3:2\n", snapshot });
  for (const [index, action] of ["accept", "reject"].entries()) {
    const id = `review-${index}`;
    source.sql.prepare(`insert into v2_review_items(id,user_id,object_id,kind,status,payload_json,created_at,resolved_at)
      values (?,?,?,'analysis_review','resolved',?,?,?)`).run(id, owner, record.capture.objectId, JSON.stringify({ revision: index + 1, action }), now, now);
    source.sql.prepare(`insert into v2_review_receipts(id,review_item_id,user_id,object_id,action,target_kind,target_id,result_status,created_at)
      values (?,?,?,?,?,'review_item',?,?,?)`).run(`receipt-${index}`, id, owner, record.capture.objectId, action, id, action === "accept" ? "accepted" : "rejected", now);
  }
  const exported = await archive(source);
  await apply(target, bucket, owner, await plan(target, bucket, exported.bytes, owner, "occupy"));
  const originalPlan = await plan(target, bucket, exported.bytes, secondOwner, "collision-original");
  const originalResult = await apply(target, bucket, secondOwner, originalPlan);
  const objectId = String(target.sql.prepare("select id from v2_objects where user_id=? and object_kind='document'").get(secondOwner)!.id);
  return { source, target, bucket, record, ...exported, originalPlan, originalResult, objectId };
}

describe("public restore workflow after an owner collision", () => {
  test("a new restore key reuses the whole previously forked graph without duplicates or source/review changes", async () => {
    const f = await fixture(), before = canonicalState(f.target);
    const repeated = await plan(f.target, f.bucket, f.bytes, secondOwner, "collision-repeat");
    expect(repeated.dryRun!.counts).toEqual({ create: 0, reuse: f.rowCount, fork: 0, conflict: 0, invalid: 0 });
    await apply(f.target, f.bucket, secondOwner, repeated);
    expect(canonicalState(f.target)).toBe(before);
    expect(f.target.sql.prepare("select raw_text from v2_source_items where user_id=? and item_kind='url'").get(secondOwner)).toEqual({ raw_text: f.record.rawText });
    expect(f.target.sql.prepare("select payload_json from v2_review_items where user_id=? order by payload_json").all(secondOwner))
      .toEqual(f.source.sql.prepare("select payload_json from v2_review_items order by payload_json").all());
    const receipts = f.target.sql.prepare("select review_item_id,target_id from v2_review_receipts where user_id=?").all(secondOwner);
    expect(receipts).toHaveLength(2); for (const receipt of receipts) expect(receipt.target_id).toBe(receipt.review_item_id);
    expect(f.target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test("the same original gesture returns the existing succeeded workflow and still rejects another archive", async () => {
    const f = await fixture(), before = canonicalState(f.target);
    const repeated = await stageArchiveRestore({ db: f.target, bucket: f.bucket, userId: secondOwner, idempotencyKey: "collision-original",
      archiveSha256: sha256Hex(f.bytes), fileName: "synthetic.zip", body: f.bytes, sizeBytes: f.bytes.byteLength, now });
    expect(repeated).toMatchObject({ batchId: f.originalResult.batchId, status: "succeeded" });
    await expect(stageArchiveRestore({ db: f.target, bucket: f.bucket, userId: secondOwner, idempotencyKey: "collision-original",
      archiveSha256: "a".repeat(64), fileName: "synthetic.zip", body: f.bytes, sizeBytes: f.bytes.byteLength, now }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(canonicalState(f.target)).toBe(before);
  });

  test.each(["content", "owner", "mapping-target", "mapping-owner", "missing-target", "missing-map", "receipt"])(
    "historical mapping cannot authorize reuse after %s drift", async (drift) => {
      const f = await fixture();
      if (drift === "content") f.target.sql.prepare("update v2_documents set title='USER EDIT' where object_id=?").run(f.objectId);
      if (drift === "owner") f.target.sql.prepare("update v2_objects set user_id=? where id=?").run(owner, f.objectId);
      if (drift === "mapping-target") f.target.sql.prepare("update v2_restore_id_mappings set target_id=? where restore_batch_id=? and table_name='v2_objects'").run(f.record.capture.objectId, f.originalResult.batchId);
      if (drift === "mapping-owner") f.target.sql.prepare("update v2_restore_id_mappings set user_id=? where restore_batch_id=? and table_name='v2_objects'").run(owner, f.originalResult.batchId);
      if (drift === "missing-target") f.target.sql.prepare("delete from v2_review_items where user_id=?").run(secondOwner);
      if (drift === "missing-map") f.target.sql.prepare("delete from v2_restore_id_mappings where restore_batch_id=? and table_name='v2_objects'").run(f.originalResult.batchId);
      if (drift === "receipt") f.target.sql.prepare("update v2_restore_rows set source_row_hash=? where restore_batch_id=? and table_name='v2_objects'").run("a".repeat(64), f.originalResult.batchId);
      const before = canonicalState(f.target);
      await expect(plan(f.target, f.bucket, f.bytes, secondOwner, `drift-${drift}`)).rejects.toMatchObject({ code: "restore_conflict" });
      expect(canonicalState(f.target)).toBe(before);
    },
  );

  test("another owner receives its own graph instead of inheriting the previous collision mapping", async () => {
    const f = await fixture(); f.target.sql.exec("insert into users values ('third-owner')");
    const p = await plan(f.target, f.bucket, f.bytes, "third-owner", "third-restore");
    expect(p.dryRun!.counts.fork).toBeGreaterThan(0);
    await apply(f.target, f.bucket, "third-owner", p);
    const id = f.target.sql.prepare("select id from v2_objects where user_id='third-owner' and object_kind='document'").get()!.id;
    expect(id).not.toBe(f.objectId); expect(id).not.toBe(f.record.capture.objectId);
    expect(f.target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test("rolled-back maps are excluded and a new key can restore a new forked graph", async () => {
    // A graph without a live snapshot cycle can be completely removed; graphs
    // with retained dependencies keep the existing rollback conflict policy.
    const f = await fixture(false);
    const requested = await requestRestoreRollback({ db: f.target, userId: secondOwner, batchId: f.originalResult.batchId,
      expectedRevision: f.originalResult.stateRevision, now });
    await until(f.target, f.bucket, secondOwner, requested, "rolled_back");
    expect(f.target.sql.prepare("select count(*) as n from v2_objects where user_id=?").get(secondOwner)).toEqual({ n: 0 });
    const p = await plan(f.target, f.bucket, f.bytes, secondOwner, "restore-after-rollback");
    expect(p.dryRun!.counts.fork).toBeGreaterThan(0); expect(p.dryRun!.counts.conflict).toBe(0);
    await apply(f.target, f.bucket, secondOwner, p);
    expect(f.target.sql.prepare("select id from v2_objects where user_id=? and object_kind='document'").get(secondOwner)!.id).not.toBe(f.objectId);
    expect(f.target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test("a target edited after repeat planning remains preserved by apply-time validation", async () => {
    const f = await fixture(), repeated = await plan(f.target, f.bucket, f.bytes, secondOwner, "repeat-before-edit");
    f.target.sql.prepare("update v2_documents set title='LATER EDIT' where object_id=?").run(f.objectId);
    const before = canonicalState(f.target);
    await expect(apply(f.target, f.bucket, secondOwner, repeated)).rejects.toMatchObject({ code: "restore_conflict" });
    expect(canonicalState(f.target)).toBe(before);
  });

  test("a succeeded repeat receipt cannot reuse targets removed by the original batch rollback", async () => {
    const f = await fixture(false);
    await apply(f.target, f.bucket, secondOwner, await plan(f.target, f.bucket, f.bytes, secondOwner, "reused-before-rollback"));
    const original = await getRestoreWorkflow(f.target, secondOwner, f.originalResult.batchId);
    const requested = await requestRestoreRollback({ db: f.target, userId: secondOwner, batchId: original.batchId,
      expectedRevision: original.stateRevision, now });
    await until(f.target, f.bucket, secondOwner, requested, "rolled_back");
    const before = canonicalState(f.target);
    await expect(plan(f.target, f.bucket, f.bytes, secondOwner, "missing-reused-graph")).rejects.toMatchObject({ code: "restore_conflict" });
    expect(canonicalState(f.target)).toBe(before);
  });
});
