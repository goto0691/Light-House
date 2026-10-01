import { beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  advanceExport: vi.fn(),
  bucketGet: vi.fn(),
  createExport: vi.fn(),
  getExport: vi.fn(),
  getActiveRestrictedGrant: vi.fn(),
  getSession: vi.fn(),
  listExports: vi.fn(),
  stageExport: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: harness.getSession,
}));
vi.mock("@/lib/v2/auth/restricted-grant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v2/auth/restricted-grant")>()),
  getActiveRestrictedGrant: harness.getActiveRestrictedGrant,
}));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({
  getV2CloudflareBindings: () => ({ db: { binding: "db" } }),
  getV2PortabilityBucket: () => ({ get: harness.bucketGet }),
}));
vi.mock("@/lib/v2/infrastructure/d1/portability-repository", () => ({
  D1PortabilityRepository: class {
    createExport = harness.createExport;
    getExport = harness.getExport;
    listExports = harness.listExports;
  },
}));
vi.mock("@/lib/v2/portability/resumable-export-v2", () => ({
  advanceResumableExportWorkflow: harness.advanceExport,
  ResumableExportError: class ResumableExportError extends Error {},
  stageResumableExportWorkflow: harness.stageExport,
}));

import { POST as advanceExport } from "@/app/api/v2/exports/[exportId]/advance/route";
import { GET as downloadExport } from "@/app/api/v2/exports/[exportId]/download/route";
import { GET as listExports, POST as createExport } from "@/app/api/v2/exports/route";

const headers = { "Content-Type": "application/json", Origin: "https://lighthouse.test", "Idempotency-Key": "export-one" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FLAG_V2_ROUTES", "1");
  vi.stubEnv("FLAG_V2_WRITE", "1");
  harness.getSession.mockResolvedValue({
    sessionId: "session-current",
    userId: "user-a",
    email: "owner@example.test",
    displayName: "Owner",
    expiresAt: Date.now() + 60_000,
  });
  harness.createExport.mockResolvedValue({ id: "export-one" });
  harness.stageExport.mockResolvedValue({
    id: "export-one",
    profile: "migration",
    scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true },
    status: "queued",
    bundleObjectKey: null,
    bundleSha256: null,
    bundleSizeBytes: null,
    manifest: null,
  });
});

describe("export creation boundaries", () => {
  test("requires recent reauthentication before creating a lossless migration archive", async () => {
    harness.getActiveRestrictedGrant.mockResolvedValue(null);
    const response = await createExport(new Request("https://lighthouse.test/api/v2/exports", {
      method: "POST",
      headers,
      body: JSON.stringify({ profile: "migration", scope: { privacyLevels: ["normal"] } }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "recent_reauthentication_required" } });
    expect(harness.createExport).not.toHaveBeenCalled();
  });

  test("expands an authorized migration archive to the complete recovery scope", async () => {
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const response = await createExport(new Request("https://lighthouse.test/api/v2/exports", {
      method: "POST",
      headers,
      body: JSON.stringify({
        profile: "migration",
        scope: { privacyLevels: ["normal"], includeTrash: false, includeHistory: false, includeOriginals: false },
      }),
    }));
    expect(response.status).toBe(202);
    expect(harness.createExport).toHaveBeenCalledWith(expect.objectContaining({
      profile: "migration",
      scope: {
        objects: "all",
        privacyLevels: ["normal", "sensitive", "restricted"],
        includeTrash: true,
        includeHistory: true,
        includeOriginals: true,
      },
    }));
  });

  test("redacts protected archive metadata and blocks continuation or download after the grant expires", async () => {
    const protectedJob = {
      id: "export-protected",
      profile: "migration",
      scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true },
      status: "succeeded",
      bundleObjectKey: "private/export-protected.zip",
      bundleSha256: "sha256:private",
      bundleSizeBytes: 1234,
      manifest: { counts: { documents: 99 } },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    harness.getActiveRestrictedGrant.mockResolvedValue(null);
    harness.getExport.mockResolvedValue(protectedJob);
    harness.listExports.mockResolvedValue([protectedJob]);

    const listed = await listExports(new Request("https://lighthouse.test/api/v2/exports"));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ jobs: [{
      id: "export-protected",
      bundleSha256: null,
      bundleSizeBytes: null,
      manifest: null,
    }] });

    const advanced = await advanceExport(new Request("https://lighthouse.test/api/v2/exports/export-protected/advance", {
      method: "POST",
      headers,
      body: "{}",
    }), { params: Promise.resolve({ exportId: "export-protected" }) });
    expect(advanced.status).toBe(403);
    expect(harness.advanceExport).not.toHaveBeenCalled();

    const downloaded = await downloadExport(
      new Request("https://lighthouse.test/api/v2/exports/export-protected/download"),
      { params: Promise.resolve({ exportId: "export-protected" }) },
    );
    expect(downloaded.status).toBe(403);
    expect(harness.bucketGet).not.toHaveBeenCalled();
  });
});
