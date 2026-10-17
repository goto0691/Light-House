import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";

export const CONNECTION_GROUPS_CONTRACT = "connection-groups-v1";
const DEFAULT_ITEMS_PER_GROUP = 5;
const MAX_EDGES = 5000;
const UNCLASSIFIED = Object.freeze({ key: "unclassified", label: "분류 전" });
const ENTITY_KIND_LABELS: Readonly<Record<string, string>> = { person: "사람", work: "작품", place: "장소", organization: "단체", book: "책", game: "게임", platform: "플랫폼" };

export type ConnectionOrigin = "imported" | "user" | "ai" | "external";
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
  review_status: "accepted" | "proposed"; source_class: string; predicate_label: string; direction: "outgoing" | "incoming";
  other_id: string; object_kind: "document" | "entity" | "event";
  title: string | null; privacy_level: "normal" | "sensitive" | null; doc_date: string | null;
  entity_kind: string | null; canonical_name: string | null; event_type_key: string | null; occurred_at_start: string | null;
  primary_type: string | null;
};

function origin(sourceClass: string): ConnectionOrigin {
  if (sourceClass === "imported") return "imported";
  if (sourceClass === "user_explicit") return "user";
  if (sourceClass === "external_grounded") return "external";
  return "ai";
}

function category(row: EdgeRow) {
  if (row.object_kind === "entity") {
    const kind = row.entity_kind ?? "entity";
    return { key: `entity:${kind}`, label: ENTITY_KIND_LABELS[kind] ?? kind };
  }
  if (row.object_kind === "event") return { key: `event:${row.event_type_key ?? "event"}`, label: row.event_type_key ?? "사건" };
  try {
    const type = row.primary_type ? JSON.parse(row.primary_type) as { key?: unknown; label?: unknown } : null;
    if (type && typeof type.key === "string" && typeof type.label === "string") return { key: `type:${type.key}`, label: type.label };
  } catch { /* An unreadable type label falls back to the unclassified group. */ }
  return { key: `type:${UNCLASSIFIED.key}`, label: UNCLASSIFIED.label };
}

function union<T>(values: readonly T[], value: T): T[] { return values.includes(value) ? [...values] : [...values, value]; }

/**
 * Connections of one record or entity, grouped by the category of the other side
 * (its accepted primary type, or entity kind) instead of one flat list. Both link
 * directions count. Restricted records are never counted or named; sensitive
 * records are counted but closed. AI-proposed links stay outside the groups.
 */
export async function readConnectionGroups(
  db: D1DatabaseBinding,
  userId: string,
  objectId: string,
  options: Readonly<{ itemsPerGroup?: number }> = {},
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
       select r.review_status,r.source_class,p.label as predicate_label,
              case when r.subject_object_id=?1 then r.object_object_id else r.subject_object_id end as other_id,
              case when r.subject_object_id=?1 then 'outgoing' else 'incoming' end as direction
       from v2_relation_edges r join v2_predicate_definitions p on p.id=r.predicate_definition_id and p.user_id=r.user_id
       where r.user_id=?2 and (r.subject_object_id=?1 or r.object_object_id=?1) and r.subject_object_id<>r.object_object_id
         and r.superseded_at is null and r.review_status in ('accepted','proposed')
     )
     select e.review_status,e.source_class,e.predicate_label,e.direction,target.id as other_id,target.object_kind,
            doc.title,doc.privacy_level,coalesce(doc.written_at,cap.captured_at) as doc_date,
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
       and (target.object_kind<>'document' or doc.privacy_level in ('normal','sensitive'))
     limit ?3`,
  ).bind(objectId, userId, MAX_EDGES).all<EdgeRow>();

  const pending = new Set<string>();
  const groups = new Map<string, { label: string; relationLabels: string[]; items: Map<string, ConnectionGroupItem>; sensitive: Set<string> }>();
  for (const row of rows.results) {
    if (row.review_status !== "accepted") { pending.add(row.other_id); continue; }
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
      items: items.slice(0, limit), closedSensitiveCount: group.sensitive.size,
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
