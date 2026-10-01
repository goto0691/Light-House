import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn(), gateways: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("@/lib/v2/ai/gemini-role-gateways", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/v2/ai/gemini-role-gateways")>(), createGeminiRoleGateways: harness.gateways,
}));

import { POST as interpret } from "@/app/api/v2/search/interpret/route";
import { GET as searchGET } from "@/app/api/v2/search/route";
import { V2ModelError, type V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { GeminiProviderError } from "@/lib/v2/ai/gemini-role-gateways";
import { prepareCaptureCommit, type CapturePrivacyLevel } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { NaturalQueryDraftV1 } from "@/lib/v2/retrieval/natural-query-v1";
import { naturalSearchHref, NATURAL_QUERY_INTERPRETATION_CONTRACT } from "@/lib/v2/retrieval/plan-presentation";
import type { V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import { LinkSqlite } from "../../support/link-sqlite";

type SQLValue = string | number | null;
const owner = "link-owner", other = "other-owner", now = "2026-09-20T09:00:00.000Z";
const question = "작년에 별점 4점 이상 준 젤다 게임 리뷰";
const secrets = ["PRIVATE TITLE", "PRIVATE BODY", "모모식당", "잠긴 제목", "RESTRICTED BODY", "secret_diary", "비밀 일기", "secret_score", "비밀장소", "secret_place",
  "visit_count", "companion_note", "other_type", "타인 분류", "other_field", "other_kind", "rejected_type"];
let db: LinkSqlite;
let ids: Record<"normal" | "restricted" | "risky" | "sensitive" | "foreign", string>;

function exec(query: string, ...values: SQLValue[]) { db.sql.prepare(query).run(...values); }
async function capture(userId: string, title: string, body: string, privacyLevel: CapturePrivacyLevel) {
  const prepared = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: body, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: "2025-06-10T09:00:00.000Z" }, crypto.randomUUID(), "2025-06-10T09:00:01.000Z");
  await new D1SourceFoundationRepository(db, userId).commitCapture(prepared);
  return prepared.objectId;
}
function type(userId: string, objectId: string, key: string, label: string, reviewStatus = "accepted") {
  const typeId = `type:${userId}:${key}`;
  exec(`insert or ignore into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
    values (?,?,?,?,'document','active','user_created','synthetic',?,?)`, typeId, userId, key, label, now, now);
  exec(`insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,created_at,updated_at)
    values (?,?,?,?,'primary','user',?,?,?)`, crypto.randomUUID(), userId, objectId, typeId, reviewStatus, now, now);
}
function property(userId: string, objectId: string, key: string, label: string, dataType: string, value: number | string, claimRisk = "low") {
  const fieldId = `field:${userId}:${key}`, numeric = typeof value === "number";
  exec(`insert or ignore into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
    values (?,?,?,?,'synthetic',?,'active','user_created',?,?)`, fieldId, userId, key, label, dataType, now, now);
  exec(`insert into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_number,value_json,source_class,claim_risk,review_status,created_at)
    values (?,?,?,?,?,?,?,?,'user_explicit',?,'accepted',?)`, crypto.randomUUID(), userId, objectId, fieldId, numeric ? (dataType === "rating" ? "rating" : "number") : "text",
  numeric ? null : value, numeric ? value : null, JSON.stringify(value), claimRisk, now);
}
function entity(userId: string, subjectId: string, kind: string, name: string) {
  const entityId = crypto.randomUUID(), predicateId = `predicate:${userId}:mentions`;
  exec("insert into v2_objects (id,user_id,object_kind,created_at,updated_at) values (?,?,'entity',?,?)", entityId, userId, now, now);
  exec("insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at) values (?,?,?,'resolved',?)", entityId, kind, name, now);
  exec(`insert or ignore into v2_predicate_definitions (id,user_id,key,label,definition,status,origin,created_at,updated_at)
    values (?,?,'mentions','언급','synthetic','active','system_seed',?,?)`, predicateId, userId, now, now);
  exec(`insert into v2_relation_edges (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,created_at)
    values (?,?,?,?,?,'user_explicit','low','accepted',?)`, crypto.randomUUID(), userId, subjectId, predicateId, entityId, now);
}

function draft(overrides: Partial<NaturalQueryDraftV1> = {}): NaturalQueryDraftV1 {
  return { full_text: "", type_keys: [], property_filters: [], entity_filters: [], date_mode: "none", date_axis: "captured_at", date_relative_kind: "previous",
    date_relative_unit: "day", date_relative_count: 1, date_from: "", date_to: "", sort_field: "default", sort_direction: "desc", limit: 0, unmapped_phrases: [], ...overrides };
}
function gateway(respond: (request: V2StructuredModelRequest) => unknown) {
  const calls: V2StructuredModelRequest[] = [];
  harness.gateways.mockImplementation(() => ({ groundedResearch: {}, mainAnalyzer: { async generate<T>(request: V2StructuredModelRequest) {
    calls.push(request);
    return { data: (await respond(request)) as T, role: request.role, modelId: "fake:main_analyzer", inputHash: request.inputHash, outputHash: "fake", latencyMs: 1 };
  } } }));
  return calls;
}
function post(body: unknown, init: { origin?: string; contentType?: string; raw?: string } = {}) {
  return interpret(new Request("https://lighthouse.test/api/v2/search/interpret", { method: "POST",
    headers: { Origin: init.origin ?? "https://lighthouse.test", "Content-Type": init.contentType ?? "application/json" }, body: init.raw ?? JSON.stringify(body) }));
}
function payloadOf(request: V2StructuredModelRequest) { return JSON.parse((request.parts![0] as { text: string }).text); }
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json() as { error: { code: string; message: string; retryable?: boolean; retryAt?: string | null } };
  expect(Object.keys(body)).toEqual(["error"]); expect(body.error.code).toBe(code);
  expect(JSON.stringify(body)).not.toContain("젤다");
  return body.error;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T01:00:00.000Z"));
  db = new LinkSqlite(32);
  for (const flag of ["FLAG_V2_ROUTES", "FLAG_V2_AI"]) vi.stubEnv(flag, "1");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-test-key");
  harness.session.mockResolvedValue({ sessionId: "natural-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 600_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
  ids = {
    normal: await capture(owner, "PRIVATE TITLE A", "PRIVATE BODY 젤다 공략", "normal"),
    restricted: await capture(owner, "잠긴 제목", "RESTRICTED BODY 젤다", "restricted"),
    risky: await capture(owner, "PRIVATE TITLE C", "PRIVATE BODY C", "normal"),
    sensitive: await capture(owner, "PRIVATE TITLE S", "PRIVATE BODY S", "sensitive"),
    foreign: await capture(other, "PRIVATE TITLE F", "PRIVATE BODY 젤다", "normal"),
  };
  type(owner, ids.normal, "game_review", "게임 리뷰");
  type(owner, ids.normal, "rejected_type", "거절된 분류", "rejected");
  property(owner, ids.normal, "user_rating", "평점", "rating", 4.5);
  property(owner, ids.normal, "visit_count", "방문 횟수", "integer", 2);
  entity(owner, ids.normal, "place", "모모식당");
  type(owner, ids.restricted, "secret_diary", "비밀 일기");
  property(owner, ids.restricted, "secret_score", "비밀 점수", "integer", 7);
  entity(owner, ids.restricted, "secret_place", "비밀장소");
  property(owner, ids.risky, "visit_count", "방문 횟수", "integer", 3, "social_high_risk");
  property(owner, ids.risky, "companion_note", "동행 메모", "short_text", "함께", "autobiographical");
  type(owner, ids.sensitive, "health_log", "건강 기록");
  type(other, ids.foreign, "other_type", "타인 분류");
  property(other, ids.foreign, "other_field", "타인 항목", "short_text", "값");
  entity(other, ids.foreign, "other_kind", "타인 대상");
});
afterEach(() => { db.sql.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks(); vi.restoreAllMocks(); });

describe("POST /api/v2/search/interpret", () => {
  test("interprets against the owner's non-restricted low-risk catalog and recalls through the existing executor", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const calls = gateway(() => draft({
      full_text: "젤다", type_keys: ["game_review", "secret_diary", "other_type"],
      property_filters: [{ field_key: "user_rating", operator: "gte", value: "4" }, { field_key: "secret_score", operator: "exists", value: "" }],
      entity_filters: [{ entity_kind: "secret_place", name: "" }], date_mode: "relative", date_relative_kind: "previous", date_relative_unit: "year", date_relative_count: 1,
    }));
    const response = await post({ question });
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json() as { contract: string; today: string; plan: V2RetrievalQueryPlanV1; href: string; chips: unknown[]; dropped: { code: string; message: string }[] };
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ role: "main_analyzer", schemaId: "natural-query-draft.v1", promptVersion: "natural-query-plan.v1" });
    const payload = payloadOf(calls[0]);
    expect(payload).toEqual({
      contract_version: "natural-query-input.v1", today: "2026-09-28", timezone: "Asia/Seoul", question,
      catalog: {
        types: [{ key: "game_review", label: "게임 리뷰" }, { key: "health_log", label: "건강 기록" }],
        fields: [{ key: "user_rating", label: "평점", data_type: "rating", operators: ["exists", "eq", "gte", "lte"] }],
        entity_kinds: ["place"],
      },
    });
    for (const secret of secrets) expect(calls[0].parts![0]).not.toMatchObject({ text: expect.stringContaining(secret) });
    expect(body).toMatchObject({ contract: NATURAL_QUERY_INTERPRETATION_CONTRACT, today: "2026-09-28" });
    expect(body.plan).toMatchObject({ fullText: "젤다", typeKeys: ["game_review"], propertyFilters: [{ fieldKey: "user_rating", operator: "gte", value: 4 }],
      entityFilters: [], dateFilter: { axis: "captured_at", from: "2025-01-01", to: "2025-12-31" }, sort: { field: "relevance", direction: "desc" }, limit: 50 });
    expect(body.href).toBe(naturalSearchHref(body.plan));
    expect(body.dropped.map((note) => note.code).sort()).toEqual(["unknown_entity_kind", "unknown_field", "unknown_type", "unknown_type"]);
    expect(body.chips).toContainEqual({ kind: "type", label: "분류", value: "게임 리뷰" });
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("젤다");

    // The applied plan is executed by the existing deterministic retrieval route, never by the model.
    const search = await searchGET(new Request(`https://lighthouse.test/api/v2/search?${new URLSearchParams({ plan: JSON.stringify(body.plan) })}`));
    expect(search.status).toBe(200);
    const results = await search.json() as { results: { recordId: string }[]; totalCount: number };
    expect(results.results.map((result) => result.recordId)).toEqual([ids.normal]);
    expect(calls).toHaveLength(1);
  });

  test("an active restricted grant does not widen the catalog, and each owner sees only their own registry", async () => {
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const calls = gateway(() => draft());
    expect((await post({ question: "비밀 일기" })).status).toBe(200);
    expect(payloadOf(calls[0]).catalog).toEqual({ types: [{ key: "game_review", label: "게임 리뷰" }, { key: "health_log", label: "건강 기록" }],
      fields: [{ key: "user_rating", label: "평점", data_type: "rating", operators: ["exists", "eq", "gte", "lte"] }], entity_kinds: ["place"] });
    harness.grant.mockResolvedValue(null);
    harness.session.mockResolvedValue({ sessionId: "other-session", userId: other, email: "other@example.test", expiresAt: Date.now() + 600_000 });
    expect((await post({ question: "게임 리뷰" })).status).toBe(200);
    expect(payloadOf(calls[1]).catalog).toEqual({ types: [{ key: "other_type", label: "타인 분류" }],
      fields: [{ key: "other_field", label: "타인 항목", data_type: "short_text", operators: ["exists", "eq", "contains"] }], entity_kinds: ["other_kind"] });
    expect(JSON.stringify(payloadOf(calls[1]))).not.toMatch(/game_review|user_rating|place|health_log/);
  });

  test.each([false, true])("includes approved sensitive-only type and field names without record content (restricted grant: %s)", async (restrictedUnlocked) => {
    // These labels exist only on a sensitive record; approval covers registry
    // names for interpretation, never the underlying title, body or values.
    property(owner, ids.sensitive, "health_measurement", "건강 측정치", "integer", 937421);
    property(owner, ids.sensitive, "health_note", "건강 메모", "short_text", "SENSITIVE PROPERTY VALUE");
    entity(owner, ids.sensitive, "place", "SENSITIVE ENTITY NAME");
    // Sensitive label approval does not relax either claim-risk or semantic
    // filtering, including a field with low and high-risk current values.
    property(owner, ids.sensitive, "mixed_assessment", "혼합 평가", "integer", 841563);
    property(owner, ids.risky, "mixed_assessment", "혼합 평가", "integer", 841564, "social_high_risk");
    property(owner, ids.sensitive, "personal_note", "개인 메모", "short_text", "SENSITIVE AUTOBIOGRAPHICAL VALUE", "autobiographical");
    property(owner, ids.sensitive, "mood", "상태", "short_text", "SENSITIVE MOOD VALUE");
    property(owner, ids.sensitive, "daily_state", "기분", "short_text", "SENSITIVE DAILY STATE VALUE");
    expect(db.sql.prepare(`select d.privacy_level from v2_object_type_assignments a
      join v2_type_definitions t on t.id=a.type_definition_id
      join v2_documents d on d.object_id=a.object_id where t.user_id=? and t.key='health_log'`).all(owner))
      .toEqual([{ privacy_level: "sensitive" }]);
    expect(db.sql.prepare(`select f.key,d.privacy_level from v2_property_values p
      join v2_field_definitions f on f.id=p.field_definition_id
      join v2_documents d on d.object_id=p.owner_object_id
      where f.user_id=? and f.key in ('health_measurement','health_note') order by f.key`).all(owner))
      .toEqual([{ key: "health_measurement", privacy_level: "sensitive" }, { key: "health_note", privacy_level: "sensitive" }]);
    harness.grant.mockResolvedValue(restrictedUnlocked ? { expiresAt: new Date(Date.now() + 60_000).toISOString() } : null);
    const calls = gateway(() => draft({ type_keys: ["health_log"], property_filters: [{ field_key: "health_note", operator: "exists", value: "" }] }));
    const response = await post({ question: "메모가 있는 건강 기록" });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].parts).toHaveLength(1);
    expect(payloadOf(calls[0])).toEqual({
      contract_version: "natural-query-input.v1", today: "2026-09-28", timezone: "Asia/Seoul", question: "메모가 있는 건강 기록",
      catalog: {
        types: [{ key: "game_review", label: "게임 리뷰" }, { key: "health_log", label: "건강 기록" }],
        fields: [
          { key: "health_measurement", label: "건강 측정치", data_type: "integer", operators: ["exists", "eq", "gte", "lte"] },
          { key: "health_note", label: "건강 메모", data_type: "short_text", operators: ["exists", "eq", "contains"] },
          { key: "user_rating", label: "평점", data_type: "rating", operators: ["exists", "eq", "gte", "lte"] },
        ],
        entity_kinds: ["place"],
      },
    });
    // Inspect the entire prepared gateway request, not just the catalog, so
    // record content cannot leak through another part or system instruction.
    const serialized = JSON.stringify(calls[0]);
    for (const excluded of [...secrets, "937421", "SENSITIVE PROPERTY VALUE", "SENSITIVE ENTITY NAME", "841563", "841564",
      "mixed_assessment", "혼합 평가", "personal_note", "개인 메모", "SENSITIVE AUTOBIOGRAPHICAL VALUE", "SENSITIVE MOOD VALUE",
      "daily_state", "기분", "SENSITIVE DAILY STATE VALUE", "비밀 점수", "타인 항목", "타인 대상"])
      expect(serialized).not.toContain(excluded);
    const body = await response.json() as { plan: V2RetrievalQueryPlanV1; dropped: unknown[] };
    expect(body.plan.typeKeys).toEqual(["health_log"]);
    expect(body.plan.propertyFilters).toEqual([{ fieldKey: "health_note", operator: "exists" }]);
    expect(body.dropped).toEqual([]);
  });

  test("AI off, routes off, missing configuration and a paused shared governor fail before any provider call", async () => {
    const calls = gateway(() => draft());
    vi.stubEnv("FLAG_V2_AI", "0");
    expect((await failure(await post({ question }), 503, "v2_ai_disabled")).retryable).toBe(false);
    vi.stubEnv("FLAG_V2_AI", "1"); vi.stubEnv("GEMINI_API_KEY", " ");
    await failure(await post({ question }), 503, "gemini_not_configured");
    vi.stubEnv("GEMINI_API_KEY", "synthetic-test-key");
    exec("insert into v2_ai_runtime_state (model_role,state,consecutive_failures,retry_after,updated_at) values ('main_analyzer','quota_exhausted',1,?,?)", "2026-09-28T01:10:00.000Z", now);
    const cooling = await post({ question });
    expect(cooling.headers.get("Retry-After")).toBe("600");
    expect(await failure(cooling, 429, "search_quota_exhausted")).toMatchObject({ retryable: true, retryAt: "2026-09-28T01:10:00.000Z" });
    exec("update v2_ai_runtime_state set state='circuit_open'");
    expect(await failure(await post({ question }), 503, "search_ai_paused")).toMatchObject({ retryable: true, retryAt: "2026-09-28T01:10:00.000Z" });
    // Queued analysis holding the single probe lease also pauses interactive recall.
    exec("update v2_ai_runtime_state set state='healthy',retry_after=null,probe_owner='queue-worker:analyze',probe_expires_at='2026-09-28T01:02:00.000Z'");
    expect(await failure(await post({ question }), 503, "search_ai_paused")).toMatchObject({ retryAt: null });
    expect(db.sql.prepare("select probe_owner from v2_ai_runtime_state").get()).toEqual({ probe_owner: "queue-worker:analyze" });
    exec("update v2_ai_runtime_state set state='circuit_open',consecutive_failures=3,retry_after='2026-09-28T00:59:00.000Z',probe_owner=null,probe_expires_at=null");
    expect((await post({ question })).status).toBe(200);
    expect(calls).toHaveLength(1);
    // A successful probe closes the circuit and releases the lease.
    expect(db.sql.prepare("select state,consecutive_failures,retry_after,probe_owner from v2_ai_runtime_state").get())
      .toEqual({ state: "healthy", consecutive_failures: 0, retry_after: null, probe_owner: null });
    vi.stubEnv("FLAG_V2_ROUTES", "0");
    await failure(await post({ question }), 404, "v2_routes_disabled");
    expect(calls).toHaveLength(1);
  });

  test("requires an authenticated same-origin JSON request with a bounded question", async () => {
    const calls = gateway(() => draft());
    harness.session.mockResolvedValueOnce(null);
    await failure(await post({ question }), 401, "authentication_required");
    await failure(await post({ question }, { origin: "https://evil.example" }), 403, "origin_rejected");
    await failure(await post({ question }, { contentType: "text/plain" }), 415, "content_type_rejected");
    await failure(await post(null, { raw: JSON.stringify({ question: "가".repeat(5000) }) }), 413, "request_too_large");
    await failure(await post(null, { raw: "{bad" }), 400, "invalid_json");
    await failure(await post({ question, extra: "catalog" }), 400, "natural_query_request_invalid");
    await failure(await post({}), 400, "natural_query_request_invalid");
    for (const bad of ["", "가".repeat(301), "게임\u0000리뷰", "리뷰\uD800", 42]) await failure(await post({ question: bad }), 400, "natural_query_question_invalid");
    expect(calls).toHaveLength(0);
  });

  test("records a provider quota error in the shared governor with its retry hint and pauses the next request", async () => {
    const calls = gateway(() => { throw new GeminiProviderError({ status: 429, category: "quota_or_rate_limit", code: "quota_exhausted", retryable: true, retryAfterMs: 3_600_000 }); });
    const exhausted = await post({ question });
    expect(exhausted.headers.get("Retry-After")).toBe("3600");
    expect(await failure(exhausted, 429, "search_quota_exhausted")).toMatchObject({ retryable: true, retryAt: "2026-09-28T02:00:00.000Z" });
    expect(db.sql.prepare("select state,retry_after,last_error_code,probe_owner from v2_ai_runtime_state").get())
      .toEqual({ state: "quota_exhausted", retry_after: "2026-09-28T02:00:00.000Z", last_error_code: "quota_exhausted", probe_owner: null });
    expect(await failure(await post({ question }), 429, "search_quota_exhausted")).toMatchObject({ retryAt: "2026-09-28T02:00:00.000Z" });
    expect(calls).toHaveLength(1);
    // Without a provider hint the governor's minimum quota pause is reported.
    exec("delete from v2_ai_runtime_state");
    gateway(() => { throw new GeminiProviderError({ status: 429, category: "quota_or_rate_limit", code: "quota_exhausted", retryable: true }); });
    expect(await failure(await post({ question }), 429, "search_quota_exhausted")).toMatchObject({ retryAt: "2026-09-28T01:15:00.000Z" });
  });

  test("maps provider failures into retryable or terminal JSON errors without provider text", async () => {
    const cases: [unknown, number, string, boolean][] = [
      [new GeminiProviderError({ status: 429, category: "quota_or_rate_limit", code: "quota_exhausted", retryable: true }), 429, "search_quota_exhausted", true],
      [new GeminiProviderError({ status: 503, category: "provider_server", code: "provider_unavailable", retryable: true }), 503, "natural_query_provider_unavailable", true],
      [new GeminiProviderError({ status: null, category: "transport_or_sdk", code: "provider_unavailable", retryable: true }), 503, "natural_query_provider_unavailable", true],
      [new GeminiProviderError({ status: null, category: "timeout", code: "timeout", retryable: true }), 504, "natural_query_timeout", true],
      [new GeminiProviderError({ status: 400, category: "invalid_request", code: "provider_unavailable", retryable: false }), 502, "natural_query_provider_rejected", false],
      [new GeminiProviderError({ status: 403, category: "permission_or_model_access", code: "provider_unavailable", retryable: false, providerReason: "API_KEY_INVALID" }), 502, "natural_query_provider_rejected", false],
      [new V2ModelError("invalid_schema", "Gemini returned invalid JSON with 젤다.", false), 502, "natural_query_invalid_output", true],
      [new Error("raw SDK body mentioning 젤다"), 503, "natural_query_provider_unavailable", true],
    ];
    for (const [error, status, code, retryable] of cases) {
      exec("delete from v2_ai_runtime_state");
      gateway(() => { throw error; });
      const result = await failure(await post({ question }), status, code);
      expect(result.retryable).toBe(retryable);
      expect(result.message).not.toMatch(/Gemini|HTTP|API_KEY|SDK/);
      expect(db.sql.prepare("select probe_owner from v2_ai_runtime_state").get()).toEqual({ probe_owner: null });
    }
    // A draft that does not satisfy the contract is never guessed into a plan; the provider call itself succeeded.
    exec("delete from v2_ai_runtime_state");
    gateway(() => ({ ...draft(), sql: "select * from v2_documents" }));
    await failure(await post({ question }), 502, "natural_query_invalid_output");
    expect(db.sql.prepare("select state,probe_owner from v2_ai_runtime_state").get()).toEqual({ state: "healthy", probe_owner: null });
  });
});
