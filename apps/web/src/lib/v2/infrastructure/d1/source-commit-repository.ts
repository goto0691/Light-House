import {
  SOURCE_COMMIT_OPERATION,
  SourceCommitIdempotencyConflictError,
  SourceCommitTransactionError,
  type SourceCommitInput,
  type SourceCommitOutcome,
  type SourceCommitReceipt,
  validateSourceCommitInput,
} from "@/lib/v2/domain/source-commit";

export type D1PreparedStatementBinding = {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatementBinding;
  batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]>;
};

type IdempotencyRow = {
  payload_hash: string;
  response_json: string;
};

function parseReceipt(value: string): SourceCommitReceipt {
  try {
    const parsed = JSON.parse(value) as Partial<SourceCommitReceipt>;
    if (
      typeof parsed.captureId !== "string" ||
      !Array.isArray(parsed.sourceItemIds) ||
      !parsed.sourceItemIds.every((id) => typeof id === "string") ||
      !(typeof parsed.outboxId === "string" || parsed.outboxId === null) ||
      typeof parsed.committedAt !== "string"
    ) {
      throw new Error("Stored source commit receipt has an invalid shape.");
    }
    return parsed as SourceCommitReceipt;
  } catch (error) {
    throw new SourceCommitTransactionError(error);
  }
}

async function findIdempotencyRecord(db: D1DatabaseBinding, input: SourceCommitInput) {
  return db
    .prepare(
      `select payload_hash, response_json
       from v2_idempotency_records
       where user_id = ? and operation = ? and idempotency_key = ?
       limit 1`,
    )
    .bind(input.userId, SOURCE_COMMIT_OPERATION, input.idempotency.key)
    .first<IdempotencyRow>();
}

function replayExisting(row: IdempotencyRow, input: SourceCommitInput): SourceCommitOutcome {
  if (row.payload_hash !== input.idempotency.payloadHash) {
    throw new SourceCommitIdempotencyConflictError();
  }
  return {
    ...parseReceipt(row.response_json),
    disposition: "replayed",
  };
}

export function buildSourceCommitBatch(db: D1DatabaseBinding, input: SourceCommitInput) {
  validateSourceCommitInput(input);

  const receipt: SourceCommitReceipt = {
    captureId: input.capture.id,
    sourceItemIds: input.sourceItems.map((source) => source.id),
    outboxId: input.outbox?.id ?? null,
    committedAt: input.capture.committedAt,
  };

  const statements: D1PreparedStatementBinding[] = [
    db
      .prepare(
        `insert into v2_capture_bundles
           (id, user_id, draft_id, title, body_text, ai_enabled, status, committed_at, created_at)
         values (?, ?, ?, ?, ?, ?, 'source_committed', ?, ?)`,
      )
      .bind(
        input.capture.id,
        input.userId,
        input.capture.draftId,
        input.capture.title ?? null,
        input.capture.bodyText ?? null,
        input.capture.aiEnabled ? 1 : 0,
        input.capture.committedAt,
        input.capture.committedAt,
      ),
  ];

  for (const source of input.sourceItems) {
    statements.push(
      db
        .prepare(
          `insert into v2_source_items
             (id, user_id, capture_id, kind, ordinal, text_content, content_hash, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          source.id,
          input.userId,
          input.capture.id,
          source.kind,
          source.ordinal,
          source.textContent ?? null,
          source.contentHash,
          input.capture.committedAt,
        ),
    );
  }

  for (const link of input.attachmentLinks) {
    statements.push(
      db
        .prepare(
          `insert into v2_source_attachment_links
             (user_id, source_item_id, attachment_id, created_at)
           values (?, ?, ?, ?)`,
        )
        .bind(input.userId, link.sourceItemId, link.attachmentId, input.capture.committedAt),
    );
  }

  if (input.outbox) {
    statements.push(
      db
        .prepare(
          `insert into v2_processing_outbox
             (id, user_id, capture_id, event_type, payload_json, status, created_at)
           values (?, ?, ?, 'analyze', ?, 'pending', ?)`,
        )
        .bind(
          input.outbox.id,
          input.userId,
          input.capture.id,
          JSON.stringify({ captureId: input.capture.id }),
          input.capture.committedAt,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `insert into v2_idempotency_records
           (user_id, operation, idempotency_key, payload_hash, response_json, status_code, created_at)
         values (?, ?, ?, ?, ?, 201, ?)`,
      )
      .bind(
        input.userId,
        SOURCE_COMMIT_OPERATION,
        input.idempotency.key,
        input.idempotency.payloadHash,
        JSON.stringify(receipt),
        input.capture.committedAt,
      ),
  );

  return { receipt, statements };
}

export async function commitSource(db: D1DatabaseBinding, input: SourceCommitInput): Promise<SourceCommitOutcome> {
  validateSourceCommitInput(input);

  const existing = await findIdempotencyRecord(db, input);
  if (existing) {
    return replayExisting(existing, input);
  }

  const { receipt, statements } = buildSourceCommitBatch(db, input);
  try {
    await db.batch(statements);
    return {
      ...receipt,
      disposition: "committed",
    };
  } catch (error) {
    const racedRecord = await findIdempotencyRecord(db, input);
    if (racedRecord) {
      return replayExisting(racedRecord, input);
    }
    throw new SourceCommitTransactionError(error);
  }
}
