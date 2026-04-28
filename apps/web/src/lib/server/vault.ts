import "server-only";

import { cache } from "react";
import { ulid } from "ulidx";

import type { AssetMock, MediaMock, PlaceMock, SourceDocumentInfo, ZettelMock } from "@/lib/mock/vault";
import { requireSession } from "@/lib/auth/session";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { syncZettelRelationsFromContent } from "@/lib/server/relations";
import { syncTagsForEntity } from "@/lib/server/tagging";

export type VaultSnapshot = {
  selectedZettelId: string;
  zettels: ZettelMock[];
  media: MediaMock[];
  assets: AssetMock[];
  places: PlaceMock[];
};

type UserRow = { id: string };
type ZettelRow = {
  id: string;
  title: string;
  type: ZettelMock["type"];
  category: string | null;
  status: string | null;
  documentKind: string | null;
  originalCreatedAt: string | null;
  source: string | null;
  sourceUrl: string | null;
  summary: string | null;
  content: string | null;
};
type BacklinkRow = { targetId: string; sourceTitle: string };
type OutgoingRow = { id: string; sourceId: string; targetId: string; targetTitle: string };
type MediaRow = {
  id: string;
  mediaType: MediaMock["mediaType"];
  title: string;
  originalTitle: string | null;
  subtype: string | null;
  platformOrPublisher: string | null;
  creator: string | null;
  studio: string | null;
  genre: string | null;
  releaseYear: number | null;
  status: MediaMock["status"];
  rating: number | null;
  evaluation: string | null;
  review: string | null;
  content: string | null;
  relationNote: string | null;
  playTime: number | null;
  author: string | null;
  pages: number | null;
  screenKind: string | null;
  rewatchValue: number | null;
  coverImageUrl: string | null;
  loggedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};
type AssetRow = { id: string; category: AssetMock["category"]; name: string; brand: string | null; currentCondition: string | null };
type PlaceRow = { id: string; category: PlaceMock["category"]; name: string; address: string | null; notes: string | null };
type SourceDocumentRow = {
  id: string;
  canonicalEntityType: string;
  canonicalEntityId: string;
  sourceDatabase: string | null;
  sourceId: string;
  documentRole: string | null;
  status: string;
  preview: string | null;
};
type SourceDocumentPropertyRow = { sourceDocumentId: string; name: string; value: string | null; type: string | null };

async function resolveUser() {
  const session = await requireSession();
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

function summarize(content: string) {
  const text = content.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 160) : "요약이 아직 없습니다.";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

export async function seedVaultSupportData() {
  const { id: userId } = await resolveUser();
  const existing = await queryD1<{ count: number | null }>(`select count(*) as count from zettels where user_id = ?`, [userId]);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

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

export const getVaultSnapshot = cache(async function getVaultSnapshot(): Promise<VaultSnapshot> {
  const { id: userId } = await resolveUser();
  const [zettelResult, backlinkResult, outgoingResult, mediaResult, assetResult, placeResult, sourceDocumentResult, sourcePropertyResult] = await Promise.all([
    queryD1<ZettelRow>(
      `select
         id,
         title,
         type,
         category,
         status,
         document_kind as documentKind,
         original_created_at as originalCreatedAt,
         source,
         source_url as sourceUrl,
         summary,
         content
       from zettels
       where user_id = ?
         and deleted_at is null
         and not exists (
           select 1
           from taggings tg
           inner join tags t on t.id = tg.tag_id
           where tg.taggable_type = 'zettel'
             and tg.taggable_id = zettels.id
             and t.slug in ('archive-work', 'needs-review', 'auto-log')
         )
       order by pinned desc, updated_at desc`,
      [userId],
    ),
    queryD1<BacklinkRow>(
      `select zl.target_id as targetId, zs.title as sourceTitle
       from zettel_links zl
       inner join zettels zs on zs.id = zl.source_id
       inner join zettels zt on zt.id = zl.target_id
       where zt.user_id = ? and zs.deleted_at is null and zt.deleted_at is null`,
      [userId],
    ),
    queryD1<OutgoingRow>(
      `select zl.id, zl.source_id as sourceId, zl.target_id as targetId, zt.title as targetTitle
       from zettel_links zl
       inner join zettels zs on zs.id = zl.source_id
       inner join zettels zt on zt.id = zl.target_id
       where zs.user_id = ? and zs.deleted_at is null and zt.deleted_at is null`,
      [userId],
    ),
    queryD1<MediaRow>(
      `select
         id,
         media_type as mediaType,
         title,
         original_title as originalTitle,
         subtype,
         platform_or_publisher as platformOrPublisher,
         creator,
         studio,
         genre,
         release_year as releaseYear,
         status,
         rating,
         evaluation,
         review,
         content,
         relation_note as relationNote,
         play_time as playTime,
         author,
         pages,
         screen_kind as screenKind,
         rewatch_value as rewatchValue,
         cover_image_url as coverImageUrl,
         logged_at as loggedAt,
         started_at as startedAt,
         completed_at as completedAt
       from media_logs
       where user_id = ? and deleted_at is null
       order by updated_at desc`,
      [userId],
    ),
    queryD1<AssetRow>(`select id, category, name, brand, current_condition as currentCondition from assets where user_id = ? and deleted_at is null order by created_at asc`, [userId]),
    queryD1<PlaceRow>(`select id, category, name, address, notes from places where user_id = ? and deleted_at is null order by updated_at desc`, [userId]),
    queryD1<SourceDocumentRow>(
      `select
         id,
         canonical_entity_type as canonicalEntityType,
         canonical_entity_id as canonicalEntityId,
         source_database as sourceDatabase,
         source_id as sourceId,
         document_role as documentRole,
         status,
         raw_content_preview as preview
       from source_documents
       where user_id = ?
         and deleted_at is null
         and canonical_entity_type in ('zettel', 'media')`,
      [userId],
    ),
    queryD1<SourceDocumentPropertyRow>(
      `select
         sdp.source_document_id as sourceDocumentId,
         sdp.property_name as name,
         sdp.value_text as value,
         sdp.property_type as type
       from source_document_properties sdp
       inner join source_documents sd on sd.id = sdp.source_document_id
       where sd.user_id = ?
         and sd.deleted_at is null
         and sd.canonical_entity_type in ('zettel', 'media')
       order by sdp.source_document_id, sdp.property_key`,
      [userId],
    ),
  ]);

  const backlinks = new Map<string, string[]>();
  for (const row of backlinkResult.rows) {
    const list = backlinks.get(row.targetId) ?? [];
    list.push(row.sourceTitle);
    backlinks.set(row.targetId, list);
  }

  const outgoing = new Map<string, ZettelMock["outgoingLinks"]>();
  for (const row of outgoingResult.rows) {
    const list = outgoing.get(row.sourceId) ?? [];
    list.push({ id: row.id, targetId: row.targetId, title: row.targetTitle });
    outgoing.set(row.sourceId, list);
  }

  const sourceProperties = new Map<string, Array<{ name: string; value: string; type?: string | null }>>();
  for (const row of sourcePropertyResult.rows) {
    if (!row.value) continue;
    const properties = sourceProperties.get(row.sourceDocumentId) ?? [];
    properties.push({ name: row.name, value: row.value, type: row.type });
    sourceProperties.set(row.sourceDocumentId, properties);
  }

  const sourceDocuments = new Map<string, SourceDocumentInfo>();
  for (const row of sourceDocumentResult.rows) {
    sourceDocuments.set(`${row.canonicalEntityType}:${row.canonicalEntityId}`, {
      id: row.id,
      sourceDatabase: row.sourceDatabase,
      sourceId: row.sourceId,
      documentRole: row.documentRole,
      status: row.status,
      preview: row.preview,
      properties: sourceProperties.get(row.id) ?? [],
    });
  }

  const zettels: ZettelMock[] = zettelResult.rows.map((row) => {
    const links = outgoing.get(row.id) ?? [];
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      category: row.category ?? "미분류",
      summary: row.summary ?? "요약이 아직 없습니다.",
      content: row.content ?? "",
      outgoingLinks: links,
      backlinks: backlinks.get(row.id) ?? [],
      related: links.map((link) => link.title),
      status: row.status,
      documentKind: row.documentKind,
      originalCreatedAt: row.originalCreatedAt,
      source: row.source,
      sourceUrl: row.sourceUrl,
      sourceDocument: sourceDocuments.get(`zettel:${row.id}`) ?? null,
    };
  });
  const media: MediaMock[] = mediaResult.rows.map((row) => ({
    id: row.id,
    mediaType: row.mediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    subtype: row.subtype,
    platformOrPublisher: row.platformOrPublisher,
    creator: row.creator ?? "Unknown",
    studio: row.studio,
    genre: row.genre,
    releaseYear: row.releaseYear,
    status: row.status,
    rating: row.rating,
    evaluation: row.evaluation,
    sourceDocument: sourceDocuments.get(`media:${row.id}`) ?? null,
    review: row.review ?? "감상이 아직 없습니다.",
    content: row.content,
    relationNote: row.relationNote,
    playTime: row.playTime,
    author: row.author,
    pages: row.pages,
    screenKind: row.screenKind,
    rewatchValue: Boolean(row.rewatchValue),
    coverImageUrl: row.coverImageUrl,
    loggedAt: row.loggedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
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
});

export async function getVaultZettel(zettelId: string) {
  const snapshot = await getVaultSnapshot();
  return snapshot.zettels.find((item) => item.id === zettelId) ?? null;
}

export async function getVaultZettelsTouchedOn(date: string, limit = 4) {
  const { id: userId } = await resolveUser();
  const result = await queryD1<{ id: string; title: string }>(
    `select distinct z.id, z.title
     from zettels z
     left join source_documents sd
       on sd.canonical_entity_type = 'zettel'
      and sd.canonical_entity_id = z.id
      and sd.deleted_at is null
     where z.user_id = ?
       and z.deleted_at is null
       and (
         date(coalesce(z.updated_at, z.created_at)) = ?
         or date(z.created_at) = ?
         or date(coalesce(sd.updated_at, sd.created_at)) = ?
       )
     order by z.title asc
     limit ?`,
    [userId, date, date, date, limit],
  );
  return result.rows;
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

export async function updateVaultMediaDetails(mediaId: string, input: {
  title?: string;
  mediaType?: MediaMock["mediaType"];
  originalTitle?: string | null;
  subtype?: string | null;
  platformOrPublisher?: string | null;
  creator?: string | null;
  studio?: string | null;
  genre?: string | null;
  releaseYear?: number | null;
  status?: MediaMock["status"];
  rating?: number | null;
  evaluation?: string | null;
  review?: string | null;
  content?: string | null;
  relationNote?: string | null;
  playTime?: number | null;
  author?: string | null;
  pages?: number | null;
  screenKind?: string | null;
  rewatchValue?: boolean | null;
  loggedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}) {
  const { id: userId } = await resolveUser();
  const title = input.title?.trim();
  if (!title) throw new Error("미디어 제목은 비워둘 수 없습니다.");

  const mediaType = ["game", "book", "screen"].includes(input.mediaType ?? "") ? input.mediaType : "screen";
  const status = ["backlog", "consuming", "completed", "dropped"].includes(input.status ?? "") ? input.status : "backlog";
  const nullableText = (value: string | null | undefined) => value?.trim() || null;
  const nullableDate = (value: string | null | undefined) => {
    const next = value?.trim();
    return next ? next.slice(0, 10) : null;
  };
  const nullableNumber = (value: number | null | undefined) => (Number.isFinite(value) ? Number(value) : null);

  await executeD1(
    `update media_logs
     set media_type = ?,
         title = ?,
         original_title = ?,
         subtype = ?,
         platform_or_publisher = ?,
         creator = ?,
         studio = ?,
         genre = ?,
         release_year = ?,
         status = ?,
         rating = ?,
         evaluation = ?,
         review = ?,
         content = ?,
         relation_note = ?,
         play_time = ?,
         author = ?,
         pages = ?,
         screen_kind = ?,
         rewatch_value = ?,
         logged_at = ?,
         started_at = ?,
         completed_at = ?,
         updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [
      mediaType,
      title,
      nullableText(input.originalTitle),
      nullableText(input.subtype),
      nullableText(input.platformOrPublisher),
      nullableText(input.creator),
      nullableText(input.studio),
      nullableText(input.genre),
      nullableNumber(input.releaseYear),
      status,
      nullableNumber(input.rating),
      nullableText(input.evaluation),
      nullableText(input.review),
      nullableText(input.content),
      nullableText(input.relationNote),
      nullableNumber(input.playTime),
      nullableText(input.author),
      nullableNumber(input.pages),
      nullableText(input.screenKind),
      input.rewatchValue ? 1 : 0,
      nullableDate(input.loggedAt),
      nullableDate(input.startedAt),
      nullableDate(input.completedAt),
      mediaId,
      userId,
    ],
  );
  return getVaultSnapshot();
}

export async function updateVaultZettelTitle(zettelId: string, title: string) {
  const { id: userId } = await resolveUser();
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error("제목은 비워둘 수 없습니다.");
  await executeD1(`update zettels set title = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [nextTitle, zettelId, userId]);
  return getVaultSnapshot();
}

export async function updateVaultZettelContent(zettelId: string, content: string) {
  const { id: userId } = await resolveUser();
  await executeD1(
    `update zettels
     set content = ?, content_text = ?, summary = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [content, content, summarize(content), zettelId, userId],
  );
  await syncTagsForEntity({
    userId,
    taggableType: "zettel",
    taggableId: zettelId,
    content,
  });
  await syncZettelRelationsFromContent({
    userId,
    zettelId,
    content,
  });
  return getVaultSnapshot();
}

export async function createVaultZettel(input: { title: string; type?: ZettelMock["type"]; category?: string; content?: string }) {
  const { id: userId } = await resolveUser();
  const title = input.title.trim();
  if (!title) throw new Error("메모 제목은 비워둘 수 없습니다.");
  const content = input.content ?? "";
  const id = ulid();
  await executeD1(
    `insert into zettels
      (id, user_id, title, slug, content, content_text, summary, type, category, pinned, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
    [id, userId, title, `${slugify(title)}-${id.slice(-6).toLowerCase()}`, content, content, summarize(content), input.type ?? "fleeting", input.category?.trim() || "미분류"],
  );
  await syncTagsForEntity({
    userId,
    taggableType: "zettel",
    taggableId: id,
    content,
  });
  await syncZettelRelationsFromContent({
    userId,
    zettelId: id,
    content,
  });
  const snapshot = await getVaultSnapshot();
  return {
    snapshot: {
      ...snapshot,
      selectedZettelId: id,
    },
  };
}

export async function deleteVaultZettel(zettelId: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`delete from zettel_links where source_id = ? or target_id = ?`, [zettelId, zettelId]);
  await executeD1(`update zettels set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [zettelId, userId]);
  return getVaultSnapshot();
}

export async function linkVaultZettels(input: { sourceId: string; targetId: string; context?: string }) {
  const { id: userId } = await resolveUser();
  if (!input.sourceId || !input.targetId) throw new Error("링크할 두 메모를 모두 선택해 주세요.");
  if (input.sourceId === input.targetId) throw new Error("같은 메모끼리는 연결할 수 없습니다.");

  const allowed = await queryD1<{ count: number }>(
    `select count(*) as count
     from zettels
     where user_id = ? and id in (?, ?) and deleted_at is null`,
    [userId, input.sourceId, input.targetId],
  );
  if (Number(allowed.rows[0]?.count ?? 0) < 2) {
    throw new Error("연결 대상 메모를 찾지 못했습니다.");
  }

  await executeD1(
    `insert or ignore into zettel_links (id, source_id, target_id, context, created_at)
     values (?, ?, ?, ?, datetime('now'))`,
    [ulid(), input.sourceId, input.targetId, input.context?.trim() || null],
  );
  return getVaultSnapshot();
}

export async function unlinkVaultZettels(linkId: string) {
  await executeD1(`delete from zettel_links where id = ?`, [linkId]);
  return getVaultSnapshot();
}

export async function updateVaultPlaceReview(placeId: string, review: string) {
  const { id: userId } = await resolveUser();
  await executeD1(`update places set notes = ?, updated_at = datetime('now') where id = ? and user_id = ?`, [review, placeId, userId]);
  return getVaultSnapshot();
}
