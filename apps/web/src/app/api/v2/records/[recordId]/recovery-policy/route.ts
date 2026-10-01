import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";

/** Authenticated metadata only. A locked record must still be able to purge local copies. */
export async function GET(request: Request, { params }: RouteContext<"/api/v2/records/[recordId]/recovery-policy">) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const { recordId } = await params;
    const policy = await new D1SourceFoundationRepository(getV2CloudflareBindings().db, context.userId).getRecoveryPolicy(recordId);
    if (!policy) throw new V2HttpError(404, "record_not_found", "The record was not found.");
    return Response.json({ recoveryPolicy: { ownerId: context.userId, ...policy },
      contentReadable: policy.privacyLevel !== "restricted" || Boolean(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = v2ErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
