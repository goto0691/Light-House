export const SOURCE_COMMIT_OPERATION = "capture.commit";

export type SourceKind = "text" | "image" | "audio" | "file" | "transcript";

export type SourceCommitInput = {
  userId: string;
  capture: {
    id: string;
    draftId: string;
    title?: string | null;
    bodyText?: string | null;
    aiEnabled: boolean;
    committedAt: string;
  };
  sourceItems: Array<{
    id: string;
    kind: SourceKind;
    ordinal: number;
    textContent?: string | null;
    contentHash: string;
  }>;
  attachmentLinks: Array<{
    sourceItemId: string;
    attachmentId: string;
  }>;
  outbox?: {
    id: string;
  };
  idempotency: {
    key: string;
    payloadHash: string;
  };
};

export type SourceCommitReceipt = {
  captureId: string;
  sourceItemIds: string[];
  outboxId: string | null;
  committedAt: string;
};

export type SourceCommitOutcome = SourceCommitReceipt & {
  disposition: "committed" | "replayed";
};

export class SourceCommitValidationError extends Error {
  readonly code = "source_commit_invalid";

  constructor(message: string) {
    super(message);
    this.name = "SourceCommitValidationError";
  }
}

export class SourceCommitIdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";

  constructor() {
    super("The idempotency key was already used with a different payload.");
    this.name = "SourceCommitIdempotencyConflictError";
  }
}

export class SourceCommitTransactionError extends Error {
  readonly code = "source_commit_transaction_failed";

  constructor(cause: unknown) {
    super("The source commit transaction failed.", { cause });
    this.name = "SourceCommitTransactionError";
  }
}

function requireValue(value: string, label: string) {
  if (!value.trim()) {
    throw new SourceCommitValidationError(`${label} is required.`);
  }
}

export function validateSourceCommitInput(input: SourceCommitInput) {
  requireValue(input.userId, "userId");
  requireValue(input.capture.id, "capture.id");
  requireValue(input.capture.draftId, "capture.draftId");
  requireValue(input.capture.committedAt, "capture.committedAt");
  requireValue(input.idempotency.key, "idempotency.key");
  requireValue(input.idempotency.payloadHash, "idempotency.payloadHash");

  if (input.sourceItems.length === 0) {
    throw new SourceCommitValidationError("At least one source item is required.");
  }

  const sourceIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const source of input.sourceItems) {
    requireValue(source.id, "sourceItem.id");
    requireValue(source.contentHash, "sourceItem.contentHash");
    if (!Number.isInteger(source.ordinal) || source.ordinal < 0) {
      throw new SourceCommitValidationError("sourceItem.ordinal must be a non-negative integer.");
    }
    if (sourceIds.has(source.id) || ordinals.has(source.ordinal)) {
      throw new SourceCommitValidationError("Source IDs and ordinals must be unique within a capture.");
    }
    sourceIds.add(source.id);
    ordinals.add(source.ordinal);
  }

  const attachmentIds = new Set<string>();
  for (const link of input.attachmentLinks) {
    requireValue(link.attachmentId, "attachmentLink.attachmentId");
    if (!sourceIds.has(link.sourceItemId)) {
      throw new SourceCommitValidationError("Every attachment link must reference an input source item.");
    }
    if (attachmentIds.has(link.attachmentId)) {
      throw new SourceCommitValidationError("An attachment can only be linked once in a source commit.");
    }
    attachmentIds.add(link.attachmentId);
  }

  if (input.capture.aiEnabled && !input.outbox?.id) {
    throw new SourceCommitValidationError("AI-enabled source commits require an outbox ID.");
  }
  if (!input.capture.aiEnabled && input.outbox) {
    throw new SourceCommitValidationError("AI-disabled source commits cannot create an outbox event.");
  }
}
