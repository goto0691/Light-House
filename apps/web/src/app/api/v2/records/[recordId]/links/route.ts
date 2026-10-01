import { linkErrorResponse, linkGrantUnlocked, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const flags = requireV2Route(), context = await requireV2RequestContext(request), { recordId } = await params;
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (!["snapshotId", "runId", "snapshotCursor", "runCursor"].includes(key) || query.getAll(key).length !== 1 || !query.get(key) || query.get(key)!.length > 1600) throw new V2HttpError(400, "link_query_invalid", "조회할 자료 버전과 이력 위치를 확인해 주세요.");
    const links = await new D1LinkPresentationRepository(getV2CloudflareBindings().db, context.userId).project(recordId, {
      snapshotId: query.get("snapshotId") ?? undefined, runId: query.get("runId") ?? undefined,
      snapshotCursor: query.get("snapshotCursor") ?? undefined, runCursor: query.get("runCursor") ?? undefined,
      restrictedUnlocked: linkGrantUnlocked(context), writeEnabled: flags.write, aiEnabled: flags.ai,
    });
    if (!links) throw new V2HttpError(404, "link_record_not_found", "기록을 찾을 수 없습니다.");
    return Response.json({ links }, { headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
