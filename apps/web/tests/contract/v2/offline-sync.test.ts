import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "vitest";

import {
  CaptureSyncError,
  syncDraft,
  type AttachmentReservationResult,
  type CaptureSyncTransport,
  type OfflineCommitReceipt,
} from "@/lib/v2/offline/capture-sync";
import { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import type { LocalAttachmentBlob, LocalDraft } from "@/lib/v2/offline/local-capture";

const stores: IndexedDbCaptureStore[] = [];

function store() {
  const result = new IndexedDbCaptureStore(`lighthouse-sync-${crypto.randomUUID()}`);
  stores.push(result);
  return result;
}

function checkpoint(draftId: string, privacyLevel: "normal" | "sensitive" = "normal") {
  return {
    draftId,
    title: "운동 기록",
    bodyMarkdown: "5km를 달렸다.",
    aiEnabled: true,
    captureChannel: "web" as const,
    privacyLevel,
    clientTimezone: "Asia/Seoul",
    localVersion: 1,
    createdAt: "2026-08-12T13:00:00.000Z",
    attachments: [0, 1, 2].map((index) => ({
      localAttachmentId: `${draftId}:image:${index}`,
      blob: new Blob([`image-${index}`], { type: "image/png" }),
      filename: `run-${index}.png`,
      sourceOrder: index + 1,
    })),
  };
}

class FakeTransport implements CaptureSyncTransport {
  reserveCalls: string[] = [];
  uploadCalls: string[] = [];
  verifyCalls: string[] = [];
  commitCalls: Array<{ draftId: string; idempotencyKey: string }> = [];
  failUploadCall: number | null = null;
  commitError: CaptureSyncError | null = null;

  async reserve(attachment: LocalAttachmentBlob): Promise<AttachmentReservationResult> {
    this.reserveCalls.push(attachment.localAttachmentId);
    const id = `reservation-${this.reserveCalls.length}`;
    return { reservation: { id, expiresAt: "2026-08-12T14:00:00.000Z" }, upload: { url: `https://upload.test/${id}`, method: "PUT", requiredHeaders: {} } };
  }

  async upload(attachment: LocalAttachmentBlob) {
    this.uploadCalls.push(attachment.localAttachmentId);
    if (this.failUploadCall === this.uploadCalls.length) throw new CaptureSyncError("network", "offline", true);
  }

  async verify(reservationId: string) {
    this.verifyCalls.push(reservationId);
  }

  async commit(draft: LocalDraft, _sources: readonly Record<string, unknown>[], idempotencyKey: string): Promise<OfflineCommitReceipt> {
    if (this.commitError) throw this.commitError;
    this.commitCalls.push({ draftId: draft.draftId, idempotencyKey });
    return {
      captureId: `capture-${draft.draftId}`,
      recordId: `record-${draft.draftId}`,
      revisionId: `revision-${draft.draftId}`,
      attachmentCount: draft.attachmentIds.length,
      committedAt: "2026-08-12T13:10:00.000Z",
      aiProcessing: "queued",
      processingStatusUrl: `/api/v2/captures/capture-${draft.draftId}/receipt`,
    };
  }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((item) => item.destroyForTest()));
});

describe("offline outbox sync", () => {
  test.each(["normal", "sensitive"] as const)("preserves a newer %s checkpoint when an older upload receives its receipt", async (privacyLevel) => {
    const captureStore = store();
    const initial = { ...checkpoint("changed-during-upload", privacyLevel), attachments: checkpoint("changed-during-upload").attachments.slice(0, 1) };
    await captureStore.checkpoint(initial, { sensitiveOptIn: true });
    const transport = new FakeTransport();
    let submittedBody = "";
    const originalCommit = transport.commit.bind(transport);
    transport.upload = async () => { await captureStore.checkpoint({ ...initial, localVersion: 2, bodyMarkdown: "전송 중 추가한 변경" }, { sensitiveOptIn: true }); };
    transport.commit = async (draft, sources, key) => { submittedBody = draft.bodyMarkdown; return originalCommit(draft, sources, key); };
    const result = await syncDraft({ store: captureStore, transport, draftId: initial.draftId });
    expect(result).toMatchObject({ outcome: "committed", localChangesRetained: true });
    expect(submittedBody).toBe(initial.bodyMarkdown);
    expect(await captureStore.getDraft(initial.draftId)).toMatchObject({ bodyMarkdown: "전송 중 추가한 변경", localVersion: 2 });
    expect(await captureStore.getDraftAttachments(initial.draftId)).toHaveLength(1);
    expect(await captureStore.listDueOutbox()).toEqual([]);
    expect(await captureStore.getReceipt(initial.draftId)).toMatchObject({ localPayloadPurgedAt: null });
  });
  test("encrypts an opted-in sensitive draft and recovers its text and Blobs after reopen", async () => {
    const dbName = `lighthouse-sensitive-${crypto.randomUUID()}`;
    const captureStore = new IndexedDbCaptureStore(dbName);
    stores.push(captureStore);
    await expect(captureStore.checkpoint(checkpoint("sensitive-resume", "sensitive"), { sensitiveOptIn: true })).resolves.toMatchObject({ persisted: true });
    const request = indexedDB.open(dbName, 2);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["drafts", "attachment_blobs", "sensitive_drafts", "sensitive_attachment_blobs", "device_keys"], "readonly");
    const read = <T>(storeName: string, key: string) => new Promise<T | undefined>((resolve, reject) => {
      const result = transaction.objectStore(storeName).get(key);
      result.onsuccess = () => resolve(result.result as T | undefined);
      result.onerror = () => reject(result.error);
    });
    const [normalDraft, normalAttachment, encryptedDraft, encryptedAttachment, keyRow] = await Promise.all([
      read("drafts", "sensitive-resume"),
      read("attachment_blobs", "sensitive-resume:image:0"),
      read("sensitive_drafts", "sensitive-resume"),
      read("sensitive_attachment_blobs", "sensitive-resume:image:0"),
      read<{ key: CryptoKey }>("device_keys", "capture-aes-gcm-v1"),
    ]);
    expect(normalDraft).toBeUndefined();
    expect(normalAttachment).toBeUndefined();
    expect(JSON.stringify(encryptedDraft)).not.toContain("5km를 달렸다");
    expect(JSON.stringify(encryptedAttachment)).not.toContain("run-0.png");
    expect(keyRow?.key.extractable).toBe(false);
    database.close();
    captureStore.close();
    await expect(captureStore.getDraft("sensitive-resume")).resolves.toMatchObject({ bodyMarkdown: "5km를 달렸다.", privacyLevel: "sensitive" });
    const attachments = await captureStore.getDraftAttachments("sensitive-resume");
    expect(attachments).toHaveLength(3);
    expect(await attachments[2].blob.text()).toBe("image-2");
  });

  test("resumes after restart at the first unverified file and commits exactly once", async () => {
    const captureStore = store();
    await captureStore.checkpoint(checkpoint("resume-files"));
    const transport = new FakeTransport();
    transport.failUploadCall = 2;
    await expect(syncDraft({ store: captureStore, transport, draftId: "resume-files", now: new Date("2026-08-12T13:01:00.000Z"), random: () => 0 })).resolves.toMatchObject({ outcome: "waiting_network" });
    expect((await captureStore.getDraftAttachments("resume-files")).map((item) => item.uploadStatus)).toEqual(["verified", "pending", "pending"]);

    captureStore.close();
    transport.failUploadCall = null;
    await expect(syncDraft({ store: captureStore, transport, draftId: "resume-files", now: new Date("2026-08-12T13:02:00.000Z"), random: () => 0 })).resolves.toMatchObject({ outcome: "committed" });
    expect(transport.reserveCalls.filter((id) => id.endsWith(":image:0"))).toHaveLength(1);
    expect(transport.commitCalls).toHaveLength(1);
    await expect(captureStore.getDraft("resume-files")).resolves.toBeUndefined();
    await expect(captureStore.getReceipt("resume-files")).resolves.toMatchObject({ captureId: "capture-resume-files" });
  });

  test("coalesces concurrent foreground triggers into one upload and one commit", async () => {
    const captureStore = store();
    await captureStore.checkpoint({ ...checkpoint("concurrent-sync"), attachments: checkpoint("concurrent-sync").attachments.slice(0, 1) });
    const transport = new FakeTransport();
    const results = await Promise.all(Array.from({ length: 10 }, () => syncDraft({ store: captureStore, transport, draftId: "concurrent-sync" })));
    expect(results.every((result) => result.outcome === "committed")).toBe(true);
    expect(transport.reserveCalls).toHaveLength(1);
    expect(transport.uploadCalls).toHaveLength(1);
    expect(transport.commitCalls).toHaveLength(1);
  });

  test("keeps an authentication-interrupted payload without retrying or purging it", async () => {
    const captureStore = store();
    await captureStore.checkpoint({ ...checkpoint("auth-pause"), attachments: [] });
    const transport = new FakeTransport();
    transport.commitError = new CaptureSyncError("authentication", "login required", false);
    await expect(syncDraft({ store: captureStore, transport, draftId: "auth-pause", now: new Date("2026-08-12T13:01:00.000Z") })).resolves.toMatchObject({ outcome: "authentication_required" });
    await expect(captureStore.getDraft("auth-pause")).resolves.toMatchObject({ state: "waiting_network" });
    await expect(captureStore.getOutboxForDraft("auth-pause")).resolves.toHaveLength(1);
    await expect(captureStore.getReceipt("auth-pause")).resolves.toBeUndefined();
  });
});
