import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
import { GET } from "@/app/api/v2/saved-views/route";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { parseSavedViewCatalogRequest, validateSavedViewCatalogPage, type SavedViewCatalogPage } from "@/lib/v2/retrieval/saved-view-catalog";
import { LinkSqlite } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ userId: "link-owner", sessionId: "catalog", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function seed(index: number, options: { name?: string; owner?: string; pinned?: boolean; broken?: boolean; archived?: boolean; pinOrder?: number } = {}) {
  const id = `catalog-${String(index).padStart(3, "0")}`;
  db.sql.prepare(`insert into v2_saved_views(id,user_id,view_key,name,description,icon_key,query_plan_json,display_json,source,status,pinned,pin_order,created_at,updated_at)
    values(?,?,?,?,?,'type.collection',?,?,'user_created',?,?,?,?,?)`).run(id, options.owner ?? "link-owner", `view_${id}`, options.name ?? `목록 ${String(index).padStart(3, "0")}`, null,
    options.broken ? "{" : JSON.stringify(defaultV2QueryPlan({ fullText: "PRIVATE_QUERY" })), options.broken ? "{" : JSON.stringify({ layout: "list", density: "comfortable", groupBy: null, visibleFields: [] }),
    options.archived ? "archived" : "active", options.pinned ? 1 : 0, options.pinned ? options.pinOrder ?? index : null, "2026-09-01", "2026-09-01");
  return id;
}
async function read(query?: string, status?: 200): Promise<SavedViewCatalogPage>;
async function read(query: string, status: number): Promise<unknown>;
async function read(query = "", status = 200): Promise<unknown> {
  const response = await GET(new Request(`https://lighthouse.test/api/v2/saved-views?${query}`));
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body: unknown = await response.json();
  return status === 200 ? validateSavedViewCatalogPage(body, parseSavedViewCatalogRequest(new URLSearchParams(query))) : body;
}

describe("saved-view discovery API and SQLite", () => {
  test("returns a bounded summary page beyond twenty without full saved queries or display JSON", async () => {
    for (let index = 0; index < 45; index++) seed(index);
    const result = await read("page=2");
    expect(result).toMatchObject({ contract: "saved-view-catalog.v1", page: 2, pageSize: 20, totalCount: 45, totalPages: 3 });
    expect(result.views).toHaveLength(20); expect(result.views[0].id).toBe("catalog-020");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_QUERY"); expect(JSON.stringify(result)).not.toContain("queryPlan");
  });
  test("does not parse large or damaged query/display columns while reading summary metadata", async () => {
    seed(1, { broken: true });
    expect((await read()).views).toEqual([{ id: "catalog-001", name: "목록 001", description: null, iconKey: "type.collection", pinned: false, pinOrder: null }]);
  });
  test("keeps the pinned menu reader bounded to five metadata summaries", async () => {
    for (let index = 0; index < 8; index++) seed(index, { pinned: true });
    const views = await new D1SavedViewRepository(db, "link-owner").list({ pinnedOnly: true });
    expect(views).toHaveLength(5); expect(Object.keys(views[0]).sort()).toEqual(["description", "iconKey", "id", "name", "pinOrder", "pinned"]);
  });
  test("rejects duplicate query parameters instead of silently ignoring them", async () => {
    seed(1); expect(await read("q=first&q=second", 400)).toMatchObject({ error: { code: "saved_view_catalog_invalid" } });
  });
  test("traverses all 45 summaries once and clamps excessive pages in the same snapshot", async () => {
    for (let index = 0; index < 45; index++) seed(index);
    const pages = await Promise.all([read(), read("page=2"), read("page=3")]);
    const ids = pages.flatMap((page) => page.views.map((view: { id: string }) => view.id));
    expect(ids).toEqual(Array.from({ length: 45 }, (_, index) => `catalog-${String(index).padStart(3, "0")}`));
    expect(await read("page=9007199254740991")).toEqual(pages[2]);
  });
  test("filters literal name substrings, not descriptions or LIKE wildcard characters", async () => {
    seed(1, { name: "Cinema 영화 👀 100%" }); seed(2, { name: "review_one" }); seed(3, { name: "unrelated" });
    db.sql.prepare("update v2_saved_views set description='Cinema 영화 👀 100%' where id='catalog-003'").run();
    for (const q of ["cinEMA", "영화", "👀", "%", "  영화  "]) expect((await read(new URLSearchParams({ q }).toString())).views.map((view: { id: string }) => view.id)).toEqual(["catalog-001"]);
    expect((await read("q=_")).views.map((view: { id: string }) => view.id)).toEqual(["catalog-002"]);
    expect(await read("q=absent&page=90")).toMatchObject({ query: "absent", totalCount: 0, totalPages: 1, page: 1, views: [] });
  });
  test("keeps owner and active boundaries while pinned filtering remains a full catalog, not a five-item menu", async () => {
    for (let index = 0; index < 8; index++) seed(index, { pinned: true, pinOrder: 7 - index });
    seed(8); seed(9, { owner: "other-owner", pinned: true }); seed(10, { archived: true, pinned: true });
    const pinned = await read("pinned=1");
    expect(pinned).toMatchObject({ totalCount: 8, pinnedOnly: true });
    expect(pinned.views.map((view: { id: string }) => view.id)).toEqual(Array.from({ length: 8 }, (_, i) => `catalog-00${7 - i}`));
    expect((await read()).totalCount).toBe(9);
    harness.session.mockResolvedValue({ userId: "other-owner", sessionId: "other", expiresAt: Date.now() + 60_000 });
    expect((await read()).views.map((view: { id: string }) => view.id)).toEqual(["catalog-009"]);
  });
  test("count and items reflect an owner/status change immediately before the single SQL read without querying blobs", async () => {
    for (let index = 0; index < 21; index++) seed(index, { broken: true });
    const prepare = db.prepare.bind(db), sql: string[] = [];
    vi.spyOn(db, "prepare").mockImplementation((query) => {
      sql.push(query); const statement = prepare(query), first = statement.first.bind(statement);
      statement.first = async <T>() => {
        db.sql.prepare("update v2_saved_views set user_id='other-owner' where id='catalog-000'").run();
        db.sql.prepare("update v2_saved_views set status='archived' where id='catalog-001'").run();
        return first<T>();
      };
      return statement;
    });
    const result = await new D1SavedViewRepository(db, "link-owner").listPage({ query: "", page: 2, pinnedOnly: false });
    expect(result).toMatchObject({ page: 1, totalCount: 19, totalPages: 1 }); expect(result.views).toHaveLength(19);
    expect(result.views.map((view) => view.id)).not.toContain("catalog-000"); expect(result.views.map((view) => view.id)).not.toContain("catalog-001");
    expect(sql).toHaveLength(1); expect(sql[0]).not.toMatch(/query_plan_json|display_json/i);
  });
  test("does not mutate definitions and preserves stored newlines, fallback icons and summaries independently of query validity", async () => {
    seed(1, { name: "여러 줄\n이름", broken: true });
    db.sql.prepare("update v2_saved_views set description='설명\n둘째 줄',icon_key='unregistered' where id='catalog-001'").run();
    const before = db.sql.prepare("select * from v2_saved_views").all();
    expect((await read()).views[0]).toMatchObject({ name: "여러 줄\n이름", description: "설명\n둘째 줄", iconKey: "type.collection" });
    expect(db.sql.prepare("select * from v2_saved_views").all()).toEqual(before);
  });
  test.each(["page=0", "page=-1", "page=01", "page=1.5", "page=1e2", "page=9007199254740992", "q=%00", "q=%0A", `q=${"x".repeat(101)}`, "pinned=true", "pinned=2", "page=1&page=2", "unknown=x"])("rejects illegal input %s with no-store and no SQL", async (query) => {
    const prepare = vi.spyOn(db, "prepare");
    expect(await read(query, 400)).toMatchObject({ error: { code: "saved_view_catalog_invalid" } }); expect(prepare).not.toHaveBeenCalled();
  });
  test("unauthenticated, disabled and failed requests do not expose summaries or private SQL errors", async () => {
    seed(1); harness.session.mockResolvedValue(null);
    expect(JSON.stringify(await read("", 401))).not.toContain("목록 001");
    vi.stubEnv("FLAG_V2_ROUTES", "0"); expect(JSON.stringify(await read("", 404))).not.toContain("목록 001");
    vi.stubEnv("FLAG_V2_ROUTES", "1"); harness.session.mockResolvedValue({ userId: "link-owner", sessionId: "catalog", expiresAt: Date.now() + 60_000 });
    vi.spyOn(db, "prepare").mockImplementation(() => { throw new Error("PRIVATE_SQL_ERROR"); });
    const failure = JSON.stringify(await read("", 500)); expect(failure).not.toContain("PRIVATE_SQL_ERROR"); expect(failure).not.toContain("목록 001");
  });
});
