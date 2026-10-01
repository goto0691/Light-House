import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { uploadRestorePart } from "@/lib/v2/portability/resumable-restore-upload-v1";

function requiredLength(request: Request) {
  const value = request.headers.get("Content-Length");
  if (!value || !/^\d+$/.test(value)) throw new V2HttpError(411, "restore_upload_part_length_required", "Content-Length is required for each restore upload part.");
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) throw new V2HttpError(400, "restore_upload_part_length_invalid", "Upload part length must be a positive integer.");
  return length;
}

function optionalRevision(request: Request) {
  const value = request.headers.get("X-Lighthouse-Upload-Revision");
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new V2HttpError(400, "restore_upload_revision_invalid", "X-Lighthouse-Upload-Revision must be a non-negative integer.");
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) throw new V2HttpError(400, "restore_upload_revision_invalid", "X-Lighthouse-Upload-Revision must be a non-negative integer.");
  return revision;
}

export async function PUT(request: Request, { params }: { params: Promise<{ uploadId: string; partNumber: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/octet-stream"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Uploading restore parts requires recent reauthentication.");
    if (!request.body) throw new V2HttpError(400, "restore_upload_part_invalid", "A non-empty archive part is required.");
    const values = await params;
    const partNumber = Number(values.partNumber);
    const upload = await uploadRestorePart({
      db: getV2CloudflareBindings().db,
      bucket: getV2PortabilityBucket(),
      userId: context.userId,
      uploadId: values.uploadId,
      partNumber,
      sizeBytes: requiredLength(request),
      sha256: request.headers.get("X-Lighthouse-Part-Sha256") ?? "",
      body: request.body,
      expectedRevision: optionalRevision(request),
    });
    return Response.json({ upload }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
