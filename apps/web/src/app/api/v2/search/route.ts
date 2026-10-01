import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { retrievalRequestQuery } from "@/lib/v2/retrieval/request-query";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const { plan, page: requestedPage } = retrievalRequestQuery(new URL(request.url).searchParams);
    const repository = new D1RetrievalRepository(getV2CloudflareBindings().db, context.userId);
    const page = await repository.searchPage(plan, Boolean(context.restrictedGrant), requestedPage);
    if (context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) <= Date.now())
      throw new V2HttpError(423, "restricted_record_locked", "검색 결과를 다시 인증한 뒤 열어 주세요.");
    return Response.json({ contractVersion: "retrieval-results-v1", plan, ...page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = v2ErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
