import { ulid } from "ulidx";

import { V2ModelError, type V2ModelErrorCode, type V2StructuredModelGateway } from "@/lib/v2/ai/gateway";
import {
  LINK_ANALYSIS_CONTRACT, LINK_ANALYSIS_PROMPT_VERSION, LinkAnalysisValidationError, resolveLinkAnalysis,
} from "@/lib/v2/ai/link-analysis-v1";
import { resolveV2ModelForRole } from "@/lib/v2/ai/model-routing";
import { LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";
import type { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import type { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import type { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";

export const LINK_ANALYSIS_REGISTRY_VERSION = "link-fragment-roles.v1";
export const LINK_ANALYSIS_MODEL_CONFIG_VERSION = "link-text-only.v1";

type LinkQueue = Pick<D1ProcessingQueueRepository, "claim" | "beginRun" | "acquireProviderInvocationLease" | "failJob">;
type LinkRepository = Pick<D1LinkAnalysisRepository, "loadInput" | "isCurrent" | "supersedeAttempt" | "complete">;
type LinkGovernor = Pick<D1AiRuntimeGovernor, "tryAcquire" | "release" | "recordSuccess" | "recordFailure">;

/** Runs only explicitly requested external-text analysis, never personal reconciliation. */
export async function runNextLinkAnalysisJob(input: {
  queue: LinkQueue; links: LinkRepository; gateway: V2StructuredModelGateway;
  governor?: LinkGovernor; workerId: string; now?: Date;
}) {
  const now = input.now ?? new Date();
  const clockStartedAt = Date.now();
  const clock = () => input.now ? new Date(now.getTime() + Date.now() - clockStartedAt) : new Date();
  const permitOwner = `${input.workerId}:link_analyze:${ulid()}`;
  if (input.governor) {
    const permit = await input.governor.tryAcquire("main_analyzer", permitOwner, now);
    if (!permit.allowed) return { outcome: "paused" as const, state: permit.state, retryAt: permit.retryAt };
  }

  let providerFeedback: "succeeded" | V2ModelErrorCode | null = null;
  let providerRetryAfterMs: number | null = null;
  try {
    const job = await input.queue.claim(input.workerId, now, 120_000, "link_analyze");
    if (!job) return { outcome: "idle" as const };
    const runId = ulid();
    try {
      const started = await input.queue.beginRun(job, {
        runId, modelId: resolveV2ModelForRole("main_analyzer"),
        promptVersion: LINK_ANALYSIS_PROMPT_VERSION, schemaVersion: LINK_ANALYSIS_CONTRACT,
        registryVersion: LINK_ANALYSIS_REGISTRY_VERSION, modelConfigVersion: LINK_ANALYSIS_MODEL_CONFIG_VERSION,
        now: clock().toISOString(),
      });
      if (!started) return { outcome: "superseded" as const, jobId: job.id };

      const prepared = await input.links.loadInput(job);
      if (!prepared) {
        await input.links.supersedeAttempt(job, runId, clock().toISOString());
        return { outcome: "superseded" as const, jobId: job.id, runId };
      }
      if (prepared.inputHash !== job.inputHash) {
        throw new V2ModelError("invalid_schema", "The prepared link input does not match its queued identity.", false);
      }
      // This is the final asynchronous fence immediately before provider invocation.
      if (!await input.queue.acquireProviderInvocationLease(job, { runId, now: clock() })) {
        await input.links.supersedeAttempt(job, runId, clock().toISOString());
        return { outcome: "superseded" as const, jobId: job.id, runId };
      }
      const result = await input.gateway.generate<unknown>(prepared.request);
      providerFeedback = "succeeded";
      if (result.inputHash !== prepared.inputHash || result.role !== "main_analyzer") {
        throw new V2ModelError("invalid_schema", "The provider result does not match the requested link analysis input.", false);
      }
      const resolved = await resolveLinkAnalysis(result.data, prepared);
      const completed = await input.links.complete({
        job, runId, resolved, outputHash: result.outputHash, modelId: result.modelId,
        latencyMs: result.latencyMs, inputTokens: result.tokenUsage?.input ?? 0, outputTokens: result.tokenUsage?.output ?? 0,
        now: clock().toISOString(),
      });
      return { outcome: completed.stale ? "stale" as const : "succeeded" as const, jobId: job.id, runId };
    } catch (error) {
      const modelError = error instanceof V2ModelError ? error
        : error instanceof LinkAnalysisValidationError || error instanceof LinkSnapshotError
          ? new V2ModelError("invalid_schema", error.message, false) : null;
      // Infrastructure failures are not semantic failures; leave durable recovery to the queue.
      if (!modelError) throw error;
      providerFeedback = modelError.code;
      providerRetryAfterMs = modelError.retryAfterMs;
      if (!await input.links.isCurrent(job)) {
        await input.links.supersedeAttempt(job, runId, clock().toISOString());
        return { outcome: "superseded" as const, jobId: job.id, runId };
      }
      const failed = await input.queue.failJob(job, {
        runId, errorClass: modelError.name, errorCode: modelError.code, retryable: modelError.retryable, retryAfterMs: modelError.retryAfterMs, now: clock(),
      });
      return { outcome: failed.retry ? "retry_wait" as const : "needs_review" as const, jobId: job.id, runId };
    }
  } finally {
    // Governor writes cannot send a successfully persisted job through the failure path.
    // release still runs when recording, repository completion or error handling throws.
    try {
      if (providerFeedback === "succeeded") await input.governor?.recordSuccess("main_analyzer", permitOwner, clock());
      else if (providerFeedback) await input.governor?.recordFailure("main_analyzer", permitOwner, providerFeedback, clock(), providerRetryAfterMs);
    } finally {
      await input.governor?.release("main_analyzer", permitOwner, clock());
    }
  }
}
