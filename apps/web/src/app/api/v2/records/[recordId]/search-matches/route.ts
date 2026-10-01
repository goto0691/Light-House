import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { linkErrorResponse, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { retrievalRequestQuery } from "@/lib/v2/retrieval/request-query";
import { RETRIEVAL_MATCHES_CONTRACT } from "@/lib/v2/retrieval/record-location-v1";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId } = await params;
    const { plan, page: pageNumber } = retrievalRequestQuery(new URL(request.url).searchParams);
    const result = await new D1RetrievalRepository(getV2CloudflareBindings().db, context.userId).listMatches(recordId, plan, Boolean(context.restrictedGrant), pageNumber);
    if (context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) <= Date.now())
      throw new V2HttpError(423, "restricted_record_locked", "검색 근거를 다시 인증한 뒤 열어 주세요.");
    if (result.privacyLevel === null)
      throw new V2HttpError(404, "record_not_found", "같은 조건으로 접근 가능한 기록을 찾지 못했습니다.");
    return Response.json({ contract: RETRIEVAL_MATCHES_CONTRACT, recordId, plan, ...result }, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
