import { ulid } from "ulidx";

import {
  ANALYSIS_ENVELOPE_V1_SCHEMA,
  ANALYSIS_MODEL_CONFIG_VERSION,
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_REGISTRY_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  ANALYSIS_VALIDATOR_VERSION,
  anchorEvidenceQuotesInDraft,
  validateAnalysisEnvelopeV1,
  type AnalysisEnvelopeV1,
} from "@/lib/v2/ai/analysis-envelope-v1";
import { V2ModelError, type V2StructuredModelGateway } from "@/lib/v2/ai/gateway";
import { AnalysisAttachmentError, loadAnalysisAttachmentParts } from "@/lib/v2/ai/analysis-attachments";
import { resolveV2ModelForRole } from "@/lib/v2/ai/model-routing";
import type { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import type { D1ProcessingQueueRepository, V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import type { AnalysisPatternObservationOutcome } from "@/lib/v2/templates/analysis-pattern-observer";

function systemInstruction() {
  return `You organize a private personal archive. Preserve the user's words. Return only AnalysisEnvelope v1 JSON. Every extracted claim needs a source_item_id and valid character offsets when the source has text, plus quote: the exact evidence text copied character for character from that source (the server re-anchors offsets from the quote; keep quotes short and specific). Only sources with a non-null attachment_id are attachments; never return source_extractions for text or URL sources, whose raw_text is already the original. For each supplied attachment return source_extractions with its original source_item_id, faithfully transcribed text (empty when no text is visible/audible), and kind image_ocr, transcript_extract (audio/video), or document_extract (PDF/text file). Do not invent missing or unreadable text. Evidence character offsets for an attachment refer to that extraction text. Visual interpretations without transcribed text must remain proposed with null offsets. Ratings always use 0 through 5. If a different maximum is explicitly stated, return rating_original {value, maximum} and value=5*original.value/original.maximum. If the scale is unclear, do not guess; retain a text proposal and a review item. Template context is optional recall assistance, never a forced classification. A template user_value is already authoritative and must not be overwritten or re-proposed. Never infer an input whose state is withheld or not_applicable, and only use the listed allowed_ai_operations for unanswered values. Never auto-accept another person's intent, personality, relationship state, causation, promise, agreement, or decision; mark those social_high_risk and proposed. Suggest open type_key and field_key values without assuming a fixed category list. Request external enrichment only for a clearly identified place, work, book, or game.`;
}

/** A source extraction is a transcription of an attachment sent in this request.
 * Extractions the request never asked for (e.g. for a text source that is
 * already the original) are dropped before validation rather than failing the
 * whole analysis. They are never stored; every supplied attachment still needs one. */
export function dropUnrequestedSourceExtractions(data: unknown, attachmentKinds: ReadonlyMap<string, string>): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const envelope = data as { source_extractions?: unknown; warnings?: unknown };
  if (!Array.isArray(envelope.source_extractions)) return data;
  const kept = envelope.source_extractions.filter((item) => item && typeof item === "object"
    && attachmentKinds.has(String((item as { source_item_id?: unknown }).source_item_id)));
  if (kept.length === envelope.source_extractions.length) return data;
  const warnings = Array.isArray(envelope.warnings) ? envelope.warnings : [];
  return { ...envelope, source_extractions: kept,
    warnings: [...warnings, `unrequested_source_extraction_dropped:${envelope.source_extractions.length - kept.length}`] };
}

function inputText(input: Awaited<ReturnType<D1ProcessingQueueRepository["loadAnalysisInput"]>>) {
  if (!input) return "";
  return JSON.stringify({
    contract_version: ANALYSIS_SCHEMA_VERSION,
    target: { capture_id: input.job.captureId, object_id: input.job.objectId, revision_id: input.job.inputRevisionId },
    document: { title: input.title, body_markdown: input.bodyMarkdown },
    sources: input.sources.map((source) => ({ source_item_id: source.id, kind: source.kind, raw_text: source.rawText, content_hash: source.contentHash, attachment_id: source.attachmentId, mime_type: source.mimeType })),
    template_context: input.templateContext ? { template_version_id: input.templateContext.templateVersionId, expected_roles: input.templateContext.expectedRoles, inputs: input.templateContext.inputs } : null,
  });
}

export async function runNextAnalysisJob(input: { queue: D1ProcessingQueueRepository; gateway: V2StructuredModelGateway; workerId: string; governor?: D1AiRuntimeGovernor; bucket?: R2BucketBinding; now?: Date; observePattern?: (job: V2ProcessingJob, runId: string, now: string) => Promise<AnalysisPatternObservationOutcome> }) {
  const now = input.now ?? new Date();
  const clockStartedAt = Date.now();
  const clock = () => input.now ? new Date(now.getTime() + Date.now() - clockStartedAt) : new Date();
  const permitOwner = `${input.workerId}:main_analyzer:${ulid()}`;
  if (input.governor) {
    const permit = await input.governor.tryAcquire("main_analyzer", permitOwner, now);
    if (!permit.allowed) return { outcome: "paused" as const, state: permit.state, retryAt: permit.retryAt };
  }
  let job;
  try {
    job = await input.queue.claim(input.workerId, now);
  } catch (error) {
    await input.governor?.release("main_analyzer", permitOwner, now);
    throw error;
  }
  if (!job) {
    await input.governor?.release("main_analyzer", permitOwner, now);
    return { outcome: "idle" as const };
  }
  const runId = ulid();
  const modelId = resolveV2ModelForRole("main_analyzer");
  try {
    const started = await input.queue.beginRun(job, { runId, modelId, promptVersion: ANALYSIS_PROMPT_VERSION, schemaVersion: ANALYSIS_SCHEMA_VERSION, registryVersion: ANALYSIS_REGISTRY_VERSION, modelConfigVersion: ANALYSIS_MODEL_CONFIG_VERSION, now: now.toISOString() });
    if (!started) {
      await input.governor?.release("main_analyzer", permitOwner, now);
      return { outcome: "superseded" as const, jobId: job.id };
    }
    const analysisInput = await input.queue.loadAnalysisInput(job);
    if (!analysisInput && await input.queue.supersedeExternalAnalysis(job, runId, clock().toISOString())) {
      await input.governor?.release("main_analyzer", permitOwner, clock());
      return { outcome: "superseded" as const, jobId: job.id, runId };
    }
    if (!analysisInput) throw new V2ModelError("invalid_schema", "The job input snapshot could not be loaded.", false);
    const invocationReady = await input.queue.acquireProviderInvocationLease(job, { runId, now: clock() });
    if (!invocationReady) {
      await input.governor?.release("main_analyzer", permitOwner, clock());
      return { outcome: "superseded" as const, jobId: job.id, runId };
    }
    const attachmentParts = await loadAnalysisAttachmentParts(analysisInput, input.bucket);
    if (attachmentParts.length && !(await input.queue.acquireProviderInvocationLease(job, { runId, now: clock() }))) {
      await input.governor?.release("main_analyzer", permitOwner, clock());
      return { outcome: "superseded" as const, jobId: job.id, runId };
    }
    const result = await input.gateway.generate<AnalysisEnvelopeV1>({
      role: "main_analyzer",
      schemaId: ANALYSIS_SCHEMA_VERSION,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      inputHash: job.inputHash,
      deadlineMs: 90_000,
      systemInstruction: systemInstruction(),
      parts: [{ text: inputText(analysisInput) }, ...attachmentParts],
      responseJsonSchema: ANALYSIS_ENVELOPE_V1_SCHEMA,
    });
    const sourceLengths = new Map(analysisInput.sources.map((source) => [source.id, source.rawText?.length ?? null]));
    const attachmentKinds = new Map(analysisInput.sources.filter((source) => source.attachmentId && source.mimeType).map((source) => [source.id, source.mimeType! ]));
    // Offsets refer to the source text, or to the extraction text for an attachment.
    const evidenceTexts = new Map<string, string>(analysisInput.sources.flatMap((source) => source.rawText !== null && !attachmentKinds.has(source.id) ? [[source.id, source.rawText] as [string, string]] : []));
    const draft = anchorEvidenceQuotesInDraft(dropUnrequestedSourceExtractions(result.data, attachmentKinds), evidenceTexts);
    const envelope = validateAnalysisEnvelopeV1(draft, { captureId: job.captureId, revisionId: job.inputRevisionId, sourceLengths, attachmentKinds });
    const completed = await input.queue.completeAnalysis({ job, runId, envelope, outputHash: result.outputHash, modelId: result.modelId, latencyMs: result.latencyMs, inputTokens: result.tokenUsage?.input ?? 0, outputTokens: result.tokenUsage?.output ?? 0, schemaVersion: ANALYSIS_SCHEMA_VERSION, validatorVersion: ANALYSIS_VALIDATOR_VERSION, now: clock().toISOString() });
    await input.governor?.recordSuccess("main_analyzer", permitOwner, clock());
    let patternObservation: AnalysisPatternObservationOutcome | "failed" = "skipped";
    if (!completed.stale && input.observePattern) {
      // Pattern discovery is a separate post-commit effect. Its failure must
      // never turn a saved analysis into a retry or another provider call.
      try { patternObservation = await input.observePattern(job, runId, clock().toISOString()); }
      catch { patternObservation = "failed"; }
    }
    return { outcome: completed.stale ? "stale" as const : "succeeded" as const, jobId: job.id, runId,
      ...(input.observePattern && !completed.stale ? { patternObservation } : {}) };
  } catch (error) {
    const modelError = error instanceof V2ModelError ? error : new V2ModelError("invalid_schema", error instanceof Error ? error.message : "Analysis validation failed.", false);
    const failed = await input.queue.failJob(job, { runId, errorClass: modelError.name, errorCode: modelError.code, retryable: modelError.retryable, retryAfterMs: modelError.retryAfterMs, reviewMessage: error instanceof AnalysisAttachmentError ? error.message : undefined, now: clock() });
    await input.governor?.recordFailure("main_analyzer", permitOwner, modelError.code, clock(), modelError.retryAfterMs);
    return { outcome: failed.superseded ? "superseded" as const : failed.retry ? "retry_wait" as const : "needs_review" as const, jobId: job.id, runId };
  }
}
