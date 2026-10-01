import { linkErrorResponse, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request), { recordId } = await params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["snapshotId", "cursor"].includes(key) || query.getAll(key).length !== 1))
      throw new V2HttpError(400, "manual_link_fragment_invalid", "지원하지 않거나 중복된 조회 필드입니다.");
    const result = await new D1ManualLinkFragmentRepository(getV2CloudflareBindings().db, context.userId).list(recordId, {
      snapshotId: query.get("snapshotId") ?? undefined, cursor: query.get("cursor") ?? undefined, restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true }), { recordId } = await params;
    const input = await readJsonObject(request, { maxBytes: 8_192 });
    const result = await new D1ManualLinkFragmentRepository(getV2CloudflareBindings().db, context.userId).create(recordId, input, {
      restrictedGrantExpiresAt: context.restrictedGrant?.expiresAt,
    });
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
