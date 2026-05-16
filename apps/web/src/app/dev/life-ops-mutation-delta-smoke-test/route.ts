import { NextResponse } from "next/server";
import { ulid } from "ulidx";

import { createSession, getSession } from "@/lib/auth/session";
import {
  createCareerEntry,
  createLifeOpsHabit,
  createWorkout,
  deleteCareerEntry,
  deleteWorkout,
  getLifeOpsCareer,
  getLifeOpsCareerEntry,
  getLifeOpsLog,
  getLifeOpsWorkout,
  getLifeOpsWorkouts,
  toggleHabitActive,
  toggleLifeOpsHabit,
  updateDailyEntry,
  updateCareerEntryProperties,
  updateLifeOpsDailyProperties,
  updateLifeOpsEnergy,
  updateLifeOpsHabitProperties,
  updateLifeOpsJournalField,
  updateLifeOpsMood,
  updateWorkoutProperties,
  upsertHealthMetric,
} from "@/lib/server/life-ops";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type SmokeCheck = { name: string; ok: boolean; detail?: string };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function createSmokeResponse(request: Request, payload: unknown, status = 200) {
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "html") {
    return NextResponse.json(payload, { status });
  }

  return new NextResponse(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>LifeOps Mutation Delta Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>LifeOps Mutation Delta Smoke Test</h1>
      <pre data-testid="smoke-result">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </main>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

function addCheck(checks: SmokeCheck[], name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  if (!ok) throw new Error(detail ? `${name}: ${detail}` : `${name} failed`);
}

function isLocalRequest(request: Request) {
  return LOCAL_HOSTS.has(new URL(request.url).hostname);
}

async function runSmokeTest() {
  const checks: SmokeCheck[] = [];
  const user = await resolveCurrentUser();
  const suffix = ulid().toLowerCase();
  const dailyDate = "2099-12-31";
  let dailyEntryId: string | null = null;
  let dailyLogId: string | null = null;
  let habitId: string | null = null;
  let workoutId: string | null = null;
  let careerId: string | null = null;

  try {
    const habitDelta = await createLifeOpsHabit({
      description: "Delta smoke habit description",
      icon: "D",
      schedule: "weekly",
      title: `Delta smoke habit ${suffix}`,
    });
    habitId = habitDelta.habit?.id ?? null;
    addCheck(checks, "habit create returns habit delta", habitDelta.habit?.title === `Delta smoke habit ${suffix}`);
    addCheck(checks, "habit create omits snapshot", !("snapshot" in habitDelta));

    const habitUpdateDelta = await updateLifeOpsHabitProperties(habitId ?? "", {
      description: "Delta smoke habit edited",
      icon: "H",
      isActive: true,
      schedule: "daily",
      title: `Delta smoke habit edited ${suffix}`,
    });
    addCheck(checks, "habit update returns edited habit", habitUpdateDelta.habit?.title === `Delta smoke habit edited ${suffix}`);
    addCheck(checks, "habit update preserves active flag", habitUpdateDelta.habit?.isActive === true);
    addCheck(checks, "habit update omits snapshot", !("snapshot" in habitUpdateDelta));

    const habitToggleDelta = await toggleHabitActive(habitId ?? "");
    addCheck(checks, "habit toggle returns toggled habit", habitToggleDelta.habit?.isActive === false);
    addCheck(checks, "habit toggle omits snapshot", !("snapshot" in habitToggleDelta));
    const habitReactivateDelta = await toggleHabitActive(habitId ?? "");
    addCheck(checks, "habit re-toggle returns active habit", habitReactivateDelta.habit?.isActive === true);

    const moodDelta = await updateLifeOpsMood(dailyDate, 4);
    addCheck(checks, "daily mood returns daily log delta", moodDelta.dailyLog?.date === dailyDate && moodDelta.dailyLog.mood === 4);
    addCheck(checks, "daily mood returns health metrics list", Array.isArray(moodDelta.healthMetrics));
    addCheck(checks, "daily mood omits snapshot", !("snapshot" in moodDelta));

    const energyDelta = await updateLifeOpsEnergy(dailyDate, 5);
    addCheck(checks, "daily energy returns daily log delta", energyDelta.dailyLog?.energy === 5);
    addCheck(checks, "daily energy omits snapshot", !("snapshot" in energyDelta));

    const dailyPropertiesDelta = await updateLifeOpsDailyProperties(dailyDate, {
      deepWorkMinutes: 77,
      emotions: ["검증", "델타"],
      gratitude: `Delta smoke gratitude ${suffix}`,
      journal: `Delta smoke journal ${suffix}`,
      meditation: `Delta smoke meditation ${suffix}`,
      meditationVerse: "요한복음 1:1",
      mood: 2,
      sleepHours: 7.5,
    });
    addCheck(checks, "daily properties returns edited log", dailyPropertiesDelta.dailyLog?.journal === `Delta smoke journal ${suffix}`);
    addCheck(checks, "daily properties returns metric delta", Boolean(dailyPropertiesDelta.healthMetrics?.some((item) => item.date === dailyDate && item.sleepHours === 7.5)));
    addCheck(checks, "daily properties omits snapshot", !("snapshot" in dailyPropertiesDelta));

    const dailyLogRead = await getLifeOpsLog(dailyDate);
    addCheck(checks, "daily log read model returns edited log", dailyLogRead.journal === `Delta smoke journal ${suffix}`);
    addCheck(checks, "daily log read model omits snapshot", !("snapshot" in dailyLogRead));

    const dailyHabitDelta = await toggleLifeOpsHabit(dailyDate, habitId ?? "");
    addCheck(checks, "daily habit toggle returns updated habit state", dailyHabitDelta.dailyLog?.habits.some((habit) => habit.id === habitId && habit.completedToday === true) === true);
    addCheck(checks, "daily habit toggle omits snapshot", !("snapshot" in dailyHabitDelta));

    const journalFieldDelta = await updateLifeOpsJournalField(dailyDate, "gratitude", `Delta smoke gratitude edited ${suffix}`);
    addCheck(checks, "daily journal field returns edited log", journalFieldDelta.dailyLog?.gratitude === `Delta smoke gratitude edited ${suffix}`);
    addCheck(checks, "daily journal field omits snapshot", !("snapshot" in journalFieldDelta));

    const healthDelta = await upsertHealthMetric({
      date: dailyDate,
      deepWorkMinutes: 88,
      sleepHours: 8,
      stepsCount: 1234,
      weight: 70.5,
    });
    addCheck(checks, "health metric upsert returns daily log delta", healthDelta.dailyLog?.deepWorkMinutes === 88);
    addCheck(checks, "health metric upsert returns health metrics list", Boolean(healthDelta.healthMetrics?.some((item) => item.date === dailyDate && item.stepsCount === 1234)));
    addCheck(checks, "health metric upsert omits snapshot", !("snapshot" in healthDelta));

    const dailyLogResult = await queryD1<{ id: string }>(`select id from daily_logs where user_id = ? and date = ? limit 1`, [user.id, dailyDate]);
    dailyLogId = dailyLogResult.rows[0]?.id ?? null;
    addCheck(checks, "daily log exists for entry smoke", Boolean(dailyLogId));
    dailyEntryId = `dev_life_ops_delta_entry_${suffix}`;
    await executeD1(
      `insert into daily_log_entries
        (id, user_id, daily_log_id, kind, title, date, body, emotion, event_summary, verse, background, tags_snapshot, created_at, updated_at)
       values (?, ?, ?, 'journal', 'Delta smoke entry', ?, 'Delta smoke entry body', null, null, null, null, null, datetime('now'), datetime('now'))`,
      [dailyEntryId, user.id, dailyLogId, dailyDate],
    );
    const dailyEntryDelta = await updateDailyEntry(dailyEntryId, {
      background: "Delta smoke entry edited background",
      body: `Delta smoke entry edited body ${suffix}`,
      emotion: "집중",
      eventSummary: "Delta smoke entry event",
      kind: "note",
      tagsSnapshot: "#delta",
      title: `Delta smoke entry edited ${suffix}`,
      verse: "시편 1:1",
    });
    addCheck(checks, "daily entry update returns daily log delta", dailyEntryDelta.dailyLog?.entries.some((entry) => entry.id === dailyEntryId && entry.title === `Delta smoke entry edited ${suffix}`) === true);
    addCheck(checks, "daily entry update omits snapshot", !("snapshot" in dailyEntryDelta));

    const workoutDelta = await createWorkout({
      categories: `Delta smoke workout ${suffix}`,
      date: "2026-05-14",
      duration: 42,
      intensity: 4,
      notes: "Delta smoke workout note",
    });
    workoutId = workoutDelta.workout?.id ?? null;
    addCheck(checks, "workout create returns workout delta", workoutDelta.workout?.categories === `Delta smoke workout ${suffix}`);
    addCheck(checks, "workout create omits snapshot", !("snapshot" in workoutDelta));

    const workoutsRead = await getLifeOpsWorkouts();
    addCheck(checks, "workouts read model includes created workout", workoutsRead.some((workout) => workout.id === workoutId));
    addCheck(checks, "workouts read model omits snapshot", !("snapshot" in workoutsRead));

    const workoutDetailRead = workoutId ? await getLifeOpsWorkout(workoutId) : null;
    addCheck(checks, "workout detail read model returns workout", workoutDetailRead?.id === workoutId);
    addCheck(checks, "workout detail read model omits snapshot", Boolean(workoutDetailRead && !("snapshot" in workoutDetailRead)));

    const workoutUpdateDelta = await updateWorkoutProperties(workoutId ?? "", {
      categories: `Delta smoke workout edited ${suffix}`,
      date: "2026-05-13",
      duration: 50,
      intensity: 5,
      notes: "Delta smoke workout edited note",
    });
    addCheck(checks, "workout update returns edited workout", workoutUpdateDelta.workout?.categories === `Delta smoke workout edited ${suffix}`);
    addCheck(checks, "workout update returns numeric fields", workoutUpdateDelta.workout?.duration === 50 && workoutUpdateDelta.workout.intensity === 5);
    addCheck(checks, "workout update omits snapshot", !("snapshot" in workoutUpdateDelta));

    const workoutDeleteDelta = await deleteWorkout(workoutId ?? "");
    addCheck(checks, "workout delete returns deleted id", workoutDeleteDelta.deletedWorkoutId === workoutId);
    addCheck(checks, "workout delete omits snapshot", !("snapshot" in workoutDeleteDelta));

    const careerDelta = await createCareerEntry({
      category: "work",
      description: "Delta smoke career description",
      endDate: null,
      organization: `Delta smoke org ${suffix}`,
      role: "Delta smoke role",
      startDate: "2026-01-01",
    });
    careerId = careerDelta.careerEntry?.id ?? null;
    addCheck(checks, "career create returns career delta", careerDelta.careerEntry?.organization === `Delta smoke org ${suffix}`);
    addCheck(checks, "career create omits snapshot", !("snapshot" in careerDelta));

    const careerRead = await getLifeOpsCareer();
    addCheck(checks, "career read model includes created entry", careerRead.some((career) => career.id === careerId));
    addCheck(checks, "career read model omits snapshot", !("snapshot" in careerRead));

    const careerDetailRead = careerId ? await getLifeOpsCareerEntry(careerId) : null;
    addCheck(checks, "career detail read model returns entry", careerDetailRead?.id === careerId);
    addCheck(checks, "career detail read model omits snapshot", Boolean(careerDetailRead && !("snapshot" in careerDetailRead)));

    const careerUpdateDelta = await updateCareerEntryProperties(careerId ?? "", {
      category: "study",
      description: "Delta smoke career edited description",
      endDate: "2026-05-01",
      organization: `Delta smoke org edited ${suffix}`,
      role: "Delta smoke edited role",
      startDate: "2025-12-01",
    });
    addCheck(checks, "career update returns edited career", careerUpdateDelta.careerEntry?.organization === `Delta smoke org edited ${suffix}`);
    addCheck(checks, "career update returns period", careerUpdateDelta.careerEntry?.period === "2025 - 2026");
    addCheck(checks, "career update omits snapshot", !("snapshot" in careerUpdateDelta));

    const careerDeleteDelta = await deleteCareerEntry(careerId ?? "");
    addCheck(checks, "career delete returns deleted id", careerDeleteDelta.deletedCareerId === careerId);
    addCheck(checks, "career delete omits snapshot", !("snapshot" in careerDeleteDelta));

    return {
      ok: true,
      checks,
      sample: {
        careerId,
        dailyDate,
        dailyEntryId,
        dailyLogId,
        habitId,
        workoutId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown LifeOps mutation delta smoke-test failure",
    };
  } finally {
    if (dailyEntryId) {
      await executeD1(`delete from taggings where taggable_type = 'daily_entry' and taggable_id = ?`, [dailyEntryId]).catch(() => undefined);
      await executeD1(`delete from daily_entry_people_relations where daily_entry_id = ?`, [dailyEntryId]).catch(() => undefined);
      await executeD1(`delete from daily_log_entries where id = ? and user_id = ?`, [dailyEntryId, user.id]).catch(() => undefined);
    }
    if (dailyLogId) {
      await executeD1(`delete from taggings where taggable_type = 'daily_log' and taggable_id = ?`, [dailyLogId]).catch(() => undefined);
    }
    await executeD1(`delete from habit_logs where date = ? and user_id = ?`, [dailyDate, user.id]).catch(() => undefined);
    await executeD1(`delete from health_metrics where date = ? and user_id = ?`, [dailyDate, user.id]).catch(() => undefined);
    await executeD1(`delete from daily_logs where date = ? and user_id = ?`, [dailyDate, user.id]).catch(() => undefined);
    if (habitId) {
      await executeD1(`delete from habit_logs where habit_id = ? and user_id = ?`, [habitId, user.id]).catch(() => undefined);
      await executeD1(`delete from habits where id = ? and user_id = ?`, [habitId, user.id]).catch(() => undefined);
    }
    if (workoutId) {
      await executeD1(`delete from workouts where id = ? and user_id = ?`, [workoutId, user.id]).catch(() => undefined);
    }
    if (careerId) {
      await executeD1(`delete from career_history where id = ? and user_id = ?`, [careerId, user.id]).catch(() => undefined);
    }
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return createSmokeResponse(request, { error: "Not found" }, 404);
  }

  const session = await getSession();
  if (!session) {
    if (!isLocalRequest(request)) {
      return createSmokeResponse(request, { error: "로그인이 필요합니다." }, 401);
    }

    const url = new URL(request.url);
    if (url.searchParams.get("session") === "created") {
      return createSmokeResponse(request, { error: "개발 검증 세션을 만들지 못했습니다." }, 401);
    }

    const admin = await syncConfiguredAdminUser();
    await createSession({ userId: admin.id });
    url.searchParams.set("session", "created");
    return NextResponse.redirect(url, { status: 303 });
  }

  const result = await runSmokeTest();
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
