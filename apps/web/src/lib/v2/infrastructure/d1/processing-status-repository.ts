import {
  PROCESSING_PAGE_SIZE, PROCESSING_STATUS_CONTRACT, encodeProcessingCursor, parseProcessingCursor, parseProcessingFilter,
  type ProcessingFilter, type ProcessingRuntime, type ProcessingStageSummary, type ProcessingStatus, type ProcessingStatusPage,
} from "@/lib/v2/domain/processing-status";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type Row = { record_id: string; title: string; privacy_level: "normal" | "sensitive" | "restricted"; saved_at: string;
  status: ProcessingStatus; partial: number; review_pending: number; stages: string | ProcessingStageSummary[] };
type Snapshot = { items: string; counts: string; runtime: string };

/** A read-only, owner-scoped overview; never repairs leases, enqueues work or invokes a provider. */
export class D1ProcessingStatusRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  async list(input: { filter?: unknown; cursor?: unknown; runtime: Pick<ProcessingRuntime, "enabled" | "configured">; now?: Date }): Promise<ProcessingStatusPage> {
    const filter = parseProcessingFilter(input.filter), cursor = parseProcessingCursor(input.cursor, filter);
    const checkedAt = (input.now ?? new Date()).toISOString();
    // Capture all mutable caller inputs before the data query. The final SELECT
    // produces rows, counts and runtime metadata in one SQLite read snapshot.
    const enabled = input.runtime.enabled === true, configured = input.runtime.configured === true;
    const visibility = await legacyProjectionVisibilityPredicate(this.db);
    const result = await this.db.prepare(`with
      scoped as materialized (
        select o.id as record_id,o.user_id,d.capture_id,d.current_revision_id,d.current_link_snapshot_id,d.published_link_run_id,
          d.privacy_level,c.committed_at as saved_at,
          case d.privacy_level when 'restricted' then '잠긴 기록' when 'sensitive' then '민감 기록'
            else substr(d.title,1,240) end as title,
          exists(select 1 from v2_document_source_links sl join v2_source_items si on si.id=sl.source_item_id
            where sl.document_object_id=o.id and si.user_id=o.user_id and si.capture_id=c.id
              and case when json_valid(si.source_metadata) then json_type(si.source_metadata,'$.manualLinkV1') is not null else 0 end) as external_source
        from v2_objects o join v2_documents d on d.object_id=o.id
        join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
        join v2_document_revisions rev on rev.id=d.current_revision_id and rev.document_object_id=o.id
        where o.user_id=? and o.object_kind='document' and o.lifecycle_status in ('active','archived')
          and (o.canonical_object_id is null or o.canonical_object_id=o.id) and ${visibility}
      ), published as materialized (
        select s.record_id,pr.id as run_id,pr.status
        from scoped s join v2_processing_runs pr on pr.id=s.published_link_run_id and pr.user_id=s.user_id
        join v2_processing_jobs j on j.id=pr.job_id and j.user_id=s.user_id and j.object_id=s.record_id
          and j.capture_id=s.capture_id and j.stage='link_analyze' and j.input_revision_id=s.current_revision_id
          and j.input_link_snapshot_id=s.current_link_snapshot_id and j.input_hash=pr.input_hash
        join v2_link_snapshots ls on ls.id=j.input_link_snapshot_id and ls.user_id=j.user_id and ls.document_object_id=j.object_id
          and ls.capture_id=j.capture_id and ls.manifest_hash=j.input_source_manifest_hash and ls.manifest_version=j.input_source_manifest_version
        where s.privacy_level<>'restricted' and pr.status in ('succeeded','partial')
      ), ranked_jobs as (
        select j.*, (select pr.status from v2_processing_runs pr where pr.job_id=j.id and pr.user_id=j.user_id and pr.input_hash=j.input_hash
          order by pr.created_at desc,pr.id desc limit 1) as run_status,
          row_number() over (partition by j.object_id,j.stage,
          case when j.stage='grounded_enrich' then j.input_hash else '' end order by j.created_at desc,j.id desc) as input_rank
        from v2_processing_jobs j join scoped s on s.record_id=j.object_id and s.user_id=j.user_id and s.capture_id=j.capture_id
        where s.privacy_level<>'restricted' and j.input_revision_id=s.current_revision_id
          and ((j.stage in ('analyze','grounded_enrich') and not s.external_source)
            or (j.stage='link_analyze' and exists(select 1 from v2_link_snapshots ls
              where ls.id=s.current_link_snapshot_id and ls.id=j.input_link_snapshot_id and ls.document_object_id=s.record_id
                and ls.user_id=s.user_id and ls.capture_id=s.capture_id
                and ls.manifest_hash=j.input_source_manifest_hash and ls.manifest_version=j.input_source_manifest_version))
            or j.stage not in ('analyze','grounded_enrich','link_analyze'))
      ), latest_jobs as materialized (
        select j.*,
          case when j.status in ('running','leased') and (j.lease_expires_at is null or j.lease_expires_at<=?)
            and not exists(select 1 from v2_provider_invocation_leases pl where pl.job_id=j.id and pl.user_id=j.user_id
              and pl.object_id=j.object_id and pl.lease_owner=j.lease_owner and pl.expires_at>?) then 'needs_review'
            when j.stage not in ('analyze','grounded_enrich','link_analyze') then 'needs_review'
            when j.status='running' then 'processing' when j.status in ('queued','leased') then 'queued'
            when j.status='retry_wait' then 'retry_wait' when j.status='succeeded' and j.run_status in ('succeeded','partial') then 'completed'
            when j.status='succeeded' and j.run_status in ('stale','superseded') then 'outdated'
            when j.status='superseded' then 'outdated' else 'needs_review' end as display_status
        from ranked_jobs j where input_rank=1
      ), stage_groups as materialized (
        select object_id,stage,display_status,count(*) as amount,
          min(case when status in ('queued','retry_wait') then next_attempt_at end) as next_at
        from latest_jobs where stage in ('analyze','grounded_enrich','link_analyze') group by object_id,stage,display_status
      ), facts as materialized (
        select s.*,
          (select count(*) from latest_jobs j where j.object_id=s.record_id) as job_count,
          exists(select 1 from latest_jobs j where j.object_id=s.record_id and j.display_status='needs_review') as failure,
          exists(select 1 from latest_jobs j where j.object_id=s.record_id and j.display_status='processing') as running,
          exists(select 1 from latest_jobs j where j.object_id=s.record_id and j.display_status='retry_wait') as retrying,
          exists(select 1 from latest_jobs j where j.object_id=s.record_id and j.display_status='queued') as queued,
          exists(select 1 from latest_jobs j where j.object_id=s.record_id and (j.display_status='outdated' or j.run_status in ('stale','superseded'))) as stale,
          (exists(select 1 from latest_jobs j where j.object_id=s.record_id and j.run_status='partial')
            or exists(select 1 from published p where p.record_id=s.record_id and p.status='partial')) as partial,
          case when s.privacy_level='restricted' then 0 else
            exists(select 1 from v2_review_items ri where ri.object_id=s.record_id and ri.user_id=s.user_id and ri.status='open'
              and (ri.processing_run_id is null or exists(select 1 from v2_processing_runs rr join v2_processing_jobs rj on rj.id=rr.job_id
                and rj.user_id=rr.user_id and rj.object_id=ri.object_id where rr.id=ri.processing_run_id and rr.user_id=ri.user_id)))
            or exists(select 1 from v2_link_fragments f join published p on p.run_id=f.processing_run_id and p.record_id=f.document_object_id
              where f.document_object_id=s.record_id and f.user_id=s.user_id and f.snapshot_id=s.current_link_snapshot_id
                and f.processing_run_id=s.published_link_run_id and f.review_status='proposed') end as review_pending,
          exists(select 1 from v2_processing_jobs j where j.object_id=s.record_id and j.user_id=s.user_id and j.capture_id=s.capture_id) as past_jobs,
          (not s.external_source and exists(select 1 from v2_processing_outbox ob where ob.capture_id=s.capture_id and ob.user_id=s.user_id and ob.status='pending')) as outbox_pending,
          (not s.external_source and exists(select 1 from v2_processing_outbox ob where ob.capture_id=s.capture_id and ob.user_id=s.user_id and ob.status='failed')) as outbox_failed,
          (select json_group_array(json_object('stage',sg.stage,'status',sg.display_status,'count',sg.amount,'nextAttemptAt',sg.next_at))
            from (select * from stage_groups where object_id=s.record_id order by stage,display_status) sg) as stages
        from scoped s
      ), classified as materialized (
        select *,case when privacy_level='restricted' then 'restricted'
          when failure or partial or review_pending or outbox_failed then 'needs_review'
          when running then 'processing' when retrying then 'retry_wait' when queued then 'queued'
          when stale then 'outdated' when job_count>0 then 'completed'
          when outbox_pending then 'queued' when past_jobs then 'outdated' else 'unprocessed' end as status
        from facts
      ), categorized as materialized (
        select *,case when status in ('queued','processing','retry_wait') then 'waiting'
          when status in ('needs_review','outdated') then 'attention' when status='completed' then 'completed' else 'unprocessed' end as category
        from classified
      ), page as (
        select * from categorized where (?='all' or category=?)
          and (? is null or saved_at<? or (saved_at=? and record_id<?))
        order by saved_at desc,record_id desc limit ?
      )
      select (select json_group_array(json_object('record_id',record_id,'title',title,'privacy_level',privacy_level,'saved_at',saved_at,
        'status',status,'partial',partial,'review_pending',review_pending,'stages',stages)) from page) as items,
        (select json_object('all',count(*),'waiting',coalesce(sum(category='waiting'),0),'attention',coalesce(sum(category='attention'),0),
          'completed',coalesce(sum(category='completed'),0),'unprocessed',coalesce(sum(category='unprocessed'),0)) from categorized) as counts,
        (select json_group_array(json_object('role',model_role,'state',state,'retryAt',retry_after)) from v2_ai_runtime_state
          where model_role in ('main_analyzer','grounded_enricher')) as runtime`)
      .bind(this.userId, checkedAt, checkedAt, filter, filter, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[1] ?? null, PROCESSING_PAGE_SIZE + 1)
      .first<Snapshot>();
    if (!result) throw new Error("Processing status snapshot unavailable.");
    const rows = JSON.parse(result.items) as Row[], shown = rows.slice(0, PROCESSING_PAGE_SIZE), last = shown.at(-1);
    const runtimeRows = JSON.parse(result.runtime) as ProcessingRuntime["roles"];
    return {
      contract: PROCESSING_STATUS_CONTRACT, filter, checkedAt,
      counts: JSON.parse(result.counts) as Record<ProcessingFilter, number>,
      items: shown.map((row) => ({ recordId: row.record_id, title: row.title || "제목 없는 기록", privacyLevel: row.privacy_level,
        savedAt: row.saved_at, storage: "saved", status: row.status, partial: row.partial === 1, reviewPending: row.review_pending === 1,
        stages: typeof row.stages === "string" ? JSON.parse(row.stages) as ProcessingStageSummary[] : row.stages })),
      nextCursor: rows.length > PROCESSING_PAGE_SIZE && last ? encodeProcessingCursor(last.saved_at, last.record_id, filter) : null,
      runtime: { enabled, configured, roles: (["main_analyzer", "grounded_enricher"] as const).map((role) => {
        const row = runtimeRows.find((item) => item.role === role);
        return { role, state: row?.state ?? "unknown", retryAt: row?.retryAt ?? null };
      }) },
    };
  }
}
