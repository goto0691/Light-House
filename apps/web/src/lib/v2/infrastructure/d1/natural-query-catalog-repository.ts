import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { NATURAL_QUERY_LIMITS, normalizeNaturalQueryCatalog, type NaturalQueryCatalog } from "@/lib/v2/retrieval/natural-query-v1";

/**
 * Owner-scoped registry metadata for natural-language interpretation.
 * Only keys, labels and data types are read. Every entry must be backed by at
 * least one active, legacy-visible, non-restricted document of this owner, so
 * a type, field or entity kind used only by restricted records never leaves
 * D1, even while a restricted grant is active. Titles, bodies, entity names
 * and property values are never selected.
 * Fields are offered only when all of their current accepted values are
 * low-risk claims: autobiographical and social_high_risk interpretations
 * (emotion, intent, personality, relationship) are not usable as filters.
 */
export async function readNaturalQueryCatalog(db: D1DatabaseBinding, userId: string): Promise<NaturalQueryCatalog> {
  const [visibility, entityVisibility] = await Promise.all([
    legacyProjectionVisibilityPredicate(db, "o"), legacyProjectionVisibilityPredicate(db, "eo"),
  ]);
  const [types, fields, kinds] = await Promise.all([
    db.prepare(
      `select t.key,t.label,count(distinct a.object_id) as usage_count
       from v2_type_definitions t
       join v2_object_type_assignments a on a.type_definition_id=t.id and a.user_id=t.user_id and a.review_status not in ('rejected','superseded')
       join v2_objects o on o.id=a.object_id and o.user_id=t.user_id and o.object_kind='document' and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       where t.user_id=? and t.status not in ('archived','merged') and ${visibility}
       group by t.key,t.label order by usage_count desc,t.key limit ?`,
    ).bind(userId, NATURAL_QUERY_LIMITS.catalogTypes).all<{ key: string; label: string }>(),
    db.prepare(
      `select f.key,f.label,f.data_type,count(distinct p.owner_object_id) as usage_count
       from v2_field_definitions f
       join v2_property_values p on p.field_definition_id=f.id and p.user_id=f.user_id
         and p.review_status='accepted' and p.superseded_at is null and p.claim_risk='low'
       join v2_objects o on o.id=p.owner_object_id and o.user_id=f.user_id and o.object_kind='document' and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       where f.user_id=? and f.status not in ('archived','merged') and ${visibility}
         and not exists (select 1 from v2_property_values risky where risky.user_id=f.user_id and risky.field_definition_id=f.id
           and risky.review_status='accepted' and risky.superseded_at is null and risky.claim_risk<>'low')
       group by f.key,f.label,f.data_type order by usage_count desc,f.key limit ?`,
    ).bind(userId, NATURAL_QUERY_LIMITS.catalogFields).all<{ key: string; label: string; data_type: string }>(),
    db.prepare(
      `select e.entity_kind,count(distinct r.subject_object_id) as usage_count
       from v2_relation_edges r
       join v2_entity_records e on e.object_id=r.object_object_id
       join v2_objects eo on eo.id=e.object_id and eo.user_id=r.user_id and eo.lifecycle_status='active'
       join v2_objects o on o.id=r.subject_object_id and o.user_id=r.user_id and o.object_kind='document' and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       where r.user_id=? and r.review_status='accepted' and r.superseded_at is null and ${entityVisibility} and ${visibility}
       group by e.entity_kind order by usage_count desc,e.entity_kind limit ?`,
    ).bind(userId, NATURAL_QUERY_LIMITS.catalogEntityKinds).all<{ entity_kind: string }>(),
  ]);
  return normalizeNaturalQueryCatalog({
    types: types.results.map((row) => ({ key: row.key, label: row.label })),
    fields: fields.results.map((row) => ({ key: row.key, label: row.label, dataType: row.data_type })),
    entityKinds: kinds.results.map((row) => row.entity_kind),
  });
}
