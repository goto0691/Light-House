import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/records/[recordId]/links/fragments/[fragmentId]/evidence/route";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import type { V2StructuredModelGateway, V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import type { LinkAnalysisEnvelopeV1 } from "@/lib/v2/ai/link-analysis-v1";
import type { LinkFragmentEvidenceV1 } from "@/lib/v2/domain/link-fragment-evidence-v1";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1LinkFragmentEvidenceRepository } from "@/lib/v2/infrastructure/d1/link-fragment-evidence-repository";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { exactLinkGateway, LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
const owner = "link-owner", rawText = "  original 👀\r\nsecond  line\r\nprivate source tail  ";
type Fixture = Awaited<ReturnType<typeof seed>>;
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1");
  vi.stubEnv("FLAG_V2_WRITE", "1");
  vi.stubEnv("FLAG_V2_AI", "1");
  harness.session.mockResolvedValue({ sessionId: "evidence-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null);
  harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

async function analyze(fixture: Awaited<ReturnType<typeof seedLinkRecord>>, gateway: V2StructuredModelGateway = exactLinkGateway()) {
  const snapshot = fixture.projection!.snapshot, links = new D1LinkAnalysisRepository(db);
  await links.enqueue(owner, { documentId: fixture.capture.objectId, expectedRevisionId: fixture.capture.revisionId,
    expectedSnapshotId: snapshot.id, expectedManifestHash: snapshot.manifestHash, idempotencyKey: crypto.randomUUID() });
  const outcome = await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), gateway, workerId: "evidence-test" });
  expect(outcome.outcome).toBe("succeeded");
  if (!("runId" in outcome) || !outcome.runId) throw new Error("Fixture run missing");
  const fragment = db.sql.prepare("select id from v2_link_fragments where processing_run_id=? and source_class='source_extract'").get(outcome.runId) as { id: string };
  return { runId: outcome.runId, fragmentId: fragment.id };
}
async function seed() {
  const fixture = await seedLinkRecord(db, { rawText });
  return { ...fixture, ...await analyze(fixture) };
}
function read(fixture: Fixture, query?: string, recordId = fixture.capture.objectId, fragmentId = fixture.fragmentId, headers?: HeadersInit) {
  const params = query ?? new URLSearchParams({ snapshotId: fixture.projection!.snapshot.id, manifestHash: fixture.projection!.snapshot.manifestHash }).toString();
  return GET(new Request(`https://lighthouse.test/api/v2/records/${recordId}/links/fragments/${fragmentId}/evidence?${params}`, { headers }), { params: Promise.resolve({ recordId, fragmentId }) });
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body).toEqual({ error: { code: code ?? expect.any(String), message: expect.any(String) } });
  for (const secret of ["PRIVATE MEMO", "original 👀", "Synthetic link", "private source tail", "https://example.test/source"]) expect(JSON.stringify(body)).not.toContain(secret);
}

test("actual processing result returns exact CRLF/emoji range and no personal memo or unselected source", async () => {
  const fixture = await seed(), response = await read(fixture);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json() as LinkFragmentEvidenceV1;
  expect(body).toMatchObject({ contract: "link-fragment-evidence.v1", recordId: fixture.capture.objectId, snapshotId: fixture.projection!.snapshot.id,
    snapshotManifestHash: fixture.projection!.snapshot.manifestHash, run: { id: fixture.runId, isPublished: true },
    fragment: { id: fixture.fragmentId, rawText: "  original 👀\r\nsecond  line\r\n", completeness: "selection_unverified" } });
  expect(body.fragment.evidence[0]).toMatchObject({ quote: body.fragment.rawText, textStart: 0, textEnd: body.fragment.rawText!.length });
  for (const secret of ["PRIVATE MEMO", "Synthetic link", "private source tail", "https://example.test/source"]) expect(JSON.stringify(body)).not.toContain(secret);
});

test("old run beyond history page remains exact, including historical rejected state", async () => {
  const fixture = await seed();
  for (let index = 0; index < 21; index++) await analyze(fixture);
  db.sql.prepare("update v2_link_fragments set review_status='rejected',state_version=2,locked_by_user=1 where id=?").run(fixture.fragmentId);
  const current = (await new D1LinkPresentationRepository(db, owner).project(fixture.capture.objectId))!;
  expect(current.runHistory.items).toHaveLength(20);
  expect(current.runHistory.items.some((run) => run.id === fixture.runId)).toBe(false);
  expect(current.runHistory.nextCursor).not.toBeNull();
  const response = await read(fixture);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ run: { id: fixture.runId, isPublished: false }, fragment: { reviewStatus: "rejected", stateVersion: 2, lockedByUser: true } });
});

test("actual partial run preserves exact available evidence without claiming unavailable link content", async () => {
  const original = await seedLinkRecord(db, { rawText });
  const projection = await original.snapshots.createSnapshot({ documentId: original.capture.objectId, expectedRevisionId: original.capture.revisionId,
    expectedSnapshotId: original.projection!.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: original.sources.map((source) => source.id),
    newManualSources: [{ rawText: "", metadata: makeManualLinkMetadata({ url: "https://example.test/unavailable", completeness: "unknown" }) }], idempotencyKey: crypto.randomUUID() });
  const input = { ...original, projection }, fixture = { ...input, ...await analyze(input) }, response = await read(fixture);
  expect(response.status).toBe(200);
  const body = await response.json() as LinkFragmentEvidenceV1;
  expect(body.run).toMatchObject({ id: fixture.runId, status: "partial", isPublished: true });
  expect(body.fragment.rawText).toBe("  original 👀\r\nsecond  line\r\n");
  expect(body.fragment.evidence).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain("unavailable");
});

test("actual AI interpretation remains derived text with source quotes, never a verbatim fragment", async () => {
  const input = await seedLinkRecord(db, { rawText }), exact = exactLinkGateway();
  const gateway: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) {
    const result = await exact.generate<T>(request), data = result.data as LinkAnalysisEnvelopeV1;
    return { ...result, data: { ...data, interpretations: [{ fragment_key: "interpretation", role: "insight", text: "Derived analysis, not the author's words.",
      evidence: [data.fragments[0].selection] }] } as T };
  } };
  const analyzed = await analyze(input, gateway);
  const selected = db.sql.prepare("select id from v2_link_fragments where processing_run_id=? and source_class='ai_interpretation'").get(analyzed.runId) as { id: string };
  const response = await read({ ...input, ...analyzed, fragmentId: selected.id });
  expect(response.status).toBe(200);
  const body = await response.json() as LinkFragmentEvidenceV1;
  expect(body.fragment).toMatchObject({ sourceClass: "ai_interpretation", role: "insight", rawText: null, rawTextHash: null,
    derivedText: "Derived analysis, not the author's words.", completeness: "selection_unverified" });
  const quote = "  original 👀\r\nsecond  line\r\n";
  expect(body.fragment.evidence[0]).toMatchObject({ quote, textStart: 0, textEnd: quote.length });
  expect(JSON.stringify(body)).not.toContain("PRIVATE MEMO");
});

test.each([["complete", "selection_unverified"], ["partial", "truncated"], ["ocr_unverified", "ocr_unverified"]] as const)("source coverage %s is preserved as %s, not upgraded by analysis", async (coverage, expected) => {
  const original = await seedLinkRecord(db, { rawText });
  const projection = await original.snapshots.createSnapshot({ documentId: original.capture.objectId, expectedRevisionId: original.capture.revisionId,
    expectedSnapshotId: original.projection!.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: [],
    newManualSources: [{ rawText, metadata: makeManualLinkMetadata({ url: "https://example.test/coverage", completeness: coverage }) }], idempotencyKey: crypto.randomUUID() });
  const input = { ...original, projection }, response = await read({ ...input, ...await analyze(input) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ fragment: { completeness: expected, rawText: "  original 👀\r\nsecond  line\r\n" } });
});

test("a real manual selection cannot be relabeled as historical AI evidence", async () => {
  const fixture = await seed(), snapshot = fixture.projection!.snapshot;
  const manual = await new D1ManualLinkFragmentRepository(db, owner).create(fixture.capture.objectId, {
    expectedRevisionId: fixture.capture.revisionId, expectedSnapshotId: snapshot.id, expectedManifestHash: snapshot.manifestHash,
    memberId: fixture.projection!.members[0].id, textStart: 0, textEnd: rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  });
  await error(await read({ ...fixture, fragmentId: manual.item.id }), 404, "link_fragment_not_found");
  expect((await new D1ManualLinkFragmentRepository(db, owner).get(fixture.capture.objectId, manual.item.id, { snapshotId: snapshot.id }))?.item.id).toBe(manual.item.id);
});

test("read works with write and AI flags off and never executes a write or history-page scan", async () => {
  const fixture = await seed(), queries: string[] = [], before = db.sql.prepare("select total_changes() as n").get();
  vi.stubEnv("FLAG_V2_WRITE", "0"); vi.stubEnv("FLAG_V2_AI", "0");
  const readonly: D1DatabaseBinding = { prepare(query) { queries.push(query); return db.prepare(query); }, async batch() { throw new Error("Unexpected write batch"); } };
  harness.bindings.mockReturnValue({ db: readonly });
  expect((await read(fixture)).status).toBe(200);
  expect(db.sql.prepare("select total_changes() as n").get()).toEqual(before);
  expect(queries.filter((query) => !/^\s*(select|with|pragma table_info)/i.test(query))).toEqual([]);
  expect(queries.some((query) => /limit 21|order by r\.created_at/i.test(query))).toBe(false);
});

test("an original run remains readable after actual document save and snapshot advancement", async () => {
  const fixture = await seed();
  const revision = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: fixture.capture.revisionId, title: "New private title",
    bodyMarkdown: "NEW PRIVATE MEMO", writtenAt: null, documentStatus: "draft", privacyLevel: "normal" }, crypto.randomUUID());
  expect(await new D1DocumentAuthoringRepository(db, owner).saveRevision(fixture.capture.objectId, revision)).toMatchObject({ outcome: "saved" });
  await fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId, expectedRevisionId: revision.revisionId,
    expectedSnapshotId: fixture.projection!.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: fixture.projection!.members.map((member) => member.sourceItemId), idempotencyKey: crypto.randomUUID() });
  const response = await read(fixture);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ run: { id: fixture.runId, documentRevisionId: fixture.capture.revisionId, isPublished: false } });
});

test.each(["", "snapshotId=x", "manifestHash=" + "a".repeat(64), "snapshotId=x&manifestHash=" + "a".repeat(64) + "&unknown=1",
  "snapshotId=x&snapshotId=x&manifestHash=" + "a".repeat(64), "snapshotId=x&manifestHash=" + "a".repeat(64) + "&manifestHash=" + "a".repeat(64),
  "snapshotId=&manifestHash=" + "a".repeat(64), "snapshotId=x&manifestHash=" + "A".repeat(64), "snapshotId=x&manifestHash=xyz",
  "snapshotId=" + "x".repeat(201) + "&manifestHash=" + "a".repeat(64), "snapshotId=%00&manifestHash=" + "a".repeat(64)])("strict query rejects %s", async (query) => {
  const fixture = await seed(); await error(await read(fixture, query), 400, "link_fragment_evidence_request_invalid");
});

test.each(["userId=link-owner", "runId=current", "restrictedUnlocked=true", "restrictedGrantExpiresAt=2099-01-01", "rawText=forged"])("query cannot add authority through %s", async (extra) => {
  const fixture = await seed();
  const query = new URLSearchParams({ snapshotId: fixture.projection!.snapshot.id, manifestHash: fixture.projection!.snapshot.manifestHash }).toString();
  await error(await read(fixture, `${query}&${extra}`), 400, "link_fragment_evidence_request_invalid");
});

test.each(["owner", "restricted"] as const)("forged request headers cannot replace authenticated %s authority", async (kind) => {
  const fixture = await seed();
  if (kind === "owner") harness.session.mockResolvedValue({ sessionId: "other-session", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
  else db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
  await error(await read(fixture, undefined, undefined, undefined, { "x-user-id": owner, "x-session-id": "evidence-session", "x-restricted-unlocked": "true",
    "x-restricted-grant-expires-at": "2099-01-01T00:00:00.000Z" }), kind === "owner" ? 404 : 423);
  expect(harness.grant).toHaveBeenCalledWith(db, { userId: kind === "owner" ? "other-owner" : owner, sessionId: kind === "owner" ? "other-session" : "evidence-session" });
});

test.each(["record", "fragment", "snapshot", "manifest", "owner"] as const)("rejects another %s without content", async (kind) => {
  const fixture = await seed(), other = await seedLinkRecord(db);
  if (kind === "owner") harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
  const query = new URLSearchParams({ snapshotId: kind === "snapshot" ? other.projection!.snapshot.id : fixture.projection!.snapshot.id,
    manifestHash: kind === "manifest" ? "0".repeat(64) : fixture.projection!.snapshot.manifestHash }).toString();
  await error(await read(fixture, query, kind === "record" ? other.capture.objectId : fixture.capture.objectId, kind === "fragment" ? "missing-fragment" : fixture.fragmentId), kind === "manifest" ? 409 : 404);
});

test.each(["normal", "sensitive", "archived"] as const)("%s access requires no restricted grant", async (state) => {
  const fixture = await seed();
  if (state === "archived") db.sql.prepare("update v2_objects set lifecycle_status='archived' where id=?").run(fixture.capture.objectId);
  else db.sql.prepare("update v2_documents set privacy_level=? where object_id=?").run(state, fixture.capture.objectId);
  expect((await read(fixture)).status).toBe(200);
});

test.each(["missing", "expired", "active"] as const)("restricted grant %s is enforced without exposing content", async (grant) => {
  const fixture = await seed();
  db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
  harness.grant.mockResolvedValue(grant === "missing" ? null : { expiresAt: new Date(Date.now() + (grant === "active" ? 60_000 : -1)).toISOString() });
  const response = await read(fixture);
  if (grant === "active") expect(response.status).toBe(200); else await error(response, 423, "restricted_record_locked");
});

test("authentication, feature/schema unavailability and unexpected errors remain private", async () => {
  const fixture = await seed();
  harness.session.mockResolvedValueOnce(null); await error(await read(fixture), 401, "authentication_required");
  vi.stubEnv("FLAG_V2_ROUTES", "0"); await error(await read(fixture), 404, "v2_routes_disabled"); vi.stubEnv("FLAG_V2_ROUTES", "1");
  harness.bindings.mockImplementationOnce(() => { throw new Error("PRIVATE MEMO internal database path"); }); await error(await read(fixture), 500, "internal_error");
  db.sql.close(); db = new LinkSqlite(30); harness.bindings.mockReturnValue({ db });
  await error(await read(fixture), 503, "link_snapshot_schema_unavailable");
});

test.each(["deleted", "legacy", "broken_capture", "broken_revision"] as const)("unavailable %s records are not evidence authorization", async (kind) => {
  const fixture = await seed(), other = await seedLinkRecord(db);
  if (kind === "deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(fixture.capture.objectId);
  if (kind === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:unattached:fixture' where id=?").run(fixture.capture.captureId);
  if (kind === "broken_capture") db.sql.prepare("update v2_capture_bundles set user_id='other-owner' where id=?").run(fixture.capture.captureId);
  if (kind === "broken_revision") db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(other.capture.revisionId, fixture.capture.objectId);
  await error(await read(fixture), 404, "link_record_not_found");
});

test.each(["run_hash", "job_hash", "input_revision", "run_status", "job_status", "model_role", "schema", "prompt", "finished", "invalid_finished"] as const)("rejects damaged %s even with valid fragment bytes", async (kind) => {
  const fixture = await seed(), other = await seedLinkRecord(db), job = db.sql.prepare("select job_id from v2_processing_runs where id=?").get(fixture.runId) as { job_id: string };
  const runEdits = { run_hash: ["input_hash", "0".repeat(64)], run_status: ["status", "superseded"], model_role: ["model_role", "search_enricher"], schema: ["schema_version", "foreign.v1"], prompt: ["prompt_version", "foreign.v1"], finished: ["finished_at", null], invalid_finished: ["finished_at", "not-a-date"] } as const;
  if (kind === "job_hash") db.sql.prepare("update v2_processing_jobs set input_hash=? where id=?").run("0".repeat(64), job.job_id);
  else if (kind === "input_revision") db.sql.prepare("update v2_processing_jobs set input_revision_id=? where id=?").run(other.capture.revisionId, job.job_id);
  else if (kind === "job_status") db.sql.prepare("update v2_processing_jobs set status='superseded' where id=?").run(job.job_id);
  else { const [column, value] = runEdits[kind]; db.sql.prepare(`update v2_processing_runs set ${column}=? where id=?`).run(value, fixture.runId); }
  await error(await read(fixture), 400, "link_fragment_evidence_integrity_invalid");
});

/** Corrupt INSERT fixtures keep all production triggers enabled. They copy an
 * actual run's owned row, never pretend that INSERT itself is the normal API. */
function damagedFragment(fixture: Fixture, change: Record<string, string | number | null>, evidenceChange: Record<string, string | number | null> = {}) {
  const original = db.sql.prepare("select * from v2_link_fragments where id=?").get(fixture.fragmentId)!;
  const fragment = { ...original, id: crypto.randomUUID(), fragment_key: crypto.randomUUID(), ...change };
  const columns = Object.keys(fragment);
  db.sql.prepare(`insert into v2_link_fragments(${columns.join(",")}) values(${columns.map(() => "?").join(",")})`).run(...Object.values(fragment));
  const evidence = { ...db.sql.prepare("select * from v2_link_fragment_evidence where fragment_id=?").get(fixture.fragmentId)!, id: crypto.randomUUID(), fragment_id: fragment.id, ...evidenceChange };
  const fields = Object.keys(evidence);
  db.sql.prepare(`insert into v2_link_fragment_evidence(${fields.join(",")}) values(${fields.map(() => "?").join(",")})`).run(...Object.values(evidence));
  return { ...fixture, fragmentId: fragment.id };
}
test.each([
  ["raw bytes", { raw_text: "rewritten" }, {}], ["raw hash", { raw_text_hash: "0".repeat(64) }, {}],
  ["range", { text_start: 1 }, {}], ["emoji midpoint", { text_end: 13 }, { text_end: 13 }],
  ["evidence nonblock", {}, { text_start: 1 }], ["evidence out of bounds", {}, { text_end: 100_000 }],
  ["evidence relation", {}, { relation_kind: "example" }], ["evidence method", {}, { evidence_method: "user_confirmed" }],
  ["evidence order", {}, { display_order: 1 }], ["completeness", { completeness: "complete" }, {}],
  ["scope", { details_json: '{"contract":"link-analysis.v1","scope":"personal_memo"}' }, {}],
  ["null details", { details_json: "null" }, {}],
] as const)("rejects stored malformed %s", async (_name, change, evidenceChange) => {
  const fixture = await seed();
  await error(await read(damagedFragment(fixture, change, evidenceChange)), 400, "link_fragment_evidence_integrity_invalid");
});

/** Hooks wrap a real SQL SELECT; no synthetic success rows are manufactured. */
function atFinalRead(action: () => void, after = false) {
  let fired = false;
  const wrapped: D1DatabaseBinding = { prepare(query) {
    let actual = db.prepare(query);
    const statement: D1PreparedStatementBinding = { bind(...values) { actual = actual.bind(...values); return statement; },
      async first<T>() { const matches = query.includes("as fragment_json") && query.includes("with proofs as materialized");
        if (matches && !fired && !after) { fired = true; action(); }
        const result = await actual.first<T>();
        if (matches && !fired && after) { fired = true; action(); }
        return result;
      }, all: <T>() => actual.all<T>(), run: () => actual.run() };
    return statement;
  }, batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements) };
  harness.bindings.mockReturnValue({ db: wrapped });
  return () => expect(fired).toBe(true);
}
test.each(["restricted", "deleted", "legacy", "capture_owner", "evidence", "review", "run", "job_hash", "job_status", "job_revision", "publication", "current_version", "source", "source_hash", "source_owner", "source_link", "metadata"] as const)("final atomic read fences concurrent %s change", async (kind) => {
  const fixture = await seed(), other = await seedLinkRecord(db);
  const job = db.sql.prepare("select job_id from v2_processing_runs where id=?").get(fixture.runId) as { job_id: string };
  const fired = atFinalRead(() => {
    if (kind === "restricted") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
    if (kind === "deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(fixture.capture.objectId);
    if (kind === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:unattached:late' where id=?").run(fixture.capture.captureId);
    if (kind === "capture_owner") db.sql.prepare("update v2_capture_bundles set user_id='other-owner' where id=?").run(fixture.capture.captureId);
    if (kind === "evidence") db.sql.prepare("update v2_link_fragment_evidence set evidence_method='user_confirmed' where fragment_id=?").run(fixture.fragmentId);
    if (kind === "review") db.sql.prepare("update v2_link_fragments set review_status='rejected',state_version=2 where id=?").run(fixture.fragmentId);
    if (kind === "run") db.sql.prepare("update v2_processing_runs set status='superseded' where id=?").run(fixture.runId);
    if (kind === "job_hash") db.sql.prepare("update v2_processing_jobs set input_hash=? where id=?").run("0".repeat(64), job.job_id);
    if (kind === "job_status") db.sql.prepare("update v2_processing_jobs set status='superseded' where id=?").run(job.job_id);
    if (kind === "job_revision") db.sql.prepare("update v2_processing_jobs set input_revision_id=? where id=?").run(other.capture.revisionId, job.job_id);
    if (kind === "publication") db.sql.prepare("update v2_documents set published_link_run_id=null where object_id=?").run(fixture.capture.objectId);
    if (kind === "current_version") db.sql.prepare("update v2_documents set current_version=current_version+1 where object_id=?").run(fixture.capture.objectId);
    if (kind === "source") db.sql.prepare("update v2_source_items set raw_text='changed after hash verification' where id=?").run(fixture.sources[0].id);
    if (kind === "source_hash") db.sql.prepare("update v2_source_items set content_hash=? where id=?").run("sha256:" + "0".repeat(64), fixture.sources[0].id);
    if (kind === "source_owner") db.sql.prepare("update v2_source_items set user_id='other-owner' where id=?").run(fixture.sources[0].id);
    if (kind === "source_link") db.sql.prepare("delete from v2_document_source_links where document_object_id=? and source_item_id=?").run(fixture.capture.objectId, fixture.sources[0].id);
    if (kind === "metadata") db.sql.prepare("update v2_source_items set source_metadata='null' where id=?").run(fixture.sources[0].id);
  });
  await error(await read(fixture), kind === "restricted" ? 423 : ["deleted", "legacy", "capture_owner"].includes(kind) ? 404
    : ["source", "source_hash", "source_owner", "source_link", "metadata"].includes(kind) ? 400 : 409);
  fired();
});

test.each(["text", "hash", "metadata"] as const)("source %s damage is not blessed by the old manifest", async (kind) => {
  const fixture = await seed();
  if (kind === "text") db.sql.prepare("update v2_source_items set raw_text='rewritten external source' where id=?").run(fixture.sources[0].id);
  if (kind === "hash") db.sql.prepare("update v2_source_items set content_hash=? where id=?").run("sha256:" + "0".repeat(64), fixture.sources[0].id);
  if (kind === "metadata") db.sql.prepare("update v2_source_items set source_metadata='{}' where id=?").run(fixture.sources[0].id);
  await error(await read(fixture), 400, kind === "metadata" ? "link_fragment_evidence_integrity_invalid" : undefined);
});

test("bounded evidence rejects absent and amplified rows rather than loading unrelated fragments", async () => {
  const fixture = await seed();
  const original = db.sql.prepare("select * from v2_link_fragment_evidence where fragment_id=?").get(fixture.fragmentId)!;
  db.sql.prepare("delete from v2_link_fragment_evidence where fragment_id=?").run(fixture.fragmentId);
  await error(await read(fixture), 400, "link_fragment_evidence_integrity_invalid");
  for (let index = 0; index < 17; index++) {
    const row = { ...original, id: crypto.randomUUID(), display_order: index }, fields = Object.keys(row);
    db.sql.prepare(`insert into v2_link_fragment_evidence(${fields.join(",")}) values(${fields.map(() => "?").join(",")})`).run(...Object.values(row));
  }
  await error(await read(fixture), 400, "link_fragment_evidence_integrity_invalid");
});
test("grant expiring after final SQL await cannot release any evidence", async () => {
  const fixture = await seed(); let clock = Date.now(); const expiry = clock + 5_000;
  db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
  harness.grant.mockResolvedValue({ expiresAt: new Date(expiry).toISOString() }); vi.spyOn(Date, "now").mockImplementation(() => clock);
  const fired = atFinalRead(() => { clock = expiry; }, true);
  await error(await read(fixture), 423, "restricted_record_locked"); fired();
});

test("final snapshot membership fence rejects a newly added competing source", async () => {
  const fixture = await seed(), originalSnapshot = fixture.projection!.snapshot;
  const advanced = await fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId, expectedRevisionId: fixture.capture.revisionId,
    expectedSnapshotId: originalSnapshot.id, expectedSnapshotVersion: 1, sourceItemIds: fixture.sources.map((source) => source.id),
    newManualSources: [{ rawText: "competing source\r\n", metadata: makeManualLinkMetadata({ url: "https://example.test/competitor" }) }], idempotencyKey: crypto.randomUUID() });
  const competitor = advanced.members.find((member) => member.sourceItemId !== fixture.sources[0].id)!;
  const fired = atFinalRead(() => {
    db.sql.prepare("insert into v2_link_snapshot_sources(id,user_id,snapshot_id,source_item_id,member_key,source_order,source_fingerprint) values (?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), owner, originalSnapshot.id, competitor.sourceItemId, competitor.memberKey, 1, competitor.sourceFingerprint);
  });
  await error(await read(fixture), 400, "link_fragment_evidence_integrity_invalid"); fired();
});

test("final evidence set is atomic when an additional support row appears", async () => {
  const fixture = await seed();
  const original = db.sql.prepare("select * from v2_link_fragment_evidence where fragment_id=?").get(fixture.fragmentId)!;
  const fired = atFinalRead(() => {
    const row = { ...original, id: crypto.randomUUID(), display_order: 1 }, fields = Object.keys(row);
    db.sql.prepare(`insert into v2_link_fragment_evidence(${fields.join(",")}) values(${fields.map(() => "?").join(",")})`).run(...Object.values(row));
  });
  await error(await read(fixture), 409, "link_fragment_evidence_conflict"); fired();
});

test("repository captures request options before the first await", async () => {
  const fixture = await seed(), options = { snapshotId: fixture.projection!.snapshot.id, manifestHash: fixture.projection!.snapshot.manifestHash };
  const promise = new D1LinkFragmentEvidenceRepository(db, owner).get(fixture.capture.objectId, fixture.fragmentId, options);
  options.snapshotId = "other"; options.manifestHash = "0".repeat(64);
  expect(await promise).toMatchObject({ snapshotId: fixture.projection!.snapshot.id, snapshotManifestHash: fixture.projection!.snapshot.manifestHash });
});
