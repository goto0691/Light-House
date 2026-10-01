import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { V2ModelError } from "@/lib/v2/ai/gateway";
import { FakeV2GroundedResearchGateway, FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { runNextGroundingJob } from "@/lib/v2/ai/grounding-runner";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationDirectory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
let db: TestD1;

async function applySql(path: string) {
  for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
}
async function reset() {
  await db.exec(`delete from v2_capture_input_values; delete from v2_capture_template_sessions; delete from v2_template_source_links; delete from v2_template_pattern_observations; delete from v2_capture_template_versions; delete from v2_capture_templates; delete from v2_saved_views; delete from v2_documents_fts; delete from v2_type_presentation_profiles; delete from v2_unit_definitions; delete from v2_relation_edges; delete from v2_predicate_definitions; delete from v2_event_records; delete from v2_entity_records; delete from v2_review_receipts; delete from v2_evidence_refs; delete from v2_review_items; delete from v2_property_values; delete from v2_object_type_assignments; delete from v2_field_definitions; delete from v2_type_definitions; delete from v2_ai_runtime_state; delete from v2_grounding_results; delete from v2_grounding_requests; delete from v2_analysis_proposals; delete from v2_restricted_grants; delete from v2_idempotency_records; delete from v2_audit_events; delete from v2_processing_runs; delete from v2_processing_jobs; delete from v2_processing_outbox; delete from v2_deletion_tombstones; delete from v2_document_source_links; delete from v2_document_revisions; delete from v2_documents; delete from v2_objects; delete from v2_source_attachment_links; delete from v2_source_items; delete from v2_attachment_reservations; delete from v2_capture_bundles;`);
}
async function count(table: string, where = "") { return (await db.prepare(`select count(*) as value from ${table} ${where}`).first<{ value: number }>())?.value ?? -1; }

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');`);
  const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 30).sort();
  for (const migration of migrations) await applySql(`${migrationDirectory}/${migration}`);
}, 60_000);
beforeEach(reset);
afterAll(async () => platform.dispose());

async function seed() {
  const capture = await prepareCaptureCommit({
    draftId: `ai-${crypto.randomUUID()}`, channel: "web", title: "영화 감상", bodyMarkdown: "영화 봄날을 보고 별점 4.5점을 남겼다.", aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-08-12T09:00:00.000Z",
  }, `capture-${crypto.randomUUID()}`, "2026-08-12T09:00:01.000Z");
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(capture);
  return capture;
}

function envelope(capture: Awaited<ReturnType<typeof seed>>, overrides: Partial<AnalysisEnvelopeV1> = {}): AnalysisEnvelopeV1 {
  const source = capture.sources[0];
  return {
    contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "영화 감상과 사용자 평점",
    document_proposals: [{ temp_id: "doc-1", source_item_ids: [source.id], suggested_title: "봄날 감상", type_assignments: [{ type_key: "movie_review", label: "영화 리뷰", registry_action: "propose_new", evidence_refs: [{ source_item_id: source.id, start: 0, end: 5 }] }] }],
    entity_proposals: [{ temp_id: "entity-1", entity_kind: "work", mention: "봄날", resolution_status: "external_required", evidence_refs: [{ source_item_id: source.id, start: 3, end: 5 }] }],
    event_proposals: [],
    field_proposals: [{ temp_id: "field-1", field_key: "user_rating", value: 4.5, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: [{ source_item_id: source.id, start: 12, end: 19 }] }],
    enrichment_requests: [{ request_id: "enrich-1", entity_kind: "work", query: "영화 봄날", requested_fields: ["director", "cast"] }], review_items: [], warnings: [], ...overrides,
  };
}

describe("I3 outbox, lease, and validated analysis pipeline", () => {
  test("fails a malformed current revision parent before dispatch and never calls the provider", async () => {
    const capture = await seed();
    const foreign = await prepareCaptureCommit({
      draftId: `foreign-revision-${crypto.randomUUID()}`,
      channel: "web",
      title: "foreign revision",
      bodyMarkdown: "다른 사용자의 본문",
      aiEnabled: true,
      clientTimezone: "Asia/Seoul",
      privacyLevel: "normal",
      capturedAt: "2026-08-12T09:00:00.000Z",
    }, `foreign-revision-${crypto.randomUUID()}`, "2026-08-12T09:00:02.000Z");
    await new D1SourceFoundationRepository(db, "user-b").commitCapture(foreign);
    await db.batch([
      db.prepare("update v2_processing_outbox set status='failed' where user_id='user-b'"),
      db.prepare("update v2_documents set current_revision_id=? where object_id=?").bind(foreign.revisionId, capture.objectId),
    ]);
    const queue = new D1ProcessingQueueRepository(db);
    await expect(queue.dispatchPending()).resolves.toBe(0);
    const gateway = new FakeV2StructuredModelGateway("success", envelope(capture));
    await expect(runNextAnalysisJob({ queue, gateway, workerId: "foreign-revision-worker" })).resolves.toEqual({ outcome: "idle" });
    expect(gateway.calls).toHaveLength(0);
    await expect(db.prepare("select status from v2_processing_outbox where user_id='user-a' and capture_id=?").bind(capture.captureId).first()).resolves.toEqual({ status: "failed" });
    await expect(count("v2_processing_jobs", "where user_id='user-a'")).resolves.toBe(0);
  });

  test("keeps a foreign template version out of a malformed current-user analysis session", async () => {
    const capture = await seed();
    await db.batch([
      db.prepare(
        `insert into v2_capture_templates
         (id,user_id,name,description,icon_key,origin,status,current_version_id,pattern_signature,pinned,usage_count,created_at,updated_at)
         values ('foreign-template','user-b','foreign template',null,'type.template','user_created','active',null,null,0,0,'2026-08-12T09:10:00.000Z','2026-08-12T09:10:00.000Z')`,
      ),
      db.prepare(
        `insert into v2_capture_template_versions
         (id,template_id,version_number,definition_json,registry_snapshot_version,source_model,prompt_version,approved_at,previous_version_id,created_at)
         values ('foreign-template-version','foreign-template',1,?,'template-registry-v1',null,null,'2026-08-12T09:10:00.000Z',null,'2026-08-12T09:10:00.000Z')`,
      ).bind(JSON.stringify(SYSTEM_TEMPLATE_SEEDS[0].definition)),
      db.prepare("update v2_capture_templates set current_version_id='foreign-template-version' where id='foreign-template'"),
      db.prepare(
        `insert into v2_capture_template_sessions
         (id,user_id,draft_id,capture_id,template_version_id,state,applied_at,detached_at,submitted_at,input_snapshot_json)
         values ('cross-owner-template-session','user-a','cross-owner-template-draft',?,'foreign-template-version','submitted','2026-08-12T09:11:00.000Z',null,'2026-08-12T09:11:01.000Z','[]')`,
      ).bind(capture.captureId),
    ]);
    const queue = new D1ProcessingQueueRepository(db);
    await expect(queue.dispatchPending()).resolves.toBe(1);
    const gateway = new FakeV2StructuredModelGateway("success", envelope(capture));
    await expect(runNextAnalysisJob({ queue, gateway, workerId: "foreign-template-worker" })).resolves.toMatchObject({ outcome: "succeeded" });
    expect(gateway.calls).toHaveLength(1);
    const promptPart = gateway.calls[0]?.parts?.[0];
    const promptText = promptPart && "text" in promptPart ? promptPart.text : "";
    expect(promptText).toContain('"template_context":null');
    expect(promptText).not.toContain("foreign-template-version");
  });

  test("dispatches and executes one source outbox without storing raw model payload in run telemetry", async () => {
    const capture = await seed();
    await expect(new D1PresentationRepository(db, "user-a").project(capture.objectId)).resolves.toMatchObject({
      displayType: { label: "기록", iconKey: "type.document", status: "fallback" }, highlights: [], sections: [], reviewItems: [],
    });
    const queue = new D1ProcessingQueueRepository(db);
    await expect(queue.dispatchPending()).resolves.toBe(1);
    const gateway = new FakeV2StructuredModelGateway("success", envelope(capture));
    await expect(runNextAnalysisJob({ queue, gateway, workerId: "worker-a" })).resolves.toMatchObject({ outcome: "succeeded" });
    expect(gateway.calls).toHaveLength(1);
    await expect(count("v2_processing_jobs", "where status='succeeded'")).resolves.toBe(1);
    await expect(count("v2_analysis_proposals", "where status='validated'")).resolves.toBe(1);
    await expect(count("v2_type_definitions", "where status='candidate'")).resolves.toBe(1);
    await expect(count("v2_object_type_assignments", "where review_status='proposed'")).resolves.toBe(1);
    await expect(count("v2_property_values", "where review_status='accepted' and source_class='user_explicit'")).resolves.toBe(1);
    await expect(count("v2_evidence_refs", "where target_kind='property_value'")).resolves.toBe(1);
    await expect(count("v2_entity_records")).resolves.toBe(1);
    await expect(count("v2_relation_edges", "where review_status='proposed'")).resolves.toBe(1);
    await expect(count("v2_evidence_refs", "where target_kind in ('entity','relation')")).resolves.toBe(2);
    await expect(count("v2_predicate_definitions", "where status='active' and origin='system_seed'")).resolves.toBe(2);
    await expect(count("v2_unit_definitions", "where status='active' and origin='system_seed'")).resolves.toBe(7);
    await expect(count("v2_type_presentation_profiles", "where status='candidate' and icon_key='type.movie'")).resolves.toBe(1);
    const typeReview = await db.prepare(`select id from v2_review_items where json_extract(payload_json,'$.code')='type_confirmation' limit 1`).first<{ id: string }>();
    if (!typeReview) throw new Error("Expected a type confirmation review.");
    await expect(new D1ReviewRepository(db, "user-a").resolve(typeReview.id, { action: "accept", now: "2026-08-12T09:29:00.000Z" })).resolves.toMatchObject({ resultStatus: "accepted" });
    await expect(count("v2_type_definitions", "where key='movie_review' and status='active' and user_pinned=1")).resolves.toBe(1);
    await expect(count("v2_object_type_assignments", "where review_status='accepted' and locked_by_user=1")).resolves.toBe(1);
    await db.prepare(
      `insert into v2_type_presentation_profiles
       (id,user_id,type_definition_id,icon_key,accent_role,default_record_preset_key,source,version,status,created_at,updated_at)
       select 'profile-invalid','user-a',id,'runtime.ai.svg','neutral','runtime.ai.jsx','user',2,'active',?,? from v2_type_definitions where user_id='user-a' and key='movie_review'`,
    ).bind("2026-08-12T09:30:00.000Z", "2026-08-12T09:30:00.000Z").run();
    const presentation = await new D1PresentationRepository(db, "user-a").project(capture.objectId);
    expect(presentation.displayType).toMatchObject({ typeKey: "movie_review", iconKey: "type.movie", status: "active", tentative: false, recordPresetKey: "record.media-review.v1" });
    expect(presentation.highlights[0]).toMatchObject({ fieldKey: "user_rating", renderer: "rating", sourceLabel: "원문에서 명시함", reviewStatus: "accepted" });
    expect(presentation.sections[0].fields[0].evidence).toHaveLength(1);
    await expect(new D1PresentationRepository(db, "user-a").project(capture.objectId, true)).resolves.toMatchObject({ highlights: [], sections: [], reviewItems: [] });
    const entityReview = await db.prepare(`select id from v2_review_items where json_extract(payload_json,'$.code')='entity_resolution' limit 1`).first<{ id: string }>();
    if (!entityReview) throw new Error("Expected an entity resolution review.");
    await expect(new D1ReviewRepository(db, "user-a").resolve(entityReview.id, { action: "accept", now: "2026-08-12T10:00:00.000Z" })).resolves.toMatchObject({ resultStatus: "accepted" });
    const connected = await new D1PresentationRepository(db, "user-a").project(capture.objectId);
    expect(connected.connections[0]).toMatchObject({ predicateKey: "mentions_entity", targetKind: "entity", sourceLabel: "AI 해석" });
    await expect(count("v2_entity_records", "where resolution_status='resolved'")).resolves.toBe(1);
    await expect(count("v2_relation_edges", "where review_status='accepted' and locked_by_user=1")).resolves.toBe(1);
    const run = await db.prepare(`select * from v2_processing_runs limit 1`).first<Record<string, unknown>>();
    expect(JSON.stringify(run)).not.toContain("별점 4.5");
    await expect(queue.getCaptureProcessing(capture.captureId, "user-a")).resolves.toMatchObject({ processing_status: "enriching", job_status: "queued" });
  });

  test("one lease means repeated runners call the provider once", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const gateway = new FakeV2StructuredModelGateway("success", envelope(capture));
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => runNextAnalysisJob({ queue, gateway, workerId: `worker-${index}` })));
    expect(results.filter((result) => result.outcome === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "idle")).toHaveLength(19);
    expect(gateway.calls).toHaveLength(1);
    await expect(count("v2_analysis_proposals")).resolves.toBe(1);
  });

  test("routes only allowlisted public-entity requests to the grounded role and stores cited output", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope(capture)), workerId: "analysis-worker" });
    const grounded = new FakeV2GroundedResearchGateway("success");
    await expect(runNextGroundingJob({ queue, gateway: grounded, workerId: "grounded-worker" })).resolves.toMatchObject({ outcome: "succeeded" });
    expect(grounded.calls).toHaveLength(1);
    expect(grounded.calls[0].prompt).toContain('"entity_kind":"work"');
    expect(grounded.calls[0].prompt).not.toContain(capture.bodyMarkdown);
    await expect(count("v2_grounding_results", "where status='cited'")).resolves.toBe(1);
    await expect(count("v2_property_values", "where source_class='external_grounded' and review_status='accepted'")).resolves.toBe(2);
    await expect(count("v2_evidence_refs", "where target_kind='property_value' and locator_kind='external_url'")).resolves.toBe(2);
    const result = await db.prepare(`select citations_json from v2_grounding_results limit 1`).first<{ citations_json: string }>();
    expect(JSON.parse(result?.citations_json ?? "[]")[0].url).toBe("https://example.test/work");
    const presentation = await new D1PresentationRepository(db, "user-a").project(capture.objectId);
    const external = presentation.sections.find((section) => section.key === "external_facts");
    expect(external?.fields.map((field) => ({ key: field.fieldKey, source: field.sourceLabel }))).toEqual([
      { key: "cast", source: "외부 출처" },
      { key: "director", source: "외부 출처" },
    ]);
    expect(external?.fields[0].evidence[0].locator).toMatchObject({ url: "https://example.test/work" });
    await expect(queue.getCaptureProcessing(capture.captureId, "user-a")).resolves.toMatchObject({ processing_status: "completed", job_status: "succeeded" });
  });

  test("ignores foreign property rows when deciding grounded conflicts and registry usage", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope(capture)), workerId: "owner-fence-analysis" })).resolves.toMatchObject({ outcome: "succeeded" });
    await db.batch([
      db.prepare(
        `insert into v2_field_definitions
         (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
         values ('owner-fence-director','user-a','director','감독','감독','short_text','candidate','ai_proposed',1,0,'2026-08-12T09:02:00.000Z','2026-08-12T09:02:00.000Z')`,
      ),
      db.prepare("insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values ('owner-fence-object-2','user-a','entity','active','2026-08-12T09:02:00.000Z','2026-08-12T09:02:00.000Z')"),
      db.prepare("insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values ('owner-fence-object-3','user-a','entity','active','2026-08-12T09:02:00.000Z','2026-08-12T09:02:00.000Z')"),
      ...[
        ["owner-fence-foreign-1", capture.objectId, "악성 감독"],
        ["owner-fence-foreign-2", "owner-fence-object-2", "악성 감독 2"],
        ["owner-fence-foreign-3", "owner-fence-object-3", "악성 감독 3"],
      ].map(([id, objectId, value]) => db.prepare(
        `insert into v2_property_values
         (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
         values (?,'user-b',?,'owner-fence-director','text',?,?,'ai_inferred','low','accepted',0,'2026-08-12T09:02:00.000Z')`,
      ).bind(id, objectId, value, JSON.stringify(value))),
    ]);

    await expect(runNextGroundingJob({ queue, gateway: new FakeV2GroundedResearchGateway("success"), workerId: "owner-fence-grounding" })).resolves.toMatchObject({ outcome: "succeeded" });
    await expect(db.prepare("select user_id,review_status,value_text from v2_property_values where field_definition_id='owner-fence-director' and source_class='external_grounded'").first()).resolves.toEqual({ user_id: "user-a", review_status: "accepted", value_text: "홍길동" });
    await expect(db.prepare("select status,usage_count from v2_field_definitions where id='owner-fence-director'").first()).resolves.toEqual({ status: "candidate", usage_count: 1 });
    await expect(count("v2_review_items", "where kind='value_conflict' and payload_json like '%director%' ")).resolves.toBe(0);
  });

  test("never commits a grounded answer without an HTTPS citation", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope(capture)), workerId: "analysis-worker" });
    const noCitation = new FakeV2GroundedResearchGateway("success", { citations: [] });
    await expect(runNextGroundingJob({ queue, gateway: noCitation, workerId: "grounded-worker" })).resolves.toMatchObject({ outcome: "needs_review" });
    await expect(count("v2_grounding_results")).resolves.toBe(0);
    await expect(count("v2_grounding_requests", "where status='needs_review'")).resolves.toBe(1);
  });

  test("rejects cited prose that does not satisfy the structured grounded field contract", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope(capture)), workerId: "analysis-worker" });
    const prose = new FakeV2GroundedResearchGateway("success", { answer: "감독은 홍길동입니다." });
    await expect(runNextGroundingJob({ queue, gateway: prose, workerId: "grounded-worker" })).resolves.toMatchObject({ outcome: "needs_review" });
    await expect(count("v2_grounding_results")).resolves.toBe(0);
    await expect(count("v2_property_values", "where source_class='external_grounded'")).resolves.toBe(0);
  });

  test("rejects high-risk accepted claims and keeps them out of active proposals", async () => {
    const capture = await seed();
    const invalid = envelope(capture, { field_proposals: [{ ...envelope(capture).field_proposals[0], claim_risk: "social_high_risk", disposition: "accepted" }] });
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", invalid), workerId: "worker-a" })).resolves.toMatchObject({ outcome: "needs_review" });
    await expect(count("v2_analysis_proposals")).resolves.toBe(0);
    await expect(count("v2_processing_jobs", "where status='needs_review'")).resolves.toBe(1);
  });

  test("commits a social high-risk interpretation only as a proposed value with a review item", async () => {
    const capture = await seed();
    const risky = envelope(capture, {
      field_proposals: [{
        temp_id: "field-risk", field_key: "other_person_intent", value: "wanted reconciliation", value_type: "text",
        claim_risk: "social_high_risk", disposition: "proposed", evidence_refs: [{ source_item_id: capture.sources[0].id, start: 0, end: 5 }],
      }],
      enrichment_requests: [],
    });
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", risky), workerId: "risk-worker" })).resolves.toMatchObject({ outcome: "succeeded" });
    await expect(count("v2_property_values", "where claim_risk='social_high_risk' and review_status='proposed' and source_class='ai_inferred'")).resolves.toBe(1);
    await expect(count("v2_property_values", "where claim_risk='social_high_risk' and review_status='accepted'")).resolves.toBe(0);
    await expect(count("v2_review_items", "where kind='high_risk_claim' and status='open'")).resolves.toBe(1);
    const review = await db.prepare(`select id from v2_review_items where kind='high_risk_claim' limit 1`).first<{ id: string }>();
    if (!review) throw new Error("Expected a high-risk review item.");
    const reviews = new D1ReviewRepository(db, "user-a");
    await expect(reviews.resolve(review.id, { action: "accept", confirmHighRisk: false })).rejects.toMatchObject({ code: "high_risk_confirmation_required" });
    await expect(reviews.resolve(review.id, { action: "accept", confirmHighRisk: true, now: "2026-08-12T10:00:00.000Z" })).resolves.toMatchObject({ action: "accept", resultStatus: "accepted", replayed: false });
    await expect(count("v2_property_values", "where claim_risk='social_high_risk' and review_status='accepted' and source_class='ai_inferred' and confirmed_by_user_at is not null and locked_by_user=1")).resolves.toBe(1);
    await expect(count("v2_review_receipts", "where action='accept' and high_risk_confirmed=1")).resolves.toBe(1);
    await expect(reviews.resolve(review.id, { action: "accept", confirmHighRisk: true })).resolves.toMatchObject({ replayed: true });
  });

  test("lets the user correct an AI value while retaining the proposal and immutable receipt", async () => {
    const capture = await seed();
    const proposed = envelope(capture, {
      entity_proposals: [], enrichment_requests: [],
      field_proposals: [{ ...envelope(capture).field_proposals[0], disposition: "proposed" }],
    });
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", proposed), workerId: "correction-worker" })).resolves.toMatchObject({ outcome: "succeeded" });
    const review = await db.prepare(`select id from v2_review_items where json_extract(payload_json,'$.code')='field_confirmation' limit 1`).first<{ id: string }>();
    if (!review) throw new Error("Expected a field confirmation review.");
    await expect(new D1ReviewRepository(db, "user-a").resolve(review.id, { action: "correct", correctedValue: 4, now: "2026-08-12T10:00:00.000Z" })).resolves.toMatchObject({ action: "correct", resultStatus: "corrected", replayed: false });
    await expect(count("v2_property_values", "where review_status='superseded' and value_number=4.5 and superseded_at is not null")).resolves.toBe(1);
    await expect(count("v2_property_values", "where review_status='accepted' and value_number=4 and source_class='user_locked' and locked_by_user=1")).resolves.toBe(1);
    const receipt = await db.prepare(`select action,corrected_value_json,target_kind from v2_review_receipts where review_item_id=?`).bind(review.id).first<{ action: string; corrected_value_json: string; target_kind: string }>();
    expect(receipt).toEqual({ action: "correct", corrected_value_json: "4", target_kind: "property_value" });
    const presentation = await new D1PresentationRepository(db, "user-a").project(capture.objectId);
    expect(presentation.highlights[0]).toMatchObject({ value: 4, sourceClass: "user_locked", lockedByUser: true });
  });

  test("lists only open review records and hides restricted records without an active grant", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope(capture, { enrichment_requests: [] })), workerId: "review-list-worker" });
    const reviews = new D1ReviewRepository(db, "user-a");
    await expect(reviews.listOpenRecords(false)).resolves.toEqual([expect.objectContaining({ recordId: capture.objectId, openCount: 2, privacyLevel: "normal" })]);
    await db.prepare(`update v2_documents set privacy_level='restricted' where object_id=?`).bind(capture.objectId).run();
    await expect(reviews.listOpenRecords(false)).resolves.toEqual([]);
    await expect(reviews.listOpenRecords(true)).resolves.toEqual([expect.objectContaining({ recordId: capture.objectId, privacyLevel: "restricted" })]);
  });

  test("keeps a user-locked value accepted and records a different AI extraction as disputed", async () => {
    const capture = await seed();
    await db.prepare(
      `insert into v2_field_definitions
       (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
       values ('field-user-rating','user-a','user_rating','User rating','User-controlled rating','rating','active','user_created',1,1,?,?)`,
    ).bind("2026-08-12T09:00:01.000Z", "2026-08-12T09:00:01.000Z").run();
    await db.prepare(
      `insert into v2_property_values
       (id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
       values ('locked-rating','user-a',?,'field-user-rating','rating',5,'5','user_locked','low','accepted',1,?)`,
    ).bind(capture.objectId, "2026-08-12T09:00:01.000Z").run();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope(capture, { enrichment_requests: [] })), workerId: "conflict-worker" })).resolves.toMatchObject({ outcome: "succeeded" });
    const accepted = await db.prepare(`select value_number,source_class,locked_by_user from v2_property_values where owner_object_id=? and review_status='accepted'`).bind(capture.objectId).first<{ value_number: number; source_class: string; locked_by_user: number }>();
    expect(accepted).toEqual({ value_number: 5, source_class: "user_locked", locked_by_user: 1 });
    await expect(count("v2_property_values", "where review_status='disputed' and value_number=4.5")).resolves.toBe(1);
    await expect(count("v2_review_items", "where kind='value_conflict' and status='open'")).resolves.toBe(1);
    const review = await db.prepare(`select id from v2_review_items where kind='value_conflict' limit 1`).first<{ id: string }>();
    if (!review) throw new Error("Expected a value conflict review item.");
    await expect(new D1ReviewRepository(db, "user-a").resolve(review.id, { action: "accept", now: "2026-08-12T10:00:00.000Z" })).resolves.toMatchObject({ resultStatus: "accepted" });
    await expect(count("v2_property_values", "where id='locked-rating' and review_status='superseded' and superseded_at is not null")).resolves.toBe(1);
    await expect(count("v2_property_values", "where review_status='accepted' and value_number=4.5 and source_class='user_explicit' and locked_by_user=1")).resolves.toBe(1);
  });

  test("provider outage schedules retry while source remains readable", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("provider_unavailable"), workerId: "worker-a" })).resolves.toMatchObject({ outcome: "retry_wait" });
    await expect(new D1SourceFoundationRepository(db, "user-a").getRecord(capture.objectId)).resolves.toMatchObject({ bodyMarkdown: capture.bodyMarkdown });
    await expect(count("v2_processing_jobs", "where status='retry_wait'")).resolves.toBe(1);
  });

  test("opens a shared role circuit after repeated provider failures and closes it only after a successful probe", async () => {
    const governor = new D1AiRuntimeGovernor(db);
    const first = new Date("2026-08-12T11:00:00.000Z");
    await expect(governor.tryAcquire("main_analyzer", "probe-1", first)).resolves.toMatchObject({ allowed: true });
    await governor.recordFailure("main_analyzer", "probe-1", "provider_unavailable", first);
    await expect(governor.tryAcquire("main_analyzer", "too-early", new Date("2026-08-12T11:00:10.000Z"))).resolves.toMatchObject({ allowed: false, state: "throttled" });

    const second = new Date("2026-08-12T11:00:31.000Z");
    await governor.tryAcquire("main_analyzer", "probe-2", second);
    await governor.recordFailure("main_analyzer", "probe-2", "timeout", second);
    const third = new Date("2026-08-12T11:01:32.000Z");
    await governor.tryAcquire("main_analyzer", "probe-3", third);
    await governor.recordFailure("main_analyzer", "probe-3", "provider_unavailable", third);
    await expect(governor.inspect("main_analyzer")).resolves.toMatchObject({ state: "circuit_open", consecutive_failures: 3 });
    await expect(governor.tryAcquire("main_analyzer", "blocked", new Date("2026-08-12T11:02:00.000Z"))).resolves.toMatchObject({ allowed: false, state: "circuit_open" });

    const recovery = new Date("2026-08-12T11:03:33.000Z");
    await expect(governor.tryAcquire("main_analyzer", "recovery", recovery)).resolves.toMatchObject({ allowed: true, state: "circuit_open" });
    await governor.recordSuccess("main_analyzer", "recovery", recovery);
    await expect(governor.inspect("main_analyzer")).resolves.toMatchObject({ state: "healthy", consecutive_failures: 0, retry_after: null });
  });

  test("quota pause is role-specific and prevents claiming or calling the provider", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending(10, "2026-08-12T12:00:00.000Z");
    const governor = new D1AiRuntimeGovernor(db);
    const pausedAt = new Date("2026-08-12T12:00:01.000Z");
    await governor.tryAcquire("main_analyzer", "quota-probe", pausedAt);
    await governor.recordFailure("main_analyzer", "quota-probe", "quota_exhausted", pausedAt);
    const gateway = new FakeV2StructuredModelGateway("success", envelope(capture));

    await expect(runNextAnalysisJob({ queue, gateway, governor, workerId: "paused-worker", now: new Date("2026-08-12T12:00:02.000Z") })).resolves.toMatchObject({ outcome: "paused", state: "quota_exhausted" });
    expect(gateway.calls).toHaveLength(0);
    const job = await db.prepare(`select status,attempt from v2_processing_jobs where stage='analyze' limit 1`).first<{ status: string; attempt: number }>();
    expect(job).toEqual({ status: "queued", attempt: 0 });
    await expect(governor.tryAcquire("grounded_enricher", "independent-role", pausedAt)).resolves.toMatchObject({ allowed: true, state: "healthy" });
  });

  test("a provider-reported daily quota pauses until the reported time, capped at 26 hours", async () => {
    const governor = new D1AiRuntimeGovernor(db);
    const pausedAt = new Date("2026-08-12T12:00:00.000Z");
    await governor.tryAcquire("main_analyzer", "daily-probe", pausedAt);
    await governor.recordFailure("main_analyzer", "daily-probe", "quota_exhausted", pausedAt, 10 * 60 * 60_000);
    await expect(governor.inspect("main_analyzer")).resolves.toMatchObject({ state: "quota_exhausted", retry_after: "2026-08-12T22:00:00.000Z" });
    await expect(governor.tryAcquire("main_analyzer", "too-early", new Date("2026-08-12T21:59:00.000Z"))).resolves.toMatchObject({ allowed: false, state: "quota_exhausted" });
    await expect(governor.tryAcquire("main_analyzer", "after-reset", new Date("2026-08-12T22:00:01.000Z"))).resolves.toMatchObject({ allowed: true });
    await governor.recordFailure("main_analyzer", "after-reset", "quota_exhausted", pausedAt, 90 * 60 * 60_000);
    await expect(governor.inspect("main_analyzer")).resolves.toMatchObject({ retry_after: "2026-08-13T14:00:00.000Z" });
  });

  test("quota rejections wait for the quota window without consuming the job's attempts", async () => {
    await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending(10, "2026-08-12T12:00:00.000Z");
    const retryAfterMs = 6 * 60 * 60_000;
    let now = new Date("2026-08-12T12:00:01.000Z");
    for (let failure = 0; failure < 6; failure += 1) {
      const gateway = { calls: 0, async generate() { this.calls += 1; throw new V2ModelError("quota_exhausted", "Daily quota exhausted.", true, retryAfterMs); } };
      await expect(runNextAnalysisJob({ queue, gateway, workerId: `quota-worker-${failure}`, now })).resolves.toMatchObject({ outcome: "retry_wait" });
      expect(gateway.calls).toBe(1);
      const job = await db.prepare(`select status,attempt,max_attempts,next_attempt_at,last_error_code from v2_processing_jobs where stage='analyze' limit 1`)
        .first<{ status: string; attempt: number; max_attempts: number; next_attempt_at: string; last_error_code: string }>();
      expect(job).toMatchObject({ status: "retry_wait", attempt: 0, last_error_code: "quota_exhausted" });
      // The runner clock advances with real elapsed time after `now`.
      expect(Date.parse(job!.next_attempt_at)).toBeGreaterThanOrEqual(now.getTime() + retryAfterMs);
      expect(Date.parse(job!.next_attempt_at)).toBeLessThan(now.getTime() + retryAfterMs + 60_000);
      now = new Date(Date.parse(job!.next_attempt_at) + 1_000);
    }
    const capture = await db.prepare(`select processing_status from v2_capture_bundles limit 1`).first<{ processing_status: string }>();
    expect(capture?.processing_status).toBe("failed_retryable");
  });

  test("a result arriving after a user revision is retained as stale and never promoted", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending(10, "2026-08-12T10:00:00.000Z");
    const claimed = await queue.claim("manual-worker", new Date("2026-08-12T10:00:01.000Z"));
    if (!claimed) throw new Error("Expected a claimed job.");
    const runId = "run-stale";
    await queue.beginRun(claimed, { runId, modelId: "fake:main", promptVersion: "analysis-main-v1", schemaVersion: "analysis-v1", registryVersion: "registry-bootstrap-v1", modelConfigVersion: "gemini-roles-v1", now: "2026-08-12T10:00:00.000Z" });
    const edit = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: capture.revisionId, title: capture.title, bodyMarkdown: `${capture.bodyMarkdown}\n사용자 수정`, writtenAt: null, documentStatus: "revising", privacyLevel: "normal" }, "stale-edit", "2026-08-12T10:01:00.000Z");
    await new D1DocumentAuthoringRepository(db, "user-a").saveRevision(capture.objectId, edit);
    await expect(queue.completeAnalysis({ job: claimed, runId, envelope: envelope(capture), outputHash: "output-stale", modelId: "fake:main", latencyMs: 1, inputTokens: 10, outputTokens: 20, schemaVersion: "analysis-v1", validatorVersion: "analysis-semantic-v1", now: "2026-08-12T10:02:00.000Z" })).resolves.toEqual({ stale: true });
    await expect(count("v2_analysis_proposals", "where status='stale'")).resolves.toBe(1);
    const document = await db.prepare(`select body_markdown,analyzed_revision_id from v2_documents where object_id=?`).bind(capture.objectId).first<{ body_markdown: string; analyzed_revision_id: string | null }>();
    expect(document).toMatchObject({ body_markdown: edit.bodyMarkdown, analyzed_revision_id: null });
    await expect(count("v2_property_values")).resolves.toBe(0);
    await expect(count("v2_object_type_assignments")).resolves.toBe(0);
  });
});
