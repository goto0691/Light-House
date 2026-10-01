import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";

import {
  assertRecordLocationText,
  firstRecordTextMatch,
  parseRecordLocation,
  parseRecordLocationParam,
  RECORD_LOCATION_CONTRACT,
  RECORD_LOCATION_MAX_LENGTH,
  RECORD_LOCATION_QUERY_KEY,
  recordLocationHref,
  RecordLocationError,
  recordLocationTextHash,
  serializeRecordLocation,
  type V2RecordLocationV1,
} from "@/lib/v2/retrieval/record-location-v1";

type Data = Record<string, unknown>;
const text = "  👤\r\nsame  same\r\n끝";
const textHash = createHash("sha256").update(text, "utf8").digest("hex");
const manifestHash = "f".repeat(64);
const base = () => ({ contract: RECORD_LOCATION_CONTRACT, range: { start: 6, end: 10 }, textHash });
const document = (kind = "document_body"): Data => ({ ...base(), kind, revisionId: "revision-1", documentVersion: 1 });
const snapshot = () => ({ snapshotId: "snapshot-1", manifestHash, sourceItemId: "source-1", memberId: "member-1" });
const source = (linked = true): Data => ({ ...base(), kind: "source", ...snapshot(),
  ...(!linked ? { snapshotId: null, manifestHash: null, memberId: null } : {}) });
const manual = (): Data => ({ ...base(), kind: "manual_fragment", ...snapshot(), fragmentId: "fragment-1" });
const ai = (): Data => ({ ...manual(), kind: "ai_fragment", runId: "run-older-than-20" });
const curation = (role = "prompt"): Data => ({ ...base(), kind: "curation", snapshotId: "snapshot-1", manifestHash,
  groupKey: "group-1", revisionId: "curation-revision-1", role });
const variants = [
  ["document title", () => document("document_title")], ["document body", document],
  ["unversioned source", () => source(false)], ["snapshot source", source],
  ["manual fragment", manual], ["AI fragment", ai],
  ...["title", "prompt", "negative_prompt", "parameters"].map((role) => [`curation ${role}`, () => curation(role)] as const),
] as const;
function invalid(run: () => unknown) {
  expect(run).toThrowError(expect.objectContaining({ name: "RecordLocationError", code: "record_location_invalid" }));
}
function typed(value: Data) { return value as V2RecordLocationV1; }

describe("record-location.v1 synchronous own-data parser", () => {
  test.each(variants)("captures and freezes the complete %s variant", (_label, make) => {
    const input = make(), parsed = parseRecordLocation(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.range).not.toBe(input.range);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.range)).toBe(true);
    Object.assign(input.range as Data, { start: 12, end: 16 });
    Object.assign(input, { textHash: "0".repeat(64), kind: "ai_fragment", runId: "later-run" });
    expect(parsed.range).toEqual({ start: 6, end: 10 });
    expect(parsed.textHash).toBe(textHash);
    expect(() => assertRecordLocationText(parsed, text)).not.toThrow();
  });

  test("accepts null-prototype own data without invoking any serialization hook", () => {
    const input = Object.assign(Object.create(null) as Data, manual());
    input.range = Object.assign(Object.create(null) as Data, { start: 6, end: 10 });
    expect(parseRecordLocation(input)).toEqual(manual());
  });

  test("captures nonenumerable primitive own fields rather than overlooking them", () => {
    const input = document();
    Object.defineProperty(input, "revisionId", { value: "nonenumerable-revision", enumerable: false });
    expect(parseRecordLocation(input)).toMatchObject({ revisionId: "nonenumerable-revision" });
  });

  test.each([undefined, null, false, true, 1, "location", [], new Date(), new Map(), () => document()])("rejects nonrecord input %#", (value) => {
    invalid(() => parseRecordLocation(value));
  });
  test("rejects inherited fields and class instances", () => {
    invalid(() => parseRecordLocation(Object.create(document())));
    class Location { constructor() { Object.assign(this, document()); } }
    invalid(() => parseRecordLocation(new Location()));
  });

  test.each(["contract", "kind", "range", "textHash", "revisionId", "documentVersion", "extra"])("does not invoke a root %s accessor", (field) => {
    const input = document(), getter = vi.fn(() => input[field]);
    Object.defineProperty(input, field, { get: getter, enumerable: true });
    invalid(() => parseRecordLocation(input));
    expect(getter).not.toHaveBeenCalled();
  });
  test.each(["start", "end", "extra"])("does not invoke a range %s accessor", (field) => {
    const selected: Data = { start: 6, end: 10 }, getter = vi.fn(() => 7);
    Object.defineProperty(selected, field, { get: getter, enumerable: true });
    invalid(() => parseRecordLocation({ ...document(), range: selected }));
    expect(getter).not.toHaveBeenCalled();
  });
  test.each(["root", "range"] as const)("rejects symbolic and nonenumerable extra keys in %s", (where) => {
    for (const key of [Symbol("grant"), "hiddenGrant"]) {
      const input = document(), selected = where === "root" ? input : input.range as Data;
      Object.defineProperty(selected, key, { value: "not-authority", enumerable: false });
      invalid(() => parseRecordLocation(input));
    }
  });
  test("does not invoke toJSON, valueOf or toString to coerce identity", () => {
    const hook = vi.fn(() => "revision-1");
    invalid(() => parseRecordLocation({ ...document(), revisionId: { valueOf: hook, toString: hook, toJSON: hook } }));
    invalid(() => serializeRecordLocation(typed({ ...document(), toJSON: hook })));
    expect(hook).not.toHaveBeenCalled();
  });

  test.each(variants)("rejects extra fields and every missing required field of %s", (_label, make) => {
    const input = make();
    invalid(() => parseRecordLocation({ ...input, grant: "not-a-grant" }));
    for (const key of Object.keys(input)) {
      const missing = { ...input }; delete missing[key];
      invalid(() => parseRecordLocation(missing));
    }
  });
  test.each(["record-location.v0", "record-location-result.v1", null, 1])("rejects a substituted contract %#", (contract) => {
    invalid(() => parseRecordLocation({ ...document(), contract }));
  });
  test.each(["document", "fragment", "manual", "ai", "video", "", null, 1])("rejects unsupported location kind %#", (kind) => {
    invalid(() => parseRecordLocation({ ...document(), kind }));
  });

  test.each([1, 2, 3, 4, 5, 6])("rejects partially absent snapshot tuple mask %i", (mask) => {
    const input = source();
    ["snapshotId", "manifestHash", "memberId"].forEach((field, index) => { if (mask & (1 << index)) input[field] = null; });
    invalid(() => parseRecordLocation(input));
  });
  test.each(["snapshotId", "manifestHash", "sourceItemId", "memberId", "fragmentId", "runId"])("requires AI %s without falling back to the current snapshot/run", (field) => {
    invalid(() => parseRecordLocation({ ...ai(), [field]: null }));
  });
  test("never reinterprets manual, AI and source locations when run/fragment fields differ", () => {
    invalid(() => parseRecordLocation({ ...manual(), runId: "run-1" }));
    const missingRun = ai(); delete missingRun.runId;
    invalid(() => parseRecordLocation(missingRun));
    invalid(() => parseRecordLocation({ ...source(), fragmentId: "fragment-1" }));
    invalid(() => parseRecordLocation({ ...curation(), runId: "run-1" }));
  });
  test.each(["whole", "all", "negative", null, 1])("rejects unsupported curation role %#", (role) => {
    invalid(() => parseRecordLocation({ ...curation(), role }));
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", null])("rejects invalid document version %#", (documentVersion) => {
    invalid(() => parseRecordLocation({ ...document(), documentVersion }));
  });
  test.each(["", " ", "\n", "id\0", "id\u007f", 200, null, "x".repeat(201)])("rejects invalid identity %#", (revisionId) => {
    invalid(() => parseRecordLocation({ ...document(), revisionId }));
  });
  test("accepts the 200 UTF-16-unit identity boundary without truncating it", () => {
    const revisionId = "👤".repeat(100);
    expect(parseRecordLocation({ ...document(), revisionId })).toMatchObject({ revisionId });
    invalid(() => parseRecordLocation({ ...document(), revisionId: revisionId + "x" }));
  });
  test.each(["\ud800", "\udc00", "before\ud800after", "before\udc00after"])("rejects ill-formed Unicode ID %# before it can be replaced in UTF-8", (revisionId) => {
    invalid(() => parseRecordLocation({ ...document(), revisionId }));
    invalid(() => parseRecordLocation({ ...curation(), groupKey: revisionId }));
  });

  test.each(["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), `sha256:${textHash}`, null, 7])("requires lowercase SHA-256 syntax %#", (value) => {
    invalid(() => parseRecordLocation({ ...document(), textHash: value }));
    invalid(() => parseRecordLocation({ ...source(), manifestHash: value }));
  });
  test.each([
    undefined, [], {}, { start: 0 }, { end: 1 }, { start: -1, end: 1 }, { start: 1, end: 1 }, { start: 2, end: 1 },
    { start: 0.5, end: 1 }, { start: 0, end: 1.5 }, { start: "0", end: 1 }, { start: 0, end: "1" },
    { start: Number.NaN, end: 1 }, { start: 0, end: Number.POSITIVE_INFINITY }, { start: 0, end: Number.MAX_SAFE_INTEGER + 1 },
    { start: 0, end: 1, normalizedStart: 0 },
  ])("rejects invalid/nonexact range shape %#", (range) => {
    invalid(() => parseRecordLocation({ ...document(), range }));
  });
  test("permits null range but preserves the whole-field hash", () => {
    const parsed = parseRecordLocation({ ...ai(), range: null });
    expect(parsed.range).toBeNull();
    expect(() => assertRecordLocationText(parsed, text)).not.toThrow();
  });
});

describe("record location URL and query boundary", () => {
  test.each(variants)("roundtrips %s through JSON and the real loc URL parameter", (_label, make) => {
    const parsed = parseRecordLocation(make());
    expect(parseRecordLocationParam(serializeRecordLocation(parsed))).toEqual(parsed);
    const recordId = "한글 / ?#%+ & 👤", url = new URL(recordLocationHref(recordId, parsed), "https://lighthouse.test");
    expect(url.pathname).toBe(`/v2/records/${encodeURIComponent(recordId)}`);
    expect([...url.searchParams.keys()]).toEqual([RECORD_LOCATION_QUERY_KEY]);
    expect(parseRecordLocationParam(url.searchParams.get(RECORD_LOCATION_QUERY_KEY))).toEqual(parsed);
    expect(url.hash).toBe("#record-search-location");
  });
  test("retains opaque ID punctuation/Unicode instead of splitting it into URL fields", () => {
    const input = { ...ai(), sourceItemId: "출처/?&=#%+", memberId: "member/👤", fragmentId: "f\"\\[]{}", runId: "과거 run + /" };
    const parsed = parseRecordLocation(input), url = new URL(recordLocationHref("record", parsed), "https://lighthouse.test");
    expect(parseRecordLocationParam(url.searchParams.get("loc"))).toEqual(input);
    expect(url.searchParams.size).toBe(1);
  });
  test("treats absent parameters as absent, not as an implicit current location", () => {
    expect(parseRecordLocationParam(undefined)).toBeNull();
    expect(parseRecordLocationParam(null)).toBeNull();
  });
  test.each(["", "{", "null", "[]", "false", "\"location\"", "%7B%7D"])("rejects malformed or nonrecord JSON %#", (value) => {
    invalid(() => parseRecordLocationParam(value));
  });
  test("rejects duplicate query values, including identical repeated loc values", () => {
    const serialized = serializeRecordLocation(parseRecordLocation(document()));
    for (const second of [serialized, serializeRecordLocation(parseRecordLocation(ai()))]) {
      const query = new URLSearchParams(); query.append("loc", serialized); query.append("loc", second);
      invalid(() => parseRecordLocationParam(query.getAll("loc")));
    }
    invalid(() => parseRecordLocationParam([serialized]));
    invalid(() => parseRecordLocationParam([]));
  });
  test("applies the exact transport length limit without silently slicing JSON", () => {
    const serialized = serializeRecordLocation(parseRecordLocation(document()));
    expect(parseRecordLocationParam(serialized.padEnd(RECORD_LOCATION_MAX_LENGTH))).toEqual(document());
    invalid(() => parseRecordLocationParam(serialized.padEnd(RECORD_LOCATION_MAX_LENGTH + 1)));
  });
  test("serializer and href synchronously recapture mutable arguments without invoking getters", () => {
    const input = ai(), serialized = serializeRecordLocation(typed(input)), href = recordLocationHref("record", typed(input));
    Object.assign(input, { snapshotId: "new-snapshot", runId: "new-run", textHash: "0".repeat(64) });
    Object.assign(input.range as Data, { start: 12, end: 16 });
    expect(parseRecordLocationParam(serialized)).toEqual(ai());
    expect(parseRecordLocationParam(new URL(href, "https://lighthouse.test").searchParams.get("loc"))).toEqual(ai());
    const getter = vi.fn(() => "new-run"); Object.defineProperty(input, "runId", { get: getter });
    invalid(() => serializeRecordLocation(typed(input)));
    invalid(() => recordLocationHref("record", typed(input)));
    expect(getter).not.toHaveBeenCalled();
  });
  test.each(["\ud800", "\udc00"])("href reports a domain error for malformed record ID %# instead of URIError", (recordId) => {
    invalid(() => recordLocationHref(recordId, parseRecordLocation(document())));
  });
});

describe("exact text digest, UTF-16 ranges and first-match selection", () => {
  test("hashes exact UTF-8 bytes synchronously with no CRLF/space/Unicode normalization", () => {
    expect(recordLocationTextHash(text)).toBe(textHash);
    expect(recordLocationTextHash("")).toBe(createHash("sha256").update("").digest("hex"));
    for (const changed of [text.replaceAll("\r\n", "\n"), text.trim(), text.replace("  same", " same"), text + "\n"])
      expect(recordLocationTextHash(changed)).not.toBe(textHash);
    expect(recordLocationTextHash("é")).not.toBe(recordLocationTextHash("e\u0301"));
  });
  test("same text in different ranges remains two distinct exact locations", () => {
    const first = parseRecordLocation(manual()), second = parseRecordLocation({ ...manual(), range: { start: 12, end: 16 } });
    expect(text.slice(first.range!.start, first.range!.end)).toBe("same");
    expect(text.slice(second.range!.start, second.range!.end)).toBe("same");
    expect(first.textHash).toBe(second.textHash);
    expect(() => assertRecordLocationText(first, text)).not.toThrow();
    expect(() => assertRecordLocationText(second, text)).not.toThrow();
    expect(recordLocationHref("record", first)).not.toBe(recordLocationHref("record", second));
  });
  test("same text/hash never drops snapshot/run/fragment identity in serialization", () => {
    const original = parseRecordLocation(ai());
    for (const field of ["snapshotId", "manifestHash", "sourceItemId", "memberId", "fragmentId", "runId"])
      expect(serializeRecordLocation(parseRecordLocation({ ...ai(), [field]: field === "manifestHash" ? "e".repeat(64) : "different-id" })))
        .not.toBe(serializeRecordLocation(original));
  });
  test.each([{ start: 2, end: 4 }, { start: 4, end: 6 }, { start: 4, end: 5 }, { start: 5, end: 6 }, { start: 0, end: text.length }])("accepts exact UTF-16 boundary %#", (range) => {
    expect(() => assertRecordLocationText(parseRecordLocation({ ...source(), range }), text)).not.toThrow();
  });
  test.each([{ start: 3, end: 4 }, { start: 2, end: 3 }, { start: 0, end: text.length + 1 }, { start: text.length, end: text.length + 1 }])("rejects split-surrogate or out-of-text range %#", (range) => {
    invalid(() => assertRecordLocationText(parseRecordLocation({ ...source(), range }), text));
  });
  test("changed text fails closed instead of searching for the same phrase elsewhere", () => {
    const location = parseRecordLocation(manual());
    expect(() => assertRecordLocationText(location, `prefix ${text}`)).toThrowError(expect.objectContaining({ code: "record_location_conflict" }));
    expect(() => assertRecordLocationText(location, text.replaceAll("\r\n", "\n"))).toThrowError(expect.objectContaining({ code: "record_location_conflict" }));
  });
  test("first match indices are measured on original UTF-16 text after length-changing lowercase characters", () => {
    const value = "İ\r\n👤 SAME same";
    expect(firstRecordTextMatch(value, ["same"])).toEqual({ start: 6, end: 10 });
    expect(value.slice(6, 10)).toBe("SAME");
    expect(firstRecordTextMatch(value, ["👤"])).toEqual({ start: 3, end: 5 });
  });
  test("chooses the earliest original match independent of token order", () => {
    expect(firstRecordTextMatch(text, ["끝", "same", "👤"])).toEqual({ start: 2, end: 4 });
    expect(firstRecordTextMatch(text, ["", "same"])).toEqual({ start: 6, end: 10 });
    expect(firstRecordTextMatch(text, ["absent", ""])).toBeNull();
    expect(firstRecordTextMatch(text, [])).toBeNull();
  });
  test.each(["a+b", "[x]", "(a)", "a.b", "*", "?", "^$", "a|b", "{x}", "\\"])("treats regex metacharacter token %s as literal text", (token) => {
    const value = `before ${token} after`;
    expect(firstRecordTextMatch(value, [token])).toEqual({ start: 7, end: 7 + token.length });
  });
  test("uses the matched case-folded substring length and does not invent Unicode normalization", () => {
    expect(firstRecordTextMatch("Kelvin", ["kelvin"])).toEqual({ start: 0, end: 6 });
    expect(firstRecordTextMatch("é", ["e\u0301"])).toBeNull();
  });
  test("exports the typed domain error without granting source access", () => {
    const error = new RecordLocationError("record_location_not_found", "not accessible");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "RecordLocationError", code: "record_location_not_found" });
  });
});
