import { describe, expect, it } from "vitest";

import { parseBooleanFlag, toPublicV2FeatureFlags } from "@/lib/v2/config/feature-flags";

describe("V2 feature flag boundary", () => {
  it.each(["1", "true", "TRUE", "on", "yes"])("parses %s as enabled", (value) => {
    expect(parseBooleanFlag(value)).toBe(true);
  });

  it.each(["0", "false", "FALSE", "off", "no"])("parses %s as disabled", (value) => {
    expect(parseBooleanFlag(value, true)).toBe(false);
  });

  it("does not expose server write or AI flags to the client", () => {
    const publicFlags = toPublicV2FeatureFlags({
      routes: true,
      write: true,
      ai: true,
      offline: false,
      defaultLibrary: true,
      legacyReadonly: true,
    });

    expect(publicFlags).toEqual({ routes: true, offline: false });
    expect(publicFlags).not.toHaveProperty("write");
    expect(publicFlags).not.toHaveProperty("ai");
  });
});
