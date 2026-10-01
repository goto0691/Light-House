import { readJsonObject, requireString } from "@/lib/v2/http/route-helpers";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { createRestoreUpload } from "@/lib/v2/portability/resumable-restore-upload-v1";

export async function POST(request: Request) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Resumable restore upload requires recent reauthentication.");
    const body = await readJsonObject(request);
    const upload = await createRestoreUpload({
      db: getV2CloudflareBindings().db,
      userId: context.userId,
      idempotencyKey: requireString(request.headers.get("Idempotency-Key"), "Idempotency-Key"),
      fileName: requireString(body.fileName, "fileName"),
      sizeBytes: Number(body.sizeBytes),
      archiveSha256: requireString(body.archiveSha256, "archiveSha256"),
    });
    return Response.json({ upload }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
