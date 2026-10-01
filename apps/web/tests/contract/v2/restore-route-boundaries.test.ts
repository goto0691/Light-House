import { beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  advanceRestoreWorkflow: vi.fn(),
  approveRestoreWorkflow: vi.fn(),
  getActiveRestrictedGrant: vi.fn(),
  getRestoreWorkflow: vi.fn(),
  getSession: vi.fn(),
  requestRestoreRollback: vi.fn(),
  stageArchiveRestore: vi.fn(),
  stageBackupRestore: vi.fn(),
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
  getV2PortabilityBucket: () => ({ binding: "bucket" }),
}));

vi.mock("@/lib/v2/portability/resumable-restore-v2", () => ({
  advanceRestoreWorkflow: harness.advanceRestoreWorkflow,
  approveRestoreWorkflow: harness.approveRestoreWorkflow,
  getRestoreWorkflow: harness.getRestoreWorkflow,
  requestRestoreRollback: harness.requestRestoreRollback,
  stageArchiveRestore: harness.stageArchiveRestore,
  stageBackupRestore: harness.stageBackupRestore,
}));

import { POST as stageBackup } from "@/app/api/v2/backups/[snapshotId]/dry-run/route";
import { POST as approveBackup } from "@/app/api/v2/backups/[snapshotId]/restore/route";
import { POST as advanceRestore } from "@/app/api/v2/restores/[restoreId]/advance/route";
import { POST as requestRollback } from "@/app/api/v2/restores/[restoreId]/rollback/route";
import { GET as getRestore } from "@/app/api/v2/restores/[restoreId]/route";
import { POST as approveRestore } from "@/app/api/v2/restores/import/route";
import { POST as stageArchive } from "@/app/api/v2/restores/verify/route";

const SHA256 = "a".repeat(64);
const view = { batchId: "restore-one", status: "indexing", stateRevision: 0, progress: {} };

function mutationHeaders(contentType: string, extra: Record<string, string> = {}) {
  return { "Content-Type": contentType, Origin: "https://lighthouse.test", ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.getSession.mockResolvedValue({
    sessionId: "session-current",
    userId: "user-a",
    email: "owner@example.test",
    displayName: "Owner",
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
  harness.stageArchiveRestore.mockResolvedValue(view);
  harness.stageBackupRestore.mockResolvedValue(view);
  harness.approveRestoreWorkflow.mockResolvedValue({ ...view, status: "applying", stateRevision: 1 });
  harness.advanceRestoreWorkflow.mockResolvedValue({ ...view, status: "planning", stateRevision: 1 });
  harness.getRestoreWorkflow.mockResolvedValue(view);
  harness.requestRestoreRollback.mockResolvedValue({ ...view, status: "rollback_requested", stateRevision: 1 });
});

describe("V2 resumable restore route boundaries", () => {
  test("streams one raw ZIP upload into staging with explicit size, digest, and idempotency", async () => {
    const response = await stageArchive(new Request("https://lighthouse.test/api/v2/restores/verify", {
      method: "POST",
      headers: mutationHeaders("application/zip", {
        "Content-Length": "4",
        "Idempotency-Key": "upload-once",
        "X-Lighthouse-Archive-Sha256": SHA256.toUpperCase(),
        "X-Lighthouse-Archive-Name": encodeURIComponent("기록.zip"),
      }),
      body: new Blob([new Uint8Array([1, 2, 3, 4])]),
    }));

    expect(response.status).toBe(202);
    expect(harness.stageArchiveRestore).toHaveBeenCalledOnce();
    expect(harness.stageArchiveRestore).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      idempotencyKey: "upload-once",
      archiveSha256: SHA256,
      fileName: "기록.zip",
      sizeBytes: 4,
      body: expect.any(ReadableStream),
    }));
  });

  test("rejects buffered multipart uploads, missing length, oversized archives, and stale grants before staging", async () => {
    const multipart = await stageArchive(new Request("https://lighthouse.test/api/v2/restores/verify", {
      method: "POST",
      headers: mutationHeaders("multipart/form-data"),
    }));
    expect(multipart.status).toBe(415);

    const missingLength = await stageArchive(new Request("https://lighthouse.test/api/v2/restores/verify", {
      method: "POST",
      headers: mutationHeaders("application/zip", { "Idempotency-Key": "one", "X-Lighthouse-Archive-Sha256": SHA256 }),
    }));
    expect(missingLength.status).toBe(411);

    const oversized = await stageArchive(new Request("https://lighthouse.test/api/v2/restores/verify", {
      method: "POST",
      headers: mutationHeaders("application/zip", { "Content-Length": String(90 * 1024 * 1024 + 1), "Idempotency-Key": "one", "X-Lighthouse-Archive-Sha256": SHA256 }),
      body: new Blob(["x"]),
    }));
    expect(oversized.status).toBe(413);

    harness.getActiveRestrictedGrant.mockResolvedValueOnce(null);
    const locked = await stageArchive(new Request("https://lighthouse.test/api/v2/restores/verify", {
      method: "POST",
      headers: mutationHeaders("application/zip", { "Content-Length": "1", "Idempotency-Key": "one", "X-Lighthouse-Archive-Sha256": SHA256 }),
      body: new Blob(["x"]),
    }));
    expect(locked.status).toBe(403);
    expect(harness.stageArchiveRestore).not.toHaveBeenCalled();
  });

  test("approves a persisted archive plan without uploading the archive again", async () => {
    const response = await approveRestore(new Request("https://lighthouse.test/api/v2/restores/import", {
      method: "POST",
      headers: mutationHeaders("application/json"),
      body: JSON.stringify({ restoreId: "restore-one", approved: true, dryRunHash: SHA256, expectedRevision: 7 }),
    }));

    expect(response.status).toBe(202);
    expect(harness.approveRestoreWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      batchId: "restore-one",
      expectedDryRunHash: SHA256,
      expectedRevision: 7,
    }));
    expect(harness.stageArchiveRestore).not.toHaveBeenCalled();
  });

  test("exposes one bounded advance action", async () => {
    const response = await advanceRestore(new Request("https://lighthouse.test/api/v2/restores/restore-one/advance", {
      method: "POST",
      headers: mutationHeaders("application/json"),
      body: "{}",
    }), { params: Promise.resolve({ restoreId: "restore-one" }) });

    expect(response.status).toBe(202);
    expect(harness.advanceRestoreWorkflow).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", batchId: "restore-one" }));
  });

  test("reads the persisted workflow and only requests rollback without performing it inline", async () => {
    const loaded = await getRestore(new Request("https://lighthouse.test/api/v2/restores/restore-one"), { params: Promise.resolve({ restoreId: "restore-one" }) });
    expect(loaded.status).toBe(200);
    expect(harness.getRestoreWorkflow).toHaveBeenCalledWith(expect.anything(), "user-a", "restore-one");

    const rollback = await requestRollback(new Request("https://lighthouse.test/api/v2/restores/restore-one/rollback", {
      method: "POST",
      headers: mutationHeaders("application/json"),
      body: JSON.stringify({ expectedRevision: 0 }),
    }), { params: Promise.resolve({ restoreId: "restore-one" }) });
    expect(rollback.status).toBe(202);
    expect(harness.requestRestoreRollback).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", batchId: "restore-one", expectedRevision: 0 }));
    expect(harness.advanceRestoreWorkflow).not.toHaveBeenCalled();
  });

  test("stages a backup with one stable key, then approves and advances that restore id", async () => {
    const staged = await stageBackup(new Request("https://lighthouse.test/api/v2/backups/snapshot-one/dry-run", {
      method: "POST",
      headers: mutationHeaders("application/json", { "Idempotency-Key": "backup-stable" }),
      body: "{}",
    }), { params: Promise.resolve({ snapshotId: "snapshot-one" }) });
    expect(staged.status).toBe(202);
    expect(harness.stageBackupRestore).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "snapshot-one", idempotencyKey: "backup-stable" }));

    const approved = await approveBackup(new Request("https://lighthouse.test/api/v2/backups/snapshot-one/restore", {
      method: "POST",
      headers: mutationHeaders("application/json"),
      body: JSON.stringify({ restoreId: "restore-one", approved: true, dryRunHash: SHA256, expectedRevision: 9 }),
    }));
    expect(approved.status).toBe(202);
    expect(harness.approveRestoreWorkflow).toHaveBeenCalledWith(expect.objectContaining({ batchId: "restore-one", expectedRevision: 9 }));
    expect(harness.advanceRestoreWorkflow).toHaveBeenCalledWith(expect.objectContaining({ batchId: "restore-one" }));
  });
});
