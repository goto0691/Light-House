import "server-only";

import { cache } from "react";
import { ulid } from "ulidx";

import type { GiftMock, NetworkEdgeMock, PersonMock } from "@/lib/mock/prm";
import type { SourceDocumentInfo } from "@/lib/mock/vault";
import { getSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

export type PRMSnapshot = {
  people: PersonMock[];
  gifts: GiftMock[];
  networkEdges: NetworkEdgeMock[];
};

type UserRow = { id: string };
type PersonRow = {
  id: string;
  name: string;
  nickname: string | null;
  groups: string | null;
  dunbarLayer: number | null;
  status: PersonMock["status"];
  isFavorite: number | null;
  bio: string | null;
  coreValue: string | null;
  lastContactedAt: string | null;
  contactCadenceDays: number | null;
  birthDate: string | null;
  giftsCount: number;
  interactionsCount: number;
  tasksCount: number;
};
type TimelineRow = {
  id: string;
  personId: string;
  date: string;
  title: string;
  kind: "interaction" | "gift" | "task" | "zettel";
};
type GiftRow = {
  id: string;
  personId: string;
  direction: GiftMock["direction"];
  title: string;
  occurredAt: string;
  satisfaction: string | null;
  notes: string | null;
};
type NetworkEdgeRow = {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  relationType: string | null;
  strength: number | null;
  notes: string | null;
};
type SourceDocumentRow = { id: string; canonicalEntityId: string; sourceDatabase: string | null; sourceId: string; documentRole: string | null; status: string; preview: string | null };
type SourceDocumentPropertyRow = { sourceDocumentId: string; name: string; value: string | null };

async function resolveUser() {
  const session = await getSession();
  if (!session) throw new Error("세션이 없습니다.");
  const found = await queryD1<UserRow>("select id from users where email = ? limit 1", [session.email]);
  const existing = found.rows[0];
  if (existing) return { id: existing.id, session };

  const userId = "user-light-keeper";
  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
    [userId, session.email, session.displayName],
  );
  return { id: userId, session };
}

function parseGroups(value: string | null) {
  if (!value) return [];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function calculateDaysSinceContact(lastContactedAt: string | null) {
  if (!lastContactedAt) return 999;
  const last = new Date(lastContactedAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  last.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}

function birthdayLabel(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export async function seedPRMSupportData() {
  const { id: userId } = await resolveUser();
  const existing = await queryD1<{ count: number | null }>(`select count(*) as count from people where user_id = ?`, [userId]);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  await executeD1(
    `insert or ignore into people
      (id, user_id, name, nickname, birth_date, groups, dunbar_layer, core_value, bio, last_contacted_at, contact_cadence_days, status, is_favorite, created_at, updated_at)
     values
      ('person-jaemin', ?, '김재민', '재민', '1992-05-01', '["비즈니스","친구"]', 15, '실행력과 감각이 빠르다.', '호떡집 비즈니스와 신메뉴 실험을 함께하는 파트너.', datetime('now','-12 day'), 10, 'active', 1, datetime('now'), datetime('now')),
      ('person-minseo', ?, '박민서', '민서', null, '["핵심","교회"]', 5, '정직하고 오래 보는 시선.', '가장 깊은 대화를 나누는 핵심 인물.', datetime('now','-3 day'), 7, 'active', 1, datetime('now'), datetime('now')),
      ('person-eunji', ?, '최은지', '은지', null, '["친구","커뮤니티"]', 50, '섬세한 감각과 기록 습관.', '책과 전시에 대한 감상을 자주 나누는 친구.', datetime('now','-29 day'), 21, 'active', 0, datetime('now'), datetime('now')),
      ('person-daniel', ?, 'Daniel Kim', null, null, '["직장"]', 150, '차분한 실무 감각.', '이전 직장 동료. 간헐적으로 근황을 주고받는다.', datetime('now','-87 day'), 60, 'observing', 0, datetime('now'), datetime('now'))`,
    [userId, userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into gifts
      (id, user_id, person_id, direction, title, occurred_at, satisfaction, notes, created_at, updated_at)
     values
      ('gift-1', ?, 'person-jaemin', 'given', '원두 세트', '2026-02-11', '성공', null, datetime('now'), datetime('now')),
      ('gift-2', ?, 'person-eunji', 'received', '전시 도록', '2026-03-01', '대만족', null, datetime('now'), datetime('now')),
      ('gift-3', ?, 'person-minseo', 'given', '기도 노트', '2025-12-24', '성공', null, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into interactions
      (id, user_id, person_id, occurred_at, type, summary, content, created_at, updated_at)
     values
      ('interaction-1', ?, 'person-jaemin', '2026-04-23', 'meeting', '겨울 메뉴 미팅', '호떡집 메뉴 실험 논의', datetime('now'), datetime('now')),
      ('interaction-2', ?, 'person-minseo', '2026-04-21', 'call', '주간 회고 대화', '기도와 회고를 함께 나눔', datetime('now'), datetime('now')),
      ('interaction-3', ?, 'person-eunji', '2026-03-25', 'message', '전시 관람 후기 공유', '전시 감상 메모를 공유함', datetime('now'), datetime('now')),
      ('interaction-4', ?, 'person-daniel', '2026-01-20', 'message', '근황 메시지', '이직 후 근황을 짧게 확인', datetime('now'), datetime('now'))`,
    [userId, userId, userId, userId],
  );

  await executeD1(
    `insert or ignore into network_edges
      (id, user_id, source_person_id, target_person_id, relation_type, strength, notes, created_at, updated_at)
     values
      ('edge-1', ?, 'person-minseo', 'person-jaemin', 'church', 4, '공동체 안에서 자주 연결됨', datetime('now'), datetime('now')),
      ('edge-2', ?, 'person-jaemin', 'person-eunji', 'creative', 3, '전시와 프로젝트 대화로 연결됨', datetime('now'), datetime('now'))`,
    [userId, userId],
  );
}

export const getPRMSnapshot = cache(async function getPRMSnapshot(): Promise<PRMSnapshot> {
  const { id: userId } = await resolveUser();
  const [peopleResult, interactionTimeline, giftTimeline, taskTimeline, zettelTimeline, giftsResult, networkEdgeResult, sourceDocumentResult, sourcePropertyResult] = await Promise.all([
    queryD1<PersonRow>(
      `select
         p.id, p.name, p.nickname, p.groups, p.dunbar_layer as dunbarLayer, p.status, p.is_favorite as isFavorite,
         p.bio, p.core_value as coreValue, p.last_contacted_at as lastContactedAt, p.contact_cadence_days as contactCadenceDays,
         p.birth_date as birthDate,
         (select count(*) from gifts g where g.person_id = p.id) as giftsCount,
         (select count(*) from interactions i where i.person_id = p.id) as interactionsCount,
         (select count(*) from task_people_relations tpr inner join tasks t on t.id = tpr.task_id where tpr.person_id = p.id and t.deleted_at is null) as tasksCount
       from people p
       where p.user_id = ?
       order by p.is_favorite desc, p.dunbar_layer asc, p.name asc`,
      [userId],
    ),
    queryD1<TimelineRow>(
      `select id, person_id as personId, occurred_at as date, summary as title, 'interaction' as kind
       from interactions
       where user_id = ? and deleted_at is null`,
      [userId],
    ),
    queryD1<TimelineRow>(
      `select id, person_id as personId, occurred_at as date, title, 'gift' as kind
       from gifts
       where user_id = ? and deleted_at is null`,
      [userId],
    ),
    queryD1<TimelineRow>(
      `select t.id as id, tpr.person_id as personId, coalesce(t.updated_at, t.created_at) as date, t.title, 'task' as kind
       from task_people_relations tpr
       inner join tasks t on t.id = tpr.task_id
       where t.user_id = ? and t.deleted_at is null`,
      [userId],
    ),
    queryD1<TimelineRow>(
      `select z.id as id, zpr.person_id as personId, coalesce(z.updated_at, z.created_at) as date, z.title, 'zettel' as kind
       from zettel_people_relations zpr
       inner join zettels z on z.id = zpr.zettel_id
       where z.user_id = ?`,
      [userId],
    ),
    queryD1<GiftRow>(
      `select id, person_id as personId, direction, title, occurred_at as occurredAt, satisfaction, notes
       from gifts
       where user_id = ? and deleted_at is null
       order by occurred_at desc, created_at desc`,
      [userId],
    ),
    queryD1<NetworkEdgeRow>(
      `select id, source_person_id as sourcePersonId, target_person_id as targetPersonId, relation_type as relationType, strength, notes
       from network_edges
       where user_id = ? and deleted_at is null
       order by updated_at desc, created_at desc`,
      [userId],
    ),
    queryD1<SourceDocumentRow>(
      `select id, canonical_entity_id as canonicalEntityId, source_database as sourceDatabase, source_id as sourceId, document_role as documentRole, status, raw_content_preview as preview
       from source_documents
       where user_id = ? and deleted_at is null and canonical_entity_type = 'person'`,
      [userId],
    ),
    queryD1<SourceDocumentPropertyRow>(
      `select sdp.source_document_id as sourceDocumentId, sdp.property_name as name, sdp.value_text as value
       from source_document_properties sdp
       inner join source_documents sd on sd.id = sdp.source_document_id
       where sd.user_id = ? and sd.deleted_at is null and sd.canonical_entity_type = 'person'
       order by sdp.source_document_id, sdp.property_key`,
      [userId],
    ),
  ]);

  const sourceProperties = new Map<string, Array<{ name: string; value: string }>>();
  for (const row of sourcePropertyResult.rows) {
    if (!row.value) continue;
    const properties = sourceProperties.get(row.sourceDocumentId) ?? [];
    properties.push({ name: row.name, value: row.value });
    sourceProperties.set(row.sourceDocumentId, properties);
  }

  const sourceDocuments = new Map<string, SourceDocumentInfo>();
  for (const row of sourceDocumentResult.rows) {
    sourceDocuments.set(row.canonicalEntityId, {
      id: row.id,
      sourceDatabase: row.sourceDatabase,
      sourceId: row.sourceId,
      documentRole: row.documentRole,
      status: row.status,
      preview: row.preview,
      properties: sourceProperties.get(row.id) ?? [],
    });
  }

  const timelineMap = new Map<string, PersonMock["timeline"]>();
  for (const row of [...interactionTimeline.rows, ...giftTimeline.rows, ...taskTimeline.rows, ...zettelTimeline.rows]) {
    const list = timelineMap.get(row.personId) ?? [];
    list.push({ id: row.id, date: row.date.slice(0, 10), title: row.title, kind: row.kind });
    timelineMap.set(row.personId, list);
  }
  for (const [id, items] of timelineMap) {
    items.sort((a, b) => (a.date < b.date ? 1 : -1));
    timelineMap.set(id, items);
  }

  const people: PersonMock[] = peopleResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nickname: row.nickname ?? undefined,
    layer: (row.dunbarLayer ?? 50) as PersonMock["layer"],
    groups: parseGroups(row.groups),
    status: row.status,
    favorite: Boolean(row.isFavorite),
    bio: row.bio ?? "설명이 아직 없습니다.",
    coreValue: row.coreValue ?? "기록 중",
    daysSinceContact: calculateDaysSinceContact(row.lastContactedAt),
    cadenceDays: row.contactCadenceDays ?? 14,
    upcomingBirthday: birthdayLabel(row.birthDate),
    giftsCount: Number(row.giftsCount ?? 0),
    interactionsCount: Number(row.interactionsCount ?? 0),
    tasksCount: Number(row.tasksCount ?? 0),
    timeline: timelineMap.get(row.id) ?? [],
    sourceDocument: sourceDocuments.get(row.id) ?? null,
  }));

  const gifts: GiftMock[] = giftsResult.rows.map((row) => ({
    id: row.id,
    personId: row.personId,
    direction: row.direction,
    title: row.title,
    occurredAt: row.occurredAt,
    satisfaction: row.satisfaction,
    notes: row.notes,
  }));

  const networkEdges: NetworkEdgeMock[] = networkEdgeResult.rows.map((row) => ({
    id: row.id,
    sourcePersonId: row.sourcePersonId,
    targetPersonId: row.targetPersonId,
    relationType: row.relationType,
    strength: Number(row.strength ?? 3),
    notes: row.notes,
  }));

  return { people, gifts, networkEdges };
});

export async function getPRMPerson(personId: string) {
  const snapshot = await getPRMSnapshot();
  return snapshot.people.find((person) => person.id === personId) ?? null;
}

export async function getPRMGifts() {
  const snapshot = await getPRMSnapshot();
  return { rows: snapshot.gifts };
}

export async function getPRMGift(giftId: string) {
  const snapshot = await getPRMSnapshot();
  const gift = snapshot.gifts.find((item) => item.id === giftId) ?? null;
  const person = gift ? snapshot.people.find((item) => item.id === gift.personId) ?? null : null;
  return gift ? { gift, person } : null;
}

export async function getPRMNeedsContact() {
  const snapshot = await getPRMSnapshot();
  return snapshot.people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((left, right) => right.daysSinceContact - left.daysSinceContact);
}

export async function markPersonContacted(personId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update people set last_contacted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`,
    [personId, userId],
  );
  await executeD1(
    `insert into interactions (id, user_id, person_id, occurred_at, type, summary, content, created_at, updated_at)
     values (?, ?, ?, date('now'), 'message', '직접 연락 완료', 'PRM에서 연락 완료로 마킹', datetime('now'), datetime('now'))`,
    [ulid(), userId, personId],
  );
  return getPRMSnapshot();
}

export async function togglePersonFavorite(personId: string) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<{ isFavorite: number }>("select is_favorite as isFavorite from people where id = ? and user_id = ? limit 1", [personId, userId]);
  const next = current.rows[0]?.isFavorite ? 0 : 1;
  await executeD1(`update people set is_favorite = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [next, personId, userId]);
  return getPRMSnapshot();
}

export async function createPersonInteraction(personId: string, input: { summary: string; type?: string; occurredAt?: string; content?: string }) {
  const { id: userId } = await resolveUser();
  const summary = input.summary.trim();
  if (!summary) throw new Error("상호작용 요약은 비워둘 수 없습니다.");

  await executeD1(
    `insert into interactions (id, user_id, person_id, occurred_at, type, summary, content, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [ulid(), userId, personId, input.occurredAt ?? new Date().toISOString().slice(0, 10), input.type ?? "message", summary, input.content?.trim() || null],
  );
  await executeD1(`update people set last_contacted_at = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [input.occurredAt ?? new Date().toISOString().slice(0, 10), personId, userId]);
  return getPRMSnapshot();
}

export async function deleteInteraction(interactionId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update interactions set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [interactionId, userId]);
  return getPRMSnapshot();
}

export async function createGift(personId: string, input: { title: string; direction: GiftMock["direction"]; occurredAt?: string; satisfaction?: string; notes?: string }) {
  const { id: userId } = await resolveUser();
  const title = input.title.trim();
  if (!title) throw new Error("선물 이름은 비워둘 수 없습니다.");

  await executeD1(
    `insert into gifts (id, user_id, person_id, direction, title, occurred_at, satisfaction, notes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [ulid(), userId, personId, input.direction, title, input.occurredAt ?? new Date().toISOString().slice(0, 10), input.satisfaction?.trim() || null, input.notes?.trim() || null],
  );
  return getPRMSnapshot();
}

export async function deleteGift(giftId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update gifts set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [giftId, userId]);
  return getPRMSnapshot();
}

export async function createNetworkEdge(input: { sourcePersonId: string; targetPersonId: string; relationType?: string; strength?: number; notes?: string }) {
  const { id: userId } = await resolveUser();
  if (!input.sourcePersonId || !input.targetPersonId) throw new Error("연결할 두 사람을 모두 선택해 주세요.");
  if (input.sourcePersonId === input.targetPersonId) throw new Error("같은 사람끼리는 연결할 수 없습니다.");

  await executeD1(
    `insert into network_edges (id, user_id, source_person_id, target_person_id, relation_type, strength, notes, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [ulid(), userId, input.sourcePersonId, input.targetPersonId, input.relationType?.trim() || null, Math.max(1, Math.min(5, Math.round(input.strength ?? 3))), input.notes?.trim() || null],
  );
  return getPRMSnapshot();
}

export async function deleteNetworkEdge(edgeId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update network_edges set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [edgeId, userId]);
  return getPRMSnapshot();
}
