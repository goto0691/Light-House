import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { readFacetPage } from "@/lib/v2/infrastructure/d1/facet-page-repository";
import { parseFacetRequest, type FacetRequest } from "@/lib/v2/retrieval/facet-page";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    let query: FacetRequest;
    try { query = parseFacetRequest(new URL(request.url).searchParams); }
    catch { throw new V2HttpError(400, "facet_page_invalid", "The facet catalog query is invalid."); }
    const page = await readFacetPage(getV2CloudflareBindings().db, context.userId, query);
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = v2ErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
