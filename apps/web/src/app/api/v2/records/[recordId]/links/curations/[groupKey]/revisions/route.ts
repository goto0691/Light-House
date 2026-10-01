import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { promptCurationErrorResponse, promptCurationQuery, PROMPT_CURATION_PRIVATE_HEADERS, PROMPT_CURATION_REQUEST_BYTES } from "@/lib/v2/server/prompt-curation-http";

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string; groupKey: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true }), { recordId, groupKey } = await params;
    promptCurationQuery(request, []);
    const input = await readJsonObject(request, { maxBytes: PROMPT_CURATION_REQUEST_BYTES });
    const result = await new D1PromptCurationRepository(getV2CloudflareBindings().db, context.userId).revise(recordId, groupKey, input, {
      restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: PROMPT_CURATION_PRIVATE_HEADERS });
  } catch (error) { return promptCurationErrorResponse(error); }
}
