import "server-only";

import type { AssetMock, MediaMock, PlaceMock, ZettelMock } from "@/lib/mock/vault";
import { getSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

export type VaultSnapshot = {
  selectedZettelId: string;
  zettels: ZettelMock[];
  media: MediaMock[];
  assets: AssetMock[];
  places: PlaceMock[];
};

type UserRow = { id: string };
type ZettelRow = { id: string; title: string; type: ZettelMock["type"]; category: string | null; summary: string | null; content: string | null };
type LinkRow = { sourceId: string; targetTitle: string };
type MediaRow = { id: string; mediaType: MediaMock["mediaType"]; title: string; creator: string | null; status: MediaMock["status"]; review: string | null };
type AssetRow = { id: string; category: AssetMock["category"]; name: string; brand: string | null; currentCondition: string | null };
type PlaceRow = { id: string; category: PlaceMock["category"]; name: string; address: string | null; notes: string | null };

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

export async function seedVaultSupportData() {
  const { id: userId } = await resolveUser();
  await executeD1(
    `insert or ignore into zettels
      (id, user_id, title, slug, content, content_text, summary, type, category, pinned, created_at, updated_at)
     values
      ('zettel-anxiety', ?, '존재의 불안과 실존주의', 'existential-anxiety', '실존적 불안은 방향 상실이 아니라 자유의 무게를 체감하는 순간에 발생한다.', '실존적 불안은 방향 상실이 아니라 자유의 무게를 체감하는 순간에 발생한다.', '불안은 회피 대상이 아니라 선택의 자유를 드러내는 신호다.', 'permanent', '실존주의', 1, datetime('now'), datetime('now')),
      ('zettel-prayer', ?, '기도와 불안의 언어', 'prayer-and-anxiety', '불안을 없애 달라는 요청이 아니라, 그 불안을 들고 걸을 힘을 달라는 기도로 이동한다.', '불안을 없애 달라는 요청이 아니라, 그 불안을 들고 걸을 힘을 달라는 기도로 이동한다.', '기도는 불안을 없애기보다 들고 견디는 방식이다.', 'literature', '묵상', 0, datetime('now'), datetime('now')),
      ('zettel-hotteok', ?, '호떡집 브랜딩과 진정성', 'hotteok-brand', '호떡집이 파는 것은 간식보다 위로일 수 있다.', '호떡집이 파는 것은 간식보다 위로일 수 있다.', '브랜드 언어는 메뉴보다 먼저 관계의 온도를 설명해야 한다.', 'fleeting', '비즈니스', 0, datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );
  await executeD1(
    `insert or ignore into zettel_links (id, source_id, target_id, context, created_at)
     values
      ('zlink-1', 'zettel-prayer', 'zettel-anxiety', '기도 메모에서 실존주의 메모 참조', datetime('now')),
      ('zlink-2', 'zettel-hotteok', 'zettel-anxiety', '브랜딩 메모에서 불안 메모 참조', datetime('now'))`,
  );
  await executeD1(
    `insert or ignore into media_logs
      (id, user_id, media_type, title, creator, status, review, created_at, updated_at)
     values
      ('media-dune', ?, 'screen', '듄: 파트 2', '드니 빌뇌브', 'completed', '신화적 스케일과 사운드 디자인이 압도적이다.', datetime('now'), datetime('now')),
      ('media-sartre', ?, 'book', '실존주의는 휴머니즘이다', '장 폴 사르트르', 'consuming', '실존주의의 입문 개념을 짧게 압축한다.', datetime('now'), datetime('now')),
      ('media-hades', ?, 'game', 'Hades', 'Supergiant Games', 'completed', '반복 플레이가 서사와 감정선을 강화한다.', datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );
  await executeD1(
    `insert or ignore into assets
      (id, user_id, category, name, brand, current_condition, created_at, updated_at)
     values
      ('asset-bike', ?, 'gear', '로드 자전거', 'Trek', 'good', datetime('now'), datetime('now')),
      ('asset-speaker', ?, 'gear', '북쉘프 스피커', 'KEF', 'mint', datetime('now'), datetime('now')),
      ('asset-figure', ?, 'collection', '듄 피규어', 'Bandai', 'good', datetime('now'), datetime('now'))`,
    [userId, userId, userId],
  );
  await executeD1(
    `insert or ignore into places
      (id, user_id, name, category, address, notes, visit_count, created_at, updated_at)
     values
      ('place-hotteok', ?, '호떡집 본점', 'restaurant', '성수 어딘가', '메뉴 테스트와 대화가 자주 열리는 장소.', 4, datetime('now'), datetime('now')),
      ('place-museum', ?, '현대미술관', 'shop', '서울 종로', '전시 감상 후 메모가 풍성하게 생기는 공간.', 3, datetime('now'), datetime('now'))`,
    [userId, userId],
  );
}

export async function getVaultSnapshot(): Promise<VaultSnapshot> {
  const { id: userId } = await resolveUser();
  const [zettelResult, backlinkResult, mediaResult, assetResult, placeResult] = await Promise.all([
    queryD1<ZettelRow>(
      `select id, title, type, category, summary, content from zettels where user_id = ? order by pinned desc, updated_at desc`,
      [userId],
    ),
    queryD1<LinkRow>(
      `select zl.target_id as sourceId, zs.title as targetTitle
       from zettel_links zl
       inner join zettels zs on zs.id = zl.source_id
       inner join zettels zt on zt.id = zl.target_id
       where zt.user_id = ?`,
      [userId],
    ),
    queryD1<MediaRow>(`select id, media_type as mediaType, title, creator, status, review from media_logs where user_id = ? order by updated_at desc`, [userId]),
    queryD1<AssetRow>(`select id, category, name, brand, current_condition as currentCondition from assets where user_id = ? order by created_at asc`, [userId]),
    queryD1<PlaceRow>(`select id, category, name, address, notes from places where user_id = ? order by updated_at desc`, [userId]),
  ]);

  const backlinks = new Map<string, string[]>();
  for (const row of backlinkResult.rows) {
    const list = backlinks.get(row.sourceId) ?? [];
    list.push(row.targetTitle);
    backlinks.set(row.sourceId, list);
  }

  const zettels: ZettelMock[] = zettelResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    category: row.category ?? "미분류",
    summary: row.summary ?? "요약이 아직 없습니다.",
    content: row.content ?? "",
    backlinks: backlinks.get(row.id) ?? [],
    related: [],
  }));
  const media: MediaMock[] = mediaResult.rows.map((row) => ({
    id: row.id,
    mediaType: row.mediaType,
    title: row.title,
    creator: row.creator ?? "Unknown",
    status: row.status,
    review: row.review ?? "감상이 아직 없습니다.",
  }));
  const assets: AssetMock[] = assetResult.rows.map((row) => ({
    id: row.id,
    category: row.category,
    name: row.name,
    brand: row.brand ?? "-",
    condition: row.currentCondition ?? "-",
  }));
  const places: PlaceMock[] = placeResult.rows.map((row) => ({
    id: row.id,
    category: row.category,
    name: row.name,
    address: row.address ?? "",
    review: row.notes ?? "",
  }));

  return {
    selectedZettelId: zettels[0]?.id ?? "",
    zettels,
    media,
    assets,
    places,
  };
}

export async function getVaultZettel(zettelId: string) {
  const snapshot = await getVaultSnapshot();
  return snapshot.zettels.find((item) => item.id === zettelId) ?? null;
}

export async function cycleVaultMediaStatus(mediaId: string) {
  const { id: userId } = await resolveUser();
  const current = await queryD1<{ status: MediaMock["status"] }>("select status from media_logs where id = ? and user_id = ? limit 1", [mediaId, userId]);
  const order: MediaMock["status"][] = ["backlog", "consuming", "completed"];
  const currentIndex = order.indexOf(current.rows[0]?.status ?? "backlog");
  const next = order[(currentIndex + 1) % order.length];
  await executeD1(`update media_logs set status = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [next, mediaId, userId]);
  return getVaultSnapshot();
}

export async function updateVaultZettelTitle(zettelId: string, title: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update zettels set title = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [title.trim(), zettelId, userId]);
  return getVaultSnapshot();
}

export async function updateVaultZettelContent(zettelId: string, content: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update zettels set content = ?, content_text = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [content, content, zettelId, userId]);
  return getVaultSnapshot();
}

export async function updateVaultPlaceReview(placeId: string, review: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update places set notes = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [review, placeId, userId]);
  return getVaultSnapshot();
}
