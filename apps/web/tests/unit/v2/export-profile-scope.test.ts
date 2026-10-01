import { describe, expect, it } from "vitest";

import {
  normalizeExportScopeForProfile,
  PortabilityContractError,
} from "@/lib/v2/portability/portability-contract-v1";
import {
  exportJobForSession,
  exportRequiresRecentReauthentication,
} from "@/lib/v2/portability/export-access-v1";

describe("export profile scope", () => {
  it("keeps portable exports selectively scoped", () => {
    expect(normalizeExportScopeForProfile("portable", {
      privacyLevels: ["normal", "sensitive"],
      includeTrash: false,
      includeHistory: false,
      includeOriginals: false,
    }, { restrictedUnlocked: false })).toEqual({
      objects: "all",
      privacyLevels: ["normal", "sensitive"],
      includeTrash: false,
      includeHistory: false,
      includeOriginals: false,
    });
  });

  it("requires reauthentication and expands migration exports to a lossless account scope", () => {
    expect(() => normalizeExportScopeForProfile("migration", {
      privacyLevels: ["normal"],
      includeTrash: false,
      includeHistory: false,
      includeOriginals: false,
    }, { restrictedUnlocked: false })).toThrow(PortabilityContractError);

    expect(normalizeExportScopeForProfile("migration", {
      privacyLevels: ["normal"],
      includeTrash: false,
      includeHistory: false,
      includeOriginals: false,
    }, { restrictedUnlocked: true })).toEqual({
      objects: "all",
      privacyLevels: ["normal", "sensitive", "restricted"],
      includeTrash: true,
      includeHistory: true,
      includeOriginals: true,
    });
  });

  it("keeps protected job status visible while redacting archive metadata", () => {
    const job = {
      id: "protected-export",
      profile: "migration" as const,
      scope: {
        objects: "all" as const,
        privacyLevels: ["normal", "sensitive", "restricted"] as const,
        includeTrash: true,
        includeHistory: true,
        includeOriginals: true,
      },
      status: "succeeded",
      bundleObjectKey: "private/archive.zip",
      bundleSha256: "sha256:secret",
      bundleSizeBytes: 42,
      manifest: { counts: { documents: 7 } },
    };
    expect(exportRequiresRecentReauthentication(job)).toBe(true);
    expect(exportJobForSession(job, false)).toEqual(expect.objectContaining({
      id: "protected-export",
      status: "succeeded",
      bundleSha256: null,
      bundleSizeBytes: null,
      manifest: null,
    }));
    expect(exportJobForSession(job, false)).not.toHaveProperty("bundleObjectKey");
    expect(exportJobForSession(job, true)).toMatchObject({
      bundleSha256: "sha256:secret",
      bundleSizeBytes: 42,
      manifest: { counts: { documents: 7 } },
    });
  });
});
