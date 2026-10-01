import { timingSafeEqual } from "node:crypto";

import { createGeminiRoleGateways } from "@/lib/v2/ai/gemini-role-gateways";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { runNextGroundingJob } from "@/lib/v2/ai/grounding-runner";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2ArchiveAssetsBucket, getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { observeAnalysisPatternWithRetry, retryAnalysisPatternObservations } from "@/lib/v2/templates/analysis-pattern-retry";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided) return false;
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function POST(request: Request) {
  try {
    const flags = requireV2Route({ write: true });
    if (!flags.ai) throw new V2HttpError(503, "v2_ai_disabled", "V2 AI processing is not enabled.");
    if (!authorized(request)) throw new V2HttpError(401, "processing_runner_unauthorized", "A valid processing runner secret is required.");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new V2HttpError(503, "gemini_not_configured", "The Gemini API key is not configured.");
    const db = getV2CloudflareBindings().db;
    const queue = new D1ProcessingQueueRepository(db);
    const governor = new D1AiRuntimeGovernor(db);
    const dispatched = await queue.dispatchPending(10);
    // Observation recovery uses saved successful runs and no provider quota.
    // Keep storage errors isolated from the main analysis/grounding runners.
    const patternObservationRetries = await retryAnalysisPatternObservations(db)
      .then((outcomes) => ({ outcome: "completed" as const, outcomes }))
      .catch(() => ({ outcome: "failed" as const, outcomes: [] }));
    const gateways = createGeminiRoleGateways(apiKey);
    const workerId = `http-${crypto.randomUUID()}`;
    const analysisOutcomes: Awaited<ReturnType<typeof runNextAnalysisJob>>[] = [];
    const linkAnalysisOutcomes: Awaited<ReturnType<typeof runNextLinkAnalysisJob>>[] = [];
    const links = new D1LinkAnalysisRepository(db);
    async function nextMainJob(link: boolean) {
      if (link) {
        const outcome = await runNextLinkAnalysisJob({ queue, links, gateway: gateways.mainAnalyzer, governor, workerId });
        linkAnalysisOutcomes.push(outcome);
        return outcome;
      }
      const outcome = await runNextAnalysisJob({ queue, gateway: gateways.mainAnalyzer, governor, workerId, bucket: getV2ArchiveAssetsBucket(),
        observePattern: (job, runId, now) => observeAnalysisPatternWithRetry(db, { job, runId, now }) });
      analysisOutcomes.push(outcome);
      return outcome;
    }
    for (let index = 0; index < 3; index += 1) {
      // Interleave both users of the main-analyzer governor. A busy personal
      // queue must not starve external sources. Keep the existing three-work
      // budget; an idle queue may yield its slot to the other stage.
      const preferLink = index % 2 === 1;
      let outcome = await nextMainJob(preferLink);
      if (outcome.outcome === "idle") outcome = await nextMainJob(!preferLink);
      if (outcome.outcome === "idle" || outcome.outcome === "paused") break;
    }
    const groundingOutcomes = [];
    for (let index = 0; index < 3; index += 1) {
      const outcome = await runNextGroundingJob({ queue, gateway: gateways.groundedResearch, governor, workerId });
      groundingOutcomes.push(outcome);
      if (outcome.outcome === "idle" || outcome.outcome === "paused") break;
    }
    return Response.json({ dispatched, analysisOutcomes, linkAnalysisOutcomes, groundingOutcomes, patternObservationRetries }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
