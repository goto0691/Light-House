import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1ProcessingQueueRepository, type V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { observeCompletedAnalysisPattern } from "@/lib/v2/templates/analysis-pattern-observer";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import { itemValueKind, validateTemplateSubmission } from "@/lib/v2/templates/template-definition-v1";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
let db: LinkSqlite;

beforeEach(() => { db = new LinkSqlite(32); });
afterEach(() => { db.sql.close(); });

type Capture = Awaited<ReturnType<typeof makeCapture>>;

async function makeCapture(day: string, suffix: string) {
  const bodyMarkdown = `합성 운동 ${suffix}: 거리 ${suffix}km, 시간 ${suffix}분, 평점 4점. PERSONAL_ORIGINAL_${suffix}_PRIVATE`;
  const prepared = await prepareCaptureCommit({
    draftId: crypto.randomUUID(), channel: "web", title: `합성 운동 ${suffix}`, bodyMarkdown,
    aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: `${day}T09:00:00.000Z`,
  }, crypto.randomUUID(), `${day}T09:00:01.000Z`);
  await new D1SourceFoundationRepository(db, owner).commitCapture(prepared);
  return prepared;
}

function workoutEnvelope(capture: Capture, suffix: string, revisionId = capture.revisionId): AnalysisEnvelopeV1 {
  const sourceId = revisionId === capture.revisionId ? capture.sources[0]!.id : `revision_source:${revisionId}`;
  const evidence = [{ source_item_id: sourceId, start: 0, end: 5 }];
  return {
    contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: revisionId,
    language: "ko", bundle_summary: `운동 ${suffix}`,
    document_proposals: [{ temp_id: "document", source_item_ids: [sourceId], suggested_title: null,
      type_assignments: [{ type_key: "workout_log", label: "운동 기록", registry_action: "propose_new", evidence_refs: evidence }] }],
    entity_proposals: [], event_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
    field_proposals: [
      { temp_id: "distance", field_key: "distance_km", value: Number(suffix), value_type: "number", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
      { temp_id: "duration", field_key: "duration_min", value: Number(suffix) * 10, value_type: "number", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
      { temp_id: "rating", field_key: "user_rating", value: 4, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
    ],
  };
}

function observation(job: V2ProcessingJob, runId: string, now: string) {
  return observeCompletedAnalysisPattern(db, { job, runId, now });
}

async function analyze(capture: Capture, day: string, suffix: string, options: {
  revisionId?: string;
  scenario?: "success" | "invalid_schema";
  observePattern?: typeof observation;
} = {}) {
  const queue = new D1ProcessingQueueRepository(db);
  await queue.dispatchPending(10, `${day}T09:30:00.000Z`);
  const gateway = new FakeV2StructuredModelGateway(options.scenario ?? "success", workoutEnvelope(capture, suffix, options.revisionId));
  const result = await runNextAnalysisJob({ queue, gateway, workerId: `worker-${crypto.randomUUID()}`,
    now: new Date(`${day}T10:00:00.000Z`), observePattern: options.observePattern ?? observation });
  return { result, gateway };
}

async function observationRows() {
  return db.prepare("select source_document_id,source_revision_id,observed_date,outcome from v2_template_pattern_observations order by source_document_id")
    .all<{ source_document_id: string; source_revision_id: string; observed_date: string; outcome: string }>();
}

describe("S2 completed analysis to explicit template use", () => {
  test("requires three distinct documents on three days, then keeps the generated draft inactive until try and keep", async () => {
    const templates = new D1TemplateRepository(db, owner);
    const days = ["2026-08-01", "2026-08-01", "2026-08-02", "2026-08-03"];
    const captures: Capture[] = [];
    for (const [index, day] of days.entries()) {
      const capture = await makeCapture(day, String(index + 1));
      captures.push(capture);
      const observedRuns: { job: V2ProcessingJob; runId: string; now: string }[] = [];
      const { result, gateway } = await analyze(capture, day, String(index + 1), {
        observePattern: async (job, runId, now) => {
          observedRuns.push({ job, runId, now });
          return observation(job, runId, now);
        },
      });
      expect(result.outcome).toBe("succeeded");
      if (result.outcome !== "succeeded") throw new Error("Expected committed analysis.");
      expect(result.patternObservation).toBe(index === days.length - 1 ? "generated" : "observed");
      expect(gateway.calls).toHaveLength(1);
      if (index === 0) {
        const before = (await observationRows()).results;
        const firstRun = observedRuns[0]!;
        await observation(firstRun.job, firstRun.runId, firstRun.now);
        expect((await observationRows()).results).toEqual(before);
      }
      const generated = (await templates.list()).filter((item) => item.origin === "ai_derived");
      expect(generated).toHaveLength(index === days.length - 1 ? 1 : 0);
    }
    const proposal = (await templates.list()).find((item) => item.origin === "ai_derived");
    if (!proposal) throw new Error("Expected the third-day proposal.");
    expect(proposal).toMatchObject({ status: "generated_draft", pinned: false, usageCount: 0 });
    expect(await templates.list({ captureEligibleOnly: true })).not.toContainEqual(expect.objectContaining({ id: proposal.id }));
    const stored = db.sql.prepare("select definition_json from v2_capture_template_versions where id=?").get(proposal.currentVersionId) as { definition_json: string };
    for (const [index, capture] of captures.entries()) {
      expect(stored.definition_json).not.toContain(capture.bodyMarkdown);
      expect(stored.definition_json).not.toContain(`PERSONAL_ORIGINAL_${index + 1}_PRIVATE`);
    }
    expect(proposal.definition.sections.flatMap((section) => section.items).every((item) => !("defaultValue" in item))).toBe(true);
    expect((await observationRows()).results).toHaveLength(4);

    expect(await templates.transition(proposal.id, "try", "2026-08-04T09:00:00.000Z")).toMatchObject({ status: "trial" });
    expect(await templates.transition(proposal.id, "keep", "2026-08-04T09:01:00.000Z")).toMatchObject({ status: "active", pinned: false });
    const chosen = await templates.getByVersion(proposal.currentVersionId);
    if (!chosen) throw new Error("Expected the chosen template version.");
    const structured = chosen.definition.sections.flatMap((section) => section.items).find((item) => item.binding && item.inputKind);
    if (!structured) throw new Error("Expected a reusable structured question.");
    const valueKind = itemValueKind(structured);
    const value = valueKind === "rating" ? 3.5 : valueKind === "number" ? 7 : valueKind === "boolean" ? true : valueKind === "date" ? "2026-08-04" : valueKind === "json" ? ["합성 답"] : "합성 새 답";
    const appliedAt = "2026-08-04T09:10:00.000Z";
    const submission = validateTemplateSubmission({ templateVersionId: chosen.currentVersionId, appliedAt,
      inputs: [{ itemKey: structured.key, valueKind, value, blankState: "answered", inputOrder: 0, clientTimestamp: appliedAt }] }, chosen.definition);
    const next = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: null,
      bodyMarkdown: "새 Capture의 사용자가 직접 쓴 본문", aiEnabled: false, clientTimezone: "Asia/Seoul",
      privacyLevel: "normal", capturedAt: appliedAt }, crypto.randomUUID(), appliedAt,
    { templateId: chosen.id, definition: chosen.definition, submission });
    await new D1SourceFoundationRepository(db, owner).commitCapture(next);
    expect(db.sql.prepare("select template_version_id from v2_capture_template_sessions where capture_id=?").get(next.captureId))
      .toEqual({ template_version_id: chosen.currentVersionId });
    expect(db.sql.prepare("select count(*) as count from v2_capture_input_values v join v2_capture_template_sessions s on s.id=v.session_id where s.capture_id=?").get(next.captureId))
      .toEqual({ count: 1 });
    expect(db.sql.prepare("select count(*) as count from v2_property_values where owner_object_id=? and source_class='user_explicit' and locked_by_user=1").get(next.objectId))
      .toEqual({ count: 1 });
  }, 60_000);

  test("a current revision replaces one document observation instead of creating another", async () => {
    const first = await makeCapture("2026-08-01", "1");
    expect((await analyze(first, "2026-08-01", "1")).result.outcome).toBe("succeeded");
    const originalObservation = (await observationRows()).results[0];
    const edit = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: first.revisionId,
      title: first.title, bodyMarkdown: "합성 운동 수정: 거리 5km, 시간 50분, 평점 4점.",
      writtenAt: null, documentStatus: "revising", privacyLevel: "normal" }, crypto.randomUUID(), "2026-08-02T09:00:00.000Z");
    expect(await new D1DocumentAuthoringRepository(db, owner).saveRevision(first.objectId, edit)).toMatchObject({ outcome: "saved" });
    expect((await analyze(first, "2026-08-02", "5", { revisionId: edit.revisionId })).result.outcome).toBe("succeeded");
    const observations = (await observationRows()).results;
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ source_document_id: first.objectId, source_revision_id: edit.revisionId });
    expect(observations[0]?.source_revision_id).not.toBe(originalObservation?.source_revision_id);

    for (const [day, suffix] of [["2026-08-03", "2"], ["2026-08-04", "3"]] as const) {
      const capture = await makeCapture(day, suffix);
      expect((await analyze(capture, day, suffix)).result.outcome).toBe("succeeded");
    }
    const generated = (await new D1TemplateRepository(db, owner).list()).filter((item) => item.origin === "ai_derived");
    expect(generated).toHaveLength(1);
    expect((await observationRows()).results).toHaveLength(3);
  }, 60_000);

  test("failed and stale analyses are never observed", async () => {
    const failed = await makeCapture("2026-08-05", "5");
    const failedObservations: string[] = [];
    const invalid = await analyze(failed, "2026-08-05", "5", { scenario: "invalid_schema",
      observePattern: async () => { failedObservations.push("unexpected"); return "observed"; } });
    expect(invalid.result.outcome).toBe("needs_review");
    expect(failedObservations).toHaveLength(0);

    const stale = await makeCapture("2026-08-06", "6");
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending(10, "2026-08-06T09:30:00.000Z");
    const staleGateway = new FakeV2StructuredModelGateway("success", workoutEnvelope(stale, "6"));
    const staleResult = await runNextAnalysisJob({ queue, workerId: "stale-worker", now: new Date("2026-08-06T10:00:00.000Z"),
      gateway: { async generate<T>(request: V2StructuredModelRequest) {
        const edit = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: stale.revisionId,
          title: stale.title, bodyMarkdown: "사용자가 분석 중 새로 쓴 수정본", writtenAt: null,
          documentStatus: "revising", privacyLevel: "normal" }, crypto.randomUUID(), "2026-08-06T10:00:01.000Z");
        await new D1DocumentAuthoringRepository(db, owner).saveRevision(stale.objectId, edit);
        return staleGateway.generate<T>(request);
      } }, observePattern: async () => { failedObservations.push("stale"); return "observed"; } });
    expect(staleResult.outcome).toBe("stale");
    expect(failedObservations).toHaveLength(0);
    expect((await observationRows()).results).toHaveLength(0);
  }, 60_000);

  test("privacy changes and disabled AI keep a successful run out of pattern discovery", async () => {
    const capture = await makeCapture("2026-08-08", "8");
    const seen: { job: V2ProcessingJob; runId: string; now: string }[] = [];
    const { result } = await analyze(capture, "2026-08-08", "8", { observePattern: async (job, runId, now) => {
      seen.push({ job, runId, now });
      return "skipped";
    } });
    expect(result.outcome).toBe("succeeded");
    const run = seen[0]!;
    db.sql.prepare("update v2_documents set privacy_level='sensitive' where object_id=?").run(capture.objectId);
    await expect(observation(run.job, run.runId, run.now)).resolves.toBe("skipped");
    db.sql.prepare("update v2_documents set privacy_level='normal' where object_id=?").run(capture.objectId);
    db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(capture.captureId);
    await expect(observation(run.job, run.runId, run.now)).resolves.toBe("skipped");
    expect((await observationRows()).results).toHaveLength(0);
  }, 60_000);

  test("a formerly observed source cannot satisfy the third-day threshold after becoming restricted", async () => {
    const first = await makeCapture("2026-08-08", "8");
    expect((await analyze(first, "2026-08-08", "8")).result).toMatchObject({ outcome: "succeeded", patternObservation: "observed" });
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(first.objectId);
    for (const [day, suffix] of [["2026-08-09", "9"], ["2026-08-10", "10"]] as const) {
      const capture = await makeCapture(day, suffix);
      expect((await analyze(capture, day, suffix)).result).toMatchObject({ outcome: "succeeded", patternObservation: "observed" });
    }
    expect((await observationRows()).results).toHaveLength(3);
    expect((await new D1TemplateRepository(db, owner).list()).filter((item) => item.origin === "ai_derived")).toHaveLength(0);
  }, 60_000);

  test("revoked AI consent removes a former observation from the three-day threshold", async () => {
    const first = await makeCapture("2026-08-11", "11");
    expect((await analyze(first, "2026-08-11", "11")).result).toMatchObject({ outcome: "succeeded", patternObservation: "observed" });
    db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(first.captureId);
    for (const [day, suffix] of [["2026-08-12", "12"], ["2026-08-13", "13"]] as const) {
      const capture = await makeCapture(day, suffix);
      expect((await analyze(capture, day, suffix)).result).toMatchObject({ outcome: "succeeded", patternObservation: "observed" });
    }
    expect((await observationRows()).results).toHaveLength(3);
    expect((await new D1TemplateRepository(db, owner).list()).filter((item) => item.origin === "ai_derived")).toHaveLength(0);
  }, 60_000);

  test("an unchosen generated draft loses read and transition eligibility when a linked source is revoked", async () => {
    const sources: Capture[] = [];
    for (const [day, suffix] of [["2026-08-14", "14"], ["2026-08-15", "15"], ["2026-08-16", "16"]] as const) {
      const capture = await makeCapture(day, suffix);
      sources.push(capture);
      expect((await analyze(capture, day, suffix)).result.outcome).toBe("succeeded");
    }
    const templates = new D1TemplateRepository(db, owner);
    const draft = (await templates.list()).find((item) => item.origin === "ai_derived");
    if (!draft) throw new Error("Expected generated draft before consent revocation.");
    db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(sources[0]!.captureId);
    expect((await templates.list()).filter((item) => item.origin === "ai_derived")).toHaveLength(0);
    expect(await templates.get(draft.id)).toBeNull();
    expect(await templates.getByVersion(draft.currentVersionId)).toBeNull();
    await expect(templates.transition(draft.id, "try")).rejects.toMatchObject({ code: "template_not_found" });
    await expect(templates.transition(draft.id, "keep")).rejects.toMatchObject({ code: "template_not_found" });
    expect(db.sql.prepare("select status from v2_capture_templates where id=?").get(draft.id)).toEqual({ status: "generated_draft" });

    db.sql.prepare("update v2_capture_bundles set ai_enabled=1 where id=?").run(sources[0]!.captureId);
    expect(await templates.get(draft.id)).toMatchObject({ status: "generated_draft" });
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(sources[1]!.objectId);
    expect(await templates.get(draft.id)).toBeNull();
  }, 60_000);

  test("a source revocation between template read and try cannot persist the transition", async () => {
    const sources: Capture[] = [];
    for (const [day, suffix] of [["2026-08-17", "17"], ["2026-08-18", "18"], ["2026-08-19", "19"]] as const) {
      const capture = await makeCapture(day, suffix);
      sources.push(capture);
      expect((await analyze(capture, day, suffix)).result.outcome).toBe("succeeded");
    }
    const templates = new D1TemplateRepository(db, owner);
    const draft = (await templates.list()).find((item) => item.origin === "ai_derived");
    if (!draft) throw new Error("Expected generated draft before transition race.");
    const originalGet = templates.get.bind(templates);
    templates.get = async (id) => {
      const current = await originalGet(id);
      db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(sources[0]!.captureId);
      return current;
    };
    await expect(templates.transition(draft.id, "try")).rejects.toMatchObject({ code: "template_transition_invalid" });
    expect(db.sql.prepare("select status from v2_capture_templates where id=?").get(draft.id)).toEqual({ status: "generated_draft" });
    db.sql.prepare("update v2_capture_bundles set ai_enabled=1 where id=?").run(sources[0]!.captureId);
    templates.get = async (id) => {
      const current = await originalGet(id);
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(sources[0]!.objectId);
      return current;
    };
    await expect(templates.transition(draft.id, "try")).rejects.toMatchObject({ code: "template_transition_invalid" });
    expect(db.sql.prepare("select status from v2_capture_templates where id=?").get(draft.id)).toEqual({ status: "generated_draft" });
  }, 60_000);

  test("a stale try cannot reactivate a template dismissed after its read", async () => {
    const first = new D1TemplateRepository(db, owner);
    const competing = new D1TemplateRepository(db, owner);
    const draft = await first.createDraft({ definition: SYSTEM_TEMPLATE_SEEDS[0]!.definition });
    if (!draft) throw new Error("Expected a template draft.");
    expect(await first.transition(draft.id, "keep")).toMatchObject({ status: "active" });
    const originalGet = first.get.bind(first);
    let raced = false;
    first.get = async (id) => {
      const current = await originalGet(id);
      if (!raced) {
        raced = true;
        expect(await competing.transition(id, "dismiss")).toMatchObject({ status: "dismissed" });
      }
      return current;
    };
    await expect(first.transition(draft.id, "try")).rejects.toMatchObject({ code: "template_transition_invalid" });
    expect(db.sql.prepare("select status from v2_capture_templates where id=?").get(draft.id)).toEqual({ status: "dismissed" });
  });

  test("a stale keep cannot reactivate a template archived after its read", async () => {
    const first = new D1TemplateRepository(db, owner);
    const competing = new D1TemplateRepository(db, owner);
    const draft = await first.createDraft({ definition: SYSTEM_TEMPLATE_SEEDS[0]!.definition });
    if (!draft) throw new Error("Expected a template draft.");
    const originalGet = first.get.bind(first);
    let raced = false;
    first.get = async (id) => {
      const current = await originalGet(id);
      if (!raced) {
        raced = true;
        expect(await competing.transition(id, "archive")).toMatchObject({ status: "archived" });
      }
      return current;
    };
    await expect(first.transition(draft.id, "keep")).rejects.toMatchObject({ code: "template_transition_invalid" });
    expect(db.sql.prepare("select status from v2_capture_templates where id=?").get(draft.id)).toEqual({ status: "archived" });
  });

  test("a stale keep cannot publish a superseded template version", async () => {
    const first = new D1TemplateRepository(db, owner);
    const draft = await first.createDraft({ definition: SYSTEM_TEMPLATE_SEEDS[0]!.definition });
    if (!draft) throw new Error("Expected a template draft.");
    const nextVersionId = crypto.randomUUID();
    const originalGet = first.get.bind(first);
    let raced = false;
    first.get = async (id) => {
      const current = await originalGet(id);
      if (!raced) {
        raced = true;
        const previous = db.sql.prepare("select definition_json,registry_snapshot_version from v2_capture_template_versions where id=?")
          .get(draft.currentVersionId) as { definition_json: string; registry_snapshot_version: string };
        db.sql.prepare(`insert into v2_capture_template_versions
          (id,template_id,version_number,definition_json,registry_snapshot_version,previous_version_id,created_at)
          values (?,?,2,?,?,?,?)`)
          .run(nextVersionId, draft.id, previous.definition_json, previous.registry_snapshot_version,
            draft.currentVersionId, "2026-08-28T09:00:00.000Z");
        db.sql.prepare("update v2_capture_templates set current_version_id=? where id=?")
          .run(nextVersionId, draft.id);
      }
      return current;
    };
    await expect(first.transition(draft.id, "keep")).rejects.toMatchObject({ code: "template_transition_invalid" });
    expect(db.sql.prepare("select status,current_version_id from v2_capture_templates where id=?").get(draft.id))
      .toEqual({ status: "draft", current_version_id: nextVersionId });
  });

  test("a generated draft keeps its provenance and remains eligible after a source revision is reanalyzed", async () => {
    const sources: Capture[] = [];
    for (const [day, suffix] of [["2026-08-20", "20"], ["2026-08-21", "21"], ["2026-08-22", "22"]] as const) {
      const capture = await makeCapture(day, suffix);
      sources.push(capture);
      expect((await analyze(capture, day, suffix)).result.outcome).toBe("succeeded");
    }
    const templates = new D1TemplateRepository(db, owner);
    const draft = (await templates.list()).find((item) => item.origin === "ai_derived");
    if (!draft) throw new Error("Expected generated draft before reanalysis.");
    const first = sources[0]!;
    const edit = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: first.revisionId,
      title: first.title, bodyMarkdown: "합성 운동 수정 후 재분석", writtenAt: null,
      documentStatus: "revising", privacyLevel: "normal" }, crypto.randomUUID(), "2026-08-23T09:00:00.000Z");
    expect(await new D1DocumentAuthoringRepository(db, owner).saveRevision(first.objectId, edit)).toMatchObject({ outcome: "saved" });
    expect((await templates.list()).filter((item) => item.origin === "ai_derived")).toHaveLength(0);
    expect((await analyze(first, "2026-08-23", "23", { revisionId: edit.revisionId })).result.outcome).toBe("succeeded");
    expect(await templates.get(draft.id)).toMatchObject({ id: draft.id, status: "generated_draft" });
    const links = db.sql.prepare("select source_revision_id from v2_template_source_links where template_version_id=? and source_document_id=? order by source_revision_id")
      .all(draft.currentVersionId, first.objectId) as { source_revision_id: string }[];
    expect(links.map((link) => link.source_revision_id)).toContain(first.revisionId);
    expect(links.map((link) => link.source_revision_id)).toContain(edit.revisionId);
  }, 60_000);

  test("a fourth eligible source restores an unchosen draft after one source revokes consent", async () => {
    const sources: Capture[] = [];
    for (const [day, suffix] of [["2026-08-24", "24"], ["2026-08-25", "25"], ["2026-08-26", "26"]] as const) {
      const capture = await makeCapture(day, suffix);
      sources.push(capture);
      expect((await analyze(capture, day, suffix)).result.outcome).toBe("succeeded");
    }
    const templates = new D1TemplateRepository(db, owner);
    const draft = (await templates.list()).find((item) => item.origin === "ai_derived");
    if (!draft) throw new Error("Expected generated draft before revocation.");
    db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(sources[0]!.captureId);
    expect(await templates.get(draft.id)).toBeNull();
    const fourth = await makeCapture("2026-08-27", "27");
    expect((await analyze(fourth, "2026-08-27", "27")).result.outcome).toBe("succeeded");
    expect(await templates.get(draft.id)).toMatchObject({ id: draft.id, status: "generated_draft" });
    const links = db.sql.prepare("select source_document_id from v2_template_source_links where template_version_id=? and source_document_id=?")
      .all(draft.currentVersionId, fourth.objectId) as { source_document_id: string }[];
    expect(links).toEqual([{ source_document_id: fourth.objectId }]);
  }, 60_000);

  test("an observer write error cannot fail a committed analysis or recall the provider", async () => {
    const committed = await makeCapture("2026-08-07", "7");
    const { result, gateway } = await analyze(committed, "2026-08-07", "7", {
      observePattern: async () => { throw new Error("synthetic observer write failure"); },
    });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") throw new Error("Expected committed analysis.");
    expect(result.patternObservation).toBe("failed");
    expect(gateway.calls).toHaveLength(1);
    expect(db.sql.prepare("select status from v2_processing_runs where id=?").get(result.runId)).toEqual({ status: "succeeded" });
    expect(db.sql.prepare("select status from v2_processing_jobs where id=?").get(result.jobId)).toEqual({ status: "succeeded" });
    expect((await observationRows()).results).toHaveLength(0);
  }, 60_000);
});
