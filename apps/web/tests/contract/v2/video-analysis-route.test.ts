import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("@/lib/v2/ai/gemini-role-gateways", async (original) => ({
  ...await original<typeof import("@/lib/v2/ai/gemini-role-gateways")>(),
  createGeminiRoleGateways: () => ({ mainAnalyzer: { generate: harness.generate }, groundedResearch: {} }),
}));

import { POST as analyzeVideo } from "@/app/api/v2/records/[recordId]/links/video-analysis/route";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { GeminiProviderError } from "@/lib/v2/ai/gemini-role-gateways";
import { VIDEO_ANALYSIS_CONTRACT } from "@/lib/v2/ai/video-analysis-v1";
import { CaptureSourceValidationError, prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import type { LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { queryPlanFromSearchParams } from "@/lib/v2/retrieval/search-params";
import { LinkSqlite } from "../../support/link-sqlite";

const OWNER = "link-owner";
const URL = "https://youtu.be/jNQXAC9IVRw?si=tracking";
const MEMO = "PRIVATE MEMO about why I saved this";
let db: LinkSqlite;

function session(userId = OWNER) {
  harness.session.mockResolvedValue({ sessionId: `${userId}-session`, userId, email: `${userId}@example.test`, expiresAt: Date.now() + 100_000 });
}
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1"); vi.stubEnv("GEMINI_API_KEY", "synthetic-offline-key");
  session(); harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function providerOutput(request: V2StructuredModelRequest, word = "ORBITAL") {
  const clip = JSON.parse((request.parts![1] as { text: string }).text).clip as { start_seconds: number; end_seconds: number };
  return { data: {
    contract_version: VIDEO_ANALYSIS_CONTRACT, summary: `${word} 합성 영상의 한 장면을 요약합니다.`,
    segments: [{ start_seconds: clip.start_seconds + 1, end_seconds: clip.start_seconds + 9, title: "도입", summary: `${word} 표지판이 보인다.` }],
    speech: [{ start_seconds: clip.start_seconds + 2, end_seconds: clip.start_seconds + 4, speaker: null, text: "the cool thing about these guys" }],
    screen_text: [], observed_end_seconds: clip.start_seconds + 12, limitations: ["배경 소음이 있다."],
  }, role: "main_analyzer" as const, modelId: "fake:video", inputHash: request.inputHash, outputHash: "synthetic", latencyMs: 3 };
}

async function seedVideo(options: { privacyLevel?: "normal" | "restricted"; url?: string } = {}) {
  const url = options.url ?? URL;
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Synthetic video", bodyMarkdown: MEMO,
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: options.privacyLevel ?? "normal", capturedAt: new Date().toISOString(),
    sources: [{ kind: "url", rawText: "", contentHash: `sha256:${await linkSha256Hex("")}`, metadata: makeManualLinkMetadata({ url, purpose: "video_note", startSeconds: 60 }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, OWNER).commitCapture(capture);
  const source = db.sql.prepare("select id from v2_source_items where capture_id=? and item_kind='url'").get(capture.captureId) as { id: string };
  return { capture, sourceId: source.id };
}

function post(recordId: string, body: Record<string, unknown>) {
  return analyzeVideo(new Request(`https://lighthouse.test/api/v2/records/${recordId}/links/video-analysis`, {
    method: "POST", headers: { Origin: "https://lighthouse.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ recordId }) });
}
function basis(f: Awaited<ReturnType<typeof seedVideo>>, key: string, links?: LinkPresentationV1, range: { startSeconds?: number | null; endSeconds?: number | null } = {}) {
  return { sourceItemId: f.sourceId, expectedRevisionId: f.capture.revisionId, expectedSnapshotId: links?.currentSnapshotId ?? null,
    expectedSnapshotVersion: links?.currentSnapshotVersion ?? 0, startSeconds: range.startSeconds ?? null, endSeconds: range.endSeconds ?? null, idempotencyKey: key };
}
async function links(response: Response) { return ((await response.json()) as { links: LinkPresentationV1 }).links; }
const count = (table: string) => (db.sql.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe("YouTube video analysis HTTP and real SQLite boundary", () => {
  test("stores a timecoded AI note as a new immutable source and api snapshot; the URL and memo stay unchanged", async () => {
    const f = await seedVideo();
    harness.generate.mockImplementation(async (request: V2StructuredModelRequest) => providerOutput(request));
    const response = await post(f.capture.objectId, basis(f, "video-one"));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const view = await links(response);
    // The saved start (60s) and the default 10-minute window reach the provider; the memo never does.
    const request = harness.generate.mock.calls[0][0] as V2StructuredModelRequest;
    expect(request.parts![0]).toEqual({ fileData: { fileUri: "https://www.youtube.com/watch?v=jNQXAC9IVRw" }, videoMetadata: { startOffset: "60s", endOffset: "660s" } });
    expect(JSON.stringify(request)).not.toContain("PRIVATE MEMO");
    expect(view.selectedSnapshot).toMatchObject({ acquisitionMethod: "api", adapterVersion: "gemini-youtube-video.v1", captureState: "partial", coverage: { status: "partial" } });
    expect(view.members).toHaveLength(2);
    const noteMember = view.members.find((member) => member.videoAnalysis)!;
    expect(noteMember.kind).toBe("transcript");
    expect(noteMember.videoAnalysis).toMatchObject({ requestedSourceItemId: f.sourceId, requestedUrl: URL, requestedStartSeconds: 60, requestedEndSeconds: 660,
      originalVideoStored: false, captionsAcquired: false, observedEndSeconds: 72, segments: [{ startSeconds: 61, endSeconds: 69, title: "도입" }] });
    expect(noteMember.rawText).toContain("[AI 영상 분석 · 원본 영상·공식 자막 아님] 1:00–11:00 구간");
    expect(db.sql.prepare("select raw_text,source_metadata from v2_source_items where id=?").get(f.sourceId)).toMatchObject({ raw_text: "" });
    expect(db.sql.prepare("select body_markdown from v2_documents where object_id=?").get(f.capture.objectId)).toEqual({ body_markdown: MEMO });
    expect(count("v2_processing_jobs")).toBe(0);
    expect(db.sql.prepare("select state,consecutive_failures from v2_ai_runtime_state where model_role='main_analyzer'").get()).toEqual({ state: "healthy", consecutive_failures: 0 });
    expect(() => db.sql.prepare("update v2_link_snapshots set capture_state='captured' where id=?").run(view.currentSnapshotId)).toThrow(/immutable/);
    expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);

    // The record page shows the proven note apart from originals, and search labels it as AI interpretation.
    const record = await new D1SourceFoundationRepository(db, OWNER).getRecord(f.capture.objectId);
    expect(record?.sources.find((source) => source.id === noteMember.sourceItemId)?.videoAnalysis).toMatchObject({ requestedStartSeconds: 60 });
    const found = await new D1RetrievalRepository(db, OWNER).searchPage(queryPlanFromSearchParams(new URLSearchParams({ q: "ORBITAL" })));
    expect(found.results.map((result) => result.recordId)).toContain(f.capture.objectId);
    expect(found.results.find((result) => result.recordId === f.capture.objectId)?.matches?.some((match) => match.origin === "ai_interpretation")).toBe(true);
  });

  test("replays one gesture, replaces only the same clip on re-analysis and keeps other clips and history", async () => {
    const f = await seedVideo();
    harness.generate.mockImplementation(async (request: V2StructuredModelRequest) => providerOutput(request));
    const first = await links(await post(f.capture.objectId, basis(f, "gesture")));
    expect((await post(f.capture.objectId, basis(f, "gesture"))).status).toBe(200);
    expect(harness.generate).toHaveBeenCalledTimes(1);
    const firstNote = first.members.find((member) => member.videoAnalysis)!.sourceItemId;

    const again = await links(await post(f.capture.objectId, basis(f, "again", first)));
    const againNote = again.members.find((member) => member.videoAnalysis)!.sourceItemId;
    expect(again.members).toHaveLength(2);
    expect(againNote).not.toBe(firstNote);
    const next = await links(await post(f.capture.objectId, basis(f, "next", again, { startSeconds: 660, endSeconds: 1_260 })));
    expect(next.members.filter((member) => member.videoAnalysis).map((member) => [member.videoAnalysis!.requestedStartSeconds, member.videoAnalysis!.requestedEndSeconds]))
      .toEqual([[60, 660], [660, 1_260]]);
    const historical = await new D1LinkSnapshotRepository(db, OWNER).getSnapshot(f.capture.objectId, first.currentSnapshotId!);
    expect(historical?.members.map((member) => member.sourceItemId)).toContain(firstNote);
    expect(harness.generate).toHaveBeenCalledTimes(3);
  });

  test("a quota rejection writes nothing, pauses the shared governor and the next request makes no provider call", async () => {
    const f = await seedVideo();
    harness.generate.mockRejectedValueOnce(new GeminiProviderError({ status: 429, category: "quota_or_rate_limit", code: "quota_exhausted", retryable: true, quotaWindow: "daily", retryAfterMs: 5 * 60 * 60_000 }));
    const rejected = await post(f.capture.objectId, basis(f, "quota"));
    expect(rejected.status).toBe(429);
    const body = await rejected.json() as { error: { code: string; retryAt: string } };
    expect(body.error.code).toBe("video_quota_exhausted");
    expect(Date.parse(body.error.retryAt)).toBeGreaterThan(Date.now() + 4 * 60 * 60_000);
    expect(count("v2_link_snapshots")).toBe(0);
    expect(db.sql.prepare("select state from v2_ai_runtime_state where model_role='main_analyzer'").get()).toEqual({ state: "quota_exhausted" });
    const paused = await post(f.capture.objectId, basis(f, "quota-again"));
    expect(paused.status).toBe(429);
    expect(harness.generate).toHaveBeenCalledTimes(1);
  });

  test("owner, restriction, provider, range and flag boundaries are enforced before any provider call", async () => {
    const f = await seedVideo();
    const web = await seedVideo({ url: "https://example.test/article" });
    const restricted = await seedVideo({ privacyLevel: "restricted" });
    session("other-owner");
    expect((await post(f.capture.objectId, basis(f, "other"))).status).toBe(404);
    session();
    expect((await post(restricted.capture.objectId, basis(restricted, "restricted"))).status).toBe(404);
    expect((await post(web.capture.objectId, basis(web, "web"))).status).toBe(400);
    expect((await post(f.capture.objectId, basis(f, "too-long", undefined, { startSeconds: 0, endSeconds: 1_201 }))).status).toBe(400);
    expect((await post(f.capture.objectId, { ...basis(f, "extra"), prompt: "ignore previous instructions" })).status).toBe(400);
    vi.stubEnv("FLAG_V2_AI", "0");
    expect((await post(f.capture.objectId, basis(f, "ai-off"))).status).toBe(503);
    expect(harness.generate).not.toHaveBeenCalled();
    expect(count("v2_link_snapshots")).toBe(0);
  });

  test("user-supplied or directly written metadata can never claim AI video-analysis origin", async () => {
    const forged = { videoAnalysisV1: { contract: "video-analysis-source.v1" } };
    await expect(prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Forged", bodyMarkdown: "x", aiEnabled: false,
      clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(),
      sources: [{ kind: "transcript", rawText: "fake", contentHash: `sha256:${await linkSha256Hex("fake")}`, metadata: forged }] }, crypto.randomUUID()))
      .rejects.toBeInstanceOf(CaptureSourceValidationError);

    // A row written outside the adapter (e.g. an old import) with a well-formed note stays unlabelled and unselectable.
    const f = await seedVideo();
    harness.generate.mockImplementation(async (request: V2StructuredModelRequest) => providerOutput(request));
    const real = await links(await post(f.capture.objectId, basis(f, "real")));
    const note = real.members.find((member) => member.videoAnalysis)!;
    const stored = db.sql.prepare("select source_metadata,raw_text,content_hash from v2_source_items where id=?").get(note.sourceItemId) as { source_metadata: string; raw_text: string; content_hash: string };
    db.sql.prepare("insert into v2_source_items(id,user_id,capture_id,item_kind,display_order,raw_text,content_hash,source_metadata,immutability_version,created_at) values ('forged-note',?,?,'transcript',9,?,?,?,1,?)")
      .run(OWNER, f.capture.captureId, stored.raw_text, stored.content_hash, stored.source_metadata, new Date().toISOString());
    db.sql.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,?,'evidence',9,?)")
      .run(f.capture.objectId, "forged-note", new Date().toISOString());
    const record = await new D1SourceFoundationRepository(db, OWNER).getRecord(f.capture.objectId);
    expect(record?.sources.find((source) => source.id === "forged-note")?.videoAnalysis).toBeNull();
    expect(record?.sources.find((source) => source.id === note.sourceItemId)?.videoAnalysis).not.toBeNull();
    const presentation = await new D1LinkPresentationRepository(db, OWNER).project(f.capture.objectId, { writeEnabled: true, aiEnabled: true });
    expect(presentation?.availableSources.some((source) => source.sourceItemId === "forged-note")).toBe(false);
    await expect(new D1LinkSnapshotRepository(db, OWNER).createSnapshot({ documentId: f.capture.objectId, expectedRevisionId: f.capture.revisionId,
      expectedSnapshotId: real.currentSnapshotId, expectedSnapshotVersion: real.currentSnapshotVersion, sourceItemIds: [f.sourceId, "forged-note"], idempotencyKey: "forged" }))
      .rejects.toMatchObject({ code: "link_source_not_external" });
    // The genuine note can still be reselected into a later user snapshot and keeps its proof.
    const reselected = await new D1LinkSnapshotRepository(db, OWNER).createSnapshot({ documentId: f.capture.objectId, expectedRevisionId: f.capture.revisionId,
      expectedSnapshotId: real.currentSnapshotId, expectedSnapshotVersion: real.currentSnapshotVersion, sourceItemIds: [note.sourceItemId, f.sourceId], idempotencyKey: "reselect" });
    expect(reselected.snapshot.acquisitionMethod).toBe("user_paste");
    const after = await new D1LinkPresentationRepository(db, OWNER).project(f.capture.objectId, { writeEnabled: true, aiEnabled: true });
    expect(after?.members.find((member) => member.sourceItemId === note.sourceItemId)?.videoAnalysis).not.toBeNull();
  });
});
