import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { unavailableLinkPresentation, type LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";

export async function GET(request: Request, { params }: RouteContext<"/api/v2/records/[recordId]">) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const { recordId } = await params;
    const record = await new D1SourceFoundationRepository(getV2CloudflareBindings().db, context.userId).getRecord(
      recordId,
      Boolean(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now()),
    );
    if (!record) {
      // getRecord() returns null when the record changed between its own reads.
      // A record that still exists changed during the read; only a missing one is 404.
      const current = await new D1SourceFoundationRepository(getV2CloudflareBindings().db, context.userId).getRecoveryPolicy(recordId);
      if (current) throw new V2HttpError(409, "record_changed_during_read", "The record changed while loading. Reload its current state.");
      throw new V2HttpError(404, "record_not_found", "The record was not found.");
    }
    const presentation = await new D1PresentationRepository(getV2CloudflareBindings().db, context.userId).project(recordId, record.locked);
    const flags = getV2ServerFeatureFlags();
    let linkPresentation: LinkPresentationV1 | null;
    try {
      linkPresentation = await new D1LinkPresentationRepository(getV2CloudflareBindings().db, context.userId).project(recordId, {
        restrictedUnlocked: Boolean(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now()), writeEnabled: flags.write, aiEnabled: flags.ai,
      });
    } catch (error) { if (!(error instanceof LinkSnapshotError)) throw error; linkPresentation = unavailableLinkPresentation(recordId, error.code); }
    const recoveryPolicy = await new D1SourceFoundationRepository(getV2CloudflareBindings().db, context.userId).getRecoveryPolicy(recordId);
    if (!recoveryPolicy) throw new V2HttpError(404, "record_not_found", "The record was not found.");
    if (recoveryPolicy.privacyLevel !== record.privacyLevel || (!record.locked && recoveryPolicy.currentVersion !== record.currentVersion)) {
      throw new V2HttpError(409, "record_changed_during_read", "The record changed while loading. Reload its current state.");
    }
    if (!record.locked && recoveryPolicy.privacyLevel === "restricted"
      && !(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now())) {
      throw new V2HttpError(423, "restricted_record_locked", "Reauthentication expired while loading this record.");
    }
    return Response.json({ ...record, presentation, linkPresentation, recoveryPolicy }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = v2ErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
