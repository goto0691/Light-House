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
vi.mock("@/components/v2/saved-view-actions", () => ({ SavedViewActions: () => null }));
import searchPage from "@/app/v2/search/page";
import savedPage from "@/app/v2/library/views/[viewId]/page";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";
let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubGlobal("React", React); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ sessionId: "search-ssr", userId: "link-owner", expiresAt: Date.now() + 120_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
async function setup(page: "search" | "saved") {
  const seed = await seedLinkRecord(db, { privacyLevel: "restricted" });
  const view = (await new D1SavedViewRepository(db, "link-owner").create({ name: "Saved exact locations", description: null, iconKey: "type.collection",
    queryPlan: defaultV2QueryPlan({ fullText: "prompt" }), display: { layout: "list", density: "comfortable", groupBy: null, visibleFields: [] } }))!;
  return { seed, render: () => page === "search" ? searchPage({ searchParams: Promise.resolve({ q: "prompt" }) })
    : savedPage({ params: Promise.resolve({ viewId: view.id }), searchParams: Promise.resolve({}) }) };
}
for (const page of ["search", "saved"] as const) {
  test(`${page} actual SSR excludes restricted records without a grant`, async () => {
    const { seed, render } = await setup(page);
    const payload = JSON.stringify(await render(), (key, value) => key === "type" || key === "_owner" ? undefined : value);
    expect(payload).not.toContain(seed.capture.objectId); expect(payload).not.toContain("Synthetic link");
  });
  test(`${page} actual SSR passes exact locations only while the grant remains live`, async () => {
    const { seed, render } = await setup(page);
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 120_000).toISOString() });
    const payload = JSON.stringify(await render(), (key, value) => key === "type" || key === "_owner" ? undefined : value);
    expect(payload).toContain(seed.capture.objectId); expect(payload).toContain("record-location.v1");
    expect(payload).not.toContain(seed.rawText);
  });
  test(`${page} actual SSR refuses content if the grant expires after the final search SQL`, async () => {
    const { render } = await setup(page), expires = Date.now() + 120_000;
    harness.grant.mockResolvedValue({ expiresAt: new Date(expires).toISOString() });
    let fired = false;
    const binding: D1DatabaseBinding = { batch: db.batch.bind(db), prepare(sql) {
      let statement = db.prepare(sql);
      const wrapped: D1PreparedStatementBinding = { bind(...values) { statement = statement.bind(...values); return wrapped; },
        all: () => statement.all(), run: () => statement.run(), async first<T>() {
          const row = await statement.first<T>();
          if (sql.startsWith("with recursive search_tokens as")) { fired = true; vi.spyOn(Date, "now").mockReturnValue(expires + 1); }
          return row;
        } };
      return wrapped;
    } };
    harness.bindings.mockReturnValue({ db: binding });
    await expect(render()).rejects.toThrow("SSR_NOT_FOUND"); expect(fired).toBe(true);
  });
}
