import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  digestPersistedSha256,
  initialPersistedSha256State,
  updatePersistedSha256,
} from "@/lib/v2/portability/persisted-sha256-v1";

describe("persisted SHA-256 state", () => {
  test("round-trips an unaligned digest across bounded updates", () => {
    const bytes = new TextEncoder().encode("light-house multipart restore ".repeat(10_003));
    let state = initialPersistedSha256State();
    for (let offset = 0; offset < bytes.byteLength; offset += 997) {
      state = updatePersistedSha256(state, bytes.subarray(offset, Math.min(bytes.byteLength, offset + 997)));
      state = JSON.parse(JSON.stringify(state)) as typeof state;
    }
    expect(digestPersistedSha256(state)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test("rejects malformed persisted state", () => {
    const state = { ...initialPersistedSha256State(), position: 1 };
    expect(() => updatePersistedSha256(state, new Uint8Array())).toThrow("sha256_state_invalid");
  });
});
