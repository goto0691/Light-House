import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { advanceBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";

export async function POST(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Continuing a verified backup requires recent reauthentication.");
    const snapshot = await advanceBackupWorkflow({
      db: getV2CloudflareBindings().db,
      bucket: getV2PortabilityBucket(),
      userId: context.userId,
      snapshotId: (await params).snapshotId,
    });
    return Response.json({ snapshot }, { status: snapshot.status === "succeeded" ? 200 : 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
