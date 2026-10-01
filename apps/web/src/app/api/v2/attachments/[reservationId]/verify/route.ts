import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2ArchiveAssetsBucket, getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import { verifyReservedUpload } from "@/lib/v2/infrastructure/r2/attachment-object-repository";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/attachments/[reservationId]/verify">) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const { reservationId } = await params;
    const repository = new D1AttachmentReservationRepository(getV2CloudflareBindings().db, context.userId);
    const reservation = await repository.find(reservationId);
    if (!reservation) throw new V2HttpError(404, "attachment_not_found", "The attachment reservation was not found.");
    if (reservation.status === "committed" || reservation.status === "verified") {
      return Response.json({ reservationId, status: reservation.status, replayed: true });
    }
    if (Date.parse(reservation.expiresAt) <= Date.now()) {
      throw new V2HttpError(410, "attachment_reservation_expired", "The attachment reservation has expired.");
    }
    await repository.markUploadedUnverified(reservationId);
    const verified = await verifyReservedUpload(getV2ArchiveAssetsBucket(), reservation);
    await repository.markVerified(reservationId, new Date().toISOString());
    return Response.json({ reservationId, status: "verified", verified, replayed: false });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
