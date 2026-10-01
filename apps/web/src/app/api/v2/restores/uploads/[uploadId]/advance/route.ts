import { readJsonObject } from "@/lib/v2/http/route-helpers";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { advanceRestoreUpload } from "@/lib/v2/portability/resumable-restore-upload-v1";

export async function POST(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Advancing a restore upload requires recent reauthentication.");
    const body = await readJsonObject(request);
    const expectedRevision = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new V2HttpError(400, "restore_upload_revision_invalid", "expectedRevision must be a non-negative integer.");
    const upload = await advanceRestoreUpload({
      db: getV2CloudflareBindings().db,
      bucket: getV2PortabilityBucket(),
      userId: context.userId,
      uploadId: (await params).uploadId,
      expectedRevision,
    });
    return Response.json({ upload }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
