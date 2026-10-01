import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { validateV2QueryPlan, type V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import type { V2RetrievalMatch, V2RetrievalMatchPage } from "@/lib/v2/retrieval/record-location-v1";
import { captureSavedViewVisibleFields, type V2SavedViewField } from "@/lib/v2/retrieval/saved-view-fields";
import { canonicalMatchPage, canonicalRecordPage, canonicalRetrievalSql, retrievalCapabilities } from "./retrieval-canonical-sql";

export type V2RetrievalResult = Readonly<{
  recordId: string;
  title: string;
  snippet: string | null;
  privacyLevel: "normal" | "sensitive" | "restricted";
  capturedAt: string;
  writtenAt: string | null;
  updatedAt: string;
  typeKey: string | null;
  typeLabel: string;
  iconKey: string;
  inclusionReasons: readonly string[];
  matches?: readonly V2RetrievalMatch[];
  matchCount?: number;
  displayFields?: readonly V2SavedViewField[];
}>;

export type V2RetrievalPage = Readonly<{ results: V2RetrievalResult[]; totalCount: number; page: number; pageSize: number; totalPages: number }>;

export class D1RetrievalRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string) {}

  async listTypeFacets() {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const rows = await this.db.prepare(
      `select t.key,t.label,count(distinct a.object_id) as result_count
       from v2_type_definitions t join v2_object_type_assignments a on a.type_definition_id=t.id and a.user_id=t.user_id
       join v2_objects o on o.id=a.object_id and o.user_id=a.user_id and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       where t.user_id=? and ${legacyVisibility} and t.status in ('observed','active') and a.review_status not in ('rejected','superseded')
       group by t.key,t.label order by result_count desc,t.label limit 50`,
    ).bind(this.userId).all<{ key: string; label: string; result_count: number }>();
    return rows.results.map((row) => ({ key: row.key, label: row.label, count: row.result_count }));
  }

  async listEntityFacets() {
    const entityLegacyVisibility = await legacyProjectionVisibilityPredicate(this.db, "eo");
    const subjectLegacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const rows = await this.db.prepare(
      `select e.object_id,e.entity_kind,e.canonical_name,count(distinct r.subject_object_id) as result_count
       from v2_entity_records e join v2_objects eo on eo.id=e.object_id and eo.user_id=? and eo.lifecycle_status='active'
       join v2_relation_edges r on r.object_object_id=e.object_id and r.user_id=eo.user_id and r.review_status='accepted' and r.superseded_at is null
       join v2_documents d on d.object_id=r.subject_object_id and d.privacy_level='normal'
       join v2_objects o on o.id=d.object_id and o.user_id=r.user_id and o.lifecycle_status='active'
       where ${entityLegacyVisibility} and ${subjectLegacyVisibility}
       group by e.object_id,e.entity_kind,e.canonical_name order by result_count desc,e.canonical_name limit 60`,
    ).bind(this.userId).all<{ object_id: string; entity_kind: string; canonical_name: string; result_count: number }>();
    return rows.results.map((row) => ({ objectId: row.object_id, kind: row.entity_kind, name: row.canonical_name, count: row.result_count }));
  }

  async listTimelineFacets() {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const rows = await this.db.prepare(
      `select substr(c.captured_at,1,7) as month,count(*) as result_count
       from v2_capture_bundles c join v2_documents d on d.capture_id=c.id join v2_objects o on o.id=d.object_id and o.user_id=c.user_id
       where c.user_id=? and o.lifecycle_status='active' and ${legacyVisibility} and d.privacy_level<>'restricted'
       group by substr(c.captured_at,1,7) order by month desc limit 36`,
    ).bind(this.userId).all<{ month: string; result_count: number }>();
    return rows.results.map((row) => ({ month: row.month, count: row.result_count }));
  }

  async search(candidate: V2RetrievalQueryPlanV1, includeRestricted = false): Promise<V2RetrievalResult[]> {
    return (await this.searchPage(candidate, includeRestricted)).results;
  }

  private async canonicalQuery(plan: V2RetrievalQueryPlanV1, includeRestricted: boolean, recordId?: string) {
    const [legacyVisibility, entityVisibility, schema] = await Promise.all([
      legacyProjectionVisibilityPredicate(this.db), legacyProjectionVisibilityPredicate(this.db, "eo"), retrievalCapabilities(this.db),
    ]);
    return canonicalRetrievalSql({ plan, userId: this.userId, includeRestricted, legacyVisibility, entityVisibility, schema, recordId });
  }

  async searchPage(candidate: V2RetrievalQueryPlanV1, includeRestricted = false, requestedPage = 1, visibleFields: readonly string[] = []): Promise<V2RetrievalPage> {
    const plan = validateV2QueryPlan(candidate);
    const selectedFields = captureSavedViewVisibleFields(visibleFields);
    const query = await this.canonicalQuery(plan, includeRestricted);
    return canonicalRecordPage(this.db, plan, query, requestedPage, selectedFields);
  }

  async listMatches(recordId: string, candidate: V2RetrievalQueryPlanV1, includeRestricted = false, requestedPage = 1): Promise<V2RetrievalMatchPage> {
    const plan = validateV2QueryPlan(candidate);
    const query = await this.canonicalQuery(plan, includeRestricted, recordId);
    return canonicalMatchPage(this.db, plan, query, requestedPage);
  }
}
