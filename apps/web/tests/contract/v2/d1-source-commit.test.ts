import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import {
  SourceCommitIdempotencyConflictError,
  SourceCommitTransactionError,
  type SourceCommitInput,
} from "@/lib/v2/domain/source-commit";
import {
  buildSourceCommitBatch,
  commitSource,
  type D1DatabaseBinding,
  type D1PreparedStatementBinding,
} from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestPreparedStatement = D1PreparedStatementBinding & {
  run(): Promise<unknown>;
};

type TestD1Database = D1DatabaseBinding & {
  exec(query: string): Promise<unknown>;
  prepare(query: string): TestPreparedStatement;
};

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const schemaPath = fileURLToPath(new URL("../../fixtures/v2/source-commit-spike.sql", import.meta.url));

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1Database }>>>;
let db: TestD1Database;

function createInput(suffix = "01", aiEnabled = true): SourceCommitInput {
  return {
    userId: "user-a",
    capture: {
      id: `capture-${suffix}`,
      draftId: `draft-${suffix}`,
      title: "오래 기억하고 싶은 장면",
      bodyText: "인물 사이의 침묵이 오래 남았다.",
      aiEnabled,
      committedAt: "2026-08-12T08:00:00.000Z",
    },
    sourceItems: [
      {
        id: `source-text-${suffix}`,
        kind: "text",
        ordinal: 0,
        textContent: "인물 사이의 침묵이 오래 남았다.",
        contentHash: `sha256-text-${suffix}`,
      },
      {
        id: `source-image-${suffix}`,
        kind: "image",
        ordinal: 1,
        contentHash: `sha256-image-${suffix}`,
      },
    ],
    attachmentLinks: [
      {
        sourceItemId: `source-image-${suffix}`,
        attachmentId: `attachment-${suffix}`,
      },
    ],
    outbox: aiEnabled ? { id: `outbox-${suffix}` } : undefined,
    idempotency: {
      key: `idem-${suffix}`,
      payloadHash: `payload-sha256-${suffix}`,
    },
  };
}

async function resetTables() {
  await db.exec(`
    DELETE FROM v2_idempotency_records;
    DELETE FROM v2_processing_outbox;
    DELETE FROM v2_source_attachment_links;
    DELETE FROM v2_source_items;
    DELETE FROM v2_capture_bundles;
    DELETE FROM v2_attachment_reservations;
  `);
}

async function seedAttachment(input: SourceCommitInput, status: "verified" | "uploaded" = "verified") {
  const attachment = input.attachmentLinks[0];
  await db
    .prepare(
      `insert into v2_attachment_reservations
         (id, user_id, status, object_key, content_hash, created_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      attachment.attachmentId,
      input.userId,
      status,
      `private/${input.userId}/${attachment.attachmentId}`,
      `sha256-${attachment.attachmentId}`,
      input.capture.committedAt,
    )
    .run();
}

async function count(table: string) {
  const row = await db.prepare(`select count(*) as value from ${table}`).first<{ value: number }>();
  return row?.value ?? -1;
}

async function expectCommitRows(expected: {
  captures: number;
  sources: number;
  links: number;
  outbox: number;
  idempotency: number;
}) {
  await expect(count("v2_capture_bundles")).resolves.toBe(expected.captures);
  await expect(count("v2_source_items")).resolves.toBe(expected.sources);
  await expect(count("v2_source_attachment_links")).resolves.toBe(expected.links);
  await expect(count("v2_processing_outbox")).resolves.toBe(expected.outbox);
  await expect(count("v2_idempotency_records")).resolves.toBe(expected.idempotency);
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1Database }>({
    configPath,
    persist: false,
    remoteBindings: false,
  });
  db = platform.env.DB;
  const schema = await readFile(schemaPath, "utf8");
  for (const statement of schema.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
});

beforeEach(resetTables);

afterAll(async () => {
  await platform.dispose();
});

describe("D1 binding source commit transaction", () => {
  test("commits capture, sources, verified attachment, outbox, and receipt atomically", async () => {
    const input = createInput();
    await seedAttachment(input);

    await expect(commitSource(db, input)).resolves.toEqual({
      captureId: input.capture.id,
      sourceItemIds: input.sourceItems.map((source) => source.id),
      outboxId: input.outbox?.id,
      committedAt: input.capture.committedAt,
      disposition: "committed",
    });
    await expectCommitRows({ captures: 1, sources: 2, links: 1, outbox: 1, idempotency: 1 });

    const payload = await db
      .prepare("select payload_json from v2_processing_outbox where id = ?")
      .bind(input.outbox?.id)
      .first<{ payload_json: string }>();
    expect(payload?.payload_json).toBe(JSON.stringify({ captureId: input.capture.id }));
    expect(payload?.payload_json).not.toContain(input.capture.bodyText ?? "");
  });

  test("resolves twenty concurrent retries to one commit without duplicate rows", async () => {
    const input = createInput("retry");
    await seedAttachment(input);

    const outcomes = await Promise.all(Array.from({ length: 20 }, () => commitSource(db, input)));
    expect(outcomes).toHaveLength(20);
    expect(outcomes.every((outcome) => outcome.captureId === input.capture.id)).toBe(true);
    expect(outcomes.filter((outcome) => outcome.disposition === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.disposition === "replayed")).toHaveLength(19);

    await expectCommitRows({ captures: 1, sources: 2, links: 1, outbox: 1, idempotency: 1 });
  }, 15_000);

  test("rejects reuse of an idempotency key with a different payload hash", async () => {
    const input = createInput("conflict");
    await seedAttachment(input);
    await commitSource(db, input);

    const conflicting = {
      ...input,
      idempotency: { ...input.idempotency, payloadHash: "different-payload" },
    };
    await expect(commitSource(db, conflicting)).rejects.toBeInstanceOf(SourceCommitIdempotencyConflictError);
    await expectCommitRows({ captures: 1, sources: 2, links: 1, outbox: 1, idempotency: 1 });
  });

  test("does not create an outbox event when AI processing is disabled", async () => {
    const input = createInput("ai-off", false);
    await seedAttachment(input);
    await expect(commitSource(db, input)).resolves.toMatchObject({ outboxId: null, disposition: "committed" });
    await expectCommitRows({ captures: 1, sources: 2, links: 1, outbox: 0, idempotency: 1 });
  });

  test("rolls back every prior statement when failure is injected at each batch boundary", async () => {
    const input = createInput("fault");
    await seedAttachment(input);
    const { statements } = buildSourceCommitBatch(db, input);

    for (let afterStatement = 0; afterStatement < statements.length; afterStatement += 1) {
      const fault = db.prepare("insert into v2_missing_failure_target (id) values ('forced')");
      const injected = [
        ...statements.slice(0, afterStatement + 1),
        fault,
        ...statements.slice(afterStatement + 1),
      ];

      await expect(db.batch(injected)).rejects.toThrow();
      await expectCommitRows({ captures: 0, sources: 0, links: 0, outbox: 0, idempotency: 0 });
    }
  });

  test("rejects an unverified attachment and rolls back the whole source commit", async () => {
    const input = createInput("unverified");
    await seedAttachment(input, "uploaded");

    await expect(commitSource(db, input)).rejects.toBeInstanceOf(SourceCommitTransactionError);
    await expectCommitRows({ captures: 0, sources: 0, links: 0, outbox: 0, idempotency: 0 });
    await expect(count("v2_attachment_reservations")).resolves.toBe(1);
  });
});
