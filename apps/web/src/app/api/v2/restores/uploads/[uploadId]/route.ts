import { readJsonObject } from "@/lib/v2/http/route-helpers";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { getRestoreUpload, requestRestoreUploadAbort } from "@/lib/v2/portability/resumable-restore-upload-v1";

function optionalRevision(value: unknown) {
  if (value === undefined) return undefined;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new V2HttpError(400, "restore_upload_revision_invalid", "expectedRevision must be a non-negative integer.");
  return revision;
}

export async function GET(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const context = await requireV2RequestContext(request);
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Reading a restore upload requires recent reauthentication.");
    const upload = await getRestoreUpload(getV2CloudflareBindings().db, context.userId, (await params).uploadId);
    return Response.json({ upload }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Aborting a restore upload requires recent reauthentication.");
    const body = await readJsonObject(request);
    const upload = await requestRestoreUploadAbort({
      db: getV2CloudflareBindings().db,
      userId: context.userId,
      uploadId: (await params).uploadId,
      expectedRevision: optionalRevision(body.expectedRevision),
    });
    return Response.json({ upload }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
