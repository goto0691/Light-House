import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
import { GET } from "@/app/api/v2/saved-view-fields/route";
import { parseSavedViewFieldLookup, validateSavedViewFieldLookupKeys } from "@/lib/v2/retrieval/saved-view-field-lookup";
import { savedViewSelectedFieldLabels } from "@/lib/v2/infrastructure/d1/saved-view-field-catalog";
import { LinkSqlite } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.session.mockResolvedValue({ sessionId: "field-labels", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function field(key: string, label: string, status = "active", owner = "link-owner") {
  db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
    values(?,?,?,?,?,'short_text',?,'user_created',?,?)`).run(crypto.randomUUID(), owner, key, label, "PRIVATE definition not metadata", status, "2026-09-01", "2026-09-01");
}
function request(query: string) { return GET(new Request(`https://lighthouse.test/api/v2/saved-view-fields?${query}`)); }
function changes() { return db.sql.prepare("select total_changes() as n").get()!.n; }
async function read(query: string, status = 200) {
  const response = await request(query); expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store"); return response.json();
}

describe("selected field exact metadata lookup through API and real SQLite", () => {
  test("preserves requested order and bare-key identity with metadata-only read and no write", async () => {
    field("z_field", "나의 분야"); field("a_field", "첫 분야", "observed"); field("type", "사용자 타입");
    const before = changes();
    expect(await read("key=z_field&key=type&key=a_field")).toEqual({ fields: [{ key: "z_field", label: "나의 분야" }, { key: "type", label: "사용자 타입" }, { key: "a_field", label: "첫 분야" }] });
    expect(changes()).toBe(before);
  });
  test("owner and visibility fences omit foreign, missing, candidate, archived and merged keys without presence hints", async () => {
    field("same", "내 필드"); field("same", "FOREIGN", "active", "other-owner"); field("foreign", "FOREIGN", "active", "other-owner");
    for (const status of ["candidate", "archived", "merged"]) field(status, `PRIVATE ${status}`, status);
    expect(await read("key=foreign&key=missing&key=archived&key=merged&key=candidate&key=same")).toEqual({ fields: [{ key: "same", label: "내 필드" }] });
    harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
    expect(await read("key=same")).toEqual({ fields: [{ key: "same", label: "FOREIGN" }] });
  });
  test("all eight selections resolve beyond paged catalog positions and no definitions means empty metadata", async () => {
    for (let index = 0; index < 80; index++) field(`field_${index}`, `분야 ${index}`);
    const keys = Array.from({ length: 8 }, (_, index) => `field_${79 - index}`);
    expect(await read(new URLSearchParams(keys.map((key) => ["key", key])).toString())).toEqual({ fields: keys.map((key) => ({ key, label: `분야 ${key.slice(6)}` })) });
    expect(await read("key=missing")).toEqual({ fields: [] });
  });
  test.each(["key=", "key=a&key=a", "key=a&q=", "key=a&page=1", "key=a&unexpected=x", "key=%40record.type", "key=A", "key=1a", "key=a%00b", "key=a%0Ab", "key=a%20b", "key=%27%20OR%201=1", `key=${"a".repeat(101)}`, Array.from({ length: 9 }, (_, index) => `key=f${index}`).join("&")])("invalid lookup %s is rejected before registry access", async (query) => {
    const prepare = vi.spyOn(db, "prepare"), before = changes();
    expect(await read(query, 400)).toMatchObject({ error: { code: "saved_view_fields_invalid" } });
    expect(prepare).not.toHaveBeenCalled(); expect(changes()).toBe(before);
  });
  test("missing session and disabled route fail closed and no-store even for malformed keys", async () => {
    harness.session.mockResolvedValue(null);
    expect(await read("key=a", 401)).toMatchObject({ error: { code: "authentication_required" } });
    vi.stubEnv("FLAG_V2_ROUTES", "0");
    expect(await read("key=a", 404)).toMatchObject({ error: { code: "v2_routes_disabled" } });
  });
  test("unexpected database failure is no-store without private details", async () => {
    vi.spyOn(db, "prepare").mockImplementation(() => { throw new Error("PRIVATE database failure"); });
    const body = await read("key=a", 500);
    expect(body).toMatchObject({ error: { code: "internal_error" } }); expect(JSON.stringify(body)).not.toContain("PRIVATE");
  });
  test("lookup coexists with unchanged q/page search and clamping", async () => {
    field("rating", "내 평점"); field("other", "별도");
    expect(await read("q=rating&page=9")).toEqual({ fields: [{ key: "rating", label: "내 평점" }], page: 1, pageSize: 20, totalPages: 1, totalCount: 1 });
  });
  test("repository validates and captures an immutable key copy before await", async () => {
    field("a", "A"); const keys = ["a"];
    const pending = savedViewSelectedFieldLabels(db, "link-owner", keys); keys[0] = "b";
    expect(await pending).toEqual({ fields: [{ key: "a", label: "A" }] });
    await expect(savedViewSelectedFieldLabels(db, "link-owner", [])).rejects.toThrow("invalid");
    expect(Object.isFrozen(validateSavedViewFieldLookupKeys(["a"]))).toBe(true);
  });
});

describe("selected label response closure", () => {
  test("accepts only ordered exact requested subsets without fabricating a missing label", () => {
    expect(parseSavedViewFieldLookup({ fields: [{ key: "b", label: "<script>literal</script>" }] }, ["a", "b"])).toEqual([{ key: "b", label: "<script>literal</script>" }]);
    expect(parseSavedViewFieldLookup({ fields: [] }, ["a"])).toEqual([]);
  });
  test.each([null, [], {}, { fields: null }, { fields: [], page: 1 }, { fields: [{ key: "other", label: "Foreign" }] }, { fields: [{ key: "a", label: 4 }] }, { fields: [{ key: "a", label: "A", value: "private" }] }, { fields: [{ key: "a", label: "A" }, { key: "a", label: "Again" }] }, { fields: [{ key: "b", label: "B" }, { key: "a", label: "A" }] }])("rejects malformed or cross-request metadata %j", (body) => {
    expect(() => parseSavedViewFieldLookup(body, ["a", "b"])).toThrow("invalid");
  });
});
