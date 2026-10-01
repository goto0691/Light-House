import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET as searchGET } from "@/app/api/v2/search/route";
import { GET as matchesGET } from "@/app/api/v2/records/[recordId]/search-matches/route";
import { GET as locationGET } from "@/app/api/v2/records/[recordId]/search-location/route";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import type { V2StructuredModelGateway, V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import type { LinkAnalysisEnvelopeV1 } from "@/lib/v2/ai/link-analysis-v1";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { V2RetrievalPage } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { defaultV2QueryPlan, type V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import { firstRecordTextMatch, recordLocationTextHash, serializeRecordLocation,
  type V2RecordLocationV1, type V2RecordLocationResult, type V2RetrievalMatchPage } from "@/lib/v2/retrieval/record-location-v1";
import { exactLinkGateway, LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

type Seed = Awaited<ReturnType<typeof seedLinkRecord>>;
type SearchResult = V2RetrievalPage & { contractVersion: "retrieval-results-v1"; plan: V2RetrievalQueryPlanV1 };
type MatchesResult = V2RetrievalMatchPage & { contract: "retrieval-matches.v1"; recordId: string; plan: V2RetrievalQueryPlanV1 };
const owner = "link-owner", now = "2026-09-12T10:00:00.000Z", rawText = "éCOLE 👀\r\nneedle raw prompt\r\n--ar 3:2\n";
let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32);
  for (const flag of ["FLAG_V2_ROUTES", "FLAG_V2_WRITE", "FLAG_V2_AI"]) vi.stubEnv(flag, "1");
  harness.session.mockResolvedValue({ sessionId: "roundtrip-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function query(plan: V2RetrievalQueryPlanV1, page = 1) { return new URLSearchParams({ plan: JSON.stringify(plan), page: String(page) }).toString(); }
function search(parameters: string) { return searchGET(new Request(`https://lighthouse.test/api/v2/search?${parameters}`)); }
function matches(recordId: string, parameters: string) {
  return matchesGET(new Request(`https://lighthouse.test/api/v2/records/${recordId}/search-matches?${parameters}`), { params: Promise.resolve({ recordId }) });
}
function exact(recordId: string, location: V2RecordLocationV1) {
  return locationGET(new Request(`https://lighthouse.test/api/v2/records/${recordId}/search-location?${new URLSearchParams({ loc: serializeRecordLocation(location) })}`),
    { params: Promise.resolve({ recordId }) });
}
async function success<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return await response.json() as T;
}
async function denial(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Expected error object");
  expect(Object.keys(result)).toEqual(["error"]); expect(result).toMatchObject({ error: { code } });
  for (const secret of [rawText, "PRIVATE MEMO", "Synthetic link", "needle raw prompt", "Derived needle insight"])
    expect(JSON.stringify(result)).not.toContain(secret);
}
function sourceLocation(seed: Seed): V2RecordLocationV1 {
  return { contract: "record-location.v1", kind: "source", sourceItemId: seed.projection!.members[0].sourceItemId,
    snapshotId: seed.projection!.snapshot.id, manifestHash: seed.projection!.snapshot.manifestHash, memberId: seed.projection!.members[0].id,
    textHash: recordLocationTextHash(rawText), range: firstRecordTextMatch(rawText, ["needle"]) };
}

async function addManual(seed: Seed) {
  return (await new D1ManualLinkFragmentRepository(db, owner).create(seed.capture.objectId, {
    expectedRevisionId: seed.capture.revisionId, expectedSnapshotId: seed.projection!.snapshot.id, expectedManifestHash: seed.projection!.snapshot.manifestHash,
    memberId: seed.projection!.members[0].id, textStart: 0, textEnd: rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  })).item;
}

describe("actual GET search → paged matches → exact location using local SQLite", () => {
  test("roundtrips 53 manual locators plus original/AI/curation origin bytes without invoking a provider on reads", async () => {
    const seed = await seedLinkRecord(db, { rawText }), manual: Awaited<ReturnType<typeof addManual>>[] = [];
    for (let index = 0; index < 53; index++) manual.push(await addManual(seed));
    const curated = (await new D1PromptCurationRepository(db, owner).create(seed.capture.objectId, {
      expectedRevisionId: seed.capture.revisionId, expectedSnapshotId: seed.projection!.snapshot.id, expectedManifestHash: seed.projection!.snapshot.manifestHash,
      groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), content: { title: "needle curated title", relationKind: "continuation",
        relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed", examples: [],
        items: [0, 1].map((position) => ({ itemKey: `part-${position}`, fragmentId: manual[0].id, expectedFragmentStateVersion: 1, copyRole: "prompt", position })) },
    })).item;
    const modelDouble = exactLinkGateway(), gateway: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) {
      const result = await modelDouble.generate<T>(request), envelope = result.data as LinkAnalysisEnvelopeV1;
      return { ...result, data: { ...envelope, interpretations: [{ fragment_key: "interpretation", role: "insight", text: "Derived needle insight",
        evidence: [envelope.fragments[0].selection] }] } as T };
    } };
    const links = new D1LinkAnalysisRepository(db);
    await links.enqueue(owner, { documentId: seed.capture.objectId, expectedRevisionId: seed.capture.revisionId,
      expectedSnapshotId: seed.projection!.snapshot.id, expectedManifestHash: seed.projection!.snapshot.manifestHash, idempotencyKey: crypto.randomUUID() });
    expect(await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), gateway, workerId: "roundtrip-test" })).toMatchObject({ outcome: "succeeded" });
    const beforeChanges = db.sql.prepare("select total_changes() as n").get(), beforeCalls = modelDouble.calls.length;
    expect(beforeCalls).toBe(1);
    const searchResult = await success<SearchResult>(await search("q=needle"));
    expect(searchResult).toMatchObject({ contractVersion: "retrieval-results-v1", totalCount: 1 });
    const record = searchResult.results[0];
    expect(record.recordId).toBe(seed.capture.objectId); expect(record.matchCount).toBe(58); expect(record.matches).toHaveLength(3);
    const first = await success<MatchesResult>(await matches(record.recordId, query(searchResult.plan)));
    const second = await success<MatchesResult>(await matches(record.recordId, query(first.plan, 2)));
    expect(first).toMatchObject({ contract: "retrieval-matches.v1", recordId: record.recordId, plan: searchResult.plan, totalCount: 58, page: 1, pageSize: 50, totalPages: 2 });
    expect(first.matches).toHaveLength(50); expect(second.matches).toHaveLength(8);
    const all = [...first.matches, ...second.matches];
    expect(new Set(all.map((match) => match.id)).size).toBe(58);
    expect(all.filter((match) => match.origin === "manual_extract")).toHaveLength(53);
    expect(record.matches).toEqual(first.matches.slice(0, 3));
    const manualIds = new Set(all.flatMap((match) => match.location.kind === "manual_fragment" ? [match.location.fragmentId] : []));
    expect(manual.every((item) => manualIds.has(item.id))).toBe(true);
    const selected = [all.find((match) => match.origin === "external_source")!,
      ...["ai_extract", "ai_interpretation"].map((origin) => all.find((match) => match.origin === origin)!),
      ...all.filter((match) => match.origin === "curation"),
      all.find((match) => match.location.kind === "manual_fragment" && match.location.fragmentId === manual[52].id)!];
    expect(selected).toHaveLength(6);
    for (const match of selected) {
      const result = await success<V2RecordLocationResult>(await exact(record.recordId, match.location));
      expect(result.location).toEqual(match.location); expect(result.range).toEqual(match.location.range);
      expect(result.textHash).toBe(match.location.textHash); expect(recordLocationTextHash(result.text)).toBe(match.location.textHash);
      expect(result.range).toEqual(firstRecordTextMatch(result.text, ["needle"]));
      expect(result.text.slice(result.range!.start, result.range!.end).toLowerCase()).toBe("needle");
      if (match.origin === "external_source" || match.origin === "manual_extract") expect(result.text).toBe(rawText);
      if (match.origin === "ai_interpretation") expect(result.text).toBe("Derived needle insight");
      if (match.origin === "ai_extract") {
        const id = match.location.kind === "ai_fragment" ? match.location.fragmentId : "";
        expect(result.text).toBe(db.sql.prepare("select raw_text from v2_link_fragments where id=?").get(id)!.raw_text);
      }
      if (match.location.kind === "curation") {
        expect(result.context).toMatchObject({ groupKey: curated.groupKey, curationRevisionId: curated.id });
        expect(result.text).toBe(match.location.role === "title" ? "needle curated title" : [rawText, rawText].join("\n"));
      }
    }
    expect(db.sql.prepare("select total_changes() as n").get()).toEqual(beforeChanges);
    expect(modelDouble.calls).toHaveLength(beforeCalls);
  });
});

async function richFixture() {
  const records = [];
  for (const label of ["target", "loud", "high-rating", "missing-person", "old-date"]) {
    const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: label, bodyMarkdown: `needle ${label} original`,
      aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-07-01T10:00:00.000Z" }, crypto.randomUUID(), now);
    await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
    const revision = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: capture.revisionId, title: capture.title,
      bodyMarkdown: capture.bodyMarkdown, writtenAt: label === "old-date" ? "2026-08-31" : "2026-09-11", documentStatus: "finished", privacyLevel: "normal" }, crypto.randomUUID());
    expect(await new D1DocumentAuthoringRepository(db, owner).saveRevision(capture.objectId, revision)).toMatchObject({ outcome: "saved" });
    records.push({ ...capture, label });
  }
  db.sql.exec(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
    values ('mood-field','link-owner','mood','기분','기분','short_text','active','user_created',1,1,'${now}','${now}'),
      ('rating-field','link-owner','user_rating','평점','평점','rating','active','user_created',1,1,'${now}','${now}');
    insert into v2_predicate_definitions(id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at)
      values ('mentions','link-owner','mentions_entity','언급','언급','active','user_created',1,'${now}','${now}');
    insert into v2_objects(id,user_id,object_kind,lifecycle_status,created_at,updated_at)
      values ('work-subject','link-owner','entity','active','${now}','${now}'),('person-subject','link-owner','entity','active','${now}','${now}');
    insert into v2_entity_records(object_id,entity_kind,canonical_name,resolution_status,created_at)
      values ('work-subject','work','작품','resolved','${now}'),('person-subject','person','Alice','resolved','${now}');`);
  for (const record of records) {
    db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
      values (?,'link-owner',?,'mood-field','text',?,?,'user_explicit','low','accepted',1,?)`)
      .run(`mood-${record.label}`, record.objectId, record.label === "loud" ? "loud evening" : "calm evening", JSON.stringify(record.label === "loud" ? "loud evening" : "calm evening"), now);
    db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
      values (?,'link-owner',?,'rating-field','rating',?,?,'user_explicit','low','accepted',1,?)`)
      .run(`rating-${record.label}`, record.objectId, record.label === "high-rating" ? 5 : 4, record.label === "high-rating" ? "5" : "4", now);
    for (const target of record.label === "missing-person" ? ["work-subject"] : ["work-subject", "person-subject"])
      db.sql.prepare(`insert into v2_relation_edges(id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,locked_by_user,created_at)
        values (?,'link-owner',?,'mentions',?,'user_explicit','low','accepted',1,?)`).run(`${record.label}-${target}`, record.objectId, target, now);
  }
  const plan = defaultV2QueryPlan({ fullText: "needle", propertyFilters: [{ fieldKey: "mood", operator: "contains", value: "calm" }, { fieldKey: "user_rating", operator: "lte", value: 4.5 }],
    entityFilters: [{ entityKind: "work", targetObjectId: "work-subject" }, { entityKind: "person", canonicalName: "Alice" }],
    dateFilter: { axis: "written_at", from: "2026-09-10", to: "2026-09-12" }, sort: { field: "written_at", direction: "asc" }, limit: 2 });
  return { records, plan };
}

describe("rich plan preservation rather than reduction to simple URL filters", () => {
  test("search echoes and enforces contains/lte/two entities/written-date/limit, then preserves it through matches and exact bytes", async () => {
    const { records, plan } = await richFixture(), searched = await success<SearchResult>(await search(query(plan)));
    expect(searched.plan).toEqual(plan); expect(searched.totalCount).toBe(1); expect(searched.pageSize).toBe(2);
    expect(searched.results.map((record) => record.recordId)).toEqual([records[0].objectId]);
    const page = await success<MatchesResult>(await matches(records[0].objectId, query(searched.plan)));
    expect(page.plan).toEqual(plan); expect(page.totalCount).toBeGreaterThan(0); expect(page.pageSize).toBe(2);
    const body = page.matches.find((match) => match.origin === "document_body")!;
    const result = await success<V2RecordLocationResult>(await exact(records[0].objectId, body.location));
    expect(result.text).toBe(records[0].bodyMarkdown); expect(result.location).toEqual(body.location);
  });

  test("search-matches alone retains the complete rich plan and excludes each independently failing record", async () => {
    const { records, plan } = await richFixture();
    for (const [index, record] of records.entries()) {
      const response = await matches(record.objectId, query(plan));
      if (index) await denial(response, 404, "record_not_found");
      else {
        const page = await success<MatchesResult>(response);
        expect(page.plan).toEqual(plan); expect(page.pageSize).toBe(2); expect(page.totalCount).toBeGreaterThan(0);
        expect(page).toMatchObject({ privacyLevel: "normal" });
      }
    }
  });
});

const invalidQueries = [
  ["duplicate simple query", "q=needle&q=other"], ["unknown key", "q=needle&grant=true"],
  ["malformed plan JSON", new URLSearchParams({ plan: "{" }).toString()],
  ["nonrecord plan", "plan=null"], ["unknown plan field", query({ ...defaultV2QueryPlan({ fullText: "needle" }), grant: true } as V2RetrievalQueryPlanV1)],
  ["mixed plan and simple query", `${query(defaultV2QueryPlan({ fullText: "needle" }))}&q=other`],
  ["duplicate plan", `${query(defaultV2QueryPlan({ fullText: "needle" }))}&plan=null`],
  ["NUL query", "q=needle%00"],
  ["lone high surrogate in JSON query", query({ ...defaultV2QueryPlan({ fullText: "needle" }), fullText: "\ud800" })],
  ["lone low surrogate in JSON query", query({ ...defaultV2QueryPlan({ fullText: "needle" }), fullText: "\udc00" })],
  ["overlength simple query", new URLSearchParams({ q: "n".repeat(301) }).toString()],
] as const;

describe("strict query and final-grant HTTP boundaries", () => {
  test.each(invalidQueries.flatMap(([label, parameters]) => [["search", label, parameters], ["matches", label, parameters]] as const))
    ("%s rejects %s without record bytes", async (endpoint, _label, parameters) => {
    const seed = await seedLinkRecord(db, { rawText });
    const response = endpoint === "search" ? await search(parameters) : await matches(seed.capture.objectId, parameters);
    await denial(response, 400, "query_plan_invalid");
  });

  test.each(["no match", "foreign owner", "restricted"] as const)("match paging returns an opaque no-store 404 for %s instead of an empty authorized-looking page", async (scenario) => {
    const seed = await seedLinkRecord(db, { rawText, privacyLevel: scenario === "restricted" ? "restricted" : "normal" });
    if (scenario === "foreign owner") harness.session.mockResolvedValue({ sessionId: "other-session", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
    await denial(await matches(seed.capture.objectId, scenario === "no match" ? "q=absent" : "q=needle"), 404, "record_not_found");
  });

  test.each(["search", "matches", "location"] as const)("%s cannot return bytes if a restricted grant expires during its final SQL await", async (endpoint) => {
    const seed = await seedLinkRecord(db, { rawText, privacyLevel: "restricted" }), currentTime = Date.now();
    harness.grant.mockResolvedValue({ expiresAt: new Date(currentTime + 60_000).toISOString() });
    let finalReads = 0, frames = 0;
    const binding: D1DatabaseBinding = { batch: db.batch.bind(db), prepare(sql) {
      let statement = db.prepare(sql);
      const wrapped: D1PreparedStatementBinding = { bind(...values) { statement = statement.bind(...values); return wrapped; },
        all: () => statement.all(), run: () => statement.run(), async first<T>() {
          const final = endpoint === "location" ? sql.includes("as material_json") && ++frames === 2 : sql.startsWith("with recursive search_tokens as");
          const result = await statement.first<T>();
          if (final) { finalReads++; vi.spyOn(Date, "now").mockReturnValue(currentTime + 60_001); }
          return result;
        } };
      return wrapped;
    } };
    harness.bindings.mockReturnValue({ db: binding });
    const response = endpoint === "search" ? await search("q=needle") : endpoint === "matches" ? await matches(seed.capture.objectId, "q=needle") : await exact(seed.capture.objectId, sourceLocation(seed));
    expect(finalReads).toBe(1);
    await denial(response, 423, "restricted_record_locked");
  });
});
