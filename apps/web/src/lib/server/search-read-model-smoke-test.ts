import "server-only";

import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getSearchReadModelItems, searchWithFTS } from "@/lib/server/search";

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
    <title>Search Read Model Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Search Read Model Smoke Test</h1>
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

async function runSearchReadModelSmokeTest() {
  const checks: SmokeCheck[] = [];

  try {
    const mediaResults = await getSearchReadModelItems("미션", ["media"]);
    addCheck(checks, "media read model returns mission results", mediaResults.length > 0, `${mediaResults.length}`);

    const emptyResults = await getSearchReadModelItems("", undefined);
    addCheck(checks, "empty read model returns ranked suggestions", emptyResults.length > 0, `${emptyResults.length}`);

    const placeResults = await getSearchReadModelItems("호떡", ["place"]);
    addCheck(checks, "place read model query completes", Array.isArray(placeResults), `${placeResults.length}`);

    const ftsResults = await searchWithFTS("미션", ["media"]);
    addCheck(checks, "fts search path completes", ftsResults === null || Array.isArray(ftsResults), ftsResults === null ? "fts unavailable" : `${ftsResults.length}`);

    return {
      ok: true,
      checks,
      samples: {
        media: mediaResults.slice(0, 3).map((item) => ({ type: item.type, title: item.title, href: item.href })),
        empty: emptyResults.slice(0, 5).map((item) => ({ type: item.type, title: item.title, href: item.href })),
        placeCount: placeResults.length,
        ftsCount: ftsResults?.length ?? null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown search read model smoke-test failure",
    };
  }
}

export async function handleSearchReadModelSmokeTest(request: Request) {
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

  const result = await runSearchReadModelSmokeTest();
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
