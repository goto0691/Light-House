import { beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  advanceResumableExportWorkflow: vi.fn(),
  advanceBackupWorkflow: vi.fn(),
  getActiveRestrictedGrant: vi.fn(),
  getBackupWorkflow: vi.fn(),
  getExport: vi.fn(),
  getSession: vi.fn(),
  stageBackupWorkflow: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/session")>()), getSession: harness.getSession }));
vi.mock("@/lib/v2/auth/restricted-grant", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/v2/auth/restricted-grant")>()), getActiveRestrictedGrant: harness.getActiveRestrictedGrant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: () => ({ db: { binding: "db" } }), getV2PortabilityBucket: () => ({ binding: "bucket" }) }));
vi.mock("@/lib/v2/infrastructure/d1/portability-repository", () => ({
  D1PortabilityRepository: class {
    getExport = harness.getExport;
  },
}));
vi.mock("@/lib/v2/portability/resumable-backup-v2", () => ({ advanceBackupWorkflow: harness.advanceBackupWorkflow, getBackupWorkflow: harness.getBackupWorkflow, stageBackupWorkflow: harness.stageBackupWorkflow }));
vi.mock("@/lib/v2/portability/resumable-export-v2", () => ({ advanceResumableExportWorkflow: harness.advanceResumableExportWorkflow, ResumableExportError: class ResumableExportError extends Error {} }));

import { POST as createBackup } from "@/app/api/v2/backups/route";
import { POST as advanceBackup } from "@/app/api/v2/backups/[snapshotId]/advance/route";
import { POST as legacyVerify } from "@/app/api/v2/backups/[snapshotId]/verify/route";
import { POST as runExport } from "@/app/api/v2/exports/[exportId]/run/route";

const view = { snapshotId: "snapshot-one", snapshotKind: "full", status: "building", phase: "metadata", stateRevision: 0, progress: {} };
const exportView = { id: "export-one", status: "running", workflowVersion: 2, buildPhase: "packaging", stateRevision: 1, progress: { entriesComplete: 1, partsUploaded: 0, bytesPacked: 256, pendingBytes: 256 }, bundleObjectKey: null };
const headers = { "Content-Type": "application/json", Origin: "https://lighthouse.test" };

beforeEach(() => {
  vi.clearAllMocks();
  harness.getSession.mockResolvedValue({ sessionId: "session-current", userId: "user-a", email: "owner@example.test", displayName: "Owner", expiresAt: Date.now() + 60_000 });
  harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
  harness.getExport.mockResolvedValue({
    id: "export-one",
    profile: "migration",
    scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true },
  });
  harness.advanceResumableExportWorkflow.mockResolvedValue(exportView);
  harness.stageBackupWorkflow.mockResolvedValue(view);
  harness.advanceBackupWorkflow.mockResolvedValue({ ...view, stateRevision: 1 });
  harness.getBackupWorkflow.mockResolvedValue(view);
});

describe("bounded backup and export route boundaries", () => {
  test("stages one idempotent backup and advances exactly one persisted step", async () => {
    const staged = await createBackup(new Request("https://lighthouse.test/api/v2/backups", { method: "POST", headers: { ...headers, "Idempotency-Key": "backup-create-one" }, body: JSON.stringify({ kind: "full" }) }));
    expect(staged.status).toBe(202);
    expect(harness.stageBackupWorkflow).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", kind: "full", idempotencyKey: "backup-create-one" }));

    const advanced = await advanceBackup(new Request("https://lighthouse.test/api/v2/backups/snapshot-one/advance", { method: "POST", headers, body: "{}" }), { params: Promise.resolve({ snapshotId: "snapshot-one" }) });
    expect(advanced.status).toBe(202);
    expect(harness.advanceBackupWorkflow).toHaveBeenCalledOnce();
    expect(harness.advanceBackupWorkflow).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", snapshotId: "snapshot-one" }));
  });

  test("keeps monolithic verification fail-closed and maps legacy export run to one persisted continuation", async () => {
    const verified = await legacyVerify(new Request("https://lighthouse.test/api/v2/backups/snapshot-one/verify", { method: "POST", headers, body: "{}" }), { params: Promise.resolve({ snapshotId: "snapshot-one" }) });
    expect(verified.status).toBe(409);
    await expect(verified.json()).resolves.toMatchObject({ error: { code: "backup_verification_resumable_required" } });

    const exported = await runExport(new Request("https://lighthouse.test/api/v2/exports/export-one/run", { method: "POST", headers, body: "{}" }), { params: Promise.resolve({ exportId: "export-one" }) });
    expect(exported.status).toBe(202);
    await expect(exported.json()).resolves.toMatchObject({ job: { id: "export-one", status: "running", stateRevision: 1 } });
    expect(harness.advanceResumableExportWorkflow).toHaveBeenCalledOnce();
    expect(harness.advanceResumableExportWorkflow).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", exportId: "export-one" }));
  });

  test("keeps the legacy export continuation behind recent reauthentication", async () => {
    harness.getActiveRestrictedGrant.mockResolvedValue(null);

    const exported = await runExport(new Request("https://lighthouse.test/api/v2/exports/export-one/run", { method: "POST", headers, body: "{}" }), { params: Promise.resolve({ exportId: "export-one" }) });

    expect(exported.status).toBe(403);
    await expect(exported.json()).resolves.toMatchObject({ error: { code: "recent_reauthentication_required" } });
    expect(harness.getExport).toHaveBeenCalledWith("export-one");
    expect(harness.advanceResumableExportWorkflow).not.toHaveBeenCalled();
  });
});
