import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { promptCurationCopyQuery, promptCurationErrorResponse, PROMPT_CURATION_PRIVATE_HEADERS } from "@/lib/v2/server/prompt-curation-http";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string; groupKey: string; revisionId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId, groupKey, revisionId } = await params;
    const input = promptCurationCopyQuery(request);
    const result = await new D1PromptCurationRepository(getV2CloudflareBindings().db, context.userId).copy(recordId, groupKey, revisionId, input, {
      restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { headers: PROMPT_CURATION_PRIVATE_HEADERS });
  } catch (error) { return promptCurationErrorResponse(error); }
}
