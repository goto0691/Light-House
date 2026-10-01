import { authenticateUser } from "@/lib/server/auth";
import { issueRestrictedGrant, revokeRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";

export async function POST(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request, { mutation: true });
    const password = requireString((await readJsonObject(request)).password, "password");
    const user = await authenticateUser(context.email, password);
    if (!user || user.id !== context.userId) throw new V2HttpError(401, "reauthentication_failed", "The password did not match the current account.");
    const grant = await issueRestrictedGrant(getV2CloudflareBindings().db, { userId: context.userId, sessionId: context.sessionId });
    return Response.json(grant, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request, { mutation: true });
    await revokeRestrictedGrant(getV2CloudflareBindings().db, { userId: context.userId, sessionId: context.sessionId });
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
