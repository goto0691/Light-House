import { afterEach, expect, test, vi } from "vitest";
import { linkSha256Hex, type LinkSnapshotMemberV1 } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { planPromptCurationMigration } from "@/lib/v2/domain/prompt-curation-migration";
import { extractManualPromptFragment, type PromptCurationInput } from "@/lib/v2/domain/prompt-curation-v1";
import { capturePromptCurationMigrationDraft, parsePromptCurationMigrationDraft, promptCurationMigrationScope, type PromptCurationMigrationDraft } from "@/lib/v2/editor/prompt-curation-migration-draft";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Draft = Mutable<PromptCurationMigrationDraft>;
afterEach(() => vi.restoreAllMocks());
function draft(): Draft {
  return { contract: "prompt-curation-migration-draft.v1", phase: "review", plan: {
    contract: "prompt-curation-migration.v1", recordId: "record", sourceGroupKey: "old-group", sourceRevisionId: "old-curation-revision",
    sourceSnapshotId: "old-snapshot", sourceManifestHash: "a".repeat(64), expectedRevisionId: "document-revision", expectedSnapshotId: "target-snapshot",
    expectedManifestHash: "b".repeat(64), items: [
      { itemKey: "first", fragmentId: "original-fragment", memberId: "target-member", match: "member_key" },
      { itemKey: "duplicate", fragmentId: "original-fragment", memberId: "target-member", match: "member_key" },
    ], examples: [{ exampleKey: "example", memberId: "target-image", attachmentId: "attachment", match: "fingerprint" }],
    issues: [], selectionConfirmations: ["first", "duplicate"], ready: true, planHash: "c".repeat(64),
  }, request: { expectedRevisionId: "document-revision", expectedSnapshotId: "target-snapshot", expectedManifestHash: "b".repeat(64),
    expectedPlanHash: "c".repeat(64), groupKey: "new-group", idempotencyKey: "original-request-key" } };
}
function blocked(): Draft {
  const value = draft(); value.plan.items.pop(); value.plan.issues.push({ kind: "item", key: "duplicate", reason: "missing" }); value.plan.ready = false; return value;
}
function reject(value: unknown) {
  for (const parse of [parsePromptCurationMigrationDraft, capturePromptCurationMigrationDraft]) {
    expect(() => parse(value)).toThrowError(expect.objectContaining({ code: "prompt_curation_migration_draft_invalid" }));
  }
}

test.each(["review", "pending"] as const)("%s roundtrip retains the exact old source, target, plan and original request", (phase) => {
  const value = draft(); value.phase = phase;
  const input = JSON.parse(JSON.stringify(value));
  expect(parsePromptCurationMigrationDraft(input)).toEqual(value);
  expect(capturePromptCurationMigrationDraft(input)).toEqual(value);
  expect(Object.keys(parsePromptCurationMigrationDraft(input))).toEqual(["contract", "phase", "plan", "request"]);
});
test("blocked review retains mappings/issues and formerly AI-selected unresolved item keys", () => {
  const value = blocked(); expect(parsePromptCurationMigrationDraft(value)).toEqual(value);
  value.phase = "pending"; reject(value);
});
test("same-snapshot review retains its mandatory issue without confusing curation and snapshot manifests", () => {
  const value = draft(); value.plan.sourceSnapshotId = value.plan.expectedSnapshotId;
  value.plan.issues = [{ kind: "snapshot", key: value.plan.expectedSnapshotId, reason: "same_snapshot" }]; value.plan.ready = false;
  expect(parsePromptCurationMigrationDraft(value)).toEqual(value);
  expect(value.plan.sourceManifestHash).not.toBe(value.plan.expectedManifestHash);
});
test("all missing selections remain a recoverable review, never a ready/pending migration", () => {
  const value = draft(); value.plan.issues = value.plan.items.map((item) => ({ kind: "item", key: item.itemKey, reason: "missing" }));
  value.plan.items = []; value.plan.ready = false;
  expect(parsePromptCurationMigrationDraft(value).plan.items).toEqual([]);
});
test("duplicate fragment selections and reused images keep distinct item/example keys and original array order", () => {
  const value = draft(); value.plan.examples.push({ ...value.plan.examples[0], exampleKey: "second-example" });
  value.plan.items.reverse(); value.plan.selectionConfirmations.reverse();
  const parsed = parsePromptCurationMigrationDraft(value);
  expect(parsed.plan.items).toEqual(value.plan.items); expect(parsed.plan.examples).toEqual(value.plan.examples);
  expect(parsed.plan.selectionConfirmations).toEqual(["duplicate", "first"]);
});
test("IDs retain allowed whitespace, Unicode and normalization distinctions without substitution", () => {
  const value = draft(); value.plan.recordId = "  기록🙂  "; value.plan.sourceRevisionId = "e\u0301";
  value.plan.items[0].itemKey = "é"; value.plan.items[1].itemKey = "e\u0301"; value.plan.selectionConfirmations = ["é", "e\u0301"];
  value.request.idempotencyKey = "  원래 요청🙂  ";
  expect(parsePromptCurationMigrationDraft(value)).toEqual(value);
});
test("parsing/capture owns all nested data synchronously before caller mutation", () => {
  const value = blocked(), parsed = parsePromptCurationMigrationDraft(value), captured = capturePromptCurationMigrationDraft(value), expected = structuredClone(value);
  value.plan.items[0].memberId = "changed"; value.plan.examples[0].attachmentId = "changed"; value.plan.issues[0].reason = "ambiguous";
  value.plan.selectionConfirmations[0] = "changed"; value.plan.sourceRevisionId = "changed"; value.request.idempotencyKey = "changed";
  expect(parsed).toEqual(expected); expect(captured).toEqual(expected);
  parsed.plan.items[0].memberId = "changed output"; expect(captured).toEqual(expected);
});
test("null-prototype records and reordered own keys are copied into a deterministic schema order", () => {
  function reordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reordered);
    if (value && typeof value === "object") return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)])));
    return value;
  }
  const value = draft(); expect(parsePromptCurationMigrationDraft(reordered(value))).toEqual(value);
  expect(promptCurationMigrationScope(parsePromptCurationMigrationDraft(reordered(value)))).toBe(promptCurationMigrationScope(value));
});
test("no digest, random ID, fetch or asynchronous verification occurs in the parser/capture/scope", () => {
  const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => { throw new Error("Unexpected digest"); });
  const random = vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("Unexpected generated ID"); });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected request"); });
  const value = draft(); value.plan.planHash = "f".repeat(64); value.request.expectedPlanHash = value.plan.planHash;
  expect(parsePromptCurationMigrationDraft(value)).toEqual(value); expect(capturePromptCurationMigrationDraft(value)).toEqual(value);
  expect(typeof promptCurationMigrationScope(value)).toBe("string");
  expect(digest).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test("scope is stable across review/pending and distinguishes every original operation identity", () => {
  const value = draft(), scope = promptCurationMigrationScope(value); value.phase = "pending"; expect(promptCurationMigrationScope(value)).toBe(scope);
  const changes: ((x: Draft) => void)[] = [
    (x) => { x.plan.recordId = "other"; }, (x) => { x.plan.sourceGroupKey = "other"; }, (x) => { x.plan.sourceRevisionId = "other"; },
    (x) => { x.plan.sourceSnapshotId = "other"; }, (x) => { x.plan.sourceManifestHash = "d".repeat(64); },
    (x) => { x.plan.expectedRevisionId = x.request.expectedRevisionId = "other"; },
    (x) => { x.plan.expectedSnapshotId = x.request.expectedSnapshotId = "other"; },
    (x) => { x.plan.expectedManifestHash = x.request.expectedManifestHash = "d".repeat(64); },
    (x) => { x.plan.planHash = x.request.expectedPlanHash = "d".repeat(64); },
    (x) => { x.request.groupKey = "other"; }, (x) => { x.request.idempotencyKey = "other"; },
  ];
  for (const change of changes) { const changed = draft(); change(changed); expect(promptCurationMigrationScope(changed)).not.toBe(scope); }
});
test("full 64 item/image/confirmation plan with maximum Unicode IDs is accepted without truncation", () => {
  const value = draft(), id = (n: number) => `${n.toString().padStart(2, "0")}${"🙂".repeat(99)}`;
  value.plan.items = Array.from({ length: 64 }, (_, index) => ({ itemKey: id(index), fragmentId: "한".repeat(200), memberId: "원문".repeat(100), match: "member_key" }));
  value.plan.examples = Array.from({ length: 64 }, (_, index) => ({ exampleKey: id(index), memberId: "이미지".repeat(66), attachmentId: "그림".repeat(100), match: "fingerprint" }));
  value.plan.selectionConfirmations = value.plan.items.map((item) => item.itemKey); value.request.idempotencyKey = "키".repeat(200); value.phase = "pending";
  expect(parsePromptCurationMigrationDraft(value)).toEqual(value);
});
test("full 129 issue partition is valid for a same-snapshot blocked review", () => {
  const value = draft(); value.plan.sourceSnapshotId = value.plan.expectedSnapshotId; value.plan.items = []; value.plan.examples = []; value.plan.ready = false;
  value.plan.issues = [{ kind: "snapshot", key: value.plan.expectedSnapshotId, reason: "same_snapshot" },
    ...Array.from({ length: 64 }, (_, index) => ({ kind: "item" as const, key: `item-${index}`, reason: "ambiguous" as const })),
    ...Array.from({ length: 64 }, (_, index) => ({ kind: "example" as const, key: `example-${index}`, reason: "changed" as const }))];
  value.plan.selectionConfirmations = value.plan.issues.filter((issue) => issue.kind === "item").map((issue) => issue.key);
  expect(parsePromptCurationMigrationDraft(value)).toEqual(value);
});

const mutations: [string, (value: Draft) => void][] = [
  ["contract", (x) => { Object.assign(x, { contract: "prompt-curation-draft.v1" }); }],
  ["missing phase", (x) => { Reflect.deleteProperty(x, "phase"); }],
  ["unknown phase", (x) => { Object.assign(x, { phase: "saved" }); }],
  ["undefined plan", (x) => { Object.assign(x, { plan: undefined }); }],
  ["plan contract", (x) => { Object.assign(x.plan, { contract: "migration.v2" }); }],
  ["source group missing", (x) => { Reflect.deleteProperty(x.plan, "sourceGroupKey"); }],
  ["empty record", (x) => { x.plan.recordId = ""; }],
  ["whitespace revision", (x) => { x.plan.sourceRevisionId = "   "; }],
  ["ID newline", (x) => { x.plan.sourceRevisionId += "\n"; }],
  ["ID C0", (x) => { x.plan.items[0].fragmentId += "\0"; }],
  ["ID C1", (x) => { x.plan.items[0].memberId += "\u0080"; }],
  ["ID unpaired high surrogate", (x) => { x.request.groupKey += "\ud800"; }],
  ["ID unpaired low surrogate", (x) => { x.plan.examples[0].attachmentId += "\udfff"; }],
  ["ID 201 units", (x) => { x.plan.sourceSnapshotId = "x".repeat(201); }],
  ["source manifest uppercase", (x) => { x.plan.sourceManifestHash = "A".repeat(64); }],
  ["source manifest short", (x) => { x.plan.sourceManifestHash = "a".repeat(63); }],
  ["target manifest prefixed", (x) => { x.plan.expectedManifestHash = "sha256:" + "b".repeat(64); }],
  ["plan hash numeric", (x) => { Object.assign(x.plan, { planHash: 1 }); }],
  ["request revision mismatch", (x) => { x.request.expectedRevisionId = "changed"; }],
  ["request snapshot mismatch", (x) => { x.request.expectedSnapshotId = "changed"; }],
  ["request manifest mismatch", (x) => { x.request.expectedManifestHash = "d".repeat(64); }],
  ["request plan hash mismatch", (x) => { x.request.expectedPlanHash = "d".repeat(64); }],
  ["request is source group", (x) => { x.request.groupKey = x.plan.sourceGroupKey; }],
  ["missing original key", (x) => { Reflect.deleteProperty(x.request, "idempotencyKey"); }],
  ["empty original key", (x) => { x.request.idempotencyKey = ""; }],
  ["unknown ready", (x) => { Object.assign(x.plan, { ready: 1 }); }],
  ["ready false without issues", (x) => { x.plan.ready = false; }],
  ["same snapshot missing issue", (x) => { x.plan.sourceSnapshotId = x.plan.expectedSnapshotId; }],
  ["no source items", (x) => { x.plan.items = []; x.plan.selectionConfirmations = []; }],
  ["duplicate item key", (x) => { x.plan.items[1].itemKey = x.plan.items[0].itemKey; }],
  ["same fragment other member", (x) => { x.plan.items[1].memberId = "other"; }],
  ["same fragment other match", (x) => { x.plan.items[1].match = "fingerprint"; }],
  ["unknown item match", (x) => { Object.assign(x.plan.items[0], { match: "fuzzy" }); }],
  ["duplicate example key", (x) => { x.plan.examples.push({ ...x.plan.examples[0] }); }],
  ["example match", (x) => { Object.assign(x.plan.examples[0], { match: "nearest" }); }],
  ["unknown confirmation", (x) => { x.plan.selectionConfirmations.push("not-an-item"); }],
  ["image confirmation", (x) => { x.plan.selectionConfirmations.push("example"); }],
  ["duplicate confirmation", (x) => { x.plan.selectionConfirmations.push("first"); }],
  ["mapped item also issue", (x) => { x.plan.issues.push({ kind: "item", key: "first", reason: "missing" }); x.plan.ready = false; }],
  ["mapped image also issue", (x) => { x.plan.issues.push({ kind: "example", key: "example", reason: "ambiguous" }); x.plan.ready = false; }],
  ["wrong snapshot issue", (x) => { x.plan.issues.push({ kind: "snapshot", key: x.plan.expectedSnapshotId, reason: "same_snapshot" }); x.plan.ready = false; }],
  ["item 65", (x) => { x.plan.items = Array.from({ length: 65 }, (_, i) => ({ ...x.plan.items[0], itemKey: String(i) })); x.plan.selectionConfirmations = []; }],
  ["image 65", (x) => { x.plan.examples = Array.from({ length: 65 }, (_, i) => ({ ...x.plan.examples[0], exampleKey: String(i) })); }],
  ["issues 130", (x) => { x.plan.issues = Array.from({ length: 130 }, (_, i) => ({ kind: "item", key: String(i), reason: "missing" })); x.plan.ready = false; }],
  ["confirmations 65", (x) => { x.plan.selectionConfirmations = Array.from({ length: 65 }, (_, i) => String(i)); }],
  ["partition item total 65", (x) => { x.plan.issues = Array.from({ length: 63 }, (_, i) => ({ kind: "item", key: String(i), reason: "missing" })); x.plan.ready = false; }],
  ["partition example total 65", (x) => { x.plan.issues = Array.from({ length: 64 }, (_, i) => ({ kind: "example", key: String(i), reason: "missing" })); x.plan.ready = false; }],
];
test.each(mutations)("both parsers reject %s without rewriting the input", (_name, mutate) => {
  const value = draft(); mutate(value); const before = structuredClone(value); reject(value); expect(value).toEqual(before);
});
test.each(["source", "target", "history", "confirmed", "saved", "error", "scope", "key", "ownerId", "restrictedGrant", "capabilities"])("cached %s is forbidden, including when undefined", (field) => {
  for (const value of [true, undefined]) { const input = draft(); Object.assign(input, { [field]: value }); reject(input); }
});
test.each(["plan", "request", "item", "example", "issue"])("unknown data cannot hide inside %s", (part) => {
  const value = blocked(), row = part === "plan" ? value.plan : part === "request" ? value.request : part === "item" ? value.plan.items[0] : part === "example" ? value.plan.examples[0] : value.plan.issues[0];
  Object.assign(row, { rawText: "must not persist" }); reject(value);
});
test.each(["root", "plan", "request", "item", "example", "issue", "array", "confirmation"])("%s accessor is rejected without invocation", (part) => {
  const value = blocked(), getter = vi.fn(() => { throw new Error("Getter invoked"); });
  const [object, key] = part === "root" ? [value, "phase"] : part === "plan" ? [value.plan, "recordId"] : part === "request" ? [value.request, "groupKey"]
    : part === "item" ? [value.plan.items[0], "memberId"] : part === "example" ? [value.plan.examples[0], "memberId"]
      : part === "issue" ? [value.plan.issues[0], "reason"] : part === "array" ? [value.plan.items, "0"] : [value.plan.selectionConfirmations, "0"];
  Object.defineProperty(object, key, { get: getter, enumerable: true }); reject(value); expect(getter).not.toHaveBeenCalled();
});
test.each(["hole", "array subclass", "array extra", "array symbol", "root symbol", "inherited root", "cycle", "toJSON", "function", "date"])("non-JSON %s cannot enter the durable payload", (kind) => {
  const value = draft(), callback = vi.fn();
  if (kind === "hole") Reflect.deleteProperty(value.plan.items, "0");
  if (kind === "array subclass") Object.setPrototypeOf(value.plan.items, class extends Array {}.prototype);
  if (kind === "array extra") Object.assign(value.plan.items, { arbitrary: 1 });
  if (kind === "array symbol") Object.assign(value.plan.items, { [Symbol("extra")]: 1 });
  if (kind === "root symbol") Object.assign(value, { [Symbol("extra")]: 1 });
  if (kind === "inherited root") { Reflect.deleteProperty(value, "phase"); Object.setPrototypeOf(value, { phase: "review" }); }
  if (kind === "cycle") Object.assign(value.plan.items[0], { fragmentId: value });
  if (kind === "toJSON") Object.assign(value.request, { toJSON: callback });
  if (kind === "function") Object.assign(value.plan, { sourceGroupKey: callback });
  if (kind === "date") Object.assign(value.plan, { sourceRevisionId: new Date() });
  reject(value); expect(callback).not.toHaveBeenCalled();
});
test.each(["duplicate issue", "bad kind", "bad item reason", "bad image reason", "snapshot wrong key", "duplicate snapshot", "false ready"])("blocked review rejects %s", (kind) => {
  const value = blocked();
  if (kind === "duplicate issue") value.plan.issues.push({ ...value.plan.issues[0] });
  if (kind === "bad kind") Object.assign(value.plan.issues[0], { kind: "record" });
  if (kind === "bad item reason") Object.assign(value.plan.issues[0], { reason: "same_snapshot" });
  if (kind === "bad image reason") { value.plan.examples = []; value.plan.issues.push({ kind: "example", key: "example", reason: "range_changed" }); }
  if (kind === "snapshot wrong key") { value.plan.sourceSnapshotId = value.plan.expectedSnapshotId; value.plan.issues.push({ kind: "snapshot", key: "other", reason: "same_snapshot" }); }
  if (kind === "duplicate snapshot") { value.plan.sourceSnapshotId = value.plan.expectedSnapshotId; value.plan.issues.push(...Array.from({ length: 2 }, () => ({ kind: "snapshot" as const, key: value.plan.expectedSnapshotId, reason: "same_snapshot" as const }))); }
  if (kind === "false ready") value.plan.ready = true;
  reject(value);
});

test.each(["matched", "missing", "same_snapshot"] as const)("real pure planner %s output roundtrips without cached source/target content", async (scenario) => {
  const value = draft(), rawText = "  원문🙂\r\ne\u0301 != é\r\n", metadata = makeManualLinkMetadata({ url: "https://example.test/original", completeness: "partial" });
  const source = { memberKey: "member-key", sourceFingerprint: "d".repeat(64), rawText, contentHash: await linkSha256Hex(rawText), completeness: "partial" as const,
    parts: { number: { value: null, origin: "unknown" as const }, total: { value: null, origin: "unknown" as const } } };
  const selected = await extractManualPromptFragment(source, { textStart: 0, textEnd: rawText.length, role: "prompt" });
  const input: PromptCurationInput = { snapshotManifestHash: "a".repeat(64), title: "이관", relationKind: "continuation", relationshipConfirmation: "user_confirmed",
    orderConfirmation: "user_confirmed", separator: "\n", sources: [source], items: [
      { itemKey: "first", copyRole: "prompt", position: 0, fragment: { ...selected, selectionOrigin: "ai_selected", completeness: "truncated" } },
      { itemKey: "duplicate", copyRole: "prompt", position: 1, fragment: { ...selected, selectionOrigin: "ai_selected", completeness: "truncated" } },
    ], examples: [] };
  const content = { title: input.title, relationKind: input.relationKind, relationshipConfirmation: input.relationshipConfirmation, orderConfirmation: input.orderConfirmation,
    items: input.items.map((item) => ({ itemKey: item.itemKey, fragmentId: "original-fragment", expectedFragmentStateVersion: 1, copyRole: item.copyRole, position: item.position })), examples: [] };
  const member: LinkSnapshotMemberV1 = { ...source, id: "target-member", snapshotId: value.plan.expectedSnapshotId, sourceItemId: "source-item", sourceOrder: 0,
    kind: "url", metadata, manualLink: metadata.manualLinkV1, attachments: [] };
  const basis = { recordId: value.plan.recordId, sourceGroupKey: value.plan.sourceGroupKey, sourceRevisionId: value.plan.sourceRevisionId,
    sourceSnapshotId: scenario === "same_snapshot" ? value.plan.expectedSnapshotId : value.plan.sourceSnapshotId, sourceManifestHash: value.plan.sourceManifestHash,
    expectedRevisionId: value.plan.expectedRevisionId, expectedSnapshotId: value.plan.expectedSnapshotId, expectedManifestHash: value.plan.expectedManifestHash };
  value.plan = await planPromptCurationMigration(basis, content, input, scenario === "missing" ? [] : [member]);
  value.request.expectedPlanHash = value.plan.planHash;
  expect(parsePromptCurationMigrationDraft(value)).toEqual(value);
  expect(JSON.stringify(parsePromptCurationMigrationDraft(value))).not.toContain(rawText);
  expect(value.plan.ready).toBe(scenario === "matched");
});
