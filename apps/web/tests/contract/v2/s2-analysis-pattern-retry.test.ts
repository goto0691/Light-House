import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ bindings: vi.fn(), gateways: vi.fn() }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings, getV2ArchiveAssetsBucket: () => undefined }));
vi.mock("@/lib/v2/ai/gemini-role-gateways", () => ({ createGeminiRoleGateways: harness.gateways }));

import { POST as processJobs } from "@/app/api/v2/processing/run/route";
import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1ProcessingQueueRepository, type V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { observeCompletedAnalysisPattern } from "@/lib/v2/templates/analysis-pattern-observer";
import { observeAnalysisPatternWithRetry, retryAnalysisPatternObservations } from "@/lib/v2/templates/analysis-pattern-retry";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const operation = "template_pattern.observe_analysis.v1";
let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-not-a-key"); vi.stubEnv("CRON_SECRET", "synthetic-retry-secret");
  harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

type ObservedRun = { job: V2ProcessingJob; runId: string; now: string };
type Observer = typeof observeCompletedAnalysisPattern;
async function prepareAnalysis(day: string) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "PRIVATE_SYNTHETIC_TITLE",
    bodyMarkdown: "PRIVATE_SYNTHETIC_ORIGINAL 운동: 거리 4km, 시간 30분, 평점 4점", aiEnabled: true,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: `${day}T09:00:00.000Z` }, crypto.randomUUID(), `${day}T09:00:01.000Z`);
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  const evidence = [{ source_item_id: capture.sources[0]!.id, start: 0, end: 5 }];
  const envelope: AnalysisEnvelopeV1 = { contract_version: "analysis-v1", capture_id: capture.captureId,
    analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "PRIVATE_SYNTHETIC_SUMMARY",
    document_proposals: [{ temp_id: "document", source_item_ids: [capture.sources[0]!.id], suggested_title: null,
      type_assignments: [{ type_key: "workout_log", label: "운동", registry_action: "propose_new", evidence_refs: evidence }] }],
    entity_proposals: [], event_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
    field_proposals: [
      { temp_id: "distance", field_key: "distance_km", value: 4, value_type: "number", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
      { temp_id: "duration", field_key: "duration_min", value: 30, value_type: "number", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
      { temp_id: "rating", field_key: "user_rating", value: 4, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: evidence },
    ] };
  const gateway = new FakeV2StructuredModelGateway("success", envelope);
  return { capture, gateway };
}
async function analyze(day: string, observe?: Observer) {
  const { capture, gateway } = await prepareAnalysis(day);
  const queue = new D1ProcessingQueueRepository(db);
  await queue.dispatchPending(10, `${day}T09:30:00.000Z`);
  let savedRun: ObservedRun | undefined;
  const result = await runNextAnalysisJob({ queue, gateway, workerId: crypto.randomUUID(), now: new Date(`${day}T10:00:00.000Z`),
    observePattern: async (job, runId, now) => {
      savedRun = { job, runId, now };
      return observe ? observeAnalysisPatternWithRetry(db, savedRun, observe) : "skipped";
    } });
  expect(result.outcome).toBe("succeeded");
  if (!savedRun) throw new Error("Expected a saved analysis run.");
  return { capture, gateway, result, run: savedRun };
}
function receipt(runId: string) {
  return db.sql.prepare("select user_id,operation,idempotency_key,payload_hash,response_json,status_code from v2_idempotency_records where operation=? and idempotency_key=?")
    .get(operation, runId) as { user_id: string; operation: string; idempotency_key: string; payload_hash: string; response_json: string; status_code: number } | undefined;
}
function count(table: string) { return (db.sql.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n; }
function runHttp() {
  return processJobs(new Request("https://lighthouse.test/api/v2/processing/run", { method: "POST", headers: { authorization: "Bearer synthetic-retry-secret" } }));
}

// Binding-call observation only: this is not a deployed Worker CPU/network
// measurement. A D1 batch is counted once, plus its SQL statement count.
class CountedD1 implements D1DatabaseBinding {
  counts = { first: 0, all: 0, run: 0, batch: 0, batchStatements: 0 };
  constructor(private readonly inner: D1DatabaseBinding) {}
  prepare(query: string): D1PreparedStatementBinding {
    let statement = this.inner.prepare(query);
    const wrapped: D1PreparedStatementBinding = {
      bind: (...values) => { statement = statement.bind(...values); return wrapped; },
      first: async <T>() => { this.counts.first += 1; return statement.first<T>(); },
      all: async <T>() => { this.counts.all += 1; return statement.all<T>(); },
      run: async () => { this.counts.run += 1; return statement.run(); },
    };
    return wrapped;
  }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.counts.batch += 1; this.counts.batchStatements += statements.length;
    // The inner SQLite helper invokes each wrapped run; subtract those calls
    // because production D1 submits the whole batch as one binding call.
    try { return await this.inner.batch<T>(statements); }
    finally { this.counts.run -= statements.length; }
  }
  report() {
    const { first, all, run, batch, batchStatements } = this.counts;
    return { ...this.counts, bindingCalls: first + all + run + batch, sqlStatements: first + all + run + batchStatements };
  }
}

describe("durable S2 observation recovery from committed runs", () => {
  test("recovers a process stopping before observation without reanalyzing, then checkpoints the run", async () => {
    const fixture = await analyze("2026-08-01");
    expect(receipt(fixture.run.runId)).toBeUndefined();
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-01T11:00:00.000Z" }))
      .toEqual([{ runId: fixture.run.runId, outcome: "observed" }]);
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-01T12:00:00.000Z" })).toEqual([]);
    expect(fixture.gateway.calls).toHaveLength(1);
    expect(count("v2_template_pattern_observations")).toBe(1);
    expect(receipt(fixture.run.runId)).toMatchObject({ user_id: owner, operation, idempotency_key: fixture.run.runId,
      payload_hash: fixture.run.job.inputHash, status_code: 200 });
    expect(receipt(fixture.run.runId)?.response_json).not.toContain("PRIVATE_SYNTHETIC");
    expect(db.sql.prepare("select status from v2_processing_jobs where id=?").get(fixture.run.job.id)).toEqual({ status: "succeeded" });
    expect(db.sql.prepare("select status from v2_processing_runs where id=?").get(fixture.run.runId)).toEqual({ status: "succeeded" });
  });

  test("backs off a failed observation and recovers it with only a safe fixed failure code", async () => {
    const fixture = await analyze("2026-08-02", async () => { throw new Error("PRIVATE_SYNTHETIC_ERROR"); });
    expect(fixture.result).toMatchObject({ outcome: "succeeded", patternObservation: "failed" });
    const failed = receipt(fixture.run.runId)!;
    expect(failed.status_code).toBe(503);
    const failure = JSON.parse(failed.response_json);
    expect(failure).toMatchObject({ outcome: "failed", code: "template_pattern_observation_failed", attempt: 1 });
    expect(failed.response_json).not.toContain("PRIVATE_SYNTHETIC");
    expect(await retryAnalysisPatternObservations(db, { now: fixture.run.now })).toEqual([]);
    expect(await retryAnalysisPatternObservations(db, { now: failure.retryAt })).toEqual([{ runId: fixture.run.runId, outcome: "observed" }]);
    expect(fixture.gateway.calls).toHaveLength(1);
  });

  test("recovers an observation committed before all receipt writes fail", async () => {
    db.sql.exec(`create temp trigger fail_pattern_receipt before insert on v2_idempotency_records
      when NEW.operation='${operation}' begin select raise(ABORT,'synthetic receipt outage'); end;`);
    const fixture = await analyze("2026-08-03", observeCompletedAnalysisPattern);
    expect(fixture.result).toMatchObject({ outcome: "succeeded", patternObservation: "failed" });
    expect(count("v2_template_pattern_observations")).toBe(1);
    expect(receipt(fixture.run.runId)).toBeUndefined();
    db.sql.exec("drop trigger fail_pattern_receipt");
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-03T11:00:00.000Z" })).toEqual([{ runId: fixture.run.runId, outcome: "observed" }]);
    expect(count("v2_template_pattern_observations")).toBe(1);
    expect(fixture.gateway.calls).toHaveLength(1);
  });

  test("retries publication even when the third observation was already inserted", async () => {
    await analyze("2026-08-04", observeCompletedAnalysisPattern);
    await analyze("2026-08-05", observeCompletedAnalysisPattern);
    db.sql.exec("create temp trigger fail_generated_template before insert on v2_capture_templates when NEW.origin='ai_derived' begin select raise(ABORT,'synthetic publication outage'); end;");
    const fixture = await analyze("2026-08-06", observeCompletedAnalysisPattern);
    expect(fixture.result).toMatchObject({ outcome: "succeeded", patternObservation: "failed" });
    expect(count("v2_template_pattern_observations")).toBe(3);
    expect(count("v2_capture_templates")).toBe(0);
    db.sql.exec("drop trigger fail_generated_template");
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-06T11:00:00.000Z" })).toEqual([{ runId: fixture.run.runId, outcome: "generated" }]);
    expect(db.sql.prepare("select status,pinned from v2_capture_templates").all()).toEqual([{ status: "generated_draft", pinned: 0 }]);
    expect(count("v2_capture_template_versions")).toBe(1);
    expect(count("v2_template_source_links")).toBe(3);
    expect(fixture.gateway.calls).toHaveLength(1);
  });

  test("a delayed failure cannot downgrade another worker's successful receipt", async () => {
    const fixture = await analyze("2026-08-07");
    let entered!: () => void;
    const enteredObserver = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const failureGate = new Promise<void>((resolve) => { release = resolve; });
    const loser = observeAnalysisPatternWithRetry(db, fixture.run, async () => { entered(); await failureGate; throw new Error("synthetic loser"); });
    const loserRejected = expect(loser).rejects.toThrow("template_pattern_observation_failed");
    await enteredObserver;
    expect(await observeAnalysisPatternWithRetry(db, fixture.run)).toBe("observed");
    release(); await loserRejected;
    expect(receipt(fixture.run.runId)).toMatchObject({ status_code: 200, response_json: JSON.stringify({ outcome: "observed" }) });
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-07T11:00:00.000Z" })).toEqual([]);
    expect(count("v2_template_pattern_observations")).toBe(1);
  });

  test("a bounded sweep moves a persistent failure aside instead of starving later runs", async () => {
    const first = await analyze("2026-08-08");
    const second = await analyze("2026-08-09");
    const observe: Observer = async (database, input) => {
      if (input.runId === first.run.runId) throw new Error("synthetic one-run outage");
      return observeCompletedAnalysisPattern(database, input);
    };
    const now = "2026-08-10T10:00:00.000Z";
    expect(await retryAnalysisPatternObservations(db, { now, limit: 1, observe })).toEqual([{ runId: first.run.runId, outcome: "failed" }]);
    expect(await retryAnalysisPatternObservations(db, { now, limit: 1, observe })).toEqual([{ runId: second.run.runId, outcome: "observed" }]);
    expect(await retryAnalysisPatternObservations(db, { now, limit: 1, observe })).toEqual([]);
    expect(JSON.parse(receipt(first.run.runId)!.response_json).attempt).toBe(1);
    const nextAttempt = JSON.parse(receipt(first.run.runId)!.response_json).retryAt as string;
    expect(await retryAnalysisPatternObservations(db, { now: nextAttempt, limit: 1, observe })).toEqual([{ runId: first.run.runId, outcome: "failed" }]);
    const secondFailure = JSON.parse(receipt(first.run.runId)!.response_json);
    expect(secondFailure.attempt).toBe(2);
    expect(Date.parse(secondFailure.retryAt) - Date.parse(nextAttempt)).toBe(120_000);
  });

  test("conflicting and corrupt terminal receipts cannot starve unrelated due runs", async () => {
    const blocked = [];
    for (const day of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) blocked.push(await analyze(day));
    for (const [index, fixture] of blocked.entries()) db.sql.prepare(`insert into v2_idempotency_records
      (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at) values (?,?,?,?,?,?,?)`)
      .run(owner, operation, fixture.run.runId, index < 3 ? "conflicting-hash" : fixture.run.job.inputHash,
        index < 3 ? JSON.stringify({ outcome: "failed", retryAt: fixture.run.now }) : "not-json", index < 3 ? 503 : 200, fixture.run.now);
    const valid = await analyze("2026-08-05");
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-06T11:00:00.000Z", limit: 3 }))
      .toEqual([{ runId: valid.run.runId, outcome: "observed" }]);
    const observe = vi.fn(observeCompletedAnalysisPattern);
    await expect(observeAnalysisPatternWithRetry(db, blocked[3]!.run, observe)).rejects.toThrow("template_pattern_receipt_conflict");
    expect(observe).not.toHaveBeenCalled();
    expect(receipt(blocked[0]!.run.runId)?.payload_hash).toBe("conflicting-hash");
    expect(receipt(blocked[3]!.run.runId)?.response_json).toBe("not-json");
  });

  test.each(["sensitive", "restricted", "revoked", "archived", "legacy-hidden", "new-revision", "wrong-capture", "wrong-owner", "failed-run", "stale-proposal", "wrong-run-hash"])(
    "rechecks %s before retrying or trusting a success receipt", async (change) => {
      const fixture = await analyze("2026-08-11");
      await observeAnalysisPatternWithRetry(db, fixture.run);
      const previousReceipt = receipt(fixture.run.runId);
      if (change === "sensitive" || change === "restricted") db.sql.prepare("update v2_documents set privacy_level=? where object_id=?").run(change, fixture.capture.objectId);
      if (change === "revoked") db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(fixture.capture.captureId);
      if (change === "archived") db.sql.prepare("update v2_objects set lifecycle_status='archived' where id=?").run(fixture.capture.objectId);
      if (change === "legacy-hidden") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:synthetic-hidden-retry' where id=?").run(fixture.capture.captureId);
      if (change === "new-revision") {
        const edit = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: fixture.capture.revisionId,
          title: "edited", bodyMarkdown: "synthetic new revision", writtenAt: null, documentStatus: "revising", privacyLevel: "normal" }, crypto.randomUUID(), "2026-08-11T11:00:00.000Z");
        await new D1DocumentAuthoringRepository(db, owner).saveRevision(fixture.capture.objectId, edit);
      }
      if (change === "wrong-capture") db.sql.prepare("update v2_processing_jobs set capture_id=? where id=?")
        .run((await analyze("2026-08-12")).capture.captureId, fixture.run.job.id);
      if (change === "wrong-owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(fixture.capture.objectId);
      if (change === "failed-run") db.sql.prepare("update v2_processing_runs set status='failed' where id=?").run(fixture.run.runId);
      if (change === "stale-proposal") db.sql.prepare("update v2_analysis_proposals set status='stale' where run_id=?").run(fixture.run.runId);
      if (change === "wrong-run-hash") db.sql.prepare("update v2_processing_runs set input_hash='different' where id=?").run(fixture.run.runId);
      const observe = vi.fn(observeCompletedAnalysisPattern);
      expect(await observeAnalysisPatternWithRetry(db, fixture.run, observe)).toBe("skipped");
      expect(observe).not.toHaveBeenCalled();
      expect(receipt(fixture.run.runId)).toEqual(previousReceipt);
      // Remove only the checkpoint to exercise recovery's independent fences.
      db.sql.prepare("delete from v2_idempotency_records where operation=? and idempotency_key=?").run(operation, fixture.run.runId);
      const retried = await retryAnalysisPatternObservations(db, { now: "2026-08-12T12:00:00.000Z", observe });
      expect(retried.some((row) => row.runId === fixture.run.runId)).toBe(false);
    },
  );

  test("a foreign caller cannot use another user's run to write an observation receipt", async () => {
    const fixture = await analyze("2026-08-13");
    expect(await observeAnalysisPatternWithRetry(db, { ...fixture.run, job: { ...fixture.run.job, userId: "other-owner" } })).toBe("skipped");
    expect(receipt(fixture.run.runId)).toBeUndefined();
    expect(count("v2_template_pattern_observations")).toBe(0);
  });

  test("a skipped run is checkpointed and cannot starve later eligible observations", async () => {
    const first = await analyze("2026-08-13");
    const second = await analyze("2026-08-14");
    db.sql.prepare("update v2_property_values set review_status='rejected' where processing_run_id=?").run(first.run.runId);
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-14T11:00:00.000Z", limit: 1 }))
      .toEqual([{ runId: first.run.runId, outcome: "skipped" }]);
    expect(await retryAnalysisPatternObservations(db, { now: "2026-08-14T11:00:00.000Z", limit: 1 }))
      .toEqual([{ runId: second.run.runId, outcome: "observed" }]);
    expect(count("v2_template_pattern_observations")).toBe(1);
  });

  test("consent revoked after retry selection is checked again before observation storage", async () => {
    const fixture = await analyze("2026-08-13");
    const outcomes = await retryAnalysisPatternObservations(db, { now: "2026-08-13T11:00:00.000Z", observe: async (database, input) => {
      db.sql.prepare("update v2_capture_bundles set ai_enabled=0 where id=?").run(fixture.capture.captureId);
      return observeCompletedAnalysisPattern(database, input);
    } });
    expect(outcomes).toEqual([{ runId: fixture.run.runId, outcome: "skipped" }]);
    expect(count("v2_template_pattern_observations")).toBe(0);
  });

  test.each(["try", "keep", "dismiss", "archive"] as const)("recovery preserves the user's %s template choice", async (action) => {
    const fixtures = [];
    for (const day of ["2026-08-14", "2026-08-15", "2026-08-16"]) fixtures.push(await analyze(day, observeCompletedAnalysisPattern));
    const templates = new D1TemplateRepository(db, owner);
    const generated = (await templates.list()).find((item) => item.origin === "ai_derived")!;
    await templates.transition(generated.id, action);
    const before = db.sql.prepare("select * from v2_capture_templates where id=?").get(generated.id);
    const versions = db.sql.prepare("select * from v2_capture_template_versions where template_id=?").all(generated.id);
    const links = db.sql.prepare("select * from v2_template_source_links where template_version_id=?").all(generated.currentVersionId);
    db.sql.prepare("delete from v2_idempotency_records where operation=? and idempotency_key=?").run(operation, fixtures[2]!.run.runId);
    await retryAnalysisPatternObservations(db, { now: "2026-08-17T10:00:00.000Z" });
    expect(db.sql.prepare("select * from v2_capture_templates where id=?").get(generated.id)).toEqual(before);
    expect(db.sql.prepare("select * from v2_capture_template_versions where template_id=?").all(generated.id)).toEqual(versions);
    expect(db.sql.prepare("select * from v2_template_source_links where template_version_id=?").all(generated.currentVersionId)).toEqual(links);
  });

  test("the authenticated HTTP runner recovers observations while the AI governor is paused", async () => {
    const fixture = await analyze("2026-08-18");
    const provider = new FakeV2StructuredModelGateway("provider_unavailable");
    harness.gateways.mockReturnValue({ mainAnalyzer: provider, groundedResearch: provider });
    db.sql.prepare("insert into v2_ai_runtime_state(model_role,state,retry_after,consecutive_failures,updated_at) values ('main_analyzer','quota_exhausted','2099-01-01T00:00:00.000Z',1,?)")
      .run("2026-08-18T11:00:00.000Z");
    const response = await runHttp();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ patternObservationRetries: { outcome: "completed", outcomes: [{ runId: fixture.run.runId, outcome: "observed" }] } });
    expect(provider.calls).toHaveLength(0);
  });

  test("HTTP recovery errors stay isolated from successful analysis responses", async () => {
    await analyze("2026-08-19");
    const provider = new FakeV2StructuredModelGateway("provider_unavailable");
    harness.gateways.mockReturnValue({ mainAnalyzer: provider, groundedResearch: provider });
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation((query) => {
      if (query.includes("left join v2_idempotency_records receipt")) throw new Error("PRIVATE_SYNTHETIC_DATABASE_OUTAGE");
      return prepare(query);
    });
    const response = await runHttp();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ patternObservationRetries: { outcome: "failed", outcomes: [] } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SYNTHETIC");
    spy.mockRestore();
    expect((await runHttp()).status).toBe(200);
    expect(count("v2_template_pattern_observations")).toBe(1);
    expect(provider.calls).toHaveLength(0);
  });

  test("unauthorized HTTP requests cannot run observation recovery", async () => {
    const fixture = await analyze("2026-08-20");
    const response = await processJobs(new Request("https://lighthouse.test/api/v2/processing/run", { method: "POST", headers: { authorization: "Bearer wrong" } }));
    expect(response.status).toBe(401);
    expect(receipt(fixture.run.runId)).toBeUndefined();
    expect(count("v2_template_pattern_observations")).toBe(0);
    expect(harness.gateways).not.toHaveBeenCalled();
  });

  test("bounds HTTP recovery at three runs without consuming the three main-analysis slots", async () => {
    for (const day of ["2026-08-21", "2026-08-22", "2026-08-23"]) await analyze(day);
    const queued = await Promise.all(["2026-08-24", "2026-08-25", "2026-08-26"].map(prepareAnalysis));
    const counted = new CountedD1(db);
    harness.bindings.mockReturnValue({ db: counted });
    harness.gateways.mockReturnValue({ mainAnalyzer: { async generate<T>(request: V2StructuredModelRequest) {
      const target = JSON.parse((request.parts![0] as { text: string }).text).target.capture_id;
      const fixture = queued.find((item) => item.capture.captureId === target);
      if (!fixture) throw new Error("Unexpected synthetic provider target.");
      return fixture.gateway.generate<T>(request);
    } }, groundedResearch: new FakeV2StructuredModelGateway("provider_unavailable") });
    const response = await runHttp();
    expect(response.status).toBe(200);
    const result = await response.json();
    const observations = result as { patternObservationRetries: { outcomes: unknown[] }; analysisOutcomes: { outcome: string }[] };
    expect(observations.patternObservationRetries.outcomes).toHaveLength(3);
    expect(observations.analysisOutcomes.filter((outcome) => outcome.outcome === "succeeded")).toHaveLength(3);
    expect(queued.reduce((total, fixture) => total + fixture.gateway.calls.length, 0)).toBe(3);
    expect(count("v2_template_pattern_observations")).toBe(6);
    console.info("S2_RETRY_BINDING_OBSERVATION", JSON.stringify({ fixture: "three-recovered-plus-three-new-analysis-runs", ...counted.report() }));
  });
});
