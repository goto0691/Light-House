import "server-only";

import { ALL_PROPERTY_DEFINITIONS, propertyDefinitionsFor } from "@/lib/properties/registry";
import { classifySourceProperty } from "@/lib/properties/source-mapping";
import type { PropertyDefinition, PropertyEntityType } from "@/lib/properties/types";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";
import { applySourcePropertyMappingRule, findSourcePropertyMappingRule, sourceMappingScopeValue } from "@/lib/source-property-mapping-rules";
import type {
  SourcePropertyBatchApplyInput,
  SourcePropertyBatchApplyResult,
  SourcePropertyMappingMutationInput,
  SourcePropertyMappingRule,
  SourcePropertyWorkbench,
  SourceWorkbenchProperty,
  SourceWorkbenchTargetOption,
} from "@/lib/source-workbench-types";

type SourcePropertyAggregateRow = {
  sourceDatabase: string | null;
  canonicalEntityType: string | null;
  documentRole: string | null;
  documentStatus: string;
  propertyName: string;
  propertyType: string | null;
  occurrences: number | null;
  documentCount: number | null;
  sampleValue: string | null;
};

type SourcePropertyBatchApplyRow = {
  sourceDocumentId: string;
  canonicalEntityType: string | null;
  canonicalEntityId: string | null;
  valueText: string | null;
  normalizedValue: string | null;
};

type SourcePropertyReviewDocumentRow = {
  sourceDocumentId: string;
  sourceDatabase: string | null;
  canonicalEntityType: string | null;
  canonicalEntityId: string | null;
  documentRole: string | null;
  documentStatus: string;
  title: string;
};

type SourcePropertyReviewRow = {
  id: string;
  sourceDocumentId: string | null;
  status: string;
  payload: string | null;
  updatedAt: string | null;
};

type SourcePropertyReviewScope = {
  sourceDatabase: string;
  canonicalEntityType: string;
  documentRole: string;
  documentStatus: string;
  propertyName: string;
  propertyType: string;
  targetField: string | null;
  displayLabel: string | null;
};

type SourcePropertyReviewPayload = {
  kind: "source_property_mapping";
  scope: SourcePropertyReviewScope;
  sourceDocument?: {
    id: string;
    sourceDatabase: string | null;
    canonicalEntityType: string | null;
    canonicalEntityId: string | null;
    documentRole: string | null;
    documentStatus: string;
    title: string;
  };
};

type SourcePropertyReviewIndexValue = {
  openCount: number;
  totalCount: number;
  sampleReviewItemId: string | null;
  updatedAt: string | null;
};

type BatchApplyFieldConfig = {
  column: string;
  storage: "text" | "number" | "boolean" | "json";
};

type BatchApplyEntityConfig = {
  table: string;
  fields: Record<string, BatchApplyFieldConfig>;
};

const SOURCE_WORKBENCH_LIMIT = 400;
const SOURCE_PROPERTY_REVIEW_ISSUE_TYPE = "source_property_mapping";
const SOURCE_PROPERTY_REVIEW_LIMIT = 50;
const SOURCE_PROPERTY_BATCH_APPLY_LIMIT = 100;
const PROPERTY_ENTITY_TYPES = [
  "zettel",
  "media",
  "person",
  "daily_log",
  "daily_log_entry",
  "project",
  "task",
  "habit",
  "workout",
  "career",
  "asset",
  "place",
  "gift",
] as const satisfies readonly PropertyEntityType[];
const PROPERTY_ENTITY_TYPE_SET = new Set<string>(PROPERTY_ENTITY_TYPES);

const ENTITY_LABELS: Record<string, string> = {
  asset: "자산",
  career: "커리어",
  daily_entry: "일일 기록",
  daily_log: "일일 로그",
  daily_log_entry: "일일 기록",
  gift: "선물",
  habit: "습관",
  media: "미디어",
  person: "사람",
  place: "장소",
  project: "프로젝트",
  task: "작업",
  workout: "운동",
  zettel: "지식",
};

const BATCH_APPLY_ENTITIES: Record<string, BatchApplyEntityConfig> = {
  asset: {
    table: "assets",
    fields: {
      name: { column: "name", storage: "text" },
      brand: { column: "brand", storage: "text" },
      modelName: { column: "model_name", storage: "text" },
      category: { column: "category", storage: "text" },
      condition: { column: "current_condition", storage: "text" },
      acquiredDate: { column: "acquired_date", storage: "text" },
      acquiredPrice: { column: "acquired_price", storage: "number" },
      notes: { column: "notes", storage: "text" },
    },
  },
  career: {
    table: "career_history",
    fields: {
      organization: { column: "organization", storage: "text" },
      role: { column: "role", storage: "text" },
      category: { column: "category", storage: "text" },
      startDate: { column: "start_date", storage: "text" },
      endDate: { column: "end_date", storage: "text" },
      description: { column: "description", storage: "text" },
    },
  },
  daily_log: {
    table: "daily_logs",
    fields: {
      date: { column: "date", storage: "text" },
      mood: { column: "mood", storage: "number" },
      energy: { column: "energy_level", storage: "number" },
      emotions: { column: "emotions", storage: "json" },
      gratitude: { column: "gratitude", storage: "text" },
      journal: { column: "journal", storage: "text" },
      meditation: { column: "meditation", storage: "text" },
      meditationVerse: { column: "meditation_verse", storage: "text" },
    },
  },
  gift: {
    table: "gifts",
    fields: {
      title: { column: "title", storage: "text" },
      direction: { column: "direction", storage: "text" },
      occurredAt: { column: "occurred_at", storage: "text" },
      satisfaction: { column: "satisfaction", storage: "text" },
      notes: { column: "notes", storage: "text" },
    },
  },
  habit: {
    table: "habits",
    fields: {
      title: { column: "title", storage: "text" },
      description: { column: "description", storage: "text" },
      type: { column: "type", storage: "text" },
      targetValue: { column: "target_value", storage: "number" },
      unit: { column: "unit", storage: "text" },
      icon: { column: "icon", storage: "text" },
      color: { column: "color", storage: "text" },
      schedule: { column: "schedule", storage: "text" },
      isActive: { column: "is_active", storage: "boolean" },
    },
  },
  media: {
    table: "media_logs",
    fields: {
      title: { column: "title", storage: "text" },
      originalTitle: { column: "original_title", storage: "text" },
      creator: { column: "creator", storage: "text" },
      author: { column: "author", storage: "text" },
      studio: { column: "studio", storage: "text" },
      mediaType: { column: "media_type", storage: "text" },
      subtype: { column: "subtype", storage: "text" },
      screenKind: { column: "screen_kind", storage: "text" },
      platformOrPublisher: { column: "platform_or_publisher", storage: "text" },
      genre: { column: "genre", storage: "text" },
      status: { column: "status", storage: "text" },
      rewatchValue: { column: "rewatch_value", storage: "boolean" },
      releaseYear: { column: "release_year", storage: "number" },
      loggedAt: { column: "logged_at", storage: "text" },
      startedAt: { column: "started_at", storage: "text" },
      completedAt: { column: "completed_at", storage: "text" },
      playTime: { column: "play_time", storage: "number" },
      pages: { column: "pages", storage: "number" },
      rating: { column: "rating", storage: "number" },
      evaluation: { column: "evaluation", storage: "text" },
      review: { column: "review", storage: "text" },
      content: { column: "content", storage: "text" },
      relationNote: { column: "relation_note", storage: "text" },
    },
  },
  person: {
    table: "people",
    fields: {
      name: { column: "name", storage: "text" },
      nickname: { column: "nickname", storage: "text" },
      aliases: { column: "aliases", storage: "text" },
      groups: { column: "groups", storage: "json" },
      status: { column: "status", storage: "text" },
      dunbarLayer: { column: "dunbar_layer", storage: "number" },
      intimacy: { column: "intimacy", storage: "number" },
      contactCadenceDays: { column: "contact_cadence_days", storage: "number" },
      birthDate: { column: "birth_date", storage: "text" },
      birthdayMemo: { column: "birthday_memo", storage: "text" },
      phone: { column: "phone", storage: "text" },
      email: { column: "email", storage: "text" },
      address: { column: "address", storage: "text" },
      socialLinks: { column: "social_links", storage: "text" },
      coreValue: { column: "core_value", storage: "text" },
      bio: { column: "bio", storage: "text" },
      profileBody: { column: "profile_body", storage: "text" },
    },
  },
  place: {
    table: "places",
    fields: {
      name: { column: "name", storage: "text" },
      category: { column: "category", storage: "text" },
      address: { column: "address", storage: "text" },
      mapUrl: { column: "map_url", storage: "text" },
      firstVisitedAt: { column: "first_visited_at", storage: "text" },
      lastVisitedAt: { column: "last_visited_at", storage: "text" },
      visitCount: { column: "visit_count", storage: "number" },
      averageRating: { column: "average_rating", storage: "number" },
      review: { column: "notes", storage: "text" },
    },
  },
  project: {
    table: "projects",
    fields: {
      title: { column: "title", storage: "text" },
      icon: { column: "icon", storage: "text" },
      kind: { column: "kind", storage: "text" },
      category: { column: "category", storage: "text" },
      color: { column: "color", storage: "text" },
      status: { column: "status", storage: "text" },
      targetDate: { column: "target_date", storage: "text" },
      description: { column: "description", storage: "text" },
    },
  },
  task: {
    table: "tasks",
    fields: {
      title: { column: "title", storage: "text" },
      kind: { column: "kind", storage: "text" },
      status: { column: "status", storage: "text" },
      priority: { column: "priority", storage: "text" },
      brainEnergy: { column: "brain_energy", storage: "text" },
      dueAt: { column: "due_at", storage: "text" },
      content: { column: "content", storage: "text" },
    },
  },
  workout: {
    table: "workouts",
    fields: {
      date: { column: "date", storage: "text" },
      categories: { column: "categories", storage: "text" },
      duration: { column: "duration_minutes", storage: "number" },
      intensity: { column: "intensity", storage: "number" },
      notes: { column: "notes", storage: "text" },
    },
  },
  zettel: {
    table: "zettels",
    fields: {
      type: { column: "type", storage: "text" },
      documentKind: { column: "document_kind", storage: "text" },
      status: { column: "status", storage: "text" },
      category: { column: "category", storage: "text" },
      aliases: { column: "aliases", storage: "json" },
      sourceReliability: { column: "source_reliability", storage: "text" },
      reviewCadence: { column: "review_cadence", storage: "text" },
      reviewDueAt: { column: "review_due_at", storage: "text" },
      source: { column: "source", storage: "text" },
      sourceUrl: { column: "source_url", storage: "text" },
      originalCreatedAt: { column: "original_created_at", storage: "text" },
    },
  },
};

export async function getSourcePropertyWorkbench(input: { limit?: number } = {}): Promise<SourcePropertyWorkbench> {
  const user = await resolveCurrentUser();
  const limit = Math.min(Math.max(input.limit ?? SOURCE_WORKBENCH_LIMIT, 25), SOURCE_WORKBENCH_LIMIT);
  const [propertiesResult, mappingRules, reviewRows] = await Promise.all([
    queryD1<SourcePropertyAggregateRow>(
      `select
         sd.source_database as sourceDatabase,
         sd.canonical_entity_type as canonicalEntityType,
         sd.document_role as documentRole,
         sd.status as documentStatus,
         sdp.property_name as propertyName,
         sdp.property_type as propertyType,
         count(*) as occurrences,
         count(distinct sd.id) as documentCount,
         min(sdp.value_text) as sampleValue
       from source_document_properties sdp
       inner join source_documents sd on sd.id = sdp.source_document_id
       where sd.user_id = ?
         and sd.deleted_at is null
         and sdp.value_text is not null
         and trim(sdp.value_text) <> ''
       group by sd.source_database, sd.canonical_entity_type, sd.document_role, sd.status, sdp.property_name, sdp.property_type
       order by occurrences desc, propertyName asc
       limit ?`,
      [user.id, limit],
    ),
    listSourcePropertyMappingRules(user.id),
    listSourcePropertyReviewRows(user.id),
  ]);

  const reviewIndex = sourcePropertyReviewIndex(reviewRows);
  const rows = propertiesResult.rows.map((row) => sourceWorkbenchProperty(row, mappingRules, reviewIndex));
  const sourceDatabases = uniqueSorted(rows.map((row) => row.sourceDatabase).filter((item): item is string => Boolean(item)));
  const entityTypes = uniqueSorted(rows.map((row) => row.canonicalEntityType).filter((item): item is string => Boolean(item)));
  const documentRoles = uniqueSorted(rows.map((row) => row.documentRole).filter((item): item is string => Boolean(item)));

  return {
    rows,
    summary: {
      totalProperties: rows.length,
      suggested: rows.filter((row) => row.classification.status === "suggested").length,
      unmapped: rows.filter((row) => row.classification.status === "unmapped").length,
      hidden: rows.filter((row) => row.classification.status === "hidden").length,
      openReviewItems: rows.reduce((sum, row) => sum + row.review.openCount, 0),
      overrideRules: rows.filter((row) => row.overrideRule).length,
      sourceDatabases: sourceDatabases.length,
      entityTypes: entityTypes.length,
    },
    filters: {
      sourceDatabases,
      entityTypes,
      documentRoles,
    },
  };
}

export async function upsertSourcePropertyMapping(input: SourcePropertyMappingMutationInput) {
  const user = await resolveCurrentUser();
  const propertyName = input.propertyName.trim();
  if (!propertyName) {
    throw new Error("원본 컬럼명은 비워둘 수 없습니다.");
  }

  const sourceDatabase = sourceMappingScopeValue(input.sourceDatabase);
  const canonicalEntityType = sourceMappingScopeValue(input.canonicalEntityType);
  const propertyType = sourceMappingScopeValue(input.propertyType);
  const documentRole = sourceMappingScopeValue(input.documentRole);
  const documentStatus = sourceMappingScopeValue(input.documentStatus);
  const existing = await queryD1<{ id: string }>(
    `select id
     from source_property_mappings
     where user_id = ?
       and source_database = ?
       and canonical_entity_type = ?
       and property_name = ?
       and property_type = ?
       and deleted_at is null
     order by updated_at desc
     limit 1`,
    [user.id, sourceDatabase, canonicalEntityType, propertyName, propertyType],
  );
  const currentId = existing.rows[0]?.id;

  if (currentId) {
    await executeD1(
      `update source_property_mappings
       set status = ?,
           target_field = ?,
           display_label = ?,
           reason = ?,
           confidence = ?,
           updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [
        input.status,
        input.targetField?.trim() || null,
        input.displayLabel?.trim() || null,
        input.reason?.trim() || null,
        input.confidence ?? null,
        currentId,
        user.id,
      ],
    );
  } else {
    await executeD1(
      `insert into source_property_mappings (
         id, user_id, source_database, canonical_entity_type, property_name, property_type,
         status, target_field, display_label, reason, confidence, created_at, updated_at
       ) values (
         lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
       )`,
      [
        user.id,
        sourceDatabase,
        canonicalEntityType,
        propertyName,
        propertyType,
        input.status,
        input.targetField?.trim() || null,
        input.displayLabel?.trim() || null,
        input.reason?.trim() || null,
        input.confidence ?? null,
      ],
    );
  }

  await syncSourcePropertyReviewItems(user.id, {
    sourceDatabase,
    canonicalEntityType,
    documentRole,
    documentStatus,
    propertyName,
    propertyType,
    targetField: input.status === "mapped" ? input.targetField?.trim() || null : null,
    displayLabel: input.displayLabel?.trim() || null,
    status: input.status,
    confidence: input.confidence ?? null,
    reason: input.reason?.trim() || null,
  });

  return getSourcePropertyWorkbench();
}

export async function applySourcePropertyMapping(input: SourcePropertyBatchApplyInput): Promise<{
  result: SourcePropertyBatchApplyResult;
  workbench: SourcePropertyWorkbench;
}> {
  const user = await resolveCurrentUser();
  const propertyName = input.propertyName.trim();
  const targetField = input.targetField.trim();
  if (!propertyName) throw new Error("원본 컬럼명은 비워둘 수 없습니다.");
  if (!targetField) throw new Error("적용할 표준 속성을 선택해 주세요.");
  if (!input.canonicalEntityType) throw new Error("표준 엔티티가 없는 원본 컬럼은 일괄 적용할 수 없습니다.");

  const entityType = propertyEntityTypeFor(input.canonicalEntityType);
  if (!entityType) throw new Error("지원하지 않는 표준 엔티티입니다.");

  const entityConfig = BATCH_APPLY_ENTITIES[entityType];
  const fieldConfig = entityConfig?.fields[targetField];
  const definition = definitionsForSourceEntity(input.canonicalEntityType).find((item) => item.field === targetField);
  if (!entityConfig || !fieldConfig || !definition) {
    throw new Error("이 표준 속성은 아직 안전한 일괄 적용 대상이 아닙니다.");
  }

  const limit = Math.min(Math.max(input.limit ?? SOURCE_PROPERTY_BATCH_APPLY_LIMIT, 1), SOURCE_PROPERTY_BATCH_APPLY_LIMIT);
  const rows = await listSourcePropertyBatchApplyRows(user.id, {
    sourceDatabase: input.sourceDatabase,
    canonicalEntityType: input.canonicalEntityType,
    documentRole: input.documentRole,
    documentStatus: input.documentStatus,
    propertyName,
    propertyType: input.propertyType,
    limit,
  });
  const result: SourcePropertyBatchApplyResult = {
    matchedDocuments: rows.length,
    applied: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    skippedUnlinked: 0,
    unsupported: 0,
    targetLabel: definition.label,
  };

  for (const row of rows) {
    if (!row.canonicalEntityId) {
      result.skippedUnlinked += 1;
      continue;
    }

    const normalized = normalizeBatchApplyValue(row.normalizedValue ?? row.valueText, definition, fieldConfig);
    if (!normalized.ok) {
      result.skippedInvalid += 1;
      continue;
    }

    const meta = await executeD1(
      `update ${entityConfig.table}
       set ${fieldConfig.column} = ?,
           updated_at = datetime('now')
       where id = ?
         and user_id = ?
         and deleted_at is null
         ${input.overwrite ? "" : `and (${fieldConfig.column} is null or trim(cast(${fieldConfig.column} as text)) = '')`}`,
      [normalized.value, row.canonicalEntityId, user.id],
    );

    if (Number(meta.changes ?? 0) > 0) {
      result.applied += 1;
    } else {
      result.skippedExisting += 1;
    }
  }

  if (result.applied > 0) {
    await resolveAppliedSourcePropertyReviewItems(user.id, {
      sourceDatabase: sourceMappingScopeValue(input.sourceDatabase),
      canonicalEntityType: sourceMappingScopeValue(input.canonicalEntityType),
      documentRole: sourceMappingScopeValue(input.documentRole),
      documentStatus: sourceMappingScopeValue(input.documentStatus),
      propertyName,
      propertyType: sourceMappingScopeValue(input.propertyType),
      targetField,
      displayLabel: definition.label,
    });
  }

  return {
    result,
    workbench: await getSourcePropertyWorkbench(),
  };
}

export async function listCurrentSourcePropertyMappings() {
  const user = await resolveCurrentUser();
  return listSourcePropertyMappingRules(user.id);
}

async function listSourcePropertyMappingRules(userId: string) {
  try {
    const result = await queryD1<SourcePropertyMappingRule>(
      `select
         id,
         source_database as sourceDatabase,
         canonical_entity_type as canonicalEntityType,
         property_name as propertyName,
         property_type as propertyType,
         status,
         target_field as targetField,
         display_label as displayLabel,
         reason,
         confidence,
         updated_at as updatedAt
       from source_property_mappings
       where user_id = ?
         and deleted_at is null
       order by updated_at desc`,
      [userId],
    );
    return result.rows;
  } catch {
    return [];
  }
}

function sourceWorkbenchProperty(
  row: SourcePropertyAggregateRow,
  mappingRules: SourcePropertyMappingRule[],
  reviewIndex: Map<string, SourcePropertyReviewIndexValue>,
): SourceWorkbenchProperty {
  const propertyEntityType = propertyEntityTypeFor(row.canonicalEntityType);
  const definitions = definitionsForSourceEntity(row.canonicalEntityType);
  const baseClassification = classifySourceProperty(
    { name: row.propertyName, type: row.propertyType, value: row.sampleValue },
    definitions,
  );
  const rule = findSourcePropertyMappingRule(mappingRules, {
    sourceDatabase: row.sourceDatabase,
    canonicalEntityType: row.canonicalEntityType,
    propertyName: row.propertyName,
    propertyType: row.propertyType,
  });
  const classification = rule ? applySourcePropertyMappingRule(rule, baseClassification, definitions) : baseClassification;

  return {
    id: sourcePropertyReviewKey({
      sourceDatabase: row.sourceDatabase,
      canonicalEntityType: row.canonicalEntityType,
      documentRole: row.documentRole,
      documentStatus: row.documentStatus,
      propertyName: row.propertyName,
      propertyType: row.propertyType,
    }),
    sourceDatabase: row.sourceDatabase,
    canonicalEntityType: row.canonicalEntityType,
    propertyEntityType,
    documentRole: row.documentRole,
    documentStatus: row.documentStatus,
    propertyName: row.propertyName,
    propertyType: row.propertyType,
    occurrences: Number(row.occurrences ?? 0),
    documentCount: Number(row.documentCount ?? 0),
    sampleValue: row.sampleValue,
    classification,
    overrideRule: rule
      ? {
          id: rule.id,
          status: rule.status,
          targetField: rule.targetField,
          displayLabel: rule.displayLabel,
          reason: rule.reason,
          updatedAt: rule.updatedAt,
        }
      : null,
    review: reviewIndex.get(sourcePropertyReviewKey({
      sourceDatabase: row.sourceDatabase,
      canonicalEntityType: row.canonicalEntityType,
      documentRole: row.documentRole,
      documentStatus: row.documentStatus,
      propertyName: row.propertyName,
      propertyType: row.propertyType,
    })) ?? emptySourcePropertyReview(),
    targetOptions: targetOptionsFor(row.canonicalEntityType),
  };
}

async function syncSourcePropertyReviewItems(
  userId: string,
  input: SourcePropertyReviewScope & {
    status: SourcePropertyMappingMutationInput["status"];
    confidence: number | null;
    reason: string | null;
  },
) {
  const scope: SourcePropertyReviewScope = {
    sourceDatabase: input.sourceDatabase,
    canonicalEntityType: input.canonicalEntityType,
    documentRole: input.documentRole,
    documentStatus: input.documentStatus,
    propertyName: input.propertyName,
    propertyType: input.propertyType,
    targetField: input.targetField,
    displayLabel: input.displayLabel,
  };
  const currentRows = await listSourcePropertyReviewRows(userId);
  const matchingRows = currentRows.filter((row) => {
    const payload = parseSourcePropertyReviewPayload(row.payload);
    return payload ? sourcePropertyReviewKey(payload.scope) === sourcePropertyReviewKey(scope) : false;
  });

  if (input.status !== "needs_review") {
    const openIds = matchingRows.filter((row) => row.status === "open").map((row) => row.id);
    if (!openIds.length) return;
    await executeD1(
      `update migration_review_items
       set status = ?,
           resolved_at = datetime('now'),
           updated_at = datetime('now')
       where user_id = ? and id in (${openIds.map(() => "?").join(",")})`,
      [input.status === "mapped" ? "applied" : "dismissed", userId, ...openIds],
    );
    return;
  }

  const documentRows = await listSourcePropertyReviewDocuments(userId, scope);
  const existingByDocumentId = new Map(matchingRows.map((row) => [row.sourceDocumentId, row]));
  const suggestedAction = sourcePropertyReviewAction(scope);
  const reason = input.reason ?? "원본 컬럼 정리 워크벤치에서 검토 대상으로 표시했습니다.";

  for (const document of documentRows) {
    const payload = stringifySourcePropertyReviewPayload(scope, document);
    const existing = existingByDocumentId.get(document.sourceDocumentId);
    if (existing) {
      await executeD1(
        `update migration_review_items
         set status = 'open',
             suggested_action = ?,
             confidence = ?,
             reason = ?,
             payload = ?,
             resolved_at = null,
             updated_at = datetime('now')
         where id = ? and user_id = ?`,
        [suggestedAction, input.confidence ?? 0.2, reason, payload, existing.id, userId],
      );
    } else {
      await executeD1(
        `insert into migration_review_items (
           id, user_id, source_document_id, entity_type, entity_id, issue_type,
           suggested_action, confidence, status, reason, payload, created_at, updated_at
         ) values (
           lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'), datetime('now')
         )`,
        [
          userId,
          document.sourceDocumentId,
          document.canonicalEntityType ?? "source_document",
          document.canonicalEntityId,
          SOURCE_PROPERTY_REVIEW_ISSUE_TYPE,
          suggestedAction,
          input.confidence ?? 0.2,
          reason,
          payload,
        ],
      );
    }
  }
}

async function resolveAppliedSourcePropertyReviewItems(userId: string, scope: SourcePropertyReviewScope) {
  const currentRows = await listSourcePropertyReviewRows(userId);
  const openIds = currentRows
    .filter((row) => {
      const payload = parseSourcePropertyReviewPayload(row.payload);
      return row.status === "open" && payload ? sourcePropertyReviewKey(payload.scope) === sourcePropertyReviewKey(scope) : false;
    })
    .map((row) => row.id);

  if (!openIds.length) return;
  await executeD1(
    `update migration_review_items
     set status = 'applied',
         resolved_at = datetime('now'),
         updated_at = datetime('now')
     where user_id = ? and id in (${openIds.map(() => "?").join(",")})`,
    [userId, ...openIds],
  );
}

async function listSourcePropertyBatchApplyRows(
  userId: string,
  input: {
    sourceDatabase?: string | null;
    canonicalEntityType?: string | null;
    documentRole?: string | null;
    documentStatus?: string | null;
    propertyName: string;
    propertyType?: string | null;
    limit: number;
  },
) {
  const conditions = [
    "sd.user_id = ?",
    "sd.deleted_at is null",
    "sdp.property_name = ?",
    "sdp.value_text is not null",
    "trim(sdp.value_text) <> ''",
  ];
  const params: unknown[] = [userId, input.propertyName];
  addNullableCondition(conditions, params, "sd.source_database", input.sourceDatabase);
  addNullableCondition(conditions, params, "sd.canonical_entity_type", input.canonicalEntityType);
  addNullableCondition(conditions, params, "sd.document_role", input.documentRole);
  addNullableCondition(conditions, params, "sd.status", input.documentStatus);
  addNullableCondition(conditions, params, "sdp.property_type", input.propertyType);

  const result = await queryD1<SourcePropertyBatchApplyRow>(
    `select
       sd.id as sourceDocumentId,
       sd.canonical_entity_type as canonicalEntityType,
       sd.canonical_entity_id as canonicalEntityId,
       sdp.value_text as valueText,
       sdp.normalized_value as normalizedValue
     from source_documents sd
     inner join source_document_properties sdp on sdp.source_document_id = sd.id
     where ${conditions.join(" and ")}
     order by sd.updated_at desc
     limit ${input.limit}`,
    params,
  );
  return result.rows;
}

async function listSourcePropertyReviewDocuments(userId: string, scope: SourcePropertyReviewScope) {
  const conditions = [
    "sd.user_id = ?",
    "sd.deleted_at is null",
    "sdp.property_name = ?",
    "sdp.value_text is not null",
    "trim(sdp.value_text) <> ''",
  ];
  const params: unknown[] = [userId, scope.propertyName];
  addOptionalCondition(conditions, params, "sd.source_database", scope.sourceDatabase);
  addOptionalCondition(conditions, params, "sd.canonical_entity_type", scope.canonicalEntityType);
  addOptionalCondition(conditions, params, "sd.document_role", scope.documentRole);
  addOptionalCondition(conditions, params, "sd.status", scope.documentStatus);
  addOptionalCondition(conditions, params, "sdp.property_type", scope.propertyType);

  const result = await queryD1<SourcePropertyReviewDocumentRow>(
    `select distinct
       sd.id as sourceDocumentId,
       sd.source_database as sourceDatabase,
       sd.canonical_entity_type as canonicalEntityType,
       sd.canonical_entity_id as canonicalEntityId,
       sd.document_role as documentRole,
       sd.status as documentStatus,
       sd.title
     from source_documents sd
     inner join source_document_properties sdp on sdp.source_document_id = sd.id
     where ${conditions.join(" and ")}
     order by sd.updated_at desc
     limit ${SOURCE_PROPERTY_REVIEW_LIMIT}`,
    params,
  );
  return result.rows;
}

async function listSourcePropertyReviewRows(userId: string) {
  try {
    const result = await queryD1<SourcePropertyReviewRow>(
      `select id, source_document_id as sourceDocumentId, status, payload, updated_at as updatedAt
       from migration_review_items
       where user_id = ?
         and issue_type = ?
         and deleted_at is null`,
      [userId, SOURCE_PROPERTY_REVIEW_ISSUE_TYPE],
    );
    return result.rows;
  } catch {
    return [];
  }
}

function sourcePropertyReviewIndex(rows: SourcePropertyReviewRow[]) {
  const index = new Map<string, SourcePropertyReviewIndexValue>();
  for (const row of rows) {
    const payload = parseSourcePropertyReviewPayload(row.payload);
    if (!payload) continue;
    const key = sourcePropertyReviewKey(payload.scope);
    const current = index.get(key) ?? emptySourcePropertyReview();
    index.set(key, {
      openCount: current.openCount + (row.status === "open" ? 1 : 0),
      totalCount: current.totalCount + 1,
      sampleReviewItemId: current.sampleReviewItemId ?? row.id,
      updatedAt: maxUpdatedAt(current.updatedAt, row.updatedAt),
    });
  }
  return index;
}

function emptySourcePropertyReview(): SourcePropertyReviewIndexValue {
  return {
    openCount: 0,
    totalCount: 0,
    sampleReviewItemId: null,
    updatedAt: null,
  };
}

function parseSourcePropertyReviewPayload(value: string | null): SourcePropertyReviewPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SourcePropertyReviewPayload>;
    if (parsed.kind !== "source_property_mapping" || !parsed.scope?.propertyName) return null;
    return parsed as SourcePropertyReviewPayload;
  } catch {
    return null;
  }
}

function stringifySourcePropertyReviewPayload(scope: SourcePropertyReviewScope, document: SourcePropertyReviewDocumentRow) {
  return JSON.stringify({
    kind: "source_property_mapping",
    scope,
    sourceDocument: {
      id: document.sourceDocumentId,
      sourceDatabase: document.sourceDatabase,
      canonicalEntityType: document.canonicalEntityType,
      canonicalEntityId: document.canonicalEntityId,
      documentRole: document.documentRole,
      documentStatus: document.documentStatus,
      title: document.title,
    },
  } satisfies SourcePropertyReviewPayload);
}

function sourcePropertyReviewKey(scope: {
  sourceDatabase?: string | null;
  canonicalEntityType?: string | null;
  documentRole?: string | null;
  documentStatus?: string | null;
  propertyName: string;
  propertyType?: string | null;
}) {
  return [
    sourceMappingScopeValue(scope.sourceDatabase),
    sourceMappingScopeValue(scope.canonicalEntityType),
    sourceMappingScopeValue(scope.documentRole),
    sourceMappingScopeValue(scope.documentStatus),
    scope.propertyName.trim(),
    sourceMappingScopeValue(scope.propertyType),
  ].join("|");
}

function sourcePropertyReviewAction(scope: SourcePropertyReviewScope) {
  const entity = scope.canonicalEntityType === "*" ? "표준 엔티티" : entityLabel(scope.canonicalEntityType);
  const target = scope.displayLabel ?? scope.targetField;
  return target
    ? `${entity} 원본 컬럼 "${scope.propertyName}"을 "${target}" 속성으로 적용할지 검토`
    : `${entity} 원본 컬럼 "${scope.propertyName}" 매핑 검토`;
}

function addOptionalCondition(conditions: string[], params: unknown[], column: string, value: string) {
  if (value === "*") return;
  conditions.push(`coalesce(${column}, '') = ?`);
  params.push(value);
}

function addNullableCondition(conditions: string[], params: unknown[], column: string, value: string | null | undefined) {
  if (value === undefined) return;
  if (value === null || value === "") {
    conditions.push(`${column} is null`);
    return;
  }
  conditions.push(`${column} = ?`);
  params.push(value);
}

function maxUpdatedAt(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function normalizeBatchApplyValue(
  rawValue: string | null | undefined,
  definition: PropertyDefinition,
  fieldConfig: BatchApplyFieldConfig,
): { ok: true; value: string | number | null } | { ok: false } {
  const text = rawValue?.trim() ?? "";
  if (!text && !definition.allowEmpty) return { ok: false };

  if (fieldConfig.storage === "json" || definition.valueType === "multiSelect") {
    const values = normalizeStringList(text);
    return values.length || definition.allowEmpty ? { ok: true, value: values.length ? JSON.stringify(values) : null } : { ok: false };
  }

  if (fieldConfig.storage === "boolean" || definition.valueType === "boolean") {
    const value = normalizeBoolean(text);
    return value === null ? { ok: false } : { ok: true, value };
  }

  if (fieldConfig.storage === "number" || definition.valueType === "number") {
    const value = normalizeNumber(text);
    return value === null ? { ok: false } : { ok: true, value };
  }

  if (definition.valueType === "date") {
    const value = normalizeDate(text);
    return value || definition.allowEmpty ? { ok: true, value: value || null } : { ok: false };
  }

  if (definition.valueType === "select" && definition.options?.length) {
    const value = normalizeSelectValue(text, definition);
    return value || definition.allowEmpty ? { ok: true, value: value || null } : { ok: false };
  }

  return text || definition.allowEmpty ? { ok: true, value: text || null } : { ok: false };
}

function normalizeSelectValue(value: string, definition: PropertyDefinition) {
  const normalized = normalizeComparableValue(value);
  const option = definition.options?.find((item) => {
    const optionValue = normalizeComparableValue(item.value);
    const optionLabel = normalizeComparableValue(item.label);
    return normalized === optionValue || normalized === optionLabel;
  });
  return option?.value ?? "";
}

function normalizeBoolean(value: string) {
  const normalized = normalizeComparableValue(value);
  if (["1", "true", "yes", "y", "on", "checked", "예", "네", "있음", "완료", "참"].includes(normalized)) return 1;
  if (["0", "false", "no", "n", "off", "unchecked", "아니오", "아님", "없음", "미완료", "거짓"].includes(normalized)) return 0;
  return null;
}

function normalizeNumber(value: string) {
  const matched = value.replaceAll(",", "").match(/-?\d+(\.\d+)?/);
  if (!matched) return null;
  const number = Number(matched[0]);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  const iso = trimmed.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return "";
}

function normalizeStringList(value: string) {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Legacy exports frequently store multi-select values as plain delimited text.
  }
  return value
    .split(/[,;\n|]+/)
    .map((item) => item.replace(/^#/, "").trim())
    .filter(Boolean);
}

function normalizeComparableValue(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

function definitionsForSourceEntity(entityType: string | null | undefined) {
  const propertyEntityType = propertyEntityTypeFor(entityType);
  return propertyEntityType ? propertyDefinitionsFor(propertyEntityType) : ALL_PROPERTY_DEFINITIONS;
}

function propertyEntityTypeFor(entityType: string | null | undefined): PropertyEntityType | null {
  if (!entityType) return null;
  if (entityType === "daily_entry") return "daily_log_entry";
  if (PROPERTY_ENTITY_TYPE_SET.has(entityType)) return entityType as PropertyEntityType;
  return null;
}

function targetOptionsFor(entityType: string | null | undefined): SourceWorkbenchTargetOption[] {
  const definitions = definitionsForSourceEntity(entityType);
  const scoped = propertyEntityTypeFor(entityType) ? definitions : uniqueDefinitionsByField(definitions);
  return scoped.map((definition) => ({
    value: definition.field,
    label: definition.label,
    group: entityLabel(definition.entityType),
  }));
}

function uniqueDefinitionsByField(definitions: PropertyDefinition[]) {
  const seen = new Set<string>();
  return definitions.filter((definition) => {
    if (seen.has(definition.field)) return false;
    seen.add(definition.field);
    return true;
  });
}

function entityLabel(entityType: string) {
  return ENTITY_LABELS[entityType] ?? entityType;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "ko-KR"));
}
