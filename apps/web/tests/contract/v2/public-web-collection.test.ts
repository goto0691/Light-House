import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { PublicWebResult } from "@/lib/v2/collect/public-web-fetch";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { hashLinkSourceManifest } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { readPublicFetchSource } from "@/lib/v2/domain/public-fetch-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1LinkSnapshotRepository, type PublicFetchSnapshotRequest } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { createBackupSnapshot } from "@/lib/v2/portability/backup-snapshot-v1";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationsPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const sourceUrl = "https://stories.example.com/article?edition=1";
const capturedAt = "2026-09-23T00:00:00.000Z";
const memo = "내 메모: 이 글을 나중에 다시 읽는다.";
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

let platform: Platform;
let db: TestD1;

async function applyMigration(name: string) {
  const sql = await readFile(`${migrationsPath}/${name}`, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(key: string, options: { userId?: string; privacyLevel?: "normal" | "restricted" } = {}) {
  const userId = options.userId ?? "web-owner";
  const prepared = await prepareCaptureCommit({
    draftId: `public-web-${key}`, channel: "web", title: `Saved ${key}`, bodyMarkdown: memo,
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: options.privacyLevel ?? "normal", capturedAt,
    sources: [{ kind: "url", rawText: "", contentHash: `sha256:${hash("")}`,
      metadata: makeManualLinkMetadata({ url: sourceUrl, purpose: "reference", completeness: "unknown" }) }],
  }, `capture-${key}`, capturedAt);
  await new D1SourceFoundationRepository(db, userId).commitCapture(prepared);
  return { ...prepared, userId, urlSourceId: prepared.sources[1].id };
}

function request(item: Fixture, extra: Partial<PublicFetchSnapshotRequest> = {}): PublicFetchSnapshotRequest {
  return { documentId: item.objectId, sourceItemId: item.urlSourceId, expectedRevisionId: item.revisionId,
    expectedSnapshotId: null, expectedSnapshotVersion: 0, idempotencyKey: `fetch-${item.objectId}`, ...extra };
}

function collected(text: string, options: { url?: string; html?: boolean } = {}): PublicWebResult {
  const html = options.html ?? false;
  return { state: html ? "partial" : "captured", reason: html ? "html_visible_text_only" : null,
    sourceUrl, finalUrl: options.url ?? sourceUrl, statusCode: 200, mimeType: html ? "text/html" : "text/plain",
    rawText: text, extraction: html ? "html_visible_text_v1" : "plain_text", externalScope: "unverified" };
}

function failed(reason: "forbidden" | "timeout", state: "needs_input" | "unavailable"): PublicWebResult {
  return { state, reason, sourceUrl, finalUrl: sourceUrl, statusCode: reason === "forbidden" ? 403 : null,
    mimeType: null, rawText: null, extraction: null, externalScope: "unverified" };
}

async function countRows(table: "v2_source_items" | "v2_link_snapshots", item: Fixture) {
  const where = table === "v2_source_items" ? "capture_id" : "document_object_id";
  const id = table === "v2_source_items" ? item.captureId : item.objectId;
  return (await db.prepare(`select count(*) as count from ${table} where ${where}=?`).bind(id).first<{ count: number }>())!.count;
}

beforeAll(async () => {
  platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec("pragma foreign_keys=on;create table users(id text primary key not null);insert into users(id) values ('web-owner'),('other-owner');");
  const names = (await readdir(migrationsPath)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort();
  for (const name of names) await applyMigration(name);
  expect(await db.prepare("pragma foreign_keys").first<{ foreign_keys: number }>()).toEqual({ foreign_keys: 1 });
}, 120_000);
afterAll(async () => { await platform?.dispose(); });

describe("public web collection canonical SQLite path", () => {
  test("full and incremental backups preserve public-fetch provenance, partial coverage and both snapshot members", async () => {
    const item = await fixture("backup", { userId: "other-owner" });
    const bucket = platform.env.ARCHIVE_ASSETS;
    const base = await createBackupSnapshot({ db, bucket, userId: item.userId, kind: "full", now: capturedAt });
    const text = "Visible title\nExact & quoted text 👤\n";
    const finalUrl = "https://stories.example.com/article-final";
    const receipt = await new D1LinkSnapshotRepository(db, item.userId)
      .createPublicFetchSnapshot(request(item), collected(text, { url: finalUrl, html: true }));
    const fetchedId = receipt.members[1].sourceItemId;
    const savedSource = (await db.prepare("select raw_text,content_hash,source_metadata from v2_source_items where id=?")
      .bind(fetchedId).first<{ raw_text: string; content_hash: string; source_metadata: string }>())!;
    const savedSnapshot = (await db.prepare("select acquisition_method,capture_state,coverage_json,manifest_hash from v2_link_snapshots where id=?")
      .bind(receipt.snapshot.id).first<{ acquisition_method: string; capture_state: string; coverage_json: string; manifest_hash: string }>())!;
    const savedMembers = (await db.prepare("select id,snapshot_id,source_item_id,member_key,source_order,source_fingerprint from v2_link_snapshot_sources where snapshot_id=?")
      .bind(receipt.snapshot.id).all()).results;

    const incremental = await createBackupSnapshot({ db, bucket, userId: item.userId, kind: "incremental", now: "2026-09-23T00:05:00.000Z" });
    expect(incremental).toMatchObject({ schemaVersion: "v2-032", baseSnapshotId: base.snapshotId, baseSequence: base.endSequence });
    expect(incremental.endSequence).toBeGreaterThan(base.endSequence);
    expect(incremental.metadataModes).toMatchObject({
      "sources/source-items.jsonl": "delta",
      "sources/link-snapshots.jsonl": "delta",
      "sources/link-snapshot-sources.jsonl": "delta",
    });
    const incrementalBundle = await materializeVerifiedBackup({ db, bucket, userId: item.userId, snapshotId: incremental.snapshotId });
    const full = await createBackupSnapshot({ db, bucket, userId: item.userId, kind: "full", now: "2026-09-23T00:10:00.000Z" });
    const fullBundle = await materializeVerifiedBackup({ db, bucket, userId: item.userId, snapshotId: full.snapshotId });

    for (const bundle of [incrementalBundle, fullBundle]) {
      expect(bundle.manifest.schemaVersion).toBe("v2-032");
      const fetched = bundle.rowsByTable.get("v2_source_items")?.find((row) => row.id === fetchedId);
      expect(fetched).toMatchObject(savedSource);
      expect(readPublicFetchSource(JSON.parse(String(fetched?.source_metadata)))).toMatchObject({
        requestedSourceItemId: item.urlSourceId, requestedUrl: sourceUrl, finalUrl,
        contentType: "text/html", extractionVersion: "html_visible_text_v1",
      });
      expect(fetched?.raw_text).toBe(text);
      const snapshot = bundle.rowsByTable.get("v2_link_snapshots")?.find((row) => row.id === receipt.snapshot.id);
      expect(snapshot).toMatchObject(savedSnapshot);
      expect(snapshot?.acquisition_method).toBe("public_fetch");
      expect(snapshot?.capture_state).toBe("partial");
      expect(JSON.parse(String(snapshot?.coverage_json))).toEqual(receipt.snapshot.coverage);
      const members = bundle.rowsByTable.get("v2_link_snapshot_sources")?.filter((row) => row.snapshot_id === receipt.snapshot.id);
      expect(members).toHaveLength(2);
      // Backup rows add export metadata columns; every saved canonical column must survive unchanged.
      expect(members).toEqual(expect.arrayContaining(savedMembers.map((member) => expect.objectContaining(member))));
      expect(members?.map((member) => member.source_item_id)).toEqual(expect.arrayContaining([item.urlSourceId, fetchedId]));
    }
  }, 180_000);

  test("stores an acquired original as a new immutable source and public-fetch snapshot without changing URL or memo", async () => {
    const item = await fixture("captured-original");
    const repo = new D1LinkSnapshotRepository(db, item.userId);
    const original = await db.prepare("select raw_text,content_hash,source_metadata from v2_source_items where id=?")
      .bind(item.urlSourceId).first();
    const text = "Title\nExact source line & punctuation.\n";
    const attempt = collected(text, { url: "https://stories.example.com/final" });
    expect(await repo.publicFetchCandidate(request(item))).toEqual({ url: sourceUrl, replayed: null });
    const receipt = await repo.createPublicFetchSnapshot(request(item), attempt);
    expect(receipt).toMatchObject({ replayed: false, documentRevisionId: item.revisionId,
      snapshot: { snapshotVersion: 1, parentSnapshotId: null, acquisitionMethod: "public_fetch", adapterVersion: "public-web-fetch.v1", captureState: "captured" } });
    expect(receipt.members).toHaveLength(2);
    expect(receipt.members[0]).toMatchObject({ sourceItemId: item.urlSourceId, rawText: "" });
    const fetched = receipt.members[1];
    expect(fetched.sourceItemId).not.toBe(item.urlSourceId);
    expect(fetched.rawText).toBe(text);
    expect(fetched.contentHash).toBe(`sha256:${hash(text)}`);
    expect(readPublicFetchSource(fetched.metadata)).toMatchObject({ requestedSourceItemId: item.urlSourceId,
      requestedUrl: sourceUrl, finalUrl: "https://stories.example.com/final", contentType: "text/plain", extractionVersion: "plain_text" });
    expect(fetched.manualLink).toMatchObject({ url: sourceUrl, completeness: "complete", publisher: null });
    expect(receipt.snapshot.manifestHash).toBe(await hashLinkSourceManifest({ members: receipt.members }));
    expect((await db.prepare("select raw_text,content_hash,source_metadata from v2_source_items where id=?").bind(item.urlSourceId).first())).toEqual(original);
    expect((await new D1SourceFoundationRepository(db, item.userId).getRecord(item.objectId))?.bodyMarkdown).toBe(memo);
    expect(await countRows("v2_source_items", item)).toBe(3); // memo, URL, fetched text
    expect(await countRows("v2_link_snapshots", item)).toBe(1);
    expect(await db.prepare("select count(*) as count from v2_processing_outbox where capture_id=?").bind(item.captureId).first()).toEqual({ count: 0 });
    expect(await db.prepare("select count(*) as count from v2_source_items s left join v2_document_source_links l on l.source_item_id=s.id where s.capture_id=? and l.source_item_id is null")
      .bind(item.captureId).first()).toEqual({ count: 0 });
  });

  test("records a 403 or timeout without inventing source text and keeps the URL and memo", async () => {
    for (const [key, attempt, state, reason] of [
      ["blocked-403", failed("forbidden", "needs_input"), "needs_input", "forbidden"],
      ["blocked-timeout", failed("timeout", "unavailable"), "unavailable", "timeout"],
    ] as const) {
      const item = await fixture(key);
      const repo = new D1LinkSnapshotRepository(db, item.userId);
      const receipt = await repo.createPublicFetchSnapshot(request(item), attempt);
      expect(receipt.snapshot.captureState).toBe(state);
      expect(receipt.snapshot.acquisitionMethod).toBe("public_fetch");
      expect(receipt.snapshot.coverage).toMatchObject({ scope: "public_web_single_url", requestedSourceItemId: item.urlSourceId,
        reason, fullExternalScope: "unverified" });
      expect(receipt.members).toHaveLength(1);
      expect(receipt.members[0]).toMatchObject({ sourceItemId: item.urlSourceId, rawText: "" });
      expect(await countRows("v2_source_items", item)).toBe(2);
      expect((await new D1SourceFoundationRepository(db, item.userId).getRecord(item.objectId))?.bodyMarkdown).toBe(memo);
    }
  });

  test("a new successful collection replaces the prior fetched member in current but preserves historical snapshot and source", async () => {
    const item = await fixture("refresh-success");
    const repo = new D1LinkSnapshotRepository(db, item.userId);
    const first = await repo.createPublicFetchSnapshot(request(item), collected("First exact version"));
    const second = await repo.createPublicFetchSnapshot(request(item, { expectedSnapshotId: first.snapshot.id, expectedSnapshotVersion: 1,
      idempotencyKey: "refresh-success-second" }), collected("Second exact version"));
    expect(second.snapshot).toMatchObject({ snapshotVersion: 2, parentSnapshotId: first.snapshot.id, acquisitionMethod: "public_fetch" });
    expect(second.members.map((member) => member.rawText)).toEqual(["", "Second exact version"]);
    expect(second.members[0].memberKey).toBe(first.members[0].memberKey);
    expect(second.members[1].sourceItemId).not.toBe(first.members[1].sourceItemId);
    expect(second.snapshot.manifestHash).not.toBe(first.snapshot.manifestHash);
    expect((await repo.getSnapshot(item.objectId, first.snapshot.id))?.members.map((member) => member.rawText)).toEqual(["", "First exact version"]);
    expect(await countRows("v2_source_items", item)).toBe(4);
  });

  test("a failed refresh retains previously acquired text in current as well as in history", async () => {
    const item = await fixture("refresh-failed");
    const repo = new D1LinkSnapshotRepository(db, item.userId);
    const first = await repo.createPublicFetchSnapshot(request(item), collected("Saved before outage"));
    const second = await repo.createPublicFetchSnapshot(request(item, { expectedSnapshotId: first.snapshot.id, expectedSnapshotVersion: 1,
      idempotencyKey: "refresh-failed-second" }), failed("timeout", "unavailable"));
    expect(second.snapshot).toMatchObject({ snapshotVersion: 2, captureState: "unavailable", parentSnapshotId: first.snapshot.id });
    expect(second.snapshot.coverage).toMatchObject({ reason: "timeout" });
    expect(second.members.map((member) => member.sourceItemId)).toEqual(first.members.map((member) => member.sourceItemId));
    expect((await repo.getSnapshot(item.objectId, first.snapshot.id))?.members[1].rawText).toBe("Saved before outage");
    expect(await countRows("v2_source_items", item)).toBe(3);
  });

  test("same idempotency key replays exactly one snapshot; stale revision and parent do not write orphans", async () => {
    const item = await fixture("replay-and-cas");
    const repo = new D1LinkSnapshotRepository(db, item.userId);
    const input = request(item);
    await expect(repo.publicFetchCandidate({ ...input, expectedRevisionId: "old-revision" })).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    expect(await countRows("v2_link_snapshots", item)).toBe(0);
    const first = await repo.createPublicFetchSnapshot(input, collected("Only once"));
    const replay = await repo.publicFetchCandidate(input);
    expect(replay.replayed).toMatchObject({ replayed: true, snapshot: { id: first.snapshot.id } });
    expect(await repo.createPublicFetchSnapshot(input, collected("Only once"))).toMatchObject({ replayed: true, snapshot: { id: first.snapshot.id } });
    expect(await countRows("v2_link_snapshots", item)).toBe(1);
    expect(await countRows("v2_source_items", item)).toBe(3);
    await expect(repo.publicFetchCandidate({ ...input, idempotencyKey: "stale-parent" })).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    expect(await countRows("v2_link_snapshots", item)).toBe(1);
  });

  test("other owners and locked restricted records cannot read candidates or save fetched content", async () => {
    const item = await fixture("owner-fence");
    const foreign = new D1LinkSnapshotRepository(db, "other-owner");
    await expect(foreign.publicFetchCandidate(request(item))).rejects.toMatchObject({ code: "link_snapshot_not_found" });
    await expect(foreign.createPublicFetchSnapshot(request(item), collected("foreign text"))).rejects.toMatchObject({ code: "link_snapshot_not_found" });
    const restricted = await fixture("restricted-fence", { privacyLevel: "restricted" });
    const restrictedRepo = new D1LinkSnapshotRepository(db, restricted.userId);
    await expect(restrictedRepo.publicFetchCandidate(request(restricted))).rejects.toMatchObject({ code: "link_snapshot_not_found" });
    await expect(restrictedRepo.createPublicFetchSnapshot(request(restricted), collected("restricted text"))).rejects.toMatchObject({ code: "link_snapshot_not_found" });
    expect(await countRows("v2_link_snapshots", item)).toBe(0);
    expect(await countRows("v2_link_snapshots", restricted)).toBe(0);
    expect(await countRows("v2_source_items", item)).toBe(2);
    expect(await countRows("v2_source_items", restricted)).toBe(2);
  });

  test("a version change at the batch boundary rolls back fetched source, members, snapshot and receipt", async () => {
    const item = await fixture("batch-cas");
    const membersBefore = await db.prepare("select count(*) as count from v2_link_snapshot_sources").first<{ count: number }>();
    const wrapped: D1DatabaseBinding = { prepare: (query) => db.prepare(query), batch: async (statements) => {
      await db.prepare("update v2_documents set link_snapshot_version=1 where object_id=?").bind(item.objectId).run();
      return db.batch(statements);
    } };
    const input = request(item);
    await expect(new D1LinkSnapshotRepository(wrapped, item.userId).createPublicFetchSnapshot(input, collected("must roll back")))
      .rejects.toMatchObject({ code: "link_snapshot_conflict" });
    expect(await countRows("v2_source_items", item)).toBe(2);
    expect(await countRows("v2_link_snapshots", item)).toBe(0);
    expect(await db.prepare("select count(*) as count from v2_link_snapshot_sources").first()).toEqual(membersBefore);
    expect(await db.prepare("select count(*) as count from v2_idempotency_records where operation='link_snapshot.public_fetch.v1' and idempotency_key=?")
      .bind(input.idempotencyKey).first()).toEqual({ count: 0 });
  });
});
