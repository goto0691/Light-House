import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Migration quarantine requires recent reauthentication.");
    if (!getV2ServerFeatureFlags().legacyReadonly) throw new V2HttpError(409, "legacy_source_not_locked", "Disable legacy writes before quarantining migration output.");
    const body = await readJsonObject(request);
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      throw new V2HttpError(400, "legacy_quarantine_revision_invalid", "expectedRevision must be a non-negative integer.");
    }
    const result = await new D1LegacyMigrationRepository(getV2CloudflareBindings().db, context.userId, { legacyReadOnly: true }).quarantineBatch({
      importBatchId: (await params).batchId,
      expectedRevision: Number(body.expectedRevision),
      idempotencyKey: requireString(body.idempotencyKey, "idempotencyKey"),
      reason: requireString(body.reason, "reason"),
    });
    return Response.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
