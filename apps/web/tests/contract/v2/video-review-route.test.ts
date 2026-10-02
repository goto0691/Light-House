import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("@/lib/v2/ai/gemini-role-gateways", async (original) => ({
  ...await original<typeof import("@/lib/v2/ai/gemini-role-gateways")>(), createGeminiRoleGateways: () => ({ mainAnalyzer: { generate: harness.generate }, groundedResearch: {} }),
}));

import { POST as analyzeVideo } from "@/app/api/v2/records/[recordId]/links/video-analysis/route";
import { GET, POST } from "@/app/api/v2/records/[recordId]/video-reviews/[sourceItemId]/route";
import { VIDEO_ANALYSIS_CONTRACT } from "@/lib/v2/ai/video-analysis-v1";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import type { LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { VideoReviewProjection, VideoReviewRequest } from "@/lib/v2/domain/video-review-v1";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1VideoReviewRepository } from "@/lib/v2/infrastructure/d1/video-review-repository";
import type { D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, envelopeCanonicalRow, sha256Hex, type ExportScopeV1 } from "@/lib/v2/portability/portability-contract-v1";
import { createRestoreDryRun, importVerifiedBundle, rollbackRestoreBatch, validateReferenceClosure, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { createBackupSnapshot } from "@/lib/v2/portability/backup-snapshot-v1";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { queryPlanFromSearchParams } from "@/lib/v2/retrieval/search-params";
import { LinkSqlite } from "../../support/link-sqlite";

/** D1 serializes transactions; serialize this SQLite adapter too, so the two
 * parallel preflight reads can race without nesting SQLite transactions. */
class ReviewSqlite extends LinkSqlite {
  private tail = Promise.resolve();
  override async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    const task = this.tail.then(() => super.batch<T>(statements));
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}

let db: ReviewSqlite;
const OWNER = "link-owner";
beforeEach(() => {
  db = new ReviewSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1"); vi.stubEnv("GEMINI_API_KEY", "synthetic-offline-key");
  harness.session.mockResolvedValue({ sessionId: "owner-session", userId: OWNER, email: "owner@example.test", expiresAt: Date.now() + 100_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
  harness.generate.mockImplementation(async (request: V2StructuredModelRequest) => ({ data: {
    contract_version: VIDEO_ANALYSIS_CONTRACT, summary: "ORBITAL 영상 요약", segments: [{ start_seconds: 1, end_seconds: 9, title: "도입", summary: "ORBITAL 표지판" }],
    speech: [{ start_seconds: 2, end_seconds: 4, speaker: null, text: "음성 내용" }], screen_text: [{ start_seconds: 5, end_seconds: 5, text: "ORBITAL 화면 글" }],
    observed_end_seconds: 12, limitations: ["합성 한계"],
  }, role: "main_analyzer", modelId: "fake:video", inputHash: request.inputHash, outputHash: "synthetic", latencyMs: 3 }));
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function seed() {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Synthetic video", bodyMarkdown: "PRIVATE MEMO",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(),
    sources: [{ kind: "url", rawText: "", contentHash: `sha256:${await linkSha256Hex("")}`, metadata: makeManualLinkMetadata({ url: "https://youtu.be/jNQXAC9IVRw", purpose: "video_note" }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, OWNER).commitCapture(capture);
  const source = db.sql.prepare("select id from v2_source_items where capture_id=? and item_kind='url'").get(capture.captureId) as { id: string };
  const response = await analyzeVideo(new Request(`https://lighthouse.test/api/v2/records/${capture.objectId}/links/video-analysis`, { method: "POST",
    headers: { Origin: "https://lighthouse.test", "Content-Type": "application/json" }, body: JSON.stringify({ sourceItemId: source.id, expectedRevisionId: capture.revisionId,
      expectedSnapshotId: null, expectedSnapshotVersion: 0, startSeconds: 0, endSeconds: 60, idempotencyKey: crypto.randomUUID() }) }), { params: Promise.resolve({ recordId: capture.objectId }) });
  expect(response.status).toBe(201);
  const links = ((await response.json()) as { links: LinkPresentationV1 }).links;
  const member = links.members.find((member) => member.videoAnalysis)!;
  return { capture, sourceId: source.id, noteId: member.sourceItemId, contentHash: member.contentHash, links };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function request(f: Fixture, body?: Record<string, unknown>) {
  return new Request(`https://lighthouse.test/api/v2/records/${f.capture.objectId}/video-reviews/${f.noteId}`, body ? { method: "POST", headers: { Origin: "https://lighthouse.test", "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
}
function input(f: Fixture, overrides: Partial<VideoReviewRequest> = {}): VideoReviewRequest {
  return { kind: "segment", index: 0, action: "confirm", expectedStateVersion: 0, expectedRevisionId: f.capture.revisionId,
    expectedSnapshotId: f.links.currentSnapshotId!, expectedSnapshotVersion: f.links.currentSnapshotVersion, contentHash: f.contentHash, idempotencyKey: crypto.randomUUID(), ...overrides };
}
function params(f: Fixture) { return { params: Promise.resolve({ recordId: f.capture.objectId, sourceItemId: f.noteId }) }; }
function post(f: Fixture, body: Record<string, unknown>) { return POST(request(f, body), params(f)); }
async function read(f: Fixture) { const response = await GET(request(f), params(f)); return { response, reviews: ((await response.json()) as { reviews: VideoReviewProjection }).reviews }; }
function count(table: string) { return (db.sql.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n; }

async function canonicalBundle(exportId: string): Promise<VerifiedExportBundle> {
  const scope: ExportScopeV1 = { objects: "all", privacyLevels: ["normal"], includeTrash: true, includeHistory: true, includeOriginals: false };
  const rows = new Map<string, readonly Record<string, unknown>[]>();
  for (const descriptor of CANONICAL_TABLES_V1) {
    const query = descriptor.query(OWNER, scope);
    rows.set(descriptor.table, (await db.prepare(query.sql).bind(...query.bindings).all<Record<string, unknown>>()).results);
  }
  validateReferenceClosure(rows);
  const digest = sha256Hex(canonicalJson([...rows]));
  return { archiveSha256: digest, entries: new Map(), rowsByTable: new Map([...rows].map(([name, records]) => [name, records.map((row) => envelopeCanonicalRow(row, exportId))])),
    manifest: { format: "lighthouse-export", version: 1, profile: "migration", exportId, createdAt: new Date().toISOString(),
      sourceAppVersion: "sqlite-video-review-contract", schemaVersion: "v2-032", userTimezone: "Asia/Seoul", scope, counts: {}, files: [],
      rootHash: `sha256:${digest}`, baseSequence: 0, endSequence: 0, warnings: [] } };
}

function memoryBucket(): R2BucketBinding {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; options: Parameters<R2BucketBinding["put"]>[2] }>();
  const metadata = (key: string, object: NonNullable<ReturnType<typeof objects.get>>) => ({ key, size: object.bytes.byteLength, checksums: {}, httpMetadata: object.options?.httpMetadata, customMetadata: object.options?.customMetadata });
  return {
    async put(key, value, options) {
      const object = { bytes: new Uint8Array(await new Response(value as BodyInit).arrayBuffer()), options }; objects.set(key, object);
      return metadata(key, object);
    },
    async head(key) { const object = objects.get(key); return object ? metadata(key, object) : null; },
    async get(key) {
      const object = objects.get(key);
      return object ? { ...metadata(key, object), body: new Blob([object.bytes]).stream(), arrayBuffer: async () => object.bytes.slice().buffer } : null;
    },
    async delete(keys) { for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key); },
  };
}

async function restoredVideoCollision() {
  const f = await seed(); await post(f, input(f));
  const bundle = await canonicalBundle("video-repeat-owner-collision");
  const target = new ReviewSqlite(32);
  const bucket = new Proxy({} as R2BucketBinding, { get() { throw new Error("Unexpected object-store access"); } });
  try {
    const occupy = await createRestoreDryRun(target, OWNER, bundle);
    await importVerifiedBundle({ db: target, bucket, userId: OWNER, bundle, expectedDryRunHash: occupy.dryRunHash, idempotencyKey: "owner-repeat-occupy" });
    const originalPlan = await createRestoreDryRun(target, "other-owner", bundle);
    const originalResult = await importVerifiedBundle({ db: target, bucket, userId: "other-owner", bundle, expectedDryRunHash: originalPlan.dryRunHash, idempotencyKey: "owner-repeat-original" });
    return { f, bundle, target, bucket, originalPlan, originalResult };
  } catch (error) { target.sql.close(); throw error; }
}

describe("video item user decisions with real SQLite and HTTP", () => {
  test("confirm, reopen, then reject appends user decisions while immutable source, memo and search provenance stay intact", async () => {
    const f = await seed(); const raw = db.sql.prepare("select * from v2_source_items where id=?").get(f.noteId);
    expect((await read(f)).reviews.items).toHaveLength(5);
    vi.stubEnv("FLAG_V2_AI", "0"); // Review is a local user action and makes no provider call.
    const first = await post(f, input(f)); expect(first.status).toBe(201); expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect((await read(f)).reviews.items.find((item) => item.kind === "segment")).toMatchObject({ status: "confirmed", stateVersion: 1 });
    expect((await post(f, input(f, { action: "reject", expectedStateVersion: 1 }))).status).toBe(201);
    expect((await read(f)).reviews.items.find((item) => item.kind === "segment")).toMatchObject({ status: "rejected", stateVersion: 2 });
    expect(count("v2_review_items")).toBe(2); expect(count("v2_review_receipts")).toBe(2);
    expect(await new D1ReviewRepository(db, OWNER).listOpenRecords()).toEqual([]);
    expect(db.sql.prepare("select * from v2_source_items where id=?").get(f.noteId)).toEqual(raw);
    expect(db.sql.prepare("select body_markdown from v2_documents where object_id=?").get(f.capture.objectId)).toEqual({ body_markdown: "PRIVATE MEMO" });
    const found = await new D1RetrievalRepository(db, OWNER).searchPage(queryPlanFromSearchParams(new URLSearchParams({ q: "ORBITAL" })));
    expect(found.results.find((result) => result.recordId === f.capture.objectId)?.matches?.some((match) => match.origin === "ai_interpretation")).toBe(true);
    expect(harness.generate).toHaveBeenCalledTimes(1); expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test("exact receipt replay is idempotent even with reordered body keys; reuse for another action conflicts", async () => {
    const f = await seed(), body = input(f); expect((await post(f, body)).status).toBe(201);
    const response = await post(f, Object.fromEntries(Object.entries(body).reverse())); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ receipt: { replayed: true, status: "confirmed", stateVersion: 1 } });
    expect((await post(f, { ...body, action: "reject" })).status).toBe(409); expect(count("v2_review_items")).toBe(1);
  });

  test("two concurrent decisions on the same item cannot overwrite each other", async () => {
    const f = await seed();
    const results = await Promise.all([post(f, input(f)), post(f, input(f, { action: "reject" }))]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(count("v2_review_items")).toBe(1); expect(count("v2_review_receipts")).toBe(1);
  });

  test("a successful old receipt can be read without repeating a decision after record snapshot changes", async () => {
    const f = await seed(), body = input(f); await post(f, body);
    await new D1LinkSnapshotRepository(db, OWNER).createSnapshot({ documentId: f.capture.objectId, expectedRevisionId: f.capture.revisionId,
      expectedSnapshotId: f.links.currentSnapshotId, expectedSnapshotVersion: f.links.currentSnapshotVersion, sourceItemIds: [f.sourceId], idempotencyKey: "remove-current-note" });
    expect((await read(f)).reviews.canReview).toBe(false);
    expect((await post(f, input(f, { action: "reject", expectedStateVersion: 1 }))).status).toBe(409);
    expect((await post(f, body)).status).toBe(200); expect(count("v2_review_items")).toBe(1);
  });

  test("owner, locked and unlock boundaries also protect receipt replay", async () => {
    const f = await seed(), body = input(f); await post(f, body);
    harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 100_000 });
    expect((await GET(request(f), params(f))).status).toBe(404); expect((await post(f, body)).status).toBe(404);
    harness.session.mockResolvedValue({ sessionId: "owner", userId: OWNER, email: "owner@example.test", expiresAt: Date.now() + 100_000 });
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(f.capture.objectId);
    expect((await GET(request(f), params(f))).status).toBe(423); expect((await post(f, body)).status).toBe(423);
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await GET(request(f), params(f))).status).toBe(200); expect((await post(f, body)).status).toBe(200);
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() - 1).toISOString() });
    expect((await post(f, body)).status).toBe(423);
  });

  test.each(["snapshot", "privacy", "membership", "raw_text"])("the transaction rechecks %s after preflight and rolls back all decision rows", async (race) => {
    const f = await seed();
    db.beforeBatch = () => {
      db.beforeBatch = null;
      if (race === "snapshot") db.sql.prepare("update v2_documents set link_snapshot_version=link_snapshot_version+1 where object_id=?").run(f.capture.objectId);
      if (race === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(f.capture.objectId);
      if (race === "membership") db.sql.prepare("update v2_documents set current_link_snapshot_id=null,link_snapshot_version=link_snapshot_version+1 where object_id=?").run(f.capture.objectId);
      if (race === "raw_text") db.sql.prepare("update v2_source_items set raw_text='tampered' where id=?").run(f.noteId);
    };
    expect((await post(f, input(f))).status).toBe(race === "privacy" ? 423 : race === "raw_text" ? 404 : 409);
    expect(count("v2_review_items")).toBe(0); expect(count("v2_review_receipts")).toBe(0);
  });

  test("wrong source, hash, item index, stale version, unknown fields and disabled writes never create a decision", async () => {
    const f = await seed();
    expect((await post(f, input(f, { contentHash: `sha256:${"a".repeat(64)}` }))).status).toBe(409);
    expect((await post(f, input(f, { index: 999 }))).status).toBe(400);
    expect((await post(f, input(f, { expectedRevisionId: "stale" }))).status).toBe(409);
    expect((await post(f, { ...input(f), correctedText: "replace the source" })).status).toBe(400);
    const original = { ...f, noteId: f.sourceId }; expect((await post(original, input(f))).status).toBe(404);
    vi.stubEnv("FLAG_V2_WRITE", "0"); expect((await post(f, input(f))).status).toBe(503);
    expect((await read(f)).reviews.canReview).toBe(false); expect(count("v2_review_items")).toBe(0);
  });

  test("canonical export includes both append-only decisions and receipts without source IDs in payload", async () => {
    const f = await seed(); await post(f, input(f)); await post(f, input(f, { action: "reject", expectedStateVersion: 1 }));
    const scope: ExportScopeV1 = { objects: "all", privacyLevels: ["normal", "sensitive"], includeTrash: true, includeHistory: true, includeOriginals: false };
    for (const name of ["v2_review_items", "v2_review_receipts"]) {
      const query = CANONICAL_TABLES_V1.find((descriptor) => descriptor.table === name)!.query(OWNER, scope);
      const rows = await db.prepare(query.sql).bind(...query.bindings).all<Record<string, unknown>>();
      expect(rows.results).toHaveLength(2);
      if (name === "v2_review_items") for (const row of rows.results) {
        expect(String(row.payload_json)).not.toContain(f.noteId); expect(String(row.payload_json)).not.toContain(f.sourceId);
        expect(JSON.parse(String(row.payload_json))).toMatchObject({ contract: "video-item-review.v1", itemKey: "segment:0" });
      }
    }
    const normalOnly: ExportScopeV1 = { ...scope, privacyLevels: ["normal"] };
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(f.capture.objectId);
    for (const name of ["v2_review_items", "v2_review_receipts"]) {
      const query = CANONICAL_TABLES_V1.find((descriptor) => descriptor.table === name)!.query(OWNER, normalOnly);
      expect((await db.prepare(query.sql).bind(...query.bindings).all()).results).toHaveLength(0);
    }
  });

  test("malformed or duplicated decision history fails closed instead of presenting a false user confirmation", async () => {
    const f = await seed(); await post(f, input(f));
    db.sql.exec("update v2_review_receipts set result_status='accepted'");
    const response = await GET(request(f), params(f)); expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "video_review_history_invalid" } });
    expect(count("v2_review_items")).toBe(1);
  });

  test("full canonical restore, repeat restore and a collided owner restore preserve source identity and both judgement revisions", async () => {
    const f = await seed(); await post(f, input(f)); await post(f, input(f, { action: "reject", expectedStateVersion: 1 }));
    const bundle = await canonicalBundle("video-review-canonical-restore");
    const target = new ReviewSqlite(32);
    const noObjects = new Proxy({} as R2BucketBinding, { get() { throw new Error("Unexpected object-store access in text-only restore"); } });
    try {
      // Occupy the incoming IDs under the original owner, forcing a real source,
      // record and review-ID fork when restoring into the second owner.
      const occupy = await createRestoreDryRun(target, OWNER, bundle);
      await importVerifiedBundle({ db: target, bucket: noObjects, userId: OWNER, bundle, expectedDryRunHash: occupy.dryRunHash, idempotencyKey: "video-review-occupy" });
      const beforeRepeat = target.sql.prepare("select * from v2_review_items order by id").all();
      const repeat = await createRestoreDryRun(target, OWNER, bundle); expect(repeat.counts).toMatchObject({ create: 0, fork: 0, conflict: 0, invalid: 0 });
      await importVerifiedBundle({ db: target, bucket: noObjects, userId: OWNER, bundle, expectedDryRunHash: repeat.dryRunHash, idempotencyKey: "video-review-repeat" });
      expect(target.sql.prepare("select * from v2_review_items order by id").all()).toEqual(beforeRepeat);
      const dryRun = await createRestoreDryRun(target, "other-owner", bundle);
      expect(dryRun.counts.fork).toBeGreaterThan(0);
      await expect(importVerifiedBundle({ db: target, bucket: noObjects, userId: "other-owner", bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "video-review-first" })).resolves.toMatchObject({ status: "succeeded" });
      const restoredSource = target.sql.prepare("select s.id,l.document_object_id from v2_source_items s join v2_document_source_links l on l.source_item_id=s.id where s.user_id='other-owner' and s.item_kind='transcript'").get() as { id: string; document_object_id: string };
      expect(restoredSource.id).not.toBe(f.noteId); expect(restoredSource.document_object_id).not.toBe(f.capture.objectId);
      const view = await new D1VideoReviewRepository(target, "other-owner").project(restoredSource.document_object_id, restoredSource.id, { writeEnabled: true });
      expect(view.items.find((item) => item.kind === "segment")).toMatchObject({ status: "rejected", stateVersion: 2 });
      expect(view.contentHash).toBe(f.contentHash); expect(view.canReview).toBe(true);
      expect(target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
    } finally { target.sql.close(); }
  });

  test("collision restore remaps existing non-null review receipt and evidence polymorphic targets exactly once", async () => {
    const f = await seed(); await post(f, input(f));
    // Existing generic review receipts may have a non-null review target. This
    // is a historical canonical fixture, not the new video receipt contract.
    db.sql.exec("update v2_review_receipts set target_id=review_item_id");
    const now = new Date().toISOString();
    db.sql.prepare("insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,origin,definition,created_at,updated_at) values ('video-type',?,'video_type','영상','document','user_created','합성 유형',?,?)").run(OWNER, now, now);
    db.sql.prepare("insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,created_at,updated_at) values ('video-assignment',?,?,'video-type','primary','user','accepted',?,?)").run(OWNER, f.capture.objectId, now, now);
    db.sql.prepare("insert into v2_evidence_refs(id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at) values ('video-evidence',?,'type_assignment','video-assignment',?,'transcript_time',?,?)").run(OWNER, f.noteId, JSON.stringify({ startSeconds: 1, endSeconds: 9 }), now);
    const bundle = await canonicalBundle("video-polymorphic-collision");
    const target = new ReviewSqlite(32);
    const noObjects = new Proxy({} as R2BucketBinding, { get() { throw new Error("Unexpected object-store access"); } });
    try {
      for (const userId of [OWNER, "other-owner"]) {
        const dryRun = await createRestoreDryRun(target, userId, bundle);
        await importVerifiedBundle({ db: target, bucket: noObjects, userId, bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: `polymorphic-${userId}` });
      }
      const receipt = target.sql.prepare("select review_item_id,target_id from v2_review_receipts where user_id='other-owner'").get() as { review_item_id: string; target_id: string };
      const evidence = target.sql.prepare("select target_id,source_item_id from v2_evidence_refs where user_id='other-owner'").get() as { target_id: string; source_item_id: string };
      const assignment = target.sql.prepare("select id from v2_object_type_assignments where user_id='other-owner'").get() as { id: string };
      const source = target.sql.prepare("select id from v2_source_items where user_id='other-owner' and item_kind='transcript'").get() as { id: string };
      expect({ receiptTarget: receipt.target_id, evidenceTarget: evidence.target_id, evidenceSource: evidence.source_item_id })
        .toEqual({ receiptTarget: receipt.review_item_id, evidenceTarget: assignment.id, evidenceSource: source.id });
      expect(target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
    } finally { target.sql.close(); }
  });

  test("an incremental backup after the initial full backup retains new decisions and restores their latest state", async () => {
    const f = await seed(), bucket = memoryBucket();
    const base = await createBackupSnapshot({ db, bucket, userId: OWNER, kind: "full" });
    await post(f, input(f)); await post(f, input(f, { action: "reject", expectedStateVersion: 1 }));
    const delta = await createBackupSnapshot({ db, bucket, userId: OWNER, kind: "incremental" });
    expect(delta.baseSnapshotId).toBe(base.snapshotId);
    const bundle = await materializeVerifiedBackup({ db, bucket, userId: OWNER, snapshotId: delta.snapshotId });
    expect(bundle.rowsByTable.get("v2_review_items")).toHaveLength(2); expect(bundle.rowsByTable.get("v2_review_receipts")).toHaveLength(2);
    const target = new ReviewSqlite(32);
    try {
      const plan = await createRestoreDryRun(target, OWNER, bundle);
      await importVerifiedBundle({ db: target, bucket, userId: OWNER, bundle, expectedDryRunHash: plan.dryRunHash, idempotencyKey: "video-review-incremental" });
      const result = await new D1VideoReviewRepository(target, OWNER).project(f.capture.objectId, f.noteId, { writeEnabled: true });
      expect(result.items.find((item) => item.kind === "segment")).toMatchObject({ status: "rejected", stateVersion: 2 });
      expect(result.contentHash).toBe(f.contentHash); expect(target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
    } finally { target.sql.close(); }
  });

  test("repeated owner-collision restore reuses the previously forked canonical graph without duplicate records", async () => {
    const fixture = await restoredVideoCollision();
    try {
      const before = fixture.target.sql.prepare("select * from v2_objects order by id").all();
      const repeat = await createRestoreDryRun(fixture.target, "other-owner", fixture.bundle);
      expect(repeat.counts).toMatchObject({ create: 0, fork: 0, conflict: 0, invalid: 0 });
      await importVerifiedBundle({ db: fixture.target, bucket: fixture.bucket, userId: "other-owner", bundle: fixture.bundle, expectedDryRunHash: repeat.dryRunHash, idempotencyKey: "owner-repeat-second" });
      expect(fixture.target.sql.prepare("select * from v2_objects order by id").all()).toEqual(before);
    } finally { fixture.target.sql.close(); }
  });

  test("the original restore gesture replays its original result after the target state changes as a result of that restore", async () => {
    const fixture = await restoredVideoCollision();
    try {
      await expect(importVerifiedBundle({ db: fixture.target, bucket: fixture.bucket, userId: "other-owner", bundle: fixture.bundle,
        expectedDryRunHash: fixture.originalPlan.dryRunHash, idempotencyKey: "owner-repeat-original" }))
        .resolves.toMatchObject({ batchId: fixture.originalResult.batchId, status: "succeeded", replayed: true, dryRun: { dryRunHash: fixture.originalPlan.dryRunHash } });
    } finally { fixture.target.sql.close(); }
  });

  test.each(["content", "owner", "foreign-map", "missing-review"])("a historical collision map cannot overwrite or reuse a target after %s drift", async (drift) => {
    const fixture = await restoredVideoCollision();
    try {
      const object = fixture.target.sql.prepare("select id from v2_objects where user_id='other-owner' and object_kind='document'").get() as { id: string };
      if (drift === "content") fixture.target.sql.prepare("update v2_documents set title='USER CHANGED TITLE' where object_id=?").run(object.id);
      if (drift === "owner") fixture.target.sql.prepare("update v2_objects set user_id=? where id=?").run(OWNER, object.id);
      if (drift === "missing-review") fixture.target.sql.exec("delete from v2_review_items where user_id='other-owner'");
      if (drift === "foreign-map") {
        const stored = fixture.target.sql.prepare("select collision_map_json from v2_restore_batches where id=?").get(fixture.originalResult.batchId) as { collision_map_json: string };
        const mappings = JSON.parse(stored.collision_map_json); mappings[`v2_objects\0${fixture.f.capture.objectId}`] = fixture.f.capture.objectId;
        fixture.target.sql.prepare("update v2_restore_batches set collision_map_json=? where id=?").run(JSON.stringify(mappings), fixture.originalResult.batchId);
      }
      const before = fixture.target.sql.prepare("select * from v2_objects order by id").all();
      const plan = await createRestoreDryRun(fixture.target, "other-owner", fixture.bundle);
      expect(plan.counts.conflict).toBeGreaterThan(0);
      await expect(importVerifiedBundle({ db: fixture.target, bucket: fixture.bucket, userId: "other-owner", bundle: fixture.bundle,
        expectedDryRunHash: plan.dryRunHash, idempotencyKey: `owner-drift-${drift}` })).rejects.toMatchObject({ code: "restore_conflict" });
      expect(fixture.target.sql.prepare("select * from v2_objects order by id").all()).toEqual(before);
      if (drift === "content") expect(fixture.target.sql.prepare("select title from v2_documents where object_id=?").get(object.id)).toEqual({ title: "USER CHANGED TITLE" });
    } finally { fixture.target.sql.close(); }
  });

  test("rolled-back restore mappings never authorize target reuse and another owner cannot inherit the collision map", async () => {
    const fixture = await restoredVideoCollision();
    try {
      await expect(rollbackRestoreBatch({ db: fixture.target, bucket: fixture.bucket, userId: "other-owner", batchId: fixture.originalResult.batchId })).resolves.toMatchObject({ status: "rolled_back" });
      expect(fixture.target.sql.prepare("select count(*) as n from v2_objects where user_id='other-owner'").get()).toEqual({ n: 0 });
      const plan = await createRestoreDryRun(fixture.target, "other-owner", fixture.bundle);
      expect(plan.counts.fork).toBeGreaterThan(0); expect(plan.counts.conflict).toBe(0);
      const originalOwner = await createRestoreDryRun(fixture.target, OWNER, fixture.bundle);
      expect(originalOwner.counts).toMatchObject({ create: 0, fork: 0, conflict: 0 });
      expect(fixture.target.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
    } finally { fixture.target.sql.close(); }
  });

  test.each(["archive", "approval", "manifest"])("an existing restore key still rejects changed %s request binding", async (binding) => {
    const fixture = await restoredVideoCollision();
    try {
      const bundle = binding === "archive" ? { ...fixture.bundle, archiveSha256: "a".repeat(64) }
        : binding === "manifest" ? { ...fixture.bundle, manifest: { ...fixture.bundle.manifest, rootHash: `sha256:${"b".repeat(64)}` } } : fixture.bundle;
      await expect(importVerifiedBundle({ db: fixture.target, bucket: fixture.bucket, userId: "other-owner", bundle,
        expectedDryRunHash: binding === "approval" ? "wrong-approval" : fixture.originalPlan.dryRunHash, idempotencyKey: "owner-repeat-original" }))
        .rejects.toMatchObject({ code: "idempotency_conflict" });
    } finally { fixture.target.sql.close(); }
  });
});
