import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { DocumentRevisionIdempotencyConflictError, DocumentRevisionLockedError, DocumentRevisionSchemaRequiredError, prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrations = [
  fileURLToPath(new URL("../../../../../migrations/0006_v2_source_and_document_foundation.sql", import.meta.url)),
  fileURLToPath(new URL("../../../../../migrations/0007_v2_document_authoring.sql", import.meta.url)),
];
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
let db: TestD1;

async function applySqlFile(path: string) {
  const sql = await readFile(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function reset() {
  await db.exec(`
    delete from v2_idempotency_records; delete from v2_audit_events; delete from v2_processing_runs;
    delete from v2_processing_jobs; delete from v2_processing_outbox; delete from v2_deletion_tombstones;
    delete from v2_document_source_links; delete from v2_document_revisions; delete from v2_documents;
    delete from v2_objects; delete from v2_source_attachment_links; delete from v2_source_items;
    delete from v2_attachment_reservations; delete from v2_capture_bundles;
  `);
}

async function count(table: string, where = "") {
  const row = await db.prepare(`select count(*) as value from ${table} ${where}`).first<{ value: number }>();
  return row?.value ?? -1;
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a'), ('user-b');`);
  for (const migration of migrations) await applySqlFile(migration);
});
beforeEach(reset);
afterAll(async () => platform.dispose());

async function seed(suffix = "one", privacyLevel: "normal" | "sensitive" | "restricted" = "normal") {
  const prepared = await prepareCaptureCommit({
    draftId: `draft-${suffix}`,
    channel: "web",
    title: `기록 ${suffix}`,
    bodyMarkdown: `# 원본 ${suffix}\n\n변하지 않는 원문이다.`,
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel,
    capturedAt: "2026-08-12T09:00:00.000Z",
  }, `capture-${suffix}`, "2026-08-12T09:00:01.000Z");
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(prepared);
  return prepared;
}

function edit(input: Awaited<ReturnType<typeof seed>>, overrides: Partial<Parameters<typeof prepareDocumentRevision>[0]> = {}) {
  return prepareDocumentRevision({
    expectedVersion: 1,
    expectedRevisionId: input.revisionId,
    title: `수정한 ${input.title}`,
    bodyMarkdown: `${input.bodyMarkdown}\n\n사용자가 덧붙인 문장.`,
    writtenAt: "2026-08-11T15:00:00.000Z",
    documentStatus: "revising",
    privacyLevel: input.privacyLevel,
    ...overrides,
  }, `revise-${crypto.randomUUID()}`, "2026-08-12T10:00:00.000Z");
}

describe("I2 document authoring repository", () => {
  test("requires a grant for restricted edits and rejects replay receipts after relocking", async () => {
    const initial = await seed("locked-edit", "restricted");
    const prepared = await edit(initial, { privacyLevel: "normal" });
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    await expect(repository.saveRevision(initial.objectId, prepared)).rejects.toBeInstanceOf(DocumentRevisionLockedError);
    await expect(count("v2_document_revisions")).resolves.toBe(1);
    const saved = await repository.saveRevision(initial.objectId, prepared, { restrictedUnlocked: true });
    expect(saved.outcome).toBe("saved");
    await db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(initial.objectId).run();
    await expect(repository.saveRevision(initial.objectId, prepared)).rejects.toBeInstanceOf(DocumentRevisionLockedError);
    await expect(count("v2_document_revisions")).resolves.toBe(2);
  });

  test("fences a record that becomes restricted between the initial read and transaction", async () => {
    const initial = await seed("restricted-race");
    const prepared = await edit(initial);
    let raced = false;
    const racing: D1DatabaseBinding = {
      prepare: (query) => db.prepare(query),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(initial.objectId).run();
        }
        return db.batch(statements);
      },
    };
    await expect(new D1DocumentAuthoringRepository(racing, "user-a").saveRevision(initial.objectId, prepared)).rejects.toBeInstanceOf(DocumentRevisionLockedError);
    await expect(count("v2_document_revisions")).resolves.toBe(1);
    await expect(count("v2_source_items")).resolves.toBe(1);
    await expect(count("v2_processing_outbox")).resolves.toBe(0);
  });

  test("can lock a normal record while preserving reauthentication on the next edit", async () => {
    const initial = await seed("new-lock");
    const prepared = await edit(initial, { privacyLevel: "restricted" });
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    await expect(repository.saveRevision(initial.objectId, prepared)).resolves.toMatchObject({ outcome: "saved" });
    await expect(repository.saveRevision(initial.objectId, prepared)).rejects.toBeInstanceOf(DocumentRevisionLockedError);
  });

  test("keeps an AI-enabled edit untouched until the revision outbox migration is applied", async () => {
    const initial = await seed("pre-0030");
    await db.prepare("update v2_capture_bundles set ai_enabled=1 where id=?").bind(initial.captureId).run();
    const prepared = await edit(initial);
    await expect(new D1DocumentAuthoringRepository(db, "user-a").saveRevision(initial.objectId, prepared)).rejects.toBeInstanceOf(DocumentRevisionSchemaRequiredError);
    await expect(count("v2_document_revisions")).resolves.toBe(1);
    await expect(count("v2_source_items")).resolves.toBe(1);
  });

  test("creates a new immutable revision and atomically advances body, metadata, version, and audit", async () => {
    const initial = await seed();
    const prepared = await edit(initial);
    const result = await new D1DocumentAuthoringRepository(db, "user-a").saveRevision(initial.objectId, prepared);
    expect(result).toMatchObject({ outcome: "saved", revisionId: prepared.revisionId, version: 2, replayed: false });
    const document = await db.prepare(`select title,body_markdown,current_revision_id,current_version,written_at,document_status from v2_documents where object_id=?`).bind(initial.objectId).first<Record<string, unknown>>();
    expect(document).toMatchObject({ title: prepared.title, body_markdown: prepared.bodyMarkdown, current_revision_id: prepared.revisionId, current_version: 2, written_at: prepared.writtenAt, document_status: "revising" });
    await expect(count("v2_document_revisions")).resolves.toBe(2);
    await expect(count("v2_audit_events")).resolves.toBe(2);
  });

  test("replays one idempotency key without adding a revision", async () => {
    const initial = await seed();
    const prepared = await edit(initial);
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    await expect(repository.saveRevision(initial.objectId, prepared)).resolves.toMatchObject({ outcome: "saved", replayed: false });
    await expect(repository.saveRevision(initial.objectId, prepared)).resolves.toMatchObject({ outcome: "saved", replayed: true, version: 2 });
    await expect(count("v2_document_revisions")).resolves.toBe(2);
  });

  test("keeps one concurrent stale edit as an explicit fork and never silently overwrites it", async () => {
    const initial = await seed();
    const left = await edit(initial, { bodyMarkdown: `${initial.bodyMarkdown}\n\n왼쪽 편집` });
    const right = await edit(initial, { bodyMarkdown: `${initial.bodyMarkdown}\n\n오른쪽 편집` });
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    const results = await Promise.all([repository.saveRevision(initial.objectId, left), repository.saveRevision(initial.objectId, right)]);
    expect(results.filter((result) => result.outcome === "saved")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "conflict")).toHaveLength(1);
    await expect(count("v2_document_revisions", "where revision_status='committed'")).resolves.toBe(2);
    await expect(count("v2_document_revisions", "where revision_status='fork'")).resolves.toBe(1);
    await expect(count("v2_audit_events")).resolves.toBe(2);
  });

  test("detects reuse of an idempotency key with a different payload", async () => {
    const initial = await seed();
    const first = await edit(initial);
    const second = await prepareDocumentRevision({ ...first, bodyMarkdown: `${first.bodyMarkdown}\n다른 본문` }, first.idempotencyKey, first.savedAt);
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    await repository.saveRevision(initial.objectId, first);
    await expect(repository.saveRevision(initial.objectId, second)).rejects.toBeInstanceOf(DocumentRevisionIdempotencyConflictError);
  });

  test("allows returning to earlier Markdown while retaining every revision", async () => {
    const initial = await seed();
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    const second = await edit(initial);
    const saved = await repository.saveRevision(initial.objectId, second);
    expect(saved.outcome).toBe("saved");
    if (saved.outcome !== "saved") throw new Error("Expected a committed revision.");
    const third = await prepareDocumentRevision({
      expectedVersion: saved.version,
      expectedRevisionId: saved.revisionId,
      title: initial.title,
      bodyMarkdown: initial.bodyMarkdown,
      writtenAt: null,
      documentStatus: "draft",
      privacyLevel: "normal",
    }, "return-to-original", "2026-08-12T10:10:00.000Z");
    await expect(repository.saveRevision(initial.objectId, third)).resolves.toMatchObject({ outcome: "saved", version: 3 });
    await expect(count("v2_document_revisions")).resolves.toBe(3);
  });

  test("projects normal, sensitive, and restricted Library rows without leaking previews", async () => {
    const normal = await seed("normal", "normal");
    const sensitive = await seed("sensitive", "sensitive");
    const restricted = await seed("restricted", "restricted");
    const ownerRows = await new D1DocumentAuthoringRepository(db, "user-a").listRecords();
    const normalRow = ownerRows.find((row) => row.recordId === normal.objectId);
    const sensitiveRow = ownerRows.find((row) => row.recordId === sensitive.objectId);
    const restrictedRow = ownerRows.find((row) => row.recordId === restricted.objectId);
    expect(normalRow?.excerpt).toContain("변하지 않는 원문이다");
    expect(sensitiveRow).toMatchObject({ title: sensitive.title, excerpt: null, locked: false });
    expect(restrictedRow).toMatchObject({ title: null, excerpt: null, currentVersion: null, writtenAt: null, locked: true });
    await expect(new D1DocumentAuthoringRepository(db, "user-b").listRecords()).resolves.toEqual([]);
  });

  test("pages tied timestamps without omissions, duplicates, or unredacted restricted data", async () => {
    const seeded: Awaited<ReturnType<typeof seed>>[] = [];
    for (let start = 0; start < 53; start += 4) {
      seeded.push(...await Promise.all(Array.from({ length: Math.min(4, 53 - start) }, (_, offset) => {
        const index = start + offset;
        return seed(`page-${index}`, index === 1 ? "restricted" : "normal");
      })));
    }
    const repository = new D1DocumentAuthoringRepository(db, "user-a");
    const first = await repository.listRecordsPage();
    expect(first.records).toHaveLength(50);
    expect(first.totalCount).toBe(53);
    expect(first.nextCursor).toBeTruthy();
    const second = await repository.listRecordsPage({ cursor: first.nextCursor! });
    expect(second.records).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const records = [...first.records, ...second.records];
    expect(new Set(records.map((record) => record.recordId)).size).toBe(53);
    expect(records.map((record) => record.recordId).sort()).toEqual(seeded.map((record) => record.objectId).sort());
    expect(records.find((record) => record.recordId === seeded[1].objectId)).toMatchObject({ title: null, excerpt: null, locked: true });
    await expect(repository.listRecordsPage({ cursor: first.nextCursor!, includeDeleted: true })).rejects.toThrow("cursor is invalid");
    await expect(repository.listRecordsPage({ cursor: "not-json" })).rejects.toThrow("cursor is invalid");
    await expect(new D1DocumentAuthoringRepository(db, "user-b").listRecordsPage()).resolves.toMatchObject({ records: [], nextCursor: null, totalCount: 0 });
  }, 60_000);
});
