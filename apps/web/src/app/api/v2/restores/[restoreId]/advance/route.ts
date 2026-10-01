import { getV2CloudflareBindings, getV2PortabilityBucket } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { V2HttpError, requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { advanceRestoreWorkflow } from "@/lib/v2/portability/resumable-restore-v2";

export async function POST(request: Request, { params }: { params: Promise<{ restoreId: string }> }) {
  try {
    const context = await requireV2RequestContext(request, { mutation: true, contentTypes: ["application/json"] });
    if (!context.restrictedGrant) throw new V2HttpError(403, "recent_reauthentication_required", "Restore continuation requires recent reauthentication.");
    const restore = await advanceRestoreWorkflow({
      db: getV2CloudflareBindings().db,
      bucket: getV2PortabilityBucket(),
      userId: context.userId,
      batchId: (await params).restoreId,
    });
    return Response.json({ restore }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
