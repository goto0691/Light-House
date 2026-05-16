import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { getTodayString } from "@/lib/mock/life-ops";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getLifeOpsHydrationSnapshot, seedLifeOpsSupportData } from "@/lib/server/life-ops";

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
    <title>LifeOps Hydration Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>LifeOps Hydration Smoke Test</h1>
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

  try {
    await seedLifeOpsSupportData();

    const today = getTodayString();
    const [home, dated, habits, workouts, career, trends, entries] = await Promise.all([
      getLifeOpsHydrationSnapshot("/life-ops"),
      getLifeOpsHydrationSnapshot(`/life-ops/${today}`),
      getLifeOpsHydrationSnapshot("/life-ops/habits"),
      getLifeOpsHydrationSnapshot("/life-ops/workouts"),
      getLifeOpsHydrationSnapshot("/life-ops/career"),
      getLifeOpsHydrationSnapshot("/life-ops/trends"),
      getLifeOpsHydrationSnapshot("/life-ops/entries?view=journal"),
    ]);
    const workoutId = workouts.workouts[0]?.id ?? null;
    const careerId = career.career[0]?.id ?? null;
    const [workoutDetail, careerDetail] = await Promise.all([
      workoutId ? getLifeOpsHydrationSnapshot(`/life-ops/workouts/${workoutId}`) : Promise.resolve(null),
      careerId ? getLifeOpsHydrationSnapshot(`/life-ops/career/${careerId}`) : Promise.resolve(null),
    ]);

    addCheck(checks, "home hydration returns today log", Boolean(home.logs[today]));
    addCheck(checks, "home hydration returns health metrics array", Array.isArray(home.healthMetrics));
    addCheck(checks, "home hydration omits list slices", home.habits.length === 0 && home.workouts.length === 0 && home.career.length === 0);
    addCheck(checks, "date hydration returns requested log", Boolean(dated.logs[today]));
    addCheck(checks, "date hydration omits list slices", dated.habits.length === 0 && dated.workouts.length === 0 && dated.career.length === 0);
    addCheck(checks, "habits hydration returns habits array", Array.isArray(habits.habits));
    addCheck(checks, "habits hydration omits daily and other lists", Object.keys(habits.logs).length === 0 && habits.workouts.length === 0 && habits.career.length === 0);
    addCheck(checks, "workouts hydration returns workouts array", Array.isArray(workouts.workouts));
    addCheck(checks, "workouts hydration omits daily and career", Object.keys(workouts.logs).length === 0 && workouts.career.length === 0);
    addCheck(checks, "workout detail hydration is scoped", workoutDetail ? workoutDetail.workouts.length <= 1 && workoutDetail.workouts[0]?.id === workoutId : true);
    addCheck(checks, "career hydration returns career array", Array.isArray(career.career));
    addCheck(checks, "career hydration omits daily and workouts", Object.keys(career.logs).length === 0 && career.workouts.length === 0);
    addCheck(checks, "career detail hydration is scoped", careerDetail ? careerDetail.career.length <= 1 && careerDetail.career[0]?.id === careerId : true);
    addCheck(checks, "trends hydration is empty", Object.keys(trends.logs).length === 0 && trends.habits.length === 0 && trends.workouts.length === 0 && trends.career.length === 0);
    addCheck(checks, "entries hydration is empty", Object.keys(entries.logs).length === 0 && entries.habits.length === 0 && entries.workouts.length === 0 && entries.career.length === 0);

    return {
      ok: true,
      checks,
      sample: {
        careerCount: career.career.length,
        careerId,
        habitCount: habits.habits.length,
        healthMetricCount: home.healthMetrics.length,
        today,
        workoutCount: workouts.workouts.length,
        workoutId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown LifeOps hydration smoke-test failure",
    };
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
