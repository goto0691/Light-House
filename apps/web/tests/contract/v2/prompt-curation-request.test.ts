import { describe, expect, test, vi } from "vitest";
import { parseCreatePromptCurationRequest, parseRevisePromptCurationRequest, promptCurationId } from "@/lib/v2/domain/prompt-curation-request";
import { PromptCurationError } from "@/lib/v2/domain/prompt-curation-v1";

const basis = () => ({ expectedRevisionId: "document-revision", expectedSnapshotId: "snapshot", expectedManifestHash: "a".repeat(64), idempotencyKey: "request-key" });
const item = (itemKey = "item-one", position = 0, copyRole = "prompt") => ({ itemKey, fragmentId: "fragment-one", expectedFragmentStateVersion: 1, copyRole, position });
const example = (exampleKey = "example-one", position = 0, itemKey: string | null = null) => ({ exampleKey, itemKey, memberId: "image-member", attachmentId: "attachment-one", position, evidenceMethod: "unresolved" });
const content = () => ({ title: "  내 정리본 🙂  ", relationKind: "continuation", relationshipConfirmation: "unconfirmed", orderConfirmation: "user_confirmed", items: [item()], examples: [example()] });
const create = () => ({ ...basis(), groupKey: "group-one", content: content() });
const revision = () => ({ ...basis(), expectedCurationRevisionId: "curation-revision", expectedCurationRevisionNumber: 1 });
function rejects(work: () => unknown) {
  expect(work).toThrowError(expect.objectContaining({ name: "PromptCurationError", code: "prompt_curation_request_invalid" }));
}
function withField(value: object, key: PropertyKey, field: unknown) {
  return Object.defineProperty(value, key, { value: field, enumerable: true, configurable: true, writable: true });
}

describe("prompt curation request capture and action shapes", () => {
  test("preserves Unicode/title whitespace and exact IDs in detached plain data", () => {
    const input = create(); input.groupKey = "  그룹-e\u0301-🙂  ";
    const result = parseCreatePromptCurationRequest(input);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(result.content).not.toBe(input.content);
    expect(result.content.items).not.toBe(input.content.items); expect(result.content.items[0]).not.toBe(input.content.items[0]);
    expect(result.content.examples).not.toBe(input.content.examples); expect(result.content.examples[0]).not.toBe(input.content.examples[0]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
  test.each(["create", "edit"])("captures every nested value before the caller's next await: %s", async (action) => {
    const input = action === "create" ? create() : { ...revision(), action: "edit", content: content() };
    const result = action === "create" ? parseCreatePromptCurationRequest(input) : parseRevisePromptCurationRequest(input);
    const expected = structuredClone(result);
    await Promise.resolve();
    input.expectedRevisionId = "later"; input.content.title = "later"; input.content.items[0].fragmentId = "later";
    input.content.items[0].expectedFragmentStateVersion = 9; input.content.items.push(item("later", 1));
    input.content.examples[0].attachmentId = "later"; input.content.examples.length = 0;
    expect(result).toEqual(expected);
  });
  test("accepts null-prototype own data without carrying its objects forward", () => {
    const input = create();
    for (const value of [input, input.content, input.content.items[0], input.content.examples[0]]) Object.setPrototypeOf(value, null);
    const result = parseCreatePromptCurationRequest(input);
    expect(result.content.items[0].itemKey).toBe("item-one"); expect(Object.getPrototypeOf(result.content.items[0])).toBe(Object.prototype);
  });
  test("does not mutate frozen inputs while checking out-of-order positions", () => {
    const input = create(); input.content.items = [item("second", 1), item("first", 0)];
    for (const value of [...input.content.items, ...input.content.examples, input.content.items, input.content.examples, input.content, input]) Object.freeze(value);
    expect(parseCreatePromptCurationRequest(input)).toEqual(input);
  });
  test.each(["edit", "undo", "archive", "unarchive"])("accepts exactly the %s revision action", (action) => {
    const input = { ...revision(), action, ...(action === "edit" ? { content: content() } : action === "undo" ? { restoreRevisionId: "prior-revision" } : {}) };
    expect(parseRevisePromptCurationRequest(input)).toEqual(input);
  });
  test.each([
    ["edit", {}], ["edit", { restoreRevisionId: "prior" }], ["edit", { content: content(), restoreRevisionId: "prior" }],
    ["undo", {}], ["undo", { content: content() }], ["undo", { restoreRevisionId: "prior", content: content() }],
    ["archive", { content: content() }], ["archive", { restoreRevisionId: "prior" }],
    ["unarchive", { content: content() }], ["unarchive", { groupKey: "route-param" }], ["migrate", {}],
  ])("rejects fields that do not belong to action %s: %j", (action, extra) => {
    rejects(() => parseRevisePromptCurationRequest({ ...revision(), action, ...extra }));
  });
  test("does not let create impersonate revision/undo/archive writes", () => {
    for (const extra of [{ action: "edit" }, { expectedCurationRevisionId: "head" }, { restoreRevisionId: "old" }, { archived: true }]) {
      rejects(() => parseCreatePromptCurationRequest({ ...create(), ...extra }));
    }
  });
});

describe("bounded strings, IDs and versions", () => {
  test.each(["id", "e\u0301", "정리본-🙂", "x".repeat(200), "🙂".repeat(100), "  exact id  "])("preserves valid ID %s", (value) => {
    expect(promptCurationId(value)).toBe(value);
  });
  test.each([null, undefined, 1, {}, [], true, "", " \t ", "x".repeat(201), "🙂".repeat(100) + "x", "a\ud800", "\udfff", "\ud800x\udc00", "a\0b", "a\tb", "a\nb", "a\rb", "a\u007fb", "a\u0085b", "a\u009fb"])("rejects malformed ID %j", (value) => {
    rejects(() => promptCurationId(value));
  });
  test.each(["expectedRevisionId", "expectedSnapshotId", "idempotencyKey", "groupKey"])("validates create ID field %s", (key) => {
    rejects(() => parseCreatePromptCurationRequest(withField(create(), key, "a\0b")));
  });
  test.each(["itemKey", "fragmentId"])("validates nested item ID field %s", (key) => {
    const input = create(); withField(input.content.items[0], key, "bad\ud800"); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test.each(["exampleKey", "itemKey", "memberId", "attachmentId"])("validates nested image ID field %s", (key) => {
    const input = create(); withField(input.content.examples[0], key, "bad\u0001"); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test.each(["expectedCurationRevisionId", "restoreRevisionId"])("validates revision ID field %s", (key) => {
    rejects(() => parseRevisePromptCurationRequest(withField({ ...revision(), action: "undo", restoreRevisionId: "old" }, key, "bad\udfff")));
  });
  test.each(["A".repeat(64), "sha256:" + "a".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), "a".repeat(64) + "\n", null])("requires lowercase unprefixed SHA-256 %j", (hash) => {
    rejects(() => parseCreatePromptCurationRequest({ ...create(), expectedManifestHash: hash }));
    rejects(() => parseRevisePromptCurationRequest({ ...revision(), action: "archive", expectedManifestHash: hash }));
  });
  test.each(["", "  ", "x".repeat(201), "bad\ud800", "\udc00bad", null])("rejects invalid title %j", (title) => {
    const input = create(); withField(input.content, "title", title); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test("keeps the 200 UTF-16 title boundary and does not normalize composition", () => {
    const input = create(); input.content.title = "🙂".repeat(100);
    expect(parseCreatePromptCurationRequest(input).content.title).toBe(input.content.title);
    input.content.title = "e\u0301"; expect(parseCreatePromptCurationRequest(input).content.title).toBe("e\u0301");
  });
  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined])("rejects non-positive or unsafe version %j", (value) => {
    const input = create(); withField(input.content.items[0], "expectedFragmentStateVersion", value);
    rejects(() => parseCreatePromptCurationRequest(input));
    rejects(() => parseRevisePromptCurationRequest({ ...revision(), action: "archive", expectedCurationRevisionNumber: value }));
  });
  test("accepts safe upper-bound versions without pretending they match live rows", () => {
    const input = create(); input.content.items[0].expectedFragmentStateVersion = Number.MAX_SAFE_INTEGER;
    expect(parseCreatePromptCurationRequest(input).content.items[0].expectedFragmentStateVersion).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseRevisePromptCurationRequest({ ...revision(), action: "archive", expectedCurationRevisionNumber: Number.MAX_SAFE_INTEGER }).expectedCurationRevisionNumber).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("role-specific order, intentional duplication and image references", () => {
  test("positions are per role and authoritative, without sorting arrays or deduplicating a fragment", () => {
    const input = create();
    input.content.items = [item("p-two", 1), item("negative", 0, "negative_prompt"), item("p-one", 0), item("settings", 0, "parameters")];
    input.content.examples = [example("later", 1, "p-one"), example("first", 0, "negative")];
    const parsed = parseCreatePromptCurationRequest(input);
    expect(parsed.content).toEqual(input.content); expect(parsed.content.items.map((row) => row.fragmentId)).toEqual(Array(4).fill("fragment-one"));
  });
  test.each(["continuation", "collection", "alternatives"])("accepts independently confirmed relation %s with item-scoped examples", (relationKind) => {
    const input = create(); input.content.relationKind = relationKind; input.content.relationshipConfirmation = "user_confirmed";
    input.content.orderConfirmation = "unconfirmed"; input.content.examples[0].itemKey = "item-one"; input.content.examples[0].evidenceMethod = "user_confirmed";
    expect(parseCreatePromptCurationRequest(input).content).toEqual(input.content);
  });
  test.each([
    { relationKind: "inferred" }, { relationshipConfirmation: "ai_confirmed" }, { orderConfirmation: true },
  ])("rejects unsupported relationship claims %j", (fields) => {
    rejects(() => parseCreatePromptCurationRequest({ ...create(), content: { ...content(), ...fields } }));
  });
  test.each(["insight", "source", "PROMPT", null])("rejects non-copy role %j", (role) => {
    const input = create(); withField(input.content.items[0], "copyRole", role); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test.each(["ai_confirmed", "exact", true, null])("rejects unsupported example evidence method %j", (method) => {
    const input = create(); withField(input.content.examples[0], "evidenceMethod", method); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test.each([-1, 0.5, 64, Infinity, "0", null])("rejects invalid item/example position %j", (position) => {
    const input = create(); withField(input.content.items[0], "position", position); rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); withField(other.content.examples[0], "position", position); rejects(() => parseCreatePromptCurationRequest(other));
  });
  test.each([[1], [0, 0], [0, 2]])("rejects non-contiguous or duplicate positions %j", (...positions) => {
    const input = create(); input.content.items = positions.map((position, index) => item(`i-${index}`, position));
    rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); other.content.examples = positions.map((position, index) => example(`e-${index}`, position));
    rejects(() => parseCreatePromptCurationRequest(other));
  });
  test("requires item keys globally unique even across roles and example keys independently unique", () => {
    const input = create(); input.content.items.push(item("item-one", 0, "negative_prompt")); rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); other.content.examples.push(example("example-one", 1)); rejects(() => parseCreatePromptCurationRequest(other));
  });
  test("requires a selected item reference and disallows curation-wide alternative examples", () => {
    const input = create(); input.content.examples[0].itemKey = "missing"; rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); other.content.relationKind = "alternatives"; rejects(() => parseCreatePromptCurationRequest(other));
    other.content.examples = []; expect(parseCreatePromptCurationRequest(other).content.examples).toEqual([]);
  });
  test("allows one image attached to several items and several images attached to one item", () => {
    const input = create(); input.content.items.push(item("two", 1));
    input.content.examples = [example("one", 0, "item-one"), example("two", 1, "two"), { ...example("three", 2, "item-one"), attachmentId: "another-image", memberId: "another-member" }];
    expect(parseCreatePromptCurationRequest(input).content.examples).toHaveLength(3);
  });
  test("accepts exact 64/64 limits and rejects either 65 or zero items", () => {
    const input = create(); input.content.items = Array.from({ length: 64 }, (_, index) => item(`i-${index}`, index));
    input.content.examples = Array.from({ length: 64 }, (_, index) => example(`e-${index}`, index));
    expect(parseCreatePromptCurationRequest(input).content.items).toHaveLength(64);
    expect(parseCreatePromptCurationRequest(input).content.examples).toHaveLength(64);
    input.content.items.push(item("overflow", 64)); rejects(() => parseCreatePromptCurationRequest(input)); input.content.items.pop();
    input.content.examples.push(example("overflow", 64)); rejects(() => parseCreatePromptCurationRequest(input)); input.content.examples.pop();
    input.content.items = []; rejects(() => parseCreatePromptCurationRequest(input));
  });
});

describe("own plain data only, with no client source or authority fields", () => {
  test.each(["userId", "ownerId", "restrictedUnlocked", "privacyLevel", "rawText", "hash", "sourceAssertion"])("rejects client root field %s", (key) => {
    rejects(() => parseCreatePromptCurationRequest(withField(create(), key, "untrusted")));
  });
  test.each(["rawText", "sources", "separator", "archived", "basedOnRevisionId"])("rejects unsupported content field %s", (key) => {
    const input = create(); withField(input.content, key, "untrusted"); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test.each(["rawText", "rawTextHash", "sourceClass", "selectionOrigin", "fragment", "stateVersion"])("rejects source assertion on item %s", (key) => {
    const input = create(); withField(input.content.items[0], key, "untrusted"); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test.each(["sha256", "mimeType", "sizeBytes", "committed", "sourceFingerprint"])("rejects image assertion %s", (key) => {
    const input = create(); withField(input.content.examples[0], key, "untrusted"); rejects(() => parseCreatePromptCurationRequest(input));
  });
  test("rejects unknown and accessor fields without invoking any getter", () => {
    const getter = vi.fn(() => { throw new Error("must never run"); });
    for (const select of [(value: ReturnType<typeof create>) => [value, "content"] as const, (value: ReturnType<typeof create>) => [value.content, "title"] as const,
      (value: ReturnType<typeof create>) => [value.content.items[0], "fragmentId"] as const, (value: ReturnType<typeof create>) => [value.content.examples[0], "attachmentId"] as const]) {
      const input = create(), [target, key] = select(input); Object.defineProperty(target, key, { get: getter });
      rejects(() => parseCreatePromptCurationRequest(input));
    }
    const indexed = create(); Object.defineProperty(indexed.content.items, "0", { get: getter }); rejects(() => parseCreatePromptCurationRequest(indexed));
    const revised = { ...revision(), action: "archive" }; Object.defineProperty(revised, "action", { get: getter }); rejects(() => parseRevisePromptCurationRequest(revised));
    expect(getter).not.toHaveBeenCalled();
  });
  test("rejects prototype-backed fields, class objects, and non-plain arrays", () => {
    rejects(() => parseCreatePromptCurationRequest(Object.create(create())));
    for (const replace of [new Date(), new Map(), new (class Content {})(), Object.create(content())]) {
      rejects(() => parseCreatePromptCurationRequest({ ...create(), content: replace }));
    }
    const input = create(); Object.setPrototypeOf(input.content.items, { inherited: true }); rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); Object.setPrototypeOf(other.content.items[0], { inherited: true }); rejects(() => parseCreatePromptCurationRequest(other));
  });
  test("rejects cycles in each structural position without recursion or JSON serialization", () => {
    const root = create(); withField(root, "content", root); rejects(() => parseCreatePromptCurationRequest(root));
    const list = create(); withField(list.content.items, "0", list.content.items); rejects(() => parseCreatePromptCurationRequest(list));
    const leaf = create(); withField(leaf.content.items[0], "itemKey", leaf.content.items[0]); rejects(() => parseCreatePromptCurationRequest(leaf));
  });
  test("rejects sparse, oversized, exotic and accessor arrays", () => {
    for (const values of [new Array(1), [item(), , item("third", 2)], new Array(65), { 0: item(), length: 1 }, new Set([item()])]) {
      rejects(() => parseCreatePromptCurationRequest({ ...create(), content: { ...content(), items: values } }));
    }
    const input = create(); Object.defineProperty(input.content.items, "extra", { value: "hidden", enumerable: false }); rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); withField(other.content.examples, Symbol("extra"), 1); rejects(() => parseCreatePromptCurationRequest(other));
  });
  test("requires all own fields, including explicit nullable item references", () => {
    for (const key of Object.keys(create())) { const input = create(); Reflect.deleteProperty(input, key); rejects(() => parseCreatePromptCurationRequest(input)); }
    const input = create(); Reflect.deleteProperty(input.content.examples[0], "itemKey"); rejects(() => parseCreatePromptCurationRequest(input));
    const other = create(); withField(other.content.items[0], "fragmentId", undefined); rejects(() => parseCreatePromptCurationRequest(other));
  });
  test("rejects symbol/non-enumerable unknown own keys instead of dropping them", () => {
    const input = create(); Object.defineProperty(input.content, "rawText", { value: "hidden", enumerable: false }); rejects(() => parseCreatePromptCurationRequest(input));
    rejects(() => parseCreatePromptCurationRequest(withField(create(), Symbol("hidden"), true)));
    rejects(() => parseCreatePromptCurationRequest(withField(create(), "__proto__", { authority: true })));
  });
  test("normalizes structural inspection failures to the public domain error", () => {
    const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
    rejects(() => parseCreatePromptCurationRequest(proxy)); rejects(() => parseRevisePromptCurationRequest(proxy));
    try { parseCreatePromptCurationRequest(null); } catch (error) { expect(error).toBeInstanceOf(PromptCurationError); }
  });
});
