import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
import { POST } from "@/app/api/v2/saved-views/route";
import { captureSavedViewCreateDefinition, confirmSavedViewCreateResponse } from "@/lib/v2/retrieval/saved-view-create-response";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { LinkSqlite } from "../../support/link-sqlite";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function candidate() {
  return { name: "  내 기록  ", description: " 설명 ", iconKey: "type.collection",
    queryPlan: defaultV2QueryPlan({ fullText: "archive", typeKeys: ["game"], propertyFilters: [{ fieldKey: "rating", operator: "gte", value: 4.5 }],
      entityFilters: [{ canonicalName: "함께 본 사람" }], dateFilter: { axis: "written_at", from: "2026-01-01", to: null } }),
    display: { layout: "cards", density: "comfortable", groupBy: "type", visibleFields: ["rating", "@record.written_at"] } as V2SavedViewDisplay };
}
function valid() {
  const selected = captureSavedViewCreateDefinition(candidate());
  const view: Record<string, unknown> = { ...selected, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    displayRevision: createHash("sha256").update(JSON.stringify(selected.display), "utf8").digest("hex"),
    viewKey: "view_01arz3ndektsv4rrffq69g5fav", source: "user_created", pinned: false, pinOrder: null, createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z" };
  return { selected, view };
}

describe("immutable creation request and content-confirmed response", () => {
  test("captures normalized independent frozen nested data before async work", () => {
    const input = candidate(), selected = captureSavedViewCreateDefinition(input), raw = JSON.stringify(selected);
    input.name = "different"; (input.queryPlan.typeKeys as string[]).push("other"); (input.display.visibleFields as string[]).reverse();
    expect(JSON.stringify(selected)).toBe(raw); expect(selected.name).toBe("내 기록"); expect(selected.description).toBe("설명");
    for (const value of [selected, selected.queryPlan, selected.queryPlan.typeKeys, selected.queryPlan.propertyFilters, selected.queryPlan.propertyFilters[0], selected.queryPlan.entityFilters[0], selected.queryPlan.dateFilter, selected.queryPlan.sort, selected.display, selected.display.visibleFields]) expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.set(selected.display, "layout", "table")).toBe(false);
  });
  test("accepts validated content and canonical revision with any newly issued valid ULID, not a pre-known identity", () => {
    const { selected, view } = valid();
    expect(confirmSavedViewCreateResponse({ view }, selected)).toBe(view.id);
    view.id = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
    expect(confirmSavedViewCreateResponse({ view }, selected)).toBe(view.id);
  });
  test("JSON key order and omitted undefined entity attributes do not change semantic confirmation", () => {
    const { selected, view } = valid();
    const plan = JSON.parse(JSON.stringify(selected.queryPlan)) as Record<string, unknown>;
    view.queryPlan = Object.fromEntries(Object.entries(plan).reverse());
    expect(confirmSavedViewCreateResponse({ view }, selected)).toBe(view.id);
  });
  test.each(["name", "description", "iconKey", "queryPlan", "display", "displayRevision"])("rejects a different %s without exposing returned content", (field) => {
    const { selected, view } = valid();
    view[field] = field === "queryPlan" ? { ...selected.queryPlan, fullText: "PRIVATE" }
      : field === "display" ? { ...selected.display, visibleFields: [...selected.display.visibleFields].reverse() }
        : field === "displayRevision" ? "0".repeat(64) : "PRIVATE";
    expect(() => confirmSavedViewCreateResponse({ view }, selected)).toThrow("입력은 유지됩니다");
    try { confirmSavedViewCreateResponse({ view }, selected); } catch (error) { expect(String(error)).not.toContain("PRIVATE"); }
  });
  test.each(["id", "name", "description", "iconKey", "queryPlan", "display", "displayRevision"])("rejects a missing %s", (field) => {
    const { selected, view } = valid(); delete view[field];
    expect(() => confirmSavedViewCreateResponse({ view }, selected)).toThrow("입력은 유지됩니다");
  });
  test.each(["", "id-only", "../elsewhere", "https://evil.test", "01arz3ndektsv4rrffq69g5fav", "81ARZ3NDEKTSV4RRFFQ69G5FAV"])("rejects non-generated ID format %s", (id) => {
    const { selected, view } = valid(); view.id = id;
    expect(() => confirmSavedViewCreateResponse({ view }, selected)).toThrow("입력은 유지됩니다");
  });
  test("rejects response normalization of an advertised different name and historical whitespace revision", () => {
    const { selected, view } = valid(); view.name = ` ${selected.name} `;
    expect(() => confirmSavedViewCreateResponse({ view }, selected)).toThrow(); view.name = selected.name;
    view.displayRevision = createHash("sha256").update(JSON.stringify(selected.display, null, 2)).digest("hex");
    expect(() => confirmSavedViewCreateResponse({ view }, selected)).toThrow();
  });
  test.each([null, [], { view: null }, { view: {} }, { error: { message: "secret" } }])("rejects malformed creation envelope %j", (body) => {
    expect(() => confirmSavedViewCreateResponse(body, valid().selected)).toThrow("입력은 유지됩니다");
  });
  test("accepts the actual create API and SQLite repository result without an adapter-shaped substitute", async () => {
    const db = new LinkSqlite(32);
    try {
      for (const flag of ["FLAG_V2_ROUTES", "FLAG_V2_WRITE"]) vi.stubEnv(flag, "1");
      harness.session.mockResolvedValue({ sessionId: "create-confirmation", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 60_000 });
      harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
      const selected = captureSavedViewCreateDefinition(candidate());
      const response = await POST(new Request("https://lighthouse.test/api/v2/saved-views", { method: "POST", headers: { origin: "https://lighthouse.test", "content-type": "application/json" }, body: JSON.stringify(selected) }));
      expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body: unknown = await response.json(), id = confirmSavedViewCreateResponse(body, selected);
      expect(response.headers.get("location")).toBe(`/v2/library/views/${id}`);
      const row = db.sql.prepare("select name,display_json,query_plan_json from v2_saved_views where id=? and user_id='link-owner'").get(id)!;
      expect(row.name).toBe(selected.name); expect(row.display_json).toBe(JSON.stringify(selected.display)); expect(row.query_plan_json).toBe(JSON.stringify(selected.queryPlan));
    } finally { db.sql.close(); }
  });
});
