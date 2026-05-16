import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { getTodayString } from "@/lib/mock/life-ops";
import { getActionHubHydrationSnapshot, getActionHubTasks, seedActionHubSupportData, type ActionHubSnapshot } from "@/lib/server/action-hub";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getLifeOpsCareer, getLifeOpsHydrationSnapshot, getLifeOpsWorkouts, seedLifeOpsSupportData, type LifeOpsSnapshot } from "@/lib/server/life-ops";
import { getPRMGifts, getPRMHydrationSnapshot, getPRMPeople, seedPRMSupportData, type PRMSnapshot } from "@/lib/server/prm";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type DomainName = "action-hub" | "life-ops" | "prm";

type BenchmarkStep<T> = {
  durationMs: number;
  result: T;
};

type BenchmarkPath = {
  dataApiPath?: string;
  domain: DomainName;
  name: string;
  path: string;
  skipBootstrap?: boolean;
};

type RouteBenchmarkTarget = BenchmarkPath & {
  kind: "bootstrapApi" | "dataApi" | "page";
  pairPath: string;
};

type RouteBenchmarkEntry = RouteBenchmarkTarget & {
  contentType: string | null;
  durationMs: number;
  finalPath: string;
  jsonSummary: Record<string, number | string | null> | null;
  ok: boolean;
  payloadBytes: number;
  redirected: boolean;
  status: number;
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function createBenchmarkResponse(request: Request, payload: unknown, status = 200) {
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "html") {
    return NextResponse.json(payload, { status });
  }

  return new NextResponse(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Domain Route Payload Benchmark</title>
  </head>
  <body>
    <main>
      <h1>Domain Route Payload Benchmark</h1>
      <pre data-testid="benchmark-result">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </main>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

function isLocalRequest(request: Request) {
  return LOCAL_HOSTS.has(new URL(request.url).hostname);
}

function getPayloadBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

async function timeStep<T>(fn: () => Promise<T>): Promise<BenchmarkStep<T>> {
  const startedAt = performance.now();
  const result = await fn();
  return {
    durationMs: Math.round(performance.now() - startedAt),
    result,
  };
}

function bootstrapPath(domain: DomainName, path: string) {
  const params = new URLSearchParams({ path });
  return `/api/${domain}/bootstrap?${params.toString()}`;
}

function summarizeActionHubSnapshot(snapshot: ActionHubSnapshot) {
  return {
    pendingCaptures: snapshot.pendingCaptures.length,
    projects: snapshot.projects.length,
    referencePeople: snapshot.referencePeople.length,
    referenceZettels: snapshot.referenceZettels.length,
    tasks: snapshot.tasks.length,
  };
}

function summarizePRMSnapshot(snapshot: PRMSnapshot) {
  return {
    gifts: snapshot.gifts.length,
    networkEdges: snapshot.networkEdges.length,
    people: snapshot.people.length,
  };
}

function summarizeLifeOpsSnapshot(snapshot: LifeOpsSnapshot) {
  return {
    career: snapshot.career.length,
    habits: snapshot.habits.length,
    healthMetrics: snapshot.healthMetrics.length,
    logs: Object.keys(snapshot.logs).length,
    workouts: snapshot.workouts.length,
  };
}

function summarizeKnownJsonPayload(value: unknown): Record<string, number | string | null> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if ("projects" in record || "tasks" in record || "pendingCaptures" in record) {
    return {
      pendingCaptures: Array.isArray(record.pendingCaptures) ? record.pendingCaptures.length : null,
      projects: Array.isArray(record.projects) ? record.projects.length : null,
      referencePeople: Array.isArray(record.referencePeople) ? record.referencePeople.length : null,
      referenceZettels: Array.isArray(record.referenceZettels) ? record.referenceZettels.length : null,
      tasks: Array.isArray(record.tasks) ? record.tasks.length : null,
    };
  }

  if ("people" in record || "gifts" in record || "networkEdges" in record) {
    return {
      gifts: Array.isArray(record.gifts) ? record.gifts.length : null,
      networkEdges: Array.isArray(record.networkEdges) ? record.networkEdges.length : null,
      people: Array.isArray(record.people) ? record.people.length : null,
    };
  }

  if ("entries" in record) {
    return {
      entries: Array.isArray(record.entries) ? record.entries.length : null,
      nextOffset: typeof record.nextOffset === "number" ? record.nextOffset : null,
      total: typeof record.total === "number" ? record.total : null,
    };
  }

  if ("deepWork" in record || "heatmap" in record || "sleep" in record) {
    return {
      deepWork: Array.isArray(record.deepWork) ? record.deepWork.length : null,
      heatmap: Array.isArray(record.heatmap) ? record.heatmap.length : null,
      sleep: Array.isArray(record.sleep) ? record.sleep.length : null,
    };
  }

  if ("logs" in record || "habits" in record || "workouts" in record || "career" in record) {
    return {
      career: Array.isArray(record.career) ? record.career.length : null,
      habits: Array.isArray(record.habits) ? record.habits.length : null,
      healthMetrics: Array.isArray(record.healthMetrics) ? record.healthMetrics.length : null,
      logs: record.logs && typeof record.logs === "object" ? Object.keys(record.logs).length : null,
      workouts: Array.isArray(record.workouts) ? record.workouts.length : null,
    };
  }

  return null;
}

function summarizeJsonPayload(payload: ArrayBuffer) {
  try {
    return summarizeKnownJsonPayload(JSON.parse(new TextDecoder().decode(payload)));
  } catch {
    return null;
  }
}

async function fetchRouteBenchmark(request: Request, target: RouteBenchmarkTarget): Promise<RouteBenchmarkEntry> {
  const url = new URL(target.path, request.url);
  const headers = new Headers({
    accept: target.kind === "page" ? "text/html" : "application/json",
    "x-domain-route-payload-benchmark": "1",
  });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  const startedAt = performance.now();
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    redirect: "follow",
  });
  const payload = await response.arrayBuffer();
  const finalUrl = new URL(response.url);
  const contentType = response.headers.get("content-type");

  return {
    ...target,
    status: response.status,
    ok: response.ok,
    durationMs: Math.round(performance.now() - startedAt),
    payloadBytes: payload.byteLength,
    contentType,
    redirected: response.redirected,
    finalPath: `${finalUrl.pathname}${finalUrl.search}`,
    jsonSummary: contentType?.includes("application/json") ? summarizeJsonPayload(payload) : null,
  };
}

function buildRouteTargets(paths: BenchmarkPath[]) {
  const targets: RouteBenchmarkTarget[] = [];
  for (const entry of paths) {
    targets.push({ ...entry, kind: "page", pairPath: entry.path });
    if (!entry.skipBootstrap) {
      targets.push({
        domain: entry.domain,
        kind: "bootstrapApi",
        name: `${entry.name}BootstrapApi`,
        pairPath: entry.path,
        path: bootstrapPath(entry.domain, entry.path),
      });
    }
    if (entry.dataApiPath) {
      targets.push({
        ...entry,
        kind: "dataApi",
        name: `${entry.name}DataApi`,
        pairPath: entry.path,
        path: entry.dataApiPath,
      });
    }
  }
  return targets;
}

function buildDuplicateFetchCandidates(entries: RouteBenchmarkEntry[]) {
  const pages = entries.filter((entry) => entry.kind === "page");
  const apis = new Map(entries.filter((entry) => entry.kind === "bootstrapApi").map((entry) => [`${entry.domain}:${entry.pairPath}`, entry]));

  return pages
    .map((page) => {
      const bootstrapApi = apis.get(`${page.domain}:${page.pairPath}`);
      const bootstrapPayloadBytes = bootstrapApi?.payloadBytes ?? 0;
      const combinedPayloadBytes = page.payloadBytes + bootstrapPayloadBytes;
      return {
        domain: page.domain,
        path: page.pairPath,
        pagePayloadBytes: page.payloadBytes,
        bootstrapPayloadBytes,
        combinedPayloadBytes,
        bootstrapShare: combinedPayloadBytes > 0 ? Number((bootstrapPayloadBytes / combinedPayloadBytes).toFixed(3)) : 0,
        candidate: page.payloadBytes > 50_000 && bootstrapPayloadBytes > 10_000,
      };
    })
    .sort((left, right) => right.combinedPayloadBytes - left.combinedPayloadBytes);
}

async function createBenchmarkPaths() {
  await Promise.all([seedActionHubSupportData(), seedPRMSupportData(), seedLifeOpsSupportData()]);

  const [actionHubHome, actionHubTasks, prmPeople, prmGifts, lifeOpsWorkouts, lifeOpsCareer] = await Promise.all([
    getActionHubHydrationSnapshot("/action-hub"),
    getActionHubTasks(),
    getPRMPeople(),
    getPRMGifts(),
    getLifeOpsWorkouts(),
    getLifeOpsCareer(),
  ]);

  const actionProjectId = actionHubTasks.find((task) => task.projectId)?.projectId ?? actionHubHome.projects[0]?.id ?? null;
  const actionTaskId = actionHubTasks.find((task) => task.projectId === actionProjectId)?.id ?? null;
  const personId = prmPeople[0]?.id ?? null;
  const giftId = prmGifts.rows[0]?.id ?? null;
  const today = getTodayString();
  const workoutId = lifeOpsWorkouts[0]?.id ?? null;
  const careerId = lifeOpsCareer[0]?.id ?? null;

  const paths: BenchmarkPath[] = [
    { domain: "action-hub", name: "actionHubHome", path: "/action-hub" },
    { domain: "action-hub", name: "actionHubInbox", path: "/action-hub/inbox" },
    { domain: "action-hub", name: "actionHubArchive", path: "/action-hub/archive" },
    { domain: "prm", name: "prmHome", path: "/prm", skipBootstrap: true },
    { domain: "prm", name: "prmGifts", path: "/prm/gifts", skipBootstrap: true },
    { domain: "prm", name: "prmGraph", path: "/prm/graph", skipBootstrap: true },
    { domain: "prm", name: "prmHitThemUp", path: "/prm/hit-them-up", skipBootstrap: true },
    { domain: "life-ops", name: "lifeOpsHome", path: "/life-ops" },
    { domain: "life-ops", name: "lifeOpsToday", path: `/life-ops/${today}` },
    { domain: "life-ops", name: "lifeOpsHabits", path: "/life-ops/habits" },
    { domain: "life-ops", name: "lifeOpsWorkouts", path: "/life-ops/workouts" },
    { domain: "life-ops", name: "lifeOpsCareer", path: "/life-ops/career" },
    { dataApiPath: "/api/life-ops/trends", domain: "life-ops", name: "lifeOpsTrends", path: "/life-ops/trends" },
    { dataApiPath: "/api/life-ops/entries", domain: "life-ops", name: "lifeOpsEntries", path: "/life-ops/entries?view=journal" },
  ];

  if (actionProjectId) {
    paths.push(
      { domain: "action-hub", name: "actionHubProject", path: `/action-hub/${actionProjectId}` },
      { domain: "action-hub", name: "actionHubProjectList", path: `/action-hub/${actionProjectId}/list` },
      { domain: "action-hub", name: "actionHubProjectCalendar", path: `/action-hub/${actionProjectId}/calendar` },
    );
  }

  if (actionProjectId && actionTaskId) {
    paths.push({ domain: "action-hub", name: "actionHubTask", path: `/action-hub/${actionProjectId}/tasks/${actionTaskId}` });
  }

  if (personId) {
    paths.push(
      { domain: "prm", name: "prmFocusedHome", path: `/prm?detail=person:${personId}`, skipBootstrap: true },
      { domain: "prm", name: "prmPersonDetail", path: `/prm/${personId}`, skipBootstrap: true },
      { domain: "prm", name: "prmPersonEdit", path: `/prm/${personId}/edit`, skipBootstrap: true },
    );
  }

  if (giftId) {
    paths.push({ domain: "prm", name: "prmGiftDetail", path: `/prm/gifts/${giftId}` });
  }

  if (workoutId) {
    paths.push({ domain: "life-ops", name: "lifeOpsWorkoutDetail", path: `/life-ops/workouts/${workoutId}` });
  }

  if (careerId) {
    paths.push({ domain: "life-ops", name: "lifeOpsCareerDetail", path: `/life-ops/career/${careerId}` });
  }

  return {
    paths,
    sampleIds: {
      actionProjectId,
      actionTaskId,
      careerId,
      giftId,
      personId,
      today,
      workoutId,
    },
  };
}

async function measureHydrationSnapshots(paths: BenchmarkPath[]) {
  const entries = [];
  for (const entry of paths) {
    if (entry.domain === "action-hub") {
      const measured = await timeStep(() => getActionHubHydrationSnapshot(entry.path));
      entries.push({
        ...entry,
        durationMs: measured.durationMs,
        payloadBytes: getPayloadBytes(measured.result),
        summary: summarizeActionHubSnapshot(measured.result),
      });
    }

    if (entry.domain === "prm") {
      const measured = await timeStep(() => getPRMHydrationSnapshot(entry.path));
      entries.push({
        ...entry,
        durationMs: measured.durationMs,
        payloadBytes: getPayloadBytes(measured.result),
        summary: summarizePRMSnapshot(measured.result),
      });
    }

    if (entry.domain === "life-ops") {
      const measured = await timeStep(() => getLifeOpsHydrationSnapshot(entry.path));
      entries.push({
        ...entry,
        durationMs: measured.durationMs,
        payloadBytes: getPayloadBytes(measured.result),
        summary: summarizeLifeOpsSnapshot(measured.result),
      });
    }
  }
  return entries;
}

async function runBenchmark(request: Request) {
  const totalStartedAt = performance.now();
  const url = new URL(request.url);
  const includeRouteFetches = url.searchParams.get("routes") !== "0";

  try {
    const { paths, sampleIds } = await createBenchmarkPaths();
    const hydrationSnapshots = await timeStep(() => measureHydrationSnapshots(paths));
    const routeFetches = includeRouteFetches
      ? await timeStep(async () => {
          const entries: RouteBenchmarkEntry[] = [];
          for (const target of buildRouteTargets(paths)) {
            entries.push(await fetchRouteBenchmark(request, target));
          }

          return {
            count: entries.length,
            duplicateFetchCandidates: buildDuplicateFetchCandidates(entries),
            entries,
          };
        })
      : null;

    return {
      ok: true,
      totalDurationMs: Math.round(performance.now() - totalStartedAt),
      sampleIds,
      targetCount: paths.length,
      hydrationSnapshots,
      routeFetches,
    };
  } catch (error) {
    return {
      ok: false,
      totalDurationMs: Math.round(performance.now() - totalStartedAt),
      error: error instanceof Error ? error.message : "Unknown domain route payload benchmark failure",
    };
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return createBenchmarkResponse(request, { error: "Not found" }, 404);
  }

  const session = await getSession();
  if (!session) {
    if (!isLocalRequest(request)) {
      return createBenchmarkResponse(request, { error: "로그인이 필요합니다." }, 401);
    }

    const url = new URL(request.url);
    if (url.searchParams.get("session") === "created") {
      return createBenchmarkResponse(request, { error: "개발 검증 세션을 만들지 못했습니다." }, 401);
    }

    const admin = await syncConfiguredAdminUser();
    await createSession({ userId: admin.id });
    url.searchParams.set("session", "created");
    return NextResponse.redirect(url, { status: 303 });
  }

  const result = await runBenchmark(request);
  return createBenchmarkResponse(request, result, result.ok ? 200 : 500);
}
