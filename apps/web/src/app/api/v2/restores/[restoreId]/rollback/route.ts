import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject } from "@/lib/v2/http/route-helpers";
import { requestRestoreRollback } from "@/lib/v2/portability/resumable-restore-v2";

export async function POST(request: Request, { params }: { params: Promise<{ restoreId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Rollback requires recent reauthentication.");
    const body = await readJsonObject(request);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new V2HttpError(400, "restore_revision_invalid", "expectedRevision must be a non-negative integer.");
    const restore = await requestRestoreRollback({ db: getV2CloudflareBindings().db, userId: context.userId, batchId: (await params).restoreId, expectedRevision });
    return Response.json({ restore }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
