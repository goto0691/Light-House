import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Result<T> = { meta?: { changes?: number }; results?: T[]; success?: boolean };
type D1Envelope<T> = { errors?: Array<{ message?: string }>; result?: Array<D1Result<T>>; success?: boolean };

type UserRow = { id: string };
type PersonMediaMatchRow = { personId: string; name: string; mediaId: string; mediaType: string };
type DuplicatePersonRow = {
  id: string;
  name: string;
  groups: string | null;
  bio: string | null;
  coreValue: string | null;
  isFavorite: number | null;
  interactions: number | null;
  gifts: number | null;
};
type ZettelRow = { id: string; title: string; content: string | null; contentText: string | null; summary: string | null };
type MediaMatchRow = { id: string; mediaType: string };
type CountRow = { value: number | null };

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 0);

const TAGS = {
  archiveWork: { slug: "archive-work", name: "Archive Work" },
  autoLog: { slug: "auto-log", name: "Auto Log" },
  faith: { slug: "faith", name: "Faith" },
  game: { slug: "game", name: "Game" },
  journal: { slug: "journal", name: "Journal" },
  media: { slug: "media", name: "Media" },
  meditation: { slug: "meditation", name: "Meditation" },
  needsReview: { slug: "needs-review", name: "Needs Review" },
  screen: { slug: "screen", name: "Screen" },
  writing: { slug: "writing", name: "Writing" },
} as const;

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.trim().match(/^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/);
      if (!match) continue;
      process.env[match[1]] ??= match[2].replace(/^"|"$/g, "");
    }
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? requiredEnv("DATABASE_AUTH_TOKEN");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const payload = (await response.json()) as D1Envelope<T>;
  const result = payload.result?.[0];
  if (!response.ok || payload.success === false || result?.success === false) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 query failed.";
    throw new Error(`${message}\n${sql.slice(0, 240)}`);
  }
  return { rows: result?.results ?? [], meta: result?.meta ?? {} };
}

async function exec(sql: string, params: unknown[] = []) {
  if (!APPLY) return { changes: 0 };
  return (await queryD1(sql, params)).meta;
}

function hashId(prefix: string, parts: Array<string | null | undefined>) {
  return `${prefix}_${createHash("sha1").update(parts.map((part) => part ?? "").join("|")).digest("hex").slice(0, 32)}`;
}

function normalizeTitle(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function body(row: ZettelRow) {
  return [row.title, row.summary, row.contentText, row.content].filter(Boolean).join("\n");
}

function extractDate(text: string) {
  const normalized = text.normalize("NFKC");
  const korean = normalized.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return `${korean[1]}-${korean[2].padStart(2, "0")}-${korean[3].padStart(2, "0")}`;
  const iso = normalized.match(/(\d{4})[-./_ ]+(\d{1,2})[-./_ ]+(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return null;
}

function stripMarkdownTitle(text: string) {
  return text
    .replace(/^# .+$/m, "")
    .replace(/^날짜:\s*.+$/m, "")
    .replace(/^태그:\s*.+$/m, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mediaTypeTag(mediaType: string) {
  if (mediaType === "game") return TAGS.game;
  if (mediaType === "screen") return TAGS.screen;
  return TAGS.media;
}

function isGeneratedMediaZettel(row: ZettelRow) {
  const text = body(row);
  return /(?:게임 로그|영상 로그|독서 로그|콘텐츠 로그)\s*:/.test(text) || /(?:^|\n)3\.\s*네트워크\s*:/.test(text);
}

function isJournalLike(row: ZettelRow) {
  const text = body(row);
  return /감사일기|Dear My Diary|일기|라이프 로그/.test(row.title) || /(?:^|\n)태그:\s*(?:감사일기|일기|journal)/i.test(text);
}

function isMeditationLike(row: ZettelRow) {
  const text = body(row);
  return /묵상|QT|말씀|본문/.test(row.title) || /(?:본문말씀|묵상|말씀)/.test(text);
}

function isFaithLike(row: ZettelRow) {
  const text = body(row);
  return /그리스도|기도|복음|성경|하나님|예수|설교|달란트|말씀|묵상/.test(text);
}

function isWritingLike(row: ZettelRow) {
  const text = body(row);
  return /소설|시나리오|캐릭터|세계관|플롯|창작|편지|답장|연애편지|유형/.test(text);
}

function isWorkArchiveLike(row: ZettelRow) {
  const text = body(row);
  return /장애|진단서|입원|퇴원|요양|병원|호흡기 진료센터|재택관리센터|전화대응|의무기록|공단|진료센터|CMD|네트워크 관련|KB 증권|PB페이지|DEMIS/.test(text);
}

async function ensureTag(userId: string, tag: { slug: string; name: string }) {
  const existing = await queryD1<{ id: string }>("select id from tags where user_id = ? and slug = ? and deleted_at is null limit 1", [userId, tag.slug]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = hashId("tag", [userId, tag.slug]);
  await exec(
    `insert into tags (id, user_id, name, slug, usage_count, created_at, updated_at)
     values (?, ?, ?, ?, 0, datetime('now'), datetime('now'))
     on conflict(id) do update set name = excluded.name, slug = excluded.slug, deleted_at = null, updated_at = datetime('now')`,
    [id, userId, tag.name, tag.slug],
  );
  return id;
}

async function tagEntity(tagIds: Map<string, string>, tag: { slug: string }, type: string, id: string) {
  const tagId = tagIds.get(tag.slug);
  if (!tagId) throw new Error(`Missing tag ${tag.slug}`);
  await exec(
    `insert into taggings (id, tag_id, taggable_type, taggable_id, created_at)
     select ?, ?, ?, ?, datetime('now')
     where not exists (
       select 1 from taggings where tag_id = ? and taggable_type = ? and taggable_id = ?
     )`,
    [hashId("tg", [tagId, type, id]), tagId, type, id, tagId, type, id],
  );
}

async function refreshTags(tagIds: Map<string, string>) {
  for (const tagId of tagIds.values()) {
    await exec(
      `update tags
       set usage_count = (select count(*) from taggings where tag_id = ?), updated_at = datetime('now')
       where id = ?`,
      [tagId, tagId],
    );
  }
}

async function writeAudit(userId: string, action: string, entityType: string, entityId: string, snapshot: unknown) {
  await exec(
    `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [randomUUID(), userId, action, entityType, entityId, JSON.stringify(snapshot)],
  );
}

async function markReviewApplied(userId: string, entityType: string, entityId: string, issueType: string, reason: string, payload: unknown) {
  await exec(
    `update migration_review_items
     set status = 'applied', reason = ?, payload = ?, resolved_at = datetime('now'), updated_at = datetime('now')
     where user_id = ? and entity_type = ? and entity_id = ? and issue_type = ? and status = 'open' and deleted_at is null`,
    [reason, JSON.stringify(payload), userId, entityType, entityId, issueType],
  );
}

async function softHideZettel(userId: string, zettelId: string, reason: string, canonicalType: string | null = null, canonicalId: string | null = null) {
  await exec(`update zettels set deleted_at = coalesce(deleted_at, datetime('now')), updated_at = datetime('now') where id = ? and user_id = ?`, [zettelId, userId]);
  await exec(`delete from zettels_fts where zettel_id = ?`, [zettelId]);
  if (canonicalType && canonicalId) {
    await exec(
      `update source_documents
       set canonical_entity_type = ?, canonical_entity_id = ?, status = 'reclassified', document_role = coalesce(document_role, ?), updated_at = datetime('now')
       where user_id = ? and canonical_entity_type = 'zettel' and canonical_entity_id = ?`,
      [canonicalType, canonicalId, reason, userId, zettelId],
    );
  }
}

async function refinePersonArtifacts(userId: string) {
  const rows = await queryD1<PersonMediaMatchRow>(
    `select p.id as personId, p.name, m.id as mediaId, m.media_type as mediaType
     from people p
     inner join media_logs m on lower(trim(m.title)) = lower(trim(p.name)) and m.user_id = p.user_id and m.deleted_at is null
     where p.user_id = ?
       and p.deleted_at is null
       and coalesce(p.is_favorite, 0) = 0
       and coalesce(p.groups, '[]') in ('', '[]')
       and coalesce(p.bio, '') = ''
       and coalesce(p.core_value, '') = ''
       and coalesce(p.phone, '') = ''
       and coalesce(p.email, '') = ''
       and coalesce(p.address, '') = ''
       and not exists (select 1 from task_people_relations tpr where tpr.person_id = p.id)
       and not exists (select 1 from daily_log_people_relations dlpr where dlpr.person_id = p.id)
       and not exists (select 1 from interactions i where i.person_id = p.id and i.deleted_at is null)
       and not exists (select 1 from gifts g where g.person_id = p.id and g.deleted_at is null)
       and not exists (select 1 from network_edges ne where (ne.source_person_id = p.id or ne.target_person_id = p.id) and ne.deleted_at is null)
     order by p.name, p.id`,
    [userId],
  );
  const selected = LIMIT ? rows.rows.slice(0, LIMIT) : rows.rows;
  let hiddenPeople = 0;
  let movedZettelLinks = 0;

  for (const row of selected) {
    const inserted = await exec(
      `insert into zettel_media_relations (zettel_id, media_id, created_at)
       select distinct zpr.zettel_id, ?, datetime('now')
       from zettel_people_relations zpr
       inner join zettels z on z.id = zpr.zettel_id and z.deleted_at is null
       where zpr.person_id = ?
         and not exists (
           select 1 from zettel_media_relations zmr where zmr.zettel_id = zpr.zettel_id and zmr.media_id = ?
         )`,
      [row.mediaId, row.personId, row.mediaId],
    );
    movedZettelLinks += inserted.changes ?? 0;
    await exec(`delete from zettel_people_relations where person_id = ?`, [row.personId]);
    await exec(`delete from media_people_relations where person_id = ?`, [row.personId]);
    await exec(`delete from people_fts where person_id = ?`, [row.personId]);
    const hidden = await exec(`update people set deleted_at = coalesce(deleted_at, datetime('now')), status = 'artifact', updated_at = datetime('now') where id = ? and user_id = ?`, [row.personId, userId]);
    hiddenPeople += hidden.changes ?? 0;
    await exec(
      `update source_documents
       set canonical_entity_type = 'media', canonical_entity_id = ?, status = 'reclassified', document_role = 'relation-artifact', updated_at = datetime('now')
       where user_id = ? and canonical_entity_type = 'person' and canonical_entity_id = ?`,
      [row.mediaId, userId, row.personId],
    );
    await markReviewApplied(userId, "person", row.personId, "possible-person-artifact", "Matched PRM artifact to canonical media title and moved zettel relations to zettel-media.", row);
    await writeAudit(userId, "migration.person_artifact.reclassify_to_media", "person", row.personId, row);
  }

  return { candidates: rows.rows.length, hiddenPeople, movedZettelLinks };
}

function personScore(row: DuplicatePersonRow) {
  return (
    (row.isFavorite ? 100 : 0) +
    (row.groups && row.groups !== "[]" ? 30 : 0) +
    (row.bio?.trim() ? 20 : 0) +
    (row.coreValue?.trim() ? 20 : 0) +
    Number(row.interactions ?? 0) * 10 +
    Number(row.gifts ?? 0) * 10
  );
}

async function mergeDuplicatePeople(userId: string) {
  const rows = await queryD1<DuplicatePersonRow>(
    `select
       p.id,
       p.name,
       p.groups,
       p.bio,
       p.core_value as coreValue,
       p.is_favorite as isFavorite,
       (select count(*) from interactions i where i.person_id = p.id and i.deleted_at is null) as interactions,
       (select count(*) from gifts g where g.person_id = p.id and g.deleted_at is null) as gifts
     from people p
     where p.user_id = ? and p.deleted_at is null
     order by lower(trim(p.name)), p.id`,
    [userId],
  );
  const groups = new Map<string, DuplicatePersonRow[]>();
  for (const row of rows.rows) {
    const key = normalizeTitle(row.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let duplicateGroups = 0;
  let hiddenPeople = 0;
  let movedRelations = 0;

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    duplicateGroups += 1;
    const [canonical, ...duplicates] = [...list].sort((a, b) => personScore(b) - personScore(a) || a.id.localeCompare(b.id));
    for (const duplicate of duplicates) {
      const zettel = await exec(
        `insert into zettel_people_relations (zettel_id, person_id, context, created_at)
         select distinct zettel_id, ?, coalesce(context, 'migration-person-merge'), datetime('now')
         from zettel_people_relations
         where person_id = ?
           and not exists (
             select 1 from zettel_people_relations existing
             where existing.zettel_id = zettel_people_relations.zettel_id and existing.person_id = ?
           )`,
        [canonical.id, duplicate.id, canonical.id],
      );
      const media = await exec(
        `insert into media_people_relations (media_id, person_id, context, created_at)
         select distinct media_id, ?, coalesce(context, 'migration-person-merge'), datetime('now')
         from media_people_relations
         where person_id = ?
           and not exists (
             select 1 from media_people_relations existing
             where existing.media_id = media_people_relations.media_id and existing.person_id = ?
           )`,
        [canonical.id, duplicate.id, canonical.id],
      );
      const daily = await exec(
        `insert into daily_log_people_relations (daily_log_id, person_id, context, created_at)
         select distinct daily_log_id, ?, coalesce(context, 'migration-person-merge'), datetime('now')
         from daily_log_people_relations
         where person_id = ?
           and not exists (
             select 1 from daily_log_people_relations existing
             where existing.daily_log_id = daily_log_people_relations.daily_log_id and existing.person_id = ?
           )`,
        [canonical.id, duplicate.id, canonical.id],
      );
      movedRelations += (zettel.changes ?? 0) + (media.changes ?? 0) + (daily.changes ?? 0);
      await exec(`update interactions set person_id = ?, updated_at = datetime('now') where person_id = ? and user_id = ?`, [canonical.id, duplicate.id, userId]);
      await exec(`update gifts set person_id = ?, updated_at = datetime('now') where person_id = ? and user_id = ?`, [canonical.id, duplicate.id, userId]);
      await exec(`delete from zettel_people_relations where person_id = ?`, [duplicate.id]);
      await exec(`delete from media_people_relations where person_id = ?`, [duplicate.id]);
      await exec(`delete from daily_log_people_relations where person_id = ?`, [duplicate.id]);
      await exec(`delete from people_fts where person_id = ?`, [duplicate.id]);
      const hidden = await exec(`update people set deleted_at = coalesce(deleted_at, datetime('now')), status = 'merged', updated_at = datetime('now') where id = ? and user_id = ?`, [duplicate.id, userId]);
      hiddenPeople += hidden.changes ?? 0;
      await exec(
        `update source_documents
         set canonical_entity_id = ?, status = 'merged', document_role = 'merged-duplicate-person', updated_at = datetime('now')
         where user_id = ? and canonical_entity_type = 'person' and canonical_entity_id = ?`,
        [canonical.id, userId, duplicate.id],
      );
      await writeAudit(userId, "migration.person.merge_duplicate", "person", duplicate.id, { canonicalId: canonical.id, name: duplicate.name });
    }
  }

  return { duplicateGroups, hiddenPeople, movedRelations };
}

async function refineUntaggedZettels(userId: string, tagIds: Map<string, string>) {
  const rows = await queryD1<ZettelRow>(
    `select id, title, content, content_text as contentText, summary
     from zettels z
     where z.user_id = ?
       and z.deleted_at is null
       and z.import_batch_id is not null
       and not exists (select 1 from taggings tg where tg.taggable_type = 'zettel' and tg.taggable_id = z.id)
     order by z.updated_at desc`,
    [userId],
  );
  const selected = LIMIT ? rows.rows.slice(0, LIMIT) : rows.rows;
  let tagged = 0;
  let hidden = 0;
  let dailyMoved = 0;
  let mediaLinked = 0;
  let stillReview = 0;

  for (const row of selected) {
    const text = body(row);
    const date = extractDate(text);
    const media = (await queryD1<MediaMatchRow>(
      `select id, media_type as mediaType from media_logs where user_id = ? and deleted_at is null and lower(trim(title)) = lower(trim(?)) limit 1`,
      [userId, row.title],
    )).rows[0];

    if (media && isGeneratedMediaZettel(row)) {
      await tagEntity(tagIds, TAGS.media, "zettel", row.id);
      await tagEntity(tagIds, mediaTypeTag(media.mediaType), "zettel", row.id);
      const inserted = await exec(
        `insert into zettel_media_relations (zettel_id, media_id, created_at)
         select ?, ?, datetime('now')
         where not exists (select 1 from zettel_media_relations where zettel_id = ? and media_id = ?)`,
        [row.id, media.id, row.id, media.id],
      );
      mediaLinked += inserted.changes ?? 0;
      await softHideZettel(userId, row.id, "generated-media-source", "media", media.id);
      await writeAudit(userId, "migration.zettel.reclassify_to_media", "zettel", row.id, { title: row.title, mediaId: media.id });
      hidden += 1;
      tagged += 1;
      continue;
    }

    if (date && (isJournalLike(row) || isMeditationLike(row))) {
      const clean = stripMarkdownTitle(row.contentText ?? row.content ?? row.summary ?? "");
      const existingDaily = (await queryD1<{ id: string }>("select id from daily_logs where user_id = ? and date = ? and deleted_at is null limit 1", [userId, date])).rows[0];
      const dailyId = existingDaily?.id ?? hashId("daily", [userId, date]);
      if (!existingDaily) {
        await exec(
          `insert into daily_logs (id, user_id, date, journal, meditation, meditation_verse, created_at, updated_at)
           values (?, ?, ?, ?, ?, null, datetime('now'), datetime('now'))`,
          [dailyId, userId, date, isJournalLike(row) ? clean : null, isMeditationLike(row) ? clean : null],
        );
      } else if (isJournalLike(row)) {
        await exec(
          `update daily_logs
           set journal = case
             when journal is null or trim(journal) = '' then ?
             when instr(journal, ?) = 0 then journal || char(10) || char(10) || ?
             else journal
           end,
           updated_at = datetime('now')
           where id = ? and user_id = ?`,
          [clean, clean, clean, dailyId, userId],
        );
      } else {
        await exec(
          `update daily_logs
           set meditation = case
             when meditation is null or trim(meditation) = '' then ?
             when instr(meditation, ?) = 0 then meditation || char(10) || char(10) || ?
             else meditation
           end,
           updated_at = datetime('now')
           where id = ? and user_id = ?`,
          [clean, clean, clean, dailyId, userId],
        );
      }
      await tagEntity(tagIds, isMeditationLike(row) ? TAGS.meditation : TAGS.journal, "zettel", row.id);
      if (isMeditationLike(row)) await tagEntity(tagIds, TAGS.faith, "zettel", row.id);
      await softHideZettel(userId, row.id, isMeditationLike(row) ? "migrated-meditation-source" : "migrated-journal-source", "daily_log", dailyId);
      await writeAudit(userId, "migration.zettel.move_to_life_ops", "zettel", row.id, { title: row.title, date });
      hidden += 1;
      dailyMoved += 1;
      tagged += 1;
      continue;
    }

    if (isWorkArchiveLike(row)) {
      await tagEntity(tagIds, TAGS.archiveWork, "zettel", row.id);
      tagged += 1;
      continue;
    }
    if (isFaithLike(row)) {
      await tagEntity(tagIds, TAGS.faith, "zettel", row.id);
      if (isMeditationLike(row)) await tagEntity(tagIds, TAGS.meditation, "zettel", row.id);
      tagged += 1;
      continue;
    }
    if (isWritingLike(row)) {
      await tagEntity(tagIds, TAGS.writing, "zettel", row.id);
      tagged += 1;
      continue;
    }

    await tagEntity(tagIds, TAGS.needsReview, "zettel", row.id);
    stillReview += 1;
  }

  return { candidates: rows.rows.length, processed: selected.length, tagged, hidden, dailyMoved, mediaLinked, stillReview };
}

async function refreshReviewQueue(userId: string) {
  await exec(
    `update migration_review_items
     set status = 'applied', reason = 'Zettel received tags or was reclassified by second refinement pass.', resolved_at = datetime('now'), updated_at = datetime('now')
     where user_id = ?
       and issue_type = 'untagged-imported-zettel'
       and status = 'open'
       and deleted_at is null
       and entity_id in (
         select z.id
         from zettels z
         where z.user_id = ?
           and (
             z.deleted_at is not null
             or exists (select 1 from taggings tg where tg.taggable_type = 'zettel' and tg.taggable_id = z.id)
           )
       )`,
    [userId, userId],
  );
}

async function count(sql: string, params: unknown[] = []) {
  return Number((await queryD1<CountRow>(sql, params)).rows[0]?.value ?? 0);
}

async function main() {
  loadEnv();
  const user = (await queryD1<UserRow>("select id from users limit 1")).rows[0];
  if (!user) throw new Error("No user found.");

  const tagIds = new Map<string, string>();
  for (const tag of Object.values(TAGS)) tagIds.set(tag.slug, await ensureTag(user.id, tag));

  const before = {
    people: await count("select count(*) value from people where user_id = ? and deleted_at is null", [user.id]),
    untagged: await count(
      `select count(*) value from zettels z
       where z.user_id = ? and z.deleted_at is null and z.import_batch_id is not null
         and not exists (select 1 from taggings tg where tg.taggable_type = 'zettel' and tg.taggable_id = z.id)`,
      [user.id],
    ),
    reviewOpen: await count("select count(*) value from migration_review_items where user_id = ? and status = 'open' and deleted_at is null", [user.id]),
  };

  const personArtifacts = await refinePersonArtifacts(user.id);
  const duplicatePeople = await mergeDuplicatePeople(user.id);
  const zettels = await refineUntaggedZettels(user.id, tagIds);
  await refreshReviewQueue(user.id);
  await refreshTags(tagIds);

  const after = {
    people: await count("select count(*) value from people where user_id = ? and deleted_at is null", [user.id]),
    untagged: await count(
      `select count(*) value from zettels z
       where z.user_id = ? and z.deleted_at is null and z.import_batch_id is not null
         and not exists (select 1 from taggings tg where tg.taggable_type = 'zettel' and tg.taggable_id = z.id)`,
      [user.id],
    ),
    reviewOpen: await count("select count(*) value from migration_review_items where user_id = ? and status = 'open' and deleted_at is null", [user.id]),
  };

  console.log(JSON.stringify({ apply: APPLY, limit: LIMIT || null, before, personArtifacts, duplicatePeople, zettels, after }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
