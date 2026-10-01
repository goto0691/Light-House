import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit, type CapturePrivacyLevel } from "@/lib/v2/domain/capture-source";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1RediscoveryRepository } from "@/lib/v2/infrastructure/d1/rediscovery-repository";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import { validateTemplateSubmission } from "@/lib/v2/templates/template-definition-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const sourceOwnerFenceMigration = fileURLToPath(new URL("../../../../../migrations/0028_v2_fts_source_owner_fence.sql", import.meta.url));
const migrations = ["0006_v2_source_and_document_foundation.sql", "0007_v2_document_authoring.sql", "0008_v2_ai_processing.sql", "0009_v2_grounded_enrichment.sql", "0010_v2_ai_runtime_governor.sql", "0011_v2_adaptive_knowledge.sql", "0012_v2_review_actions.sql", "0013_v2_entities_relations_and_presentation.sql", "0014_v2_retrieval_and_saved_views.sql", "0015_v2_adaptive_capture_templates.sql", "0016_v2_opt_in_rediscovery.sql"].map((name) => fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url))).concat(sourceOwnerFenceMigration);
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
let db: TestD1;

async function applySql(path: string) { for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run(); }
async function reset() {
  await db.exec(`delete from v2_rediscovery_events; delete from v2_rediscovery_preferences;`);
  await db.exec(`delete from v2_capture_input_values; delete from v2_capture_template_sessions; delete from v2_template_source_links; delete from v2_template_pattern_observations; delete from v2_capture_template_versions; delete from v2_capture_templates; delete from v2_saved_views; delete from v2_type_presentation_profiles; delete from v2_unit_definitions; delete from v2_relation_edges; delete from v2_predicate_definitions; delete from v2_event_records; delete from v2_entity_records; delete from v2_review_receipts; delete from v2_evidence_refs; delete from v2_review_items; delete from v2_property_values; delete from v2_object_type_assignments; delete from v2_field_definitions; delete from v2_type_definitions; delete from v2_ai_runtime_state; delete from v2_grounding_results; delete from v2_grounding_requests; delete from v2_analysis_proposals; delete from v2_restricted_grants; delete from v2_idempotency_records; delete from v2_audit_events; delete from v2_processing_runs; delete from v2_processing_jobs; delete from v2_processing_outbox; delete from v2_deletion_tombstones; delete from v2_document_source_links; delete from v2_document_revisions; delete from v2_documents; delete from v2_objects; delete from v2_source_attachment_links; delete from v2_source_items; delete from v2_attachment_reservations; delete from v2_capture_bundles; delete from v2_documents_fts;`);
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false, envFiles: [] });
  db = platform.env.DB;
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');`);
  for (const migration of migrations) await applySql(migration);
});

describe("V2 adaptive capture templates", () => {
  test("keeps generated patterns inactive through three separate dates until explicit try and keep", async () => {
    const repository = new D1TemplateRepository(db, "user-a");
    for (const [index, day] of ["2026-08-01", "2026-08-04", "2026-08-09"].entries()) {
      const source = await capture(`운동 ${index}`, `${index + 3}km 달리기`, "normal", day);
      await db.prepare("update v2_capture_bundles set ai_enabled=1 where id=? and user_id='user-a'").bind(source.captureId).run();
      const result = await repository.observePattern({ patternSignature: "workout.pattern.v1", sourceDocumentId: source.objectId, sourceRevisionId: source.revisionId, observedDate: day, typeKey: "workout_log", features: { fields: ["distance_km", "duration_min", "average_heart_rate"] }, candidateDefinition: SYSTEM_TEMPLATE_SEEDS[1].definition, sourceModel: "fake-model", promptVersion: "pattern-v1" }, `${day}T10:00:00.000Z`);
      if (index < 2) expect(result.generated).toBe(false);
      else expect(result.template).toMatchObject({ status: "generated_draft", usageCount: 0 });
    }
    expect(await repository.list({ captureEligibleOnly: true })).toEqual([]);
    const generated = (await repository.list()).find((template) => template.patternSignature === "workout.pattern.v1");
    if (!generated) throw new Error("Expected generated template.");
    await expect(db.prepare("select count(*) as value from v2_template_source_links where template_version_id=? and role='pattern_source'").bind(generated.currentVersionId).first()).resolves.toEqual({ value: 3 });
    await expect(db.prepare("select outcome,count(*) as value from v2_template_pattern_observations where user_id='user-a' and pattern_signature='workout.pattern.v1' group by outcome").all()).resolves.toMatchObject({ results: [{ outcome: "generated", value: 3 }] });
    await expect(repository.transition(generated.id, "try")).resolves.toMatchObject({ status: "trial" });
    await expect(repository.transition(generated.id, "keep")).resolves.toMatchObject({ status: "active", pinned: false });
  });

  test("fails closed when a template points at another template's current version", async () => {
    const ownRepository = new D1TemplateRepository(db, "user-a");
    const foreignRepository = new D1TemplateRepository(db, "user-b");
    const ownTemplate = await ownRepository.createDraft({ definition: SYSTEM_TEMPLATE_SEEDS[0].definition });
    const foreignTemplate = await foreignRepository.createDraft({ definition: SYSTEM_TEMPLATE_SEEDS[1].definition });
    if (!ownTemplate || !foreignTemplate) throw new Error("Expected both template drafts.");

    await db.prepare("update v2_capture_templates set current_version_id=? where id=? and user_id='user-a'").bind(foreignTemplate.currentVersionId, ownTemplate.id).run();

    await expect(ownRepository.get(ownTemplate.id)).resolves.toBeNull();
    await expect(ownRepository.getByVersion(foreignTemplate.currentVersionId)).resolves.toBeNull();
    expect((await ownRepository.list()).some((template) => template.id === ownTemplate.id)).toBe(false);
    await expect(foreignRepository.get(foreignTemplate.id)).resolves.toMatchObject({ id: foreignTemplate.id, currentVersionId: foreignTemplate.currentVersionId });
  });

  test("commits template input source and deterministic user-locked fields in the source transaction", async () => {
    const templates = new D1TemplateRepository(db, "user-a");
    await templates.ensureSystemSeeds("2026-08-12T09:00:00.000Z");
    const review = (await templates.list({ captureEligibleOnly: true })).find((template) => template.name === "리뷰 기록");
    if (!review) throw new Error("Expected review seed.");
    const appliedAt = "2026-08-12T09:10:00.000Z";
    const submission = validateTemplateSubmission({ templateVersionId: review.currentVersionId, appliedAt, inputs: [
      { itemKey: "subject_name", valueKind: "text", value: "봄날", blankState: "answered", inputOrder: 0, clientTimestamp: appliedAt },
      { itemKey: "experienced_at", valueKind: "date", value: "2026-08-11", blankState: "answered", inputOrder: 1, clientTimestamp: appliedAt },
      { itemKey: "companions", valueKind: "json", value: null, blankState: "withheld", inputOrder: 2, clientTimestamp: appliedAt },
      { itemKey: "user_rating", valueKind: "rating", value: 4.5, blankState: "answered", inputOrder: 3, clientTimestamp: appliedAt },
    ] }, review.definition);
    const prepared = await prepareCaptureCommit({ draftId: "template-capture", channel: "web", title: null, bodyMarkdown: "", aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: appliedAt }, "template-capture-key", "2026-08-12T09:10:01.000Z", { templateId: review.id, definition: review.definition, submission });
    await new D1SourceFoundationRepository(db, "user-a").commitCapture(prepared);
    expect(await db.prepare(`select count(*) as value from v2_capture_input_values`).first<{ value: number }>()).toEqual({ value: 4 });
    expect(await db.prepare(`select written_at,template_version_id from v2_documents d join v2_capture_bundles c on c.id=d.capture_id where d.object_id=?`).bind(prepared.objectId).first()).toMatchObject({ written_at: "2026-08-11", template_version_id: review.currentVersionId });
    expect(await db.prepare(`select p.value_number,p.source_class,p.review_status,p.locked_by_user from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id where p.owner_object_id=? and f.key='user_rating'`).bind(prepared.objectId).first()).toMatchObject({ value_number: 4.5, source_class: "user_explicit", review_status: "accepted", locked_by_user: 1 });
    expect(await db.prepare(`select blank_state,value_json from v2_capture_input_values where item_key='companions'`).first()).toMatchObject({ blank_state: "withheld", value_json: null });
  });
});
beforeEach(reset);
afterAll(async () => platform.dispose());

async function capture(title: string, body: string, privacyLevel: CapturePrivacyLevel, day: string, extraSource?: string) {
  const prepared = await prepareCaptureCommit({
    draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: body, aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel,
    capturedAt: `${day}T09:00:00.000Z`,
    sources: extraSource ? [{ kind: "image", rawText: extraSource, contentHash: "0".repeat(64) }] : [],
  }, crypto.randomUUID(), `${day}T09:00:01.000Z`);
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(prepared);
  return prepared;
}

describe("V2 deterministic retrieval", () => {
  test("pages beyond the first fifty matches without exposing restricted rows in totals", async () => {
    const repository = new D1RetrievalRepository(db, "user-a");
    for (let index = 0; index < 53; index += 1) await capture(`집 기록 ${String(index).padStart(2, "0")}`, "pagination 집 기록", "normal", "2026-08-12");
    await capture("집 잠금 기록", "pagination 집 기록", "restricted", "2026-08-12");
    for (const fullText of [null, "pagination", "집"]) {
      const plan = defaultV2QueryPlan({ fullText, sort: { field: "title", direction: "asc" } });
      const first = await repository.searchPage(plan, false, 1);
      const second = await repository.searchPage(plan, false, 2);
      expect(first).toMatchObject({ totalCount: 53, page: 1, pageSize: 50, totalPages: 2 });
      expect(first.results).toHaveLength(50);
      expect(second.results).toHaveLength(3);
      expect(new Set([...first.results, ...second.results].map((row) => row.recordId)).size).toBe(53);
      expect((await repository.searchPage(plan, false, 999)).page).toBe(2);
    }
  }, 60_000);
  test("keeps ownerless cross-user source links out of fallback and FTS search", async () => {
    const visible = await capture("내 기록", "현재 사용자의 본문", "normal", "2026-08-12");
    const foreign = await prepareCaptureCommit({
      draftId: "foreign-source-capture",
      channel: "web",
      title: "다른 사용자의 기록",
      bodyMarkdown: "다른 사용자의 본문",
      aiEnabled: false,
      clientTimezone: "Asia/Seoul",
      privacyLevel: "normal",
      capturedAt: "2026-08-12T09:10:00.000Z",
      sources: [
        { kind: "text", rawText: "타인만아는장부", contentHash: "a".repeat(64) },
        { kind: "image", rawText: "비밀", contentHash: "b".repeat(64) },
      ],
    }, "foreign-source-capture-key", "2026-08-12T09:10:01.000Z");
    await new D1SourceFoundationRepository(db, "user-b").commitCapture(foreign);

    await db.prepare(
      `insert into v2_document_source_links (document_object_id,source_item_id,role,source_order,created_at)
       values (?,?,'evidence',90,'2026-08-12T09:11:00.000Z')`,
    ).bind(visible.objectId, foreign.sources[0]!.id).run();
    await db.prepare("update v2_documents_fts set source_text='타인만아는장부 비밀' where object_id=?").bind(visible.objectId).run();

    // Reapplying the forward-only repair simulates upgrading an index that was
    // populated by the pre-0028 trigger.
    await applySql(sourceOwnerFenceMigration);
    await db.prepare(
      `insert into v2_document_source_links (document_object_id,source_item_id,role,source_order,created_at)
       values (?,?,'evidence',91,'2026-08-12T09:12:00.000Z')`,
    ).bind(visible.objectId, foreign.sources[1]!.id).run();

    const indexed = await db.prepare("select source_text from v2_documents_fts where object_id=?").bind(visible.objectId).first<{ source_text: string }>();
    expect(indexed?.source_text).toContain("현재 사용자의 본문");
    expect(indexed?.source_text).not.toContain("타인만아는장부");
    expect(indexed?.source_text).not.toContain("비밀");
    const repository = new D1RetrievalRepository(db, "user-a");
    await expect(repository.search(defaultV2QueryPlan({ fullText: "타인만아는장부" }))).resolves.toEqual([]);
    await expect(repository.search(defaultV2QueryPlan({ fullText: "비밀" }))).resolves.toEqual([]);
  });

  test("fails closed across detail, library, timeline, and rediscovery when a document points at a foreign capture", async () => {
    const record = await capture("손상된 소유권 기록", "현재 사용자의 본문", "normal", "2026-04-05");
    await db.prepare(
      `insert into v2_capture_bundles
       (id,user_id,draft_id,capture_channel,user_note,ai_enabled,client_timezone,processing_status,processing_priority,content_hash,captured_at,committed_at,created_at)
       values ('foreign-orphan-capture','user-b','foreign-orphan-draft','import',null,0,'Asia/Seoul','completed','migration',?,'2025-01-02T03:04:05.000Z','2025-01-02T03:04:06.000Z','2025-01-02T03:04:06.000Z')`,
    ).bind("f".repeat(64)).run();
    await db.prepare("update v2_documents set capture_id='foreign-orphan-capture' where object_id=?").bind(record.objectId).run();

    await expect(new D1SourceFoundationRepository(db, "user-a").getRecord(record.objectId)).resolves.toBeNull();
    await expect(new D1DocumentAuthoringRepository(db, "user-a").listRecords()).resolves.toEqual([]);
    await expect(new D1RetrievalRepository(db, "user-a").listTimelineFacets()).resolves.toEqual([]);
    const rediscovery = new D1RediscoveryRepository(db, "user-a");
    const now = new Date("2026-08-12T10:00:00.000Z");
    await rediscovery.updatePreference({ enabled: true, includeSensitive: false }, now.toISOString());
    await expect(rediscovery.deck(now)).resolves.toEqual([]);
  });

  test("searches Korean title, body, and OCR while applying sensitive and restricted projection", async () => {
    const run = await capture("서울숲 아침 달리기", "오늘은 5km를 달렸다.", "normal", "2026-08-12", "운동 캡처 평균 심박 148");
    await capture("비밀 독후감", "기억과 장소에 대한 사적인 감상", "sensitive", "2026-08-11");
    const restricted = await capture("숨겨진 게임 리뷰", "은빛 항해자 엔딩 감상", "restricted", "2026-08-10");
    const retrieval = new D1RetrievalRepository(db, "user-a");
    await expect(retrieval.search(defaultV2QueryPlan({ fullText: "서울숲" }))).resolves.toEqual([expect.objectContaining({ recordId: run.objectId, title: "서울숲 아침 달리기", privacyLevel: "normal" })]);
    await expect(retrieval.search(defaultV2QueryPlan({ fullText: "평균 심박" }))).resolves.toEqual([expect.objectContaining({ recordId: run.objectId, inclusionReasons: [expect.stringContaining("원본") ] })]);
    const sensitive = await retrieval.search(defaultV2QueryPlan({ fullText: "사적인 감상" }));
    expect(sensitive[0]).toMatchObject({ title: "비밀 독후감", privacyLevel: "sensitive", snippet: null });
    await expect(retrieval.search(defaultV2QueryPlan({ fullText: "은빛 항해자" }), false)).resolves.toEqual([]);
    await expect(retrieval.search(defaultV2QueryPlan({ fullText: "은빛 항해자" }), true)).resolves.toEqual([expect.objectContaining({ recordId: restricted.objectId, privacyLevel: "restricted", snippet: null })]);
  });

  test("executes allowlisted type, numeric property, entity, and date filters without embeddings", async () => {
    const matching = await capture("좋았던 영화", "영화 봄날을 보고 별점 4.5점을 남겼다.", "normal", "2026-08-12");
    await capture("평범한 영화", "다른 작품은 별점 3점이었다.", "normal", "2025-08-12");
    await db.exec(`
      insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at) values ('type-movie','user-a','movie_review','영화 리뷰','document','active','user_created','영화 감상',1,1,1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at) values ('assignment-movie','user-a','${matching.objectId}','type-movie','primary','user','accepted',1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at) values ('field-rating','user-a','user_rating','내 평점','평점','rating','active','user_created',1,1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,locked_by_user,created_at) values ('value-rating','user-a','${matching.objectId}','field-rating','rating',4.5,'4.5','user_explicit','low','accepted',1,'2026-08-12T10:00:00Z');
      insert into v2_predicate_definitions (id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at) values ('predicate-mention','user-a','mentions_entity','언급한 대상','문서가 언급함','active','system_seed',1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values ('entity-spring','user-a','entity','active','2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at) values ('entity-spring','work','봄날','resolved','2026-08-12T10:00:00Z');
      insert into v2_relation_edges (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,locked_by_user,created_at) values ('relation-spring','user-a','${matching.objectId}','predicate-mention','entity-spring','user_explicit','low','accepted',1,'2026-08-12T10:00:00Z');
    `);
    const results = await new D1RetrievalRepository(db, "user-a").search(defaultV2QueryPlan({
      typeKeys: ["movie_review"], propertyFilters: [{ fieldKey: "user_rating", operator: "gte", value: 4 }], entityFilters: [{ entityKind: "work", canonicalName: "봄날" }],
      dateFilter: { axis: "captured_at", from: "2026-01-01", to: "2026-12-31" }, sort: { field: "captured_at", direction: "desc" },
    }));
    expect(results).toEqual([expect.objectContaining({ recordId: matching.objectId, typeKey: "movie_review", inclusionReasons: expect.arrayContaining(["영화 리뷰 분류", "확인된 대상과 연결"]) })]);
  });

  test("keeps FTS synchronized when a document changes", async () => {
    const record = await capture("초기 제목", "초기 본문", "normal", "2026-08-12");
    await db.prepare(`update v2_documents set title='수정된 제목',body_markdown='새로운 등대 문장' where object_id=?`).bind(record.objectId).run();
    const results = await new D1RetrievalRepository(db, "user-a").search(defaultV2QueryPlan({ fullText: "새로운 등대" }));
    expect(results).toEqual([expect.objectContaining({ recordId: record.objectId, title: "수정된 제목" })]);
  });

  test("requires explicit rediscovery opt-in and a second sensitive-record choice while always excluding restricted records", async () => {
    const normal = await capture("봄 산책", "벚꽃길을 천천히 걸었다.", "normal", "2026-04-05");
    const sensitive = await capture("조용한 대화", "사적인 대화를 돌아봤다.", "sensitive", "2026-04-06");
    await capture("잠긴 회고", "절대로 자동 재노출하지 않는다.", "restricted", "2026-04-07");
    const repository = new D1RediscoveryRepository(db, "user-a");
    const now = new Date("2026-08-12T10:00:00.000Z");
    await expect(repository.deck(now)).resolves.toEqual([]);
    await expect(repository.recordEvent(normal.objectId, "shown")).rejects.toMatchObject({ code: "rediscovery_disabled" });
    await repository.updatePreference({ enabled: true, includeSensitive: false }, now.toISOString());
    await expect(repository.deck(now)).resolves.toEqual([expect.objectContaining({ recordId: normal.objectId, privacyLevel: "normal", snippet: expect.stringContaining("벚꽃길") })]);
    await repository.updatePreference({ enabled: true, includeSensitive: true }, now.toISOString());
    const withSensitive = await repository.deck(now);
    expect(withSensitive.map((item) => item.recordId)).toEqual([normal.objectId, sensitive.objectId]);
    expect(withSensitive.find((item) => item.recordId === sensitive.objectId)).toMatchObject({ snippet: null, privacyLevel: "sensitive" });
    await repository.recordEvent(normal.objectId, "shown", now.toISOString());
    await expect(repository.deck(now)).resolves.toEqual([expect.objectContaining({ recordId: sensitive.objectId })]);
  });

  test("does not project a cross-user type definition through a malformed assignment", async () => {
    const record = await capture("소유권이 분리된 기록", "내 기록의 본문", "normal", "2026-04-05");
    await db.batch([
      db.prepare(
        `insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
         values ('foreign-rediscovery-type','user-b','foreign_private_type','다른 사용자의 비밀 분류','document','active','user_created','foreign',1,1,0,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z')`,
      ),
      db.prepare(
        `insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
         values ('cross-owner-rediscovery-assignment','user-a',?,'foreign-rediscovery-type','primary','import','accepted',0,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z')`,
      ).bind(record.objectId),
    ]);
    const repository = new D1RediscoveryRepository(db, "user-a");
    const now = new Date("2026-08-12T10:00:00.000Z");
    await repository.updatePreference({ enabled: true, includeSensitive: false }, now.toISOString());

    const deck = await repository.deck(now);
    expect(deck).toEqual([expect.objectContaining({ recordId: record.objectId, typeLabel: "기록", iconKey: "type.document" })]);
    expect(JSON.stringify(deck)).not.toContain("다른 사용자의 비밀 분류");
    expect(JSON.stringify(deck)).not.toContain("foreign_private_type");
  });

  test("meets the sanitized deterministic top-10 recall baseline without embeddings", async () => {
    const restaurant = await capture("모모식당 연남점", "가지튀김이 맛있었고 데이트에 좋겠다. 별점은 4.5점.", "normal", "2024-04-05");
    const game = await capture("새 게임 감상", "엔딩의 선택이 오래 남았다.", "normal", "2024-05-03", "게임 타이틀 은빛 항해자");
    const book = await capture("기억의 지도 독후감", "장소와 기억을 엮는 문장이 좋았다.", "normal", "2024-06-08");
    const movie = await capture("늦게 피는 이야기", "마지막 장면의 오래 남은 침묵을 적었다.", "normal", "2024-07-11");
    const poem = await capture("검은 파도", "파도 아래 가라앉은 작은 불빛", "normal", "2024-08-14");
    const essay = await capture("도시 산책 에세이", "도시에서 기억하는 산책길과 낡은 간판을 썼다.", "normal", "2024-09-19");
    await capture("민감한 대화", "서로의 경계를 확인한 사적인 녹취", "sensitive", "2024-10-20");
    const restricted = await capture("잠긴 게임 메모", "검은 성채 비밀 엔딩", "restricted", "2024-11-21");
    await db.exec(`
      insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at) values ('recall-type-movie','user-a','movie_review','영화 리뷰','document','active','user_created','영화 감상',1,1,1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at) values ('recall-assignment-movie','user-a','${movie.objectId}','recall-type-movie','primary','user','accepted',1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at) values ('recall-field-rating','user-a','user_rating','내 평점','평점','rating','active','user_created',1,1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,locked_by_user,created_at) values ('recall-value-rating','user-a','${restaurant.objectId}','recall-field-rating','rating',4.5,'4.5','user_explicit','low','accepted',1,'2026-08-12T10:00:00Z');
      insert into v2_predicate_definitions (id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at) values ('recall-predicate-work','user-a','mentions_entity','언급한 대상','작품 연결','active','system_seed',1,'2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values ('recall-entity-movie','user-a','entity','active','2026-08-12T10:00:00Z','2026-08-12T10:00:00Z');
      insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at) values ('recall-entity-movie','work','늦게 피는 이야기','resolved','2026-08-12T10:00:00Z');
      insert into v2_relation_edges (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,locked_by_user,created_at) values ('recall-relation-movie','user-a','${movie.objectId}','recall-predicate-work','recall-entity-movie','user_explicit','low','accepted',1,'2026-08-12T10:00:00Z');
    `);
    const repository = new D1RetrievalRepository(db, "user-a");
    const scenarios = [
      { id: "text-place", expected: restaurant.objectId, plan: defaultV2QueryPlan({ fullText: "가지튀김" }) },
      { id: "ocr-game", expected: game.objectId, plan: defaultV2QueryPlan({ fullText: "은빛 항해자" }) },
      { id: "title-book", expected: book.objectId, plan: defaultV2QueryPlan({ fullText: "기억의 지도" }) },
      { id: "body-movie", expected: movie.objectId, plan: defaultV2QueryPlan({ fullText: "오래 남은 침묵" }) },
      { id: "type-movie", expected: movie.objectId, plan: defaultV2QueryPlan({ typeKeys: ["movie_review"] }) },
      { id: "rating-place", expected: restaurant.objectId, plan: defaultV2QueryPlan({ propertyFilters: [{ fieldKey: "user_rating", operator: "gte", value: 4 }] }) },
      { id: "entity-movie", expected: movie.objectId, plan: defaultV2QueryPlan({ entityFilters: [{ targetObjectId: "recall-entity-movie" }] }) },
      { id: "date-place", expected: restaurant.objectId, plan: defaultV2QueryPlan({ dateFilter: { axis: "captured_at", from: "2024-04-05", to: "2024-04-05" } }) },
      { id: "multiword-essay", expected: essay.objectId, plan: defaultV2QueryPlan({ fullText: "도시에서 기억하는 산책길" }) },
      { id: "short-korean-poem", expected: poem.objectId, plan: defaultV2QueryPlan({ fullText: "파도" }) },
    ];
    const outcomes = await Promise.all(scenarios.map(async (scenario) => ({ id: scenario.id, hit: (await repository.search(scenario.plan)).slice(0, 10).some((result) => result.recordId === scenario.expected) })));
    expect(outcomes.filter((outcome) => outcome.hit)).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome.hit).length / outcomes.length).toBeGreaterThanOrEqual(0.9);
    await expect(repository.search(defaultV2QueryPlan({ fullText: "검은 성채" }))).resolves.not.toContainEqual(expect.objectContaining({ recordId: restricted.objectId }));
  });

  test("stores validated saved views unpinned and enforces a five-item explicit pin limit", async () => {
    const views = new D1SavedViewRepository(db, "user-a");
    const definition = (name: string) => ({ name, description: null, iconKey: "runtime.ai.svg", queryPlan: defaultV2QueryPlan({ fullText: "서울숲" }), display: { layout: "list", density: "comfortable", groupBy: null, visibleFields: [] } });
    const first = await views.create(definition("서울숲 기록"), "2026-08-12T10:00:00.000Z");
    expect(first).toMatchObject({ name: "서울숲 기록", iconKey: "type.collection", pinned: false, source: "user_created" });
    for (let index = 0; index < 4; index += 1) {
      const view = await views.create(definition(`목록 ${index}`), `2026-08-12T10:0${index + 1}:00.000Z`);
      if (!view) throw new Error("Expected a saved view.");
      await views.setPinned(view.id, true);
    }
    if (!first) throw new Error("Expected the first saved view.");
    await views.setPinned(first.id, true);
    const sixth = await views.create(definition("여섯 번째"));
    if (!sixth) throw new Error("Expected the sixth saved view.");
    await expect(views.setPinned(sixth.id, true)).rejects.toMatchObject({ code: "saved_view_pin_limit" });
    await expect(views.list({ pinnedOnly: true })).resolves.toHaveLength(5);
    await expect(new D1SavedViewRepository(db, "user-b").get(first.id)).resolves.toBeNull();
    await views.archive(first.id);
    await expect(views.get(first.id)).resolves.toBeNull();
  });
});
