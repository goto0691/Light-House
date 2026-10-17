import { entityCurationErrorResponse } from "@/lib/v2/http/entity-curation-response";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1EntityCurationRepository } from "@/lib/v2/infrastructure/d1/entity-curation-repository";

/** The owner merges another entity (`sourceEntityId`) into this one after confirming it on the entity page. */
export async function POST(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request, { maxBytes: 4096 });
    const sourceEntityId = requireString(body.sourceEntityId, "sourceEntityId");
    if (body.confirmed !== true) throw new V2HttpError(400, "entity_merge_unconfirmed", "Merging needs the owner's confirmation.");
    const { entityId } = await params;
    const result = await new D1EntityCurationRepository(getV2CloudflareBindings().db, context.userId).merge(sourceEntityId, entityId, new Date().toISOString());
    return Response.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return entityCurationErrorResponse(error);
  }
}
