import { requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const url = new URL(request.url);
    const includeDeleted = url.searchParams.get("includeDeleted") === "1";
    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const page = await new D1DocumentAuthoringRepository(getV2CloudflareBindings().db, context.userId).listRecordsPage({
      includeDeleted,
      limit: Number.isFinite(requestedLimit) ? requestedLimit : 50,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
