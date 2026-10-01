import { afterEach, describe, expect, test, vi } from "vitest";

import { FakeV2StructuredModelGateway, type FakeGatewayScenario } from "@/lib/v2/ai/fake-gateway";
import { V2ModelError, type V2StructuredModelGateway, type V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { LINK_ANALYSIS_CONTRACT, LINK_ANALYSIS_PROMPT_VERSION, LinkAnalysisValidationError, prepareLinkAnalysis } from "@/lib/v2/ai/link-analysis-v1";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";
import { normalizeManualLinkSource } from "@/lib/v2/domain/manual-link-source";
import type { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import type { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import type { D1ProcessingQueueRepository, V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";

const now = new Date("2026-09-08T01:00:00.000Z");
const rawText = "Heading\r\n  portrait 👀, film grain  \r\n--ar 3:2\n";
const exact = "  portrait 👀, film grain  \r\n--ar 3:2\n";
async function hash(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function fixture(scenario: FakeGatewayScenario = "success") {
  const prepared = await prepareLinkAnalysis({
    snapshotId: "snapshot-one", documentRevisionId: "revision-one", manifestVersion: "link-source-manifest.v1", manifestHash: "a".repeat(64),
  }, [{
    memberKey: "source-one", memberId: "member-one", sourceItemId: "source-item-one", rawText, contentHash: await hash(rawText),
    manualLink: normalizeManualLinkSource({ url: "https://example.test/prompt", purpose: "prompt", role: "prompt" }),
  }]);
  const job: V2ProcessingJob = {
    id: "job-one", userId: "user-one", captureId: "capture-one", objectId: "document-one", stage: "link_analyze",
    status: "leased", attempt: 1, maxAttempts: 4, inputRevisionId: prepared.identity.documentRevisionId, inputHash: prepared.inputHash,
    inputLinkSnapshotId: prepared.identity.snapshotId, inputSourceManifestHash: prepared.identity.manifestHash,
    inputSourceManifestVersion: prepared.identity.manifestVersion, leaseOwner: "worker:unique-lease", leaseExpiresAt: "2026-09-08T01:02:00.000Z",
  };
  const envelope = {
    contract_version: LINK_ANALYSIS_CONTRACT, snapshot_id: prepared.identity.snapshotId,
    analyzed_revision_id: prepared.identity.documentRevisionId, manifest_version: prepared.identity.manifestVersion, manifest_hash: prepared.identity.manifestHash,
    fragments: [{ fragment_key: "prompt-one", role: "prompt", selection: { member_key: "source-one", first_block: 1, last_block: 2 } }], interpretations: [],
  };
  const events: string[] = [];
  const queue = {
    claim: vi.fn<D1ProcessingQueueRepository["claim"]>(async () => { events.push("claim"); return job; }),
    beginRun: vi.fn<D1ProcessingQueueRepository["beginRun"]>(async () => { events.push("begin"); return true; }),
    acquireProviderInvocationLease: vi.fn<D1ProcessingQueueRepository["acquireProviderInvocationLease"]>(async () => { events.push("lease"); return true; }),
    failJob: vi.fn<D1ProcessingQueueRepository["failJob"]>(async (_job, failure) => { events.push("fail"); return { retry: failure.retryable, nextAttemptAt: now.toISOString(), superseded: false }; }),
  };
  const links = {
    loadInput: vi.fn<D1LinkAnalysisRepository["loadInput"]>(async () => { events.push("load"); return prepared; }),
    isCurrent: vi.fn<D1LinkAnalysisRepository["isCurrent"]>(async () => { events.push("current"); return true; }),
    supersedeAttempt: vi.fn<D1LinkAnalysisRepository["supersedeAttempt"]>(async () => { events.push("supersede"); }),
    complete: vi.fn<D1LinkAnalysisRepository["complete"]>(async () => { events.push("complete"); return { stale: false }; }),
  };
  const governor = {
    tryAcquire: vi.fn<D1AiRuntimeGovernor["tryAcquire"]>(async () => { events.push("permit"); return { allowed: true, state: "healthy", retryAt: null }; }),
    release: vi.fn<D1AiRuntimeGovernor["release"]>(async () => { events.push("release"); }),
    recordSuccess: vi.fn<D1AiRuntimeGovernor["recordSuccess"]>(async () => { events.push("success"); }),
    recordFailure: vi.fn<D1AiRuntimeGovernor["recordFailure"]>(async () => { events.push("failure"); }),
  };
  const fake = new FakeV2StructuredModelGateway(scenario, envelope);
  const gateway: V2StructuredModelGateway = {
    async generate<T>(request: V2StructuredModelRequest) { events.push("generate"); return fake.generate<T>(request); },
  };
  return { prepared, job, envelope, events, fake, queue, links, governor, gateway, workerId: "link-worker", now };
}

afterEach(() => vi.useRealTimers());

describe("dedicated link analysis runner", () => {
  test("quota pause neither claims a job nor invokes the provider", async () => {
    const context = await fixture();
    context.governor.tryAcquire.mockResolvedValue({ allowed: false, state: "quota_exhausted", retryAt: "2026-09-08T01:15:00.000Z" });
    expect(await runNextLinkAnalysisJob(context)).toEqual({ outcome: "paused", state: "quota_exhausted", retryAt: "2026-09-08T01:15:00.000Z" });
    expect(context.queue.claim).not.toHaveBeenCalled();
    expect(context.fake.calls).toHaveLength(0);
    expect(context.governor.release).not.toHaveBeenCalled();
  });

  test("an empty link queue releases its permit without claiming the personal analysis stage", async () => {
    const context = await fixture();
    context.queue.claim.mockResolvedValue(null);
    expect(await runNextLinkAnalysisJob(context)).toEqual({ outcome: "idle" });
    expect(context.queue.claim).toHaveBeenCalledWith("link-worker", now, 120_000, "link_analyze");
    expect(context.governor.release).toHaveBeenCalledOnce();
    expect(context.governor.recordSuccess).not.toHaveBeenCalled();
    expect(context.governor.recordFailure).not.toHaveBeenCalled();
  });

  test("persists only exact server-resolved text after an immediate invocation fence", async () => {
    const context = await fixture();
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "succeeded", jobId: context.job.id });
    expect(context.events).toEqual(["permit", "claim", "begin", "load", "lease", "generate", "complete", "success", "release"]);
    expect(context.fake.calls).toEqual([context.prepared.request]);
    const run = context.queue.beginRun.mock.calls[0][1];
    expect(run).toMatchObject({ promptVersion: LINK_ANALYSIS_PROMPT_VERSION, schemaVersion: LINK_ANALYSIS_CONTRACT });
    expect(context.queue.acquireProviderInvocationLease).toHaveBeenCalledWith(context.job, expect.objectContaining({ runId: run.runId, now: expect.any(Date) }));
    expect(context.links.complete.mock.calls[0][0]).toMatchObject({
      job: context.job, runId: run.runId, inputTokens: 10, outputTokens: 20,
      resolved: { inputHash: context.prepared.inputHash, fragments: [{ rawText: exact, rawTextHash: (await hash(exact)).slice(7), sourceClass: "source_extract", derivedText: null, reviewStatus: "proposed" }] },
    });
    expect(context.governor.recordSuccess.mock.calls[0][1]).toBe(context.governor.tryAcquire.mock.calls[0][1]);
    expect(context.queue.failJob).not.toHaveBeenCalled();
  });

  test("a lost beginRun fence does not load or invoke anything", async () => {
    const context = await fixture();
    context.queue.beginRun.mockResolvedValue(false);
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "superseded" });
    expect(context.links.loadInput).not.toHaveBeenCalled();
    expect(context.fake.calls).toHaveLength(0);
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test.each(["input", "lease"])("a lost %s fence retires only the owned attempt before invocation", async (boundary) => {
    const context = await fixture();
    if (boundary === "input") context.links.loadInput.mockResolvedValue(null);
    else context.queue.acquireProviderInvocationLease.mockResolvedValue(false);
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "superseded", jobId: context.job.id });
    expect(context.links.supersedeAttempt).toHaveBeenCalledWith(context.job, context.queue.beginRun.mock.calls[0][1].runId, expect.any(String));
    expect(context.fake.calls).toHaveLength(0);
    expect(context.links.complete).not.toHaveBeenCalled();
    expect(context.queue.failJob).not.toHaveBeenCalled();
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test.each(["rewritten_text", "out_of_bounds", "wrong_snapshot"])("rejects %s instead of storing untrusted model material", async (malformation) => {
    const context = await fixture();
    const envelope = structuredClone(context.envelope);
    const altered = malformation === "rewritten_text" ? { ...envelope, fragments: [{ ...envelope.fragments[0], rawText: "model rewrite" }] }
      : malformation === "out_of_bounds" ? { ...envelope, fragments: [{ ...envelope.fragments[0], selection: { member_key: "source-one", first_block: 0, last_block: 999 } }] }
        : { ...envelope, snapshot_id: "different-snapshot" };
    const gateway = new FakeV2StructuredModelGateway("success", altered);
    expect(await runNextLinkAnalysisJob({ ...context, gateway })).toMatchObject({ outcome: "needs_review" });
    expect(context.links.complete).not.toHaveBeenCalled();
    expect(context.queue.failJob).toHaveBeenCalledWith(context.job, expect.objectContaining({ errorCode: "invalid_schema", retryable: false }));
    expect(context.governor.recordFailure).toHaveBeenCalledWith("main_analyzer", expect.any(String), "invalid_schema", expect.any(Date), null);
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test.each(["inputHash", "role"])("rejects mismatched provider %s even with otherwise valid model JSON", async (field) => {
    const context = await fixture();
    const gateway: V2StructuredModelGateway = {
      async generate<T>(request: V2StructuredModelRequest) {
        const result = await context.fake.generate<T>(request);
        return field === "inputHash" ? { ...result, inputHash: "wrong-input" } : { ...result, role: "grounded_enricher" as const };
      },
    };
    expect(await runNextLinkAnalysisJob({ ...context, gateway })).toMatchObject({ outcome: "needs_review" });
    expect(context.links.complete).not.toHaveBeenCalled();
    expect(context.queue.failJob).toHaveBeenCalledWith(context.job, expect.objectContaining({ errorCode: "invalid_schema", retryable: false }));
  });

  test("a changed prepared input is refused before requesting a provider lease", async () => {
    const context = await fixture();
    context.links.loadInput.mockResolvedValue({ ...context.prepared, inputHash: "changed" });
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "needs_review" });
    expect(context.queue.acquireProviderInvocationLease).not.toHaveBeenCalled();
    expect(context.fake.calls).toHaveLength(0);
  });

  test.each([
    new LinkAnalysisValidationError("link_analysis_needs_input", "Available source text is missing."),
    new LinkSnapshotError("link_analysis_input_changed", "Saved input changed."),
  ])("known source validation failures are non-retryable without provider invocation", async (error) => {
    const context = await fixture();
    context.links.loadInput.mockRejectedValue(error);
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "needs_review" });
    expect(context.queue.failJob).toHaveBeenCalledWith(context.job, expect.objectContaining({ errorClass: "V2ModelError", errorCode: "invalid_schema", retryable: false }));
    expect(context.fake.calls).toHaveLength(0);
  });

  test.each(["quota_exhausted", "timeout", "provider_unavailable", "invalid_schema"] as const)("preserves provider %s and governor feedback", async (scenario) => {
    const context = await fixture(scenario);
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: scenario === "invalid_schema" ? "needs_review" : "retry_wait" });
    expect(context.queue.failJob).toHaveBeenCalledWith(context.job, expect.objectContaining({ errorClass: "V2ModelError", errorCode: scenario, retryable: scenario !== "invalid_schema" }));
    expect(context.governor.recordFailure).toHaveBeenCalledWith("main_analyzer", expect.any(String), scenario, expect.any(Date), null);
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test("retains a provider subclass name and its explicit non-retryable decision", async () => {
    const context = await fixture();
    const error = new V2ModelError("provider_unavailable", "Provider refused this request.", false);
    error.name = "ProviderConfigurationError";
    const gateway: V2StructuredModelGateway = { async generate() { throw error; } };
    expect(await runNextLinkAnalysisJob({ ...context, gateway })).toMatchObject({ outcome: "needs_review" });
    expect(context.queue.failJob).toHaveBeenCalledWith(context.job, expect.objectContaining({ errorClass: error.name, errorCode: error.code, retryable: false }));
  });

  test("a failed old snapshot is superseded without stamping the newer capture failure state", async () => {
    const context = await fixture("quota_exhausted");
    context.links.isCurrent.mockResolvedValue(false);
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "superseded" });
    expect(context.queue.failJob).not.toHaveBeenCalled();
    expect(context.links.supersedeAttempt).toHaveBeenCalledOnce();
    expect(context.governor.recordFailure).toHaveBeenCalledWith("main_analyzer", expect.any(String), "quota_exhausted", expect.any(Date), null);
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test("a stale completion is not a provider failure and is never re-published by the runner", async () => {
    const context = await fixture();
    context.links.complete.mockResolvedValue({ stale: true });
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "stale" });
    expect(context.links.complete).toHaveBeenCalledOnce();
    expect(context.queue.failJob).not.toHaveBeenCalled();
    expect(context.governor.recordSuccess).toHaveBeenCalledOnce();
    expect(context.governor.recordFailure).not.toHaveBeenCalled();
  });

  test.each(["claim", "load", "complete"])("unexpected %s infrastructure failure is not mislabeled as invalid model output", async (boundary) => {
    const context = await fixture();
    const error = new Error("database unavailable");
    if (boundary === "claim") context.queue.claim.mockRejectedValue(error);
    else if (boundary === "load") context.links.loadInput.mockRejectedValue(error);
    else context.links.complete.mockRejectedValue(error);
    await expect(runNextLinkAnalysisJob(context)).rejects.toBe(error);
    expect(context.queue.failJob).not.toHaveBeenCalled();
    expect(context.governor.recordFailure).not.toHaveBeenCalled();
    expect(context.governor.recordSuccess).toHaveBeenCalledTimes(boundary === "complete" ? 1 : 0);
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test.each(["fail", "current", "supersede", "recordFailure"])("releases the governor even when %s error handling itself throws", async (boundary) => {
    const context = await fixture("timeout");
    const error = new Error("secondary persistence error");
    if (boundary === "fail") context.queue.failJob.mockRejectedValue(error);
    else if (boundary === "current") context.links.isCurrent.mockRejectedValue(error);
    else if (boundary === "supersede") {
      context.links.isCurrent.mockResolvedValue(false);
      context.links.supersedeAttempt.mockRejectedValue(error);
    } else context.governor.recordFailure.mockRejectedValue(error);
    await expect(runNextLinkAnalysisJob(context)).rejects.toBe(error);
    expect(context.governor.release).toHaveBeenCalledOnce();
    expect(context.links.complete).not.toHaveBeenCalled();
  });

  test("governor success recording failure cannot turn a committed result into a failed job", async () => {
    const context = await fixture();
    const error = new Error("governor write failure");
    context.governor.recordSuccess.mockRejectedValue(error);
    await expect(runNextLinkAnalysisJob(context)).rejects.toBe(error);
    expect(context.links.complete).toHaveBeenCalledOnce();
    expect(context.queue.failJob).not.toHaveBeenCalled();
    expect(context.governor.recordFailure).not.toHaveBeenCalled();
    expect(context.governor.release).toHaveBeenCalledOnce();
  });

  test("supports an omitted governor and missing token usage", async () => {
    const context = await fixture();
    const gateway: V2StructuredModelGateway = {
      async generate<T>(request: V2StructuredModelRequest) {
        return { ...await context.fake.generate<T>(request), tokenUsage: undefined };
      },
    };
    expect(await runNextLinkAnalysisJob({ ...context, governor: undefined, gateway })).toMatchObject({ outcome: "succeeded" });
    expect(context.links.complete.mock.calls[0][0]).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  test("the invocation fence uses elapsed time rather than an expired frozen start time", async () => {
    const context = await fixture();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    context.links.loadInput.mockImplementation(async () => {
      vi.advanceTimersByTime(2500);
      return context.prepared;
    });
    expect(await runNextLinkAnalysisJob(context)).toMatchObject({ outcome: "succeeded" });
    expect(context.queue.acquireProviderInvocationLease.mock.calls[0][1].now?.toISOString()).toBe("2026-09-08T01:00:02.500Z");
    expect(context.links.complete.mock.calls[0][0].now).toBe("2026-09-08T01:00:02.500Z");
  });
});
