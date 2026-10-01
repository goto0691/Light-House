import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/records/[recordId]/display-fields/[propertyId]/route";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { readSavedFieldPage, type SavedFieldReadRequest } from "@/lib/v2/infrastructure/d1/saved-field-value-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { SAVED_FIELD_MAX_STORED_BYTES, SAVED_FIELD_PAGE_UNITS, type SavedFieldPage } from "@/lib/v2/retrieval/saved-field-page";
import { SAVED_FIELD_INLINE_BYTES, SAVED_FIELD_PREVIEW_POINTS } from "@/lib/v2/retrieval/saved-view-fields";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner", origin = "https://lighthouse.test", now = "2026-09-22T00:00:00.000Z";
let db: LinkSqlite;
type Seed = { recordId: string; captureId: string; revisionId: string; fieldId: string; propertyId: string; key: string; raw: string };
type SqlEvent = { sql: string; method: "first" | "all" | "run" };
type ObserveHooks = { before?: (event: SqlEvent) => void; after?: (event: SqlEvent, value: unknown) => void };
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1");
  harness.session.mockResolvedValue({ sessionId: "field-read-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function changes() { return db.sql.prepare("select total_changes() as n").get()!.n; }
function propertyRaw(propertyId: string) { return String(db.sql.prepare("select value_json from v2_property_values where id=?").get(propertyId)!.value_json); }
function hash(raw: string) { return createHash("sha256").update(raw, "utf8").digest("hex"); }
function bytes(raw: string) { return new TextEncoder().encode(raw).length; }
function insertProperty(recordId: string, fieldId: string, raw: string, options: { kind?: string; locked?: number; review?: string; userId?: string; superseded?: string | null } = {}) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_json,unit_key,source_class,
    claim_risk,review_status,locked_by_user,created_at,superseded_at) values (?,?,?,?,?,?,null,'user_explicit','low',?,?,?,?)`)
    .run(id, options.userId ?? owner, recordId, fieldId, options.kind ?? "text", raw, options.review ?? "accepted", options.locked ?? 0, now, options.superseded ?? null);
  return id;
}
async function seed(raw = JSON.stringify("secret-field-value"), kind = "text", key = "long_note"): Promise<Seed> {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Independent saved-field fixture", bodyMarkdown: "original unchanged",
    aiEnabled: false, privacyLevel: "normal", clientTimezone: "Asia/Seoul", capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  const fieldId = crypto.randomUUID();
  db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
    values(?,?,?,?,?,'long_text','active','user_created',?,?)`).run(fieldId, owner, key, `${key} 이름`, "Independent fixture", now, now);
  const propertyId = insertProperty(capture.objectId, fieldId, raw, { kind });
  return { recordId: capture.objectId, captureId: capture.captureId, revisionId: capture.revisionId, fieldId, propertyId, key, raw };
}
function request(item: Seed, query: string | Record<string, string> = { fieldKey: item.key }, ids: { recordId: string; propertyId: string } = item) {
  const suffix = typeof query === "string" ? query : new URLSearchParams(query).toString();
  return GET(new Request(`${origin}/api/v2/records/${encodeURIComponent(ids.recordId)}/display-fields/${encodeURIComponent(ids.propertyId)}?${suffix}`),
    { params: Promise.resolve(ids) });
}
async function page(response: Response): Promise<SavedFieldPage> {
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return response.json() as Promise<SavedFieldPage>;
}
async function deny(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const result = await response.json(); expect(result).toMatchObject({ error: { code } });
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Expected a structured error object.");
  expect(Object.keys(result)).toEqual(["error"]);
  expect(JSON.stringify(result)).not.toContain("secret-field-value"); expect(JSON.stringify(result)).not.toContain("owner@example.test");
}
function observe(hooks: ObserveHooks = {}) {
  const events: SqlEvent[] = [];
  const binding: D1DatabaseBinding = { prepare(sql) {
    const actual = db.prepare(sql);
    const before = (method: SqlEvent["method"]) => { const event = { sql, method }; events.push(event); hooks.before?.(event); return event; };
    const wrapped: D1PreparedStatementBinding = {
      bind(...values) { actual.bind(...values); return wrapped; },
      async first<T>() { const event = before("first"), result = await actual.first<T>(); hooks.after?.(event, result); return result; },
      async all<T>() { const event = before("all"), result = await actual.all<T>(); hooks.after?.(event, result); return result; },
      async run() { const event = before("run"), result = await actual.run(); hooks.after?.(event, result); return result; },
    }; return wrapped;
  }, batch: db.batch.bind(db) };
  harness.bindings.mockReturnValue({ db: binding }); return { binding, events };
}
function valueRead(event: SqlEvent) { return /select v\.id as propertyId/.test(event.sql); }
function finalSearch(event: SqlEvent) { return event.sql.startsWith("with recursive search_tokens as"); }

describe("saved-field default list projection budgets through actual SQLite SQL", () => {
  test.each(["text", "json"])("does not send a huge %s original across the D1 return boundary", async (kind) => {
    const value = `${"가👀\\\n".repeat(15_000)}TAIL-ONLY-NOT-IN-PREVIEW`, raw = kind === "json" ? JSON.stringify({ value }) : JSON.stringify(value);
    const item = await seed(raw, kind), sqlReturns: Record<string, unknown>[] = [];
    const observed = observe({ after(event, result) { if (finalSearch(event)) sqlReturns.push(result as Record<string, unknown>); } });
    const before = changes(), result = await new D1RetrievalRepository(observed.binding, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key]);
    const projected = result.results[0].displayFields![0];
    expect(projected).toMatchObject({ fieldKey: item.key, state: "value", values: [{ propertyId: item.propertyId, renderer: kind,
      value: Array.from(raw).slice(0, SAVED_FIELD_PREVIEW_POINTS).join(""), preview: { format: "stored_json", totalBytes: bytes(raw) } }] });
    expect(sqlReturns).toHaveLength(1); const serialized = JSON.stringify(sqlReturns[0]);
    expect(serialized).not.toContain("TAIL-ONLY-NOT-IN-PREVIEW"); expect(bytes(serialized)).toBeLessThan(12_000);
    const wire = JSON.parse(String(sqlReturns[0].property_values_json));
    expect(wire).toHaveLength(1); expect(wire[0].valueJson).toBeNull(); expect(Array.from(wire[0].valuePreview)).toHaveLength(SAVED_FIELD_PREVIEW_POINTS);
    expect(propertyRaw(item.propertyId)).toBe(raw); expect(hash(propertyRaw(item.propertyId))).toBe(hash(raw)); expect(changes()).toBe(before);
    expect(observed.events.filter(finalSearch)).toHaveLength(1);
  });

  test.each([2047, 2048, 2049])("uses UTF-8 stored bytes for the exact %s-byte inline boundary", async (size) => {
    const raw = JSON.stringify(`가${"a".repeat(size - 5)}`), item = await seed(raw); expect(bytes(raw)).toBe(size);
    const result = (await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key])).results[0].displayFields![0].values[0];
    if (size <= SAVED_FIELD_INLINE_BYTES) { expect(result.value).toBe(JSON.parse(raw)); expect(result).not.toHaveProperty("preview"); }
    else { expect(result.preview?.totalBytes).toBe(size); expect(result.value).toBe(Array.from(raw).slice(0, 256).join("")); }
    expect(propertyRaw(item.propertyId)).toBe(raw);
  });

  test.each(["invalid", "wrong-type"])("marks %s large storage as conflict rather than trusted preview", async (mode) => {
    const raw = mode === "invalid" ? `"${"a".repeat(5000)}` : JSON.stringify({ wrong: "a".repeat(5000) }), item = await seed(raw);
    const result = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key]);
    expect(result.results[0].displayFields![0]).toMatchObject({ state: "conflict", values: [] });
    await deny(await request(item), 409, "saved_field_value_conflict"); expect(propertyRaw(item.propertyId)).toBe(raw);
  });

  test.each([
    ["number", 5], ["rating", 4.5], ["boolean", false], ["text", null], ["date", null],
    ["number", null], ["rating", null], ["boolean", null], ["json", null],
  ] as const)("preserves valid large stored JSON whitespace for %s %s rather than inventing conflict", async (kind, value) => {
    const raw = `${" \n".repeat(1100)}${JSON.stringify(value)} \t`, item = await seed(raw, kind);
    const result = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key]);
    expect(result.results[0].displayFields![0]).toMatchObject({ state: "value", values: [{ propertyId: item.propertyId, renderer: kind,
      value: Array.from(raw).slice(0, 256).join(""), preview: { format: "stored_json", totalBytes: bytes(raw) } }] });
    expect((await page(await request(item))).text).toBe(kind === "json" ? raw : String(value));
    expect(propertyRaw(item.propertyId)).toBe(raw);
  });

  test.each([
    ["number", '"not-a-number"'], ["rating", "1e999"], ["number", "-1e999"], ["boolean", "0"], ["boolean", '"false"'],
  ])("keeps wrong-type/non-finite %s %s storage as conflict even when a preview would fit", async (kind, value) => {
    const raw = `${" ".repeat(2200)}${value}`, item = await seed(raw, kind);
    const result = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key]);
    expect(result.results[0].displayFields![0]).toMatchObject({ state: "conflict", values: [] });
    await deny(await request(item), 409, "saved_field_value_conflict"); expect(propertyRaw(item.propertyId)).toBe(raw);
  });

  test.each(["number", "rating"])("keeps a padded signed-64 minimum %s literal from crashing the whole list query", async (kind) => {
    const raw = `${" ".repeat(2200)}-9223372036854775808`, item = await seed(raw, kind);
    const result = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key]);
    expect(result.results).toHaveLength(1); expect(result.results[0].displayFields![0]).toMatchObject({ state: "value", values: [{
      renderer: kind, value: raw.slice(0, 256), preview: { format: "stored_json", totalBytes: bytes(raw) },
    }] });
    // The existing number renderer uses finite JavaScript numbers, not arbitrary precision decimals.
    expect((await page(await request(item))).text).toBe(String(JSON.parse(raw))); expect(propertyRaw(item.propertyId)).toBe(raw);
  });

  test.each(["sensitive", "restricted"])("suppresses both preview bytes and existence on %s records", async (privacy) => {
    const item = await seed(JSON.stringify("secret-field-value".repeat(3000))); db.sql.prepare("update v2_documents set privacy_level=? where object_id=?").run(privacy, item.recordId);
    let rawReturn = ""; const observed = observe({ after(event, result) { if (finalSearch(event)) rawReturn = JSON.stringify(result); } });
    const result = await new D1RetrievalRepository(observed.binding, owner).searchPage(defaultV2QueryPlan(), true, 1, [item.key, "absent"]);
    expect(result.results[0].displayFields?.every((field) => field.state === "private" && field.values.length === 0)).toBe(true);
    expect(rawReturn).not.toContain("secret-field-value"); expect(rawReturn).not.toContain(item.propertyId);
  });

  test("keeps all small typed DTOs unchanged including null, whitespace-preserved JSON and unscaled rating", async () => {
    const cases = [{ kind: "text", raw: '"hello"', value: "hello" }, { kind: "text", raw: "null", value: null },
      { kind: "json", raw: ' { "a" : 1 }\n', value: ' { "a" : 1 }\n' }, { kind: "number", raw: "0", value: 0 },
      { kind: "boolean", raw: "false", value: false }, { kind: "rating", raw: "4.5", value: 4.5 }, { kind: "date", raw: '"2026-09-22"', value: "2026-09-22" }];
    for (const entry of cases) {
      const item = await seed(entry.raw, entry.kind, `field_${entry.kind}_${entry.raw.length}`);
      const result = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, [item.key]);
      expect(result.results.find((record) => record.recordId === item.recordId)!.displayFields![0].values).toEqual([{
        propertyId: item.propertyId, value: entry.value, renderer: entry.kind, unit: null, sourceLabel: "직접 입력", lockedByUser: false,
      }]);
    }
  });
});

describe("explicit saved-field GET through actual route and SQLite", () => {
  test("preserves text, CRLF, NUL, emoji and JSON lexical bytes without writing or AI", async () => {
    const text = "  exact 👀\r\n\u0000<svg onload=do_not_run>\\quote\"\n", item = await seed(JSON.stringify(text));
    const before = changes(), first = await page(await request(item));
    expect(first).toMatchObject({ contract: "saved-field-page.v1", recordId: item.recordId, propertyId: item.propertyId, fieldKey: item.key,
      privacyLevel: "normal", text, offset: 0, end: text.length, totalUtf16: text.length, nextOffset: null, totalStoredBytes: bytes(item.raw),
      renderer: "text", sourceLabel: "직접 입력", lockedByUser: false, unit: null });
    expect(first.revision).toBe(hash(JSON.stringify([item.recordId, item.propertyId, item.key, item.raw, "text", null, "user_explicit", 0])));
    const full = await page(await request(item, { fieldKey: item.key, revision: first.revision, format: "full" })); expect(full).toEqual(first);
    expect(changes()).toBe(before); expect(propertyRaw(item.propertyId)).toBe(item.raw);
    const jsonItem = await seed(' { "n": 1.00, "text": "\\uac00" } \n', "json", "json_source"), jsonPage = await page(await request(jsonItem));
    expect(jsonPage.text).toBe(jsonItem.raw); expect(jsonPage.renderer).toBe("json");
  });

  test("paginates all text without splitting surrogate pairs and only copies fresh full response", async () => {
    const text = `${"a".repeat(4095)}👀${"가".repeat(4093)}🧪${"b".repeat(3000)}`, item = await seed(JSON.stringify(text));
    let current = await page(await request(item)), result = current.text; const revision = current.revision;
    expect(current.end).toBe(4095); expect(current.text.length).toBeLessThanOrEqual(SAVED_FIELD_PAGE_UNITS);
    while (current.nextOffset !== null) {
      current = await page(await request(item, { fieldKey: item.key, revision, offset: String(current.nextOffset) }));
      expect(current.text.length).toBeLessThanOrEqual(SAVED_FIELD_PAGE_UNITS);
      expect(new TextDecoder().decode(new TextEncoder().encode(current.text))).toBe(current.text); result += current.text;
    }
    expect(result).toBe(text); expect((await page(await request(item, { fieldKey: item.key, revision, format: "full" }))).text).toBe(text);
    await deny(await request(item, { fieldKey: item.key, revision, offset: "4096" }), 400, "saved_field_request_invalid");
    await deny(await request(item, { fieldKey: item.key, revision, offset: String(text.length + 1) }), 400, "saved_field_request_invalid");
    expect((await page(await request(item, { fieldKey: item.key, revision, offset: String(text.length) }))).text).toBe("");
  });

  test.each([SAVED_FIELD_MAX_STORED_BYTES, SAVED_FIELD_MAX_STORED_BYTES + 1])("bounds explicit raw JSON at %s bytes before D1 returns it", async (size) => {
    // Node SQLite permits the oversized corruption fixture; this is not a D1 platform-limit claim.
    const raw = JSON.stringify("z".repeat(size - 2)), item = await seed(raw), wire: Record<string, unknown>[] = [];
    observe({ after(event, result) { if (valueRead(event)) wire.push(result as Record<string, unknown>); } });
    if (size <= SAVED_FIELD_MAX_STORED_BYTES) {
      const first = await page(await request(item)); expect(first.totalStoredBytes).toBe(size); expect(first.text).toHaveLength(4096);
      const full = await page(await request(item, { fieldKey: item.key, revision: first.revision, format: "full" })); expect(full.text).toHaveLength(size - 2);
    } else { await deny(await request(item), 413, "saved_field_too_large"); expect(wire[0].valueJson).toBeNull(); expect(bytes(JSON.stringify(wire))).toBeLessThan(500); }
    expect(propertyRaw(item.propertyId)).toBe(raw);
  });

  test.each(["null", "false", "0", '""'])("represents %s scalar exactly instead of dropping falsy values", async (raw) => {
    const kind = raw === "false" ? "boolean" : raw === "0" ? "number" : "text", item = await seed(raw, kind);
    expect((await page(await request(item))).text).toBe(raw === '""' ? "" : raw);
  });

  test.each(["same-length-value", "lexical-json", "unit", "source", "lock", "kind"])("invalidates subsequent page and full copy after %s changes", async (change) => {
    const raw = change === "lexical-json" ? '{ "x": 1 }' : JSON.stringify("a".repeat(5000)), item = await seed(raw, change === "lexical-json" ? "json" : "text");
    const first = await page(await request(item));
    if (change === "same-length-value") db.sql.prepare("update v2_property_values set value_json=? where id=?").run(JSON.stringify("b".repeat(5000)), item.propertyId);
    if (change === "lexical-json") db.sql.prepare("update v2_property_values set value_json=? where id=?").run('{"x": 1  }', item.propertyId);
    if (change === "unit") db.sql.prepare("update v2_property_values set unit_key='words' where id=?").run(item.propertyId);
    if (change === "source") db.sql.prepare("update v2_property_values set source_class='imported' where id=?").run(item.propertyId);
    if (change === "lock") db.sql.prepare("update v2_property_values set locked_by_user=1 where id=?").run(item.propertyId);
    if (change === "kind") db.sql.prepare("update v2_property_values set value_kind='json' where id=?").run(item.propertyId);
    const before = changes();
    await deny(await request(item, { fieldKey: item.key, revision: first.revision, offset: "1" }), 409, "saved_field_value_conflict");
    await deny(await request(item, { fieldKey: item.key, revision: first.revision, format: "full" }), 409, "saved_field_value_conflict");
    const fresh = await page(await request(item)); expect(fresh.revision).not.toBe(first.revision); expect(changes()).toBe(before);
  });

  test.each(["sensitive", "restricted", "deleted", "owner", "capture-owner", "property-owner", "registry-owner", "legacy", "superseded", "proposed", "disputed", "rejected", "missing-property", "wrong-record", "missing-revision"])("closes explicit reads after %s changes before final SQL", async (change) => {
    const item = await seed(), initial = await page(await request(item));
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    let reads = 0;
    const observed = observe({ before(event) { if (!valueRead(event)) return; reads++;
      if (change === "sensitive" || change === "restricted") db.sql.prepare("update v2_documents set privacy_level=? where object_id=?").run(change, item.recordId);
      if (change === "deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(item.recordId);
      if (change === "owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(item.recordId);
      if (change === "capture-owner") db.sql.prepare("update v2_capture_bundles set user_id='other-owner' where id=?").run(item.captureId);
      if (change === "property-owner") db.sql.prepare("update v2_property_values set user_id='other-owner' where id=?").run(item.propertyId);
      if (change === "registry-owner") db.sql.prepare("update v2_field_definitions set user_id='other-owner' where id=?").run(item.fieldId);
      if (change === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:orphan' where id=?").run(item.captureId);
      if (change === "superseded") db.sql.prepare("update v2_property_values set superseded_at=? where id=?").run(now, item.propertyId);
      if (["proposed", "disputed", "rejected"].includes(change)) db.sql.prepare("update v2_property_values set review_status=? where id=?").run(change, item.propertyId);
      if (change === "missing-property") db.sql.prepare("delete from v2_property_values where id=?").run(item.propertyId);
      if (change === "wrong-record") db.sql.prepare("update v2_property_values set owner_object_id=? where id=?").run("other-record", item.propertyId);
      if (change === "missing-revision") db.sql.prepare("update v2_documents set current_revision_id='missing-revision' where object_id=?").run(item.recordId);
    } });
    if (change === "wrong-record") db.sql.prepare("insert into v2_objects(id,user_id,object_kind,lifecycle_status,created_at,updated_at) values('other-record',?,'document','active',?,?)").run(owner, now, now);
    await deny(await request(item, { fieldKey: item.key, revision: initial.revision, format: "full" }), 404, "record_not_found");
    expect(reads).toBe(1); expect(observed.events.filter(valueRead)).toHaveLength(1);
  });

  test("does not combine old permission with a new value after the final awaited read", async () => {
    const item = await seed(); let changed = false;
    const observed = observe({ after(event) { if (!valueRead(event)) return; changed = true;
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.recordId);
      db.sql.prepare("update v2_property_values set value_json=? where id=?").run(JSON.stringify("new-after-snapshot-secret"), item.propertyId);
    } });
    const first = await page(await request(item)); expect(changed).toBe(true); expect(first.text).toBe("secret-field-value");
    expect(first.revision).toBe(hash(JSON.stringify([item.recordId, item.propertyId, item.key, item.raw, "text", null, "user_explicit", 0])));
    expect(observed.events.at(-1)).toMatchObject({ method: "first" }); expect(valueRead(observed.events.at(-1)!)).toBe(true);
    await deny(await request(item, { fieldKey: item.key, revision: first.revision, format: "full" }), 404, "record_not_found");
  });

  test("rejects a same-length write racing the full-copy query before its final snapshot", async () => {
    const item = await seed(JSON.stringify("a".repeat(5000))), first = await page(await request(item)); let fired = 0;
    observe({ before(event) { if (valueRead(event)) { fired++; db.sql.prepare("update v2_property_values set value_json=? where id=?").run(JSON.stringify("b".repeat(5000)), item.propertyId); } } });
    await deny(await request(item, { fieldKey: item.key, revision: first.revision, format: "full" }), 409, "saved_field_value_conflict");
    expect(fired).toBe(1); expect(propertyRaw(item.propertyId)).toBe(JSON.stringify("b".repeat(5000)));
  });

  test("lower-priority unlocked property is not readable once a current user-locked winner exists", async () => {
    const item = await seed(); expect(() => insertProperty(item.recordId, item.fieldId, '"locked winner"', { locked: 1 })).toThrow(/UNIQUE/);
    // Explicitly damaged/legacy duplicate fixture; production unique index is retained everywhere else.
    db.sql.exec("drop index uq_v2_property_current_accepted"); const lockedId = insertProperty(item.recordId, item.fieldId, '"locked winner"', { locked: 1 });
    await deny(await request(item), 404, "record_not_found");
    expect((await page(await request(item, { fieldKey: item.key }, { recordId: item.recordId, propertyId: lockedId }))).text).toBe("locked winner");
    db.sql.prepare("update v2_property_values set review_status='proposed' where id=?").run(lockedId);
    expect((await page(await request(item))).text).toBe("secret-field-value");
  });

  test("captures mutable request values before the schema probe yields", async () => {
    const item = await seed(), mutable = { fieldKey: item.key, offset: 0, revision: null, full: false } as SavedFieldReadRequest;
    const observed = observe({ before(event) { if (event.sql.includes("sqlite_master")) Object.assign(mutable, { fieldKey: "wrong", offset: 999, revision: "f".repeat(64), full: true }); } });
    const result = await readSavedFieldPage(observed.binding, owner, item.recordId, item.propertyId, mutable);
    expect(result.fieldKey).toBe(item.key); expect(result.offset).toBe(0); expect(result.text).toBe("secret-field-value");
  });

  test.each(["invalid", "wrong-text", "wrong-number", "wrong-boolean", "unknown-kind"])("rejects malformed %s persisted values without returning bytes", async (mode) => {
    const raw = mode === "invalid" ? "{broken" : mode === "wrong-text" ? '{"secret":"secret-field-value"}' : '"secret-field-value"';
    const kind = mode === "wrong-number" ? "number" : mode === "wrong-boolean" ? "boolean" : "text", item = await seed(raw, kind);
    if (mode === "unknown-kind") { db.sql.exec("pragma ignore_check_constraints=on"); db.sql.prepare("update v2_property_values set value_kind='unknown' where id=?").run(item.propertyId); }
    await deny(await request(item), 409, "saved_field_value_conflict");
  });

  test("requires authentication and owner equality even for a guessed existing property ID", async () => {
    const item = await seed(); harness.session.mockResolvedValue(null); await deny(await request(item), 401, "authentication_required");
    harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
    await deny(await request(item), 404, "record_not_found");
  });

  test("applies route gating, permits read-only mode, and keeps unexpected SQL errors secret-safe", async () => {
    const item = await seed(); vi.stubEnv("FLAG_V2_ROUTES", "0");
    await deny(await request(item), 404, "v2_routes_disabled"); vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "0");
    expect((await page(await request(item))).text).toBe("secret-field-value");
    observe({ before(event) { if (valueRead(event)) throw new Error("secret-field-value owner@example.test"); } });
    await deny(await request(item), 500, "internal_error");
  });

  test.each(["", "fieldKey=long_note&extra=1", "fieldKey=long_note&fieldKey=long_note", "fieldKey=Upper", "fieldKey=%40record.type", "fieldKey=long_note&offset=-1", "fieldKey=long_note&offset=01",
    "fieldKey=long_note&offset=1", "fieldKey=long_note&revision=short", "fieldKey=long_note&format=full", "fieldKey=long_note&format=other",
    `fieldKey=long_note&offset=1&format=full&revision=${"f".repeat(64)}`, `fieldKey=long_note&offset=2097153&revision=${"f".repeat(64)}`])("rejects invalid query %s before executing value SQL", async (query) => {
    const item = await seed(), observed = observe(); await deny(await request(item, query), 400, "saved_field_request_invalid"); expect(observed.events.filter(valueRead)).toHaveLength(0);
  });

  test.each(["", "x".repeat(201), "bad\u0000id"])("rejects invalid target ID %s", async (id) => {
    const item = await seed(); await deny(await request(item, { fieldKey: item.key }, { recordId: id, propertyId: item.propertyId }), 400, "saved_field_request_invalid");
    await deny(await request(item, { fieldKey: item.key }, { recordId: item.recordId, propertyId: id }), 400, "saved_field_request_invalid");
  });
});
