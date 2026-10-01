import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

import {
  LOCAL_CAPTURE_DB_NAME,
  LOCAL_CAPTURE_DB_VERSION,
  type LocalAttachmentBlob,
  type LocalCheckpointResult,
  type LocalCommitReceipt,
  type LocalDraft,
  type LocalDraftCheckpoint,
  type LocalOutboxOperation,
  type LocalSensitiveAttachmentEnvelope,
  type LocalSensitiveDraftEnvelope,
} from "@/lib/v2/offline/local-capture";

type DeviceKeyRow = Readonly<{ id: "capture-aes-gcm-v1"; key: CryptoKey; createdAt: string }>;

interface LocalCaptureSchema extends DBSchema {
  drafts: { key: string; value: LocalDraft; indexes: { "by-updatedAt": string } };
  attachment_blobs: { key: string; value: LocalAttachmentBlob; indexes: { "by-draftId": string } };
  outbox: { key: string; value: LocalOutboxOperation; indexes: { "by-draftId": string; "by-idempotencyKey": string; "by-nextAttemptAt": string } };
  receipts: { key: string; value: LocalCommitReceipt; indexes: { "by-committedAt": string } };
  sensitive_drafts: { key: string; value: LocalSensitiveDraftEnvelope; indexes: { "by-updatedAt": string } };
  sensitive_attachment_blobs: { key: string; value: LocalSensitiveAttachmentEnvelope; indexes: { "by-draftId": string } };
  device_keys: { key: string; value: DeviceKeyRow };
}

const DEVICE_KEY_ID = "capture-aes-gcm-v1" as const;

async function sha256(value: string | Blob) {
  const buffer = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function operationIdFor(draftId: string, localVersion: number) {
  return `commit:${draftId}:${localVersion}`;
}

async function deviceKey(database: IDBPDatabase<LocalCaptureSchema>) {
  const existing = await database.get("device_keys", DEVICE_KEY_ID);
  if (existing) return existing.key;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await database.put("device_keys", { id: DEVICE_KEY_ID, key, createdAt: new Date().toISOString() });
  return key;
}

async function encrypt(key: CryptoKey, bytes: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes as BufferSource);
  return { ciphertext, iv };
}

async function decrypt(key: CryptoKey, ciphertext: ArrayBuffer, iv: Uint8Array) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext));
}

function encodeAttachment(attachment: LocalAttachmentBlob) {
  return attachment.blob.arrayBuffer().then((blobBuffer) => {
    const metadata = new TextEncoder().encode(JSON.stringify({ ...attachment, blob: undefined }));
    const packed = new Uint8Array(4 + metadata.length + blobBuffer.byteLength);
    new DataView(packed.buffer).setUint32(0, metadata.length);
    packed.set(metadata, 4);
    packed.set(new Uint8Array(blobBuffer), 4 + metadata.length);
    return packed;
  });
}

function decodeAttachment(bytes: Uint8Array): LocalAttachmentBlob {
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metadataLength))) as Omit<LocalAttachmentBlob, "blob">;
  const blobBuffer = new Uint8Array(bytes.subarray(4 + metadataLength)).buffer;
  return { ...metadata, blob: new Blob([blobBuffer], { type: metadata.mime }) };
}

export class IndexedDbCaptureStore {
  private databasePromise: Promise<IDBPDatabase<LocalCaptureSchema>> | null = null;

  constructor(private readonly dbName = LOCAL_CAPTURE_DB_NAME) {}

  private open() {
    this.databasePromise ??= openDB<LocalCaptureSchema>(this.dbName, LOCAL_CAPTURE_DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const drafts = database.createObjectStore("drafts", { keyPath: "draftId" });
          drafts.createIndex("by-updatedAt", "updatedAt");
          const attachments = database.createObjectStore("attachment_blobs", { keyPath: "localAttachmentId" });
          attachments.createIndex("by-draftId", "draftId");
          const outbox = database.createObjectStore("outbox", { keyPath: "operationId" });
          outbox.createIndex("by-draftId", "draftId");
          outbox.createIndex("by-idempotencyKey", "idempotencyKey", { unique: true });
          const receipts = database.createObjectStore("receipts", { keyPath: "draftId" });
          receipts.createIndex("by-committedAt", "committedAt");
        }
        if (oldVersion < 2) {
          const outbox = transaction.objectStore("outbox");
          if (!outbox.indexNames.contains("by-nextAttemptAt")) outbox.createIndex("by-nextAttemptAt", "nextAttemptAt");
          const sensitiveDrafts = database.createObjectStore("sensitive_drafts", { keyPath: "draftId" });
          sensitiveDrafts.createIndex("by-updatedAt", "updatedAt");
          const sensitiveAttachments = database.createObjectStore("sensitive_attachment_blobs", { keyPath: "localAttachmentId" });
          sensitiveAttachments.createIndex("by-draftId", "draftId");
          database.createObjectStore("device_keys", { keyPath: "id" });
        }
      },
    });
    return this.databasePromise;
  }

  private async buildRows(input: LocalDraftCheckpoint, previous: LocalDraft | undefined, previousAttachments: readonly LocalAttachmentBlob[]) {
    const timestamp = input.updatedAt ?? new Date().toISOString();
    const attachmentRows: LocalAttachmentBlob[] = [];
    for (const attachment of input.attachments ?? []) {
      const hash = await sha256(attachment.blob);
      const prior = previousAttachments.find((item) => item.localAttachmentId === attachment.localAttachmentId && item.sha256 === hash);
      attachmentRows.push({
        localAttachmentId: attachment.localAttachmentId,
        draftId: input.draftId,
        blob: attachment.blob,
        filename: attachment.filename,
        mime: attachment.blob.type || "application/octet-stream",
        bytes: attachment.blob.size,
        sha256: hash,
        sourceOrder: attachment.sourceOrder,
        createdAt: prior?.createdAt ?? timestamp,
        uploadProgress: prior?.uploadProgress ?? 0,
        uploadStatus: prior?.uploadStatus ?? "pending",
        reservationId: prior?.reservationId ?? null,
        reservationExpiresAt: prior?.reservationExpiresAt ?? null,
        attempt: prior?.attempt ?? 0,
        nextAttemptAt: prior?.nextAttemptAt ?? null,
        lastErrorClass: prior?.lastErrorClass ?? null,
      });
    }
    const attachmentIds = attachmentRows.map((attachment) => attachment.localAttachmentId);
    const payloadHash = await sha256(JSON.stringify({
      title: input.title?.trim() || null,
      bodyMarkdown: input.bodyMarkdown,
      aiEnabled: input.aiEnabled ?? true,
      privacyLevel: input.privacyLevel,
      templateValues: input.templateValues ?? [],
      sourceItems: input.sourceItems ?? [],
      attachments: attachmentRows.map(({ localAttachmentId, sha256: hash, sourceOrder }) => ({ localAttachmentId, sha256: hash, sourceOrder })),
    }));
    const draft: LocalDraft = {
      draftId: input.draftId,
      title: input.title?.trim() || null,
      bodyMarkdown: input.bodyMarkdown,
      aiEnabled: input.aiEnabled ?? true,
      captureChannel: input.captureChannel,
      privacyLevel: input.privacyLevel,
      templateVersionId: input.templateVersionId ?? null,
      templateValues: input.templateValues ?? [],
      attachmentIds,
      sourceItems: input.sourceItems ?? [],
      createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
      capturedAt: input.capturedAt ?? previous?.capturedAt ?? input.createdAt ?? timestamp,
      updatedAt: timestamp,
      clientTimezone: input.clientTimezone,
      localVersion: input.localVersion,
      state: "local_saved",
    };
    const outbox: LocalOutboxOperation = {
      operationId: operationIdFor(input.draftId, input.localVersion),
      draftId: input.draftId,
      idempotencyKey: `local-source:${input.draftId}:${payloadHash}`,
      dependencyOperationIds: attachmentIds.map((attachmentId) => `upload:${attachmentId}`),
      attempt: 0,
      nextAttemptAt: timestamp,
      lastErrorClass: null,
      payloadHash,
      createdAt: timestamp,
      serverReceipt: null,
    };
    return { draft, outbox, attachmentRows };
  }

  async checkpoint(input: LocalDraftCheckpoint, options: { sensitiveOptIn?: boolean } = {}): Promise<LocalCheckpointResult> {
    if (input.privacyLevel === "restricted") {
      await this.purgeDraftPayload(input.draftId);
      return { persisted: false, reason: "restricted" };
    }
    if (input.privacyLevel === "sensitive" && !options.sensitiveOptIn) {
      await this.purgeDraftPayload(input.draftId);
      return { persisted: false, reason: "sensitive_opt_in_required" };
    }
    if (!(await this.getDraft(input.draftId)) && (await this.listDrafts()).length >= 50) {
      return { persisted: false, reason: "draft_limit" };
    }
    return input.privacyLevel === "sensitive" ? this.checkpointSensitive(input) : this.checkpointNormal(input);
  }

  private async checkpointNormal(input: LocalDraftCheckpoint): Promise<LocalCheckpointResult> {
    const database = await this.open();
    const previous = await database.get("drafts", input.draftId);
    const priorAttachments = await database.getAllFromIndex("attachment_blobs", "by-draftId", input.draftId);
    const rows = await this.buildRows(input, previous, priorAttachments);
    const transaction = database.transaction(["drafts", "attachment_blobs", "sensitive_drafts", "sensitive_attachment_blobs", "outbox"], "readwrite");
    for (const key of await transaction.objectStore("attachment_blobs").index("by-draftId").getAllKeys(input.draftId)) {
      if (!rows.draft.attachmentIds.includes(String(key))) await transaction.objectStore("attachment_blobs").delete(key);
    }
    for (const key of await transaction.objectStore("sensitive_attachment_blobs").index("by-draftId").getAllKeys(input.draftId)) await transaction.objectStore("sensitive_attachment_blobs").delete(key);
    await transaction.objectStore("sensitive_drafts").delete(input.draftId);
    for (const attachment of rows.attachmentRows) await transaction.objectStore("attachment_blobs").put(attachment);
    for (const key of await transaction.objectStore("outbox").index("by-draftId").getAllKeys(input.draftId)) await transaction.objectStore("outbox").delete(key);
    await transaction.objectStore("drafts").put(rows.draft);
    await transaction.objectStore("outbox").put(rows.outbox);
    await transaction.done;
    return { persisted: true, draft: rows.draft, outbox: rows.outbox };
  }

  private async checkpointSensitive(input: LocalDraftCheckpoint): Promise<LocalCheckpointResult> {
    const database = await this.open();
    const previous = await this.getDraft(input.draftId);
    const priorAttachments = await this.getDraftAttachments(input.draftId);
    const rows = await this.buildRows(input, previous, priorAttachments);
    const key = await deviceKey(database);
    const draftEncrypted = await encrypt(key, new TextEncoder().encode(JSON.stringify(rows.draft)));
    const attachmentEnvelopes: LocalSensitiveAttachmentEnvelope[] = [];
    for (const attachment of rows.attachmentRows) {
      const encrypted = await encrypt(key, await encodeAttachment(attachment));
      attachmentEnvelopes.push({ localAttachmentId: attachment.localAttachmentId, draftId: input.draftId, ...encrypted, createdAt: attachment.createdAt });
    }
    const envelope: LocalSensitiveDraftEnvelope = {
      draftId: input.draftId,
      ...draftEncrypted,
      attachmentIds: rows.draft.attachmentIds,
      createdAt: rows.draft.createdAt,
      updatedAt: rows.draft.updatedAt,
    };
    const transaction = database.transaction(["drafts", "attachment_blobs", "sensitive_drafts", "sensitive_attachment_blobs", "outbox"], "readwrite");
    for (const keyValue of await transaction.objectStore("attachment_blobs").index("by-draftId").getAllKeys(input.draftId)) await transaction.objectStore("attachment_blobs").delete(keyValue);
    await transaction.objectStore("drafts").delete(input.draftId);
    for (const keyValue of await transaction.objectStore("sensitive_attachment_blobs").index("by-draftId").getAllKeys(input.draftId)) {
      if (!rows.draft.attachmentIds.includes(String(keyValue))) await transaction.objectStore("sensitive_attachment_blobs").delete(keyValue);
    }
    for (const attachment of attachmentEnvelopes) await transaction.objectStore("sensitive_attachment_blobs").put(attachment);
    for (const keyValue of await transaction.objectStore("outbox").index("by-draftId").getAllKeys(input.draftId)) await transaction.objectStore("outbox").delete(keyValue);
    await transaction.objectStore("sensitive_drafts").put(envelope);
    await transaction.objectStore("outbox").put(rows.outbox);
    await transaction.done;
    return { persisted: true, draft: rows.draft, outbox: rows.outbox };
  }

  async getDraft(draftId: string): Promise<LocalDraft | undefined> {
    const database = await this.open();
    const normal = await database.get("drafts", draftId);
    if (normal) return normal;
    const envelope = await database.get("sensitive_drafts", draftId);
    if (!envelope) return undefined;
    const key = await deviceKey(database);
    return JSON.parse(new TextDecoder().decode(await decrypt(key, envelope.ciphertext, envelope.iv))) as LocalDraft;
  }

  async getDraftAttachments(draftId: string): Promise<LocalAttachmentBlob[]> {
    const database = await this.open();
    const normal = await database.getAllFromIndex("attachment_blobs", "by-draftId", draftId);
    if (normal.length) return normal.sort((a, b) => a.sourceOrder - b.sourceOrder);
    const envelopes = await database.getAllFromIndex("sensitive_attachment_blobs", "by-draftId", draftId);
    if (!envelopes.length) return [];
    const key = await deviceKey(database);
    const rows = await Promise.all(envelopes.map(async (envelope) => decodeAttachment(await decrypt(key, envelope.ciphertext, envelope.iv))));
    return rows.sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  async getSyncSnapshot(draftId: string) {
    const database = await this.open();
    const tx = database.transaction(["drafts", "sensitive_drafts", "attachment_blobs", "sensitive_attachment_blobs", "outbox"], "readonly");
    const [normal, envelope, normalAttachments, encryptedAttachments, operations] = await Promise.all([
      tx.objectStore("drafts").get(draftId), tx.objectStore("sensitive_drafts").get(draftId),
      tx.objectStore("attachment_blobs").index("by-draftId").getAll(draftId), tx.objectStore("sensitive_attachment_blobs").index("by-draftId").getAll(draftId),
      tx.objectStore("outbox").index("by-draftId").getAll(draftId),
    ]);
    await tx.done;
    if ((!normal && !envelope) || operations.length !== 1) return null;
    const key = envelope ? await deviceKey(database) : null;
    const draft = normal ?? JSON.parse(new TextDecoder().decode(await decrypt(key!, envelope!.ciphertext, envelope!.iv))) as LocalDraft;
    const attachments = normal ? normalAttachments : await Promise.all(encryptedAttachments.map(async (item) => decodeAttachment(await decrypt(key!, item.ciphertext, item.iv))));
    return { draft, operation: operations[0], attachments: attachments.sort((a, b) => a.sourceOrder - b.sourceOrder) };
  }

  async listDrafts() {
    const database = await this.open();
    const normal = await database.getAllFromIndex("drafts", "by-updatedAt");
    const sensitive = await database.getAllFromIndex("sensitive_drafts", "by-updatedAt");
    const decrypted = await Promise.all(sensitive.map((item) => this.getDraft(item.draftId)));
    return [...normal, ...decrypted.filter((item): item is LocalDraft => Boolean(item))].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  async getOutboxForDraft(draftId: string) {
    return (await this.open()).getAllFromIndex("outbox", "by-draftId", draftId);
  }

  async listDueOutbox(now = new Date().toISOString()) {
    const rows = await (await this.open()).getAllFromIndex("outbox", "by-nextAttemptAt", IDBKeyRange.upperBound(now));
    return rows.sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
  }

  async updateDraftState(draftId: string, state: LocalDraft["state"]) {
    const draft = await this.getDraft(draftId);
    if (!draft) return;
    const database = await this.open();
    const updated = { ...draft, state, updatedAt: new Date().toISOString() };
    if (draft.privacyLevel !== "sensitive") {
      await database.put("drafts", updated);
      return;
    }
    const prior = await database.get("sensitive_drafts", draftId);
    if (!prior) return;
    const encrypted = await encrypt(await deviceKey(database), new TextEncoder().encode(JSON.stringify(updated)));
    await database.put("sensitive_drafts", { ...prior, ...encrypted, updatedAt: updated.updatedAt });
  }

  async updateAttachmentUpload(draftId: string, localAttachmentId: string, patch: Partial<Pick<LocalAttachmentBlob, "uploadProgress" | "uploadStatus" | "reservationId" | "reservationExpiresAt" | "attempt" | "nextAttemptAt" | "lastErrorClass">>) {
    const draft = await this.getDraft(draftId);
    const current = (await this.getDraftAttachments(draftId)).find((item) => item.localAttachmentId === localAttachmentId);
    if (!draft || !current) return;
    const updated = { ...current, ...patch };
    const database = await this.open();
    if (draft.privacyLevel !== "sensitive") {
      await database.put("attachment_blobs", updated);
      return;
    }
    const encrypted = await encrypt(await deviceKey(database), await encodeAttachment(updated));
    await database.put("sensitive_attachment_blobs", { localAttachmentId, draftId, ...encrypted, createdAt: current.createdAt });
  }

  async markOutboxFailure(draftId: string, input: { errorClass: string; nextAttemptAt: string }) {
    const database = await this.open();
    const transaction = database.transaction("outbox", "readwrite");
    const keys = await transaction.store.index("by-draftId").getAllKeys(draftId);
    for (const key of keys) {
      const row = await transaction.store.get(key);
      if (row) await transaction.store.put({ ...row, attempt: row.attempt + 1, lastErrorClass: input.errorClass, nextAttemptAt: input.nextAttemptAt });
    }
    await transaction.done;
  }

  async commitReceipt(receipt: Omit<LocalCommitReceipt, "localPayloadPurgedAt">, expected: { operationId: string; payloadHash: string }) {
    const database = await this.open();
    const transaction = database.transaction(["drafts", "attachment_blobs", "sensitive_drafts", "sensitive_attachment_blobs", "outbox", "receipts"], "readwrite");
    const operations = await transaction.objectStore("outbox").index("by-draftId").getAll(receipt.draftId);
    const matchesSnapshot = operations.length === 1 && operations[0].operationId === expected.operationId && operations[0].payloadHash === expected.payloadHash;
    if (!matchesSnapshot) {
      // A different tab/checkpoint changed the draft while its submitted snapshot
      // was uploading. Keep every byte and require an explicit next submission.
      for (const operation of operations) await transaction.objectStore("outbox").put({ ...operation, nextAttemptAt: "9999-12-31T23:59:59.999Z", lastErrorClass: "submitted_snapshot_changed" });
      const completed: LocalCommitReceipt = { ...receipt, localPayloadPurgedAt: null };
      await transaction.objectStore("receipts").put(completed);
      await transaction.done;
      return completed;
    }
    for (const key of await transaction.objectStore("attachment_blobs").index("by-draftId").getAllKeys(receipt.draftId)) await transaction.objectStore("attachment_blobs").delete(key);
    for (const key of await transaction.objectStore("sensitive_attachment_blobs").index("by-draftId").getAllKeys(receipt.draftId)) await transaction.objectStore("sensitive_attachment_blobs").delete(key);
    for (const key of await transaction.objectStore("outbox").index("by-draftId").getAllKeys(receipt.draftId)) await transaction.objectStore("outbox").delete(key);
    await transaction.objectStore("drafts").delete(receipt.draftId);
    await transaction.objectStore("sensitive_drafts").delete(receipt.draftId);
    const completed: LocalCommitReceipt = { ...receipt, localPayloadPurgedAt: new Date().toISOString() };
    await transaction.objectStore("receipts").put(completed);
    await transaction.done;
    return completed;
  }

  async getReceipt(draftId: string) {
    return (await this.open()).get("receipts", draftId);
  }

  async purgeDraftPayload(draftId: string) {
    const database = await this.open();
    const transaction = database.transaction(["drafts", "attachment_blobs", "sensitive_drafts", "sensitive_attachment_blobs", "outbox"], "readwrite");
    for (const key of await transaction.objectStore("attachment_blobs").index("by-draftId").getAllKeys(draftId)) await transaction.objectStore("attachment_blobs").delete(key);
    for (const key of await transaction.objectStore("sensitive_attachment_blobs").index("by-draftId").getAllKeys(draftId)) await transaction.objectStore("sensitive_attachment_blobs").delete(key);
    for (const key of await transaction.objectStore("outbox").index("by-draftId").getAllKeys(draftId)) await transaction.objectStore("outbox").delete(key);
    await transaction.objectStore("drafts").delete(draftId);
    await transaction.objectStore("sensitive_drafts").delete(draftId);
    await transaction.done;
  }

  close() {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = null;
  }

  async destroyForTest() {
    this.close();
    await deleteDB(this.dbName);
  }
}
