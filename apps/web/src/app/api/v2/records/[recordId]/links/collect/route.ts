import { collectConfiguredPublicWeb } from "@/lib/v2/collect/public-web-runtime";
import { linkErrorResponse, LINK_PRIVATE_HEADERS, parsePublicFetchRequest } from "@/lib/v2/http/link-route-helpers";
import { requireV2RequestContext } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";

export async function POST(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  try {
    const flags = requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const { recordId } = await params;
    const input = parsePublicFetchRequest(recordId, await readJsonObject(request, { maxBytes: 4_096 }));
    const db = getV2CloudflareBindings().db;
    const snapshots = new D1LinkSnapshotRepository(db, context.userId);
    const candidate = await snapshots.publicFetchCandidate(input);
    const receipt = candidate.replayed ?? await snapshots.createPublicFetchSnapshot(input, await collectConfiguredPublicWeb(candidate.url));
    const links = await new D1LinkPresentationRepository(db, context.userId).project(recordId, {
      writeEnabled: flags.write, aiEnabled: flags.ai,
    });
    if (!links) throw new Error("The collected record is no longer accessible.");
    // An unavailable page is a preserved, versioned result. No AI job is dispatched here.
    return Response.json({ links }, { status: receipt.replayed ? 200 : 201, headers: LINK_PRIVATE_HEADERS });
  } catch (error) { return linkErrorResponse(error); }
}
