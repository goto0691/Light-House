import { ulid } from "ulidx";

import { V2ModelError, type V2GroundedResearchGateway } from "@/lib/v2/ai/gateway";
import { parseGroundedResultV1 } from "@/lib/v2/ai/grounded-result-v1";
import { resolveV2ModelForRole } from "@/lib/v2/ai/model-routing";
import type { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import type { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";

const PROMPT_VERSION = "grounded-enrichment-v1";
const SCHEMA_VERSION = "grounded-result-v1";
const REGISTRY_VERSION = "registry-bootstrap-v1";
const MODEL_CONFIG_VERSION = "gemini-roles-v1";

function groundedPrompt(input: NonNullable<Awaited<ReturnType<D1ProcessingQueueRepository["loadGroundingInput"]>>>) {
  return JSON.stringify({
    contract_version: SCHEMA_VERSION,
    policy: "Research only the named public place, work, book, or game. Do not investigate private people. Resolve identity before returning facts. Every fact must be supported by at least one returned HTTPS citation. Return JSON only, without Markdown fences. Use only requested field keys.",
    output_contract: {
      contract_version: SCHEMA_VERSION,
      identity_status: "resolved | ambiguous | not_found",
      canonical_name: "string when resolved, otherwise null",
      facts: [{ field_key: "requested canonical key", label: "short display label", value_type: "text | number | boolean | date | json", value: "typed value", citation_urls: ["one or more exact returned HTTPS citation URLs"] }],
      summary: "brief research summary",
    },
    request: { entity_kind: input.entityKind, query: input.query, requested_fields: input.requestedFields },
  });
}

function validateCitations(citations: readonly { url: string; citedText: string; startByte: number; endByte: number }[]) {
  if (!citations.length) throw new V2ModelError("invalid_schema", "Grounded enrichment returned no citation.", false);
  if (citations.length > 50) throw new V2ModelError("invalid_schema", "Grounded enrichment returned too many citations.", false);
  for (const citation of citations) {
    if (!citation.url.startsWith("https://") || !citation.citedText.trim() || citation.citedText.length > 2_000 || citation.startByte < 0 || citation.endByte < citation.startByte) {
      throw new V2ModelError("invalid_schema", "Grounded enrichment returned an invalid citation.", false);
    }
  }
}

export async function runNextGroundingJob(input: { queue: D1ProcessingQueueRepository; gateway: V2GroundedResearchGateway; workerId: string; governor?: D1AiRuntimeGovernor; now?: Date }) {
  const now = input.now ?? new Date();
  const clockStartedAt = Date.now();
  const clock = () => input.now ? new Date(now.getTime() + Date.now() - clockStartedAt) : new Date();
  const permitOwner = `${input.workerId}:grounded_enricher:${ulid()}`;
  if (input.governor) {
    const permit = await input.governor.tryAcquire("grounded_enricher", permitOwner, now);
    if (!permit.allowed) return { outcome: "paused" as const, state: permit.state, retryAt: permit.retryAt };
  }
  let job;
  try {
    job = await input.queue.claim(input.workerId, now, 120_000, "grounded_enrich");
  } catch (error) {
    await input.governor?.release("grounded_enricher", permitOwner, now);
    throw error;
  }
  if (!job) {
    await input.governor?.release("grounded_enricher", permitOwner, now);
    return { outcome: "idle" as const };
  }
  const runId = ulid();
  try {
    const started = await input.queue.beginGroundingRun(job, { runId, modelId: resolveV2ModelForRole("grounded_enricher"), promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, registryVersion: REGISTRY_VERSION, modelConfigVersion: MODEL_CONFIG_VERSION, now: now.toISOString() });
    if (!started) {
      await input.governor?.release("grounded_enricher", permitOwner, now);
      return { outcome: "superseded" as const, jobId: job.id };
    }
    const request = await input.queue.loadGroundingInput(job);
    if (!request) throw new V2ModelError("invalid_schema", "The grounding request could not be loaded.", false);
    const invocationReady = await input.queue.acquireProviderInvocationLease(job, { runId, now: clock() });
    if (!invocationReady) {
      await input.governor?.release("grounded_enricher", permitOwner, clock());
      return { outcome: "superseded" as const, jobId: job.id, runId };
    }
    const result = await input.gateway.research({ role: "grounded_enricher", prompt: groundedPrompt(request), promptVersion: PROMPT_VERSION, inputHash: request.queryHash, deadlineMs: 90_000 });
    if (!result.answer.trim() || result.answer.length > 20_000 || result.queries.length > 25) {
      throw new V2ModelError("invalid_schema", "Grounded enrichment exceeded its bounded result contract.", false);
    }
    validateCitations(result.citations);
    const envelope = parseGroundedResultV1(result.answer, request.requestedFields, result.citations.map((citation) => citation.url));
    const completed = await input.queue.completeGrounding({ job, requestId: request.requestId, runId, answer: result.answer, envelope, citations: result.citations, queries: result.queries, outputHash: result.outputHash, modelId: result.modelId, latencyMs: result.latencyMs, inputTokens: result.tokenUsage?.input ?? 0, outputTokens: result.tokenUsage?.output ?? 0, now: clock().toISOString() });
    await input.governor?.recordSuccess("grounded_enricher", permitOwner, clock());
    return { outcome: completed.stale ? "stale" as const : "succeeded" as const, jobId: job.id, runId };
  } catch (error) {
    const modelError = error instanceof V2ModelError ? error : new V2ModelError("invalid_schema", error instanceof Error ? error.message : "Grounding validation failed.", false);
    const failed = await input.queue.failJob(job, { runId, errorClass: modelError.name, errorCode: modelError.code, retryable: modelError.retryable, retryAfterMs: modelError.retryAfterMs, now: clock() });
    await input.governor?.recordFailure("grounded_enricher", permitOwner, modelError.code, clock(), modelError.retryAfterMs);
    return { outcome: failed.retry ? "retry_wait" as const : "needs_review" as const, jobId: job.id, runId };
  }
}
