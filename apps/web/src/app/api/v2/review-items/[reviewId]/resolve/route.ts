import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1ReviewRepository, ReviewResolutionError, type ReviewResolutionAction } from "@/lib/v2/infrastructure/d1/review-repository";

const ACTIONS = new Set<ReviewResolutionAction>(["accept", "reject", "correct", "dismiss"]);

export async function POST(request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request);
    const action = requireString(body.action, "action") as ReviewResolutionAction;
    if (!ACTIONS.has(action)) throw new V2HttpError(400, "review_action_invalid", "The review action is invalid.");
    const { reviewId } = await params;
    const result = await new D1ReviewRepository(getV2CloudflareBindings().db, context.userId).resolve(reviewId, {
      action,
      confirmHighRisk: body.confirmHighRisk === true,
      correctedValue: body.correctedValue,
    }, {
      restrictedUnlocked: Boolean(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now()),
    });
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewResolutionError) {
      const status = error.code === "restricted_record_locked" ? 423 : error.code === "review_not_found" ? 404 : error.code === "review_already_resolved" || error.code === "provider_invocation_visibility_conflict" ? 409 : 400;
      return v2ErrorResponse(new V2HttpError(status, error.code, error.message));
    }
    return v2ErrorResponse(error);
  }
}
