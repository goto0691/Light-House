import { readJsonObject } from "@/lib/v2/http/route-helpers";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { completeRestoreUpload } from "@/lib/v2/portability/resumable-restore-upload-v1";

export async function POST(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Completing a restore upload requires recent reauthentication.");
    const body = await readJsonObject(request);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new V2HttpError(400, "restore_upload_revision_invalid", "expectedRevision must be a non-negative integer.");
    const upload = await completeRestoreUpload({ db: getV2CloudflareBindings().db, userId: context.userId, uploadId: (await params).uploadId, expectedRevision });
    return Response.json({ upload }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
