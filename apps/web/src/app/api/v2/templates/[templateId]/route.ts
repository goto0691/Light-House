import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";

const ACTIONS = new Set(["try", "keep", "dismiss", "archive", "pin", "unpin"]);

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const template = await new D1TemplateRepository(getV2CloudflareBindings().db, context.userId).get((await params).templateId);
    if (!template) throw new V2HttpError(404, "template_not_found", "Template not found.");
    return Response.json({ template }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const action = requireString((await readJsonObject(request)).action, "action");
    if (!ACTIONS.has(action)) throw new V2HttpError(400, "template_transition_invalid", "Unsupported template action.");
    const template = await new D1TemplateRepository(getV2CloudflareBindings().db, context.userId).transition((await params).templateId, action as "try" | "keep" | "dismiss" | "archive" | "pin" | "unpin");
    return Response.json({ template }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}
