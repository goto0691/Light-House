import "server-only";

import type { SearchItem } from "@/lib/mock/search";
import { queryD1, executeD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

type SearchRow = {
  id: string;
  title: string;
  snippet: string | null;
  href: string | null;
  boost: number | null;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

function isMissingFts(error: unknown) {
  return error instanceof Error && /no such table: .*_fts/i.test(error.message);
}

function normalizeQuery(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, "")}"*`)
    .join(" AND ");
}

export async function seedSearchIndexes() {
  const user = await resolveCurrentUser();

  try {
    await Promise.all([
      executeD1(
        `insert into zettels_fts(zettel_id, title, content_text, summary, category)
         select z.id, z.title, coalesce(z.content_text, ''), coalesce(z.summary, ''), coalesce(z.category, '')
         from zettels z
         where z.deleted_at is null
           and not exists (select 1 from zettels_fts f where f.zettel_id = z.id)`,
      ),
      executeD1(
        `insert into tasks_fts(task_id, title, content)
         select t.id, t.title, coalesce(t.content, '')
         from tasks t
         where not exists (select 1 from tasks_fts f where f.task_id = t.id)`,
      ),
      executeD1(
        `insert into people_fts(person_id, name, nickname, bio, core_value)
         select p.id, p.name, coalesce(p.nickname, ''), coalesce(p.bio, ''), coalesce(p.core_value, '')
         from people p
         where p.deleted_at is null
           and not exists (select 1 from people_fts f where f.person_id = p.id)`,
      ),
      executeD1(
        `insert into media_fts(media_id, title, original_title, creator, review)
         select m.id, m.title, coalesce(m.original_title, ''), coalesce(m.creator, ''), coalesce(m.review, '')
         from media_logs m
         where m.deleted_at is null
           and not exists (select 1 from media_fts f where f.media_id = m.id)`,
      ),
      executeD1(
        `insert or ignore into tags (id, user_id, name, slug, color, parent_id, usage_count, created_at, updated_at)
         values
          ('tag-existentialism', ?, '실존주의', 'existentialism', 'gold', null, 12, datetime('now'), datetime('now')),
          ('tag-business', ?, '비즈니스', 'business', 'orange', null, 10, datetime('now'), datetime('now')),
          ('tag-psychology', ?, '심리학', 'psychology', 'sky', null, 8, datetime('now'), datetime('now')),
          ('tag-relationship', ?, '관계', 'relationship', 'rose', null, 7, datetime('now'), datetime('now')),
          ('tag-writing', ?, '집필', 'writing', 'violet', null, 6, datetime('now'), datetime('now'))`,
        [user.id, user.id, user.id, user.id, user.id],
      ),
    ]);
  } catch (error) {
    if (!isMissingFts(error)) {
      throw error;
    }
  }
}

export async function searchWithFTS(query: string, types?: string[]): Promise<SearchItem[] | null> {
  const user = await resolveCurrentUser();
  const ftsQuery = normalizeQuery(query);

  if (!ftsQuery) {
    return [];
  }

  const wants = (type: SearchItem["type"]) => !types?.length || types.includes(type);

  try {
    const searches: Array<Promise<SearchItem[]>> = [];

    if (wants("task")) {
      searches.push(
        queryD1<SearchRow>(
          `select
             t.id as id,
             t.title as title,
             snippet(tasks_fts, 1, '<mark>', '</mark>', '…', 14) as snippet,
             case when lower(t.title) like lower(?) then 3 else 1.6 end as boost,
             case when t.project_id is null then '/action-hub/inbox' else '/action-hub/' || t.project_id || '/tasks/' || t.id end as href
           from tasks_fts
           inner join tasks t on t.id = tasks_fts.task_id
           where tasks_fts match ?
             and t.user_id = ?
             and t.deleted_at is null
           order by boost desc, t.updated_at desc
           limit 8`,
          [`%${query}%`, ftsQuery, user.id],
        ).then((result) =>
          result.rows.map((row) => ({
            type: "task" as const,
            id: row.id,
            title: row.title,
            snippet: row.snippet ?? "작업 검색 결과",
            href: row.href ?? "/action-hub",
            score: Number(row.boost ?? 1.5),
          })),
        ),
      );
    }

    if (wants("person")) {
      searches.push(
        queryD1<SearchRow>(
          `select
             p.id as id,
             p.name as title,
             snippet(people_fts, 3, '<mark>', '</mark>', '…', 12) as snippet,
             case when lower(p.name) like lower(?) then 3 else 1.4 end as boost,
             '/prm?detail=person:' || p.id as href
           from people_fts
           inner join people p on p.id = people_fts.person_id
           where people_fts match ?
             and p.user_id = ?
             and p.deleted_at is null
           order by boost desc, p.updated_at desc
           limit 8`,
          [`%${query}%`, ftsQuery, user.id],
        ).then((result) =>
          result.rows.map((row) => ({
            type: "person" as const,
            id: row.id,
            title: row.title,
            snippet: row.snippet ?? "관계 검색 결과",
            href: row.href ?? "/prm",
            score: Number(row.boost ?? 1.4),
          })),
        ),
      );
    }

    if (wants("zettel")) {
      searches.push(
        queryD1<SearchRow>(
          `select
             z.id as id,
             z.title as title,
             snippet(zettels_fts, 2, '<mark>', '</mark>', '…', 14) as snippet,
             case when lower(z.title) like lower(?) then 3 else 1.3 end as boost,
             '/vault/zettels?detail=zettel:' || z.id as href
           from zettels_fts
           inner join zettels z on z.id = zettels_fts.zettel_id
           where zettels_fts match ?
             and z.user_id = ?
             and z.deleted_at is null
           order by boost desc, z.updated_at desc
           limit 8`,
          [`%${query}%`, ftsQuery, user.id],
        ).then((result) =>
          result.rows.map((row) => ({
            type: "zettel" as const,
            id: row.id,
            title: row.title,
            snippet: row.snippet ?? "노트 검색 결과",
            href: row.href ?? "/vault/zettels",
            score: Number(row.boost ?? 1.3),
          })),
        ),
      );
    }

    if (wants("media")) {
      searches.push(
        queryD1<SearchRow>(
          `select
             m.id as id,
             m.title as title,
             snippet(media_fts, 4, '<mark>', '</mark>', '…', 12) as snippet,
             case when lower(m.title) like lower(?) then 2.4 else 1.1 end as boost,
             '/vault/media?detail=media:' || m.id as href
           from media_fts
           inner join media_logs m on m.id = media_fts.media_id
           where media_fts match ?
             and m.user_id = ?
             and m.deleted_at is null
           order by boost desc, m.updated_at desc
           limit 8`,
          [`%${query}%`, ftsQuery, user.id],
        ).then((result) =>
          result.rows.map((row) => ({
            type: "media" as const,
            id: row.id,
            title: row.title,
            snippet: row.snippet ?? "미디어 검색 결과",
            href: row.href ?? "/vault/media",
            score: Number(row.boost ?? 1.1),
          })),
        ),
      );
    }

    if (wants("tag")) {
      searches.push(
        queryD1<SearchRow>(
          `select
             t.id as id,
             t.name as title,
             ('#' || t.slug || ' · ' || coalesce(t.usage_count, 0) || ' uses') as snippet,
             case when lower(t.name) like lower(?) then 2.2 else 1.05 end as boost,
             '/vault?tag=' || t.slug as href
           from tags t
           where t.user_id = ?
             and t.deleted_at is null
             and (lower(t.name) like lower(?) or lower(t.slug) like lower(?))
           order by boost desc, coalesce(t.usage_count, 0) desc, t.name asc
           limit 10`,
          [`%${query}%`, user.id, `%${query}%`, `%${slugify(query)}%`],
        ).then((result) =>
          result.rows.map((row) => ({
            type: "tag" as const,
            id: row.id,
            title: row.title,
            snippet: row.snippet ?? "태그 검색 결과",
            href: row.href ?? "/vault",
            score: Number(row.boost ?? 1.05),
          })),
        ),
      );
    }

    const groups = await Promise.all(searches);
    return groups
      .flat()
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
  } catch (error) {
    if (isMissingFts(error)) {
      return null;
    }
    throw error;
  }
}
