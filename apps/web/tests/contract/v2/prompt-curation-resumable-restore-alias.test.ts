import { afterEach, describe, expect, test } from "vitest";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { CANONICAL_TABLES_V1, CANONICAL_SOFT_REFERENCES_V1, RESTORE_TABLE_ORDER_V2 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, envelopeCanonicalRow, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { advanceRestoreWorkflow, approveRestoreWorkflow } from "@/lib/v2/portability/resumable-restore-v2";
import { validateReferenceClosure } from "@/lib/v2/portability/restore-bundle-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

type Row = Record<string, unknown>;
const owner = "link-owner", revisions = "v2_link_curation_revisions", items = "v2_link_curation_items";
const now = "2026-09-12T09:00:00.000Z";
const scope = { objects: "all", privacyLevels: ["normal"], includeTrash: true, includeHistory: true, includeOriginals: true } as const;
const databases: LinkSqlite[] = [];
const noObjects = new Proxy({} as R2BucketBinding, { get() { throw new Error("Unexpected object-store access in SQLite coordinator test"); } });
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });

async function fixture() {
  const db = new LinkSqlite(32); databases.push(db);
  const record = await seedLinkRecord(db), projection = record.projection!;
  const firstBasis = { expectedRevisionId: record.capture.revisionId, expectedSnapshotId: projection.snapshot.id,
    expectedManifestHash: projection.snapshot.manifestHash };
  const fragment = await new D1ManualLinkFragmentRepository(db, owner).create(record.capture.objectId, {
    ...firstBasis, memberId: projection.members[0].id, textStart: 0, textEnd: record.rawText.length,
    role: "prompt", idempotencyKey: crypto.randomUUID(),
  });
  const repo = new D1PromptCurationRepository(db, owner);
  const a = (await repo.create(record.capture.objectId, { ...firstBasis, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "Original", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [{ itemKey: "prompt", fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 }], examples: [] },
  })).item;
  const target = await record.snapshots.createSnapshot({ documentId: record.capture.objectId, expectedRevisionId: record.capture.revisionId,
    expectedSnapshotId: projection.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: projection.members.map((member) => member.sourceItemId),
    idempotencyKey: crypto.randomUUID() });
  const plan = await repo.previewMigration(record.capture.objectId, a.groupKey, a.id);
  const b = (await repo.migrate(record.capture.objectId, a.groupKey, a.id, {
    expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId,
    expectedManifestHash: plan.expectedManifestHash, expectedPlanHash: plan.planHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
  })).item;
  const basis = { expectedRevisionId: record.capture.revisionId, expectedSnapshotId: target.snapshot.id,
    expectedManifestHash: target.snapshot.manifestHash };
  const c = (await repo.revise(record.capture.objectId, b.groupKey, { ...basis, expectedCurationRevisionId: b.id,
    expectedCurationRevisionNumber: b.revisionNumber, action: "edit", content: { ...b.content, title: "Edited" }, idempotencyKey: crypto.randomUUID() })).item;
  const d = (await repo.revise(record.capture.objectId, b.groupKey, { ...basis, expectedCurationRevisionId: c.id,
    expectedCurationRevisionNumber: c.revisionNumber, action: "undo", restoreRevisionId: b.id, idempotencyKey: crypto.randomUUID() })).item;
  expect(b).toMatchObject({ basedOnRevisionId: a.id, parentRevisionId: null, snapshotId: target.snapshot.id });
  expect(d).toMatchObject({ basedOnRevisionId: b.id, parentRevisionId: c.id, changeReason: "undo", manifestHash: b.manifestHash });
  expect(b.snapshotId).not.toBe(a.snapshotId);
  expect(c.manifestHash).not.toBe(b.manifestHash);
  const rows = new Map<string, readonly Row[]>();
  for (const descriptor of CANONICAL_TABLES_V1) {
    const query = descriptor.query(owner, scope);
    rows.set(descriptor.table, (await db.prepare(query.sql).bind(...query.bindings).all<Row>()).results);
  }
  validateReferenceClosure(rows);
  return { db, record, a, b, c, d, rows };
}

function removeTargetRevisions(db: LinkSqlite, ids: readonly string[]) {
  // This changes only the in-memory target fixture, after taking the intact
  // source graph. Production immutability triggers remain enabled.
  for (const id of ids) {
    db.sql.prepare(`delete from ${items} where curation_revision_id=?`).run(id);
    db.sql.prepare(`delete from ${revisions} where id=?`).run(id);
  }
  expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
}

function aliasRevisions(rows: ReadonlyMap<string, readonly Row[]>, aliases: ReadonlyMap<string, string>) {
  return new Map(CANONICAL_TABLES_V1.map((descriptor) => [descriptor.table, rows.get(descriptor.table)!.map((original) => {
    const row = { ...original };
    if (descriptor.table === revisions) row.id = aliases.get(String(row.id)) ?? row.id;
    for (const [column, table] of Object.entries({ ...descriptor.foreignKeys, ...CANONICAL_SOFT_REFERENCES_V1[descriptor.table] })) {
      if (table === revisions) row[column] = aliases.get(String(row[column])) ?? row[column];
    }
    return row;
  })]));
}

// Start exactly at the verified/materialized canonical-row checkpoint. These
// tests do not claim ZIP, upload, indexing, R2, backup-delta or workerd coverage.
async function stage(db: LinkSqlite, rows: ReadonlyMap<string, readonly Row[]>) {
  const batchId = crypto.randomUUID();
  const summary = { sourceKind: "archive", counts: { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 },
    tables: RESTORE_TABLE_ORDER_V2.map((descriptor) => ({ table: descriptor.table, rows: 0, create: 0, reuse: 0, fork: 0, conflict: 0 })),
    warnings: [], indexedFiles: 0, verifiedFiles: 0, materializedRows: [...rows.values()].reduce((sum, list) => sum + list.length, 0), rollbackPreserved: 0 };
  await db.prepare(`insert into v2_restore_batches
    (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_size_bytes,cursor_json,state_revision,last_progress_at)
    values (?,?,?,'pending','pending','pending','planning',?,'{}',?,2,'archive',0,'{}',0,?)`)
    .bind(batchId, owner, batchId, canonicalJson(summary), now, now).run();
  for (const [ordinal, descriptor] of RESTORE_TABLE_ORDER_V2.entries()) {
    // Every revision is deliberately staged child-first, including the
    // cross-snapshot migration basis, parent chain and separate undo basis.
    const ordered = descriptor.table === revisions ? [...rows.get(descriptor.table)!].reverse() : rows.get(descriptor.table)!;
    for (const [index, row] of ordered.entries()) {
      const key = Object.fromEntries(descriptor.primaryKey.map((column) => [column, row[column]]));
      await db.prepare(`insert into v2_restore_rows
        (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,source_row_json,candidate_row_json,plan_position,apply_status,rollback_status,r2_status,updated_at)
        values (?,?,?,?,'pending','{}',?,?,'{}',?,'pending','not_applicable','not_applicable',?)`)
        .bind(batchId, descriptor.table, canonicalJson(key), sha256Hex(canonicalJson(row)), now,
          canonicalJson(envelopeCanonicalRow(row, batchId)), ordinal * 1_000_000_000_000 + index, now).run();
    }
  }
  return batchId;
}

function progress(db: LinkSqlite, batchId: string) {
  return db.sql.prepare("select status,dry_run_hash,failure_code,applied_row_count from v2_restore_batches where id=?").get(batchId)!;
}
async function until(db: LinkSqlite, batchId: string, status: string) {
  const count = Number(db.sql.prepare("select count(*) as count from v2_restore_rows where restore_batch_id=?").get(batchId)!.count);
  for (let step = 0; step < count * 4 + 20; step++) {
    if (progress(db, batchId).status === status) return;
    await advanceRestoreWorkflow({ db, bucket: noObjects, userId: owner, batchId, now });
  }
  throw new Error(`Coordinator failed to reach ${status}: ${canonicalJson(progress(db, batchId))}`);
}
function candidate(db: LinkSqlite, batchId: string, id: string) {
  const row = db.sql.prepare("select candidate_row_json from v2_restore_rows where restore_batch_id=? and table_name=? and row_key=?")
    .get(batchId, revisions, canonicalJson({ id }))!;
  return JSON.parse(String(row.candidate_row_json)) as Row;
}
function mapping(db: LinkSqlite, batchId: string, id: string) {
  return db.sql.prepare("select target_id,disposition from v2_restore_id_mappings where restore_batch_id=? and table_name=? and source_id=?")
    .get(batchId, revisions, id)!;
}
async function apply(db: LinkSqlite, batchId: string) {
  await approveRestoreWorkflow({ db, userId: owner, batchId, expectedDryRunHash: String(progress(db, batchId).dry_run_hash), now });
  await until(db, batchId, "succeeded");
}

describe("curation V2 SQL coordinator source/target ID namespace boundary", () => {
  test("plans and applies a reversed actual migrate/edit/undo graph using both self-reference columns", async () => {
    const f = await fixture();
    removeTargetRevisions(f.db, [f.d.id, f.c.id, f.b.id, f.a.id]);
    const batchId = await stage(f.db, f.rows);
    await until(f.db, batchId, "rewriting");
    expect(candidate(f.db, batchId, f.b.id)).toMatchObject({ based_on_revision_id: f.a.id });
    expect(candidate(f.db, batchId, f.d.id)).toMatchObject({ parent_revision_id: f.c.id, based_on_revision_id: f.b.id });
    await until(f.db, batchId, "awaiting_approval");
    await apply(f.db, batchId);
    expect(f.db.sql.prepare(`select * from ${revisions} where id=?`).get(f.d.id))
      .toMatchObject({ parent_revision_id: f.c.id, based_on_revision_id: f.b.id, manifest_hash: f.b.manifestHash });
    expect(f.db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test.each(["rewriting", "applying"] as const)("does not remap an already-resolved basis through a second source alias during %s", async (checkpoint) => {
    const f = await fixture();
    removeTargetRevisions(f.db, [f.d.id, f.c.id]);
    // The same logical B already exists at T. Incoming B's ID is S and
    // incoming C's ID is T: S -> T (reuse), T -> F (PK fork). D refers to
    // both B and C, so both mappings legitimately occur in its bounded read.
    const incomingB = "incoming-migrated-basis", incomingC = f.b.id;
    const rows = aliasRevisions(f.rows, new Map([[f.b.id, incomingB], [f.c.id, incomingC]]));
    validateReferenceClosure(rows);
    const beforeBasis = f.db.sql.prepare(`select * from ${revisions} where id=?`).get(f.b.id);
    const batchId = await stage(f.db, rows);
    await until(f.db, batchId, "rewriting");
    expect(mapping(f.db, batchId, incomingB)).toEqual({ target_id: f.b.id, disposition: "reused" });
    const parent = mapping(f.db, batchId, incomingC);
    expect(parent.disposition).toBe("forked");
    expect(parent.target_id).not.toBe(incomingC);
    expect(candidate(f.db, batchId, f.d.id)).toMatchObject({ parent_revision_id: parent.target_id, based_on_revision_id: f.b.id });
    await until(f.db, batchId, "awaiting_approval");
    if (checkpoint === "rewriting") {
      expect(candidate(f.db, batchId, f.d.id)).toMatchObject({ parent_revision_id: parent.target_id, based_on_revision_id: f.b.id });
    } else {
      await apply(f.db, batchId);
      // A wrong basis can satisfy owner/document/FK constraints, so success
      // and foreign_key_check alone cannot prove historical provenance.
      expect(progress(f.db, batchId).status).toBe("succeeded");
      expect(f.db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
      expect(f.db.sql.prepare(`select * from ${revisions} where id=?`).get(f.b.id)).toEqual(beforeBasis);
      expect(f.db.sql.prepare(`select * from ${revisions} where id=?`).get(f.d.id))
        .toMatchObject({ parent_revision_id: parent.target_id, based_on_revision_id: f.b.id, manifest_hash: f.b.manifestHash });
    }
  });

  test("does not fill a missing staged cross-snapshot basis from an existing target ID", async () => {
    const f = await fixture(), rows = new Map(f.rows);
    rows.set(revisions, rows.get(revisions)!.filter((row) => row.id !== f.a.id));
    rows.set(items, rows.get(items)!.filter((row) => row.curation_revision_id !== f.a.id));
    expect(f.db.sql.prepare(`select id from ${revisions} where id=?`).get(f.a.id)).toBeDefined();
    const before = f.db.sql.prepare(`select * from ${revisions} order by id`).all();
    const batchId = await stage(f.db, rows);
    await expect(until(f.db, batchId, "awaiting_approval")).rejects.toMatchObject({ code: "reference_closure_invalid" });
    expect(progress(f.db, batchId)).toMatchObject({ status: "failed", failure_code: "reference_closure_invalid", applied_row_count: 0 });
    expect(f.db.sql.prepare(`select * from ${revisions} order by id`).all()).toEqual(before);
  });
});
