import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { manualFragmentRequest, manualFragmentScope, parseManualFragmentDraft, type ManualFragmentDraft } from "@/lib/v2/editor/manual-fragment-draft";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function draft(): Mutable<ManualFragmentDraft> {
  const rawText = "  alpha🙂\r\n  exact  spaces\r\n尾  ";
  return { contract: "manual-fragment-draft.v1", basis: { expectedRevisionId: "revision-original", expectedSnapshotId: "snapshot-original", expectedManifestHash: "a".repeat(64) },
    source: { sourceItemId: "source-original", memberId: "member-original", memberKey: "stable-original", contentHash: `sha256:${hash(rawText)}`, rawText, sourceOrder: 3,
      manualLink: structuredClone(makeManualLinkMetadata({ url: "https://www.threads.com/@test/post/exact?xmt=tracking", publisher: "Author", purpose: "prompt", completeness: "partial", partNumber: 2, totalParts: 3 }).manualLinkV1) },
    role: "prompt", range: { textStart: 2, textEnd: rawText.length - 2 }, pending: null };
}
function pendingDraft() {
  const value = draft(); value.pending = manualFragmentRequest(value, "stable-key"); return value;
}
function reject(value: unknown) { expect(() => parseManualFragmentDraft(value)).toThrowError(expect.objectContaining({ code: "manual_fragment_draft_invalid" })); }

test("lossless roundtrip preserves original basis, CRLF, spaces, emoji and source metadata", () => {
  const value = draft(), parsed = parseManualFragmentDraft(JSON.parse(JSON.stringify(value)));
  expect(parsed).toEqual(value); expect(parsed.source.rawText).toBe(value.source.rawText);
  expect(manualFragmentScope(parsed.basis)).toBe(JSON.stringify(["revision-original", "snapshot-original", "a".repeat(64)]));
});
test.each(["prompt", "negative_prompt", "parameters"] as const)("preserves the chosen %s role without adopting the source label", (role) => {
  const value = draft(); value.role = role;
  expect(parseManualFragmentDraft(value).role).toBe(role);
  expect(manualFragmentRequest(value, "key").role).toBe(role);
});
test.each([null, { textStart: 2, textEnd: 2 }])("unfinished selection %j is retained but cannot become pending", (range) => {
  const value = { ...draft(), range };
  expect(parseManualFragmentDraft(value).range).toEqual(range);
  expect(() => manualFragmentRequest(value, "key")).toThrow();
});
test("empty link-only original is preserved with no selection", () => {
  const value = draft(); value.source.rawText = ""; value.source.contentHash = `sha256:${hash("")}`; value.range = null;
  expect(parseManualFragmentDraft(value).source.rawText).toBe("");
});
test("an unfinished oversize source can be preserved without silent trimming, but not submitted", () => {
  const value = draft(); value.source.rawText = "한".repeat(40_000); value.source.contentHash = `sha256:${hash(value.source.rawText)}`; value.range = { textStart: 0, textEnd: 1 };
  expect(parseManualFragmentDraft(value).source.rawText).toBe(value.source.rawText);
  expect(() => manualFragmentRequest(value, "key")).toThrow();
});
test("pending roundtrip keeps complete original request and key regardless of object key order", () => {
  const value = pendingDraft();
  value.pending = Object.fromEntries(Object.entries(value.pending!).reverse()) as NonNullable<ManualFragmentDraft["pending"]>;
  expect(parseManualFragmentDraft(value).pending).toEqual(manualFragmentRequest(draft(), "stable-key"));
  expect(manualFragmentRequest(value, "stable-key")).toEqual(value.pending);
  expect(() => manualFragmentRequest(value, "new-key")).toThrow();
});
test("returns owned copies instead of retaining caller references", () => {
  const value = pendingDraft(), parsed = parseManualFragmentDraft(value);
  value.source.rawText = "mutated"; value.source.manualLink.publisher = "mutated"; value.basis.expectedRevisionId = "new"; value.pending!.role = "parameters";
  expect(parsed.source.rawText).toContain("alpha🙂\r\n"); expect(parsed.source.manualLink.publisher).toBe("Author");
  expect(parsed.basis.expectedRevisionId).toBe("revision-original"); expect(parsed.pending!.role).toBe("prompt");
});

const mutations: [string, (value: Mutable<ManualFragmentDraft>) => void][] = [
  ["unknown contract", (value) => { Object.assign(value, { contract: "capture-outbox.v1" }); }],
  ["authority field", (value) => { Object.assign(value, { ownerId: "claimed-owner" }); }],
  ["unknown basis field", (value) => { Object.assign(value.basis, { currentSnapshotId: "new" }); }],
  ["unknown source field", (value) => { Object.assign(value.source, { verified: true }); }],
  ["missing pending", (value) => { Reflect.deleteProperty(value, "pending"); }],
  ["undefined pending", (value) => { Object.assign(value, { pending: undefined }); }],
  ["null source", (value) => { Object.assign(value, { source: null }); }],
  ["empty member id", (value) => { value.source.memberId = ""; }],
  ["long source id", (value) => { value.source.sourceItemId = "x".repeat(201); }],
  ["control in id", (value) => { value.source.memberId = "member\n"; }],
  ["surrogate id", (value) => { value.basis.expectedRevisionId = "revision\ud800"; }],
  ["malformed manifest", (value) => { value.basis.expectedManifestHash = "A".repeat(64); }],
  ["malformed source hash", (value) => { value.source.contentHash = "no-hash"; }],
  ["negative source order", (value) => { value.source.sourceOrder = -1; }],
  ["out of range source order", (value) => { value.source.sourceOrder = 40; }],
  ["non-integer source order", (value) => { value.source.sourceOrder = 1.5; }],
  ["null raw source", (value) => { Object.assign(value.source, { rawText: null }); }],
  ["unpaired source surrogate", (value) => { value.source.rawText += "\udc00"; }],
  ["oversize recovery source", (value) => { value.source.rawText = "x".repeat(500_001); }],
  ["unknown role", (value) => { Object.assign(value, { role: "ai_interpretation" }); }],
  ["unknown range field", (value) => { Object.assign(value.range!, { byteOffset: 2 }); }],
  ["negative range", (value) => { value.range!.textStart = -1; }],
  ["reversed range", (value) => { value.range = { textStart: 5, textEnd: 2 }; }],
  ["past-end range", (value) => { value.range!.textEnd = value.source.rawText.length + 1; }],
  ["fractional range", (value) => { value.range!.textStart = 1.5; }],
  ["split surrogate start", (value) => { value.range!.textStart = value.source.rawText.indexOf("🙂") + 1; }],
  ["split surrogate end", (value) => { value.range!.textEnd = value.source.rawText.indexOf("🙂") + 1; }],
  ["unnormalized source metadata", (value) => { value.source.manualLink.publisher = "  Author  "; }],
  ["false provider claim", (value) => { value.source.manualLink.provider = "youtube"; }],
  ["unknown metadata field", (value) => { Object.assign(value.source.manualLink, { verified: true }); }],
];
test.each(mutations)("rejects unsafe or inconsistent draft %s", (_name, mutate) => { const value = draft(); mutate(value); reject(value); });
test.each(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "memberId", "textStart", "textEnd", "role"])("pending cannot independently retarget %s", (field) => {
  const value = pendingDraft();
  Object.assign(value.pending!, { [field]: field === "expectedManifestHash" ? "b".repeat(64) : field === "textStart" ? 0 : field === "textEnd" ? value.source.rawText.length : field === "role" ? "parameters" : "other" });
  reject(value);
});
test.each(["rawText", "ownerId", "sourceFingerprint", "confirmed"])("pending cannot add client assertion %s", (field) => {
  const value = pendingDraft(); Object.assign(value.pending!, { [field]: "forbidden" }); reject(value);
});
test("pending requires a nonempty current selection and a safe original request key", () => {
  const value = pendingDraft(); value.range = null; reject(value);
  const unsafe = pendingDraft(); unsafe.pending!.idempotencyKey = "bad\nkey"; reject(unsafe);
});
test("does not call nested getters or toJSON and rejects cyclic/prototype/symbol input", () => {
  const value = draft(), getter = vi.fn(() => value.source);
  Object.defineProperty(value, "source", { get: getter }); reject(value); expect(getter).not.toHaveBeenCalled();
  const json = vi.fn(() => draft()); reject({ ...draft(), toJSON: json }); expect(json).not.toHaveBeenCalled();
  const cyclic: Record<string, unknown> = { ...draft() }; cyclic.source = cyclic; reject(cyclic);
  reject(Object.create(draft())); reject({ ...draft(), [Symbol("hidden")]: true });
  reject({ ...draft(), source: new Array(2) });
});
test("scope changes only for its explicit original basis fields", () => {
  const value = draft(), original = manualFragmentScope(value.basis);
  expect(manualFragmentScope({ ...value.basis, expectedRevisionId: "next" })).not.toBe(original);
  expect(manualFragmentScope({ ...value.basis, expectedSnapshotId: "next" })).not.toBe(original);
  expect(manualFragmentScope({ ...value.basis, expectedManifestHash: "b".repeat(64) })).not.toBe(original);
  expect(() => manualFragmentScope({ ...value.basis, expectedSnapshotId: "" })).toThrow();
});
