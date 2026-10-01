import { describe, expect, it } from "vitest";

import { resolveAuthenticatedHome } from "@/lib/v2/cutover/cutover-routing";

describe("cutover authenticated home", () => {
  it("keeps the dashboard until both route and Library-default flags are enabled", () => {
    expect(resolveAuthenticatedHome({ routes: false, defaultLibrary: true })).toBe("/dashboard");
    expect(resolveAuthenticatedHome({ routes: true, defaultLibrary: false })).toBe("/dashboard");
  });

  it("uses V2 Library after final UI promotion", () => {
    expect(resolveAuthenticatedHome({ routes: true, defaultLibrary: true })).toBe("/v2/library");
  });
});
