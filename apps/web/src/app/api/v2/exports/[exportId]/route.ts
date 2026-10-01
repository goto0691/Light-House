import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { exportJobForSession } from "@/lib/v2/portability/export-access-v1";
import { getResumableExportWorkflow } from "@/lib/v2/portability/resumable-export-v2";

export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  try {
    const context = await requireV2RequestContext(request);
    const job = await getResumableExportWorkflow(getV2CloudflareBindings().db, context.userId, (await params).exportId);
    return Response.json({ job: exportJobForSession(job, Boolean(context.restrictedGrant)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
