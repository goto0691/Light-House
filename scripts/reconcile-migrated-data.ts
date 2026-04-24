import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Meta = { changes?: number };
type D1Result<T> = { meta?: D1Meta; results?: T[]; success?: boolean };
type D1Envelope<T> = { errors?: Array<{ message?: string }>; result?: Array<D1Result<T>>; success?: boolean };

type UserRow = { id: string };
type MediaRow = {
  id: string;
  title: string;
  mediaType: string;
  creator: string | null;
  studio: string | null;
  genre: string | null;
  status: string;
  rating: number | null;
  evaluation: string | null;
  review: string | null;
  content: string | null;
  completedAt: string | null;
  importBatchId: string | null;
  sourceDocumentId: string | null;
  propertyCount: number;
};
type WorkoutRow = {
  id: string;
  date: string;
  categories: string | null;
  durationMinutes: number | null;
  intensity: number | null;
  notes: string | null;
  importBatchId: string | null;
  sourceDocumentId: string | null;
};
type ZettelRow = {
  id: string;
  title: string;
  contentText: string | null;
  summary: string | null;
  importBatchId: string | null;
  sourceDocumentId: string | null;
  tagCount: number;
};
type PersonRow = { id: string; name: string; sourceDocumentId: string | null };
type DailyRow = { id: string; date: string; journal: string | null; gratitude: string | null; meditation: string | null };

const APPLY = process.argv.includes("--apply");
const MAX_REVIEW_ITEMS = Number(process.argv.find((arg) => arg.startsWith("--max-review-items="))?.split("=")[1] ?? 800);

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
    const message = payload.errors?.map((error) => error.message).join(" | ") || "D1 query failed.";
    throw new Error(`${message}\n${sql.slice(0, 240)}`);
  }
  return { rows: result?.results ?? [], meta: result?.meta ?? {} };
}

async function exec(sql: string, params: unknown[] = []) {
  return (await queryD1(sql, params)).meta;
}

function hashId(prefix: string, parts: Array<string | null | undefined>) {
  const hash = createHash("sha1").update(parts.map((part) => part ?? "").join("|")).digest("hex").slice(0, 32);
  return `${prefix}_${hash}`;
}

function normalizeTitle(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]{}'"“”‘’.,:;!?/\\|_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valueScore(value: unknown) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.trim() ? Math.min(6, Math.ceil(value.trim().length / 80)) : 0;
  return 1;
}

function mediaScore(row: MediaRow) {
  return (
    valueScore(row.creator) +
    valueScore(row.studio) +
    valueScore(row.genre) +
    valueScore(row.rating) +
    valueScore(row.evaluation) +
    valueScore(row.review) +
    valueScore(row.content) +
    valueScore(row.completedAt) +
    row.propertyCount +
    (row.importBatchId ? 2 : 0)
  );
}

function workoutScore(row: WorkoutRow) {
  return valueScore(row.durationMinutes) + valueScore(row.intensity) + valueScore(row.notes) + (row.importBatchId ? 2 : 0);
}

function grouped<T>(items: T[], keyFn: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].filter(([, list]) => list.length > 1);
}

async function upsertReviewItem(input: {
  userId: string;
  sourceDocumentId?: string | null;
  entityType: string;
  entityId?: string | null;
  issueType: string;
  suggestedAction: string;
  confidence: number;
  status?: "open" | "applied";
  reason: string;
  payload: unknown;
}) {
  if (!APPLY) return;
  const id = hashId("mri", [input.userId, input.entityType, input.entityId, input.issueType, input.suggestedAction]);
  await exec(
    `insert into migration_review_items
      (id, user_id, source_document_id, entity_type, entity_id, issue_type, suggested_action, confidence, status, reason, payload, resolved_at, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, case when ? = 'applied' then datetime('now') else null end, datetime('now'), datetime('now'))
     on conflict(id) do update set
       source_document_id = excluded.source_document_id,
       confidence = excluded.confidence,
       status = excluded.status,
       reason = excluded.reason,
       payload = excluded.payload,
       resolved_at = excluded.resolved_at,
       updated_at = datetime('now'),
       deleted_at = null`,
    [
      id,
      input.userId,
      input.sourceDocumentId ?? null,
      input.entityType,
      input.entityId ?? null,
      input.issueType,
      input.suggestedAction,
      input.confidence,
      input.status ?? "open",
      input.reason,
      JSON.stringify(input.payload),
      input.status ?? "open",
    ],
  );
}

async function writeAudit(userId: string, action: string, entityType: string, entityId: string, snapshot: unknown) {
  if (!APPLY) return;
  await exec(
    `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [randomUUID(), userId, action, entityType, entityId, JSON.stringify(snapshot)],
  );
}

async function mergeMediaDuplicate(userId: string, canonical: MediaRow, duplicate: MediaRow) {
  await exec(
    `insert or ignore into media_people_relations (media_id, person_id, context, created_at)
     select ?, person_id, 'migration-merge', datetime('now')
     from media_people_relations
     where media_id = ?`,
    [canonical.id, duplicate.id],
  );
  await exec(
    `insert or ignore into zettel_media_relations (zettel_id, media_id, created_at)
     select zettel_id, ?, datetime('now')
     from zettel_media_relations
     where media_id = ?`,
    [canonical.id, duplicate.id],
  );
  await exec(
    `update media_logs
     set
       creator = coalesce(nullif(creator, ''), ?),
       studio = coalesce(nullif(studio, ''), ?),
       genre = coalesce(nullif(genre, ''), ?),
       evaluation = coalesce(nullif(evaluation, ''), ?),
       review = coalesce(nullif(review, ''), ?),
       content = coalesce(nullif(content, ''), ?),
       completed_at = coalesce(completed_at, ?),
       updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [duplicate.creator, duplicate.studio, duplicate.genre, duplicate.evaluation, duplicate.review, duplicate.content, duplicate.completedAt, canonical.id, userId],
  );
  await exec(`update media_logs set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [duplicate.id, userId]);
  await exec(
    `update source_documents
     set canonical_entity_id = ?, document_role = coalesce(document_role, 'merged-duplicate'), status = 'merged', updated_at = datetime('now')
     where canonical_entity_type = 'media' and canonical_entity_id = ? and user_id = ?`,
    [canonical.id, duplicate.id, userId],
  );
  await writeAudit(userId, "migration.media.merge_duplicate", "media", duplicate.id, { canonicalId: canonical.id, duplicateTitle: duplicate.title });
}

async function mergeWorkoutDuplicate(userId: string, canonical: WorkoutRow, duplicate: WorkoutRow) {
  await exec(
    `update workouts
     set
       duration_minutes = coalesce(duration_minutes, ?),
       intensity = coalesce(intensity, ?),
       notes = coalesce(nullif(notes, ''), ?),
       updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [duplicate.durationMinutes, duplicate.intensity, duplicate.notes, canonical.id, userId],
  );
  await exec(`update workouts set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [duplicate.id, userId]);
  await exec(
    `update source_documents
     set canonical_entity_id = ?, document_role = coalesce(document_role, 'merged-duplicate'), status = 'merged', updated_at = datetime('now')
     where canonical_entity_type = 'workout' and canonical_entity_id = ? and user_id = ?`,
    [canonical.id, duplicate.id, userId],
  );
  await writeAudit(userId, "migration.workout.merge_duplicate", "workout", duplicate.id, { canonicalId: canonical.id, date: duplicate.date });
}

async function rebuildSourceRelations() {
  if (!APPLY) return { inserted: 0 };
  await exec("delete from source_document_relations");
  const statements = [
    `insert into source_document_relations (id, source_document_id, relation_name, resolved_entity_type, resolved_entity_id, confidence, created_at)
     select lower(hex(randomblob(16))), sd.id, 'canonical:person', 'person', zpr.person_id, 1.0, datetime('now')
     from zettel_people_relations zpr
     inner join source_documents sd on sd.canonical_entity_type = 'zettel' and sd.canonical_entity_id = zpr.zettel_id`,
    `insert into source_document_relations (id, source_document_id, relation_name, resolved_entity_type, resolved_entity_id, confidence, created_at)
     select lower(hex(randomblob(16))), sd.id, 'canonical:person', 'person', mpr.person_id, 1.0, datetime('now')
     from media_people_relations mpr
     inner join source_documents sd on sd.canonical_entity_type = 'media' and sd.canonical_entity_id = mpr.media_id`,
    `insert into source_document_relations (id, source_document_id, relation_name, resolved_entity_type, resolved_entity_id, confidence, created_at)
     select lower(hex(randomblob(16))), sd.id, 'canonical:media', 'media', zmr.media_id, 1.0, datetime('now')
     from zettel_media_relations zmr
     inner join source_documents sd on sd.canonical_entity_type = 'zettel' and sd.canonical_entity_id = zmr.zettel_id`,
    `insert into source_document_relations (id, source_document_id, relation_name, resolved_entity_type, resolved_entity_id, confidence, created_at)
     select lower(hex(randomblob(16))), sd.id, 'canonical:person', 'person', dlpr.person_id, 1.0, datetime('now')
     from daily_log_people_relations dlpr
     inner join source_documents sd on sd.canonical_entity_type = 'daily_log' and sd.canonical_entity_id = dlpr.daily_log_id`,
  ];
  let inserted = 0;
  for (const statement of statements) inserted += Number((await exec(statement)).changes ?? 0);
  return { inserted };
}

async function main() {
  loadEnv();
  const user = (await queryD1<UserRow>("select id from users limit 1")).rows[0];
  if (!user) throw new Error("No user found.");

  const summary = {
    apply: APPLY,
    mediaDuplicateGroups: 0,
    mediaDuplicatesMerged: 0,
    workoutDuplicateGroups: 0,
    workoutDuplicatesMerged: 0,
    zettelMediaRelationsInserted: 0,
    dailyPeopleRelationsInserted: 0,
    reviewItemsSeeded: 0,
    sourceRelationsInserted: 0,
  };

  const media = (await queryD1<MediaRow>(
    `select
       m.id, m.title, m.media_type as mediaType, m.creator, m.studio, m.genre, m.status, m.rating,
       m.evaluation, m.review, m.content, m.completed_at as completedAt, m.import_batch_id as importBatchId,
       sd.id as sourceDocumentId,
       coalesce((select count(*) from source_document_properties sdp where sdp.source_document_id = sd.id), 0) as propertyCount
     from media_logs m
     left join source_documents sd on sd.canonical_entity_type = 'media' and sd.canonical_entity_id = m.id and sd.user_id = m.user_id
     where m.user_id = ? and m.deleted_at is null`,
    [user.id],
  )).rows;

  for (const [, group] of grouped(media, (item) => `${item.mediaType}:${normalizeTitle(item.title)}`).filter(([key]) => key.split(":")[1].length >= 2)) {
    summary.mediaDuplicateGroups += 1;
    const sorted = [...group].sort((a, b) => mediaScore(b) - mediaScore(a) || a.id.localeCompare(b.id));
    const canonical = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      await upsertReviewItem({
        userId: user.id,
        sourceDocumentId: duplicate.sourceDocumentId,
        entityType: "media",
        entityId: duplicate.id,
        issueType: "duplicate-media",
        suggestedAction: "merge-into-canonical",
        confidence: 0.96,
        status: APPLY ? "applied" : "open",
        reason: `Same normalized title and media type as ${canonical.id}.`,
        payload: { canonicalId: canonical.id, duplicateId: duplicate.id, title: duplicate.title, mediaType: duplicate.mediaType },
      });
      summary.reviewItemsSeeded += 1;
      if (APPLY) {
        await mergeMediaDuplicate(user.id, canonical, duplicate);
        summary.mediaDuplicatesMerged += 1;
      }
    }
  }

  const workouts = (await queryD1<WorkoutRow>(
    `select w.id, w.date, w.categories, w.duration_minutes as durationMinutes, w.intensity, w.notes, w.import_batch_id as importBatchId, sd.id as sourceDocumentId
     from workouts w
     left join source_documents sd on sd.canonical_entity_type = 'workout' and sd.canonical_entity_id = w.id and sd.user_id = w.user_id
     where w.user_id = ? and w.deleted_at is null`,
    [user.id],
  )).rows;
  for (const [, group] of grouped(workouts, (item) => `${item.date}:${normalizeTitle(item.categories)}:${normalizeTitle(item.notes)}`)) {
    summary.workoutDuplicateGroups += 1;
    const sorted = [...group].sort((a, b) => workoutScore(b) - workoutScore(a) || a.id.localeCompare(b.id));
    const canonical = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      await upsertReviewItem({
        userId: user.id,
        sourceDocumentId: duplicate.sourceDocumentId,
        entityType: "workout",
        entityId: duplicate.id,
        issueType: "duplicate-workout",
        suggestedAction: "merge-into-canonical",
        confidence: 0.98,
        status: APPLY ? "applied" : "open",
        reason: `Same date, categories, and notes as ${canonical.id}.`,
        payload: { canonicalId: canonical.id, duplicateId: duplicate.id, date: duplicate.date },
      });
      summary.reviewItemsSeeded += 1;
      if (APPLY) {
        await mergeWorkoutDuplicate(user.id, canonical, duplicate);
        summary.workoutDuplicatesMerged += 1;
      }
    }
  }

  const zettels = (await queryD1<ZettelRow>(
    `select
       z.id, z.title, z.content_text as contentText, z.summary, z.import_batch_id as importBatchId,
       sd.id as sourceDocumentId,
       coalesce((select count(*) from taggings tg where tg.taggable_type = 'zettel' and tg.taggable_id = z.id), 0) as tagCount
     from zettels z
     left join source_documents sd on sd.canonical_entity_type = 'zettel' and sd.canonical_entity_id = z.id and sd.user_id = z.user_id
     where z.user_id = ? and z.deleted_at is null`,
    [user.id],
  )).rows;

  const activeMedia = APPLY
    ? (await queryD1<MediaRow>(
        `select id, title, media_type as mediaType, creator, studio, genre, status, rating, evaluation, review, content, completed_at as completedAt, import_batch_id as importBatchId, null as sourceDocumentId, 0 as propertyCount
         from media_logs where user_id = ? and deleted_at is null`,
        [user.id],
      )).rows
    : media;
  const mediaByTitle = new Map<string, MediaRow[]>();
  for (const item of activeMedia) {
    const key = normalizeTitle(item.title);
    if (!key) continue;
    const list = mediaByTitle.get(key) ?? [];
    list.push(item);
    mediaByTitle.set(key, list);
  }
  for (const zettel of zettels) {
    const mediaMatches = mediaByTitle.get(normalizeTitle(zettel.title)) ?? [];
    if (mediaMatches.length !== 1) continue;
    if (APPLY) {
      const changes = await exec(
        `insert or ignore into zettel_media_relations (zettel_id, media_id, created_at)
         values (?, ?, datetime('now'))`,
        [zettel.id, mediaMatches[0].id],
      );
      summary.zettelMediaRelationsInserted += Number(changes.changes ?? 0);
    } else {
      summary.zettelMediaRelationsInserted += 1;
    }
  }

  const people = (await queryD1<PersonRow>(
    `select p.id, p.name, sd.id as sourceDocumentId
     from people p
     left join source_documents sd on sd.canonical_entity_type = 'person' and sd.canonical_entity_id = p.id and sd.user_id = p.user_id
     where p.user_id = ? and p.deleted_at is null`,
    [user.id],
  )).rows;
  const dailyRows = (await queryD1<DailyRow>(
    `select id, date, journal, gratitude, meditation from daily_logs where user_id = ? and deleted_at is null`,
    [user.id],
  )).rows;
  const usablePeople = people.filter((person) => person.name.trim().length >= 2 && person.name.trim().length <= 30 && !/[{}[\]|]/.test(person.name));
  for (const daily of dailyRows) {
    const corpus = `${daily.journal ?? ""}\n${daily.gratitude ?? ""}\n${daily.meditation ?? ""}`;
    if (!corpus.trim()) continue;
    for (const person of usablePeople) {
      if (!corpus.includes(person.name)) continue;
      if (APPLY) {
        const changes = await exec(
          `insert or ignore into daily_log_people_relations (daily_log_id, person_id, context, created_at)
           values (?, ?, 'migration-content-mention', datetime('now'))`,
          [daily.id, person.id],
        );
        summary.dailyPeopleRelationsInserted += Number(changes.changes ?? 0);
      } else {
        summary.dailyPeopleRelationsInserted += 1;
      }
    }
  }

  let reviewBudget = MAX_REVIEW_ITEMS;
  for (const zettel of zettels.filter((item) => item.importBatchId && item.tagCount === 0).slice(0, reviewBudget)) {
    await upsertReviewItem({
      userId: user.id,
      sourceDocumentId: zettel.sourceDocumentId,
      entityType: "zettel",
      entityId: zettel.id,
      issueType: "untagged-imported-zettel",
      suggestedAction: "classify-or-archive",
      confidence: 0.72,
      reason: "Imported zettel has no tags after the first reclassification pass.",
      payload: { title: zettel.title, summary: zettel.summary },
    });
    summary.reviewItemsSeeded += 1;
    reviewBudget -= 1;
  }

  const mediaTitleSet = new Set(activeMedia.map((item) => normalizeTitle(item.title)).filter(Boolean));
  for (const person of people.filter((item) => mediaTitleSet.has(normalizeTitle(item.name))).slice(0, Math.max(0, reviewBudget))) {
    await upsertReviewItem({
      userId: user.id,
      sourceDocumentId: person.sourceDocumentId,
      entityType: "person",
      entityId: person.id,
      issueType: "possible-person-artifact",
      suggestedAction: "review-person-or-convert-to-reference",
      confidence: 0.74,
      reason: "Person name matches a media title, which often indicates a migrated relation artifact.",
      payload: { name: person.name },
    });
    summary.reviewItemsSeeded += 1;
    reviewBudget -= 1;
  }

  const relationSummary = await rebuildSourceRelations();
  summary.sourceRelationsInserted = relationSummary.inserted;

  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
