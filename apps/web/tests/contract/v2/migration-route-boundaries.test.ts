import { afterEach, describe, expect, test, vi } from "vitest";

const boundaryHarness = vi.hoisted(() => ({
  getActiveRestrictedGrant: vi.fn(),
  getSession: vi.fn(),
  getV2CloudflareBindings: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: boundaryHarness.getSession,
}));

vi.mock("@/lib/v2/auth/restricted-grant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v2/auth/restricted-grant")>()),
  getActiveRestrictedGrant: boundaryHarness.getActiveRestrictedGrant,
}));

vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v2/infrastructure/cloudflare/runtime-bindings")>()),
  getV2CloudflareBindings: boundaryHarness.getV2CloudflareBindings,
}));

import { GET as getMigrationBatch } from "@/app/api/v2/migration/batches/[batchId]/route";
import { POST as quarantineMigrationBatch } from "@/app/api/v2/migration/batches/[batchId]/quarantine/route";
import { GET as getMigrationBatches } from "@/app/api/v2/migration/batches/route";
import { POST as createMigrationDryRun } from "@/app/api/v2/migration/dry-run/route";
import { GET as getMigrationInventory } from "@/app/api/v2/migration/inventory/route";
import { POST as runMigration } from "@/app/api/v2/migration/run/route";
import { POST as projectMigrationRow } from "@/app/api/v2/migration/rows/route";

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("V2 migration route boundaries", () => {
  test("gates inventory, dry-run, and reconciliation reads behind V2 routes", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "0");
    vi.stubEnv("FLAG_V2_WRITE", "0");

    await expectError(
      await getMigrationInventory(new Request("https://lighthouse.test/api/v2/migration/inventory")),
      404,
      "v2_routes_disabled",
    );
    await expectError(
      await createMigrationDryRun(new Request("https://lighthouse.test/api/v2/migration/dry-run", { method: "POST" })),
      404,
      "v2_routes_disabled",
    );
    await expectError(
      await getMigrationBatch(
        new Request("https://lighthouse.test/api/v2/migration/batches/batch-one"),
        { params: Promise.resolve({ batchId: "batch-one" }) },
      ),
      404,
      "v2_routes_disabled",
    );
    await expectError(
      await getMigrationBatches(new Request("https://lighthouse.test/api/v2/migration/batches")),
      404,
      "v2_routes_disabled",
    );
    await expectError(
      await quarantineMigrationBatch(
        new Request("https://lighthouse.test/api/v2/migration/batches/batch-one/quarantine", { method: "POST" }),
        { params: Promise.resolve({ batchId: "batch-one" }) },
      ),
      404,
      "v2_routes_disabled",
    );
  });

  test("treats dry-run as a read while gating approved runs as writes", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "0");

    await expectError(
      await createMigrationDryRun(new Request("https://lighthouse.test/api/v2/migration/dry-run", { method: "POST" })),
      403,
      "origin_rejected",
    );
    await expectError(
      await runMigration(new Request("https://lighthouse.test/api/v2/migration/run", { method: "POST" })),
      503,
      "v2_write_disabled",
    );
    await expectError(
      await quarantineMigrationBatch(
        new Request("https://lighthouse.test/api/v2/migration/batches/batch-one/quarantine", { method: "POST" }),
        { params: Promise.resolve({ batchId: "batch-one" }) },
      ),
      503,
      "v2_write_disabled",
    );
  });

  test("retires direct row projection and leaves the approved run endpoint as the only write path", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "1");

    await expectError(await projectMigrationRow(), 410, "legacy_row_projection_retired");
  });

  test("refuses an authenticated approved run until legacy writes are locked", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "1");
    vi.stubEnv("FLAG_V2_LEGACY_READONLY", "0");
    boundaryHarness.getV2CloudflareBindings.mockReturnValue({ db: {} });
    boundaryHarness.getSession.mockResolvedValue({
      sessionId: "session-current",
      userId: "user-a",
      email: "owner@example.test",
      displayName: "Owner",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    boundaryHarness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });

    await expectError(
      await runMigration(new Request("https://lighthouse.test/api/v2/migration/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://lighthouse.test" },
      })),
      409,
      "legacy_source_not_locked",
    );
  });

  test("requires recent reauthentication for batch history and quarantine", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "1");
    vi.stubEnv("FLAG_V2_LEGACY_READONLY", "1");
    boundaryHarness.getV2CloudflareBindings.mockReturnValue({ db: {} });
    boundaryHarness.getSession.mockResolvedValue({
      sessionId: "session-current",
      userId: "user-a",
      email: "owner@example.test",
      displayName: "Owner",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    boundaryHarness.getActiveRestrictedGrant.mockResolvedValue(null);

    await expectError(
      await getMigrationBatches(new Request("https://lighthouse.test/api/v2/migration/batches")),
      403,
      "recent_reauthentication_required",
    );
    await expectError(
      await quarantineMigrationBatch(
        new Request("https://lighthouse.test/api/v2/migration/batches/batch-one/quarantine", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://lighthouse.test" },
        }),
        { params: Promise.resolve({ batchId: "batch-one" }) },
      ),
      403,
      "recent_reauthentication_required",
    );
  });

  test("refuses quarantine until legacy writes are locked", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "1");
    vi.stubEnv("FLAG_V2_LEGACY_READONLY", "0");
    boundaryHarness.getV2CloudflareBindings.mockReturnValue({ db: {} });
    boundaryHarness.getSession.mockResolvedValue({
      sessionId: "session-current",
      userId: "user-a",
      email: "owner@example.test",
      displayName: "Owner",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    boundaryHarness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });

    await expectError(
      await quarantineMigrationBatch(
        new Request("https://lighthouse.test/api/v2/migration/batches/batch-one/quarantine", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://lighthouse.test" },
        }),
        { params: Promise.resolve({ batchId: "batch-one" }) },
      ),
      409,
      "legacy_source_not_locked",
    );
  });
});
