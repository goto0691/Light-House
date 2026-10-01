import { afterEach, describe, expect, test } from "vitest";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { captureSavedViewVisibleFields, formatSavedViewFieldValue, presentSavedViewFields, type SavedViewFieldValueRow } from "@/lib/v2/retrieval/saved-view-fields";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite } from "../../support/link-sqlite";

const databases: LinkSqlite[] = [], owner = "link-owner", now = "2026-09-12T10:00:00.000Z";
function database(version = 32) { const db = new LinkSqlite(version); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });
async function capture(db: LinkSqlite, privacyLevel: "normal" | "sensitive" | "restricted" = "normal", title = "visible title") {
  const prepared = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: "note", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(prepared); return prepared;
}
function field(db: LinkSqlite, key: string, dataType = "short_text", userId = owner, unit: string | null = null) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,canonical_unit,status,origin,schema_version,usage_count,created_at,updated_at)
    values (?,?,?,?,?,?,?,'active','user_created',1,1,?,?)`).run(id, userId, key, `${key} 이름`, key, dataType, unit, now, now); return id;
}
function property(db: LinkSqlite, recordId: string, fieldId: string, value: unknown, options: {
  kind?: string; review?: string; supersededAt?: string | null; locked?: number; sourceClass?: string; unit?: string | null; userId?: string;
} = {}) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_json,unit_key,source_class,claim_risk,review_status,locked_by_user,created_at,superseded_at)
    values (?,?,?,?,?,?,?,?,'low',?,?,?,?)`).run(id, options.userId ?? owner, recordId, fieldId, options.kind ?? "text", JSON.stringify(value), options.unit ?? null,
    options.sourceClass ?? "user_explicit", options.review ?? "accepted", options.locked ?? 0, now, options.supersededAt ?? null); return id;
}
const query = () => defaultV2QueryPlan();
function observeFinal(db: LinkSqlite, before: (sql: string) => void) {
  let count = 0;
  const binding: D1DatabaseBinding = { prepare(sql) {
    let actual = db.prepare(sql);
    const statement: D1PreparedStatementBinding = { bind(...values) { actual = actual.bind(...values); return statement; },
      async first<T>() { if (sql.startsWith("with recursive search_tokens as")) { count++; before(sql); } return actual.first<T>(); },
      all<T>() { return actual.all<T>(); }, run() { return actual.run(); } };
    return statement;
  }, batch: (statements) => db.batch(statements) };
  return { binding, count: () => count };
}
function type(db: LinkSqlite, recordId: string, key: string, { role = "primary", locked = 0, review = "accepted", source = "user" } = {}) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
    values (?,?,?,?,'document','active','user_created',?,1,1,0,?,?)`).run(id, owner, key, `${key} 분류`, key, now, now);
  db.sql.prepare(`insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
    values (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), owner, recordId, id, role, source, review, locked, now, now);
}

describe("saved view selected fields: pure contract and actual Node SQLite", () => {
  test("keeps all bare registry names distinct from reserved record metadata", async () => {
    const db = database(), record = await capture(db), keys = ["captured_at", "written_at", "updated_at", "type"];
    for (const key of keys) property(db, record.objectId, field(db, key), `my ${key}`);
    const repo = new D1RetrievalRepository(db, owner), page = await repo.searchPage(query(), false, 1, keys);
    expect(page.results[0].displayFields?.map((item) => item.values[0]?.value)).toEqual(keys.map((key) => `my ${key}`));
    const all = await repo.searchPage(query(), false, 1, [...keys, ...keys.map((key) => `@record.${key}`)]);
    expect(all.results[0].displayFields).toHaveLength(8);
    expect(all.results[0].displayFields?.[4]).toMatchObject({ fieldKey: "@record.captured_at", state: "value", values: [{ propertyId: null, value: now }] });
    expect(all.results[0].displayFields?.[5]).toMatchObject({ fieldKey: "@record.written_at", state: "missing", values: [] });
    expect(all.results[0].displayFields?.[7]).toMatchObject({ fieldKey: "@record.type", state: "missing", values: [] });
  });
  test("projects selected builtins and accepted values in requested order", async () => {
    const db = database(), record = await capture(db), rating = field(db, "rating", "rating");
    const propertyId = property(db, record.objectId, rating, 4.5, { kind: "rating", locked: 1 });
    const page = await new D1RetrievalRepository(db, owner).searchPage(query(), false, 1, ["rating", "@record.written_at", "@record.captured_at", "@record.updated_at", "@record.type"]);
    expect(page.results[0].displayFields?.map((value) => value.fieldKey)).toEqual(["rating", "@record.written_at", "@record.captured_at", "@record.updated_at", "@record.type"]);
    expect(page.results[0].displayFields?.[0]).toMatchObject({ state: "value", values: [{ propertyId, value: 4.5, renderer: "rating", unit: null, lockedByUser: true }] });
    expect(page.results[0].displayFields?.[1]).toMatchObject({ state: "missing", values: [] });
    expect(page.results[0].displayFields?.[2]).toMatchObject({ state: "value", values: [{ propertyId: null, value: now, renderer: "date" }] });
    expect(page.results[0].displayFields?.[4]).toMatchObject({ state: "missing", values: [] });
  });

  test.each([30, 32])("supports dynamic typed fields on schema %s without inventing canonical units", async (version) => {
    const db = database(version), record = await capture(db);
    const definitions = [
      { key: "distance", type: "measurement", kind: "number", value: 5, unit: null, canonical: "km" },
      { key: "weight", type: "measurement", kind: "number", value: 20, unit: "lb", canonical: "kg" },
      { key: "finished", type: "boolean", kind: "boolean", value: false, unit: null, canonical: null },
      { key: "visited", type: "date", kind: "date", value: "2026-09-10", unit: null, canonical: null },
      { key: "details", type: "structured_json", kind: "json", value: { prompt: "<script>not executable</script>", flags: [1, 2] }, unit: null, canonical: null },
      { key: "zero", type: "decimal", kind: "number", value: 0, unit: null, canonical: null },
      { key: "empty", type: "short_text", kind: "text", value: "", unit: null, canonical: null },
      { key: "explicit_null", type: "short_text", kind: "text", value: null, unit: null, canonical: null },
    ];
    for (const item of definitions) property(db, record.objectId, field(db, item.key, item.type, owner, item.canonical), item.value, { kind: item.kind, unit: item.unit });
    const result = (await new D1RetrievalRepository(db, owner).searchPage(query(), false, 1, definitions.map((item) => item.key))).results[0];
    expect(result.displayFields?.every((item) => item.state === "value")).toBe(true);
    expect(result.displayFields?.map((item) => item.values[0].unit)).toEqual([null, "lb", null, null, null, null, null, null]);
    expect(result.displayFields?.map((item) => item.values[0].value)).toEqual([5, 20, false, "2026-09-10", JSON.stringify(definitions[4].value), 0, "", null]);
  });

  test("excludes every nonaccepted or superseded value, foreign properties and foreign registry labels", async () => {
    const db = database(), record = await capture(db), statusField = field(db, "status");
    for (const review of ["proposed", "disputed", "rejected", "superseded"]) property(db, record.objectId, statusField, `hidden-${review}`, { review });
    property(db, record.objectId, statusField, "old", { supersededAt: now });
    const foreign = field(db, "foreign", "short_text", "other-owner"), foreignValue = field(db, "foreign_value");
    property(db, record.objectId, foreign, "foreign definition");
    property(db, record.objectId, foreignValue, "foreign owner", { userId: "other-owner" });
    const result = (await new D1RetrievalRepository(db, owner).searchPage(query(), false, 1, ["status", "foreign", "foreign_value", "unknown"])).results[0];
    expect(result.displayFields?.every((item) => item.state === "missing" && item.values.length === 0)).toBe(true);
    expect(result.displayFields?.find((item) => item.fieldKey === "foreign")?.label).toBe("foreign");
    expect(JSON.stringify(result.displayFields)).not.toContain("hidden-");
    expect((await new D1RetrievalRepository(db, "other-owner").searchPage(query(), false, 1, ["status"])).results).toEqual([]);
    db.sql.prepare("update v2_capture_bundles set draft_id='legacy:orphan' where id=?").run(record.captureId);
    expect((await new D1RetrievalRepository(db, owner).searchPage(query(), false, 1, ["status"])).results).toEqual([]);
  });

  test("preserves locked precedence and tied duplicate conflict in an explicitly damaged legacy index fixture", async () => {
    const db = database(), record = await capture(db), id = field(db, "rating", "rating");
    const first = property(db, record.objectId, id, 2, { kind: "rating" });
    expect(() => property(db, record.objectId, id, 4, { kind: "rating" })).toThrow(/UNIQUE/);
    // Normal schema prevents duplicate current accepted values. Remove only the
    // named index to model legacy/corrupt storage; do not weaken product schema.
    db.sql.exec("drop index uq_v2_property_current_accepted");
    const locked = property(db, record.objectId, id, 4, { kind: "rating", locked: 1, sourceClass: "user_locked" });
    const repo = new D1RetrievalRepository(db, owner);
    expect((await repo.searchPage(query(), false, 1, ["rating"])).results[0].displayFields?.[0])
      .toMatchObject({ state: "value", values: [{ propertyId: locked, value: 4, lockedByUser: true }] });
    const duplicate = property(db, record.objectId, id, 4, { kind: "rating", locked: 1 });
    const result = (await repo.searchPage(query(), false, 1, ["rating"])).results[0].displayFields![0];
    expect(result.state).toBe("conflict"); expect(result.values.map((item) => item.propertyId).sort()).toEqual([locked, duplicate].sort());
    expect(result.values.map((item) => item.propertyId)).not.toContain(first);
    db.sql.prepare("update v2_property_values set value_json='invalid json' where id=?").run(duplicate);
    expect((await repo.searchPage(query(), false, 1, ["rating"])).results[0].displayFields?.[0].state).toBe("conflict");
  });

  test("shows accepted primary classification with user lock precedence and explicit tied classifications", async () => {
    const db = database(), record = await capture(db), repo = new D1RetrievalRepository(db, owner);
    type(db, record.objectId, "proposal", { review: "proposed" });
    expect((await repo.searchPage(query(), false, 1, ["@record.type"])).results[0].displayFields?.[0].state).toBe("missing");
    type(db, record.objectId, "primary", { source: "ai" }); type(db, record.objectId, "secondary", { role: "secondary" });
    expect((await repo.searchPage(query(), false, 1, ["@record.type"])).results[0].displayFields?.[0])
      .toMatchObject({ state: "value", values: [{ propertyId: null, value: "primary 분류", sourceLabel: "AI 분류" }] });
    type(db, record.objectId, "locked", { role: "secondary", locked: 1 });
    expect((await repo.searchPage(query(), false, 1, ["@record.type"])).results[0].displayFields?.[0])
      .toMatchObject({ state: "value", values: [{ value: "locked 분류", sourceLabel: "사용자가 분류", lockedByUser: true }] });
    type(db, record.objectId, "also_locked", { role: "secondary", locked: 1 });
    expect((await repo.searchPage(query(), false, 1, ["@record.type"])).results[0].displayFields?.[0]).toMatchObject({ state: "conflict", values: expect.any(Array) });
    expect((await repo.searchPage(query(), false, 1, ["@record.type"])).results[0].displayFields?.[0].values).toHaveLength(2);
  });

  test.each(["sensitive", "restricted"] as const)("hides selected field presence and values on %s records", async (privacy) => {
    const db = database(), record = await capture(db, privacy), id = field(db, "present"); property(db, record.objectId, id, "SECRET PROPERTY");
    const result = (await new D1RetrievalRepository(db, owner).searchPage(query(), true, 1, ["present", "absent", "@record.captured_at", "@record.written_at", "@record.type"])).results[0];
    expect(result.title).toBe("visible title"); expect(result.displayFields).toHaveLength(5);
    expect(result.displayFields?.every((item) => item.state === "private" && item.values.length === 0)).toBe(true);
    expect(JSON.stringify(result.displayFields)).not.toContain("SECRET PROPERTY");
  });

  test.each([
    ["sensitive", "update v2_documents set privacy_level='sensitive' where object_id=?"],
    ["restricted", "update v2_documents set privacy_level='restricted' where object_id=?"],
    ["foreign", "update v2_objects set user_id='other-owner' where id=?"],
    ["deleted", "update v2_objects set lifecycle_status='deleted' where id=?"],
  ] as const)("binds fields to the final same SQL snapshot when a record becomes %s", async (label, mutation) => {
    const db = database(), record = await capture(db); property(db, record.objectId, field(db, "rating"), "SECRET PROPERTY");
    const observed = observeFinal(db, () => db.sql.prepare(mutation).run(record.objectId));
    const result = await new D1RetrievalRepository(observed.binding, owner).searchPage(query(), false, 1, ["rating"]);
    expect(observed.count()).toBe(1); expect(JSON.stringify(result)).not.toContain("SECRET PROPERTY");
    if (label === "sensitive") expect(result.results[0].displayFields?.[0]).toMatchObject({ state: "private", values: [] });
    else expect(result.results).toEqual([]);
  });

  test("keeps fifty-record pagination without per-record field queries and captures mutable selection before await", async () => {
    const db = database(), id = field(db, "rating");
    for (let index = 0; index < 53; index++) { const record = await capture(db, "normal", `record ${index}`); property(db, record.objectId, id, String(index)); }
    const fields = ["rating"], observed = observeFinal(db, (sql) => { fields[0] = "unknown"; expect(new TextEncoder().encode(sql).length).toBeLessThanOrEqual(100_000); });
    const repo = new D1RetrievalRepository(observed.binding, owner), first = await repo.searchPage(query(), false, 1, fields);
    const second = await repo.searchPage(query(), false, 2, ["rating"]);
    expect(observed.count()).toBe(2); expect(first.totalCount).toBe(53); expect(first.results).toHaveLength(50); expect(second.results).toHaveLength(3);
    expect([...first.results, ...second.results].every((item) => item.displayFields?.[0].fieldKey === "rating" && item.displayFields[0].state === "value")).toBe(true);
    expect((await repo.searchPage(query())).results[0].displayFields).toBeUndefined();
  });

  test("captures at most eight own data keys without running getters or silently changing order", () => {
    const input = ["rating", "type", "rating"], captured = captureSavedViewVisibleFields(input); input[0] = "unknown";
    expect(captured).toEqual(["rating", "type"]); expect(Object.isFrozen(captured)).toBe(true);
    let invoked = 0; const accessor = ["rating"]; Object.defineProperty(accessor, "0", { get() { invoked++; return "type"; } });
    expect(() => captureSavedViewVisibleFields(accessor)).toThrow(); expect(invoked).toBe(0);
    expect(captureSavedViewVisibleFields(["type", "@record.type"])).toEqual(["type", "@record.type"]);
    for (const invalid of [new Array(1), Array(9).fill("rating"), ["rating;drop"], ["UPPER"], ["@record.rating"], ["@Record.type"], Object.assign(["rating"], { unexpected: "value" }), null])
      expect(() => captureSavedViewVisibleFields(invalid)).toThrow();
  });

  test("formats plain preserved values without inventing a rating scale or a canonical unit", () => {
    const row: SavedViewFieldValueRow = { propertyId: "p", valueKind: "rating", valueJson: "4", unit: null, sourceClass: "user_explicit", lockedByUser: 1 };
    const value = presentSavedViewFields([{ fieldKey: "rating", label: "평점", values: [row] }], "normal")[0].values[0];
    expect(formatSavedViewFieldValue(value)).toBe("4 (척도 미기록)");
    expect(formatSavedViewFieldValue({ ...value, renderer: "number", value: 10, unit: "lb" })).toBe("10 lb");
    expect(formatSavedViewFieldValue({ ...value, renderer: "boolean", value: false })).toBe("아니요");
    expect(formatSavedViewFieldValue({ ...value, renderer: "text", value: null })).toBe("값 없음");
    expect(formatSavedViewFieldValue({ ...value, renderer: "json", value: '{"html":"<script>"}' })).toBe('{"html":"<script>"}');
    expect(presentSavedViewFields([{ fieldKey: "rating", label: "평점", values: [{ ...row, valueJson: "true" }] }], "normal")[0]).toMatchObject({ state: "conflict", values: [] });
  });
});
