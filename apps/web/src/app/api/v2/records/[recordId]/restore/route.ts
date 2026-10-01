import { ulid } from "ulidx";

import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/records/[recordId]/restore">) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const { recordId } = await params;
    const result = await new D1SourceFoundationRepository(getV2CloudflareBindings().db, context.userId).restoreRecord(recordId, {
      auditEventId: ulid(),
      restoredAt: new Date().toISOString(),
    });
    if (!result) throw new V2HttpError(404, "record_not_found", "The record was not found.");
    return Response.json(result);
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
