import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RediscoveryRepository } from "@/lib/v2/infrastructure/d1/rediscovery-repository";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    return Response.json({ preference: await new D1RediscoveryRepository(getV2CloudflareBindings().db, context.userId).getPreference() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request);
    if (typeof body.enabled !== "boolean" || typeof body.includeSensitive !== "boolean") throw new V2HttpError(400, "rediscovery_preference_invalid", "Both rediscovery preferences must be booleans.");
    const preference = await new D1RediscoveryRepository(getV2CloudflareBindings().db, context.userId).updatePreference({ enabled: body.enabled, includeSensitive: body.includeSensitive });
    return Response.json({ preference }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
