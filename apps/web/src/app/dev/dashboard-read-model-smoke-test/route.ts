import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { getTodayString } from "@/lib/mock/life-ops";
import { getActionHubTasks, seedActionHubSupportData } from "@/lib/server/action-hub";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getLifeOpsHabitHeatmap, getLifeOpsLog, getLifeOpsWeeklyRhythm, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getPRMNeedsContact, getPRMPeople, getPRMPeopleTouchedOn, seedPRMSupportData } from "@/lib/server/prm";
import { getVaultMediaList, getVaultZettelList, getVaultZettelsTouchedOn, seedVaultSupportData } from "@/lib/server/vault";

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
    <title>Dashboard Read Model Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Dashboard Read Model Smoke Test</h1>
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

function offsetDate(days: number) {
  const date = new Date(`${getTodayString()}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekDates() {
  const today = new Date(`${getTodayString()}T00:00:00+09:00`);
  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
}

async function runSmokeTest() {
  const checks: SmokeCheck[] = [];

  try {
    await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);

    const today = getTodayString();
    const yesterday = offsetDate(-1);
    const dates = weekDates();
    const [tasks, people, needsContact, touchedPeople, todayLog, weeklyRhythm, heatmap, zettels, media, touchedZettels] = await Promise.all([
      getActionHubTasks(),
      getPRMPeople(),
      getPRMNeedsContact(),
      getPRMPeopleTouchedOn(yesterday),
      getLifeOpsLog(today),
      getLifeOpsWeeklyRhythm(dates),
      getLifeOpsHabitHeatmap(),
      getVaultZettelList(),
      getVaultMediaList(),
      getVaultZettelsTouchedOn(yesterday),
    ]);

    addCheck(checks, "dashboard task read model returns array", Array.isArray(tasks));
    addCheck(checks, "dashboard task read model omits snapshot", !("snapshot" in tasks));
    addCheck(checks, "dashboard people read model returns array", Array.isArray(people));
    addCheck(checks, "dashboard people read model omits snapshot", !("snapshot" in people));
    addCheck(checks, "dashboard needs-contact read model is filtered", needsContact.every((person) => person.daysSinceContact > person.cadenceDays));
    addCheck(checks, "dashboard touched people read model returns array", Array.isArray(touchedPeople));
    addCheck(checks, "dashboard daily log read model returns today", todayLog.date === today);
    addCheck(checks, "dashboard weekly rhythm read model returns seven days", weeklyRhythm.length === 7);
    addCheck(checks, "dashboard heatmap read model returns data", heatmap.length > 0);
    addCheck(checks, "dashboard zettel read model returns array", Array.isArray(zettels));
    addCheck(checks, "dashboard media read model returns array", Array.isArray(media));
    addCheck(checks, "dashboard touched zettels read model returns array", Array.isArray(touchedZettels));

    return {
      ok: true,
      checks,
      sample: {
        mediaCount: media.length,
        needsContactCount: needsContact.length,
        peopleCount: people.length,
        taskCount: tasks.length,
        today,
        touchedPeopleCount: touchedPeople.length,
        touchedZettelsCount: touchedZettels.length,
        zettelCount: zettels.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown dashboard read model smoke-test failure",
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
