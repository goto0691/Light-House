import "server-only";

import { cache } from "react";
import type { CareerLog, DailyLogMock, HabitDefinition, HealthMetric, WorkoutLog } from "@/lib/mock/life-ops";
import type { SourceDocumentInfo } from "@/lib/mock/vault";
import { getTodayString } from "@/lib/mock/life-ops";
import { getSession } from "@/lib/auth/session";
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
type SourceDocumentRow = { id: string; sourceDatabase: string | null; sourceId: string; documentRole: string | null; status: string; preview: string | null };
type SourceDocumentPropertyRow = { sourceDocumentId: string; name: string; value: string | null };
type DailyPersonRow = {
  date: string;
  time: string;
  label: string;
  type: string;
};
type WorkoutRow = {
  id: string;
  date: string;
  categories: string;
  durationMinutes: number | null;
  intensity: number | null;
  notes: string | null;
};
type CareerRow = {
  id: string;
  organization: string;
  role: string;
  category: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
};

function parseJsonArray(value: string | null) {
  if (!value) return [] as string[];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

async function resolveUser() {
  const session = await getSession();
  if (!session) throw new Error("세션이 없습니다.");
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

async function getSourceDocumentForEntity(userId: string, entityType: string, entityId: string): Promise<SourceDocumentInfo | null> {
  const sourceDocument = await queryD1<SourceDocumentRow>(
    `select id, source_database as sourceDatabase, source_id as sourceId, document_role as documentRole, status, raw_content_preview as preview
     from source_documents
     where user_id = ? and canonical_entity_type = ? and canonical_entity_id = ? and deleted_at is null
     limit 1`,
    [userId, entityType, entityId],
  );
  const row = sourceDocument.rows[0];
  if (!row) return null;
  const properties = await queryD1<SourceDocumentPropertyRow>(
    `select source_document_id as sourceDocumentId, property_name as name, value_text as value
     from source_document_properties
     where source_document_id = ?
     order by property_key`,
    [row.id],
  );
  return {
    id: row.id,
    sourceDatabase: row.sourceDatabase,
    sourceId: row.sourceId,
    documentRole: row.documentRole,
    status: row.status,
    preview: row.preview,
    properties: properties.rows.filter((property) => property.value).map((property) => ({ name: property.name, value: property.value! })),
  };
}

export const getLifeOpsSnapshot = cache(async function getLifeOpsSnapshot(dates?: string[]): Promise<LifeOpsSnapshot> {
  const { id: userId } = await resolveUser();
  const targetDates = dates?.length ? dates : [getTodayString(), "2026-04-22", "2026-04-21"];
  const logs: Record<string, DailyLogMock> = {};

  const [habitsResult, healthMetricRows, workoutsResult, careerResult] = await Promise.all([
    queryD1<HabitDefinitionRow>(
      `select id, title, description, icon, schedule, is_active as isActive, display_order as displayOrder
       from habits where user_id = ? order by display_order asc, created_at asc`,
      [userId],
    ),
    queryD1<HealthMetricRow>(
      `select id, date, sleep_hours as sleepHours, deep_work_minutes as deepWorkMinutes, weight, steps_count as stepsCount
       from health_metrics where user_id = ? order by date desc limit 30`,
      [userId],
    ),
    queryD1<WorkoutRow>(
      `select id, date, categories, duration_minutes as durationMinutes, intensity, notes
       from workouts where user_id = ? and deleted_at is null order by date desc`,
      [userId],
    ),
    queryD1<CareerRow>(
      `select id, organization, role, category, start_date as startDate, end_date as endDate, description
       from career_history where user_id = ? and deleted_at is null order by start_date desc`,
      [userId],
    ),
  ]);

  const dailyEntries = await Promise.all(targetDates.map(async (date) => {
    const [dailyResult, habitsStateResult, metricsResult, taskTimeline, interactionTimeline, zettelTimeline, dailyPeopleTimeline] = await Promise.all([
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
      const sourceDocument = row ? await getSourceDocumentForEntity(userId, "daily_log", row.id) : null;
      const metrics = metricsResult.rows;
      return [date, {
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
      sleepHours: metrics.map((item) => Number(item.sleepHours ?? 0)).reverse(),
      deepWorkMinutes: Number(metrics[0]?.deepWorkMinutes ?? 0),
      timeline: [...taskTimeline.rows, ...interactionTimeline.rows, ...zettelTimeline.rows, ...dailyPeopleTimeline.rows]
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
        .slice(0, 6)
        .map((item) => ({ time: item.time.slice(0, 5), label: item.label, type: item.type })),
      sourceDocument,
    } satisfies DailyLogMock] as const;
  }));

  for (const [date, log] of dailyEntries) {
    logs[date] = log;
  }

  return {
    logs,
    habits: habitsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      icon: row.icon ?? "•",
      schedule: row.schedule ?? "daily",
      isActive: Boolean(row.isActive),
    })),
    workouts: workoutsResult.rows.map((row) => ({
      id: row.id,
      date: row.date,
      categories: row.categories,
      duration: Number(row.durationMinutes ?? 0),
      intensity: Number(row.intensity ?? 0),
      notes: row.notes ?? "",
    })),
    career: careerResult.rows.map((row) => ({
      id: row.id,
      organization: row.organization,
      role: row.role,
      category: row.category,
      period: row.endDate ? `${row.startDate.slice(0, 4)} - ${row.endDate.slice(0, 4)}` : `${row.startDate.slice(0, 4)} - 현재`,
      description: row.description ?? "",
    })),
    healthMetrics: healthMetricRows.rows.map((row) => ({
      id: row.id,
      date: row.date,
      sleepHours: Number(row.sleepHours ?? 0),
      deepWorkMinutes: Number(row.deepWorkMinutes ?? 0),
      weight: row.weight ?? undefined,
      stepsCount: Number(row.stepsCount ?? 0),
    })),
  };
});

export async function getLifeOpsLog(date: string) {
  const snapshot = await getLifeOpsSnapshot([date]);
  return snapshot.logs[date] ?? null;
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
  const snapshot = await getLifeOpsSnapshot();
  return snapshot.workouts;
}

export async function getLifeOpsCareer() {
  const snapshot = await getLifeOpsSnapshot();
  return snapshot.career;
}

export async function getLifeOpsCareerEntry(careerId: string) {
  const snapshot = await getLifeOpsSnapshot();
  return snapshot.career.find((item) => item.id === careerId) ?? null;
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

export async function updateLifeOpsMood(date: string, mood: number) {
  const { id: userId } = await resolveUser();
  await ensureDailyLog(userId, date);
  await executeD1(`update daily_logs set mood = ?, updated_at = datetime('now') where user_id = ? and date = ?`, [mood, userId, date]);
  return getLifeOpsSnapshot([date]);
}

export async function updateLifeOpsEnergy(date: string, energy: number) {
  const { id: userId } = await resolveUser();
  await ensureDailyLog(userId, date);
  await executeD1(`update daily_logs set energy_level = ?, updated_at = datetime('now') where user_id = ? and date = ?`, [energy, userId, date]);
  return getLifeOpsSnapshot([date]);
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
  return getLifeOpsSnapshot([date]);
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
  return getLifeOpsSnapshot([date]);
}

export async function createLifeOpsHabit(input: { title: string; description?: string; icon?: string; schedule?: string }) {
  const { id: userId } = await resolveUser();
  const title = input.title.trim();
  if (!title) throw new Error("습관 이름은 비워둘 수 없습니다.");
  const nextOrder = await queryD1<{ nextOrder: number | null }>(`select coalesce(max(display_order), -1) + 1 as nextOrder from habits where user_id = ?`, [userId]);
  await executeD1(
    `insert into habits
      (id, user_id, title, description, type, target_value, unit, icon, color, schedule, is_active, display_order, created_at, updated_at)
     values (?, ?, ?, ?, 'boolean', 1, 'session', ?, 'gold', ?, 1, ?, datetime('now'), datetime('now'))`,
    [ulid(), userId, title, input.description?.trim() || null, input.icon?.trim() || "•", input.schedule?.trim() || "daily", Number(nextOrder.rows[0]?.nextOrder ?? 0)],
  );
  return getLifeOpsSnapshot();
}

export async function toggleHabitActive(habitId: string) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<{ isActive: number | null }>(`select is_active as isActive from habits where id = ? and user_id = ? limit 1`, [habitId, userId]);
  if (!current.rows[0]) throw new Error("습관을 찾지 못했습니다.");
  const next = current.rows[0].isActive ? 0 : 1;
  await executeD1(`update habits set is_active = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [next, habitId, userId]);
  return getLifeOpsSnapshot();
}

export async function createWorkout(input: { date: string; categories: string; duration: number; intensity: number; notes?: string }) {
  const { id: userId } = await resolveUser();
  const categories = input.categories.trim();
  if (!categories) throw new Error("운동 카테고리는 비워둘 수 없습니다.");
  await executeD1(
    `insert into workouts (id, user_id, date, categories, duration_minutes, intensity, notes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [ulid(), userId, input.date, categories, input.duration, input.intensity, input.notes?.trim() || null],
  );
  return getLifeOpsSnapshot();
}

export async function deleteWorkout(workoutId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update workouts set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [workoutId, userId]);
  return getLifeOpsSnapshot();
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
  return getLifeOpsSnapshot([input.date]);
}

export async function createCareerEntry(input: { organization: string; role: string; category: string; startDate: string; endDate?: string | null; description?: string }) {
  const { id: userId } = await resolveUser();
  const organization = input.organization.trim();
  const role = input.role.trim();
  if (!organization || !role) throw new Error("조직명과 역할은 비워둘 수 없습니다.");
  await executeD1(
    `insert into career_history
      (id, user_id, organization, role, category, start_date, end_date, location, description, highlights, cover_image_url, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, null, ?, null, null, datetime('now'), datetime('now'))`,
    [ulid(), userId, organization, role, input.category.trim() || "work", input.startDate, input.endDate ?? null, input.description?.trim() || null],
  );
  return getLifeOpsSnapshot();
}

export async function deleteCareerEntry(careerId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update career_history set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [careerId, userId]);
  return getLifeOpsSnapshot();
}
