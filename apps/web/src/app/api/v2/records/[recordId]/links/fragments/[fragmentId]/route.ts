import type { LinkFragmentReviewRequest } from "@/lib/v2/domain/link-presentation-v1";
import { linkErrorResponse, linkGrantUnlocked, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string; fragmentId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId, fragmentId } = await params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => key !== "snapshotId") || query.getAll("snapshotId").length !== 1 || !query.get("snapshotId"))
      throw new V2HttpError(400, "manual_link_fragment_invalid", "복사할 조각의 자료 버전을 지정해 주세요.");
    const result = await new D1ManualLinkFragmentRepository(getV2CloudflareBindings().db, context.userId).get(recordId, fragmentId, {
      snapshotId: query.get("snapshotId")!, restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ recordId: string; fragmentId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true }), { recordId, fragmentId } = await params;
    const input = await readJsonObject(request, { maxBytes: 8_192 });
    if (Object.keys(input).some((key) => !["action", "expectedRevisionId", "expectedSnapshotId", "expectedRunId", "expectedStateVersion", "idempotencyKey"].includes(key))) throw new V2HttpError(400, "link_review_invalid", "지원하지 않는 검토 필드입니다.");
    const result = await new D1LinkPresentationRepository(getV2CloudflareBindings().db, context.userId)
      .reviewFragment(recordId, fragmentId, input as LinkFragmentReviewRequest, { restrictedUnlocked: linkGrantUnlocked(context) });
    return Response.json(result, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
