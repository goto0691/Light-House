import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { getContextBundle } from "@/lib/server/context";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getVaultZettel, getVaultZettelGraph, getVaultZettelList, seedVaultSupportData } from "@/lib/server/vault";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type BenchmarkStep<T> = {
  durationMs: number;
  result: T;
};

type RouteBenchmarkTarget = {
  name: string;
  path: string;
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
    <title>Vault Read Model Benchmark</title>
  </head>
  <body>
    <main>
      <h1>Vault Read Model Benchmark</h1>
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

async function fetchRouteBenchmark(request: Request, target: RouteBenchmarkTarget) {
  const url = new URL(target.path, request.url);
  const headers = new Headers({
    accept: target.path.startsWith("/api/") ? "application/json" : "text/html",
    "x-vault-read-model-benchmark": "1",
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
  const jsonSummary = contentType?.includes("application/json") ? summarizeJsonPayload(payload) : null;

  return {
    name: target.name,
    path: target.path,
    status: response.status,
    ok: response.ok,
    durationMs: Math.round(performance.now() - startedAt),
    payloadBytes: payload.byteLength,
    contentType,
    redirected: response.redirected,
    finalPath: `${finalUrl.pathname}${finalUrl.search}`,
    jsonSummary,
  };
}

function summarizeJsonPayload(payload: ArrayBuffer) {
  try {
    const data = JSON.parse(new TextDecoder().decode(payload)) as {
      nextOffset?: number | null;
      offset?: number;
      total?: number;
      zettel?: unknown;
      zettels?: unknown[];
    };
    return {
      hasZettel: Boolean(data.zettel),
      nextOffset: data.nextOffset ?? null,
      offset: data.offset ?? null,
      total: data.total ?? null,
      zettelCount: Array.isArray(data.zettels) ? data.zettels.length : null,
    };
  } catch {
    return null;
  }
}

async function runBenchmark(request: Request) {
  const totalStartedAt = performance.now();
  const url = new URL(request.url);
  const includeHeavy = url.searchParams.get("heavy") === "1";
  const includeRouteFetches = url.searchParams.get("routes") !== "0";

  try {
    await seedVaultSupportData();

    const zettelList = await timeStep(async () => {
      const zettels = await getVaultZettelList();
      const payloadBytes = getPayloadBytes(zettels);
      return {
        count: zettels.length,
        firstId: zettels[0]?.id ?? null,
        firstContentLength: zettels[0]?.content.length ?? 0,
        payloadBytes,
        sourceDocumentCount: zettels.filter((zettel) => zettel.sourceDocument).length,
        sourceDocumentPropertyCount: zettels.reduce((count, zettel) => count + (zettel.sourceDocument?.properties.length ?? 0), 0),
        sourcePropertySearchTextCount: zettels.filter((zettel) => zettel.sourcePropertySearchText).length,
        totalOutgoingLinks: zettels.reduce((count, zettel) => count + zettel.outgoingLinks.length, 0),
      };
    });

    const zettelDetail = await timeStep(async () => {
      const zettel = zettelList.result.firstId ? await getVaultZettel(zettelList.result.firstId) : null;
      return {
        id: zettel?.id ?? null,
        title: zettel?.title ?? null,
        contentLength: zettel?.content.length ?? 0,
        payloadBytes: getPayloadBytes(zettel),
        sourceDocumentCount: zettel?.sourceDocument ? 1 : 0,
        sourceDocumentPropertyCount: zettel?.sourceDocument?.properties.length ?? 0,
        outgoingLinkCount: zettel?.outgoingLinks.length ?? 0,
        backlinkCount: zettel?.backlinks.length ?? 0,
      };
    });

    const graph = await timeStep(async () => {
      const nodes = await getVaultZettelGraph();
      const connectedNodes = nodes.filter((node) => node.outgoingCount + node.backlinkCount > 0);
      return {
        count: nodes.length,
        connectedCount: connectedNodes.length,
        firstIds: nodes.slice(0, 9).map((node) => node.id),
        firstConnectedIds: connectedNodes.slice(0, 6).map((node) => node.id),
        totalBacklinks: nodes.reduce((count, node) => count + node.backlinkCount, 0),
        totalOutgoing: nodes.reduce((count, node) => count + node.outgoingCount, 0),
      };
    });

    const pageGraphBundles = await timeStep(async () => {
      const candidateIds = graph.result.firstConnectedIds;
      const bundles = await Promise.all(
        candidateIds.map((id) => getContextBundle("zettel", id, { depth: 1, include: ["explicit", "source"], limit: 6 })),
      );
      return {
        count: bundles.length,
        edgeCount: bundles.reduce((count, bundle) => count + bundle.edges.length, 0),
        nodeCount: bundles.reduce((count, bundle) => count + bundle.nodes.length, 0),
      };
    });

    const heavyGraphBundles = includeHeavy
      ? await timeStep(async () => {
          const bundles = await Promise.all(
            graph.result.firstIds.map((id) => getContextBundle("zettel", id, { depth: 2, include: ["explicit", "source", "mention", "semantic"], limit: 10 })),
          );
          return {
            count: bundles.length,
            edgeCount: bundles.reduce((count, bundle) => count + bundle.edges.length, 0),
            nodeCount: bundles.reduce((count, bundle) => count + bundle.nodes.length, 0),
          };
        })
      : null;

    const routeFetches = includeRouteFetches
      ? await timeStep(async () => {
          const firstId = zettelList.result.firstId;
          const targets: RouteBenchmarkTarget[] = [
            { name: "listPage", path: "/vault/zettels" },
            { name: "savedViewPage", path: "/vault/zettels?view=sermons" },
            { name: "listApi", path: "/api/vault/zettels" },
            { name: "bootstrapListApi", path: `/api/vault/bootstrap?path=${encodeURIComponent("/vault/zettels")}` },
          ];

          if (firstId) {
            targets.push(
              { name: "detailPage", path: `/vault/zettels/${firstId}` },
              { name: "bootstrapDetailApi", path: `/api/vault/bootstrap?path=${encodeURIComponent(`/vault/zettels/${firstId}`)}` },
              { name: "detailApi", path: `/api/vault/zettels/${firstId}/details` },
            );
          }

          const entries = [];
          for (const target of targets) {
            entries.push(await fetchRouteBenchmark(request, target));
          }

          return {
            count: entries.length,
            entries,
          };
        })
      : null;

    return {
      ok: true,
      totalDurationMs: Math.round(performance.now() - totalStartedAt),
      zettelList,
      zettelDetail,
      graph,
      pageGraphBundles,
      heavyGraphBundles,
      routeFetches,
    };
  } catch (error) {
    return {
      ok: false,
      totalDurationMs: Math.round(performance.now() - totalStartedAt),
      error: error instanceof Error ? error.message : "Unknown Vault read model benchmark failure",
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
