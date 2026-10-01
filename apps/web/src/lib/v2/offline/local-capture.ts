export const LOCAL_CAPTURE_DB_NAME = "lighthouse_capture_v1";
export const LOCAL_CAPTURE_DB_VERSION = 2;

export type LocalPrivacyLevel = "normal" | "sensitive" | "restricted";
export type LocalCaptureChannel = "web" | "mobile_share" | "clipboard";
export type LocalDraftState =
  | "editing"
  | "local_saved"
  | "waiting_network"
  | "uploading"
  | "partial_blocked"
  | "ready_to_commit"
  | "committing"
  | "conflict";

export type LocalSourceItem = Readonly<{
  sourceId: string;
  order: number;
  kind: "title" | "text" | "url" | "attachment";
  // A manual-link URL source stores pasted original text here; its URL lives in metadata.
  // Legacy shared URL sources without metadata retain the URL itself as their value.
  value: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type LocalDraft = Readonly<{
  draftId: string;
  title: string | null;
  bodyMarkdown: string;
  aiEnabled: boolean;
  captureChannel: LocalCaptureChannel;
  privacyLevel: LocalPrivacyLevel;
  templateVersionId: string | null;
  templateValues: readonly Readonly<{
    itemKey: string;
    valueKind: "text" | "number" | "boolean" | "date" | "rating" | "json";
    value: unknown;
    blankState: "answered" | "unanswered" | "unknown" | "not_applicable" | "withheld";
    inputOrder: number;
    clientTimestamp: string;
  }>[];
  attachmentIds: readonly string[];
  sourceItems: readonly LocalSourceItem[];
  createdAt: string;
  capturedAt: string;
  updatedAt: string;
  clientTimezone: string;
  localVersion: number;
  state: LocalDraftState;
}>;

export type LocalAttachmentBlob = Readonly<{
  localAttachmentId: string;
  draftId: string;
  blob: Blob;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  sourceOrder: number;
  createdAt: string;
  uploadProgress: number;
  uploadStatus: "pending" | "uploading" | "verified" | "blocked";
  reservationId: string | null;
  reservationExpiresAt: string | null;
  attempt: number;
  nextAttemptAt: string | null;
  lastErrorClass: string | null;
}>;

export type LocalOutboxOperation = Readonly<{
  operationId: string;
  draftId: string;
  idempotencyKey: string;
  dependencyOperationIds: readonly string[];
  attempt: number;
  nextAttemptAt: string;
  lastErrorClass: string | null;
  payloadHash: string;
  createdAt: string;
  serverReceipt: string | null;
}>;

export type LocalCommitReceipt = Readonly<{
  draftId: string;
  captureId: string;
  committedAt: string;
  processingStatusUrl: string;
  attachmentVerification: "verified" | "partial" | "none";
  localPayloadPurgedAt: string | null;
}>;

export type LocalAttachmentInput = Readonly<{
  localAttachmentId: string;
  blob: Blob;
  filename: string;
  sourceOrder: number;
}>;

export type LocalDraftCheckpoint = Readonly<{
  draftId: string;
  title?: string | null;
  bodyMarkdown: string;
  aiEnabled?: boolean;
  captureChannel: LocalCaptureChannel;
  privacyLevel: LocalPrivacyLevel;
  templateVersionId?: string | null;
  templateValues?: LocalDraft["templateValues"];
  sourceItems?: readonly LocalSourceItem[];
  attachments?: readonly LocalAttachmentInput[];
  createdAt?: string;
  capturedAt?: string;
  updatedAt?: string;
  clientTimezone: string;
  localVersion: number;
}>;

export type LocalCheckpointResult =
  | Readonly<{ persisted: true; draft: LocalDraft; outbox: LocalOutboxOperation }>
  | Readonly<{ persisted: false; reason: "restricted" | "sensitive_opt_in_required" | "draft_limit" }>;

export type LocalSensitiveDraftEnvelope = Readonly<{
  draftId: string;
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  attachmentIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;

export type LocalSensitiveAttachmentEnvelope = Readonly<{
  localAttachmentId: string;
  draftId: string;
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  createdAt: string;
}>;
