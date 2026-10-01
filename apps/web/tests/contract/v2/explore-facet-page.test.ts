import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/explore-facets/route";
import { validateAnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { readFacetPage } from "@/lib/v2/infrastructure/d1/facet-page-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { captureFacetRequest, parseFacetRequest, validateFacetPage, type FacetKind, type FacetPage } from "@/lib/v2/retrieval/facet-page";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner", origin = "https://lighthouse.test", now = "2026-09-22T00:00:00.000Z";
type RecordSeed = { objectId: string; captureId: string; revisionId: string };
let db: LinkSqlite;
function query(kind: FacetKind = "type", extra: Record<string, string> = {}) { return parseFacetRequest(new URLSearchParams({ kind, ...extra })); }
const item = { key: "review", label: "리뷰", count: 1, entityKind: null };
function validBody(): FacetPage { return { contract: "facet-page.v1", kind: "type", query: "", page: 1, pageSize: 20, totalCount: 1, totalPages: 1, items: [{ ...item }], selected: null }; }

describe("explore facet strict transport contract", () => {
  test("normalizes only documented defaults and trims literal Unicode query", () => {
    expect(query()).toEqual({ kind: "type", query: "", page: 1, selectedKey: null });
    const result = query("type", { q: "  가👀_%  ", page: "9007199254740991", selected: "old_review" });
    expect(result).toEqual({ kind: "type", query: "가👀_%", page: Number.MAX_SAFE_INTEGER, selectedKey: "old_review" }); expect(Object.isFrozen(result)).toBe(true);
  });

  test.each(["", "kind=unknown", "kind=TYPE", "kind=type&kind=type", "kind=type&unknown=x", "kind=type&q=a&q=b", "kind=type&page=1&page=1", "kind=type&selected=x&selected=x",
    "kind=type&page=0", "kind=type&page=-1", "kind=type&page=01", "kind=type&page=1.0", "kind=type&page=1e2", "kind=type&page=9007199254740992", "kind=type&page=Infinity",
    "kind=entity&selected=review", "kind=month&selected=review", "kind=type&selected=Upper", "kind=type&selected=%40record.type", "kind=type&selected=", "kind=type&q=%00",
    `kind=type&q=${"a".repeat(101)}`, `kind=type&selected=${"a".repeat(101)}`])("rejects invalid or duplicate request %s", (raw) => {
    expect(() => parseFacetRequest(new URLSearchParams(raw))).toThrow();
  });

  test("returns an immutable independent response including item objects", () => {
    const body = validBody(), validated = validateFacetPage(body, query());
    expect(validated).toEqual(body); expect(Object.isFrozen(validated)).toBe(true); expect(Object.isFrozen(validated.items)).toBe(true); expect(Object.isFrozen(validated.items[0])).toBe(true);
    (body.items[0] as { label: string }).label = "tampered afterwards"; expect(validated.items[0].label).toBe("리뷰");
  });

  test.each([
    ["unknown top field", (body: Record<string, unknown>) => { body.extra = true; }],
    ["wrong contract", (body: Record<string, unknown>) => { body.contract = "wrong"; }],
    ["wrong kind", (body: Record<string, unknown>) => { body.kind = "entity"; }],
    ["wrong query", (body: Record<string, unknown>) => { body.query = "other"; }],
    ["wrong page", (body: Record<string, unknown>) => { body.page = 2; }],
    ["wrong page size", (body: Record<string, unknown>) => { body.pageSize = 50; }],
    ["negative total", (body: Record<string, unknown>) => { body.totalCount = -1; }],
    ["unsafe total", (body: Record<string, unknown>) => { body.totalCount = Number.MAX_SAFE_INTEGER + 1; }],
    ["wrong total pages", (body: Record<string, unknown>) => { body.totalPages = 2; }],
    ["missing items", (body: Record<string, unknown>) => { body.items = []; }],
    ["duplicate items", (body: Record<string, unknown>) => { body.totalCount = 2; body.items = [{ ...item }, { ...item }]; }],
    ["unknown item field", (body: Record<string, unknown>) => { body.items = [{ ...item, extra: 1 }]; }],
    ["zero item count", (body: Record<string, unknown>) => { body.items = [{ ...item, count: 0 }]; }],
    ["noninteger item count", (body: Record<string, unknown>) => { body.items = [{ ...item, count: 1.5 }]; }],
    ["invalid type key", (body: Record<string, unknown>) => { body.items = [{ ...item, key: "Not-a-key" }]; }],
    ["nonentity has kind", (body: Record<string, unknown>) => { body.items = [{ ...item, entityKind: "person" }]; }],
    ["unsolicited selection", (body: Record<string, unknown>) => { body.selected = { ...item }; }],
  ] as const)("rejects %s response", (_label, mutate) => {
    const body = validBody() as unknown as Record<string, unknown>; mutate(body); expect(() => validateFacetPage(body, query())).toThrow();
  });

  test("preserves existing nonempty metadata labels without applying new query Unicode restrictions", () => {
    const body = { ...validBody(), items: [{ ...item, label: "\ud800" }], selected: { ...item, label: "\ud800" } };
    const result = validateFacetPage(body, query("type", { selected: "review" }));
    expect(result.items[0].label).toBe("\ud800"); expect(result.selected?.label).toBe("\ud800");
  });

  test("checks clamped pages and selected identity independently of search results", () => {
    const requested = query("type", { page: "9007199254740991", selected: "review", q: "not-found" });
    const body: FacetPage = { ...validBody(), query: "not-found", totalCount: 0, items: [], selected: { ...item } };
    expect(validateFacetPage(body, requested)).toEqual(body);
    expect(() => validateFacetPage({ ...body, selected: { ...item, key: "wrong" } }, requested)).toThrow();
    expect(validateFacetPage({ ...body, selected: null }, requested).selected).toBeNull();
  });

  test.each([null, { ...item, label: "Different label" }, { ...item, count: 2 }])("rejects selected metadata inconsistent with the same item on this page", (selected) => {
    expect(() => validateFacetPage({ ...validBody(), selected }, query("type", { selected: "review" }))).toThrow();
  });

  test.each(["type", "entity", "month"] as const)("rejects out-of-order %s items instead of hiding a server ordering change", (kind) => {
    const items = kind === "month" ? [{ key: "2020-01", label: "2020-01", count: 1, entityKind: null }, { key: "2020-02", label: "2020-02", count: 1, entityKind: null }]
      : [{ key: "one", label: "One", count: 1, entityKind: kind === "entity" ? "person" : null }, { key: "two", label: "Two", count: 2, entityKind: kind === "entity" ? "person" : null }];
    expect(() => validateFacetPage({ ...validBody(), kind, totalCount: 2, items }, query(kind))).toThrow();
  });

  test.each(["2020-00", "2020-13", "20-01", "2020-1"])("rejects unrenderable month response key %s", (key) => {
    expect(() => validateFacetPage({ ...validBody(), kind: "month", items: [{ ...item, key, label: key }] }, query("month"))).toThrow();
  });

  test.each(["\ud800", "\udfff", "bad\u0000query"])("rejects invalid primitive query before a repository await", (value) => {
    expect(() => captureFacetRequest({ ...query(), query: value })).toThrow();
  });
});

async function record({ privacy = "normal", capturedAt = now, userId = owner }: { privacy?: "normal" | "sensitive" | "restricted"; capturedAt?: string; userId?: string } = {}): Promise<RecordSeed> {
  const prepared = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Facet fixture", bodyMarkdown: "PRIVATE ORIGINAL NOT CATALOG DATA",
    aiEnabled: false, privacyLevel: privacy, capturedAt, clientTimezone: "Asia/Seoul" }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, userId).commitCapture(prepared); return prepared;
}
function type(recordId: string, key: string, { label = key, review = "accepted", status = "active", userId = owner }: { label?: string; review?: string; status?: string; userId?: string } = {}) {
  const id = crypto.randomUUID(), assignmentId = crypto.randomUUID();
  db.sql.prepare(`insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
    values(?,?,?,?,'document',?,'user_created','Independent facet fixture',?,?)`).run(id, userId, key, label, status, now, now);
  db.sql.prepare(`insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
    values(?,?,?,?,'primary','user',?,0,?,?)`).run(assignmentId, userId, recordId, id, review, now, now);
  return { id, assignmentId, key, label };
}
function entity(recordId: string, { key = crypto.randomUUID(), name = key, kind = "person", review = "accepted", superseded = null, userId = owner }: {
  key?: string; name?: string; kind?: string; review?: string; superseded?: string | null; userId?: string;
} = {}) {
  const predicateId = crypto.randomUUID(), edgeId = crypto.randomUUID();
  db.sql.prepare("insert into v2_objects(id,user_id,object_kind,lifecycle_status,created_at,updated_at) values(?,?,'entity','active',?,?)").run(key, userId, now, now);
  db.sql.prepare("insert into v2_entity_records(object_id,entity_kind,canonical_name,resolution_status,created_at) values(?,?,?,'resolved',?)").run(key, kind, name, now);
  db.sql.prepare("insert into v2_predicate_definitions(id,user_id,key,label,definition,status,origin,created_at,updated_at) values(?,?,?,'related','related','active','user_created',?,?)")
    .run(predicateId, userId, `related_${predicateId.replaceAll("-", "")}`, now, now);
  db.sql.prepare(`insert into v2_relation_edges(id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,created_at,superseded_at)
    values(?,?,?,?,?,'user_explicit','low',?,?,?)`).run(edgeId, userId, recordId, predicateId, key, review, now, superseded);
  return { key, edgeId, predicateId, name, kind };
}
function legacy(objectId: string, status: string) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_legacy_source_envelopes(id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
    values(?,?,'legacy_notes',?,'{}',?,?,'[]','[]','facet-fixture')`).run(id, owner, id, id, now);
  db.sql.prepare(`insert into v2_legacy_source_mappings(id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,projected_object_id,projection_kind,status,created_at)
    values(?,?,?,'legacy_notes',?,'facet-v1',?,'document',?,?)`).run(crypto.randomUUID(), owner, id, id, objectId, status, now);
}
function request(kind: FacetKind = "type", extra: Record<string, string> = {}) { return GET(new Request(`${origin}/api/v2/explore-facets?${new URLSearchParams({ kind, ...extra })}`)); }
async function page(response: Response): Promise<FacetPage> {
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); return response.json() as Promise<FacetPage>;
}
async function rejected(response: Response, status: number) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json(); expect(body).toMatchObject({ error: expect.any(Object) }); expect(JSON.stringify(body)).not.toContain("PRIVATE ORIGINAL NOT CATALOG DATA");
}
type SqlEvent = { sql: string; method: "first" | "all" | "run" };
function observe(hooks: { before?: (event: SqlEvent) => void; after?: (event: SqlEvent, value: unknown) => void } = {}) {
  const events: SqlEvent[] = [], results: unknown[] = [];
  const binding: D1DatabaseBinding = { prepare(sql) {
    const actual = db.prepare(sql), before = (method: SqlEvent["method"]) => { const event = { sql, method }; events.push(event); hooks.before?.(event); return event; };
    const statement: D1PreparedStatementBinding = { bind(...values) { actual.bind(...values); return statement; },
      async first<T>() { const event = before("first"), result = await actual.first<T>(); results.push(result); hooks.after?.(event, result); return result; },
      async all<T>() { const event = before("all"), result = await actual.all<T>(); results.push(result); hooks.after?.(event, result); return result; },
      async run() { const event = before("run"), result = await actual.run(); results.push(result); hooks.after?.(event, result); return result; },
    }; return statement;
  }, batch: db.batch.bind(db) };
  harness.bindings.mockReturnValue({ db: binding }); return { binding, events, results };
}
function snapshot(event: SqlEvent) { return !event.sql.includes("sqlite_master"); }

describe("explore facet page real route and Node SQLite boundary", () => {
  beforeEach(() => {
    db = new LinkSqlite(32); vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "0");
    harness.session.mockResolvedValue({ sessionId: "facet-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
    harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
  });
  afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

  test("reads all 57 types across bounded pages and keeps exact selected metadata beyond both page and q", async () => {
    const source = await record();
    for (let index = 0; index < 57; index++) type(source.objectId, `type_${String(index).padStart(3, "0")}`);
    const all = [];
    for (let current = 1; current <= 3; current++) {
      const result = await page(await request("type", { page: String(current), selected: "type_056" }));
      expect(result).toMatchObject({ page: current, pageSize: 20, totalCount: 57, totalPages: 3, selected: { key: "type_056", count: 1 } });
      expect(result.items).toHaveLength(current === 3 ? 17 : 20); all.push(...result.items.map((item) => item.key));
    }
    expect(new Set(all).size).toBe(57); expect(all).toEqual([...all].sort());
    const queried = await page(await request("type", { q: "type_000", selected: "type_056" }));
    expect(queried.items.map((item) => item.key)).toEqual(["type_000"]); expect(queried.selected?.key).toBe("type_056"); expect(queried.totalCount).toBe(1);
    expect((await page(await request("type", { q: "nothing", selected: "missing" }))).selected).toBeNull();
  });

  test("reads all 65 entities beyond the old sixty cutoff and ties by stable object key", async () => {
    const source = await record();
    for (let index = 0; index < 65; index++) entity(source.objectId, { key: `entity-${String(index).padStart(3, "0")}`, name: "Same name" });
    const keys = [];
    for (let current = 1; current <= 4; current++) {
      const result = await page(await request("entity", { page: String(current) })); expect(result.totalCount).toBe(65); expect(result.pageSize).toBe(20);
      expect(result.items.length).toBeLessThanOrEqual(20); expect(result.items.every((item) => item.entityKind === "person")).toBe(true); keys.push(...result.items.map((item) => item.key));
    }
    expect(new Set(keys).size).toBe(65); expect(keys).toEqual([...keys].sort());
  });

  test("reads all 41 months beyond the old thirty-six cutoff and clamps huge page before offset multiplication", async () => {
    const months: string[] = [];
    for (let index = 0; index < 41; index++) { const month = `${2020 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`; months.push(month); await record({ capturedAt: `${month}-10T01:00:00.000Z` }); }
    const all = [];
    for (let current = 1; current <= 3; current++) { const result = await page(await request("month", { page: String(current) })); expect(result.totalCount).toBe(41); all.push(...result.items.map((item) => item.key)); }
    expect(all).toEqual([...months].sort().reverse());
    const end = await page(await request("month", { page: String(Number.MAX_SAFE_INTEGER) })); expect(end.page).toBe(3); expect(end.items).toHaveLength(1);
    expect(end.items[0].key).toBe("2020-01");
  });

  test.each(["type", "entity", "month"] as const)("clamps empty %s pages to one without manufacturing buckets", async (kind) => {
    const result = await page(await request(kind, { page: String(Number.MAX_SAFE_INTEGER) }));
    expect(result).toMatchObject({ kind, page: 1, totalCount: 0, totalPages: 1, items: [], selected: null });
  });

  test("preserves proposed type assignments and existing sensitive counts but excludes rejected/superseded/inactive/private buckets", async () => {
    const normal = await record(), sensitive = await record({ privacy: "sensitive" }), restricted = await record({ privacy: "restricted" });
    type(normal.objectId, "accepted"); type(normal.objectId, "proposal", { review: "proposed", status: "observed" });
    type(normal.objectId, "rejected", { review: "rejected" }); type(normal.objectId, "superseded", { review: "superseded" });
    type(normal.objectId, "candidate", { status: "candidate" }); type(normal.objectId, "archived", { status: "archived" });
    type(sensitive.objectId, "sensitive"); type(restricted.objectId, "restricted");
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const result = await page(await request("type", { selected: "restricted" }));
    expect(result.items.map((item) => item.key).sort()).toEqual(["accepted", "proposal", "sensitive"]); expect(result.selected).toBeNull();
    expect((await page(await request("month"))).items[0].count).toBe(2);
  });

  test("entity facets only include normal accepted current edges and count distinct documents", async () => {
    const normal = await record(), sensitive = await record({ privacy: "sensitive" }), restricted = await record({ privacy: "restricted" });
    const accepted = entity(normal.objectId, { name: "Accepted" });
    db.sql.prepare(`insert into v2_relation_edges(id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,created_at)
      values(?,?,?,?,?,'user_explicit','low','accepted',?)`).run(crypto.randomUUID(), owner, normal.objectId, accepted.predicateId, accepted.key, now);
    for (const review of ["proposed", "disputed", "rejected", "superseded"]) entity(normal.objectId, { review });
    entity(normal.objectId, { superseded: now }); entity(sensitive.objectId); entity(restricted.objectId);
    const result = await page(await request("entity")); expect(result.items).toEqual([{ key: accepted.key, label: "Accepted", entityKind: "person", count: 1 }]);
  });

  test("searches type key/label and entity name using literal percent/underscore/quote instead of LIKE patterns", async () => {
    const source = await record(); type(source.objectId, "literal", { label: "MiXeD %_ '👀" }); type(source.objectId, "other", { label: "Mixed anything" });
    entity(source.objectId, { name: "%_ '👀" }); entity(source.objectId, { name: "not literal" });
    for (const kind of ["type", "entity"] as const) {
      const result = await page(await request(kind, { q: "%_ '👀" })); expect(result.items).toHaveLength(1); expect(result.items[0].label).toContain("%_ '👀");
      expect(JSON.stringify(result)).not.toContain("PRIVATE ORIGINAL NOT CATALOG DATA");
    }
    expect((await page(await request("type", { q: "mixed" }))).items).toHaveLength(2);
    expect((await page(await request("type", { q: "literal" }))).items[0].key).toBe("literal");
    expect((await page(await request("type", { q: "%' OR 1=1 --" }))).totalCount).toBe(0);
  });

  test.each([
    ["type", "First\nSecond"], ["type", "First\tSecond"], ["type", "First\r\nSecond"],
    ["entity", "First\nSecond"], ["entity", "First\tSecond"], ["entity", "First\r\nSecond"],
  ] as const)("keeps existing analysis-permitted %s display metadata %j readable", async (kind, label) => {
    // Current writing schema permits internal line breaks/tabs and the reconciler
    // binds these exact labels/mentions. They are text data, not query syntax.
    const accepted = validateAnalysisEnvelopeV1({ contract_version: "analysis-v1", capture_id: "capture", analyzed_revision_id: "revision", language: "ko", bundle_summary: "",
      document_proposals: [{ temp_id: "document", source_item_ids: [], suggested_title: null, type_assignments: [{ type_key: "review", label, registry_action: "reuse", evidence_refs: [] }] }],
      entity_proposals: [{ temp_id: "entity", entity_kind: "person", mention: label, resolution_status: "local_candidate", evidence_refs: [] }],
      event_proposals: [], field_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
    }, { captureId: "capture", revisionId: "revision", sourceLengths: new Map() });
    expect(accepted.document_proposals[0].type_assignments[0].label).toBe(label); expect(accepted.entity_proposals[0].mention).toBe(label);
    const source = await record();
    if (kind === "type") type(source.objectId, "review", { label }); else entity(source.objectId, { name: label });
    const result = await page(await request(kind, kind === "type" ? { selected: "review" } : {}));
    expect(result.items).toHaveLength(1); expect(result.items[0].label).toBe(label); if (kind === "type") expect(result.selected?.label).toBe(label);
  });

  test("excludes foreign owner, archived objects and unprojected legacy mappings from both selected and buckets", async () => {
    const foreign = await record({ userId: "other-owner" }); type(foreign.objectId, "foreign", { userId: "other-owner" });
    const deleted = await record(); type(deleted.objectId, "deleted"); db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(deleted.objectId);
    const unprojected = await record(); type(unprojected.objectId, "unprojected"); legacy(unprojected.objectId, "quarantined");
    const orphan = await record(); type(orphan.objectId, "orphan"); db.sql.prepare("update v2_capture_bundles set draft_id='legacy:orphan' where id=?").run(orphan.captureId);
    const projected = await record(); type(projected.objectId, "projected"); legacy(projected.objectId, "projected");
    for (const selected of ["foreign", "deleted", "unprojected", "orphan"]) {
      const result = await page(await request("type", { selected })); expect(result.items.map((item) => item.key)).toEqual(["projected"]); expect(result.selected).toBeNull();
    }
    expect((await page(await request("month"))).items[0].count).toBe(1);
  });

  test.each(["subject-owner", "entity-owner", "edge-owner", "entity-deleted", "subject-legacy", "entity-legacy"])("closes entity bucket when %s changes", async (change) => {
    const source = await record(), target = entity(source.objectId);
    if (change === "subject-owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(source.objectId);
    if (change === "entity-owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(target.key);
    if (change === "edge-owner") db.sql.prepare("update v2_relation_edges set user_id='other-owner' where id=?").run(target.edgeId);
    if (change === "entity-deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(target.key);
    if (change === "subject-legacy") legacy(source.objectId, "quarantined");
    if (change === "entity-legacy") legacy(target.key, "quarantined");
    expect((await page(await request("entity"))).totalCount).toBe(0);
  });

  test.each(["type", "entity", "month"] as const)("uses one final %s snapshot for count/items/selection after privacy changes", async (kind) => {
    const source = await record(); type(source.objectId, "review"); entity(source.objectId);
    const observed = observe({ before(event) { if (snapshot(event)) db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(source.objectId); } });
    const result = await page(await request(kind, kind === "type" ? { selected: "review" } : {}));
    expect(result).toMatchObject({ totalCount: 0, items: [], selected: null }); expect(observed.events.filter(snapshot)).toHaveLength(1);
  });

  test.each(["type", "entity", "month"] as const)("retains the existing %s privacy policy when normal changes to sensitive at final SQL", async (kind) => {
    const source = await record(); type(source.objectId, "review"); entity(source.objectId);
    observe({ before(event) { if (snapshot(event)) db.sql.prepare("update v2_documents set privacy_level='sensitive' where object_id=?").run(source.objectId); } });
    const result = await page(await request(kind, kind === "type" ? { selected: "review" } : {}));
    expect(result.totalCount).toBe(kind === "entity" ? 0 : 1);
    if (kind === "type") expect(result.selected?.key).toBe("review");
  });

  test("excludes malformed stored month prefixes without removing their records or other valid buckets", async () => {
    const valid = await record({ capturedAt: "2020-01-10T01:00:00.000Z" }), broken = await record();
    for (const invalid of ["not-a-date", "2020-13-01", "2020-00-01", "2020-1"]) {
      db.sql.prepare("update v2_capture_bundles set captured_at=? where id=?").run(invalid, broken.captureId);
      const result = await page(await request("month")); expect(result.items).toEqual([{ key: "2020-01", label: "2020-01", count: 1, entityKind: null }]);
      expect(db.sql.prepare("select count(*) as n from v2_objects where id in (?,?)").get(valid.objectId, broken.objectId)!.n).toBe(2);
    }
  });

  test("keeps count/items/selected from the same completed snapshot and captures mutable request before schema await", async () => {
    const source = await record(); type(source.objectId, "review");
    const input = { ...query("type", { selected: "review" }) };
    const observed = observe({ before(event) { if (event.sql.includes("sqlite_master")) Object.assign(input, { kind: "entity", query: "other", page: 999, selectedKey: null }); },
      after(event) { if (snapshot(event)) db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(source.objectId); } });
    const result = await readFacetPage(observed.binding, owner, input);
    expect(result).toMatchObject({ kind: "type", query: "", totalCount: 1, selected: { key: "review", count: 1 }, items: [{ key: "review", count: 1 }] });
    expect(observed.events.filter(snapshot)).toHaveLength(1); expect(snapshot(observed.events.at(-1)!)).toBe(true);
    expect((await page(await request("type", { selected: "review" }))).selected).toBeNull();
  });

  test("does not write during read and rejects missing auth/route/error without leaking private content", async () => {
    const source = await record(); type(source.objectId, "review"); const before = db.sql.prepare("select total_changes() as n").get()!.n;
    await page(await request()); expect(db.sql.prepare("select total_changes() as n").get()!.n).toBe(before);
    harness.session.mockResolvedValue(null); await rejected(await request(), 401);
    vi.stubEnv("FLAG_V2_ROUTES", "0"); await rejected(await request(), 404); vi.stubEnv("FLAG_V2_ROUTES", "1");
    harness.session.mockResolvedValue({ sessionId: "facet-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
    observe({ before(event) { if (snapshot(event)) throw new Error("PRIVATE ORIGINAL NOT CATALOG DATA"); } }); await rejected(await request(), 500);
  });

  test.each(["kind=unknown", "kind=type&kind=type", "kind=type&q=a&q=b", "kind=type&page=0", "kind=month&selected=review", "kind=type&extra=1"])("rejects invalid HTTP query %s without value SQL", async (raw) => {
    const observed = observe(); await rejected(await GET(new Request(`${origin}/api/v2/explore-facets?${raw}`)), 400); expect(observed.events).toHaveLength(0);
  });
});
