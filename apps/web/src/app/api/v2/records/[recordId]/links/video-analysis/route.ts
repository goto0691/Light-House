import { createGeminiRoleGateways } from "@/lib/v2/ai/gemini-role-gateways";
import { analyzeYouTubeVideo, type VideoAnalysisRejection } from "@/lib/v2/collect/youtube-video-analysis";
import { linkErrorResponse, LINK_PRIVATE_HEADERS, parseVideoAnalysisRequest } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";

const REJECTIONS: Record<VideoAnalysisRejection, { status: number; message: string }> = {
  video_ai_paused: { status: 503, message: "AI 호출이 잠시 대기 중입니다. 잠시 뒤 다시 시도해 주세요. 영상 링크와 메모는 그대로 있습니다." },
  video_quota_exhausted: { status: 429, message: "AI 사용량 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도해 주세요. 영상 링크와 메모는 그대로 있습니다." },
  video_provider_busy: { status: 503, message: "AI 공급자가 지금 응답하지 못했습니다. 잠시 뒤 다시 시도해 주세요." },
  video_timeout: { status: 504, message: "영상 분석 시간이 초과되었습니다. 더 짧은 구간으로 다시 시도해 주세요." },
  video_not_accessible: { status: 422, message: "이 영상을 분석할 수 없었습니다. 공개 영상만 분석할 수 있으며, 비공개·일부 공개·삭제·지역 제한 영상은 자막이나 메모를 직접 붙여 넣어 주세요." },
  video_analysis_invalid: { status: 502, message: "AI 결과가 시각 근거 검증을 통과하지 못해 저장하지 않았습니다. 다시 시도하거나 구간을 줄여 주세요." },
};

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const flags = requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    if (!flags.ai) throw new V2HttpError(503, "v2_ai_disabled", "AI 정리가 아직 활성화되지 않았습니다. 영상 링크와 메모는 계속 보관됩니다.");
    const { recordId } = await params;
    const input = parseVideoAnalysisRequest(recordId, await readJsonObject(request, { maxBytes: 4_096 }));
    const db = getV2CloudflareBindings().db;
    const snapshots = new D1LinkSnapshotRepository(db, context.userId);
    const candidate = await snapshots.videoAnalysisCandidate(input);
    let receipt = candidate.replayed;
    if (!receipt) {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) throw new V2HttpError(503, "v2_ai_unconfigured", "AI 공급자 설정이 없습니다. 영상 링크와 메모는 계속 보관됩니다.");
      // Only the server-resolved public URL and clip reach the provider; the user's memo never does.
      const outcome = await analyzeYouTubeVideo({
        gateway: createGeminiRoleGateways(apiKey).mainAnalyzer, governor: new D1AiRuntimeGovernor(db), workerId: "video-request",
        video: { videoId: candidate.videoId, videoUrl: candidate.videoUrl, range: candidate.range, purpose: candidate.purpose },
      });
      if (outcome.status === "rejected") {
        const rejection = REJECTIONS[outcome.code];
        return Response.json({ error: { code: outcome.code, message: rejection.message, retryAt: outcome.retryAt } },
          { status: rejection.status, headers: LINK_PRIVATE_HEADERS });
      }
      receipt = await snapshots.createVideoAnalysisSnapshot(input, { result: outcome.result, modelId: outcome.modelId });
    }
    const links = await new D1LinkPresentationRepository(db, context.userId).project(recordId, { writeEnabled: flags.write, aiEnabled: flags.ai });
    if (!links) throw new Error("The analyzed record is no longer accessible.");
    return Response.json({ links }, { status: receipt.replayed ? 200 : 201, headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
