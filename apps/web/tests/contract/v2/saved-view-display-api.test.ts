import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { POST as createPOST } from "@/app/api/v2/saved-views/route";
import { GET as viewGET, PATCH as viewPATCH } from "@/app/api/v2/saved-views/[viewId]/route";
import { GET as fieldsGET } from "@/app/api/v2/saved-view-fields/route";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { LinkSqlite } from "../../support/link-sqlite";

type View = { id: string; name: string; display: V2SavedViewDisplay; displayRevision: string; pinned: boolean;
  pinOrder: number | null; queryPlan: ReturnType<typeof defaultV2QueryPlan>; updatedAt: string };
type Catalog = { fields: { key: string; label: string }[]; page: number; pageSize: number; totalCount: number; totalPages: number };
type SqlEvent = { query: string; method: "first" | "all" | "run" };
const origin = "https://lighthouse.test", owner = "link-owner", initialTime = "2026-09-01T00:00:00.000Z";
const initial: V2SavedViewDisplay = { layout: "list", density: "comfortable", groupBy: null, visibleFields: [] };
const desired: V2SavedViewDisplay = { layout: "table", density: "compact", groupBy: "type", visibleFields: ["rating", "mood"] };
const competing: V2SavedViewDisplay = { layout: "cards", density: "comfortable", groupBy: "written_month", visibleFields: ["mood"] };
let db: LinkSqlite;

beforeEach(() => {
  db = new LinkSqlite(32);
  for (const flag of ["FLAG_V2_ROUTES", "FLAG_V2_WRITE"]) vi.stubEnv(flag, "1");
  harness.session.mockResolvedValue({ sessionId: "saved-display-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function hash(raw: string) { return createHash("sha256").update(raw, "utf8").digest("hex"); }
function row(id: string) { return db.sql.prepare("select * from v2_saved_views where id=?").get(id)!; }
function changes() { return db.sql.prepare("select total_changes() as n").get()!.n; }
function get(id: string) { return viewGET(new Request(`${origin}/api/v2/saved-views/${id}`), { params: Promise.resolve({ viewId: id }) }); }
function patch(id: string, body: unknown, headers: HeadersInit = { origin, "content-type": "application/json" }) {
  return viewPATCH(new Request(`${origin}/api/v2/saved-views/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ viewId: id }) });
}
function update(id: string, expectedRevision: string, display: unknown = desired) { return patch(id, { action: "display", display, expectedRevision }); }
function catalog(query = "") { return fieldsGET(new Request(`${origin}/api/v2/saved-view-fields?${query}`)); }
async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return await response.json() as T;
}
async function view(response: Response, status = 200) { return (await json<{ view: View }>(response, status)).view; }
async function deny(response: Response, status: number, code: string) {
  const result = await json<Record<string, unknown>>(response, status);
  expect(Object.keys(result)).toEqual(["error"]); expect(result).toMatchObject({ error: { code } });
  for (const value of ["PRIVATE SAVED VIEW", "PRIVATE FIELD", "owner@example.test", "description-secret", "query-secret"])
    expect(JSON.stringify(result)).not.toContain(value);
}
async function seed() {
  const result = await view(await createPOST(new Request(`${origin}/api/v2/saved-views`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({
      name: "PRIVATE SAVED VIEW", description: "description-secret", iconKey: "type.collection", display: initial,
      queryPlan: defaultV2QueryPlan({ fullText: "query-secret", propertyFilters: [{ fieldKey: "rating", operator: "lte", value: 4.5 }],
        entityFilters: [{ canonicalName: "Alice" }, { targetObjectId: "film-1" }],
        dateFilter: { axis: "written_at", from: "2026-09-01", to: "2026-09-12" } }),
    }),
  })), 201);
  db.sql.prepare("update v2_saved_views set created_at=?,updated_at=? where id=?").run(initialTime, initialTime, result.id);
  return await view(await get(result.id));
}

/** Execute genuine repository SQL, inserting a deterministic second writer only at the selected await boundary. */
function intercept(hooks: { before?: (event: SqlEvent) => void; after?: (event: SqlEvent) => void }) {
  const binding: D1DatabaseBinding = {
    prepare(query) {
      const statement = db.prepare(query);
      const event = (method: SqlEvent["method"]) => ({ query, method });
      const wrapped: D1PreparedStatementBinding = {
        bind(...values) { statement.bind(...values); return wrapped; },
        async first<T>() { hooks.before?.(event("first")); const result = await statement.first<T>(); hooks.after?.(event("first")); return result; },
        async all<T>() { hooks.before?.(event("all")); const result = await statement.all<T>(); hooks.after?.(event("all")); return result; },
        async run() { hooks.before?.(event("run")); const result = await statement.run(); hooks.after?.(event("run")); return result; },
      };
      return wrapped;
    },
    batch: db.batch.bind(db),
  };
  harness.bindings.mockReturnValue({ db: binding });
}
function isDisplayWrite(event: SqlEvent) { return /^\s*update\s+v2_saved_views\s+set\s+display_json\s*=/i.test(event.query); }

describe("saved display exact content-CAS through actual API and SQLite", () => {
  test("GET is read-only and hashes exact stored JSON bytes, not the projected canonical object", async () => {
    const saved = await seed();
    const raw = '{ "visibleFields": [ ], "groupBy": null, "density": "comfortable", "layout": "list" }\n';
    db.sql.prepare("update v2_saved_views set display_json=? where id=?").run(raw, saved.id);
    const before = changes(), result = await view(await get(saved.id));
    expect(result.display).toEqual(initial); expect(result.displayRevision).toBe(hash(raw));
    expect(result.displayRevision).not.toBe(hash(JSON.stringify(initial))); expect(changes()).toBe(before);
  });

  test("PATCH changes only display and update time, returns its exact revision, and retains the rich saved query", async () => {
    const saved = await seed(), before = row(saved.id);
    const result = await view(await update(saved.id, saved.displayRevision)), after = row(saved.id);
    expect(result.display).toEqual(desired); expect(result.displayRevision).toBe(hash(String(after.display_json)));
    expect(result.queryPlan).toEqual(saved.queryPlan); expect(result.updatedAt).not.toBe(initialTime);
    expect(after).toEqual({ ...before, display_json: JSON.stringify(desired), updated_at: result.updatedAt });
    expect((await view(await get(saved.id))).displayRevision).toBe(result.displayRevision);
    expect(db.sql.prepare("select count(*) as n from v2_idempotency_records").get()!.n).toBe(0);
  });

  test("all existing layout/density/groupBy combinations and eight ordered fields are accepted", async () => {
    let saved = await seed();
    for (const layout of ["list", "cards", "timeline", "table"] as const)
      for (const density of ["comfortable", "compact"] as const)
        for (const groupBy of [null, "type", "captured_month", "written_month"] as const) {
          const display = { layout, density, groupBy, visibleFields: Array.from({ length: 8 }, (_, index) => `field.${index}`) };
          saved = await view(await update(saved.id, saved.displayRevision, display)); expect(saved.display).toEqual(display);
        }
  });

  test("preserves existing first-occurrence normalization for duplicate visible field keys", async () => {
    const saved = await seed();
    const result = await view(await update(saved.id, saved.displayRevision, { ...desired, visibleFields: ["mood", "rating", "mood"] }));
    expect(result.display.visibleFields).toEqual(["mood", "rating"]);
  });

  test("persists all four metadata selectors separately from their four legitimate bare property keys", async () => {
    const saved = await seed(), keys = ["captured_at", "written_at", "updated_at", "type"];
    const visibleFields = keys.flatMap((key) => [key, `@record.${key}`]);
    const result = await view(await update(saved.id, saved.displayRevision, { ...desired, visibleFields }));
    expect(result.display.visibleFields).toEqual(visibleFields);
    expect((await view(await get(saved.id))).display.visibleFields).toEqual(visibleFields);
  });

  test("stale conflicting content returns 409 with no write or private row bytes", async () => {
    const saved = await seed(); await view(await update(saved.id, saved.displayRevision));
    const before = row(saved.id), beforeChanges = changes();
    await deny(await update(saved.id, saved.displayRevision, competing), 409, "saved_view_display_conflict");
    expect(row(saved.id)).toEqual(before); expect(changes()).toBe(beforeChanges);
  });

  test("same already-applied content with an old revision succeeds without write, timestamp change, or receipt", async () => {
    const saved = await seed(), first = await view(await update(saved.id, saved.displayRevision));
    const before = row(saved.id), beforeChanges = changes();
    const retried = await view(await update(saved.id, saved.displayRevision));
    expect(retried).toEqual(first); expect(row(saved.id)).toEqual(before); expect(changes()).toBe(beforeChanges);
    expect(db.sql.prepare("select count(*) as n from v2_idempotency_records").get()!.n).toBe(0);
  });

  test("an old retry cannot overwrite a newer different display", async () => {
    const saved = await seed(), first = await view(await update(saved.id, saved.displayRevision));
    const second = await view(await update(saved.id, first.displayRevision, competing)), beforeChanges = changes();
    await deny(await update(saved.id, saved.displayRevision), 409, "saved_view_display_conflict");
    expect((await view(await get(saved.id))).display).toEqual(second.display); expect(changes()).toBe(beforeChanges);
  });

  test("equal projected settings with different stored whitespace still conflict when requesting a different display", async () => {
    const saved = await seed();
    const raw = JSON.stringify(initial, null, 2); db.sql.prepare("update v2_saved_views set display_json=? where id=?").run(raw, saved.id);
    const beforeChanges = changes(); await deny(await update(saved.id, saved.displayRevision), 409, "saved_view_display_conflict");
    expect(row(saved.id).display_json).toBe(raw); expect(changes()).toBe(beforeChanges);
    expect((await view(await update(saved.id, hash(raw)))).display).toEqual(desired);
  });

  test("same-state retries accept noncanonical stored formatting without normalizing or rewriting it", async () => {
    const saved = await seed();
    const raw = JSON.stringify(desired, null, 2); db.sql.prepare("update v2_saved_views set display_json=? where id=?").run(raw, saved.id);
    const beforeChanges = changes(), result = await view(await update(saved.id, saved.displayRevision));
    expect(result.display).toEqual(desired); expect(result.displayRevision).toBe(hash(raw));
    expect(row(saved.id).display_json).toBe(raw); expect(changes()).toBe(beforeChanges);
  });

  test("content-CAS permits exact-byte A→B→A; this is explicitly not a monotonic-history or receipt token", async () => {
    const a = await seed(), b = await view(await update(a.id, a.displayRevision));
    const again = await view(await update(a.id, b.displayRevision, initial)); expect(again.displayRevision).toBe(a.displayRevision);
    expect((await view(await update(a.id, a.displayRevision, competing))).display).toEqual(competing);
  });

  test("pin changes and unrelated timestamps do not conflict with the display revision", async () => {
    const saved = await seed();
    const pinned = await view(await patch(saved.id, { action: "pin", pinned: true }));
    expect(pinned.pinned).toBe(true); expect(pinned.displayRevision).toBe(saved.displayRevision);
    const result = await view(await update(saved.id, saved.displayRevision));
    expect(result.pinned).toBe(true); expect(result.pinOrder).toBe(pinned.pinOrder); expect(result.display).toEqual(desired);
  });

  test("a pin update immediately before the atomic display write survives without false conflict", async () => {
    const saved = await seed(); let fired = false;
    intercept({ before(event) {
      if (!fired && isDisplayWrite(event)) { fired = true; db.sql.prepare("update v2_saved_views set pinned=1,pin_order=4,updated_at=? where id=?").run("2026-09-02T00:00:00.000Z", saved.id); }
    } });
    const result = await view(await update(saved.id, saved.displayRevision));
    expect(fired).toBe(true); expect(result).toMatchObject({ display: desired, pinned: true, pinOrder: 4 });
    expect(row(saved.id)).toMatchObject({ pinned: 1, pin_order: 4 });
  });

  test("a different display committed immediately before UPDATE fails the atomic exact-byte CAS", async () => {
    const saved = await seed(); let fired = false, afterCompetingWrite: ReturnType<typeof changes>;
    intercept({ before(event) {
      if (!fired && isDisplayWrite(event)) {
        fired = true; db.sql.prepare("update v2_saved_views set display_json=? where id=?").run(JSON.stringify(competing), saved.id);
        // Includes the canonical backup change-event trigger; the rejected request must add no further writes.
        afterCompetingWrite = changes();
      }
    } });
    await deny(await update(saved.id, saved.displayRevision), 409, "saved_view_display_conflict");
    expect(fired).toBe(true); expect(row(saved.id).display_json).toBe(JSON.stringify(competing)); expect(changes()).toBe(afterCompetingWrite!);
  });

  test("successful response uses UPDATE RETURNING, not a later writer's subsequent GET", async () => {
    const saved = await seed(); let fired = false;
    intercept({ after(event) {
      if (!fired && isDisplayWrite(event)) {
        fired = true; expect(event.query).toMatch(/\breturning\b/i);
        db.sql.prepare("update v2_saved_views set display_json=?,updated_at=? where id=?").run(JSON.stringify(competing), "2026-09-13T00:00:00.000Z", saved.id);
      }
    } });
    const result = await view(await update(saved.id, saved.displayRevision));
    expect(fired).toBe(true); expect(result.display).toEqual(desired); expect(result.displayRevision).toBe(hash(JSON.stringify(desired)));
    expect(result.updatedAt).not.toBe("2026-09-13T00:00:00.000Z"); expect(row(saved.id).display_json).toBe(JSON.stringify(competing));
  });

  test("another writer applying the same desired display before UPDATE yields a read-only current-state success", async () => {
    const saved = await seed(); let fired = false, afterCompetingWrite: ReturnType<typeof changes>;
    intercept({ before(event) {
      if (!fired && isDisplayWrite(event)) {
        fired = true; db.sql.prepare("update v2_saved_views set display_json=?,updated_at=? where id=?").run(JSON.stringify(desired), initialTime, saved.id);
        afterCompetingWrite = changes();
      }
    } });
    const result = await view(await update(saved.id, saved.displayRevision));
    expect(fired).toBe(true); expect(result.display).toEqual(desired); expect(result.updatedAt).toBe(initialTime);
    expect(changes()).toBe(afterCompetingWrite!);
  });

  test.each(["foreign", "archived", "missing"] as const)("GET/PATCH return opaque 404 for %s views without writing", async (state) => {
    const saved = await seed(); let id = saved.id;
    if (state === "foreign") db.sql.prepare("update v2_saved_views set user_id='other-owner' where id=?").run(id);
    if (state === "archived") db.sql.prepare("update v2_saved_views set status='archived' where id=?").run(id);
    if (state === "missing") id = "does-not-exist";
    const beforeChanges = changes(); await deny(await get(id), 404, "saved_view_not_found");
    await deny(await update(id, saved.displayRevision), 404, "saved_view_not_found"); expect(changes()).toBe(beforeChanges);
  });

  test.each(["foreign", "archived", "deleted"] as const)("the final display write fences a concurrently %s row", async (state) => {
    const saved = await seed(); let fired = false;
    intercept({ before(event) {
      if (!fired && isDisplayWrite(event)) {
        fired = true;
        if (state === "deleted") db.sql.prepare("delete from v2_saved_views where id=?").run(saved.id);
        else db.sql.prepare(`update v2_saved_views set ${state === "foreign" ? "user_id='other-owner'" : "status='archived'"} where id=?`).run(saved.id);
      }
    } });
    await deny(await update(saved.id, saved.displayRevision), 404, "saved_view_not_found"); expect(fired).toBe(true);
    if (state !== "deleted") expect(row(saved.id).display_json).toBe(JSON.stringify(initial));
  });
});

describe("strict display payload and route authorization", () => {
  const invalidDisplays: [string, unknown][] = [
    ["null", null], ["array", []], ["extra key", { ...desired, title: "no" }],
    ...Object.keys(initial).map((key): [string, unknown] => [`missing ${key}`, Object.fromEntries(Object.entries(initial).filter(([name]) => name !== key))]),
    ["invalid layout", { ...desired, layout: "grid" }], ["invalid density", { ...desired, density: "tiny" }],
    ["invalid grouping", { ...desired, groupBy: "owner" }], ["non-array fields", { ...desired, visibleFields: "rating" }],
    ["nine fields", { ...desired, visibleFields: Array.from({ length: 9 }, (_, i) => `field${i}`) }],
    ["non-string field", { ...desired, visibleFields: [1] }], ["SQL field", { ...desired, visibleFields: ["x');drop table users;--"] }],
    ["uppercase field", { ...desired, visibleFields: ["Rating"] }], ["empty field", { ...desired, visibleFields: [""] }],
    ["oversize field", { ...desired, visibleFields: ["x".repeat(101)] }], ["NUL field", { ...desired, visibleFields: ["x\0y"] }],
    ["unknown metadata selector", { ...desired, visibleFields: ["@record.secret"] }],
    ["metadata suffix", { ...desired, visibleFields: ["@record.type.extra"] }],
    ["other namespace", { ...desired, visibleFields: ["@user.type"] }],
  ];
  test.each(invalidDisplays)("rejects %s without changing storage", async (_label, display) => {
    const saved = await seed(), before = row(saved.id), beforeChanges = changes();
    await deny(await update(saved.id, saved.displayRevision, display), 400, "saved_view_invalid");
    expect(row(saved.id)).toEqual(before); expect(changes()).toBe(beforeChanges);
  });

  test.each(["", "g".repeat(64), "a".repeat(63), "a".repeat(65), "SHA256:" + "a".repeat(64), null, 5])("rejects malformed expectedRevision %j", async (expectedRevision) => {
    const saved = await seed(), beforeChanges = changes();
    await deny(await patch(saved.id, { action: "display", display: desired, expectedRevision }), 400, "saved_view_invalid"); expect(changes()).toBe(beforeChanges);
  });
  test.each(["queryPlan", "pinned", "name", "receipt", "unexpected"])("rejects extra body key %s without changing another setting", async (key) => {
    const saved = await seed(), beforeChanges = changes();
    await deny(await patch(saved.id, { action: "display", display: desired, expectedRevision: saved.displayRevision, [key]: true }), 400, "saved_view_action_invalid");
    expect(changes()).toBe(beforeChanges);
  });

  test("rejects malformed JSON and non-object JSON with no write", async () => {
    const saved = await seed(), beforeChanges = changes();
    const malformed = await viewPATCH(new Request(`${origin}/api/v2/saved-views/${saved.id}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: "{" }), { params: Promise.resolve({ viewId: saved.id }) });
    await deny(malformed, 400, "invalid_json"); await deny(await patch(saved.id, []), 400, "invalid_json_shape"); expect(changes()).toBe(beforeChanges);
  });

  test("enforces the actual 8192-byte body bound without relying on Content-Length", async () => {
    const saved = await seed(), beforeChanges = changes();
    const raw = JSON.stringify({ action: "display", display: { ...desired, visibleFields: ["한".repeat(3000)] }, expectedRevision: saved.displayRevision });
    expect(raw.length).toBeLessThan(8192); expect(new TextEncoder().encode(raw).length).toBeGreaterThan(8192);
    const result = await viewPATCH(new Request(`${origin}/api/v2/saved-views/${saved.id}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: raw }), { params: Promise.resolve({ viewId: saved.id }) });
    await deny(result, 413, "request_too_large"); expect(changes()).toBe(beforeChanges);
  });

  test("unauthenticated GET/PATCH/catalog are no-store 401 and do not read private content", async () => {
    const saved = await seed(), beforeChanges = changes(); harness.session.mockResolvedValue(null);
    await deny(await get(saved.id), 401, "authentication_required");
    await deny(await update(saved.id, saved.displayRevision), 401, "authentication_required");
    await deny(await catalog(), 401, "authentication_required"); expect(changes()).toBe(beforeChanges);
  });
  test("write gate blocks PATCH while GET/catalog remain available", async () => {
    const saved = await seed(), beforeChanges = changes(); vi.stubEnv("FLAG_V2_WRITE", "0");
    await deny(await update(saved.id, saved.displayRevision), 503, "v2_write_disabled");
    await view(await get(saved.id)); await json<Catalog>(await catalog()); expect(changes()).toBe(beforeChanges);
  });
  test("route gate closes all three endpoints", async () => {
    const saved = await seed(), beforeChanges = changes(); vi.stubEnv("FLAG_V2_ROUTES", "0");
    await deny(await get(saved.id), 404, "v2_routes_disabled"); await deny(await update(saved.id, saved.displayRevision), 404, "v2_routes_disabled");
    await deny(await catalog(), 404, "v2_routes_disabled"); expect(changes()).toBe(beforeChanges);
  });
  test.each([
    ["missing origin", { "content-type": "application/json" }, 403, "origin_rejected"],
    ["foreign origin", { origin: "https://evil.test", "content-type": "application/json" }, 403, "origin_rejected"],
    ["wrong content type", { origin, "content-type": "text/plain" }, 415, "content_type_rejected"],
  ] as const)("mutation policy rejects %s", async (_label, headers, status, code) => {
    const saved = await seed(), beforeChanges = changes();
    await deny(await patch(saved.id, { action: "display", display: desired, expectedRevision: saved.displayRevision }, headers), status, code);
    expect(changes()).toBe(beforeChanges);
  });
});

function field(key: string, label: string, status = "active", userId = owner) {
  db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
    values(?,?,?,?,?,'short_text',?,'user_created',?,?)`).run(crypto.randomUUID(), userId, key, label, "PRIVATE FIELD definition", status, initialTime, initialTime);
}
describe("owner-only display field catalog", () => {
  test("pages beyond the former small registry cap with exact totals, stable unique entries, and metadata-only DTO", async () => {
    for (let i = 0; i < 63; i++) field(`field.${String(i).padStart(2, "0")}`, `Field ${String(i).padStart(2, "0")}`, i % 2 ? "observed" : "active");
    for (const status of ["candidate", "archived", "merged"]) field(`hidden.${status}`, "PRIVATE FIELD", status);
    field("foreign.only", "PRIVATE FIELD", "active", "other-owner"); field("field.00", "PRIVATE FIELD", "active", "other-owner");
    const beforeChanges = changes(), pages = [] as Catalog[];
    for (let page = 1; page <= 4; page++) pages.push(await json<Catalog>(await catalog(`page=${page}`)));
    for (const [index, result] of pages.entries()) {
      expect(Object.keys(result).sort()).toEqual(["fields", "page", "pageSize", "totalCount", "totalPages"]);
      expect(result).toMatchObject({ page: index + 1, pageSize: 20, totalCount: 63, totalPages: 4 });
      expect(result.fields).toHaveLength([20, 20, 20, 3][index]);
      for (const item of result.fields) expect(Object.keys(item).sort()).toEqual(["key", "label"]);
    }
    const fields = pages.flatMap((page) => page.fields);
    expect(new Set(fields.map((item) => item.key)).size).toBe(63);
    expect(fields.map((item) => item.key).sort()).toEqual(Array.from({ length: 63 }, (_, i) => `field.${String(i).padStart(2, "0")}`));
    expect(JSON.stringify(pages)).not.toContain("PRIVATE FIELD"); expect(changes()).toBe(beforeChanges);
    expect((await json<Catalog>(await catalog("page=2"))).fields).toEqual(pages[1].fields);
    expect(await json<Catalog>(await catalog("page=9007199254740991"))).toEqual(pages[3]);
  });

  test("empty registries clamp to page one and legitimate bare properties remain discoverable", async () => {
    expect(await json<Catalog>(await catalog("page=5"))).toEqual({ fields: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 1 });
    const keys = ["captured_at", "written_at", "updated_at", "type"].sort();
    for (const key of keys) field(key, `User ${key}`);
    expect(await json<Catalog>(await catalog("page=5"))).toEqual({ fields: keys.map((key) => ({ key, label: `User ${key}` })), page: 1, pageSize: 20, totalCount: 4, totalPages: 1 });
  });

  test("filters by key or label, including literal SQL wildcards and Unicode, without wildcard or SQL injection", async () => {
    field("movie.rating", "평점"); field("literal.percent", "100% delight"); field("literal.underscore", "snake_case");
    field("literal.quote", "Chef's note"); field("decoy", "100X snakeYcase"); field("foreign.rating", "평점", "active", "other-owner");
    for (const [q, key] of [["movie.rating", "movie.rating"], ["평점", "movie.rating"], ["%", "literal.percent"], ["_", "literal.underscore"], ["Chef's", "literal.quote"]]) {
      const result = await json<Catalog>(await catalog(new URLSearchParams({ q, page: "1" }).toString()));
      expect(result.totalCount).toBe(1); expect(result.fields.map((item) => item.key)).toEqual([key]);
    }
    const result = await json<Catalog>(await catalog(new URLSearchParams({ q: "' OR 1=1 --" }).toString()));
    expect(result.totalCount).toBe(0); expect(result.fields).toEqual([]);
  });

  test("a different owner sees only its own definitions even when field keys overlap", async () => {
    field("rating", "Owner rating"); field("rating", "Other rating", "observed", "other-owner");
    harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
    const result = await json<Catalog>(await catalog()); expect(result.fields).toEqual([{ key: "rating", label: "Other rating" }]); expect(result.totalCount).toBe(1);
  });

  test.each([
    "q=a&q=b", "page=1&page=2", "unknown=1", "limit=100", "page=", "page=0", "page=-1", "page=1.5", "page=1e2",
    "page=9007199254740992", "page=abc", "page=01", "q=a%00b", "q=a%0Ab", "q=a%7Fb", `q=${"x".repeat(101)}`,
  ])("rejects invalid catalog query %s without writes", async (query) => {
    const beforeChanges = changes(); await deny(await catalog(query), 400, "saved_view_fields_invalid"); expect(changes()).toBe(beforeChanges);
  });
});
