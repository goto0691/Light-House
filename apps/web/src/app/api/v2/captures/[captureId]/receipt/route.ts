import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";

export async function GET(request: Request, { params }: RouteContext<"/api/v2/captures/[captureId]/receipt">) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const { captureId } = await params;
    const db = getV2CloudflareBindings().db;
    const receipt = await new D1SourceFoundationRepository(db, context.userId).getReceipt(captureId);
    if (!receipt) throw new V2HttpError(404, "capture_not_found", "The capture receipt was not found.");
    const processing = await new D1ProcessingQueueRepository(db).getCaptureProcessing(captureId, context.userId);
    return Response.json({ ...receipt, processing }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
