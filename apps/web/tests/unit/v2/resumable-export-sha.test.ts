import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { digestSerializableSha256, INITIAL_EXPORT_SHA256_STATE, updateSerializableSha256 } from "@/lib/v2/portability/resumable-export-v2";

describe("resumable export SHA-256", () => {
  test.each([0, 3, 55, 56, 63, 64, 65, 1_000, 1_048_576])("matches Node across chunk boundaries for %i bytes", (size) => {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) & 0xff;
    let state = INITIAL_EXPORT_SHA256_STATE;
    for (let offset = 0; offset < bytes.length; offset += 137) state = updateSerializableSha256(state, bytes.subarray(offset, Math.min(bytes.length, offset + 137)));
    expect(digestSerializableSha256(state)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
