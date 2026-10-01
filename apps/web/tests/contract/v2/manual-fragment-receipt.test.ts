import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { canonicalLinkJson, linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import type { CreateManualLinkFragmentRequest, ManualLinkFragmentReceipt } from "@/lib/v2/domain/manual-link-fragment-v1";
import { makeManualLinkMetadata, type ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import { assertManualFragmentReceipt } from "@/lib/v2/editor/manual-fragment-receipt";
import type { ManualFragmentDraftSource } from "@/lib/v2/editor/manual-fragment-draft";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Fixture = { context: { request: Mutable<CreateManualLinkFragmentRequest>; source: Mutable<ManualFragmentDraftSource> };
  receipt: Mutable<ManualLinkFragmentReceipt>; replay: Mutable<ManualLinkFragmentReceipt> };
let db: LinkSqlite;
const fixtures = new Map<ManualLinkSourceV1["completeness"], Fixture>();
const rawText = "  alpha🙂\r\n  prompt exact  \r\nend  ";
function fixture() { return structuredClone(fixtures.get("partial")!); }
async function reject(value: unknown, context = fixture().context) {
  await expect(assertManualFragmentReceipt(value, context)).rejects.toMatchObject({ code: "manual_fragment_receipt_invalid" });
}

beforeAll(async () => {
  db = new LinkSqlite(32);
  for (const completeness of ["unknown", "complete", "partial", "ocr_unverified"] as const) {
    const seeded = await seedLinkRecord(db, { rawText, snapshot: false });
    db.sql.prepare("update v2_source_items set source_metadata=? where id=?").run(canonicalLinkJson(makeManualLinkMetadata({
      url: "https://example.test/exact?utm_source=fixture", purpose: "prompt", role: "source", completeness, partNumber: 1, totalParts: 2,
    })), seeded.sources[0].id);
    const snapshot = await seeded.snapshots.bootstrapManualSources({ documentId: seeded.capture.objectId, expectedRevisionId: seeded.capture.revisionId, idempotencyKey: crypto.randomUUID() });
    const member = snapshot.members[0];
    const context: Fixture["context"] = { request: { expectedRevisionId: seeded.capture.revisionId, expectedSnapshotId: snapshot.snapshot.id,
      expectedManifestHash: snapshot.snapshot.manifestHash, memberId: member.id, textStart: 1, textEnd: rawText.length - 1, role: "prompt", idempotencyKey: crypto.randomUUID() },
    source: { sourceItemId: member.sourceItemId, memberId: member.id, memberKey: member.memberKey, contentHash: member.contentHash, rawText: member.rawText!,
      manualLink: structuredClone(member.manualLink!), sourceOrder: member.sourceOrder } };
    const repository = new D1ManualLinkFragmentRepository(db, "link-owner");
    const receipt = structuredClone(await repository.create(seeded.capture.objectId, context.request)) as Mutable<ManualLinkFragmentReceipt>;
    const replay = structuredClone(await repository.create(seeded.capture.objectId, context.request)) as Mutable<ManualLinkFragmentReceipt>;
    fixtures.set(completeness, { context, receipt, replay });
  }
});
afterAll(() => { db?.sql.close(); vi.restoreAllMocks(); });

test.each(["unknown", "complete", "partial", "ocr_unverified"] as const)("actual repository create/replay preserves source %s completeness", async (completeness) => {
  const current = fixtures.get(completeness)!;
  expect(current.receipt.replayed).toBe(false); expect(current.replay.replayed).toBe(true);
  expect(current.receipt.item.fragment.rawText).toBe(rawText.slice(1, rawText.length - 1));
  expect(current.receipt.item.fragment.rawText).toContain("🙂\r\n");
  await expect(assertManualFragmentReceipt(current.receipt, current.context)).resolves.toEqual(current.receipt);
  await expect(assertManualFragmentReceipt(current.replay, current.context)).resolves.toEqual(current.replay);
});
test.each([null, [], {}, { success: true }, { contract: "manual-link-fragment.v1", item: {}, replayed: false }].map((value) => ({ value })))("malformed successful JSON $value cannot acknowledge cleanup", async ({ value }) => { await reject(value); });

const mutations: [string, (value: Mutable<ManualLinkFragmentReceipt>) => void][] = [
  ["wrong contract", (value) => { Object.assign(value, { contract: "ai-link-analysis.v1" }); }],
  ["unknown envelope field", (value) => { Object.assign(value, { bodyMarkdown: "PRIVATE MEMO" }); }],
  ["missing replay field", (value) => { Reflect.deleteProperty(value, "replayed"); }],
  ["string replay field", (value) => { Object.assign(value, { replayed: "false" }); }],
  ["empty fragment id", (value) => { value.item.id = ""; }],
  ["control character id", (value) => { value.item.id = "bad\nidentity"; }],
  ["lone surrogate id", (value) => { value.item.id = "bad\ud800"; }],
  ["fragment key mismatch", (value) => { value.item.fragmentKey = "not-this-fragment"; }],
  ["wrong snapshot", (value) => { value.item.snapshotId = "another-snapshot"; }],
  ["wrong primary member", (value) => { value.item.primaryMemberId = "another-member"; }],
  ["invalid time", (value) => { value.item.createdAt = "invalid-time"; }],
  ["zero state version", (value) => { value.item.stateVersion = 0; }],
  ["fractional state version", (value) => { value.item.stateVersion = 1.5; }],
  ["unknown review state", (value) => { Object.assign(value.item, { reviewStatus: "proposed" }); }],
  ["unknown item field", (value) => { Object.assign(value.item, { confirmedByServer: true }); }],
  ["wrong member key", (value) => { value.item.fragment.memberKey = "another-key"; }],
  ["AI interpretation", (value) => { Object.assign(value.item.fragment, { sourceClass: "ai_interpretation" }); }],
  ["AI selection origin", (value) => { value.item.fragment.selectionOrigin = "ai_selected"; }],
  ["wrong role", (value) => { value.item.fragment.role = "parameters"; }],
  ["wrong start", (value) => { value.item.fragment.textStart += 1; }],
  ["wrong end", (value) => { value.item.fragment.textEnd -= 1; }],
  ["wrong raw hash", (value) => { value.item.fragment.rawTextHash = "a".repeat(64); }],
  ["uppercase raw hash", (value) => { value.item.fragment.rawTextHash = value.item.fragment.rawTextHash.toUpperCase(); }],
  ["coverage upgraded", (value) => { value.item.fragment.completeness = "complete"; }],
  ["unknown fragment evidence", (value) => { Object.assign(value.item.fragment, { evidence: "invented" }); }],
];
test.each(mutations)("rejects receipt %s", async (_label, mutate) => { const current = fixture(); mutate(current.receipt); await reject(current.receipt, current.context); });

test.each(["trim", "newline", "translation"])("changed exact fragment %s still fails after hash recalculation", async (change) => {
  const current = fixture(), fragment = current.receipt.item.fragment;
  fragment.rawText = change === "trim" ? fragment.rawText.trim() : change === "newline" ? fragment.rawText.replaceAll("\r\n", "\n") : "translated original";
  fragment.rawTextHash = await linkSha256Hex(fragment.rawText);
  await reject(current.receipt, current.context);
});
test("unchanged selected slice does not mask a corrupted cached whole-source hash", async () => {
  const current = fixture(); current.context.source.rawText = `X${current.context.source.rawText.slice(1)}`;
  expect(current.context.source.rawText.slice(current.context.request.textStart, current.context.request.textEnd)).toBe(current.receipt.item.fragment.rawText);
  await reject(current.receipt, current.context);
});
test.each(["memberId", "role", "textStart", "textEnd", "expectedSnapshotId"])("request %s must match the captured source and returned selection", async (field) => {
  const current = fixture();
  Object.assign(current.context.request, { [field]: field === "textStart" ? 0 : field === "textEnd" ? rawText.length : field === "role" ? "parameters" : "different" });
  await reject(current.receipt, current.context);
});
test("surrogate-splitting request is rejected even if receipt text and hash were forged consistently", async () => {
  const current = fixture(), start = rawText.indexOf("🙂") + 1;
  current.context.request.textStart = start; current.receipt.item.fragment.textStart = start;
  current.receipt.item.fragment.rawText = rawText.slice(start, current.context.request.textEnd);
  current.receipt.item.fragment.rawTextHash = await linkSha256Hex(current.receipt.item.fragment.rawText);
  await reject(current.receipt, current.context);
});
test.each(["confirmed", "rejected", "superseded"] as const)("replay may carry later %s review status without rewriting the original", async (reviewStatus) => {
  const current = fixture(); current.replay.item.reviewStatus = reviewStatus; current.replay.item.stateVersion = 4;
  await expect(assertManualFragmentReceipt(current.replay, current.context)).resolves.toEqual(current.replay);
});
test.each(["negative_prompt", "parameters"] as const)("valid role-specific result %s does not follow the source metadata role", async (role) => {
  const current = fixture(); current.context.request.role = role; current.receipt.item.fragment.role = role;
  expect(current.context.source.manualLink.role).toBe("source");
  await expect(assertManualFragmentReceipt(current.receipt, current.context)).resolves.toEqual(current.receipt);
});
test("captures request, source and valid response before the first hashing await", async () => {
  const current = fixture(), expected = structuredClone(current.receipt);
  const checking = assertManualFragmentReceipt(current.receipt, current.context);
  current.receipt.item.fragment.rawText = "changed later"; current.context.source.rawText = "changed later"; current.context.request.memberId = "changed later";
  const result = await checking; expect(result).toEqual(expected); expect(result).not.toBe(current.receipt);
});
test("does not permit repairing initial corruption during an asynchronous hash", async () => {
  const current = fixture(), original = current.receipt.item.fragment.rawText;
  current.receipt.item.fragment.rawText = "initial corruption";
  const checking = assertManualFragmentReceipt(current.receipt, current.context);
  current.receipt.item.fragment.rawText = original;
  await expect(checking).rejects.toMatchObject({ code: "manual_fragment_receipt_invalid" });
});
test("rejects accessors, cyclic values, prototype responses and sparse data without executing code", async () => {
  const current = fixture(), getter = vi.fn(() => current.receipt.item);
  Object.defineProperty(current.receipt, "item", { get: getter }); await reject(current.receipt, current.context); expect(getter).not.toHaveBeenCalled();
  const cyclic: Record<string, unknown> = { ...fixture().receipt }; cyclic.item = cyclic; await reject(cyclic);
  await reject(Object.create(fixture().receipt)); await reject({ ...fixture().receipt, item: new Array(2) });
});
test("does not pretend the DTO proves owner/record/key/manifest database binding", async () => {
  const current = fixture(); current.context.request.expectedRevisionId = "different-valid-revision";
  current.context.request.expectedManifestHash = "c".repeat(64); current.context.request.idempotencyKey = "other-valid-key";
  current.context.source.sourceItemId = "other-valid-source-id";
  // These identities are absent from the response; the authenticated API must
  // bind them. This checker can prove only its returned member/range/raw/hash.
  await expect(assertManualFragmentReceipt(current.receipt, current.context)).resolves.toEqual(current.receipt);
});
