import { afterEach, describe, expect, test } from "vitest";

import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { putVerifiedFixedLengthStream } from "@/lib/v2/portability/resumable-restore-v2";

const originalFixedLengthDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FixedLengthStream");

afterEach(() => {
  if (originalFixedLengthDescriptor) Object.defineProperty(globalThis, "FixedLengthStream", originalFixedLengthDescriptor);
  else Reflect.deleteProperty(globalThis, "FixedLengthStream");
});

describe("restore FixedLengthStream upload", () => {
  test("uses the Workers fixed-length branch with the declared size and R2 checksum", async () => {
    const declaredLengths: number[] = [];
    class FakeFixedLengthStream {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;

      constructor(expectedLength: number) {
        declaredLengths.push(expectedLength);
        const transform = new TransformStream<Uint8Array, Uint8Array>();
        this.readable = transform.readable;
        this.writable = transform.writable;
      }
    }
    Object.defineProperty(globalThis, "FixedLengthStream", { configurable: true, value: FakeFixedLengthStream });

    const expected = new TextEncoder().encode("workers-fixed-length-restore");
    const expectedHash = sha256Hex(expected);
    let multipartUsed = false;
    let stored: Uint8Array | null = null;
    let storedKey = "";
    let storedOptions: Parameters<R2BucketBinding["put"]>[2];
    const bucket: R2BucketBinding = {
      async head() { return null; },
      async get() { return null; },
      async delete() {},
      async put(key, value, options) {
        if (!(value instanceof ReadableStream)) throw new Error("Expected a fixed-length readable stream.");
        storedKey = key;
        storedOptions = options;
        stored = new Uint8Array(await new Response(value).arrayBuffer());
        return { key, size: stored.byteLength, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata, checksums: { sha256: new ArrayBuffer(0) } };
      },
      async createMultipartUpload() {
        multipartUsed = true;
        throw new Error("FixedLengthStream branch must not use multipart upload.");
      },
    };

    await putVerifiedFixedLengthStream({
      bucket,
      key: "users/test/restore-staging/fixed-length",
      body: new Blob([expected]).stream(),
      size: expected.byteLength,
      sha256: expectedHash,
      mediaType: "image/png",
      customMetadata: { userId: "user-a", restoreBatchId: "restore-a" },
    });

    expect(declaredLengths).toEqual([expected.byteLength]);
    expect(multipartUsed).toBe(false);
    expect(storedKey).toBe("users/test/restore-staging/fixed-length");
    expect(stored).toEqual(expected);
    expect(storedOptions).toMatchObject({
      httpMetadata: { contentType: "image/png" },
      customMetadata: { userId: "user-a", restoreBatchId: "restore-a" },
      sha256: Uint8Array.from(expectedHash.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16)),
    });
  });

  test("does not delete a winner object when a stale fixed-length PUT fails", async () => {
    class FailingFixedLengthStream {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;
      constructor() {
        const transform = new TransformStream<Uint8Array, Uint8Array>();
        this.readable = transform.readable;
        this.writable = transform.writable;
      }
    }
    Object.defineProperty(globalThis, "FixedLengthStream", { configurable: true, value: FailingFixedLengthStream });
    const deleted: string[] = [];
    const bucket = {
      async head() { return null; },
      async get() { return null; },
      async delete(key: string | string[]) { deleted.push(...(Array.isArray(key) ? key : [key])); },
      async put() { throw new Error("stale put failed after a newer owner committed"); },
      async createMultipartUpload() { throw new Error("unexpected multipart"); },
    } as unknown as R2BucketBinding;
    const bytes = new TextEncoder().encode("immutable-winner");

    await expect(putVerifiedFixedLengthStream({
      bucket,
      key: "users/test/restored-originals/shared/hash",
      body: new Blob([bytes]).stream(),
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
      mediaType: "application/octet-stream",
      customMetadata: { userId: "user-a", restoreBatchId: "stale-owner" },
    })).rejects.toThrow("stale put failed");
    expect(deleted).toEqual([]);
  });
});
