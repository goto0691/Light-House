import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { requireString } from "@/lib/v2/http/route-helpers";
import { stageBackupRestore } from "@/lib/v2/portability/resumable-restore-v2";

export async function POST(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Backup restore staging requires recent reauthentication.");
    const restore = await stageBackupRestore({
      db: getV2CloudflareBindings().db,
      bucket: getV2PortabilityBucket(),
      userId: context.userId,
      idempotencyKey: requireString(request.headers.get("Idempotency-Key"), "Idempotency-Key"),
      snapshotId: (await params).snapshotId,
    });
    return Response.json({ restore }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
