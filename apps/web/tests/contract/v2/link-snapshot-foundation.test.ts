import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit, type CaptureCommitRequest } from "@/lib/v2/domain/capture-source";
import { buildPrivateOriginalKey } from "@/lib/v2/domain/attachment-reservation";
import { canonicalLinkJson, createLinkSourceFingerprint, hashLinkSourceManifest } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkSnapshotRepository, type CreateLinkSnapshotInput } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1AttachmentReservationRepository } from "@/lib/v2/infrastructure/d1/attachment-reservation-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationsPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const platforms: Platform[] = [];
const now = "2026-09-08T09:00:00.000Z";
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const metadata = makeManualLinkMetadata({ url: "https://www.threads.com/@fixture/post/prompt-1?xmt=fixture", purpose: "prompt", role: "prompt", completeness: "partial" });
const rawText = "  창가 인물 👤\r\n\r\n빛은  부드럽게.\n";
let db: TestD1;
let preMigration: TestD1;
let preservedLease: Record<string, unknown> | null;
let leaseDocumentId: string;

async function applyMigration(target: TestD1, name: string) {
  const sql = await readFile(`${migrationsPath}/${name}`, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await target.prepare(statement).run();
}
async function createPlatform(lastMigration: number) {
  const platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  platforms.push(platform);
  await platform.env.DB.exec("create table users(id text primary key not null);insert into users(id) values ('link-user'),('other-user');");
  const names = (await readdir(migrationsPath)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= lastMigration).sort();
  for (const name of names) await applyMigration(platform.env.DB, name);
  return platform.env.DB;
}
async function capture(key: string, options: { target?: TestD1; userId?: string; privacyLevel?: "normal" | "restricted"; sources?: CaptureCommitRequest["sources"]; draftId?: string; rawText?: string } = {}) {
  const text = options.rawText ?? rawText;
  const prepared = await prepareCaptureCommit({
    draftId: options.draftId ?? key, channel: "web", title: "원문 스냅샷", bodyMarkdown: "내 생각은 외부 원문이 아니다.",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: options.privacyLevel ?? "normal", capturedAt: now,
    sources: options.sources ?? [{ kind: "url", rawText: text, contentHash: `sha256:${hash(text)}`, metadata }],
  }, key, now);
  await new D1SourceFoundationRepository(options.target ?? db, options.userId ?? "link-user").commitCapture(prepared);
  return prepared;
}
type Capture = Awaited<ReturnType<typeof capture>>;
function selection(item: Capture, extra: Partial<CreateLinkSnapshotInput> = {}): CreateLinkSnapshotInput {
  return { documentId: item.objectId, expectedRevisionId: item.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0,
    sourceItemIds: [item.sources[1].id], idempotencyKey: `snapshot-${item.objectId}`, now, ...extra };
}
function bootstrap(item: Capture, extra: Partial<CreateLinkSnapshotInput> = {}) {
  return new D1LinkSnapshotRepository(db, "link-user").bootstrapManualSources({ documentId: item.objectId, expectedRevisionId: item.revisionId, idempotencyKey: `bootstrap-${item.objectId}`, now, ...extra });
}
async function snapshotCount(item: Capture) {
  return (await db.prepare("select count(*) as count from v2_link_snapshots where document_object_id=?").bind(item.objectId).first<{ count: number }>())!.count;
}

beforeAll(async () => {
  preMigration = await createPlatform(30);
  db = await createPlatform(30);
  const item = await capture("lease-upgrade");
  leaseDocumentId = item.objectId;
  await db.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
    values ('old-job','link-user',?,?,'analyze','running','old-job-key',3,?,?,'old-hash',?)`).bind(item.captureId, item.objectId, now, item.revisionId, now).run();
  await db.prepare(`insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
    values ('old-run','old-job','link-user','structured','fake','p1','s1','r1','m1','old-hash','running',?)`).bind(now).run();
  await db.prepare(`insert into v2_provider_invocation_leases(job_id,run_id,user_id,object_id,lease_owner,stage,expires_at,acquired_at,updated_at)
    values ('old-job','old-run','link-user',?,'old-worker','analyze','2099-01-01T00:00:00.000Z',?,?)`).bind(item.objectId, now, now).run();
  preservedLease = await db.prepare("select * from v2_provider_invocation_leases where job_id='old-job'").first();
  await applyMigration(db, "0031_v2_link_snapshot_foundation.sql");
}, 60_000);
afterAll(async () => { await Promise.all(platforms.map((platform) => platform.dispose())); });

describe("stable link snapshot hash contract", () => {
  test("uses code-unit Unicode ordering and ignores object insertion order", async () => {
    expect(canonicalLinkJson({ "한": 1, "ä": 2, z: 3, A: 4, "😀": 5 })).toBe('{"A":4,"z":3,"ä":2,"한":1,"😀":5}');
    const base = { kind: "url", contentHash: hash(rawText), rawText, attachments: [] };
    expect(await createLinkSourceFingerprint({ ...base, metadata: { "한": 1, A: { z: 2, "é": 3 } } })).toBe(await createLinkSourceFingerprint({ ...base, metadata: { A: { "é": 3, z: 2 }, "한": 1 } }));
  });
  test("excludes row IDs but hashes stable member key, selected order and exact source metadata", async () => {
    const sourceFingerprint = await createLinkSourceFingerprint({ kind: "url", contentHash: hash(rawText), rawText, metadata, attachments: [] });
    const member = { id: "old-row", sourceItemId: "old-source", snapshotId: "old-snapshot", memberKey: "portable-member", sourceOrder: 0, sourceFingerprint };
    const first = await hashLinkSourceManifest({ members: [member] });
    const restoredMember = { ...member, id: "new-row", sourceItemId: "new-source", snapshotId: "new-snapshot" };
    expect(await hashLinkSourceManifest({ members: [restoredMember] })).toBe(first);
    expect(await hashLinkSourceManifest({ members: [{ ...member, memberKey: "different-key" }] })).not.toBe(first);
    expect(await createLinkSourceFingerprint({ kind: "url", contentHash: hash(rawText), rawText, metadata: { manualLinkV1: { ...metadata.manualLinkV1, role: "caption" } }, attachments: [] })).not.toBe(sourceFingerprint);
    await expect(createLinkSourceFingerprint({ kind: "url", contentHash: hash(rawText), rawText: rawText.trim(), metadata, attachments: [] })).rejects.toMatchObject({ code: "link_source_hash_mismatch" });
  });
  test("rejects duplicate member keys and noncontiguous source order", async () => {
    const member = { memberKey: "a", sourceOrder: 0, sourceFingerprint: "a".repeat(64) };
    await expect(hashLinkSourceManifest({ members: [member, { ...member, sourceOrder: 1 }] })).rejects.toMatchObject({ code: "link_snapshot_invalid" });
    await expect(hashLinkSourceManifest({ members: [{ ...member, sourceOrder: 2 }] })).rejects.toMatchObject({ code: "link_snapshot_invalid" });
  });
});

describe("additive D1 link snapshot foundation", () => {
  test("preserves active pre-0031 leases and recreates all lifecycle guards and indexes", async () => {
    expect(await db.prepare("select * from v2_provider_invocation_leases where job_id='old-job'").first()).toEqual(preservedLease);
    const guards = (await db.prepare("select name from sqlite_master where type='trigger' and name like '%invocation%guard'").all<{ name: string }>()).results;
    expect(guards).toHaveLength(5);
    const indexes = (await db.prepare("pragma index_list(v2_provider_invocation_leases)").all<{ name: string }>()).results;
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining(["uq_v2_provider_invocation_run", "idx_v2_provider_invocation_object_expiry"]));
    await expect(db.prepare("update v2_objects set lifecycle_status='archived' where id=?").bind(leaseDocumentId).run()).rejects.toThrow("legacy_provider_invocation_active");
    await expect(db.prepare("delete from v2_objects where id=?").bind(leaseDocumentId).run()).rejects.toThrow("legacy_provider_invocation_active");
    await expect(db.prepare("update v2_provider_invocation_leases set stage='link_analyze' where job_id='old-job'").run()).resolves.toBeDefined();
    await expect(db.prepare("update v2_provider_invocation_leases set stage='unknown' where job_id='old-job'").run()).rejects.toThrow("CHECK constraint");
  });
  test("fails closed before 0031 without creating snapshots or changing preserved originals", async () => {
    const item = await capture("unmigrated", { target: preMigration });
    const repo = new D1LinkSnapshotRepository(preMigration, "link-user");
    expect(await repo.isAvailable()).toBe(false);
    await expect(repo.getCurrent(item.objectId)).rejects.toMatchObject({ code: "link_snapshot_schema_unavailable" });
    await expect(repo.createSnapshot(selection(item))).rejects.toMatchObject({ code: "link_snapshot_schema_unavailable" });
    expect((await new D1SourceFoundationRepository(preMigration, "link-user").getRecord(item.objectId))?.sources[1].rawText).toBe(rawText);
  });
  test("GET does not bootstrap; explicit bootstrap preserves manualLinkV1 and excludes user memo", async () => {
    const item = await capture("lazy-bootstrap");
    const repo = new D1LinkSnapshotRepository(db, "link-user");
    expect(await repo.getCurrent(item.objectId)).toBeNull();
    expect(await snapshotCount(item)).toBe(0);
    const before = await db.prepare("select * from v2_source_items where capture_id=? order by display_order").bind(item.captureId).all();
    const result = await bootstrap(item);
    expect(result).toMatchObject({ documentRevisionId: item.revisionId, replayed: false, snapshot: { snapshotVersion: 1, parentSnapshotId: null, captureState: "partial" } });
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({ sourceItemId: item.sources[1].id, rawText, metadata, manualLink: metadata.manualLinkV1 });
    expect(JSON.stringify(result)).not.toContain("내 생각은");
    expect((await db.prepare("select * from v2_source_items where capture_id=? order by display_order").bind(item.captureId).all()).results).toEqual(before.results);
    expect(await bootstrap(item)).toMatchObject({ replayed: true, snapshot: { id: result.snapshot.id } });
    expect(await snapshotCount(item)).toBe(1);
    expect(await db.prepare("select count(*) as count from v2_processing_outbox where capture_id=?").bind(item.captureId).first()).toEqual({ count: 0 });
  });
  test("creates snapshot 2 on unchanged body, appends exact originals, and retains stable member keys", async () => {
    const item = await capture("append-snapshot");
    const first = await bootstrap(item);
    const repo = new D1LinkSnapshotRepository(db, "link-user");
    const secondText = "  Negative prompt:\r\n  no blur  ";
    const request = selection(item, { expectedSnapshotId: first.snapshot.id, expectedSnapshotVersion: 1, idempotencyKey: "append-second", newManualSources: [{ rawText: secondText, metadata: makeManualLinkMetadata({ url: "https://www.threads.com/@fixture/post/part-2", role: "negative_prompt", purpose: "prompt", completeness: "partial" }) }] });
    const second = await repo.createSnapshot(request);
    expect(second.snapshot).toMatchObject({ snapshotVersion: 2, parentSnapshotId: first.snapshot.id });
    expect(second.documentRevisionId).toBe(item.revisionId);
    expect(second.members[0].memberKey).toBe(first.members[0].memberKey);
    expect(second.members[0].id).not.toBe(first.members[0].id);
    expect(second.members[1].rawText).toBe(secondText);
    expect(second.snapshot.manifestHash).not.toBe(first.snapshot.manifestHash);
    expect((await repo.getSnapshot(item.objectId, first.snapshot.id))?.members).toHaveLength(1);
    expect(await repo.createSnapshot(request)).toMatchObject({ replayed: true, snapshot: { id: second.snapshot.id } });
    await expect(repo.createSnapshot({ ...request, newManualSources: [{ ...request.newManualSources![0], rawText: "changed" }] })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(await snapshotCount(item)).toBe(2);
    const third = await repo.createSnapshot(selection(item, { expectedSnapshotId: second.snapshot.id, expectedSnapshotVersion: 2, idempotencyKey: "reordered-third", sourceItemIds: second.members.map((m) => m.sourceItemId).reverse() }));
    expect(third.members.map((m) => m.memberKey)).toEqual(second.members.map((m) => m.memberKey).reverse());
  });
  test("preserves empty link-only text without claiming complete external capture", async () => {
    const item = await capture("link-only-snapshot", { rawText: "" });
    expect(await bootstrap(item)).toMatchObject({ snapshot: { captureState: "link_only" }, members: [{ rawText: "" }] });
  });
  test("rejects stale revision/snapshot without orphans and resolves concurrent version CAS", async () => {
    const item = await capture("snapshot-concurrent");
    const repo = new D1LinkSnapshotRepository(db, "link-user");
    await expect(repo.createSnapshot(selection(item, { expectedRevisionId: "stale-revision" }))).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    expect(await snapshotCount(item)).toBe(0);
    const results = await Promise.allSettled([repo.createSnapshot(selection(item, { idempotencyKey: "concurrent-a" })), repo.createSnapshot(selection(item, { idempotencyKey: "concurrent-b" }))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await snapshotCount(item)).toBe(1);
    await expect(repo.createSnapshot(selection(item, { idempotencyKey: "stale-parent" }))).rejects.toMatchObject({ code: "link_snapshot_conflict" });
  });
  test("NOT NULL sentinel rolls back new sources/members if revision CAS is lost just before batch", async () => {
    const item = await capture("snapshot-cas-sentinel");
    const wrapped: D1DatabaseBinding = { prepare: (query) => db.prepare(query), batch: async (statements) => {
      await db.prepare("update v2_documents set link_snapshot_version=1 where object_id=?").bind(item.objectId).run();
      return db.batch(statements);
    } };
    const request = selection(item, { newManualSources: [{ rawText: "must rollback", metadata }] });
    await expect(new D1LinkSnapshotRepository(wrapped, "link-user").createSnapshot(request)).rejects.toMatchObject({ code: "link_snapshot_conflict" });
    expect(await snapshotCount(item)).toBe(0);
    expect(await db.prepare("select count(*) as count from v2_source_items where capture_id=?").bind(item.captureId).first()).toEqual({ count: 2 });
    expect(await db.prepare("select count(*) as count from v2_idempotency_records where operation='link_snapshot.create.v1' and idempotency_key=?").bind(request.idempotencyKey).first()).toEqual({ count: 0 });
  });
  test("scopes selected sources by owner, document and capture, including forged document links", async () => {
    const item = await capture("source-owner-document");
    const other = await capture("source-other-user", { userId: "other-user" });
    const sibling = await capture("source-other-capture");
    for (const foreign of [other, sibling]) {
      await db.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,?,'evidence',99,?)").bind(item.objectId, foreign.sources[1].id, now).run();
      await expect(new D1LinkSnapshotRepository(db, "link-user").createSnapshot(selection(item, { sourceItemIds: [foreign.sources[1].id] }))).rejects.toMatchObject({ code: "link_source_not_found" });
    }
    await expect(new D1LinkSnapshotRepository(db, "other-user").createSnapshot(selection(item))).rejects.toMatchObject({ code: "link_snapshot_not_found" });
    expect(await snapshotCount(item)).toBe(0);
  });
  test("never treats user memo or legacy URL without manual namespace as external source", async () => {
    const legacyText = "https://example.com/old";
    const item = await capture("legacy-url-source", { sources: [{ kind: "url", rawText: legacyText, contentHash: `sha256:${hash(legacyText)}` }] });
    for (const sourceId of item.sources.map((source) => source.id)) await expect(new D1LinkSnapshotRepository(db, "link-user").createSnapshot(selection(item, { sourceItemIds: [sourceId] }))).rejects.toMatchObject({ code: "link_source_not_external" });
    await expect(bootstrap(item)).rejects.toMatchObject({ code: "link_snapshot_invalid" });
  });
  test("respects restricted unlock, foreign owner, deleted and unprojected legacy visibility", async () => {
    const item = await capture("restricted-snapshot", { privacyLevel: "restricted" });
    const repo = new D1LinkSnapshotRepository(db, "link-user");
    await expect(bootstrap(item)).rejects.toMatchObject({ code: "link_snapshot_not_found" });
    const first = await bootstrap(item, { restrictedUnlocked: true });
    expect(await repo.getCurrent(item.objectId)).toBeNull();
    expect((await repo.getCurrent(item.objectId, true))?.snapshot.id).toBe(first.snapshot.id);
    expect(await new D1LinkSnapshotRepository(db, "other-user").getSnapshot(item.objectId, first.snapshot.id, true)).toBeNull();
    await db.prepare("update v2_objects set lifecycle_status='deleted' where id=?").bind(item.objectId).run();
    expect(await repo.getCurrent(item.objectId, true)).toBeNull();
    const hidden = await capture("legacy-hidden-snapshot");
    // Simulate an incomplete persisted legacy import, not a public capture request.
    await db.prepare("update v2_capture_bundles set draft_id='legacy:snapshot-hidden' where id=?").bind(hidden.captureId).run();
    await expect(bootstrap(hidden)).rejects.toMatchObject({ code: "link_snapshot_not_found" });
  });
  test("detects preserved raw text and metadata tampering on read; snapshots and members are immutable", async () => {
    const item = await capture("snapshot-integrity");
    const first = await bootstrap(item);
    await expect(db.prepare("update v2_link_snapshots set manifest_hash=? where id=?").bind("a".repeat(64), first.snapshot.id).run()).rejects.toThrow("link_snapshot_immutable");
    await expect(db.prepare("update v2_link_snapshot_sources set source_order=9 where id=?").bind(first.members[0].id).run()).rejects.toThrow("link_snapshot_source_immutable");
    await db.prepare("update v2_source_items set raw_text='tampered' where id=?").bind(item.sources[1].id).run();
    await expect(new D1LinkSnapshotRepository(db, "link-user").getCurrent(item.objectId)).rejects.toMatchObject({ code: "link_source_hash_mismatch" });
    await db.prepare("update v2_source_items set raw_text=?,source_metadata=? where id=?").bind(rawText, JSON.stringify({ manualLinkV1: { ...metadata.manualLinkV1, role: "caption" } }), item.sources[1].id).run();
    await expect(new D1LinkSnapshotRepository(db, "link-user").getCurrent(item.objectId)).rejects.toMatchObject({ code: "link_snapshot_integrity_invalid" });
  });
  test("emits snapshot/member change events without scheduling analysis or overwriting document text", async () => {
    const item = await capture("snapshot-events");
    const first = await bootstrap(item);
    const changes = (await db.prepare("select aggregate_kind,aggregate_id from v2_change_events where aggregate_id in (?,?)").bind(first.snapshot.id, first.members[0].id).all()).results;
    expect(changes).toEqual(expect.arrayContaining([{ aggregate_kind: "link_snapshot", aggregate_id: first.snapshot.id }, { aggregate_kind: "link_snapshot_source", aggregate_id: first.members[0].id }]));
    const record = await new D1SourceFoundationRepository(db, "link-user").getRecord(item.objectId);
    expect(record?.bodyMarkdown).toBe("내 생각은 외부 원문이 아니다.");
    expect(await db.prepare("select count(*) as count from v2_processing_jobs where capture_id=?").bind(item.captureId).first()).toEqual({ count: 0 });
  });
  test("keeps committed attachment identity and caller-selected order without inferring an image-prompt pair", async () => {
    const id = "snapshot-synthetic-image";
    const attachmentHash = hash("synthetic image bytes");
    const attachments = new D1AttachmentReservationRepository(db, "link-user");
    await attachments.create({ id, userId: "link-user", objectKey: buildPrivateOriginalKey({ userId: "link-user", reservationId: id, reservedAt: now }), filename: "구도.png", expectedSize: 21, expectedMimeType: "image/png", expectedSha256: attachmentHash, expiresAt: "2099-01-01T00:00:00.000Z" }, now);
    // Storage-only fixture: emulate the verifier's completed state; no external bytes or OCR.
    await attachments.markUploadedUnverified(id);
    await attachments.markVerified(id, now);
    const item = await capture("snapshot-with-image", { sources: [
      { kind: "url", rawText, contentHash: `sha256:${hash(rawText)}`, metadata },
      { kind: "image", rawText: null, contentHash: `sha256:${attachmentHash}`, attachmentId: id },
    ] });
    const result = await new D1LinkSnapshotRepository(db, "link-user").createSnapshot(selection(item, { sourceItemIds: [item.sources[2].id, item.sources[1].id] }));
    expect(result.members.map((member) => member.kind)).toEqual(["image", "url"]);
    expect(result.members[0]).toMatchObject({ rawText: null, manualLink: null, attachments: [{ id, sha256: attachmentHash, mimeType: "image/png" }] });
    expect(await db.prepare("select count(*) as count from v2_link_fragment_evidence").first()).toEqual({ count: 0 });
  });
  test("SQL rejects cross-owner members, wrong job manifest and foreign fragment evidence", async () => {
    const item = await capture("sql-owner-guards");
    const other = await capture("sql-owner-guards-other", { userId: "other-user" });
    const first = await bootstrap(item);
    const second = await new D1LinkSnapshotRepository(db, "other-user").createSnapshot(selection(other));
    await expect(db.prepare("insert into v2_link_snapshot_sources(id,user_id,snapshot_id,source_item_id,member_key,source_order,source_fingerprint) values ('forged-member','link-user',?,?,'forged',2,?)").bind(first.snapshot.id, other.sources[1].id, "a".repeat(64)).run()).rejects.toThrow("link_snapshot_source_owner_mismatch");
    await expect(db.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at,input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version)
      values ('wrong-link-job','link-user',?,?,'link_analyze','queued','wrong-link-job',3,?,?,'input',?,?,?,'link-source-manifest.v1')`).bind(item.captureId, item.objectId, now, item.revisionId, now, first.snapshot.id, "b".repeat(64)).run()).rejects.toThrow("link_job_snapshot_mismatch");
    const fragment = (id: string, memberId: string) => db.prepare(`insert into v2_link_fragments(id,user_id,document_object_id,snapshot_id,primary_member_id,fragment_key,role,source_class,text_start,text_end,raw_text,raw_text_hash,completeness,display_order,review_status,created_at)
      values (?,'link-user',?,?,?,?,'prompt','source_extract',0,1,' ',?,'selection_unverified',0,'proposed',?)`).bind(id, item.objectId, first.snapshot.id, memberId, id, hash(" "), now);
    await expect(fragment("forged-fragment", second.members[0].id).run()).rejects.toThrow("link_fragment_owner_mismatch");
    await fragment("valid-fragment", first.members[0].id).run();
    await expect(db.prepare(`insert into v2_link_fragment_evidence(id,user_id,fragment_id,member_id,relation_kind,evidence_method,display_order,created_at)
      values ('forged-evidence','link-user','valid-fragment',?,'supports','ai_proposed',0,?)`).bind(second.members[0].id, now).run()).rejects.toThrow("link_fragment_evidence_owner_mismatch");
    await expect(db.prepare("update v2_link_fragments set raw_text='x' where id='valid-fragment'").run()).rejects.toThrow("link_fragment_content_immutable");
    await expect(db.prepare("update v2_link_fragments set review_status='confirmed',locked_by_user=1,state_version=2 where id='valid-fragment'").run()).resolves.toBeDefined();
    expect(await db.prepare("select review_status,locked_by_user,state_version from v2_link_fragments where id='valid-fragment'").first()).toEqual({ review_status: "confirmed", locked_by_user: 1, state_version: 2 });
  });
  test("keeps AI interpretation separate from verbatim source extraction at the SQL boundary", async () => {
    const item = await capture("fragment-content-checks");
    const first = await bootstrap(item);
    const statement = (id: string, sourceClass: string, raw: string | null, derived: string | null, start: number | null, end: number | null) => db.prepare(`insert into v2_link_fragments(id,user_id,document_object_id,snapshot_id,primary_member_id,fragment_key,role,source_class,text_start,text_end,raw_text,raw_text_hash,derived_text,completeness,display_order,review_status,created_at)
      values (?,'link-user',?,?,?,?,'insight',?,?,?,?,?,?,'selection_unverified',0,'proposed',?)`).bind(id, item.objectId, first.snapshot.id, first.members[0].id, id, sourceClass, start, end, raw, raw === null ? null : hash(raw), derived, now);
    await expect(statement("source-with-derived", "source_extract", " ", "AI wording", 0, 1).run()).rejects.toThrow("CHECK constraint");
    await expect(statement("interpretation-with-raw", "ai_interpretation", " ", "AI wording", 0, 1).run()).rejects.toThrow("CHECK constraint");
    await expect(statement("extract-without-range", "source_extract", " ", null, null, null).run()).rejects.toThrow("CHECK constraint");
    await expect(statement("valid-interpretation", "ai_interpretation", null, "External-source summary, not my belief", null, null).run()).resolves.toBeDefined();
  });
});
