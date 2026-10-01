import {
  AttachmentReservationError,
  normalizeSha256,
  type AttachmentReservation,
  validateAttachmentReservation,
} from "@/lib/v2/domain/attachment-reservation";

type R2ChecksumsBinding = {
  sha256?: ArrayBuffer;
};

type R2ObjectBinding = {
  key: string;
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  checksums: R2ChecksumsBinding;
};

export type R2ObjectBodyBinding = R2ObjectBinding & {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type R2BucketBinding = {
  head(key: string): Promise<R2ObjectBinding | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<R2ObjectBodyBinding | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      sha256?: ArrayBuffer | ArrayBufferView | string;
    },
  ): Promise<R2ObjectBinding>;
  delete(key: string | string[]): Promise<void>;
  createMultipartUpload?(
    key: string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<{
    uploadId: string;
    uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob): Promise<{ partNumber: number; etag: string }>;
    complete(parts: readonly { partNumber: number; etag: string }[]): Promise<R2ObjectBinding>;
    abort(): Promise<void>;
  }>;
  resumeMultipartUpload?(
    key: string,
    uploadId: string,
  ): {
    uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob): Promise<{ partNumber: number; etag: string }>;
    complete(parts: readonly { partNumber: number; etag: string }[]): Promise<R2ObjectBinding>;
    abort(): Promise<void>;
  };
};

export type VerifiedAttachmentObject = {
  key: string;
  size: number;
  mimeType: string;
  sha256: string;
};

export class AttachmentObjectVerificationError extends Error {
  readonly code = "attachment_object_verification_failed";

  constructor(message: string) {
    super(message);
    this.name = "AttachmentObjectVerificationError";
  }
}

function bytesToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertReservationMetadata(object: R2ObjectBinding, reservation: AttachmentReservation) {
  if (
    object.customMetadata?.reservationId !== reservation.id ||
    object.customMetadata?.userId !== reservation.userId
  ) {
    throw new AttachmentObjectVerificationError("R2 custom metadata does not match the reservation owner.");
  }
}

export async function putReservedUpload(
  bucket: R2BucketBinding,
  reservation: AttachmentReservation,
  body: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
  actualSha256: ArrayBuffer,
) {
  validateAttachmentReservation(reservation);
  return bucket.put(reservation.objectKey, body, {
    httpMetadata: { contentType: reservation.expectedMimeType },
    customMetadata: {
      reservationId: reservation.id,
      userId: reservation.userId,
    },
    sha256: actualSha256,
  });
}

export async function verifyReservedUpload(
  bucket: R2BucketBinding,
  reservation: AttachmentReservation,
  options: { removeOnFailure?: boolean } = {},
): Promise<VerifiedAttachmentObject> {
  validateAttachmentReservation(reservation);
  try {
    const object = await bucket.head(reservation.objectKey);
    if (!object) {
      throw new AttachmentObjectVerificationError("The reserved R2 object does not exist.");
    }
    if (object.size !== reservation.expectedSize) {
      throw new AttachmentObjectVerificationError("The uploaded object size does not match the reservation.");
    }
    if (object.httpMetadata?.contentType !== reservation.expectedMimeType) {
      throw new AttachmentObjectVerificationError("The uploaded object MIME type does not match the reservation.");
    }
    assertReservationMetadata(object, reservation);

    const actualSha256 = object.checksums.sha256 ? bytesToHex(object.checksums.sha256) : null;
    if (!actualSha256 || actualSha256 !== normalizeSha256(reservation.expectedSha256)) {
      throw new AttachmentObjectVerificationError("The uploaded object SHA-256 does not match the reservation.");
    }

    return {
      key: object.key,
      size: object.size,
      mimeType: object.httpMetadata.contentType,
      sha256: actualSha256,
    };
  } catch (error) {
    if (options.removeOnFailure !== false) {
      await bucket.delete(reservation.objectKey);
    }
    if (error instanceof AttachmentReservationError || error instanceof AttachmentObjectVerificationError) {
      throw error;
    }
    throw new AttachmentObjectVerificationError("The uploaded object could not be verified.");
  }
}

export async function getPrivateOriginal(
  bucket: R2BucketBinding,
  reservation: AttachmentReservation,
  requestingUserId: string,
) {
  validateAttachmentReservation(reservation);
  if (requestingUserId !== reservation.userId) {
    throw new AttachmentObjectVerificationError("The requesting user cannot read this private original.");
  }
  const object = await bucket.get(reservation.objectKey);
  if (!object) {
    throw new AttachmentObjectVerificationError("The private original does not exist.");
  }
  assertReservationMetadata(object, reservation);
  return object;
}
