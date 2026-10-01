import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { promptCurationErrorResponse, promptCurationQuery, PROMPT_CURATION_PRIVATE_HEADERS } from "@/lib/v2/server/prompt-curation-http";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string; groupKey: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId, groupKey } = await params;
    const query = promptCurationQuery(request, ["revisionId", "cursor"]);
    const result = await new D1PromptCurationRepository(getV2CloudflareBindings().db, context.userId).get(recordId, groupKey, {
      revisionId: query.get("revisionId") ?? undefined, cursor: query.get("cursor") ?? undefined,
      restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { headers: PROMPT_CURATION_PRIVATE_HEADERS });
  } catch (error) { return promptCurationErrorResponse(error); }
}
