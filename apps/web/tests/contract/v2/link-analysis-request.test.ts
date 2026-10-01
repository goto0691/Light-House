import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn(), gateways: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings, getV2ArchiveAssetsBucket: () => undefined }));
vi.mock("@/lib/v2/ai/gemini-role-gateways", () => ({ createGeminiRoleGateways: harness.gateways }));

import { POST as analyze } from "@/app/api/v2/records/[recordId]/links/analyze/route";
import { POST as saveSnapshot } from "@/app/api/v2/records/[recordId]/links/snapshots/route";
import { POST as processJobs } from "@/app/api/v2/processing/run/route";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import type { LinkSnapshotReceipt } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { LinkSqlite, seedLinkRecord, exactLinkGateway } from "../../support/link-sqlite";

let db: LinkSqlite;
let provider: ReturnType<typeof exactLinkGateway>;
type JobReceipt = { jobId: string; status: string; replayed: boolean };
beforeEach(() => {
  db = new LinkSqlite();
  provider = exactLinkGateway();
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-not-a-key"); vi.stubEnv("CRON_SECRET", "synthetic-runner-secret");
  harness.session.mockResolvedValue({ sessionId: "link-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 100_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
  harness.gateways.mockReturnValue({ mainAnalyzer: provider, groundedResearch: provider });
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function post(path: string, body: unknown, headers = { Origin: "https://lighthouse.test", "Content-Type": "application/json" }) {
  return new Request(`https://lighthouse.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
function analysisBody(f: Awaited<ReturnType<typeof seedLinkRecord>>, key = "gesture-1") {
  return { expectedRevisionId: f.capture.revisionId, expectedSnapshotId: f.projection!.snapshot.id, expectedManifestHash: f.projection!.snapshot.manifestHash, idempotencyKey: key };
}
function analysisRoute(f: Awaited<ReturnType<typeof seedLinkRecord>>, body: Record<string, unknown> = analysisBody(f)) {
  return analyze(post(`/api/v2/records/${f.capture.objectId}/links/analyze`, body), { params: Promise.resolve({ recordId: f.capture.objectId }) });
}
function runner(secret = "synthetic-runner-secret") {
  return processJobs(new Request("https://lighthouse.test/api/v2/processing/run", { method: "POST", headers: { authorization: `Bearer ${secret}` } }));
}

describe("explicit link analysis HTTP and actual SQLite transaction contracts", () => {
  test("queues explicitly without provider call, executes via authenticated runner, and preserves exact source", async () => {
    const f = await seedLinkRecord(db);
    const response = await analysisRoute(f);
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(provider.calls).toHaveLength(0); expect(harness.gateways).not.toHaveBeenCalled();
    const ran = await runner(); expect(ran.status).toBe(200);
    expect(await ran.json()).toMatchObject({ linkAnalysisOutcomes: expect.arrayContaining([expect.objectContaining({ outcome: "succeeded" })]) });
    expect(provider.calls).toHaveLength(1); expect(JSON.stringify(provider.calls)).not.toContain("PRIVATE MEMO");
    expect(db.sql.prepare("select raw_text,review_status from v2_link_fragments").get()).toEqual({ raw_text: f.rawText, review_status: "proposed" });
  });
  test("same gesture replays a terminal job; a new gesture creates a new attempt without deleting old fragments", async () => {
    const f = await seedLinkRecord(db);
    const first = await (await analysisRoute(f)).json() as JobReceipt;
    await runner();
    const repeated = await (await analysisRoute(f)).json() as JobReceipt;
    expect(repeated).toEqual({ ...first, status: "succeeded", replayed: true });
    const next = await (await analysisRoute(f, analysisBody(f, "gesture-2"))).json() as JobReceipt;
    expect(next.jobId).not.toBe(first.jobId); expect(next).toMatchObject({ replayed: false, status: "queued" });
    expect(db.sql.prepare("select count(*) n from v2_link_fragments").get()).toEqual({ n: 1 });
    await runner(); expect(db.sql.prepare("select count(*) n from v2_link_fragments").get()).toEqual({ n: 2 });
  });
  test("different in-flight gestures coalesce and retain their alias after completion", async () => {
    const f = await seedLinkRecord(db);
    const first = await (await analysisRoute(f)).json() as JobReceipt;
    const second = await (await analysisRoute(f, analysisBody(f, "second-tab"))).json() as JobReceipt;
    expect(second).toMatchObject({ jobId: first.jobId, replayed: true });
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs").get()).toEqual({ n: 1 });
    await runner();
    expect(await (await analysisRoute(f, analysisBody(f, "second-tab"))).json()).toMatchObject({ jobId: first.jobId, status: "succeeded", replayed: true });
  });
  test("a request key cannot be rebound to a different current snapshot", async () => {
    const f = await seedLinkRecord(db); await analysisRoute(f);
    const next = await f.snapshots.createSnapshot({ documentId: f.capture.objectId, expectedRevisionId: f.capture.revisionId, expectedSnapshotId: f.projection!.snapshot.id,
      expectedSnapshotVersion: 1, sourceItemIds: f.sources.map((s) => s.id), newManualSources: [{ rawText: "another source", metadata: makeManualLinkMetadata({ url: "https://example.test/new" }) }], idempotencyKey: "new-snapshot" });
    const response = await analysisRoute(f, { ...analysisBody(f), expectedSnapshotId: next.snapshot.id, expectedManifestHash: next.snapshot.manifestHash });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
  });
  test("queue and receipt roll back together when privacy changes immediately before the batch", async () => {
    const f = await seedLinkRecord(db);
    db.beforeBatch = () => { db.beforeBatch = null; db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(f.capture.objectId); };
    expect((await analysisRoute(f)).status).toBe(409);
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) n from v2_idempotency_records where operation='link_analysis.enqueue.v1'").get()).toEqual({ n: 0 });
    expect(provider.calls).toHaveLength(0);
  });
  test("receipt cannot be replayed after restricting the record, even with a valid read grant", async () => {
    const f = await seedLinkRecord(db); await analysisRoute(f);
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(f.capture.objectId);
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await analysisRoute(f)).status).toBe(409); expect(provider.calls).toHaveLength(0);
  });
  test.each(["wrong-owner", "no-session"])("denies %s without provider activity", async (mode) => {
    const f = await seedLinkRecord(db);
    harness.session.mockResolvedValue(mode === "no-session" ? null : { sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
    expect((await analysisRoute(f)).status).toBe(mode === "no-session" ? 401 : 409); expect(provider.calls).toHaveLength(0);
  });
  test.each(["FLAG_V2_AI", "FLAG_V2_WRITE", "FLAG_V2_ROUTES"])("honors %s feature gate", async (name) => {
    const f = await seedLinkRecord(db); vi.stubEnv(name, "0");
    expect((await analysisRoute(f)).status).toBe(name === "FLAG_V2_ROUTES" ? 404 : 503);
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs").get()).toEqual({ n: 0 });
  });
  test.each([
    [{ Origin: "https://evil.test", "Content-Type": "application/json" }, 403],
    [{ Origin: "https://lighthouse.test", "Content-Type": "text/plain" }, 415],
  ] as const)("requires same origin and JSON: %j", async (headers, status) => {
    const f = await seedLinkRecord(db);
    const response = await analyze(post("/link", analysisBody(f), headers), { params: Promise.resolve({ recordId: f.capture.objectId }) });
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  test("rejects oversized streamed JSON and spoofed authority fields", async () => {
    const f = await seedLinkRecord(db);
    expect((await analysisRoute(f, { ...analysisBody(f), restrictedUnlocked: true })).status).toBe(400);
    expect((await analysisRoute(f, { ...analysisBody(f), huge: "x".repeat(8_192) })).status).toBe(413);
    expect(provider.calls).toHaveLength(0);
  });
  test("URL-only content requests human input rather than fabricating a fetch", async () => {
    const f = await seedLinkRecord(db, { rawText: "" }); const response = await analysisRoute(f);
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: "link_analysis_needs_input" } });
    expect(provider.calls).toHaveLength(0);
  });
  test("saving a source version never queues or calls AI and replays safely", async () => {
    const f = await seedLinkRecord(db, { snapshot: false });
    const body = { expectedRevisionId: f.capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0, sourceItemIds: f.sources.map((s) => s.id), idempotencyKey: "snapshot-click" };
    const route = (input: unknown) => saveSnapshot(post("/links/snapshots", input), { params: Promise.resolve({ recordId: f.capture.objectId }) });
    expect((await route(body)).status).toBe(201); expect((await route(body)).status).toBe(200);
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs").get()).toEqual({ n: 0 }); expect(provider.calls).toHaveLength(0);
  });
  test("source addition preserves CRLF and validates URLs without trusting supplied metadata", async () => {
    const f = await seedLinkRecord(db, { snapshot: false });
    const rawText = " \r\nnew prompt 👀\r\n ";
    const body = { expectedRevisionId: f.capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0, sourceItemIds: [], idempotencyKey: "source-add",
      newManualSources: [{ rawText, link: { url: "https://example.test/new", role: "prompt" } }] };
    const route = (input: unknown) => saveSnapshot(post("/links/snapshots", input), { params: Promise.resolve({ recordId: f.capture.objectId }) });
    expect((await route({ ...body, newManualSources: [{ rawText, link: { url: "javascript:alert(1)" } }] })).status).toBe(400);
    const response = await route(body); expect(response.status).toBe(201);
    expect((await response.json() as { snapshot: LinkSnapshotReceipt }).snapshot.members[0].rawText).toBe(rawText);
  });
  test("source save accepts only a server read/write grant for restricted records", async () => {
    const f = await seedLinkRecord(db, { snapshot: false, privacyLevel: "restricted" });
    const body = { expectedRevisionId: f.capture.revisionId, expectedSnapshotId: null, expectedSnapshotVersion: 0, sourceItemIds: f.sources.map((s) => s.id), idempotencyKey: "locked-source" };
    const route = () => saveSnapshot(post("/links/snapshots", body), { params: Promise.resolve({ recordId: f.capture.objectId }) });
    expect((await route()).status).toBe(404);
    harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await route()).status).toBe(201);
  });
  test("runner rejects the wrong credential and does not construct a provider", async () => {
    const f = await seedLinkRecord(db); await analysisRoute(f);
    expect((await runner("wrong-secret")).status).toBe(401); expect(harness.gateways).not.toHaveBeenCalled();
  });
  test("runner preserves the three-work budget when the personal queue is idle", async () => {
    for (let index = 0; index < 4; index += 1) {
      const f = await seedLinkRecord(db);
      expect((await analysisRoute(f, analysisBody(f, `budget-${index}`))).status).toBe(202);
    }
    expect((await runner()).status).toBe(200); expect(provider.calls).toHaveLength(3);
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs where status='queued'").get()).toEqual({ n: 1 });
    expect((await runner()).status).toBe(200); expect(provider.calls).toHaveLength(4);
  });
  test("runner's shared governor stops external calls after a quota failure", async () => {
    const f = await seedLinkRecord(db); await analysisRoute(f);
    const limited = new FakeV2StructuredModelGateway("quota_exhausted");
    harness.gateways.mockReturnValue({ mainAnalyzer: limited, groundedResearch: provider });
    expect((await runner()).status).toBe(200);
    expect((await runner()).status).toBe(200);
    expect(limited.calls).toHaveLength(1); expect(provider.calls).toHaveLength(0);
  });
  test("an older schema reports unavailable without mutating manual sources", async () => {
    db.sql.close(); db = new LinkSqlite(30); harness.bindings.mockReturnValue({ db });
    const f = await seedLinkRecord(db, { snapshot: false });
    const response = await analyze(post("/links/analyze", { expectedRevisionId: f.capture.revisionId, expectedSnapshotId: "missing", expectedManifestHash: "a".repeat(64), idempotencyKey: "old-schema" }), { params: Promise.resolve({ recordId: f.capture.objectId }) });
    expect(response.status).toBe(503); expect(provider.calls).toHaveLength(0);
  });
  test("internal callers without a gesture key keep the original deterministic enqueue contract", async () => {
    const f = await seedLinkRecord(db); const { idempotencyKey: _key, ...input } = analysisBody(f); void _key;
    const links = new D1LinkAnalysisRepository(db);
    const first = await links.enqueue("link-owner", { documentId: f.capture.objectId, ...input });
    expect(await links.enqueue("link-owner", { documentId: f.capture.objectId, ...input })).toMatchObject({ jobId: first.jobId, replayed: true });
  });
});
