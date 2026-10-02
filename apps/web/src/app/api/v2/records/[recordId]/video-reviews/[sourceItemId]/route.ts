import { parseVideoReviewRequest } from "@/lib/v2/domain/video-review-v1";
import { linkErrorResponse, linkGrantUnlocked, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1VideoReviewRepository } from "@/lib/v2/infrastructure/d1/video-review-repository";

type Params = { params: Promise<{ recordId: string; sourceItemId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const flags = requireV2Route();
    const context = await requireV2RequestContext(request);
    const { recordId, sourceItemId } = await params;
    const reviews = await new D1VideoReviewRepository(getV2CloudflareBindings().db, context.userId).project(recordId, sourceItemId,
      { writeEnabled: flags.write, restrictedExpiresAt: linkGrantUnlocked(context) ? context.restrictedGrant?.expiresAt : undefined });
    return Response.json({ reviews }, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const flags = requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const { recordId, sourceItemId } = await params;
    const input = parseVideoReviewRequest(await readJsonObject(request, { maxBytes: 4_096 }));
    const repository = new D1VideoReviewRepository(getV2CloudflareBindings().db, context.userId);
    const options = { writeEnabled: flags.write, restrictedExpiresAt: linkGrantUnlocked(context) ? context.restrictedGrant?.expiresAt : undefined };
    const receipt = await repository.resolve(recordId, sourceItemId, input, options);
    const reviews = await repository.project(recordId, sourceItemId, options);
    return Response.json({ receipt, reviews }, { status: receipt.replayed ? 200 : 201, headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
