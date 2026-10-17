import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { AnalysisRequestError, D1AnalysisRequestRepository } from "@/lib/v2/infrastructure/d1/analysis-request-repository";

/** The owner asks for AI organization of one record saved with AI off. */
export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route({ write: true });
    if (!getV2ServerFeatureFlags().ai) throw new V2HttpError(503, "v2_ai_disabled", "AI organization is not enabled.");
    const context = await requireV2RequestContext(request, { mutation: true });
    await readJsonObject(request, { maxBytes: 1024 });
    const { recordId } = await params;
    const result = await new D1AnalysisRequestRepository(getV2CloudflareBindings().db, context.userId).request(recordId, new Date().toISOString());
    return Response.json(result, { status: result.outcome === "queued" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AnalysisRequestError) return v2ErrorResponse(new V2HttpError(error.code === "record_not_found" ? 404 : 409, error.code, error.message));
    return v2ErrorResponse(error);
  }
}
