import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  type AttachmentReservation,
  normalizeSha256,
  validateAttachmentReservation,
} from "@/lib/v2/domain/attachment-reservation";

export type R2DirectUploadConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  expiresInSeconds?: number;
};

function hexToBase64(hex: string) {
  const normalized = normalizeSha256(hex);
  const bytes = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function requireSecret(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

export async function createR2DirectUploadUrl(
  config: R2DirectUploadConfig,
  reservation: AttachmentReservation,
) {
  validateAttachmentReservation(reservation);
  requireSecret(config.accountId, "R2 accountId");
  requireSecret(config.accessKeyId, "R2 accessKeyId");
  requireSecret(config.secretAccessKey, "R2 secretAccessKey");
  requireSecret(config.bucketName, "R2 bucketName");

  const expiresIn = config.expiresInSeconds ?? 900;
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 3_600) {
    throw new Error("Direct upload URLs must expire between 60 and 3600 seconds.");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const checksumSha256 = hexToBase64(reservation.expectedSha256);
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: reservation.objectKey,
      ContentType: reservation.expectedMimeType,
      ChecksumSHA256: checksumSha256,
      Metadata: {
        reservationId: reservation.id,
        userId: reservation.userId,
      },
    }),
    {
      expiresIn,
      unhoistableHeaders: new Set([
        "x-amz-checksum-sha256",
        "x-amz-meta-reservationid",
        "x-amz-meta-userid",
      ]),
    },
  );

  return {
    method: "PUT" as const,
    url,
    expiresIn,
    requiredHeaders: {
      "content-type": reservation.expectedMimeType,
      "x-amz-checksum-sha256": checksumSha256,
      "x-amz-meta-reservationid": reservation.id,
      "x-amz-meta-userid": reservation.userId,
    },
  };
}
