import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Legacy migration requires recent reauthentication.");
    if (!getV2ServerFeatureFlags().legacyReadonly) throw new V2HttpError(409, "legacy_source_not_locked", "Disable legacy writes before starting migration.");
    const body = await readJsonObject(request);
    if (body.approved !== true) throw new V2HttpError(400, "migration_approval_invalid", "Explicit approval of the current legacy dry-run is required.");
    const mode = body.mode === "source_only" || body.mode === "knowledge" ? body.mode : null;
    if (!mode) throw new V2HttpError(400, "migration_mode_invalid", "Migration mode must be source_only or knowledge.");
    const result = await new D1LegacyMigrationRepository(getV2CloudflareBindings().db, context.userId, { legacyReadOnly: true }).runApprovedBatch({
      table: requireString(body.table, "table"), importBatchId: requireString(body.importBatchId, "importBatchId"), mode,
      expectedDryRunHash: requireString(body.dryRunHash, "dryRunHash"),
      offset: typeof body.offset === "number" ? body.offset : undefined,
      limit: typeof body.limit === "number" ? body.limit : 1,
    });
    return Response.json({ result }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
