import { afterEach, describe, expect, test } from "vitest";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { CANONICAL_TABLES_V1, CANONICAL_SOFT_REFERENCES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { createRestoreDryRun, importVerifiedBundle, validateLinkRestoreRow, validateReferenceClosure, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

type Row = Record<string, unknown>;
const revisions = "v2_link_curation_revisions", items = "v2_link_curation_items";
const owner = "link-owner", restoredOwner = "other-owner";
const databases: LinkSqlite[] = [];
const scope = { objects: "all", privacyLevels: ["normal"], includeTrash: true, includeHistory: true, includeOriginals: true } as const;
const rawText = "  exact 👀 prompt\r\n  retained  spacing  ";
function database() { const db = new LinkSqlite(32); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });

async function seed(db: LinkSqlite) {
  const record = await seedLinkRecord(db, { rawText });
  const projection = record.projection!;
  const fragment = await new D1ManualLinkFragmentRepository(db, owner).create(record.capture.objectId, {
    expectedRevisionId: record.capture.revisionId, expectedSnapshotId: projection.snapshot.id,
    expectedManifestHash: projection.snapshot.manifestHash, memberId: projection.members[0].id,
    textStart: 0, textEnd: rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  });
  const repo = new D1PromptCurationRepository(db, owner);
  const first = await repo.create(record.capture.objectId, {
    expectedRevisionId: record.capture.revisionId, expectedSnapshotId: projection.snapshot.id,
    expectedManifestHash: projection.snapshot.manifestHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "이관 원본", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [{ itemKey: "exact-item", fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 }], examples: [] },
  });
  const target = await record.snapshots.createSnapshot({ documentId: record.capture.objectId, expectedRevisionId: record.capture.revisionId,
    expectedSnapshotId: projection.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: projection.members.map((member) => member.sourceItemId),
    idempotencyKey: crypto.randomUUID() });
  const plan = await repo.previewMigration(record.capture.objectId, first.item.groupKey, first.item.id);
  const migrated = await repo.migrate(record.capture.objectId, first.item.groupKey, first.item.id, {
    expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId,
    expectedManifestHash: plan.expectedManifestHash, expectedPlanHash: plan.planHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
  });
  expect(migrated.item).toMatchObject({ revisionNumber: 1, parentRevisionId: null, basedOnRevisionId: first.item.id, snapshotId: target.snapshot.id });
  const rows = new Map<string, readonly Row[]>();
  for (const descriptor of CANONICAL_TABLES_V1) {
    const query = descriptor.query(owner, scope);
    rows.set(descriptor.table, (await db.prepare(query.sql).bind(...query.bindings).all<Row>()).results);
  }
  expect(() => validateReferenceClosure(rows)).not.toThrow();
  return { record, first, migrated, rows };
}

// This is the already-verified canonical input boundary, not ZIP verification
// or a workerd/R2 claim. The separate API portability suite exercises those.
function canonicalInput(rowsByTable: ReadonlyMap<string, readonly Row[]>): VerifiedExportBundle {
  const exportId = "sqlite-migration-closure";
  return { archiveSha256: sha256Hex(canonicalJson([...rowsByTable])), entries: new Map(),
    rowsByTable: new Map([...rowsByTable].map(([table, rows]) => [table, rows.map((row) => ({ ...row, schema_version: "v2-032", user_scope_export_id: exportId }))])),
    manifest: { format: "lighthouse-export", version: 1, profile: "migration", exportId, createdAt: "2026-09-12T00:00:00.000Z",
      sourceAppVersion: "sqlite-contract", schemaVersion: "v2-032", userTimezone: "Asia/Seoul", scope, counts: {}, files: [],
      rootHash: `sha256:${sha256Hex(canonicalJson([...rowsByTable]))}`, baseSequence: 0, endSequence: 0, warnings: [] },
  };
}

function alter(rows: ReadonlyMap<string, readonly Row[]>, table: string, id: string, patch: Row) {
  const result = new Map(rows);
  result.set(table, result.get(table)!.map((row) => row.id === id ? { ...row, ...patch } : row));
  return result;
}

describe("migrated curation canonical closure and collision restore: actual SQLite", () => {
  test("validates both snapshots and new manual fragment while preserving the original basis", async () => {
    const fixture = await seed(database());
    expect(fixture.rows.get(revisions)).toHaveLength(2);
    expect(fixture.rows.get(items)).toHaveLength(2);
    expect(fixture.first.item.content.items[0].fragmentId).not.toBe(fixture.migrated.item.content.items[0].fragmentId);
    expect(fixture.first.item.items[0].fragment.rawText).toBe(rawText);
    expect(fixture.migrated.item.items[0].fragment.rawText).toBe(rawText);
    expect(() => validateReferenceClosure(fixture.rows)).not.toThrow();
  });

  test.each(["missing", "foreign-owner", "foreign-document", "self"] as const)("rejects a %s migration basis before owner rewriting", async (attack) => {
    const fixture = await seed(database());
    let rows = fixture.rows;
    if (attack === "missing" || attack === "self") rows = alter(rows, revisions, fixture.migrated.item.id,
      { based_on_revision_id: attack === "missing" ? "absent-basis" : fixture.migrated.item.id });
    else {
      // Put a substituted basis alongside the intact original so this exercises
      // the migrated row's basis identity, not a broken source snapshot owner.
      const original = rows.get(revisions)!.find((row) => row.id === fixture.first.item.id)!;
      rows = new Map(rows);
      rows.set(revisions, [{ ...original, id: "substituted-basis", ...(attack === "foreign-owner" ? { user_id: restoredOwner } : { document_object_id: "other-document" }) }, ...rows.get(revisions)!]);
      rows = alter(rows, revisions, fixture.migrated.item.id, { based_on_revision_id: "substituted-basis" });
    }
    const child = rows.get(revisions)!.find((row) => row.id === fixture.migrated.item.id)!;
    // Address the migrated row directly: an invalid substituted row must not
    // make this pass merely by failing its own independent validation first.
    expect(() => validateLinkRestoreRow(revisions, child, (table, id) => rows.get(table)?.find((row) => row.id === id)))
      .toThrowError(expect.objectContaining({ code: attack === "missing" ? "reference_closure_invalid" : "link_reference_invalid" }));
    expect(() => validateReferenceClosure(rows)).toThrow();
  });

  test("orders migrated children before a collided source ID safely, remaps the basis, then reuses both groups", async () => {
    const source = await seed(database()), target = database(), occupied = await seed(target);
    const beforeForeign = target.sql.prepare(`select * from ${revisions} order by id`).all();
    const aliases = new Map([[source.first.item.id, occupied.first.item.id], [source.migrated.item.id, "a-migrated-child"]]);
    const rows = new Map<string, readonly Row[]>();
    for (const descriptor of CANONICAL_TABLES_V1) {
      rows.set(descriptor.table, source.rows.get(descriptor.table)!.map((original) => {
        const row = { ...original };
        if (descriptor.table === revisions) row.id = aliases.get(String(row.id)) ?? row.id;
        for (const [column, table] of Object.entries({ ...descriptor.foreignKeys, ...CANONICAL_SOFT_REFERENCES_V1[descriptor.table] })) {
          if (table === revisions) row[column] = aliases.get(String(row[column])) ?? row[column];
        }
        return row;
      }));
    }
    rows.set(revisions, [...rows.get(revisions)!].sort((a, b) => Number(b.id === "a-migrated-child") - Number(a.id === "a-migrated-child")));
    expect(rows.get(revisions)![0].based_on_revision_id).toBe(occupied.first.item.id);
    expect(() => validateReferenceClosure(rows)).not.toThrow();
    const bundle = canonicalInput(rows);
    const dryRun = await createRestoreDryRun(target, restoredOwner, bundle);
    expect(dryRun.counts).toMatchObject({ conflict: 0, invalid: 0, fork: 1 });
    // Text-only fixture: any object-store operation would be a test failure.
    const noObjects = new Proxy({} as R2BucketBinding, { get() { throw new Error("Unexpected R2 access in text-only SQLite restore"); } });
    await expect(importVerifiedBundle({ db: target, bucket: noObjects, userId: restoredOwner, bundle,
      expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "collision-first" })).resolves.toMatchObject({ status: "succeeded" });
    const imported = target.sql.prepare(`select * from ${revisions} where user_id=? order by group_key`).all(restoredOwner) as Row[];
    expect(imported).toHaveLength(2);
    const basis = imported.find((row) => row.group_key === source.first.item.groupKey)!;
    const child = imported.find((row) => row.group_key === source.migrated.item.groupKey)!;
    expect(basis.id).not.toBe(occupied.first.item.id);
    expect(child).toMatchObject({ id: "a-migrated-child", based_on_revision_id: basis.id, parent_revision_id: null, revision_number: 1, change_reason: "migrate" });
    expect(child.snapshot_id).not.toBe(basis.snapshot_id);
    expect(child.manifest_hash).toBe(source.migrated.item.manifestHash);
    const fragments = target.sql.prepare("select raw_text,raw_text_hash from v2_link_fragments where user_id=? order by id").all(restoredOwner);
    expect(fragments).toHaveLength(2);
    expect(fragments.every((row) => row.raw_text === rawText && row.raw_text_hash === sha256Hex(rawText))).toBe(true);
    const again = await createRestoreDryRun(target, restoredOwner, bundle);
    expect(again.counts).toMatchObject({ create: 0, fork: 0, conflict: 0, invalid: 0 });
    await expect(importVerifiedBundle({ db: target, bucket: noObjects, userId: restoredOwner, bundle,
      expectedDryRunHash: again.dryRunHash, idempotencyKey: "collision-repeat" })).resolves.toMatchObject({ status: "succeeded" });
    expect(target.sql.prepare(`select * from ${revisions} where user_id=? order by group_key`).all(restoredOwner)).toEqual(imported);
    expect(target.sql.prepare(`select * from ${revisions} where user_id=? order by id`).all(owner)).toEqual(beforeForeign);
    expect(target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test("does not remap a reused target ID again when it equals another incoming source ID", async () => {
    const source = await seed(database()), target = database();
    const existingRows = new Map<string, readonly Row[]>();
    for (const descriptor of CANONICAL_TABLES_V1) {
      existingRows.set(descriptor.table, source.rows.get(descriptor.table)!
        .filter((row) => descriptor.table === revisions ? row.id !== source.migrated.item.id : row.curation_revision_id !== source.migrated.item.id)
        .map((original) => {
          const row = { ...original };
          if (descriptor.table === revisions && row.id === source.first.item.id) row.id = source.migrated.item.id;
          for (const [column, table] of Object.entries(descriptor.foreignKeys ?? {})) {
            if (table === revisions && row[column] === source.first.item.id) row[column] = source.migrated.item.id;
          }
          return row;
        }));
    }
    validateReferenceClosure(existingRows);
    const noObjects = new Proxy({} as R2BucketBinding, { get() { throw new Error("Unexpected object-store access"); } });
    const initial = canonicalInput(existingRows), initialPlan = await createRestoreDryRun(target, restoredOwner, initial);
    await importVerifiedBundle({ db: target, bucket: noObjects, userId: restoredOwner, bundle: initial,
      expectedDryRunHash: initialPlan.dryRunHash, idempotencyKey: "alias-initial" });
    const before = target.sql.prepare(`select * from ${revisions}`).all();
    const complete = canonicalInput(source.rows), plan = await createRestoreDryRun(target, restoredOwner, complete);
    expect(plan.counts).toMatchObject({ fork: 1, conflict: 0, invalid: 0 });
    await expect(importVerifiedBundle({ db: target, bucket: noObjects, userId: restoredOwner, bundle: complete,
      expectedDryRunHash: plan.dryRunHash, idempotencyKey: "alias-complete" })).resolves.toMatchObject({ status: "succeeded" });
    expect(target.sql.prepare(`select * from ${revisions} where group_key=?`).all(source.first.item.groupKey)).toEqual(before);
    const child = target.sql.prepare(`select * from ${revisions} where group_key=?`).get(source.migrated.item.groupKey)!;
    expect(child.id).not.toBe(source.migrated.item.id);
    expect(child.based_on_revision_id).toBe(source.migrated.item.id);
    expect(child.based_on_revision_id).not.toBe(child.id);
    const repeat = await createRestoreDryRun(target, restoredOwner, complete);
    expect(repeat.counts).toMatchObject({ create: 0, fork: 0, conflict: 0, invalid: 0 });
    expect(target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });
});
