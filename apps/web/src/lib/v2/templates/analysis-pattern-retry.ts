import type { V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { observeCompletedAnalysisPattern, type AnalysisPatternObservationOutcome } from "@/lib/v2/templates/analysis-pattern-observer";

const OPERATION = "template_pattern.observe_analysis.v1";
const RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
type ObservationInput = Readonly<{ job: V2ProcessingJob; runId: string; now: string }>;
type Observer = typeof observeCompletedAnalysisPattern;
type Receipt = { payload_hash: string; response_json: string; status_code: number };
type RetryJobRow = {
  id: string; user_id: string; capture_id: string; object_id: string; input_revision_id: string;
  input_hash: string; attempt: number; max_attempts: number; run_id: string;
};

// The committed successful run/proposal is the durable work ledger. No enqueue
// write has to succeed after the analysis transaction for recovery to find it.
const COMPLETED_ANALYSIS = `from v2_processing_jobs j
  join v2_processing_runs r on r.job_id=j.id and r.user_id=j.user_id
    and r.status='succeeded' and r.input_hash=j.input_hash
  join v2_analysis_proposals a on a.job_id=j.id and a.run_id=r.id and a.user_id=j.user_id
    and a.capture_id=j.capture_id and a.object_id=j.object_id and a.input_revision_id=j.input_revision_id
    and a.input_hash=j.input_hash and a.output_hash=r.output_hash and a.status='validated'
  join v2_objects o on o.id=j.object_id and o.user_id=j.user_id and o.lifecycle_status='active'
  join v2_documents d on d.object_id=o.id and d.capture_id=j.capture_id
    and d.current_revision_id=j.input_revision_id and d.analyzed_revision_id=j.input_revision_id and d.privacy_level='normal'
  join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
  join v2_capture_bundles c on c.id=d.capture_id and c.user_id=j.user_id and c.ai_enabled=1`;

function receiptData(receipt: Receipt | null): { outcome?: AnalysisPatternObservationOutcome; attempt: number } {
  try {
    const data = JSON.parse(receipt?.response_json ?? "{}");
    const outcome = ["skipped", "observed", "generated"].includes(data.outcome) ? data.outcome as AnalysisPatternObservationOutcome : undefined;
    return { outcome, attempt: Number.isSafeInteger(data.attempt) && data.attempt > 0 ? Math.min(data.attempt, 10) : 0 };
  } catch { return { attempt: 0 }; }
}

async function saveReceipt(db: D1DatabaseBinding, input: ObservationInput, response: object, status: number) {
  // Operation and key stay owner-scoped. A slower failing worker must never
  // downgrade a success written by another observer of the same run.
  await db.prepare(`insert into v2_idempotency_records
    (user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
    values (?,?,?,?,?,?,?)
    on conflict(user_id,operation,idempotency_key) do update set
      response_json=excluded.response_json,status_code=excluded.status_code,created_at=excluded.created_at
    where v2_idempotency_records.payload_hash=excluded.payload_hash and v2_idempotency_records.status_code<>200`)
    .bind(input.job.userId, OPERATION, input.runId, input.job.inputHash, JSON.stringify(response), status, input.now).run();
}

/** Post-commit effect only: failures leave the successful analysis untouched.
 * Receipts contain no source text, field values, titles, or error messages.
 * Repeating a partially completed observation is safe under the repository's
 * source uniqueness and generated-template publication guards.
 */
export async function observeAnalysisPatternWithRetry(
  db: D1DatabaseBinding,
  input: ObservationInput,
  observe: Observer = observeCompletedAnalysisPattern,
): Promise<AnalysisPatternObservationOutcome> {
  if (input.job.stage !== "analyze") return "skipped";
  const legacyVisibility = await legacyProjectionVisibilityPredicate(db);
  // Recheck source/run identity, consent and current revision even on a receipt
  // replay. A receipt is an execution checkpoint, never authority to read data.
  const eligible = await db.prepare(`select 1 as eligible ${COMPLETED_ANALYSIS}
    where j.stage='analyze' and j.status='succeeded' and r.id=? and j.id=? and j.user_id=?
      and j.object_id=? and j.capture_id=? and j.input_revision_id=? and j.input_hash=? and ${legacyVisibility} limit 1`)
    .bind(input.runId, input.job.id, input.job.userId, input.job.objectId, input.job.captureId, input.job.inputRevisionId, input.job.inputHash)
    .first<{ eligible: number }>();
  if (!eligible) return "skipped";
  const receipt = await db.prepare(`select payload_hash,response_json,status_code from v2_idempotency_records
    where user_id=? and operation=? and idempotency_key=? limit 1`)
    .bind(input.job.userId, OPERATION, input.runId).first<Receipt>();
  if (receipt && receipt.payload_hash !== input.job.inputHash) throw new Error("template_pattern_receipt_conflict");
  const previous = receiptData(receipt);
  if (receipt?.status_code === 200) {
    if (!previous.outcome) throw new Error("template_pattern_receipt_conflict");
    return previous.outcome;
  }
  try {
    const outcome = await observe(db, input);
    await saveReceipt(db, input, { outcome }, 200);
    return outcome;
  } catch {
    const attempt = previous.attempt + 1;
    const retryAt = new Date(Date.parse(input.now) + Math.min(MAX_RETRY_DELAY_MS, RETRY_DELAY_MS * 2 ** (attempt - 1))).toISOString();
    try { await saveReceipt(db, input, { outcome: "failed", code: "template_pattern_observation_failed", attempt, retryAt }, 503); }
    catch { /* A database outage cannot erase the committed run/proposal ledger. */ }
    throw new Error("template_pattern_observation_failed");
  }
}

/** Bounded local recovery, including a process stopping before the first
 * observation or before its receipt. Backoff moves repeatedly failing runs
 * out of the due set so they cannot starve later successful runs.
 */
export async function retryAnalysisPatternObservations(
  db: D1DatabaseBinding,
  input: Readonly<{ now?: string; limit?: number; observe?: Observer }> = {},
) {
  const now = input.now ?? new Date().toISOString();
  const limit = Math.min(10, Math.max(1, Math.trunc(input.limit ?? 3) || 3));
  const legacyVisibility = await legacyProjectionVisibilityPredicate(db);
  const pending = await db.prepare(`select j.id,j.user_id,j.capture_id,j.object_id,j.input_revision_id,
      j.input_hash,j.attempt,j.max_attempts,r.id as run_id ${COMPLETED_ANALYSIS}
    left join v2_idempotency_records receipt on receipt.user_id=j.user_id
      and receipt.operation=? and receipt.idempotency_key=r.id
    where j.stage='analyze' and j.status='succeeded' and ${legacyVisibility}
      and (receipt.idempotency_key is null or (receipt.payload_hash=j.input_hash and receipt.status_code<>200
        and coalesce(case when json_valid(receipt.response_json) then json_extract(receipt.response_json,'$.retryAt') end,'')<=?))
    order by coalesce(receipt.created_at,r.finished_at,r.created_at),r.id limit ?`)
    .bind(OPERATION, now, limit).all<RetryJobRow>();
  const outcomes: { runId: string; outcome: AnalysisPatternObservationOutcome | "failed" }[] = [];
  for (const row of pending.results) {
    const job: V2ProcessingJob = { id: row.id, userId: row.user_id, captureId: row.capture_id, objectId: row.object_id,
      inputRevisionId: row.input_revision_id, inputHash: row.input_hash, stage: "analyze", status: "succeeded",
      attempt: row.attempt, maxAttempts: row.max_attempts, leaseOwner: null, leaseExpiresAt: null };
    try { outcomes.push({ runId: row.run_id, outcome: await observeAnalysisPatternWithRetry(db, { job, runId: row.run_id, now }, input.observe) }); }
    catch { outcomes.push({ runId: row.run_id, outcome: "failed" }); }
  }
  return outcomes;
}
