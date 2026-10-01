import { ulid } from "ulidx";

export type DocumentStatus = "inbox" | "draft" | "revising" | "finished" | "archived";
export type DocumentPrivacy = "normal" | "sensitive" | "restricted";

export type DocumentRevisionRequest = Readonly<{
  expectedVersion: number;
  expectedRevisionId: string;
  title: string;
  bodyMarkdown: string;
  writtenAt: string | null;
  documentStatus: DocumentStatus;
  privacyLevel: DocumentPrivacy;
}>;

export type PreparedDocumentRevision = DocumentRevisionRequest & Readonly<{
  revisionId: string;
  auditEventId: string;
  contentHash: string;
  payloadHash: string;
  idempotencyKey: string;
  savedAt: string;
}>;

export type DocumentRevisionResult = Readonly<{
  outcome: "saved";
  recordId: string;
  revisionId: string;
  version: number;
  savedAt: string;
  replayed: boolean;
}> | Readonly<{
  outcome: "conflict";
  recordId: string;
  forkRevisionId: string;
  currentRevisionId: string;
  currentVersion: number;
  savedAt: string;
  replayed: boolean;
}>;

export class DocumentRevisionValidationError extends Error {
  readonly code = "document_revision_invalid";
  constructor(message: string) {
    super(message);
    this.name = "DocumentRevisionValidationError";
  }
}

export class DocumentRevisionIdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";
  constructor() {
    super("The idempotency key was already used with different revision content.");
    this.name = "DocumentRevisionIdempotencyConflictError";
  }
}

export class DocumentRevisionWriteError extends Error {
  readonly code = "document_revision_write_failed";
  constructor(cause: unknown) {
    super("The document revision could not be persisted.", { cause });
    this.name = "DocumentRevisionWriteError";
  }
}

export class DocumentRevisionNotFoundError extends Error {
  readonly code = "document_not_found";
  constructor() {
    super("The document was not found.");
    this.name = "DocumentRevisionNotFoundError";
  }
}

export class DocumentRevisionLockedError extends Error {
  readonly code = "restricted_record_locked";
  constructor() {
    super("Recent reauthentication is required to edit this restricted record.");
    this.name = "DocumentRevisionLockedError";
  }
}

export class DocumentRevisionSchemaRequiredError extends Error {
  readonly code = "document_revision_schema_required";
  constructor() {
    super("Apply migration 0030 before editing records with AI analysis enabled.");
    this.name = "DocumentRevisionSchemaRequiredError";
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareDocumentRevision(
  request: DocumentRevisionRequest,
  idempotencyKey: string,
  savedAt = new Date().toISOString(),
): Promise<PreparedDocumentRevision> {
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) {
    throw new DocumentRevisionValidationError("expectedVersion must be a positive integer.");
  }
  if (!request.expectedRevisionId.trim()) throw new DocumentRevisionValidationError("expectedRevisionId is required.");
  if (!request.title.trim()) throw new DocumentRevisionValidationError("title is required.");
  if (!idempotencyKey.trim()) throw new DocumentRevisionValidationError("Idempotency-Key is required.");
  if (request.writtenAt !== null && Number.isNaN(Date.parse(request.writtenAt))) {
    throw new DocumentRevisionValidationError("writtenAt must be null or an ISO timestamp.");
  }
  if (!(["inbox", "draft", "revising", "finished", "archived"] as const).includes(request.documentStatus)) {
    throw new DocumentRevisionValidationError("documentStatus is invalid.");
  }
  if (!(["normal", "sensitive", "restricted"] as const).includes(request.privacyLevel)) {
    throw new DocumentRevisionValidationError("privacyLevel is invalid.");
  }

  const canonicalPayload = JSON.stringify({
    expectedVersion: request.expectedVersion,
    expectedRevisionId: request.expectedRevisionId,
    title: request.title.trim(),
    bodyMarkdown: request.bodyMarkdown,
    writtenAt: request.writtenAt,
    documentStatus: request.documentStatus,
    privacyLevel: request.privacyLevel,
  });
  return {
    ...request,
    title: request.title.trim(),
    revisionId: ulid(),
    auditEventId: ulid(),
    contentHash: `sha256:${await sha256(request.bodyMarkdown)}`,
    payloadHash: `sha256:${await sha256(canonicalPayload)}`,
    idempotencyKey,
    savedAt,
  };
}
