import { NextResponse } from "next/server";
import { ulid } from "ulidx";

import { createSession, getSession } from "@/lib/auth/session";
import {
  createGift,
  createNetworkEdge,
  createPersonInteraction,
  deleteGift,
  deleteInteraction,
  deleteNetworkEdge,
  getPRMContextPeople,
  getPRMGift,
  getPRMGifts,
  getPRMNeedsContact,
  getPRMNetwork,
  getPRMPerson,
  markPersonContacted,
  togglePersonFavorite,
  updatePersonProfile,
} from "@/lib/server/prm";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

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
    <title>PRM Mutation Delta Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>PRM Mutation Delta Smoke Test</h1>
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
  const user = await resolveCurrentUser();
  const suffix = ulid().toLowerCase();
  const personId = `dev_prm_delta_person_${suffix}`;
  const secondPersonId = `dev_prm_delta_person_second_${suffix}`;
  let createdGiftId: string | null = null;
  let createdInteractionId: string | null = null;
  let createdNetworkEdgeId: string | null = null;

  try {
    await executeD1(
      `insert into people
        (id, user_id, name, nickname, birth_date, groups, dunbar_layer, core_value, bio, last_contacted_at, contact_cadence_days, status, is_favorite, created_at, updated_at)
       values (?, ?, 'Delta smoke person', 'Delta', null, '["검증"]', 50, '검증 대상', 'Delta smoke bio', datetime('now', '-20 day'), 10, 'active', 0, datetime('now'), datetime('now'))`,
      [personId, user.id],
    );
    await executeD1(
      `insert into people
        (id, user_id, name, nickname, birth_date, groups, dunbar_layer, core_value, bio, last_contacted_at, contact_cadence_days, status, is_favorite, created_at, updated_at)
       values (?, ?, 'Delta smoke second person', 'Second', null, '["검증"]', 50, '검증 대상', 'Delta smoke second bio', datetime('now', '-15 day'), 10, 'active', 0, datetime('now'), datetime('now'))`,
      [secondPersonId, user.id],
    );

    const readPerson = await getPRMPerson(personId);
    addCheck(checks, "person read model returns person", readPerson?.id === personId);
    addCheck(checks, "person read model omits snapshot", Boolean(readPerson && !("snapshot" in readPerson)));

    const needsContact = await getPRMNeedsContact();
    addCheck(checks, "needs-contact read model includes overdue person", needsContact.some((person) => person.id === personId));
    addCheck(checks, "needs-contact read model omits snapshot", !("snapshot" in needsContact));

    const contextPeople = await getPRMContextPeople(200);
    addCheck(checks, "context people read model returns ids", contextPeople.some((person) => person.id === personId));

    const profileDelta = await updatePersonProfile(personId, {
      bio: "Delta smoke edited bio",
      contactCadenceDays: 5,
      coreValue: "Delta smoke edited value",
      dunbarLayer: 15,
      groups: ["검증", "델타"],
      name: "Delta smoke person renamed",
      nickname: "Delta edited",
      status: "observing",
    });
    addCheck(checks, "profile mutation returns person delta", profileDelta.person?.name === "Delta smoke person renamed");
    addCheck(checks, "profile mutation updates person fields", profileDelta.person?.status === "observing" && profileDelta.person.cadenceDays === 5);
    addCheck(checks, "profile mutation omits snapshot", !("snapshot" in profileDelta));

    const favoriteDelta = await togglePersonFavorite(personId);
    addCheck(checks, "favorite mutation returns toggled person", favoriteDelta.person?.favorite === true);
    addCheck(checks, "favorite mutation omits snapshot", !("snapshot" in favoriteDelta));

    const contactDelta = await markPersonContacted(personId);
    addCheck(checks, "contact mutation returns contacted person", contactDelta.person?.daysSinceContact === 0);
    addCheck(checks, "contact mutation appends timeline item", Boolean(contactDelta.person?.timeline.some((item) => item.title === "직접 연락 완료")));
    addCheck(checks, "contact mutation omits snapshot", !("snapshot" in contactDelta));

    const interactionDelta = await createPersonInteraction(personId, {
      summary: "Delta smoke interaction",
      type: "message",
    });
    const interactionResult = await queryD1<{ id: string }>(
      `select id from interactions where person_id = ? and user_id = ? and summary = 'Delta smoke interaction' and deleted_at is null order by created_at desc limit 1`,
      [personId, user.id],
    );
    createdInteractionId = interactionResult.rows[0]?.id ?? null;
    addCheck(checks, "interaction create returns person delta", Boolean(interactionDelta.person?.timeline.some((item) => item.title === "Delta smoke interaction")));
    addCheck(checks, "interaction create omits snapshot", !("snapshot" in interactionDelta));

    const deleteInteractionDelta = createdInteractionId ? await deleteInteraction(createdInteractionId) : null;
    addCheck(checks, "interaction delete returns deleted id", deleteInteractionDelta?.deletedInteractionId === createdInteractionId);
    addCheck(checks, "interaction delete returns updated person", !deleteInteractionDelta?.person?.timeline.some((item) => item.id === createdInteractionId));
    addCheck(checks, "interaction delete omits snapshot", Boolean(deleteInteractionDelta && !("snapshot" in deleteInteractionDelta)));

    const giftDelta = await createGift(personId, {
      direction: "given",
      title: "Delta smoke gift",
    });
    createdGiftId = giftDelta.gift?.id ?? null;
    addCheck(checks, "gift create returns gift delta", giftDelta.gift?.title === "Delta smoke gift");
    addCheck(checks, "gift create returns person delta", Boolean(giftDelta.person?.timeline.some((item) => item.id === createdGiftId)));
    addCheck(checks, "gift create omits snapshot", !("snapshot" in giftDelta));

    const giftsRead = await getPRMGifts();
    addCheck(checks, "gifts read model includes created gift", giftsRead.rows.some((gift) => gift.id === createdGiftId));
    addCheck(checks, "gifts read model omits snapshot", !("snapshot" in giftsRead));

    const giftDetailRead = createdGiftId ? await getPRMGift(createdGiftId) : null;
    addCheck(checks, "gift detail read model returns person", giftDetailRead?.person?.id === personId);
    addCheck(checks, "gift detail read model omits snapshot", Boolean(giftDetailRead && !("snapshot" in giftDetailRead)));

    const deleteGiftDelta = createdGiftId ? await deleteGift(createdGiftId) : null;
    addCheck(checks, "gift delete returns deleted id", deleteGiftDelta?.deletedGiftId === createdGiftId);
    addCheck(checks, "gift delete returns updated person", !deleteGiftDelta?.person?.timeline.some((item) => item.id === createdGiftId));
    addCheck(checks, "gift delete omits snapshot", Boolean(deleteGiftDelta && !("snapshot" in deleteGiftDelta)));

    const networkEdgeDelta = await createNetworkEdge({
      relationType: "delta",
      sourcePersonId: personId,
      strength: 4,
      targetPersonId: secondPersonId,
    });
    createdNetworkEdgeId = networkEdgeDelta.networkEdge?.id ?? null;
    addCheck(checks, "network edge create returns edge delta", networkEdgeDelta.networkEdge?.sourcePersonId === personId);
    addCheck(checks, "network edge create omits snapshot", !("snapshot" in networkEdgeDelta));

    const networkRead = await getPRMNetwork();
    addCheck(checks, "network read model includes created edge", networkRead.some((edge) => edge.id === createdNetworkEdgeId));
    addCheck(checks, "network read model omits snapshot", !("snapshot" in networkRead));

    const deleteNetworkEdgeDelta = createdNetworkEdgeId ? await deleteNetworkEdge(createdNetworkEdgeId) : null;
    addCheck(checks, "network edge delete returns deleted id", deleteNetworkEdgeDelta?.deletedNetworkEdgeId === createdNetworkEdgeId);
    addCheck(checks, "network edge delete omits snapshot", Boolean(deleteNetworkEdgeDelta && !("snapshot" in deleteNetworkEdgeDelta)));

    return {
      ok: true,
      checks,
      sample: {
        createdGiftId,
        createdInteractionId,
        createdNetworkEdgeId,
        personId,
        secondPersonId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown PRM mutation delta smoke-test failure",
    };
  } finally {
    await executeD1(`delete from network_edges where user_id = ? and (source_person_id in (?, ?) or target_person_id in (?, ?))`, [
      user.id,
      personId,
      secondPersonId,
      personId,
      secondPersonId,
    ]).catch(() => undefined);
    await executeD1(`delete from gifts where person_id = ? and user_id = ?`, [personId, user.id]).catch(() => undefined);
    await executeD1(`delete from interactions where person_id = ? and user_id = ?`, [personId, user.id]).catch(() => undefined);
    await executeD1(`delete from people where id = ? and user_id = ?`, [personId, user.id]).catch(() => undefined);
    await executeD1(`delete from people where id = ? and user_id = ?`, [secondPersonId, user.id]).catch(() => undefined);
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
