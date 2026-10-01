import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Migration batch history requires recent reauthentication.");
    const rawLimit = new URL(request.url).searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    const batches = await new D1LegacyMigrationRepository(getV2CloudflareBindings().db, context.userId).listBatches(limit);
    return Response.json({ batches }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
