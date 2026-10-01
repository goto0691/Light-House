import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RediscoveryRepository } from "@/lib/v2/infrastructure/d1/rediscovery-repository";

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request);
    const eventKind = requireString(body.eventKind, "eventKind");
    if (!["shown", "opened", "dismissed"].includes(eventKind)) throw new V2HttpError(400, "rediscovery_event_invalid", "Unsupported rediscovery event.");
    await new D1RediscoveryRepository(getV2CloudflareBindings().db, context.userId).recordEvent(requireString(body.recordId, "recordId"), eventKind as "shown" | "opened" | "dismissed");
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
