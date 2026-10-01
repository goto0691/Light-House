import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { createLinkSourceFingerprint, hashLinkSourceManifest, linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { assertSnapshotReceipt } from "@/lib/v2/editor/link-snapshot-receipt";
import type { SnapshotRequest } from "@/lib/v2/editor/link-snapshot-draft";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1LinkSnapshotRepository, type LinkSnapshotReceipt } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkSqlite } from "../../support/link-sqlite";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Envelope = { snapshot: Mutable<LinkSnapshotReceipt> };
type Context = { ownerId: string; recordId: string; request: Mutable<SnapshotRequest> };
let db: LinkSqlite;
let context: Context, receipt: Envelope, child: { context: Context; receipt: Envelope }, replay: Envelope;

function input(value: Context) {
  return { ...value.request, documentId: value.recordId, newManualSources: value.request.newManualSources.map((source) => ({ rawText: source.rawText, metadata: makeManualLinkMetadata(source.link) })) };
}
function clone() { return { value: structuredClone(receipt), context: structuredClone(context) }; }
async function reject(value: unknown, request = context) {
  await expect(assertSnapshotReceipt(value, request)).rejects.toMatchObject({ code: "link_snapshot_receipt_invalid" });
}
async function rehash(value: Envelope) {
  for (const member of value.snapshot.members) member.sourceFingerprint = await createLinkSourceFingerprint(member);
  value.snapshot.snapshot.manifestHash = await hashLinkSourceManifest({ members: value.snapshot.members });
}

beforeAll(async () => {
  db = new LinkSqlite(32);
  const now = new Date().toISOString(), attachmentId = crypto.randomUUID(), imageHash = "b".repeat(64), rawText = "  existing 👀\r\nexact original\n";
  // Only the reservation is synthetic; commitment and all snapshot/replay SQL
  // use real repositories. This does not exercise R2 transport/image decoding.
  db.sql.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
    values(?,'link-owner','verified',?,'example.png','image/png',8,?,?,'2099-01-01T00:00:00.000Z',?)`)
    .run(attachmentId, `fixture/${attachmentId}.png`, imageHash, now, now);
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Receipt fixture", bodyMarkdown: "PRIVATE MEMO", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now,
    sources: [{ kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://example.test/original", purpose: "prompt" }) },
      { kind: "image", contentHash: `sha256:${imageHash}`, attachmentId }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const ids = db.sql.prepare("select id,item_kind from v2_source_items where capture_id=? and item_kind in ('url','image')").all(capture.captureId) as { id: string; item_kind: string }[];
  context = { ownerId: "link-owner", recordId: capture.objectId, request: {
    expectedRevisionId: capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0,
    sourceItemIds: [ids.find((row) => row.item_kind === "image")!.id, ids.find((row) => row.item_kind === "url")!.id],
    newManualSources: [
      { rawText: "  새 프롬프트 🙂\r\n--ar 3:2\n", link: { url: " https://www.threads.com/@test/post/one?xmt=tracking ", publisher: "  저자  ", purpose: "prompt", role: "prompt", completeness: "partial", partNumber: 1, totalParts: 2 } },
      { rawText: " \r\n ", link: { url: "https://youtu.be/second?si=tracking&t=5", purpose: "video_note", role: "transcript", startSeconds: 5, endSeconds: 10 } },
    ], idempotencyKey: crypto.randomUUID(),
  } };
  const snapshots = new D1LinkSnapshotRepository(db, context.ownerId);
  receipt = { snapshot: structuredClone(await snapshots.createSnapshot(input(context))) as Mutable<LinkSnapshotReceipt> };
  const childContext: Context = { ...context, request: { expectedRevisionId: capture.revisionId, expectedSnapshotId: receipt.snapshot.snapshot.id, expectedSnapshotVersion: 1,
    sourceItemIds: receipt.snapshot.members.map((member) => member.sourceItemId).reverse(), newManualSources: [], idempotencyKey: crypto.randomUUID() } };
  child = { context: childContext, receipt: { snapshot: structuredClone(await snapshots.createSnapshot(input(childContext))) as Mutable<LinkSnapshotReceipt> } };
  const revision = await prepareDocumentRevision({ expectedRevisionId: capture.revisionId, expectedVersion: 1, title: "Later title", bodyMarkdown: "Later PRIVATE MEMO",
    documentStatus: "draft", privacyLevel: "normal", writtenAt: null }, crypto.randomUUID());
  const saved = await new D1DocumentAuthoringRepository(db, context.ownerId).saveRevision(context.recordId, revision);
  expect(saved.outcome).toBe("saved");
  replay = { snapshot: structuredClone(await snapshots.createSnapshot(input(context))) as Mutable<LinkSnapshotReceipt> };
});
afterAll(() => { db?.sql.close(); vi.restoreAllMocks(); });

test("accepts the actual initial repository receipt with selected image and exact normalized manual additions", async () => {
  expect(receipt.snapshot.replayed).toBe(false);
  expect(receipt.snapshot.members[2].rawText).toBe(context.request.newManualSources[0].rawText);
  expect(receipt.snapshot.members[2].manualLink?.url).toBe(context.request.newManualSources[0].link.url.trim());
  await expect(assertSnapshotReceipt(receipt, context)).resolves.toBeUndefined();
});
test("accepts actual parent/version+1 selection with reordered existing sources", async () => {
  expect(child.receipt.snapshot.snapshot.parentSnapshotId).toBe(receipt.snapshot.snapshot.id);
  await expect(assertSnapshotReceipt(child.receipt, child.context)).resolves.toBeUndefined();
});
test("old idempotent replay survives a later snapshot and real document revision", async () => {
  expect(replay.snapshot.replayed).toBe(true);
  expect(replay.snapshot.snapshot).toEqual(receipt.snapshot.snapshot);
  expect(replay.snapshot.documentRevisionId).not.toBe(context.request.expectedRevisionId);
  await expect(assertSnapshotReceipt(replay, context)).resolves.toBeUndefined();
});

test.each([null, [], {}, { snapshot: {} }, { snapshot: { replayed: true } }, { success: true }])("rejects malformed 2xx object %j", async (value) => { await reject(value); });

const mutations: [string, (value: Envelope) => void][] = [
  ["unknown envelope field", (value) => Object.assign(value, { secret: "PRIVATE MEMO" })],
  ["unknown receipt field", (value) => Object.assign(value.snapshot, { bodyMarkdown: "PRIVATE MEMO" })],
  ["missing replay flag", (value) => { Reflect.deleteProperty(value.snapshot, "replayed"); }],
  ["non-boolean replay flag", (value) => { Object.assign(value.snapshot, { replayed: "true" }); }],
  ["empty current document revision", (value) => { value.snapshot.documentRevisionId = ""; }],
  ["wrong owner", (value) => { value.snapshot.snapshot.userId = "other-owner"; }],
  ["wrong record", (value) => { value.snapshot.snapshot.documentId = "other-record"; }],
  ["wrong parent", (value) => { value.snapshot.snapshot.parentSnapshotId = "other-snapshot"; }],
  ["wrong version", (value) => { value.snapshot.snapshot.snapshotVersion += 1; }],
  ["wrong manifest version", (value) => { Object.assign(value.snapshot.snapshot, { manifestVersion: "future" }); }],
  ["unknown adapter", (value) => { value.snapshot.snapshot.adapterVersion = "automatic-fetch.v1"; }],
  ["wrong acquisition", (value) => { value.snapshot.snapshot.acquisitionMethod = "public_fetch"; }],
  ["invalid created time", (value) => { value.snapshot.snapshot.createdAt = "not-a-date"; }],
  ["missing capture identity", (value) => { value.snapshot.snapshot.captureId = ""; }],
  ["inflated captured status", (value) => { value.snapshot.snapshot.captureState = "captured"; }],
  ["inflated coverage", (value) => { value.snapshot.snapshot.coverage.fullExternalScope = "verified"; }],
  ["wrong pasted count", (value) => { value.snapshot.snapshot.coverage.pastedTexts = 4; }],
  ["unknown coverage key", (value) => { value.snapshot.snapshot.coverage.guessedAuthor = "someone"; }],
  ["missing member", (value) => { value.snapshot.members.pop(); }],
  ["extra member", (value) => { value.snapshot.members.push(structuredClone(value.snapshot.members[0])); }],
  ["wrong source selection", (value) => { value.snapshot.members[0].sourceItemId = "other-source"; }],
  ["source order changed", (value) => { [value.snapshot.members[0], value.snapshot.members[1]] = [value.snapshot.members[1], value.snapshot.members[0]]; }],
  ["gapped order", (value) => { value.snapshot.members[2].sourceOrder = 6; }],
  ["foreign member snapshot", (value) => { value.snapshot.members[0].snapshotId = "other"; }],
  ["duplicate member id", (value) => { value.snapshot.members[1].id = value.snapshot.members[0].id; }],
  ["duplicate source id", (value) => { value.snapshot.members[3].sourceItemId = value.snapshot.members[2].sourceItemId; }],
  ["duplicate member key", (value) => { value.snapshot.members[1].memberKey = value.snapshot.members[0].memberKey; }],
  ["new source reuses selected id", (value) => { value.snapshot.members[2].sourceItemId = context.request.sourceItemIds[0]; }],
  ["missing manual projection", (value) => { value.snapshot.members[2].manualLink = null; }],
  ["manual projection disagreement", (value) => { value.snapshot.members[2].manualLink!.role = "caption"; }],
  ["wrong fingerprint", (value) => { value.snapshot.members[1].sourceFingerprint = "0".repeat(64); }],
  ["wrong manifest hash", (value) => { value.snapshot.snapshot.manifestHash = "0".repeat(64); }],
  ["malformed content hash", (value) => { value.snapshot.members[1].contentHash = "not-sha256"; }],
  ["missing committed attachment", (value) => { value.snapshot.members[0].attachments = []; }],
  ["attachment source hash mismatch", (value) => { value.snapshot.members[0].attachments[0].sha256 = "c".repeat(64); }],
  ["duplicate attachment id", (value) => { value.snapshot.members[0].attachments.push(structuredClone(value.snapshot.members[0].attachments[0])); }],
  ["invalid attachment size", (value) => { value.snapshot.members[0].attachments[0].sizeBytes = -1; }],
  ["unknown member field", (value) => { Object.assign(value.snapshot.members[1], { verifiedByAi: true }); }],
  ["lone surrogate id", (value) => { value.snapshot.members[0].id = "bad\ud800"; }],
  ["control character id", (value) => { value.snapshot.members[0].id = "bad\nidentifier"; }],
];
test.each(mutations)("rejects %s before a caller can retire its draft", async (_label, change) => {
  const { value } = clone(); change(value); await reject(value);
});

test.each(["trim", "line_endings", "changed_text"] as const)("rejects new rawText %s even with recomputed fingerprint and manifest", async (change) => {
  const { value } = clone(), member = value.snapshot.members[2];
  member.rawText = change === "trim" ? member.rawText!.trim() : change === "line_endings" ? member.rawText!.replaceAll("\r\n", "\n") : "different original";
  member.contentHash = `sha256:${await linkSha256Hex(member.rawText)}`;
  await rehash(value); await reject(value);
});
test.each(["url", "purpose", "completeness", "publisher", "partNumber", "tracking_url"] as const)("rejects new normalized metadata %s even after rehashing", async (field) => {
  const { value } = clone(), member = value.snapshot.members[2];
  const link = { ...member.manualLink!, [field === "tracking_url" ? "url" : field]: field === "url" ? "https://example.test/different" : field === "tracking_url" ? "https://www.threads.com/@test/post/one?xmt=another" : field === "partNumber" ? 2 : field === "purpose" ? "insight" : field === "completeness" ? "complete" : "different author" };
  const normalized = makeManualLinkMetadata(link);
  member.metadata = structuredClone(normalized); member.manualLink = structuredClone(normalized.manualLinkV1);
  await rehash(value); await reject(value);
});

test("existing text mutation with unchanged content hash is rejected by the fingerprint helper", async () => {
  const { value } = clone(); value.snapshot.members[1].rawText = "tampered existing original"; await reject(value);
});
test("exact duplicate new originals remain separate sources in the validated request order", async () => {
  const { value, context: request } = clone();
  request.request.newManualSources[1] = structuredClone(request.request.newManualSources[0]);
  const original = value.snapshot.members[3], template = value.snapshot.members[2];
  value.snapshot.members[3] = { ...structuredClone(template), id: original.id, sourceItemId: original.sourceItemId, memberKey: original.memberKey, sourceOrder: 3 };
  value.snapshot.snapshot.coverage.pastedTexts = 3;
  await rehash(value); await expect(assertSnapshotReceipt(value, request)).resolves.toBeUndefined();
});
test("rejects a selected source order mismatch even after rebuilding the valid manifest", async () => {
  const { value } = clone();
  [value.snapshot.members[0], value.snapshot.members[1]] = [value.snapshot.members[1], value.snapshot.members[0]];
  value.snapshot.members.forEach((member, index) => { member.sourceOrder = index; });
  await rehash(value); await reject(value);
});
test("accepts link-only whitespace exactly without claiming acquired text", async () => {
  const { value, context: request } = clone();
  request.request.sourceItemIds = []; request.request.newManualSources = [request.request.newManualSources[1]];
  value.snapshot.members = [value.snapshot.members[3]]; value.snapshot.members[0].sourceOrder = 0;
  value.snapshot.snapshot.captureState = "link_only";
  value.snapshot.snapshot.coverage = { scope: "user_selected", selectedSources: 1, pastedTexts: 0, attachmentSources: 0, fullExternalScope: "unverified", analysis: "not_started" };
  await rehash(value); await expect(assertSnapshotReceipt(value, request)).resolves.toBeUndefined();
});
test("same-owner JSON data with cyclic/accessor/prototype/sparse payloads is still rejected without invoking accessors", async () => {
  const accessor = vi.fn(() => receipt.snapshot);
  await reject(Object.defineProperty({}, "snapshot", { get: accessor, enumerable: true })); expect(accessor).not.toHaveBeenCalled();
  const cyclic = { snapshot: null as unknown }; cyclic.snapshot = cyclic; await reject(cyclic);
  await reject(Object.create(receipt));
  const { value } = clone(); Reflect.deleteProperty(value.snapshot.members, "1"); await reject(value);
});
test("captures valid response and expected request before hashing awaits", async () => {
  const { value, context: request } = clone();
  const checking = assertSnapshotReceipt(value, request);
  value.snapshot.members[2].rawText = "mutated after invocation";
  request.request.newManualSources[0].rawText = "also mutated"; request.ownerId = "other-owner";
  await expect(checking).resolves.toBeUndefined();
});
test("an initially malformed receipt cannot be repaired by mutating it after invocation", async () => {
  const { value } = clone(), preserved = value.snapshot.members[2].rawText;
  value.snapshot.members[2].rawText = "initial corruption";
  const checking = assertSnapshotReceipt(value, context);
  value.snapshot.members[2].rawText = preserved;
  await expect(checking).rejects.toMatchObject({ code: "link_snapshot_receipt_invalid" });
});
test("the helper does not claim to verify the server-only idempotency record", async () => {
  const request = structuredClone(context); request.request.idempotencyKey = crypto.randomUUID();
  // There is no key/payloadHash in the API response. Server authorization and
  // receipt lookup bind this key; this helper verifies the returned source data.
  await expect(assertSnapshotReceipt(receipt, request)).resolves.toBeUndefined();
});
