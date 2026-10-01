import { expect, test, vi } from "vitest";
import { parseCreatePromptCurationRequest, parseRevisePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { capturePromptCurationDraft, parsePromptCurationDraft, promptCurationDraftRequest, promptCurationScope, type PromptCurationDraftOriginal, type PromptCurationRecoveryDraft } from "@/lib/v2/editor/prompt-curation-draft";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const rawText = "  alpha🙂\r\n e\u0301 != é\r\n尾  ";
function original(id = "fragment-original"): Mutable<PromptCurationDraftOriginal> {
  return { id, snapshotId: "snapshot-original", memberId: "member-original", rawText, role: "prompt", stateVersion: 3, origin: "manual", isManual: null,
    completeness: "partial", sourceItemId: "source-original", sourceUrl: "https://www.threads.com/@author/post/original?xmt=exact" };
}
function draft(): Mutable<PromptCurationRecoveryDraft> {
  return { contract: "prompt-curation-draft.v1", draft: { basis: { expectedRevisionId: "document-revision-original", expectedSnapshotId: "snapshot-original", expectedManifestHash: "a".repeat(64) },
    groupKey: "group-original", head: null, dirty: true, conflict: false, content: { title: "  내 정리🙂\r\n  ", relationKind: "continuation", relationshipConfirmation: "unconfirmed", orderConfirmation: "user_confirmed",
      items: [{ itemKey: "item-original", fragmentId: "fragment-original", expectedFragmentStateVersion: 3, copyRole: "prompt", position: 0 }],
      examples: [{ exampleKey: "example-original", itemKey: null, memberId: "image-member", attachmentId: "attachment-original", position: 0, evidenceMethod: "unresolved" }] }, originals: [original()] }, pending: null };
}
function pendingDraft(edit = false): Mutable<PromptCurationRecoveryDraft> {
  const value = draft(); if (edit) value.draft!.head = { id: "curation-original-head", revisionNumber: 7 };
  value.pending = structuredClone(promptCurationDraftRequest(value, "original-request-key")) as Mutable<NonNullable<PromptCurationRecoveryDraft["pending"]>>; return value;
}
function transition(action: "undo" | "archive" | "unarchive"): Mutable<PromptCurationRecoveryDraft> {
  const value = draft();
  return { contract: value.contract, draft: null, pending: { kind: "revise", groupKey: value.draft!.groupKey, originals: [original()],
    request: { ...value.draft!.basis, idempotencyKey: "original-transition-key", expectedCurationRevisionId: "head-7", expectedCurationRevisionNumber: 7,
      ...(action === "undo" ? { action, restoreRevisionId: "historical-2" } : { action }) } } };
}
function reject(value: unknown, capture = false) {
  expect(() => (capture ? capturePromptCurationDraft : parsePromptCurationDraft)(value)).toThrowError(expect.objectContaining({ code: "prompt_curation_draft_invalid" }));
}

test("lossless persisted roundtrip retains original basis, CRLF, spaces, emoji and normalization differences", () => {
  const input = draft(), parsed = parsePromptCurationDraft(JSON.parse(JSON.stringify(input)));
  expect(parsed).toEqual(input); expect(parsed.draft!.originals[0].rawText).toBe(rawText);
  expect(parsed.draft!.content.title).toBe("  내 정리🙂\r\n  ");
});
test.each(["", "  \r\n\t  "])("unfinished title %j and no items remain recoverable, not submittable", (title) => {
  const input = draft(); input.draft!.content.title = title; input.draft!.content.items = []; input.draft!.originals = [];
  expect(parsePromptCurationDraft(input)).toEqual(input);
  expect(() => promptCurationDraftRequest(input, "new-key")).toThrow();
});
test("unfinished alternatives/whole-image relation keeps the exact link but cannot form pending", () => {
  const input = draft(); input.draft!.content.relationKind = "alternatives";
  expect(parsePromptCurationDraft(input).draft!.content.examples[0].itemKey).toBeNull();
  expect(() => promptCurationDraftRequest(input, "key")).toThrow();
  input.draft!.content.examples[0].itemKey = "item-original";
  expect(promptCurationDraftRequest(input, "key").request).toEqual(parseCreatePromptCurationRequest({ ...input.draft!.basis, groupKey: input.draft!.groupKey, content: input.draft!.content, idempotencyKey: "key" }));
});
test.each(["prompt", "negative_prompt", "parameters"] as const)("preserves fixed %s source roles and explicit duplicate items", (role) => {
  const input = draft(); input.draft!.originals[0].role = role; input.draft!.content.items[0].copyRole = role;
  input.draft!.content.items.push({ ...input.draft!.content.items[0], itemKey: "explicit-duplicate", position: 1 });
  const parsed = parsePromptCurationDraft(input), pending = promptCurationDraftRequest(parsed, "key");
  expect(parsed.draft!.originals).toHaveLength(1); expect(parsed.draft!.content.items).toHaveLength(2);
  expect(pending.kind === "create" && pending.request.content.items.map((item) => item.fragmentId)).toEqual(["fragment-original", "fragment-original"]);
});
test.each([false, true])("create/edit pending keeps exact request with immutable original key (edit=%s)", (edit) => {
  const input = pendingDraft(edit), request = input.pending!.request;
  input.pending!.request = Object.fromEntries(Object.entries(request).reverse()) as typeof request;
  const parsed = parsePromptCurationDraft(input);
  expect(parsed.pending).toEqual(input.pending); expect(promptCurationDraftRequest(parsed, "original-request-key")).toEqual(input.pending);
  expect(() => promptCurationDraftRequest(parsed, "replacement-key")).toThrow();
  expect(promptCurationScope(parsed)).toBe(promptCurationScope({ ...parsed, pending: null }));
});
test.each(["undo", "archive", "unarchive"] as const)("pending-only %s preserves both original revision identity and source context", (action) => {
  const input = transition(action), parsed = parsePromptCurationDraft(JSON.parse(JSON.stringify(input)));
  expect(parsed).toEqual(input); expect(parsed.draft).toBeNull();
  expect(promptCurationDraftRequest(parsed, "original-transition-key")).toEqual(input.pending);
  expect(parsed.pending!.request).toEqual(parseRevisePromptCurationRequest(input.pending!.request));
  expect(() => promptCurationDraftRequest(parsed, "new-key")).toThrow();
});
test("scope distinguishes groups, original revision/head and undo target without including mutable title or request key", () => {
  const input = draft(), scope = promptCurationScope(input);
  const title = draft(); title.draft!.content.title = "edited"; expect(promptCurationScope(title)).toBe(scope);
  for (const mutate of [
    (x: Mutable<PromptCurationRecoveryDraft>) => { x.draft!.groupKey = "different"; },
    (x: Mutable<PromptCurationRecoveryDraft>) => { x.draft!.basis.expectedRevisionId = "next"; },
    (x: Mutable<PromptCurationRecoveryDraft>) => { x.draft!.basis.expectedSnapshotId = "next"; x.draft!.originals[0].snapshotId = "next"; },
    (x: Mutable<PromptCurationRecoveryDraft>) => { x.draft!.basis.expectedManifestHash = "b".repeat(64); },
    (x: Mutable<PromptCurationRecoveryDraft>) => { x.draft!.head = { id: "head", revisionNumber: 2 }; },
  ]) { const changed = draft(); mutate(changed); expect(promptCurationScope(changed)).not.toBe(scope); }
  const undo = transition("undo"), changed = transition("undo");
  if (changed.pending!.kind === "revise" && changed.pending!.request.action === "undo") changed.pending!.request.restoreRevisionId = "different-target";
  expect(promptCurationScope(changed)).not.toBe(promptCurationScope(undo));
  expect(promptCurationScope(transition("archive"))).not.toBe(promptCurationScope(transition("unarchive")));
});
test("synchronously owns nested content, source context and pending before caller mutation", () => {
  const input = pendingDraft(true), parsed = parsePromptCurationDraft(input), captured = capturePromptCurationDraft(input);
  input.draft!.originals[0].rawText = "changed"; input.draft!.basis.expectedRevisionId = "new";
  input.draft!.content.items[0].position = 8; input.pending!.originals[0].rawText = "changed pending"; input.pending!.request.idempotencyKey = "new-key";
  for (const result of [parsed, captured]) {
    expect(result.draft!.originals[0].rawText).toBe(rawText); expect(result.draft!.content.items[0].position).toBe(0);
    expect(result.draft!.basis.expectedRevisionId).toBe("document-revision-original"); expect(result.pending!.originals[0].rawText).toBe(rawText);
    expect(result.pending!.request.idempotencyKey).toBe("original-request-key");
  }
});
test("UI capture normalizes only documented absent/undefined optionals and historical missing member", () => {
  const input = draft(), row = input.draft!.originals[0]; row.origin = "stored"; row.memberId = "";
  Reflect.deleteProperty(row, "sourceItemId"); Object.assign(row, { sourceUrl: undefined, isManual: undefined });
  reject(input);
  const captured = capturePromptCurationDraft(input);
  expect(captured.draft!.originals[0]).toMatchObject({ memberId: null, sourceItemId: null, sourceUrl: null, isManual: null, origin: "stored" });
  expect(parsePromptCurationDraft(JSON.parse(JSON.stringify(captured)))).toEqual(captured);
  expect(row.memberId).toBe(""); expect(Object.hasOwn(row, "sourceItemId")).toBe(false);
});
test("UI capture prunes removed candidates and coalesces identical cached originals, never selected items", () => {
  const input = draft(); input.draft!.content.items.push({ ...input.draft!.content.items[0], itemKey: "intentional-repeat", position: 1 });
  input.draft!.originals.push(original("removed"), original());
  reject(input);
  const captured = capturePromptCurationDraft(input);
  expect(captured.draft!.originals).toHaveLength(1); expect(captured.draft!.content.items).toHaveLength(2);
  expect(input.draft!.originals).toHaveLength(3);
  input.draft!.originals[2].rawText += "changed"; reject(input, true);
});
test("source context cannot claim its origin as authority; known absent provenance remains absent", () => {
  for (const origin of ["manual", "ai", "stored"] as const) {
    const input = draft(); input.draft!.originals[0].origin = origin;
    expect(parsePromptCurationDraft(input).draft!.originals[0]).toMatchObject({ origin, isManual: null, completeness: "partial" });
  }
});
test("preserves the UI URL.href of a legal Unicode original whose encoding exceeds 2048 characters", () => {
  const input = draft(), url = new URL(`https://example.com/${"한".repeat(2000)}`).href;
  expect(url.length).toBeGreaterThan(2048); input.draft!.originals[0].sourceUrl = url;
  expect(parsePromptCurationDraft(input).draft!.originals[0].sourceUrl).toBe(url);
  expect(capturePromptCurationDraft(input).draft!.originals[0].sourceUrl).toBe(url);
});
test("supports the full 64-item/64-image Unicode-ID request without trimming or lowering limits", () => {
  const input = draft(), content = input.draft!.content, source = input.draft!.originals[0];
  source.id = "한".repeat(200);
  content.items = Array.from({ length: 64 }, (_, position) => ({ itemKey: `${position}${"🙂".repeat(98)}`, fragmentId: source.id, expectedFragmentStateVersion: source.stateVersion, copyRole: "prompt", position }));
  content.examples = Array.from({ length: 64 }, (_, position) => ({ exampleKey: `${position}${"한".repeat(198)}`, itemKey: content.items[position].itemKey, memberId: "이미지".repeat(66), attachmentId: "첨부".repeat(100), position, evidenceMethod: "user_confirmed" }));
  const pending = promptCurationDraftRequest(input, "요청".repeat(100));
  expect(pending.kind === "create" && pending.request.content.items).toHaveLength(64);
  expect(pending.kind === "create" && pending.request.content.examples).toHaveLength(64);
});

const mutations: [string, (value: Mutable<PromptCurationRecoveryDraft>) => void][] = [
  ["contract", (x) => { Object.assign(x, { contract: "migration-draft.v1" }); }],
  ["empty payload", (x) => { x.draft = null; }],
  ["missing pending", (x) => { Reflect.deleteProperty(x, "pending"); }],
  ["undefined pending", (x) => { Object.assign(x, { pending: undefined }); }],
  ["claimed owner", (x) => { Object.assign(x, { ownerId: "other" }); }],
  ["personal memo", (x) => { Object.assign(x.draft!, { memo: "private" }); }],
  ["extra source catalog", (x) => { Object.assign(x.draft!, { catalog: [original("not selected")] }); }],
  ["unknown basis", (x) => { Object.assign(x.draft!.basis, { currentSnapshotId: "latest" }); }],
  ["manifest case", (x) => { x.draft!.basis.expectedManifestHash = "A".repeat(64); }],
  ["group empty", (x) => { x.draft!.groupKey = ""; }],
  ["ID C1 control", (x) => { x.draft!.groupKey = "bad\u0080"; }],
  ["ID newline", (x) => { x.draft!.basis.expectedRevisionId += "\n"; }],
  ["ID surrogate", (x) => { x.draft!.basis.expectedSnapshotId += "\ud800"; }],
  ["ID limit", (x) => { x.draft!.groupKey = "x".repeat(201); }],
  ["head zero", (x) => { x.draft!.head = { id: "head", revisionNumber: 0 }; }],
  ["head unsafe integer", (x) => { x.draft!.head = { id: "head", revisionNumber: Number.MAX_SAFE_INTEGER + 1 }; }],
  ["dirty type", (x) => { Object.assign(x.draft!, { dirty: 1 }); }],
  ["title limit", (x) => { x.draft!.content.title = "x".repeat(201); }],
  ["title invalid UTF16", (x) => { x.draft!.content.title = "\ud800"; }],
  ["relation enum", (x) => { Object.assign(x.draft!.content, { relationKind: "auto_pair" }); }],
  ["confirmation enum", (x) => { Object.assign(x.draft!.content, { orderConfirmation: "ai_confirmed" }); }],
  ["item arbitrary raw", (x) => { Object.assign(x.draft!.content.items[0], { rawText: "rewrite" }); }],
  ["item role mismatch", (x) => { x.draft!.content.items[0].copyRole = "parameters"; }],
  ["item version mismatch", (x) => { x.draft!.content.items[0].expectedFragmentStateVersion = 4; }],
  ["item position gap", (x) => { x.draft!.content.items[0].position = 1; }],
  ["item key duplicate", (x) => { x.draft!.content.items.push({ ...x.draft!.content.items[0], position: 1 }); }],
  ["missing selected original", (x) => { x.draft!.originals = []; }],
  ["unselected cached original", (x) => { x.draft!.originals.push(original("unselected")); }],
  ["duplicate cached original", (x) => { x.draft!.originals.push(original()); }],
  ["source wrong snapshot", (x) => { x.draft!.originals[0].snapshotId = "another"; }],
  ["source authority", (x) => { Object.assign(x.draft!.originals[0], { verified: true }); }],
  ["AI interpretation field", (x) => { Object.assign(x.draft!.originals[0], { derivedText: "summary" }); }],
  ["source role enum", (x) => { Object.assign(x.draft!.originals[0], { role: "ai_interpretation" }); }],
  ["source completeness enum", (x) => { Object.assign(x.draft!.originals[0], { completeness: "verified" }); }],
  ["source origin enum", (x) => { Object.assign(x.draft!.originals[0], { origin: "memo" }); }],
  ["source AI manual contradiction", (x) => { x.draft!.originals[0].origin = "ai"; x.draft!.originals[0].isManual = true; }],
  ["source manual contradiction", (x) => { x.draft!.originals[0].isManual = false; }],
  ["source missing active member", (x) => { x.draft!.originals[0].memberId = null; }],
  ["source raw surrogate", (x) => { x.draft!.originals[0].rawText += "\udfff"; }],
  ["source raw excessive", (x) => { x.draft!.originals[0].rawText = "x".repeat(500_001); }],
  ["source raw wrong type", (x) => { Object.assign(x.draft!.originals[0], { rawText: null }); }],
  ["source URL unsafe", (x) => { x.draft!.originals[0].sourceUrl = "javascript:alert(1)"; }],
  ["source URL credentials", (x) => { x.draft!.originals[0].sourceUrl = "https://username:password@example.com"; }],
  ["source URL whitespace", (x) => { x.draft!.originals[0].sourceUrl = "https://exam\nple.com"; }],
  ["image unknown field", (x) => { Object.assign(x.draft!.content.examples[0], { remoteUrl: "https://example.com" }); }],
  ["image dangling item", (x) => { x.draft!.content.examples[0].itemKey = "missing"; }],
  ["image position gap", (x) => { x.draft!.content.examples[0].position = 1; }],
  ["image evidence enum", (x) => { Object.assign(x.draft!.content.examples[0], { evidenceMethod: "ai_confirmed" }); }],
];
test.each(mutations)("rejects unsafe/inconsistent persisted draft: %s", (_name, mutate) => { const input = draft(); mutate(input); reject(input); });
test.each(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "groupKey", "content"])("create pending cannot independently change %s", (field) => {
  const input = pendingDraft(); Object.assign(input.pending!.request, { [field]: field === "expectedManifestHash" ? "b".repeat(64) : field === "content" ? { ...input.draft!.content, title: "new title" } : "other" }); reject(input);
});
test.each(["expectedCurationRevisionId", "expectedCurationRevisionNumber", "action"])("edit pending cannot independently change %s", (field) => {
  const input = pendingDraft(true); Object.assign(input.pending!.request, { [field]: field === "expectedCurationRevisionNumber" ? 8 : field === "action" ? "archive" : "another-head" }); reject(input);
});
test.each(["url", "identity", "scope", "clearDraft", "ownerId"])("pending cannot store client transport/authority field %s", (field) => {
  const input = pendingDraft(); Object.assign(input.pending!, { [field]: "untrusted" }); reject(input);
});
test("pending preserves source claims but rejects different raw, origin, group, or missing edit draft", () => {
  const raw = pendingDraft(); raw.pending!.originals[0].rawText = "rewritten"; reject(raw);
  const origin = pendingDraft(); origin.pending!.originals[0].origin = "ai"; reject(origin);
  const group = pendingDraft(true); group.pending!.groupKey = "other"; reject(group);
  const absent = pendingDraft(); absent.draft = null; reject(absent);
  const combined = transition("archive"); combined.draft = draft().draft; reject(combined);
});
test("keeps conflict state without retargeting an already submitted operation", () => {
  const input = pendingDraft(true); input.draft!.conflict = true;
  const restored = parsePromptCurationDraft(input);
  expect(restored.draft!.conflict).toBe(true);
  expect(promptCurationDraftRequest(restored, "original-request-key")).toEqual(input.pending);
});
test("all action bodies use existing strict request parsers, without migrate or fabricated confirmations", () => {
  const undo = transition("undo"); if (undo.pending!.kind === "revise") Reflect.deleteProperty(undo.pending!.request, "restoreRevisionId"); reject(undo);
  const archive = transition("archive"); Object.assign(archive.pending!.request, { restoreRevisionId: "not-permitted" }); reject(archive);
  const migrate = transition("archive"); Object.assign(migrate.pending!.request, { action: "migrate", expectedPlanHash: "a".repeat(64) }); reject(migrate);
  const server = pendingDraft(); Object.assign(server.pending!.request, { confirmed: true }); reject(server);
  const empty = transition("archive"); empty.pending!.originals = []; reject(empty);
});
test("rejects accessor, prototype, sparse/extended/subclass arrays and cycles without invoking code", () => {
  const root = draft(), getter = vi.fn(() => root.draft);
  Object.defineProperty(root, "draft", { get: getter }); reject(root); reject(root, true); expect(getter).not.toHaveBeenCalled();
  const nested = draft(), rawGetter = vi.fn(() => rawText); Object.defineProperty(nested.draft!.originals[0], "rawText", { get: rawGetter }); reject(nested); reject(nested, true); expect(rawGetter).not.toHaveBeenCalled();
  const optional = draft(), optionalGetter = vi.fn(() => undefined); Object.defineProperty(optional.draft!.originals[0], "sourceUrl", { get: optionalGetter }); reject(optional, true); expect(optionalGetter).not.toHaveBeenCalled();
  const toJSON = vi.fn(() => draft()); reject({ ...draft(), toJSON }); expect(toJSON).not.toHaveBeenCalled();
  reject(Object.create(draft())); reject({ ...draft(), [Symbol("hidden")]: true });
  const cycle = draft(); Object.assign(cycle.draft!.content, { title: cycle }); reject(cycle);
  const sparse = draft(); sparse.draft!.content.items = new Array(1); reject(sparse);
  const accessorArray = draft(), arrayGetter = vi.fn(() => original()); Object.defineProperty(accessorArray.draft!.originals, "0", { get: arrayGetter }); reject(accessorArray, true); expect(arrayGetter).not.toHaveBeenCalled();
  const extended = draft(); Object.assign(extended.draft!.content.items, { extra: true }); reject(extended);
  const subclass = draft(); Object.setPrototypeOf(subclass.draft!.content.items, Object.create(Array.prototype)); reject(subclass); reject(subclass, true);
});
test.each(["rawText", "memberId", "origin", "completeness"])("UI adapter does not silently strip nonoptional undefined %s", (field) => {
  const input = draft(); Object.assign(input.draft!.originals[0], { [field]: undefined }); reject(input, true);
});
test("known null optional fields work with own null-prototype data", () => {
  const input = draft(); Object.setPrototypeOf(input, null); Object.setPrototypeOf(input.draft!.originals[0], null);
  expect(parsePromptCurationDraft(input)).toEqual(draft());
});
test("rejects item/image/candidate count and aggregate text budgets rather than truncating", () => {
  const items = draft(); items.draft!.content.items = Array.from({ length: 65 }, (_, position) => ({ ...items.draft!.content.items[0], itemKey: `item-${position}`, position })); reject(items);
  const images = draft(); images.draft!.content.examples = Array.from({ length: 65 }, (_, position) => ({ ...images.draft!.content.examples[0], exampleKey: `example-${position}`, position })); reject(images);
  const candidates = draft(); candidates.draft!.originals = Array.from({ length: 1025 }, (_, index) => original(String(index))); reject(candidates, true);
  const large = draft(); large.draft!.originals = Array.from({ length: 5 }, (_, index) => ({ ...original(String(index)), rawText: "x".repeat(500_000) }));
  large.draft!.content.items = large.draft!.originals.map((row, position) => ({ itemKey: `item-${position}`, fragmentId: row.id, expectedFragmentStateVersion: row.stateVersion, copyRole: row.role, position }));
  reject(large); reject(large, true);
});
