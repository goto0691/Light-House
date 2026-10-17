import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";

/** The analyzer receives relevant registry candidates, never the whole registry (04 §3). */
export const ANALYSIS_REGISTRY_CONTEXT_LIMITS = Object.freeze({ types: 40, fields: 80, scanTypes: 200, scanFields: 400, label: 100, typesPerField: 3 });

const CANONICAL_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;

export type AnalysisRegistryContext = Readonly<{
  candidate_types: readonly Readonly<{ key: string; label: string; status: string; usage_count: number }>[];
  /** used_with_types: the owner's document types this field is kept on most (at most 3), so a field's meaning is read in its category. */
  candidate_fields: readonly Readonly<{ key: string; label: string; data_type: string; status: string; usage_count: number; used_with_types: readonly string[] }>[];
}>;

type Row = { key: string; label: string; status: string; usage_count: number };

/**
 * Owner-scoped type and field definitions the analyzer should reuse instead of
 * inventing a new key for the same meaning. Only keys, labels, data types,
 * registry status and usage counts are read. Like the S5 catalog, every entry
 * must be backed by an active, legacy-visible, non-restricted document of this
 * owner, so a definition used only by restricted records never reaches the
 * provider. Titles, bodies, entity names and property values are never read.
 * Unlike the S5 catalog, fields with autobiographical or proposed values stay
 * candidates: the analyzer must keep their key stable, not filter on them.
 */
export async function readAnalysisRegistryContext(db: D1DatabaseBinding, userId: string, documentText: string): Promise<AnalysisRegistryContext> {
  const visibility = await legacyProjectionVisibilityPredicate(db, "o");
  const statusRank = (alias: string) => `case ${alias}.status when 'active' then 0 when 'observed' then 1 else 2 end`;
  const [types, fields] = await Promise.all([
    db.prepare(
      `select t.key,t.label,t.status,count(distinct a.object_id) as usage_count
       from v2_type_definitions t
       join v2_object_type_assignments a on a.type_definition_id=t.id and a.user_id=t.user_id and a.review_status not in ('rejected','superseded')
       join v2_objects o on o.id=a.object_id and o.user_id=t.user_id and o.object_kind='document' and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       where t.user_id=? and t.applies_to_kind='document' and t.status not in ('archived','merged') and ${visibility}
       group by t.key,t.label,t.status order by ${statusRank("t")},usage_count desc,t.key limit ?`,
    ).bind(userId, ANALYSIS_REGISTRY_CONTEXT_LIMITS.scanTypes).all<Row>(),
    db.prepare(
      `select f.key,f.label,f.data_type,f.status,count(distinct p.owner_object_id) as usage_count
       from v2_field_definitions f
       join v2_property_values p on p.field_definition_id=f.id and p.user_id=f.user_id
         and p.review_status not in ('rejected','superseded') and p.superseded_at is null
       join v2_objects o on o.id=p.owner_object_id and o.user_id=f.user_id and o.object_kind='document' and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       where f.user_id=? and f.status not in ('archived','merged') and ${visibility}
       group by f.key,f.label,f.data_type,f.status order by ${statusRank("f")},usage_count desc,f.key limit ?`,
    ).bind(userId, ANALYSIS_REGISTRY_CONTEXT_LIMITS.scanFields).all<Row & { data_type: string }>(),
  ]);
  // Relevance: a definition whose label already appears in this document goes first;
  // otherwise registry status and usage order is kept.
  const relevant = <T extends Row>(rows: readonly T[], limit: number) => rows
    .filter((row) => CANONICAL_KEY.test(row.key) && typeof row.label === "string" && row.label.trim())
    .map((row, index) => ({ row, index, mentioned: row.label.trim().length >= 2 && documentText.includes(row.label.trim()) ? 0 : 1 }))
    .sort((left, right) => left.mentioned - right.mentioned || left.index - right.index)
    .slice(0, limit)
    .map(({ row }) => row);
  const label = (value: string) => value.trim().slice(0, ANALYSIS_REGISTRY_CONTEXT_LIMITS.label);
  const chosenFields = relevant(fields.results, ANALYSIS_REGISTRY_CONTEXT_LIMITS.fields);
  const usedWith = await fieldTypes(db, userId, chosenFields.map((row) => row.key), visibility);
  return {
    candidate_types: relevant(types.results, ANALYSIS_REGISTRY_CONTEXT_LIMITS.types)
      .map((row) => ({ key: row.key, label: label(row.label), status: row.status, usage_count: Number(row.usage_count) })),
    candidate_fields: chosenFields
      .map((row) => ({ key: row.key, label: label(row.label), data_type: row.data_type, status: row.status, usage_count: Number(row.usage_count), used_with_types: usedWith.get(row.key) ?? [] })),
  };
}

/** For each field, the types of the visible, non-restricted documents that hold it (any role), most used first. */
async function fieldTypes(db: D1DatabaseBinding, userId: string, fieldKeys: readonly string[], visibility: string) {
  const byField = new Map<string, string[]>();
  if (!fieldKeys.length) return byField;
  const rows = await db.prepare(
    `select field_key,type_key from (
       select f.key as field_key,t.key as type_key,
         row_number() over (partition by f.key order by count(distinct p.owner_object_id) desc,t.key) as rank
       from v2_field_definitions f
       join v2_property_values p on p.field_definition_id=f.id and p.user_id=f.user_id
         and p.review_status not in ('rejected','superseded') and p.superseded_at is null
       join v2_objects o on o.id=p.owner_object_id and o.user_id=f.user_id and o.object_kind='document' and o.lifecycle_status='active'
       join v2_documents d on d.object_id=o.id and d.privacy_level<>'restricted'
       join v2_object_type_assignments a on a.object_id=o.id and a.user_id=f.user_id and a.review_status not in ('rejected','superseded')
       join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=f.user_id and t.applies_to_kind='document' and t.status not in ('archived','merged')
       where f.user_id=? and f.key in (${fieldKeys.map(() => "?").join(",")}) and ${visibility}
       group by f.key,t.key
     ) where rank<=? order by field_key,rank`,
  ).bind(userId, ...fieldKeys, ANALYSIS_REGISTRY_CONTEXT_LIMITS.typesPerField).all<{ field_key: string; type_key: string }>();
  for (const row of rows.results) {
    if (!CANONICAL_KEY.test(row.type_key)) continue;
    byField.set(row.field_key, [...byField.get(row.field_key) ?? [], row.type_key]);
  }
  return byField;
}
