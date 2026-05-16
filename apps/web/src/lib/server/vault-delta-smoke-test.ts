import "server-only";

import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import {
  cycleVaultMediaStatus,
  updateVaultAssetProperties,
  updateVaultMediaDetails,
  updateVaultPlaceProperties,
  updateVaultPlaceReview,
} from "@/lib/server/vault";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MEDIA_ID_PREFIX = "lh_smoke_media_";
const ASSET_ID_PREFIX = "lh_smoke_asset_";
const PLACE_ID_PREFIX = "lh_smoke_place_";

type CountRow = { count: number };
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
    <title>Vault Delta Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Vault Delta Smoke Test</h1>
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

async function cleanupVaultDeltaSmokeRows(userId: string) {
  await executeD1(
    `delete from media_people_relations
     where media_id in (
       select id from media_logs where user_id = ? and id like ?
     )`,
    [userId, `${MEDIA_ID_PREFIX}%`],
  );
  await executeD1(
    `delete from zettel_media_relations
     where media_id in (
       select id from media_logs where user_id = ? and id like ?
     )`,
    [userId, `${MEDIA_ID_PREFIX}%`],
  );
  await executeD1(`delete from media_logs where user_id = ? and id like ?`, [userId, `${MEDIA_ID_PREFIX}%`]);
  await executeD1(`delete from assets where user_id = ? and id like ?`, [userId, `${ASSET_ID_PREFIX}%`]);
  await executeD1(
    `delete from place_visits
     where place_id in (
       select id from places where user_id = ? and id like ?
     )`,
    [userId, `${PLACE_ID_PREFIX}%`],
  );
  await executeD1(`delete from places where user_id = ? and id like ?`, [userId, `${PLACE_ID_PREFIX}%`]);
}

async function countVaultDeltaSmokeRows(userId: string) {
  const [media, assets, places] = await Promise.all([
    queryD1<CountRow>(`select count(*) as count from media_logs where user_id = ? and id like ?`, [userId, `${MEDIA_ID_PREFIX}%`]),
    queryD1<CountRow>(`select count(*) as count from assets where user_id = ? and id like ?`, [userId, `${ASSET_ID_PREFIX}%`]),
    queryD1<CountRow>(`select count(*) as count from places where user_id = ? and id like ?`, [userId, `${PLACE_ID_PREFIX}%`]),
  ]);

  return {
    media: Number(media.rows[0]?.count ?? 0),
    assets: Number(assets.rows[0]?.count ?? 0),
    places: Number(places.rows[0]?.count ?? 0),
  };
}

async function insertVaultDeltaSmokeRows(userId: string, runId: string) {
  const ids = {
    mediaStatus: `${MEDIA_ID_PREFIX}status_${runId}`,
    mediaDetails: `${MEDIA_ID_PREFIX}details_${runId}`,
    asset: `${ASSET_ID_PREFIX}${runId}`,
    placeProperties: `${PLACE_ID_PREFIX}properties_${runId}`,
    placeReview: `${PLACE_ID_PREFIX}review_${runId}`,
  };

  await executeD1(
    `insert into media_logs (id, user_id, media_type, title, status, review, created_at, updated_at)
     values (?, ?, 'screen', ?, 'backlog', 'Temporary smoke fixture.', datetime('now'), datetime('now'))`,
    [ids.mediaStatus, userId, `[SMOKE] Media Status ${runId}`],
  );
  await executeD1(
    `insert into media_logs (id, user_id, media_type, title, status, review, created_at, updated_at)
     values (?, ?, 'book', ?, 'backlog', 'Temporary smoke fixture.', datetime('now'), datetime('now'))`,
    [ids.mediaDetails, userId, `[SMOKE] Media Details ${runId}`],
  );
  await executeD1(
    `insert into assets (id, user_id, category, name, brand, current_condition, notes, created_at, updated_at)
     values (?, ?, 'gear', ?, 'Smoke', 'fair', 'Temporary smoke fixture.', datetime('now'), datetime('now'))`,
    [ids.asset, userId, `[SMOKE] Asset ${runId}`],
  );
  await executeD1(
    `insert into places (id, user_id, name, category, address, notes, visit_count, created_at, updated_at)
     values (?, ?, ?, 'cafe', 'Smoke address', 'Temporary smoke fixture.', 1, datetime('now'), datetime('now'))`,
    [ids.placeProperties, userId, `[SMOKE] Place Properties ${runId}`],
  );
  await executeD1(
    `insert into places (id, user_id, name, category, address, notes, visit_count, created_at, updated_at)
     values (?, ?, ?, 'restaurant', 'Smoke address', 'Temporary smoke fixture.', 1, datetime('now'), datetime('now'))`,
    [ids.placeReview, userId, `[SMOKE] Place Review ${runId}`],
  );

  return ids;
}

async function runVaultDeltaSmokeTest(userId: string) {
  const checks: SmokeCheck[] = [];
  const runId = Date.now().toString(36);

  await cleanupVaultDeltaSmokeRows(userId);

  try {
    const ids = await insertVaultDeltaSmokeRows(userId, runId);

    const cycledMedia = await cycleVaultMediaStatus(ids.mediaStatus);
    addCheck(checks, "cycle media status", cycledMedia?.status === "consuming", cycledMedia?.status);

    const updatedMediaTitle = `[SMOKE] Media Details Updated ${runId}`;
    const updatedMedia = await updateVaultMediaDetails(ids.mediaDetails, {
      title: updatedMediaTitle,
      mediaType: "book",
      originalTitle: "Smoke Original",
      platformOrPublisher: "Smoke Publisher",
      creator: "Smoke Creator",
      genre: "Smoke Genre",
      releaseYear: 2026,
      status: "completed",
      rating: 4.5,
      review: "Smoke media review updated.",
      author: "Smoke Author",
      pages: 123,
      rewatchValue: true,
      startedAt: "2026-05-01",
      completedAt: "2026-05-02",
    });
    addCheck(
      checks,
      "update media details",
      updatedMedia?.title === updatedMediaTitle && updatedMedia.status === "completed" && updatedMedia.rating === 4.5,
      updatedMedia?.title,
    );

    const updatedAssetName = `[SMOKE] Asset Updated ${runId}`;
    const updatedAsset = await updateVaultAssetProperties(ids.asset, {
      name: updatedAssetName,
      category: "collection",
      brand: "Smoke Brand",
      modelName: "Smoke Model",
      acquiredDate: "2026-05-03",
      acquiredPrice: 12000,
      condition: "good",
      notes: "Smoke asset notes updated.",
    });
    addCheck(
      checks,
      "update asset properties",
      updatedAsset?.name === updatedAssetName && updatedAsset.category === "collection" && updatedAsset.acquiredPrice === 12000,
      updatedAsset?.name,
    );

    const updatedPlaceName = `[SMOKE] Place Properties Updated ${runId}`;
    const updatedPlace = await updateVaultPlaceProperties(ids.placeProperties, {
      name: updatedPlaceName,
      category: "shop",
      address: "Smoke updated address",
      mapUrl: "https://example.com/smoke-place",
      firstVisitedAt: "2026-05-04",
      lastVisitedAt: "2026-05-05",
      visitCount: 2,
      averageRating: 4.2,
      review: "Smoke place properties updated.",
    });
    addCheck(
      checks,
      "update place properties",
      updatedPlace?.name === updatedPlaceName && updatedPlace.category === "shop" && updatedPlace.visitCount === 2,
      updatedPlace?.name,
    );

    const updatedReview = "Smoke place review updated.";
    const reviewedPlace = await updateVaultPlaceReview(ids.placeReview, updatedReview);
    addCheck(checks, "update place review", reviewedPlace?.review === updatedReview, reviewedPlace?.review);

    await cleanupVaultDeltaSmokeRows(userId);
    const remainingRows = await countVaultDeltaSmokeRows(userId);
    addCheck(checks, "cleanup smoke rows", remainingRows.media === 0 && remainingRows.assets === 0 && remainingRows.places === 0, JSON.stringify(remainingRows));

    return { ok: true, runId, checks, cleanup: { remainingRows } };
  } catch (error) {
    await cleanupVaultDeltaSmokeRows(userId);
    const remainingRows = await countVaultDeltaSmokeRows(userId);
    return {
      ok: false,
      runId,
      checks,
      cleanup: { remainingRows },
      error: error instanceof Error ? error.message : "Unknown vault delta smoke-test failure",
    };
  }
}

function isLocalRequest(request: Request) {
  return LOCAL_HOSTS.has(new URL(request.url).hostname);
}

export async function handleVaultDeltaSmokeTest(request: Request) {
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

  const result = await runVaultDeltaSmokeTest(session.userId);
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
