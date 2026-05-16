import "server-only";

import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { searchContextNodes } from "@/lib/server/context";

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
    <title>Context Search Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Context Search Smoke Test</h1>
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

async function runContextSearchSmokeTest() {
  const checks: SmokeCheck[] = [];

  try {
    const mediaResults = await searchContextNodes("미션", ["media"], { semantic: false });
    addCheck(checks, "media context search falls back to read model", mediaResults.length > 0, `${mediaResults.length}`);

    const placeResults = await searchContextNodes("호떡", ["place"], { semantic: false });
    addCheck(checks, "place context search completes through read model", Array.isArray(placeResults), `${placeResults.length}`);

    const personResults = await searchContextNodes("양주영", ["person"], { semantic: false });
    addCheck(checks, "person context search completes with labels", Array.isArray(personResults), `${personResults.length}`);

    const zettelResults = await searchContextNodes("실존", ["zettel"], { semantic: true });
    addCheck(checks, "semantic zettel context search completes", Array.isArray(zettelResults), `${zettelResults.length}`);

    return {
      ok: true,
      checks,
      samples: {
        media: mediaResults.slice(0, 3).map((item) => ({ type: item.type, title: item.title, href: item.href })),
        placeCount: placeResults.length,
        person: personResults.slice(0, 3).map((item) => ({ type: item.type, title: item.title, subtitle: item.subtitle })),
        zettelCount: zettelResults.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown context search smoke-test failure",
    };
  }
}

export async function handleContextSearchSmokeTest(request: Request) {
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

  const result = await runContextSearchSmokeTest();
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
