import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString } from "@/lib/v2/http/route-helpers";
import { approveRestoreWorkflow } from "@/lib/v2/portability/resumable-restore-v2";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function POST(request: Request) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) {
      throw new V2HttpError(403, "recent_reauthentication_required", "Restore approval requires recent reauthentication.");
    }
    const body = await readJsonObject(request);
    const restoreId = requireString(body.restoreId, "restoreId");
    const dryRunHash = requireString(body.dryRunHash, "dryRunHash").toLowerCase();
    if (body.approved !== true || !SHA256_PATTERN.test(dryRunHash)) {
      throw new V2HttpError(400, "restore_approval_invalid", "Explicit approval of the current dry-run is required.");
    }
    const expectedRevision = body.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0)) {
      throw new V2HttpError(400, "restore_revision_invalid", "expectedRevision must be a non-negative integer.");
    }
    const restore = await approveRestoreWorkflow({
      db: getV2CloudflareBindings().db,
      userId: context.userId,
      batchId: restoreId,
      expectedDryRunHash: dryRunHash,
      expectedRevision: expectedRevision === undefined ? undefined : Number(expectedRevision),
    });
    return Response.json({ restore }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
