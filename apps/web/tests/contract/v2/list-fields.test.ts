import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { finishNotionImport } from "@/lib/v2/import/notion-import";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { fieldInputValue, parseFieldCorrection } from "@/lib/v2/presentation/field-input";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { formatSavedViewFieldValue } from "@/lib/v2/retrieval/saved-view-fields";
import { createOwnerStructureTemplates } from "@/lib/v2/templates/owner-structure-templates";
import { itemValueKind, validateTemplateSubmission } from "@/lib/v2/templates/template-definition-v1";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const now = "2026-10-18T01:00:00.000Z";
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => { db.sql.close(); });

async function record(title: string, aiEnabled = false) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: `${title}: 장르 SF, 액션`, aiEnabled,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  return capture;
}
const stored = (objectId: string) => db.sql.prepare(`select p.value_kind,p.value_text,p.value_json,f.data_type from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id
  where p.owner_object_id=? and f.key='genre' and p.superseded_at is null`).all(objectId);
const genre = { key: "genre", label: "장르" } as const;

describe("fields with several values are lists", () => {
  test("a multi-select is stored as its items, and an earlier comma-joined text becomes the same list", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    const fresh = await record("작품 새로");
    await knowledge.setValue(fresh.objectId, { ...genre, dataType: "ordered_list" }, { kind: "list", items: ["드라마", "판타지"] }, null, now);
    expect(stored(fresh.objectId)).toEqual([{ value_kind: "json", value_text: "드라마, 판타지", value_json: '["드라마","판타지"]', data_type: "ordered_list" }]);

    db.sql.close(); db = new LinkSqlite(33);
    const older = await record("작품 예전");
    await new D1ImportedKnowledgeRepository(db, owner).setValue(older.objectId, { ...genre, dataType: "short_text" }, { kind: "text", text: "드라마,판타지" }, null, now);
    expect(await finishNotionImport(db, owner, now)).toMatchObject({ listFields: 1 });
    expect(stored(older.objectId)).toEqual([{ value_kind: "json", value_text: "드라마, 판타지", value_json: '["드라마","판타지"]', data_type: "ordered_list" }]);
    expect(await finishNotionImport(db, owner, now)).toMatchObject({ listFields: 0 });
  });

  test("an exact condition matches one item of a list, never part of an item", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    const fantasy = await record("판타지 작품"), plain = await record("드라마 작품");
    await knowledge.setValue(fantasy.objectId, { ...genre, dataType: "ordered_list" }, { kind: "list", items: ["드라마", "판타지"] }, null, now);
    await knowledge.setValue(plain.objectId, { ...genre, dataType: "ordered_list" }, { kind: "list", items: ["드라마"] }, null, now);
    const ids = async (value: string, operator: "eq" | "contains" = "eq") => (await new D1RetrievalRepository(db, owner)
      .searchPage(defaultV2QueryPlan({ propertyFilters: [{ fieldKey: "genre", operator, value }] }))).results.map((result) => result.recordId).sort();
    expect(await ids("판타지")).toEqual([fantasy.objectId]);
    expect(await ids("드라마")).toEqual([fantasy.objectId, plain.objectId].sort());
    expect(await ids("판타")).toEqual([]);
    expect(await ids("판타", "contains")).toEqual([fantasy.objectId]);
  });

  test("the analyzer's text for a list field is stored as items, without a type conflict", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    const existing = await record("기존 작품");
    await knowledge.setValue(existing.objectId, { ...genre, dataType: "ordered_list" }, { kind: "list", items: ["드라마"] }, null, now);
    const capture = await record("새 작품", true);
    const evidence = [{ source_item_id: capture.sources[0]!.id, start: 0, end: 4 }];
    const envelope: AnalysisEnvelopeV1 = {
      contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "작품",
      document_proposals: [], entity_proposals: [], event_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
      field_proposals: [{ temp_id: "genre", field_key: "genre", value: "SF, 액션", value_type: "text", claim_risk: "low", disposition: "accepted", evidence_refs: evidence }],
    };
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending(10, now);
    const result = await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope), workerId: "list-worker", now: new Date(now) });
    expect(result.outcome).toBe("succeeded");
    expect(stored(capture.objectId)).toEqual([{ value_kind: "json", value_text: "SF, 액션", value_json: '["SF","액션"]', data_type: "ordered_list" }]);
    expect(db.sql.prepare("select count(*) as n from v2_review_items where kind='registry_conflict'").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) as n from v2_evidence_refs where target_kind='property_value'").get()).toEqual({ n: 1 });
  }, 60_000);

  test("a list reads and is corrected as comma-separated items", () => {
    expect(fieldInputValue({ renderer: "json", value: ["드라마", "판타지"] })).toBe("드라마, 판타지");
    expect(parseFieldCorrection("json", "드라마, 판타지 ,드라마")).toEqual(["드라마", "판타지"]);
    expect(parseFieldCorrection("json", '{"a":1}')).toEqual({ a: 1 });
    expect(formatSavedViewFieldValue({ propertyId: "p", value: '["SF","액션"]', renderer: "json", unit: null, sourceClass: "imported", lockedByUser: false } as never)).toBe("SF, 액션");
  });
  test("a guide asks for several values in a list field and its answer is kept as items", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    for (const title of ["작품 A", "작품 B"]) {
      const capture = await record(title);
      await knowledge.assignType(capture.objectId, { key: "video_log", label: "영상 로그" }, now);
      await knowledge.setValue(capture.objectId, { ...genre, dataType: "short_text" }, { kind: "text", text: "드라마,판타지" }, null, now);
    }
    const templates = new D1TemplateRepository(db, owner);
    expect(await createOwnerStructureTemplates(db, owner, { now })).toEqual(["video_log"]);
    const before = (await templates.list())[0]!;
    expect(before.definition.sections[0]!.items[0]).toMatchObject({ inputKind: "text", cardinality: "one" });

    // The field becomes a list: the untouched draft is rebuilt, once.
    expect(await finishNotionImport(db, owner, now)).toMatchObject({ listFields: 1, templates: ["video_log"] });
    const guide = (await templates.list())[0]!;
    expect(guide.id).not.toBe(before.id);
    expect(guide.definition.sections[0]!.items[0]).toMatchObject({ prompt: "장르를 남길까요?", inputKind: "chips", cardinality: "many" });
    expect(await createOwnerStructureTemplates(db, owner, { now })).toEqual([]);

    const tried = await templates.transition(guide.id, "try", now);
    const chosen = (await templates.getByVersion(tried!.currentVersionId))!;
    const item = chosen.definition.sections[0]!.items[0]!;
    const submission = validateTemplateSubmission({ templateVersionId: chosen.currentVersionId, appliedAt: now,
      inputs: [{ itemKey: item.key, valueKind: itemValueKind(item), value: ["SF", "액션"], blankState: "answered", inputOrder: 0, clientTimestamp: now }] }, chosen.definition);
    const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "새 작품", bodyMarkdown: "새로 본 작품", aiEnabled: false,
      clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now }, crypto.randomUUID(), now, { templateId: chosen.id, definition: chosen.definition, submission });
    await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
    expect(stored(capture.objectId)).toEqual([{ value_kind: "json", value_text: "SF, 액션", value_json: '["SF","액션"]', data_type: "ordered_list" }]);
    // A guide the owner tried is never rebuilt.
    db.sql.prepare("update v2_field_definitions set label='장르(복수)' where key='genre'").run();
    expect(await createOwnerStructureTemplates(db, owner, { now })).toEqual([]);
    expect((await templates.list()).map((template) => template.id)).toEqual([guide.id]);
  });
});
