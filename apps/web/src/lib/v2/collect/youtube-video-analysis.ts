import { ulid } from "ulidx";

import { V2ModelError, type V2StructuredModelGateway } from "@/lib/v2/ai/gateway";
import {
  buildVideoAnalysisRequest, resolveVideoAnalysis, VideoAnalysisValidationError, type ResolvedVideoAnalysis, type VideoAnalysisInput,
} from "@/lib/v2/ai/video-analysis-v1";
import type { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";

type VideoGovernor = Pick<D1AiRuntimeGovernor, "tryAcquire" | "release" | "recordSuccess" | "recordFailure">;

export type VideoAnalysisRejection =
  | "video_ai_paused" | "video_quota_exhausted" | "video_provider_busy" | "video_timeout"
  | "video_not_accessible" | "video_analysis_invalid";
export type VideoAnalysisOutcome =
  | Readonly<{ status: "analyzed"; result: ResolvedVideoAnalysis; modelId: string; latencyMs: number }>
  | Readonly<{ status: "rejected"; code: VideoAnalysisRejection; retryAt: string | null }>;

function rejection(error: V2ModelError): VideoAnalysisRejection {
  const category = (error as { category?: unknown }).category;
  if (error.code === "quota_exhausted") return "video_quota_exhausted";
  if (error.code === "timeout") return "video_timeout";
  if (error.code === "invalid_schema") return "video_analysis_invalid";
  // Private, unlisted, removed or region-blocked videos surface as a rejected
  // request. The provider body is discarded, so the precise cause stays unknown.
  if (category === "invalid_request" || category === "permission_or_model_access" || category === "model_unavailable_or_access"
    || category === "request_too_large" || category === "request_rejected") return "video_not_accessible";
  return "video_provider_busy";
}

/** One explicit provider call per user request. It shares the main-analyzer
 * governor with the durable queue, so a paused quota is never bypassed. */
export async function analyzeYouTubeVideo(input: {
  gateway: V2StructuredModelGateway; governor?: VideoGovernor; video: VideoAnalysisInput; workerId: string; now?: () => Date;
}): Promise<VideoAnalysisOutcome> {
  const clock = input.now ?? (() => new Date());
  const owner = `${input.workerId}:video_analyze:${ulid()}`;
  if (input.governor) {
    const permit = await input.governor.tryAcquire("main_analyzer", owner, clock());
    if (!permit.allowed) {
      return { status: "rejected", code: permit.state === "quota_exhausted" ? "video_quota_exhausted" : "video_ai_paused", retryAt: permit.retryAt };
    }
  }
  let feedback: { code: V2ModelError["code"]; retryAfterMs: number | null } | "succeeded" | null = null;
  try {
    const request = await buildVideoAnalysisRequest(input.video);
    const result = await input.gateway.generate<unknown>(request);
    feedback = "succeeded";
    if (result.inputHash !== request.inputHash || result.role !== "main_analyzer") {
      throw new V2ModelError("invalid_schema", "The provider result does not match the requested video.", false);
    }
    return { status: "analyzed", result: resolveVideoAnalysis(result.data, input.video.range), modelId: result.modelId, latencyMs: result.latencyMs };
  } catch (error) {
    const modelError = error instanceof V2ModelError ? error
      : error instanceof VideoAnalysisValidationError ? new V2ModelError("invalid_schema", error.message, false) : null;
    if (!modelError) throw error;
    // A validated-output failure after a successful call still counts as a provider success for pacing.
    if (feedback !== "succeeded") feedback = { code: modelError.code, retryAfterMs: modelError.retryAfterMs };
    const retryAt = modelError.retryAfterMs ? new Date(clock().getTime() + modelError.retryAfterMs).toISOString() : null;
    return { status: "rejected", code: rejection(modelError), retryAt };
  } finally {
    try {
      if (feedback === "succeeded") await input.governor?.recordSuccess("main_analyzer", owner, clock());
      else if (feedback) await input.governor?.recordFailure("main_analyzer", owner, feedback.code, clock(), feedback.retryAfterMs);
    } finally {
      await input.governor?.release("main_analyzer", owner, clock());
    }
  }
}
