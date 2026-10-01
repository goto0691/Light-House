import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ANALYSIS_ATTACHMENT_READ_DEADLINE_MS, MAX_ANALYSIS_ATTACHMENT_BYTES, loadAnalysisAttachmentParts } from "@/lib/v2/ai/analysis-attachments";
import { validateAnalysisEnvelopeV1, type AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { AttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1ProcessingQueueRepository, type V2AnalysisInput } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1RecordLocationRepository } from "@/lib/v2/infrastructure/d1/record-location-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding, R2ObjectBodyBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";

class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly sql: StatementSync, private readonly afterFirst?: () => void) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { const result = (this.sql.get(...this.values) ?? null) as T | null; this.afterFirst?.(); return result; }
  async all<T>() { return { results: this.sql.all(...this.values) as T[] }; }
  async run() { return this.sql.run(...this.values); }
}
class MemoryD1 implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  afterFirst?: (query: string) => void;
  prepare(query: string) { return new Statement(this.sql.prepare(query), () => this.afterFirst?.(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.sql.exec("begin immediate");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sql.exec("commit");
      return result as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}
let db: MemoryD1;
beforeEach(() => {
  db = new MemoryD1();
  db.sql.exec("pragma foreign_keys=on; create table users(id text primary key); insert into users values ('user-a'),('user-b');");
  const directory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
  for (const file of readdirSync(directory).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 30).sort()) db.sql.exec(readFileSync(`${directory}/${file}`, "utf8"));
});
afterEach(() => { vi.useRealTimers(); db.sql.close(); });

async function seed(bodyMarkdown = "별점 4.5점", sources?: Parameters<typeof prepareCaptureCommit>[0]["sources"]) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "분석 회귀", bodyMarkdown, aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(), sources }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(capture);
  return capture;
}
function envelope(capture: Awaited<ReturnType<typeof seed>>): AnalysisEnvelopeV1 {
  return { contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "분석", document_proposals: [], entity_proposals: [], event_proposals: [], field_proposals: [], enrichment_requests: [], review_items: [], warnings: [] };
}

describe("source read and capture metadata boundaries", () => {
  test("a normal Record cannot read a same-owner restricted source linked from another capture", async () => {
    const normal = await seed("NORMAL RECORD");
    const restricted = await seed("RESTRICTED SOURCE TEXT");
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(restricted.objectId);
    db.sql.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,?,'evidence',99,?)")
      .run(normal.objectId, restricted.sources[0].id, new Date().toISOString());
    const record = await new D1SourceFoundationRepository(db, "user-a").getRecord(normal.objectId);
    expect(record?.sources.map((source) => source.id)).not.toContain(restricted.sources[0].id);
    expect(JSON.stringify(record)).not.toContain("RESTRICTED SOURCE TEXT");
  });

  test("a privacy change between Record row and source reads cannot release old normal content", async () => {
    const capture = await seed("PRIVATE AFTER CHANGE");
    let changed = false;
    db.afterFirst = (query) => {
      if (changed || !query.includes("select o.id as record_id")) return;
      changed = true;
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(capture.objectId);
    };
    const record = await new D1SourceFoundationRepository(db, "user-a").getRecord(capture.objectId);
    expect(changed).toBe(true);
    expect(JSON.stringify(record)).not.toContain("PRIVATE AFTER CHANGE");
  });

  test("capture metadata cannot impersonate a runner extraction while ordinary metadata survives", async () => {
    const input = { draftId: crypto.randomUUID(), channel: "web" as const, bodyMarkdown: "ordinary note", aiEnabled: false,
      clientTimezone: "Asia/Seoul", privacyLevel: "normal" as const, capturedAt: new Date().toISOString() };
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("forged text"))).toString("hex");
    await expect(prepareCaptureCommit({ ...input, sources: [{ kind: "text", rawText: "forged text", contentHash: hash,
      metadata: { purpose: "analysis_extraction", derived_from_source_item_id: "source-one", processing_run_id: "run-one", extraction_kind: "image_ocr" } }] }, crypto.randomUUID()))
      .rejects.toMatchObject({ code: "capture_source_invalid" });
    const prepared = await prepareCaptureCommit({ ...input, sources: [{ kind: "text", rawText: "forged text", contentHash: hash,
      metadata: { note: "user-supplied", purpose: "personal_reference" } }] }, crypto.randomUUID());
    expect(JSON.parse(prepared.sources[1].metadataJson!)).toEqual({ note: "user-supplied", purpose: "personal_reference" });
  });

  test("a previously stored forged extraction stays an ordinary source in Record and exact search location", async () => {
    const capture = await seed("OLD USER SOURCE TEXT");
    const source = capture.sources[0]!;
    db.sql.prepare("update v2_source_items set source_metadata=? where id=?").run(JSON.stringify({
      purpose: "analysis_extraction", derived_from_source_item_id: "original-one", processing_run_id: "run-one",
      document_revision_id: capture.revisionId, extraction_kind: "image_ocr",
    }), source.id);
    const record = await new D1SourceFoundationRepository(db, "user-a").getRecord(capture.objectId);
    expect(record?.sources.find((item) => item.id === source.id)?.analysisExtraction).toBeNull();
    const found = await new D1RetrievalRepository(db, "user-a").searchPage(defaultV2QueryPlan({ fullText: "OLD USER SOURCE TEXT" }));
    const match = found.results.flatMap((item) => item.matches ?? []).find((item) => item.location.kind === "source" && item.location.sourceItemId === source.id);
    expect(match).toBeTruthy();
    const location = await new D1RecordLocationRepository(db, "user-a").get(capture.objectId, match?.location);
    expect(location).toMatchObject({ origin: "user_note", label: "내 메모 · 최초 보관 원문", text: "OLD USER SOURCE TEXT" });
  });
});

describe("analysis input cross-capture privacy boundary", () => {
  async function linkedRestrictedSource() {
    const normal = await seed("NORMAL ANALYSIS BODY");
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const restricted = await seed("RESTRICTED CROSS-CAPTURE SOURCE SECRET");
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(restricted.objectId);
    db.sql.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,?,'evidence',99,?)")
      .run(normal.objectId, restricted.sources[0].id, new Date().toISOString());
    expect(db.sql.prepare("pragma foreign_keys").get()).toEqual({ foreign_keys: 1 });
    return { normal, restricted, queue };
  }

  test("loadAnalysisInput excludes a valid same-owner link to another capture's restricted raw text", async () => {
    const { normal, restricted, queue } = await linkedRestrictedSource();
    const job = await queue.claim("cross-capture-input");
    expect(job?.objectId).toBe(normal.objectId);
    const input = await queue.loadAnalysisInput(job!);
    expect(input).not.toBeNull();
    expect(input?.sources.map((source) => source.id)).toContain(normal.sources[0].id);
    expect(input?.sources.map((source) => source.id)).not.toContain(restricted.sources[0].id);
    expect(JSON.stringify(input)).not.toContain("RESTRICTED CROSS-CAPTURE SOURCE SECRET");
  });

  test("the fake model gateway never receives another capture's restricted raw text", async () => {
    const { normal, queue } = await linkedRestrictedSource();
    const gateway = new FakeV2StructuredModelGateway("success", envelope(normal));
    expect(await runNextAnalysisJob({ queue, gateway, workerId: "cross-capture-runner" })).toMatchObject({ outcome: "succeeded" });
    expect(gateway.calls).toHaveLength(1);
    expect(JSON.stringify(gateway.calls.flatMap((call) => call.parts ?? []))).not.toContain("RESTRICTED CROSS-CAPTURE SOURCE SECRET");
  });

  test("a wrongly linked manual source from another capture cannot block personal analysis", async () => {
    const { normal, restricted, queue } = await linkedRestrictedSource();
    db.sql.prepare("update v2_source_items set source_metadata=? where id=?")
      .run(JSON.stringify(makeManualLinkMetadata({ url: "https://example.test/unrelated-source" })), restricted.sources[0].id);
    const gateway = new FakeV2StructuredModelGateway("success", envelope(normal));
    expect(await runNextAnalysisJob({ queue, gateway, workerId: "cross-capture-manual-runner" })).toMatchObject({ outcome: "succeeded" });
    expect(gateway.calls).toHaveLength(1);
    expect(JSON.stringify(gateway.calls)).not.toContain("RESTRICTED CROSS-CAPTURE SOURCE SECRET");
    expect(db.sql.prepare("select status from v2_processing_jobs where object_id=?").get(normal.objectId)).toEqual({ status: "succeeded" });
  });

  test("an unrelated manual source added during a lease does not supersede its recoverable personal job", async () => {
    const { normal, restricted, queue } = await linkedRestrictedSource();
    const start = new Date();
    const job = (await queue.claim("cross-capture-before-expiry", start))!;
    await queue.beginRun(job, { ...versions, runId: "cross-capture-expiring", now: start.toISOString() });
    db.sql.prepare("update v2_source_items set source_metadata=? where id=?")
      .run(JSON.stringify(makeManualLinkMetadata({ url: "https://example.test/unrelated-source" })), restricted.sources[0].id);
    const recovered = await queue.claim("cross-capture-recovery", new Date(start.getTime() + 121_000));
    expect(recovered).toMatchObject({ id: job.id, objectId: normal.objectId, attempt: 2 });
    expect(db.sql.prepare("select status,validation_error_code from v2_processing_runs where id='cross-capture-expiring'").get())
      .toEqual({ status: "failed", validation_error_code: "lease_expired" });
    expect((await queue.loadAnalysisInput(recovered!))?.sources.map((source) => source.id)).not.toContain(restricted.sources[0].id);
  });
});
const versions = { modelId: "fake", promptVersion: "test", schemaVersion: "analysis-v1", registryVersion: "test", modelConfigVersion: "test" };

describe("analysis recovery and current-revision evidence", () => {
  test("recovers an expired running attempt and fences its late success, failure and invocation", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    const start = new Date();
    await queue.dispatchPending(10, start.toISOString());
    const oldJob = (await queue.claim("same-worker", start))!;
    await queue.beginRun(oldJob, { ...versions, runId: "old-run", now: start.toISOString() });
    const later = new Date(start.getTime() + 121_000);
    const newJob = (await queue.claim("same-worker", later))!;
    expect(newJob.attempt).toBe(2);
    expect(newJob.leaseOwner).not.toBe(oldJob.leaseOwner);
    await queue.beginRun(newJob, { ...versions, runId: "new-run", now: later.toISOString() });
    expect(await queue.acquireProviderInvocationLease(oldJob, { runId: "old-run", now: later })).toBe(false);
    expect(await queue.completeAnalysis({ job: oldJob, runId: "old-run", envelope: envelope(capture), outputHash: "old", modelId: "fake", latencyMs: 1, inputTokens: 1, outputTokens: 1, schemaVersion: "analysis-v1", validatorVersion: "test", now: later.toISOString() })).toEqual({ stale: true });
    await queue.failJob(oldJob, { runId: "old-run", errorClass: "late", errorCode: "timeout", retryable: true, now: later });
    expect(db.sql.prepare("select status,attempt,lease_owner from v2_processing_jobs").get()).toEqual({ status: "running", attempt: 2, lease_owner: newJob.leaseOwner });
    expect(db.sql.prepare("select status,validation_error_code from v2_processing_runs where id='old-run'").get()).toEqual({ status: "failed", validation_error_code: "lease_expired" });
    expect(db.sql.prepare("select count(*) as count from v2_analysis_proposals").get()).toEqual({ count: 0 });
  });

  test("does not reclaim while a provider invocation still owns a live lease", async () => {
    await seed();
    const queue = new D1ProcessingQueueRepository(db);
    const start = new Date();
    await queue.dispatchPending(10, start.toISOString());
    const job = (await queue.claim("worker", start, 10_000))!;
    await queue.beginRun(job, { ...versions, runId: "provider-run", now: start.toISOString() });
    expect(await queue.acquireProviderInvocationLease(job, { runId: "provider-run", now: start })).toBe(true);
    expect(await queue.claim("another", new Date(start.getTime() + 11_000))).toBeNull();
    expect((await queue.claim("another", new Date(start.getTime() + 121_000)))?.attempt).toBe(2);
    expect(db.sql.prepare("select count(*) as count from v2_provider_invocation_leases").get()).toEqual({ count: 0 });
  });

  test("moves exhausted expired jobs to review once instead of leaving them leased forever", async () => {
    await seed();
    const queue = new D1ProcessingQueueRepository(db);
    const start = new Date();
    await queue.dispatchPending(10, start.toISOString());
    db.sql.exec("update v2_processing_jobs set max_attempts=1");
    const job = (await queue.claim("worker", start))!;
    await queue.beginRun(job, { ...versions, runId: "exhausted-run", now: start.toISOString() });
    const later = new Date(start.getTime() + 121_000);
    expect(await queue.claim("recovery", later)).toBeNull();
    expect(await queue.claim("recovery", later)).toBeNull();
    expect(db.sql.prepare("select status from v2_processing_jobs").get()).toEqual({ status: "needs_review" });
    expect(db.sql.prepare("select count(*) as count from v2_review_items where json_extract(payload_json,'$.code')='processing_lease_exhausted'").get()).toEqual({ count: 1 });
  });

  test("recovers grounding request state and rejects a late completion from its old run", async () => {
    const capture = await seed();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", { ...envelope(capture), enrichment_requests: [{ request_id: "work", entity_kind: "work", query: "public work", requested_fields: ["director"] }] }), workerId: "main" });
    const start = new Date();
    const job = (await queue.claim("grounding", start, 120_000, "grounded_enrich"))!;
    await queue.beginGroundingRun(job, { ...versions, runId: "grounding-old", now: start.toISOString() });
    const request = (await queue.loadGroundingInput(job))!;
    const later = new Date(start.getTime() + 121_000);
    const replacement = (await queue.claim("grounding", later, 120_000, "grounded_enrich"))!;
    expect(replacement.attempt).toBe(2);
    expect(db.sql.prepare("select status from v2_grounding_requests").get()).toEqual({ status: "queued" });
    await queue.beginGroundingRun(replacement, { ...versions, runId: "grounding-new", now: later.toISOString() });
    expect(await queue.completeGrounding({ job, runId: "grounding-old", requestId: request.requestId, answer: "stale", envelope: { contract_version: "grounded-result-v1", identity_status: "resolved", canonical_name: "work", facts: [], summary: "" }, citations: [{ url: "https://example.test", title: null, startByte: 0, endByte: 1, citedText: "x" }], queries: [], outputHash: "old", modelId: "fake", latencyMs: 1, inputTokens: 1, outputTokens: 1, now: later.toISOString() })).toEqual({ stale: true });
    expect(db.sql.prepare("select status from v2_grounding_requests").get()).toEqual({ status: "running" });
    expect(db.sql.prepare("select count(*) as count from v2_grounding_results").get()).toEqual({ count: 0 });
  });

  test("analyzes the committed edit source and excludes original and derived text from a new request", async () => {
    const capture = await seed("별점 4.5점");
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const initialRef = { source_item_id: capture.sources[0]!.id, start: 0, end: capture.bodyMarkdown.length };
    const initialEnvelope: AnalysisEnvelopeV1 = { ...envelope(capture),
      document_proposals: [{ temp_id: "doc", source_item_ids: [initialRef.source_item_id], suggested_title: null, type_assignments: [{ type_key: "review", label: "리뷰", registry_action: "propose_new", evidence_refs: [initialRef] }] }],
      field_proposals: [{ temp_id: "rating", field_key: "user_rating", value: 4.5, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: [initialRef] }],
    };
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", initialEnvelope), workerId: "initial" });
    db.sql.exec("update v2_type_definitions set status='active'");
    const revision = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: capture.revisionId, title: capture.title, bodyMarkdown: "별점 2점", writtenAt: null, documentStatus: "revising", privacyLevel: "normal" }, "edit");
    await new D1DocumentAuthoringRepository(db, "user-a").saveRevision(capture.objectId, revision);
    expect(db.sql.prepare("select review_status from v2_property_values").get()).toEqual({ review_status: "superseded" });
    expect(db.sql.prepare("select review_status from v2_object_type_assignments").get()).toEqual({ review_status: "superseded" });
    await queue.dispatchPending();
    const revisedRef = { source_item_id: `revision_source:${revision.revisionId}`, start: 0, end: revision.bodyMarkdown.length };
    const revisedEnvelope: AnalysisEnvelopeV1 = { ...envelope(capture), analyzed_revision_id: revision.revisionId,
      document_proposals: [{ temp_id: "doc", source_item_ids: [revisedRef.source_item_id], suggested_title: null, type_assignments: [{ type_key: "review", label: "리뷰", registry_action: "reuse", evidence_refs: [revisedRef] }] }],
      field_proposals: [{ temp_id: "rating", field_key: "user_rating", value: 2, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: [revisedRef] }],
    };
    const gateway = new FakeV2StructuredModelGateway("success", revisedEnvelope);
    expect(await runNextAnalysisJob({ queue, gateway, workerId: "edited" })).toMatchObject({ outcome: "succeeded" });
    const part = gateway.calls[0]!.parts![0]!;
    const input = JSON.parse("text" in part ? part.text : "{}");
    expect(input.document.body_markdown).toBe("별점 2점");
    expect(input.sources).toHaveLength(1);
    expect(input.sources[0]).toMatchObject({ raw_text: "별점 2점", source_item_id: revisedRef.source_item_id });
    expect(db.sql.prepare("select value_number from v2_property_values where review_status='accepted'").all()).toEqual([{ value_number: 2 }]);
    expect(db.sql.prepare("select review_status from v2_object_type_assignments").get()).toEqual({ review_status: "accepted" });
  });

  test("keeps the user's locked rating authoritative when an edited source extracts a different value", async () => {
    const capture = await seed("별점 4.5점");
    const queue = new D1ProcessingQueueRepository(db);
    const field = { temp_id: "rating", field_key: "user_rating", value: 4.5, value_type: "rating" as const, claim_risk: "low" as const, disposition: "accepted" as const, evidence_refs: [{ source_item_id: capture.sources[0]!.id, start: 0, end: capture.bodyMarkdown.length }] };
    await queue.dispatchPending();
    await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", { ...envelope(capture), field_proposals: [field] }), workerId: "initial" });
    db.sql.exec("update v2_property_values set locked_by_user=1");
    const revision = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: capture.revisionId, title: capture.title, bodyMarkdown: "별점 2점", writtenAt: null, documentStatus: "revising", privacyLevel: "normal" }, "locked-edit");
    await new D1DocumentAuthoringRepository(db, "user-a").saveRevision(capture.objectId, revision);
    await queue.dispatchPending();
    const output = { ...envelope(capture), analyzed_revision_id: revision.revisionId, field_proposals: [{ ...field, value: 2, evidence_refs: [{ source_item_id: `revision_source:${revision.revisionId}`, start: 0, end: revision.bodyMarkdown.length }] }] };
    expect(await runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", output), workerId: "edited" })).toMatchObject({ outcome: "succeeded" });
    expect(db.sql.prepare("select value_number,locked_by_user from v2_property_values where review_status='accepted'").all()).toEqual([{ value_number: 4.5, locked_by_user: 1 }]);
    expect(db.sql.prepare("select value_number from v2_property_values where review_status='disputed'").all()).toEqual([{ value_number: 2 }]);
  });
});

async function media(mimeType: string, expectedSize?: number) {
  const bytes = new TextEncoder().encode("private original fixture");
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const id = `attachment-${crypto.randomUUID()}`;
  const reservation: AttachmentReservation = { id, userId: "user-a", objectKey: `users/user-a/originals/2026/09/${id}`, filename: "fixture.bin", expectedSize: expectedSize ?? bytes.length, expectedMimeType: mimeType, expectedSha256: hash, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  await db.prepare(`insert into v2_attachment_reservations (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at) values (?,?,'verified',?,?,?,?,?,?,?)`).bind(id, reservation.userId, reservation.objectKey, reservation.filename, mimeType, reservation.expectedSize, hash, new Date().toISOString(), reservation.expiresAt).run();
  const kind = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : "document";
  const capture = await seed("", [{ kind, attachmentId: id, contentHash: hash }]);
  let reads = 0;
  let storedBytes = bytes;
  const body = (): R2ObjectBodyBinding => ({ key: reservation.objectKey, size: reservation.expectedSize, httpMetadata: { contentType: mimeType }, customMetadata: { reservationId: id, userId: "user-a" }, checksums: {}, body: new Blob([storedBytes]).stream(), async arrayBuffer() { return Uint8Array.from(storedBytes).buffer; } });
  const bucket: R2BucketBinding = { async head() { return body(); }, async get() { reads += 1; return body(); }, async put() { throw new Error("unexpected write"); }, async delete() { throw new Error("unexpected delete"); } };
  return { capture, reservation, bytes, bucket, get reads() { return reads; }, corrupt() { storedBytes = new Uint8Array(bytes.length).fill(0); } };
}

describe("bounded multimodal provider requests", () => {
  test("keeps an image original separate while its fake OCR field reaches Record, Review and search", async () => {
    const fixture = await media("image/png");
    const source = fixture.capture.sources[0]!;
    const extractedText = "합성 지도 코드 QX742";
    const start = extractedText.indexOf("QX742");
    const output: AnalysisEnvelopeV1 = {
      ...envelope(fixture.capture),
      source_extractions: [{ source_item_id: source.id, text: extractedText, kind: "image_ocr" }],
      field_proposals: [{ temp_id: "map-code", field_key: "map_code", value: "QX742", value_type: "text", claim_risk: "low", disposition: "proposed", evidence_refs: [{ source_item_id: source.id, start, end: start + 5 }] }],
    };
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const gateway = new FakeV2StructuredModelGateway("success", output);
    expect(await runNextAnalysisJob({ queue, gateway, bucket: fixture.bucket, workerId: "image-roundtrip" })).toMatchObject({ outcome: "succeeded" });
    expect(gateway.calls[0]?.parts).toContainEqual({ inlineData: { mimeType: "image/png", data: Buffer.from(fixture.bytes).toString("base64") } });

    const record = await new D1SourceFoundationRepository(db, "user-a").getRecord(fixture.capture.objectId);
    const derived = record?.sources.find((item) => item.analysisExtraction?.kind === "image_ocr");
    expect(record?.sources.find((item) => item.id === source.id)).toMatchObject({ rawText: null, attachmentId: fixture.reservation.id });
    expect(derived).toMatchObject({ rawText: extractedText, analysisExtraction: { kind: "image_ocr", originalSourceItemId: source.id } });

    const presentation = await new D1PresentationRepository(db, "user-a").project(fixture.capture.objectId);
    expect(presentation.reviewItems).toEqual(expect.arrayContaining([expect.objectContaining({ field: expect.objectContaining({
      fieldKey: "map_code", value: "QX742", evidence: [expect.objectContaining({ sourceItemId: derived?.id, quote: "QX742" })],
    }) })]));
    const found = await new D1RetrievalRepository(db, "user-a").searchPage(defaultV2QueryPlan({ fullText: "QX742" }));
    expect(found.results).toEqual(expect.arrayContaining([expect.objectContaining({ recordId: fixture.capture.objectId })]));
    const match = found.results.flatMap((item) => item.matches ?? []).find((item) => item.location.kind === "source" && item.location.sourceItemId === derived?.id);
    expect(match?.origin).toBe("source");
    const opened = await new D1RecordLocationRepository(db, "user-a").get(fixture.capture.objectId, match?.location);
    expect(opened).toMatchObject({ origin: "source", label: "이미지에서 읽은 텍스트 · AI 추출", text: extractedText });
  });

  test.each([['image/png', 'image_ocr'], ['audio/mpeg', 'transcript_extract'], ['application/pdf', 'document_extract']] as const)("sends %s bytes and preserves extracted evidence", async (mime, kind) => {
    const fixture = await media(mime);
    const source = fixture.capture.sources[0]!;
    const output: AnalysisEnvelopeV1 = { ...envelope(fixture.capture), source_extractions: [{ source_item_id: source.id, text: "4.5", kind }], field_proposals: [{ temp_id: "rating", field_key: "user_rating", value: 4.5, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: [{ source_item_id: source.id, start: 0, end: 3 }] }] };
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const gateway = new FakeV2StructuredModelGateway("success", output);
    expect(await runNextAnalysisJob({ queue, gateway, bucket: fixture.bucket, workerId: "media" })).toMatchObject({ outcome: "succeeded" });
    expect(gateway.calls[0]?.parts).toContainEqual({ inlineData: { mimeType: mime, data: Buffer.from(fixture.bytes).toString("base64") } });
    const evidence = db.sql.prepare("select s.raw_text,s.source_metadata,p.value_number,p.source_class from v2_evidence_refs e join v2_source_items s on s.id=e.source_item_id join v2_property_values p on p.id=e.target_id where e.target_kind='property_value'").get()!;
    expect(evidence.raw_text).toBe("4.5");
    expect(JSON.parse(String(evidence.source_metadata))).toMatchObject({ derived_from_source_item_id: source.id, purpose: "analysis_extraction" });
    expect(evidence.source_class).toBe(kind === "document_extract" ? "ai_inferred" : kind);
    expect(evidence.value_number).toBe(4.5);
    expect(db.sql.prepare("select raw_text from v2_source_items where id=?").get(source.id)).toEqual({ raw_text: null });
  });

  test("rejects a foreign reservation before reading bytes or calling the model", async () => {
    const fixture = await media("image/png");
    db.sql.prepare("update v2_attachment_reservations set user_id='user-b' where id=?").run(fixture.reservation.id);
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const gateway = new FakeV2StructuredModelGateway("success", envelope(fixture.capture));
    expect(await runNextAnalysisJob({ queue, gateway, bucket: fixture.bucket, workerId: "foreign" })).toMatchObject({ outcome: "needs_review" });
    expect(gateway.calls).toHaveLength(0);
    expect(fixture.reads).toBe(0);
  });

  test("rejects changed original bytes and keeps them out of the provider request", async () => {
    const fixture = await media("image/png");
    fixture.corrupt();
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const gateway = new FakeV2StructuredModelGateway("success", envelope(fixture.capture));
    expect(await runNextAnalysisJob({ queue, gateway, bucket: fixture.bucket, workerId: "corrupt" })).toMatchObject({ outcome: "needs_review" });
    expect(gateway.calls).toHaveLength(0);
  });

  test("preserves oversized originals and records an actionable review without reading them", async () => {
    const fixture = await media("audio/mpeg", MAX_ANALYSIS_ATTACHMENT_BYTES + 1);
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const gateway = new FakeV2StructuredModelGateway("success", envelope(fixture.capture));
    expect(await runNextAnalysisJob({ queue, gateway, bucket: fixture.bucket, workerId: "oversized" })).toMatchObject({ outcome: "needs_review" });
    expect(fixture.reads).toBe(0);
    expect(gateway.calls).toHaveLength(0);
    const review = db.sql.prepare("select payload_json from v2_review_items where json_extract(payload_json,'$.code')='attachment_analysis_unavailable'").get();
    expect(String(review?.payload_json)).toContain("8 MiB");
    expect(db.sql.prepare("select status from v2_attachment_reservations").get()).toEqual({ status: "committed" });
  });

  test("rechecks the invocation owner after reading bytes and never calls a reclaimed attempt", async () => {
    const fixture = await media("image/png");
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const racedBucket: R2BucketBinding = { ...fixture.bucket, async get(key) {
      db.sql.exec("update v2_processing_jobs set lease_expires_at='2000-01-01T00:00:00.000Z'; update v2_provider_invocation_leases set expires_at='2000-01-01T00:00:00.000Z';");
      await queue.claim("replacement");
      return fixture.bucket.get(key);
    } };
    const gateway = new FakeV2StructuredModelGateway("success", envelope(fixture.capture));
    expect(await runNextAnalysisJob({ queue, gateway, bucket: racedBucket, workerId: "expired-during-read" })).toMatchObject({ outcome: "superseded" });
    expect(gateway.calls).toHaveLength(0);
    expect(db.sql.prepare("select status,attempt from v2_processing_jobs").get()).toEqual({ status: "leased", attempt: 2 });
  });

  test("cancels a stalled attachment stream when its preparation deadline expires", async () => {
    const fixture = await media("image/png");
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const job = (await queue.claim("slow"))!;
    const input = (await queue.loadAnalysisInput(job))!;
    let canceled = false;
    const slowBucket: R2BucketBinding = { ...fixture.bucket, async get(key) {
      const original = (await fixture.bucket.get(key))!;
      return { ...original, body: new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }) };
    } };
    vi.useFakeTimers();
    const request = loadAnalysisAttachmentParts(input, slowBucket);
    const assertion = expect(request).rejects.toMatchObject({ code: "timeout", retryable: true });
    await vi.advanceTimersByTimeAsync(ANALYSIS_ATTACHMENT_READ_DEADLINE_MS + 1);
    await assertion;
    expect(canceled).toBe(true);
  });

  test("requires extracted text before trusting non-null attachment evidence offsets", async () => {
    const capture = await seed();
    const result = { ...envelope(capture), field_proposals: [{ temp_id: "f", field_key: "rating", value: 4, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: [{ source_item_id: "image", start: 0, end: 4 }] }] };
    expect(() => validateAnalysisEnvelopeV1(result, { captureId: capture.captureId, revisionId: capture.revisionId, sourceLengths: new Map([["image", null]]) })).toThrow("source text or extraction bounds");
  });

  test("enforces both the aggregate byte budget and the five-point rating normalization", async () => {
    const fixture = await media("image/png", 6 * 1024 * 1024);
    const queue = new D1ProcessingQueueRepository(db);
    await queue.dispatchPending();
    const job = (await queue.claim("budget"))!;
    const input = (await queue.loadAnalysisInput(job))!;
    const duplicated: V2AnalysisInput = { ...input, sources: [...input.sources, ...input.sources] };
    await expect(loadAnalysisAttachmentParts(duplicated, fixture.bucket)).rejects.toThrow("10 MiB");
    expect(fixture.reads).toBe(0);
    const base = envelope(fixture.capture);
    const context = { captureId: base.capture_id, revisionId: base.analyzed_revision_id, sourceLengths: new Map([["text", 20]]) };
    const field = { temp_id: "r", field_key: "rating", value: 90, value_type: "rating", claim_risk: "low", disposition: "accepted", evidence_refs: [{ source_item_id: "text", start: 0, end: 3 }] };
    expect(() => validateAnalysisEnvelopeV1({ ...base, field_proposals: [field] }, context)).toThrow("value type");
    expect(validateAnalysisEnvelopeV1({ ...base, field_proposals: [{ ...field, value: 4.5, rating_original: { value: 90, maximum: 100 } }] }, context).field_proposals[0]?.value).toBe(4.5);
    expect(() => validateAnalysisEnvelopeV1({ ...base, field_proposals: [{ ...field, value: 5, rating_original: { value: 90, maximum: 100 } }] }, context)).toThrow("explicitly recorded original scale");
  });
});
