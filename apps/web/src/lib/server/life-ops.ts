import "server-only";

import { cache } from "react";
import type { CareerLog, DailyEntry, DailyLogMock, HabitDefinition, HealthMetric, WorkoutLog } from "@/lib/mock/life-ops";
import type { SourceDocumentInfo } from "@/lib/mock/vault";
import { getTodayString } from "@/lib/mock/life-ops";
import { requireSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { syncTagsForEntity } from "@/lib/server/tagging";
import { ulid } from "ulidx";

export type LifeOpsSnapshot = {
  logs: Record<string, DailyLogMock>;
  habits: HabitDefinition[];
  workouts: WorkoutLog[];
  career: CareerLog[];
  healthMetrics: HealthMetric[];
};

export type LifeOpsMutationDelta = {
  careerEntry?: CareerLog;
  dailyLog?: DailyLogMock;
  deletedCareerId?: string;
  deletedWorkoutId?: string;
  habit?: HabitDefinition;
  healthMetrics?: HealthMetric[];
  workout?: WorkoutLog;
};

type UserRow = { id: string };
type DailyLogRow = {
  id: string;
  date: string;
  mood: number | null;
  energyLevel: number | null;
  emotions: string | null;
  gratitude: string | null;
  journal: string | null;
  meditation: string | null;
  meditationVerse: string | null;
};
type DailyEntryRow = {
  id: string;
  kind: DailyEntry["kind"];
  title: string | null;
  date: string;
  body: string | null;
  emotion: string | null;
  eventSummary: string | null;
  verse: string | null;
  background: string | null;
  tagsSnapshot: string | null;
  sourceDocumentId: string | null;
};
type HabitStateRow = {
  id: string;
  title: string;
  icon: string | null;
  displayOrder: number | null;
  description: string | null;
  schedule: string | null;
  isActive: number | null;
  completedToday: number;
  streak: number;
};
type HabitDefinitionRow = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  schedule: string | null;
  isActive: number | null;
  displayOrder: number | null;
};
type HealthMetricRow = {
  id: string;
  date: string;
  sleepHours: number | null;
  deepWorkMinutes: number | null;
  weight: number | null;
  stepsCount: number | null;
};
type TimelineRow = {
  date: string;
  time: string;
  label: string;
  type: string;
};
type SourceDocumentRow = { id: string; sourceDatabase: string | null; sourceId: string; documentRole: string | null; status: string; url: string | null; preview: string | null };
type SourceDocumentEntityRow = SourceDocumentRow & { canonicalEntityId: string };
type SourceDocumentPropertyRow = { sourceDocumentId: string; name: string; value: string | null; type: string | null };
type DailyPersonRow = {
  date: string;
  time: string;
  label: string;
  type: string;
};
type DailyEntryPersonRelationRow = {
  dailyEntryId: string;
  personId: string;
  name: string;
  context: string | null;
};
type DailyArchiveLogRow = {
  id: string;
  date: string;
  journal: string | null;
  meditation: string | null;
  meditationVerse: string | null;
  sourceDocumentId: string | null;
};
export type DailyEntryArchiveFilters = {
  hasEmotion?: boolean;
  hasPeople?: boolean;
  kinds?: DailyEntry["kind"][];
  limit?: number;
  offset?: number;
  q?: string;
};
export type DailyEntryArchiveItem = DailyEntry & {
  backgroundPreview?: string | null;
  bodyPreview?: string;
  hasBackground?: boolean;
  hasBody?: boolean;
  hasSourceDocument?: boolean;
  isSummary?: boolean;
};
export type DailyEntryArchivePage = {
  entries: DailyEntryArchiveItem[];
  limit: number;
  nextOffset: number | null;
  offset: number;
  total: number;
};
type WorkoutRow = {
  id: string;
  title: string | null;
  date: string;
  categories: string;
  durationMinutes: number | null;
  intensity: number | null;
  notes: string | null;
};
type CareerRow = {
  id: string;
  sourceDocumentId: string | null;
  organization: string;
  role: string;
  category: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
};

const DAILY_ENTRY_KIND_SET = new Set<DailyEntry["kind"]>(["journal", "meditation", "sermon_note", "workout", "note"]);

function parseJsonArray(value: string | null) {
  if (!value) return [] as string[];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function dailyEntryFallbackTitle(kind: DailyEntry["kind"]) {
  const titles: Record<DailyEntry["kind"], string> = {
    journal: "일기",
    meditation: "묵상",
    sermon_note: "설교 노트",
    workout: "운동 기록",
    note: "기록",
  };
  return titles[kind];
}

function clampPageLimit(value: number | undefined, fallback = 40) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), 80);
}

function compactText(value: string | null | undefined, maxLength: number) {
  if (!value) return "";
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function dailyEntryArchiveSearchText(entry: DailyEntry) {
  return [
    entry.title,
    entry.body,
    entry.emotion ?? "",
    entry.eventSummary ?? "",
    entry.verse ?? "",
    entry.background ?? "",
    entry.tagsSnapshot ?? "",
    ...(entry.people?.map((person) => `${person.name} ${person.context ?? ""}`) ?? []),
  ].join(" ").toLowerCase();
}

function summarizeDailyEntry(entry: DailyEntry, hasSourceDocument?: boolean): DailyEntryArchiveItem {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    date: entry.date,
    body: "",
    emotion: entry.emotion,
    eventSummary: entry.eventSummary,
    verse: entry.verse,
    background: null,
    tagsSnapshot: entry.tagsSnapshot,
    people: entry.people,
    sourceDocument: null,
    backgroundPreview: compactText(entry.background, 180) || null,
    bodyPreview: compactText(entry.body, 220),
    hasBackground: Boolean(entry.background?.trim()),
    hasBody: Boolean(entry.body?.trim()),
    hasSourceDocument: Boolean(hasSourceDocument ?? entry.sourceDocument),
    isSummary: true,
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function habitDefinitionFromRow(row: HabitDefinitionRow): HabitDefinition {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    icon: row.icon ?? "•",
    schedule: row.schedule ?? "daily",
    isActive: Boolean(row.isActive),
  };
}

function workoutFromRow(row: WorkoutRow): WorkoutLog {
  return {
    id: row.id,
    date: row.date,
    categories: row.title ?? row.categories,
    duration: Number(row.durationMinutes ?? 0),
    intensity: Number(row.intensity ?? 0),
    notes: row.notes ?? "",
  };
}

function careerFromRow(row: CareerRow): CareerLog {
  return {
    id: row.id,
    organization: row.organization,
    role: row.role,
    category: row.category,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    period: row.endDate ? `${row.startDate.slice(0, 4)} - ${row.endDate.slice(0, 4)}` : `${row.startDate.slice(0, 4)} - 현재`,
    description: row.description ?? "",
  };
}

function healthMetricFromRow(row: HealthMetricRow): HealthMetric {
  return {
    id: row.id,
    date: row.date,
    sleepHours: Number(row.sleepHours ?? 0),
    deepWorkMinutes: Number(row.deepWorkMinutes ?? 0),
    weight: row.weight ?? undefined,
    stepsCount: Number(row.stepsCount ?? 0),
  };
}

async function resolveUser() {
  const session = await requireSession();
  const found = await queryD1<UserRow>("select id from users where email = ? limit 1", [session.email]);
  const existing = found.rows[0];
  if (existing) return { id: existing.id, session };
  const userId = "user-light-keeper";
  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
    [userId, session.email, session.displayName],
  );
  return { id: userId, session };
}

export async function seedLifeOpsSupportData() {
  const { id: userId } = await resolveUser();
  const existing = await queryD1<{ count: number | null }>(`select count(*) as count from daily_logs where user_id = ?`, [userId]);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  await executeD1(
    `insert or ignore into habits
      (id, user_id, title, description, type, target_value, unit, icon, color, schedule, is_active, display_order, created_at, updated_at)
     values
      ('habit-1', ?, 'QT', '아침 묵상', 'boolean', 1, 'session', '🙏', 'gold', 'daily', 1, 0, datetime('now'), datetime('now')),
      ('habit-2', ?, 'Deep Work', '집중 업무 블록', 'boolean', 1, 'session', '🧠', 'sky', 'daily', 1, 1, datetime('now'), datetime('now')),
      ('habit-3', ?, 'Workout', '운동하기', 'boolean', 1, 'session', '🏃', 'orange', 'daily', 1, 2, datetime('now'), datetime('now')),
      ('habit-4', ?, 'Water 2L', '수분 섭취', 'boolean', 1, 'goal', '💧', 'blue', 'daily', 1, 3, datetime('now'), datetime('now'))`,
    [userId, userId, userId, userId],
  );

  const days = [
    { date: "2026-04-23", mood: 4, energy: 3, sleep: 6.8, deepWork: 165, gratitude: "재민과의 대화에서 겨울 메뉴 방향이 더 또렷해졌다.", journal: "오늘은 Project Light House의 P1을 닫고 Life Ops의 Daily Command Center로 넘어왔다.", meditation: "불안은 피해야 할 대상이 아니라 방향을 알려주는 신호일 수 있다.", verse: "시편 23:1", emotions: '["차분함","집중","감사"]', weight: 72.4, steps: 8210 },
    { date: "2026-04-22", mood: 3, energy: 4, sleep: 7.3, deepWork: 190, gratitude: "몰입감이 좋았다.", journal: "Action Hub와 PRM 연결 흐름을 다듬었다.", meditation: "기록은 현실을 정리하는 기도와 닮아 있다.", verse: "잠언 4:23", emotions: '["집중","평온"]', weight: 72.7, steps: 9340 },
    { date: "2026-04-21", mood: 4, energy: 3, sleep: 6.7, deepWork: 150, gratitude: "민서와의 대화가 큰 위로가 됐다.", journal: "이번 주 감정선이 조금씩 안정됐다.", meditation: "서두르지 않는 것이 믿음일 수 있다.", verse: "시편 27:14", emotions: '["감사","차분함"]', weight: 72.9, steps: 7650 },
  ];

  for (const day of days) {
    await executeD1(
      `insert or ignore into daily_logs
        (id, user_id, date, mood, energy_level, emotions, gratitude, journal, meditation, meditation_verse, ai_summary, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, datetime('now'), datetime('now'))`,
      [`daily-${day.date}`, userId, day.date, day.mood, day.energy, day.emotions, day.gratitude, day.journal, day.meditation, day.verse],
    );
    await executeD1(
      `insert or ignore into health_metrics
        (id, user_id, date, sleep_hours, deep_work_minutes, weight, steps_count, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [`health-${day.date}`, userId, day.date, day.sleep, day.deepWork, day.weight, day.steps],
    );
  }

  const habitLogs = [
    ["habit-1", "2026-04-23", 1], ["habit-2", "2026-04-23", 1], ["habit-3", "2026-04-23", 0], ["habit-4", "2026-04-23", 1],
    ["habit-1", "2026-04-22", 1], ["habit-2", "2026-04-22", 1], ["habit-3", "2026-04-22", 1], ["habit-4", "2026-04-22", 1],
    ["habit-1", "2026-04-21", 1], ["habit-2", "2026-04-21", 0], ["habit-3", "2026-04-21", 0], ["habit-4", "2026-04-21", 1],
  ] as const;
  for (const [habitId, date, value] of habitLogs) {
    await executeD1(
      `insert or ignore into habit_logs (id, user_id, habit_id, date, value, note, created_at)
       values (?, ?, ?, ?, ?, null, datetime('now'))`,
      [`${habitId}-${date}`, userId, habitId, date, value],
    );
  }

  await executeD1(
    `insert or ignore into workouts
      (id, user_id, date, categories, duration_minutes, intensity, notes, created_at, updated_at)
     values
      ('workout-1', ?, '2026-04-23', '등 · 유산소', 70, 4, '기분이 정리되는 세션', datetime('now'), datetime('now')),
      ('workout-2', ?, '2026-04-21', '가슴 · 삼두', 65, 3, '가볍게 볼륨 유지', datetime('now'), datetime('now')),
      ('workout-3', ?, '2026-04-19', '하체', 82, 5, '강도 높음', datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into career_history
      (id, user_id, organization, role, category, start_date, end_date, location, description, highlights, cover_image_url, created_at, updated_at)
     values
      ('career-1', ?, 'MODU WORKS', 'Product Builder', 'work', '2024-01-01', null, 'Seoul', '제품 빌드와 자동화 설계', null, null, datetime('now'), datetime('now')),
      ('career-2', ?, 'Trauma Repair Lab', 'Writer / Researcher', 'work', '2022-01-01', '2024-01-01', 'Seoul', '집필과 연구 중심 역할', null, null, datetime('now'), datetime('now')),
      ('career-3', ?, 'Community Fellowship', 'Volunteer', 'service', '2020-01-01', '2022-01-01', 'Seoul', '공동체 섬김과 운영 지원', null, null, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );
}

async function getHabitStateRows(userId: string, date: string) {
  return queryD1<HabitStateRow>(
    `select
       h.id, h.title, h.icon, h.display_order as displayOrder, h.description, h.schedule, h.is_active as isActive,
       coalesce((select hl.value from habit_logs hl where hl.habit_id = h.id and hl.date = ? limit 1), 0) as completedToday,
       coalesce((
         select count(*)
         from habit_logs hl2
         where hl2.habit_id = h.id and hl2.value = 1 and hl2.date <= ?
       ), 0) as streak
     from habits h
     where h.user_id = ? and h.is_active = 1
     order by h.display_order asc, h.created_at asc`,
    [date, date, userId],
  );
}

async function getSourceDocumentsForEntities(userId: string, entityType: string, entityIds: string[]) {
  const uniqueEntityIds = [...new Set(entityIds.filter(Boolean))];
  const documentsByEntityId = new Map<string, SourceDocumentInfo>();
  if (!uniqueEntityIds.length) return documentsByEntityId;

  const documentRows: SourceDocumentEntityRow[] = [];
  for (const entityIdChunk of chunkArray(uniqueEntityIds, 80)) {
    const placeholders = entityIdChunk.map(() => "?").join(", ");
    const result = await queryD1<SourceDocumentEntityRow>(
      `select
         id,
         canonical_entity_id as canonicalEntityId,
         source_database as sourceDatabase,
         source_id as sourceId,
         document_role as documentRole,
         status,
         url,
         raw_content_preview as preview
       from source_documents
       where user_id = ?
         and canonical_entity_type = ?
         and canonical_entity_id in (${placeholders})
         and deleted_at is null
       order by canonical_entity_id asc, updated_at desc, created_at desc`,
      [userId, entityType, ...entityIdChunk],
    );
    documentRows.push(...result.rows);
  }

  const propertiesByDocumentId = new Map<string, SourceDocumentInfo["properties"]>();
  const documentIds = documentRows.map((row) => row.id);
  for (const documentIdChunk of chunkArray(documentIds, 80)) {
    const placeholders = documentIdChunk.map(() => "?").join(", ");
    const result = await queryD1<SourceDocumentPropertyRow>(
      `select source_document_id as sourceDocumentId, property_name as name, value_text as value, property_type as type
       from source_document_properties
       where source_document_id in (${placeholders})
       order by source_document_id, property_key`,
      documentIdChunk,
    );

    for (const property of result.rows) {
      if (!property.value) continue;
      const properties = propertiesByDocumentId.get(property.sourceDocumentId) ?? [];
      properties.push({ name: property.name, value: property.value, type: property.type });
      propertiesByDocumentId.set(property.sourceDocumentId, properties);
    }
  }

  for (const row of documentRows) {
    if (documentsByEntityId.has(row.canonicalEntityId)) continue;
    documentsByEntityId.set(row.canonicalEntityId, {
      id: row.id,
      sourceDatabase: row.sourceDatabase,
      sourceId: row.sourceId,
      documentRole: row.documentRole,
      status: row.status,
      url: row.url,
      preview: row.preview,
      properties: propertiesByDocumentId.get(row.id) ?? [],
    });
  }

  return documentsByEntityId;
}

async function getPeopleForDailyEntries(userId: string, dailyEntryIds: string[]) {
  if (!dailyEntryIds.length) return new Map<string, DailyEntry["people"]>();

  const byEntry = new Map<string, DailyEntry["people"]>();
  for (const entryIdChunk of chunkArray(dailyEntryIds, 80)) {
    const placeholders = entryIdChunk.map(() => "?").join(", ");
    const result = await queryD1<DailyEntryPersonRelationRow>(
      `select
         depr.daily_entry_id as dailyEntryId,
         p.id as personId,
         p.name,
         depr.context
       from daily_entry_people_relations depr
       inner join people p on p.id = depr.person_id
       where depr.daily_entry_id in (${placeholders})
         and p.user_id = ?
         and p.deleted_at is null
       order by p.name asc`,
      [...entryIdChunk, userId],
    );

    for (const row of result.rows) {
      const people = byEntry.get(row.dailyEntryId) ?? [];
      people.push({ id: row.personId, name: row.name, context: row.context });
      byEntry.set(row.dailyEntryId, people);
    }
  }
  return byEntry;
}

async function getHealthMetricsReadModel(userId: string) {
  const result = await queryD1<HealthMetricRow>(
    `select id, date, sleep_hours as sleepHours, deep_work_minutes as deepWorkMinutes, weight, steps_count as stepsCount
     from health_metrics where user_id = ? order by date desc limit 30`,
    [userId],
  );
  return result.rows.map(healthMetricFromRow);
}

async function getHabitDefinitionsReadModel(userId: string) {
  const result = await queryD1<HabitDefinitionRow>(
    `select id, title, description, icon, schedule, is_active as isActive, display_order as displayOrder
     from habits where user_id = ? order by display_order asc, created_at asc`,
    [userId],
  );
  return result.rows.map(habitDefinitionFromRow);
}

async function getWorkoutListReadModel(userId: string) {
  const result = await queryD1<WorkoutRow>(
    `select id, title, date, categories, duration_minutes as durationMinutes, intensity, notes
     from workouts
     where user_id = ? and deleted_at is null
     order by date desc`,
    [userId],
  );
  return result.rows.map(workoutFromRow);
}

async function getCareerListReadModel(userId: string) {
  const result = await queryD1<CareerRow>(
    `select id, source_document_id as sourceDocumentId, organization, role, category, start_date as startDate, end_date as endDate, description
     from career_history
     where user_id = ? and deleted_at is null
     order by start_date desc`,
    [userId],
  );
  return result.rows.map(careerFromRow);
}

async function getDailyLogReadModel(userId: string, date: string): Promise<DailyLogMock> {
  const [dailyResult, habitsStateResult, metricsResult, dailyEntryResult, taskTimeline, interactionTimeline, zettelTimeline, dailyPeopleTimeline] = await Promise.all([
    queryD1<DailyLogRow>(
      `select id, date, mood, energy_level as energyLevel, emotions, gratitude, journal, meditation, meditation_verse as meditationVerse
       from daily_logs where user_id = ? and date = ? limit 1`,
      [userId, date],
    ),
    getHabitStateRows(userId, date),
    queryD1<HealthMetricRow>(
      `select id, date, sleep_hours as sleepHours, deep_work_minutes as deepWorkMinutes, weight, steps_count as stepsCount
       from health_metrics where user_id = ? and date <= ? order by date desc limit 14`,
      [userId, date],
    ),
    queryD1<DailyEntryRow>(
      `select id, kind, title, date, body, emotion, event_summary as eventSummary, verse, background,
              tags_snapshot as tagsSnapshot, source_document_id as sourceDocumentId
       from daily_log_entries
       where user_id = ? and date = ? and deleted_at is null
       order by case kind when 'journal' then 0 when 'meditation' then 1 when 'sermon_note' then 2 when 'workout' then 3 else 4 end, created_at asc`,
      [userId, date],
    ),
    queryD1<TimelineRow>(
      `select date(coalesce(updated_at, created_at)) as date, time(coalesce(updated_at, created_at)) as time, title as label, 'task' as type
       from tasks where user_id = ? and date(coalesce(updated_at, created_at)) = ? and deleted_at is null order by updated_at desc limit 4`,
      [userId, date],
    ),
    queryD1<TimelineRow>(
      `select occurred_at as date, '14:00' as time, summary as label, 'interaction' as type
       from interactions where user_id = ? and occurred_at = ? and deleted_at is null order by created_at desc limit 4`,
      [userId, date],
    ),
    queryD1<TimelineRow>(
      `select date(coalesce(updated_at, created_at)) as date, time(coalesce(updated_at, created_at)) as time, title as label, 'zettel' as type
       from zettels where user_id = ? and date(coalesce(updated_at, created_at)) = ? and deleted_at is null order by updated_at desc limit 4`,
      [userId, date],
    ),
    queryD1<DailyPersonRow>(
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

  const row = dailyResult.rows[0];
  const metrics = metricsResult.rows;
  const entryIds = dailyEntryResult.rows.map((entry) => entry.id);
  const [dailyLogSourceDocuments, entrySourceDocuments, peopleByEntry] = await Promise.all([
    row ? getSourceDocumentsForEntities(userId, "daily_log", [row.id]) : Promise.resolve(new Map<string, SourceDocumentInfo>()),
    getSourceDocumentsForEntities(userId, "daily_entry", entryIds),
    getPeopleForDailyEntries(userId, entryIds),
  ]);

  return {
    date,
    mood: row?.mood ?? 3,
    energy: row?.energyLevel ?? 3,
    emotions: parseJsonArray(row?.emotions ?? null),
    gratitude: row?.gratitude ?? "",
    journal: row?.journal ?? "",
    meditation: row?.meditation ?? "",
    meditationVerse: row?.meditationVerse ?? "",
    habits: habitsStateResult.rows.map((habit) => ({
      id: habit.id,
      title: habit.title,
      icon: habit.icon ?? "•",
      streak: Number(habit.streak ?? 0),
      completedToday: Boolean(habit.completedToday),
    })),
    entries: dailyEntryResult.rows.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title ?? dailyEntryFallbackTitle(entry.kind),
      date: entry.date,
      body: entry.body ?? "",
      emotion: entry.emotion,
      eventSummary: entry.eventSummary,
      verse: entry.verse,
      background: entry.background,
      tagsSnapshot: entry.tagsSnapshot,
      people: peopleByEntry.get(entry.id) ?? [],
      sourceDocument: entrySourceDocuments.get(entry.id) ?? null,
    })),
    sleepHours: metrics.map((item) => Number(item.sleepHours ?? 0)).reverse(),
    deepWorkMinutes: Number(metrics[0]?.deepWorkMinutes ?? 0),
    timeline: [...taskTimeline.rows, ...interactionTimeline.rows, ...zettelTimeline.rows, ...dailyPeopleTimeline.rows]
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      .slice(0, 6)
      .map((item) => ({ time: item.time.slice(0, 5), label: item.label, type: item.type })),
    sourceDocument: row ? dailyLogSourceDocuments.get(row.id) ?? null : null,
  };
}

async function getLifeOpsDailyDelta(userId: string, date: string): Promise<Pick<LifeOpsMutationDelta, "dailyLog" | "healthMetrics">> {
  const [dailyLog, healthMetrics] = await Promise.all([
    getDailyLogReadModel(userId, date),
    getHealthMetricsReadModel(userId),
  ]);
  return { dailyLog, healthMetrics };
}

export const getLifeOpsSnapshot = cache(async function getLifeOpsSnapshot(dates?: string[]): Promise<LifeOpsSnapshot> {
  const { id: userId } = await resolveUser();
  const targetDates = dates?.length ? dates : [getTodayString(), "2026-04-22", "2026-04-21"];
  const logs: Record<string, DailyLogMock> = {};

  const [habits, healthMetrics, workouts, career] = await Promise.all([
    getHabitDefinitionsReadModel(userId),
    getHealthMetricsReadModel(userId),
    getWorkoutListReadModel(userId),
    getCareerListReadModel(userId),
  ]);

  const dailyEntries = await Promise.all(targetDates.map(async (date) => [date, await getDailyLogReadModel(userId, date)] as const));

  for (const [date, log] of dailyEntries) {
    logs[date] = log;
  }

  return {
    logs,
    habits,
    workouts,
    career,
    healthMetrics,
  };
});

function emptyLifeOpsSnapshot(): LifeOpsSnapshot {
  return {
    career: [],
    habits: [],
    healthMetrics: [],
    logs: {},
    workouts: [],
  };
}

function isDatePathSegment(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function getDailyHydrationSnapshot(userId: string, date: string): Promise<LifeOpsSnapshot> {
  const [dailyLog, healthMetrics] = await Promise.all([
    getDailyLogReadModel(userId, date),
    getHealthMetricsReadModel(userId),
  ]);

  return {
    ...emptyLifeOpsSnapshot(),
    healthMetrics,
    logs: {
      [date]: dailyLog,
    },
  };
}

export async function getLifeOpsHydrationSnapshot(pathAndSearch = "/life-ops"): Promise<LifeOpsSnapshot> {
  const { id: userId } = await resolveUser();
  const url = new URL(pathAndSearch, "http://local");
  const segments = url.pathname.split("/").filter(Boolean);
  const section = segments[1] ?? "";

  if (!section) return getDailyHydrationSnapshot(userId, getTodayString());
  if (isDatePathSegment(section)) return getDailyHydrationSnapshot(userId, section);

  if (section === "habits") {
    const habits = await getHabitDefinitionsReadModel(userId);
    return { ...emptyLifeOpsSnapshot(), habits };
  }

  if (section === "workouts") {
    const workoutId = segments[2];
    if (!workoutId) {
      const workouts = await getWorkoutListReadModel(userId);
      return { ...emptyLifeOpsSnapshot(), workouts };
    }

    try {
      const workout = (await getWorkoutDelta(userId, workoutId)).workout;
      return { ...emptyLifeOpsSnapshot(), workouts: workout ? [workout] : [] };
    } catch (error) {
      if (error instanceof Error && error.message === "운동 로그를 찾지 못했습니다.") return emptyLifeOpsSnapshot();
      throw error;
    }
  }

  if (section === "career") {
    const careerId = segments[2];
    if (!careerId) {
      const career = await getCareerListReadModel(userId);
      return { ...emptyLifeOpsSnapshot(), career };
    }

    try {
      const careerEntry = (await getCareerDelta(userId, careerId)).careerEntry;
      return { ...emptyLifeOpsSnapshot(), career: careerEntry ? [careerEntry] : [] };
    } catch (error) {
      if (error instanceof Error && error.message === "커리어 이력을 찾지 못했습니다.") return emptyLifeOpsSnapshot();
      throw error;
    }
  }

  return emptyLifeOpsSnapshot();
}

export async function getLifeOpsLog(date: string) {
  const { id: userId } = await resolveUser();
  return getDailyLogReadModel(userId, date);
}

export async function getDailyEntryArchive(kind?: DailyEntry["kind"]): Promise<DailyEntry[]> {
  const { id: userId } = await resolveUser();
  const filters = kind ? "and kind = ?" : "";
  const params = kind ? [userId, kind] : [userId];
  const entryResult = await queryD1<DailyEntryRow>(
    `select id, kind, title, date, body, emotion, event_summary as eventSummary, verse, background,
            tags_snapshot as tagsSnapshot, source_document_id as sourceDocumentId
     from daily_log_entries
     where user_id = ? and deleted_at is null ${filters}
     order by date desc, created_at desc`,
    params,
  );
  const entryIds = entryResult.rows.map((entry) => entry.id);
  const [sourceDocuments, peopleByEntry] = await Promise.all([
    getSourceDocumentsForEntities(userId, "daily_entry", entryIds),
    getPeopleForDailyEntries(userId, entryIds),
  ]);

  const entries: DailyEntry[] = entryResult.rows.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title ?? dailyEntryFallbackTitle(entry.kind),
    date: entry.date,
    body: entry.body ?? "",
    emotion: entry.emotion,
    eventSummary: entry.eventSummary,
    verse: entry.verse,
    background: entry.background,
    tagsSnapshot: entry.tagsSnapshot,
    people: peopleByEntry.get(entry.id) ?? [],
    sourceDocument: sourceDocuments.get(entry.id) ?? null,
  }));

  if (!kind || kind === "journal" || kind === "meditation") {
    const logResult = await queryD1<DailyArchiveLogRow>(
      `select id, date, journal, meditation, meditation_verse as meditationVerse
       from daily_logs
       where user_id = ? and deleted_at is null
       order by date desc`,
      [userId],
    );
    const logRows = logResult.rows.filter((row) => {
      if (kind === "journal") return Boolean(row.journal?.trim());
      if (kind === "meditation") return Boolean(row.meditation?.trim());
      return Boolean(row.journal?.trim() || row.meditation?.trim());
    });
    const logSources = await getSourceDocumentsForEntities(userId, "daily_log", logRows.map((row) => row.id));
    for (const row of logRows) {
      if ((!kind || kind === "journal") && row.journal?.trim()) {
        entries.push({
          id: `${row.id}:journal`,
          kind: "journal",
          title: "Daily Journal",
          date: row.date,
          body: row.journal,
          sourceDocument: logSources.get(row.id) ?? null,
        });
      }
      if ((!kind || kind === "meditation") && row.meditation?.trim()) {
        entries.push({
          id: `${row.id}:meditation`,
          kind: "meditation",
          title: "Daily Meditation",
          date: row.date,
          body: row.meditation,
          verse: row.meditationVerse,
          sourceDocument: logSources.get(row.id) ?? null,
        });
      }
    }
  }

  return entries.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : left.title.localeCompare(right.title)));
}

export async function getDailyEntryArchivePage(options: DailyEntryArchiveFilters = {}): Promise<DailyEntryArchivePage> {
  const { id: userId } = await resolveUser();
  const kinds = options.kinds?.filter((kind, index, array) => DAILY_ENTRY_KIND_SET.has(kind) && array.indexOf(kind) === index) ?? [];
  const q = options.q?.trim().toLowerCase() ?? "";
  const limit = clampPageLimit(options.limit);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const kindPlaceholders = kinds.length ? `and kind in (${kinds.map(() => "?").join(", ")})` : "";
  const entryResult = await queryD1<DailyEntryRow>(
    `select id, kind, title, date, body, emotion, event_summary as eventSummary, verse, background,
            tags_snapshot as tagsSnapshot, source_document_id as sourceDocumentId
     from daily_log_entries
     where user_id = ? and deleted_at is null ${kindPlaceholders}
     order by date desc, created_at desc`,
    [userId, ...kinds],
  );
  const entryIds = entryResult.rows.map((entry) => entry.id);
  const peopleByEntry = await getPeopleForDailyEntries(userId, entryIds);

  const entries: Array<DailyEntry & { hasSourceDocument?: boolean }> = entryResult.rows.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title ?? dailyEntryFallbackTitle(entry.kind),
    date: entry.date,
    body: entry.body ?? "",
    emotion: entry.emotion,
    eventSummary: entry.eventSummary,
    verse: entry.verse,
    background: entry.background,
    tagsSnapshot: entry.tagsSnapshot,
    people: peopleByEntry.get(entry.id) ?? [],
    sourceDocument: null,
    hasSourceDocument: Boolean(entry.sourceDocumentId),
  }));

  if (!kinds.length || kinds.includes("journal") || kinds.includes("meditation")) {
    const logResult = await queryD1<DailyArchiveLogRow>(
      `select id, date, journal, meditation, meditation_verse as meditationVerse, source_document_id as sourceDocumentId
       from daily_logs
       where user_id = ? and deleted_at is null
       order by date desc`,
      [userId],
    );
    for (const row of logResult.rows) {
      if ((!kinds.length || kinds.includes("journal")) && row.journal?.trim()) {
        entries.push({
          id: `${row.id}:journal`,
          kind: "journal",
          title: "Daily Journal",
          date: row.date,
          body: row.journal,
          sourceDocument: null,
          hasSourceDocument: Boolean(row.sourceDocumentId),
        });
      }
      if ((!kinds.length || kinds.includes("meditation")) && row.meditation?.trim()) {
        entries.push({
          id: `${row.id}:meditation`,
          kind: "meditation",
          title: "Daily Meditation",
          date: row.date,
          body: row.meditation,
          verse: row.meditationVerse,
          sourceDocument: null,
          hasSourceDocument: Boolean(row.sourceDocumentId),
        });
      }
    }
  }

  const filtered = entries
    .filter((entry) => (options.hasPeople ? (entry.people?.length ?? 0) > 0 : true))
    .filter((entry) => (options.hasEmotion ? Boolean(entry.emotion?.trim()) : true))
    .filter((entry) => (q ? dailyEntryArchiveSearchText(entry).includes(q) : true))
    .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : left.title.localeCompare(right.title)));
  const page = filtered.slice(offset, offset + limit);

  return {
    entries: page.map((entry) => summarizeDailyEntry(entry, entry.hasSourceDocument)),
    limit,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    offset,
    total: filtered.length,
  };
}

export async function getDailyEntryArchiveDetail(entryId: string): Promise<DailyEntry | null> {
  const { id: userId } = await resolveUser();
  const syntheticMatch = entryId.match(/^(.+):(journal|meditation)$/);
  if (syntheticMatch) {
    const [, dailyLogId, kind] = syntheticMatch;
    const result = await queryD1<DailyArchiveLogRow>(
      `select id, date, journal, meditation, meditation_verse as meditationVerse, source_document_id as sourceDocumentId
       from daily_logs
       where user_id = ? and id = ? and deleted_at is null
       limit 1`,
      [userId, dailyLogId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const sourceDocuments = await getSourceDocumentsForEntities(userId, "daily_log", [row.id]);
    if (kind === "journal" && row.journal?.trim()) {
      return {
        id: entryId,
        kind: "journal",
        title: "Daily Journal",
        date: row.date,
        body: row.journal,
        sourceDocument: sourceDocuments.get(row.id) ?? null,
      };
    }
    if (kind === "meditation" && row.meditation?.trim()) {
      return {
        id: entryId,
        kind: "meditation",
        title: "Daily Meditation",
        date: row.date,
        body: row.meditation,
        verse: row.meditationVerse,
        sourceDocument: sourceDocuments.get(row.id) ?? null,
      };
    }
    return null;
  }

  const result = await queryD1<DailyEntryRow>(
    `select id, kind, title, date, body, emotion, event_summary as eventSummary, verse, background,
            tags_snapshot as tagsSnapshot, source_document_id as sourceDocumentId
     from daily_log_entries
     where user_id = ? and id = ? and deleted_at is null
     limit 1`,
    [userId, entryId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [sourceDocuments, peopleByEntry] = await Promise.all([
    getSourceDocumentsForEntities(userId, "daily_entry", [row.id]),
    getPeopleForDailyEntries(userId, [row.id]),
  ]);

  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? dailyEntryFallbackTitle(row.kind),
    date: row.date,
    body: row.body ?? "",
    emotion: row.emotion,
    eventSummary: row.eventSummary,
    verse: row.verse,
    background: row.background,
    tagsSnapshot: row.tagsSnapshot,
    people: peopleByEntry.get(row.id) ?? [],
    sourceDocument: sourceDocuments.get(row.id) ?? null,
  };
}

export async function getLifeOpsTrendSeries(limit = 7) {
  const { id: userId } = await resolveUser();
  return queryD1<{ date: string; sleepHours: number | null; deepWorkMinutes: number | null; mood: number | null; energy: number | null }>(
    `select
       dl.date,
       hm.sleep_hours as sleepHours,
       hm.deep_work_minutes as deepWorkMinutes,
       dl.mood,
       dl.energy_level as energy
     from daily_logs dl
     left join health_metrics hm on hm.user_id = dl.user_id and hm.date = dl.date
     where dl.user_id = ?
     order by dl.date desc
     limit ?`,
    [userId, limit],
  );
}

export async function getLifeOpsWeeklyRhythm(dates: string[]) {
  if (!dates.length) return [];
  const { id: userId } = await resolveUser();
  const placeholders = dates.map(() => "?").join(", ");
  const rows = await queryD1<{ date: string; mood: number | null; energy: number | null }>(
    `select date, mood, energy_level as energy
     from daily_logs
     where user_id = ? and date in (${placeholders})`,
    [userId, ...dates],
  );
  const byDate = new Map(rows.rows.map((row) => [row.date, row]));
  return dates.map((date) => ({
    date,
    mood: byDate.get(date)?.mood ?? null,
    energy: byDate.get(date)?.energy ?? null,
  }));
}

export async function getLifeOpsHabitHeatmap(days = 371) {
  const { id: userId } = await resolveUser();
  const today = new Date(`${getTodayString()}T00:00:00.000Z`);
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() - (days - 1));
  const startDate = start.toISOString().slice(0, 10);
  const rows = await queryD1<{ date: string; value: number | null }>(
    `select date, sum(case when value > 0 then 1 else 0 end) as value
     from habit_logs
     where user_id = ? and date >= ?
     group by date`,
    [userId, startDate],
  );
  const valueByDate = new Map(rows.rows.map((row) => [row.date, Math.min(Number(row.value ?? 0), 4)]));

  return Array.from({ length: days }).map((_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, value: valueByDate.get(key) ?? 0 };
  });
}

export async function getLifeOpsWorkouts() {
  const { id: userId } = await resolveUser();
  return getWorkoutListReadModel(userId);
}

export async function getLifeOpsWorkout(workoutId: string) {
  const { id: userId } = await resolveUser();
  try {
    return (await getWorkoutDelta(userId, workoutId)).workout ?? null;
  } catch (error) {
    if (error instanceof Error && error.message === "운동 로그를 찾지 못했습니다.") return null;
    throw error;
  }
}

export async function getLifeOpsCareer() {
  const { id: userId } = await resolveUser();
  return getCareerListReadModel(userId);
}

export async function getLifeOpsCareerEntry(careerId: string) {
  const { id: userId } = await resolveUser();
  try {
    return (await getCareerDelta(userId, careerId)).careerEntry ?? null;
  } catch (error) {
    if (error instanceof Error && error.message === "커리어 이력을 찾지 못했습니다.") return null;
    throw error;
  }
}

async function ensureDailyLog(userId: string, date: string) {
  const existing = await queryD1<{ id: string }>(`select id from daily_logs where user_id = ? and date = ? limit 1`, [userId, date]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = ulid();
  await executeD1(
    `insert into daily_logs
      (id, user_id, date, mood, energy_level, emotions, gratitude, journal, meditation, meditation_verse, ai_summary, created_at, updated_at)
     values (?, ?, ?, 3, 3, '[]', '', '', '', '', null, datetime('now'), datetime('now'))`,
    [id, userId, date],
  );
  return id;
}

function clampScale(value: number | undefined, fallback: number) {
  const next = Number(value ?? fallback);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(5, Math.max(1, Math.round(next)));
}

function safeNumber(value: number | undefined, fallback = 0) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) ? next : fallback;
}

export async function updateLifeOpsMood(date: string, mood: number) {
  const { id: userId } = await resolveUser();
  await ensureDailyLog(userId, date);
  await executeD1(`update daily_logs set mood = ?, updated_at = datetime('now') where user_id = ? and date = ?`, [mood, userId, date]);
  return getLifeOpsDailyDelta(userId, date);
}

export async function updateLifeOpsEnergy(date: string, energy: number) {
  const { id: userId } = await resolveUser();
  await ensureDailyLog(userId, date);
  await executeD1(`update daily_logs set energy_level = ?, updated_at = datetime('now') where user_id = ? and date = ?`, [energy, userId, date]);
  return getLifeOpsDailyDelta(userId, date);
}

export async function updateLifeOpsDailyProperties(
  date: string,
  input: {
    mood?: number;
    energy?: number;
    emotions?: string[];
    sleepHours?: number;
    deepWorkMinutes?: number;
    gratitude?: string;
    journal?: string;
    meditation?: string;
    meditationVerse?: string;
  },
) {
  const { id: userId } = await resolveUser();
  const dailyLogId = await ensureDailyLog(userId, date);
  const [currentLog, currentMetric] = await Promise.all([
    queryD1<DailyLogRow>(
      `select id, date, mood, energy_level as energyLevel, emotions, gratitude, journal, meditation, meditation_verse as meditationVerse
       from daily_logs
       where user_id = ? and date = ?
       limit 1`,
      [userId, date],
    ),
    queryD1<HealthMetricRow>(
      `select id, date, sleep_hours as sleepHours, deep_work_minutes as deepWorkMinutes, weight, steps_count as stepsCount
       from health_metrics
       where user_id = ? and date = ?
       limit 1`,
      [userId, date],
    ),
  ]);
  const current = currentLog.rows[0];
  const metric = currentMetric.rows[0];
  const mood = input.mood === undefined ? current?.mood ?? 3 : clampScale(input.mood, 3);
  const energy = input.energy === undefined ? current?.energyLevel ?? 3 : clampScale(input.energy, 3);
  const emotions = Array.isArray(input.emotions)
    ? input.emotions.map((emotion) => emotion.trim()).filter(Boolean).slice(0, 12)
    : parseJsonArray(current?.emotions ?? null);
  const gratitude = input.gratitude === undefined ? current?.gratitude ?? "" : input.gratitude.trim();
  const journal = input.journal === undefined ? current?.journal ?? "" : input.journal.trim();
  const meditation = input.meditation === undefined ? current?.meditation ?? "" : input.meditation.trim();
  const meditationVerse = input.meditationVerse === undefined ? current?.meditationVerse ?? "" : input.meditationVerse.trim();
  const sleepHours = input.sleepHours === undefined ? Number(metric?.sleepHours ?? 0) : Math.max(0, safeNumber(input.sleepHours, 0));
  const deepWorkMinutes = input.deepWorkMinutes === undefined
    ? Number(metric?.deepWorkMinutes ?? 0)
    : Math.max(0, Math.round(safeNumber(input.deepWorkMinutes, 0)));

  await executeD1(
    `update daily_logs
     set mood = ?,
         energy_level = ?,
         emotions = ?,
         gratitude = ?,
         journal = ?,
         meditation = ?,
         meditation_verse = ?,
         updated_at = datetime('now')
     where user_id = ? and date = ?`,
    [mood, energy, JSON.stringify(emotions), gratitude, journal, meditation, meditationVerse, userId, date],
  );

  if (metric?.id) {
    await executeD1(
      `update health_metrics
       set sleep_hours = ?,
           deep_work_minutes = ?,
           updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [sleepHours, deepWorkMinutes, metric.id, userId],
    );
  } else {
    await executeD1(
      `insert into health_metrics (id, user_id, date, sleep_hours, deep_work_minutes, weight, steps_count, created_at, updated_at)
       values (?, ?, ?, ?, ?, null, null, datetime('now'), datetime('now'))`,
      [ulid(), userId, date, sleepHours, deepWorkMinutes],
    );
  }

  await syncTagsForEntity({
    userId,
    taggableType: "daily_log",
    taggableId: dailyLogId,
    content: [journal, meditation, gratitude, meditationVerse, ...emotions].join("\n"),
  });
  return getLifeOpsDailyDelta(userId, date);
}

export async function toggleLifeOpsHabit(date: string, habitId: string) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<{ value: number }>(
    `select value from habit_logs where user_id = ? and habit_id = ? and date = ? limit 1`,
    [userId, habitId, date],
  );
  if (current.rows[0]) {
    const next = current.rows[0].value ? 0 : 1;
    await executeD1(`update habit_logs set value = ? where user_id = ? and habit_id = ? and date = ?`, [next, userId, habitId, date]);
  } else {
    await executeD1(`insert into habit_logs (id, user_id, habit_id, date, value, note, created_at) values (?, ?, ?, ?, 1, null, datetime('now'))`, [`${habitId}-${date}`, userId, habitId, date]);
  }
  return getLifeOpsDailyDelta(userId, date);
}

export async function updateLifeOpsJournalField(date: string, field: "journal" | "meditation" | "gratitude", value: string) {
  const { id: userId } = await resolveUser();
  await ensureDailyLog(userId, date);
  const columns = { journal: "journal", meditation: "meditation", gratitude: "gratitude" } as const;
  await executeD1(`update daily_logs set ${columns[field]} = ?, updated_at = datetime('now') where user_id = ? and date = ?`, [value, userId, date]);
  const dailyLog = await queryD1<{ id: string; journal: string | null; meditation: string | null; gratitude: string | null }>(
    `select id, journal, meditation, gratitude
     from daily_logs
     where user_id = ? and date = ?
     limit 1`,
    [userId, date],
  );
  const row = dailyLog.rows[0];
  if (row?.id) {
    await syncTagsForEntity({
      userId,
      taggableType: "daily_log",
      taggableId: row.id,
      content: [row.journal ?? "", row.meditation ?? "", row.gratitude ?? ""].join("\n"),
    });
  }
  return getLifeOpsDailyDelta(userId, date);
}

export async function updateDailyEntry(entryId: string, input: {
  kind?: DailyEntryRow["kind"];
  title?: string | null;
  body?: string | null;
  emotion?: string | null;
  eventSummary?: string | null;
  verse?: string | null;
  background?: string | null;
  tagsSnapshot?: string | null;
}) {
  const { id: userId } = await resolveUser();
  const existing = await queryD1<{ id: string; date: string }>(
    `select id, date
     from daily_log_entries
     where id = ? and user_id = ? and deleted_at is null
     limit 1`,
    [entryId, userId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("일일 엔트리를 찾지 못했습니다.");

  const nullableText = (value: string | null | undefined) => value?.trim() || null;
  const kind = ["journal", "meditation", "sermon_note", "workout", "note"].includes(input.kind ?? "") ? input.kind : "journal";

  await executeD1(
    `update daily_log_entries
     set kind = ?,
         title = ?,
         body = ?,
         emotion = ?,
         event_summary = ?,
         verse = ?,
         background = ?,
         tags_snapshot = ?,
         updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [
      kind,
      nullableText(input.title),
      nullableText(input.body),
      nullableText(input.emotion),
      nullableText(input.eventSummary),
      nullableText(input.verse),
      nullableText(input.background),
      nullableText(input.tagsSnapshot),
      entryId,
      userId,
    ],
  );

  await syncTagsForEntity({
    userId,
    taggableType: "daily_entry",
    taggableId: entryId,
    content: [input.title ?? "", input.body ?? "", input.emotion ?? "", input.eventSummary ?? "", input.verse ?? "", input.background ?? "", input.tagsSnapshot ?? ""].join("\n"),
  });
  return getLifeOpsDailyDelta(userId, row.date);
}

async function getHabitDefinitionDelta(userId: string, habitId: string): Promise<Pick<LifeOpsMutationDelta, "habit">> {
  const result = await queryD1<HabitDefinitionRow>(
    `select id, title, description, icon, schedule, is_active as isActive, display_order as displayOrder
     from habits
     where id = ? and user_id = ?
     limit 1`,
    [habitId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("습관을 찾지 못했습니다.");
  return { habit: habitDefinitionFromRow(row) };
}

async function getWorkoutDelta(userId: string, workoutId: string): Promise<Pick<LifeOpsMutationDelta, "workout">> {
  const result = await queryD1<WorkoutRow>(
    `select id, title, date, categories, duration_minutes as durationMinutes, intensity, notes
     from workouts
     where id = ? and user_id = ? and deleted_at is null
     limit 1`,
    [workoutId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("운동 로그를 찾지 못했습니다.");
  return { workout: workoutFromRow(row) };
}

async function getCareerDelta(userId: string, careerId: string): Promise<Pick<LifeOpsMutationDelta, "careerEntry">> {
  const result = await queryD1<CareerRow>(
    `select id, source_document_id as sourceDocumentId, organization, role, category, start_date as startDate, end_date as endDate, description
     from career_history
     where id = ? and user_id = ? and deleted_at is null
     limit 1`,
    [careerId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("커리어 이력을 찾지 못했습니다.");
  return { careerEntry: careerFromRow(row) };
}

export async function createLifeOpsHabit(input: { title: string; description?: string; icon?: string; schedule?: string }) {
  const { id: userId } = await resolveUser();
  const title = input.title.trim();
  if (!title) throw new Error("습관 이름은 비워둘 수 없습니다.");
  const nextOrder = await queryD1<{ nextOrder: number | null }>(`select coalesce(max(display_order), -1) + 1 as nextOrder from habits where user_id = ?`, [userId]);
  const habitId = ulid();
  await executeD1(
    `insert into habits
      (id, user_id, title, description, type, target_value, unit, icon, color, schedule, is_active, display_order, created_at, updated_at)
     values (?, ?, ?, ?, 'boolean', 1, 'session', ?, 'gold', ?, 1, ?, datetime('now'), datetime('now'))`,
    [habitId, userId, title, input.description?.trim() || null, input.icon?.trim() || "•", input.schedule?.trim() || "daily", Number(nextOrder.rows[0]?.nextOrder ?? 0)],
  );
  return getHabitDefinitionDelta(userId, habitId);
}

export async function updateLifeOpsHabitProperties(
  habitId: string,
  input: { title?: string; description?: string; icon?: string; schedule?: string; isActive?: boolean },
) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<HabitDefinitionRow>(
    `select id, title, description, icon, schedule, is_active as isActive, display_order as displayOrder
     from habits
     where id = ? and user_id = ?
     limit 1`,
    [habitId, userId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("습관을 찾지 못했습니다.");

  const title = input.title === undefined ? row.title : input.title.trim();
  if (!title) throw new Error("습관 이름은 비워둘 수 없습니다.");
  const description = input.description === undefined ? row.description : input.description.trim() || null;
  const icon = input.icon === undefined ? row.icon ?? "•" : input.icon.trim() || "•";
  const schedule = input.schedule === undefined ? row.schedule ?? "daily" : input.schedule.trim() || "daily";
  const isActive = input.isActive === undefined ? Number(row.isActive ?? 1) : input.isActive ? 1 : 0;

  await executeD1(
    `update habits
     set title = ?,
         description = ?,
         icon = ?,
         schedule = ?,
         is_active = ?,
         updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [title, description, icon, schedule, isActive, habitId, userId],
  );

  return getHabitDefinitionDelta(userId, habitId);
}

export async function toggleHabitActive(habitId: string) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<{ isActive: number | null }>(`select is_active as isActive from habits where id = ? and user_id = ? limit 1`, [habitId, userId]);
  if (!current.rows[0]) throw new Error("습관을 찾지 못했습니다.");
  const next = current.rows[0].isActive ? 0 : 1;
  await executeD1(`update habits set is_active = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [next, habitId, userId]);
  return getHabitDefinitionDelta(userId, habitId);
}

export async function createWorkout(input: { date: string; categories: string; duration: number; intensity: number; notes?: string }) {
  const { id: userId } = await resolveUser();
  const categories = input.categories.trim();
  if (!categories) throw new Error("운동 카테고리는 비워둘 수 없습니다.");
  const workoutId = ulid();
  await executeD1(
    `insert into workouts (id, user_id, date, categories, duration_minutes, intensity, notes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [workoutId, userId, input.date, categories, input.duration, input.intensity, input.notes?.trim() || null],
  );
  return getWorkoutDelta(userId, workoutId);
}

export async function updateWorkoutProperties(
  workoutId: string,
  input: { date?: string; categories?: string; duration?: number; intensity?: number; notes?: string },
) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<WorkoutRow>(
    `select id, title, date, categories, duration_minutes as durationMinutes, intensity, notes
     from workouts
     where id = ? and user_id = ? and deleted_at is null
     limit 1`,
    [workoutId, userId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("운동 로그를 찾지 못했습니다.");

  const categories = input.categories === undefined ? row.title ?? row.categories : input.categories.trim();
  if (!categories) throw new Error("운동 카테고리는 비워둘 수 없습니다.");
  const duration = input.duration === undefined ? Number(row.durationMinutes ?? 0) : Math.max(0, Math.round(safeNumber(input.duration, 0)));
  const intensity = input.intensity === undefined ? clampScale(row.intensity ?? 3, 3) : clampScale(input.intensity, 3);
  const notes = input.notes === undefined ? row.notes : input.notes.trim() || null;

  await executeD1(
    `update workouts
     set title = ?,
         date = ?,
         categories = ?,
         duration_minutes = ?,
         intensity = ?,
         notes = ?,
         updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [categories, input.date ?? row.date, categories, duration, intensity, notes, workoutId, userId],
  );

  return getWorkoutDelta(userId, workoutId);
}

export async function deleteWorkout(workoutId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update workouts set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [workoutId, userId]);
  return { deletedWorkoutId: workoutId } satisfies LifeOpsMutationDelta;
}

export async function upsertHealthMetric(input: { date: string; sleepHours: number; deepWorkMinutes: number; weight?: number; stepsCount?: number }) {
  const { id: userId } = await resolveUser();
  const existing = await queryD1<{ id: string }>(`select id from health_metrics where user_id = ? and date = ? limit 1`, [userId, input.date]);
  if (existing.rows[0]?.id) {
    await executeD1(
      `update health_metrics
       set sleep_hours = ?, deep_work_minutes = ?, weight = ?, steps_count = ?, updated_at = datetime('now')
       where id = ?`,
      [input.sleepHours, input.deepWorkMinutes, input.weight ?? null, input.stepsCount ?? null, existing.rows[0].id],
    );
  } else {
    await executeD1(
      `insert into health_metrics (id, user_id, date, sleep_hours, deep_work_minutes, weight, steps_count, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [ulid(), userId, input.date, input.sleepHours, input.deepWorkMinutes, input.weight ?? null, input.stepsCount ?? null],
    );
  }
  return getLifeOpsDailyDelta(userId, input.date);
}

export async function createCareerEntry(input: { organization: string; role: string; category: string; startDate: string; endDate?: string | null; description?: string }) {
  const { id: userId } = await resolveUser();
  const organization = input.organization.trim();
  const role = input.role.trim();
  if (!organization || !role) throw new Error("조직명과 역할은 비워둘 수 없습니다.");
  const careerId = ulid();
  await executeD1(
    `insert into career_history
      (id, user_id, organization, role, category, start_date, end_date, location, description, highlights, cover_image_url, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, null, ?, null, null, datetime('now'), datetime('now'))`,
    [careerId, userId, organization, role, input.category.trim() || "work", input.startDate, input.endDate ?? null, input.description?.trim() || null],
  );
  return getCareerDelta(userId, careerId);
}

export async function updateCareerEntryProperties(
  careerId: string,
  input: { organization?: string; role?: string; category?: string; startDate?: string; endDate?: string | null; description?: string },
) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<CareerRow>(
    `select id, source_document_id as sourceDocumentId, organization, role, category, start_date as startDate, end_date as endDate, description
     from career_history
     where id = ? and user_id = ? and deleted_at is null
     limit 1`,
    [careerId, userId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("커리어 이력을 찾지 못했습니다.");

  const organization = input.organization === undefined ? row.organization : input.organization.trim();
  const role = input.role === undefined ? row.role : input.role.trim();
  if (!organization || !role) throw new Error("조직명과 역할은 비워둘 수 없습니다.");
  const category = normalizeCareerCategory(input.category, row.category);
  const endDate = input.endDate === undefined ? row.endDate : input.endDate?.trim() || null;
  const description = input.description === undefined ? row.description : input.description.trim() || null;

  await executeD1(
    `update career_history
     set organization = ?,
         role = ?,
         category = ?,
         start_date = ?,
         end_date = ?,
         description = ?,
         updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [organization, role, category, input.startDate ?? row.startDate, endDate, description, careerId, userId],
  );

  return getCareerDelta(userId, careerId);
}

export async function deleteCareerEntry(careerId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update career_history set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [careerId, userId]);
  return { deletedCareerId: careerId } satisfies LifeOpsMutationDelta;
}

function normalizeCareerCategory(value: string | undefined, fallback: string) {
  const next = value?.trim() || fallback;
  return ["work", "study", "service"].includes(next) ? next : "work";
}
