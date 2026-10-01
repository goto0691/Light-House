import { linkErrorResponse, linkGrantUnlocked, LINK_PRIVATE_HEADERS, parseLinkSnapshotRequest } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const { recordId } = await params;
    const input = parseLinkSnapshotRequest(recordId, await readJsonObject(request, { maxBytes: 750_000 }));
    const snapshot = await new D1LinkSnapshotRepository(getV2CloudflareBindings().db, context.userId).createSnapshot({
      ...input, restrictedUnlocked: linkGrantUnlocked(context),
    });
    // Saving source versions is intentionally not an AI dispatch operation.
    return Response.json({ snapshot }, { status: snapshot.replayed ? 200 : 201, headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
