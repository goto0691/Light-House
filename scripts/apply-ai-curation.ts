import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: { changes?: number }; results?: T[]; success?: boolean }>;
  success?: boolean;
};

type ReviewRow = {
  id: string;
  userId: string;
  sourceDocumentId: string | null;
  entityType: string;
  entityId: string | null;
  issueType: string;
  suggestedAction: string;
  confidence: number | null;
  payload: string | null;
};

type ZettelRow = {
  id: string;
  userId: string;
  title: string;
  slug: string;
  content: string | null;
  contentText: string | null;
  summary: string | null;
  type: string;
  category: string | null;
};

type PersonRow = {
  id: string;
  name: string;
};

type AiPayload = {
  original?: {
    entityType?: string;
    entityId?: string;
    sourceDocumentId?: string | null;
    title?: string;
    currentTags?: string | null;
    body?: string | null;
    preview?: string | null;
    rawProperties?: string | null;
  };
  ai?: {
    classification?: string;
    confidence?: number;
    tags?: string[];
    targetEntityType?: string;
    shouldHideOriginal?: boolean;
    shouldDeleteOriginal?: boolean;
    extracted?: {
      title?: string;
      date?: string;
      summary?: string;
      mediaType?: "game" | "screen" | "book" | "other";
      journal?: string;
      meditation?: string;
      meditationVerse?: string;
      workoutCategories?: string[];
      peopleMentions?: string[];
    };
    reason?: string;
  };
  error?: string;
  rawOutput?: string;
  appliedAction?: string;
};

const apply = process.argv.includes("--apply");
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 100);
const minConfidence = Number(process.argv.find((arg) => arg.startsWith("--min-confidence="))?.split("=")[1] ?? 0.9);

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
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function hashId(prefix: string, parts: Array<string | null | undefined>) {
  return `${prefix}_${createHash("sha1").update(parts.map((part) => part ?? "").join("|")).digest("hex").slice(0, 32)}`;
}

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeText(value: string | null | undefined) {
  return compact(value).replace(/\s+/g, " ");
}

function slugifyTag(value: string | null | undefined) {
  return compact(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function unique<T>(items: T[]) {
  return [...new Set(items.filter(Boolean))];
}

function parsePayload(row: ReviewRow): AiPayload {
  if (!row.payload) return {};
  return JSON.parse(row.payload) as AiPayload;
}

function originalBody(payload: AiPayload, zettel: ZettelRow | null) {
  return compact(payload.original?.body) || compact(payload.original?.preview) || compact(zettel?.contentText) || compact(zettel?.content) || compact(zettel?.summary);
}

function stripMarkdownTitle(body: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^\\s*#\\s+${escaped}\\s*\\n+`, "i"), "").trim();
}

function extractDate(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = compact(value).normalize("NFKC");
    if (!text) continue;
    const match = text.match(/(\d{4})[-./_년\s]+(\d{1,2})[-./_월\s]+(\d{1,2})/);
    if (!match) continue;
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return undefined;
}

function extractLabeledValue(text: string, labels: string[]) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${escaped})\\s*[:：]\\s*([^\\n]+)`, "i");
  return compact(text.match(pattern)?.[1]);
}

function parseNumber(value: string | null | undefined) {
  const match = compact(value).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeMediaType(value: string | null | undefined, text: string) {
  const normalized = compact(value).toLowerCase();
  if (normalized === "game" || /개발사|플랫폼|플레이\s*타임|게임/i.test(text)) return "game";
  if (normalized === "book" || /저자|출판사|도서|책|웹소설|소설/i.test(text)) return "book";
  if (normalized === "screen" || /감독|제작사|시청|영화|드라마|애니/i.test(text)) return "screen";
  return "other";
}

function normalizeMediaStatus(value: string | null | undefined) {
  const text = compact(value).toLowerCase();
  if (!text) return "backlog";
  if (/완료|클리어|완결|finished|complete|done/.test(text)) return "completed";
  if (/진행|보는\s*중|읽는\s*중|playing|watching|reading|active/.test(text)) return "active";
  if (/중단|보류|drop|pause|hold/.test(text)) return "paused";
  if (/예정|보고싶|읽고싶|backlog|wishlist/.test(text)) return "backlog";
  return text.slice(0, 32);
}

function isMediaCollection(payload: AiPayload, title: string, body: string) {
  const tags = (payload.ai?.tags ?? []).map((tag) => slugifyTag(tag));
  if (tags.includes("media-list") || tags.includes("reading-list") || tags.includes("collection")) return true;
  if (/^(회귀물|현대|완결|웹툰|웹소설|소설|읽을\s*것|볼\s*것)$/i.test(title.trim())) return true;
  const detailSignals = [/개발사\s*[:：]/, /감독(?:\/크리에이터)?\s*[:：]/, /제작사\s*[:：]/, /플랫폼\s*[:：]/, /플레이\s*타임\s*[:：]/, /상태\s*[:：]/, /장르\s*[:：]/, /저자\s*[:：]/, /출판사\s*[:：]/].filter((pattern) =>
    pattern.test(body),
  ).length;
  const listSignals = body.split(/\n/).filter((line) => /^[-*]\s+|^\d+[.)]\s+|^\[\[/.test(line.trim())).length;
  return detailSignals < 2 && listSignals >= 5;
}

function parseTags(payload: AiPayload, fallback: string[] = []) {
  return unique([...fallback, ...(payload.ai?.tags ?? [])].map(slugifyTag).filter((tag) => tag && tag !== "needs-review"));
}

function d1Endpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const response = await fetch(d1Endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? requiredEnv("DATABASE_AUTH_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const payload = (await response.json()) as D1Envelope<T>;
  const result = payload.result?.[0];
  if (!response.ok || payload.success === false || result?.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 query failed.");
  }
  return { rows: result?.results ?? [], meta: result?.meta ?? {} };
}

async function exec(sql: string, params: unknown[] = []) {
  if (!apply) return { changes: 0 };
  return (await queryD1(sql, params)).meta;
}

async function ensureTag(userId: string, slug: string, name: string) {
  const found = await queryD1<{ id: string }>("select id from tags where user_id = ? and slug = ? and deleted_at is null limit 1", [userId, slug]);
  if (found.rows[0]) return found.rows[0].id;
  const id = hashId("tag", [userId, slug]);
  await exec(
    `insert into tags (id, user_id, name, slug, usage_count, created_at, updated_at)
     values (?, ?, ?, ?, 0, datetime('now'), datetime('now'))
     on conflict(id) do update set deleted_at = null, name = excluded.name, slug = excluded.slug, updated_at = datetime('now')`,
    [id, userId, name, slug],
  );
  return id;
}

async function tagEntity(userId: string, entityType: string, entityId: string, slug: string, name: string) {
  const tagId = await ensureTag(userId, slug, name);
  await exec(
    `insert into taggings (id, tag_id, taggable_type, taggable_id, created_at)
     select ?, ?, ?, ?, datetime('now')
     where not exists (
       select 1 from taggings where tag_id = ? and taggable_type = ? and taggable_id = ?
     )`,
    [hashId("tg", [tagId, entityType, entityId]), tagId, entityType, entityId, tagId, entityType, entityId],
  );
  await exec(
    `update tags
     set usage_count = (select count(*) from taggings where tag_id = ?), updated_at = datetime('now')
     where id = ?`,
    [tagId, tagId],
  );
}

async function removeTag(userId: string, entityType: string, entityId: string, slug: string) {
  const tag = await queryD1<{ id: string }>("select id from tags where user_id = ? and slug = ? and deleted_at is null limit 1", [userId, slug]);
  const tagId = tag.rows[0]?.id;
  if (!tagId) return;
  await exec(`delete from taggings where tag_id = ? and taggable_type = ? and taggable_id = ?`, [tagId, entityType, entityId]);
  await exec(
    `update tags
     set usage_count = (select count(*) from taggings where tag_id = ?), updated_at = datetime('now')
     where id = ?`,
    [tagId, tagId],
  );
}

async function getZettel(userId: string, id: string) {
  const row = await queryD1<ZettelRow>(
    `select
       id,
       user_id as userId,
       title,
       slug,
       content,
       content_text as contentText,
       summary,
       type,
       category
     from zettels
     where user_id = ? and id = ?
     limit 1`,
    [userId, id],
  );
  return row.rows[0] ?? null;
}

async function updateSourceDocument(row: ReviewRow, entityType: string, entityId: string, status = "reclassified") {
  if (!row.sourceDocumentId) return;
  await exec(
    `update source_documents
     set canonical_entity_type = ?,
         canonical_entity_id = ?,
         status = ?,
         resolved_at = coalesce(resolved_at, datetime('now')),
         updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [entityType, entityId, status, row.sourceDocumentId, row.userId],
  );
}

async function softHideZettel(row: ReviewRow, reason: string) {
  if (!row.entityId) return;
  await exec(`update zettels set deleted_at = coalesce(deleted_at, datetime('now')), updated_at = datetime('now') where id = ? and user_id = ?`, [row.entityId, row.userId]);
  await exec(`delete from zettels_fts where zettel_id = ?`, [row.entityId]);
  await writeAudit(row, "migration.ai_curate.soft_hide_zettel", { reviewId: row.id, reason });
}

async function clearReviewTag(row: ReviewRow) {
  if (!row.entityId) return;
  await removeTag(row.userId, row.entityType, row.entityId, "needs-review");
}

async function markApplied(row: ReviewRow, snapshot: unknown) {
  await exec(
    `update migration_review_items
     set status = 'applied',
         payload = ?,
         resolved_at = datetime('now'),
         updated_at = datetime('now')
     where id = ?`,
    [JSON.stringify(snapshot), row.id],
  );
}

async function writeAudit(row: ReviewRow, action: string, snapshot: unknown) {
  await exec(
    `insert into audit_logs (id, user_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [randomUUID(), row.userId, action, row.entityType, row.entityId ?? row.id, JSON.stringify(snapshot)],
  );
}

async function applyKeepVault(row: ReviewRow, payload: AiPayload) {
  if (row.entityType !== "zettel" || !row.entityId) return { action: "skip", reason: "keep_vault only supports zettel" };
  for (const tag of parseTags(payload, ["vault"])) {
    await tagEntity(row.userId, "zettel", row.entityId, tag, tag);
  }
  await clearReviewTag(row);
  await updateSourceDocument(row, "zettel", row.entityId, "active");
  await markApplied(row, { ...payload, appliedAction: "kept in vault and tagged" });
  await writeAudit(row, "migration.ai_curate.keep_vault", { reviewId: row.id, confidence: row.confidence });
  return { action: "keep_vault" };
}

async function upsertMediaFromZettel(row: ReviewRow, payload: AiPayload, zettel: ZettelRow, body: string) {
  const extracted = payload.ai?.extracted ?? {};
  const title = compact(extracted.title) || zettel.title;
  const mediaType = normalizeMediaType(extracted.mediaType, body);
  const existing = await queryD1<{ id: string }>(
    `select id
     from media_logs
     where user_id = ?
       and lower(title) = lower(?)
       and media_type = ?
       and deleted_at is null
     limit 1`,
    [row.userId, title, mediaType],
  );
  const mediaId = existing.rows[0]?.id ?? randomUUID();
  const developer = extractLabeledValue(body, ["개발사", "developer"]);
  const director = extractLabeledValue(body, ["감독/크리에이터", "감독", "creator", "director"]);
  const studio = extractLabeledValue(body, ["제작사", "studio"]);
  const platform = extractLabeledValue(body, ["플랫폼", "출판사", "publisher", "platform"]);
  const genre = extractLabeledValue(body, ["장르", "genre"]);
  const status = normalizeMediaStatus(extractLabeledValue(body, ["상태", "시청상태", "status"]));
  const playTime = parseNumber(extractLabeledValue(body, ["플레이 타임", "play time", "playtime"]));
  const rating = parseNumber(extractLabeledValue(body, ["평점", "rating"]));
  const oneLine = extractLabeledValue(body, ["한줄평", "평가", "evaluation"]);
  const review = stripMarkdownTitle(body, zettel.title);
  const creator = mediaType === "game" ? developer || director : director || developer;

  if (existing.rows[0]) {
    await exec(
      `update media_logs
       set platform_or_publisher = coalesce(nullif(platform_or_publisher, ''), ?),
           creator = coalesce(nullif(creator, ''), ?),
           studio = coalesce(nullif(studio, ''), ?),
           genre = coalesce(nullif(genre, ''), ?),
           status = case when status = 'backlog' and ? <> 'backlog' then ? else status end,
           rating = coalesce(rating, ?),
           evaluation = coalesce(nullif(evaluation, ''), ?),
           review = case when review is null or trim(review) = '' then ? else review end,
           content = case when content is null or trim(content) = '' then ? else content end,
           play_time = coalesce(play_time, ?),
           updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [platform || null, creator || null, studio || null, genre || null, status, status, rating, oneLine || null, review || null, body || null, playTime, mediaId, row.userId],
    );
  } else {
    await exec(
      `insert into media_logs
        (id, user_id, media_type, title, original_title, platform_or_publisher, creator, studio, genre, release_year, status, rating, evaluation, review, content, play_time, author, pages, screen_kind, rewatch_value, cover_image_url, started_at, completed_at, created_at, updated_at, deleted_at)
       values (?, ?, ?, ?, null, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, null, null, null, 0, null, null, null, datetime('now'), datetime('now'), null)`,
      [mediaId, row.userId, mediaType, title, platform || null, creator || null, studio || null, genre || null, status, rating, oneLine || null, review || null, body || null, playTime],
    );
  }

  await exec(
    `insert into zettel_media_relations (zettel_id, media_id, created_at)
     select ?, ?, datetime('now')
     where not exists (select 1 from zettel_media_relations where zettel_id = ? and media_id = ?)`,
    [zettel.id, mediaId, zettel.id, mediaId],
  );
  for (const tag of parseTags(payload, ["media", mediaType])) {
    await tagEntity(row.userId, "media", mediaId, tag, tag);
  }
  await updateSourceDocument(row, "media", mediaId);
  await softHideZettel(row, `moved to media ${mediaId}`);
  await markApplied(row, { ...payload, appliedAction: "moved to media", mediaId });
  await writeAudit(row, "migration.ai_curate.move_to_media", { reviewId: row.id, mediaId, confidence: row.confidence });
  return { action: "move_to_media", mediaId };
}

async function applyMoveToMedia(row: ReviewRow, payload: AiPayload) {
  if (row.entityType !== "zettel" || !row.entityId) return { action: "skip", reason: "move_to_media only supports zettel" };
  const zettel = await getZettel(row.userId, row.entityId);
  if (!zettel) return { action: "skip", reason: "zettel not found" };
  const body = originalBody(payload, zettel);
  if (isMediaCollection(payload, zettel.title, body)) {
    for (const tag of parseTags(payload, ["vault", "media-list"])) {
      await tagEntity(row.userId, "zettel", row.entityId, tag, tag);
    }
    await clearReviewTag(row);
    await updateSourceDocument(row, "zettel", row.entityId, "active");
    await markApplied(row, { ...payload, appliedAction: "kept as media-list zettel" });
    await writeAudit(row, "migration.ai_curate.keep_media_list", { reviewId: row.id, confidence: row.confidence });
    return { action: "keep_media_list" };
  }
  return upsertMediaFromZettel(row, payload, zettel, body);
}

async function linkDailyPeople(row: ReviewRow, dailyLogId: string, peopleMentions: string[]) {
  if (!peopleMentions.length) return;
  const people = await queryD1<PersonRow>("select id, name from people where user_id = ? and deleted_at is null", [row.userId]);
  const byName = new Map(people.rows.map((person) => [person.name.normalize("NFKC").toLowerCase(), person]));
  for (const name of peopleMentions) {
    const person = byName.get(compact(name).normalize("NFKC").toLowerCase());
    if (!person) continue;
    await exec(
      `insert into daily_log_people_relations (daily_log_id, person_id, context, created_at)
       select ?, ?, 'ai_migration_mention', datetime('now')
       where not exists (
         select 1 from daily_log_people_relations where daily_log_id = ? and person_id = ?
       )`,
      [dailyLogId, person.id, dailyLogId, person.id],
    );
  }
}

async function applyMoveToLifeOps(row: ReviewRow, payload: AiPayload) {
  if (row.entityType !== "zettel" || !row.entityId) return { action: "skip", reason: "move_to_life_ops only supports zettel" };
  const zettel = await getZettel(row.userId, row.entityId);
  if (!zettel) return { action: "skip", reason: "zettel not found" };
  const extracted = payload.ai?.extracted ?? {};
  const body = originalBody(payload, zettel);
  const date = extractDate(extracted.date, body, zettel.title);
  if (!date) {
    for (const tag of parseTags(payload, ["vault", "journal-undated", "reflection"])) {
      await tagEntity(row.userId, "zettel", row.entityId, tag, tag);
    }
    await clearReviewTag(row);
    await updateSourceDocument(row, "zettel", row.entityId, "active");
    await markApplied(row, { ...payload, appliedAction: "kept as undated life note in vault" });
    await writeAudit(row, "migration.ai_curate.keep_undated_life_note", { reviewId: row.id, confidence: row.confidence });
    return { action: "keep_undated_life_note" };
  }

  const rawJournal = stripMarkdownTitle(body, zettel.title);
  const journal = compact(rawJournal) || compact(extracted.journal) || compact(extracted.summary);
  const meditation = compact(extracted.meditation);
  const meditationVerse = compact(extracted.meditationVerse);
  const existing = await queryD1<{ id: string; journal: string | null; meditation: string | null; meditationVerse: string | null }>(
    `select id, journal, meditation, meditation_verse as meditationVerse
     from daily_logs
     where user_id = ? and date = ? and deleted_at is null
     limit 1`,
    [row.userId, date],
  );
  const dailyLogId = existing.rows[0]?.id ?? randomUUID();
  if (existing.rows[0]) {
    await exec(
      `update daily_logs
       set journal = case
             when ? is null or trim(?) = '' then journal
             when journal is null or trim(journal) = '' then ?
             when instr(journal, ?) = 0 then journal || char(10) || char(10) || ?
             else journal
           end,
           meditation = case when (meditation is null or trim(meditation) = '') and ? is not null and trim(?) <> '' then ? else meditation end,
           meditation_verse = case when (meditation_verse is null or trim(meditation_verse) = '') and ? is not null and trim(?) <> '' then ? else meditation_verse end,
           updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [journal || null, journal || "", journal || null, journal || "", journal ? `---\n${journal}` : null, meditation || null, meditation || "", meditation || null, meditationVerse || null, meditationVerse || "", meditationVerse || null, dailyLogId, row.userId],
    );
  } else {
    await exec(
      `insert into daily_logs
        (id, user_id, notion_source_id, import_batch_id, date, mood, energy_level, emotions, gratitude, journal, meditation, meditation_verse, ai_summary, created_at, updated_at, deleted_at)
       values (?, ?, null, null, ?, null, null, null, null, ?, ?, ?, ?, datetime('now'), datetime('now'), null)`,
      [dailyLogId, row.userId, date, journal || null, meditation || null, meditationVerse || null, compact(extracted.summary) || null],
    );
  }
  for (const tag of parseTags(payload, ["journal", meditation || meditationVerse ? "meditation" : ""])) {
    await tagEntity(row.userId, "daily_log", dailyLogId, tag, tag);
  }
  await linkDailyPeople(row, dailyLogId, extracted.peopleMentions ?? []);
  await updateSourceDocument(row, "daily_log", dailyLogId);
  await softHideZettel(row, `moved to daily_log ${dailyLogId}`);
  await markApplied(row, { ...payload, appliedAction: "moved to life ops", dailyLogId });
  await writeAudit(row, "migration.ai_curate.move_to_life_ops", { reviewId: row.id, dailyLogId, confidence: row.confidence });
  return { action: "move_to_life_ops", dailyLogId };
}

function inferParseErrorIssue(payload: AiPayload) {
  const text = [payload.original?.title, payload.original?.currentTags, payload.original?.body, payload.original?.preview, payload.error].map(compact).join("\n");
  if (/archive_work|archive-work|외출자|외출목적|간병인|국군수도병원|장애등급|병원|환자|LH공사/i.test(text)) return "ai:archive_work";
  if (/move_to_media|개발사\s*[:：]|플랫폼\s*[:：]|플레이\s*타임\s*[:：]|컨텐츠\s*로그|콘텐츠\s*로그|장르\s*[:：]/i.test(text)) return "ai:move_to_media";
  if (/keep_vault|keep_prm|person-analysis|personality-analysis|성격분석|성격\s*분석|인물 분석|기프트 로그|대응 프로토콜|기본 프로필/i.test(text)) return "ai:keep_vault";
  if (/move_to_life_ops|생일|다툼|관계|일기|묵상|journal|diary|reflection/i.test(text)) return "ai:move_to_life_ops";
  return "ai:needs_manual_review";
}

async function applyParseError(row: ReviewRow, payload: AiPayload) {
  const inferred = inferParseErrorIssue(payload);
  const inferredPayload: AiPayload = {
    ...payload,
    ai: {
      ...(payload.ai ?? {}),
      classification: inferred.replace(/^ai:/, ""),
      tags: parseTags(payload, inferred === "ai:archive_work" ? ["archive-work"] : inferred === "ai:move_to_media" ? ["media"] : ["vault"]),
      extracted: { ...(payload.ai?.extracted ?? {}), title: payload.ai?.extracted?.title ?? payload.original?.title },
    },
  };
  const inferredRow = { ...row, issueType: inferred, confidence: inferred === "ai:needs_manual_review" ? row.confidence : Math.max(row.confidence ?? 0, 0.91) };
  if (inferred === "ai:archive_work") return applyReview(inferredRow, inferredPayload);
  if (inferred === "ai:move_to_media") return applyMoveToMedia(inferredRow, inferredPayload);
  if (inferred === "ai:move_to_life_ops") return applyMoveToLifeOps(inferredRow, inferredPayload);
  if (inferred === "ai:keep_vault") return applyKeepVault(inferredRow, inferredPayload);
  return { action: "skip", reason: "parse_error still needs manual review" };
}

function isEmptyImportedZettel(title: string, body: string) {
  const normalized = normalizeText(body.replace(/^#\s+/gm, ""));
  return !normalized || normalized === title || normalized === "제목 없음";
}

async function applyNeedsManualReview(row: ReviewRow, payload: AiPayload) {
  if (row.entityType !== "zettel" || !row.entityId) return { action: "skip", reason: "manual review only supports zettel" };
  const zettel = await getZettel(row.userId, row.entityId);
  if (!zettel) return { action: "skip", reason: "zettel not found" };
  const body = originalBody(payload, zettel);
  if (isEmptyImportedZettel(zettel.title, body)) {
    await tagEntity(row.userId, "zettel", row.entityId, "empty-import", "empty-import");
    await softHideZettel(row, "empty imported placeholder");
    await updateSourceDocument(row, "zettel", row.entityId, "archived_empty");
    await markApplied(row, { ...payload, appliedAction: "soft-hidden empty imported zettel" });
    await writeAudit(row, "migration.ai_curate.hide_empty_import", { reviewId: row.id, confidence: row.confidence });
    return { action: "hide_empty_import" };
  }
  for (const tag of parseTags(payload, ["vault", "manual-review-kept"])) {
    await tagEntity(row.userId, "zettel", row.entityId, tag, tag);
  }
  await clearReviewTag(row);
  await updateSourceDocument(row, "zettel", row.entityId, "active");
  await markApplied(row, { ...payload, appliedAction: "kept non-empty manual review item in vault" });
  await writeAudit(row, "migration.ai_curate.keep_manual_review_item", { reviewId: row.id, confidence: row.confidence });
  return { action: "keep_manual_review_item" };
}

async function applyReview(row: ReviewRow) {
  if (!row.entityId) return { action: "skip", reason: "missing entity id" };
  const confidence = row.confidence ?? 0;
  if (confidence < minConfidence) return { action: "skip", reason: "low confidence" };

  const payload = parsePayload(row);

  if (row.issueType === "ai:archive_work" && row.entityType === "zettel") {
    await tagEntity(row.userId, "zettel", row.entityId, "archive-work", "Archive Work");
    await clearReviewTag(row);
    await markApplied(row, { ...payload, appliedAction: "tagged archive-work" });
    await writeAudit(row, "migration.ai_curate.apply_archive_work", { reviewId: row.id, confidence });
    return { action: "tag_archive_work" };
  }

  if (row.issueType === "ai:delete_auto_log") {
    if (row.entityType === "zettel") {
      await tagEntity(row.userId, "zettel", row.entityId, "auto-log", "Auto Log");
      await exec(`update zettels set deleted_at = coalesce(deleted_at, datetime('now')), updated_at = datetime('now') where id = ? and user_id = ?`, [row.entityId, row.userId]);
      await exec(`delete from zettels_fts where zettel_id = ?`, [row.entityId]);
    }
    if (row.entityType === "workout") {
      await tagEntity(row.userId, "workout", row.entityId, "auto-log", "Auto Log");
      await exec(`update workouts set deleted_at = coalesce(deleted_at, datetime('now')), updated_at = datetime('now') where id = ? and user_id = ?`, [row.entityId, row.userId]);
    }
    await markApplied(row, { ...payload, appliedAction: "soft-deleted auto-log" });
    await writeAudit(row, "migration.ai_curate.soft_delete_auto_log", { reviewId: row.id, confidence });
    return { action: "soft_delete_auto_log" };
  }

  if (row.issueType === "ai:keep_vault") return applyKeepVault(row, payload);
  if (row.issueType === "ai:move_to_media") return applyMoveToMedia(row, payload);
  if (row.issueType === "ai:move_to_life_ops") return applyMoveToLifeOps(row, payload);
  if (row.issueType === "ai:parse_error") return applyParseError(row, payload);
  if (row.issueType === "ai:needs_manual_review") return applyNeedsManualReview(row, payload);

  return { action: "skip", reason: `unsupported issue type ${row.issueType}` };
}

async function main() {
  loadEnv();
  const rows = (
    await queryD1<ReviewRow>(
      `select
         id,
         user_id as userId,
         source_document_id as sourceDocumentId,
         entity_type as entityType,
         entity_id as entityId,
         issue_type as issueType,
         suggested_action as suggestedAction,
         confidence,
         payload
       from migration_review_items
       where deleted_at is null
         and status = 'open'
         and issue_type in ('ai:archive_work', 'ai:delete_auto_log', 'ai:keep_vault', 'ai:move_to_media', 'ai:move_to_life_ops', 'ai:parse_error', 'ai:needs_manual_review')
         and coalesce(confidence, 0) >= ?
       order by confidence desc, created_at asc
       limit ?`,
      [minConfidence, limit],
    )
  ).rows;

  const summary: Record<string, number> = {};
  for (const row of rows) {
    const result = await applyReview(row);
    summary[result.action] = (summary[result.action] ?? 0) + 1;
    console.log(JSON.stringify({ reviewId: row.id, entityType: row.entityType, entityId: row.entityId, issueType: row.issueType, confidence: row.confidence, result }));
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned: rows.length, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
