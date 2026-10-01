import { describe, expect, test } from "vitest";
import { captureSavedViewCatalogRequest, parseSavedViewCatalogRequest, savedViewCatalogParams, validateSavedViewCatalogPage } from "@/lib/v2/retrieval/saved-view-catalog";
const request = { query: "영화 👀", page: 1, pinnedOnly: false };
function body() { return { contract: "saved-view-catalog.v1", query: request.query, pinnedOnly: false, page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
  views: [{ id: "view-id", name: "두 줄\n영화", description: "설명\n본문", iconKey: "type.collection", pinned: false, pinOrder: null }] }; }

describe("saved-view catalog strict independent request and response contract", () => {
  test("normalizes valid query whitespace, supports Unicode and keeps an immutable copy", () => {
    const candidate = { ...request, query: `  ${request.query}  ` }, captured = captureSavedViewCatalogRequest(candidate);
    candidate.query = "changed"; expect(captured).toEqual(request); expect(Object.isFrozen(captured)).toBe(true);
    expect(parseSavedViewCatalogRequest(savedViewCatalogParams(captured))).toEqual(request);
    expect(savedViewCatalogParams({ query: "", page: 1, pinnedOnly: false }).toString()).toBe("");
  });
  test.each(["\ud800", "x\udfff", "\ud800\ud800", "\u0000", "\n", "\u007f"])("rejects original malformed query %j before URLSearchParams replacement", (query) => {
    expect(() => captureSavedViewCatalogRequest({ ...request, query })).toThrow();
  });
  test.each([{ ...request, extra: "no" }, { ...request, page: NaN }, { ...request, page: Infinity }, { ...request, page: 0 }, { ...request, page: 1.5 }, { ...request, page: Number.MAX_SAFE_INTEGER + 1 }, { ...request, pinnedOnly: 1 }, { ...request, query: null }])("rejects malformed typed request %j", (candidate) => {
    expect(() => captureSavedViewCatalogRequest(candidate as typeof request)).toThrow();
  });
  test("copies and freezes the exact metadata DTO without normalizing away stored newlines", () => {
    const source = body(), page = validateSavedViewCatalogPage(source, request);
    source.views[0].name = "changed"; expect(page.views[0].name).toBe("두 줄\n영화");
    for (const value of [page, page.views, page.views[0]]) expect(Object.isFrozen(value)).toBe(true);
  });
  test.each([
    { query: "different" }, { pinnedOnly: true }, { pageSize: 21 }, { totalCount: -1 }, { totalCount: 1.1 }, { totalCount: 21 },
    { totalPages: 0 }, { totalPages: 2 }, { page: 2 }, { views: [] }, { contract: "old" }, { queryPlan: "PRIVATE" },
  ])("rejects mismatched or expanded envelope %j", (change) => {
    expect(() => validateSavedViewCatalogPage({ ...body(), ...change }, request)).toThrow();
  });
  test.each([{ id: "" }, { id: "\ud800" }, { name: null }, { name: "x".repeat(81) }, { description: 42 }, { description: "x".repeat(301) },
    { iconKey: "<svg>" }, { pinned: 1 }, { pinOrder: -1 }, { pinOrder: 1.5 }, { queryPlan: "PRIVATE" }, { display: {} }])("rejects malformed or expanded summary %j", (change) => {
    const value = body(); expect(() => validateSavedViewCatalogPage({ ...value, views: [{ ...value.views[0], ...change }] }, request)).toThrow();
  });
  test("rejects duplicate IDs and unpinned summaries in a pinned-only response", () => {
    const value = body(); expect(() => validateSavedViewCatalogPage({ ...value, totalCount: 2, views: [value.views[0], value.views[0]] }, request)).toThrow();
    expect(() => validateSavedViewCatalogPage({ ...value, pinnedOnly: true }, { ...request, pinnedOnly: true })).toThrow();
  });
  test("accepts only the exact clamped terminal page and empty first page", () => {
    const empty = { ...body(), views: [], totalCount: 0, totalPages: 1 };
    expect(validateSavedViewCatalogPage(empty, { ...request, page: 100 }).page).toBe(1);
    expect(() => validateSavedViewCatalogPage({ ...empty, page: 100 }, { ...request, page: 100 })).toThrow();
    const last = { ...body(), totalCount: 41, totalPages: 3, page: 3 };
    expect(validateSavedViewCatalogPage(last, { ...request, page: 100 }).views).toHaveLength(1);
  });
});
