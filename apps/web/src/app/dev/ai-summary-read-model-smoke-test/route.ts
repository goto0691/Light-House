import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { buildAISummarySourceMaterial } from "@/lib/server/ai";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type SmokeCheck = { name: string; ok: boolean; detail?: string };
type ProjectCandidateRow = { id: string; title: string };

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
    <title>AI Summary Read Model Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>AI Summary Read Model Smoke Test</h1>
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

async function findProjectCandidate() {
  const user = await resolveCurrentUser();
  const result = await queryD1<ProjectCandidateRow>(
    `select id, title
     from projects
     where user_id = ?
       and deleted_at is null
     order by pinned desc, display_order asc, created_at asc
     limit 1`,
    [user.id],
  );

  return result.rows[0] ?? null;
}

async function runSmokeTest() {
  const checks: SmokeCheck[] = [];

  try {
    const daily = await buildAISummarySourceMaterial({ type: "daily" });
    addCheck(checks, "daily source material generated", daily.markdown.includes("# Daily Summary"), daily.date);
    addCheck(checks, "daily source material uses compact counters", daily.markdown.includes("진행 중 Task") || daily.markdown.includes("Life Ops 기록이 아직 없습니다."));

    const weekly = await buildAISummarySourceMaterial({ type: "weekly" });
    addCheck(checks, "weekly source material generated", weekly.markdown.includes("# Weekly Review"), weekly.date);
    addCheck(checks, "weekly source material includes follow-up", weekly.markdown.includes("## Follow-up"));

    const projectCandidate = await findProjectCandidate();
    let project: Awaited<ReturnType<typeof buildAISummarySourceMaterial>> | { skipped: true; reason: string } = {
      skipped: true,
      reason: "no project candidate",
    };

    if (projectCandidate) {
      const projectMaterial = await buildAISummarySourceMaterial({ type: "project", id: projectCandidate.id });
      addCheck(checks, "project source material generated", projectMaterial.markdown.includes("# Project Summary"), projectCandidate.title);
      addCheck(checks, "project source material references candidate", projectMaterial.markdown.includes(projectCandidate.title));
      project = projectMaterial;
    } else {
      addCheck(checks, "project candidate optional", true, "no project candidate");
    }

    return {
      ok: true,
      checks,
      samples: {
        daily: { date: daily.date, length: daily.markdown.length },
        weekly: { date: weekly.date, length: weekly.markdown.length },
        project:
          "skipped" in project
            ? project
            : {
                id: project.projectId,
                length: project.markdown.length,
              },
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown AI summary read model smoke-test failure",
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
