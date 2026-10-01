import { requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { parseSavedViewCatalogRequest } from "@/lib/v2/retrieval/saved-view-catalog";

function failure(error: unknown) {
  const response = v2ErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response;
}

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const requestPage = parseSavedViewCatalogRequest(new URL(request.url).searchParams);
    const page = await new D1SavedViewRepository(getV2CloudflareBindings().db, context.userId).listPage(requestPage);
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const view = await new D1SavedViewRepository(getV2CloudflareBindings().db, context.userId).create(await readJsonObject(request, { maxBytes: 32768 }));
    return Response.json({ view }, { status: 201, headers: { "Cache-Control": "private, no-store", Location: `/v2/library/views/${view?.id}` } });
  } catch (error) { return failure(error); }
}
