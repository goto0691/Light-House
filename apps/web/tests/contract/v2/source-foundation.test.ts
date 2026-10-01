import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { buildPrivateOriginalKey } from "@/lib/v2/domain/attachment-reservation";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type {
  D1DatabaseBinding,
  D1PreparedStatementBinding,
} from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestD1 = D1DatabaseBinding & {
  exec(query: string): Promise<unknown>;
  prepare(query: string): D1PreparedStatementBinding;
};

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationPath = fileURLToPath(new URL("../../../../../migrations/0006_v2_source_and_document_foundation.sql", import.meta.url));
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
    delete from v2_idempotency_records;
    delete from v2_audit_events;
    delete from v2_processing_runs;
    delete from v2_processing_jobs;
    delete from v2_processing_outbox;
    delete from v2_deletion_tombstones;
    delete from v2_document_source_links;
    delete from v2_document_revisions;
    delete from v2_documents;
    delete from v2_objects;
    delete from v2_source_attachment_links;
    delete from v2_source_items;
    delete from v2_attachment_reservations;
    delete from v2_capture_bundles;
  `);
}

async function count(table: string) {
  const row = await db.prepare(`select count(*) as value from ${table}`).first<{ value: number }>();
  return row?.value ?? -1;
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec(`
    create table users (id text primary key not null);
    insert into users (id) values ('user-a'), ('user-b');
  `);
  await applySqlFile(migrationPath);
});

beforeEach(reset);

afterAll(async () => {
  await platform.dispose();
});

function request(privacyLevel: "normal" | "restricted" = "normal") {
  return {
    draftId: `draft-${privacyLevel}`,
    channel: "web" as const,
    title: "원본 왕복 기록",
    bodyMarkdown: "# 원본 왕복\n\n한국어와  줄 사이 공백을 **그대로** 보존한다.\n",
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel,
    capturedAt: "2026-08-12T09:00:00.000Z",
  };
}

describe("I1 source foundation", () => {
  test("rejects the case-insensitive legacy draft namespace on the public preparation path", async () => {
    await expect(prepareCaptureCommit({ ...request(), draftId: "LeGaCy:forged-native-capture" }, "public-key"))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
    await expect(count("v2_capture_bundles")).resolves.toBe(0);
  });

  test("applies the additive migration and commits source, immutable revision, record, receipt, and content-free audit atomically", async () => {
    const prepared = await prepareCaptureCommit(request(), "idem-roundtrip", "2026-08-12T09:00:01.000Z");
    const repository = new D1SourceFoundationRepository(db, "user-a");
    const receipt = await repository.commitCapture(prepared);

    expect(receipt).toMatchObject({ recordId: prepared.objectId, revisionId: prepared.revisionId, disposition: "committed" });
    await expect(count("v2_capture_bundles")).resolves.toBe(1);
    await expect(count("v2_document_revisions")).resolves.toBe(1);
    await expect(count("v2_audit_events")).resolves.toBe(1);
    const record = await repository.getRecord(prepared.objectId);
    expect(record).toMatchObject({
      title: "원본 왕복 기록",
      bodyMarkdown: request().bodyMarkdown,
      currentVersion: 1,
      locked: false,
    });
    expect(record?.sources[0]).toMatchObject({ rawText: request().bodyMarkdown, displayOrder: 0 });
    const audit = await db.prepare("select metadata_json from v2_audit_events limit 1").first<{ metadata_json: string }>();
    expect(audit?.metadata_json).toBe("{}");
    expect(audit?.metadata_json).not.toContain("원본 왕복");
  });

  test("converges twenty retries to one source and one document", async () => {
    const prepared = await prepareCaptureCommit(request(), "idem-20-retries", "2026-08-12T09:00:01.000Z");
    const repository = new D1SourceFoundationRepository(db, "user-a");
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => repository.commitCapture(prepared)));

    expect(outcomes.filter((outcome) => outcome.disposition === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.disposition === "replayed")).toHaveLength(19);
    await expect(count("v2_capture_bundles")).resolves.toBe(1);
    await expect(count("v2_documents")).resolves.toBe(1);
    await expect(count("v2_source_items")).resolves.toBe(1);
  }, 15_000);

  test("preserves the pre-lifecycle active payload hash and replays its stored receipt", async () => {
    const prepared = await prepareCaptureCommit(request(), "idem-legacy-active", "2026-08-12T09:00:01.000Z");
    const legacyPayloadHash = "sha256:a9be09fe15733047ff0a0aaa7c191efc68a5f9245676dd7e57090417cef58bff";
    const legacyReceipt = {
      captureId: "legacy-capture",
      recordId: "legacy-record",
      revisionId: "legacy-revision",
      sourceItemIds: ["legacy-source"],
    };

    expect(prepared.initialLifecycleStatus).toBe("active");
    expect(prepared.payloadHash).toBe(legacyPayloadHash);
    expect(prepared.contentHash).toBe(legacyPayloadHash);
    await db.prepare(
      `insert into v2_idempotency_records
       (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
       values (?,'capture.commit',?,?,?,201,?)`,
    ).bind("user-a", prepared.idempotencyKey, legacyPayloadHash, JSON.stringify(legacyReceipt), "2026-08-12T09:00:01.000Z").run();

    await expect(new D1SourceFoundationRepository(db, "user-a").commitCapture(prepared)).resolves.toMatchObject({
      ...legacyReceipt,
      disposition: "replayed",
    });
    await expect(count("v2_capture_bundles")).resolves.toBe(0);
  });

  test("keeps explicit active compatible while hashing and storing archived captures separately", async () => {
    const normal = await prepareCaptureCommit(request(), "idem-lifecycle", "2026-08-12T09:00:01.000Z");
    const explicitActive = await prepareCaptureCommit(request(), "idem-lifecycle", "2026-08-12T09:00:01.000Z", null, { initialLifecycleStatus: "active" });
    const archived = await prepareCaptureCommit(request(), "idem-lifecycle", "2026-08-12T09:00:01.000Z", null, { initialLifecycleStatus: "archived" });

    expect(explicitActive.payloadHash).toBe(normal.payloadHash);
    expect(archived.payloadHash).not.toBe(normal.payloadHash);
    expect(archived.initialLifecycleStatus).toBe("archived");

    const repository = new D1SourceFoundationRepository(db, "user-a");
    await repository.commitCapture(archived);
    await expect(repository.getRecord(archived.objectId, true)).resolves.toMatchObject({ lifecycleStatus: "archived" });
  });

  test("scopes reads to the repository user", async () => {
    const prepared = await prepareCaptureCommit(request(), "idem-owner", "2026-08-12T09:00:01.000Z");
    await new D1SourceFoundationRepository(db, "user-a").commitCapture(prepared);
    await expect(new D1SourceFoundationRepository(db, "user-b").getRecord(prepared.objectId)).resolves.toBeNull();
  });

  test("fails closed when a current revision id points at another owner's document", async () => {
    const own = await prepareCaptureCommit({ ...request(), draftId: "draft-owner-revision" }, "idem-owner-revision", "2026-08-12T09:00:01.000Z");
    const foreign = await prepareCaptureCommit({ ...request(), draftId: "draft-foreign-revision", bodyMarkdown: "foreign revision" }, "idem-foreign-revision", "2026-08-12T09:00:02.000Z");
    await new D1SourceFoundationRepository(db, "user-a").commitCapture(own);
    await new D1SourceFoundationRepository(db, "user-b").commitCapture(foreign);
    await db.prepare(`update v2_documents set current_revision_id=? where object_id=?`).bind(foreign.revisionId, own.objectId).run();

    await expect(new D1SourceFoundationRepository(db, "user-a").getRecord(own.objectId, true)).resolves.toBeNull();
  });

  test("returns no title, body, revision, or source payload for a locked restricted record", async () => {
    const prepared = await prepareCaptureCommit(request("restricted"), "idem-restricted", "2026-08-12T09:00:01.000Z");
    const repository = new D1SourceFoundationRepository(db, "user-a");
    await repository.commitCapture(prepared);

    await expect(repository.getRecord(prepared.objectId)).resolves.toMatchObject({
      title: null,
      bodyMarkdown: null,
      currentRevisionId: null,
      currentVersion: null,
      sources: [],
      locked: true,
    });
    await expect(repository.getRecord(prepared.objectId, true)).resolves.toMatchObject({
      title: "원본 왕복 기록",
      bodyMarkdown: request("restricted").bodyMarkdown,
      locked: false,
    });
  });

  test("keeps attachment reservation status and lookup inside one user scope", async () => {
    const createdAt = "2026-08-12T09:00:00.000Z";
    const reservation = {
      id: "attachment-scope",
      userId: "user-a",
      objectKey: buildPrivateOriginalKey({ userId: "user-a", reservationId: "attachment-scope", reservedAt: createdAt }),
      filename: "운동.png",
      expectedSize: 9,
      expectedMimeType: "image/png",
      expectedSha256: "a".repeat(64),
      expiresAt: "2026-08-12T09:15:00.000Z",
    };
    const owner = new D1AttachmentReservationRepository(db, "user-a");
    await owner.create(reservation, createdAt);
    await expect(new D1AttachmentReservationRepository(db, "user-b").find(reservation.id)).resolves.toBeNull();
    await owner.markUploadedUnverified(reservation.id);
    await expect(owner.find(reservation.id)).resolves.toMatchObject({ status: "uploaded_unverified" });
    await owner.markVerified(reservation.id, "2026-08-12T09:01:00.000Z");
    await expect(owner.find(reservation.id)).resolves.toMatchObject({ status: "verified" });
    const capture = await prepareCaptureCommit({
      ...request(),
      draftId: "draft-attachment-access",
      sources: [{
        kind: "image",
        contentHash: reservation.expectedSha256,
        attachmentId: reservation.id,
        metadata: { filename: reservation.filename },
      }],
    }, "idem-attachment-access", "2026-08-12T09:02:00.000Z");
    await new D1SourceFoundationRepository(db, "user-a").commitCapture(capture);
    await expect(owner.findCommittedAccess(reservation.id)).resolves.toMatchObject({ status: "committed", privacyLevel: "normal" });
    await expect(new D1AttachmentReservationRepository(db, "user-b").findCommittedAccess(reservation.id)).resolves.toBeNull();
  });

  test("trashes and restores a record without deleting source or revision history", async () => {
    const prepared = await prepareCaptureCommit(request(), "idem-trash", "2026-08-12T09:00:01.000Z");
    const repository = new D1SourceFoundationRepository(db, "user-a");
    await repository.commitCapture(prepared);
    await expect(
      repository.trashRecord(prepared.objectId, {
        auditEventId: "audit-trash",
        deletedAt: "2026-08-12T10:00:00.000Z",
        purgeAfter: "2026-11-10T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "deleted", replayed: false });
    await expect(count("v2_source_items")).resolves.toBe(1);
    await expect(count("v2_document_revisions")).resolves.toBe(1);

    await expect(
      repository.restoreRecord(prepared.objectId, {
        auditEventId: "audit-restore",
        restoredAt: "2026-08-12T10:05:00.000Z",
      }),
    ).resolves.toMatchObject({ lifecycleStatus: "active", replayed: false });
    await expect(repository.getRecord(prepared.objectId)).resolves.toMatchObject({ lifecycleStatus: "active" });
    await expect(count("v2_deletion_tombstones")).resolves.toBe(1);
    await expect(count("v2_audit_events")).resolves.toBe(3);
  });
});
