import { videoAnalysisProofSql } from "@/lib/v2/infrastructure/d1/video-analysis-provenance";
import type { D1DatabaseBinding } from "./source-commit-repository";
import type { V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import { firstRecordTextMatch, recordLocationTextHash, type V2RecordLocationV1, type V2RetrievalMatch, type V2RetrievalMatchPage } from "@/lib/v2/retrieval/record-location-v1";
import { sqliteUnicodeCaseVariants, sqliteUnicodeLiteralPattern } from "@/lib/v2/retrieval/unicode-search-pattern";
import { suggestSemanticIconForType } from "@/lib/v2/presentation/semantic-icons";
import type { V2RetrievalPage, V2RetrievalResult } from "./retrieval-repository";
import { captureSavedViewVisibleFields, preferredSavedViewFieldRows, presentSavedViewFields, SAVED_FIELD_INLINE_BYTES, SAVED_FIELD_PREVIEW_POINTS, type SavedViewFieldRow, type SavedViewFieldValueRow } from "@/lib/v2/retrieval/saved-view-fields";

type Capabilities = Readonly<{ links: boolean; curations: boolean }>;
const capabilities = new WeakMap<D1DatabaseBinding, Capabilities>();
export async function retrievalCapabilities(db: D1DatabaseBinding): Promise<Capabilities> {
  const known = capabilities.get(db);
  if (known?.links && known.curations) return known;
  const rows = await db.prepare(`select name from sqlite_master where type='table' and name in
    ('v2_link_snapshots','v2_link_snapshot_sources','v2_link_fragments','v2_link_fragment_evidence',
     'v2_link_curation_revisions','v2_link_curation_items','v2_link_curation_examples')`).all<{ name: string }>();
  const names = new Set(rows.results.map((row) => row.name));
  let links = ['v2_link_snapshots', 'v2_link_snapshot_sources', 'v2_link_fragments', 'v2_link_fragment_evidence'].every((name) => names.has(name));
  if (links) {
    const [documents, jobs] = await Promise.all([
      db.prepare("pragma table_info(v2_documents)").all<{ name: string }>(),
      db.prepare("pragma table_info(v2_processing_jobs)").all<{ name: string }>(),
    ]);
    links = ["current_link_snapshot_id", "link_snapshot_version", "published_link_run_id"].every((name) => documents.results.some((row) => row.name === name))
      && ["input_link_snapshot_id", "input_source_manifest_hash", "input_source_manifest_version"].every((name) => jobs.results.some((row) => row.name === name));
  }
  const result = { links, curations: links && ['v2_link_curation_revisions', 'v2_link_curation_items', 'v2_link_curation_examples'].every((name) => names.has(name)) };
  // A negative probe must not outlive an additive migration in a warm isolate.
  if (result.links && result.curations) capabilities.set(db, result);
  return result;
}

const columns = ["record_id", "origin", "kind", "target_text", "revision_id", "document_version", "source_item_id", "snapshot_id", "manifest_hash",
  "member_id", "fragment_id", "run_id", "group_key", "role", "review_status", "is_historical", "origin_order", "identity"] as const;
export type CanonicalRetrievalOriginRow = {
  record_id: string; origin: V2RetrievalMatch["origin"]; kind: V2RecordLocationV1["kind"]; target_text: string;
  revision_id: string | null; document_version: number | null; source_item_id: string | null; snapshot_id: string | null; manifest_hash: string | null;
  member_id: string | null; fragment_id: string | null; run_id: string | null; group_key: string | null; role: string | null;
  review_status: string | null; is_historical: number; origin_order: number; identity: string;
};
function origin(values: Partial<Record<typeof columns[number], string>>, from: string) {
  const defaults: Partial<Record<typeof columns[number], string>> = { record_id: "d.object_id", is_historical: "0" };
  return `select ${columns.map((column) => `${values[column] ?? defaults[column] ?? "null"} as ${column}`).join(",")} ${from}`;
}
function searchToken(token: string) {
  const encoder = new TextEncoder(), pattern = sqliteUnicodeLiteralPattern(token);
  const characters = Array.from(token);
  if (encoder.encode(pattern).length <= 50) return { token, pattern, prefix: null, points: characters.length, parts: [], anchors: [] };
  const parts: { pattern: string; offset: number; length: number }[] = [];
  let current = "", bytes = 0, offset = 0, length = 0;
  for (const character of token) {
    // A scalar's whole escaped atom is indivisible, including GLOB metacharacters.
    const atom = sqliteUnicodeLiteralPattern(character).slice(1, -1), size = encoder.encode(atom).length;
    if (bytes + size > 48) { parts.push({ pattern: current, offset, length }); offset += length; current = ""; bytes = 0; length = 0; }
    current += atom; bytes += size; length++;
  }
  parts.push({ pattern: current, offset, length });
  return { token, pattern: null, prefix: `*${parts[0].pattern}*`, points: offset + length, parts,
    anchors: sqliteUnicodeCaseVariants(characters[characters.length - 1]) };
}
function tokenMatches(text: string) {
  // Long tokens keep their complete ordered content. D1's 50-byte GLOB limit
  // applies to each atom-preserving chunk, never to a truncated query. The
  // prefix is only a prefilter; every part must match one shared start offset.
  // instr jumps between the final scalar's Unicode-equivalent anchors. Its
  // SQLite codepoint position minus token length yields the exact common start;
  // EXISTS stops after the first complete match, without a candidate row cap.
  return `(case when t.pattern is not null then ${text} glob t.pattern
    when ${text} glob t.prefix then exists (select 1 from json_each(t.anchors) anchor where exists (
      with recursive candidate_ends(position) as (
        select t.points-1+instr(substr(${text},t.points),anchor.value) where instr(substr(${text},t.points),anchor.value)>0
        union all select position+instr(substr(${text},position+1),anchor.value) from candidate_ends
          where instr(substr(${text},position+1),anchor.value)>0)
      select 1 from candidate_ends where not exists (
        select 1 from json_each(t.parts) part where
          substr(${text},position-t.points+1+json_extract(part.value,'$.offset'),json_extract(part.value,'$.length'))
            not glob json_extract(part.value,'$.pattern'))))
    else 0 end)`;
}
export const retrievalOriginOrder = "origin_order,identity";
export function retrievalOriginJson(alias: string) {
  const pieces = [columns.slice(0, 16), columns.slice(16)].map((part) =>
    `json_object(${part.map((column) => `'${column}',${alias}.${column}`).join(",")})`);
  return `json_patch(${pieces.join(",")})`;
}

/** Query values are always bindings. These names and SQL fragments are code-owned. */
export function canonicalRetrievalSql(input: { plan: V2RetrievalQueryPlanV1; userId: string; includeRestricted: boolean;
  legacyVisibility: string; entityVisibility: string; schema: Capabilities; recordId?: string }) {
  const { plan, schema } = input;
  const tokens = [...new Set(plan.fullText?.split(/\s+/).filter(Boolean) ?? [])];
  const bindings: unknown[] = [JSON.stringify(tokens.map(searchToken)), input.userId, input.includeRestricted ? 1 : 0];
  const conditions = ["o.user_id=?", "o.lifecycle_status='active'", input.legacyVisibility, "(?=1 or d.privacy_level<>'restricted')"];
  if (input.recordId !== undefined) { conditions.push("d.object_id=?"); bindings.push(input.recordId); }
  if (plan.typeKeys.length) {
    conditions.push(`exists(select 1 from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id
      where a.user_id=o.user_id and a.object_id=d.object_id and a.review_status not in ('rejected','superseded') and t.key in (select value from json_each(?)))`);
    bindings.push(JSON.stringify(plan.typeKeys));
  }
  for (const filter of plan.propertyFilters) {
    const values: unknown[] = [filter.fieldKey];
    let clause = "";
    if (filter.operator === "eq") { clause = "and p.value_json=?"; values.push(JSON.stringify(filter.value)); }
    if (filter.operator === "contains") { clause = "and instr(lower(coalesce(p.value_text,p.value_json)),lower(?))>0"; values.push(filter.value); }
    if (filter.operator === "gte") { clause = "and p.value_number>=?"; values.push(filter.value); }
    if (filter.operator === "lte") { clause = "and p.value_number<=?"; values.push(filter.value); }
    conditions.push(`exists(select 1 from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id and f.user_id=p.user_id
      where p.user_id=o.user_id and p.owner_object_id=d.object_id and p.review_status='accepted' and p.superseded_at is null and f.key=? ${clause})`);
    bindings.push(...values);
  }
  for (const filter of plan.entityFilters) {
    const clauses = ["r.user_id=o.user_id", "r.subject_object_id=d.object_id", "r.review_status='accepted'", "r.superseded_at is null", input.entityVisibility];
    if (filter.entityKind) { clauses.push("e.entity_kind=?"); bindings.push(filter.entityKind); }
    if (filter.canonicalName) { clauses.push("instr(lower(e.canonical_name),lower(?))>0"); bindings.push(filter.canonicalName); }
    if (filter.targetObjectId) { clauses.push("e.object_id=?"); bindings.push(filter.targetObjectId); }
    conditions.push(`exists(select 1 from v2_relation_edges r join v2_entity_records e on e.object_id=r.object_object_id
      join v2_objects eo on eo.id=e.object_id and eo.user_id=r.user_id and eo.lifecycle_status='active' where ${clauses.join(" and ")})`);
  }
  if (plan.dateFilter) {
    const axis = plan.dateFilter.axis === "written_at" ? "d.written_at" : "c.captured_at";
    if (plan.dateFilter.from) { conditions.push(`${axis}>=?`); bindings.push(`${plan.dateFilter.from}T00:00:00.000Z`); }
    if (plan.dateFilter.to) { conditions.push(`${axis}<=?`); bindings.push(`${plan.dateFilter.to}T23:59:59.999Z`); }
  }
  const ctes = [`search_tokens as (select json_extract(value,'$.token') as token,json_extract(value,'$.pattern') as pattern,
      json_extract(value,'$.prefix') as prefix,json_extract(value,'$.points') as points,json_extract(value,'$.parts') as parts,
      json_extract(value,'$.anchors') as anchors from json_each(?))`,
    `eligible_documents as materialized (select d.*,o.user_id,o.updated_at as object_updated_at,c.captured_at,
      ${schema.links ? "d.current_link_snapshot_id as search_current_snapshot,d.published_link_run_id as search_published_run" : "null as search_current_snapshot,null as search_published_run"}
      from v2_documents d join v2_objects o on o.id=d.object_id
      join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
      join v2_document_revisions current on current.id=d.current_revision_id and current.document_object_id=d.object_id
      where ${conditions.join(" and ")})`,
    `eligible_sources as materialized (select d.object_id,s.*,l.role as link_role from eligible_documents d
      join v2_document_source_links l on l.document_object_id=d.object_id
      join v2_source_items s on s.id=l.source_item_id and s.user_id=d.user_id and s.capture_id=d.capture_id)`];
  const origins = [
    origin({ origin: "'document_title'", kind: "'document_title'", target_text: "d.title", revision_id: "d.current_revision_id", document_version: "d.current_version",
      origin_order: "0", identity: "json_array('title',d.object_id)" }, "from eligible_documents d"),
    origin({ origin: "'document_body'", kind: "'document_body'", target_text: "d.body_markdown", revision_id: "d.current_revision_id", document_version: "d.current_version",
      origin_order: "1", identity: "json_array('body',d.object_id)" }, "from eligible_documents d"),
  ];
  if (schema.links) ctes.push(`eligible_members as materialized (select d.object_id,d.user_id,d.capture_id,s.id as snapshot_id,s.manifest_hash,s.snapshot_version,
      m.id as member_id,m.member_key,m.source_fingerprint,m.source_item_id,
      case when s.id is d.search_current_snapshot then 0 else 1 end as is_historical
      from eligible_documents d join v2_link_snapshots s on s.user_id=d.user_id and s.document_object_id=d.object_id and s.capture_id=d.capture_id
      join v2_link_snapshot_sources m on m.snapshot_id=s.id and m.user_id=s.user_id
      join eligible_sources source on source.object_id=d.object_id and source.id=m.source_item_id and source.user_id=m.user_id
      where s.manifest_version='link-source-manifest.v1')`);
  const sourceOrigin = `case when s.item_kind='user_note' or s.link_role='user_note' then 'user_note'
    ${schema.links ? `when ${videoAnalysisProofSql("s", "s.object_id")} then 'ai_interpretation'` : ""}
    when s.item_kind='url' and json_extract(case when json_valid(s.source_metadata) then s.source_metadata else '{}' end,'$.manualLinkV1.contract')='manual-link-source.v1'
      then 'external_source' else 'source' end`;
  origins.push(origin({ origin: sourceOrigin, kind: "'source'", target_text: "s.raw_text", source_item_id: "s.id",
    snapshot_id: schema.links ? "m.snapshot_id" : "null", manifest_hash: schema.links ? "m.manifest_hash" : "null", member_id: schema.links ? "m.member_id" : "null",
    is_historical: schema.links ? "coalesce(m.is_historical,0)" : "0", origin_order: "2",
    identity: `json_array('source',s.id,${schema.links ? "m.member_id" : "null"})` },
    `from eligible_documents d join eligible_sources s on s.object_id=d.object_id
      ${schema.links ? "left join eligible_members m on m.object_id=d.object_id and m.source_item_id=s.id" : ""} where s.raw_text is not null`));
  if (schema.links) {
    ctes.push(`eligible_fragments as materialized (select f.*,m.source_item_id,m.manifest_hash,m.is_historical as snapshot_historical,
      case when f.processing_run_id is null then 'manual_extract' when f.source_class='source_extract' then 'ai_extract' else 'ai_interpretation' end as search_origin,
      case when f.processing_run_id is null then m.is_historical
        when m.is_historical=1 or f.processing_run_id is not d.search_published_run or j.input_revision_id is not d.current_revision_id then 1 else 0 end as is_historical
      from eligible_documents d join eligible_members m on m.object_id=d.object_id
      join v2_link_fragments f on f.primary_member_id=m.member_id and f.snapshot_id=m.snapshot_id and f.user_id=d.user_id and f.document_object_id=d.object_id
      left join v2_processing_runs r on r.id=f.processing_run_id and r.user_id=d.user_id
      left join v2_processing_jobs j on j.id=r.job_id and j.user_id=d.user_id and j.object_id=d.object_id and j.capture_id=d.capture_id
      left join v2_document_revisions original on original.id=j.input_revision_id and original.document_object_id=d.object_id
      where (f.processing_run_id is null and f.source_class='source_extract' and f.locked_by_user=1
          and (select count(*) from v2_link_fragment_evidence e where e.fragment_id=f.id)=1
          and exists(select 1 from v2_link_fragment_evidence e where e.fragment_id=f.id and e.user_id=f.user_id and e.member_id=f.primary_member_id
            and e.relation_kind='supports' and e.evidence_method='user_confirmed' and e.text_start=f.text_start and e.text_end=f.text_end
            and e.image_region_json is null and e.start_seconds is null and e.end_seconds is null and e.display_order=0 and e.locked_by_user=1 and e.state_version=1)
          and json_extract(f.details_json,'$.contract')='manual-link-fragment.v1' and json_extract(f.details_json,'$.selectionOrigin')='user_selected')
        or (f.processing_run_id is not null and f.source_class in ('source_extract','ai_interpretation')
          and j.stage='link_analyze' and j.status='succeeded' and r.status in ('succeeded','partial') and r.finished_at is not null
          and r.model_role='main_analyzer' and r.schema_version='link-analysis.v1' and r.prompt_version='link-analysis-block-selection.v1'
          and r.input_hash=j.input_hash and original.id is not null and j.input_link_snapshot_id=f.snapshot_id
          and j.input_source_manifest_hash=m.manifest_hash and j.input_source_manifest_version='link-source-manifest.v1'
          and (select count(*) from v2_link_fragment_evidence e where e.fragment_id=f.id) between 1 and 16
          and (f.source_class='ai_interpretation' and f.role in ('insight','visual_tip')
            or f.source_class='source_extract' and (select count(*) from v2_link_fragment_evidence e where e.fragment_id=f.id)=1)
          and exists(select 1 from v2_link_fragment_evidence e where e.fragment_id=f.id and e.display_order=0 and e.member_id=f.primary_member_id)
          and (select count(*)=count(distinct e.display_order) and min(e.display_order)=0 and max(e.display_order)=count(*)-1
            from v2_link_fragment_evidence e where e.fragment_id=f.id)
          and not exists(select 1 from v2_link_fragment_evidence e where e.fragment_id=f.id and (
            e.user_id<>f.user_id or e.relation_kind<>'supports' or e.evidence_method<>'ai_proposed'
            or e.image_region_json is not null or e.start_seconds is not null or e.end_seconds is not null
            or e.text_start is null or e.text_end is null
            or not exists(select 1 from eligible_members em where em.member_id=e.member_id and em.snapshot_id=f.snapshot_id and em.user_id=f.user_id)
            or (f.source_class='source_extract' and (e.member_id<>f.primary_member_id or e.text_start<>f.text_start or e.text_end<>f.text_end))))
          and json_extract(f.details_json,'$.contract')='link-analysis.v1' and json_extract(f.details_json,'$.scope')='available_external_text'))`);
    origins.push(origin({ origin: "f.search_origin", kind: "case when f.processing_run_id is null then 'manual_fragment' else 'ai_fragment' end",
      target_text: "coalesce(f.raw_text,f.derived_text)", source_item_id: "f.source_item_id", snapshot_id: "f.snapshot_id", manifest_hash: "f.manifest_hash",
      member_id: "f.primary_member_id", fragment_id: "f.id", run_id: "f.processing_run_id", review_status: "f.review_status", is_historical: "f.is_historical",
      origin_order: "case when f.processing_run_id is null then 3 when f.source_class='source_extract' then 4 else 5 end", identity: "json_array('fragment',f.id)" },
      "from eligible_documents d join eligible_fragments f on f.document_object_id=d.object_id where f.review_status in ('proposed','confirmed') and (f.processing_run_id is not null or f.review_status='confirmed')"));
  }
  if (schema.curations) {
    ctes.push(`eligible_curations as materialized (select c.*,s.manifest_hash as snapshot_manifest_hash,
      case when c.snapshot_id is not d.search_current_snapshot or exists(select 1 from v2_link_curation_revisions newer
        where newer.user_id=c.user_id and newer.document_object_id=c.document_object_id and newer.group_key=c.group_key and newer.revision_number>c.revision_number) then 1 else 0 end as is_historical
      from eligible_documents d join v2_link_curation_revisions c on c.document_object_id=d.object_id and c.user_id=d.user_id
      join v2_link_snapshots s on s.id=c.snapshot_id and s.user_id=c.user_id and s.document_object_id=c.document_object_id and s.capture_id=d.capture_id
      where c.manifest_version='prompt-curation-manifest.v1' and c.render_version='prompt-curation-render.v1'
        and json_extract(c.manifest_json,'$.snapshotManifestHash')=s.manifest_hash)`,
    `curation_channels as materialized (select c.id,i.copy_role,group_concat(f.raw_text,char(10) order by i.position,i.item_key) as target_text
      from eligible_curations c join v2_link_curation_items i on i.curation_revision_id=c.id and i.user_id=c.user_id
      join eligible_fragments f on f.id=i.fragment_id and f.user_id=c.user_id and f.document_object_id=c.document_object_id and f.snapshot_id=c.snapshot_id
        and f.source_class='source_extract' and f.role=i.copy_role and f.state_version>=i.fragment_state_version
      group by c.id,i.copy_role having count(*)=(select count(*) from v2_link_curation_items expected where expected.curation_revision_id=c.id and expected.copy_role=i.copy_role))`);
    const curationBase = { origin: "'curation'", kind: "'curation'", snapshot_id: "c.snapshot_id", manifest_hash: "c.snapshot_manifest_hash",
      group_key: "c.group_key", revision_id: "c.id", review_status: "c.status", is_historical: "c.is_historical", origin_order: "6" };
    origins.push(origin({ ...curationBase, target_text: "c.title", role: "'title'", identity: "json_array('curation',c.id,'title')" },
      "from eligible_documents d join eligible_curations c on c.document_object_id=d.object_id"));
    origins.push(origin({ ...curationBase, target_text: "channel.target_text", role: "channel.copy_role", identity: "json_array('curation',c.id,channel.copy_role)" },
      "from eligible_documents d join eligible_curations c on c.document_object_id=d.object_id join curation_channels channel on channel.id=c.id"));
  }
  // D1 permits fewer compound SELECT arms than the Node SQLite fixture. Keep
  // each code-owned materialized group small without limiting any data rows.
  for (let index = 0; index < origins.length; index += 4) ctes.push(`canonical_origin_group_${index / 4} as materialized (${origins.slice(index, index + 4).join(" union all ")})`);
  const originGroups = Array.from({ length: Math.ceil(origins.length / 4) }, (_, index) => `select * from canonical_origin_group_${index}`);
  ctes.push(`canonical_origins as materialized (${originGroups.join(" union all ")})`,
    `visible_entity_names as materialized (select d.object_id,r.id,e.canonical_name from eligible_documents d
      join v2_relation_edges r on r.subject_object_id=d.object_id and r.user_id=d.user_id and r.review_status='accepted' and r.superseded_at is null
      join v2_entity_records e on e.object_id=r.object_object_id join v2_objects eo on eo.id=e.object_id and eo.user_id=r.user_id and eo.lifecycle_status='active'
      where ${input.entityVisibility})`,
    `searchable_texts as materialized (select record_id,identity,target_text from canonical_origins
      union all select object_id,json_array('entity',id),canonical_name from visible_entity_names)`,
    // SQLite GLOB and replace(text,char(0),...) both stop at NUL. Only the
    // affected haystacks enter this byte-based splitter. Each recursive step
    // consumes the next NUL, including empty/consecutive/trailing segments.
    // Tokens cannot contain NUL, so no legitimate match spans the boundary.
    `nul_segments(record_id,identity,segment,tail) as (
      select record_id,identity,substr(cast(target_text as blob),1,instr(cast(target_text as blob),x'00')-1),
        substr(cast(target_text as blob),instr(cast(target_text as blob),x'00')+1)
      from searchable_texts where instr(cast(target_text as blob),x'00')>0
      union all select record_id,identity,
        case when instr(tail,x'00')>0 then substr(tail,1,instr(tail,x'00')-1) else tail end,
        case when instr(tail,x'00')>0 then substr(tail,instr(tail,x'00')+1) else null end
      from nul_segments where tail is not null)`,
    `matching_tokens as materialized (
      select s.record_id,s.identity,t.token from searchable_texts s,search_tokens t
        where instr(cast(s.target_text as blob),x'00')=0 and ${tokenMatches("s.target_text")}
      union select s.record_id,s.identity,t.token from nul_segments s,search_tokens t where ${tokenMatches("cast(s.segment as text)")})`,
    `matching_origins as materialized (select o.* from canonical_origins o where
      exists(select 1 from matching_tokens m where m.record_id=o.record_id and m.identity=o.identity))`,
    `matched_records as materialized (select d.* from eligible_documents d where not exists(select 1 from search_tokens t where
      not exists(select 1 from matching_tokens m where m.record_id=d.object_id and m.token=t.token)))`);
  const hasFts = tokens.length > 0 && tokens.every((token) => Array.from(token).length >= 3);
  if (hasFts) {
    // FTS affects ranking only. It can neither add stale text nor suppress new
    // canonical origin kinds from membership or counts.
    const expression = tokens.map((token) => {
      const phrase = `"${token.replaceAll('"', '""')}"`;
      return `(title:${phrase} OR body:${phrase} OR source_text:${phrase})`;
    }).join(" AND ");
    ctes.push(`fts_scores as materialized (select object_id,bm25(v2_documents_fts,0,0,4,2,1.5,1.2) as score from v2_documents_fts where v2_documents_fts match ? and user_id=?)`);
    bindings.push(expression, input.userId);
  }
  const sortColumn = plan.sort.field === "title" ? "d.title" : plan.sort.field === "captured_at" ? "d.captured_at"
    : plan.sort.field === "written_at" ? "coalesce(d.written_at,d.captured_at)" : plan.sort.field === "updated_at" ? "d.object_updated_at"
      : hasFts ? "coalesce((select min(score) from fts_scores where object_id=d.object_id),0)" : "d.object_updated_at";
  return { withSql: `with recursive ${ctes.join(",\n")}`, bindings, tokens, userId: input.userId,
    orderSql: `${sortColumn} ${plan.sort.field === "relevance" && hasFts ? "asc" : plan.sort.direction},d.object_id` };
}

const labels: Record<V2RetrievalMatch["origin"], string> = { document_title: "제목", document_body: "내 글", user_note: "보관한 내 메모",
  external_source: "보관 원문", source: "원본·OCR·녹취", manual_extract: "수동 발췌", ai_extract: "AI 선택 발췌", ai_interpretation: "AI 해석", curation: "정리본" };
export function materializeRetrievalMatch(row: CanonicalRetrievalOriginRow, tokens: readonly string[], allowSnippet: boolean): V2RetrievalMatch {
  const range = firstRecordTextMatch(row.target_text, tokens);
  const common = { contract: "record-location.v1" as const, range, textHash: recordLocationTextHash(row.target_text) };
  let location: V2RecordLocationV1;
  if (row.kind === "document_title" || row.kind === "document_body") location = { ...common, kind: row.kind,
    revisionId: row.revision_id!, documentVersion: row.document_version! };
  else if (row.kind === "source") location = { ...common, kind: "source", sourceItemId: row.source_item_id!, snapshotId: row.snapshot_id,
    manifestHash: row.manifest_hash, memberId: row.member_id };
  else if (row.kind === "curation") location = { ...common, kind: "curation", snapshotId: row.snapshot_id!, manifestHash: row.manifest_hash!,
    groupKey: row.group_key!, revisionId: row.revision_id!, role: row.role as "title" | "prompt" | "negative_prompt" | "parameters" };
  else {
    const fragment = { ...common, snapshotId: row.snapshot_id!, manifestHash: row.manifest_hash!, sourceItemId: row.source_item_id!, memberId: row.member_id!, fragmentId: row.fragment_id! };
    location = row.kind === "manual_fragment" ? { ...fragment, kind: "manual_fragment" } : { ...fragment, kind: "ai_fragment", runId: row.run_id! };
  }
  let start = Math.max(0, (range?.start ?? 0) - 60), end = Math.min(row.target_text.length, (range?.end ?? 0) + 160);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(row.target_text[start])) start--;
  if (end < row.target_text.length && /[\uDC00-\uDFFF]/.test(row.target_text[end])) end++;
  return { id: recordLocationTextHash(`${row.record_id}\0${row.identity}\0${common.textHash}`), origin: row.origin,
    label: labels[row.origin] + (row.origin === "curation" ? ` · ${row.role === "title" ? "제목" : row.role}` : ""),
    snippet: allowSnippet ? `${start ? "…" : ""}${row.target_text.slice(start, end)}${end < row.target_text.length ? "…" : ""}` : null,
    location, reviewStatus: row.review_status, isHistorical: row.is_historical === 1 };
}

type CanonicalQuery = ReturnType<typeof canonicalRetrievalSql>;
type QueryPageRow = { total_count: number; page: number; page_size: number; total_pages: number; items_json: string };
type DocumentResultRow = { object_id: string; title: string; privacy_level: V2RetrievalResult["privacyLevel"]; captured_at: string; written_at: string | null;
  object_updated_at: string; body_excerpt: string; matches: CanonicalRetrievalOriginRow[]; match_count: number };
type PropertyDisplayRow = SavedViewFieldValueRow & { recordId: string; fieldKey: string };
type TypeDisplayRow = SavedViewFieldValueRow & { recordId: string; typeKey: string };
type DisplayPageRow = QueryPageRow & { field_registry_json: string; property_values_json: string; type_values_json: string };
const pageOffset = "limit (select page_size from pagination) offset (select (page-1)*page_size from pagination)";
function pageCtes(count: string) {
  return `, page_input as (select cast(? as integer) as page_size,cast(? as integer) as requested_page), totals as (${count}), pagination as (
    select total_count,page_size,max(1,(total_count+page_size-1)/page_size) as total_pages,
      min(requested_page,max(1,(total_count+page_size-1)/page_size)) as page from totals,page_input)`;
}
function requestedPage(value: number) { return Number.isSafeInteger(value) ? Math.max(1, value) : 1; }
function outputPage(row: QueryPageRow) { return { totalCount: row.total_count, page: row.page, pageSize: row.page_size, totalPages: row.total_pages }; }

function savedViewFieldsForRecord(record: DocumentResultRow, fields: readonly string[], registry: ReadonlyMap<string, string>,
  properties: readonly PropertyDisplayRow[], types: readonly TypeDisplayRow[]): readonly SavedViewFieldRow[] {
  return fields.map((fieldKey) => {
    const label = registry.get(fieldKey) ?? fieldKey;
    if (record.privacy_level !== "normal") return { fieldKey, label, values: [] };
    if (fieldKey === "@record.type") return { fieldKey, label, values: types };
    if (fieldKey === "@record.captured_at" || fieldKey === "@record.written_at" || fieldKey === "@record.updated_at") {
      const value = fieldKey === "@record.captured_at" ? record.captured_at : fieldKey === "@record.written_at" ? record.written_at : record.object_updated_at;
      return { fieldKey, label, values: value === null ? [] : [{ propertyId: null, valueKind: "date", valueJson: JSON.stringify(value),
        unit: null, sourceClass: "metadata", lockedByUser: 0 }] };
    }
    return { fieldKey, label, values: properties.filter((property) => property.fieldKey === fieldKey) };
  });
}

/** Count, page membership, privacy and returned bytes share one SQL snapshot. */
export async function canonicalRecordPage(db: D1DatabaseBinding, plan: V2RetrievalQueryPlanV1, query: CanonicalQuery, page: number, visibleFields: readonly string[] = []): Promise<V2RetrievalPage> {
  const selectedFields = captureSavedViewVisibleFields(visibleFields);
  const jsonFields = ["object_id", "title", "privacy_level", "captured_at", "written_at", "object_updated_at", "body_excerpt", "match_count"];
  const row = await db.prepare(`${query.withSql}, selected_display_fields as (
      select ? as user_id,value as field_key from json_each(?))${pageCtes("select count(*) as total_count from matched_records")},
    result_rows as materialized (select d.object_id,d.user_id,d.title,d.privacy_level,d.captured_at,d.written_at,d.object_updated_at,substr(d.body_markdown,1,220) as body_excerpt,
      (select count(*) from matching_origins m where m.record_id=d.object_id) as match_count,
      (select json_group_array(${retrievalOriginJson("m")}) from
        (select * from matching_origins where record_id=d.object_id order by ${retrievalOriginOrder} limit 3) m) as matches_json
      from matched_records d order by ${query.orderSql} ${pageOffset})
    select p.*,(select json_group_array(json_object(${jsonFields.map((field) => `'${field}',r.${field}`).join(",")},'matches',json(r.matches_json)))
      from result_rows r) as items_json,
      (select json_group_array(json_object('fieldKey',k.field_key,'label',coalesce(f.label,k.field_key)))
        from selected_display_fields k left join v2_field_definitions f on f.key=k.field_key and f.user_id=k.user_id) as field_registry_json,
      (select json_group_array(json_object('recordId',r.object_id,'fieldKey',f.key,'propertyId',v.id,
          'valueKind',v.value_kind,'valueJson',case when length(cast(v.value_json as blob))<=${SAVED_FIELD_INLINE_BYTES} then v.value_json else null end,
          'storedBytes',length(cast(v.value_json as blob)),
          'valuePreview',case when length(cast(v.value_json as blob))>${SAVED_FIELD_INLINE_BYTES} and json_valid(v.value_json) then
            case when v.value_kind='json'
              or (v.value_kind in ('text','number','boolean','date','rating') and json_type(v.value_json)='null')
              or (v.value_kind in ('text','date') and json_type(v.value_json)='text')
              or (v.value_kind in ('number','rating') and json_type(v.value_json) in ('integer','real')
                and json_extract(v.value_json,'$') between -1.7976931348623157e308 and 1.7976931348623157e308)
              or (v.value_kind='boolean' and json_type(v.value_json) in ('true','false'))
              then substr(v.value_json,1,${SAVED_FIELD_PREVIEW_POINTS}) end end,
          'unit',v.unit_key,'sourceClass',v.source_class,'lockedByUser',v.locked_by_user)
          order by r.object_id,f.key,v.id)
        from result_rows r join v2_property_values v on v.owner_object_id=r.object_id and v.user_id=r.user_id
          join v2_field_definitions f on f.id=v.field_definition_id and f.user_id=v.user_id
          join selected_display_fields k on k.field_key=f.key and k.user_id=f.user_id
        where r.privacy_level='normal' and v.review_status='accepted' and v.superseded_at is null) as property_values_json,
      (select json_group_array(json_object('recordId',r.object_id,'typeKey',t.key,'propertyId',null,
          'valueKind','text','valueJson',json_quote(t.label)||'','unit',null,'sourceClass','type_'||a.source_class,'lockedByUser',a.locked_by_user,
          'priority',case a.role when 'primary' then 0 when 'secondary' then 1 else 2 end) order by r.object_id,t.key,a.id)
        from result_rows r join v2_object_type_assignments a on a.object_id=r.object_id and a.user_id=r.user_id and a.review_status='accepted'
          join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id
        where r.privacy_level='normal') as type_values_json
      from pagination p`)
    .bind(...query.bindings, query.userId, JSON.stringify(selectedFields), plan.limit, requestedPage(page)).first<DisplayPageRow>();
  if (!row) throw new Error("Canonical retrieval did not return its count snapshot.");
  // The remaining work is synchronous. No later request can supply different
  // bytes or silently promote a normal record after this permission boundary.
  // Flat sibling projections avoid D1's depth-100 nested-expression limit;
  // their assembly is synchronous and never requires per-record SQL reads.
  const values = JSON.parse(row.items_json) as DocumentResultRow[];
  const registry = new Map((JSON.parse(row.field_registry_json) as { fieldKey: string; label: string }[]).map((field) => [field.fieldKey, field.label]));
  const properties = new Map<string, PropertyDisplayRow[]>(), types = new Map<string, TypeDisplayRow[]>();
  for (const value of JSON.parse(row.property_values_json) as PropertyDisplayRow[]) {
    const recordValues = properties.get(value.recordId) ?? []; recordValues.push(value); properties.set(value.recordId, recordValues);
  }
  for (const value of JSON.parse(row.type_values_json) as TypeDisplayRow[]) {
    const recordValues = types.get(value.recordId) ?? []; recordValues.push(value); types.set(value.recordId, recordValues);
  }
  const results = values.map((value): V2RetrievalResult => {
    const recordTypes = types.get(value.object_id) ?? [], selectedTypes = preferredSavedViewFieldRows(recordTypes);
    const typeKey = selectedTypes.length === 1 ? selectedTypes[0].typeKey : null;
    const typeLabel = selectedTypes.length > 1 ? "분류 확인 필요" : selectedTypes.length === 1 ? JSON.parse(selectedTypes[0].valueJson!) as string : "기록";
    const matches = value.matches.map((match) => materializeRetrievalMatch(match, query.tokens, value.privacy_level === "normal"));
    const reasons: string[] = [];
    if (plan.fullText) {
      const first = value.matches[0];
      if (!first) reasons.push(`연결된 대상 이름에 ‘${plan.fullText}’ 포함`);
      else if (!firstRecordTextMatch(first.target_text, [plan.fullText])) reasons.push("검색어가 여러 보관 위치에 일치");
      else {
        const reasonLabel = first.origin === "document_title" ? "제목" : first.origin === "document_body" ? "본문"
          : ["source", "external_source"].includes(first.origin) ? "원본·OCR·녹취" : labels[first.origin];
        reasons.push(`${reasonLabel}에 ‘${plan.fullText}’ 포함`);
      }
    }
    if (plan.typeKeys.length) reasons.push(typeKey && plan.typeKeys.includes(typeKey) ? `${typeLabel} 분류` : "분류 조건 일치");
    for (const filter of plan.propertyFilters) reasons.push(`${filter.fieldKey} ${filter.operator}`);
    if (plan.entityFilters.length) reasons.push("확인된 대상과 연결");
    return { recordId: value.object_id, title: value.title, privacyLevel: value.privacy_level, capturedAt: value.captured_at, writtenAt: value.written_at,
      updatedAt: value.object_updated_at, typeKey, typeLabel, iconKey: suggestSemanticIconForType(typeKey),
      snippet: value.privacy_level === "normal" ? matches[0]?.snippet ?? value.body_excerpt : null,
      inclusionReasons: reasons.length ? reasons : ["최근 기록"], matches, matchCount: value.match_count,
      ...(selectedFields.length ? { displayFields: presentSavedViewFields(savedViewFieldsForRecord(value, selectedFields, registry,
        properties.get(value.object_id) ?? [], recordTypes), value.privacy_level) } : {}) };
  });
  return { ...outputPage(row), results };
}

export async function canonicalMatchPage(db: D1DatabaseBinding, plan: V2RetrievalQueryPlanV1, query: CanonicalQuery, page: number): Promise<V2RetrievalMatchPage> {
  const row = await db.prepare(`${query.withSql}, matched_locations as materialized (
      select m.*,d.privacy_level from matching_origins m join matched_records d on d.object_id=m.record_id)
    ${pageCtes("select count(*) as total_count from matched_locations")},
    result_rows as (select * from matched_locations order by ${retrievalOriginOrder} ${pageOffset})
    select p.*,(select privacy_level from matched_records) as record_privacy_level,
      (select json_group_array(json_object('origin',json(${retrievalOriginJson("r")}),'privacyLevel',r.privacy_level))
      from result_rows r) as items_json from pagination p`)
    .bind(...query.bindings, plan.limit, requestedPage(page)).first<QueryPageRow & { record_privacy_level: V2RetrievalMatchPage["privacyLevel"] }>();
  if (!row) throw new Error("Canonical retrieval did not return its count snapshot.");
  const values = JSON.parse(row.items_json) as { origin: CanonicalRetrievalOriginRow; privacyLevel: V2RetrievalResult["privacyLevel"] }[];
  return { ...outputPage(row), privacyLevel: row.record_privacy_level,
    matches: values.map((value) => materializeRetrievalMatch(value.origin, query.tokens, value.privacyLevel === "normal")) };
}
