import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
  AttachmentReservationError,
  buildPrivateOriginalKey,
  type AttachmentReservation,
} from "@/lib/v2/domain/attachment-reservation";
import {
  AttachmentObjectVerificationError,
  getPrivateOriginal,
  putReservedUpload,
  type R2BucketBinding,
  verifyReservedUpload,
} from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { createR2DirectUploadUrl } from "@/lib/v2/infrastructure/r2/direct-upload-url";

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const reservedAt = "2026-08-12T09:00:00.000Z";
const expiresAt = "2026-08-13T09:00:00.000Z";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ ARCHIVE_ASSETS: R2BucketBinding }>>>;
let bucket: R2BucketBinding;
let createdKeys: string[] = [];

async function sha256(bytes: Uint8Array) {
  const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  const hex = Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { buffer, hex };
}

async function createReservation(
  suffix: string,
  bytes: Uint8Array,
  overrides: Partial<AttachmentReservation> = {},
) {
  const digest = await sha256(bytes);
  const id = `attachment-${suffix}`;
  return {
    reservation: {
      id,
      userId: "user-a",
      objectKey: buildPrivateOriginalKey({ userId: "user-a", reservationId: id, reservedAt }),
      filename: "논쟁 화면 캡처.png",
      expectedSize: bytes.byteLength,
      expectedMimeType: "image/png",
      expectedSha256: digest.hex,
      expiresAt,
      ...overrides,
    } satisfies AttachmentReservation,
    digest,
  };
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ ARCHIVE_ASSETS: R2BucketBinding }>({
    configPath,
    persist: false,
    remoteBindings: false,
  });
  bucket = platform.env.ARCHIVE_ASSETS;
});

beforeEach(async () => {
  if (createdKeys.length) await bucket.delete(createdKeys);
  createdKeys = [];
});

afterAll(async () => {
  if (createdKeys.length) await bucket.delete(createdKeys);
  await platform.dispose();
});

describe("R2 private attachment reservation and verification", () => {
  test("keeps the display filename out of the private object key", async () => {
    const bytes = new TextEncoder().encode("fake png payload");
    const { reservation } = await createReservation("key", bytes);
    expect(reservation.objectKey).toBe("users/user-a/originals/2026/08/attachment-key");
    expect(reservation.objectKey).not.toContain(reservation.filename);
  });

  test("rejects executable MIME, oversized files, and unsafe identifiers before upload", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const executable = await createReservation("exe", bytes, { expectedMimeType: "application/x-msdownload" });
    await expect(putReservedUpload(bucket, executable.reservation, bytes, executable.digest.buffer)).rejects.toBeInstanceOf(
      AttachmentReservationError,
    );

    const oversized = await createReservation("large", bytes, { expectedSize: 100 * 1024 * 1024 + 1 });
    await expect(putReservedUpload(bucket, oversized.reservation, bytes, oversized.digest.buffer)).rejects.toBeInstanceOf(
      AttachmentReservationError,
    );

    expect(() => buildPrivateOriginalKey({ userId: "../user-a", reservationId: "escape", reservedAt })).toThrow(
      AttachmentReservationError,
    );
  });

  test("signs a short-lived direct PUT without exposing the display filename", async () => {
    const bytes = new Uint8Array([1, 4, 9, 16]);
    const { reservation } = await createReservation("signed", bytes);
    const signed = await createR2DirectUploadUrl(
      {
        accountId: "local-test-account",
        accessKeyId: "local-test-key",
        secretAccessKey: "local-test-secret",
        bucketName: "light-house-v2-r2-spike",
        expiresInSeconds: 600,
      },
      reservation,
    );

    expect(signed.method).toBe("PUT");
    expect(signed.expiresIn).toBe(600);
    const signedUrl = new URL(signed.url);
    expect(signedUrl.pathname).toBe(`/${reservation.objectKey}`);
    expect(signed.url).not.toContain(encodeURIComponent(reservation.filename));
    expect(signed.url).toContain("X-Amz-Expires=600");
    expect(signedUrl.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
    expect(signed.requiredHeaders["content-type"]).toBe("image/png");
    expect(signed.requiredHeaders["x-amz-meta-userid"]).toBe("user-a");
  });

  test("round-trips original bytes, MIME, size, and SHA-256 through a stream", async () => {
    const bytes = new TextEncoder().encode("\u0089PNG\r\n\u001a\nKorean screenshot fixture: 운동 5.2 km");
    const { reservation, digest } = await createReservation("roundtrip", bytes);
    createdKeys.push(reservation.objectKey);
    await putReservedUpload(bucket, reservation, bytes, digest.buffer);

    await expect(verifyReservedUpload(bucket, reservation)).resolves.toEqual({
      key: reservation.objectKey,
      size: bytes.byteLength,
      mimeType: "image/png",
      sha256: digest.hex,
    });

    const original = await getPrivateOriginal(bucket, reservation, "user-a");
    const reader = original.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const streamed = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      streamed.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(streamed).toEqual(bytes);
    await expect(sha256(streamed)).resolves.toMatchObject({ hex: digest.hex });
  });

  test("deletes an object that fails the reserved size check", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { reservation, digest } = await createReservation("size", bytes, { expectedSize: bytes.byteLength + 1 });
    await putReservedUpload(bucket, { ...reservation, expectedSize: bytes.byteLength }, bytes, digest.buffer);

    await expect(verifyReservedUpload(bucket, reservation)).rejects.toBeInstanceOf(AttachmentObjectVerificationError);
    await expect(bucket.head(reservation.objectKey)).resolves.toBeNull();
  });

  test("deletes an object that fails MIME or SHA-256 verification", async () => {
    const bytes = new Uint8Array([5, 6, 7, 8]);
    const mimeCase = await createReservation("mime", bytes);
    await bucket.put(mimeCase.reservation.objectKey, bytes, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { reservationId: mimeCase.reservation.id, userId: mimeCase.reservation.userId },
      sha256: mimeCase.digest.buffer,
    });
    await expect(verifyReservedUpload(bucket, mimeCase.reservation)).rejects.toBeInstanceOf(
      AttachmentObjectVerificationError,
    );
    await expect(bucket.head(mimeCase.reservation.objectKey)).resolves.toBeNull();

    const hashCase = await createReservation("hash", bytes, { expectedSha256: "0".repeat(64) });
    await bucket.put(hashCase.reservation.objectKey, bytes, {
      httpMetadata: { contentType: hashCase.reservation.expectedMimeType },
      customMetadata: { reservationId: hashCase.reservation.id, userId: hashCase.reservation.userId },
      sha256: (await sha256(bytes)).buffer,
    });
    await expect(verifyReservedUpload(bucket, hashCase.reservation)).rejects.toBeInstanceOf(
      AttachmentObjectVerificationError,
    );
    await expect(bucket.head(hashCase.reservation.objectKey)).resolves.toBeNull();
  });

  test("does not return a private original to a different user", async () => {
    const bytes = new Uint8Array([9, 10, 11]);
    const { reservation, digest } = await createReservation("privacy", bytes);
    createdKeys.push(reservation.objectKey);
    await putReservedUpload(bucket, reservation, bytes, digest.buffer);
    await expect(getPrivateOriginal(bucket, reservation, "user-b")).rejects.toBeInstanceOf(
      AttachmentObjectVerificationError,
    );
  });
});
