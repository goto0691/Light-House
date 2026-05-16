import "server-only";

import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import type { EntityType } from "@/lib/context/types";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { queryD1 } from "@/lib/server/cloudflare-d1";
import { getContextBundle } from "@/lib/server/context";
import { getSearchReadModelItems } from "@/lib/server/search";
import { resolveCurrentUser } from "@/lib/server/session-user";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type SmokeCheck = { name: string; ok: boolean; detail?: string };
type SmokeEntityType = Extract<EntityType, "project" | "task" | "person" | "gift" | "zettel" | "media" | "place" | "workout" | "career" | "daily_log">;
type SmokeCandidate = { id: string; title: string };

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
    <title>Context Bundle Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Context Bundle Smoke Test</h1>
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

async function checkBundle(type: SmokeEntityType, checks: SmokeCheck[], options: { required?: boolean } = {}) {
  const candidate = await findSmokeCandidate(type);
  if (!candidate?.id) {
    addCheck(checks, `${type} candidate optional`, options.required === false, "no candidate data");
    const missingBundle = await getContextBundle(type, `missing-${type}`, { limit: 1 });
    addCheck(checks, `${type} missing bundle remains safe`, missingBundle.focus.type === type, missingBundle.focus.subtitle);
    return { skipped: true, reason: "no candidate data" };
  }

  addCheck(checks, `${type} candidate exists`, Boolean(candidate.id), candidate.title);

  const bundle = await getContextBundle(type, candidate.id, { limit: 8 });
  addCheck(checks, `${type} context bundle focuses requested entity`, bundle.focus.type === type && bundle.focus.id === candidate.id, bundle.focus.title);

  return {
    focus: { type: bundle.focus.type, id: bundle.focus.id, title: bundle.focus.title },
    totals: {
      nodes: bundle.nodes.length,
      edges: bundle.edges.length,
      people: bundle.grouped.people.length,
      projects: bundle.grouped.projects.length,
      zettels: bundle.grouped.zettels.length,
      source: bundle.grouped.source.length,
    },
  };
}

async function findSmokeCandidate(type: SmokeEntityType): Promise<SmokeCandidate | null> {
  if (type === "project" || type === "gift" || type === "workout" || type === "career" || type === "daily_log") {
    const user = await resolveCurrentUser();

    if (type === "project") {
      const result = await queryD1<SmokeCandidate>(
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

    if (type === "gift") {
      const result = await queryD1<SmokeCandidate>(
        `select id, title
         from gifts
         where user_id = ?
           and deleted_at is null
         order by occurred_at desc, created_at desc
         limit 1`,
        [user.id],
      );
      return result.rows[0] ?? null;
    }

    if (type === "workout") {
      const result = await queryD1<SmokeCandidate>(
        `select id, coalesce(title, categories) as title
         from workouts
         where user_id = ?
           and deleted_at is null
         order by date desc, created_at desc
         limit 1`,
        [user.id],
      );
      return result.rows[0] ?? null;
    }

    if (type === "career") {
      const result = await queryD1<SmokeCandidate>(
        `select id, organization as title
         from career_history
         where user_id = ?
           and deleted_at is null
         order by start_date desc, created_at desc
         limit 1`,
        [user.id],
      );
      return result.rows[0] ?? null;
    }

    const result = await queryD1<SmokeCandidate>(
      `select date as id, date as title
       from daily_logs
       where user_id = ?
         and deleted_at is null
       order by date desc
       limit 1`,
      [user.id],
    );
    return result.rows[0] ?? null;
  }

  return (await getSearchReadModelItems("", [type]))[0] ?? null;
}

async function runContextBundleSmokeTest() {
  const checks: SmokeCheck[] = [];

  try {
    const [project, task, person, gift, zettel] = await Promise.all([
      checkBundle("project", checks, { required: false }),
      checkBundle("task", checks),
      checkBundle("person", checks),
      checkBundle("gift", checks, { required: false }),
      checkBundle("zettel", checks),
    ]);
    const [media, place] = await Promise.all([checkBundle("media", checks), checkBundle("place", checks, { required: false })]);
    const [workout, career, dailyLog] = await Promise.all([
      checkBundle("workout", checks, { required: false }),
      checkBundle("career", checks, { required: false }),
      checkBundle("daily_log", checks, { required: false }),
    ]);

    return {
      ok: true,
      checks,
      samples: { project, task, person, gift, zettel, media, place, workout, career, dailyLog },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown context bundle smoke-test failure",
    };
  }
}

export async function handleContextBundleSmokeTest(request: Request) {
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

  const result = await runContextBundleSmokeTest();
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
