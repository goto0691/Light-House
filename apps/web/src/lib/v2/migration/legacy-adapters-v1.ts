export type LegacyColumnDisposition = "source_text" | "typed_projection" | "metadata_preserved" | "excluded" | "manual_review";

export type LegacyProjectionDraft = Readonly<{
  key: string;
  title: string;
  bodyMarkdown: string;
  writtenAt: string | null;
  typeKey: string;
  typeLabel: string;
  privacyLevel: "normal" | "sensitive" | "restricted";
  lifecycleStatus: "active" | "archived";
  properties: readonly Readonly<{ key: string; label: string; dataType: "rating" | "integer" | "decimal" | "date" | "short_text"; valueKind: "rating" | "number" | "date" | "text"; value: string | number }>[];
}>;

export type LegacyAdapterV1 = Readonly<{
  table: string;
  version: string;
  identityColumns?: readonly string[];
  scopeFrom?: string;
  scopeUserColumn?: string;
  sourceTextFields: readonly string[];
  jsonFields: readonly string[];
  columnCoverage: Readonly<Record<string, LegacyColumnDisposition>>;
  project: (row: Readonly<Record<string, unknown>>) => readonly LegacyProjectionDraft[];
}>;

export function legacyIdentityValues(adapter: LegacyAdapterV1, legacyId: string) {
  const columns = adapter.identityColumns ?? ["id"];
  if (columns.length === 1) return [legacyId];
  let parsed: unknown;
  try { parsed = JSON.parse(legacyId); } catch { throw new Error(`Composite identity for ${adapter.table} must be a JSON array.`); }
  if (!Array.isArray(parsed) || parsed.length !== columns.length || parsed.some((value) => typeof value !== "string" && typeof value !== "number")) throw new Error(`Composite identity for ${adapter.table} is invalid.`);
  return parsed;
}

const common = { id: "metadata_preserved", user_id: "metadata_preserved", created_at: "metadata_preserved", updated_at: "metadata_preserved", deleted_at: "metadata_preserved", notion_source_id: "metadata_preserved", import_batch_id: "metadata_preserved" } as const;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const lifecycleStatus = (row: Readonly<Record<string, unknown>>) => text(row.deleted_at) ? "archived" as const : "active" as const;

function coverage(columns: readonly string[], sourceTextFields: readonly string[] = [], typedFields: readonly string[] = [], excludedFields: readonly string[] = []) {
  return Object.fromEntries(columns.map((column) => [column, excludedFields.includes(column) ? "excluded" : sourceTextFields.includes(column) ? "source_text" : typedFields.includes(column) ? "typed_projection" : "metadata_preserved"])) as Record<string, LegacyColumnDisposition>;
}

function documentAdapter(input: {
  table: string; columns: readonly string[]; sourceTextFields: readonly string[]; typedFields?: readonly string[]; jsonFields?: readonly string[];
  version?: string;
  title: (row: Readonly<Record<string, unknown>>) => string; writtenAt: (row: Readonly<Record<string, unknown>>) => string | null;
  typeKey: string; typeLabel: string; privacyLevel?: LegacyProjectionDraft["privacyLevel"];
  properties?: (row: Readonly<Record<string, unknown>>) => LegacyProjectionDraft["properties"];
  projectWithoutSourceText?: boolean;
  identityColumns?: readonly string[]; scopeFrom?: string; scopeUserColumn?: string;
}): LegacyAdapterV1 {
  return {
    table: input.table, version: input.version ?? `${input.table}_v1`, identityColumns: input.identityColumns, scopeFrom: input.scopeFrom, scopeUserColumn: input.scopeUserColumn,
    sourceTextFields: input.sourceTextFields, jsonFields: input.jsonFields ?? [], columnCoverage: coverage(input.columns, input.sourceTextFields, input.typedFields),
    project: (row) => {
      const bodyMarkdown = input.sourceTextFields.map((field) => text(row[field])).filter(Boolean).join("\n\n");
      const properties = input.properties?.(row) ?? [];
      if (!bodyMarkdown && !input.projectWithoutSourceText && !properties.length) return [];
      return [{ key: "document", title: input.title(row), bodyMarkdown, writtenAt: input.writtenAt(row), typeKey: input.typeKey, typeLabel: input.typeLabel, privacyLevel: input.privacyLevel ?? "normal", lifecycleStatus: lifecycleStatus(row), properties }];
    },
  };
}

function archivedAdapter(input: { table: string; columns: readonly string[]; version?: string; excludedFields?: readonly string[]; identityColumns?: readonly string[]; scopeFrom?: string; scopeUserColumn?: string }): LegacyAdapterV1 {
  return { table: input.table, version: input.version ?? `${input.table}_archive_v1`, identityColumns: input.identityColumns, scopeFrom: input.scopeFrom, scopeUserColumn: input.scopeUserColumn, sourceTextFields: [], jsonFields: [], columnCoverage: coverage(input.columns, [], [], input.excludedFields), project: () => [] };
}

const integerProperty = (row: Readonly<Record<string, unknown>>, key: string, label: string) => { const value = number(row[key]); return value === null ? [] : [{ key, label, dataType: "integer" as const, valueKind: "number" as const, value }]; };
const decimalProperty = (row: Readonly<Record<string, unknown>>, key: string, label: string) => { const value = number(row[key]); return value === null ? [] : [{ key, label, dataType: "decimal" as const, valueKind: "number" as const, value }]; };

export const LEGACY_ADAPTERS_V1: readonly LegacyAdapterV1[] = [
  {
    table: "zettels", version: "zettels_v2", sourceTextFields: ["content", "content_text", "summary"], jsonFields: ["aliases"],
    columnCoverage: { ...common, title: "source_text", slug: "metadata_preserved", content: "source_text", content_text: "source_text", summary: "source_text", type: "typed_projection", category: "typed_projection", source: "metadata_preserved", source_url: "metadata_preserved", vector_id: "excluded", vector_hash: "excluded", pinned: "metadata_preserved", source_document_id: "metadata_preserved", status: "typed_projection", document_kind: "typed_projection", original_created_at: "typed_projection", aliases: "metadata_preserved", source_reliability: "metadata_preserved", review_cadence: "metadata_preserved", review_due_at: "metadata_preserved" },
    project: (row) => [{ key: "document", title: text(row.title) || "가져온 글", bodyMarkdown: text(row.content) || text(row.content_text) || text(row.summary), writtenAt: text(row.original_created_at) || text(row.created_at) || null, typeKey: text(row.category) ? `imported_zettel_${text(row.category).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "_")}` : "imported_zettel", typeLabel: text(row.category) || "가져온 글", privacyLevel: "normal", lifecycleStatus: lifecycleStatus(row), properties: [] }],
  },
  {
    table: "media_logs", version: "media_logs_v2", sourceTextFields: ["review", "content", "evaluation", "relation_note"], jsonFields: [],
    columnCoverage: { ...common, media_type: "typed_projection", title: "source_text", original_title: "metadata_preserved", platform_or_publisher: "metadata_preserved", creator: "typed_projection", studio: "typed_projection", genre: "typed_projection", release_year: "typed_projection", status: "metadata_preserved", rating: "typed_projection", evaluation: "source_text", review: "source_text", content: "source_text", play_time: "typed_projection", author: "typed_projection", pages: "typed_projection", screen_kind: "metadata_preserved", rewatch_value: "typed_projection", cover_image_url: "metadata_preserved", started_at: "typed_projection", completed_at: "typed_projection", source_document_id: "metadata_preserved", subtype: "typed_projection", relation_note: "source_text", logged_at: "typed_projection" },
    project: (row) => {
      const body = [text(row.review), text(row.content), text(row.evaluation), text(row.relation_note)].filter(Boolean).join("\n\n");
      const rating = number(row.rating);
      return [{ key: "review", title: text(row.title) || "가져온 작품 기록", bodyMarkdown: body, writtenAt: text(row.logged_at) || text(row.completed_at) || text(row.started_at) || text(row.created_at) || null, typeKey: `${text(row.media_type) || "media"}_review`, typeLabel: `${text(row.media_type) || "미디어"} 리뷰`, privacyLevel: "normal", lifecycleStatus: lifecycleStatus(row), properties: rating === null ? [] : [{ key: "user_rating", label: "내 평점", dataType: "rating", valueKind: "rating", value: rating }] }];
    },
  },
  {
    table: "daily_logs", version: "daily_logs_v2", sourceTextFields: ["journal", "meditation", "meditation_verse", "gratitude"], jsonFields: ["emotions"],
    columnCoverage: { ...common, date: "typed_projection", mood: "typed_projection", energy_level: "typed_projection", emotions: "metadata_preserved", gratitude: "source_text", journal: "source_text", meditation: "source_text", meditation_verse: "source_text", ai_summary: "metadata_preserved", source_document_id: "metadata_preserved" },
    project: (row) => [
      ...(text(row.journal) || text(row.gratitude) ? [{ key: "journal", title: `${text(row.date)} 일기`, bodyMarkdown: [text(row.journal), text(row.gratitude) && `## 감사\n\n${text(row.gratitude)}`].filter(Boolean).join("\n\n"), writtenAt: text(row.date) || null, typeKey: "diary", typeLabel: "일기", privacyLevel: "sensitive" as const, lifecycleStatus: lifecycleStatus(row), properties: [] }] : []),
      ...(text(row.meditation) || text(row.meditation_verse) ? [{ key: "meditation", title: `${text(row.date)} 묵상`, bodyMarkdown: [text(row.meditation_verse) && `> ${text(row.meditation_verse)}`, text(row.meditation)].filter(Boolean).join("\n\n"), writtenAt: text(row.date) || null, typeKey: "meditation", typeLabel: "묵상", privacyLevel: "normal" as const, lifecycleStatus: lifecycleStatus(row), properties: [] }] : []),
    ],
  },
  {
    table: "workouts", version: "workouts_v2", sourceTextFields: ["notes", "categories"], jsonFields: ["categories"],
    columnCoverage: { ...common, date: "typed_projection", categories: "source_text", duration_minutes: "typed_projection", intensity: "typed_projection", notes: "source_text", source_document_id: "metadata_preserved", title: "source_text" },
    project: (row) => {
      const duration = number(row.duration_minutes); const intensity = number(row.intensity);
      return [{ key: "workout", title: text(row.title) || `${text(row.date)} 운동`, bodyMarkdown: [text(row.categories), text(row.notes)].filter(Boolean).join("\n\n"), writtenAt: text(row.date) || null, typeKey: "workout_log", typeLabel: "운동 기록", privacyLevel: "normal", lifecycleStatus: lifecycleStatus(row), properties: [
        ...(duration === null ? [] : [{ key: "duration_minutes", label: "운동 시간", dataType: "integer" as const, valueKind: "number" as const, value: duration }]),
        ...(intensity === null ? [] : [{ key: "intensity", label: "운동 강도", dataType: "integer" as const, valueKind: "number" as const, value: intensity }]),
      ] }];
    },
  },
  {
    table: "quick_captures", version: "quick_captures_v1", sourceTextFields: ["raw_text"], jsonFields: ["suggested_fields"],
    columnCoverage: { ...common, raw_text: "source_text", status: "metadata_preserved", suggested_domain: "manual_review", suggested_fields: "manual_review", confidence: "metadata_preserved", routed_entity_type: "metadata_preserved", routed_entity_id: "metadata_preserved" },
    project: (row) => [{ key: "capture", title: "가져온 빠른 기록", bodyMarkdown: text(row.raw_text), writtenAt: text(row.created_at) || null, typeKey: "unclassified", typeLabel: "미분류", privacyLevel: "normal", lifecycleStatus: lifecycleStatus(row), properties: [] }],
  },
  documentAdapter({ table: "checklists", columns: ["id","task_id","content","is_completed","display_order","completed_at","created_at"], sourceTextFields: ["content"], typedFields: ["is_completed","completed_at"], title: () => "가져온 체크리스트 항목", writtenAt: (row) => text(row.completed_at) || text(row.created_at) || null, typeKey: "checklist_item", typeLabel: "체크리스트", identityColumns: ["id"], scopeFrom: "checklists legacy join tasks scope_parent on scope_parent.id=legacy.task_id", scopeUserColumn: "scope_parent.user_id" }),
  documentAdapter({ table: "projects", version: "projects_v2", columns: ["id","user_id","title","slug","description","icon","color","kind","status","category","start_date","target_date","progress","pinned","display_order","created_at","updated_at","deleted_at","notion_source_id","import_batch_id","source_document_id","importance","brain_energy","artifact_url"], sourceTextFields: ["description"], typedFields: ["kind","status","category","start_date","target_date","progress","importance","brain_energy"], title: (row) => text(row.title) || "가져온 프로젝트", writtenAt: (row) => text(row.created_at) || null, typeKey: "project_note", typeLabel: "프로젝트 기록" }),
  documentAdapter({ table: "tasks", version: "tasks_v2", columns: ["id","user_id","project_id","title","kind","content","status","priority","brain_energy","start_at","due_at","completed_at","display_order","word_count","episode_number","created_at","updated_at","deleted_at","notion_source_id","import_batch_id"], sourceTextFields: ["content"], typedFields: ["kind","status","priority","start_at","due_at","completed_at"], title: (row) => text(row.title) || "가져온 할 일", writtenAt: (row) => text(row.completed_at) || text(row.created_at) || null, typeKey: "task_note", typeLabel: "할 일 기록" }),
  documentAdapter({ table: "career_history", version: "career_history_v2", columns: ["id","user_id","organization","role","category","start_date","end_date","location","description","highlights","cover_image_url","created_at","updated_at","deleted_at","notion_source_id","import_batch_id","source_document_id"], sourceTextFields: ["description","highlights"], typedFields: ["organization","role","category","start_date","end_date","location"], title: (row) => `${text(row.organization)} ${text(row.role)}`.trim() || "가져온 경력", writtenAt: (row) => text(row.start_date) || text(row.created_at) || null, typeKey: "career_record", typeLabel: "경력 기록" }),
  documentAdapter({ table: "habit_logs", columns: ["id","user_id","habit_id","date","value","note","created_at"], sourceTextFields: ["note"], typedFields: ["date","value"], title: (row) => `${text(row.date)} 습관 기록`, writtenAt: (row) => text(row.date) || null, typeKey: "habit_log", typeLabel: "습관 기록", properties: (row) => integerProperty(row, "value", "실행 값") }),
  documentAdapter({ table: "habits", columns: ["id","user_id","title","description","type","target_value","unit","icon","color","schedule","is_active","display_order","created_at","updated_at","deleted_at"], sourceTextFields: ["description"], typedFields: ["type","target_value","unit","schedule","is_active"], title: (row) => text(row.title) || "가져온 습관", writtenAt: (row) => text(row.created_at) || null, typeKey: "habit_definition", typeLabel: "습관" }),
  documentAdapter({ table: "health_metrics", columns: ["id","user_id","date","sleep_hours","sleep_quality","weight","resting_heart_rate","deep_work_minutes","steps_count","notes","created_at","updated_at"], sourceTextFields: ["notes"], typedFields: ["date","sleep_hours","sleep_quality","weight","resting_heart_rate","deep_work_minutes","steps_count"], title: (row) => `${text(row.date)} 건강 기록`, writtenAt: (row) => text(row.date) || null, typeKey: "health_log", typeLabel: "건강 기록", privacyLevel: "sensitive", properties: (row) => [...decimalProperty(row,"sleep_hours","수면 시간"),...integerProperty(row,"sleep_quality","수면 품질"),...decimalProperty(row,"weight","체중"),...integerProperty(row,"resting_heart_rate","안정 심박수"),...integerProperty(row,"deep_work_minutes","몰입 시간"),...integerProperty(row,"steps_count","걸음 수")] }),
  documentAdapter({ table: "gifts", version: "gifts_v2", columns: ["id","user_id","person_id","direction","title","occurred_at","reason","cost","satisfaction","options","image_url","notes","created_at","updated_at","deleted_at","notion_source_id","import_batch_id"], sourceTextFields: ["reason","notes"], typedFields: ["direction","occurred_at","cost","satisfaction"], jsonFields: ["options"], title: (row) => text(row.title) || "가져온 선물 기록", writtenAt: (row) => text(row.occurred_at) || null, typeKey: "gift_record", typeLabel: "선물 기록", privacyLevel: "sensitive", properties: (row) => integerProperty(row,"cost","금액"), projectWithoutSourceText: true }),
  documentAdapter({ table: "interactions", columns: ["id","user_id","person_id","occurred_at","type","intensity","summary","content","protocol","place_id","created_at","updated_at","deleted_at"], sourceTextFields: ["summary","content","protocol"], typedFields: ["occurred_at","type","intensity"], title: (row) => `${text(row.occurred_at)} 대화·만남`, writtenAt: (row) => text(row.occurred_at) || null, typeKey: "interaction_record", typeLabel: "대화·만남 기록", privacyLevel: "sensitive", properties: (row) => integerProperty(row,"intensity","강도"), projectWithoutSourceText: true }),
  documentAdapter({ table: "network_edges", columns: ["id","user_id","source_person_id","target_person_id","relation_type","strength","notes","created_at","updated_at","deleted_at"], sourceTextFields: ["notes"], typedFields: ["relation_type","strength"], title: () => "가져온 관계 기록", writtenAt: (row) => text(row.created_at) || null, typeKey: "relationship_note", typeLabel: "관계 기록", privacyLevel: "sensitive", properties: (row) => integerProperty(row,"strength","관계 강도") }),
  documentAdapter({ table: "people", version: "people_v2", columns: ["id","user_id","name","nickname","birth_date","photo_url","groups","dunbar_layer","intimacy","core_value","bio","last_contacted_at","contact_cadence_days","phone","email","address","social_links","status","is_favorite","created_at","updated_at","deleted_at","notion_source_id","import_batch_id","source_document_id","aliases","birthday_memo","profile_body"], sourceTextFields: ["core_value","bio","birthday_memo","profile_body"], typedFields: ["name","nickname","birth_date","groups","dunbar_layer","intimacy","last_contacted_at","contact_cadence_days","status"], jsonFields: ["groups","social_links","aliases"], title: (row) => text(row.name) || "가져온 인물 기록", writtenAt: (row) => text(row.created_at) || null, typeKey: "person_note", typeLabel: "인물 기록", privacyLevel: "sensitive" }),
  documentAdapter({ table: "assets", columns: ["id","user_id","category","name","brand","model_name","acquired_date","acquired_price","current_condition","notes","cover_image_url","created_at","updated_at","deleted_at"], sourceTextFields: ["notes"], typedFields: ["category","brand","model_name","acquired_date","acquired_price","current_condition"], title: (row) => text(row.name) || "가져온 물건 기록", writtenAt: (row) => text(row.acquired_date) || text(row.created_at) || null, typeKey: "asset_record", typeLabel: "물건 기록", properties: (row) => integerProperty(row,"acquired_price","구입 가격") }),
  documentAdapter({ table: "place_visits", columns: ["id","place_id","visited_at","rating","review","companion_ids","expense","created_at"], sourceTextFields: ["review"], typedFields: ["visited_at","rating","expense"], jsonFields: ["companion_ids"], title: (row) => `${text(row.visited_at)} 장소 방문`, writtenAt: (row) => text(row.visited_at) || null, typeKey: "place_visit", typeLabel: "장소 방문", privacyLevel: "sensitive", properties: (row) => { const rating = number(row.rating); return [...(rating === null ? [] : [{ key: "user_rating", label: "내 평점", dataType: "rating" as const, valueKind: "rating" as const, value: rating }]),...integerProperty(row,"expense","지출")]; }, scopeFrom: "place_visits legacy join places scope_parent on scope_parent.id=legacy.place_id", scopeUserColumn: "scope_parent.user_id" }),
  documentAdapter({ table: "places", columns: ["id","user_id","name","category","address","latitude","longitude","map_url","first_visited_at","last_visited_at","visit_count","average_rating","notes","created_at","updated_at","deleted_at"], sourceTextFields: ["notes"], typedFields: ["category","address","latitude","longitude","first_visited_at","last_visited_at","visit_count","average_rating"], title: (row) => text(row.name) || "가져온 장소", writtenAt: (row) => text(row.first_visited_at) || text(row.created_at) || null, typeKey: "place_note", typeLabel: "장소 기록" }),
  documentAdapter({ table: "source_documents", columns: ["id","user_id","source_type","source_id","import_batch_id","source_database","title","document_role","canonical_entity_type","canonical_entity_id","status","url","raw_properties","raw_content_preview","resolved_at","created_at","updated_at","deleted_at","source_path","raw_content","raw_content_hash"], sourceTextFields: ["raw_content","raw_content_preview"], typedFields: ["source_type","document_role","canonical_entity_type","status","resolved_at"], jsonFields: ["raw_properties"], title: (row) => text(row.title) || "가져온 원본 문서", writtenAt: (row) => text(row.created_at) || null, typeKey: "imported_source_document", typeLabel: "가져온 원본", projectWithoutSourceText: false }),
  documentAdapter({ table: "media_records", columns: ["id","user_id","media_id","recorded_at","record_kind","status_at_time","progress_text","duration_minutes","rating","note","import_receipt_id","created_at","updated_at","deleted_at"], sourceTextFields: ["note","progress_text"], typedFields: ["recorded_at","record_kind","status_at_time","duration_minutes","rating"], title: (row) => `${text(row.recorded_at)} 미디어 기록`.trim(), writtenAt: (row) => text(row.recorded_at) || text(row.created_at) || null, typeKey: "media_activity", typeLabel: "미디어 활동", properties: (row) => { const rating = number(row.rating); return [...(rating === null ? [] : [{ key: "user_rating", label: "내 평점", dataType: "rating" as const, valueKind: "rating" as const, value: rating }]),...integerProperty(row,"duration_minutes","감상 시간")]; }, projectWithoutSourceText: true }),
  documentAdapter({ table: "daily_log_entries", columns: ["id","user_id","daily_log_id","source_document_id","kind","title","date","body","emotion","event_summary","verse","background","tags_snapshot","created_at","updated_at","deleted_at"], sourceTextFields: ["body","event_summary","verse","background","emotion"], typedFields: ["kind","date"], jsonFields: ["tags_snapshot"], title: (row) => text(row.title) || `${text(row.date)} ${text(row.kind) || "기록"}`.trim(), writtenAt: (row) => text(row.date) || text(row.created_at) || null, typeKey: "daily_log_entry", typeLabel: "일상 기록", privacyLevel: "sensitive" }),
  archivedAdapter({ table: "task_people_relations", version: "task_people_relations_archive_v2", columns: ["task_id","person_id","role_context","created_at","source_document_id","confidence","raw_value"], identityColumns: ["task_id","person_id"], scopeFrom: "task_people_relations legacy join tasks scope_parent on scope_parent.id=legacy.task_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "task_zettel_relations", version: "task_zettel_relations_archive_v2", columns: ["task_id","zettel_id","created_at","source_document_id","confidence","raw_value"], identityColumns: ["task_id","zettel_id"], scopeFrom: "task_zettel_relations legacy join tasks scope_parent on scope_parent.id=legacy.task_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "ai_conversations", columns: ["id","user_id","purpose","input","output","model","input_tokens","output_tokens","latency_ms","created_at"] }),
  archivedAdapter({ table: "attachments", columns: ["id","user_id","owner_type","owner_id","kind","r2_key","cdn_url","filename","mime_type","size_bytes","meta","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "audit_logs", version: "audit_logs_archive_v2", columns: ["id","user_id","action","entity_type","entity_id","snapshot","created_at","import_batch_id"] }),
  archivedAdapter({ table: "taggings", columns: ["id","tag_id","taggable_type","taggable_id","created_at"], scopeFrom: "taggings legacy join tags scope_parent on scope_parent.id=legacy.tag_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "tags", columns: ["id","user_id","name","slug","color","parent_id","usage_count","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "media_people_relations", version: "media_people_relations_archive_v2", columns: ["media_id","person_id","context","created_at","source_document_id","confidence","raw_value"], identityColumns: ["media_id","person_id"], scopeFrom: "media_people_relations legacy join media_logs scope_parent on scope_parent.id=legacy.media_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "zettel_links", columns: ["id","source_id","target_id","context","created_at"], scopeFrom: "zettel_links legacy join zettels scope_parent on scope_parent.id=legacy.source_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "zettel_media_relations", version: "zettel_media_relations_archive_v2", columns: ["zettel_id","media_id","created_at","source_document_id","confidence","raw_value"], identityColumns: ["zettel_id","media_id"], scopeFrom: "zettel_media_relations legacy join zettels scope_parent on scope_parent.id=legacy.zettel_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "zettel_people_relations", version: "zettel_people_relations_archive_v2", columns: ["zettel_id","person_id","context","created_at","source_document_id","confidence","raw_value"], identityColumns: ["zettel_id","person_id"], scopeFrom: "zettel_people_relations legacy join zettels scope_parent on scope_parent.id=legacy.zettel_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "notifications", columns: ["id","user_id","kind","title","body","entity_type","entity_id","read_at","created_at"] }),
  archivedAdapter({ table: "saved_views", columns: ["id","user_id","domain","scope","name","icon","search_query","filter_state","sort_state","view_key","is_default","display_order","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "widget_layouts", columns: ["id","user_id","page_key","widget_key","title_override","layout","is_hidden","display_order","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "shortcut_bindings", columns: ["id","user_id","category","action_key","label","binding","is_enabled","is_custom","display_order","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "backup_snapshots", columns: ["id","user_id","provider","bucket_key","format","status","size_bytes","checksum","expires_at","restored_at","meta","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "import_jobs", columns: ["id","user_id","source_type","file_name","status","mapping_config","preview_summary","result_summary","progress_percent","started_at","finished_at","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "collection_views", columns: ["id","user_id","collection_key","name","slug","layout","density","filter_json","sort_json","group_json","search_query","is_default","is_system","display_order","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "daily_entry_people_relations", columns: ["daily_entry_id","person_id","context","source_document_id","confidence","raw_value","created_at"], identityColumns: ["daily_entry_id","person_id"], scopeFrom: "daily_entry_people_relations legacy join daily_log_entries scope_parent on scope_parent.id=legacy.daily_entry_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "daily_log_people_relations", columns: ["daily_log_id","person_id","context","created_at","source_document_id","confidence","raw_value"], identityColumns: ["rowid"], scopeFrom: "daily_log_people_relations legacy join daily_logs scope_parent on scope_parent.id=legacy.daily_log_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "entity_links", columns: ["id","user_id","source_type","source_id","target_type","target_id","relation_type","context","source_document_id","confidence","raw_value","created_at"] }),
  archivedAdapter({ table: "entity_property_values", columns: ["id","property_id","entity_type","entity_id","value_text","value_number","value_date","value_json","value_bool","created_at","updated_at","deleted_at"], scopeFrom: "entity_property_values legacy join property_definitions scope_parent on scope_parent.id=legacy.property_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "entity_relations", columns: ["id","user_id","from_type","from_id","to_type","to_id","relation_type","context","strength","privacy_level","import_receipt_id","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "import_batches", columns: ["id","user_id","kind","status","label","input_summary_json","result_summary_json","started_at","finished_at","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "import_receipts", columns: ["id","user_id","batch_id","native_entity_type","native_entity_id","input_kind","input_title","input_path_hash","input_database_hint","raw_properties_json","raw_body_hash","decision","decision_reason","created_at"] }),
  archivedAdapter({ table: "migration_review_items", columns: ["id","user_id","source_document_id","entity_type","entity_id","issue_type","suggested_action","confidence","status","reason","payload","resolved_at","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "project_people_relations", columns: ["project_id","person_id","role_context","source_document_id","confidence","raw_value","created_at"], identityColumns: ["project_id","person_id"], scopeFrom: "project_people_relations legacy join projects scope_parent on scope_parent.id=legacy.project_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "project_zettel_relations", columns: ["project_id","zettel_id","context","source_document_id","confidence","raw_value","created_at"], identityColumns: ["project_id","zettel_id"], scopeFrom: "project_zettel_relations legacy join projects scope_parent on scope_parent.id=legacy.project_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "property_definitions", columns: ["id","user_id","collection_key","key","label","type","description","default_hidden","is_archived","display_order","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "property_options", columns: ["id","property_id","label","value","color","display_order","is_archived","created_at","updated_at","deleted_at"], scopeFrom: "property_options legacy join property_definitions scope_parent on scope_parent.id=legacy.property_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "source_document_properties", columns: ["id","source_document_id","property_key","property_name","property_type","value_text","value_json","normalized_value","created_at"], scopeFrom: "source_document_properties legacy join source_documents scope_parent on scope_parent.id=legacy.source_document_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "source_document_relations", columns: ["id","source_document_id","relation_name","target_source_id","target_title","resolved_entity_type","resolved_entity_id","confidence","created_at"], scopeFrom: "source_document_relations legacy join source_documents scope_parent on scope_parent.id=legacy.source_document_id", scopeUserColumn: "scope_parent.user_id" }),
  archivedAdapter({ table: "source_property_mappings", columns: ["id","user_id","source_database","canonical_entity_type","property_name","property_type","status","target_field","display_label","reason","confidence","created_at","updated_at","deleted_at"] }),
  archivedAdapter({ table: "view_columns", columns: ["id","view_id","field_key","field_source","label_override","is_visible","width","display_order","pin","created_at","updated_at","deleted_at"], scopeFrom: "view_columns legacy join collection_views scope_parent on scope_parent.id=legacy.view_id", scopeUserColumn: "scope_parent.user_id" }),
] as const;

export const LEGACY_ADAPTER_BY_TABLE = new Map(LEGACY_ADAPTERS_V1.map((adapter) => [adapter.table, adapter]));

export function detectLegacyDamage(adapter: LegacyAdapterV1, row: Readonly<Record<string, unknown>>) {
  const damage = new Set<string>();
  if (adapter.sourceTextFields.length && !adapter.sourceTextFields.some((field) => text(row[field]))) damage.add("SOURCE_MISSING");
  for (const field of adapter.jsonFields) {
    const value = row[field];
    if (typeof value !== "string" || !value.trim()) continue;
    try { JSON.parse(value); } catch { damage.add("JSON_INVALID"); }
  }
  return [...damage].sort();
}

export function validateAdapterCoverage(adapter: LegacyAdapterV1, columns: readonly string[]) {
  const missing = columns.length ? columns.filter((column) => !adapter.columnCoverage[column]) : ["__table_missing__"];
  const stale = Object.keys(adapter.columnCoverage).filter((column) => !columns.includes(column));
  return { valid: missing.length === 0, missing, stale, covered: columns.length - missing.length, total: columns.length };
}
