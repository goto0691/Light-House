export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

export type AttachmentReservation = {
  id: string;
  userId: string;
  objectKey: string;
  filename: string;
  expectedSize: number;
  expectedMimeType: string;
  expectedSha256: string;
  expiresAt: string;
};

export class AttachmentReservationError extends Error {
  readonly code = "attachment_reservation_invalid";

  constructor(message: string) {
    super(message);
    this.name = "AttachmentReservationError";
  }
}

function requireSafeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new AttachmentReservationError(`${label} must be a safe opaque identifier.`);
  }
}

export function normalizeSha256(value: string) {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new AttachmentReservationError("SHA-256 must be a 64-character hexadecimal value.");
  }
  return normalized;
}

export function validateAttachmentReservation(reservation: AttachmentReservation) {
  requireSafeIdentifier(reservation.id, "reservation.id");
  requireSafeIdentifier(reservation.userId, "reservation.userId");
  if (!reservation.filename.trim()) {
    throw new AttachmentReservationError("filename is required.");
  }
  if (!Number.isInteger(reservation.expectedSize) || reservation.expectedSize <= 0) {
    throw new AttachmentReservationError("expectedSize must be a positive integer.");
  }
  if (reservation.expectedSize > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentReservationError("The attachment exceeds the provisional 100 MB limit.");
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(reservation.expectedMimeType)) {
    throw new AttachmentReservationError("The attachment MIME type is not allowed.");
  }
  normalizeSha256(reservation.expectedSha256);

  const expectedPrefix = `users/${reservation.userId}/originals/`;
  if (!reservation.objectKey.startsWith(expectedPrefix) || !reservation.objectKey.endsWith(`/${reservation.id}`)) {
    throw new AttachmentReservationError("The object key is outside the user's private original namespace.");
  }
  if (reservation.objectKey.includes(reservation.filename)) {
    throw new AttachmentReservationError("Display filenames must not be embedded in object keys.");
  }
  if (Number.isNaN(Date.parse(reservation.expiresAt))) {
    throw new AttachmentReservationError("expiresAt must be an ISO-compatible timestamp.");
  }
}

export function buildPrivateOriginalKey(input: {
  userId: string;
  reservationId: string;
  reservedAt: string;
}) {
  requireSafeIdentifier(input.userId, "userId");
  requireSafeIdentifier(input.reservationId, "reservationId");
  const date = new Date(input.reservedAt);
  if (Number.isNaN(date.getTime())) {
    throw new AttachmentReservationError("reservedAt must be an ISO-compatible timestamp.");
  }
  return `users/${input.userId}/originals/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${input.reservationId}`;
}
