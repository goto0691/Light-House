import { ulid } from "ulidx";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import type { AttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import type { GroundedFactV1, GroundedResultEnvelopeV1 } from "@/lib/v2/ai/grounded-result-v1";
import { buildKnowledgeCommitStatements } from "@/lib/v2/infrastructure/d1/knowledge-reconciler";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import {
  hasLegacyProjectionBoundary,
  legacyProjectionVisibilityPredicate,
} from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { templateInputAnalyzerProjection, validateTemplateDefinitionV1, validateTemplateSubmission } from "@/lib/v2/templates/template-definition-v1";

const PROVIDER_INVOCATION_LEASE_MS = 120_000;
const providerInvocationLeaseTableChecks = new WeakMap<D1DatabaseBinding, Promise<boolean>>();

/** Do not run a new stage against a partially installed or older schema. */
export async function hasLinkProcessingSchema(db: D1DatabaseBinding) {
  if (!await new D1LinkSnapshotRepository(db, "schema-probe").isAvailable()) return false;
  const columns = await db.prepare("pragma table_info(v2_processing_jobs)").all<{ name: string }>();
  if (!["input_link_snapshot_id", "input_source_manifest_hash", "input_source_manifest_version"].every((name) => columns.results.some((column) => column.name === name))) return false;
  const lease = await db.prepare("select sql from sqlite_master where type='table' and name='v2_provider_invocation_leases'").first<{ sql: string }>();
  return Boolean(lease?.sql.includes("'link_analyze'"));
}

function linkInvocationFence() {
  return `d.current_link_snapshot_id=j.input_link_snapshot_id and d.privacy_level<>'restricted'
    and o.lifecycle_status in ('active','archived') and exists (
      select 1 from v2_link_snapshots s where s.id=j.input_link_snapshot_id and s.user_id=j.user_id
        and s.document_object_id=j.object_id and s.capture_id=j.capture_id
        and s.manifest_hash=j.input_source_manifest_hash and s.manifest_version=j.input_source_manifest_version
    )`;
}

function personalSourceFence(document = "d.object_id", user = "o.user_id") {
  // Match the same document/capture boundary used by loadAnalysisInput.
  // A malformed cross-capture link is never provider input and must not
  // retire otherwise valid personal work during invocation or recovery.
  return `not exists (select 1 from v2_document_source_links external_link
    join v2_documents external_document on external_document.object_id=external_link.document_object_id
    join v2_source_items external_source on external_source.id=external_link.source_item_id and external_source.capture_id=external_document.capture_id
    where external_link.document_object_id=${document} and external_source.user_id=${user}
      and json_type(external_source.source_metadata,'$.manualLinkV1') is not null)`;
}

async function hasProviderInvocationLeaseTable(db: D1DatabaseBinding) {
  let check = providerInvocationLeaseTableChecks.get(db);
  if (!check) {
    check = db
      .prepare("select 1 as present from sqlite_master where type='table' and name='v2_provider_invocation_leases' limit 1")
      .first<{ present: number }>()
      .then(Boolean);
    providerInvocationLeaseTableChecks.set(db, check);
  }
  const present = await check;
  // Pre-0017 databases have no legacy projection boundary to race. Do not
  // retain a negative probe so an additive migration is observed by a warm
  // Worker isolate as soon as it lands.
  if (!present && providerInvocationLeaseTableChecks.get(db) === check) providerInvocationLeaseTableChecks.delete(db);
  return present;
}

async function providerInvocationSchemaReady(db: D1DatabaseBinding) {
  if (await hasProviderInvocationLeaseTable(db)) return true;
  // Databases older than 0017 have no legacy visibility boundary to race.
  // Once that boundary exists, 0029 is mandatory before any provider call.
  // Negative table probes are not cached, so a warm Worker observes the
  // additive migration and resumes queued work without a restart.
  return !(await hasLegacyProjectionBoundary(db));
}

export type V2ProcessingJob = Readonly<{
  id: string;
  userId: string;
  captureId: string;
  objectId: string;
  stage: "analyze" | "grounded_enrich" | "link_analyze";
  status: string;
  attempt: number;
  maxAttempts: number;
  inputRevisionId: string;
  inputHash: string;
  inputLinkSnapshotId?: string | null;
  inputSourceManifestHash?: string | null;
  inputSourceManifestVersion?: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}>;

export type V2AnalysisInput = Readonly<{
  job: V2ProcessingJob;
  title: string;
  bodyMarkdown: string;
  privacyLevel: "normal" | "sensitive" | "restricted";
  sources: readonly Readonly<{ id: string; kind: string; rawText: string | null; contentHash: string; attachmentId: string | null; mimeType: string | null; attachment?: AttachmentReservation | null }>[];
  templateContext: null | Readonly<{
    templateVersionId: string;
    expectedRoles: readonly string[];
    inputs: ReturnType<typeof templateInputAnalyzerProjection>;
  }>;
}>;

export type V2GroundingInput = Readonly<{
  job: V2ProcessingJob;
  requestId: string;
  requestKey: string;
  entityKind: "place" | "work" | "book" | "game";
  query: string;
  queryHash: string;
  requestedFields: readonly string[];
}>;

type JobRow = {
  id: string; user_id: string; capture_id: string; object_id: string; stage: V2ProcessingJob["stage"]; status: string;
  attempt: number; max_attempts: number; input_revision_id: string; input_hash: string;
  lease_owner: string | null; lease_expires_at: string | null;
  input_link_snapshot_id?: string | null; input_source_manifest_hash?: string | null; input_source_manifest_version?: string | null;
};

function projectJob(row: JobRow): V2ProcessingJob {
  return { id: row.id, userId: row.user_id, captureId: row.capture_id, objectId: row.object_id, stage: row.stage, status: row.status, attempt: row.attempt, maxAttempts: row.max_attempts, inputRevisionId: row.input_revision_id, inputHash: row.input_hash, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
    ...(row.stage === "link_analyze" ? { inputLinkSnapshotId: row.input_link_snapshot_id ?? null, inputSourceManifestHash: row.input_source_manifest_hash ?? null, inputSourceManifestVersion: row.input_source_manifest_version ?? null } : {}),
  };
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function groundedDataType(kind: GroundedFactV1["value_type"]) {
  if (kind === "text") return "short_text";
  if (kind === "number") return "decimal";
  if (kind === "json") return "structured_json";
  return kind;
}

function groundedValueColumns(fact: GroundedFactV1) {
  return {
    text: fact.value_type === "text" ? fact.value as string : null,
    number: fact.value_type === "number" ? fact.value as number : null,
    boolean: fact.value_type === "boolean" ? ((fact.value as boolean) ? 1 : 0) : null,
    date: fact.value_type === "date" ? fact.value as string : null,
    json: JSON.stringify(fact.value),
  };
}

export class D1ProcessingQueueRepository {
  constructor(private readonly db: D1DatabaseBinding) {}

  async acquireProviderInvocationLease(
    job: V2ProcessingJob,
    input: { runId: string; now?: Date; leaseMs?: number },
  ) {
    if (job.stage === "link_analyze" && !await hasLinkProcessingSchema(this.db)) return false;
    if (!(await this.ownsRunningAttempt(job, input.runId))) return false;
    if (!(await hasProviderInvocationLeaseTable(this.db))) {
      if (job.stage === "analyze" && await this.supersedeExternalAnalysis(job, input.runId, (input.now ?? new Date()).toISOString())) return false;
      return !(await hasLegacyProjectionBoundary(this.db));
    }
    if (!job.leaseOwner) return false;
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseMs = Math.max(PROVIDER_INVOCATION_LEASE_MS, Math.trunc(input.leaseMs ?? PROVIDER_INVOCATION_LEASE_MS));
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const acquired = await this.db.prepare(
      `insert into v2_provider_invocation_leases
       (job_id,run_id,user_id,object_id,lease_owner,stage,expires_at,acquired_at,updated_at)
       select j.id,r.id,j.user_id,j.object_id,j.lease_owner,j.stage,?,?,?
      from v2_processing_jobs j
      join v2_processing_runs r on r.id=? and r.job_id=j.id and r.user_id=j.user_id
      join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
      join v2_documents d on d.object_id=j.object_id and d.current_revision_id=j.input_revision_id
       where j.id=? and j.user_id=? and j.object_id=? and j.stage=?
         and j.status='running' and j.lease_owner=? and j.lease_expires_at>?
         and r.status='running' and ${legacyVisibility}
         ${job.stage === "link_analyze" ? `and ${linkInvocationFence()}` : ""}
         ${job.stage === "analyze" ? `and ${personalSourceFence()}` : ""}
       on conflict(job_id) do update set
         expires_at=excluded.expires_at,updated_at=excluded.updated_at
       where v2_provider_invocation_leases.run_id=excluded.run_id
         and v2_provider_invocation_leases.user_id=excluded.user_id
         and v2_provider_invocation_leases.object_id=excluded.object_id
         and v2_provider_invocation_leases.lease_owner=excluded.lease_owner
         and v2_provider_invocation_leases.stage=excluded.stage
       returning job_id`,
    ).bind(expiresAt, nowIso, nowIso, input.runId, job.id, job.userId, job.objectId, job.stage, job.leaseOwner, nowIso).first<{ job_id: string }>();
    if (!acquired) {
      if (job.stage === "analyze") await this.supersedeExternalAnalysis(job, input.runId, nowIso);
      if (!(await this.isObjectVisible(job))) await this.terminalizeHiddenJob(job, nowIso, input.runId);
    }
    return Boolean(acquired);
  }

  /** A source-only snapshot change can retire a personal job without changing
   * its body revision. Only this leased attempt may retire itself; no capture,
   * review or newer link job is touched.
   */
  async supersedeExternalAnalysis(job: V2ProcessingJob, runId: string, now: string) {
    if (job.stage !== "analyze") return false;
    const guard = `exists (select 1 from v2_processing_jobs j join v2_processing_runs r on r.job_id=j.id and r.user_id=j.user_id
      where j.id=? and j.user_id=? and j.object_id=? and j.stage='analyze' and j.status='running' and j.lease_owner is ?
        and r.id=? and r.status='running' and not (${personalSourceFence("j.object_id", "j.user_id")}))`;
    const values = [job.id, job.userId, job.objectId, job.leaseOwner, runId];
    if (!await this.db.prepare(`select 1 as obsolete where ${guard}`).bind(...values).first()) return false;
    const supportsLease = await hasProviderInvocationLeaseTable(this.db);
    await this.db.batch([
      ...(supportsLease ? [this.db.prepare(`delete from v2_provider_invocation_leases where job_id=? and run_id=? and user_id=? and lease_owner is ? and ${guard}`)
        .bind(job.id, runId, job.userId, job.leaseOwner, ...values)] : []),
      this.db.prepare(`update v2_processing_runs set status='superseded',finished_at=?,validation_error_code='external_source_requires_link_analysis' where id=? and ${guard}`)
        .bind(now, runId, ...values),
      this.db.prepare(`update v2_processing_jobs set status='superseded',finished_at=?,lease_owner=null,lease_expires_at=null,last_error_code='external_source_requires_link_analysis'
        where id=? and user_id=? and object_id=? and status='running' and lease_owner is ?
          and exists(select 1 from v2_processing_runs r where r.id=? and r.job_id=v2_processing_jobs.id and r.user_id=v2_processing_jobs.user_id
            and r.status='superseded' and r.validation_error_code='external_source_requires_link_analysis')`)
        .bind(now, job.id, job.userId, job.objectId, job.leaseOwner, runId),
    ]);
    return true;
  }

  private async isObjectVisible(job: Pick<V2ProcessingJob, "objectId" | "userId">) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    return Boolean(await this.db.prepare(
      `select 1 as visible from v2_objects o where o.id=? and o.user_id=? and ${legacyVisibility} limit 1`,
    ).bind(job.objectId, job.userId).first<{ visible: number }>());
  }

  private async terminalizeHiddenJob(job: V2ProcessingJob, now: string, runId?: string) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const supportsInvocationLease = await hasProviderInvocationLeaseTable(this.db);
    const hiddenJob = `exists (
      select 1 from v2_processing_jobs hidden_job
      where hidden_job.id=? and hidden_job.user_id=? and hidden_job.object_id=?
        and not exists (
          select 1 from v2_objects o
          where o.id=hidden_job.object_id and o.user_id=hidden_job.user_id and ${legacyVisibility}
        )
    )`;
    await this.db.batch([
      ...(supportsInvocationLease ? [this.db.prepare(
        `delete from v2_provider_invocation_leases
         where job_id=? and user_id=? and object_id=? ${runId ? "and run_id=?" : ""}`,
      ).bind(job.id, job.userId, job.objectId, ...(runId ? [runId] : []))] : []),
      this.db.prepare(
        `update v2_processing_runs set status='superseded',finished_at=coalesce(finished_at,?)
         where job_id=? and status in ('running','failed') and ${hiddenJob} ${runId ? "and id=?" : ""}`,
      ).bind(now, job.id, job.id, job.userId, job.objectId, ...(runId ? [runId] : [])),
      this.db.prepare(
        `update v2_grounding_requests set status='stale'
         where processing_job_id=? and status in ('queued','running','needs_review') and ${hiddenJob}`,
      ).bind(job.id, job.id, job.userId, job.objectId),
      this.db.prepare(
        `update v2_processing_jobs
         set status='superseded',finished_at=coalesce(finished_at,?),lease_owner=null,lease_expires_at=null,
             last_error_class='LegacyProjectionVisibility',last_error_code='legacy_projection_hidden'
         where id=? and user_id=? and object_id=? and status not in ('succeeded','dead_letter','superseded')
           and not exists (
             select 1 from v2_objects o
             where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
           )`,
      ).bind(now, job.id, job.userId, job.objectId),
    ]);
  }

  private async terminalizeHiddenStageJobs(stage: V2ProcessingJob["stage"], now: string) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const hiddenJobIds = `select hidden_job.id from v2_processing_jobs hidden_job
      where hidden_job.stage=? and hidden_job.status in ('queued','retry_wait','leased','running')
        and hidden_job.object_id is not null
        and not exists (
          select 1 from v2_objects o
          where o.id=hidden_job.object_id and o.user_id=hidden_job.user_id and ${legacyVisibility}
        )`;
    await this.db.batch([
      this.db.prepare(
        `update v2_processing_runs set status='superseded',finished_at=coalesce(finished_at,?)
         where status='running' and job_id in (${hiddenJobIds})`,
      ).bind(now, stage),
      this.db.prepare(
        `update v2_grounding_requests set status='stale'
         where status in ('queued','running','needs_review') and processing_job_id in (${hiddenJobIds})`,
      ).bind(stage),
      this.db.prepare(
        `update v2_processing_jobs
         set status='superseded',finished_at=coalesce(finished_at,?),lease_owner=null,lease_expires_at=null,
             last_error_class='LegacyProjectionVisibility',last_error_code='legacy_projection_hidden'
         where id in (${hiddenJobIds})`,
      ).bind(now, stage),
    ]);
  }

  async dispatchPending(limit = 10, now = new Date().toISOString()) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    await this.db.prepare(
      `update v2_processing_outbox set status='failed'
       where status='pending' and exists (select 1 from v2_documents d where d.capture_id=v2_processing_outbox.capture_id)
         and not exists (
           select 1 from v2_documents d join v2_objects o on o.id=d.object_id and o.user_id=v2_processing_outbox.user_id
           join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
           where d.capture_id=v2_processing_outbox.capture_id and ${legacyVisibility}
         )`,
    ).run();
    const pending = await this.db.prepare(
      `select outbox.id as outbox_id,outbox.user_id,outbox.capture_id,d.object_id,d.current_revision_id,r.content_hash
       from v2_processing_outbox outbox join v2_documents d on d.capture_id=outbox.capture_id
       join v2_objects o on o.id=d.object_id and o.user_id=outbox.user_id
       join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
       where outbox.status='pending' and ${legacyVisibility} order by outbox.created_at limit ?`,
    ).bind(Math.min(50, Math.max(1, Math.trunc(limit)))).all<{ outbox_id: string; user_id: string; capture_id: string; object_id: string; current_revision_id: string; content_hash: string }>();
    let dispatched = 0;
    for (const item of pending.results) {
      const jobId = ulid();
      const idempotencyKey = `analyze:${item.object_id}:${item.current_revision_id}:${item.content_hash}:analysis-v1`;
      await this.db.batch([
        this.db.prepare(
          `insert or ignore into v2_processing_jobs
           (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
           select ?,?,?,?,'analyze','queued','interactive',?,0,4,?,?,?,?
           where exists (
             select 1 from v2_documents d join v2_objects o on o.id=d.object_id
             join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
             where d.object_id=? and o.user_id=? and d.current_revision_id=? and r.content_hash=? and ${legacyVisibility}
           )`,
        ).bind(jobId, item.user_id, item.capture_id, item.object_id, idempotencyKey, now, item.current_revision_id, item.content_hash, now, item.object_id, item.user_id, item.current_revision_id, item.content_hash),
        this.db.prepare(
          `update v2_processing_outbox set status='dispatched',dispatched_at=?
           where id=? and user_id=? and status='pending'
             and exists (
               select 1 from v2_processing_jobs j join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
               where j.user_id=? and j.object_id=? and j.idempotency_key=? and ${legacyVisibility}
             )`,
        ).bind(now, item.outbox_id, item.user_id, item.user_id, item.object_id, idempotencyKey),
      ]);
      const state = await this.db.prepare(`select status from v2_processing_outbox where id=? and user_id=? limit 1`).bind(item.outbox_id, item.user_id).first<{ status: string }>();
      if (state?.status === "dispatched") dispatched += 1;
    }
    return dispatched;
  }

  async claim(workerId: string, now = new Date(), leaseMs = 120_000, stage: V2ProcessingJob["stage"] = "analyze"): Promise<V2ProcessingJob | null> {
    if (!(await providerInvocationSchemaReady(this.db))) return null;
    if (stage === "link_analyze" && !await hasLinkProcessingSchema(this.db)) return null;
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    await this.terminalizeHiddenStageJobs(stage, nowIso);
    await this.recoverExpiredStageJobs(stage, nowIso);
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db.prepare(
      `update v2_processing_jobs set status='leased',lease_owner=?,lease_expires_at=?,attempt=attempt+1,started_at=coalesce(started_at,?)
       where id=(select id from v2_processing_jobs
          where stage=? and ((status in ('queued','retry_wait') and next_attempt_at<=?) or (status='leased' and lease_expires_at<=?))
            and attempt < max_attempts
            and exists (
              select 1 from v2_objects o
              where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
            )
          order by case priority when 'interactive' then 0 when 'background' then 1 else 2 end,next_attempt_at,created_at limit 1)
       and ((status in ('queued','retry_wait') and next_attempt_at<=?) or (status='leased' and lease_expires_at<=?))
       and exists (
         select 1 from v2_objects o
         where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
       )
       returning id,user_id,capture_id,object_id,stage,status,attempt,max_attempts,input_revision_id,input_hash,lease_owner,lease_expires_at
       ${stage === "link_analyze" ? ",input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version" : ""}`,
    ).bind(`${workerId}:${ulid()}`, leaseExpiresAt, nowIso, stage, nowIso, nowIso, nowIso, nowIso).first<JobRow>();
    return row ? projectJob(row) : null;
  }

  private async recoverExpiredStageJobs(stage: V2ProcessingJob["stage"], now: string) {
    const supportsInvocationLease = await hasProviderInvocationLeaseTable(this.db);
    const eligible = `select j.id from v2_processing_jobs j
      where j.stage=? and j.status in ('leased','running') and (j.lease_expires_at is null or j.lease_expires_at<=?)
      ${supportsInvocationLease ? "and not exists (select 1 from v2_provider_invocation_leases p where p.job_id=j.id and p.user_id=j.user_id and p.expires_at>?)" : ""}`;
    const bindings = supportsInvocationLease ? [stage, now, now] : [stage, now];
    const currentStageInput = stage === "link_analyze" ? `exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id and o.user_id=j.user_id
      where d.object_id=j.object_id and d.current_revision_id=j.input_revision_id and ${linkInvocationFence()})`
      : stage === "analyze" ? personalSourceFence("j.object_id", "j.user_id") : "1=1";
    const obsoletePersonalRun = stage === "analyze" ? `exists (select 1 from v2_processing_jobs j where j.id=v2_processing_runs.job_id and not (${personalSourceFence("j.object_id", "j.user_id")}))` : "0";
    const obsoletePersonalJob = stage === "analyze" ? `not (${personalSourceFence("v2_processing_jobs.object_id", "v2_processing_jobs.user_id")})` : "0";
    const currentEligible = `${eligible} and ${currentStageInput}`;
    // All transitions share the same transaction. A late worker is fenced by
    // the changed run state and the unique lease token generated by claim().
    await this.db.batch([
      this.db.prepare(`update v2_processing_runs set status=case when ${obsoletePersonalRun} then 'superseded' else 'failed' end,
        validation_error_code=case when ${obsoletePersonalRun} then 'external_source_requires_link_analysis' else 'lease_expired' end,
        finished_at=? where status='running' and job_id in (${eligible})`).bind(now, ...bindings),
      this.db.prepare(`update v2_grounding_requests set status=case when exists (select 1 from v2_processing_jobs j where j.id=processing_job_id and j.attempt>=j.max_attempts) then 'needs_review' else 'queued' end where processing_job_id in (${eligible})`).bind(...bindings),
      this.db.prepare(`update v2_capture_bundles set processing_status=case when exists (select 1 from v2_processing_jobs j where j.capture_id=v2_capture_bundles.id and j.id in (${currentEligible}) and j.attempt>=j.max_attempts) then 'needs_review' else 'failed_retryable' end where id in (select capture_id from v2_processing_jobs where id in (${currentEligible}))`).bind(...bindings, ...bindings),
      this.db.prepare(`insert into v2_review_items (id,user_id,object_id,kind,status,payload_json,created_at)
        select 'lease-exhausted:'||j.id,j.user_id,j.object_id,'analysis_warning','open',?,? from v2_processing_jobs j
        where j.id in (${currentEligible}) and j.attempt>=j.max_attempts
        and not exists (select 1 from v2_review_items r where r.id='lease-exhausted:'||j.id)`).bind(JSON.stringify({ code: "processing_lease_exhausted", message: "Automatic analysis stopped repeatedly. The original is safe; review this capture before retrying." }), now, ...bindings),
      ...(supportsInvocationLease ? [this.db.prepare(`delete from v2_provider_invocation_leases where expires_at<=? and job_id in (${eligible})`).bind(now, ...bindings)] : []),
      this.db.prepare(`update v2_processing_jobs set status=case when ${obsoletePersonalJob} then 'superseded' when attempt>=max_attempts then 'needs_review' else 'retry_wait' end,
        next_attempt_at=?,lease_owner=null,lease_expires_at=null,
        last_error_class=case when ${obsoletePersonalJob} then 'SourceProvenance' else 'LeaseExpired' end,
        last_error_code=case when ${obsoletePersonalJob} then 'external_source_requires_link_analysis' else 'lease_expired' end,
        finished_at=case when ${obsoletePersonalJob} or attempt>=max_attempts then ? else null end where id in (${eligible})`).bind(now, now, ...bindings),
    ]);
  }

  private async ownsRunningAttempt(job: V2ProcessingJob, runId: string) {
    return Boolean(await this.db.prepare(`select 1 as owned from v2_processing_jobs j join v2_processing_runs r on r.job_id=j.id and r.user_id=j.user_id
      where j.id=? and j.user_id=? and j.object_id=? and j.status='running' and j.lease_owner is ? and r.id=? and r.status='running' limit 1`)
      .bind(job.id, job.userId, job.objectId, job.leaseOwner, runId).first<{ owned: number }>());
  }

  async loadAnalysisInput(job: V2ProcessingJob): Promise<V2AnalysisInput | null> {
    if (job.stage !== "analyze") return null;
    // A later document edit can enqueue generic analysis even for an AI-off
    // manual capture. Keep externally authored material out of that pathway.
    const externalSource = await this.db.prepare(`select 1 as present from v2_document_source_links l
      join v2_documents d on d.object_id=l.document_object_id and d.capture_id=?
      join v2_source_items s on s.id=l.source_item_id and s.capture_id=d.capture_id
      where l.document_object_id=? and s.user_id=? and json_type(s.source_metadata,'$.manualLinkV1') is not null limit 1`)
      .bind(job.captureId, job.objectId, job.userId).first<{ present: number }>();
    if (externalSource) return null;
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const document = await this.db.prepare(
      `select d.title,d.body_markdown,d.privacy_level from v2_documents d join v2_objects o on o.id=d.object_id
       join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
       join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
       where d.object_id=? and o.user_id=? and d.capture_id=? and d.current_revision_id=? and ${legacyVisibility} limit 1`,
    ).bind(job.objectId, job.userId, job.captureId, job.inputRevisionId).first<{ title: string; body_markdown: string; privacy_level: "normal" | "sensitive" | "restricted" }>();
    if (!document) return null;
    const sources = await this.db.prepare(
      `select s.id,s.item_kind,s.raw_text,s.content_hash,sal.attachment_id,a.mime_type,
              a.id as reservation_id,a.user_id as attachment_user_id,a.object_key,a.filename,a.size_bytes,a.sha256,a.expires_at
       from v2_document_source_links dsl
       join v2_documents d on d.object_id=dsl.document_object_id and d.capture_id=?
       join v2_capture_bundles c on c.id=d.capture_id and c.user_id=?
       join v2_source_items s on s.id=dsl.source_item_id and s.user_id=c.user_id and s.capture_id=d.capture_id
       left join v2_source_attachment_links sal on sal.source_item_id=s.id and sal.user_id=s.user_id
       left join v2_attachment_reservations a on a.id=sal.attachment_id and a.user_id=s.user_id and a.status='committed'
       where dsl.document_object_id=?
         and json_type(s.source_metadata,'$.manualLinkV1') is null
         and coalesce(json_extract(s.source_metadata,'$.purpose'),'')<>'analysis_extraction'
         and (s.item_kind<>'text' or sal.attachment_id is not null
           or json_extract(s.source_metadata,'$.document_revision_id')=?
           or (json_extract(s.source_metadata,'$.document_revision_id') is null
             and exists (select 1 from v2_document_revisions r where r.id=? and r.document_object_id=dsl.document_object_id and r.parent_revision_id is null)))
       order by dsl.source_order`,
    ).bind(job.captureId, job.userId, job.objectId, job.inputRevisionId, job.inputRevisionId).all<{ id: string; item_kind: string; raw_text: string | null; content_hash: string; attachment_id: string | null; mime_type: string | null; reservation_id: string | null; attachment_user_id: string; object_key: string; filename: string; size_bytes: number; sha256: string; expires_at: string }>();
    const templateRow = await this.db.prepare(
      `select s.template_version_id,s.applied_at,s.input_snapshot_json,v.definition_json
       from v2_capture_template_sessions s
       join v2_capture_template_versions v on v.id=s.template_version_id
       join v2_capture_templates t on t.id=v.template_id and t.user_id=s.user_id
       where s.capture_id=? and s.user_id=? and s.state='submitted' limit 1`,
    ).bind(job.captureId, job.userId).first<{ template_version_id: string; applied_at: string; input_snapshot_json: string; definition_json: string }>();
    let templateContext: V2AnalysisInput["templateContext"] = null;
    if (templateRow) {
      try {
        const definition = validateTemplateDefinitionV1(JSON.parse(templateRow.definition_json));
        const submission = validateTemplateSubmission({ templateVersionId: templateRow.template_version_id, appliedAt: templateRow.applied_at, inputs: JSON.parse(templateRow.input_snapshot_json) }, definition);
        templateContext = { templateVersionId: templateRow.template_version_id, expectedRoles: definition.objectRoles.map((role) => role.role), inputs: templateInputAnalyzerProjection(definition, submission) };
      } catch { templateContext = null; }
    }
    const remainsVisible = await this.db.prepare(
      `select 1 as visible from v2_documents d join v2_objects o on o.id=d.object_id
       join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
       where d.object_id=? and o.user_id=? and d.capture_id=? and d.current_revision_id=? and ${legacyVisibility} and ${personalSourceFence()} limit 1`,
    ).bind(job.objectId, job.userId, job.captureId, job.inputRevisionId).first<{ visible: number }>();
    if (!remainsVisible) return null;
    return {
      job,
      title: document.title,
      bodyMarkdown: document.body_markdown,
      privacyLevel: document.privacy_level,
      sources: sources.results.map((source) => ({ id: source.id, kind: source.item_kind, rawText: source.raw_text, contentHash: source.content_hash, attachmentId: source.attachment_id, mimeType: source.mime_type,
        attachment: source.reservation_id ? { id: source.reservation_id, userId: source.attachment_user_id, objectKey: source.object_key, filename: source.filename, expectedSize: source.size_bytes, expectedMimeType: source.mime_type!, expectedSha256: source.sha256, expiresAt: source.expires_at } : null,
      })),
      templateContext,
    };
  }

  async beginRun(job: V2ProcessingJob, input: { runId: string; modelId: string; promptVersion: string; schemaVersion: string; registryVersion: string; modelConfigVersion: string; now: string }) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    await this.db.batch([
      this.db.prepare(
        `update v2_processing_jobs
         set status='superseded',finished_at=coalesce(finished_at,?),lease_owner=null,lease_expires_at=null,
             last_error_class='LegacyProjectionVisibility',last_error_code='legacy_projection_hidden'
         where id=? and user_id=? and object_id=? and status='leased'
           and not exists (
             select 1 from v2_objects o
             where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
           )`,
      ).bind(input.now, job.id, job.userId, job.objectId),
      this.db.prepare(
        `update v2_processing_jobs set status='running'
         where id=? and user_id=? and object_id=? and lease_owner=? and status='leased'
           and exists (
             select 1 from v2_objects o
             where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
           )`,
      ).bind(job.id, job.userId, job.objectId, job.leaseOwner),
      this.db.prepare(
        `insert into v2_processing_runs
         (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
         select ?,j.id,j.user_id,'main_analyzer',?,?,?,?,?,?,'running',?
         from v2_processing_jobs j
         where j.id=? and j.user_id=? and j.object_id=? and j.status='running' and j.lease_owner=?
           and exists (
             select 1 from v2_objects o where o.id=j.object_id and o.user_id=j.user_id and ${legacyVisibility}
           )`,
      ).bind(input.runId, input.modelId, input.promptVersion, input.schemaVersion, input.registryVersion, input.modelConfigVersion, job.inputHash, input.now, job.id, job.userId, job.objectId, job.leaseOwner),
    ]);
    const started = await this.db.prepare(
      `select 1 as started from v2_processing_runs r
       join v2_processing_jobs j on j.id=r.job_id and j.user_id=r.user_id
       join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
       where r.id=? and r.job_id=? and r.status='running' and ${legacyVisibility} limit 1`,
    ).bind(input.runId, job.id).first<{ started: number }>();
    if (!started) await this.terminalizeHiddenJob(job, input.now, input.runId);
    return Boolean(started);
  }

  async loadGroundingInput(job: V2ProcessingJob): Promise<V2GroundingInput | null> {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db.prepare(
      `select gr.id,gr.request_key,gr.entity_kind,gr.query_text,gr.query_hash,gr.requested_fields_json
       from v2_grounding_requests gr
       join v2_processing_jobs j on j.id=gr.processing_job_id and j.user_id=gr.user_id and j.object_id=gr.object_id
       join v2_documents d on d.object_id=gr.object_id and d.current_revision_id=gr.input_revision_id
       join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
       join v2_objects o on o.id=gr.object_id and o.user_id=gr.user_id
       where gr.processing_job_id=? and gr.user_id=? and ${legacyVisibility} limit 1`,
    ).bind(job.id, job.userId).first<{ id: string; request_key: string; entity_kind: "place" | "work" | "book" | "game"; query_text: string; query_hash: string; requested_fields_json: string }>();
    if (!row) return null;
    const requestedFields = JSON.parse(row.requested_fields_json) as unknown;
    if (!Array.isArray(requestedFields) || !requestedFields.every((field) => typeof field === "string")) return null;
    return { job, requestId: row.id, requestKey: row.request_key, entityKind: row.entity_kind, query: row.query_text, queryHash: row.query_hash, requestedFields };
  }

  async beginGroundingRun(job: V2ProcessingJob, input: { runId: string; modelId: string; promptVersion: string; schemaVersion: string; registryVersion: string; modelConfigVersion: string; now: string }) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    await this.db.batch([
      this.db.prepare(
        `update v2_processing_jobs
         set status='superseded',finished_at=coalesce(finished_at,?),lease_owner=null,lease_expires_at=null,
             last_error_class='LegacyProjectionVisibility',last_error_code='legacy_projection_hidden'
         where id=? and user_id=? and object_id=? and status='leased'
           and not exists (
             select 1 from v2_objects o
             where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
           )`,
      ).bind(input.now, job.id, job.userId, job.objectId),
      this.db.prepare(
        `update v2_grounding_requests set status='stale'
         where processing_job_id=? and user_id=? and status in ('queued','running','needs_review')
           and exists (select 1 from v2_processing_jobs where id=? and status='superseded')`,
      ).bind(job.id, job.userId, job.id),
      this.db.prepare(
        `update v2_processing_jobs set status='running'
         where id=? and user_id=? and object_id=? and lease_owner=? and status='leased'
           and exists (
             select 1 from v2_objects o
             where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
           )`,
      ).bind(job.id, job.userId, job.objectId, job.leaseOwner),
      this.db.prepare(
        `update v2_grounding_requests set status='running'
         where processing_job_id=? and user_id=? and status='queued'
           and exists (
             select 1 from v2_processing_jobs j join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
             where j.id=v2_grounding_requests.processing_job_id and j.status='running' and ${legacyVisibility}
           )`,
      ).bind(job.id, job.userId),
      this.db.prepare(
        `insert into v2_processing_runs
         (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
         select ?,j.id,j.user_id,'grounded_enricher',?,?,?,?,?,?,'running',?
         from v2_processing_jobs j join v2_grounding_requests gr on gr.processing_job_id=j.id and gr.user_id=j.user_id and gr.status='running'
         where j.id=? and j.user_id=? and j.object_id=? and j.status='running' and j.lease_owner=?
           and exists (
             select 1 from v2_objects o where o.id=j.object_id and o.user_id=j.user_id and ${legacyVisibility}
           )`,
      ).bind(input.runId, input.modelId, input.promptVersion, input.schemaVersion, input.registryVersion, input.modelConfigVersion, job.inputHash, input.now, job.id, job.userId, job.objectId, job.leaseOwner),
    ]);
    const started = await this.db.prepare(
      `select 1 as started from v2_processing_runs r
       join v2_processing_jobs j on j.id=r.job_id and j.user_id=r.user_id
       join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
       where r.id=? and r.job_id=? and r.status='running' and ${legacyVisibility} limit 1`,
    ).bind(input.runId, job.id).first<{ started: number }>();
    if (!started) await this.terminalizeHiddenJob(job, input.now, input.runId);
    return Boolean(started);
  }

  async completeGrounding(input: { job: V2ProcessingJob; requestId: string; runId: string; answer: string; envelope: GroundedResultEnvelopeV1; citations: readonly Readonly<{ url: string; title: string | null; startByte: number; endByte: number; citedText: string }>[]; queries: readonly string[]; outputHash: string; modelId: string; latencyMs: number; inputTokens: number; outputTokens: number; now: string }) {
    if (!(await this.ownsRunningAttempt(input.job, input.runId))) return { stale: true };
    if (!input.citations.length) throw new Error("Grounding completion requires at least one citation.");
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const supportsInvocationLease = await hasProviderInvocationLeaseTable(this.db);
    const current = await this.db.prepare(
      `select d.current_revision_id from v2_documents d join v2_objects o on o.id=d.object_id
       join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
       where d.object_id=? and o.user_id=? and ${legacyVisibility} limit 1`,
    ).bind(input.job.objectId, input.job.userId).first<{ current_revision_id: string }>();
    if (!current) {
      await this.terminalizeHiddenJob(input.job, input.now, input.runId);
      return { stale: true };
    }
    const stale = current?.current_revision_id !== input.job.inputRevisionId;
    const statements = [
      this.db.prepare(
        `insert into v2_grounding_results
         (id,request_id,run_id,user_id,answer_text,citations_json,queries_json,output_hash,status,verified_at)
         values (?,(
           select gr.id from v2_grounding_requests gr
           join v2_processing_jobs j on j.id=gr.processing_job_id and j.user_id=gr.user_id and j.object_id=gr.object_id
           join v2_processing_runs pr on pr.id=? and pr.job_id=j.id and pr.user_id=j.user_id
           join v2_documents d on d.object_id=j.object_id
           join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
           join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
           where gr.id=? and gr.processing_job_id=? and gr.user_id=? and gr.status='running'
             and j.status='running' and j.lease_owner is ? and pr.status='running'
             and d.current_revision_id ${stale ? "<>" : "="} ? and ${legacyVisibility} limit 1
         ),?,?,?,?,?,?,?,?)`,
      ).bind(ulid(), input.runId, input.requestId, input.job.id, input.job.userId, input.job.leaseOwner, input.job.inputRevisionId, input.runId, input.job.userId, input.answer, JSON.stringify(input.citations), JSON.stringify(input.queries), input.outputHash, stale ? "stale" : "cited", input.now),
      this.db.prepare(`update v2_grounding_requests set status=? where id=? and processing_job_id=?`).bind(stale ? "stale" : "succeeded", input.requestId, input.job.id),
      this.db.prepare(`update v2_processing_runs set model_id=?,output_hash=?,input_tokens=?,output_tokens=?,latency_ms=?,grounding_query_count=?,cited_source_count=?,status=?,finished_at=? where id=? and job_id=?`).bind(input.modelId, input.outputHash, input.inputTokens, input.outputTokens, input.latencyMs, input.queries.length, input.citations.length, stale ? "stale" : "succeeded", input.now, input.runId, input.job.id),
      this.db.prepare(`update v2_processing_jobs set status=?,finished_at=?,lease_owner=null,lease_expires_at=null where id=?`).bind(stale ? "superseded" : "succeeded", input.now, input.job.id),
      this.db.prepare(
        `update v2_capture_bundles set processing_status=case
           when ? then 'needs_review'
           when exists (select 1 from v2_processing_jobs j where j.capture_id=? and j.id<>? and j.stage='grounded_enrich' and j.status not in ('succeeded','superseded','needs_review','dead_letter')) then 'enriching'
           else 'completed' end
         where id=? and user_id=? and exists (select 1 from v2_documents d where d.object_id=? and d.capture_id=v2_capture_bundles.id and d.current_revision_id=?)`,
      ).bind(stale ? 1 : 0, input.job.captureId, input.job.id, input.job.captureId, input.job.userId, input.job.objectId, input.job.inputRevisionId),
    ];
    if (!stale && input.envelope.identity_status === "resolved") {
      for (const fact of input.envelope.facts) {
        const fieldId = ulid();
        const propertyId = ulid();
        const proposalTempId = `grounded:${input.requestId}:${fact.field_key}`;
        const dataType = groundedDataType(fact.value_type);
        const columns = groundedValueColumns(fact);
        statements.push(
          this.db.prepare(
            `insert or ignore into v2_field_definitions
             (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
             values (?,?,?,?,?,?,'candidate','ai_proposed',1,0,?,?)`,
          ).bind(fieldId, input.job.userId, fact.field_key, fact.label, `Grounded external field: ${fact.field_key}`, dataType, input.now, input.now),
          this.db.prepare(
            `insert into v2_property_values
             (id,user_id,owner_object_id,field_definition_id,proposal_temp_id,value_kind,value_text,value_number,value_boolean,value_date,value_json,source_class,claim_risk,review_status,locked_by_user,processing_run_id,created_at)
             select ?,?,?,id,?,?,?,?,?,?,?,'external_grounded','low',
               case when exists (
                 select 1 from v2_property_values current where current.owner_object_id=? and current.field_definition_id=v2_field_definitions.id
                   and current.user_id=v2_field_definitions.user_id
                   and current.review_status='accepted' and current.superseded_at is null
               ) then 'disputed' else 'accepted' end,
               0,?,?
             from v2_field_definitions
             where user_id=? and key=? and data_type=?
               and not exists (
                 select 1 from v2_property_values current where current.owner_object_id=? and current.field_definition_id=v2_field_definitions.id
                   and current.user_id=v2_field_definitions.user_id
                   and current.review_status='accepted' and current.superseded_at is null and current.value_json=?
               )
             limit 1`,
          ).bind(
            propertyId, input.job.userId, input.job.objectId, proposalTempId, fact.value_type,
            columns.text, columns.number, columns.boolean, columns.date, columns.json,
            input.job.objectId, input.runId, input.now,
            input.job.userId, fact.field_key, dataType, input.job.objectId, columns.json,
          ),
          this.db.prepare(
            `insert into v2_review_items
             (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
             select ?,?,?,?,'registry_conflict','open',?,?
             where exists (select 1 from v2_field_definitions where user_id=? and key=? and data_type<>?)`,
          ).bind(ulid(), input.job.userId, input.job.objectId, input.runId, JSON.stringify({ target: "field", key: fact.field_key, proposedDataType: dataType, source: "external_grounded" }), input.now, input.job.userId, fact.field_key, dataType),
          this.db.prepare(
            `insert into v2_review_items
             (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
             select ?,?,?,?,'value_conflict','open',?,?
             where exists (select 1 from v2_property_values where id=? and user_id=? and review_status='disputed')`,
          ).bind(ulid(), input.job.userId, input.job.objectId, input.runId, JSON.stringify({ fieldKey: fact.field_key, proposalTempId, source: "external_grounded" }), input.now, propertyId, input.job.userId),
          this.db.prepare(
            `update v2_field_definitions
             set usage_count=(select count(distinct p.owner_object_id) from v2_property_values p join v2_objects owner on owner.id=p.owner_object_id and owner.user_id=p.user_id where p.field_definition_id=v2_field_definitions.id and p.user_id=v2_field_definitions.user_id and p.review_status not in ('rejected','superseded')),
                 status=case when status='candidate' and (select count(distinct p.owner_object_id) from v2_property_values p join v2_objects owner on owner.id=p.owner_object_id and owner.user_id=p.user_id where p.field_definition_id=v2_field_definitions.id and p.user_id=v2_field_definitions.user_id and p.review_status not in ('rejected','superseded'))>=3 then 'observed' else status end,
                 updated_at=? where user_id=? and key=?`,
          ).bind(input.now, input.job.userId, fact.field_key),
        );
        for (const citation of input.citations.filter((candidate) => fact.citation_urls.includes(candidate.url))) {
          statements.push(this.db.prepare(
            `insert into v2_evidence_refs
             (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
             select ?,?,'property_value',?,null,'external_url',?,?
             where exists (select 1 from v2_property_values where id=? and user_id=?)`,
          ).bind(ulid(), input.job.userId, propertyId, JSON.stringify({ url: citation.url, title: citation.title, citedText: citation.citedText, verifiedAt: input.now }), input.now, propertyId, input.job.userId));
        }
      }
    }
    if (supportsInvocationLease) {
      statements.push(this.db.prepare(
        `delete from v2_provider_invocation_leases
         where job_id=? and run_id=? and user_id=? and object_id=? and lease_owner=?`,
      ).bind(input.job.id, input.runId, input.job.userId, input.job.objectId, input.job.leaseOwner));
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (!(await this.isObjectVisible(input.job))) {
        await this.terminalizeHiddenJob(input.job, input.now, input.runId);
        return { stale: true };
      }
      if (!(await this.ownsRunningAttempt(input.job, input.runId))) return { stale: true };
      throw error;
    }
    return { stale };
  }

  async completeAnalysis(input: { job: V2ProcessingJob; runId: string; envelope: AnalysisEnvelopeV1; outputHash: string; modelId: string; latencyMs: number; inputTokens: number; outputTokens: number; schemaVersion: string; validatorVersion: string; now: string }) {
    if (!(await this.ownsRunningAttempt(input.job, input.runId))) return { stale: true };
    if (await this.supersedeExternalAnalysis(input.job, input.runId, input.now)) return { stale: true };
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const supportsInvocationLease = await hasProviderInvocationLeaseTable(this.db);
    const current = await this.db.prepare(
      `select d.current_revision_id from v2_documents d join v2_objects o on o.id=d.object_id
       join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
       where d.object_id=? and o.user_id=? and ${legacyVisibility} limit 1`,
    ).bind(input.job.objectId, input.job.userId).first<{ current_revision_id: string }>();
    if (!current) {
      await this.terminalizeHiddenJob(input.job, input.now, input.runId);
      return { stale: true };
    }
    const stale = current?.current_revision_id !== input.job.inputRevisionId;
    const status = stale ? "stale" : "validated";
    const proposalId = ulid();
    const statements = [
      this.db.prepare(
        `insert into v2_analysis_proposals
         (id,job_id,run_id,user_id,capture_id,object_id,input_revision_id,input_hash,output_hash,schema_version,validator_version,proposal_json,status,created_at)
         values (?,?,?,?,?,(
           select o.id from v2_objects o
           join v2_documents d on d.object_id=o.id
           join v2_document_revisions revision on revision.id=d.current_revision_id and revision.document_object_id=d.object_id
           join v2_processing_jobs j on j.id=? and j.object_id=o.id and j.user_id=o.user_id
           join v2_processing_runs pr on pr.id=? and pr.job_id=j.id and pr.user_id=j.user_id
           where o.id=? and o.user_id=? and j.status='running' and j.lease_owner is ? and pr.status='running'
             and d.current_revision_id ${stale ? "<>" : "="} ? and ${legacyVisibility} and ${personalSourceFence()} limit 1
         ),?,?,?,?,?,?,?,?)`,
      ).bind(proposalId, input.job.id, input.runId, input.job.userId, input.job.captureId, input.job.id, input.runId, input.job.objectId, input.job.userId, input.job.leaseOwner, input.job.inputRevisionId, input.job.inputRevisionId, input.job.inputHash, input.outputHash, input.schemaVersion, input.validatorVersion, JSON.stringify(input.envelope), status, input.now),
      this.db.prepare(`update v2_processing_runs set model_id=?,output_hash=?,input_tokens=?,output_tokens=?,latency_ms=?,status=?,finished_at=? where id=? and job_id=?`).bind(input.modelId, input.outputHash, input.inputTokens, input.outputTokens, input.latencyMs, stale ? "stale" : "succeeded", input.now, input.runId, input.job.id),
      this.db.prepare(`update v2_processing_jobs set status=?,finished_at=?,lease_owner=null,lease_expires_at=null where id=?`).bind(stale ? "superseded" : "succeeded", input.now, input.job.id),
      this.db.prepare(`update v2_capture_bundles set processing_status=? where id=? and user_id=? and exists (select 1 from v2_documents d where d.object_id=? and d.capture_id=v2_capture_bundles.id and d.current_revision_id=?)`).bind(stale ? "needs_review" : input.envelope.enrichment_requests.length ? "enriching" : "completed", input.job.captureId, input.job.userId, input.job.objectId, input.job.inputRevisionId),
      this.db.prepare(`update v2_documents set analyzed_revision_id=? where object_id=? and current_revision_id=?`).bind(input.job.inputRevisionId, input.job.objectId, input.job.inputRevisionId),
    ];
    if (!stale) {
      const extractionSourceIds = new Map<string, string>();
      const extractionSourceClasses = new Map<string, string>();
      for (const extraction of input.envelope.source_extractions ?? []) {
        const sourceId = `analysis_source:${input.runId}:${extraction.source_item_id}`;
        extractionSourceIds.set(extraction.source_item_id, sourceId);
        extractionSourceClasses.set(sourceId, extraction.kind === "document_extract" ? "ai_inferred" : extraction.kind);
        statements.push(this.db.prepare(
          `insert into v2_source_items (id,user_id,capture_id,item_kind,display_order,raw_text,content_hash,source_metadata,immutability_version,created_at)
           select ?,?,?,?,coalesce((select max(display_order)+1 from v2_source_items where capture_id=?),0),?,?,?,1,?
           where exists (select 1 from v2_source_items s join v2_document_source_links l on l.source_item_id=s.id where s.id=? and s.user_id=? and l.document_object_id=?)`,
        ).bind(sourceId, input.job.userId, input.job.captureId, extraction.kind === "transcript_extract" ? "transcript" : "text", input.job.captureId, extraction.text, `sha256:${await sha256Text(extraction.text)}`, JSON.stringify({ purpose: "analysis_extraction", derived_from_source_item_id: extraction.source_item_id, processing_run_id: input.runId, document_revision_id: input.job.inputRevisionId, extraction_kind: extraction.kind }), input.now, extraction.source_item_id, input.job.userId, input.job.objectId));
        statements.push(this.db.prepare(`insert into v2_document_source_links (document_object_id,source_item_id,role,source_order,created_at)
          values (?,?,'evidence',coalesce((select max(source_order)+1 from v2_document_source_links where document_object_id=?),0),?)`)
          .bind(input.job.objectId, sourceId, input.job.objectId, input.now));
      }
      const remapRef = (ref: AnalysisEnvelopeV1["field_proposals"][number]["evidence_refs"][number]) => ({ ...ref, source_item_id: extractionSourceIds.get(ref.source_item_id) ?? ref.source_item_id });
      const knowledgeEnvelope: AnalysisEnvelopeV1 = {
        ...input.envelope,
        document_proposals: input.envelope.document_proposals.map((document) => ({ ...document, type_assignments: document.type_assignments.map((assignment) => ({ ...assignment, evidence_refs: assignment.evidence_refs.map(remapRef) })) })),
        field_proposals: input.envelope.field_proposals.map((field) => ({ ...field, evidence_refs: field.evidence_refs.map(remapRef) })),
        entity_proposals: input.envelope.entity_proposals.map((entity) => ({ ...entity, evidence_refs: entity.evidence_refs.map(remapRef) })),
        event_proposals: input.envelope.event_proposals.map((event) => ({ ...event, evidence_refs: event.evidence_refs.map(remapRef) })),
      };
      statements.push(...buildKnowledgeCommitStatements(this.db, {
        userId: input.job.userId,
        objectId: input.job.objectId,
        runId: input.runId,
        envelope: knowledgeEnvelope,
        evidenceSourceClasses: extractionSourceClasses,
        now: input.now,
      }));
      for (const request of input.envelope.enrichment_requests) {
        const processingJobId = ulid();
        const requestId = ulid();
        const requestHash = await sha256Text(JSON.stringify({
          inputHash: input.job.inputHash,
          requestId: request.request_id,
          entityKind: request.entity_kind,
          query: request.query,
          requestedFields: request.requested_fields,
        }));
        statements.push(
          this.db.prepare(
            `insert into v2_processing_jobs
             (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,dependency_job_id,input_revision_id,input_hash,created_at)
             values (?,?,?,?,'grounded_enrich','queued','interactive',?,0,3,?,?,?,?,?)`,
          ).bind(processingJobId, input.job.userId, input.job.captureId, input.job.objectId, `grounded:${input.job.id}:${request.request_id}`, input.now, input.job.id, input.job.inputRevisionId, requestHash, input.now),
          this.db.prepare(
            `insert into v2_grounding_requests
             (id,analysis_job_id,processing_job_id,user_id,capture_id,object_id,input_revision_id,request_key,entity_kind,query_text,query_hash,requested_fields_json,status,created_at)
             values (?,?,?,?,?,?,?,?,?,?,?,?, 'queued',?)`,
          ).bind(requestId, input.job.id, processingJobId, input.job.userId, input.job.captureId, input.job.objectId, input.job.inputRevisionId, request.request_id, request.entity_kind, request.query, requestHash, JSON.stringify(request.requested_fields), input.now),
        );
      }
    }
    if (supportsInvocationLease) {
      statements.push(this.db.prepare(
        `delete from v2_provider_invocation_leases
         where job_id=? and run_id=? and user_id=? and object_id=? and lease_owner=?`,
      ).bind(input.job.id, input.runId, input.job.userId, input.job.objectId, input.job.leaseOwner));
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (await this.supersedeExternalAnalysis(input.job, input.runId, input.now)) return { stale: true };
      if (!(await this.isObjectVisible(input.job))) {
        await this.terminalizeHiddenJob(input.job, input.now, input.runId);
        return { stale: true };
      }
      if (!(await this.ownsRunningAttempt(input.job, input.runId))) return { stale: true };
      throw error;
    }
    return { stale };
  }

  async failJob(job: V2ProcessingJob, input: { runId: string; errorClass: string; errorCode: string; retryable: boolean; retryAfterMs?: number | null; reviewMessage?: string; now?: Date }) {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    // A quota rejection means the provider did not process this input. It
    // waits for the quota window instead of consuming one of the job's attempts;
    // otherwise a daily free-tier limit would stop every pending job for good.
    const quotaWait = input.retryable && input.errorCode === "quota_exhausted";
    const exhausted = !quotaWait && job.attempt >= job.maxAttempts;
    const retry = input.retryable && !exhausted;
    const backoffMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, job.attempt - 1));
    const providerDelayMs = input.retryAfterMs && Number.isFinite(input.retryAfterMs) ? Math.min(26 * 60 * 60_000, input.retryAfterMs) : 0;
    const nextAttemptAt = new Date(now.getTime() + Math.max(backoffMs, providerDelayMs)).toISOString();
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const supportsInvocationLease = await hasProviderInvocationLeaseTable(this.db);
    const visibleRunningJob = `exists (
      select 1 from v2_processing_jobs j join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
      where j.id=? and j.user_id=? and j.object_id=? and j.status='running' and j.lease_owner is ? and ${legacyVisibility}
      ${job.stage === "link_analyze" ? `and exists (select 1 from v2_documents d where d.object_id=j.object_id and d.current_revision_id=j.input_revision_id and ${linkInvocationFence()})` : ""}
      ${job.stage === "analyze" ? `and ${personalSourceFence("j.object_id", "j.user_id")}` : ""}
    )`;
    const staleLinkJob = `exists (select 1 from v2_processing_jobs j where j.id=? and j.user_id=? and j.object_id=?
      and j.status='running' and j.lease_owner is ? and not exists (
        select 1 from v2_documents d join v2_objects o on o.id=d.object_id and o.user_id=j.user_id
        where d.object_id=j.object_id and d.current_revision_id=j.input_revision_id and ${legacyVisibility} and ${linkInvocationFence()}
      ))`;
    await this.db.batch([
      ...(job.stage === "link_analyze" ? [
        this.db.prepare(`update v2_processing_runs set status='superseded',finished_at=?,validation_error_code='link_input_superseded'
          where id=? and job_id=? and status='running' and ${staleLinkJob}`)
          .bind(nowIso, input.runId, job.id, job.id, job.userId, job.objectId, job.leaseOwner),
        this.db.prepare(`update v2_processing_jobs set status='superseded',finished_at=?,lease_owner=null,lease_expires_at=null,last_error_code='link_input_superseded'
          where id=? and user_id=? and object_id=? and status='running' and lease_owner is ? and ${staleLinkJob}`)
          .bind(nowIso, job.id, job.userId, job.objectId, job.leaseOwner, job.id, job.userId, job.objectId, job.leaseOwner),
      ] : []),
      ...(input.reviewMessage ? [this.db.prepare(`insert into v2_review_items (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
        select ?,?,?,?,'analysis_warning','open',?,? where ${visibleRunningJob}`)
        .bind(ulid(), job.userId, job.objectId, input.runId, JSON.stringify({ code: "attachment_analysis_unavailable", message: input.reviewMessage }), nowIso, job.id, job.userId, job.objectId, job.leaseOwner)] : []),
      this.db.prepare(
        `update v2_processing_runs set status='failed',validation_error_code=?,finished_at=?
         where id=? and job_id=? and status='running' and ${visibleRunningJob}`,
      ).bind(input.errorCode, nowIso, input.runId, job.id, job.id, job.userId, job.objectId, job.leaseOwner),
      this.db.prepare(
        `update v2_capture_bundles set processing_status=?
          where id=? and user_id=? and ${visibleRunningJob}
            and exists (select 1 from v2_documents d where d.object_id=? and d.capture_id=v2_capture_bundles.id and d.current_revision_id=?)`,
      ).bind(retry ? "failed_retryable" : "needs_review", job.captureId, job.userId, job.id, job.userId, job.objectId, job.leaseOwner, job.objectId, job.inputRevisionId),
      this.db.prepare(
        `update v2_grounding_requests set status=?
         where processing_job_id=? and user_id=? and ${visibleRunningJob}`,
      ).bind(retry ? "queued" : "needs_review", job.id, job.userId, job.id, job.userId, job.objectId, job.leaseOwner),
      this.db.prepare(
        `update v2_processing_jobs
         set status=?,next_attempt_at=?,lease_owner=null,lease_expires_at=null,last_error_class=?,last_error_code=?,finished_at=?,
           attempt=case when ? then max(attempt-1,0) else attempt end
         where id=? and user_id=? and object_id=? and status='running' and lease_owner is ?
           ${job.stage === "analyze" ? `and ${personalSourceFence("v2_processing_jobs.object_id", "v2_processing_jobs.user_id")}` : ""}
           and exists (
             select 1 from v2_objects o
             where o.id=v2_processing_jobs.object_id and o.user_id=v2_processing_jobs.user_id and ${legacyVisibility}
           )`,
      ).bind(retry ? "retry_wait" : "needs_review", nextAttemptAt, input.errorClass, input.errorCode, retry ? null : nowIso, quotaWait ? 1 : 0, job.id, job.userId, job.objectId, job.leaseOwner),
      ...(supportsInvocationLease ? [this.db.prepare(
        `delete from v2_provider_invocation_leases
         where job_id=? and run_id=? and user_id=? and object_id=? and lease_owner=?`,
      ).bind(job.id, input.runId, job.userId, job.objectId, job.leaseOwner)] : []),
    ]);
    if (job.stage === "analyze") await this.supersedeExternalAnalysis(job, input.runId, nowIso);
    await this.terminalizeHiddenJob(job, nowIso, input.runId);
    const state = await this.db.prepare(`select status from v2_processing_jobs where id=? and user_id=? limit 1`).bind(job.id, job.userId).first<{ status: string }>();
    return { retry: state?.status === "retry_wait", nextAttemptAt, superseded: state?.status === "superseded" };
  }

  async getCaptureProcessing(captureId: string, userId: string) {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    return this.db.prepare(
      `select c.processing_status,j.id as job_id,j.status as job_status,j.attempt,j.max_attempts,j.next_attempt_at,j.last_error_code
       from v2_capture_bundles c
       join v2_documents d on d.capture_id=c.id
       join v2_objects o on o.id=d.object_id and o.user_id=c.user_id
       left join v2_processing_jobs j on j.capture_id=c.id and j.user_id=c.user_id
       where c.id=? and c.user_id=? and ${legacyVisibility}
       order by j.created_at desc,case j.stage when 'grounded_enrich' then 1 else 0 end desc,j.id desc limit 1`,
    ).bind(captureId, userId).first<{ processing_status: string; job_id: string | null; job_status: string | null; attempt: number | null; max_attempts: number | null; next_attempt_at: string | null; last_error_code: string | null }>();
  }
}
