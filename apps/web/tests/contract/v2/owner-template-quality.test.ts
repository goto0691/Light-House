import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { observeCompletedAnalysisPattern } from "@/lib/v2/templates/analysis-pattern-observer";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const now = "2026-10-17T05:00:00.000Z";
const FIELDS = [["author_name", "저자"], ["reading_place", "읽은 곳"], ["mood_word", "기분"]] as const;
let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(33);
  // The owner's own category and field names, as an import or the owner's edits leave them.
  db.sql.prepare(`insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
    values ('type-reading',?,'reading_log','독서 기록','document','active','imported','Owner category',1,0,0,?,?)`).run(owner, now, now);
  for (const [key, label] of FIELDS) db.sql.prepare(`insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
    values (?,?,?,?,'Owner field','short_text','active','imported',1,0,?,?)`).run(`field-${key}`, owner, key, label, now, now);
});
afterEach(() => { db.sql.close(); });

async function analyzeOn(day: string, suffix: string, alreadyFiled = false) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: `합성 독서 ${suffix}`,
    bodyMarkdown: `합성 독서 ${suffix}: 저자 갑, 도서관에서, 기분 좋음. PRIVATE_READING_${suffix}`, aiEnabled: true,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: `${day}T09:00:00.000Z` }, crypto.randomUUID(), `${day}T09:00:01.000Z`);
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  if (alreadyFiled) await new D1ImportedKnowledgeRepository(db, owner).assignType(capture.objectId, { key: "reading_log", label: "독서 기록" }, now);
  const evidence = [{ source_item_id: capture.sources[0]!.id, start: 0, end: 5 }];
  const envelope: AnalysisEnvelopeV1 = {
    contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "독서",
    document_proposals: [{ temp_id: "document", source_item_ids: [capture.sources[0]!.id], suggested_title: null,
      type_assignments: [{ type_key: "reading_log", label: "독서 기록", registry_action: "reuse", evidence_refs: evidence }] }],
    entity_proposals: [], event_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
    field_proposals: FIELDS.map(([key]) => ({ temp_id: key, field_key: key, value: `${key} ${suffix}`, value_type: "text" as const, claim_risk: "low" as const, disposition: "accepted" as const, evidence_refs: evidence })),
  };
  const queue = new D1ProcessingQueueRepository(db);
  await queue.dispatchPending(10, `${day}T09:30:00.000Z`);
  const result = await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope), workerId: crypto.randomUUID(),
    now: new Date(`${day}T10:00:00.000Z`), observePattern: (job, runId, at) => observeCompletedAnalysisPattern(db, { job, runId, now: at }) });
  if (result.outcome !== "succeeded") throw new Error(`Expected a committed analysis, got ${result.outcome}.`);
  return result.patternObservation;
}

const threeDays = async (alreadyFiled = false) => {
  const outcomes = [];
  for (const [day, suffix] of [["2026-09-01", "1"], ["2026-09-02", "2"], ["2026-09-03", "3"]] as const) outcomes.push(await analyzeOn(day, suffix, alreadyFiled));
  return outcomes;
};

describe("templates found in analysis speak in the owner's words and do not repeat one another", () => {
  test("a repeated pattern becomes a guide named after the owner's category with neutral questions in the owner's field names", async () => {
    expect(await threeDays()).toEqual(["observed", "observed", "generated"]);
    const [proposal, ...others] = (await new D1TemplateRepository(db, owner).list()).filter((item) => item.origin === "ai_derived");
    expect(others).toHaveLength(0);
    expect(proposal).toMatchObject({ status: "generated_draft", name: "독서 기록 안내" });
    expect(proposal!.definition.expectedTypeIds).toEqual(["reading_log"]);
    expect(proposal!.definition.sections[0]!.items.map((item) => item.prompt).sort()).toEqual(["기분을 남길까요?", "읽은 곳을 남길까요?", "저자를 남길까요?"]);
    expect(JSON.stringify(proposal!.definition)).not.toMatch(/PRIVATE_READING|저자 갑|도서관/);
  }, 60_000);

  test("a record already filed under the owner's category keeps that category when the analysis reuses it", async () => {
    expect(await threeDays(true)).toEqual(["observed", "observed", "generated"]);
    const proposal = (await new D1TemplateRepository(db, owner).list()).find((item) => item.origin === "ai_derived");
    expect(proposal).toMatchObject({ name: "독서 기록 안내" });
    expect(proposal!.definition.expectedTypeIds).toEqual(["reading_log"]);
  }, 60_000);

  test("AI-made field names never become template questions", async () => {
    db.sql.prepare(`update v2_field_definitions set origin='ai_proposed',label='AI가 지은 이름' where key='mood_word'`).run();
    await threeDays();
    const proposal = (await new D1TemplateRepository(db, owner).list()).find((item) => item.origin === "ai_derived");
    const prompts = proposal!.definition.sections[0]!.items.map((item) => item.prompt);
    expect(prompts.join(" ")).not.toContain("AI가 지은 이름");
    expect(prompts).toEqual(expect.arrayContaining(["저자를 남길까요?", "읽은 곳을 남길까요?"]));
  }, 60_000);

  for (const status of ["generated_draft", "dismissed"] as const) {
    test(`a guide the owner already has (${status}) covering the same fields stops a near-duplicate`, async () => {
      const templates = new D1TemplateRepository(db, owner);
      const existing = await templates.createDraft({ origin: "imported", generated: true, patternSignature: "owner-structure:reading_log", definition: {
        contractVersion: 1, name: "독서 기록", expectedTypeIds: ["reading_log"], objectRoles: [{ role: "primary_document", optional: false }],
        sections: [{ key: "frequent_fields", label: "자주 쓰던 항목", items: FIELDS.slice(0, 2).map(([key, label]) => ({
          key, kind: "field", prompt: `${label} 질문`, prominence: "core", binding: { ownerRole: "primary_document", fieldKey: key },
          inputKind: "text", cardinality: "one", allowedAiOperations: ["extract_from_capture"] })) }],
      } }, now);
      if (status === "dismissed") await templates.transition(existing!.id, "dismiss", now);
      expect(await threeDays()).toEqual(["skipped", "skipped", "skipped"]);
      expect(db.sql.prepare("select count(*) as n from v2_capture_templates where origin='ai_derived'").get()).toEqual({ n: 0 });
    }, 60_000);
  }

  test("a guide for another category does not stop this one", async () => {
    db.sql.prepare(`insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
      values ('type-video',?,'video_log','영상 로그','document','active','imported','Owner category',1,0,0,?,?)`).run(owner, now, now);
    await new D1TemplateRepository(db, owner).createDraft({ origin: "imported", generated: true, patternSignature: "owner-structure:video_log", definition: {
      contractVersion: 1, name: "영상 로그", expectedTypeIds: ["video_log"], objectRoles: [{ role: "primary_document", optional: false }],
      sections: [{ key: "frequent_fields", label: "자주 쓰던 항목", items: FIELDS.map(([key, label]) => ({
        key, kind: "field", prompt: `${label} 질문`, prominence: "core", binding: { ownerRole: "primary_document", fieldKey: key },
        inputKind: "text", cardinality: "one", allowedAiOperations: ["extract_from_capture"] })) }],
    } }, now);
    expect(await threeDays()).toEqual(["observed", "observed", "generated"]);
  }, 60_000);
});
