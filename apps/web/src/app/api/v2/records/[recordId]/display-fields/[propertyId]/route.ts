import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { linkErrorResponse, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { parseSavedFieldRead, readSavedFieldPage } from "@/lib/v2/infrastructure/d1/saved-field-value-repository";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string; propertyId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId, propertyId } = await params;
    const query = parseSavedFieldRead(new URL(request.url).searchParams);
    const page = await readSavedFieldPage(getV2CloudflareBindings().db, context.userId, recordId, propertyId, query);
    return Response.json(page, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
