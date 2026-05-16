import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { getVaultHydrationSnapshot, seedVaultSupportData } from "@/lib/server/vault";

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
    <title>Vault Hydration Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Vault Hydration Smoke Test</h1>
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
    await seedVaultSupportData();

    const [home, zettels, graph, media, books, assets, places] = await Promise.all([
      getVaultHydrationSnapshot("/vault"),
      getVaultHydrationSnapshot("/vault/zettels"),
      getVaultHydrationSnapshot("/vault/zettels/graph"),
      getVaultHydrationSnapshot("/vault/media"),
      getVaultHydrationSnapshot("/vault/media/books"),
      getVaultHydrationSnapshot("/vault/assets"),
      getVaultHydrationSnapshot("/vault/places"),
    ]);
    const zettelId = zettels.zettels[0]?.id ?? home.zettels[0]?.id ?? null;
    const mediaId = media.media[0]?.id ?? books.media[0]?.id ?? null;
    const assetId = assets.assets[0]?.id ?? null;
    const placeId = places.places[0]?.id ?? null;
    const [zettelDetail, mediaDetail, assetDetail, placeDetail] = await Promise.all([
      zettelId ? getVaultHydrationSnapshot(`/vault/zettels/${zettelId}`) : Promise.resolve(null),
      mediaId ? getVaultHydrationSnapshot(`/vault/media/${mediaId}`) : Promise.resolve(null),
      assetId ? getVaultHydrationSnapshot(`/vault/assets/${assetId}`) : Promise.resolve(null),
      placeId ? getVaultHydrationSnapshot(`/vault/places/${placeId}`) : Promise.resolve(null),
    ]);

    addCheck(checks, "home hydration returns zettels", home.zettels.length > 0);
    addCheck(checks, "home hydration omits other vault collections", home.media.length === 0 && home.assets.length === 0 && home.places.length === 0);
    addCheck(checks, "zettels hydration returns zettels", zettels.zettels.length > 0);
    addCheck(checks, "zettels hydration omits media assets places", zettels.media.length === 0 && zettels.assets.length === 0 && zettels.places.length === 0);
    addCheck(checks, "zettel graph hydration is empty", graph.zettels.length === 0 && graph.media.length === 0 && graph.assets.length === 0 && graph.places.length === 0);
    addCheck(checks, "zettel detail hydration includes selected zettel", zettelDetail ? zettelDetail.selectedZettelId === zettelId && zettelDetail.zettels.some((item) => item.id === zettelId) : true);
    addCheck(checks, "media hydration returns media array", Array.isArray(media.media));
    addCheck(checks, "media hydration omits zettels assets places", media.zettels.length === 0 && media.assets.length === 0 && media.places.length === 0);
    addCheck(checks, "books hydration is filtered", books.media.every((item) => item.mediaType === "book"));
    addCheck(checks, "media detail hydration is scoped", mediaDetail ? mediaDetail.media.length <= 1 && mediaDetail.media[0]?.id === mediaId : true);
    addCheck(checks, "assets hydration returns assets array", Array.isArray(assets.assets));
    addCheck(checks, "assets hydration omits zettels media places", assets.zettels.length === 0 && assets.media.length === 0 && assets.places.length === 0);
    addCheck(checks, "asset detail hydration is scoped", assetDetail ? assetDetail.assets.length <= 1 && assetDetail.assets[0]?.id === assetId : true);
    addCheck(checks, "places hydration returns places array", Array.isArray(places.places));
    addCheck(checks, "places hydration omits zettels media assets", places.zettels.length === 0 && places.media.length === 0 && places.assets.length === 0);
    addCheck(checks, "place detail hydration is scoped", placeDetail ? placeDetail.places.length <= 1 && placeDetail.places[0]?.id === placeId : true);

    return {
      ok: true,
      checks,
      sample: {
        assetCount: assets.assets.length,
        assetId,
        bookCount: books.media.length,
        mediaCount: media.media.length,
        mediaId,
        placeCount: places.places.length,
        placeId,
        zettelCount: zettels.zettels.length,
        zettelId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown Vault hydration smoke-test failure",
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
