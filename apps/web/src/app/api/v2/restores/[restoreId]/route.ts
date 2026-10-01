import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { getRestoreWorkflow } from "@/lib/v2/portability/resumable-restore-v2";

export async function GET(request: Request, { params }: { params: Promise<{ restoreId: string }> }) {
  try {
    const context = await requireV2RequestContext(request);
    const restore = await getRestoreWorkflow(getV2CloudflareBindings().db, context.userId, (await params).restoreId);
    return Response.json({ restore }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
