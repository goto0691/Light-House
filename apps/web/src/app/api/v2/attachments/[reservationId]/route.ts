import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2ArchiveAssetsBucket, getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import { getPrivateOriginal } from "@/lib/v2/infrastructure/r2/attachment-object-repository";

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "original";
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ reservationId: string }> }) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const { reservationId } = await params;
    const access = await new D1AttachmentReservationRepository(getV2CloudflareBindings().db, context.userId).findCommittedAccess(reservationId);
    if (!access) throw new V2HttpError(404, "attachment_not_found", "The committed attachment was not found.");
    const grantActive = Boolean(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now());
    if (access.privacyLevel === "restricted" && !grantActive) {
      throw new V2HttpError(423, "restricted_record_locked", "Recent reauthentication is required.");
    }
    const object = await getPrivateOriginal(getV2ArchiveAssetsBucket(), access, context.userId);
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(access.filename),
        "Content-Length": String(object.size),
        "Content-Type": access.expectedMimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
