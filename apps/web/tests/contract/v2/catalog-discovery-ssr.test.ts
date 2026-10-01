import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", async (original) => ({ ...await original<typeof import("@/lib/v2/auth/restricted-grant")>(), getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("SSR_NOT_FOUND"); } }));
vi.mock("@/components/v2/search-results", () => ({ SearchResults: () => null }));
vi.mock("@/components/v2/search-pagination", () => ({ SearchPagination: () => null }));
vi.mock("@/components/v2/save-search-view", () => ({ SaveSearchView: () => null }));
vi.mock("@/components/v2/search-type-selector", () => ({ SearchTypeSelector: () => null }));
vi.mock("@/components/v2/mobile-navigation", () => ({ V2MobileNavigation: () => null }));
import explorePage from "@/app/v2/explore/page";
import searchPage from "@/app/v2/search/page";
import { FacetExplorePanels } from "@/components/v2/facet-explore-panels";
import { SearchTypeSelector } from "@/components/v2/search-type-selector";
import { SearchResults } from "@/components/v2/search-results";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";
import type { FacetPage } from "@/lib/v2/retrieval/facet-page";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubGlobal("React", React); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ sessionId: "catalog-ssr", userId: "link-owner", expiresAt: Date.now() + 120_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function props(node: unknown, type: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) return node.map((child) => props(child, type)).find(Boolean) ?? null;
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  return node.type === type ? node.props : props(node.props.children, type);
}
async function seedTypes() {
  const seed = await seedLinkRecord(db, { snapshot: false }), now = "2026-09-22T11:00:00.000Z";
  for (let index = 0; index < 61; index++) {
    const key = `type_${String(index).padStart(3, "0")}`;
    db.sql.prepare(`insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
      values (?1,'link-owner',?1,?2,'document','active','user_created','fixture',?3,?3)`).run(key, `분류 ${index}`, now);
    db.sql.prepare(`insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,created_at,updated_at)
      values (?1,'link-owner',?2,?1,'secondary','user','accepted',?3,?3)`).run(key, seed.capture.objectId, now);
  }
  return seed;
}

test("actual explore SSR pages each requested kind independently and retains every URL condition", async () => {
  await seedTypes();
  const tree = await explorePage({ searchParams: Promise.resolve({ type_q: "type_05", type_page: "9007199254740991", entity_page: "3", month_q: "2026" }) });
  const panel = props(tree, FacetExplorePanels)!;
  expect(panel.pages).toEqual([
    expect.objectContaining({ kind: "type", query: "type_05", totalCount: 10, page: 1 }),
    expect.objectContaining({ kind: "entity", totalCount: 0, page: 1 }),
    expect.objectContaining({ kind: "month", query: "2026", totalCount: 1, page: 1 }),
  ]);
  expect(new URLSearchParams(panel.query as string).get("entity_page")).toBe("3");
  expect(props(tree, V2MobileNavigation)).toEqual({ active: "explore" });
});
test.each([
  { unexpected: "yes" }, { type_page: "0" }, { month_page: "01" }, { type_q: ["one", "two"] }, { entity_q: "x\0y" }, { month_q: "x".repeat(101) },
])("actual explore SSR rejects invalid scope before any catalog SQL: %j", async (searchParams) => {
  await expect(explorePage({ searchParams: Promise.resolve(searchParams) })).rejects.toThrow("SSR_NOT_FOUND");
  expect(harness.bindings).not.toHaveBeenCalled();
});
test("actual search SSR recovers selected type outside the first twenty without changing the record query", async () => {
  const seed = await seedTypes();
  const tree = await searchPage({ searchParams: Promise.resolve({ type: "type_060", q: "Synthetic", sort: "captured_at", direction: "asc" }) });
  const selector = props(tree, SearchTypeSelector)!;
  expect(selector.selectedKey).toBe("type_060");
  const catalog = selector.initialPage as FacetPage;
  expect(catalog.items).toHaveLength(20); expect(catalog.items.map((item) => item.key)).not.toContain("type_060");
  expect(catalog.selected).toMatchObject({ key: "type_060", label: "분류 60", count: 1 });
  const results = props(tree, SearchResults)!;
  expect(results).toMatchObject({ queried: true, queryPlan: { typeKeys: ["type_060"], fullText: "Synthetic", sort: { field: "captured_at", direction: "asc" } } });
  expect(results.results).toEqual([expect.objectContaining({ recordId: seed.capture.objectId })]);
});
test("actual search SSR retains an unknown selected key without borrowing an accessible type's name", async () => {
  await seedTypes();
  const tree = await searchPage({ searchParams: Promise.resolve({ type: "future.unknown" }) });
  expect(props(tree, SearchTypeSelector)).toMatchObject({ selectedKey: "future.unknown", initialPage: { selected: null, totalCount: 61 } });
  expect(props(tree, SearchResults)).toMatchObject({ queried: true, results: [], queryPlan: { typeKeys: ["future.unknown"] } });
});
test("actual search SSR cannot resolve another owner's selected type metadata", async () => {
  await seedTypes(); harness.session.mockResolvedValue({ sessionId: "other-session", userId: "other-owner" });
  const tree = await searchPage({ searchParams: Promise.resolve({ type: "type_060" }) });
  expect(props(tree, SearchTypeSelector)).toMatchObject({ selectedKey: "type_060", initialPage: { selected: null, items: [], totalCount: 0 } });
  expect(props(tree, SearchResults)).toMatchObject({ results: [] });
});
test("actual search SSR still fails closed when a restricted grant expires before delivery", async () => {
  harness.grant.mockResolvedValue({ expiresAt: "2000-01-01T00:00:00.000Z" });
  await expect(searchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("SSR_NOT_FOUND");
});
