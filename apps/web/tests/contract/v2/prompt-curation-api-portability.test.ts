import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { getPlatformProxy } from "wrangler";

const auth = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: auth.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: auth.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: auth.bindings }));

import { POST as CREATE } from "@/app/api/v2/records/[recordId]/links/curations/route";
import { GET as GET_GROUP } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/route";
import { POST as REVISE } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/route";
import { GET as COPY } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/copy/route";
import { POST as EXTRACT } from "@/app/api/v2/records/[recordId]/links/fragments/route";
import { POST as SNAPSHOT } from "@/app/api/v2/records/[recordId]/links/snapshots/route";
import { GET as PREVIEW_MIGRATION, POST as MIGRATE } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/migration/route";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { ManualLinkFragmentReceipt } from "@/lib/v2/domain/manual-link-fragment-v1";
import type { PromptCurationMigrationPlan } from "@/lib/v2/domain/prompt-curation-migration";
import type { CreatePromptCurationRequest, MigratePromptCurationRequest, RevisePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import type { PromptCopyRole, PromptCurationCopy } from "@/lib/v2/domain/prompt-curation-v1";
import type { PromptCurationDetail, PromptCurationReceipt, StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";
import { D1LinkSnapshotRepository, type LinkSnapshotReceipt } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { backupBasePath, isBackupDeltaTombstone, loadVerifiedBackupChain, readAndValidateBackupMetadata, type BackupManifestV1 } from "@/lib/v2/portability/backup-snapshot-v1";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, sha256Hex, unwrapCanonicalRow } from "@/lib/v2/portability/portability-contract-v1";
import { advanceBackupWorkflow, stageBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";
import { advanceResumableExportWorkflow } from "@/lib/v2/portability/resumable-export-v2";
import { advanceRestoreWorkflow, approveRestoreWorkflow, stageArchiveRestore } from "@/lib/v2/portability/resumable-restore-v2";
import { verifyExportBundle, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type TestR2 = R2BucketBinding & { list(options: { prefix: string }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean }> };
type Env = { DB: TestD1; ARCHIVE_ASSETS: TestR2 };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
type Row = Record<string, unknown>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const sourceOwner = "api-source-owner", targetOwner = "api-restored-owner";
const origin = "https://lighthouse.test";
const rawText = "  portrait 👤\r\n  warm  light  \r\nnegative: blurred hands\r\n--ar 3:2  ";
const memo = "PRIVATE PERSONAL MEMO — not external source text";
// Synthetic committed bytes: object-store integrity, not image decoding, is under test.
const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const imageHash = sha256Hex(imageBytes), attachmentId = "api-portability-image";
const curationTables = ["v2_link_curation_revisions", "v2_link_curation_items", "v2_link_curation_examples"] as const;
const platforms: Platform[] = [];
let source: Platform, target: Platform;
let fixture: Awaited<ReturnType<typeof seedCapture>>;
let first: PromptCurationReceipt, edited: PromptCurationReceipt, undone: PromptCurationReceipt, disposable: PromptCurationReceipt, migrated: PromptCurationReceipt;
let secondSnapshot: LinkSnapshotReceipt;
let full: Awaited<ReturnType<typeof stageBackupWorkflow>>;
let archiveBytes: Uint8Array, bundle: VerifiedExportBundle, materialized: VerifiedExportBundle;
let freshPlan: Awaited<ReturnType<typeof planRestore>>, repeatPlan: Awaited<ReturnType<typeof planRestore>>;
let firstRestoreId: string;
const persisted = new Map<string, StoredPromptCuration>();
const deletedRows = new Map<string, Row[]>();
const rowsBeforeRepeat = new Map<string, Row[]>();
let beforeRepeat: Awaited<ReturnType<typeof assertRestored>>;
const restoredGraphTables = ["v2_link_snapshots", "v2_link_snapshot_sources", "v2_link_fragments", "v2_link_fragment_evidence", ...curationTables] as const;

/** Counts actual workerd-bound statements; never substitutes a SQLite model. */
class CountingD1 implements D1DatabaseBinding {
  statements = 0;
  private readonly originals = new WeakMap<D1PreparedStatementBinding, D1PreparedStatementBinding>();
  constructor(private readonly inner: D1DatabaseBinding) {}
  prepare(sql: string): D1PreparedStatementBinding {
    let actual = this.inner.prepare(sql);
    const wrapper: D1PreparedStatementBinding = {
      bind: (...values) => { actual = actual.bind(...values); this.originals.set(wrapper, actual); return wrapper; },
      first: async <T>() => { this.statements++; return actual.first<T>(); },
      all: async <T>() => { this.statements++; return actual.all<T>(); },
      run: async () => { this.statements++; return actual.run(); },
    };
    this.originals.set(wrapper, actual); return wrapper;
  }
  batch<T>(statements: D1PreparedStatementBinding[]) {
    this.statements += statements.length;
    return this.inner.batch<T>(statements.map((statement) => this.originals.get(statement) ?? statement));
  }
}

async function platform() {
  const value = await getPlatformProxy<Env>({ configPath, persist: false, remoteBindings: false, envFiles: [] });
  platforms.push(value);
  await value.env.DB.exec(`create table users(id text primary key not null); insert into users values ('${sourceOwner}'),('${targetOwner}');`);
  for (const name of (await readdir(migrationPath)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const sql of (await readFile(`${migrationPath}/${name}`, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await value.env.DB.prepare(sql).run();
  }
  return value;
}
function activate(value: Platform, userId: string) {
  auth.session.mockResolvedValue({ sessionId: "synthetic-api-portability", userId, email: "synthetic@example.test", expiresAt: Date.now() + 100_000 });
  auth.grant.mockResolvedValue(null); auth.bindings.mockReturnValue({ db: value.env.DB, bucket: value.env.ARCHIVE_ASSETS });
}
function request(path: string, body?: unknown) {
  return new Request(`${origin}${path}`, body === undefined ? undefined : { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function json<T>(response: Response, status = 200): Promise<T> {
  const result: unknown = await response.json();
  expect(response.status, canonicalJson(result)).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return result as T;
}
const base = (recordId: string) => `/api/v2/records/${encodeURIComponent(recordId)}/links/curations`;
async function seedCapture() {
  activate(source, sourceOwner);
  const now = new Date().toISOString(), objectKey = "synthetic/api-portability/image.png";
  await source.env.ARCHIVE_ASSETS.put(objectKey, imageBytes, { sha256: imageHash });
  // A pre-verified upload is the only content fixture INSERT. Capture commit
  // performs actual commitment; snapshots/fragments/curations use product paths.
  await source.env.DB.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
    values(?,?,'verified',?,'synthetic.png','image/png',?,?,?,'2099-01-01T00:00:00Z',?)`)
    .bind(attachmentId, sourceOwner, objectKey, imageBytes.length, imageHash, now, now).run();
  const capture = await prepareCaptureCommit({ draftId: "api-portability-draft", channel: "web", title: "API ZIP portability", bodyMarkdown: memo,
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now,
    sources: [{ kind: "url", rawText, contentHash: `sha256:${sha256Hex(rawText)}`, metadata: makeManualLinkMetadata({
      url: "https://example.invalid/api-portability", purpose: "prompt", role: "prompt", completeness: "complete", partNumber: 1, totalParts: 1,
    }) }, { kind: "image", contentHash: `sha256:${imageHash}`, attachmentId }],
  }, "api-portability-capture");
  await new D1SourceFoundationRepository(source.env.DB, sourceOwner).commitCapture(capture);
  const snapshot = await new D1LinkSnapshotRepository(source.env.DB, sourceOwner).bootstrapManualSources({
    documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: "api-portability-snapshot",
  });
  const basis = { expectedRevisionId: capture.revisionId, expectedSnapshotId: snapshot.snapshot.id, expectedManifestHash: snapshot.snapshot.manifestHash };
  const negativeStart = rawText.indexOf("negative:"), parameterStart = rawText.indexOf("--ar");
  const selections = [{ role: "prompt", start: 0, end: negativeStart }, { role: "negative_prompt", start: negativeStart, end: parameterStart },
    { role: "parameters", start: parameterStart, end: rawText.length }] as const;
  const fragments: ManualLinkFragmentReceipt[] = [];
  for (const selection of selections) fragments.push(await json<ManualLinkFragmentReceipt>(await EXTRACT(request(`/api/v2/records/${capture.objectId}/links/fragments`, {
    ...basis, memberId: snapshot.members[0].id, textStart: selection.start, textEnd: selection.end, role: selection.role, idempotencyKey: `api-extract-${selection.role}`,
  }), { params: Promise.resolve({ recordId: capture.objectId }) }), 201));
  const input: CreatePromptCurationRequest = { ...basis, groupKey: "api-group-stable", idempotencyKey: "api-create-v1",
    content: { title: "원문 정리본", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: fragments.map((fragment, index) => ({ itemKey: `item-${selections[index].role}`, fragmentId: fragment.item.id, expectedFragmentStateVersion: fragment.item.stateVersion, copyRole: selections[index].role, position: 0 })),
      examples: [{ exampleKey: "whole-image", itemKey: null, memberId: snapshot.members[1].id, attachmentId, position: 0, evidenceMethod: "user_confirmed" },
        { exampleKey: "prompt-image", itemKey: "item-prompt", memberId: snapshot.members[1].id, attachmentId, position: 1, evidenceMethod: "user_confirmed" }],
    } };
  return { capture, snapshot, basis, fragments, input };
}
function revisionBasis(receipt: PromptCurationReceipt) {
  return { ...fixture.basis, expectedCurationRevisionId: receipt.item.id, expectedCurationRevisionNumber: receipt.item.revisionNumber, idempotencyKey: crypto.randomUUID() };
}
async function revise(input: RevisePromptCurationRequest) {
  return json<PromptCurationReceipt>(await REVISE(request(`${base(fixture.capture.objectId)}/${fixture.input.groupKey}/revisions`, input),
    { params: Promise.resolve({ recordId: fixture.capture.objectId, groupKey: fixture.input.groupKey }) }), 201);
}
async function backupRows(manifest: BackupManifestV1, table: typeof curationTables[number]) {
  const descriptor = CANONICAL_TABLES_V1.find((item) => item.table === table)!;
  const files = manifest.metadataFiles.filter((file) => backupBasePath(file.path) === descriptor.path);
  expect(files.length).toBeGreaterThan(0);
  const rows: Row[] = [];
  for (const file of files) {
    expect(manifest.metadataModes[file.path] ?? manifest.metadataModes[descriptor.path]).toBe(manifest.snapshotKind === "full" ? "full" : "delta");
    rows.push(...await readAndValidateBackupMetadata(source.env.ARCHIVE_ASSETS,
      `users/${sha256Hex(sourceOwner).slice(0, 24)}/backups/snapshots/${manifest.snapshotId}/metadata/${file.path}`, file, manifest.snapshotId, "v2-032"));
  }
  return rows;
}
async function restoredRows(table: string) {
  const descriptor = CANONICAL_TABLES_V1.find((item) => item.table === table);
  if (!descriptor) throw new Error(`Noncanonical test table: ${table}`);
  return (await target.env.DB.prepare(`select * from ${descriptor.table} order by ${descriptor.primaryKey.join(",")}`).all<Row>()).results;
}
async function driveBackup(kind: "full" | "incremental") {
  const db = new CountingD1(source.env.DB);
  let view = await stageBackupWorkflow({ db, userId: sourceOwner, kind, idempotencyKey: `api-${kind}` });
  for (let step = 0; step < 600 && view.status === "building"; step++) {
    db.statements = 0;
    view = await advanceBackupWorkflow({ db, bucket: source.env.ARCHIVE_ASSETS, userId: sourceOwner, snapshotId: view.snapshotId });
    expect(db.statements).toBeLessThanOrEqual(40);
    if (step % 50 === 0) console.info("api-portability backup", kind, step, view.phase);
  }
  expect(view.status, JSON.stringify(view)).toBe("succeeded");
  console.info("api-portability backup complete", kind, view.snapshotId, view.manifestRootHash);
  return view;
}
async function driveZip() {
  const job = await new D1PortabilityRepository(source.env.DB, sourceOwner).createExport({ profile: "migration", idempotencyKey: "api-final-zip",
    scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true } });
  const db = new CountingD1(source.env.DB);
  let view: Awaited<ReturnType<typeof advanceResumableExportWorkflow>> | null = null;
  for (let step = 0; step < 600; step++) {
    db.statements = 0;
    view = await advanceResumableExportWorkflow({ db, bucket: source.env.ARCHIVE_ASSETS, userId: sourceOwner, exportId: job.id });
    expect(db.statements).toBeLessThanOrEqual(20);
    if (step % 50 === 0) console.info("api-portability ZIP", step, view.status, view.buildPhase);
    if (["succeeded", "failed"].includes(view.status)) break;
  }
  expect(view?.status, JSON.stringify(view)).toBe("succeeded");
  const object = await source.env.ARCHIVE_ASSETS.get(view!.bundleObjectKey!);
  expect(object).toBeTruthy();
  const bytes = new Uint8Array(await object!.arrayBuffer());
  expect(sha256Hex(bytes)).toBe(view!.bundleSha256);
  console.info("api-portability ZIP complete", bytes.length, sha256Hex(bytes));
  return bytes;
}
async function driveRestore(batchId: string, terminal: readonly string[]) {
  const db = new CountingD1(target.env.DB);
  let view: Awaited<ReturnType<typeof advanceRestoreWorkflow>> | null = null;
  for (let step = 0; step < 600; step++) {
    db.statements = 0;
    view = await advanceRestoreWorkflow({ db, bucket: target.env.ARCHIVE_ASSETS, userId: targetOwner, batchId });
    expect(db.statements).toBeLessThanOrEqual(40);
    if (step % 50 === 0) console.info("api-portability restore", batchId, step, view.status, view.progress);
    if (terminal.includes(view.status)) return view;
  }
  throw new Error(`Restore did not reach ${terminal.join("|")}: ${JSON.stringify(view)}`);
}
async function planRestore(idempotencyKey: string, repeated: boolean) {
  const staged = await stageArchiveRestore({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: targetOwner, idempotencyKey,
    archiveSha256: sha256Hex(archiveBytes), fileName: "api-curation.zip", body: archiveBytes, sizeBytes: archiveBytes.byteLength });
  expect(staged.status).toBe("indexing");
  const planned = await driveRestore(staged.batchId, ["awaiting_approval", "failed"]);
  expect(planned.status, JSON.stringify(planned)).toBe("awaiting_approval");
  expect(planned.dryRun!.counts).toMatchObject({ conflict: 0, invalid: 0, fork: 0, ...(repeated ? { create: 0 } : {}) });
  if (!repeated) expect(planned.dryRun!.counts.create).toBeGreaterThan(0);
  expect(planned.progress.filesComplete).toBe(planned.progress.filesTotal);
  const files = (await target.env.DB.prepare("select kind,status,verified_at,consumed_at from v2_restore_files where restore_batch_id=?").bind(staged.batchId).all<Row>()).results;
  expect(files.some((file) => file.kind === "original")).toBe(true);
  expect(files.every((file) => file.verified_at !== null && file.status === "consumed")).toBe(true);
  console.info("api-portability approved plan", repeated, planned.dryRun!.counts, files.length);
  return planned;
}
async function applyRestore(planned: Awaited<ReturnType<typeof planRestore>>, repeated: boolean) {
  expect(planned.status).toBe("awaiting_approval");
  await approveRestoreWorkflow({ db: target.env.DB, userId: targetOwner, batchId: planned.batchId, expectedDryRunHash: planned.dryRun!.dryRunHash, expectedRevision: planned.stateRevision });
  const completed = await driveRestore(planned.batchId, ["succeeded", "failed", "rollback_requested", "rollback_conflicted"]);
  expect(completed.status, JSON.stringify(completed)).toBe("succeeded");
  expect(await target.env.DB.prepare("select count(*) as n from v2_workflow_lease_assertions").first()).toEqual({ n: 0 });
  console.info("api-portability restore complete", repeated, completed.batchId, completed.progress);
  return completed.batchId;
}
async function assertRestored() {
  activate(target, targetOwner);
  const recordId = fixture.capture.objectId, groupKey = fixture.input.groupKey;
  const detail = await json<PromptCurationDetail>(await GET_GROUP(request(`${base(recordId)}/${groupKey}`), { params: Promise.resolve({ recordId, groupKey }) }));
  expect(detail.item.id).toBe(undone.item.id); expect(detail.history.items).toHaveLength(3);
  expect(detail.history.items.map((item) => item.revisionNumber)).toEqual([3, 2, 1]);
  expect(detail).toMatchObject({ currentRevisionId: fixture.capture.revisionId, currentSnapshotId: secondSnapshot.snapshot.id, isHistorical: true });
  const migratedKey = migrated.item.groupKey;
  const migratedDetail = await json<PromptCurationDetail>(await GET_GROUP(request(`${base(recordId)}/${migratedKey}`), { params: Promise.resolve({ recordId, groupKey: migratedKey }) }));
  expect(migratedDetail).toMatchObject({ currentSnapshotId: secondSnapshot.snapshot.id, isHistorical: false,
    head: { id: migrated.item.id, revisionNumber: 1 }, item: { basedOnRevisionId: first.item.id, changeReason: "migrate", snapshotId: secondSnapshot.snapshot.id } });
  expect(migratedDetail.history.items.map((item) => item.id)).toEqual([migrated.item.id]);
  for (const receipt of [first, edited, undone, migrated]) {
    const selectedGroup = receipt.item.groupKey;
    const historical = await json<PromptCurationDetail>(await GET_GROUP(request(`${base(recordId)}/${selectedGroup}?revisionId=${receipt.item.id}`),
      { params: Promise.resolve({ recordId, groupKey: selectedGroup }) }));
    // POST echoes request ordering across roles; GET has canonical role/position
    // order. Compare persisted source GET to restored GET without sorting away
    // any within-role order, duplicate, exact text, image or manifest difference.
    expect(historical.item).toEqual(persisted.get(receipt.item.id));
    for (const role of ["prompt", "negative_prompt", "parameters"] as PromptCopyRole[]) {
      const copy = await json<PromptCurationCopy>(await COPY(request(`${base(recordId)}/${selectedGroup}/revisions/${receipt.item.id}/copy?channel=${role}`),
        { params: Promise.resolve({ recordId, groupKey: selectedGroup, revisionId: receipt.item.id }) }));
      const part = fixture.fragments.find((fragment) => fragment.item.fragment.role === role)!.item.fragment.rawText;
      const exact = role === "prompt" && receipt.item.id === edited.item.id ? `${part}\n${part}` : part;
      expect(copy.text).toBe(exact); expect(copy.sha256).toBe(sha256Hex(exact)); expect(copy.byteLength).toBe(new TextEncoder().encode(exact).length);
      expect(copy.text).not.toContain(memo); expect(copy.warnings).not.toContain("missing_parts");
    }
  }
  const stored = await target.env.DB.prepare("select object_key,status,sha256,size_bytes from v2_attachment_reservations where id=? and user_id=?").bind(attachmentId, targetOwner).first<Row>();
  expect(stored).toMatchObject({ status: "committed", sha256: imageHash, size_bytes: imageBytes.length });
  const original = await target.env.ARCHIVE_ASSETS.get(String(stored!.object_key));
  expect(original).toBeTruthy();
  expect(original!.customMetadata).toMatchObject({ userId: targetOwner, reservationId: attachmentId, sha256: imageHash });
  expect(new Uint8Array(await original!.arrayBuffer())).toEqual(imageBytes);
  const generations = await target.env.ARCHIVE_ASSETS.list({ prefix: `users/${sha256Hex(targetOwner).slice(0, 24)}/restored-originals/` });
  expect(generations.truncated).toBe(false);
  expect(generations.objects.map((object) => ({ key: object.key, size: object.size }))).toEqual([{ key: stored!.object_key, size: imageBytes.length }]);
  expect(await target.env.DB.prepare("select count(*) as n from v2_attachment_reservations").first()).toEqual({ n: 1 });
  const graphRows = new Map<string, Row[]>();
  for (const table of restoredGraphTables) {
    const rows = await restoredRows(table); graphRows.set(table, rows);
    expect(rows.every((row) => row.user_id === targetOwner), table).toBe(true);
    const expected = bundle.rowsByTable.get(table)!.map((row) => ({ ...unwrapCanonicalRow(row, table), user_id: targetOwner }));
    expect(rows.map(canonicalJson).sort(), `${table}: exact graph with only the owner remapped`).toEqual(expected.map(canonicalJson).sort());
  }
  for (const table of curationTables) {
    const ids = new Set(graphRows.get(table)!.map((row) => String(row.id)));
    expect([...ids].sort(), table).toEqual(bundle.rowsByTable.get(table)!.map((row) => String(row.id)).sort());
    expect(deletedRows.get(table)!.some((row) => ids.has(String(row.id))), `${table}: deleted base rows must stay absent`).toBe(false);
  }
  expect((await target.env.DB.prepare(`select c.group_key,c.revision_number,c.based_on_revision_id,c.snapshot_id,b.snapshot_id as basis_snapshot_id
    from v2_link_curation_revisions c join v2_link_curation_revisions b on b.id=c.based_on_revision_id where c.id=?`).bind(migrated.item.id).first())).toEqual({
    group_key: migratedKey, revision_number: 1, based_on_revision_id: first.item.id, snapshot_id: secondSnapshot.snapshot.id, basis_snapshot_id: fixture.snapshot.snapshot.id,
  });
  const migratedFragments = (await target.env.DB.prepare(`select f.id,f.snapshot_id,f.processing_run_id,f.locked_by_user,f.review_status,f.state_version
    from v2_link_fragments f join v2_link_curation_items i on i.fragment_id=f.id where i.curation_revision_id=? order by f.id`).bind(migrated.item.id).all<Row>()).results;
  expect(migratedFragments).toHaveLength(3);
  for (const fragment of migratedFragments) expect(fragment).toMatchObject({ snapshot_id: secondSnapshot.snapshot.id, processing_run_id: null, locked_by_user: 1, review_status: "confirmed", state_version: 1 });
  const deletedGroup = disposable.item.groupKey;
  await json(await GET_GROUP(request(`${base(recordId)}/${deletedGroup}`), { params: Promise.resolve({ recordId, groupKey: deletedGroup }) }), 404);
  expect(await target.env.DB.prepare("select count(*) as n from v2_objects where user_id=?").bind(sourceOwner).first()).toEqual({ n: 0 });
  expect(await target.env.DB.prepare("select count(*) as n from v2_processing_jobs").first()).toEqual({ n: 0 });
  expect((await target.env.DB.prepare("pragma foreign_key_check").all()).results).toEqual([]);
  activate(target, sourceOwner);
  await json(await GET_GROUP(request(`${base(recordId)}/${migratedKey}`), { params: Promise.resolve({ recordId, groupKey: migratedKey }) }), 404);
  activate(target, targetOwner);
  return { detail, migratedDetail, graphRows, objectKey: stored!.object_key, generations: generations.objects.map((object) => object.key) };
}

beforeAll(async () => {
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "0");
  source = await platform(); target = await platform(); fixture = await seedCapture();
}, 90_000);
afterAll(async () => {
  try { await Promise.all(platforms.map((value) => value.dispose())); console.info("api-portability disposed", platforms.length, "isolated workerd platforms"); }
  finally { vi.unstubAllEnvs(); vi.clearAllMocks(); }
});

describe.sequential("HTTP curation migration and base-present deletion to actual V2 backup/ZIP/fresh/repeat restore", () => {
  test("creates original A and independent deletion target T through HTTP before the verified V2 full backup", async () => {
    activate(source, sourceOwner);
    first = await json<PromptCurationReceipt>(await CREATE(request(base(fixture.capture.objectId), fixture.input), { params: Promise.resolve({ recordId: fixture.capture.objectId }) }), 201);
    expect(first.item.revisionNumber).toBe(1); expect(first.item.content.examples).toHaveLength(2);
    disposable = await json<PromptCurationReceipt>(await CREATE(request(base(fixture.capture.objectId), {
      ...fixture.input, groupKey: "api-disposable-before-full", idempotencyKey: "api-disposable-create",
      content: { ...fixture.input.content, title: "full 이후 삭제할 독립 정리본", items: [fixture.input.content.items[0]], examples: [fixture.input.content.examples[0]] },
    } satisfies CreatePromptCurationRequest), { params: Promise.resolve({ recordId: fixture.capture.objectId }) }), 201);
    expect(disposable.item).toMatchObject({ revisionNumber: 1, parentRevisionId: null, basedOnRevisionId: null, snapshotId: fixture.snapshot.snapshot.id });
    for (const table of curationTables) {
      const column = table === curationTables[0] ? "id" : "curation_revision_id";
      const rows = (await source.env.DB.prepare(`select * from ${table} where ${column}=? order by id`).bind(disposable.item.id).all<Row>()).results;
      expect(rows, table).toHaveLength(1); deletedRows.set(table, rows);
    }
    full = await driveBackup("full");
    const chain = await loadVerifiedBackupChain({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: sourceOwner, snapshotId: full.snapshotId });
    expect(chain).toHaveLength(1); expect(chain[0].schemaVersion).toBe("v2-032");
    expect(await source.env.DB.prepare("select workflow_version,status from v2_backup_snapshots where id=?").bind(full.snapshotId).first()).toEqual({ workflow_version: 2, status: "succeeded" });
    for (const table of curationTables) {
      const rows = await backupRows(chain[0], table);
      expect(rows.some(isBackupDeltaTombstone)).toBe(false);
      for (const deleted of deletedRows.get(table)!) {
        const backedUp = rows.find((row) => row.id === deleted.id);
        expect(backedUp, `${table}: deletion target must exist in the full backup`).toBeDefined();
        expect(unwrapCanonicalRow(backedUp!, table), table).toEqual(deleted);
      }
    }
  }, 300_000);

  test("preserves edit/undo, creates S2 and migrates A to B through HTTP, then deletes only T in the isolated fixture", async () => {
    expect(full).toBeDefined(); activate(source, sourceOwner);
    const duplicate = { ...fixture.input.content.items[0], itemKey: "intentional-duplicate", position: 1 };
    edited = await revise({ ...revisionBasis(first), action: "edit", content: { ...fixture.input.content, title: "중복 원문을 보존한 수정", items: [...fixture.input.content.items, duplicate] } });
    undone = await revise({ ...revisionBasis(edited), action: "undo", restoreRevisionId: first.item.id });
    expect(undone.item).toMatchObject({ revisionNumber: 3, parentRevisionId: edited.item.id, basedOnRevisionId: first.item.id, manifestHash: first.item.manifestHash });
    for (const receipt of [first, edited, undone]) {
      const recordId = fixture.capture.objectId, groupKey = fixture.input.groupKey;
      const detail = await json<PromptCurationDetail>(await GET_GROUP(request(`${base(recordId)}/${groupKey}?revisionId=${receipt.item.id}`), { params: Promise.resolve({ recordId, groupKey }) }));
      expect(detail.item.prepared).toEqual(receipt.item.prepared);
      persisted.set(receipt.item.id, detail.item);
    }
    const recordId = fixture.capture.objectId;
    const sourceRowsBefore = new Map<string, Row[]>();
    for (const table of curationTables) {
      const column = table === curationTables[0] ? "id" : "curation_revision_id";
      sourceRowsBefore.set(table, (await source.env.DB.prepare(`select * from ${table} where ${column} in (?,?,?) order by id`)
        .bind(first.item.id, edited.item.id, undone.item.id).all<Row>()).results);
    }
    // Real capture-version save: retaining the exact sources in a different
    // order creates a new snapshot/member set and manifest, not a seeded row.
    const savedSnapshot = await json<{ snapshot: LinkSnapshotReceipt }>(await SNAPSHOT(request(`/api/v2/records/${recordId}/links/snapshots`, {
      expectedRevisionId: fixture.capture.revisionId, expectedSnapshotId: fixture.snapshot.snapshot.id,
      expectedSnapshotVersion: fixture.snapshot.snapshot.snapshotVersion,
      sourceItemIds: [...fixture.snapshot.members].reverse().map((member) => member.sourceItemId), idempotencyKey: "api-snapshot-s2",
    }), { params: Promise.resolve({ recordId }) }), 201);
    secondSnapshot = savedSnapshot.snapshot;
    expect(secondSnapshot.snapshot).toMatchObject({ parentSnapshotId: fixture.snapshot.snapshot.id, snapshotVersion: 2 });
    expect(secondSnapshot.snapshot.id).not.toBe(fixture.snapshot.snapshot.id);
    expect(secondSnapshot.snapshot.manifestHash).not.toBe(fixture.snapshot.snapshot.manifestHash);
    expect(secondSnapshot.members.some((member) => fixture.snapshot.members.some((old) => old.id === member.id))).toBe(false);
    const groupKey = first.item.groupKey, revisionId = first.item.id;
    const path = `${base(recordId)}/${groupKey}/revisions/${revisionId}/migration`;
    const context = { params: Promise.resolve({ recordId, groupKey, revisionId }) };
    const plan = await json<PromptCurationMigrationPlan>(await PREVIEW_MIGRATION(request(path), context));
    expect(plan).toMatchObject({ ready: true, issues: [], sourceRevisionId: first.item.id, sourceSnapshotId: fixture.snapshot.snapshot.id,
      expectedSnapshotId: secondSnapshot.snapshot.id, expectedManifestHash: secondSnapshot.snapshot.manifestHash, selectionConfirmations: [] });
    expect(plan.items).toHaveLength(3); expect(plan.examples).toHaveLength(2);
    migrated = await json<PromptCurationReceipt>(await MIGRATE(request(path, {
      expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId, expectedManifestHash: plan.expectedManifestHash,
      expectedPlanHash: plan.planHash, groupKey: "api-migrated-group-b", idempotencyKey: "api-migrate-a-to-b",
    } satisfies MigratePromptCurationRequest), context), 201);
    expect(migrated.item).toMatchObject({ changeReason: "migrate", revisionNumber: 1, parentRevisionId: null, basedOnRevisionId: first.item.id,
      snapshotId: secondSnapshot.snapshot.id, status: "active" });
    expect(migrated.item.groupKey).not.toBe(first.item.groupKey);
    expect(migrated.item.content.items.some((item) => first.item.content.items.some((old) => old.fragmentId === item.fragmentId))).toBe(false);
    for (const item of migrated.item.items) expect(item.fragment).toMatchObject(first.item.items.find((old) => old.itemKey === item.itemKey)!.fragment);
    for (const example of migrated.item.content.examples) expect(example.memberId).toBe(plan.examples.find((mapped) => mapped.exampleKey === example.exampleKey)!.memberId);
    const migratedDetail = await json<PromptCurationDetail>(await GET_GROUP(request(`${base(recordId)}/${migrated.item.groupKey}`),
      { params: Promise.resolve({ recordId, groupKey: migrated.item.groupKey }) }));
    expect(migratedDetail.item.prepared).toEqual(migrated.item.prepared); persisted.set(migrated.item.id, migratedDetail.item);
    // SQL deletion is fixture-only. No public hard-delete API or destructive
    // restore synchronization is introduced; A remains B's immutable evidence.
    await source.env.DB.batch([
      source.env.DB.prepare("delete from v2_link_curation_examples where curation_revision_id=? and user_id=?").bind(disposable.item.id, sourceOwner),
      source.env.DB.prepare("delete from v2_link_curation_items where curation_revision_id=? and user_id=?").bind(disposable.item.id, sourceOwner),
      source.env.DB.prepare("delete from v2_link_curation_revisions where id=? and user_id=?").bind(disposable.item.id, sourceOwner),
    ]);
    for (const table of curationTables) {
      const column = table === curationTables[0] ? "id" : "curation_revision_id";
      expect(await source.env.DB.prepare(`select count(*) as n from ${table} where ${column}=?`).bind(disposable.item.id).first()).toEqual({ n: 0 });
      expect((await source.env.DB.prepare(`select * from ${table} where ${column} in (?,?,?) order by id`)
        .bind(first.item.id, edited.item.id, undone.item.id).all<Row>()).results).toEqual(sourceRowsBefore.get(table));
    }
    expect(await source.env.DB.prepare("select count(*) as n from v2_processing_jobs").first()).toEqual({ n: 0 });
    expect((await source.env.DB.prepare("pragma foreign_key_check").all()).results).toEqual([]);
  }, 300_000);

  test("V2 delta contains all three base-present tombstones and materializes A plus migrated B without T", async () => {
    expect(migrated).toBeDefined();
    const delta = await driveBackup("incremental");
    const chain = await loadVerifiedBackupChain({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: sourceOwner, snapshotId: delta.snapshotId });
    expect(chain.map((snapshot) => snapshot.snapshotId)).toEqual([full.snapshotId, delta.snapshotId]);
    expect(chain[1].baseSnapshotId).toBe(full.snapshotId);
    for (const table of curationTables) {
      const rows = await backupRows(chain[1], table), tombstones = rows.filter(isBackupDeltaTombstone);
      expect(tombstones.map((row) => row.id).sort(), table).toEqual(deletedRows.get(table)!.map((row) => row.id).sort());
      if (table === curationTables[0]) expect(rows.filter((row) => !isBackupDeltaTombstone(row)).map((row) => row.id).sort())
        .toEqual([edited.item.id, undone.item.id, migrated.item.id].sort());
      const kind = table === curationTables[0] ? "link_curation_revision" : table === curationTables[1] ? "link_curation_item" : "link_curation_example";
      const events = (await source.env.DB.prepare("select aggregate_id from v2_change_events where user_id=? and aggregate_kind=? and operation='tombstone' and sequence>? and sequence<=? order by aggregate_id")
        .bind(sourceOwner, kind, chain[0].endSequence, chain[1].endSequence).all<{ aggregate_id: string }>()).results;
      expect(events.map((event) => event.aggregate_id), table).toEqual(deletedRows.get(table)!.map((row) => String(row.id)).sort());
    }
    materialized = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: sourceOwner, snapshotId: delta.snapshotId });
    for (const table of curationTables) {
      const rows = materialized.rowsByTable.get(table)!;
      expect(rows.some(isBackupDeltaTombstone)).toBe(false);
      for (const deleted of deletedRows.get(table)!) expect(rows.some((row) => row.id === deleted.id), `${table}: remove a row present in full`).toBe(false);
    }
    expect(materialized.rowsByTable.get(curationTables[0])!.map((row) => row.id).sort()).toEqual([first.item.id, edited.item.id, undone.item.id, migrated.item.id].sort());
  }, 300_000);

  test("the actual V2 ZIP exactly matches all 46 full-plus-delta canonical tables", async () => {
    expect(materialized).toBeDefined();
    archiveBytes = await driveZip(); bundle = verifyExportBundle(archiveBytes);
    expect(bundle.manifest.schemaVersion).toBe("v2-032"); expect(bundle.rowsByTable.size).toBe(46);
    for (const descriptor of CANONICAL_TABLES_V1) {
      const normalized = (rows: readonly Row[]) => rows.map((row) => canonicalJson(unwrapCanonicalRow(row, descriptor.table))).sort();
      expect(normalized(bundle.rowsByTable.get(descriptor.table) ?? []), descriptor.table).toEqual(normalized(materialized.rowsByTable.get(descriptor.table) ?? []));
    }
    expect(bundle.rowsByTable.get(curationTables[0])).toHaveLength(4);
    console.info("api-portability full/delta/ZIP canonical equality", CANONICAL_TABLES_V1.length, "tables");
  }, 300_000);

  test("fresh ZIP restore starts at indexing and plans the complete migrated graph before approval", async () => {
    expect(bundle).toBeDefined();
    for (const table of curationTables) expect(await target.env.DB.prepare(`select count(*) as n from ${table}`).first()).toEqual({ n: 0 });
    expect(await target.env.DB.prepare("select count(*) as n from v2_objects").first()).toEqual({ n: 0 });
    freshPlan = await planRestore("api-fresh-zip", false);
    for (const table of curationTables) expect(await target.env.DB.prepare(`select count(*) as n from ${table}`).first()).toEqual({ n: 0 });
  }, 300_000);

  test("explicit fresh approval preserves A/B exact HTTP history/copy, image bytes, owner and based-on FK", async () => {
    expect(freshPlan).toBeDefined();
    firstRestoreId = await applyRestore(freshPlan, false);
    beforeRepeat = await assertRestored();
    for (const [table, rows] of beforeRepeat.graphRows) rowsBeforeRepeat.set(table, rows);
    for (const table of ["v2_attachment_reservations", "v2_source_attachment_links"]) rowsBeforeRepeat.set(table, await restoredRows(table));
  }, 300_000);

  test("the same ZIP repeats from indexing with no planned creates or forks", async () => {
    expect(firstRestoreId).toBeDefined();
    repeatPlan = await planRestore("api-repeat-zip", true);
  }, 300_000);

  test("repeat approval adds no logical revisions, source/member/fragment identities or image generations", async () => {
    expect(repeatPlan).toBeDefined();
    const repeated = await applyRestore(repeatPlan, true);
    expect(repeated).not.toBe(firstRestoreId);
    const after = await assertRestored(); expect(after).toEqual(beforeRepeat);
    for (const [table, rows] of rowsBeforeRepeat) expect(after.graphRows.get(table) ?? await restoredRows(table), table).toEqual(rows);
  }, 300_000);
});
