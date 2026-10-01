import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";

function failure(error: unknown) {
  const response = v2ErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request, { params }: { params: Promise<{ viewId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const { viewId } = await params;
    const view = await new D1SavedViewRepository(getV2CloudflareBindings().db, context.userId).get(viewId);
    if (!view) throw new V2HttpError(404, "saved_view_not_found", "The saved view was not found.");
    return Response.json({ view }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ viewId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request, { maxBytes: 8192 });
    const { viewId } = await params;
    const repository = new D1SavedViewRepository(getV2CloudflareBindings().db, context.userId);
    const expectedKeys = body.action === "archive" ? ["action"] : body.action === "pin" ? ["action", "pinned"] : body.action === "display" ? ["action", "display", "expectedRevision"] : [];
    if (!expectedKeys.length || Object.keys(body).sort().join(",") !== expectedKeys.sort().join(",")) throw new V2HttpError(400, "saved_view_action_invalid", "The saved view action is invalid.");
    if (body.action === "archive") { await repository.archive(viewId); return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } }); }
    if (body.action === "pin" && typeof body.pinned !== "boolean") throw new V2HttpError(400, "saved_view_action_invalid", "The saved view action is invalid.");
    const view = body.action === "display" ? await repository.setDisplay(viewId, body.display, body.expectedRevision) : await repository.setPinned(viewId, body.pinned as boolean);
    if (!view) throw new V2HttpError(404, "saved_view_not_found", "The saved view was not found.");
    return Response.json({ view }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
