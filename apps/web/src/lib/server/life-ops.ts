import "server-only";

import type { DailyLogMock } from "@/lib/mock/life-ops";
import { getTodayString } from "@/lib/mock/life-ops";
import { getSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

export type LifeOpsSnapshot = {
  logs: Record<string, DailyLogMock>;
};

export type WorkoutItem = {
  id: string;
  date: string;
  categories: string;
  duration: number;
  intensity: number;
};

export type CareerItem = {
  id: string;
  organization: string;
  role: string;
  period: string;
};

type UserRow = { id: string };
type DailyLogRow = {
  date: string;
  mood: number | null;
  energyLevel: number | null;
  emotions: string | null;
  gratitude: string | null;
  journal: string | null;
  meditation: string | null;
  meditationVerse: string | null;
};
type HabitRow = {
  id: string;
  title: string;
  icon: string | null;
  displayOrder: number | null;
  completedToday: number;
  streak: number;
};
type HealthMetricRow = {
  date: string;
  sleepHours: number | null;
  deepWorkMinutes: number | null;
};
type TimelineRow = {
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
};
type CareerRow = {
  id: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string | null;
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
    { date: "2026-04-23", mood: 4, energy: 3, sleep: 6.8, deepWork: 165, gratitude: "재민과의 대화에서 겨울 메뉴 방향이 더 또렷해졌다.", journal: "오늘은 Project Light House의 P1을 닫고 Life Ops의 Daily Command Center로 넘어왔다.", meditation: "불안은 피해야 할 대상이 아니라 방향을 알려주는 신호일 수 있다.", verse: "시편 23:1", emotions: '["차분함","집중","감사"]' },
    { date: "2026-04-22", mood: 3, energy: 4, sleep: 7.3, deepWork: 190, gratitude: "몰입감이 좋았다.", journal: "Action Hub와 PRM 연결 흐름을 다듬었다.", meditation: "기록은 현실을 정리하는 기도와 닮아 있다.", verse: "잠언 4:23", emotions: '["집중","평온"]' },
    { date: "2026-04-21", mood: 4, energy: 3, sleep: 6.7, deepWork: 150, gratitude: "민서와의 대화가 큰 위로가 됐다.", journal: "이번 주 감정선이 조금씩 안정됐다.", meditation: "서두르지 않는 것이 믿음일 수 있다.", verse: "시편 27:14", emotions: '["감사","차분함"]' },
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
        (id, user_id, date, sleep_hours, deep_work_minutes, created_at, updated_at)
       values (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [`health-${day.date}`, userId, day.date, day.sleep, day.deepWork],
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
      ('workout-1', ?, '2026-04-23', '등 · 유산소', 70, 4, null, datetime('now'), datetime('now')),
      ('workout-2', ?, '2026-04-21', '가슴 · 삼두', 65, 3, null, datetime('now'), datetime('now')),
      ('workout-3', ?, '2026-04-19', '하체', 82, 5, null, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into career_history
      (id, user_id, organization, role, category, start_date, end_date, location, description, highlights, cover_image_url, created_at, updated_at)
     values
      ('career-1', ?, 'MODU WORKS', 'Product Builder', 'work', '2024-01-01', null, 'Seoul', null, null, null, datetime('now'), datetime('now')),
      ('career-2', ?, 'Trauma Repair Lab', 'Writer / Researcher', 'work', '2022-01-01', '2024-01-01', 'Seoul', null, null, null, datetime('now'), datetime('now')),
      ('career-3', ?, 'Community Fellowship', 'Volunteer', 'service', '2020-01-01', '2022-01-01', 'Seoul', null, null, null, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );
}

async function getHabitRows(userId: string, date: string) {
  return queryD1<HabitRow>(
    `select
       h.id, h.title, h.icon, h.display_order as displayOrder,
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

export async function getLifeOpsSnapshot(dates?: string[]): Promise<LifeOpsSnapshot> {
  const { id: userId } = await resolveUser();
  const targetDates = dates?.length ? dates : [getTodayString(), "2026-04-22", "2026-04-21"];
  const logs: Record<string, DailyLogMock> = {};

  for (const date of targetDates) {
    const [dailyResult, habitsResult, metricsResult, taskTimeline, interactionTimeline, zettelTimeline] = await Promise.all([
      queryD1<DailyLogRow>(
        `select date, mood, energy_level as energyLevel, emotions, gratitude, journal, meditation, meditation_verse as meditationVerse
         from daily_logs where user_id = ? and date = ? limit 1`,
        [userId, date],
      ),
      getHabitRows(userId, date),
      queryD1<HealthMetricRow>(
        `select date, sleep_hours as sleepHours, deep_work_minutes as deepWorkMinutes
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
         from interactions where user_id = ? and occurred_at = ? order by created_at desc limit 4`,
        [userId, date],
      ),
      queryD1<TimelineRow>(
        `select date(coalesce(updated_at, created_at)) as date, time(coalesce(updated_at, created_at)) as time, title as label, 'zettel' as type
         from zettels where user_id = ? and date(coalesce(updated_at, created_at)) = ? order by updated_at desc limit 4`,
        [userId, date],
      ),
    ]);

    const row = dailyResult.rows[0];
    const metrics = metricsResult.rows;
    logs[date] = {
      date,
      mood: row?.mood ?? 3,
      energy: row?.energyLevel ?? 3,
      emotions: parseJsonArray(row?.emotions ?? null),
      gratitude: row?.gratitude ?? "",
      journal: row?.journal ?? "",
      meditation: row?.meditation ?? "",
      meditationVerse: row?.meditationVerse ?? "",
      habits: habitsResult.rows.map((habit) => ({
        id: habit.id,
        title: habit.title,
        icon: habit.icon ?? "•",
        streak: Number(habit.streak ?? 0),
        completedToday: Boolean(habit.completedToday),
      })),
      sleepHours: metrics.map((item) => Number(item.sleepHours ?? 0)).reverse(),
      deepWorkMinutes: Number(metrics[0]?.deepWorkMinutes ?? 0),
      timeline: [...taskTimeline.rows, ...interactionTimeline.rows, ...zettelTimeline.rows]
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
        .slice(0, 6)
        .map((item) => ({
          time: item.time.slice(0, 5),
          label: item.label,
          type: item.type,
        })),
    };
  }

  return { logs };
}

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

export async function getLifeOpsWorkouts() {
  const { id: userId } = await resolveUser();
  const result = await queryD1<WorkoutRow>(
    `select id, date, categories, duration_minutes as durationMinutes, intensity
     from workouts where user_id = ? order by date desc`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    date: row.date,
    categories: row.categories,
    duration: Number(row.durationMinutes ?? 0),
    intensity: Number(row.intensity ?? 0),
  })) satisfies WorkoutItem[];
}

export async function getLifeOpsCareer() {
  const { id: userId } = await resolveUser();
  const result = await queryD1<CareerRow>(
    `select id, organization, role, start_date as startDate, end_date as endDate
     from career_history where user_id = ? order by start_date desc`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    organization: row.organization,
    role: row.role,
    period: row.endDate ? `${row.startDate.slice(0, 4)} - ${row.endDate.slice(0, 4)}` : `${row.startDate.slice(0, 4)} - 현재`,
  })) satisfies CareerItem[];
}

export async function updateLifeOpsMood(date: string, mood: number) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update daily_logs set mood = ?, updated_at = datetime('now') where user_id = ? and date = ?`,
    [mood, userId, date],
  );
  return getLifeOpsSnapshot([date]);
}

export async function updateLifeOpsEnergy(date: string, energy: number) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update daily_logs set energy_level = ?, updated_at = datetime('now') where user_id = ? and date = ?`,
    [energy, userId, date],
  );
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
    await executeD1(
      `insert into habit_logs (id, user_id, habit_id, date, value, note, created_at) values (?, ?, ?, ?, 1, null, datetime('now'))`,
      [`${habitId}-${date}`, userId, habitId, date],
    );
  }
  return getLifeOpsSnapshot([date]);
}

export async function updateLifeOpsJournalField(date: string, field: "journal" | "meditation" | "gratitude", value: string) {
  const { id: userId } = await resolveUser();
  const columns = {
    journal: "journal",
    meditation: "meditation",
    gratitude: "gratitude",
  } as const;
  await executeD1(`update daily_logs set ${columns[field]} = ?, updated_at = datetime('now') where user_id = ? and date = ?`, [value, userId, date]);
  return getLifeOpsSnapshot([date]);
}
