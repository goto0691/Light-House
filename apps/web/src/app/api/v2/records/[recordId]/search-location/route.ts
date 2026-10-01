import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { linkErrorResponse, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RecordLocationRepository } from "@/lib/v2/infrastructure/d1/record-location-repository";
import { parseRecordLocationParam, RECORD_LOCATION_QUERY_KEY } from "@/lib/v2/retrieval/record-location-v1";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId } = await params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => key !== RECORD_LOCATION_QUERY_KEY) || query.getAll(RECORD_LOCATION_QUERY_KEY).length !== 1)
      throw new V2HttpError(400, "record_location_invalid", "중복되지 않은 정확한 보관 위치를 지정해 주세요.");
    const location = parseRecordLocationParam(query.get(RECORD_LOCATION_QUERY_KEY));
    if (!location) throw new V2HttpError(400, "record_location_invalid", "보관 위치를 지정해 주세요.");
    const result = await new D1RecordLocationRepository(getV2CloudflareBindings().db, context.userId).get(recordId, location, {
      restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
