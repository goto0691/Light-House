import { beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  advanceRestoreUpload: vi.fn(),
  completeRestoreUpload: vi.fn(),
  createRestoreUpload: vi.fn(),
  getActiveRestrictedGrant: vi.fn(),
  getRestoreUpload: vi.fn(),
  getSession: vi.fn(),
  requestRestoreUploadAbort: vi.fn(),
  uploadRestorePart: vi.fn(),
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

vi.mock("@/lib/v2/portability/resumable-restore-upload-v1", () => ({
  advanceRestoreUpload: harness.advanceRestoreUpload,
  completeRestoreUpload: harness.completeRestoreUpload,
  createRestoreUpload: harness.createRestoreUpload,
  getRestoreUpload: harness.getRestoreUpload,
  requestRestoreUploadAbort: harness.requestRestoreUploadAbort,
  uploadRestorePart: harness.uploadRestorePart,
}));

import { POST as advanceUpload } from "@/app/api/v2/restores/uploads/[uploadId]/advance/route";
import { POST as completeUpload } from "@/app/api/v2/restores/uploads/[uploadId]/complete/route";
import { PUT as putPart } from "@/app/api/v2/restores/uploads/[uploadId]/parts/[partNumber]/route";
import { DELETE as abortUpload, GET as getUpload } from "@/app/api/v2/restores/uploads/[uploadId]/route";
import { POST as createUpload } from "@/app/api/v2/restores/uploads/route";

const SHA256 = "a".repeat(64);
const upload = {
  uploadId: "upload-one",
  status: "uploading",
  phase: "receiving",
  stateRevision: 0,
  fileName: "archive.zip",
  sizeBytes: 8 * 1024 * 1024,
  archiveSha256: SHA256,
};

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
  harness.createRestoreUpload.mockResolvedValue(upload);
  harness.uploadRestorePart.mockResolvedValue({ ...upload, receivedParts: 1, stateRevision: 1 });
  harness.completeRestoreUpload.mockResolvedValue({ ...upload, status: "verifying", phase: "hashing", stateRevision: 1 });
  harness.advanceRestoreUpload.mockResolvedValue({ ...upload, status: "assembling", phase: "creating_multipart", stateRevision: 2 });
  harness.getRestoreUpload.mockResolvedValue(upload);
  harness.requestRestoreUploadAbort.mockResolvedValue({ ...upload, status: "aborting", phase: "aborting", stateRevision: 1 });
});

describe("resumable restore upload route boundaries", () => {
  test("creates an owner-scoped session with one stable idempotency key", async () => {
    const response = await createUpload(new Request("https://lighthouse.test/api/v2/restores/uploads", {
      method: "POST",
      headers: mutationHeaders("application/json", { "Idempotency-Key": "stable-upload" }),
      body: JSON.stringify({ fileName: "archive.zip", sizeBytes: upload.sizeBytes, archiveSha256: SHA256 }),
    }));

    expect(response.status).toBe(201);
    expect(harness.createRestoreUpload).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      idempotencyKey: "stable-upload",
      fileName: "archive.zip",
      sizeBytes: upload.sizeBytes,
      archiveSha256: SHA256,
    }));
  });

  test("passes an 8 MiB octet stream directly with explicit size, SHA receipt, and revision", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const response = await putPart(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one/parts/1", {
      method: "PUT",
      headers: mutationHeaders("application/octet-stream", {
        "Content-Length": String(bytes.byteLength),
        "X-Lighthouse-Part-Sha256": SHA256,
        "X-Lighthouse-Upload-Revision": "7",
      }),
      body: new Blob([bytes]),
    }), { params: Promise.resolve({ uploadId: "upload-one", partNumber: "1" }) });

    expect(response.status).toBe(202);
    expect(harness.uploadRestorePart).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      uploadId: "upload-one",
      partNumber: 1,
      sizeBytes: bytes.byteLength,
      sha256: SHA256,
      expectedRevision: 7,
      body: expect.any(ReadableStream),
    }));
  });

  test("rejects unsupported bodies, missing length, unsafe revisions, and stale grants before R2 work", async () => {
    const wrongType = await putPart(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one/parts/1", {
      method: "PUT",
      headers: mutationHeaders("application/zip", { "Content-Length": "1", "X-Lighthouse-Part-Sha256": SHA256 }),
      body: new Blob(["x"]),
    }), { params: Promise.resolve({ uploadId: "upload-one", partNumber: "1" }) });
    expect(wrongType.status).toBe(415);

    const missingLength = await putPart(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one/parts/1", {
      method: "PUT",
      headers: mutationHeaders("application/octet-stream", { "X-Lighthouse-Part-Sha256": SHA256 }),
      body: new Blob(["x"]),
    }), { params: Promise.resolve({ uploadId: "upload-one", partNumber: "1" }) });
    expect(missingLength.status).toBe(411);

    const unsafeRevision = await putPart(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one/parts/1", {
      method: "PUT",
      headers: mutationHeaders("application/octet-stream", {
        "Content-Length": "1",
        "X-Lighthouse-Part-Sha256": SHA256,
        "X-Lighthouse-Upload-Revision": "9007199254740992",
      }),
      body: new Blob(["x"]),
    }), { params: Promise.resolve({ uploadId: "upload-one", partNumber: "1" }) });
    expect(unsafeRevision.status).toBe(400);

    harness.getActiveRestrictedGrant.mockResolvedValueOnce(null);
    const locked = await createUpload(new Request("https://lighthouse.test/api/v2/restores/uploads", {
      method: "POST",
      headers: mutationHeaders("application/json", { "Idempotency-Key": "locked" }),
      body: JSON.stringify({ fileName: "archive.zip", sizeBytes: 1, archiveSha256: SHA256 }),
    }));
    expect(locked.status).toBe(403);
    expect(harness.uploadRestorePart).not.toHaveBeenCalled();
    expect(harness.createRestoreUpload).not.toHaveBeenCalled();
  });

  test("resumes, completes, advances, and aborts only through the authenticated owner context", async () => {
    const params = { params: Promise.resolve({ uploadId: "upload-one" }) };
    const loaded = await getUpload(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one"), params);
    expect(loaded.status).toBe(200);
    expect(harness.getRestoreUpload).toHaveBeenCalledWith(expect.anything(), "user-a", "upload-one");

    const completed = await completeUpload(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one/complete", {
      method: "POST",
      headers: mutationHeaders("application/json"),
      body: JSON.stringify({ expectedRevision: 5 }),
    }), params);
    expect(completed.status).toBe(202);
    expect(harness.completeRestoreUpload).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", uploadId: "upload-one", expectedRevision: 5 }));

    const advanced = await advanceUpload(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one/advance", {
      method: "POST",
      headers: mutationHeaders("application/json"),
      body: JSON.stringify({ expectedRevision: 6 }),
    }), params);
    expect(advanced.status).toBe(202);
    expect(harness.advanceRestoreUpload).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", uploadId: "upload-one", expectedRevision: 6 }));

    const aborted = await abortUpload(new Request("https://lighthouse.test/api/v2/restores/uploads/upload-one", {
      method: "DELETE",
      headers: mutationHeaders("application/json"),
      body: JSON.stringify({ expectedRevision: 7 }),
    }), params);
    expect(aborted.status).toBe(202);
    expect(harness.requestRestoreUploadAbort).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", uploadId: "upload-one", expectedRevision: 7 }));
  });
});
