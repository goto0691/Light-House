import type { LocalAttachmentBlob, LocalCommitReceipt, LocalDraft } from "@/lib/v2/offline/local-capture";
import type { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import { serializeLocalSourceItems, type OrderedCaptureCommitSource } from "@/lib/v2/offline/serialize-source-items";

export type OfflineCommitReceipt = Readonly<{
  captureId: string;
  recordId: string;
  revisionId: string;
  attachmentCount: number;
  committedAt: string;
  aiProcessing: "queued" | "disabled";
  processingStatusUrl: string;
}>;

export type AttachmentReservationResult = Readonly<{
  reservation: { id: string; expiresAt: string };
  upload: { url: string; method: "PUT"; requiredHeaders: Record<string, string> };
}>;

export interface CaptureSyncTransport {
  reserve(attachment: LocalAttachmentBlob): Promise<AttachmentReservationResult>;
  upload(attachment: LocalAttachmentBlob, reservation: AttachmentReservationResult): Promise<void>;
  verify(reservationId: string): Promise<void>;
  commit(draft: LocalDraft, sources: readonly Record<string, unknown>[], idempotencyKey: string): Promise<OfflineCommitReceipt>;
}

export class CaptureSyncError extends Error {
  constructor(
    readonly code: "network" | "authentication" | "retryable_server" | "validation" | "conflict",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CaptureSyncError";
  }
}

async function responseJson<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (response.ok) return body;
  const message = body.error?.message || `Request failed with ${response.status}.`;
  if (response.status === 401 || response.status === 403) throw new CaptureSyncError("authentication", message, false);
  if (response.status === 409) throw new CaptureSyncError("conflict", message, false);
  if (response.status === 408 || response.status === 429 || response.status >= 500) throw new CaptureSyncError("retryable_server", message, true);
  throw new CaptureSyncError("validation", message, false);
}

async function fetchOrNetwork(input: RequestInfo | URL, init: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new CaptureSyncError("network", error instanceof Error ? error.message : "Network unavailable.", true);
  }
}

export class BrowserCaptureSyncTransport implements CaptureSyncTransport {
  async reserve(attachment: LocalAttachmentBlob) {
    const response = await fetchOrNetwork("/api/v2/attachments/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: attachment.filename, mimeType: attachment.mime, sizeBytes: attachment.bytes, sha256: attachment.sha256 }),
    });
    return responseJson<AttachmentReservationResult>(response);
  }

  async upload(attachment: LocalAttachmentBlob, reservation: AttachmentReservationResult) {
    const response = await fetchOrNetwork(reservation.upload.url, {
      method: reservation.upload.method,
      headers: reservation.upload.requiredHeaders,
      body: attachment.blob,
    });
    if (!response.ok) {
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw new CaptureSyncError("retryable_server", `${attachment.filename} upload failed.`, true);
      throw new CaptureSyncError("validation", `${attachment.filename} upload was rejected.`, false);
    }
  }

  async verify(reservationId: string) {
    const response = await fetchOrNetwork(`/api/v2/attachments/${encodeURIComponent(reservationId)}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await responseJson(response);
  }

  async commit(draft: LocalDraft, sources: readonly Record<string, unknown>[], idempotencyKey: string) {
    const response = await fetchOrNetwork("/api/v2/captures/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        draftId: draft.draftId,
        channel: draft.captureChannel,
        title: draft.title,
        bodyMarkdown: draft.bodyMarkdown,
        aiEnabled: draft.aiEnabled,
        clientTimezone: draft.clientTimezone,
        privacyLevel: draft.privacyLevel,
        capturedAt: draft.capturedAt,
        sources,
        template: draft.templateVersionId ? {
          templateVersionId: draft.templateVersionId,
          appliedAt: draft.createdAt,
          inputs: draft.templateValues,
        } : null,
      }),
    });
    return responseJson<OfflineCommitReceipt>(response);
  }
}

function sourceKind(attachment: LocalAttachmentBlob) {
  if (attachment.mime.startsWith("image/")) return "image";
  if (attachment.mime.startsWith("audio/")) return "audio";
  if (attachment.mime.startsWith("video/")) return "video";
  return "document";
}

function retryAt(attempt: number, now: Date, random: () => number) {
  const base = Math.min(15 * 60_000, 15_000 * 2 ** Math.min(6, attempt));
  return new Date(now.getTime() + base + Math.floor(base * 0.2 * random())).toISOString();
}

const inFlight = new Map<string, Promise<SyncDraftResult>>();

export type SyncDraftResult = Readonly<
  | { outcome: "idle" }
  | { outcome: "committed"; receipt: OfflineCommitReceipt; localChangesRetained: boolean }
  | { outcome: "waiting_network" | "authentication_required" | "blocked" | "conflict"; error: CaptureSyncError }
>;

export function syncDraft(input: { store: IndexedDbCaptureStore; transport: CaptureSyncTransport; draftId: string; now?: Date; random?: () => number }): Promise<SyncDraftResult> {
  const current = inFlight.get(input.draftId);
  if (current) return current;
  const promise = syncDraftInternal(input).finally(() => inFlight.delete(input.draftId));
  inFlight.set(input.draftId, promise);
  return promise;
}

async function syncDraftInternal(input: { store: IndexedDbCaptureStore; transport: CaptureSyncTransport; draftId: string; now?: Date; random?: () => number }): Promise<SyncDraftResult> {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const snapshot = await input.store.getSyncSnapshot(input.draftId);
  if (!snapshot) return { outcome: "idle" };
  const { draft, operation, attachments } = snapshot;
  if (draft.privacyLevel === "restricted") {
    await input.store.purgeDraftPayload(draft.draftId);
    return { outcome: "idle" };
  }

  try {
    await input.store.updateDraftState(draft.draftId, draft.attachmentIds.length ? "uploading" : "ready_to_commit");
    const uploadedSources: OrderedCaptureCommitSource[] = [];
    for (const attachment of attachments) {
      let reservationId = attachment.reservationId;
      if (attachment.uploadStatus !== "verified" || !reservationId) {
        const reservation = await input.transport.reserve(attachment);
        reservationId = reservation.reservation.id;
        await input.store.updateAttachmentUpload(draft.draftId, attachment.localAttachmentId, {
          uploadStatus: "uploading",
          reservationId,
          reservationExpiresAt: reservation.reservation.expiresAt,
          attempt: attachment.attempt + 1,
          lastErrorClass: null,
        });
        await input.transport.upload(attachment, reservation);
        await input.transport.verify(reservationId);
        await input.store.updateAttachmentUpload(draft.draftId, attachment.localAttachmentId, {
          uploadStatus: "verified",
          uploadProgress: 100,
          reservationId,
          reservationExpiresAt: reservation.reservation.expiresAt,
          nextAttemptAt: null,
          lastErrorClass: null,
        });
      }
      uploadedSources.push({
        sourceOrder: attachment.sourceOrder,
        kind: sourceKind(attachment),
        contentHash: attachment.sha256,
        attachmentId: reservationId,
        metadata: { filename: attachment.filename, mimeType: attachment.mime, sizeBytes: attachment.bytes },
      });
    }
    await input.store.updateDraftState(draft.draftId, "committing");
    const sources = await serializeLocalSourceItems(draft.sourceItems, uploadedSources);
    const receipt = await input.transport.commit(draft, sources, operation.idempotencyKey);
    const localReceipt = await input.store.commitReceipt({
      draftId: draft.draftId,
      captureId: receipt.captureId,
      committedAt: receipt.committedAt,
      processingStatusUrl: receipt.processingStatusUrl,
      attachmentVerification: attachments.length ? "verified" : "none",
    }, { operationId: operation.operationId, payloadHash: operation.payloadHash });
    return { outcome: "committed", receipt, localChangesRetained: localReceipt.localPayloadPurgedAt === null };
  } catch (caught) {
    const error = caught instanceof CaptureSyncError ? caught : new CaptureSyncError("validation", caught instanceof Error ? caught.message : "Capture sync failed.", false);
    const attachments = await input.store.getDraftAttachments(draft.draftId);
    const active = attachments.find((attachment) => attachment.uploadStatus === "uploading");
    if (active) await input.store.updateAttachmentUpload(draft.draftId, active.localAttachmentId, { uploadStatus: error.retryable ? "pending" : "blocked", lastErrorClass: error.code });
    await input.store.markOutboxFailure(draft.draftId, { errorClass: error.code, nextAttemptAt: retryAt(operation.attempt, now, random) });
    if (error.code === "conflict") {
      await input.store.updateDraftState(draft.draftId, "conflict");
      return { outcome: "conflict", error };
    }
    if (error.code === "authentication") {
      await input.store.updateDraftState(draft.draftId, "waiting_network");
      return { outcome: "authentication_required", error };
    }
    if (error.retryable) {
      await input.store.updateDraftState(draft.draftId, "waiting_network");
      return { outcome: "waiting_network", error };
    }
    await input.store.updateDraftState(draft.draftId, "partial_blocked");
    return { outcome: "blocked", error };
  }
}

export async function drainOutbox(input: { store: IndexedDbCaptureStore; transport: CaptureSyncTransport; now?: Date; concurrency?: number; excludeDraftIds?: readonly string[] }) {
  const excluded = new Set(input.excludeDraftIds ?? []);
  const due = (await input.store.listDueOutbox((input.now ?? new Date()).toISOString())).filter((operation) => !excluded.has(operation.draftId));
  const results: SyncDraftResult[] = [];
  const queue = [...due];
  const workers = Array.from({ length: Math.max(1, Math.min(3, input.concurrency ?? 2)) }, async () => {
    while (queue.length) {
      const operation = queue.shift();
      if (!operation) return;
      results.push(await syncDraft({ ...input, draftId: operation.draftId }));
    }
  });
  await Promise.all(workers);
  return results;
}

export function receiptToLocal(receipt: OfflineCommitReceipt, draftId: string): Omit<LocalCommitReceipt, "localPayloadPurgedAt"> {
  return {
    draftId,
    captureId: receipt.captureId,
    committedAt: receipt.committedAt,
    processingStatusUrl: receipt.processingStatusUrl,
    attachmentVerification: receipt.attachmentCount ? "verified" : "none",
  };
}
