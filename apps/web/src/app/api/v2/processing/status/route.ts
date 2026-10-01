import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1ProcessingStatusRepository } from "@/lib/v2/infrastructure/d1/processing-status-repository";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export async function GET(request: Request) {
  try {
    const flags = requireV2Route();
    const context = await requireV2RequestContext(request);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["filter", "cursor"].includes(key) || query.getAll(key).length !== 1)) {
      throw new V2HttpError(400, "processing_status_query_invalid", "처리 상태 조회 조건이 올바르지 않습니다.");
    }
    const page = await new D1ProcessingStatusRepository(getV2CloudflareBindings().db, context.userId).list({
      filter: query.get("filter"), cursor: query.get("cursor"),
      runtime: { enabled: flags.ai && flags.write, configured: Boolean(process.env.GEMINI_API_KEY?.trim()) },
    });
    return Response.json(page, { headers });
  } catch (error) {
    const response = v2ErrorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
