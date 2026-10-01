import { ulid } from "ulidx";

import { LINK_ANALYSIS_CONTRACT, prepareLinkAnalysis, type LinkAnalysisSource, type PreparedLinkAnalysis, type ResolvedLinkAnalysis } from "@/lib/v2/ai/link-analysis-v1";
import { canonicalLinkJson, linkSha256Hex, LinkSnapshotError } from "@/lib/v2/domain/link-snapshot-v1";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { D1LinkSnapshotRepository, type LinkSnapshotProjection } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { hasLinkProcessingSchema, type V2ProcessingJob } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type CurrentDocument = { capture_id: string; current_revision_id: string; current_link_snapshot_id: string; manifest_hash: string; manifest_version: string };
export type LinkAnalysisJobRequest = Readonly<{ documentId: string; expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string; idempotencyKey?: string }>;
const ENQUEUE_OPERATION = "link_analysis.enqueue.v1";

/** Dedicated provenance writer. It never calls the personal-knowledge reconciler. */
export class D1LinkAnalysisRepository {
  constructor(private readonly db: D1DatabaseBinding) {}

  private async current(userId: string, documentId: string): Promise<CurrentDocument | null> {
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    return this.db.prepare(`select d.capture_id,d.current_revision_id,d.current_link_snapshot_id,s.manifest_hash,s.manifest_version
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_document_revisions r on r.id=d.current_revision_id and r.document_object_id=d.object_id
      join v2_link_snapshots s on s.id=d.current_link_snapshot_id and s.user_id=o.user_id and s.document_object_id=d.object_id and s.capture_id=d.capture_id
      where d.object_id=? and o.user_id=? and d.privacy_level<>'restricted' and o.lifecycle_status in ('active','archived') and ${visibility} limit 1`)
      .bind(documentId, userId).first<CurrentDocument>();
  }

  private async prepare(revisionId: string, projection: LinkSnapshotProjection) {
    const { snapshot, members } = projection;
    const textSources: LinkAnalysisSource[] = members.filter((member) => member.manualLink !== null).map((member) => ({
      memberKey: member.memberKey, memberId: member.id, sourceItemId: member.sourceItemId,
      rawText: member.rawText, contentHash: member.contentHash, manualLink: member.manualLink!,
    }));
    const prepared = await prepareLinkAnalysis({ snapshotId: snapshot.id, documentRevisionId: revisionId, manifestVersion: snapshot.manifestVersion, manifestHash: snapshot.manifestHash }, textSources);
    // Attachments remain preserved but unprocessed by this text-only version.
    // Never imply that omitted image/audio/video members were analyzed.
    return Object.freeze({ ...prepared, unavailableMemberKeys: Object.freeze([...prepared.unavailableMemberKeys, ...members.filter((member) => !member.manualLink).map((member) => member.memberKey)]) });
  }

  private matches(job: V2ProcessingJob, current: CurrentDocument | null) {
    return Boolean(current && job.stage === "link_analyze" && current.capture_id === job.captureId
      && current.current_revision_id === job.inputRevisionId && current.current_link_snapshot_id === job.inputLinkSnapshotId
      && current.manifest_hash === job.inputSourceManifestHash && current.manifest_version === job.inputSourceManifestVersion);
  }

  async isCurrent(job: V2ProcessingJob) {
    return this.matches(job, await this.current(job.userId, job.objectId));
  }

  /** Explicit analysis request only; source save and GET never enqueue this work. */
  async enqueue(userId: string, request: LinkAnalysisJobRequest, now = new Date().toISOString()) {
    if (!await hasLinkProcessingSchema(this.db)) throw new LinkSnapshotError("link_snapshot_schema_unavailable", "Link analysis requires the complete 0031 schema.");
    const current = await this.current(userId, request.documentId);
    if (!current || current.current_revision_id !== request.expectedRevisionId || current.current_link_snapshot_id !== request.expectedSnapshotId || current.manifest_hash !== request.expectedManifestHash) {
      throw new LinkSnapshotError("link_snapshot_conflict", "The record is unavailable or its revision/source snapshot changed.");
    }
    const projection = await new D1LinkSnapshotRepository(this.db, userId).getSnapshot(request.documentId, request.expectedSnapshotId);
    if (!projection) throw new LinkSnapshotError("link_snapshot_not_found", "The original snapshot is not accessible.");
    const prepared = await this.prepare(request.expectedRevisionId, projection);
    if (request.idempotencyKey !== undefined) return this.enqueueExplicit(userId, request, prepared, projection, now);
    const idempotencyKey = `link_analyze:${request.documentId}:${request.expectedRevisionId}:${request.expectedSnapshotId}:${prepared.inputHash}:${LINK_ANALYSIS_CONTRACT}`;
    const prior = await this.db.prepare("select id,status from v2_processing_jobs where user_id=? and idempotency_key=? limit 1").bind(userId, idempotencyKey).first<{ id: string; status: string }>();
    if (prior) return { jobId: prior.id, status: prior.status, replayed: true };
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const id = ulid();
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_processing_jobs
          (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,input_revision_id,input_hash,
           input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version,created_at)
          values (?,?,(select d.capture_id from v2_documents d join v2_objects o on o.id=d.object_id
            join v2_link_snapshots s on s.id=d.current_link_snapshot_id and s.user_id=o.user_id and s.document_object_id=d.object_id
            where d.object_id=? and o.user_id=? and d.current_revision_id=? and s.id=? and s.manifest_hash=? and s.manifest_version=?
              and d.privacy_level<>'restricted' and o.lifecycle_status in ('active','archived') and ${visibility} limit 1),
            ?,'link_analyze','queued','interactive',?,0,4,?,?,?,?,?,?,?)`)
          .bind(id, userId, request.documentId, userId, request.expectedRevisionId, projection.snapshot.id, projection.snapshot.manifestHash, projection.snapshot.manifestVersion,
            request.documentId, idempotencyKey, now, request.expectedRevisionId, prepared.inputHash, projection.snapshot.id, projection.snapshot.manifestHash, projection.snapshot.manifestVersion, now),
        this.db.prepare("update v2_capture_bundles set processing_status='pending' where id=? and user_id=?")
          .bind(current.capture_id, userId),
      ]);
    } catch (error) {
      const replay = await this.db.prepare("select id,status from v2_processing_jobs where user_id=? and idempotency_key=? limit 1").bind(userId, idempotencyKey).first<{ id: string; status: string }>();
      if (replay) return { jobId: replay.id, status: replay.status, replayed: true };
      if (/NOT NULL constraint failed|link_job_snapshot_mismatch/.test(error instanceof Error ? error.message : String(error))) throw new LinkSnapshotError("link_snapshot_conflict", "The original snapshot changed before the analysis request committed.");
      throw error;
    }
    return { jobId: id, status: "queued", replayed: false };
  }

  /** One receipt per user gesture; a new gesture may rerun a terminal input.
   * Different gestures still share an in-flight job, without resetting its lease.
   */
  private async enqueueExplicit(userId: string, request: LinkAnalysisJobRequest, prepared: PreparedLinkAnalysis, projection: LinkSnapshotProjection, now: string) {
    const key = request.idempotencyKey!;
    if (typeof key !== "string" || !key.trim() || key.length > 200) throw new LinkSnapshotError("link_analysis_request_invalid", "Provide an idempotency key of at most 200 characters.");
    const payloadHash = await linkSha256Hex(canonicalLinkJson({ documentId: request.documentId, revisionId: request.expectedRevisionId,
      snapshotId: request.expectedSnapshotId, manifestHash: request.expectedManifestHash, inputHash: prepared.inputHash, contract: LINK_ANALYSIS_CONTRACT }));
    const lookup = async () => {
      const receipt = await this.db.prepare("select payload_hash,response_json from v2_idempotency_records where user_id=? and operation=? and idempotency_key=?")
        .bind(userId, ENQUEUE_OPERATION, key).first<{ payload_hash: string; response_json: string }>();
      if (!receipt) return null;
      if (receipt.payload_hash !== payloadHash) throw new LinkSnapshotError("idempotency_conflict", "This request key belongs to another analysis input.");
      const response = JSON.parse(receipt.response_json) as { jobId?: unknown };
      const job = typeof response.jobId === "string" ? await this.db.prepare("select id,status from v2_processing_jobs where id=? and user_id=? and object_id=? and stage='link_analyze'")
        .bind(response.jobId, userId, request.documentId).first<{ id: string; status: string }>() : null;
      const current = await this.current(userId, request.documentId);
      if (!job || !current || current.current_revision_id !== request.expectedRevisionId || current.current_link_snapshot_id !== request.expectedSnapshotId || current.manifest_hash !== request.expectedManifestHash) {
        throw new LinkSnapshotError("link_snapshot_conflict", "The replayed analysis input is no longer current or accessible.");
      }
      return { jobId: job.id, status: job.status, replayed: true };
    };
    const replay = await lookup();
    if (replay) return replay;
    const id = ulid();
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const inputCondition = "user_id=? and object_id=? and stage='link_analyze' and input_revision_id=? and input_link_snapshot_id=? and input_source_manifest_hash=? and input_source_manifest_version=? and input_hash=?";
    const inputValues = [userId, request.documentId, request.expectedRevisionId, projection.snapshot.id, projection.snapshot.manifestHash, projection.snapshot.manifestVersion, prepared.inputHash];
    const active = `select id from v2_processing_jobs where ${inputCondition} and status in ('queued','leased','running','retry_wait') order by created_at desc,id desc limit 1`;
    const guard = `exists (select 1 from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_link_snapshots s on s.id=d.current_link_snapshot_id and s.user_id=o.user_id and s.document_object_id=d.object_id and s.capture_id=d.capture_id
      where d.object_id=? and o.user_id=? and d.current_revision_id=? and s.id=? and s.manifest_hash=? and s.manifest_version=?
        and d.privacy_level<>'restricted' and o.lifecycle_status in ('active','archived') and ${visibility})`;
    const guardValues = [request.documentId, userId, request.expectedRevisionId, projection.snapshot.id, projection.snapshot.manifestHash, projection.snapshot.manifestVersion];
    try {
      await this.db.batch([
        this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
          values(case when ${guard} then ? else null end,?,'link.analysis_requested','document',?,'{}',?)`)
          .bind(...guardValues, ulid(), userId, request.documentId, now),
        this.db.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,
          input_revision_id,input_hash,input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version,created_at)
          select ?,?,?,?,'link_analyze','queued','interactive',?,0,4,?,?,?,?,?,?,? where not exists (${active})`)
          .bind(id, userId, projection.snapshot.captureId, request.documentId, `link_request:${await linkSha256Hex(key)}`,
            now, request.expectedRevisionId, prepared.inputHash, projection.snapshot.id, projection.snapshot.manifestHash, projection.snapshot.manifestVersion, now, ...inputValues),
        this.db.prepare(`insert into v2_idempotency_records(user_id,operation,idempotency_key,payload_hash,response_json,status_code,created_at)
          values (?,?,?,?,json_object('jobId',(${active})),202,?)`)
          .bind(userId, ENQUEUE_OPERATION, key, payloadHash, ...inputValues, now),
        this.db.prepare("update v2_capture_bundles set processing_status='pending' where id=? and user_id=? and exists (select 1 from v2_processing_jobs where id=? and user_id=?)")
          .bind(projection.snapshot.captureId, userId, id, userId),
      ]);
    } catch (error) {
      const raced = await lookup();
      if (raced) return raced;
      if (/NOT NULL constraint failed: v2_audit_events.id/.test(error instanceof Error ? error.message : String(error))) throw new LinkSnapshotError("link_snapshot_conflict", "The analysis input changed before the request committed.");
      throw error;
    }
    const result = await lookup();
    if (!result) throw new LinkSnapshotError("link_analysis_receipt_invalid", "The analysis receipt could not be read.");
    return { ...result, replayed: result.jobId !== id };
  }

  async loadInput(job: V2ProcessingJob): Promise<PreparedLinkAnalysis | null> {
    if (!job.inputLinkSnapshotId || !await this.isCurrent(job)) return null;
    const projection = await new D1LinkSnapshotRepository(this.db, job.userId).getSnapshot(job.objectId, job.inputLinkSnapshotId);
    if (!projection) return null;
    const prepared = await this.prepare(job.inputRevisionId, projection);
    if (prepared.inputHash !== job.inputHash) throw new LinkSnapshotError("link_analysis_input_changed", "The saved analysis contract or exact input changed. Request analysis again.");
    return await this.isCurrent(job) ? prepared : null;
  }

  /** Only the caller owning this attempt may retire it; never stamps the newer capture state. */
  async supersedeAttempt(job: V2ProcessingJob, runId: string, now: string) {
    const owned = "exists (select 1 from v2_processing_jobs j join v2_processing_runs r on r.job_id=j.id and r.user_id=j.user_id where j.id=? and j.user_id=? and j.stage='link_analyze' and j.status='running' and j.lease_owner is ? and r.id=?)";
    await this.db.batch([
      this.db.prepare(`update v2_processing_runs set status='superseded',finished_at=?,validation_error_code='link_input_superseded' where id=? and job_id=? and status='running' and ${owned}`)
        .bind(now, runId, job.id, job.id, job.userId, job.leaseOwner, runId),
      this.db.prepare(`delete from v2_provider_invocation_leases where job_id=? and run_id=? and user_id=? and lease_owner is ? and ${owned}`)
        .bind(job.id, runId, job.userId, job.leaseOwner, job.id, job.userId, job.leaseOwner, runId),
      this.db.prepare("update v2_processing_jobs set status='superseded',finished_at=?,lease_owner=null,lease_expires_at=null,last_error_code='link_input_superseded' where id=? and user_id=? and stage='link_analyze' and status='running' and lease_owner is ? and exists (select 1 from v2_processing_runs r where r.id=? and r.job_id=v2_processing_jobs.id and r.user_id=v2_processing_jobs.user_id and r.status='superseded')")
        .bind(now, job.id, job.userId, job.leaseOwner, runId),
    ]);
  }

  async complete(input: {
    job: V2ProcessingJob; runId: string; resolved: ResolvedLinkAnalysis; outputHash: string; modelId: string;
    latencyMs: number; inputTokens: number; outputTokens: number; now: string;
  }) {
    const { job, resolved } = input;
    if (job.stage !== "link_analyze" || resolved.inputHash !== job.inputHash || resolved.identity.snapshotId !== job.inputLinkSnapshotId
      || resolved.identity.documentRevisionId !== job.inputRevisionId || resolved.identity.manifestHash !== job.inputSourceManifestHash
      || resolved.identity.manifestVersion !== job.inputSourceManifestVersion) throw new LinkSnapshotError("link_analysis_identity_invalid", "The derived result belongs to a different analysis input.");
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const state = await this.current(job.userId, job.objectId);
    if (!state) { await this.supersedeAttempt(job, input.runId, input.now); return { stale: true }; }
    const stale = !this.matches(job, state);
    // A first-statement NOT NULL assertion keeps even empty-result completion
    // atomic. A lost revision/snapshot CAS cannot leave orphan fragments behind.
    const guard = `exists (select 1 from v2_processing_jobs j join v2_processing_runs r on r.job_id=j.id and r.user_id=j.user_id
      join v2_documents d on d.object_id=j.object_id join v2_objects o on o.id=j.object_id and o.user_id=j.user_id
      join v2_provider_invocation_leases p on p.job_id=j.id and p.run_id=r.id and p.user_id=j.user_id and p.lease_owner=j.lease_owner
      where j.id=? and j.user_id=? and j.object_id=? and j.stage='link_analyze' and j.status='running' and j.lease_owner is ?
        and r.id=? and r.status='running' and p.expires_at>? and d.privacy_level<>'restricted' and o.lifecycle_status in ('active','archived')
        and ${visibility} and d.current_revision_id=? and d.current_link_snapshot_id=?
        and j.input_link_snapshot_id=? and j.input_source_manifest_hash=? and j.input_source_manifest_version=? and j.input_hash=?)`;
    const guardValues = [job.id, job.userId, job.objectId, job.leaseOwner, input.runId, input.now, state.current_revision_id, state.current_link_snapshot_id, job.inputLinkSnapshotId, job.inputSourceManifestHash, job.inputSourceManifestVersion, job.inputHash];
    const statements: D1PreparedStatementBinding[] = [this.db.prepare(`insert into v2_audit_events(id,user_id,action,object_kind,object_id,metadata_json,created_at)
      values (case when ${guard} then ? else null end,?,'link.analysis_completed','document',?,?,?)`)
      .bind(...guardValues, ulid(), job.userId, job.objectId, JSON.stringify({ inputHash: job.inputHash, stale, fragmentCount: resolved.fragments.length, unprocessedMembers: resolved.unavailableMemberKeys.length }), input.now)];
    for (const [order, fragment] of resolved.fragments.entries()) {
      const primary = fragment.evidence[0];
      if (!primary) throw new LinkSnapshotError("link_analysis_evidence_missing", "Every derived fragment needs source evidence.");
      const fragmentId = ulid();
      statements.push(this.db.prepare(`insert into v2_link_fragments
        (id,user_id,document_object_id,snapshot_id,primary_member_id,processing_run_id,fragment_key,role,source_class,
         text_start,text_end,raw_text,raw_text_hash,derived_text,details_json,completeness,display_order,review_status,locked_by_user,state_version,created_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,?)`)
        .bind(fragmentId, job.userId, job.objectId, job.inputLinkSnapshotId, primary.memberId, input.runId, fragment.fragmentKey, fragment.role, fragment.sourceClass,
          fragment.sourceClass === "source_extract" ? primary.textStart : null, fragment.sourceClass === "source_extract" ? primary.textEnd : null,
          fragment.rawText, fragment.rawTextHash, fragment.derivedText, JSON.stringify({ contract: LINK_ANALYSIS_CONTRACT, scope: resolved.scope }), fragment.completeness, order, stale ? "superseded" : "proposed", input.now));
      for (const [evidenceOrder, span] of fragment.evidence.entries()) statements.push(this.db.prepare(`insert into v2_link_fragment_evidence
        (id,user_id,fragment_id,member_id,relation_kind,evidence_method,text_start,text_end,display_order,locked_by_user,state_version,created_at)
        values (?,?,?,?,'supports','ai_proposed',?,?,?,0,1,?)`)
        .bind(ulid(), job.userId, fragmentId, span.memberId, span.textStart, span.textEnd, evidenceOrder, input.now));
    }
    if (!stale) statements.push(
      this.db.prepare("update v2_documents set published_link_run_id=? where object_id=? and current_revision_id=? and current_link_snapshot_id=?")
        .bind(input.runId, job.objectId, job.inputRevisionId, job.inputLinkSnapshotId),
      this.db.prepare("update v2_capture_bundles set processing_status=? where id=? and user_id=?")
        .bind(resolved.fragments.length || resolved.unavailableMemberKeys.length ? "needs_review" : "completed", job.captureId, job.userId),
    );
    statements.push(
      this.db.prepare("update v2_processing_runs set status=?,output_hash=?,model_id=?,latency_ms=?,input_tokens=?,output_tokens=?,finished_at=? where id=? and job_id=?")
        .bind(stale ? "stale" : resolved.unavailableMemberKeys.length ? "partial" : "succeeded", input.outputHash, input.modelId, input.latencyMs, input.inputTokens, input.outputTokens, input.now, input.runId, job.id),
      this.db.prepare("update v2_processing_jobs set status=?,finished_at=?,lease_owner=null,lease_expires_at=null where id=? and user_id=?")
        .bind(stale ? "superseded" : "succeeded", input.now, job.id, job.userId),
      this.db.prepare("delete from v2_provider_invocation_leases where job_id=? and run_id=? and user_id=? and lease_owner is ?")
        .bind(job.id, input.runId, job.userId, job.leaseOwner),
    );
    try { await this.db.batch(statements); }
    catch (error) {
      if (/NOT NULL constraint failed: v2_audit_events.id/.test(error instanceof Error ? error.message : String(error))) {
        await this.supersedeAttempt(job, input.runId, input.now);
        return { stale: true };
      }
      throw error;
    }
    return { stale };
  }
}
