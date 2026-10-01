import { linkErrorResponse, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1LinkFragmentEvidenceRepository } from "@/lib/v2/infrastructure/d1/link-fragment-evidence-repository";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string; fragmentId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId, fragmentId } = await params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["snapshotId", "manifestHash"].includes(key))
      || query.getAll("snapshotId").length !== 1 || query.getAll("manifestHash").length !== 1)
      throw new V2HttpError(400, "link_fragment_evidence_request_invalid", "정확한 자료 ID와 manifest 해시를 한 번씩 지정해 주세요.");
    const result = await new D1LinkFragmentEvidenceRepository(getV2CloudflareBindings().db, context.userId).get(recordId, fragmentId, {
      snapshotId: query.get("snapshotId")!, manifestHash: query.get("manifestHash")!, restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
