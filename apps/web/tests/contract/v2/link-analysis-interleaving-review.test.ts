import { expect, test } from "vitest";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { V2ModelError, type V2StructuredModelGateway } from "@/lib/v2/ai/gateway";
import { type AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite } from "../../support/link-sqlite";

async function personalFixture(db: LinkSqlite) {
  const key = crypto.randomUUID();
  const capture = await prepareCaptureCommit({ draftId: key, channel: "web", title: "Personal note before external source", bodyMarkdown: "Only my own words",
    aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, key);
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  await new D1ProcessingQueueRepository(db).dispatchPending();
  return capture;
}

function envelope(capture: Awaited<ReturnType<typeof personalFixture>>): AnalysisEnvelopeV1 {
  return { contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "en", bundle_summary: "Personal summary",
    document_proposals: [], entity_proposals: [], event_proposals: [], field_proposals: [], enrichment_requests: [], review_items: [], warnings: [] };
}

async function protectedLinkState(db: LinkSqlite, capture: Awaited<ReturnType<typeof personalFixture>>) {
  const snapshot = await new D1LinkSnapshotRepository(db, "link-owner").createSnapshot({
    documentId: capture.objectId, expectedRevisionId: capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0,
    sourceItemIds: [], newManualSources: [{ rawText: "External author prompt\nsecond line", metadata: makeManualLinkMetadata({ url: "https://example.test/new-source" }) }],
    idempotencyKey: crypto.randomUUID(),
  });
  const queued = await new D1LinkAnalysisRepository(db).enqueue("link-owner", { documentId: capture.objectId, expectedRevisionId: capture.revisionId,
    expectedSnapshotId: snapshot.snapshot.id, expectedManifestHash: snapshot.snapshot.manifestHash, idempotencyKey: crypto.randomUUID() });
  const queue = new D1ProcessingQueueRepository(db);
  const job = await queue.claim("protected-link-worker", new Date(), 120_000, "link_analyze");
  expect(job?.id).toBe(queued.jobId);
  const runId = crypto.randomUUID();
  expect(await queue.beginRun(job!, { runId, modelId: "synthetic", promptVersion: "review.v1", schemaVersion: "review.v1", registryVersion: "review.v1", modelConfigVersion: "review.v1", now: new Date().toISOString() })).toBe(true);
  expect(await queue.acquireProviderInvocationLease(job!, { runId })).toBe(true);
  return {
    jobId: job!.id, runId, captureId: capture.captureId,
    job: db.sql.prepare("select * from v2_processing_jobs where id=?").get(job!.id),
    run: db.sql.prepare("select * from v2_processing_runs where id=?").get(runId),
    lease: db.sql.prepare("select * from v2_provider_invocation_leases where job_id=?").get(job!.id),
    capture: db.sql.prepare("select * from v2_capture_bundles where id=?").get(capture.captureId),
    document: db.sql.prepare("select * from v2_documents where object_id=?").get(capture.objectId),
  };
}

function assertProtected(db: LinkSqlite, capture: Awaited<ReturnType<typeof personalFixture>>, state: Awaited<ReturnType<typeof protectedLinkState>>) {
  expect(db.sql.prepare("select * from v2_processing_jobs where id=?").get(state.jobId)).toEqual(state.job);
  expect(db.sql.prepare("select * from v2_processing_runs where id=?").get(state.runId)).toEqual(state.run);
  expect(db.sql.prepare("select * from v2_provider_invocation_leases where job_id=?").get(state.jobId)).toEqual(state.lease);
  expect(db.sql.prepare("select * from v2_capture_bundles where id=?").get(capture.captureId)).toEqual(state.capture);
  expect(db.sql.prepare("select * from v2_documents where object_id=?").get(capture.objectId)).toEqual(state.document);
  expect(db.sql.prepare("select count(*) n from v2_analysis_proposals").get()).toEqual({ n: 0 });
  expect(db.sql.prepare("select count(*) n from v2_property_values").get()).toEqual({ n: 0 });
  expect(db.sql.prepare("select count(*) n from v2_review_items").get()).toEqual({ n: 0 });
}

function interleavedDb(db: LinkSqlite, hooks: { afterFirst?: (query: string) => Promise<void>; beforeBatch?: (queries: string[]) => Promise<void> }): D1DatabaseBinding {
  const queries = new WeakMap<D1PreparedStatementBinding, string>();
  return {
    prepare(query) {
      let statement = db.prepare(query);
      const wrapped: D1PreparedStatementBinding = {
        bind: (...values) => { statement = statement.bind(...values); return wrapped; },
        first: async <T>() => { const result = await statement.first<T>(); await hooks.afterFirst?.(query); return result; },
        all: <T>() => statement.all<T>(), run: () => statement.run(),
      };
      queries.set(wrapped, query); return wrapped;
    },
    batch: async <T>(statements: D1PreparedStatementBinding[]) => { await hooks.beforeBatch?.(statements.map((statement) => queries.get(statement) ?? "")); return db.batch<T>(statements); },
  };
}

test("new external originals cannot enter a personal job when source saving interleaves after its initial probe", async () => {
  const raw = new LinkSqlite();
  try {
    const capture = await prepareCaptureCommit({ draftId: "personal-race", channel: "web", title: "My own reflection", bodyMarkdown: "My personal note",
      aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, "personal-race");
    await new D1SourceFoundationRepository(raw, "link-owner").commitCapture(capture);
    const baseQueue = new D1ProcessingQueueRepository(raw);
    await baseQueue.dispatchPending();
    const job = await baseQueue.claim("independent-provenance-review");
    expect(job).not.toBeNull();
    let inserted = false;
    const externalText = "EXTERNAL AUTHOR: I moved to Mars and made these image prompts.";
    const hooked: D1DatabaseBinding = {
      prepare(query: string) {
        let original = raw.prepare(query);
        const wrapped: D1PreparedStatementBinding = {
          bind: (...values) => { original = original.bind(...values); return wrapped; },
          first: async <T>() => {
            const result = await original.first<T>();
            if (!inserted && query.includes("json_type(s.source_metadata,'$.manualLinkV1')")) {
              inserted = true;
              await new D1LinkSnapshotRepository(raw, "link-owner").createSnapshot({
                documentId: capture.objectId, expectedRevisionId: capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0,
                sourceItemIds: [], newManualSources: [{ rawText: externalText, metadata: makeManualLinkMetadata({ url: "https://example.test/external" }) }],
                idempotencyKey: "concurrent-manual-save",
              });
            }
            return result;
          },
          all: <T>() => original.all<T>(), run: () => original.run(),
        };
        return wrapped;
      },
      batch: <T>(statements: D1PreparedStatementBinding[]) => raw.batch<T>(statements),
    };
    const loaded = await new D1ProcessingQueueRepository(hooked).loadAnalysisInput(job!);
    expect(inserted).toBe(true);
    expect(loaded?.sources.some((source) => source.rawText === externalText) ?? false).toBe(false);
  } finally { raw.sql.close(); }
});

test("a generic provider lease refuses an external source added after personal input was loaded", async () => {
  const db = new LinkSqlite();
  try {
    const capture = await prepareCaptureCommit({ draftId: "personal-lease-race", channel: "web", title: "Personal input before source addition", bodyMarkdown: "My own note",
      aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, "personal-lease-race");
    await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const job = await queue.claim("generic-provider-boundary-review");
    expect(job).not.toBeNull();
    const runId = "generic-provider-boundary-run";
    expect(await queue.beginRun(job!, { runId, modelId: "synthetic", promptVersion: "review.v1", schemaVersion: "review.v1", registryVersion: "review.v1", modelConfigVersion: "review.v1", now: new Date().toISOString() })).toBe(true);
    expect(await queue.loadAnalysisInput(job!)).not.toBeNull();
    await new D1LinkSnapshotRepository(db, "link-owner").createSnapshot({
      documentId: capture.objectId, expectedRevisionId: capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0,
      sourceItemIds: [], newManualSources: [{ rawText: "Another author's source", metadata: makeManualLinkMetadata({ url: "https://example.test/after-input" }) }],
      idempotencyKey: "source-before-generic-lease",
    });
    expect(await queue.acquireProviderInvocationLease(job!, { runId })).toBe(false);
    expect(db.sql.prepare("select count(*) as count from v2_provider_invocation_leases where job_id=?").get(job!.id)).toEqual({ count: 0 });
  } finally { db.sql.close(); }
});

test.each(["initial_probe", "before_lease", "provider_return", "completion_read", "completion_batch", "provider_error", "failure_batch"] as const)(
  "generic runner preserves new link state when source addition occurs at %s", async (point) => {
    const db = new LinkSqlite();
    try {
      const capture = await personalFixture(db);
      let protectedState: Awaited<ReturnType<typeof protectedLinkState>> | null = null;
      let providerCalls = 0;
      const add = async () => { if (!protectedState) protectedState = await protectedLinkState(db, capture); };
      const hooked = interleavedDb(db, {
        afterFirst: async (query) => {
          if (point === "initial_probe" && query.includes("json_type(s.source_metadata,'$.manualLinkV1')")) await add();
          if (point === "completion_read" && query.includes("select d.current_revision_id from v2_documents")) await add();
        },
        beforeBatch: async (queries) => {
          if (point === "completion_batch" && queries.some((query) => query.includes("insert into v2_analysis_proposals"))) await add();
          if (point === "failure_batch" && providerCalls > 0 && queries.some((query) => query.includes("update v2_processing_runs set status='failed'"))) await add();
        },
      });
      const queue = new D1ProcessingQueueRepository(hooked);
      if (point === "before_lease") {
        const load = queue.loadAnalysisInput.bind(queue);
        queue.loadAnalysisInput = async (job) => { const loaded = await load(job); await add(); return loaded; };
      }
      const fake = new FakeV2StructuredModelGateway("success", envelope(capture));
      const gateway: V2StructuredModelGateway = {
        async generate<T>(request: Parameters<V2StructuredModelGateway["generate"]>[0]) {
          providerCalls += 1;
          if (point === "provider_return" || point === "provider_error") await add();
          if (point === "provider_error" || point === "failure_batch") throw new V2ModelError("provider_unavailable", "Synthetic late provider failure", true);
          return fake.generate<T>(request);
        },
      };
      const result = await runNextAnalysisJob({ queue, gateway, workerId: "old-personal-runner" });
      expect(protectedState).not.toBeNull();
      expect(providerCalls).toBe(["initial_probe", "before_lease"].includes(point) ? 0 : 1);
      expect(fake.calls).toHaveLength(["initial_probe", "before_lease", "provider_error", "failure_batch"].includes(point) ? 0 : 1);
      if (point === "provider_error" || point === "failure_batch") expect.soft(db.sql.prepare("select * from v2_capture_bundles where id=?").get(capture.captureId)).toEqual(protectedState!.capture);
      const generic = db.sql.prepare("select id,status,lease_owner from v2_processing_jobs where stage='analyze'").get()!;
      expect(generic).toMatchObject({ status: "superseded", lease_owner: null });
      expect(db.sql.prepare("select status from v2_processing_runs where job_id=?").get(generic.id)).toEqual({ status: "superseded" });
      expect(db.sql.prepare("select count(*) n from v2_provider_invocation_leases where job_id=?").get(generic.id)).toEqual({ n: 0 });
      expect(["superseded", "stale"]).toContain(result.outcome);
      assertProtected(db, capture, protectedState!);
    } finally { db.sql.close(); }
  },
);

test("a reclaimed old personal attempt cannot mutate a new attempt or a newer link lease", async () => {
  const db = new LinkSqlite();
  try {
    const capture = await personalFixture(db);
    const queue = new D1ProcessingQueueRepository(db);
    const old = await queue.claim("old-worker"); expect(old).not.toBeNull();
    const config = { modelId: "synthetic", promptVersion: "review.v1", schemaVersion: "review.v1", registryVersion: "review.v1", modelConfigVersion: "review.v1", now: new Date().toISOString() };
    await queue.beginRun(old!, { ...config, runId: "old-run" });
    await queue.acquireProviderInvocationLease(old!, { runId: "old-run" });
    db.sql.prepare("update v2_processing_jobs set lease_expires_at='2000-01-01T00:00:00.000Z' where id=?").run(old!.id);
    db.sql.prepare("update v2_provider_invocation_leases set expires_at='2000-01-01T00:00:00.000Z' where job_id=?").run(old!.id);
    const current = await queue.claim("new-worker"); expect(current?.id).toBe(old!.id); expect(current?.leaseOwner).not.toBe(old!.leaseOwner);
    await queue.beginRun(current!, { ...config, runId: "new-run" });
    expect(await queue.acquireProviderInvocationLease(current!, { runId: "new-run" })).toBe(true);
    const protectedState = await protectedLinkState(db, capture);
    const beforeJob = db.sql.prepare("select * from v2_processing_jobs where id=?").get(current!.id);
    const beforeRun = db.sql.prepare("select * from v2_processing_runs where id='new-run'").get();
    const beforeLease = db.sql.prepare("select * from v2_provider_invocation_leases where job_id=?").get(current!.id);
    expect(await queue.supersedeExternalAnalysis(old!, "old-run", new Date().toISOString())).toBe(false);
    expect(await queue.acquireProviderInvocationLease(old!, { runId: "old-run" })).toBe(false);
    expect(await queue.completeAnalysis({ job: old!, runId: "old-run", envelope: envelope(capture), outputHash: "late", modelId: "synthetic", latencyMs: 1, inputTokens: 1, outputTokens: 1, schemaVersion: "review.v1", validatorVersion: "review.v1", now: new Date().toISOString() })).toEqual({ stale: true });
    await queue.failJob(old!, { runId: "old-run", errorClass: "Synthetic", errorCode: "provider_unavailable", retryable: true });
    expect(db.sql.prepare("select * from v2_processing_jobs where id=?").get(current!.id)).toEqual(beforeJob);
    expect(db.sql.prepare("select * from v2_processing_runs where id='new-run'").get()).toEqual(beforeRun);
    expect(db.sql.prepare("select * from v2_provider_invocation_leases where job_id=?").get(current!.id)).toEqual(beforeLease);
    assertProtected(db, capture, protectedState);
  } finally { db.sql.close(); }
});

test.each([false, true])("expired generic recovery preserves new link state (attempts exhausted=%s)", async (exhausted) => {
  const db = new LinkSqlite();
  try {
    const capture = await personalFixture(db);
    const queue = new D1ProcessingQueueRepository(db);
    const old = await queue.claim("expiring-personal-worker"); expect(old).not.toBeNull();
    await queue.beginRun(old!, { runId: "expiring-run", modelId: "synthetic", promptVersion: "review.v1", schemaVersion: "review.v1", registryVersion: "review.v1", modelConfigVersion: "review.v1", now: new Date().toISOString() });
    expect(await queue.acquireProviderInvocationLease(old!, { runId: "expiring-run" })).toBe(true);
    const protectedState = await protectedLinkState(db, capture);
    db.sql.prepare(`update v2_processing_jobs set lease_expires_at='2000-01-01T00:00:00.000Z'${exhausted ? ",attempt=max_attempts" : ""} where id=?`).run(old!.id);
    db.sql.prepare("update v2_provider_invocation_leases set expires_at='2000-01-01T00:00:00.000Z' where job_id=?").run(old!.id);
    const fake = new FakeV2StructuredModelGateway("success", envelope(capture));
    await runNextAnalysisJob({ queue, gateway: fake, workerId: "generic-recovery-worker" });
    expect(fake.calls).toHaveLength(0);
    assertProtected(db, capture, protectedState);
  } finally { db.sql.close(); }
});
