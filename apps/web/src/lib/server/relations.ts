import "server-only";

import { ulid } from "ulidx";

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

type EntityRow = {
  id: string;
  title: string;
};

const PERSON_PATTERN = /(^|[\s(])@([A-Za-z0-9가-힣][A-Za-z0-9가-힣_-]{0,31})/g;
const ZETTEL_PATTERN = /\[\[([^\]\n]{1,120})\]\]/g;

function normalizeToken(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function extractPersonMentions(input: string) {
  const matches = [...input.matchAll(PERSON_PATTERN)];
  return [...new Set(matches.map((match) => normalizeToken(match[2] ?? "")).filter(Boolean))];
}

export function extractZettelMentions(input: string) {
  const matches = [...input.matchAll(ZETTEL_PATTERN)];
  return [...new Set(matches.map((match) => normalizeToken(match[1] ?? "")).filter(Boolean))];
}

async function findPeopleByMention(userId: string, mentions: string[]) {
  if (!mentions.length) return [];
  const people = await queryD1<EntityRow>(
    `select id, name as title
     from people
     where user_id = ? and deleted_at is null`,
    [userId],
  );
  const mentionSet = new Set(mentions);
  return people.rows.filter((row) => mentionSet.has(normalizeToken(row.title)));
}

async function findZettelsByMention(userId: string, mentions: string[]) {
  if (!mentions.length) return [];
  const zettels = await queryD1<EntityRow>(
    `select id, title
     from zettels
     where user_id = ? and deleted_at is null`,
    [userId],
  );
  const mentionSet = new Set(mentions);
  return zettels.rows.filter((row) => mentionSet.has(normalizeToken(row.title)));
}

export async function syncZettelRelationsFromContent(input: {
  userId: string;
  zettelId: string;
  content: string;
}) {
  const [people, zettels] = await Promise.all([
    findPeopleByMention(input.userId, extractPersonMentions(input.content)),
    findZettelsByMention(input.userId, extractZettelMentions(input.content)),
  ]);

  await executeD1(
    `delete from zettel_people_relations
     where zettel_id = ? and context = 'editor_mention'`,
    [input.zettelId],
  );
  await executeD1(
    `delete from zettel_links
     where source_id = ? and context = 'editor_mention'`,
    [input.zettelId],
  );

  for (const person of people) {
    await executeD1(
      `insert into zettel_people_relations (zettel_id, person_id, context, created_at)
       values (?, ?, 'editor_mention', datetime('now'))`,
      [input.zettelId, person.id],
    );
  }

  for (const zettel of zettels) {
    if (zettel.id === input.zettelId) continue;
    await executeD1(
      `insert into zettel_links (id, source_id, target_id, context, created_at)
       values (?, ?, ?, 'editor_mention', datetime('now'))`,
      [ulid(), input.zettelId, zettel.id],
    );
  }

  return {
    people,
    zettels: zettels.filter((zettel) => zettel.id !== input.zettelId),
  };
}

export async function attachTaskRelationsFromContent(input: {
  userId: string;
  taskId: string;
  content: string;
}) {
  const [people, zettels] = await Promise.all([
    findPeopleByMention(input.userId, extractPersonMentions(input.content)),
    findZettelsByMention(input.userId, extractZettelMentions(input.content)),
  ]);

  await executeD1(
    `delete from task_people_relations
     where task_id = ? and role_context = 'editor_mention'`,
    [input.taskId],
  );

  for (const person of people) {
    await executeD1(
      `insert or ignore into task_people_relations (task_id, person_id, role_context, created_at)
       values (?, ?, 'editor_mention', datetime('now'))`,
      [input.taskId, person.id],
    );
  }

  for (const zettel of zettels) {
    await executeD1(
      `insert or ignore into task_zettel_relations (task_id, zettel_id, created_at)
       values (?, ?, datetime('now'))`,
      [input.taskId, zettel.id],
    );
  }

  return { people, zettels };
}
