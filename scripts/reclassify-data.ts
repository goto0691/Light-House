import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Meta = {
  changes?: number;
  rows_read?: number;
  rows_written?: number;
};

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: D1Meta; results?: T[]; success?: boolean }>;
  success?: boolean;
};

type UserRow = {
  id: string;
  email: string;
};

type ZettelRow = {
  id: string;
  title: string;
  category: string | null;
  type: string | null;
  content: string | null;
  summary: string | null;
  notionSourceId: string | null;
  importBatchId: string | null;
};

type PersonRow = {
  id: string;
  name: string;
  groups: string | null;
  bio: string | null;
  coreValue: string | null;
  notionSourceId: string | null;
  importBatchId: string | null;
};

type DailyLogRow = {
  id: string;
  date: string;
  journal: string | null;
  meditation: string | null;
  meditationVerse: string | null;
};

type WorkoutRow = {
  id: string;
  date: string;
  categories: string;
  notes: string | null;
};

type MediaRow = {
  id: string;
  title: string;
  mediaType: string;
};

type BackupRow = {
  id: string;
};

type SqliteObjectRow = {
  name: string;
};

type TableInfoRow = {
  name: string;
};

type ExtractedLifeOps = {
  date?: string;
  journal?: string;
  meditation?: string;
  meditationVerse?: string;
  workoutNote?: string;
  workoutCategories: string[];
  relatedPeople: string[];
};

type Candidate = {
  entityType: "zettel" | "daily_log" | "workout" | "person" | "media";
  id: string;
  title: string;
  reason: string;
  tags: string[];
  target: "vault" | "media" | "life_ops" | "archive" | "prm";
  action: "tag" | "extract" | "extract_and_soft_hide" | "soft_hide" | "review";
  confidence: number;
  extracted?: ExtractedLifeOps;
};

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const hardDeleteAutoLogs = args.has("--hard-delete-auto-logs");
const backupId = process.argv.find((arg) => arg.startsWith("--backup-id="))?.slice("--backup-id=".length);

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^"|"$/g, "");
    process.env[key] = process.env[key] ?? value;
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function d1Endpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${required("CLOUDFLARE_D1_DATABASE_ID")}/query`;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  let response: Response;
  try {
    response = await fetch(d1Endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? required("DATABASE_AUTH_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`D1 network request failed before reaching Cloudflare. Check sandbox/network permissions and token environment. Original error: ${message}`);
  }
  const payload = (await response.json()) as D1Envelope<T>;
  if (!response.ok || payload.success === false || payload.result?.[0]?.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 query failed.");
  }
  return {
    meta: payload.result?.[0]?.meta ?? {},
    rows: payload.result?.[0]?.results ?? [],
  };
}

async function executeD1(sql: string, params: unknown[] = []) {
  return queryD1(sql, params);
}

function corpus(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join("\n");
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function compact(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9가-힣-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isUsefulValue(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^(오늘\s*)?(일기|묵상|운동)\s*[❌xX]?$/.test(normalized)) return false;
  if (/^(없음|미작성|해당 없음|n\/a|null|undefined)$/i.test(normalized)) return false;
  if (/^[❌xX-]+$/.test(normalized)) return false;
  return true;
}

function normalizeExtractedValue(value: string | undefined) {
  const trimmed = value?.trim();
  return isUsefulValue(trimmed) ? trimmed : undefined;
}

function extractDate(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const normalized = value.normalize("NFKC");
    const iso = normalized.match(/(\d{4})[-./_년\s]+(\d{1,2})[-./_월\s]+(\d{1,2})/);
    if (iso) {
      const [, year, month, day] = iso;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }
  return undefined;
}

function extractLabeledValue(text: string, labels: string[]) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${escaped})\\s*[:：]\\s*([^\\n]+)`, "i");
  return normalizeExtractedValue(text.match(pattern)?.[1]);
}

function extractRelatedPeopleNames(text: string) {
  const names = new Set<string>();
  const relatedLine = text.match(/(?:관련인물|관련 인물|사람|외출자 이름)\s*[:：]\s*([^\n]+)/);
  for (const raw of (relatedLine?.[1] ?? "").split(/[,;/、·|]/)) {
    const name = raw.replace(/\[\[|\]\]|@/g, "").trim();
    if (name) names.add(name);
  }

  for (const match of text.matchAll(/@([\p{L}\p{N}_ -]{2,40})/gu)) {
    const name = match[1]?.trim();
    if (name) names.add(name);
  }

  return [...names];
}

function extractWorkoutCategories(value: string | undefined) {
  if (!value) return [];
  return unique(
    value
      .replace(/[\[\]"]/g, "")
      .split(/[,;/、·|]/)
      .map((item) => item.trim())
      .filter((item) => item && !/^(오늘\s*)?운동\s*[❌xX]?$/.test(item)),
  );
}

function extractLifeOpsFromZettel(row: ZettelRow): ExtractedLifeOps {
  const text = corpus(row.title, row.summary, row.content);
  const journal = extractLabeledValue(text, ["오늘 일기", "일기", "사건", "journal", "diary"]);
  const meditation = extractLabeledValue(text, ["오늘 묵상", "묵상", "배경지식", "meditation"]);
  const meditationVerse = extractLabeledValue(text, ["본문말씀", "본문 말씀", "말씀", "verse"]);
  const workoutNote = extractLabeledValue(text, ["오늘 운동", "운동", "운동 로그", "workout"]);
  return {
    date: extractDate(row.title, row.summary, row.content),
    journal,
    meditation,
    meditationVerse,
    workoutNote,
    workoutCategories: extractWorkoutCategories(workoutNote),
    relatedPeople: extractRelatedPeopleNames(text),
  };
}

function isGeneratedDailyShell(row: ZettelRow) {
  const title = row.title;
  return hasAny(title, [
    /^🗓️|^🏃/,
    /@오늘/i,
    /운동\s*완료/,
    /^MASTER DB$/i,
  ]);
}

function classifyZettel(row: ZettelRow, peopleTitleSet: Set<string>): Candidate | null {
  const text = corpus(row.title, row.category, row.type, row.summary, row.content);
  const extracted = extractLifeOpsFromZettel(row);
  const titleKey = normalizeTitle(row.title);

  const isFaithTitle =
    /누가복음|마태복음|마가복음|요한복음|로마서|고린도|갈라디아|에베소|빌립보|야고보서|시편|잠언|창세기|출애굽|레위기|민수기|신명기|예수|하나님|복음|구유|십자가|부활/.test(row.title) ||
    /카테고리\s*[:：]\s*신앙\/종교|유형\s*[:：]\s*설교문|본문\s*[:：]\s*[^\n]+/.test(text);
  const isPersonalDiary = /태그\s*[:：]\s*일기|카테고리\s*[:：]\s*일기/.test(text);
  const isLikelyPersonPage =
    peopleTitleSet.has(titleKey) ||
    hasAny(text, [/그룹\s*[:：]|생일\s*[:：]|마지막\s*연락일|생일까지|주소\s*[:：]|핵심\s*가치|관련\s*인물\s*[:：]/]);

  if (
    !isFaithTitle &&
    !isPersonalDiary &&
    hasAny(text, [
      /외출자\s*특이사항|외출목적|외출할\s*곳|외출자\s*이름|간병인\s*외출/,
      /국군수도병원|DEMIS/,
      /병원.*(업무|코로나|외출|외박|출근|재입사)|(업무|코로나|외출|외박|출근|재입사).*병원/,
    ])
  ) {
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "old workplace or hospital operation document",
      tags: ["archive-work"],
      target: "archive",
      action: "tag",
      confidence: 0.92,
    };
  }

  if (isGeneratedDailyShell(row)) {
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "generated Notion daily shell; preserve canonical data in Life Ops and hide the shell page",
      tags: unique(["auto-log", extracted.date ? "journal" : "", extracted.workoutNote ? "workout" : ""].filter(Boolean)),
      target: "life_ops",
      action: "soft_hide",
      confidence: 0.88,
    };
  }

  if (
    !isLikelyPersonPage &&
    hasAny(text, [
      /감독\/크리에이터|감독\s*[:：]|개발사|제작사|플레이\s*타임|시청상태|다시\s*볼\s*가치/,
      /영상\s*로그|게임\s*로그|도서\s*로그|컨텐츠\s*로그|콘텐츠\s*로그/,
      /평점\s*[:：]|한줄평\s*[:：]|리뷰\s*[:：]/,
    ])
  ) {
    const strongMediaSignalCount = [
      /감독\/크리에이터|감독\s*[:：]/,
      /개발사|제작사/,
      /플레이\s*타임|시청상태|다시\s*볼\s*가치/,
      /평점\s*[:：]|한줄평\s*[:：]|리뷰\s*[:：]/,
      /영상\s*로그|게임\s*로그|도서\s*로그|컨텐츠\s*로그|콘텐츠\s*로그/,
    ].filter((pattern) => pattern.test(text)).length;
    if (strongMediaSignalCount < 2) return null;

    const tags = ["media"];
    if (/게임|개발사|플레이\s*타임/i.test(text)) tags.push("game");
    if (/도서|저자|출판사|책/i.test(text)) tags.push("book");
    if (/영상|영화|드라마|애니|감독|시청/i.test(text)) tags.push("screen");
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "media-like raw Notion page; needs merge review before hiding",
      tags: unique([...tags, "needs-review"]),
      target: "media",
      action: "review",
      confidence: 0.82,
    };
  }

  if (
    hasAny(text, [
      /설교|본문\s*[:：]|마태복음|마가복음|누가복음|요한복음|로마서|고린도|갈라디아|에베소|빌립보|시편|잠언|창세기|출애굽|레위기|민수기|신명기/,
    ])
  ) {
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "sermon or Bible-passage note",
      tags: ["sermon", "faith"],
      target: "vault",
      action: "tag",
      confidence: 0.88,
    };
  }

  if (hasAny(text, [/신학|종교|기도|예배|복음|하나님|예수|십자가|부활|묵상|QT/i])) {
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "faith or meditation note",
      tags: unique(["faith", /묵상|QT/i.test(text) ? "meditation" : ""].filter(Boolean)),
      target: "vault",
      action: "tag",
      confidence: 0.76,
    };
  }

  if (hasAny(text, [/창작|소설|시나리오|캐릭터|세계관|설정|아이디어|에피소드|글쓰기|초고|드래프트/i])) {
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "creative writing note",
      tags: ["writing"],
      target: "vault",
      action: "tag",
      confidence: 0.78,
    };
  }

  if (!isLikelyPersonPage && extracted.date && (extracted.journal || extracted.meditation || extracted.meditationVerse || extracted.workoutNote)) {
    return {
      entityType: "zettel",
      id: row.id,
      title: row.title,
      reason: "dated Life Ops-like note with extractable fields",
      tags: unique(["journal", extracted.meditation || extracted.meditationVerse ? "meditation" : "", extracted.workoutNote ? "workout" : "", "needs-review"].filter(Boolean)),
      target: "life_ops",
      action: "extract",
      confidence: 0.7,
      extracted,
    };
  }

  return null;
}

function classifyPerson(row: PersonRow): Candidate | null {
  const text = corpus(row.name, row.groups, row.bio, row.coreValue);
  if (!hasAny(text, [/감독\/크리에이터|개발사|제작사|플랫폼|플레이\s*타임|시청상태|영상\s*로그|게임\s*로그|도서\s*로그|컨텐츠\s*로그|다시\s*볼\s*가치/i])) {
    return null;
  }
  return {
    entityType: "person",
    id: row.id,
    title: row.name,
    reason: "PRM row looks like a media artifact; review before merge",
    tags: ["media", "needs-review"],
    target: "media",
    action: "review",
    confidence: 0.8,
  };
}

function classifyDaily(row: DailyLogRow): Candidate[] {
  const candidates: Candidate[] = [];
  if (compact(row.journal)) {
    candidates.push({
      entityType: "daily_log",
      id: row.id,
      title: row.date,
      reason: "daily log contains journal text",
      tags: ["journal"],
      target: "life_ops",
      action: "tag",
      confidence: 0.98,
    });
  }
  if (compact(row.meditation) || compact(row.meditationVerse)) {
    candidates.push({
      entityType: "daily_log",
      id: row.id,
      title: row.date,
      reason: "daily log contains meditation text or verse",
      tags: ["meditation", "faith"],
      target: "life_ops",
      action: "tag",
      confidence: 0.98,
    });
  }
  return candidates;
}

function classifyWorkout(row: WorkoutRow): Candidate | null {
  const text = corpus(row.categories, row.notes);
  const categories = extractWorkoutCategories(row.categories);
  if (!categories.length && !compact(row.notes)) {
    return {
      entityType: "workout",
      id: row.id,
      title: row.date,
      reason: "empty workout placeholder",
      tags: ["workout", "auto-log"],
      target: "life_ops",
      action: "soft_hide",
      confidence: 0.75,
    };
  }
  if (hasAny(text, [/운동|러닝|달리기|웨이트|상체|하체|유산소|헬스|workout|running|fitness/i])) {
    return {
      entityType: "workout",
      id: row.id,
      title: row.date,
      reason: "workout data",
      tags: ["workout"],
      target: "life_ops",
      action: "tag",
      confidence: 0.9,
    };
  }
  return null;
}

function groupBy(items: Candidate[], key: keyof Candidate) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function summarizeTags(items: Candidate[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    for (const tag of item.tags) acc[tag] = (acc[tag] ?? 0) + 1;
    return acc;
  }, {});
}

async function tagEntity(userId: string, taggableType: string, taggableId: string, tag: string) {
  const slug = slugifyTag(tag);
  if (!slug) return;
  const existing = await queryD1<{ id: string }>("select id from tags where user_id = ? and slug = ? and deleted_at is null limit 1", [userId, slug]);
  const tagId = existing.rows[0]?.id ?? randomUUID();
  if (!existing.rows[0]) {
    await executeD1(
      `insert into tags (id, user_id, name, slug, color, parent_id, usage_count, created_at, updated_at)
       values (?, ?, ?, ?, null, null, 0, datetime('now'), datetime('now'))`,
      [tagId, userId, tag, slug],
    );
  }
  await executeD1(
    `insert into taggings (id, tag_id, taggable_type, taggable_id, created_at)
     select ?, ?, ?, ?, datetime('now')
     where not exists (
       select 1 from taggings
       where tag_id = ? and taggable_type = ? and taggable_id = ?
     )`,
    [randomUUID(), tagId, taggableType, taggableId, tagId, taggableType, taggableId],
  );
  await executeD1(
    `update tags
     set usage_count = (select count(*) from taggings where tag_id = ?), updated_at = datetime('now')
     where id = ?`,
    [tagId, tagId],
  );
}

async function seedSavedView(userId: string, input: { domain: string; scope: string; name: string; icon: string; query: string; order: number }) {
  const viewKey = `${input.domain}.${input.scope}.${slugifyTag(input.name)}`;
  await executeD1(
    `insert into saved_views
      (id, user_id, domain, scope, name, icon, search_query, filter_state, sort_state, view_key, is_default, display_order, created_at, updated_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now')
     where not exists (
       select 1 from saved_views
       where user_id = ? and view_key = ? and deleted_at is null
     )`,
    [
      randomUUID(),
      userId,
      input.domain,
      input.scope,
      input.name,
      input.icon,
      input.query,
      JSON.stringify({ tags: input.query.split(/\s+OR\s+|\s+/).filter(Boolean) }),
      JSON.stringify({ field: "dateOrUpdatedAt", direction: "desc" }),
      viewKey,
      input.order,
      userId,
      viewKey,
    ],
  );
}

async function ensureDailyLog(userId: string, extracted: ExtractedLifeOps, source: Candidate) {
  if (!extracted.date) return undefined;

  const existing = await queryD1<DailyLogRow>(
    `select id, date, journal, meditation, meditation_verse as meditationVerse
     from daily_logs
     where user_id = ? and date = ? and deleted_at is null
     limit 1`,
    [userId, extracted.date],
  );
  const current = existing.rows[0];
  const dailyLogId = current?.id ?? randomUUID();

  if (current) {
    await executeD1(
      `update daily_logs
       set journal = case when (journal is null or trim(journal) = '') and ? is not null then ? else journal end,
           meditation = case when (meditation is null or trim(meditation) = '') and ? is not null then ? else meditation end,
           meditation_verse = case when (meditation_verse is null or trim(meditation_verse) = '') and ? is not null then ? else meditation_verse end,
           updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [extracted.journal ?? null, extracted.journal ?? null, extracted.meditation ?? null, extracted.meditation ?? null, extracted.meditationVerse ?? null, extracted.meditationVerse ?? null, dailyLogId, userId],
    );
  } else {
    await executeD1(
      `insert into daily_logs
        (id, user_id, notion_source_id, import_batch_id, date, mood, energy_level, emotions, gratitude, journal, meditation, meditation_verse, ai_summary, created_at, updated_at, deleted_at)
       values (?, ?, null, null, ?, null, null, null, null, ?, ?, ?, null, datetime('now'), datetime('now'), null)`,
      [dailyLogId, userId, extracted.date, extracted.journal ?? null, extracted.meditation ?? null, extracted.meditationVerse ?? null],
    );
  }

  for (const tag of ["journal", extracted.meditation || extracted.meditationVerse ? "meditation" : ""].filter(Boolean)) {
    await tagEntity(userId, "daily_log", dailyLogId, tag);
  }

  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, null, 'data.reclassify.extract_daily_log', 'daily_log', ?, ?, datetime('now'))`,
    [randomUUID(), userId, dailyLogId, JSON.stringify({ source: { entityType: source.entityType, id: source.id, title: source.title }, extracted })],
  );

  return dailyLogId;
}

async function ensureWorkout(userId: string, extracted: ExtractedLifeOps, source: Candidate) {
  if (!extracted.date || !extracted.workoutNote) return undefined;
  const categories = extracted.workoutCategories.length ? extracted.workoutCategories : ["운동"];
  const categoryJson = JSON.stringify(categories);
  const existing = await queryD1<{ id: string }>(
    `select id
     from workouts
     where user_id = ?
       and date = ?
       and categories = ?
       and deleted_at is null
     limit 1`,
    [userId, extracted.date, categoryJson],
  );
  const workoutId = existing.rows[0]?.id ?? randomUUID();
  if (existing.rows[0]) {
    await executeD1(
      `update workouts
       set notes = case when (notes is null or trim(notes) = '') then ? else notes end,
           updated_at = datetime('now')
       where id = ? and user_id = ?`,
      [extracted.workoutNote, workoutId, userId],
    );
  } else {
    await executeD1(
      `insert into workouts
        (id, user_id, notion_source_id, import_batch_id, date, categories, duration_minutes, intensity, notes, created_at, updated_at, deleted_at)
       values (?, ?, null, null, ?, ?, null, null, ?, datetime('now'), datetime('now'), null)`,
      [workoutId, userId, extracted.date, categoryJson, extracted.workoutNote],
    );
  }
  await tagEntity(userId, "workout", workoutId, "workout");
  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, null, 'data.reclassify.extract_workout', 'workout', ?, ?, datetime('now'))`,
    [randomUUID(), userId, workoutId, JSON.stringify({ source: { entityType: source.entityType, id: source.id, title: source.title }, extracted })],
  );
  return workoutId;
}

async function linkDailyLogPeople(userId: string, dailyLogId: string | undefined, extracted: ExtractedLifeOps, people: PersonRow[]) {
  if (!dailyLogId || !extracted.relatedPeople.length) return;
  const peopleByName = new Map(people.map((person) => [normalizeTitle(person.name), person]));
  for (const name of extracted.relatedPeople) {
    const person = peopleByName.get(normalizeTitle(name));
    if (!person) continue;
    await executeD1(
      `insert into daily_log_people_relations (daily_log_id, person_id, context, created_at)
       select ?, ?, 'notion_related_people', datetime('now')
       where not exists (
         select 1 from daily_log_people_relations where daily_log_id = ? and person_id = ?
       )`,
      [dailyLogId, person.id, dailyLogId, person.id],
    );
    await tagEntity(userId, "person", person.id, "journal");
  }
}

async function softHideCandidate(userId: string, item: Candidate) {
  if (item.entityType === "zettel") {
    await executeD1(`update zettels set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ? and deleted_at is null`, [item.id, userId]);
  }
  if (item.entityType === "workout") {
    await executeD1(`update workouts set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ? and deleted_at is null`, [item.id, userId]);
  }
  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, null, 'data.reclassify.soft_hide', ?, ?, ?, datetime('now'))`,
    [randomUUID(), userId, item.entityType, item.id, JSON.stringify({ title: item.title, reason: item.reason, tags: item.tags })],
  );
}

async function hardDeleteAutoLogCandidate(userId: string, item: Candidate) {
  if (!hardDeleteAutoLogs) return;
  if (!backupId) throw new Error("--hard-delete-auto-logs requires --backup-id=<backup_snapshots.id>.");
  if (!item.tags.includes("auto-log")) return;
  if (item.action !== "soft_hide" && item.action !== "extract_and_soft_hide") return;
  if (item.entityType !== "zettel" && item.entityType !== "workout") return;

  if (item.entityType === "zettel") await executeD1(`delete from zettels where id = ? and user_id = ? and deleted_at is not null`, [item.id, userId]);
  if (item.entityType === "workout") await executeD1(`delete from workouts where id = ? and user_id = ? and deleted_at is not null`, [item.id, userId]);
  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, null, 'data.reclassify.hard_delete_auto_log', ?, ?, ?, datetime('now'))`,
    [randomUUID(), userId, item.entityType, item.id, JSON.stringify({ backupId, title: item.title, reason: item.reason })],
  );
}

async function refreshFts() {
  await executeD1(
    `insert into zettels_fts(zettel_id, title, content_text, summary, category)
     select z.id, z.title, coalesce(z.content_text, ''), coalesce(z.summary, ''), coalesce(z.category, '')
     from zettels z
     where z.deleted_at is null
       and not exists (select 1 from zettels_fts f where f.zettel_id = z.id)`,
  );
  await executeD1(
    `insert into people_fts(person_id, name, nickname, bio, core_value)
     select p.id, p.name, coalesce(p.nickname, ''), coalesce(p.bio, ''), coalesce(p.core_value, '')
     from people p
     where p.deleted_at is null
       and not exists (select 1 from people_fts f where f.person_id = p.id)`,
  );
  await executeD1(
    `insert into media_fts(media_id, title, original_title, creator, review)
     select m.id, m.title, coalesce(m.original_title, ''), coalesce(m.creator, ''), coalesce(m.review, '')
     from media_logs m
     where m.deleted_at is null
       and not exists (select 1 from media_fts f where f.media_id = m.id)`,
  );
  await executeD1(
    `insert into daily_logs_fts(log_id, date, journal, meditation, gratitude)
     select d.id, d.date, coalesce(d.journal, ''), coalesce(d.meditation, ''), coalesce(d.gratitude, '')
     from daily_logs d
     where d.deleted_at is null
       and not exists (select 1 from daily_logs_fts f where f.log_id = d.id)`,
  );
}

function isMissingSqliteObject(error: unknown) {
  return error instanceof Error && /no such table|no such column/i.test(error.message);
}

async function assertBackupExists(userId: string) {
  if (!hardDeleteAutoLogs) return;
  if (!backupId) throw new Error("--hard-delete-auto-logs requires --backup-id=<backup_snapshots.id>.");
  const backup = await queryD1<BackupRow>(
    `select id from backup_snapshots where id = ? and user_id = ? and deleted_at is null and status = 'ready' limit 1`,
    [backupId, userId],
  );
  if (!backup.rows[0]) throw new Error(`Backup snapshot ${backupId} was not found or is not ready.`);
}

async function assertRequiredSchema() {
  if (!apply) return;

  const relationTable = await queryD1<SqliteObjectRow>(
    `select name
     from sqlite_master
     where type = 'table' and name = 'daily_log_people_relations'
     limit 1`,
  );
  if (!relationTable.rows[0]) {
    throw new Error("Missing table daily_log_people_relations. Apply migrations/0006_daily_log_people_relations.sql before running --apply.");
  }

  const giftColumns = await queryD1<TableInfoRow>(`pragma table_info(gifts)`);
  const giftColumnSet = new Set(giftColumns.rows.map((row) => row.name));
  for (const column of ["notion_source_id", "import_batch_id"]) {
    if (!giftColumnSet.has(column)) {
      throw new Error(`Missing gifts.${column}. Apply migrations/0003_notion_import_identity.sql before running --apply.`);
    }
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const email = process.env.LIGHT_HOUSE_ADMIN_EMAIL;
  const userResult = email
    ? await queryD1<UserRow>("select id, email from users where email = ? limit 1", [email])
    : await queryD1<UserRow>("select id, email from users limit 1");
  const user = userResult.rows[0];
  if (!user) throw new Error("No user found.");
  await assertRequiredSchema();
  await assertBackupExists(user.id);

  const [zettels, people, dailyLogs, workouts, media] = await Promise.all([
    queryD1<ZettelRow>(
      `select id, title, category, type, content, summary, notion_source_id as notionSourceId, import_batch_id as importBatchId
       from zettels
       where user_id = ? and deleted_at is null`,
      [user.id],
    ),
    queryD1<PersonRow>(
      `select id, name, groups, bio, core_value as coreValue, notion_source_id as notionSourceId, import_batch_id as importBatchId
       from people
       where user_id = ? and deleted_at is null`,
      [user.id],
    ),
    queryD1<DailyLogRow>(
      `select id, date, journal, meditation, meditation_verse as meditationVerse
       from daily_logs
       where user_id = ? and deleted_at is null`,
      [user.id],
    ),
    queryD1<WorkoutRow>(
      `select id, date, categories, notes
       from workouts
       where user_id = ? and deleted_at is null`,
      [user.id],
    ),
    queryD1<MediaRow>(
      `select id, title, media_type as mediaType
       from media_logs
       where user_id = ? and deleted_at is null`,
      [user.id],
    ),
  ]);

  const peopleTitleSet = new Set(people.rows.map((person) => normalizeTitle(person.name)));
  const zettelCandidates = zettels.rows.map((row) => classifyZettel(row, peopleTitleSet)).filter(Boolean) as Candidate[];
  const personCandidates = people.rows.map(classifyPerson).filter(Boolean) as Candidate[];
  const dailyCandidates = dailyLogs.rows.flatMap(classifyDaily);
  const workoutCandidates = workouts.rows.map(classifyWorkout).filter(Boolean) as Candidate[];
  const allCandidates = [...zettelCandidates, ...personCandidates, ...dailyCandidates, ...workoutCandidates];

  const summary = {
    mode: apply ? "apply" : "dry-run",
    hardDeleteAutoLogs,
    backupId: backupId ?? null,
    user,
    scanned: {
      zettels: zettels.rows.length,
      people: people.rows.length,
      dailyLogs: dailyLogs.rows.length,
      workouts: workouts.rows.length,
      mediaLogs: media.rows.length,
    },
    candidates: allCandidates.length,
    byEntityType: groupBy(allCandidates, "entityType"),
    byTarget: groupBy(allCandidates, "target"),
    byAction: groupBy(allCandidates, "action"),
    byTag: summarizeTags(allCandidates),
    samples: {
      extractableLifeOps: allCandidates.filter((item) => item.action === "extract" || item.action === "extract_and_soft_hide").slice(0, 12),
      autoLogs: allCandidates.filter((item) => item.tags.includes("auto-log")).slice(0, 12),
      mediaReview: allCandidates.filter((item) => item.target === "media").slice(0, 12),
      vaultTags: allCandidates.filter((item) => item.target === "vault").slice(0, 12),
      archive: allCandidates.filter((item) => item.target === "archive").slice(0, 12),
      needsReview: allCandidates.filter((item) => item.tags.includes("needs-review")).slice(0, 12),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;

  for (const item of allCandidates) {
    for (const tag of item.tags) await tagEntity(user.id, item.entityType, item.id, tag);

    let dailyLogId: string | undefined;
    if ((item.action === "extract" || item.action === "extract_and_soft_hide") && item.extracted) {
      dailyLogId = await ensureDailyLog(user.id, item.extracted, item);
      await ensureWorkout(user.id, item.extracted, item);
      await linkDailyLogPeople(user.id, dailyLogId, item.extracted, people.rows);
    }

    if (item.action === "soft_hide" || item.action === "extract_and_soft_hide") {
      await softHideCandidate(user.id, item);
      await hardDeleteAutoLogCandidate(user.id, item);
    }
  }

  const views = [
    { domain: "life-ops", scope: "daily", name: "Journal Archive", icon: "book-open", query: "journal", order: 10 },
    { domain: "life-ops", scope: "daily", name: "Meditation Archive", icon: "sparkles", query: "meditation OR faith", order: 20 },
    { domain: "vault", scope: "zettels", name: "Sermons & Faith Notes", icon: "landmark", query: "sermon OR faith", order: 10 },
    { domain: "vault", scope: "zettels", name: "Creative Writing", icon: "pen-line", query: "writing", order: 20 },
    { domain: "vault", scope: "media", name: "Media Shelf", icon: "library", query: "media OR game OR book OR screen", order: 30 },
    { domain: "vault", scope: "zettels", name: "Archived Work Docs", icon: "archive", query: "archive-work", order: 90 },
    { domain: "settings", scope: "data", name: "Needs Review", icon: "list-checks", query: "needs-review", order: 100 },
    { domain: "settings", scope: "data", name: "Auto Logs Hidden", icon: "archive-x", query: "auto-log", order: 110 },
  ];
  for (const view of views) await seedSavedView(user.id, view);

  try {
    await refreshFts();
  } catch (error) {
    if (!isMissingSqliteObject(error)) throw error;
    console.warn("Skipping FTS refresh because one or more FTS tables are not available yet.");
  }

  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, null, 'data.reclassify', 'user', ?, ?, datetime('now'))`,
    [randomUUID(), user.id, user.id, JSON.stringify(summary)],
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
