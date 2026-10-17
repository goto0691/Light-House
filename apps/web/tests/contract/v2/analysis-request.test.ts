import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1AnalysisRequestRepository } from "@/lib/v2/infrastructure/d1/analysis-request-repository";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1ProcessingStatusRepository } from "@/lib/v2/infrastructure/d1/processing-status-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const now = "2026-10-18T04:00:00.000Z";
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => { db.sql.close(); });

async function savedWithoutAi(privacyLevel: "normal" | "sensitive" | "restricted" = "normal", userId = owner) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "import", title: "작품 메모", bodyMarkdown: "장르: 드라마, 판타지\n오래전에 본 작품.",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: "2024-08-25T12:00:00.000Z" }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, userId).commitCapture(capture);
  return capture;
}
const status = async (recordId: string) => (await new D1ProcessingStatusRepository(db, owner).list({ runtime: { enabled: true, configured: true } }))
  .items.find((item) => item.recordId === recordId)?.status;

describe("asking for AI organization of a record saved without it", () => {
  test("one request turns AI on for that record and queues exactly one analysis of its current text", async () => {
    const capture = await savedWithoutAi();
    expect(await status(capture.objectId)).toBe("unprocessed");
    expect(db.sql.prepare("select count(*) as n from v2_processing_outbox").get()).toEqual({ n: 0 });
    const requests = new D1AnalysisRequestRepository(db, owner);
    expect(await requests.request(capture.objectId, now)).toMatchObject({ outcome: "queued", revisionId: capture.revisionId });
    expect(await requests.request(capture.objectId, now)).toMatchObject({ outcome: "already_requested" });
    expect(db.sql.prepare("select ai_enabled from v2_capture_bundles where id=?").get(capture.captureId)).toEqual({ ai_enabled: 1 });
    expect(db.sql.prepare("select count(*) as n from v2_processing_outbox where status='pending'").get()).toEqual({ n: 1 });
    expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='record.analysis_requested'").get()).toEqual({ n: 1 });
    expect(await status(capture.objectId)).toBe("queued");
    await expect(new D1ProcessingQueueRepository(db).dispatchPending(10, now)).resolves.toBe(1);
    expect(db.sql.prepare("select count(*) as n from v2_processing_jobs where object_id=? and stage='analyze'").get(capture.objectId)).toEqual({ n: 1 });
  });

  test("a sensitive or locked record, or another owner's, cannot be sent this way", async () => {
    const requests = new D1AnalysisRequestRepository(db, owner);
    await expect(requests.request((await savedWithoutAi("sensitive")).objectId, now)).rejects.toMatchObject({ code: "analysis_request_not_allowed" });
    await expect(requests.request((await savedWithoutAi("restricted")).objectId, now)).rejects.toMatchObject({ code: "analysis_request_not_allowed" });
    await expect(requests.request((await savedWithoutAi("normal", "other-owner")).objectId, now)).rejects.toMatchObject({ code: "record_not_found" });
    expect(db.sql.prepare("select count(*) as n from v2_processing_outbox").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) as n from v2_capture_bundles where ai_enabled=1").get()).toEqual({ n: 0 });
  });

  test("the analysis keeps the values the owner already has and sets a differing one aside", async () => {
    const capture = await savedWithoutAi();
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    await knowledge.setValue(capture.objectId, { key: "genre", label: "장르", dataType: "ordered_list" }, { kind: "list", items: ["드라마", "판타지"] }, null, now);
    await knowledge.setValue(capture.objectId, { key: "viewing_status", label: "시청상태", dataType: "short_text" }, { kind: "text", text: "완료" }, null, now);
    await new D1AnalysisRequestRepository(db, owner).request(capture.objectId, now);
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending(10, now);
    const evidence = [{ source_item_id: capture.sources[0]!.id, start: 0, end: 4 }];
    const envelope: AnalysisEnvelopeV1 = {
      contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "작품",
      document_proposals: [], entity_proposals: [], event_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
      field_proposals: [
        { temp_id: "genre", field_key: "genre", value: "드라마, 판타지", value_type: "text", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
        { temp_id: "status", field_key: "viewing_status", value: "보는 중", value_type: "text", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
      ],
    };
    const gateway = new FakeV2StructuredModelGateway("success", envelope);
    expect((await runNextAnalysisJob({ queue, gateway, workerId: "request-worker", now: new Date(now) })).outcome).toBe("succeeded");
    expect(gateway.calls).toHaveLength(1);
    const values = db.sql.prepare(`select f.key,p.value_json,p.source_class,p.review_status from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id
      where p.owner_object_id=? order by f.key,p.source_class`).all(capture.objectId);
    expect(values).toEqual([
      { key: "genre", value_json: '["드라마","판타지"]', source_class: "imported", review_status: "accepted" },
      { key: "viewing_status", value_json: '"완료"', source_class: "imported", review_status: "accepted" },
      { key: "viewing_status", value_json: '"보는 중"', source_class: "user_explicit", review_status: "disputed" },
    ]);
    expect(await status(capture.objectId)).toBe("needs_review");
  }, 60_000);
});
