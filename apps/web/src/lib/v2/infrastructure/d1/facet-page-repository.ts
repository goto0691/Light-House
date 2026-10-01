import type { D1DatabaseBinding } from "./source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "./legacy-projection-visibility";
import { captureFacetRequest, validateFacetPage, type FacetPage, type FacetRequest } from "@/lib/v2/retrieval/facet-page";

/** Count, visible page, and exact selection all use one final SQL snapshot. */
export async function readFacetPage(db: D1DatabaseBinding, userId: string, candidate: FacetRequest): Promise<FacetPage> {
  const request = captureFacetRequest(candidate);
  const legacyVisibility = await legacyProjectionVisibilityPredicate(db);
  let base: string;
  if (request.kind === "type") {
    base = `select t.key,t.label,count(distinct a.object_id) as result_count,null as entity_kind
      from v2_type_definitions t join v2_object_type_assignments a on a.type_definition_id=t.id and a.user_id=t.user_id
      join v2_objects o on o.id=a.object_id and o.user_id=a.user_id and o.lifecycle_status='active'
      join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
      where t.user_id=?1 and ${legacyVisibility} and t.status in ('observed','active')
        and a.review_status not in ('rejected','superseded') group by t.key,t.label`;
  } else if (request.kind === "entity") {
    const entityVisibility = await legacyProjectionVisibilityPredicate(db, "eo");
    base = `select e.object_id as key,e.canonical_name as label,count(distinct r.subject_object_id) as result_count,e.entity_kind
      from v2_entity_records e join v2_objects eo on eo.id=e.object_id and eo.user_id=?1 and eo.lifecycle_status='active'
      join v2_relation_edges r on r.object_object_id=e.object_id and r.user_id=eo.user_id and r.review_status='accepted' and r.superseded_at is null
      join v2_documents d on d.object_id=r.subject_object_id and d.privacy_level='normal'
      join v2_objects o on o.id=d.object_id and o.user_id=r.user_id and o.lifecycle_status='active'
      where ${entityVisibility} and ${legacyVisibility} group by e.object_id,e.entity_kind,e.canonical_name`;
  } else {
    // Preserve stored capture-month semantics (not UTC recategorization); reject unusable month prefixes, not entire records.
    base = `select substr(c.captured_at,1,7) as key,substr(c.captured_at,1,7) as label,count(*) as result_count,null as entity_kind
      from v2_capture_bundles c join v2_documents d on d.capture_id=c.id join v2_objects o on o.id=d.object_id and o.user_id=c.user_id
      where c.user_id=?1 and o.lifecycle_status='active' and ${legacyVisibility} and d.privacy_level<>'restricted'
        and substr(c.captured_at,1,7) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' and substr(c.captured_at,6,2) between '01' and '12'
      group by substr(c.captured_at,1,7)`;
  }
  const order = request.kind === "month" ? "key desc" : "result_count desc,label,key";
  const row = await db.prepare(`with facets as materialized (${base}),
    filtered as materialized (select * from facets where instr(lower(key),lower(?2))>0 or instr(lower(label),lower(?2))>0
      or instr(lower(coalesce(entity_kind,'')),lower(?2))>0),
    summary as (select count(*) as total_count from filtered),
    paging as (select total_count,max(1,(total_count+19)/20) as total_pages,min(?3,max(1,(total_count+19)/20)) as page from summary)
    select total_count,total_pages,page,coalesce((select json_group_array(json_object('key',key,'label',label,'count',result_count,'entityKind',entity_kind))
      from (select * from filtered order by ${order} limit 20 offset (select (page-1)*20 from paging))), '[]') as items_json,
      (select json_object('key',key,'label',label,'count',result_count,'entityKind',entity_kind) from facets where key=?4) as selected_json from paging
  `).bind(userId, request.query, request.page, request.selectedKey).first<{
    total_count: number; total_pages: number; page: number; items_json: string; selected_json: string | null;
  }>();
  if (!row) throw new Error("The facet catalog could not be read.");
  return validateFacetPage({ contract: "facet-page.v1", kind: request.kind, query: request.query, page: row.page, pageSize: 20,
    totalCount: row.total_count, totalPages: row.total_pages, items: JSON.parse(row.items_json), selected: row.selected_json === null ? null : JSON.parse(row.selected_json) }, request);
}
