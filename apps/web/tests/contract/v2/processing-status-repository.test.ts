import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { prepareCaptureCommit, type PreparedCaptureCommit } from "@/lib/v2/domain/capture-source";
import { encodeProcessingCursor, type ProcessingStatus } from "@/lib/v2/domain/processing-status";
import { D1ProcessingStatusRepository } from "@/lib/v2/infrastructure/d1/processing-status-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkMemoryD1, linkFixture, seedLinkRun } from "./link-presentation-fixture";

const now = "2026-09-22T14:00:00.000Z", earlier = "2026-09-22T13:00:00.000Z", later = "2026-09-22T15:00:00.000Z";
let db: LinkMemoryD1;
beforeEach(() => { db = new LinkMemoryD1(32); });
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); });
async function capture(options: { owner?: string; privacy?: "normal" | "sensitive" | "restricted"; ai?: boolean; savedAt?: string; title?: string } = {}) {
  const value = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: options.title ?? "정상 제목",
    bodyMarkdown: "PRIVATE ORIGINAL MUST NOT APPEAR", aiEnabled: options.ai ?? false, privacyLevel: options.privacy ?? "normal",
    clientTimezone: "Asia/Seoul", capturedAt: earlier }, crypto.randomUUID(), options.savedAt ?? now);
  await new D1SourceFoundationRepository(db, options.owner ?? "link-owner").commitCapture(value);
  return value;
}
function job(record: PreparedCaptureCommit, options: { id?: string; owner?: string; captureId?: string; stage?: string; status?: string; hash?: string; revision?: string; createdAt?: string; lease?: string | null } = {}) {
  const id = options.id ?? crypto.randomUUID();
  db.sql.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at,lease_owner,lease_expires_at,last_error_code)
    values (?,?,?,?,?,?,?,3,?,?,?,?, 'PRIVATE_LEASE_OWNER',?,'PRIVATE_PROVIDER_ERROR')`).run(id, options.owner ?? "link-owner", options.captureId ?? record.captureId,
      record.objectId, options.stage ?? "analyze", options.status ?? "succeeded", id, later, options.revision ?? record.revisionId,
      options.hash ?? "synthetic", options.createdAt ?? now, options.lease ?? null);
  return id;
}
function run(jobId: string, status = "succeeded", options: { owner?: string; createdAt?: string; id?: string } = {}) {
  const id = options.id ?? crypto.randomUUID();
  const inputHash = (db.sql.prepare("select input_hash from v2_processing_jobs where id=?").get(jobId) as { input_hash: string }).input_hash;
  db.sql.prepare(`insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at,validation_error_code)
    values (?,?,?,'structured','PRIVATE_MODEL','p','s','r','m',?,?,?,'PRIVATE_VALIDATION_ERROR')`).run(id, jobId, options.owner ?? "link-owner", inputHash, status, options.createdAt ?? now);
  return id;
}
function completedJob(record: PreparedCaptureCommit, options: Parameters<typeof job>[1] = {}) {
  const id = job(record, { ...options, status: "succeeded" }); run(id); return id;
}
function review(record: PreparedCaptureCommit, status = "open", owner = "link-owner") {
  db.sql.prepare(`insert into v2_review_items(id,user_id,object_id,kind,status,payload_json,created_at)
    values (?,?,?,'analysis_review',?,'{"private":"PRIVATE_REVIEW_PAYLOAD"}',?)`).run(crypto.randomUUID(), owner, record.objectId, status, now);
}
function mapping(record: PreparedCaptureCommit, status: string) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_legacy_source_envelopes(id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
    values (?,'link-owner','notes',?,'{}',?,?,'audit','[]','processing-status-audit')`).run(id, id, id, now);
  db.sql.prepare(`insert into v2_legacy_source_mappings(id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,created_at)
    values (?,'link-owner',?,'notes',?,'audit-v1',?,?,'document',?,?)`).run(id, id, id, record.sources[0].id, record.objectId, status, now);
}
const read = (input: { filter?: unknown; cursor?: unknown } = {}, owner = "link-owner") => new D1ProcessingStatusRepository(db, owner)
  .list({ ...input, now: new Date(now), runtime: { enabled: true, configured: true } });

describe("processing status actual SQLite projection", () => {
  test("empty state has bounded DTO, all filter counts and explicit unknown runtime roles", async () => {
    expect(await read()).toEqual({ contract: "processing-status.v1", filter: "all", items: [], nextCursor: null, checkedAt: now,
      counts: { all: 0, waiting: 0, attention: 0, completed: 0, unprocessed: 0 }, runtime: { enabled: true, configured: true,
        roles: [{ role: "main_analyzer", state: "unknown", retryAt: null }, { role: "grounded_enricher", state: "unknown", retryAt: null }] } });
  });
  test("storage saved is independent of AI-disabled/unprocessed and queued outbox", async () => {
    const idle = await capture(), queued = await capture({ ai: true });
    const result = await read();
    expect(result.items.find((item) => item.recordId === idle.objectId)).toMatchObject({ status: "unprocessed", storage: "saved", savedAt: now, stages: [] });
    expect(result.items.find((item) => item.recordId === queued.objectId)).toMatchObject({ status: "queued", storage: "saved", stages: [] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE ORIGINAL");
  });
  test.each<[string, ProcessingStatus]>([["queued", "queued"], ["running", "processing"], ["leased", "queued"], ["retry_wait", "retry_wait"],
    ["succeeded", "completed"], ["needs_review", "needs_review"], ["dead_letter", "needs_review"], ["superseded", "outdated"]])("current %s job maps to %s", async (status, expected) => {
    const record = await capture(); const id = job(record, { status, lease: later }); if (status === "succeeded") run(id);
    const item = (await read()).items[0];
    expect(item).toMatchObject({ status: expected, partial: false, reviewPending: false,
      stages: [{ stage: "analyze", status: expected, count: 1, nextAttemptAt: ["queued", "retry_wait"].includes(status) ? later : null }] });
  });
  test("a succeeded job without a matching successful run still requires attention", async () => {
    const record = await capture(); const id = job(record);
    expect((await read()).items[0]).toMatchObject({ status: "needs_review", stages: [{ status: "needs_review" }] });
    run(id); expect((await read()).items[0]).toMatchObject({ status: "completed", stages: [{ status: "completed" }] });
  });
  test("an expired worker lease is attention, without renewing or retrying it on GET", async () => {
    const record = await capture(); const id = job(record, { status: "running", lease: earlier });
    const before = db.sql.prepare("select * from v2_processing_jobs where id=?").get(id);
    db.sql.exec("pragma query_only=on");
    expect((await read()).items[0].status).toBe("needs_review");
    expect(db.sql.prepare("select * from v2_processing_jobs where id=?").get(id)).toEqual(before);
  });
  test("an active provider invocation protects an expired worker lease from false failure", async () => {
    const record = await capture(); const id = job(record, { status: "running", lease: earlier }), runId = run(id, "running");
    db.sql.prepare(`insert into v2_provider_invocation_leases(job_id,run_id,user_id,object_id,lease_owner,stage,expires_at,acquired_at,updated_at)
      values (?,?,'link-owner',?,'PRIVATE_LEASE_OWNER','analyze',?,?,?)`).run(id, runId, record.objectId, later, earlier, earlier);
    expect((await read()).items[0].status).toBe("processing");
    db.sql.prepare("update v2_provider_invocation_leases set expires_at=? where job_id=?").run(earlier, id);
    expect((await read()).items[0].status).toBe("needs_review");
  });
  test("newest stage job wins deterministically by created time and id", async () => {
    const record = await capture(); job(record, { id: "z-old", status: "dead_letter", createdAt: earlier });
    job(record, { id: "a-new", status: "dead_letter" }); completedJob(record, { id: "z-new" });
    expect((await read()).items[0]).toMatchObject({ status: "completed", stages: [{ count: 1, status: "completed" }] });
  });
  test("grounding siblings retain different hashes but supersede attempts for the same hash", async () => {
    const record = await capture(); completedJob(record);
    job(record, { stage: "grounded_enrich", hash: "first", status: "dead_letter", createdAt: earlier });
    completedJob(record, { stage: "grounded_enrich", hash: "first" });
    job(record, { stage: "grounded_enrich", hash: "second", status: "retry_wait" });
    completedJob(record, { stage: "grounded_enrich", hash: "third" });
    expect((await read()).items[0]).toMatchObject({ status: "retry_wait", stages: [
      { stage: "analyze", status: "completed", count: 1 }, { stage: "grounded_enrich", status: "completed", count: 2 },
      { stage: "grounded_enrich", status: "retry_wait", count: 1, nextAttemptAt: later }] });
  });
  test("latest partial run requires review even when job succeeded", async () => {
    const record = await capture(), id = job(record); run(id, "succeeded", { createdAt: earlier }); run(id, "partial");
    expect((await read()).items[0]).toMatchObject({ status: "needs_review", partial: true, reviewPending: false });
  });
  test("old partial and foreign latest run do not overwrite current successful run", async () => {
    const record = await capture(), id = job(record); run(id, "partial", { createdAt: earlier }); run(id);
    run(id, "partial", { owner: "link-other", createdAt: later });
    expect((await read()).items[0]).toMatchObject({ status: "completed", partial: false });
  });
  test("run input hash must match its job before partial or stale flags are trusted", async () => {
    const record = await capture(), id = job(record); run(id, "succeeded", { createdAt: earlier });
    const mismatched = run(id, "partial");
    db.sql.prepare("update v2_processing_runs set input_hash='different-input' where id=?").run(mismatched);
    expect((await read()).items[0]).toMatchObject({ status: "completed", partial: false });
  });
  test.each(["stale", "superseded"])("a %s latest run prevents completed classification", async (status) => {
    const record = await capture(); run(job(record), status);
    expect((await read()).items[0].status).toBe("outdated");
  });
  test("open owner review takes precedence; resolved/dismissed/foreign reviews do not", async () => {
    const record = await capture(); completedJob(record); review(record, "resolved"); review(record, "dismissed"); review(record, "open", "link-other");
    expect((await read()).items[0]).toMatchObject({ status: "completed", reviewPending: false });
    review(record); expect((await read()).items[0]).toMatchObject({ status: "needs_review", reviewPending: true });
  });
  test.each(["foreign-run", "other-record-run"])("a %s cannot attach open review metadata to this record", async (mismatch) => {
    const record = await capture(), other = await capture(); completedJob(record);
    const badRun = run(job(other), "succeeded", { owner: mismatch === "foreign-run" ? "link-other" : "link-owner" });
    review(record); db.sql.prepare("update v2_review_items set processing_run_id=? where object_id=?").run(badRun, record.objectId);
    expect((await read()).items.find((item) => item.recordId === record.objectId)).toMatchObject({ status: "completed", reviewPending: false });
  });
  test("failed outbox is attention; another owner's outbox cannot enqueue this record", async () => {
    const record = await capture({ ai: true });
    db.sql.prepare("update v2_processing_outbox set status='failed' where capture_id=?").run(record.captureId);
    expect((await read()).items[0].status).toBe("needs_review");
    db.sql.prepare("update v2_processing_outbox set user_id='link-other',status='pending' where capture_id=?").run(record.captureId);
    expect((await read()).items[0].status).toBe("unprocessed");
  });
  test("jobs for a prior revision are outdated, not current completed, queued or review flags", async () => {
    const record = await capture(); const id = job(record); run(id, "partial");
    db.sql.prepare(`insert into v2_document_revisions(id,document_object_id,parent_revision_id,body_markdown,content_hash,author_kind,change_reason,created_at,revision_number)
      values ('next-revision',?,?,'PRIVATE NEW BODY','new-hash','user','edit',?,2)`).run(record.objectId, record.revisionId, later);
    db.sql.prepare("update v2_documents set current_revision_id='next-revision',current_version=2 where object_id=?").run(record.objectId);
    expect((await read()).items[0]).toMatchObject({ status: "outdated", stages: [], partial: false });
  });
  test("wrong owner and capture jobs never become current stages or past-job status", async () => {
    const record = await capture(), other = await capture();
    job(record, { owner: "link-other", status: "dead_letter" }); job(record, { captureId: other.captureId, status: "running" });
    expect((await read()).items.find((item) => item.recordId === record.objectId)).toMatchObject({ status: "unprocessed", stages: [] });
  });
  test("unknown stages require attention but never enter the stage DTO or leak their names", async () => {
    const record = await capture(); job(record, { stage: "PRIVATE_FUTURE_STAGE" });
    const result = await read(); expect(result.items[0]).toMatchObject({ status: "needs_review", stages: [] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FUTURE_STAGE");
  });
  test("sensitive title redacts while restricted reveals no stages, partial or review metadata", async () => {
    const sensitive = await capture({ privacy: "sensitive", title: "PRIVATE SENSITIVE TITLE" }), restricted = await capture({ privacy: "restricted", title: "PRIVATE RESTRICTED TITLE", ai: true });
    completedJob(sensitive); run(job(restricted), "partial"); review(restricted);
    const result = await read();
    expect(result.items.find((item) => item.recordId === sensitive.objectId)).toMatchObject({ title: "민감 기록", status: "completed" });
    expect(result.items.find((item) => item.recordId === restricted.objectId)).toMatchObject({ title: "잠긴 기록", status: "restricted", partial: false, reviewPending: false, stages: [] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|payload|revisionId|inputHash|leaseOwner|lastError/);
  });
  test("owner scope, canonical aliases, lifecycle, capture owner and revision ownership are all fenced", async () => {
    const visible = await capture(), archived = await capture(), foreign = await capture({ owner: "link-other" }), alias = await capture(), deleted = await capture(), corruptCapture = await capture(), corruptRevision = await capture();
    db.sql.prepare("update v2_objects set lifecycle_status='archived' where id=?").run(archived.objectId);
    db.sql.prepare("update v2_objects set canonical_object_id=? where id=?").run(visible.objectId, alias.objectId);
    db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(deleted.objectId);
    db.sql.prepare("update v2_capture_bundles set user_id='link-other' where id=?").run(corruptCapture.captureId);
    db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(visible.revisionId, corruptRevision.objectId);
    expect((await read()).items.map((item) => item.recordId).sort()).toEqual([visible.objectId, archived.objectId].sort());
    expect((await read({}, "link-other")).items.map((item) => item.recordId)).toEqual([foreign.objectId]);
  });
  test("missing current revision and merged records stay outside items and counts", async () => {
    const broken = await capture(), merged = await capture();
    db.sql.prepare("update v2_documents set current_revision_id='absent' where object_id=?").run(broken.objectId);
    db.sql.prepare("update v2_objects set lifecycle_status='merged' where id=?").run(merged.objectId);
    expect(await read()).toMatchObject({ items: [], counts: { all: 0 } });
  });
  test("legacy native, projected, hidden, mixed and orphan cases retain visibility contract", async () => {
    const native = await capture(), projected = await capture(), hidden = await capture(), mixed = await capture(), orphan = await capture();
    mapping(projected, "projected"); mapping(hidden, "preserved"); mapping(mixed, "projected"); mapping(mixed, "preserved");
    db.sql.prepare("update v2_capture_bundles set draft_id=? where id=?").run(`legacy:${crypto.randomUUID()}`, orphan.captureId);
    db.sql.prepare("update v2_capture_bundles set draft_id=? where id=?").run(`legacy:${crypto.randomUUID()}`, projected.captureId);
    expect((await read()).items.map((item) => item.recordId).sort()).toEqual([native.objectId, projected.objectId].sort());
  });
  test("current link snapshot job and published proposed fragments expose review pending, not private text", async () => {
    const fixture = await linkFixture(db); const seeded = await seedLinkRun(db, fixture);
    db.sql.prepare("update v2_documents set title='링크 자료' where object_id=?").run(fixture.capture.objectId);
    const result = await read(); expect(result.items[0]).toMatchObject({ status: "needs_review", reviewPending: true, stages: [{ stage: "link_analyze", count: 1 }] });
    expect(JSON.stringify(result)).not.toMatch(/PERSONAL MEMO|portrait|interpretation|rawText/);
    db.sql.prepare("update v2_link_fragments set review_status='confirmed' where processing_run_id=?").run(seeded.id);
    expect((await read()).items[0]).toMatchObject({ status: "completed", reviewPending: false });
  });
  test("prior published proposed fragments remain review pending while newer same-input work is queued", async () => {
    const fixture = await linkFixture(db); await seedLinkRun(db, fixture, { createdAt: earlier });
    const newest = await seedLinkRun(db, fixture, { createdAt: now, publish: false });
    db.sql.prepare("update v2_processing_jobs set status='queued' where id=?").run(newest.jobId);
    expect((await read()).items[0]).toMatchObject({ status: "needs_review", reviewPending: true, stages: [{ stage: "link_analyze", status: "queued" }] });
  });
  test("unpublished proposed fragments alone do not create a visible review requirement", async () => {
    const fixture = await linkFixture(db); await seedLinkRun(db, fixture, { publish: false });
    expect((await read()).items[0]).toMatchObject({ status: "completed", reviewPending: false });
  });
  test("no current snapshot cannot promote a past link job as completed", async () => {
    const fixture = await linkFixture(db); await seedLinkRun(db, fixture);
    db.sql.prepare("update v2_documents set current_link_snapshot_id=null where object_id=?").run(fixture.capture.objectId);
    expect((await read()).items[0]).toMatchObject({ status: "outdated", reviewPending: false, stages: [] });
  });
  test("a current snapshot from another record cannot validate link job or review", async () => {
    const first = await linkFixture(db), other = await linkFixture(db); await seedLinkRun(db, first);
    db.sql.prepare("update v2_documents set current_link_snapshot_id=? where object_id=?").run(other.projection!.snapshot.id, first.capture.objectId);
    expect((await read()).items.find((item) => item.recordId === first.capture.objectId)).toMatchObject({ status: "outdated", reviewPending: false, stages: [] });
  });
  test("manual external sources never use personal analyzer, grounding or synthetic personal outbox", async () => {
    const fixture = await linkFixture(db); job(fixture.capture); job(fixture.capture, { stage: "grounded_enrich" });
    db.sql.prepare(`insert into v2_processing_outbox(id,user_id,capture_id,event_type,payload_json,status,created_at)
      values ('external-outbox','link-owner',?,'analyze','{}','failed',?)`).run(fixture.capture.captureId, now);
    expect((await read()).items[0]).toMatchObject({ status: "outdated", stages: [] });
  });
  test("malformed unrelated source metadata does not kill a safe personal status read", async () => {
    const record = await capture(); completedJob(record);
    db.sql.prepare("update v2_source_items set source_metadata='{' where id=?").run(record.sources[0].id);
    expect((await read()).items[0].status).toBe("completed");
  });
  test("45 equal-time records use 20-item keyset pages without duplicates or omissions", async () => {
    const records = []; for (let index = 0; index < 45; index++) records.push(await capture());
    const first = await read(), second = await read({ cursor: first.nextCursor }), third = await read({ cursor: second.nextCursor });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([20, 20, 5]); expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items].map((item) => item.recordId)).toEqual(records.map((item) => item.objectId).sort().reverse());
    expect([first.counts.all, second.counts.all, third.counts.all]).toEqual([45, 45, 45]);
  });
  test("keyset prioritizes savedAt before id and does not repeat records after a newer insertion", async () => {
    for (let index = 0; index < 21; index++) await capture({ savedAt: earlier });
    const first = await read(); const newest = await capture({ savedAt: later });
    const second = await read({ cursor: first.nextCursor });
    expect(second.items).toHaveLength(1); expect(second.counts.all).toBe(22);
    expect(second.items.map((item) => item.recordId)).not.toContain(newest.objectId);
    expect((await read()).items[0].recordId).toBe(newest.objectId);
  });
  test("each filter shares global counts while returning only its category", async () => {
    const idle = await capture(), locked = await capture({ privacy: "restricted" }), waiting = await capture({ ai: true }), done = await capture(), attention = await capture();
    completedJob(done); job(attention, { status: "dead_letter" });
    for (const [filter, ids] of [["waiting", [waiting.objectId]], ["completed", [done.objectId]], ["attention", [attention.objectId]], ["unprocessed", [idle.objectId, locked.objectId]]] as const) {
      const result = await read({ filter }); expect(result.items.map((item) => item.recordId).sort()).toEqual([...ids].sort());
      expect(result.counts).toEqual({ all: 5, waiting: 1, attention: 1, completed: 1, unprocessed: 2 });
    }
  });
  test("counts, items and runtime come from one statement even if data changes after its read", async () => {
    const record = await capture(); let dataReads = 0;
    db.afterRead = (query) => {
      if (!query.includes("ranked_jobs")) return;
      dataReads++; db.sql.prepare("update v2_objects set user_id='link-other' where id=?").run(record.objectId);
    };
    const first = await read(); expect(dataReads).toBe(1); expect(first.items).toHaveLength(1); expect(first.counts.all).toBe(1);
    db.afterRead = null; expect(await read()).toMatchObject({ items: [], counts: { all: 0 } });
  });
  test("runtime exports only fixed role/state/retryAt and caller booleans, without writes", async () => {
    await capture();
    db.sql.prepare(`insert into v2_ai_runtime_state(model_role,state,consecutive_failures,retry_after,probe_owner,probe_expires_at,last_error_code,updated_at)
      values ('main_analyzer','throttled',12,?,'PRIVATE_PROBE',?,'PRIVATE_ERROR',?)`).run(later, later, now);
    const before = db.sql.prepare("select total_changes() as changes").get(); db.sql.exec("pragma query_only=on");
    const result = await new D1ProcessingStatusRepository(db, "link-owner").list({ runtime: { enabled: false, configured: false }, now: new Date(now) });
    expect(result.runtime).toEqual({ enabled: false, configured: false, roles: [{ role: "main_analyzer", state: "throttled", retryAt: later }, { role: "grounded_enricher", state: "unknown", retryAt: null }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|consecutive|probe|error|token/i);
    expect(db.sql.prepare("select total_changes() as changes").get()).toEqual(before);
  });
  test("runtime configuration is captured before the asynchronous schema probe", async () => {
    const runtime = { enabled: false, configured: false }; db.afterRead = () => { runtime.enabled = true; runtime.configured = true; };
    const result = await new D1ProcessingStatusRepository(db, "link-owner").list({ runtime, now: new Date(now) });
    expect(result.runtime).toMatchObject({ enabled: false, configured: false });
  });
  test.each([{ filter: "bogus" }, { filter: [] }, { cursor: "{" }, { cursor: "[]" }, { cursor: "x".repeat(1025) },
    { cursor: JSON.stringify(["invalid", "id", "all"]) }, { cursor: encodeProcessingCursor(now, "id", "waiting") },
    { cursor: JSON.stringify([now, "", "all"]) }])("invalid filter/cursor rejects before SQL: %j", async (input) => {
    const spy = vi.spyOn(db, "prepare"); await expect(read(input)).rejects.toMatchObject({ code: "processing_status_query_invalid" }); expect(spy).not.toHaveBeenCalled();
  });
});
