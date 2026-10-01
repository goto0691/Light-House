import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { createLinkSourceFingerprint, hashLinkSourceManifest } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { extractManualPromptFragment, preparePromptCuration, type PromptCurationInput } from "@/lib/v2/domain/prompt-curation-v1";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { createBackupSnapshot, validateBackupManifest } from "@/lib/v2/portability/backup-snapshot-v1";
import { assertPromptCurationExportScope, CANONICAL_TABLES_V1, canonicalTablesForSchemaVersion, RESTORE_TABLE_ORDER_V2 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { writeExportBundle } from "@/lib/v2/portability/export-bundle-v1";
import { canonicalJson, sha256Hex, unwrapCanonicalRow } from "@/lib/v2/portability/portability-contract-v1";
import { advanceResumableExportWorkflow } from "@/lib/v2/portability/resumable-export-v2";
import { advanceRestoreWorkflow, approveRestoreWorkflow } from "@/lib/v2/portability/resumable-restore-v2";
import { createRestoreDryRun, importVerifiedBundle, validateReferenceClosure, verifyExportBundle, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type Env = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
type Row = Record<string, unknown>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationsPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const now = "2026-09-08T11:00:00.000Z";
const text = "  portrait 👤\r\n  warm light  ";
const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]); // Synthetic header; no image-decoding claim.
const imageHash = sha256Hex(imageBytes);
const scope = { objects: "all", privacyLevels: ["normal"], includeTrash: true, includeHistory: true, includeOriginals: true } as const;
const curationTables = ["v2_link_curation_revisions", "v2_link_curation_items", "v2_link_curation_examples"] as const;
const platforms: Platform[] = [];
let source: Platform;
let fixture: Awaited<ReturnType<typeof seed>>;
let repeatedFixture: { target: Platform; bundle: VerifiedExportBundle };

async function platform() {
  const value = await getPlatformProxy<Env>({ configPath, persist: false, remoteBindings: false, envFiles: [] });
  platforms.push(value);
  await value.env.DB.exec("create table users(id text primary key not null); insert into users values ('owner'),('other'),('target');");
  for (const name of (await readdir(migrationsPath)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const sql of (await readFile(`${migrationsPath}/${name}`, "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await value.env.DB.prepare(sql).run();
  }
  return value;
}

async function insert(db: TestD1, table: string, row: Row) {
  const keys = Object.keys(row);
  return db.prepare(`insert into ${table} (${keys.map((key) => `"${key}"`).join(",")}) values (${keys.map(() => "?").join(",")})`).bind(...keys.map((key) => row[key])).run();
}

async function seed(value: Platform, userId: string, prefix: string, privacyLevel: "normal" | "restricted" = "normal") {
  const attachmentId = `${prefix}-image`, objectKey = `fixture/${prefix}/image.png`;
  await value.env.ARCHIVE_ASSETS.put(objectKey, imageBytes);
  await insert(value.env.DB, "v2_attachment_reservations", { id: attachmentId, user_id: userId, status: "verified", object_key: objectKey, filename: "fixture.png", mime_type: "image/png", size_bytes: imageBytes.length, sha256: imageHash, created_at: now, expires_at: "2099-01-01T00:00:00.000Z", verified_at: now });
  const prepared = await prepareCaptureCommit({ draftId: prefix, channel: "web", title: "Curation fixture", bodyMarkdown: "My memo stays separate.", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now,
    sources: [{ kind: "url", rawText: text, contentHash: `sha256:${sha256Hex(text)}`,
      metadata: makeManualLinkMetadata({ url: `https://example.invalid/${prefix}`, purpose: "prompt", role: "prompt", completeness: "complete", partNumber: 1, totalParts: 1 }) },
    { kind: "image", contentHash: `sha256:${imageHash}`, attachmentId }],
  }, prefix, now);
  await new D1SourceFoundationRepository(value.env.DB, userId).commitCapture(prepared);
  const members = await Promise.all(prepared.sources.slice(1).map(async (item, index) => ({ id: `${prefix}-member-${index}`, sourceItemId: item.id, memberKey: `member-${index}`, sourceOrder: index,
    sourceFingerprint: await createLinkSourceFingerprint({ kind: item.kind, contentHash: item.contentHash, rawText: item.rawText, metadata: item.metadataJson === null ? null : JSON.parse(item.metadataJson),
      attachments: index ? [{ sha256: imageHash, mimeType: "image/png", sizeBytes: imageBytes.length }] : [] }) })));
  const snapshotId = `${prefix}-snapshot`, snapshotManifestHash = await hashLinkSourceManifest({ members });
  await insert(value.env.DB, "v2_link_snapshots", { id: snapshotId, user_id: userId, document_object_id: prepared.objectId, capture_id: prepared.captureId, parent_snapshot_id: null, snapshot_version: 1,
    manifest_version: "link-source-manifest.v1", manifest_hash: snapshotManifestHash, acquisition_method: "user_paste", adapter_version: "fixture.v1", capture_state: "captured", coverage_json: "{}", created_at: now });
  for (const member of members) await insert(value.env.DB, "v2_link_snapshot_sources", { id: member.id, user_id: userId, snapshot_id: snapshotId, source_item_id: member.sourceItemId, member_key: member.memberKey, source_order: member.sourceOrder, source_fingerprint: member.sourceFingerprint });
  await value.env.DB.prepare("update v2_documents set current_link_snapshot_id=?,link_snapshot_version=1 where object_id=?").bind(snapshotId, prepared.objectId).run();
  const catalog = { memberKey: members[0].memberKey, sourceFingerprint: members[0].sourceFingerprint, rawText: text, contentHash: sha256Hex(text), completeness: "complete" as const,
    parts: { number: { value: 1, origin: "user_declared" as const }, total: { value: 1, origin: "user_declared" as const } } };
  const fragment = await extractManualPromptFragment(catalog, { textStart: 0, textEnd: text.length, role: "prompt" });
  const fragmentId = `${prefix}-fragment`;
  await insert(value.env.DB, "v2_link_fragments", { id: fragmentId, user_id: userId, document_object_id: prepared.objectId, snapshot_id: snapshotId, primary_member_id: members[0].id, processing_run_id: null,
    fragment_key: "manual-prompt", role: "prompt", source_class: "source_extract", text_start: 0, text_end: text.length, raw_text: text, raw_text_hash: sha256Hex(text),
    details_json: canonicalJson({ contract: "manual-link-fragment.v1", selectionOrigin: "user_selected" }), completeness: "complete", display_order: 0, review_status: "confirmed", locked_by_user: 1, created_at: now });
  await insert(value.env.DB, "v2_link_fragment_evidence", { id: `${prefix}-evidence`, user_id: userId, fragment_id: fragmentId, member_id: members[0].id,
    relation_kind: "supports", evidence_method: "user_confirmed", text_start: 0, text_end: text.length, display_order: 0, locked_by_user: 1, state_version: 1, created_at: now });
  const input: PromptCurationInput = { snapshotManifestHash, title: "Original curation", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed", separator: "\n", sources: [catalog],
    items: [{ itemKey: "item-stable", copyRole: "prompt", position: 0, fragment }],
    examples: [{ exampleKey: "example-stable", itemKey: "item-stable", memberKey: members[1].memberKey, sourceFingerprint: members[1].sourceFingerprint, sha256: imageHash, mimeType: "image/png", sizeBytes: imageBytes.length, position: 0, evidenceMethod: "user_confirmed" }] };
  return { value, userId, prepared, members, snapshotId, fragmentId, attachmentId, input };
}

async function revision(f: Awaited<ReturnType<typeof seed>>, id: string, number = 1, parent: string | null = null, options: { groupKey?: string; basedOn?: string; reason?: string; input?: PromptCurationInput } = {}) {
  const input = options.input ?? f.input, prepared = await preparePromptCuration(input);
  const row = { id, user_id: f.userId, document_object_id: f.prepared.objectId, snapshot_id: f.snapshotId, group_key: options.groupKey ?? "group-stable", revision_number: number,
    parent_revision_id: parent, based_on_revision_id: options.basedOn ?? null, change_reason: options.reason ?? (number === 1 ? "create" : "edit"), title: input.title, relation_kind: input.relationKind,
    relationship_confirmation: input.relationshipConfirmation, order_confirmation: input.orderConfirmation, status: "active", separator: "\n", manifest_version: prepared.manifestVersion, render_version: prepared.renderVersion, manifest_json: prepared.manifestJson, manifest_hash: prepared.manifestHash, created_at: now };
  await insert(f.value.env.DB, curationTables[0], row);
  await insert(f.value.env.DB, curationTables[1], { id: `${id}-item`, user_id: f.userId, curation_revision_id: id, item_key: "item-stable", fragment_id: f.fragmentId, copy_role: "prompt", position: 0, fragment_state_version: 1 });
  await insert(f.value.env.DB, curationTables[2], { id: `${id}-example`, user_id: f.userId, curation_revision_id: id, example_key: "example-stable", item_id: `${id}-item`, member_id: f.members[1].id, attachment_id: f.attachmentId, position: 0, evidence_method: "user_confirmed" });
  return row;
}

async function exported() {
  const repository = new D1PortabilityRepository(source.env.DB, "owner");
  const job = await repository.createExport({ profile: "migration", scope, idempotencyKey: crypto.randomUUID(), now });
  const written = await writeExportBundle({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "owner", job: await repository.claimExport(job.id, now) });
  const bytes = new Uint8Array(await (await source.env.ARCHIVE_ASSETS.get(written.objectKey))!.arrayBuffer());
  return verifyExportBundle(bytes);
}

beforeAll(async () => {
  source = await platform();
  fixture = await seed(source, "owner", "main");
  await revision(fixture, "z-base");
}, 90_000);
afterAll(async () => { await Promise.all(platforms.map((value) => value.dispose())); });

// Ordered scenario: the final coordinator phase intentionally consumes the
// real fresh-DB restore produced by the preceding full/incremental phase.
describe.sequential("prompt curation canonical portability", () => {
  test("enforces owner, parent, manifest slots, fragment role/version and immutable rows without weakening image commitment", async () => {
    const db = source.env.DB;
    const base = await db.prepare("select * from v2_link_curation_revisions where id='z-base'").first<Row>();
    await expect(insert(db, curationTables[0], { ...base, id: "foreign", user_id: "other", group_key: "foreign" })).rejects.toThrow("prompt_curation_owner_mismatch");
    await expect(insert(db, curationTables[0], { ...base, id: "skip", revision_number: 3, parent_revision_id: "z-base" })).rejects.toThrow("prompt_curation_parent_mismatch");
    await expect(insert(db, curationTables[0], { ...base, id: "cycle", group_key: "cycle", based_on_revision_id: "cycle" })).rejects.toThrow("prompt_curation_basis_mismatch");
    await expect(insert(db, curationTables[0], { ...base, id: "bad-manifest", group_key: "bad", title: "not the manifest" })).rejects.toThrow("prompt_curation_manifest_mismatch");
    const item = await db.prepare("select * from v2_link_curation_items where id='z-base-item'").first<Row>();
    await expect(insert(db, curationTables[1], { ...item, id: "wrong-role", copy_role: "negative_prompt" })).rejects.toThrow("prompt_curation_item_mismatch");
    await expect(insert(db, curationTables[1], { ...item, id: "future-state", fragment_state_version: 2 })).rejects.toThrow("prompt_curation_item_mismatch");
    const example = await db.prepare("select * from v2_link_curation_examples where id='z-base-example'").first<Row>();
    await expect(insert(db, curationTables[2], { ...example, id: "wrong-member", member_id: fixture.members[0].id })).rejects.toThrow("prompt_curation_example_mismatch");
    await db.prepare("update v2_attachment_reservations set status='verified',committed_at=null where id=?").bind(fixture.attachmentId).run();
    try { await expect(insert(db, curationTables[2], { ...example, id: "not-committed" })).rejects.toThrow("prompt_curation_example_mismatch"); }
    finally { await db.prepare("update v2_attachment_reservations set status='committed',committed_at=? where id=?").bind(now, fixture.attachmentId).run(); }
    for (const table of curationTables) await expect(db.prepare(`update ${table} set id=id where id=?`).bind(table === curationTables[0] ? "z-base" : table === curationTables[1] ? "z-base-item" : "z-base-example").run()).rejects.toThrow("prompt_curation_immutable");
    await db.prepare("update v2_link_fragments set state_version=2 where id=?").bind(fixture.fragmentId).run();
    await revision(fixture, "a-edit", 2, "z-base", { input: { ...fixture.input, title: "Edited curation" } });
    const bundle = await exported();
    expect(() => validateReferenceClosure(bundle.rowsByTable)).not.toThrow(); // Historical item version=1 survives fragment review version=2.
    for (const table of curationTables) expect(bundle.rowsByTable.get(table)).toHaveLength(2);
  }, 60_000);

  test("registers exact canonical paths and excludes foreign/restricted graphs; history exclusion fails before R2 writes", async () => {
    expect(canonicalTablesForSchemaVersion("v2-031")).toHaveLength(43);
    expect(canonicalTablesForSchemaVersion("v2-032")).toHaveLength(46);
    const paths = (await source.env.DB.prepare("select path from v2_backup_retention_known_metadata_paths").all<{ path: string }>()).results.map((row) => row.path).sort();
    expect(paths).toEqual(CANONICAL_TABLES_V1.map((item) => item.path).sort());
    const foreign = await seed(source, "other", "foreign"); await revision(foreign, "foreign-curation");
    const restricted = await seed(source, "owner", "restricted", "restricted"); await revision(restricted, "restricted-curation");
    const noHistory = { ...scope, includeHistory: false };
    await expect(assertPromptCurationExportScope(source.env.DB, "owner", noHistory)).rejects.toMatchObject({ code: "export_curation_scope_conflict" });
    for (const descriptor of CANONICAL_TABLES_V1.filter((row) => curationTables.includes(row.table as typeof curationTables[number]))) {
      const query = descriptor.query("owner", scope);
      const rows = (await source.env.DB.prepare(query.sql).bind(...query.bindings).all<Row>()).results;
      expect(rows).toHaveLength(2); expect(rows.every((row) => row.user_id === "owner")).toBe(true);
    }
    const repository = new D1PortabilityRepository(source.env.DB, "owner");
    const job = await repository.createExport({ profile: "portable", scope: noHistory, idempotencyKey: "no-history-v1", now });
    await expect(writeExportBundle({ db: source.env.DB, bucket: {} as R2BucketBinding, userId: "owner", job: await repository.claimExport(job.id, now) })).rejects.toMatchObject({ code: "export_curation_scope_conflict" });
    const queued = await repository.createExport({ profile: "portable", scope: noHistory, idempotencyKey: "no-history-v2", now });
    await expect(advanceResumableExportWorkflow({ db: source.env.DB, bucket: {} as R2BucketBinding, userId: "owner", exportId: queued.id, now })).resolves.toMatchObject({ failureCode: "export_curation_scope_conflict" });
  }, 60_000);

  test("rejects a missing child, wrong image membership and rehashed inconsistent curation manifest", async () => {
    const bundle = await exported();
    const rows = new Map(bundle.rowsByTable);
    rows.set(curationTables[1], rows.get(curationTables[1])!.slice(1));
    expect(() => validateReferenceClosure(rows)).toThrow();
    const images = new Map(bundle.rowsByTable);
    images.set(curationTables[2], images.get(curationTables[2])!.map((row, index) => index ? row : { ...row, member_id: fixture.members[0].id }));
    expect(() => validateReferenceClosure(images)).toThrow();
    const attacks: readonly [string, (item: Row) => void][] = [
      ["range", (item) => { item.textStart = Number(item.textStart) + 1; }],
      ["parts shape", (item) => { item.parts = []; }],
      ["unknown claim invents number", (item) => { item.parts = { number: { value: 1, origin: "unknown" }, total: { value: 1, origin: "user_declared" } }; }],
      ["claim number overflow", (item) => { item.parts = { number: { value: 101, origin: "user_declared" }, total: { value: 101, origin: "user_declared" } }; }],
      ["unsupported claim origin", (item) => { item.parts = { number: { value: 1, origin: "ai_verified" }, total: { value: 1, origin: "user_declared" } }; }],
      ["unproven source explicit claim", (item) => { item.parts = { number: { value: 1, origin: "source_explicit" }, total: { value: 1, origin: "user_declared" } }; }],
      ["changed declaration", (item) => { item.parts = { number: { value: 2, origin: "user_declared" }, total: { value: 2, origin: "user_declared" } }; }],
      ["unsupported source completeness", (item) => { item.sourceCompleteness = "fully_verified"; }],
      ["changed source completeness", (item) => { item.sourceCompleteness = "unknown"; }],
      ["unsupported selection origin", (item) => { item.selectionOrigin = "user_rewritten"; }],
      ["changed selection origin", (item) => { item.selectionOrigin = "ai_selected"; }],
    ];
    for (const [label, attack] of attacks) {
      const altered = new Map(bundle.rowsByTable);
      altered.set(curationTables[0], altered.get(curationTables[0])!.map((row, index) => {
        if (index) return row;
        const manifest = JSON.parse(String(row.manifest_json)); attack(manifest.items[0]);
        const json = canonicalJson(manifest); return { ...row, manifest_json: json, manifest_hash: sha256Hex(json) };
      }));
      expect(() => validateReferenceClosure(altered), label).toThrow();
    }
    const withoutEvidence = new Map(bundle.rowsByTable);
    withoutEvidence.set("v2_link_fragment_evidence", []);
    expect(() => validateReferenceClosure(withoutEvidence), "missing manual range evidence").toThrow();
    const relabelledSelection = new Map(bundle.rowsByTable);
    relabelledSelection.set("v2_link_fragments", relabelledSelection.get("v2_link_fragments")!.map((row) => ({ ...row,
      details_json: canonicalJson({ contract: "link-analysis.v1", selectionOrigin: "user_selected" }) })));
    expect(() => validateReferenceClosure(relabelledSelection), "null-run fragment cannot impersonate an AI run").toThrow();
  }, 60_000);

  test("full to edit/undo incremental preserves image bytes, tombstones, remapped parents and exact logical identity on repeated restore", async () => {
    const base = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "owner", kind: "full", now });
    await revision(fixture, "m-undo", 3, "a-edit", { basedOn: "z-base", reason: "undo" });
    const transient = await revision(fixture, "transient", 1, null, { groupKey: "transient" });
    await source.env.DB.prepare("delete from v2_link_curation_revisions where id=?").bind(transient.id).run();
    const delta = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "owner", kind: "incremental", now });
    expect(delta.baseSnapshotId).toBe(base.snapshotId); expect(validateBackupManifest(delta).schemaVersion).toBe("v2-032");
    for (const table of curationTables) expect(delta.metadataModes[CANONICAL_TABLES_V1.find((row) => row.table === table)!.path]).toBe("delta");
    const kinds = (await source.env.DB.prepare("select distinct aggregate_kind from v2_change_events where user_id='owner' and sequence>? and aggregate_kind like 'link_curation_%' and operation='tombstone'").bind(base.endSequence).all<{ aggregate_kind: string }>()).results.map((row) => row.aggregate_kind);
    expect(kinds.sort()).toEqual(["link_curation_example", "link_curation_item", "link_curation_revision"]);
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "owner", snapshotId: delta.snapshotId });
    expect(bundle.rowsByTable.get(curationTables[0])!.some((row) => row.id === "transient")).toBe(false);
    const target = await platform();
    const foreign = await seed(target, "other", "collision"); await revision(foreign, "z-base");
    const dryRun = await createRestoreDryRun(target.env.DB, "target", bundle);
    expect(dryRun.counts.conflict).toBe(0); expect(dryRun.counts.fork).toBeGreaterThan(0);
    await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "first", now });
    const restored = (await target.env.DB.prepare("select * from v2_link_curation_revisions where user_id='target' and document_object_id=? order by revision_number").bind(fixture.prepared.objectId).all<Row>()).results;
    expect(restored).toHaveLength(3);
    expect(restored[0].id).not.toBe("z-base"); expect(restored[1].parent_revision_id).toBe(restored[0].id); expect(restored[2].based_on_revision_id).toBe(restored[0].id);
    expect(restored[0].manifest_hash).toBe(restored[2].manifest_hash);
    const example = await target.env.DB.prepare("select e.*,a.object_key from v2_link_curation_examples e join v2_attachment_reservations a on a.id=e.attachment_id where e.curation_revision_id=?").bind(restored[0].id).first<Row>();
    expect(new Uint8Array(await (await target.env.ARCHIVE_ASSETS.get(String(example!.object_key)))!.arrayBuffer())).toEqual(imageBytes);
    expect(await target.env.DB.prepare("select raw_text from v2_link_fragments where id=?").bind(fixture.fragmentId).first()).toEqual({ raw_text: text });
    const repeated = await createRestoreDryRun(target.env.DB, "target", bundle);
    expect(repeated.counts).toMatchObject({ create: 0, fork: 0, conflict: 0, invalid: 0 });
    await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", bundle, expectedDryRunHash: repeated.dryRunHash, idempotencyKey: "repeat", now });
    const conflict = new Map(bundle.rowsByTable);
    conflict.set(curationTables[0], conflict.get(curationTables[0])!.map((row) => {
      if (row.id !== "z-base") return row;
      const manifest = JSON.parse(String(row.manifest_json)); manifest.title = "Conflicting same revision"; const json = canonicalJson(manifest);
      return { ...row, title: manifest.title, manifest_json: json, manifest_hash: sha256Hex(json) };
    }));
    const denied = await createRestoreDryRun(target.env.DB, "target", { ...bundle, rowsByTable: conflict });
    expect(denied.counts.conflict).toBeGreaterThan(0);
    await expect(importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", bundle: { ...bundle, rowsByTable: conflict }, expectedDryRunHash: denied.dryRunHash, idempotencyKey: "conflict", now })).rejects.toMatchObject({ code: "restore_conflict" });
    expect(await target.env.DB.prepare("select count(*) as value from v2_link_curation_revisions where user_id='target' and document_object_id=?").bind(fixture.prepared.objectId).first()).toEqual({ value: 3 });
    repeatedFixture = { target, bundle };
  }, 180_000);

  test("resumable repeated planning preserves remapped logical identities, historical versions and immutable FK order", async () => {
    // This is the actual already-restored target from the full/incremental
    // test. Stage only the verified materialization checkpoint here; ZIP/R2
    // verification was performed above, not simulated by this coordinator.
    expect(repeatedFixture).toBeDefined();
    const { target, bundle } = repeatedFixture, db = target.env.DB, batchId = "curation-resumable-repeat";
    const staged: { table: string; key: string; json: string; hash: string; position: number }[] = [];
    for (const [ordinal, descriptor] of RESTORE_TABLE_ORDER_V2.entries()) for (const [index, row] of (bundle.rowsByTable.get(descriptor.table) ?? []).entries()) {
      staged.push({ table: descriptor.table, key: canonicalJson(Object.fromEntries(descriptor.primaryKey.map((key) => [key, row[key]]))), json: canonicalJson(row),
        hash: sha256Hex(canonicalJson(unwrapCanonicalRow(row, descriptor.table))), position: ordinal * 1_000_000_000_000 + index });
    }
    const summary = { sourceKind: "archive", manifest: bundle.manifest, counts: { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 },
      tables: RESTORE_TABLE_ORDER_V2.map((row) => ({ table: row.table, rows: 0, create: 0, reuse: 0, fork: 0, conflict: 0 })), warnings: [], indexedFiles: 0, verifiedFiles: 0, materializedRows: staged.length, rollbackPreserved: 0 };
    await insert(db, "v2_restore_batches", { id: batchId, user_id: "target", idempotency_key: batchId, archive_sha256: bundle.archiveSha256, manifest_root_hash: bundle.manifest.rootHash, dry_run_hash: "pending", status: "planning",
      summary_json: canonicalJson(summary), collision_map_json: "{}", created_at: now, workflow_version: 2, source_kind: "archive", source_size_bytes: 0, cursor_json: "{}", state_revision: 0, last_progress_at: now });
    for (const row of staged) await insert(db, "v2_restore_rows", { restore_batch_id: batchId, table_name: row.table, row_key: row.key, source_row_hash: row.hash, disposition: "pending", restored_row_key: "{}", created_at: now,
      source_row_json: row.json, candidate_row_json: "{}", plan_position: row.position, apply_status: "pending", rollback_status: "not_applicable", r2_status: "not_applicable", updated_at: now });
    for (const row of bundle.rowsByTable.get("v2_attachment_reservations") ?? []) {
      const original = await db.prepare("select object_key from v2_attachment_reservations where id=? and user_id='target' and status='committed'").bind(row.id).first<{ object_key: string }>();
      expect(original).toBeTruthy();
      expect(new Uint8Array(await (await target.env.ARCHIVE_ASSETS.get(original!.object_key))!.arrayBuffer())).toEqual(imageBytes);
      await insert(db, "v2_restore_files", { restore_batch_id: batchId, user_id: "target", file_id: `original-${row.id}`, ordinal: 0,
        kind: "original", path: `attachments/originals/${row.id}/fixture.png`, source_object_key: original!.object_key, byte_length: row.size_bytes, expected_sha256: row.sha256,
        expected_records: 1, next_byte_offset: row.size_bytes, next_record: 1, verified_at: now, consumed_at: now, status: "consumed" });
    }
    let view = await advanceRestoreWorkflow({ db, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId, now });
    for (let step = 0; step < 600 && !["awaiting_approval", "failed"].includes(view.status); step++) view = await advanceRestoreWorkflow({ db, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId, now });
    expect(view.status, JSON.stringify(view)).toBe("awaiting_approval");
    expect(view.dryRun!.counts).toEqual({ create: 0, reuse: staged.length, fork: 0, conflict: 0, invalid: 0 });
    view = await approveRestoreWorkflow({ db, userId: "target", batchId, expectedDryRunHash: view.dryRun!.dryRunHash, expectedRevision: view.stateRevision, now });
    for (let step = 0; step < 600 && !["succeeded", "failed"].includes(view.status); step++) view = await advanceRestoreWorkflow({ db, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId, now });
    expect(view.status, JSON.stringify(view)).toBe("succeeded");
    expect(await db.prepare("select count(*) as value from v2_link_curation_revisions where user_id='target' and document_object_id=?").bind(fixture.prepared.objectId).first()).toEqual({ value: 3 });
    for (const row of staged) expect(await db.prepare("select source_row_hash,source_row_json from v2_restore_rows where restore_batch_id=? and table_name=? and row_key=?").bind(batchId, row.table, row.key).first()).toEqual({ source_row_hash: row.hash, source_row_json: row.json });
  }, 180_000);
});
