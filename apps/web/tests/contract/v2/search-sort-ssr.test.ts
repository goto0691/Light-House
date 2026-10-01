import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
vi.mock("@/components/v2/natural-search-panel", () => ({ SearchQueryBox: () => null }));
vi.mock("@/components/v2/mobile-navigation", () => ({ V2MobileNavigation: () => null }));

import searchPage from "@/app/v2/search/page";
import { SearchResults } from "@/components/v2/search-results";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { searchParamsForPlan } from "@/lib/v2/retrieval/plan-presentation";
import { LinkSqlite } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubGlobal("React", React); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ sessionId: "sort-ssr", userId: "link-owner", expiresAt: Date.now() + 120_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function props(node: unknown, type: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) return node.map((child) => props(child, type)).find(Boolean) ?? null;
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  return node.type === type ? node.props : props(node.props.children, type);
}
function selectedOption(html: string, name: string) {
  return html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>(.*?)</select>`))?.[1]
    .match(/<option value="([^"]+)" selected="">([^<]+)<\/option>/)?.slice(1);
}

test.each(["asc", "desc"] as const)("actual search SSR displays written_at %s from readable parameters and the same executed plan", async (direction) => {
  const plan = defaultV2QueryPlan({ fullText: "기록", sort: { field: "written_at", direction } });
  const params = searchParamsForPlan(plan, { natural: true });
  expect(params.has("plan")).toBe(false);
  const tree = await searchPage({ searchParams: Promise.resolve(Object.fromEntries(params)) });
  const html = renderToStaticMarkup(tree);
  expect(selectedOption(html, "sort")).toEqual(["written_at", "작성·경험일"]);
  expect(selectedOption(html, "direction")?.[0]).toBe(direction);
  expect(props(tree, SearchResults)?.queryPlan).toEqual(plan);
});

test.each(["asc", "desc"] as const)("actual search SSR reads written_at %s from the authoritative JSON plan rather than conflicting loose parameters", async (direction) => {
  const plan = defaultV2QueryPlan({ fullText: "기록", dateFilter: { axis: "written_at", from: "2025-01-01", to: null }, sort: { field: "written_at", direction } });
  const params = searchParamsForPlan(plan, { natural: true });
  expect(params.has("plan")).toBe(true);
  params.set("sort", "captured_at"); params.set("direction", direction === "asc" ? "desc" : "asc");
  const tree = await searchPage({ searchParams: Promise.resolve(Object.fromEntries(params)) });
  const html = renderToStaticMarkup(tree);
  expect(selectedOption(html, "sort")).toEqual(["written_at", "작성·경험일"]);
  expect(selectedOption(html, "direction")?.[0]).toBe(direction);
  expect(props(tree, SearchResults)?.queryPlan).toEqual(plan);
});

test.each([
  { params: { q: "기록", sort: "unsupported", direction: "sideways" }, field: "relevance" },
  { params: { plan: "{bad", sort: "written_at", direction: "asc" }, field: "updated_at" },
])("actual search SSR displays the validated fallback rather than unsupported URL sort values: $field", async ({ params, field }) => {
  const tree = await searchPage({ searchParams: Promise.resolve(params) });
  const html = renderToStaticMarkup(tree);
  expect(selectedOption(html, "sort")?.[0]).toBe(field);
  expect(selectedOption(html, "direction")?.[0]).toBe("desc");
  expect(props(tree, SearchResults)?.queryPlan).toMatchObject({ sort: { field, direction: "desc" } });
});
