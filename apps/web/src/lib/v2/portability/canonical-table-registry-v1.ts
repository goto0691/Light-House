import { compareLighthouseSchemaVersions, type ExportScopeV1, type LighthouseSchemaVersion } from "@/lib/v2/portability/portability-contract-v1";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

export type CanonicalTableDescriptor = Readonly<{
  table: string;
  path: string;
  primaryKey: readonly string[];
  alternateKey?: readonly string[];
  alternateKeyResolution?: "reuse" | "conflict" | "exact";
  foreignKeys?: Readonly<Record<string, string>>;
  restoreDependencies?: readonly string[];
  introducedIn?: LighthouseSchemaVersion;
  query: (userId: string, scope: ExportScopeV1) => { sql: string; bindings: readonly unknown[] };
}>;

const fullFidelityScopes = new WeakSet<ExportScopeV1>();

/**
 * Marks a short-lived scope used only by verified backup and migration
 * archives. Portable, human-facing exports deliberately omit legacy
 * projections that have not reached the projected state; recovery artifacts
 * retain them so source provenance is never lost.
 */
export function fullFidelityCanonicalScope(scope: ExportScopeV1): ExportScopeV1 {
  const marked = { ...scope };
  fullFidelityScopes.add(marked);
  return marked;
}

function visibleLegacyProjection(alias: string, scope: ExportScopeV1) {
  if (fullFidelityScopes.has(scope)) return "1=1";
  return `not exists (
    select 1 from v2_legacy_source_mappings portable_legacy_visibility
    where portable_legacy_visibility.user_id=${alias}.user_id
      and portable_legacy_visibility.projected_object_id=${alias}.id
      and portable_legacy_visibility.status is not 'projected'
  ) and (
    not exists (
      select 1
      from v2_documents portable_legacy_document
      join v2_capture_bundles portable_legacy_capture on portable_legacy_capture.id=portable_legacy_document.capture_id
      where portable_legacy_document.object_id=${alias}.id
        and portable_legacy_capture.draft_id like 'legacy:%'
    )
    or exists (
      select 1 from v2_legacy_source_mappings portable_legacy_projection
      where portable_legacy_projection.user_id=${alias}.user_id
        and portable_legacy_projection.projected_object_id=${alias}.id
        and portable_legacy_projection.status='projected'
    )
  )`;
}

function allowedDocuments(scope: ExportScopeV1) {
  const levels = scope.privacyLevels.map((level) => `'${level}'`).join(",");
  const lifecycle = scope.includeTrash ? "('active','archived','deleted')" : "('active','archived')";
  return `select d.object_id from v2_documents d
    join v2_objects o on o.id=d.object_id
    join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
    join v2_document_revisions current_revision on current_revision.id=d.current_revision_id and current_revision.document_object_id=d.object_id
    where o.user_id=? and d.privacy_level in (${levels}) and o.lifecycle_status in ${lifecycle}
      and (d.analyzed_revision_id is null or exists (select 1 from v2_document_revisions analyzed_revision where analyzed_revision.id=d.analyzed_revision_id and analyzed_revision.document_object_id=d.object_id))
      and ${visibleLegacyProjection("o", scope)}`;
}

function allowedObjects(scope: ExportScopeV1) {
  const documents = allowedDocuments(scope);
  return `select scoped_object.id from v2_objects scoped_object where scoped_object.user_id=? and (scoped_object.id in (${documents}) or scoped_object.id in (
    select case when r.subject_object_id in (${documents}) then r.object_object_id else r.subject_object_id end
    from v2_relation_edges r where r.user_id=? and (r.subject_object_id in (${documents}) or r.object_object_id in (${documents}))
  )) and ${visibleLegacyProjection("scoped_object", scope)}`;
}

// Recovery and migration archives carry the complete legacy provenance graph
// independently of the human-facing privacy selection. A portable export,
// however, may only include provenance reachable from documents in its scope.
const restrictedLegacyScope = (scope: ExportScopeV1) => fullFidelityScopes.has(scope) ? "1" : "0";

const objectScopeBindings = (userId: string) => [userId, userId, userId, userId, userId, userId] as const;

function linkSnapshotGraphCtes(scope: ExportScopeV1) {
  return `scoped_link_document(id) as (${allowedDocuments(scope)}),
    eligible_link_snapshot(id,user_id,document_object_id,capture_id,snapshot_version,manifest_hash,manifest_version) as (
      select snapshot.id,snapshot.user_id,snapshot.document_object_id,snapshot.capture_id,snapshot.snapshot_version,snapshot.manifest_hash,snapshot.manifest_version
      from v2_link_snapshots snapshot
      join scoped_link_document scoped on scoped.id=snapshot.document_object_id
      join v2_documents document on document.object_id=snapshot.document_object_id and document.capture_id=snapshot.capture_id
      join v2_objects owner on owner.id=snapshot.document_object_id and owner.user_id=snapshot.user_id
      where snapshot.parent_snapshot_id is null and snapshot.snapshot_version=1
      union all
      select child.id,child.user_id,child.document_object_id,child.capture_id,child.snapshot_version,child.manifest_hash,child.manifest_version
      from v2_link_snapshots child
      join eligible_link_snapshot parent on parent.id=child.parent_snapshot_id and parent.user_id=child.user_id
        and parent.document_object_id=child.document_object_id and parent.capture_id=child.capture_id
        and child.snapshot_version=parent.snapshot_version+1
    ),
    eligible_link_member(id,user_id,snapshot_id,source_item_id) as (
      select member.id,member.user_id,member.snapshot_id,member.source_item_id
      from v2_link_snapshot_sources member
      join eligible_link_snapshot snapshot on snapshot.id=member.snapshot_id and snapshot.user_id=member.user_id
      join v2_source_items source on source.id=member.source_item_id and source.user_id=member.user_id and source.capture_id=snapshot.capture_id
      join v2_document_source_links link on link.document_object_id=snapshot.document_object_id and link.source_item_id=member.source_item_id
    )`;
}

function validLinkJobSnapshot(alias: string) {
  return `(${alias}.input_link_snapshot_id is null or exists (
    select 1 from eligible_link_snapshot snapshot where snapshot.id=${alias}.input_link_snapshot_id
      and snapshot.user_id=${alias}.user_id and snapshot.document_object_id=${alias}.object_id and snapshot.capture_id=${alias}.capture_id
      and snapshot.manifest_hash=${alias}.input_source_manifest_hash and snapshot.manifest_version=${alias}.input_source_manifest_version
  ))`;
}

function processingGraphCtes(scope: ExportScopeV1) {
  return `scoped_object(id) as (${allowedObjects(scope)}),
    ${linkSnapshotGraphCtes(scope)},
    eligible_job(id,user_id,object_id,capture_id,input_revision_id,dependency_job_id) as (
      select job.id,job.user_id,job.object_id,job.capture_id,job.input_revision_id,job.dependency_job_id
      from v2_processing_jobs job
      join scoped_object object_scope on object_scope.id=job.object_id
      join v2_objects owner on owner.id=job.object_id and owner.user_id=job.user_id
      join v2_documents document on document.object_id=job.object_id and document.capture_id=job.capture_id
      join v2_capture_bundles capture on capture.id=job.capture_id and capture.user_id=job.user_id
      where job.dependency_job_id is null
        and ${validLinkJobSnapshot("job")}
        and (job.input_revision_id is null or exists (select 1 from v2_document_revisions revision where revision.id=job.input_revision_id and revision.document_object_id=job.object_id))
      union all
      select child.id,child.user_id,child.object_id,child.capture_id,child.input_revision_id,child.dependency_job_id
      from v2_processing_jobs child
      join eligible_job parent on parent.id=child.dependency_job_id and parent.user_id=child.user_id and parent.object_id=child.object_id and parent.capture_id=child.capture_id
      join v2_documents document on document.object_id=child.object_id and document.capture_id=child.capture_id
      join v2_capture_bundles capture on capture.id=child.capture_id and capture.user_id=child.user_id
      where ${validLinkJobSnapshot("child")} and (child.input_revision_id is null or exists (select 1 from v2_document_revisions revision where revision.id=child.input_revision_id and revision.document_object_id=child.object_id))
    ),
    eligible_run(id,job_id,user_id) as (
      select run.id,run.job_id,run.user_id from v2_processing_runs run
      join eligible_job job on job.id=run.job_id and job.user_id=run.user_id
    )`;
}

function eligibleProcessingJobIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)} select id from eligible_job`;
}

function eligibleProcessingRunIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)} select id from eligible_run`;
}

const processingScopeBindings = (userId: string) => [...objectScopeBindings(userId), userId] as const;

function eligibleAssignmentIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)}
    select assignment.id from v2_object_type_assignments assignment
    join scoped_object object_scope on object_scope.id=assignment.object_id
    join v2_objects owner on owner.id=assignment.object_id and owner.user_id=assignment.user_id
    join v2_type_definitions type_definition on type_definition.id=assignment.type_definition_id and type_definition.user_id=assignment.user_id
    left join eligible_run run on run.id=assignment.processing_run_id and run.user_id=assignment.user_id
    left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=assignment.object_id
    where assignment.processing_run_id is null or run_job.id is not null`;
}

const assignmentScopeBindings = processingScopeBindings;

function eligiblePropertyIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)},
    eligible_property(id,user_id,owner_object_id,field_definition_id) as (
      select property.id,property.user_id,property.owner_object_id,property.field_definition_id
      from v2_property_values property
      join scoped_object object_scope on object_scope.id=property.owner_object_id
      join v2_objects owner on owner.id=property.owner_object_id and owner.user_id=property.user_id
      join v2_field_definitions field_definition on field_definition.id=property.field_definition_id and field_definition.user_id=property.user_id
      left join eligible_run run on run.id=property.processing_run_id and run.user_id=property.user_id
      left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=property.owner_object_id
      where property.supersedes_value_id is null and (property.processing_run_id is null or run_job.id is not null)
      union all
      select child.id,child.user_id,child.owner_object_id,child.field_definition_id
      from v2_property_values child
      join eligible_property parent on parent.id=child.supersedes_value_id and parent.user_id=child.user_id and parent.owner_object_id=child.owner_object_id and parent.field_definition_id=child.field_definition_id
      left join eligible_run run on run.id=child.processing_run_id and run.user_id=child.user_id
      left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=child.owner_object_id
      where child.processing_run_id is null or run_job.id is not null
    ) select id from eligible_property`;
}

const propertyScopeBindings = processingScopeBindings;

function eligibleRelationIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)}
    select relation.id from v2_relation_edges relation
    join scoped_object subject_scope on subject_scope.id=relation.subject_object_id
    join scoped_object object_scope on object_scope.id=relation.object_object_id
    join v2_objects subject_owner on subject_owner.id=relation.subject_object_id and subject_owner.user_id=relation.user_id
    join v2_objects object_owner on object_owner.id=relation.object_object_id and object_owner.user_id=relation.user_id
    join v2_predicate_definitions predicate on predicate.id=relation.predicate_definition_id and predicate.user_id=relation.user_id
    left join eligible_run run on run.id=relation.processing_run_id and run.user_id=relation.user_id
    left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=relation.subject_object_id
    where relation.processing_run_id is null or run_job.id is not null`;
}

const relationScopeBindings = processingScopeBindings;

function eligibleRecordIds(table: "v2_entity_records" | "v2_event_records", scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)}
    select record.object_id from ${table} record
    join scoped_object object_scope on object_scope.id=record.object_id
    join v2_objects owner on owner.id=record.object_id
    left join eligible_run run on run.id=record.processing_run_id and run.user_id=owner.user_id
    where record.processing_run_id is null or run.id is not null`;
}

const recordScopeBindings = processingScopeBindings;

function eligibleTemplateVersionIds() {
  return `with recursive eligible_version(id,template_id) as (
    select version.id,version.template_id
    from v2_capture_template_versions version
    join v2_capture_templates template on template.id=version.template_id
    where template.user_id=? and version.previous_version_id is null
    union all
    select child.id,child.template_id
    from v2_capture_template_versions child
    join eligible_version parent on parent.id=child.previous_version_id and parent.template_id=child.template_id
  ) select id from eligible_version`;
}

function eligibleSourceIds(scope: ExportScopeV1) {
  return `select source.id from v2_source_items source
    join v2_capture_bundles capture on capture.id=source.capture_id and capture.user_id=source.user_id
    where source.user_id=?
      and source.capture_id in (select document.capture_id from v2_documents document where document.object_id in (${allowedDocuments(scope)}))
      and source.id in (select link.source_item_id from v2_document_source_links link where link.document_object_id in (${allowedDocuments(scope)}))`;
}

const sourceScopeBindings = (userId: string) => [userId, userId, userId] as const;

function eligibleTemplateSessionIds(scope: ExportScopeV1) {
  return `select session.id from v2_capture_template_sessions session
    where session.user_id=?
      and session.capture_id in (select document.capture_id from v2_documents document where document.object_id in (${allowedDocuments(scope)}))
      and session.template_version_id in (${eligibleTemplateVersionIds()})`;
}

const templateSessionScopeBindings = (userId: string) => [userId, userId, userId] as const;

function eligibleReviewItemIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)}
    select review.id from v2_review_items review
    join scoped_object object_scope on object_scope.id=review.object_id
    join v2_objects owner on owner.id=review.object_id and owner.user_id=review.user_id
    left join eligible_run run on run.id=review.processing_run_id and run.user_id=review.user_id
    left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=review.object_id
    where review.processing_run_id is null or run_job.id is not null`;
}

const reviewScopeBindings = processingScopeBindings;

function eligibleLinkFragmentIds(scope: ExportScopeV1) {
  return `with recursive ${processingGraphCtes(scope)}
    select fragment.id from v2_link_fragments fragment
    join eligible_link_snapshot snapshot on snapshot.id=fragment.snapshot_id and snapshot.user_id=fragment.user_id and snapshot.document_object_id=fragment.document_object_id
    join eligible_link_member member on member.id=fragment.primary_member_id and member.user_id=fragment.user_id and member.snapshot_id=fragment.snapshot_id
    left join eligible_run run on run.id=fragment.processing_run_id and run.user_id=fragment.user_id
    left join v2_processing_jobs job on job.id=run.job_id and job.object_id=fragment.document_object_id and job.input_link_snapshot_id=fragment.snapshot_id
    where fragment.processing_run_id is null or job.id is not null`;
}

function eligibleCurationRevisionIds(scope: ExportScopeV1) {
  return `with recursive ${linkSnapshotGraphCtes(scope)}
    select c.id from v2_link_curation_revisions c
    join eligible_link_snapshot s on s.id=c.snapshot_id and s.user_id=c.user_id and s.document_object_id=c.document_object_id
    left join v2_link_curation_revisions p on p.id=c.parent_revision_id and p.user_id=c.user_id and p.document_object_id=c.document_object_id
      and p.snapshot_id=c.snapshot_id and p.group_key=c.group_key and p.revision_number=c.revision_number-1
    left join v2_link_curation_revisions b on b.id=c.based_on_revision_id and b.user_id=c.user_id and b.document_object_id=c.document_object_id
    where ((c.parent_revision_id is null and c.revision_number=1) or p.id is not null) and (c.based_on_revision_id is null or b.id is not null)`;
}

/** Do not silently export excluded history to satisfy an immutable curation FK.
 * Called before any ZIP/R2 writes, and again before final publication. */
export async function assertPromptCurationExportScope(db: D1DatabaseBinding, userId: string, scope: ExportScopeV1) {
  if (scope.includeHistory) return;
  const conflict = await db.prepare(`select c.id from v2_link_curation_revisions c join v2_documents d on d.object_id=c.document_object_id
    where c.id in (${eligibleCurationRevisionIds(scope)}) and (
      c.revision_number>1 or c.based_on_revision_id is not null or c.snapshot_id is not d.current_link_snapshot_id or exists (
        select 1 from v2_link_curation_items i join v2_link_fragments f on f.id=i.fragment_id
        join v2_processing_runs r on r.id=f.processing_run_id join v2_processing_jobs j on j.id=r.job_id
        where i.curation_revision_id=c.id and j.input_revision_id is not d.current_revision_id
      )) limit 1`).bind(userId).first();
  if (conflict) {
    const error = new Error("Include history to preserve curation parents and source fragments.");
    Object.assign(error, { code: "export_curation_scope_conflict" });
    throw error;
  }
}

export const CANONICAL_SOFT_REFERENCES_V1: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  v2_capture_bundles: { template_version_id: "v2_capture_template_versions" },
  v2_capture_templates: { current_version_id: "v2_capture_template_versions" },
  v2_document_source_links: { extraction_run_id: "v2_processing_runs" },
  v2_documents: { current_revision_id: "v2_document_revisions", analyzed_revision_id: "v2_document_revisions", current_link_snapshot_id: "v2_link_snapshots", published_link_run_id: "v2_processing_runs" },
};

function legacyMappingGraphCtes(scope: ExportScopeV1) {
  return `candidate_legacy_mapping(id,user_id,legacy_envelope_id,source_item_id,projected_object_id,superseded_by_mapping_id,activation_batch_id) as (
      select mapping.id,mapping.user_id,mapping.legacy_envelope_id,mapping.source_item_id,mapping.projected_object_id,mapping.superseded_by_mapping_id,mapping.activation_batch_id
      from v2_legacy_source_mappings mapping
      join v2_legacy_source_envelopes envelope on envelope.id=mapping.legacy_envelope_id and envelope.user_id=mapping.user_id
      where mapping.user_id=?
        and (mapping.source_item_id is null or mapping.source_item_id in (${eligibleSourceIds(scope)}))
        and (mapping.projected_object_id is null or mapping.projected_object_id in (${allowedObjects(scope)}))
        and (mapping.activation_batch_id is null or exists (select 1 from v2_legacy_migration_batches batch where batch.id=mapping.activation_batch_id and batch.user_id=mapping.user_id))
        and (${restrictedLegacyScope(scope)} or (mapping.status<>'superseded' and mapping.superseded_by_mapping_id is null and mapping.projected_object_id is not null))
    ),
    eligible_legacy_mapping(id,user_id,legacy_envelope_id,source_item_id,projected_object_id,superseded_by_mapping_id,activation_batch_id) as (
      select mapping.id,mapping.user_id,mapping.legacy_envelope_id,mapping.source_item_id,mapping.projected_object_id,mapping.superseded_by_mapping_id,mapping.activation_batch_id
      from candidate_legacy_mapping mapping
      where mapping.superseded_by_mapping_id is null
      union all
      select predecessor.id,predecessor.user_id,predecessor.legacy_envelope_id,predecessor.source_item_id,predecessor.projected_object_id,predecessor.superseded_by_mapping_id,predecessor.activation_batch_id
      from candidate_legacy_mapping predecessor
      join eligible_legacy_mapping successor on successor.id=predecessor.superseded_by_mapping_id and successor.user_id=predecessor.user_id
    )`;
}

const legacyMappingScopeBindings = (userId: string) => [userId, ...sourceScopeBindings(userId), ...objectScopeBindings(userId)] as const;

function reviewReceiptQuery(userId: string, scope: ExportScopeV1) {
  return {
    sql: `with recursive ${processingGraphCtes(scope)},
      receipt_assignment(id) as (
        select assignment.id from v2_object_type_assignments assignment
        join scoped_object object_scope on object_scope.id=assignment.object_id
        join v2_objects owner on owner.id=assignment.object_id and owner.user_id=assignment.user_id
        join v2_type_definitions type_definition on type_definition.id=assignment.type_definition_id and type_definition.user_id=assignment.user_id
        left join eligible_run run on run.id=assignment.processing_run_id and run.user_id=assignment.user_id
        left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=assignment.object_id
        where assignment.processing_run_id is null or run_job.id is not null
      ),
      receipt_property(id,user_id,owner_object_id,field_definition_id) as (
        select property.id,property.user_id,property.owner_object_id,property.field_definition_id
        from v2_property_values property
        join scoped_object object_scope on object_scope.id=property.owner_object_id
        join v2_objects owner on owner.id=property.owner_object_id and owner.user_id=property.user_id
        join v2_field_definitions field_definition on field_definition.id=property.field_definition_id and field_definition.user_id=property.user_id
        left join eligible_run run on run.id=property.processing_run_id and run.user_id=property.user_id
        left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=property.owner_object_id
        where property.supersedes_value_id is null and (property.processing_run_id is null or run_job.id is not null)
        union all
        select child.id,child.user_id,child.owner_object_id,child.field_definition_id
        from v2_property_values child
        join receipt_property parent on parent.id=child.supersedes_value_id and parent.user_id=child.user_id and parent.owner_object_id=child.owner_object_id and parent.field_definition_id=child.field_definition_id
        left join eligible_run run on run.id=child.processing_run_id and run.user_id=child.user_id
        left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=child.owner_object_id
        where child.processing_run_id is null or run_job.id is not null
      ),
      receipt_relation(id) as (
        select relation.id from v2_relation_edges relation
        join scoped_object subject_scope on subject_scope.id=relation.subject_object_id
        join scoped_object object_scope on object_scope.id=relation.object_object_id
        join v2_objects subject_owner on subject_owner.id=relation.subject_object_id and subject_owner.user_id=relation.user_id
        join v2_objects object_owner on object_owner.id=relation.object_object_id and object_owner.user_id=relation.user_id
        join v2_predicate_definitions predicate on predicate.id=relation.predicate_definition_id and predicate.user_id=relation.user_id
        left join eligible_run run on run.id=relation.processing_run_id and run.user_id=relation.user_id
        left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=relation.subject_object_id
        where relation.processing_run_id is null or run_job.id is not null
      ),
      receipt_entity(id) as (
        select record.object_id from v2_entity_records record
        join scoped_object object_scope on object_scope.id=record.object_id
        join v2_objects owner on owner.id=record.object_id
        left join eligible_run run on run.id=record.processing_run_id and run.user_id=owner.user_id
        where record.processing_run_id is null or run.id is not null
      ),
      receipt_event(id) as (
        select record.object_id from v2_event_records record
        join scoped_object object_scope on object_scope.id=record.object_id
        join v2_objects owner on owner.id=record.object_id
        left join eligible_run run on run.id=record.processing_run_id and run.user_id=owner.user_id
        where record.processing_run_id is null or run.id is not null
      ),
      receipt_review(id) as (
        select review.id from v2_review_items review
        join scoped_object object_scope on object_scope.id=review.object_id
        join v2_objects owner on owner.id=review.object_id and owner.user_id=review.user_id
        left join eligible_run run on run.id=review.processing_run_id and run.user_id=review.user_id
        left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=review.object_id
        where review.processing_run_id is null or run_job.id is not null
      )
      select receipt.* from v2_review_receipts receipt
      join v2_review_items review on review.id=receipt.review_item_id and review.user_id=receipt.user_id and review.object_id=receipt.object_id
      join receipt_review parent_review on parent_review.id=receipt.review_item_id
      where receipt.user_id=? and (
        receipt.target_id is null
        or (receipt.target_kind='type_assignment' and receipt.target_id in (select id from receipt_assignment))
        or (receipt.target_kind='property_value' and receipt.target_id in (select id from receipt_property))
        or (receipt.target_kind='entity' and receipt.target_id in (select id from receipt_entity))
        or (receipt.target_kind='event' and receipt.target_id in (select id from receipt_event))
        or (receipt.target_kind='relation' and receipt.target_id in (select id from receipt_relation))
        or (receipt.target_kind='review_item' and receipt.target_id in (select id from receipt_review))
      )`,
    bindings: [...processingScopeBindings(userId), userId],
  } as const;
}

const queryByUser = (table: string) => (userId: string) => ({ sql: `select * from ${table} where user_id=?`, bindings: [userId] });
const queryByOwnedObjects = (table: string, column: string) => (userId: string, scope: ExportScopeV1) => ({
  sql: `select * from ${table} where user_id=? and ${column} in (${allowedObjects(scope)})`, bindings: [userId, ...objectScopeBindings(userId)],
});

export const CANONICAL_TABLES_V1: readonly CanonicalTableDescriptor[] = [
  { table: "v2_capture_bundles", path: "sources/captures.jsonl", primaryKey: ["id"], alternateKey: ["user_id", "draft_id"], alternateKeyResolution: "conflict", query: (userId, scope) => ({ sql: `select capture.id,capture.user_id,capture.draft_id,capture.capture_channel,capture.user_note,capture.ai_enabled,capture.client_timezone,capture.processing_status,capture.processing_priority,capture.content_hash,case when capture.template_version_id is null or capture.template_version_id in (${eligibleTemplateVersionIds()}) then capture.template_version_id else null end as template_version_id,capture.captured_at,capture.committed_at,capture.created_at from v2_capture_bundles capture where capture.user_id=? and capture.id in (select document.capture_id from v2_documents document where document.object_id in (${allowedDocuments(scope)}))`, bindings: [userId, userId, userId] }) },
  { table: "v2_attachment_reservations", path: "attachments/metadata.jsonl", primaryKey: ["id"], query: (userId, scope) => ({ sql: `select distinct attachment.* from v2_attachment_reservations attachment join v2_source_attachment_links link on link.attachment_id=attachment.id and link.user_id=attachment.user_id where attachment.user_id=? and link.source_item_id in (${eligibleSourceIds(scope)})`, bindings: [userId, ...sourceScopeBindings(userId)] }) },
  { table: "v2_source_items", path: "sources/source-items.jsonl", primaryKey: ["id"], foreignKeys: { capture_id: "v2_capture_bundles" }, query: (userId, scope) => ({ sql: `select * from v2_source_items where id in (${eligibleSourceIds(scope)})`, bindings: sourceScopeBindings(userId) }) },
  { table: "v2_objects", path: "objects/objects.jsonl", primaryKey: ["id"], foreignKeys: { canonical_object_id: "v2_objects" }, query: (userId, scope) => ({ sql: `with scoped_object(id) as (${allowedObjects(scope)}) select object.id,object.user_id,object.object_kind,object.lifecycle_status,case when object.canonical_object_id is null or exists (select 1 from v2_objects parent join scoped_object parent_scope on parent_scope.id=parent.id where parent.id=object.canonical_object_id and parent.user_id=object.user_id) then object.canonical_object_id else null end as canonical_object_id,object.created_at,object.updated_at,object.deleted_at from v2_objects object join scoped_object object_scope on object_scope.id=object.id`, bindings: objectScopeBindings(userId) }) },
  { table: "v2_documents", path: "objects/documents.jsonl", primaryKey: ["object_id"], foreignKeys: { object_id: "v2_objects", capture_id: "v2_capture_bundles", current_revision_id: "v2_document_revisions", analyzed_revision_id: "v2_document_revisions" }, query: (userId, scope) => ({ sql: `with recursive ${processingGraphCtes(scope)} select document.object_id,document.capture_id,document.title,document.title_source,document.body_markdown,document.current_revision_id,document.current_version,${scope.includeHistory ? "document.analyzed_revision_id" : "case when document.analyzed_revision_id=document.current_revision_id then document.analyzed_revision_id else null end"} as analyzed_revision_id,document.written_at,document.document_status,document.summary,document.privacy_level,document.user_locked_fields,
      snapshot.id as current_link_snapshot_id,coalesce(snapshot.snapshot_version,0) as link_snapshot_version,
      case when exists (select 1 from eligible_run run join v2_processing_jobs job on job.id=run.job_id where run.id=document.published_link_run_id and job.object_id=document.object_id and job.input_link_snapshot_id=snapshot.id) then document.published_link_run_id else null end as published_link_run_id
      from v2_documents document left join eligible_link_snapshot snapshot on snapshot.id=document.current_link_snapshot_id and snapshot.document_object_id=document.object_id and snapshot.capture_id=document.capture_id and snapshot.snapshot_version=document.link_snapshot_version
      where document.object_id in (select id from scoped_link_document)`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_document_revisions", path: "objects/document-revisions.jsonl", primaryKey: ["id"], foreignKeys: { document_object_id: "v2_objects", parent_revision_id: "v2_document_revisions" }, query: (userId, scope) => ({ sql: `select revision.id,revision.document_object_id,${scope.includeHistory ? "case when revision.parent_revision_id is null or exists (select 1 from v2_document_revisions parent where parent.id=revision.parent_revision_id and parent.document_object_id=revision.document_object_id) then revision.parent_revision_id else null end" : "null"} as parent_revision_id,revision.body_markdown,revision.content_hash,revision.author_kind,revision.change_reason,revision.revision_status,revision.revision_number,revision.forked_from_version,revision.created_at from v2_document_revisions revision join v2_documents document on document.object_id=revision.document_object_id where revision.document_object_id in (${allowedDocuments(scope)}) ${scope.includeHistory ? "" : "and revision.id=document.current_revision_id"}`, bindings: [userId] }) },
  { table: "v2_source_attachment_links", path: "sources/source-attachment-links.jsonl", primaryKey: ["source_item_id", "attachment_id"], alternateKey: ["attachment_id"], alternateKeyResolution: "conflict", foreignKeys: { source_item_id: "v2_source_items", attachment_id: "v2_attachment_reservations" }, query: (userId, scope) => ({ sql: `select link.* from v2_source_attachment_links link join v2_attachment_reservations attachment on attachment.id=link.attachment_id and attachment.user_id=link.user_id where link.user_id=? and link.source_item_id in (${eligibleSourceIds(scope)})`, bindings: [userId, ...sourceScopeBindings(userId)] }) },
  { table: "v2_document_source_links", path: "objects/document-source-links.jsonl", primaryKey: ["document_object_id", "source_item_id"], foreignKeys: { document_object_id: "v2_objects", source_item_id: "v2_source_items" }, query: (userId, scope) => ({ sql: `with recursive ${processingGraphCtes(scope)} select link.* from v2_document_source_links link join scoped_object document_scope on document_scope.id=link.document_object_id join v2_documents document on document.object_id=link.document_object_id join v2_objects owner on owner.id=link.document_object_id join v2_source_items source on source.id=link.source_item_id and source.user_id=owner.user_id and source.capture_id=document.capture_id left join eligible_run run on run.id=link.extraction_run_id and run.user_id=owner.user_id left join eligible_job run_job on run_job.id=run.job_id and run_job.object_id=link.document_object_id where link.extraction_run_id is null or run_job.id is not null`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_link_snapshots", path: "sources/link-snapshots.jsonl", primaryKey: ["id"], introducedIn: "v2-031", foreignKeys: { document_object_id: "v2_objects", capture_id: "v2_capture_bundles", parent_snapshot_id: "v2_link_snapshots" }, restoreDependencies: ["v2_documents"], query: (userId, scope) => ({ sql: `with recursive ${linkSnapshotGraphCtes(scope)} select snapshot.* from v2_link_snapshots snapshot join eligible_link_snapshot eligible on eligible.id=snapshot.id`, bindings: [userId] }) },
  { table: "v2_link_snapshot_sources", path: "sources/link-snapshot-sources.jsonl", primaryKey: ["id"], introducedIn: "v2-031", foreignKeys: { snapshot_id: "v2_link_snapshots", source_item_id: "v2_source_items" }, restoreDependencies: ["v2_document_source_links"], query: (userId, scope) => ({ sql: `with recursive ${linkSnapshotGraphCtes(scope)} select member.* from v2_link_snapshot_sources member join eligible_link_member eligible on eligible.id=member.id`, bindings: [userId] }) },
  { table: "v2_processing_jobs", path: "objects/processing-jobs.jsonl", primaryKey: ["id"], foreignKeys: { capture_id: "v2_capture_bundles", object_id: "v2_objects", input_revision_id: "v2_document_revisions", dependency_job_id: "v2_processing_jobs", input_link_snapshot_id: "v2_link_snapshots" }, query: (userId, scope) => ({ sql: `select * from v2_processing_jobs where id in (${eligibleProcessingJobIds(scope)})`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_processing_runs", path: "objects/processing-runs.jsonl", primaryKey: ["id"], foreignKeys: { job_id: "v2_processing_jobs" }, query: (userId, scope) => ({ sql: `select * from v2_processing_runs where id in (${eligibleProcessingRunIds(scope)})`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_link_fragments", path: "objects/link-fragments.jsonl", primaryKey: ["id"], introducedIn: "v2-031", foreignKeys: { document_object_id: "v2_objects", snapshot_id: "v2_link_snapshots", primary_member_id: "v2_link_snapshot_sources", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_link_fragments where id in (${eligibleLinkFragmentIds(scope)})`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_link_fragment_evidence", path: "objects/link-fragment-evidence.jsonl", primaryKey: ["id"], introducedIn: "v2-031", foreignKeys: { fragment_id: "v2_link_fragments", member_id: "v2_link_snapshot_sources" }, query: (userId, scope) => ({ sql: `select evidence.* from v2_link_fragment_evidence evidence join v2_link_fragments fragment on fragment.id=evidence.fragment_id and fragment.user_id=evidence.user_id join v2_link_snapshot_sources member on member.id=evidence.member_id and member.user_id=evidence.user_id and member.snapshot_id=fragment.snapshot_id join v2_source_items source on source.id=member.source_item_id and source.user_id=evidence.user_id join v2_link_snapshots snapshot on snapshot.id=fragment.snapshot_id and snapshot.capture_id=source.capture_id where fragment.id in (${eligibleLinkFragmentIds(scope)})`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_link_curation_revisions", path: "objects/link-curation-revisions.jsonl", primaryKey: ["id"], introducedIn: "v2-032", alternateKey: ["document_object_id", "group_key", "revision_number"], alternateKeyResolution: "exact", foreignKeys: { document_object_id: "v2_objects", snapshot_id: "v2_link_snapshots", parent_revision_id: "v2_link_curation_revisions", based_on_revision_id: "v2_link_curation_revisions" }, query: (userId, scope) => ({ sql: `select * from v2_link_curation_revisions where id in (${eligibleCurationRevisionIds(scope)})`, bindings: [userId] }) },
  { table: "v2_link_curation_items", path: "objects/link-curation-items.jsonl", primaryKey: ["id"], introducedIn: "v2-032", alternateKey: ["curation_revision_id", "item_key"], alternateKeyResolution: "exact", foreignKeys: { curation_revision_id: "v2_link_curation_revisions", fragment_id: "v2_link_fragments" }, query: (userId, scope) => ({ sql: `select i.* from v2_link_curation_items i join v2_link_curation_revisions c on c.id=i.curation_revision_id and c.user_id=i.user_id join v2_link_fragments f on f.id=i.fragment_id and f.user_id=i.user_id and f.snapshot_id=c.snapshot_id and f.document_object_id=c.document_object_id where c.id in (${eligibleCurationRevisionIds(scope)})`, bindings: [userId] }) },
  { table: "v2_link_curation_examples", path: "objects/link-curation-examples.jsonl", primaryKey: ["id"], introducedIn: "v2-032", alternateKey: ["curation_revision_id", "example_key"], alternateKeyResolution: "exact", foreignKeys: { curation_revision_id: "v2_link_curation_revisions", item_id: "v2_link_curation_items", member_id: "v2_link_snapshot_sources", attachment_id: "v2_attachment_reservations" }, restoreDependencies: ["v2_source_attachment_links"], query: (userId, scope) => ({ sql: `select e.* from v2_link_curation_examples e join v2_link_curation_revisions c on c.id=e.curation_revision_id and c.user_id=e.user_id join v2_link_snapshot_sources m on m.id=e.member_id and m.snapshot_id=c.snapshot_id and m.user_id=e.user_id join v2_source_attachment_links l on l.source_item_id=m.source_item_id and l.attachment_id=e.attachment_id and l.user_id=e.user_id join v2_attachment_reservations a on a.id=e.attachment_id and a.user_id=e.user_id left join v2_link_curation_items i on i.id=e.item_id and i.curation_revision_id=c.id and i.user_id=e.user_id where c.id in (${eligibleCurationRevisionIds(scope)}) and (e.item_id is null or i.id is not null)`, bindings: [userId] }) },
  { table: "v2_analysis_proposals", path: "objects/analysis-proposals.jsonl", primaryKey: ["id"], foreignKeys: { job_id: "v2_processing_jobs", run_id: "v2_processing_runs", capture_id: "v2_capture_bundles", object_id: "v2_objects", input_revision_id: "v2_document_revisions" }, query: (userId, scope) => ({ sql: `with recursive ${processingGraphCtes(scope)} select proposal.* from v2_analysis_proposals proposal join eligible_job job on job.id=proposal.job_id and job.user_id=proposal.user_id and job.object_id=proposal.object_id and job.capture_id=proposal.capture_id and job.input_revision_id is proposal.input_revision_id join eligible_run run on run.id=proposal.run_id and run.user_id=proposal.user_id and run.job_id=proposal.job_id`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_grounding_requests", path: "objects/grounding-requests.jsonl", primaryKey: ["id"], foreignKeys: { processing_job_id: "v2_processing_jobs", analysis_job_id: "v2_processing_jobs", capture_id: "v2_capture_bundles", object_id: "v2_objects", input_revision_id: "v2_document_revisions" }, query: (userId, scope) => ({ sql: `with recursive ${processingGraphCtes(scope)} select request.* from v2_grounding_requests request join eligible_job analysis_job on analysis_job.id=request.analysis_job_id and analysis_job.user_id=request.user_id and analysis_job.object_id=request.object_id and analysis_job.capture_id=request.capture_id and analysis_job.input_revision_id is request.input_revision_id join eligible_job processing_job on processing_job.id=request.processing_job_id and processing_job.user_id=request.user_id and processing_job.object_id=request.object_id and processing_job.capture_id=request.capture_id and processing_job.input_revision_id is request.input_revision_id and processing_job.dependency_job_id=analysis_job.id`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_grounding_results", path: "objects/grounding-results.jsonl", primaryKey: ["id"], foreignKeys: { request_id: "v2_grounding_requests", run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `with recursive ${processingGraphCtes(scope)} select result.* from v2_grounding_results result join v2_grounding_requests request on request.id=result.request_id and request.user_id=result.user_id join eligible_job analysis_job on analysis_job.id=request.analysis_job_id and analysis_job.user_id=request.user_id and analysis_job.object_id=request.object_id and analysis_job.capture_id=request.capture_id and analysis_job.input_revision_id is request.input_revision_id join eligible_job processing_job on processing_job.id=request.processing_job_id and processing_job.user_id=request.user_id and processing_job.object_id=request.object_id and processing_job.capture_id=request.capture_id and processing_job.input_revision_id is request.input_revision_id and processing_job.dependency_job_id=analysis_job.id join eligible_run run on run.id=result.run_id and run.user_id=result.user_id and run.job_id=processing_job.id`, bindings: processingScopeBindings(userId) }) },
  { table: "v2_type_definitions", path: "registries/types.jsonl", primaryKey: ["id"], query: queryByUser("v2_type_definitions") },
  { table: "v2_field_definitions", path: "registries/fields.jsonl", primaryKey: ["id"], query: queryByUser("v2_field_definitions") },
  { table: "v2_object_type_assignments", path: "objects/type-assignments.jsonl", primaryKey: ["id"], foreignKeys: { object_id: "v2_objects", type_definition_id: "v2_type_definitions", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_object_type_assignments where id in (${eligibleAssignmentIds(scope)})`, bindings: assignmentScopeBindings(userId) }) },
  { table: "v2_property_values", path: "objects/property-values.jsonl", primaryKey: ["id"], foreignKeys: { owner_object_id: "v2_objects", field_definition_id: "v2_field_definitions", supersedes_value_id: "v2_property_values", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_property_values where id in (${eligiblePropertyIds(scope)})`, bindings: propertyScopeBindings(userId) }) },
  { table: "v2_evidence_refs", path: "objects/evidence-refs.jsonl", primaryKey: ["id"], foreignKeys: { source_item_id: "v2_source_items" }, query: (userId, scope) => ({
    sql: `select evidence.* from v2_evidence_refs evidence where evidence.user_id=? and (evidence.source_item_id is null or evidence.source_item_id in (${eligibleSourceIds(scope)})) and evidence.target_kind='type_assignment' and evidence.target_id in (${eligibleAssignmentIds(scope)})
      union all select evidence.* from v2_evidence_refs evidence where evidence.user_id=? and (evidence.source_item_id is null or evidence.source_item_id in (${eligibleSourceIds(scope)})) and evidence.target_kind='property_value' and evidence.target_id in (${eligiblePropertyIds(scope)})
      union all select evidence.* from v2_evidence_refs evidence where evidence.user_id=? and (evidence.source_item_id is null or evidence.source_item_id in (${eligibleSourceIds(scope)})) and evidence.target_kind='entity' and evidence.target_id in (${eligibleRecordIds("v2_entity_records", scope)})
      union all select evidence.* from v2_evidence_refs evidence where evidence.user_id=? and (evidence.source_item_id is null or evidence.source_item_id in (${eligibleSourceIds(scope)})) and evidence.target_kind='event' and evidence.target_id in (${eligibleRecordIds("v2_event_records", scope)})
      union all select evidence.* from v2_evidence_refs evidence where evidence.user_id=? and (evidence.source_item_id is null or evidence.source_item_id in (${eligibleSourceIds(scope)})) and evidence.target_kind='relation' and evidence.target_id in (${eligibleRelationIds(scope)})`,
    bindings: [
      userId, ...sourceScopeBindings(userId), ...assignmentScopeBindings(userId),
      userId, ...sourceScopeBindings(userId), ...propertyScopeBindings(userId),
      userId, ...sourceScopeBindings(userId), ...recordScopeBindings(userId),
      userId, ...sourceScopeBindings(userId), ...recordScopeBindings(userId),
      userId, ...sourceScopeBindings(userId), ...relationScopeBindings(userId),
    ],
  }) },
  { table: "v2_review_items", path: "objects/review-items.jsonl", primaryKey: ["id"], foreignKeys: { object_id: "v2_objects", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_review_items where id in (${eligibleReviewItemIds(scope)})`, bindings: reviewScopeBindings(userId) }) },
  { table: "v2_review_receipts", path: "objects/review-receipts.jsonl", primaryKey: ["id"], foreignKeys: { review_item_id: "v2_review_items", object_id: "v2_objects" }, query: reviewReceiptQuery },
  { table: "v2_entity_records", path: "objects/entities.jsonl", primaryKey: ["object_id"], foreignKeys: { object_id: "v2_objects", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_entity_records where object_id in (${eligibleRecordIds("v2_entity_records", scope)})`, bindings: recordScopeBindings(userId) }) },
  { table: "v2_event_records", path: "objects/events.jsonl", primaryKey: ["object_id"], foreignKeys: { object_id: "v2_objects", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_event_records where object_id in (${eligibleRecordIds("v2_event_records", scope)})`, bindings: recordScopeBindings(userId) }) },
  { table: "v2_predicate_definitions", path: "registries/predicates.jsonl", primaryKey: ["id"], query: queryByUser("v2_predicate_definitions") },
  { table: "v2_relation_edges", path: "objects/relations.jsonl", primaryKey: ["id"], foreignKeys: { subject_object_id: "v2_objects", predicate_definition_id: "v2_predicate_definitions", object_object_id: "v2_objects", processing_run_id: "v2_processing_runs" }, query: (userId, scope) => ({ sql: `select * from v2_relation_edges where id in (${eligibleRelationIds(scope)})`, bindings: relationScopeBindings(userId) }) },
  { table: "v2_unit_definitions", path: "registries/units.jsonl", primaryKey: ["id"], query: queryByUser("v2_unit_definitions") },
  { table: "v2_type_presentation_profiles", path: "registries/presentation-profiles.jsonl", primaryKey: ["id"], foreignKeys: { type_definition_id: "v2_type_definitions" }, query: (userId) => ({ sql: `select profile.* from v2_type_presentation_profiles profile join v2_type_definitions type_definition on type_definition.id=profile.type_definition_id and type_definition.user_id=profile.user_id where profile.user_id=?`, bindings: [userId] }) },
  { table: "v2_saved_views", path: "views/saved-views.jsonl", primaryKey: ["id"], query: queryByUser("v2_saved_views") },
  { table: "v2_capture_templates", path: "registries/templates.jsonl", primaryKey: ["id"], query: (userId) => ({ sql: `select template.* from v2_capture_templates template where template.user_id=? and (template.current_version_id is null or template.current_version_id in (${eligibleTemplateVersionIds()}))`, bindings: [userId, userId] }) },
  { table: "v2_capture_template_versions", path: "registries/template-versions.jsonl", primaryKey: ["id"], foreignKeys: { template_id: "v2_capture_templates", previous_version_id: "v2_capture_template_versions" }, query: (userId) => ({ sql: `select * from v2_capture_template_versions where id in (${eligibleTemplateVersionIds()})`, bindings: [userId] }) },
  { table: "v2_template_source_links", path: "sources/template-source-links.jsonl", primaryKey: ["template_version_id", "source_document_id", "source_revision_id", "role"], foreignKeys: { template_version_id: "v2_capture_template_versions", source_document_id: "v2_documents", source_revision_id: "v2_document_revisions" }, query: (userId, scope) => ({ sql: `select link.* from v2_template_source_links link join v2_document_revisions revision on revision.id=link.source_revision_id and revision.document_object_id=link.source_document_id where link.template_version_id in (${eligibleTemplateVersionIds()}) and link.source_document_id in (${allowedDocuments(scope)})`, bindings: [userId, userId] }) },
  { table: "v2_capture_template_sessions", path: "sources/template-sessions.jsonl", primaryKey: ["id"], foreignKeys: { capture_id: "v2_capture_bundles", template_version_id: "v2_capture_template_versions" }, query: (userId, scope) => ({ sql: `select * from v2_capture_template_sessions where id in (${eligibleTemplateSessionIds(scope)})`, bindings: templateSessionScopeBindings(userId) }) },
  { table: "v2_capture_input_values", path: "sources/template-input-values.jsonl", primaryKey: ["id"], foreignKeys: { session_id: "v2_capture_template_sessions" }, query: (userId, scope) => ({ sql: `select input.* from v2_capture_input_values input where input.user_id=? and input.session_id in (${eligibleTemplateSessionIds(scope)})`, bindings: [userId, ...templateSessionScopeBindings(userId)] }) },
  { table: "v2_template_pattern_observations", path: "registries/template-pattern-observations.jsonl", primaryKey: ["id"], foreignKeys: { source_document_id: "v2_documents", source_revision_id: "v2_document_revisions" }, query: (userId, scope) => ({ sql: `select observation.* from v2_template_pattern_observations observation join v2_document_revisions revision on revision.id=observation.source_revision_id and revision.document_object_id=observation.source_document_id where observation.user_id=? and observation.source_document_id in (${allowedDocuments(scope)})`, bindings: [userId, userId] }) },
  { table: "v2_rediscovery_preferences", path: "views/rediscovery-preferences.jsonl", primaryKey: ["user_id"], query: queryByUser("v2_rediscovery_preferences") },
  { table: "v2_deletion_tombstones", path: "objects/deletion-tombstones.jsonl", primaryKey: ["object_id"], foreignKeys: { object_id: "v2_objects" }, query: (userId, scope) => scope.includeTrash ? queryByOwnedObjects("v2_deletion_tombstones", "object_id")(userId, scope) : ({ sql: "select * from v2_deletion_tombstones where 0", bindings: [] }) },
  { table: "v2_legacy_migration_batches", path: "migration/legacy-migration-batches.jsonl", primaryKey: ["id"], introducedIn: "v2-018", query: (userId, scope) => ({ sql: `with recursive ${legacyMappingGraphCtes(scope)} select distinct batch.* from v2_legacy_migration_batches batch left join eligible_legacy_mapping activation on activation.activation_batch_id=batch.id and activation.user_id=batch.user_id left join v2_legacy_migration_batch_items item on item.batch_id=batch.id and item.user_id=batch.user_id left join eligible_legacy_mapping item_mapping on item_mapping.legacy_envelope_id=item.legacy_envelope_id and item_mapping.user_id=item.user_id where batch.user_id=? and (${restrictedLegacyScope(scope)} or activation.id is not null or item_mapping.id is not null)`, bindings: [...legacyMappingScopeBindings(userId), userId] }) },
  { table: "v2_legacy_source_envelopes", path: "migration/legacy-source-envelopes.jsonl", primaryKey: ["id"], alternateKey: ["user_id", "legacy_table", "legacy_id", "row_hash", "schema_snapshot"], query: (userId, scope) => ({ sql: `with recursive ${legacyMappingGraphCtes(scope)} select distinct envelope.* from v2_legacy_source_envelopes envelope left join eligible_legacy_mapping mapping on mapping.legacy_envelope_id=envelope.id and mapping.user_id=envelope.user_id where envelope.user_id=? and (${restrictedLegacyScope(scope)} or mapping.id is not null)`, bindings: [...legacyMappingScopeBindings(userId), userId] }) },
  { table: "v2_legacy_migration_batch_items", path: "migration/legacy-migration-batch-items.jsonl", primaryKey: ["batch_id", "position"], foreignKeys: { batch_id: "v2_legacy_migration_batches", legacy_envelope_id: "v2_legacy_source_envelopes" }, introducedIn: "v2-018", query: (userId, scope) => ({ sql: `with recursive ${legacyMappingGraphCtes(scope)} select distinct item.* from v2_legacy_migration_batch_items item join v2_legacy_migration_batches batch on batch.id=item.batch_id and batch.user_id=item.user_id join v2_legacy_source_envelopes envelope on envelope.id=item.legacy_envelope_id and envelope.user_id=item.user_id left join eligible_legacy_mapping mapping on mapping.legacy_envelope_id=item.legacy_envelope_id and mapping.user_id=item.user_id where item.user_id=? and (${restrictedLegacyScope(scope)} or mapping.id is not null)`, bindings: [...legacyMappingScopeBindings(userId), userId] }) },
  { table: "v2_legacy_source_mappings", path: "migration/legacy-source-mappings.jsonl", primaryKey: ["id"], alternateKey: ["user_id", "legacy_envelope_id", "adapter_version", "projection_kind"], foreignKeys: { legacy_envelope_id: "v2_legacy_source_envelopes", source_item_id: "v2_source_items", projected_object_id: "v2_objects", superseded_by_mapping_id: "v2_legacy_source_mappings", activation_batch_id: "v2_legacy_migration_batches" }, query: (userId, scope) => ({ sql: `with recursive ${legacyMappingGraphCtes(scope)} select mapping.* from v2_legacy_source_mappings mapping join eligible_legacy_mapping eligible on eligible.id=mapping.id and eligible.user_id=mapping.user_id`, bindings: legacyMappingScopeBindings(userId) }) },
] as const;

export function canonicalTablesForSchemaVersion(schemaVersion: LighthouseSchemaVersion) {
  return CANONICAL_TABLES_V1.filter((descriptor) => !descriptor.introducedIn || compareLighthouseSchemaVersions(descriptor.introducedIn, schemaVersion) <= 0);
}

function buildRestoreTableOrder(descriptors: readonly CanonicalTableDescriptor[]) {
  const byName = new Map(descriptors.map((descriptor) => [descriptor.table, descriptor]));
  const dependencies = new Map(descriptors.map((descriptor) => [descriptor.table, new Set<string>()]));
  const dependents = new Map(descriptors.map((descriptor) => [descriptor.table, new Set<string>()]));

  for (const descriptor of descriptors) {
    for (const targetTable of [...Object.values(descriptor.foreignKeys ?? {}), ...(descriptor.restoreDependencies ?? [])]) {
      if (!byName.has(targetTable)) throw new Error(`Canonical restore dependency is not registered: ${descriptor.table} -> ${targetTable}`);
      if (targetTable === descriptor.table) continue;
      dependencies.get(descriptor.table)!.add(targetTable);
      dependents.get(targetTable)!.add(descriptor.table);
    }
  }

  const ready = [...dependencies.entries()].filter(([, values]) => values.size === 0).map(([table]) => table).sort();
  const ordered: CanonicalTableDescriptor[] = [];
  while (ready.length) {
    const table = ready.shift()!;
    ordered.push(byName.get(table)!);
    for (const dependent of [...dependents.get(table)!].sort()) {
      const remaining = dependencies.get(dependent)!;
      remaining.delete(table);
      if (remaining.size === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (ordered.length !== descriptors.length) {
    const cycle = [...dependencies.entries()].filter(([, values]) => values.size > 0).map(([table]) => table).sort();
    throw new Error(`Canonical restore dependency cycle requires an explicit multi-phase restore: ${cycle.join(", ")}`);
  }
  return ordered;
}

export const RESTORE_SELF_REFERENCES_V2 = CANONICAL_TABLES_V1
  .flatMap((descriptor) => Object.entries(descriptor.foreignKeys ?? {})
    .filter(([, targetTable]) => targetTable === descriptor.table)
    .map(([column]) => ({ table: descriptor.table, column } as const)))
  .sort((left, right) => `${left.table}\0${left.column}`.localeCompare(`${right.table}\0${right.column}`));

export const RESTORE_TABLE_ORDER_V2: readonly CanonicalTableDescriptor[] = buildRestoreTableOrder(CANONICAL_TABLES_V1);

export const CANONICAL_TABLE_BY_PATH = new Map(CANONICAL_TABLES_V1.map((descriptor) => [descriptor.path, descriptor]));
export const CANONICAL_TABLE_BY_NAME = new Map(CANONICAL_TABLES_V1.map((descriptor) => [descriptor.table, descriptor]));
