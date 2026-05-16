import "server-only";

import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import {
  createVaultZettel,
  deleteVaultZettel,
  getVaultZettelList,
  linkVaultZettels,
  unlinkVaultZettels,
  updateVaultZettelDetails,
} from "@/lib/server/vault";
import { mergePagedZettelPage, mergeZettelList, mergeZettelListItems, removeZettelFromList } from "@/lib/vault/zettel-list-state";

const SMOKE_SOURCE = "lh-zettel-mutation-smoke-test";
const SMOKE_CONTEXT = "mutation smoke test";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type SmokeZettelRow = { id: string };
type SmokeCountRow = { count: number };
type SmokeLinkRow = { id: string };
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
    <title>Zettel Mutation Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Zettel Mutation Smoke Test</h1>
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

function createInClause(values: string[]) {
  return values.map(() => "?").join(", ");
}

async function hardDeleteSmokeZettels(userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return;

  const placeholders = createInClause(uniqueIds);
  await executeD1(`delete from zettel_links where source_id in (${placeholders}) or target_id in (${placeholders})`, [
    ...uniqueIds,
    ...uniqueIds,
  ]);
  await executeD1(`delete from taggings where taggable_type = 'zettel' and taggable_id in (${placeholders})`, uniqueIds);
  await executeD1(`delete from zettels where user_id = ? and id in (${placeholders})`, [userId, ...uniqueIds]);
}

async function findSmokeZettelIds(userId: string) {
  const found = await queryD1<SmokeZettelRow>(
    `select id
     from zettels
     where user_id = ?
       and source = ?`,
    [userId, SMOKE_SOURCE],
  );
  return found.rows.map((row) => row.id);
}

async function countSmokeZettels(userId: string) {
  const found = await queryD1<SmokeCountRow>(
    `select count(*) as count
     from zettels
     where user_id = ?
       and source = ?`,
    [userId, SMOKE_SOURCE],
  );
  return Number(found.rows[0]?.count ?? 0);
}

async function runZettelMutationSmokeTest(userId: string) {
  const checks: SmokeCheck[] = [];
  const createdIds: string[] = [];
  const runId = Date.now().toString(36);

  await hardDeleteSmokeZettels(userId, await findSmokeZettelIds(userId));

  try {
    const source = await createVaultZettel({
      title: `[SMOKE] Zettel Mutation Source ${runId}`,
      type: "fleeting",
      category: "smoke-test",
      status: "draft",
      documentKind: "note",
      source: SMOKE_SOURCE,
      content: `Smoke source fixture ${runId}.`,
      summary: "Temporary mutation smoke-test source fixture.",
    });
    const sourceId = source.zettel?.id ?? source.selectedZettelId;
    createdIds.push(sourceId);
    addCheck(checks, "create source zettel", Boolean(source.zettel?.id), sourceId);

    const target = await createVaultZettel({
      title: `[SMOKE] Zettel Mutation Target ${runId}`,
      type: "permanent",
      category: "smoke-test",
      status: "draft",
      documentKind: "note",
      source: SMOKE_SOURCE,
      content: `Smoke target fixture ${runId}.`,
      summary: "Temporary mutation smoke-test target fixture.",
    });
    const targetId = target.zettel?.id ?? target.selectedZettelId;
    createdIds.push(targetId);
    addCheck(checks, "create target zettel", Boolean(target.zettel?.id), targetId);

    const loadedDetailIds = new Set<string>();
    const initialPage = (await getVaultZettelList()).slice(0, 40);
    let localZettels = mergePagedZettelPage([], initialPage, { loadedDetailIds, mode: "replace" });
    addCheck(checks, "merge initial paged list", localZettels.length <= 40 && localZettels.length > 0, `${localZettels.length} items`);

    localZettels = mergeZettelList(localZettels, source.zettel);
    loadedDetailIds.add(sourceId);
    addCheck(checks, "merge created detail into paged list", localZettels.some((zettel) => zettel.id === sourceId), sourceId);
    addCheck(
      checks,
      "preserve full content after detail merge",
      localZettels.find((zettel) => zettel.id === sourceId)?.content.includes(`Smoke source fixture ${runId}`) ?? false,
      localZettels.find((zettel) => zettel.id === sourceId)?.content,
    );

    const nextPage = (await getVaultZettelList()).slice(40, 80);
    localZettels = mergePagedZettelPage(localZettels, nextPage, { loadedDetailIds, mode: "append" });
    addCheck(
      checks,
      "append paged list preserves loaded detail",
      localZettels.find((zettel) => zettel.id === sourceId)?.content.includes(`Smoke source fixture ${runId}`) ?? false,
      `${localZettels.length} local items`,
    );

    const updatedTitle = `[SMOKE] Zettel Mutation Source Updated ${runId}`;
    const updated = await updateVaultZettelDetails(sourceId, {
      title: updatedTitle,
      type: "literature",
      category: "smoke-test",
      status: "active",
      documentKind: "note",
      source: SMOKE_SOURCE,
      content: `Smoke source fixture ${runId} updated through details mutation.`,
      summary: "Temporary mutation smoke-test source fixture after update.",
    });
    addCheck(checks, "update source details", updated?.title === updatedTitle, updated?.title);
    localZettels = mergeZettelList(localZettels, updated);
    addCheck(
      checks,
      "merge updated detail into paged list",
      localZettels.find((zettel) => zettel.id === sourceId)?.title === updatedTitle,
      localZettels.find((zettel) => zettel.id === sourceId)?.title,
    );

    localZettels = mergePagedZettelPage(localZettels, [], { loadedDetailIds, mode: "replace" });
    addCheck(
      checks,
      "replace page keeps loaded detail",
      localZettels.some((zettel) => zettel.id === sourceId && zettel.title === updatedTitle),
      `${localZettels.length} local items`,
    );

    const linked = await linkVaultZettels({ sourceId, targetId, context: SMOKE_CONTEXT });
    const linkedSource = linked.zettels.find((zettel) => zettel.id === sourceId);
    addCheck(
      checks,
      "link source to target",
      Boolean(linkedSource?.outgoingLinks.some((link) => link.targetId === targetId)),
      `returned ${linked.zettels.length} zettels`,
    );
    localZettels = mergeZettelListItems(localZettels, linked.zettels);
    addCheck(
      checks,
      "merge linked relation into paged list",
      Boolean(localZettels.find((zettel) => zettel.id === sourceId)?.outgoingLinks.some((link) => link.targetId === targetId)),
      `local source links ${localZettels.find((zettel) => zettel.id === sourceId)?.outgoingLinks.length ?? 0}`,
    );

    const linkRows = await queryD1<SmokeLinkRow>(
      `select zl.id
       from zettel_links zl
       inner join zettels z on z.id = zl.source_id
       where z.user_id = ?
         and zl.source_id = ?
         and zl.target_id = ?
       limit 1`,
      [userId, sourceId, targetId],
    );
    const linkId = linkRows.rows[0]?.id;
    addCheck(checks, "persist link row", Boolean(linkId), linkId);

    const unlinked = await unlinkVaultZettels(linkId);
    const unlinkedSource = unlinked.zettels.find((zettel) => zettel.id === sourceId);
    addCheck(
      checks,
      "unlink source from target",
      Boolean(unlinkedSource && !unlinkedSource.outgoingLinks.some((link) => link.targetId === targetId)),
      `returned ${unlinked.zettels.length} zettels`,
    );
    localZettels = mergeZettelListItems(localZettels, unlinked.zettels);
    addCheck(
      checks,
      "merge unlinked relation into paged list",
      Boolean(localZettels.find((zettel) => zettel.id === sourceId) && !localZettels.find((zettel) => zettel.id === sourceId)?.outgoingLinks.some((link) => link.targetId === targetId)),
      `local source links ${localZettels.find((zettel) => zettel.id === sourceId)?.outgoingLinks.length ?? 0}`,
    );

    await deleteVaultZettel(sourceId);
    localZettels = removeZettelFromList(localZettels, sourceId);
    loadedDetailIds.delete(sourceId);
    addCheck(checks, "remove deleted source from paged list", !localZettels.some((zettel) => zettel.id === sourceId), sourceId);

    await deleteVaultZettel(targetId);
    localZettels = removeZettelFromList(localZettels, targetId);
    loadedDetailIds.delete(targetId);
    addCheck(checks, "remove deleted target from paged list", !localZettels.some((zettel) => zettel.id === targetId), targetId);

    await hardDeleteSmokeZettels(userId, createdIds);

    const remainingRows = await countSmokeZettels(userId);
    addCheck(checks, "cleanup smoke rows", remainingRows === 0, `${remainingRows} remaining`);

    return { ok: true, runId, checks, cleanup: { remainingRows } };
  } catch (error) {
    await hardDeleteSmokeZettels(userId, [...createdIds, ...(await findSmokeZettelIds(userId))]);
    const remainingRows = await countSmokeZettels(userId);
    return {
      ok: false,
      runId,
      checks,
      cleanup: { remainingRows },
      error: error instanceof Error ? error.message : "Unknown smoke-test failure",
    };
  }
}

function isLocalRequest(request: Request) {
  return LOCAL_HOSTS.has(new URL(request.url).hostname);
}

export async function handleZettelMutationSmokeTest(request: Request) {
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

  const result = await runZettelMutationSmokeTest(session.userId);
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
