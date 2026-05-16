import "server-only";

import { ulid } from "ulidx";

import type {
  ContextBundle,
  ContextEdge,
  ContextEdgeEvidence,
  ContextLensKey,
  ContextNode,
  ContextSearchResult,
  EntityType,
  RelationKind,
  SourceTraceDocument,
  SourceTraceProperty,
  SourceTraceRelation,
  SourceTraceReviewItem,
} from "@/lib/context/types";
import { getPersonSummaryText } from "@/lib/display/person";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";
import { getSearchReadModelItems, searchWithFTS } from "@/lib/server/search";
import { seedSemanticZettelIndex, semanticSearchZettels } from "@/lib/server/vectorize";

type SourceDocumentRow = {
  id: string;
  sourceDatabase: string | null;
  sourceId: string;
  title: string;
  documentRole: string | null;
  status: string;
  preview: string | null;
};

type SourceRelationRow = {
  id: string;
  sourceDocumentId: string;
  relationName: string;
  targetSourceId: string | null;
  targetTitle: string | null;
  resolvedEntityType: EntityType | null;
  resolvedEntityId: string | null;
  confidence: number | null;
};

type ReviewRow = {
  id: string;
  entityType: EntityType;
  entityId: string | null;
  issueType: string;
  suggestedAction: string;
  confidence: number | null;
  reason: string | null;
};

type SourceTraceDocumentRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  importBatchId: string | null;
  sourceDatabase: string | null;
  title: string;
  documentRole: string | null;
  canonicalEntityType: EntityType | null;
  canonicalEntityId: string | null;
  status: string;
  url: string | null;
  rawContentPreview: string | null;
  resolvedAt: string | null;
  updatedAt: string | null;
};

type SourceTracePropertyRow = {
  id: string;
  sourceDocumentId: string;
  propertyKey: string;
  propertyName: string;
  propertyType: string | null;
  valueText: string | null;
  valueJson: string | null;
  normalizedValue: string | null;
};

const CONTEXT_SEARCH_ENTITY_TYPES = new Set<EntityType>(["person", "task", "zettel", "media", "place", "tag"]);

type SourceTraceRelationRow = {
  id: string;
  sourceDocumentId: string;
  relationName: string;
  targetSourceId: string | null;
  targetTitle: string | null;
  resolvedEntityType: EntityType | null;
  resolvedEntityId: string | null;
  confidence: number | null;
  createdAt: string | null;
};

type SourceTraceReviewRow = {
  id: string;
  sourceDocumentId: string;
  entityType: EntityType;
  entityId: string | null;
  issueType: string;
  suggestedAction: string;
  confidence: number | null;
  status: string;
  reason: string | null;
  resolvedAt: string | null;
  updatedAt: string | null;
};

type PersonIdentityRow = {
  id: string;
  name: string;
  groups: string | null;
  birthDate: string | null;
};

type EdgeInput = {
  focusType: EntityType;
  focusId: string;
  targetType: EntityType;
  targetId: string;
  label?: string;
};

type ResolveSourceRelationInput = {
  sourceRelationId: string;
  targetType: EntityType;
  targetId: string;
  label?: string;
};

type ContextBundleOptions = {
  cursor?: string;
  depth?: number;
  include?: RelationKind[];
  lens?: ContextLensKey;
  limit?: number;
};

type CreateCanonicalEntityInput = {
  focusType: EntityType;
  focusId: string;
  label?: string;
  sourceRelationId?: string;
  targetType: EntityType;
  title: string;
};

type SourceRelationDetailRow = SourceRelationRow & {
  focusType: EntityType | null;
  focusId: string | null;
  focusTitle: string | null;
};

type BridgeRow = {
  tableName: string;
  relationId: string | null;
  fromType: EntityType;
  fromId: string;
  fromTitle: string;
  fromSubtitle: string | null;
  fromPreview: string | null;
  toType: EntityType;
  toId: string;
  toTitle: string;
  toSubtitle: string | null;
  toPreview: string | null;
  label: string;
  createdAt: string | null;
};

type ContextTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  content: string | null;
  projectId: string | null;
  projectTitle: string | null;
  projectCategory: string | null;
  projectDescription: string | null;
};

type ContextProjectRow = {
  id: string;
  title: string;
  status: string;
  category: string | null;
  description: string | null;
  updatedAt: string | null;
};

type ContextProjectTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  content: string | null;
};

type ContextPersonRow = {
  id: string;
  name: string;
  groups: string | null;
  bio: string | null;
  sourceDocumentId: string | null;
};

type ContextDailyEntryRow = {
  id: string;
  date: string;
  title: string;
};

type ContextZettelRow = {
  id: string;
  title: string;
  category: string | null;
  summary: string | null;
  sourceDocumentId: string | null;
};

type ContextZettelOutgoingRow = {
  id: string;
  targetId: string;
  targetTitle: string;
};

type ContextZettelBacklinkRow = {
  sourceId: string;
  sourceTitle: string;
};

type ContextMediaRow = {
  id: string;
  mediaType: string;
  title: string;
  status: string;
  review: string | null;
  sourceDocumentId: string | null;
};

type ContextPlaceRow = {
  id: string;
  category: string | null;
  name: string;
  address: string | null;
  review: string | null;
  sourceDocumentId: string | null;
};

type ContextWorkoutRow = {
  id: string;
  title: string | null;
  date: string;
  categories: string;
  durationMinutes: number | null;
  intensity: number | null;
  notes: string | null;
};

type ContextCareerRow = {
  id: string;
  sourceDocumentId: string | null;
  organization: string;
  role: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
};

type ContextDailyLogRow = {
  id: string;
  date: string;
  mood: number | null;
  energyLevel: number | null;
  journal: string | null;
  meditation: string | null;
  sourceDocumentId: string | null;
};

type ContextDailyTimelineRow = {
  date: string;
  time: string;
  label: string;
  type: string;
};

type ContextGiftRow = {
  id: string;
  direction: string;
  title: string;
  occurredAt: string;
  satisfaction: string | null;
  notes: string | null;
  personId: string | null;
  personName: string | null;
  personGroups: string | null;
  personBio: string | null;
  personSourceDocumentId: string | null;
};

type ContextSeed = {
  focus: ContextNode | null;
  nodes: ContextNode[];
  edges: ContextEdge[];
};

const EMPTY_GROUPS: ContextBundle["grouped"] = {
  people: [],
  projects: [],
  zettels: [],
  media: [],
  dates: [],
  places: [],
  source: [],
  unresolved: [],
};

const CONTEXT_LENSES: ContextLensKey[] = ["overview", "people", "projects", "zettels", "media", "dates", "places", "source", "unresolved"];
const DEFAULT_CONTEXT_LIMIT = 12;
const MAX_CONTEXT_LIMIT = 48;

function hrefFor(type: EntityType, id: string) {
  switch (type) {
    case "project":
      return `/action-hub/${id}`;
    case "task":
      return `/action-hub?detail=task:${id}`;
    case "person":
      return `/prm/${id}`;
    case "zettel":
      return `/vault/zettels/${id}`;
    case "media":
      return `/vault/media/${id}`;
    case "place":
      return `/vault/places/${id}`;
    case "gift":
      return `/prm/gifts/${id}`;
    case "workout":
      return `/life-ops/workouts/${id}`;
    case "career":
      return `/life-ops/career/${id}`;
    case "daily_log":
      return `/life-ops/${id}`;
    case "daily_entry":
      return `/life-ops/entries`;
    case "source_document":
      return `/settings/data?source=${id}`;
    case "tag":
      return `/vault?tag=${id}`;
    default:
      return "#";
  }
}

function node(type: EntityType, id: string, title: string, patch: Partial<ContextNode> = {}): ContextNode {
  const normalizedPatch =
    type === "person" && patch.preview ? { ...patch, preview: getPersonSummaryText({ bio: patch.preview }, { maxLength: 180 }) } : patch;

  return {
    type,
    id,
    title,
    href: hrefFor(type, id),
    ...normalizedPatch,
  };
}

function dailyLogSubtitle(mood: number, energy: number) {
  return `기분 ${mood} · 에너지 ${energy}`;
}

function edge(input: {
  from: ContextNode;
  to: ContextNode;
  label: string;
  kind?: ContextEdge["kind"];
  confidence?: number;
  evidence: ContextEdgeEvidence[];
  id?: string;
}): ContextEdge {
  return {
    id: input.id ?? `${input.from.type}:${input.from.id}->${input.to.type}:${input.to.id}:${input.label}`,
    from: { type: input.from.type, id: input.from.id },
    to: { type: input.to.type, id: input.to.id },
    label: input.label,
    kind: input.kind ?? "explicit",
    confidence: input.confidence ?? 1,
    evidence: input.evidence,
  };
}

function explicitEdgeId(tableName: string, from: ContextNode, to: ContextNode, relationId?: string | null) {
  return `explicit:${tableName}:${relationId ?? `${from.type}:${from.id}:${to.type}:${to.id}`}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

function uniqueNodes(nodes: ContextNode[]) {
  const map = new Map<string, ContextNode>();
  for (const item of nodes) {
    map.set(`${item.type}:${item.id}`, { ...map.get(`${item.type}:${item.id}`), ...item });
  }
  return [...map.values()];
}

function uniqueEdges(edges: ContextEdge[]) {
  const map = new Map<string, ContextEdge>();
  for (const item of edges) {
    const key = `${item.from.type}:${item.from.id}:${item.to.type}:${item.to.id}:${item.label}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    map.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence, item.confidence),
      evidence: [...existing.evidence, ...item.evidence],
      kind: existing.kind === "explicit" ? existing.kind : item.kind,
    });
  }
  return [...map.values()];
}

function applyContextQuery(focus: ContextNode, nodes: ContextNode[], edges: ContextEdge[], options: ContextBundleOptions) {
  const include = options.include?.length ? new Set(options.include) : null;
  const filteredEdges = include ? edges.filter((item) => include.has(item.kind)) : edges;
  const visibleKeys = new Set<string>([`${focus.type}:${focus.id}`]);
  for (const relation of filteredEdges) {
    visibleKeys.add(`${relation.from.type}:${relation.from.id}`);
    visibleKeys.add(`${relation.to.type}:${relation.to.id}`);
  }
  const filteredNodes = nodes.filter((item) => visibleKeys.has(`${item.type}:${item.id}`));
  return { edges: filteredEdges, nodes: filteredNodes };
}

function groupNodes(focus: ContextNode, nodes: ContextNode[], edges: ContextEdge[]): ContextBundle["grouped"] {
  const groups: ContextBundle["grouped"] = {
    people: nodes.filter((item) => item.type === "person"),
    projects: nodes.filter((item) => item.type === "project" || item.type === "task"),
    zettels: nodes.filter((item) => item.type === "zettel"),
    media: nodes.filter((item) => item.type === "media"),
    dates: nodes.filter((item) => item.type === "daily_log" || item.type === "workout" || item.type === "interaction" || item.type === "gift"),
    places: nodes.filter((item) => item.type === "place"),
    source: nodes.filter((item) => item.type === "source_document"),
    unresolved: nodes.filter((item) => item.tone === "warning"),
  };

  for (const relation of edges) {
    if (relation.kind === "source" && !relation.to.id.startsWith("unresolved:")) continue;
    if (relation.kind === "source") {
      const unresolved = nodes.find((item) => item.type === relation.to.type && item.id === relation.to.id);
      if (unresolved && !groups.unresolved.some((item) => item.id === unresolved.id && item.type === unresolved.type)) {
        groups.unresolved.push(unresolved);
      }
    }
  }

  return {
    people: groups.people.filter((item) => item.id !== focus.id),
    projects: groups.projects.filter((item) => item.id !== focus.id),
    zettels: groups.zettels.filter((item) => item.id !== focus.id),
    media: groups.media.filter((item) => item.id !== focus.id),
    dates: groups.dates.filter((item) => item.id !== focus.id),
    places: groups.places.filter((item) => item.id !== focus.id),
    source: groups.source.filter((item) => item.id !== focus.id),
    unresolved: groups.unresolved.filter((item) => item.id !== focus.id),
  };
}

function timelineDate(item: ContextNode) {
  return item.subtitle?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? item.preview?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? item.id.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function buildTimeline(nodes: ContextNode[], edges: ContextEdge[]): ContextBundle["timeline"] {
  return nodes
    .filter((item) => item.type === "daily_log" || item.type === "workout" || item.type === "interaction" || item.type === "gift" || Boolean(timelineDate(item)))
    .slice(0, 18)
    .map((item) => ({
      date: timelineDate(item) ?? item.id.slice(0, 10),
      nodes: [item],
      edges: edges.filter((relation) => relation.to.id === item.id || relation.from.id === item.id),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function lensNodes(grouped: ContextBundle["grouped"], lens: ContextLensKey) {
  if (lens === "overview") {
    return [...grouped.people, ...grouped.zettels, ...grouped.media, ...grouped.projects, ...grouped.dates];
  }
  return grouped[lens] ?? [];
}

function paginateContext(grouped: ContextBundle["grouped"], options: ContextBundleOptions) {
  const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_CONTEXT_LIMIT), 1), MAX_CONTEXT_LIMIT);
  const requestedLens = options.lens && CONTEXT_LENSES.includes(options.lens) ? options.lens : undefined;
  const requestedCursor = Math.max(Number.parseInt(options.cursor ?? "0", 10) || 0, 0);
  const pages: NonNullable<ContextBundle["pages"]> = {};
  const pagination: NonNullable<ContextBundle["pagination"]> = {};
  const pagedGrouped: ContextBundle["grouped"] = { ...EMPTY_GROUPS };

  for (const lens of CONTEXT_LENSES) {
    const cursor = requestedLens && requestedLens === lens ? requestedCursor : 0;
    const all = lensNodes(grouped, lens);
    const page = all.slice(cursor, cursor + limit);
    pages[lens] = page;
    pagination[lens] = {
      cursor: String(cursor),
      hasMore: cursor + limit < all.length,
      limit,
      nextCursor: cursor + limit < all.length ? String(cursor + limit) : undefined,
      total: all.length,
    };
    if (lens !== "overview") {
      pagedGrouped[lens] = page;
    }
  }

  return { pages, pagedGrouped, pagination };
}

async function getSourceDocuments(userId: string, type: EntityType, id: string) {
  try {
    const ownedDocuments = await queryD1<SourceDocumentRow>(
      `select id, source_database as sourceDatabase, source_id as sourceId, title, document_role as documentRole, status, raw_content_preview as preview
       from source_documents
       where user_id = ?
         and canonical_entity_type = ?
         and canonical_entity_id = ?
         and deleted_at is null
       order by updated_at desc`,
      [userId, type, id],
    );

    const ownedRelations = await queryD1<SourceRelationRow>(
      `select sdr.id, sdr.source_document_id as sourceDocumentId, sdr.relation_name as relationName, sdr.target_source_id as targetSourceId,
              sdr.target_title as targetTitle, sdr.resolved_entity_type as resolvedEntityType, sdr.resolved_entity_id as resolvedEntityId, sdr.confidence
       from source_document_relations sdr
       inner join source_documents sd on sd.id = sdr.source_document_id
       where sd.user_id = ?
         and sd.canonical_entity_type = ?
         and sd.canonical_entity_id = ?
         and sd.deleted_at is null`,
      [userId, type, id],
    );

    const inboundRelations = await queryD1<SourceRelationRow>(
      `select sdr.id, sdr.source_document_id as sourceDocumentId, sdr.relation_name as relationName, sdr.target_source_id as targetSourceId,
              coalesce(sdr.target_title, sd.title) as targetTitle, sdr.resolved_entity_type as resolvedEntityType,
              sdr.resolved_entity_id as resolvedEntityId, sdr.confidence
       from source_document_relations sdr
       inner join source_documents sd on sd.id = sdr.source_document_id
       where sd.user_id = ?
         and sd.deleted_at is null
         and sdr.resolved_entity_type = ?
         and sdr.resolved_entity_id = ?
         and not (sd.canonical_entity_type = ? and sd.canonical_entity_id = ?)`,
      [userId, type, id, type, id],
    );

    const inboundDocuments = inboundRelations.rows.length
      ? await queryD1<SourceDocumentRow>(
          `select distinct sd.id, sd.source_database as sourceDatabase, sd.source_id as sourceId, sd.title,
                  sd.document_role as documentRole, sd.status, sd.raw_content_preview as preview
           from source_document_relations sdr
           inner join source_documents sd on sd.id = sdr.source_document_id
           where sd.user_id = ?
             and sd.deleted_at is null
             and sdr.resolved_entity_type = ?
             and sdr.resolved_entity_id = ?`,
          [userId, type, id],
        )
      : { rows: [] as SourceDocumentRow[] };

    return {
      documents: [...ownedDocuments.rows, ...inboundDocuments.rows],
      relations: [...ownedRelations.rows, ...inboundRelations.rows],
    };
  } catch {
    return { documents: [] as SourceDocumentRow[], relations: [] as SourceRelationRow[] };
  }
}

function defined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function sourceTraceDocument(row: SourceTraceDocumentRow): SourceTraceDocument {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    importBatchId: defined(row.importBatchId),
    sourceDatabase: defined(row.sourceDatabase),
    title: row.title,
    documentRole: defined(row.documentRole),
    canonicalEntityType: defined(row.canonicalEntityType),
    canonicalEntityId: defined(row.canonicalEntityId),
    status: row.status,
    url: defined(row.url),
    rawContentPreview: defined(row.rawContentPreview),
    resolvedAt: defined(row.resolvedAt),
    updatedAt: defined(row.updatedAt),
    properties: [],
    relations: [],
    reviewItems: [],
  };
}

export async function getSourceTraceDocuments(input: {
  sourceDocumentIds?: string[];
  focusType?: EntityType;
  focusId?: string;
}): Promise<SourceTraceDocument[]> {
  const user = await resolveCurrentUser();
  const ids = [...new Set(input.sourceDocumentIds?.map((id) => id.trim()).filter(Boolean) ?? [])].filter(
    (id) => !id.startsWith("unresolved:") && !id.startsWith("review:"),
  );

  const documentResult = ids.length
    ? await queryD1<SourceTraceDocumentRow>(
        `select id, source_type as sourceType, source_id as sourceId, import_batch_id as importBatchId,
                source_database as sourceDatabase, title, document_role as documentRole,
                canonical_entity_type as canonicalEntityType, canonical_entity_id as canonicalEntityId,
                status, url, raw_content_preview as rawContentPreview, resolved_at as resolvedAt, updated_at as updatedAt
         from source_documents
         where user_id = ?
           and deleted_at is null
           and id in (${ids.map(() => "?").join(",")})
         order by updated_at desc`,
        [user.id, ...ids],
      )
    : input.focusType && input.focusId
      ? await queryD1<SourceTraceDocumentRow>(
          `select id, source_type as sourceType, source_id as sourceId, import_batch_id as importBatchId,
                  source_database as sourceDatabase, title, document_role as documentRole,
                  canonical_entity_type as canonicalEntityType, canonical_entity_id as canonicalEntityId,
                  status, url, raw_content_preview as rawContentPreview, resolved_at as resolvedAt, updated_at as updatedAt
           from source_documents
           where user_id = ?
             and deleted_at is null
             and canonical_entity_type = ?
             and canonical_entity_id = ?
           order by updated_at desc`,
          [user.id, input.focusType, input.focusId],
        )
      : { rows: [] as SourceTraceDocumentRow[] };

  const documents = documentResult.rows.map(sourceTraceDocument);
  if (!documents.length) return [];

  const documentIds = documents.map((document) => document.id);
  const placeholders = documentIds.map(() => "?").join(",");
  const [propertiesResult, relationsResult, reviewResult] = await Promise.all([
    queryD1<SourceTracePropertyRow>(
      `select id, source_document_id as sourceDocumentId, property_key as propertyKey, property_name as propertyName,
              property_type as propertyType, value_text as valueText, value_json as valueJson, normalized_value as normalizedValue
       from source_document_properties
       where source_document_id in (${placeholders})
       order by property_name asc, property_key asc`,
      documentIds,
    ),
    queryD1<SourceTraceRelationRow>(
      `select id, source_document_id as sourceDocumentId, relation_name as relationName, target_source_id as targetSourceId,
              target_title as targetTitle, resolved_entity_type as resolvedEntityType, resolved_entity_id as resolvedEntityId,
              confidence, created_at as createdAt
       from source_document_relations
       where source_document_id in (${placeholders})
       order by relation_name asc, created_at desc`,
      documentIds,
    ),
    queryD1<SourceTraceReviewRow>(
      `select id, source_document_id as sourceDocumentId, entity_type as entityType, entity_id as entityId,
              issue_type as issueType, suggested_action as suggestedAction, confidence, status, reason,
              resolved_at as resolvedAt, updated_at as updatedAt
       from migration_review_items
       where user_id = ?
         and deleted_at is null
         and source_document_id in (${placeholders})
       order by case status when 'open' then 0 when 'applied' then 1 when 'dismissed' then 2 else 3 end, updated_at desc`,
      [user.id, ...documentIds],
    ),
  ]);

  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const row of propertiesResult.rows) {
    byId.get(row.sourceDocumentId)?.properties.push({
      id: row.id,
      propertyKey: row.propertyKey,
      propertyName: row.propertyName,
      propertyType: defined(row.propertyType),
      valueText: defined(row.valueText),
      valueJson: defined(row.valueJson),
      normalizedValue: defined(row.normalizedValue),
    } satisfies SourceTraceProperty);
  }
  for (const row of relationsResult.rows) {
    byId.get(row.sourceDocumentId)?.relations.push({
      id: row.id,
      relationName: row.relationName,
      targetSourceId: defined(row.targetSourceId),
      targetTitle: defined(row.targetTitle),
      resolvedEntityType: defined(row.resolvedEntityType),
      resolvedEntityId: defined(row.resolvedEntityId),
      confidence: defined(row.confidence),
      createdAt: defined(row.createdAt),
    } satisfies SourceTraceRelation);
  }
  for (const row of reviewResult.rows) {
    byId.get(row.sourceDocumentId)?.reviewItems.push({
      id: row.id,
      entityType: row.entityType,
      entityId: defined(row.entityId),
      issueType: row.issueType,
      suggestedAction: row.suggestedAction,
      confidence: defined(row.confidence),
      status: row.status,
      reason: defined(row.reason),
      resolvedAt: defined(row.resolvedAt),
      updatedAt: defined(row.updatedAt),
    } satisfies SourceTraceReviewItem);
  }

  return documents;
}

function bridgeNode(type: EntityType, id: string, title: string, subtitle: string | null, preview: string | null): ContextNode {
  return node(type, id, title, {
    subtitle: subtitle ?? undefined,
    preview: preview ?? undefined,
    tone: type === "person" ? "info" : type === "place" ? "success" : type === "media" ? "info" : "gold",
  });
}

function appendBridgeRows(focus: ContextNode, rows: BridgeRow[], nodes: ContextNode[], edges: ContextEdge[]) {
  for (const row of rows) {
    const from = row.fromType === focus.type && row.fromId === focus.id ? focus : bridgeNode(row.fromType, row.fromId, row.fromTitle, row.fromSubtitle, row.fromPreview);
    const to = row.toType === focus.type && row.toId === focus.id ? focus : bridgeNode(row.toType, row.toId, row.toTitle, row.toSubtitle, row.toPreview);
    if (!(from.type === focus.type && from.id === focus.id)) nodes.push(from);
    if (!(to.type === focus.type && to.id === focus.id)) nodes.push(to);
    edges.push(edge({
      from,
      to,
      label: row.label,
      kind: "explicit",
      confidence: 1,
      id: explicitEdgeId(row.tableName, from, to, row.relationId),
      evidence: [{ source: "table", table: row.tableName, snippet: row.createdAt ?? undefined }],
    }));
  }
}

async function getExplicitBridgeRows(userId: string, type: EntityType, id: string): Promise<BridgeRow[]> {
  const rows: BridgeRow[] = [];

  async function collect(sql: string, params: unknown[]) {
    try {
      const result = await queryD1<BridgeRow>(sql, params);
      rows.push(...result.rows);
    } catch {
      // Some imported workspaces may not have every optional relation table yet.
    }
  }

  if (type === "task") {
    await collect(
      `select 'task_people_relations' as tableName, null as relationId,
              'task' as fromType, t.id as fromId, t.title as fromTitle, t.status as fromSubtitle, t.content as fromPreview,
              'person' as toType, p.id as toId, p.name as toTitle, p.groups as toSubtitle, p.bio as toPreview,
              coalesce(tpr.role_context, 'linked person') as label, tpr.created_at as createdAt
       from task_people_relations tpr
       inner join tasks t on t.id = tpr.task_id
       inner join people p on p.id = tpr.person_id
       where t.user_id = ? and t.deleted_at is null and p.deleted_at is null and tpr.task_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'task_zettel_relations' as tableName, null as relationId,
              'task' as fromType, t.id as fromId, t.title as fromTitle, t.status as fromSubtitle, t.content as fromPreview,
              'zettel' as toType, z.id as toId, z.title as toTitle, z.category as toSubtitle, z.summary as toPreview,
              'linked note' as label, tzr.created_at as createdAt
       from task_zettel_relations tzr
       inner join tasks t on t.id = tzr.task_id
       inner join zettels z on z.id = tzr.zettel_id
       where t.user_id = ? and t.deleted_at is null and z.deleted_at is null and tzr.task_id = ?`,
      [userId, id],
    );
  }

  if (type === "person") {
    await collect(
      `select 'task_people_relations' as tableName, null as relationId,
              'person' as fromType, p.id as fromId, p.name as fromTitle, p.groups as fromSubtitle, p.bio as fromPreview,
              'task' as toType, t.id as toId, t.title as toTitle, t.status as toSubtitle, t.content as toPreview,
              coalesce(tpr.role_context, 'task') as label, tpr.created_at as createdAt
       from task_people_relations tpr
       inner join people p on p.id = tpr.person_id
       inner join tasks t on t.id = tpr.task_id
       where p.user_id = ? and p.deleted_at is null and t.deleted_at is null and tpr.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'zettel_people_relations' as tableName, null as relationId,
              'person' as fromType, p.id as fromId, p.name as fromTitle, p.groups as fromSubtitle, p.bio as fromPreview,
              'zettel' as toType, z.id as toId, z.title as toTitle, z.category as toSubtitle, z.summary as toPreview,
              coalesce(zpr.context, 'note') as label, zpr.created_at as createdAt
       from zettel_people_relations zpr
       inner join people p on p.id = zpr.person_id
       inner join zettels z on z.id = zpr.zettel_id
       where p.user_id = ? and p.deleted_at is null and z.deleted_at is null and zpr.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'media_people_relations' as tableName, null as relationId,
              'person' as fromType, p.id as fromId, p.name as fromTitle, p.groups as fromSubtitle, p.bio as fromPreview,
              'media' as toType, m.id as toId, m.title as toTitle, m.media_type || ' · ' || m.status as toSubtitle, m.review as toPreview,
              coalesce(mpr.context, 'media') as label, mpr.created_at as createdAt
       from media_people_relations mpr
       inner join people p on p.id = mpr.person_id
       inner join media_logs m on m.id = mpr.media_id
       where p.user_id = ? and p.deleted_at is null and m.deleted_at is null and mpr.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'daily_log_people_relations' as tableName, null as relationId,
              'person' as fromType, p.id as fromId, p.name as fromTitle, p.groups as fromSubtitle, p.bio as fromPreview,
              'daily_log' as toType, d.date as toId, d.date as toTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as toSubtitle, d.journal as toPreview,
              coalesce(dlpr.context, 'daily log') as label, dlpr.created_at as createdAt
       from daily_log_people_relations dlpr
       inner join people p on p.id = dlpr.person_id
       inner join daily_logs d on d.id = dlpr.daily_log_id
       where p.user_id = ? and p.deleted_at is null and d.deleted_at is null and dlpr.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'gifts' as tableName, g.id as relationId,
              'person' as fromType, p.id as fromId, p.name as fromTitle, p.groups as fromSubtitle, p.bio as fromPreview,
              'gift' as toType, g.id as toId, g.title as toTitle, g.direction || ' · ' || g.occurred_at as toSubtitle, coalesce(g.notes, g.reason) as toPreview,
              'gift' as label, g.created_at as createdAt
       from gifts g
       inner join people p on p.id = g.person_id
       where g.user_id = ? and g.deleted_at is null and g.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'interactions' as tableName, i.id as relationId,
              'person' as fromType, p.id as fromId, p.name as fromTitle, p.groups as fromSubtitle, p.bio as fromPreview,
              'interaction' as toType, i.id as toId, coalesce(i.summary, i.type) as toTitle, i.occurred_at as toSubtitle, i.content as toPreview,
              i.type as label, i.created_at as createdAt
       from interactions i
       inner join people p on p.id = i.person_id
       where i.user_id = ? and i.deleted_at is null and i.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'interactions' as tableName, i.id as relationId,
              'interaction' as fromType, i.id as fromId, coalesce(i.summary, i.type) as fromTitle, i.occurred_at as fromSubtitle, i.content as fromPreview,
              'place' as toType, pl.id as toId, pl.name as toTitle, pl.category as toSubtitle, pl.notes as toPreview,
              'place' as label, i.created_at as createdAt
       from interactions i
       inner join places pl on pl.id = i.place_id
       where i.user_id = ? and i.deleted_at is null and pl.deleted_at is null and i.person_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'network_edges' as tableName, ne.id as relationId,
              'person' as fromType, p1.id as fromId, p1.name as fromTitle, p1.groups as fromSubtitle, p1.bio as fromPreview,
              'person' as toType, p2.id as toId, p2.name as toTitle, p2.groups as toSubtitle, p2.bio as toPreview,
              coalesce(ne.relation_type, 'network') as label, ne.created_at as createdAt
       from network_edges ne
       inner join people p1 on p1.id = ne.source_person_id
       inner join people p2 on p2.id = ne.target_person_id
       where ne.user_id = ? and ne.deleted_at is null and (ne.source_person_id = ? or ne.target_person_id = ?)`,
      [userId, id, id],
    );
  }

  if (type === "zettel") {
    await collect(
      `select 'zettel_links' as tableName, zl.id as relationId,
              'zettel' as fromType, zs.id as fromId, zs.title as fromTitle, zs.category as fromSubtitle, zs.summary as fromPreview,
              'zettel' as toType, zt.id as toId, zt.title as toTitle, zt.category as toSubtitle, zt.summary as toPreview,
              coalesce(zl.context, 'link') as label, zl.created_at as createdAt
       from zettel_links zl
       inner join zettels zs on zs.id = zl.source_id
       inner join zettels zt on zt.id = zl.target_id
       where zs.user_id = ? and zs.deleted_at is null and zt.deleted_at is null and (zl.source_id = ? or zl.target_id = ?)`,
      [userId, id, id],
    );
    await collect(
      `select 'zettel_people_relations' as tableName, null as relationId,
              'zettel' as fromType, z.id as fromId, z.title as fromTitle, z.category as fromSubtitle, z.summary as fromPreview,
              'person' as toType, p.id as toId, p.name as toTitle, p.groups as toSubtitle, p.bio as toPreview,
              coalesce(zpr.context, 'person') as label, zpr.created_at as createdAt
       from zettel_people_relations zpr
       inner join zettels z on z.id = zpr.zettel_id
       inner join people p on p.id = zpr.person_id
       where z.user_id = ? and z.deleted_at is null and p.deleted_at is null and zpr.zettel_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'zettel_media_relations' as tableName, null as relationId,
              'zettel' as fromType, z.id as fromId, z.title as fromTitle, z.category as fromSubtitle, z.summary as fromPreview,
              'media' as toType, m.id as toId, m.title as toTitle, m.media_type || ' · ' || m.status as toSubtitle, m.review as toPreview,
              'media' as label, zmr.created_at as createdAt
       from zettel_media_relations zmr
       inner join zettels z on z.id = zmr.zettel_id
       inner join media_logs m on m.id = zmr.media_id
       where z.user_id = ? and z.deleted_at is null and m.deleted_at is null and zmr.zettel_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'task_zettel_relations' as tableName, null as relationId,
              'zettel' as fromType, z.id as fromId, z.title as fromTitle, z.category as fromSubtitle, z.summary as fromPreview,
              'task' as toType, t.id as toId, t.title as toTitle, t.status as toSubtitle, t.content as toPreview,
              'task note' as label, tzr.created_at as createdAt
       from task_zettel_relations tzr
       inner join zettels z on z.id = tzr.zettel_id
       inner join tasks t on t.id = tzr.task_id
       where z.user_id = ? and z.deleted_at is null and t.deleted_at is null and tzr.zettel_id = ?`,
      [userId, id],
    );
  }

  if (type === "media") {
    await collect(
      `select 'media_people_relations' as tableName, null as relationId,
              'media' as fromType, m.id as fromId, m.title as fromTitle, m.media_type || ' · ' || m.status as fromSubtitle, m.review as fromPreview,
              'person' as toType, p.id as toId, p.name as toTitle, p.groups as toSubtitle, p.bio as toPreview,
              coalesce(mpr.context, 'person') as label, mpr.created_at as createdAt
       from media_people_relations mpr
       inner join media_logs m on m.id = mpr.media_id
       inner join people p on p.id = mpr.person_id
       where m.user_id = ? and m.deleted_at is null and p.deleted_at is null and mpr.media_id = ?`,
      [userId, id],
    );
    await collect(
      `select 'zettel_media_relations' as tableName, null as relationId,
              'media' as fromType, m.id as fromId, m.title as fromTitle, m.media_type || ' · ' || m.status as fromSubtitle, m.review as fromPreview,
              'zettel' as toType, z.id as toId, z.title as toTitle, z.category as toSubtitle, z.summary as toPreview,
              'note' as label, zmr.created_at as createdAt
       from zettel_media_relations zmr
       inner join media_logs m on m.id = zmr.media_id
       inner join zettels z on z.id = zmr.zettel_id
       where m.user_id = ? and m.deleted_at is null and z.deleted_at is null and zmr.media_id = ?`,
      [userId, id],
    );
  }

  if (type === "daily_log") {
    await collect(
      `select 'daily_log_people_relations' as tableName, null as relationId,
              'daily_log' as fromType, d.date as fromId, d.date as fromTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as fromSubtitle, d.journal as fromPreview,
              'person' as toType, p.id as toId, p.name as toTitle, p.groups as toSubtitle, p.bio as toPreview,
              coalesce(dlpr.context, 'person') as label, dlpr.created_at as createdAt
       from daily_log_people_relations dlpr
       inner join daily_logs d on d.id = dlpr.daily_log_id
       inner join people p on p.id = dlpr.person_id
       where d.user_id = ? and d.deleted_at is null and p.deleted_at is null and d.date = ?`,
      [userId, id],
    );
    await collect(
      `select 'workouts' as tableName, w.id as relationId,
              'daily_log' as fromType, d.date as fromId, d.date as fromTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as fromSubtitle, d.journal as fromPreview,
              'workout' as toType, w.id as toId, w.categories as toTitle, w.date as toSubtitle, w.notes as toPreview,
              'workout' as label, w.created_at as createdAt
       from daily_logs d
       inner join workouts w on w.user_id = d.user_id and w.date = d.date and w.deleted_at is null
       where d.user_id = ? and d.deleted_at is null and d.date = ?`,
      [userId, id],
    );
    await collect(
      `select 'tasks' as tableName, t.id as relationId,
              'daily_log' as fromType, d.date as fromId, d.date as fromTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as fromSubtitle, d.journal as fromPreview,
              'task' as toType, t.id as toId, t.title as toTitle,
              coalesce(t.completed_at, t.due_at, t.updated_at, t.created_at) as toSubtitle,
              t.content as toPreview,
              case when t.completed_at = d.date then 'completed task' when t.due_at = d.date then 'due task' else 'updated task' end as label,
              coalesce(t.completed_at, t.updated_at, t.created_at) as createdAt
       from daily_logs d
       inner join tasks t on t.user_id = d.user_id
        and t.deleted_at is null
        and (
          date(t.completed_at) = d.date
          or date(t.due_at) = d.date
          or date(t.updated_at) = d.date
          or date(t.created_at) = d.date
        )
       where d.user_id = ? and d.deleted_at is null and d.date = ?
       order by coalesce(t.completed_at, t.updated_at, t.created_at) desc
       limit 12`,
      [userId, id],
    );
    await collect(
      `select 'interactions' as tableName, i.id as relationId,
              'daily_log' as fromType, d.date as fromId, d.date as fromTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as fromSubtitle, d.journal as fromPreview,
              'interaction' as toType, i.id as toId, coalesce(i.summary, i.type) as toTitle, i.occurred_at as toSubtitle, i.content as toPreview,
              i.type as label, i.created_at as createdAt
       from daily_logs d
       inner join interactions i on i.user_id = d.user_id and i.deleted_at is null and date(i.occurred_at) = d.date
       where d.user_id = ? and d.deleted_at is null and d.date = ?
       order by i.occurred_at desc
       limit 12`,
      [userId, id],
    );
    await collect(
      `select 'gifts' as tableName, g.id as relationId,
              'daily_log' as fromType, d.date as fromId, d.date as fromTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as fromSubtitle, d.journal as fromPreview,
              'gift' as toType, g.id as toId, g.title as toTitle, g.direction || ' · ' || g.occurred_at as toSubtitle, coalesce(g.notes, g.reason) as toPreview,
              'gift' as label, g.created_at as createdAt
       from daily_logs d
       inner join gifts g on g.user_id = d.user_id and g.deleted_at is null and date(g.occurred_at) = d.date
       where d.user_id = ? and d.deleted_at is null and d.date = ?
       order by g.occurred_at desc
       limit 12`,
      [userId, id],
    );
    await collect(
      `select 'zettels' as tableName, z.id as relationId,
              'daily_log' as fromType, d.date as fromId, d.date as fromTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as fromSubtitle, d.journal as fromPreview,
              'zettel' as toType, z.id as toId, z.title as toTitle, coalesce(z.updated_at, z.created_at) as toSubtitle, z.summary as toPreview,
              'note activity' as label, coalesce(z.updated_at, z.created_at) as createdAt
       from daily_logs d
       inner join zettels z on z.user_id = d.user_id
        and z.deleted_at is null
        and (date(z.created_at) = d.date or date(z.updated_at) = d.date)
       where d.user_id = ? and d.deleted_at is null and d.date = ?
       order by coalesce(z.updated_at, z.created_at) desc
       limit 12`,
      [userId, id],
    );
  }

  if (type === "workout") {
    await collect(
      `select 'workouts' as tableName, w.id as relationId,
              'workout' as fromType, w.id as fromId, w.categories as fromTitle, w.date as fromSubtitle, w.notes as fromPreview,
              'daily_log' as toType, d.date as toId, d.date as toTitle, '기분 ' || d.mood || ' · 에너지 ' || d.energy as toSubtitle, d.journal as toPreview,
              'daily anchor' as label, w.created_at as createdAt
       from workouts w
       inner join daily_logs d on d.user_id = w.user_id and d.date = w.date and d.deleted_at is null
       where w.user_id = ? and w.deleted_at is null and w.id = ?`,
      [userId, id],
    );
  }

  if (type === "gift") {
    await collect(
      `select 'gifts' as tableName, g.id as relationId,
              'gift' as fromType, g.id as fromId, g.title as fromTitle, g.direction || ' · ' || g.occurred_at as fromSubtitle, coalesce(g.notes, g.satisfaction) as fromPreview,
              'person' as toType, p.id as toId, p.name as toTitle, p.groups as toSubtitle, p.bio as toPreview,
              'recipient' as label, g.created_at as createdAt
       from gifts g
       inner join people p on p.id = g.person_id
       where g.user_id = ? and g.deleted_at is null and p.deleted_at is null and g.id = ?`,
      [userId, id],
    );
  }

  if (type === "place") {
    await collect(
      `select 'interactions' as tableName, i.id as relationId,
              'place' as fromType, pl.id as fromId, pl.name as fromTitle, pl.category as fromSubtitle, pl.notes as fromPreview,
              'person' as toType, p.id as toId, p.name as toTitle, p.groups as toSubtitle, p.bio as toPreview,
              i.type as label, i.created_at as createdAt
       from interactions i
       inner join places pl on pl.id = i.place_id
       inner join people p on p.id = i.person_id
       where pl.user_id = ? and i.deleted_at is null and pl.deleted_at is null and i.place_id = ?`,
      [userId, id],
    );
  }

  return rows;
}

async function getReviewItems(userId: string, type: EntityType, id: string) {
  try {
    const result = await queryD1<ReviewRow>(
      `select id, entity_type as entityType, entity_id as entityId, issue_type as issueType, suggested_action as suggestedAction, confidence, reason
       from migration_review_items
       where user_id = ?
         and status = 'open'
         and deleted_at is null
         and (entity_type = ? and (entity_id = ? or entity_id is null))
       order by confidence asc, created_at desc
       limit 12`,
      [userId, type, id],
    );
    return result.rows;
  } catch {
    return [];
  }
}

function parseJsonList(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

async function personIdentityLabels(userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return new Map<string, string>();
  const rows = await queryD1<PersonIdentityRow>(
    `select p.id, p.name, p.groups, p.birth_date as birthDate
     from people p
     where p.user_id = ?
       and p.deleted_at is null
       and p.id in (${uniqueIds.map(() => "?").join(",")})`,
    [userId, ...uniqueIds],
  );
  const nameCounts = new Map<string, number>();
  for (const row of rows.rows) {
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }
  return new Map(
    rows.rows.map((row) => {
      const groups = parseJsonList(row.groups).slice(0, 2).join(" · ");
      const parts = [row.birthDate ? `생일 ${row.birthDate}` : null, groups || null].filter(Boolean);
      const label = nameCounts.get(row.name)! > 1 ? parts.join(" · ") || "동명 인물" : parts.slice(0, 2).join(" · ");
      return [row.id, label || "인물 정보 정리 중"];
    }),
  );
}

async function getProjectContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const [projectResult, taskResult] = await Promise.all([
    queryD1<ContextProjectRow>(
      `select
         id,
         title,
         status,
         category,
         description,
         updated_at as updatedAt
       from projects
       where user_id = ?
         and id = ?
         and deleted_at is null
       limit 1`,
      [userId, id],
    ),
    queryD1<ContextProjectTaskRow>(
      `select
         id,
         title,
         status,
         priority,
         content
       from tasks
       where user_id = ?
         and project_id = ?
         and deleted_at is null
       order by display_order asc, created_at asc`,
      [userId, id],
    ),
  ]);
  const project = projectResult.rows[0];
  if (!project) return { focus: null, nodes: [], edges: [] };

  const focus = node("project", project.id, project.title, {
    subtitle: `${project.category ?? "미분류"} · ${project.status}`,
    preview: project.description ?? (project.updatedAt ? `${project.updatedAt.slice(0, 10)} 업데이트` : undefined),
    tone: "gold",
  });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];

  for (const task of taskResult.rows) {
    const target = node("task", task.id, task.title, {
      subtitle: `${task.status} · ${task.priority}`,
      preview: task.content ?? undefined,
      tone: "gold",
    });
    nodes.push(target);
    edges.push(edge({ from: focus, to: target, label: "작업", evidence: [{ source: "table", table: "tasks.project_id" }] }));
  }

  return { focus, nodes, edges };
}

async function getTaskContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const result = await queryD1<ContextTaskRow>(
    `select
       t.id,
       t.title,
       t.status,
       t.priority,
       t.due_at as dueAt,
       t.content,
       p.id as projectId,
       p.title as projectTitle,
       p.category as projectCategory,
       p.description as projectDescription
     from tasks t
     left join projects p on p.id = t.project_id and p.user_id = t.user_id and p.deleted_at is null
     where t.user_id = ?
       and t.id = ?
       and t.deleted_at is null
     limit 1`,
    [userId, id],
  );
  const task = result.rows[0];
  if (!task) return { focus: null, nodes: [], edges: [] };

  const focus = node("task", task.id, task.title, {
    subtitle: `${task.status} · ${task.priority}`,
    preview: task.content ?? "세부 메모가 아직 없습니다.",
    tone: "gold",
  });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];

  if (task.projectId && task.projectTitle) {
    const target = node("project", task.projectId, task.projectTitle, {
      subtitle: task.projectCategory ?? "프로젝트",
      preview: task.projectDescription ?? undefined,
      tone: "gold",
    });
    nodes.push(target);
    edges.push(edge({ from: target, to: focus, label: "contains task", evidence: [{ source: "table", table: "tasks.project_id" }] }));
  }

  if (task.dueAt) {
    const date = task.dueAt.slice(0, 10);
    const target = node("daily_log", date, date, { subtitle: date, tone: "gold" });
    nodes.push(target);
    edges.push(edge({ from: focus, to: target, label: "due date", evidence: [{ source: "table", table: "tasks" }] }));
  }

  return { focus, nodes, edges };
}

async function getPersonContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const [personResult, dailyEntryResult] = await Promise.all([
    queryD1<ContextPersonRow>(
      `select
         p.id,
         p.name,
         p.groups,
         p.bio,
         (
           select sd.id
           from source_documents sd
           where sd.user_id = p.user_id
             and sd.deleted_at is null
             and sd.canonical_entity_type = 'person'
             and sd.canonical_entity_id = p.id
           order by sd.updated_at desc, sd.created_at desc
           limit 1
         ) as sourceDocumentId
       from people p
       where p.user_id = ?
         and p.id = ?
         and p.deleted_at is null
       limit 1`,
      [userId, id],
    ),
    queryD1<ContextDailyEntryRow>(
      `select
         dle.id,
         dle.date,
         coalesce(dle.title, 'Daily Entry') as title
       from daily_entry_people_relations depr
       inner join daily_log_entries dle on dle.id = depr.daily_entry_id
       where dle.user_id = ?
         and dle.deleted_at is null
         and depr.person_id = ?
       order by dle.date desc, dle.created_at desc
       limit 12`,
      [userId, id],
    ).catch(() => ({ rows: [] })),
  ]);
  const person = personResult.rows[0];
  if (!person) return { focus: null, nodes: [], edges: [] };

  const focus = node("person", person.id, person.name, {
    subtitle: parseJsonList(person.groups).join(" · "),
    preview: person.bio ?? "설명이 아직 없습니다.",
    tone: "info",
    sourceDocumentId: person.sourceDocumentId ?? undefined,
  });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];

  for (const item of dailyEntryResult.rows) {
    const target = node("daily_entry", item.id, item.title, { subtitle: item.date, tone: "info" });
    nodes.push(target);
    edges.push(edge({ from: focus, to: target, label: "daily_entry", evidence: [{ source: "table", table: "daily_entry_people_relations" }] }));
  }

  return { focus, nodes, edges };
}

async function getGiftContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const result = await queryD1<ContextGiftRow>(
    `select
       g.id,
       g.direction,
       g.title,
       g.occurred_at as occurredAt,
       g.satisfaction,
       g.notes,
       p.id as personId,
       p.name as personName,
       p.groups as personGroups,
       p.bio as personBio,
       (
         select sd.id
         from source_documents sd
         where sd.user_id = g.user_id
           and sd.deleted_at is null
           and sd.canonical_entity_type = 'person'
           and sd.canonical_entity_id = p.id
         order by sd.updated_at desc, sd.created_at desc
         limit 1
       ) as personSourceDocumentId
     from gifts g
     left join people p on p.id = g.person_id and p.deleted_at is null
     where g.user_id = ?
       and g.id = ?
       and g.deleted_at is null
     limit 1`,
    [userId, id],
  );
  const gift = result.rows[0];
  if (!gift) return { focus: null, nodes: [], edges: [] };

  const focus = node("gift", gift.id, gift.title, {
    subtitle: `${gift.direction} · ${gift.occurredAt}`,
    preview: gift.notes ?? gift.satisfaction ?? undefined,
    tone: "success",
  });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];

  if (gift.personId && gift.personName) {
    const target = node("person", gift.personId, gift.personName, {
      subtitle: parseJsonList(gift.personGroups).join(" · "),
      preview: gift.personBio ?? undefined,
      tone: "info",
      sourceDocumentId: gift.personSourceDocumentId ?? undefined,
    });
    nodes.push(target);
    edges.push(edge({ from: focus, to: target, label: "gift person", evidence: [{ source: "table", table: "gifts.person_id" }] }));
  }

  return { focus, nodes, edges };
}

async function getZettelContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const [zettelResult, outgoingResult, backlinkResult] = await Promise.all([
    queryD1<ContextZettelRow>(
      `select
         z.id,
         z.title,
         z.category,
         z.summary,
         (
           select sd.id
           from source_documents sd
           where sd.user_id = z.user_id
             and sd.deleted_at is null
             and sd.canonical_entity_type = 'zettel'
             and sd.canonical_entity_id = z.id
           order by sd.updated_at desc, sd.created_at desc
           limit 1
         ) as sourceDocumentId
       from zettels z
       where z.user_id = ?
         and z.id = ?
         and z.deleted_at is null
       limit 1`,
      [userId, id],
    ),
    queryD1<ContextZettelOutgoingRow>(
      `select zl.id, zl.target_id as targetId, zt.title as targetTitle
       from zettel_links zl
       inner join zettels zs on zs.id = zl.source_id
       inner join zettels zt on zt.id = zl.target_id
       where zs.user_id = ?
         and zs.deleted_at is null
         and zt.deleted_at is null
         and zl.source_id = ?`,
      [userId, id],
    ),
    queryD1<ContextZettelBacklinkRow>(
      `select zs.id as sourceId, zs.title as sourceTitle
       from zettel_links zl
       inner join zettels zs on zs.id = zl.source_id
       inner join zettels zt on zt.id = zl.target_id
       where zt.user_id = ?
         and zs.deleted_at is null
         and zt.deleted_at is null
         and zl.target_id = ?`,
      [userId, id],
    ),
  ]);
  const zettel = zettelResult.rows[0];
  if (!zettel) return { focus: null, nodes: [], edges: [] };

  const focus = node("zettel", zettel.id, zettel.title, {
    subtitle: zettel.category ?? "지식",
    preview: zettel.summary ?? undefined,
    tone: "gold",
    sourceDocumentId: zettel.sourceDocumentId ?? undefined,
  });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];

  for (const link of outgoingResult.rows) {
    const target = node("zettel", link.targetId, link.targetTitle, { subtitle: "나가는 링크", tone: "gold" });
    nodes.push(target);
    edges.push(edge({ from: focus, to: target, label: "outgoing", evidence: [{ source: "table", table: "zettel_links" }] }));
  }

  for (const link of backlinkResult.rows) {
    const target = node("zettel", link.sourceId, link.sourceTitle, { subtitle: "역링크", tone: "gold" });
    nodes.push(target);
    edges.push(edge({ from: target, to: focus, label: "backlink", evidence: [{ source: "table", table: "zettel_links" }] }));
  }

  return { focus, nodes, edges };
}

async function getMediaContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const result = await queryD1<ContextMediaRow>(
    `select
       m.id,
       m.media_type as mediaType,
       m.title,
       m.status,
       m.review,
       (
         select sd.id
         from source_documents sd
         where sd.user_id = m.user_id
           and sd.deleted_at is null
           and sd.canonical_entity_type = 'media'
           and sd.canonical_entity_id = m.id
         order by sd.updated_at desc, sd.created_at desc
         limit 1
       ) as sourceDocumentId
     from media_logs m
     where m.user_id = ?
       and m.id = ?
       and m.deleted_at is null
     limit 1`,
    [userId, id],
  );
  const media = result.rows[0];
  if (!media) return { focus: null, nodes: [], edges: [] };

  return {
    focus: node("media", media.id, media.title, {
      subtitle: `${media.mediaType} · ${media.status}`,
      preview: media.review ?? undefined,
      tone: "info",
      sourceDocumentId: media.sourceDocumentId ?? undefined,
    }),
    nodes: [],
    edges: [],
  };
}

async function getPlaceContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const result = await queryD1<ContextPlaceRow>(
    `select
       pl.id,
       pl.category,
       pl.name,
       pl.address,
       pl.notes as review,
       (
         select sd.id
         from source_documents sd
         where sd.user_id = pl.user_id
           and sd.deleted_at is null
           and sd.canonical_entity_type = 'place'
           and sd.canonical_entity_id = pl.id
         order by sd.updated_at desc, sd.created_at desc
         limit 1
       ) as sourceDocumentId
     from places pl
     where pl.user_id = ?
       and pl.id = ?
       and pl.deleted_at is null
     limit 1`,
    [userId, id],
  );
  const place = result.rows[0];
  if (!place) return { focus: null, nodes: [], edges: [] };

  return {
    focus: node("place", place.id, place.name, {
      subtitle: place.address ?? place.category ?? "장소",
      preview: place.review ?? undefined,
      tone: "success",
      sourceDocumentId: place.sourceDocumentId ?? undefined,
    }),
    nodes: [],
    edges: [],
  };
}

async function getWorkoutContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const workoutResult = await queryD1<ContextWorkoutRow>(
    `select
       id,
       title,
       date,
       categories,
       duration_minutes as durationMinutes,
       intensity,
       notes
     from workouts
     where user_id = ?
       and id = ?
       and deleted_at is null
     limit 1`,
    [userId, id],
  );
  const workout = workoutResult.rows[0];
  if (!workout) return { focus: null, nodes: [], edges: [] };

  const focus = node("workout", workout.id, workout.title ?? workout.categories, {
    subtitle: `${workout.date} · ${Number(workout.durationMinutes ?? 0)} min · intensity ${Number(workout.intensity ?? 0)}`,
    preview: workout.notes ?? undefined,
    tone: "success",
  });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];
  const daily = await getDailyLogContextRow(userId, workout.date);

  if (daily) {
    const target = dailyLogNodeFromRow(daily);
    nodes.push(target);
    edges.push(edge({ from: target, to: focus, label: "daily anchor", evidence: [{ source: "table", table: "workouts.date" }] }));
  }

  return { focus, nodes, edges };
}

async function getCareerContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const result = await queryD1<ContextCareerRow>(
    `select
       id,
       source_document_id as sourceDocumentId,
       organization,
       role,
       start_date as startDate,
       end_date as endDate,
       description
     from career_history
     where user_id = ?
       and id = ?
       and deleted_at is null
     limit 1`,
    [userId, id],
  );
  const career = result.rows[0];
  if (!career) return { focus: null, nodes: [], edges: [] };
  const period = career.endDate ? `${career.startDate.slice(0, 4)} - ${career.endDate.slice(0, 4)}` : `${career.startDate.slice(0, 4)} - 현재`;

  return {
    focus: node("career", career.id, career.organization, {
      subtitle: `${career.role} · ${period}`,
      preview: career.description ?? undefined,
      tone: "gold",
      sourceDocumentId: career.sourceDocumentId ?? undefined,
    }),
    nodes: [],
    edges: [],
  };
}

async function getDailyLogContextRow(userId: string, date: string) {
  const result = await queryD1<ContextDailyLogRow>(
    `select
       dl.id,
       dl.date,
       dl.mood,
       dl.energy_level as energyLevel,
       dl.journal,
       dl.meditation,
       (
         select sd.id
         from source_documents sd
         where sd.user_id = dl.user_id
           and sd.deleted_at is null
           and sd.canonical_entity_type = 'daily_log'
           and sd.canonical_entity_id = dl.id
         order by sd.updated_at desc, sd.created_at desc
         limit 1
       ) as sourceDocumentId
     from daily_logs dl
     where dl.user_id = ?
       and dl.date = ?
       and dl.deleted_at is null
     limit 1`,
    [userId, date],
  );

  return result.rows[0] ?? null;
}

function dailyLogNodeFromRow(row: ContextDailyLogRow) {
  return node("daily_log", row.date, row.date, {
    subtitle: dailyLogSubtitle(Number(row.mood ?? 3), Number(row.energyLevel ?? 3)),
    preview: row.journal || row.meditation || undefined,
    tone: "gold",
    sourceDocumentId: row.sourceDocumentId ?? undefined,
  });
}

async function getDailyLogTimelineRows(userId: string, date: string) {
  const [taskTimeline, interactionTimeline, zettelTimeline, dailyPeopleTimeline] = await Promise.all([
    queryD1<ContextDailyTimelineRow>(
      `select date(coalesce(updated_at, created_at)) as date, time(coalesce(updated_at, created_at)) as time, title as label, 'task' as type
       from tasks
       where user_id = ?
         and date(coalesce(updated_at, created_at)) = ?
         and deleted_at is null
       order by updated_at desc
       limit 4`,
      [userId, date],
    ),
    queryD1<ContextDailyTimelineRow>(
      `select occurred_at as date, '14:00' as time, summary as label, 'interaction' as type
       from interactions
       where user_id = ?
         and occurred_at = ?
         and deleted_at is null
       order by created_at desc
       limit 4`,
      [userId, date],
    ),
    queryD1<ContextDailyTimelineRow>(
      `select date(coalesce(updated_at, created_at)) as date, time(coalesce(updated_at, created_at)) as time, title as label, 'zettel' as type
       from zettels
       where user_id = ?
         and date(coalesce(updated_at, created_at)) = ?
         and deleted_at is null
       order by updated_at desc
       limit 4`,
      [userId, date],
    ),
    queryD1<ContextDailyTimelineRow>(
      `select dl.date as date, '12:00' as time, p.name as label, 'person' as type
       from daily_logs dl
       inner join daily_log_people_relations dlpr on dlpr.daily_log_id = dl.id
       inner join people p on p.id = dlpr.person_id
       where dl.user_id = ?
         and dl.date = ?
         and dl.deleted_at is null
         and p.deleted_at is null
       order by p.name asc
       limit 6`,
      [userId, date],
    ),
  ]);

  return [...taskTimeline.rows, ...interactionTimeline.rows, ...zettelTimeline.rows, ...dailyPeopleTimeline.rows]
    .sort((left, right) => `${right.date} ${right.time}`.localeCompare(`${left.date} ${left.time}`))
    .slice(0, 6);
}

async function getDailyLogContextSeed(userId: string, id: string): Promise<ContextSeed> {
  const daily = await getDailyLogContextRow(userId, id);
  const focus = daily
    ? dailyLogNodeFromRow(daily)
    : node("daily_log", id, id, {
        subtitle: dailyLogSubtitle(3, 3),
        tone: "gold",
      });
  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];

  if (daily) {
    const timeline = await getDailyLogTimelineRows(userId, daily.date);
    for (const item of timeline) {
      const targetType = item.type === "person" ? "person" : item.type === "zettel" ? "zettel" : item.type === "task" ? "task" : "interaction";
      const target = node(targetType, `${daily.date}:${item.type}:${item.label}`, item.label, { subtitle: `${daily.date} ${item.time.slice(0, 5)}`, tone: "info" });
      nodes.push(target);
      edges.push(edge({ from: focus, to: target, label: item.type, evidence: [{ source: "table", table: "daily context query" }] }));
    }
  }

  return { focus, nodes, edges };
}

async function getContextReadModelSeed(userId: string, type: EntityType, id: string): Promise<ContextSeed | null> {
  if (type === "project") return getProjectContextSeed(userId, id);
  if (type === "task") return getTaskContextSeed(userId, id);
  if (type === "person") return getPersonContextSeed(userId, id);
  if (type === "gift") return getGiftContextSeed(userId, id);
  if (type === "zettel") return getZettelContextSeed(userId, id);
  if (type === "media") return getMediaContextSeed(userId, id);
  if (type === "place") return getPlaceContextSeed(userId, id);
  if (type === "workout") return getWorkoutContextSeed(userId, id);
  if (type === "career") return getCareerContextSeed(userId, id);
  if (type === "daily_log") return getDailyLogContextSeed(userId, id);
  return null;
}

export async function getContextBundle(type: EntityType, id: string, options: ContextBundleOptions = {}): Promise<ContextBundle> {
  const user = await resolveCurrentUser();
  const seed = await getContextReadModelSeed(user.id, type, id);
  const nodes: ContextNode[] = seed ? [...seed.nodes] : [];
  const edges: ContextEdge[] = seed ? [...seed.edges] : [];
  let focus: ContextNode | null = seed?.focus ?? null;

  if (!focus) {
    focus = node(type, id, id, { subtitle: "아직 canonical 데이터를 찾지 못했습니다", tone: "warning" });
  }

  appendBridgeRows(focus, await getExplicitBridgeRows(user.id, type, id), nodes, edges);

  const source = await getSourceDocuments(user.id, type, id);
  for (const document of source.documents) {
    const target = node("source_document", document.id, document.title, {
      subtitle: `${document.sourceDatabase ?? "External Source"} · ${document.status}`,
      preview: document.preview ?? document.sourceId,
      tone: "muted",
    });
    nodes.push(target);
    edges.push(edge({
      from: focus,
      to: target,
      label: "record trace",
      kind: "source",
      confidence: 1,
      evidence: [{ source: "source_document", table: "source_documents", sourceDocumentId: document.id, snippet: document.preview ?? undefined }],
    }));
  }

  for (const relation of source.relations) {
    const resolved = relation.resolvedEntityType && relation.resolvedEntityId;
    const target = resolved
      ? node(relation.resolvedEntityType!, relation.resolvedEntityId!, relation.targetTitle ?? relation.resolvedEntityId!, { subtitle: relation.relationName, tone: "info" })
      : node("source_document", `unresolved:${relation.id}`, relation.targetTitle ?? relation.targetSourceId ?? "미해결 관계", { subtitle: relation.relationName, tone: "warning" });
    nodes.push(target);
    edges.push(edge({
      from: focus,
      to: target,
      label: relation.relationName,
      kind: "source",
      confidence: Number(relation.confidence ?? (resolved ? 0.85 : 0.45)),
      id: relation.id,
      evidence: [{
        source: "source_document",
        table: "source_document_relations",
        sourceDocumentId: relation.sourceDocumentId,
        propertyName: relation.relationName,
        snippet: relation.targetTitle ?? (relation.targetSourceId ? "원본 관계 대상 보관됨" : undefined),
      }],
    }));
  }

  const reviews = await getReviewItems(user.id, type, id);
  for (const review of reviews) {
    const target = node("source_document", `review:${review.id}`, review.issueType, {
      subtitle: review.suggestedAction,
      preview: review.reason ?? undefined,
      tone: "warning",
    });
    nodes.push(target);
    edges.push(edge({
      from: focus,
      to: target,
      label: "record review",
      kind: "inferred",
      confidence: Number(review.confidence ?? 0.4),
      evidence: [{ source: "ai", table: "migration_review_items", snippet: review.suggestedAction }],
    }));
  }

  const rawNodes = uniqueNodes([focus, ...nodes]);
  const rawEdges = uniqueEdges(edges);
  const queried = applyContextQuery(focus, rawNodes, rawEdges, options);
  const allNodes = queried.nodes;
  const allEdges = queried.edges;
  const grouped = groupNodes(focus, allNodes, allEdges);
  const { pages, pagedGrouped, pagination } = paginateContext(grouped, options);
  return {
    focus,
    nodes: allNodes,
    edges: allEdges,
    pages,
    pagination,
    grouped: pagedGrouped,
    timeline: buildTimeline(allNodes, allEdges),
    quality: {
      unresolvedCount: grouped.unresolved.length,
      lowConfidenceCount: allEdges.filter((item) => item.confidence < 0.7).length,
      duplicateSuspects: reviews.filter((item) => item.issueType.includes("duplicate")).length,
    },
  };
}

export async function searchContextNodes(query: string, types?: EntityType[], options: { semantic?: boolean } = {}): Promise<ContextSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const user = await resolveCurrentUser();
  const searchTypes = types?.filter((type) => CONTEXT_SEARCH_ENTITY_TYPES.has(type));
  let semanticResults: Awaited<ReturnType<typeof semanticSearchZettels>> = [];
  if (options.semantic && (!searchTypes?.length || searchTypes.includes("zettel"))) {
    try {
      await seedSemanticZettelIndex();
      semanticResults = await semanticSearchZettels(normalized, 8);
    } catch {
      semanticResults = [];
    }
  }
  const ftsResults = await searchWithFTS(normalized, searchTypes);
  const supplementalTypes = searchTypes?.length && !searchTypes.includes("place") ? [] : ["place"];
  const readModelResults = ftsResults?.length
    ? supplementalTypes.length
      ? await getSearchReadModelItems(normalized, supplementalTypes)
      : []
    : await getSearchReadModelItems(normalized, searchTypes);
  const results = [...semanticResults, ...(ftsResults ?? []), ...readModelResults]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.type === item.type && candidate.id === item.id) === index)
    .sort((left, right) => right.score - left.score);
  const personLabels = await personIdentityLabels(user.id, results.filter((item) => item.type === "person").map((item) => item.id));
  return results.map((item) => ({
    ...node(item.type as EntityType, item.id, item.title, {
      subtitle: item.type === "person" ? personLabels.get(item.id) ?? "Person" : item.type,
      preview: item.snippet,
      tone: item.type === "person" ? "info" : item.type === "tag" ? "muted" : "gold",
      disambiguationLabel: item.type === "person" ? personLabels.get(item.id) : undefined,
    }),
    score: item.score,
  }));
}

export async function createContextEdge(input: EdgeInput) {
  const user = await resolveCurrentUser();
  const pair = `${input.focusType}:${input.targetType}`;

  if (pair === "person:task") {
    await executeD1(
      `insert or ignore into task_people_relations (task_id, person_id, role_context, created_at)
       values (?, ?, ?, datetime('now'))`,
      [input.targetId, input.focusId, input.label ?? "manual_attach"],
    );
  } else if (pair === "person:zettel") {
    await executeD1(
      `insert or ignore into zettel_people_relations (zettel_id, person_id, context, created_at)
       values (?, ?, ?, datetime('now'))`,
      [input.targetId, input.focusId, input.label ?? "manual_attach"],
    );
  } else if (pair === "person:media") {
    await executeD1(
      `insert or ignore into media_people_relations (media_id, person_id, context, created_at)
       values (?, ?, ?, datetime('now'))`,
      [input.targetId, input.focusId, input.label ?? "manual_attach"],
    );
  } else if (pair === "person:daily_log") {
    await executeD1(
      `insert or ignore into daily_log_people_relations (daily_log_id, person_id, context, created_at)
       values ((select id from daily_logs where date = ? and user_id = ? and deleted_at is null limit 1), ?, ?, datetime('now'))`,
      [input.targetId, user.id, input.focusId, input.label ?? "manual_attach"],
    );
  } else if (input.focusType === "task" && input.targetType === "person") {
    await executeD1(
      `insert or ignore into task_people_relations (task_id, person_id, role_context, created_at)
       values (?, ?, ?, datetime('now'))`,
      [input.focusId, input.targetId, input.label ?? "manual_attach"],
    );
  } else if (input.focusType === "task" && input.targetType === "zettel") {
    await executeD1(
      `insert or ignore into task_zettel_relations (task_id, zettel_id, created_at)
       values (?, ?, datetime('now'))`,
      [input.focusId, input.targetId],
    );
  } else if (input.focusType === "zettel" && input.targetType === "zettel") {
    await executeD1(
      `insert or ignore into zettel_links (id, source_id, target_id, context, created_at)
       values (?, ?, ?, ?, datetime('now'))`,
      [ulid(), input.focusId, input.targetId, input.label ?? "manual_attach"],
    );
  } else if (input.focusType === "zettel" && input.targetType === "person") {
    await executeD1(
      `insert or ignore into zettel_people_relations (zettel_id, person_id, context, created_at)
       values (?, ?, ?, datetime('now'))`,
      [input.focusId, input.targetId, input.label ?? "manual_attach"],
    );
  } else if (input.focusType === "zettel" && input.targetType === "media") {
    await executeD1(
      `insert or ignore into zettel_media_relations (zettel_id, media_id, created_at)
       values (?, ?, datetime('now'))`,
      [input.focusId, input.targetId],
    );
  } else if (input.focusType === "media" && input.targetType === "person") {
    await executeD1(
      `insert or ignore into media_people_relations (media_id, person_id, context, created_at)
       values (?, ?, ?, datetime('now'))`,
      [input.focusId, input.targetId, input.label ?? "manual_attach"],
    );
  } else if (input.focusType === "media" && input.targetType === "zettel") {
    await executeD1(
      `insert or ignore into zettel_media_relations (zettel_id, media_id, created_at)
       values (?, ?, datetime('now'))`,
      [input.targetId, input.focusId],
    );
  } else if (input.focusType === "daily_log" && input.targetType === "person") {
    await executeD1(
      `insert or ignore into daily_log_people_relations (daily_log_id, person_id, context, created_at)
       values ((select id from daily_logs where date = ? and user_id = ? and deleted_at is null limit 1), ?, ?, datetime('now'))`,
      [input.focusId, user.id, input.targetId, input.label ?? "manual_attach"],
    );
  } else {
    await executeD1(
      `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
       values (?, ?, 'create_relation_candidate', ?, ?, ?, datetime('now'))`,
      [ulid(), user.id, input.focusType, input.focusId, JSON.stringify(input)],
    );
  }

  await executeD1(
    `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, 'create_relation', ?, ?, ?, datetime('now'))`,
    [ulid(), user.id, input.focusType, input.focusId, JSON.stringify(input)],
  ).catch(() => undefined);

  return getContextBundle(input.focusType, input.focusId);
}

function parseExplicitEdgeId(edgeId: string) {
  if (!edgeId.startsWith("explicit:")) return null;
  const [, tableName, ...rest] = edgeId.split(":");
  return { tableName, key: rest.join(":") };
}

async function auditContextMutation(userId: string, action: string, input: unknown, entityType: EntityType, entityId: string) {
  await executeD1(
    `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [ulid(), userId, action, entityType, entityId, JSON.stringify(input)],
  ).catch(() => undefined);
}

export async function deleteContextEdge(input: { edgeId: string; focusType: EntityType; focusId: string }) {
  const user = await resolveCurrentUser();
  const parsed = parseExplicitEdgeId(input.edgeId);
  if (!parsed) throw new Error("Only explicit edges can be detached.");
  const key = parsed.key;
  const parts = key.split(":");
  const [fromType, fromId, toType, toId] = parts as [EntityType, string, EntityType, string];

  switch (parsed.tableName) {
    case "task_people_relations": {
      const taskId = fromType === "task" ? fromId : toId;
      const personId = fromType === "person" ? fromId : toId;
      await executeD1(
        `delete from task_people_relations
         where task_id = ? and person_id = ?
           and exists (select 1 from tasks where id = ? and user_id = ? and deleted_at is null)`,
        [taskId, personId, taskId, user.id],
      );
      break;
    }
    case "task_zettel_relations": {
      const taskId = fromType === "task" ? fromId : toId;
      const zettelId = fromType === "zettel" ? fromId : toId;
      await executeD1(
        `delete from task_zettel_relations
         where task_id = ? and zettel_id = ?
           and exists (select 1 from tasks where id = ? and user_id = ? and deleted_at is null)`,
        [taskId, zettelId, taskId, user.id],
      );
      break;
    }
    case "zettel_people_relations": {
      const zettelId = fromType === "zettel" ? fromId : toId;
      const personId = fromType === "person" ? fromId : toId;
      await executeD1(
        `delete from zettel_people_relations
         where zettel_id = ? and person_id = ?
           and exists (select 1 from zettels where id = ? and user_id = ? and deleted_at is null)`,
        [zettelId, personId, zettelId, user.id],
      );
      break;
    }
    case "zettel_media_relations": {
      const zettelId = fromType === "zettel" ? fromId : toId;
      const mediaId = fromType === "media" ? fromId : toId;
      await executeD1(
        `delete from zettel_media_relations
         where zettel_id = ? and media_id = ?
           and exists (select 1 from zettels where id = ? and user_id = ? and deleted_at is null)`,
        [zettelId, mediaId, zettelId, user.id],
      );
      break;
    }
    case "media_people_relations": {
      const mediaId = fromType === "media" ? fromId : toId;
      const personId = fromType === "person" ? fromId : toId;
      await executeD1(
        `delete from media_people_relations
         where media_id = ? and person_id = ?
           and exists (select 1 from media_logs where id = ? and user_id = ? and deleted_at is null)`,
        [mediaId, personId, mediaId, user.id],
      );
      break;
    }
    case "daily_log_people_relations": {
      const date = fromType === "daily_log" ? fromId : toId;
      const personId = fromType === "person" ? fromId : toId;
      await executeD1(
        `delete from daily_log_people_relations
         where person_id = ?
           and daily_log_id in (select id from daily_logs where date = ? and user_id = ? and deleted_at is null)`,
        [personId, date, user.id],
      );
      break;
    }
    case "zettel_links": {
      await executeD1(
        `delete from zettel_links
         where id = ?
           and exists (select 1 from zettels where id = source_id and user_id = ? and deleted_at is null)`,
        [parsed.key, user.id],
      );
      break;
    }
    case "network_edges": {
      await executeD1(`update network_edges set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [parsed.key, user.id]);
      break;
    }
    default:
      throw new Error("This relation type cannot be detached from Context API.");
  }

  await auditContextMutation(user.id, "delete_relation", input, input.focusType, input.focusId);
  return getContextBundle(input.focusType, input.focusId);
}

async function getSourceRelationDetail(userId: string, sourceRelationId: string) {
  const result = await queryD1<SourceRelationDetailRow>(
    `select sdr.id, sdr.source_document_id as sourceDocumentId, sdr.relation_name as relationName, sdr.target_source_id as targetSourceId,
            sdr.target_title as targetTitle, sdr.resolved_entity_type as resolvedEntityType, sdr.resolved_entity_id as resolvedEntityId, sdr.confidence,
            sd.canonical_entity_type as focusType, sd.canonical_entity_id as focusId, sd.title as focusTitle
     from source_document_relations sdr
     inner join source_documents sd on sd.id = sdr.source_document_id
     where sd.user_id = ? and sd.deleted_at is null and sdr.id = ?
     limit 1`,
    [userId, sourceRelationId],
  );
  return result.rows[0] ?? null;
}

export async function resolveSourceRelation(input: ResolveSourceRelationInput) {
  const user = await resolveCurrentUser();
  const relation = await getSourceRelationDetail(user.id, input.sourceRelationId);
  if (!relation?.focusType || !relation.focusId) throw new Error("Source relation has no canonical focus.");

  await executeD1(
    `update source_document_relations
     set resolved_entity_type = ?, resolved_entity_id = ?, confidence = max(coalesce(confidence, 0), 0.9)
     where id = ?`,
    [input.targetType, input.targetId, input.sourceRelationId],
  );

  await createContextEdge({
    focusType: relation.focusType,
    focusId: relation.focusId,
    targetType: input.targetType,
    targetId: input.targetId,
    label: input.label ?? relation.relationName,
  });

  await auditContextMutation(user.id, "resolve_source_relation", input, relation.focusType, relation.focusId);
  return getContextBundle(relation.focusType, relation.focusId);
}

export async function createCanonicalEntityAndAttach(input: CreateCanonicalEntityInput) {
  const user = await resolveCurrentUser();
  const title = input.title.trim();
  if (!title) throw new Error("새 엔티티 이름은 비워둘 수 없습니다.");
  const id = ulid();

  if (input.targetType === "person") {
    await executeD1(
      `insert into people (id, user_id, name, groups, dunbar_layer, status, is_favorite, created_at, updated_at)
       values (?, ?, ?, ?, 50, 'active', 0, datetime('now'), datetime('now'))`,
      [id, user.id, title, JSON.stringify(["context"])],
    );
  } else if (input.targetType === "zettel") {
    await executeD1(
      `insert into zettels (id, user_id, title, slug, content, content_text, summary, type, category, pinned, created_at, updated_at)
       values (?, ?, ?, ?, '', '', '', 'fleeting', 'linked', 0, datetime('now'), datetime('now'))`,
      [id, user.id, title, `${slugify(title)}-${id.slice(-6).toLowerCase()}`],
    );
  } else if (input.targetType === "project") {
    await executeD1(
      `insert into projects (id, user_id, title, slug, icon, color, kind, status, category, progress, pinned, display_order, created_at, updated_at)
       values (?, ?, ?, ?, 'LH', 'gold', 'project', 'active', 'context', 0, 0, 0, datetime('now'), datetime('now'))`,
      [id, user.id, title, `${slugify(title)}-${id.slice(-6).toLowerCase()}`],
    );
  } else if (input.targetType === "media") {
    await executeD1(
      `insert into media_logs (id, user_id, media_type, title, status, created_at, updated_at)
       values (?, ?, 'unknown', ?, 'backlog', datetime('now'), datetime('now'))`,
      [id, user.id, title],
    );
  } else if (input.targetType === "place") {
    await executeD1(
      `insert into places (id, user_id, name, category, visit_count, created_at, updated_at)
       values (?, ?, ?, 'unknown', 0, datetime('now'), datetime('now'))`,
      [id, user.id, title],
    );
  } else {
    throw new Error("이 타입은 빠른 canonical 생성 대상이 아닙니다.");
  }

  if (input.sourceRelationId) {
    await executeD1(
      `update source_document_relations
       set resolved_entity_type = ?, resolved_entity_id = ?, confidence = max(coalesce(confidence, 0), 0.9)
       where id = ?
         and exists (
          select 1 from source_documents sd
          where sd.id = source_document_relations.source_document_id
            and sd.user_id = ?
            and sd.deleted_at is null
         )`,
      [input.targetType, id, input.sourceRelationId, user.id],
    );
  }

  await createContextEdge({
    focusType: input.focusType,
    focusId: input.focusId,
    targetType: input.targetType,
    targetId: id,
    label: input.label ?? "manual_create",
  });

  await auditContextMutation(user.id, "create_canonical_entity", input, input.focusType, input.focusId);
  return getContextBundle(input.focusType, input.focusId);
}
