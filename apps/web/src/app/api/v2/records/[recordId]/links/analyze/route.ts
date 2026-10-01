import { linkErrorResponse, LINK_PRIVATE_HEADERS, parseLinkAnalysisRequest } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const flags = requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    if (!flags.ai) throw new V2HttpError(503, "v2_ai_disabled", "AI 정리가 아직 활성화되지 않았습니다. 원문은 계속 보관할 수 있습니다.");
    const { recordId } = await params;
    const input = parseLinkAnalysisRequest(recordId, await readJsonObject(request, { maxBytes: 8_192 }));
    const result = await new D1LinkAnalysisRepository(getV2CloudflareBindings().db).enqueue(context.userId, input);
    // The authenticated cron runner executes the durable queue. This request
    // neither waits on nor passes user-controlled instructions to the provider.
    return Response.json(result, { status: 202, headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
