import { describe, expect, test } from "vitest";

import { hasManualLinkSource, makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { canUndoSharedLinkConversion, convertSharedLink, legacySharedUrls, sharedTextCandidates, undoSharedLinkConversion } from "@/lib/v2/offline/manual-share-conversion";
import type { LocalSourceItem } from "@/lib/v2/offline/local-capture";

const text = "  shared text\r\nkeep  spaces and 🖼️\r\n  ";
const sources: readonly LocalSourceItem[] = [
  { sourceId: "share:title", order: 0, kind: "title", value: "A title is not the author" },
  { sourceId: "share:text", order: 1, kind: "text", value: text },
  { sourceId: "share:url", order: 2, kind: "url", value: " https://www.threads.com/@sample/post/example?xmt=original " },
  { sourceId: "share:attachment", order: 3, kind: "attachment", value: "private-image" },
];

describe("explicit legacy shared link conversion", () => {
  test("detects legacy URL rows without parsing text or title as links", () => {
    expect(legacySharedUrls(sources)).toHaveLength(1);
    expect(sharedTextCandidates(sources)).toEqual([sources[1]]);
    expect(legacySharedUrls([{ sourceId: "body-url", order: 0, kind: "text", value: "https://example.com/not-a-url-source" }])).toEqual([]);
  });

  test("keep-memo conversion is additive, preserves exact originals and ordering, and makes no author claim", () => {
    const converted = convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "keep_memo", nextOrder: 8 });
    expect(converted.slice(0, sources.length)).toEqual(sources);
    expect(converted.slice(0, sources.length).every((item, index) => item === sources[index])).toBe(true);
    expect(converted.at(-1)).toMatchObject({ order: 8, value: "", metadata: { manualLinkV1: { publisher: null, completeness: "unknown", role: "source", purpose: "reference" } } });
    expect(sources.some((item) => hasManualLinkSource(item.metadata))).toBe(false);
  });

  test("copies only the explicitly selected text, without CRLF or whitespace rewriting", () => {
    const converted = convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "copy_source_text", textSourceId: "share:text" });
    expect(converted.at(-1)?.value).toBe(text);
    expect(converted.at(-1)?.order).toBe(4);
    expect(converted[1]?.value).toBe(text);
    expect(() => convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "copy_source_text", textSourceId: "share:title" })).toThrow();
    expect(() => convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "copy_source_text" })).toThrow();
  });

  test("repeated conversion is idempotent even if user edited the derived material", () => {
    const converted = convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "keep_memo" });
    const edited = converted.map((item, index) => index === converted.length - 1 ? { ...item, value: "later user original" } : item);
    expect(convertSharedLink({ items: edited, urlSourceId: "share:url", choice: "copy_source_text", textSourceId: "share:text" })).toBe(edited);
    expect(legacySharedUrls(edited)[0]?.convertedSourceId).toBe(converted.at(-1)?.sourceId);
  });

  test("undo removes only an unchanged derivative, retains unrelated edits, and works after JSON reload", () => {
    const converted = JSON.parse(JSON.stringify(convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "copy_source_text", textSourceId: "share:text" }))) as LocalSourceItem[];
    const id = converted.at(-1)!.sourceId;
    const unrelated = { sourceId: "later-source", order: 10, kind: "text" as const, value: "new unrelated text" };
    expect(canUndoSharedLinkConversion(converted, id)).toBe(true);
    expect(undoSharedLinkConversion([...converted, unrelated], id)).toEqual([...sources, unrelated]);
  });

  test.each(["text", "metadata"])("undo refuses changed %s instead of losing it", (kind) => {
    const converted = convertSharedLink({ items: sources, urlSourceId: "share:url", choice: "keep_memo" });
    const id = converted.at(-1)!.sourceId;
    const edited = converted.map((item) => item.sourceId !== id ? item : kind === "text" ? { ...item, value: "do not lose" } : { ...item, metadata: { ...item.metadata, ...makeManualLinkMetadata({ url: "https://example.com/new" }) } });
    expect(canUndoSharedLinkConversion(edited, id)).toBe(false);
    expect(() => undoSharedLinkConversion(edited, id)).toThrow(/수정한 자료/);
  });

  test.each(["http://example.com", "https://user:password@example.com", "javascript:alert(1)", "not a URL"])("rejects unsupported shared URL %s without mutation", (value) => {
    const input = [{ sourceId: "bad", order: 0, kind: "url" as const, value }];
    expect(legacySharedUrls(input)[0]?.error).toBeTruthy();
    expect(() => convertSharedLink({ items: input, urlSourceId: "bad", choice: "keep_memo" })).toThrow();
    expect(input).toEqual([{ sourceId: "bad", order: 0, kind: "url", value }]);
  });

  test("does not canonical-dedupe separate shared URL source rows or silently exceed the manual limit", () => {
    const twoUrls = [...sources, { ...sources[2]!, sourceId: "second-url", order: 4 }];
    const first = convertSharedLink({ items: twoUrls, urlSourceId: "share:url", choice: "keep_memo" });
    const second = convertSharedLink({ items: first, urlSourceId: "second-url", choice: "keep_memo" });
    expect(second.filter((item) => hasManualLinkSource(item.metadata))).toHaveLength(2);
    const full = [...sources, ...Array.from({ length: 20 }, (_, index): LocalSourceItem => ({ sourceId: `manual-${index}`, order: index + 10, kind: "url", value: "", metadata: makeManualLinkMetadata({ url: `https://example.com/${index}` }) }))];
    expect(() => convertSharedLink({ items: full, urlSourceId: "share:url", choice: "keep_memo" })).toThrow(/20/);
  });
});
