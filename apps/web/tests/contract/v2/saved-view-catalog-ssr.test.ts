import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: harness.session }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("SSR_NOT_FOUND"); } }));
vi.mock("@/components/v2/saved-view-catalog", () => ({ SavedViewCatalog: () => null }));
vi.mock("@/components/v2/mobile-navigation", () => ({ V2MobileNavigation: () => null }));
import savedPage from "@/app/v2/library/views/page";
import { SavedViewCatalog } from "@/components/v2/saved-view-catalog";
import { LinkSqlite } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubGlobal("React", React); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ userId: "link-owner", sessionId: "catalog-ssr", expiresAt: Date.now() + 60_000 }); harness.bindings.mockReturnValue({ db });
  const insert = db.sql.prepare("insert into v2_saved_views(id,user_id,view_key,name,description,icon_key,query_plan_json,display_json,source,status,pinned,pin_order,created_at,updated_at) values(?,'link-owner',?,?,null,'type.collection','{','{','user_created','active',0,null,'2026-09-22','2026-09-22')");
  for (let i = 0; i < 45; i++) { const n = String(i).padStart(3, "0"); insert.run(`view-${n}`, `key_${n}`, `목록 ${n}`); }
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function props(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) return node.map(props).find(Boolean) ?? null;
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  return node.type === SavedViewCatalog ? node.props : props(node.props.children);
}
test("actual catalog SSR reads only twenty summaries and count without parsing stored query/display JSON", async () => {
  const prepare = vi.spyOn(db, "prepare");
  const tree = await savedPage({ searchParams: Promise.resolve({ page: "2" }) });
  expect(props(tree)).toMatchObject({ initialPage: { contract: "saved-view-catalog.v1", page: 2, totalCount: 45, totalPages: 3, views: expect.any(Array) } });
  const page = props(tree)!.initialPage as { views: { id: string }[] };
  expect(page.views).toHaveLength(20); expect(page.views[0].id).toBe("view-020");
  expect(prepare).toHaveBeenCalledTimes(1); expect(prepare.mock.calls[0][0]).not.toMatch(/query_plan_json|display_json/);
  expect(JSON.stringify(props(tree))).not.toContain("queryPlan");
});
test("SSR preserves normalized name search and final page clamp on reload", async () => {
  const tree = await savedPage({ searchParams: Promise.resolve({ q: "  목록 04  ", page: "999" }) });
  expect(props(tree)).toMatchObject({ initialPage: { query: "목록 04", page: 1, totalCount: 5, totalPages: 1 } });
});
test.each([{ q: ["first", "second"] }, { unknown: "query" }, { page: "01" }, { pinned: "true" }, { q: "\n" }])("invalid SSR parameters %j do not query private data", async (params) => {
  const prepare = vi.spyOn(db, "prepare");
  await expect(savedPage({ searchParams: Promise.resolve(params) })).rejects.toThrow("SSR_NOT_FOUND"); expect(prepare).not.toHaveBeenCalled();
});
test("SSR uses the authenticated owner and never resolves data on unavailable session or route", async () => {
  harness.session.mockResolvedValue({ userId: "other-owner" });
  expect(props(await savedPage({ searchParams: Promise.resolve({}) }))).toMatchObject({ initialPage: { totalCount: 0, views: [] } });
  const prepare = vi.spyOn(db, "prepare"); prepare.mockClear(); harness.session.mockRejectedValue(new Error("AUTH_REQUIRED"));
  await expect(savedPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("AUTH_REQUIRED"); expect(prepare).not.toHaveBeenCalled();
  vi.stubEnv("FLAG_V2_ROUTES", "0"); await expect(savedPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("SSR_NOT_FOUND"); expect(prepare).not.toHaveBeenCalled();
});
