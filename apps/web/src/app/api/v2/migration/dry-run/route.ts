import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";

export async function POST(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Legacy dry-run requires recent reauthentication.");
    const body = await readJsonObject(request);
    const dryRun = await new D1LegacyMigrationRepository(getV2CloudflareBindings().db, context.userId).createDryRun(requireString(body.table, "table"));
    return Response.json({ dryRun }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
