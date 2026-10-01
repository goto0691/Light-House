import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { promptCurationErrorResponse, promptCurationQuery, PROMPT_CURATION_PRIVATE_HEADERS, PROMPT_CURATION_REQUEST_BYTES } from "@/lib/v2/server/prompt-curation-http";

type Context = { params: Promise<{ recordId: string; groupKey: string; revisionId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId, groupKey, revisionId } = await params;
    promptCurationQuery(request, []);
    const result = await new D1PromptCurationRepository(getV2CloudflareBindings().db, context.userId).previewMigration(recordId, groupKey, revisionId,
      { restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt });
    return Response.json(result, { headers: PROMPT_CURATION_PRIVATE_HEADERS });
  } catch (error) { return promptCurationErrorResponse(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true }), { recordId, groupKey, revisionId } = await params;
    promptCurationQuery(request, []);
    const input = await readJsonObject(request, { maxBytes: PROMPT_CURATION_REQUEST_BYTES });
    const result = await new D1PromptCurationRepository(getV2CloudflareBindings().db, context.userId).migrate(recordId, groupKey, revisionId, input,
      { restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt });
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: PROMPT_CURATION_PRIVATE_HEADERS });
  } catch (error) { return promptCurationErrorResponse(error); }
}
