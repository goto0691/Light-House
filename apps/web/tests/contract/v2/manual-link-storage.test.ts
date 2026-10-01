import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { buildPrivateOriginalKey } from "@/lib/v2/domain/attachment-reservation";
import { prepareCaptureCommit, type CaptureCommitRequest } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import type { ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { createBackupSnapshot } from "@/lib/v2/portability/backup-snapshot-v1";
import { writeExportBundle } from "@/lib/v2/portability/export-bundle-v1";
import { sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { createRestoreDryRun, importVerifiedBundle, verifyExportBundle } from "@/lib/v2/portability/restore-bundle-v1";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationsPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const platforms: Platform[] = [];
const now = "2026-09-08T09:00:00.000Z";
let source: Platform;

async function createPlatform() {
  const platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  platforms.push(platform);
  await platform.env.DB.exec("create table users (id text primary key not null); insert into users (id) values ('link-user'),('other-user'),('export-user'),('backup-user');");
  const names = (await readdir(migrationsPath)).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort();
  for (const name of names) {
    const sql = await readFile(`${migrationsPath}/${name}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await platform.env.DB.prepare(statement).run();
  }
  return platform;
}

beforeAll(async () => { source = await createPlatform(); }, 60_000);
afterAll(async () => { await Promise.all(platforms.map((platform) => platform.dispose())); });

function manualLink(overrides: Partial<ManualLinkSourceV1> = {}): ManualLinkSourceV1 {
  return {
    contract: "manual-link-source.v1", url: "https://www.threads.com/@fixture/post/prompt-1?xmt=fixture",
    canonicalUrl: "https://www.threads.com/@fixture/post/prompt-1", provider: "threads", purpose: "prompt",
    role: "prompt", completeness: "complete", publisher: "직접 입력한 작성자", partNumber: 1,
    totalParts: 1, startSeconds: null, endSeconds: null, ...overrides,
  };
}

function request(key: string, options: { privacyLevel?: "normal" | "restricted"; metadata?: ManualLinkSourceV1; rawText?: string } = {}): CaptureCommitRequest {
  const rawText = options.rawText ?? "  창가 인물 👤\r\n\r\n빛은  부드럽게.\n";
  return {
    draftId: key, channel: "web", title: "수동 링크 자료", bodyMarkdown: "내 메모: 먼저 참고해 보기.",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: options.privacyLevel ?? "normal", capturedAt: now,
    sources: [{ kind: "url", rawText, contentHash: `sha256:${sha256Hex(rawText)}`, metadata: { manualLinkV1: options.metadata ?? manualLink() } }],
  };
}

async function storedSources(platform: Platform, captureId: string) {
  return (await platform.env.DB.prepare("select id,item_kind,display_order,raw_text,content_hash,source_metadata,immutability_version from v2_source_items where capture_id=? order by display_order")
    .bind(captureId).all<Record<string, unknown>>()).results;
}

describe("manual link capture storage without external acquisition", () => {
  test("round-trips exact pasted text and allowlisted metadata in original input order without AI jobs", async () => {
    const input = request("manual-link-roundtrip");
    const metadata = manualLink({ partNumber: 3, totalParts: 3 });
    const prepared = await prepareCaptureCommit({ ...input, sources: [
      { ...input.sources![0], metadata: { manualLinkV1: metadata, privateDebugValue: "not-a-client-field" } },
      { ...input.sources![0], rawText: "첫 번째 조각", contentHash: `sha256:${sha256Hex("첫 번째 조각")}`, metadata: { manualLinkV1: manualLink({ partNumber: 1, totalParts: 3 }) } },
    ] }, "manual-link-roundtrip", now);
    const repository = new D1SourceFoundationRepository(source.env.DB, "link-user");
    const receipt = await repository.commitCapture(prepared);
    expect(receipt).toMatchObject({ disposition: "committed", aiProcessing: "disabled", attachmentCount: 0 });
    const record = await repository.getRecord(receipt.recordId);
    expect(record?.sources.map((item) => item.rawText)).toEqual([input.bodyMarkdown, input.sources![0].rawText, "첫 번째 조각"]);
    expect(record?.sources[0].manualLink).toBeNull();
    expect(record?.sources[1]).toMatchObject({ contentHash: input.sources![0].contentHash, manualLink: metadata });
    expect(record?.sources[2].manualLink?.partNumber).toBe(1);
    expect(JSON.stringify(record)).not.toContain("privateDebugValue");
    expect(JSON.stringify(record)).not.toContain("not-a-client-field");
    await expect(source.env.DB.prepare("select count(*) as count from v2_processing_outbox where capture_id=?").bind(prepared.captureId).first()).resolves.toEqual({ count: 0 });
  });

  test("replays retries without creating sources and rejects metadata changes under an existing idempotency key", async () => {
    const input = request("manual-link-idempotency");
    const prepared = await prepareCaptureCommit(input, "manual-link-idempotency", now);
    const repository = new D1SourceFoundationRepository(source.env.DB, "link-user");
    const first = await repository.commitCapture(prepared);
    const original = await storedSources(source, prepared.captureId);
    const retried = await prepareCaptureCommit(input, "manual-link-idempotency", "2026-09-08T09:01:00.000Z");
    expect(retried.objectId).not.toBe(prepared.objectId);
    await expect(repository.commitCapture(retried)).resolves.toMatchObject({ ...first, disposition: "replayed" });
    const changed = await prepareCaptureCommit(request("manual-link-idempotency", { metadata: manualLink({ completeness: "partial" }) }), "manual-link-idempotency", now);
    expect(changed.payloadHash).not.toBe(prepared.payloadHash);
    await expect(repository.commitCapture(changed)).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(await storedSources(source, prepared.captureId)).toEqual(original);
    await expect(source.env.DB.prepare("select count(*) as count from v2_capture_bundles where user_id='link-user' and draft_id=?").bind(input.draftId).first()).resolves.toEqual({ count: 1 });
  });

  test("omits source metadata for another owner or a locked restricted record, including forged cross-owner links", async () => {
    const repository = new D1SourceFoundationRepository(source.env.DB, "link-user");
    const restricted = await prepareCaptureCommit(request("manual-link-private", { privacyLevel: "restricted" }), "manual-link-private", now);
    await repository.commitCapture(restricted);
    await expect(repository.getRecord(restricted.objectId)).resolves.toMatchObject({ locked: true, title: null, bodyMarkdown: null, currentRevisionId: null, sources: [] });
    expect((await repository.getRecord(restricted.objectId, true))?.sources[1].manualLink).toEqual(manualLink());
    await expect(new D1SourceFoundationRepository(source.env.DB, "other-user").getRecord(restricted.objectId, true)).resolves.toBeNull();

    const other = await prepareCaptureCommit(request("manual-link-other", { rawText: "타인의 자료는 보이지 않아야 한다." }), "manual-link-other", now);
    await new D1SourceFoundationRepository(source.env.DB, "other-user").commitCapture(other);
    await source.env.DB.prepare("insert into v2_document_source_links (document_object_id,source_item_id,role,source_order,created_at) values (?,?,'evidence',99,?)")
      .bind(restricted.objectId, other.sources[1].id, now).run();
    const unlocked = await repository.getRecord(restricted.objectId, true);
    expect(unlocked?.sources).toHaveLength(2);
    expect(JSON.stringify(unlocked)).not.toContain("타인의 자료");
  });

  test("falls back to raw-source display for malformed, unsupported, or unsafe stored metadata", async () => {
    const prepared = await prepareCaptureCommit(request("manual-link-invalid-metadata"), "manual-link-invalid-metadata", now);
    const repository = new D1SourceFoundationRepository(source.env.DB, "link-user");
    await repository.commitCapture(prepared);
    for (const value of ["{invalid", "[]", JSON.stringify({ unrelated: "kept private" }), JSON.stringify({ manualLinkV1: { ...manualLink(), contract: "future-contract" } }), JSON.stringify({ manualLinkV1: { ...manualLink(), url: "javascript:alert(1)" } })]) {
      // Simulate historical/restored corruption, not an application update API.
      await source.env.DB.prepare("update v2_source_items set source_metadata=? where id=?").bind(value, prepared.sources[1].id).run();
      const record = await repository.getRecord(prepared.objectId);
      expect(record?.sources[1].manualLink).toBeNull();
      expect(record?.sources[1].rawText).toBe(prepared.sources[1].rawText);
    }
  });

  test("keeps the captured source snapshot unchanged when the user edits their note or loses a revision CAS race", async () => {
    const prepared = await prepareCaptureCommit(request("manual-link-revision"), "manual-link-revision", now);
    const repository = new D1SourceFoundationRepository(source.env.DB, "link-user");
    await repository.commitCapture(prepared);
    const original = await storedSources(source, prepared.captureId);
    const authoring = new D1DocumentAuthoringRepository(source.env.DB, "link-user");
    const revisionInput = { expectedVersion: 1, expectedRevisionId: prepared.revisionId, title: "내 메모 수정", bodyMarkdown: "동의보다는 검토하려고 남긴 자료.", writtenAt: null, documentStatus: "revising" as const, privacyLevel: "normal" as const };
    const winning = await prepareDocumentRevision(revisionInput, "manual-link-note", "2026-09-08T09:02:00.000Z");
    await expect(authoring.saveRevision(prepared.objectId, winning)).resolves.toMatchObject({ outcome: "saved" });
    const stale = await prepareDocumentRevision({ ...revisionInput, bodyMarkdown: "옛 화면의 수정" }, "manual-link-stale-note", "2026-09-08T09:03:00.000Z");
    await expect(authoring.saveRevision(prepared.objectId, stale)).resolves.toMatchObject({ outcome: "conflict" });
    const after = await storedSources(source, prepared.captureId);
    expect(after.filter((item) => original.some((old) => old.id === item.id))).toEqual(original);
    const record = await repository.getRecord(prepared.objectId);
    expect(record?.bodyMarkdown).toBe(revisionInput.bodyMarkdown);
    expect(record?.sources.find((item) => item.id === prepared.sources[1].id)?.manualLink).toEqual(manualLink());
    await expect(source.env.DB.prepare("select count(*) as count from v2_processing_outbox where capture_id=?").bind(prepared.captureId).first()).resolves.toEqual({ count: 0 });
  });

  test("exports and restores exact manual sources, private image bytes and metadata while excluding restricted documents", async () => {
    const userId = "export-user";
    const repository = new D1SourceFoundationRepository(source.env.DB, userId);
    const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    // This synthetic byte fixture tests storage fidelity, not image decoding or OCR.
    const reservation = { id: "manual-link-image", userId, objectKey: buildPrivateOriginalKey({ userId, reservationId: "manual-link-image", reservedAt: now }), filename: "구도-합성.png", expectedSize: imageBytes.byteLength, expectedMimeType: "image/png", expectedSha256: sha256Hex(imageBytes), expiresAt: "2026-09-08T09:15:00.000Z" };
    const attachmentRepository = new D1AttachmentReservationRepository(source.env.DB, userId);
    await attachmentRepository.create(reservation, now);
    await source.env.ARCHIVE_ASSETS.put(reservation.objectKey, imageBytes);
    await attachmentRepository.markUploadedUnverified(reservation.id);
    await attachmentRepository.markVerified(reservation.id, now);
    const input = request("manual-link-export");
    const prepared = await prepareCaptureCommit({ ...input, sources: [...input.sources!, { kind: "image", rawText: null, contentHash: `sha256:${reservation.expectedSha256}`, attachmentId: reservation.id }] }, "manual-link-export", now);
    await repository.commitCapture(prepared);
    const restricted = await prepareCaptureCommit(request("manual-link-export-restricted", { privacyLevel: "restricted", rawText: "잠긴 링크 원문" }), "manual-link-export-restricted", now);
    await repository.commitCapture(restricted);

    const jobs = new D1PortabilityRepository(source.env.DB, userId);
    const queued = await jobs.createExport({ profile: "migration", scope: { objects: "all", privacyLevels: ["normal"], includeTrash: false, includeHistory: true, includeOriginals: true }, idempotencyKey: "manual-link-export-bundle", now });
    const claimed = await jobs.claimExport(queued.id, now);
    const exported = await writeExportBundle({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, job: claimed });
    const object = await source.env.ARCHIVE_ASSETS.get(exported.objectKey);
    if (!object) throw new Error("Expected local archive object.");
    const bundle = verifyExportBundle(new Uint8Array(await object.arrayBuffer()));
    const sourceRows = bundle.rowsByTable.get("v2_source_items") ?? [];
    expect(sourceRows.find((row) => row.id === prepared.sources[1].id)?.source_metadata).toBe(prepared.sources[1].metadataJson);
    expect(sourceRows.some((row) => row.capture_id === restricted.captureId)).toBe(false);
    const target = await createPlatform();
    const dryRun = await createRestoreDryRun(target.env.DB, "other-user", bundle);
    const restored = await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "other-user", bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "manual-link-restore", now });
    expect(restored.status).toBe("succeeded");
    const targetRecord = await new D1SourceFoundationRepository(target.env.DB, "other-user").getRecord(prepared.objectId);
    expect(targetRecord?.sources[1]).toMatchObject({ rawText: input.sources![0].rawText, manualLink: manualLink(), contentHash: input.sources![0].contentHash });
    expect(targetRecord?.sources[2]).toMatchObject({ attachmentId: reservation.id, sizeBytes: imageBytes.byteLength, mimeType: "image/png" });
    const restoredAttachment = await new D1AttachmentReservationRepository(target.env.DB, "other-user").findCommittedAccess(reservation.id);
    const restoredBytes = restoredAttachment && await target.env.ARCHIVE_ASSETS.get(restoredAttachment.objectKey);
    expect(restoredBytes && new Uint8Array(await restoredBytes.arrayBuffer())).toEqual(imageBytes);
    await expect(new D1SourceFoundationRepository(target.env.DB, userId).getRecord(prepared.objectId, true)).resolves.toBeNull();
  }, 120_000);

  test("includes a newly captured manual source in incremental backup through existing source change events", async () => {
    const userId = "backup-user";
    const base = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, kind: "full", now });
    const input = request("manual-link-backup", { metadata: manualLink({ purpose: "insight", role: "source", partNumber: null, totalParts: null, completeness: "unknown" }) });
    const prepared = await prepareCaptureCommit(input, "manual-link-backup", "2026-09-08T09:05:00.000Z");
    await new D1SourceFoundationRepository(source.env.DB, userId).commitCapture(prepared);
    const changed = await source.env.DB.prepare("select aggregate_kind,content_hash from v2_change_events where user_id=? and aggregate_id=? and sequence>?")
      .bind(userId, prepared.sources[1].id, base.endSequence).all<{ aggregate_kind: string; content_hash: string }>();
    expect(changed.results).toContainEqual({ aggregate_kind: "source_item", content_hash: prepared.sources[1].contentHash });
    const incremental = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, kind: "incremental", now: "2026-09-08T09:06:00.000Z" });
    expect(incremental.baseSnapshotId).toBe(base.snapshotId);
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: incremental.snapshotId });
    const sourceRows = bundle.rowsByTable.get("v2_source_items") ?? [];
    expect(sourceRows.find((row) => row.id === prepared.sources[1].id)).toMatchObject({ raw_text: prepared.sources[1].rawText, content_hash: prepared.sources[1].contentHash, source_metadata: prepared.sources[1].metadataJson });
    const target = await createPlatform();
    const dryRun = await createRestoreDryRun(target.env.DB, userId, bundle);
    await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId, bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "manual-link-backup-restore", now: "2026-09-08T09:07:00.000Z" });
    const record = await new D1SourceFoundationRepository(target.env.DB, userId).getRecord(prepared.objectId);
    expect(record?.sources[1]).toMatchObject({ rawText: input.sources![0].rawText, manualLink: input.sources![0].metadata!.manualLinkV1 });
  }, 120_000);
});
