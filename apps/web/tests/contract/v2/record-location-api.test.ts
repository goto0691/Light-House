import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/records/[recordId]/search-location/route";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import type { V2StructuredModelGateway, V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import type { LinkAnalysisEnvelopeV1 } from "@/lib/v2/ai/link-analysis-v1";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1RecordLocationRepository } from "@/lib/v2/infrastructure/d1/record-location-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { recordLocationTextHash, serializeRecordLocation, type V2RecordLocationV1, type V2RecordLocationResult } from "@/lib/v2/retrieval/record-location-v1";
import { exactLinkGateway, LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
const owner = "link-owner", rawText = "  exact 👀 prompt\r\nsecond  line\r\nexact 👀 prompt  ";
type Seed = Awaited<ReturnType<typeof seedLinkRecord>>;
const base = (text: string) => ({ contract: "record-location.v1" as const, textHash: recordLocationTextHash(text), range: { start: 2, end: 17 } });
function sourceLocation(seed: Seed, snapshot = true): V2RecordLocationV1 {
  const projection = seed.projection!, member = projection.members[0];
  return { ...base(seed.rawText), kind: "source", sourceItemId: member.sourceItemId,
    snapshotId: snapshot ? projection.snapshot.id : null, manifestHash: snapshot ? projection.snapshot.manifestHash : null, memberId: snapshot ? member.id : null };
}
function read(seed: Seed, location: V2RecordLocationV1, rawQuery?: string, recordId = seed.capture.objectId) {
  const query = rawQuery ?? new URLSearchParams({ loc: serializeRecordLocation(location) }).toString();
  return GET(new Request(`https://lighthouse.test/api/v2/records/${recordId}/search-location?${query}`), { params: Promise.resolve({ recordId }) });
}
async function expectError(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json(); expect(body).toMatchObject({ error: { code: code ?? expect.any(String) } });
  for (const secret of [rawText, "PRIVATE MEMO", "Synthetic link"]) expect(JSON.stringify(body)).not.toContain(secret);
}
beforeEach(() => {
  db = new LinkSqlite(32); vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1");
  harness.session.mockResolvedValue({ sessionId: "location-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

async function manual(seed: Seed, start = 0, end = rawText.length) {
  return (await new D1ManualLinkFragmentRepository(db, owner).create(seed.capture.objectId, {
    expectedRevisionId: seed.capture.revisionId, expectedSnapshotId: seed.projection!.snapshot.id, expectedManifestHash: seed.projection!.snapshot.manifestHash,
    memberId: seed.projection!.members[0].id, textStart: start, textEnd: end, role: "prompt", idempotencyKey: crypto.randomUUID(),
  })).item;
}
function manualLocation(seed: Seed, item: Awaited<ReturnType<typeof manual>>): V2RecordLocationV1 {
  return { ...base(item.fragment.rawText), range: { start: 0, end: item.fragment.rawText.length }, kind: "manual_fragment", snapshotId: seed.projection!.snapshot.id,
    manifestHash: seed.projection!.snapshot.manifestHash, sourceItemId: seed.projection!.members[0].sourceItemId, memberId: seed.projection!.members[0].id, fragmentId: item.id };
}
async function analyze(seed: Seed, gateway: V2StructuredModelGateway = exactLinkGateway()) {
  const links = new D1LinkAnalysisRepository(db), snapshot = seed.projection!.snapshot;
  await links.enqueue(owner, { documentId: seed.capture.objectId, expectedRevisionId: seed.capture.revisionId,
    expectedSnapshotId: snapshot.id, expectedManifestHash: snapshot.manifestHash, idempotencyKey: crypto.randomUUID() });
  const outcome = await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), gateway, workerId: "location-test" });
  expect(outcome.outcome).toBe("succeeded");
  if (!("runId" in outcome) || !outcome.runId) throw new Error("Missing fixture run");
  return outcome.runId;
}
function finalFrameHook(action: () => void, after = false): D1DatabaseBinding {
  let frames = 0;
  return { batch: db.batch.bind(db), prepare(sql: string) {
    let statement = db.prepare(sql);
    const wrapped: D1PreparedStatementBinding = { bind(...values) { statement = statement.bind(...values); return wrapped; }, all: () => statement.all(), run: () => statement.run(),
      async first<T>() {
        const terminal = sql.includes("as material_json") && ++frames === 2;
        if (terminal && !after) action();
        const row = await statement.first<T>();
        if (terminal && after) action();
        return row;
      } };
    return wrapped;
  } };
}

test.each([true, false])("source exact read keeps bytes/identity with snapshot=%s and performs no writes", async (withSnapshot) => {
  const seed = await seedLinkRecord(db, { rawText }), before = db.sql.prepare("select total_changes() as n").get();
  const response = await read(seed, sourceLocation(seed, withSnapshot));
  expect(response.status).toBe(200);
  const result = await response.json() as V2RecordLocationResult;
  expect(result).toMatchObject({ recordId: seed.capture.objectId, text: rawText, origin: "external_source", isHistorical: false,
    location: { sourceItemId: seed.projection!.members[0].sourceItemId }, copy: { allowed: true, mode: "exact" } });
  expect(result.text.slice(result.range!.start, result.range!.end)).toBe(rawText.slice(2, 17));
  expect(result.text).not.toContain("PRIVATE MEMO");
  expect(db.sql.prepare("select total_changes() as n").get()).toEqual(before);
});

test("a source in a past snapshot remains exact after a new snapshot, never retargets to current", async () => {
  const seed = await seedLinkRecord(db, { rawText }), loc = sourceLocation(seed);
  await seed.snapshots.createSnapshot({ documentId: seed.capture.objectId, expectedRevisionId: seed.capture.revisionId,
    expectedSnapshotId: seed.projection!.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: seed.sources.map((s) => s.id), idempotencyKey: crypto.randomUUID() });
  const response = await read(seed, loc); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: rawText, isHistorical: true, context: { snapshotId: seed.projection!.snapshot.id, snapshotVersion: 1 } });
});

test("old body version opens exactly while changed title identity conflicts", async () => {
  const seed = await seedLinkRecord(db, { rawText });
  const body: V2RecordLocationV1 = { ...base("PRIVATE MEMO"), range: null, kind: "document_body", revisionId: seed.capture.revisionId, documentVersion: 1 };
  const title: V2RecordLocationV1 = { ...base("Synthetic link"), range: null, kind: "document_title", revisionId: seed.capture.revisionId, documentVersion: 1 };
  const revision = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: seed.capture.revisionId, title: "New title",
    bodyMarkdown: "New text", writtenAt: null, documentStatus: "draft", privacyLevel: "normal" }, crypto.randomUUID());
  expect(await new D1DocumentAuthoringRepository(db, owner).saveRevision(seed.capture.objectId, revision)).toMatchObject({ outcome: "saved" });
  const response = await read(seed, body); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: "PRIVATE MEMO", isHistorical: true, context: { documentRevisionId: seed.capture.revisionId } });
  await expectError(await read(seed, title), 409);
});

test.each(["sourceItemId", "memberId", "snapshotId", "manifestHash"] as const)("refuses crossed %s even if text hash is identical", async (key) => {
  const seed = await seedLinkRecord(db, { rawText }), other = await seedLinkRecord(db, { rawText });
  const loc = sourceLocation(seed), foreign = sourceLocation(other);
  await expectError(await read(seed, { ...loc, [key]: (foreign as unknown as Record<string, unknown>)[key] }), 404);
});
test.each(["owner", "capture", "deleted"] as const)("exact source rejects %s boundary mismatch", async (attack) => {
  const seed = await seedLinkRecord(db, { rawText });
  if (attack === "owner") harness.session.mockResolvedValue({ sessionId: "other-session", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
  if (attack === "capture") db.sql.prepare("update v2_capture_bundles set user_id='other-owner' where id=?").run(seed.capture.captureId);
  if (attack === "deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(seed.capture.objectId);
  await expectError(await read(seed, sourceLocation(seed)), 404);
});
test.each(["", "loc={}", "loc=null", "loc=[]", "loc=not-json", "loc={}&loc={}", "loc={}&unknown=x"])("rejects malformed request %s without bytes", async (query) => {
  const seed = await seedLinkRecord(db, { rawText }); await expectError(await read(seed, sourceLocation(seed), query), 400);
});
test("hash and range mismatch never silently select similar current text", async () => {
  const seed = await seedLinkRecord(db, { rawText }), loc = sourceLocation(seed);
  await expectError(await read(seed, { ...loc, textHash: "f".repeat(64) }), 409);
  await expectError(await read(seed, { ...loc, range: { start: 0, end: rawText.length + 1 } }), 400);
  const emoji = rawText.indexOf("👀"); await expectError(await read(seed, { ...loc, range: { start: emoji + 1, end: emoji + 2 } }), 400);
});

test("source privacy is checked initially and after the final awaited frame", async () => {
  const seed = await seedLinkRecord(db, { rawText });
  harness.bindings.mockReturnValue({ db: finalFrameHook(() => db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(seed.capture.objectId)) });
  await expectError(await read(seed, sourceLocation(seed)), 423);
  harness.bindings.mockReturnValue({ db }); await expectError(await read(seed, sourceLocation(seed)), 423);
});
test("restricted grant expiring during final SQL read cannot return text", async () => {
  const seed = await seedLinkRecord(db, { rawText, privacyLevel: "restricted" }), now = Date.now();
  harness.grant.mockResolvedValue({ expiresAt: new Date(now + 60_000).toISOString() });
  harness.bindings.mockReturnValue({ db: finalFrameHook(() => { vi.spyOn(Date, "now").mockReturnValue(now + 60_001); }, true) });
  await expectError(await read(seed, sourceLocation(seed)), 423);
});

test("two identical manual excerpts preserve distinct source offsets and fragment IDs", async () => {
  const seed = await seedLinkRecord(db, { rawText }), phrase = "exact 👀 prompt";
  const first = await manual(seed, rawText.indexOf(phrase), rawText.indexOf(phrase) + phrase.length);
  const second = await manual(seed, rawText.lastIndexOf(phrase), rawText.lastIndexOf(phrase) + phrase.length);
  const results = await Promise.all([first, second].map(async (item) => { const response = await read(seed, manualLocation(seed, item)); expect(response.status).toBe(200); return response.json() as Promise<V2RecordLocationResult>; }));
  expect(results.map((row) => row.text)).toEqual([phrase, phrase]);
  expect(results.map((row) => row.evidence[0].textStart)).toEqual([rawText.indexOf(phrase), rawText.lastIndexOf(phrase)]);
  expect(results[0].location).not.toEqual(results[1].location);
});
test("manual fragment beyond first 50 items reads directly without list cursor", async () => {
  const seed = await seedLinkRecord(db, { rawText }); let last = await manual(seed);
  for (let index = 0; index < 51; index++) last = await manual(seed);
  const response = await read(seed, manualLocation(seed, last)); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: rawText, location: { fragmentId: last.id }, origin: "manual_extract" });
});
test("fragment removal between evidence validation and final frame fails closed", async () => {
  const seed = await seedLinkRecord(db, { rawText }), item = await manual(seed);
  harness.bindings.mockReturnValue({ db: finalFrameHook(() => db.sql.prepare("delete from v2_link_fragments where id=?").run(item.id)) });
  await expectError(await read(seed, manualLocation(seed, item)), 404);
});

test.each(["continuation", "collection", "alternatives"] as const)("curation %s preserves selected role, duplicates and copy authorization", async (relationKind) => {
  const seed = await seedLinkRecord(db, { rawText }), selected = await manual(seed), repository = new D1PromptCurationRepository(db, owner);
  const created = await repository.create(seed.capture.objectId, { expectedRevisionId: seed.capture.revisionId, expectedSnapshotId: seed.projection!.snapshot.id,
    expectedManifestHash: seed.projection!.snapshot.manifestHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "Exact group", relationKind, relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [0, 1].map((position) => ({ itemKey: `part-${position}`, fragmentId: selected.id, expectedFragmentStateVersion: 1, copyRole: "prompt", position })), examples: [] } });
  const text = [rawText, rawText].join("\n"), loc: V2RecordLocationV1 = { ...base(text), kind: "curation", snapshotId: seed.projection!.snapshot.id,
    manifestHash: seed.projection!.snapshot.manifestHash, groupKey: created.item.groupKey, revisionId: created.item.id, role: "prompt" };
  const response = await read(seed, loc); expect(response.status).toBe(200);
  const result = await response.json() as V2RecordLocationResult;
  expect(result.text).toBe(text); expect(result.evidence.map((row) => row.label)).toEqual(["항목 part-0 · 위치 1", "항목 part-1 · 위치 2"]);
  expect(result.copy.allowed).toBe(relationKind === "continuation");
  if (relationKind === "continuation") expect(result.copy.mode).toBe("available_only");
});

test("old AI run beyond 20 history entries uses the original exact fragment and does not invoke AI", async () => {
  const seed = await seedLinkRecord(db, { rawText }), runId = await analyze(seed);
  const row = db.sql.prepare("select id,raw_text from v2_link_fragments where processing_run_id=? and source_class='source_extract'").get(runId) as { id: string; raw_text: string };
  for (let index = 0; index < 21; index++) await analyze(seed);
  expect((await new D1LinkPresentationRepository(db, owner).project(seed.capture.objectId))!.runHistory.items.some((run) => run.id === runId)).toBe(false);
  const loc: V2RecordLocationV1 = { ...base(row.raw_text), kind: "ai_fragment", snapshotId: seed.projection!.snapshot.id, manifestHash: seed.projection!.snapshot.manifestHash,
    sourceItemId: seed.projection!.members[0].sourceItemId, memberId: seed.projection!.members[0].id, fragmentId: row.id, runId };
  const before = db.sql.prepare("select count(*) as n from v2_processing_runs").get(), response = await read(seed, loc);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ text: row.raw_text, origin: "ai_extract", isHistorical: true, context: { runId } });
  expect(db.sql.prepare("select count(*) as n from v2_processing_runs").get()).toEqual(before);
  await expectError(await read(seed, { ...loc, runId: "other-run" }), 404);
});
test("AI interpretation is derived text with original supporting quotes, not an authored claim", async () => {
  const seed = await seedLinkRecord(db, { rawText }), exact = exactLinkGateway();
  const gateway: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) {
    const result = await exact.generate<T>(request), data = result.data as LinkAnalysisEnvelopeV1;
    return { ...result, data: { ...data, interpretations: [{ fragment_key: "derived", role: "insight", text: "Derived insight only.", evidence: [data.fragments[0].selection] }] } as T };
  } };
  const runId = await analyze(seed, gateway), row = db.sql.prepare("select id from v2_link_fragments where processing_run_id=? and source_class='ai_interpretation'").get(runId) as { id: string };
  const loc: V2RecordLocationV1 = { ...base("Derived insight only."), kind: "ai_fragment", snapshotId: seed.projection!.snapshot.id, manifestHash: seed.projection!.snapshot.manifestHash,
    sourceItemId: seed.projection!.members[0].sourceItemId, memberId: seed.projection!.members[0].id, fragmentId: row.id, runId };
  const response = await read(seed, loc); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: "Derived insight only.", origin: "ai_interpretation", label: "AI 해석 · 원문이나 내 주장 아님", reviewStatus: "proposed",
    evidence: [{ quote: "  exact 👀 prompt\r\nsecond  line\r\n" }] });
});

test("direct repository freezes a locator before awaited reads", async () => {
  const seed = await seedLinkRecord(db, { rawText }), location = structuredClone(sourceLocation(seed));
  const pending = new D1RecordLocationRepository(db, owner).get(seed.capture.objectId, location);
  (location as { textHash: string }).textHash = "0".repeat(64);
  expect((await pending).text).toBe(rawText);
});
