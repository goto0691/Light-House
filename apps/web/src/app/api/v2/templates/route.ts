import { requireV2RequestContext, v2ErrorResponse } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const repository = new D1TemplateRepository(getV2CloudflareBindings().db, context.userId);
    await repository.ensureSystemSeeds();
    const query = new URL(request.url).searchParams;
    const versionId = query.get("version");
    if (versionId) {
      const template = await repository.getByVersion(versionId);
      return Response.json({ templates: template ? [template] : [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const captureEligibleOnly = query.get("capture") === "1";
    return Response.json({ templates: await repository.list({ captureEligibleOnly }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return v2ErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request);
    const repository = new D1TemplateRepository(getV2CloudflareBindings().db, context.userId);
    const template = await repository.createDraft({
      definition: body.definition,
      iconKey: typeof body.iconKey === "string" ? body.iconKey : null,
      origin: "user_created",
    });
    return Response.json({ template }, { status: 201, headers: { "Cache-Control": "private, no-store", Location: `/v2/library/templates/${template?.id}` } });
  } catch (error) { return v2ErrorResponse(error); }
}
