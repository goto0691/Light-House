import "server-only";

import { ulid } from "ulidx";

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

type ExistingTagRow = {
  id: string;
  slug: string;
};

const HASHTAG_PATTERN = /(^|[\s(])#([A-Za-z0-9가-힣][A-Za-z0-9가-힣_-]{0,31})/g;

function slugifyTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9가-힣-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function extractHashtags(input: string) {
  const matches = [...input.matchAll(HASHTAG_PATTERN)];
  const unique = new Map<string, string>();

  for (const match of matches) {
    const raw = match[2]?.trim();
    if (!raw) continue;
    const slug = slugifyTag(raw);
    if (!slug || unique.has(slug)) continue;
    unique.set(slug, raw.replace(/_/g, " "));
  }

  return [...unique.entries()].map(([slug, name]) => ({ slug, name }));
}

async function refreshUsageCount(tagId: string) {
  await executeD1(
    `update tags
     set usage_count = (
       select count(*)
       from taggings
       where tag_id = ?
     ),
     updated_at = datetime('now')
     where id = ?`,
    [tagId, tagId],
  );
}

export async function syncTagsForEntity(input: {
  userId: string;
  taggableType: "task" | "zettel" | "daily_log" | "daily_entry";
  taggableId: string;
  content: string;
}) {
  const tags = extractHashtags(input.content);
  const current = await queryD1<ExistingTagRow>(
    `select t.id, t.slug
     from taggings tg
     inner join tags t on t.id = tg.tag_id
     where tg.taggable_type = ? and tg.taggable_id = ?`,
    [input.taggableType, input.taggableId],
  );
  const currentIds = current.rows.map((row) => row.id);

  await executeD1(`delete from taggings where taggable_type = ? and taggable_id = ?`, [input.taggableType, input.taggableId]);

  const affectedTagIds = new Set(currentIds);
  if (!tags.length) {
    for (const tagId of affectedTagIds) {
      await refreshUsageCount(tagId);
    }
    return [];
  }

  const existing = await queryD1<ExistingTagRow>(
    `select id, slug from tags where user_id = ? and slug in (${tags.map(() => "?").join(", ")})`,
    [input.userId, ...tags.map((tag) => tag.slug)],
  );
  const existingMap = new Map(existing.rows.map((row) => [row.slug, row.id]));

  for (const tag of tags) {
    let tagId = existingMap.get(tag.slug);
    if (!tagId) {
      tagId = ulid();
      await executeD1(
        `insert into tags (id, user_id, name, slug, color, parent_id, usage_count, created_at, updated_at)
         values (?, ?, ?, ?, null, null, 0, datetime('now'), datetime('now'))`,
        [tagId, input.userId, tag.name, tag.slug],
      );
      existingMap.set(tag.slug, tagId);
    }
    affectedTagIds.add(tagId);
    await executeD1(
      `insert into taggings (id, tag_id, taggable_type, taggable_id, created_at)
       values (?, ?, ?, ?, datetime('now'))`,
      [ulid(), tagId, input.taggableType, input.taggableId],
    );
  }

  for (const tagId of affectedTagIds) {
    await refreshUsageCount(tagId);
  }

  return tags.map((tag) => ({ ...tag, id: existingMap.get(tag.slug)! }));
}
