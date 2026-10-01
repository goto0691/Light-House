import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { LINK_ANALYSIS_CONTRACT, LINK_ANALYSIS_PROMPT_VERSION, resolveLinkAnalysis, type LinkAnalysisEnvelopeV1, type PreparedLinkAnalysis } from "@/lib/v2/ai/link-analysis-v1";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationDirectory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
let db: TestD1;
let links: D1LinkAnalysisRepository;
let queue: D1ProcessingQueueRepository;
const exact = "Title\r\n  portrait 👀, grain  \r\n--ar 3:2\n";

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec("create table users (id text primary key not null); insert into users (id) values ('link-owner'),('link-other');");
  for (const name of (await readdir(migrationDirectory)).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 31).sort()) {
    for (const statement of (await readFile(`${migrationDirectory}/${name}`, "utf8")).split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  links = new D1LinkAnalysisRepository(db);
  queue = new D1ProcessingQueueRepository(db);
}, 60_000);
beforeEach(async () => {
  await db.prepare("delete from v2_provider_invocation_leases").run();
  await db.prepare("update v2_processing_jobs set status='superseded',lease_owner=null,lease_expires_at=null where status in ('queued','leased','running','retry_wait')").run();
  await db.prepare("update v2_processing_runs set status='superseded' where status='running'").run();
});
afterAll(async () => platform?.dispose());

async function seed(rawText = exact, privacyLevel: "normal" | "restricted" = "normal") {
  const prepared = await prepareCaptureCommit({
    draftId: `link-analysis-${crypto.randomUUID()}`, channel: "web", bodyMarkdown: "내 메모: 좋은 그림 같아.", aiEnabled: false,
    privacyLevel, clientTimezone: "Asia/Seoul", capturedAt: new Date().toISOString(),
    sources: [{ kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://threads.com/@author/post/example", purpose: "prompt" }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(prepared);
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner");
  const projection = await snapshots.bootstrapManualSources({ documentId: prepared.objectId, expectedRevisionId: prepared.revisionId, idempotencyKey: crypto.randomUUID(), restrictedUnlocked: privacyLevel === "restricted" });
  const request = { documentId: prepared.objectId, expectedRevisionId: prepared.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash };
  return { capture: prepared, projection, request, snapshots };
}

async function running(fixture: Awaited<ReturnType<typeof seed>>, providerLease = true) {
  const enqueued = await links.enqueue("link-owner", fixture.request);
  const job = (await queue.claim("link-test", new Date(), 120_000, "link_analyze"))!;
  expect(job.id).toBe(enqueued.jobId);
  const runId = crypto.randomUUID();
  expect(await queue.beginRun(job, { runId, modelId: "fake-link", promptVersion: LINK_ANALYSIS_PROMPT_VERSION, schemaVersion: LINK_ANALYSIS_CONTRACT, registryVersion: "link.v1", modelConfigVersion: "test", now: new Date().toISOString() })).toBe(true);
  const prepared = (await links.loadInput(job))!;
  expect(prepared).not.toBeNull();
  if (providerLease) expect(await queue.acquireProviderInvocationLease(job, { runId })).toBe(true);
  return { job, runId, prepared };
}
function envelope(prepared: PreparedLinkAnalysis): LinkAnalysisEnvelopeV1 {
  return {
    contract_version: LINK_ANALYSIS_CONTRACT, snapshot_id: prepared.identity.snapshotId, analyzed_revision_id: prepared.identity.documentRevisionId,
    manifest_hash: prepared.identity.manifestHash, manifest_version: prepared.identity.manifestVersion,
    fragments: [{ fragment_key: "p1", role: "prompt", selection: { member_key: prepared.sources[0].memberKey, first_block: 1, last_block: 2 } }],
    interpretations: [{ fragment_key: "idea", role: "insight", text: "외부 저자의 스타일 요약 후보", evidence: [{ member_key: prepared.sources[0].memberKey, first_block: 1, last_block: 1 }] }],
  };
}
async function complete(attempt: Awaited<ReturnType<typeof running>>) {
  return links.complete({ ...attempt, resolved: await resolveLinkAnalysis(envelope(attempt.prepared), attempt.prepared), outputHash: "fake-output-hash", modelId: "fake-link", latencyMs: 1, inputTokens: 20, outputTokens: 10, now: new Date().toISOString() });
}
async function nextSnapshot(fixture: Awaited<ReturnType<typeof seed>>) {
  return fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId, expectedRevisionId: fixture.capture.revisionId,
    expectedSnapshotId: fixture.projection.snapshot.id, expectedSnapshotVersion: 1,
    sourceItemIds: fixture.projection.members.map((member) => member.sourceItemId),
    newManualSources: [{ rawText: "new source", metadata: makeManualLinkMetadata({ url: "https://threads.com/@author/post/two" }) }], idempotencyKey: crypto.randomUUID() });
}

describe("link text analysis D1 ownership, snapshot and publication fences", () => {
  test("concurrent explicit gestures and retries coalesce atomically into one D1 job", async () => {
    const fixture = await seed();
    const prefix = crypto.randomUUID();
    const results = await Promise.all(["a", "a", "b", "c", "c"].map((key) => links.enqueue("link-owner", { ...fixture.request, idempotencyKey: `${prefix}-${key}` })));
    expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
    expect(await db.prepare("select count(*) n from v2_processing_jobs where object_id=?").bind(fixture.capture.objectId).first()).toEqual({ n: 1 });
    expect(await db.prepare("select count(*) n from v2_idempotency_records where user_id=? and operation='link_analysis.enqueue.v1' and idempotency_key like ?")
      .bind("link-owner", `${prefix}%`).first()).toEqual({ n: 3 });
  });

  test("a new gesture sharing an active provider invocation does not reset its lease or capture status", async () => {
    const fixture = await seed();
    const attempt = await running(fixture);
    const beforeJob = await db.prepare("select * from v2_processing_jobs where id=?").bind(attempt.job.id).first();
    const beforeLease = await db.prepare("select * from v2_provider_invocation_leases where job_id=?").bind(attempt.job.id).first();
    const beforeCapture = await db.prepare("select * from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first();
    expect(await links.enqueue("link-owner", { ...fixture.request, idempotencyKey: crypto.randomUUID() })).toEqual({ jobId: attempt.job.id, status: "running", replayed: true });
    expect(await db.prepare("select * from v2_processing_jobs where id=?").bind(attempt.job.id).first()).toEqual(beforeJob);
    expect(await db.prepare("select * from v2_provider_invocation_leases where job_id=?").bind(attempt.job.id).first()).toEqual(beforeLease);
    expect(await db.prepare("select * from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first()).toEqual(beforeCapture);
    expect(await complete(attempt)).toEqual({ stale: false });
  });

  test("explicitly enqueues only a link stage, idempotently, without turning generic capture AI on", async () => {
    const fixture = await seed();
    const one = await links.enqueue("link-owner", fixture.request);
    const two = await links.enqueue("link-owner", fixture.request);
    expect(two).toEqual({ jobId: one.jobId, status: "queued", replayed: true });
    expect(await db.prepare("select stage,input_link_snapshot_id,input_source_manifest_hash from v2_processing_jobs where id=?").bind(one.jobId).first())
      .toEqual({ stage: "link_analyze", input_link_snapshot_id: fixture.projection.snapshot.id, input_source_manifest_hash: fixture.projection.snapshot.manifestHash });
    expect(await db.prepare("select ai_enabled from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first()).toEqual({ ai_enabled: 0 });
    expect(await queue.claim("generic-claim")).toBeNull();
  });

  test("publishes exact original extracts and proposed interpretations with normalized evidence only", async () => {
    const fixture = await seed();
    const attempt = await running(fixture);
    expect(JSON.stringify(attempt.prepared.request)).not.toContain("내 메모");
    expect(await complete(attempt)).toEqual({ stale: false });
    expect((await db.prepare("select raw_text,derived_text,source_class,review_status from v2_link_fragments where processing_run_id=? order by display_order").bind(attempt.runId).all()).results).toEqual([
      { raw_text: "  portrait 👀, grain  \r\n--ar 3:2\n", derived_text: null, source_class: "source_extract", review_status: "proposed" },
      { raw_text: null, derived_text: "외부 저자의 스타일 요약 후보", source_class: "ai_interpretation", review_status: "proposed" },
    ]);
    expect(await db.prepare("select published_link_run_id,body_markdown from v2_documents where object_id=?").bind(fixture.capture.objectId).first())
      .toEqual({ published_link_run_id: attempt.runId, body_markdown: "내 메모: 좋은 그림 같아." });
    expect(await db.prepare("select count(*) as n from v2_property_values where processing_run_id=?").bind(attempt.runId).first()).toEqual({ n: 0 });
    expect(await db.prepare("select count(*) as n from v2_link_fragment_evidence e join v2_link_fragments f on f.id=e.fragment_id where f.processing_run_id=?").bind(attempt.runId).first()).toEqual({ n: 2 });
    expect(await db.prepare("select count(*) as n from v2_provider_invocation_leases where run_id=?").bind(attempt.runId).first()).toEqual({ n: 0 });
  });

  test("same-body new snapshot makes late results history-only and leaves new source state intact", async () => {
    const fixture = await seed();
    const attempt = await running(fixture);
    const newer = await nextSnapshot(fixture);
    expect(await complete(attempt)).toEqual({ stale: true });
    expect(await db.prepare("select current_revision_id,current_link_snapshot_id,published_link_run_id from v2_documents where object_id=?").bind(fixture.capture.objectId).first())
      .toEqual({ current_revision_id: fixture.capture.revisionId, current_link_snapshot_id: newer.snapshot.id, published_link_run_id: null });
    expect(await db.prepare("select status from v2_processing_runs where id=?").bind(attempt.runId).first()).toEqual({ status: "stale" });
    expect((await db.prepare("select distinct review_status from v2_link_fragments where processing_run_id=?").bind(attempt.runId).all()).results).toEqual([{ review_status: "superseded" }]);
  });

  test("refuses a provider lease when snapshot changes after input preparation", async () => {
    const fixture = await seed();
    const attempt = await running(fixture, false);
    await nextSnapshot(fixture);
    expect(await links.loadInput(attempt.job)).toBeNull();
    expect(await queue.acquireProviderInvocationLease(attempt.job, { runId: attempt.runId })).toBe(false);
    await links.supersedeAttempt(attempt.job, attempt.runId, new Date().toISOString());
    expect(await db.prepare("select status from v2_processing_jobs where id=?").bind(attempt.job.id).first()).toEqual({ status: "superseded" });
  });

  test("enqueue CAS race creates no job and does not stamp the newer capture processing state", async () => {
    const fixture = await seed();
    let changed = false;
    const raced: D1DatabaseBinding = { prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (!changed) { changed = true; await nextSnapshot(fixture); await db.prepare("update v2_capture_bundles set processing_status='completed' where id=?").bind(fixture.capture.captureId).run(); }
      return db.batch(statements);
    } };
    await expect(new D1LinkAnalysisRepository(raced).enqueue("link-owner", fixture.request)).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    expect(await db.prepare("select count(*) as n from v2_processing_jobs where object_id=?").bind(fixture.capture.objectId).first()).toEqual({ n: 0 });
    expect(await db.prepare("select processing_status from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first()).toEqual({ processing_status: "completed" });
  });

  test.each([false, true])("completion CAS race atomically rolls back publication (empty=%s)", async (empty) => {
    const fixture = await seed();
    const attempt = await running(fixture);
    let changed = false;
    const raced: D1DatabaseBinding = { prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (!changed) { changed = true; await nextSnapshot(fixture); }
      return db.batch(statements);
    } };
    const output = envelope(attempt.prepared);
    const resolved = await resolveLinkAnalysis(empty ? { ...output, fragments: [], interpretations: [] } : output, attempt.prepared);
    expect(await new D1LinkAnalysisRepository(raced).complete({ ...attempt, resolved, outputHash: "fake", modelId: "fake", latencyMs: 1, inputTokens: 1, outputTokens: 1, now: new Date().toISOString() })).toEqual({ stale: true });
    expect(await db.prepare("select count(*) as n from v2_link_fragments where processing_run_id=?").bind(attempt.runId).first()).toEqual({ n: 0 });
    expect(await db.prepare("select published_link_run_id from v2_documents where object_id=?").bind(fixture.capture.objectId).first()).toEqual({ published_link_run_id: null });
  });

  test("failure CAS never stamps a newer same-revision snapshot as failed", async () => {
    const fixture = await seed();
    const attempt = await running(fixture);
    await nextSnapshot(fixture);
    await db.prepare("update v2_capture_bundles set processing_status='completed' where id=?").bind(fixture.capture.captureId).run();
    await queue.failJob(attempt.job, { runId: attempt.runId, errorClass: "V2ModelError", errorCode: "quota_exhausted", retryable: true, reviewMessage: "old error" });
    expect(await db.prepare("select processing_status from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first()).toEqual({ processing_status: "completed" });
    expect(await db.prepare("select count(*) as n from v2_review_items where processing_run_id=?").bind(attempt.runId).first()).toEqual({ n: 0 });
    expect(await db.prepare("select status from v2_processing_runs where id=?").bind(attempt.runId).first()).toEqual({ status: "superseded" });
    expect(await db.prepare("select status from v2_processing_jobs where id=?").bind(attempt.job.id).first()).toEqual({ status: "superseded" });
  });

  test("foreign owner, restricted records and URL-only sources cannot enqueue provider work", async () => {
    const fixture = await seed();
    await expect(links.enqueue("link-other", fixture.request)).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    await expect(links.enqueue("link-owner", (await seed(exact, "restricted")).request)).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    await expect(links.enqueue("link-owner", (await seed("")).request)).rejects.toMatchObject({ code: "link_analysis_needs_input" });
  });

  test("missing provider lease cannot write derived fragments", async () => {
    const fixture = await seed();
    const attempt = await running(fixture, false);
    expect(await complete(attempt)).toEqual({ stale: true });
    expect(await db.prepare("select count(*) as n from v2_link_fragments where processing_run_id=?").bind(attempt.runId).first()).toEqual({ n: 0 });
  });

  test("a late reclaimed attempt cannot overwrite or retire the new worker lease", async () => {
    const fixture = await seed();
    const old = await running(fixture);
    const expired = new Date(Date.now() - 1000).toISOString();
    await db.prepare("update v2_provider_invocation_leases set expires_at=? where job_id=?").bind(expired, old.job.id).run();
    await db.prepare("update v2_processing_jobs set lease_expires_at=? where id=?").bind(expired, old.job.id).run();
    const replacement = (await queue.claim("replacement-worker", new Date(), 120_000, "link_analyze"))!;
    const replacementRun = crypto.randomUUID();
    expect(await queue.beginRun(replacement, { runId: replacementRun, modelId: "fake", promptVersion: LINK_ANALYSIS_PROMPT_VERSION, schemaVersion: LINK_ANALYSIS_CONTRACT, registryVersion: "test", modelConfigVersion: "test", now: new Date().toISOString() })).toBe(true);
    expect(await queue.acquireProviderInvocationLease(replacement, { runId: replacementRun })).toBe(true);
    const replacementState = async () => Promise.all([
      db.prepare("select * from v2_processing_jobs where id=?").bind(replacement.id).first(),
      db.prepare("select * from v2_processing_runs where id=?").bind(replacementRun).first(),
      db.prepare("select * from v2_provider_invocation_leases where job_id=?").bind(replacement.id).first(),
      db.prepare("select processing_status from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first(),
      db.prepare("select count(*) as n from v2_review_items where object_id=?").bind(fixture.capture.objectId).first(),
    ]);
    const baseline = await replacementState();
    expect(await complete(old)).toEqual({ stale: true });
    expect(await replacementState()).toEqual(baseline);
    await queue.failJob(old.job, { runId: old.runId, errorClass: "V2ModelError", errorCode: "quota_exhausted", retryable: true, reviewMessage: "late old worker failure" });
    expect(await replacementState()).toEqual(baseline);
    await links.supersedeAttempt(old.job, old.runId, new Date().toISOString());
    expect(await replacementState()).toEqual(baseline);
    expect(await db.prepare("select status,lease_owner from v2_processing_jobs where id=?").bind(old.job.id).first()).toEqual({ status: "running", lease_owner: replacement.leaseOwner });
    expect(await db.prepare("select run_id from v2_provider_invocation_leases where job_id=?").bind(old.job.id).first()).toEqual({ run_id: replacementRun });
    expect(await db.prepare("select count(*) as n from v2_link_fragments where processing_run_id=?").bind(old.runId).first()).toEqual({ n: 0 });
  });

  test("snapshot-changed expired old jobs cannot change newer capture state or create exhaustion reviews", async () => {
    const fixture = await seed();
    const old = await running(fixture);
    const newer = await nextSnapshot(fixture);
    await db.prepare("update v2_capture_bundles set processing_status='completed' where id=?").bind(fixture.capture.captureId).run();
    const currentState = async () => Promise.all([
      db.prepare("select processing_status from v2_capture_bundles where id=?").bind(fixture.capture.captureId).first(),
      db.prepare("select current_revision_id,current_link_snapshot_id,published_link_run_id from v2_documents where object_id=?").bind(fixture.capture.objectId).first(),
      db.prepare("select count(*) as n from v2_review_items where object_id=?").bind(fixture.capture.objectId).first(),
    ]);
    const baseline = await currentState();
    expect(baseline).toEqual([
      { processing_status: "completed" },
      { current_revision_id: fixture.capture.revisionId, current_link_snapshot_id: newer.snapshot.id, published_link_run_id: null },
      { n: 0 },
    ]);
    const expired = new Date(Date.now() - 1000).toISOString();
    await db.prepare("update v2_provider_invocation_leases set expires_at=? where job_id=?").bind(expired, old.job.id).run();
    // Exercise the exhausted-attempt branch that would normally add a review item.
    await db.prepare("update v2_processing_jobs set attempt=max_attempts,lease_expires_at=? where id=?").bind(expired, old.job.id).run();
    expect(await queue.claim("snapshot-expiry-recovery", new Date(), 120_000, "link_analyze")).toBeNull();
    expect(await currentState()).toEqual(baseline);
    expect(await db.prepare("select status,last_error_code,lease_owner from v2_processing_jobs where id=?").bind(old.job.id).first())
      .toEqual({ status: "needs_review", last_error_code: "lease_expired", lease_owner: null });
    expect(await db.prepare("select status,validation_error_code from v2_processing_runs where id=?").bind(old.runId).first())
      .toEqual({ status: "failed", validation_error_code: "lease_expired" });
    expect(await db.prepare("select count(*) as n from v2_provider_invocation_leases where job_id=?").bind(old.job.id).first()).toEqual({ n: 0 });
  });

  test("a later generic analysis request cannot route manual external prose through autobiographical extraction", async () => {
    const fixture = await seed();
    await db.prepare("insert into v2_processing_outbox(id,user_id,capture_id,event_type,payload_json,status,created_at) values (?,'link-owner',?,'analyze','{}','pending',?)")
      .bind(crypto.randomUUID(), fixture.capture.captureId, new Date().toISOString()).run();
    expect(await queue.dispatchPending()).toBe(1);
    const generic = (await queue.claim("generic-after-edit"))!;
    expect(generic.stage).toBe("analyze");
    expect(await queue.loadAnalysisInput(generic)).toBeNull();
  });
});
