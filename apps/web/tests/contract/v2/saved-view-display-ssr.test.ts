import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", async (original) => ({ ...await original<typeof import("@/lib/v2/auth/restricted-grant")>(), getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("SSR_NOT_FOUND"); } }));
vi.mock("@/components/v2/search-results", () => ({ SearchResults: () => null }));
vi.mock("@/components/v2/search-pagination", () => ({ SearchPagination: () => null }));
vi.mock("@/components/v2/saved-view-actions", () => ({ SavedViewActions: () => null }));
import savedPage from "@/app/v2/library/views/[viewId]/page";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";
import { SearchResults } from "@/components/v2/search-results";
import { SavedViewActions } from "@/components/v2/saved-view-actions";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubGlobal("React", React); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ sessionId: "saved-display-ssr", userId: "link-owner", expiresAt: Date.now() + 120_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function componentProps(node: unknown, type: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) return node.map((child) => componentProps(child, type)).find(Boolean) ?? null;
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  return node.type === type ? node.props : componentProps(node.props.children, type);
}
for (const layout of ["list", "cards", "timeline", "table"] as const) {
  test(`actual saved-view SSR forwards persisted ${layout} and selected fields without changing query membership`, async () => {
    const seed = await seedLinkRecord(db), display: V2SavedViewDisplay = { layout, density: "compact", groupBy: "written_month", visibleFields: ["@record.written_at", "@record.captured_at", "@record.type", "new.field"] };
    const plan = defaultV2QueryPlan({ fullText: "prompt" }), views = new D1SavedViewRepository(db, "link-owner");
    const view = (await views.create({ name: "나의 표시 설정", description: null, iconKey: "type.collection", queryPlan: plan, display }))!;
    const tree = await savedPage({ params: Promise.resolve({ viewId: view.id }), searchParams: Promise.resolve({ page: "1" }) });
    const props = componentProps(tree, SearchResults)!;
    expect(props).toMatchObject({ display, queryPlan: plan, queried: true });
    expect(props.results).toEqual([expect.objectContaining({ recordId: seed.capture.objectId,
      displayFields: [expect.objectContaining({ fieldKey: "@record.written_at", state: "missing" }), expect.objectContaining({ fieldKey: "@record.captured_at", state: "value" }),
        expect.objectContaining({ fieldKey: "@record.type", state: "missing" }), expect.objectContaining({ fieldKey: "new.field", state: "missing" })] })]);
    expect(componentProps(tree, SavedViewActions)).toMatchObject({ viewId: view.id, display, displayRevision: view.displayRevision });
    expect((await views.get(view.id))!.queryPlan).toEqual(plan);
  });
}
test("saved display SSR passes no additional field values for sensitive records", async () => {
  const seed = await seedLinkRecord(db);
  db.sql.prepare("update v2_documents set privacy_level='sensitive' where object_id=?").run(seed.capture.objectId);
  const display: V2SavedViewDisplay = { layout: "table", density: "comfortable", groupBy: null, visibleFields: ["@record.captured_at", "new.field"] };
  const view = (await new D1SavedViewRepository(db, "link-owner").create({ name: "민감 표시", description: null, iconKey: "type.collection", queryPlan: defaultV2QueryPlan({ fullText: "prompt" }), display }))!;
  const tree = await savedPage({ params: Promise.resolve({ viewId: view.id }), searchParams: Promise.resolve({}) });
  const props = componentProps(tree, SearchResults)!;
  expect(props.results).toEqual([expect.objectContaining({ privacyLevel: "sensitive", snippet: null,
    displayFields: [expect.objectContaining({ state: "private", values: [] }), expect.objectContaining({ state: "private", values: [] })] })]);
});
