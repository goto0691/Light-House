import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import { undatedImportSql } from "@/lib/v2/presentation/record-date";
import { entityKindLabel } from "@/lib/v2/presentation/record-labels";

export const CONNECTION_GROUPS_CONTRACT = "connection-groups-v1";
const DEFAULT_ITEMS_PER_GROUP = 5;
/** One opened group shows this many; beyond it the page offers search. */
export const EXPANDED_ITEMS = 100;
const MAX_EDGES = 5000;
const UNCLASSIFIED = Object.freeze({ key: "unclassified", label: "분류 전" });

/** Imported owner links read as the owner's own (D-119); only AI and external links are marked. */
export type ConnectionOrigin = "user" | "ai" | "external";
export type ConnectionGroupItem = Readonly<{
  objectId: string;
  objectKind: "document" | "entity" | "event";
  label: string;
  date: string | null;
  relationLabels: readonly string[];
  directions: readonly ("outgoing" | "incoming")[];
  origins: readonly ConnectionOrigin[];
}>;
export type ConnectionGroup = Readonly<{
  groupKey: string;
  label: string;
  count: number;
  relationLabels: readonly string[];
  items: readonly ConnectionGroupItem[];
  /** Sensitive records count toward the group but their titles stay closed. */
  closedSensitiveCount: number;
}>;
export type ConnectionGroups = Readonly<{
  contractVersion: typeof CONNECTION_GROUPS_CONTRACT;
  total: number;
  summary: readonly Readonly<{ groupKey: string; label: string; count: number }>[];
  groups: readonly ConnectionGroup[];
  /** AI-proposed links are not mixed into confirmed groups. */
  pendingCount: number;
}>;

type EdgeRow = {
  relation_id: string; review_status: "accepted" | "proposed"; source_class: string; predicate_label: string; direction: "outgoing" | "incoming";
  other_id: string; object_kind: "document" | "entity" | "event";
  title: string | null; privacy_level: "normal" | "sensitive" | null; doc_date: string | null;
  entity_kind: string | null; canonical_name: string | null; event_type_key: string | null; occurred_at_start: string | null;
  primary_type: string | null;
};

function origin(sourceClass: string): ConnectionOrigin {
  if (sourceClass === "imported" || sourceClass === "user_explicit") return "user";
  if (sourceClass === "external_grounded") return "external";
  return "ai";
}

function category(row: EdgeRow) {
  if (row.object_kind === "entity") {
    const kind = row.entity_kind ?? "entity";
    return { key: `entity:${kind}`, label: entityKindLabel(kind) };
  }
  if (row.object_kind === "event") return { key: `event:${row.event_type_key ?? "event"}`, label: row.event_type_key ?? "사건" };
  try {
    const type = row.primary_type ? JSON.parse(row.primary_type) as { key?: unknown; label?: unknown } : null;
    if (type && typeof type.key === "string" && typeof type.label === "string") return { key: `type:${type.key}`, label: type.label };
  } catch { /* An unreadable type label falls back to the unclassified group. */ }
  return { key: `type:${UNCLASSIFIED.key}`, label: UNCLASSIFIED.label };
}

function union<T>(values: readonly T[], value: T): T[] { return values.includes(value) ? [...values] : [...values, value]; }

export { entityKindLabel };

/** The header of an entity page: an active, visible entity of this owner, or null. */
export async function readEntitySummary(db: D1DatabaseBinding, userId: string, entityId: string) {
  const visibility = await legacyProjectionVisibilityPredicate(db, "eo");
  const row = await db.prepare(
    `select e.object_id,e.entity_kind,e.canonical_name from v2_entity_records e
     join v2_objects eo on eo.id=e.object_id and eo.user_id=? and eo.object_kind='entity' and eo.lifecycle_status='active'
     where e.object_id=? and ${visibility} limit 1`,
  ).bind(userId, entityId).first<{ object_id: string; entity_kind: string; canonical_name: string }>();
  return row ? { entityId: row.object_id, kind: row.entity_kind, kindLabel: entityKindLabel(row.entity_kind), name: row.canonical_name } : null;
}

/**
 * Connections of one record or entity, grouped by the category of the other side
 * (its accepted primary type, or entity kind) instead of one flat list. Both link
 * directions count. Restricted records are never counted or named; sensitive
 * records are counted but closed. AI-proposed links stay outside the groups.
 * A linked record counts only while its capture and current revision are its own.
 * `outgoingRelationIds`, when given, is the record page's already fenced set of this
 * record's own confirmed links (D1PresentationRepository): an outgoing link outside
 * it is not shown, so both parts of the page agree on one final check.
 */
export async function readConnectionGroups(
  db: D1DatabaseBinding,
  userId: string,
  objectId: string,
  options: Readonly<{ itemsPerGroup?: number; expandedGroup?: string | null; outgoingRelationIds?: ReadonlySet<string> | null }> = {},
): Promise<ConnectionGroups | null> {
  const [subjectVisibility, targetVisibility] = await Promise.all([
    legacyProjectionVisibilityPredicate(db, "subject"), legacyProjectionVisibilityPredicate(db, "target"),
  ]);
  const focus = await db.prepare(
    `select subject.object_kind,doc.privacy_level from v2_objects subject left join v2_documents doc on doc.object_id=subject.id
     where subject.id=? and subject.user_id=? and subject.lifecycle_status='active' and ${subjectVisibility} limit 1`,
  ).bind(objectId, userId).first<{ object_kind: string; privacy_level: string | null }>();
  if (!focus || focus.privacy_level === "restricted") return null;

  const rows = await db.prepare(
    `with edges as (
       select r.id as relation_id,r.review_status,r.source_class,p.label as predicate_label,
              case when r.subject_object_id=?1 then r.object_object_id else r.subject_object_id end as other_id,
              case when r.subject_object_id=?1 then 'outgoing' else 'incoming' end as direction
       from v2_relation_edges r join v2_predicate_definitions p on p.id=r.predicate_definition_id and p.user_id=r.user_id
       where r.user_id=?2 and (r.subject_object_id=?1 or r.object_object_id=?1) and r.subject_object_id<>r.object_object_id
         and r.superseded_at is null and r.review_status in ('accepted','proposed')
     )
     select e.relation_id,e.review_status,e.source_class,e.predicate_label,e.direction,target.id as other_id,target.object_kind,
            doc.title,doc.privacy_level,case when ${undatedImportSql("doc", "cap")} then null else coalesce(doc.written_at,cap.captured_at) end as doc_date,
            ent.entity_kind,ent.canonical_name,ev.event_type_key,ev.occurred_at_start,
            (select json_object('key',t.key,'label',t.label) from v2_object_type_assignments a
               join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id
               where a.object_id=target.id and a.user_id=target.user_id and a.review_status='accepted' and t.status not in ('archived','merged')
               order by case a.role when 'primary' then 0 when 'secondary' then 1 else 2 end,a.created_at,t.key limit 1) as primary_type
     from edges e
     join v2_objects target on target.id=e.other_id and target.user_id=?2 and target.lifecycle_status='active'
     left join v2_documents doc on doc.object_id=target.id
     left join v2_capture_bundles cap on cap.id=doc.capture_id and cap.user_id=target.user_id
     left join v2_entity_records ent on ent.object_id=target.id
     left join v2_event_records ev on ev.object_id=target.id
     where ${targetVisibility}
       and (target.object_kind<>'document' or (doc.privacy_level in ('normal','sensitive')
         and exists (select 1 from v2_document_revisions revision where revision.id=doc.current_revision_id and revision.document_object_id=target.id)
         and cap.id is not null))
     limit ?3`,
  ).bind(objectId, userId, MAX_EDGES).all<EdgeRow>();

  const pending = new Set<string>();
  const groups = new Map<string, { label: string; relationLabels: string[]; items: Map<string, ConnectionGroupItem>; sensitive: Set<string> }>();
  for (const row of rows.results) {
    if (row.review_status !== "accepted") { pending.add(row.other_id); continue; }
    if (options.outgoingRelationIds && row.direction === "outgoing" && !options.outgoingRelationIds.has(row.relation_id)) continue;
    const { key, label } = category(row);
    const group = groups.get(key) ?? { label, relationLabels: [], items: new Map(), sensitive: new Set<string>() };
    groups.set(key, group);
    group.relationLabels = union(group.relationLabels, row.predicate_label);
    if (row.privacy_level === "sensitive") { group.sensitive.add(row.other_id); continue; }
    const current = group.items.get(row.other_id);
    group.items.set(row.other_id, {
      objectId: row.other_id,
      objectKind: row.object_kind,
      label: row.title ?? row.canonical_name ?? row.event_type_key ?? "연결된 대상",
      date: row.doc_date ?? row.occurred_at_start ?? null,
      relationLabels: union(current?.relationLabels ?? [], row.predicate_label),
      directions: union(current?.directions ?? [], row.direction),
      origins: union(current?.origins ?? [], origin(row.source_class)),
    });
  }
  // A link that is both confirmed and still proposed is confirmed.
  for (const group of groups.values()) for (const id of [...group.items.keys(), ...group.sensitive]) pending.delete(id);

  const limit = Math.max(1, Math.min(options.itemsPerGroup ?? DEFAULT_ITEMS_PER_GROUP, 50));
  const projected = [...groups.entries()].map(([groupKey, group]) => {
    const items = [...group.items.values()].sort((left, right) => (right.date ?? "").localeCompare(left.date ?? "") || left.label.localeCompare(right.label, "ko"));
    return {
      groupKey, label: group.label, count: items.length + group.sensitive.size, relationLabels: group.relationLabels,
      items: items.slice(0, groupKey === options.expandedGroup ? EXPANDED_ITEMS : limit), closedSensitiveCount: group.sensitive.size,
    } satisfies ConnectionGroup;
  }).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ko"));
  return {
    contractVersion: CONNECTION_GROUPS_CONTRACT,
    total: projected.reduce((sum, group) => sum + group.count, 0),
    summary: projected.map((group) => ({ groupKey: group.groupKey, label: group.label, count: group.count })),
    groups: projected,
    pendingCount: pending.size,
  };
}
