import { ulid } from "ulidx";

import { buildPrivateOriginalKey, type AttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireString, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import { createR2DirectUploadUrl } from "@/lib/v2/infrastructure/r2/direct-upload-url";

export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request);
    const filename = requireString(body.filename, "filename");
    const mimeType = requireString(body.mimeType, "mimeType");
    const sha256 = requireString(body.sha256, "sha256");
    if (!Number.isInteger(body.sizeBytes) || Number(body.sizeBytes) <= 0) {
      throw new V2HttpError(400, "invalid_field", "sizeBytes must be a positive integer.");
    }
    const now = new Date();
    const id = ulid();
    const reservation: AttachmentReservation = {
      id,
      userId: context.userId,
      objectKey: buildPrivateOriginalKey({ userId: context.userId, reservationId: id, reservedAt: now.toISOString() }),
      filename,
      expectedSize: Number(body.sizeBytes),
      expectedMimeType: mimeType,
      expectedSha256: sha256,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    };
    const upload = await createR2DirectUploadUrl(
      {
        accountId: process.env.R2_ACCOUNT_ID ?? "",
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
        bucketName: process.env.R2_BUCKET ?? "light-house-assets",
        expiresInSeconds: 900,
      },
      reservation,
    );
    const repository = new D1AttachmentReservationRepository(getV2CloudflareBindings().db, context.userId);
    await repository.create(reservation, now.toISOString());
    return Response.json({ reservation, upload }, { status: 201 });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
