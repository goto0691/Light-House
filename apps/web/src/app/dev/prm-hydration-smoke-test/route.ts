import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getPRMHydrationSnapshot, seedPRMSupportData } from "@/lib/server/prm";

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
    <title>PRM Hydration Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>PRM Hydration Smoke Test</h1>
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
    await seedPRMSupportData();

    const [home, gifts, graph, hitThemUp] = await Promise.all([
      getPRMHydrationSnapshot("/prm"),
      getPRMHydrationSnapshot("/prm/gifts"),
      getPRMHydrationSnapshot("/prm/graph"),
      getPRMHydrationSnapshot("/prm/hit-them-up"),
    ]);
    const personId = home.people[0]?.id ?? gifts.people[0]?.id ?? graph.people[0]?.id ?? null;
    const focusedHome = personId ? await getPRMHydrationSnapshot(`/prm?detail=person:${personId}`) : null;
    const personDetail = personId ? await getPRMHydrationSnapshot(`/prm/${personId}`) : null;

    addCheck(checks, "home hydration returns people", home.people.length > 0);
    addCheck(checks, "home hydration omits gifts", home.gifts.length === 0);
    addCheck(checks, "home hydration omits network edges", home.networkEdges.length === 0);
    addCheck(checks, "gifts hydration returns people", gifts.people.length > 0);
    addCheck(checks, "gifts hydration returns gifts array", Array.isArray(gifts.gifts));
    addCheck(checks, "gifts hydration omits network edges", gifts.networkEdges.length === 0);
    addCheck(checks, "graph hydration returns people", graph.people.length > 0);
    addCheck(checks, "graph hydration returns network edges array", Array.isArray(graph.networkEdges));
    addCheck(checks, "graph hydration omits gifts", graph.gifts.length === 0);
    addCheck(checks, "hit-them-up hydration returns filtered people array", Array.isArray(hitThemUp.people));
    addCheck(checks, "focused home hydration includes gifts", focusedHome ? Array.isArray(focusedHome.gifts) : true);
    addCheck(checks, "focused home hydration includes focused person", focusedHome ? focusedHome.people.some((person) => person.id === personId) : true);
    addCheck(checks, "person detail hydration is scoped", personDetail ? personDetail.people.length <= 1 && personDetail.gifts.length === 0 && personDetail.networkEdges.length === 0 : true);

    return {
      ok: true,
      checks,
      sample: {
        focusedPersonId: personId,
        giftCount: gifts.gifts.length,
        graphEdgeCount: graph.networkEdges.length,
        hitThemUpPeople: hitThemUp.people.length,
        homePeople: home.people.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown PRM hydration smoke-test failure",
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
