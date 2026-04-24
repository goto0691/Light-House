import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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

type Candidate = {
  id: string;
  title: string;
  reason: string;
  tags: string[];
  target: "vault" | "media" | "life_ops" | "archive" | "prm";
  action: "tag" | "merge" | "soft_hide" | "review";
};

const apply = process.argv.includes("--apply");

function loadEnvFile(path: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    process.env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
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
  const response = await fetch(d1Endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? required("DATABASE_AUTH_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
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

function classifyZettel(row: ZettelRow): Candidate | null {
  const text = corpus(row.title, row.category, row.type, row.summary, row.content);
  const tags: string[] = [];

  const workArchiveSignals = [
    /^# .*(외출|외박)/m,
    /외출자[:\s]/,
    /외출목적[:\s]/,
    /외출할 곳[:\s]/,
    /국군수도병원|DEMIS/i,
  ];
  if (hasAny(text, workArchiveSignals)) {
    tags.push("archive-work");
    return {
      id: row.id,
      title: row.title,
      reason: "previous workplace operational or patient-leave document",
      tags,
      target: "archive",
      action: "tag",
    };
  }

  if (hasAny(text, [/오늘 일기:\s*오늘 일기 ❌|오늘 묵상:\s*오늘 묵상 ❌|오늘 운동:\s*오늘 운동 ❌|^#\s*🗓️@|^#\s*🏃@/m])) {
    tags.push("auto-log");
    if (/운동|🏃/.test(text)) tags.push("workout");
    return {
      id: row.id,
      title: row.title,
      reason: "Notion automation shell with no standalone reading value",
      tags,
      target: "life_ops",
      action: "soft_hide",
    };
  }

  const strongMediaSignals = [
    /^감독\/크리에이터:/m,
    /^감독:/m,
    /^개발사:/m,
    /^제작사:/m,
    /^플랫폼:/m,
    /^플레이 타임:/m,
    /^시청상태:/m,
    /^다시 볼 가치:/m,
    /^저자:/m,
    /^출판사:/m,
    /^평점:/m,
  ];
  const relationOnlyShell = /^(3\. 네트워크|1\. 지식 창고|2\. 프로젝트|4\. 라이프 오퍼레이션):/m.test(text) && !hasAny(text, strongMediaSignals);
  if (!relationOnlyShell && hasAny(text, strongMediaSignals)) {
    tags.push("media");
    if (/게임|개발사|플레이 타임/.test(text)) tags.push("game");
    if (/도서|저자|출판사/.test(text)) tags.push("book");
    if (/영상|영화|드라마|애니|감독|시청/.test(text)) tags.push("screen");
    return {
      id: row.id,
      title: row.title,
      reason: "raw Notion media detail page",
      tags: unique(tags),
      target: "media",
      action: "merge",
    };
  }

  if (hasAny(text, [/유형:\s*설교문|본문:\s*[가-힣]+\s*\d+[:장]|마태복음|누가복음|로마서|갈라디아서|시편|잠언|신명기|레위기|여호수아|사사기/i])) {
    tags.push("sermon", "faith");
    return {
      id: row.id,
      title: row.title,
      reason: "sermon or Bible passage based note",
      tags: unique(tags),
      target: "vault",
      action: "tag",
    };
  }

  const isLikelyPersonShell = /^(그룹|생일|마지막 연락일|주소|생일까지|영상 로그|일기):/m.test(text);
  if (!isLikelyPersonShell && hasAny(text, [/카테고리:\s*신앙\/종교|묵상|기도|예배|하나님|예수|십자가|복음/i])) {
    tags.push("faith");
    if (/묵상|본문말씀|QT/i.test(text)) tags.push("meditation");
    return {
      id: row.id,
      title: row.title,
      reason: "faith or meditation note",
      tags: unique(tags),
      target: "vault",
      action: "tag",
    };
  }

  if (hasAny(text, [/카테고리:\s*창작|유형:\s*(시|세계관 설정|아이디어|소설)|창작/i])) {
    tags.push("writing");
    return {
      id: row.id,
      title: row.title,
      reason: "creative writing note",
      tags,
      target: "vault",
      action: "tag",
    };
  }

  if (hasAny(text, [/날짜:\s*\d{4}년.*태그:.*일기|감사일기|오늘의 일기|태그:\s*일기/i])) {
    tags.push("journal");
    return {
      id: row.id,
      title: row.title,
      reason: "journal-like markdown note",
      tags,
      target: "life_ops",
      action: "review",
    };
  }

  return null;
}

function classifyPerson(row: PersonRow): Candidate | null {
  const text = corpus(row.name, row.groups, row.bio, row.coreValue);
  if (!hasAny(text, [/감독\/크리에이터|개발사|제작사|플랫폼|플레이 타임|시청상태|영상 로그|게임 로그|도서 로그|오징어 게임/i])) {
    return null;
  }
  return {
    id: row.id,
    title: row.name,
    reason: "non-person media artifact in PRM",
    tags: ["media"],
    target: "media",
    action: "merge",
  };
}

function classifyDaily(row: DailyLogRow): Candidate[] {
  const candidates: Candidate[] = [];
  if (row.journal?.trim()) {
    candidates.push({
      id: row.id,
      title: row.date,
      reason: "daily log contains journal text",
      tags: ["journal"],
      target: "life_ops",
      action: "tag",
    });
  }
  if (row.meditation?.trim() || row.meditationVerse?.trim()) {
    candidates.push({
      id: row.id,
      title: row.date,
      reason: "daily log contains meditation text or verse",
      tags: ["meditation", "faith"],
      target: "life_ops",
      action: "tag",
    });
  }
  return candidates;
}

function classifyWorkout(row: WorkoutRow): Candidate | null {
  const text = corpus(row.categories, row.notes);
  if (/^\["운동"\]$/.test(row.categories) && /^🗓️@/.test(row.notes ?? "")) {
    return {
      id: row.id,
      title: row.date,
      reason: "empty workout placeholder generated by Notion rollup",
      tags: ["workout", "auto-log"],
      target: "life_ops",
      action: "soft_hide",
    };
  }
  if (/운동|러닝|하체|상체|등|가슴|유산소|헬스/i.test(text)) {
    return {
      id: row.id,
      title: row.date,
      reason: "workout data",
      tags: ["workout"],
      target: "life_ops",
      action: "tag",
    };
  }
  return null;
}

function groupBy<T extends Candidate>(items: T[], key: keyof Candidate) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function slugifyTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9가-힣-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function tagEntity(userId: string, taggableType: string, taggableId: string, tag: string) {
  const slug = slugifyTag(tag);
  if (!slug) return;
  const existing = await queryD1<{ id: string }>("select id from tags where user_id = ? and slug = ? limit 1", [userId, slug]);
  const tagId = existing.rows[0]?.id ?? randomUUID();
  if (!existing.rows[0]) {
    await executeD1(
      `insert into tags (id, user_id, name, slug, color, parent_id, usage_count, created_at, updated_at)
       values (?, ?, ?, ?, null, null, 0, datetime('now'), datetime('now'))`,
      [tagId, userId, tag, slug],
    );
  }
  await executeD1(
    `insert or ignore into taggings (id, tag_id, taggable_type, taggable_id, created_at)
     values (?, ?, ?, ?, datetime('now'))`,
    [randomUUID(), tagId, taggableType, taggableId],
  );
  await executeD1(
    `update tags
     set usage_count = (select count(*) from taggings where tag_id = ?), updated_at = datetime('now')
     where id = ?`,
    [tagId, tagId],
  );
}

async function seedSavedView(userId: string, input: { domain: string; scope: string; name: string; icon: string; query: string; order: number }) {
  await executeD1(
    `insert or ignore into saved_views
      (id, user_id, domain, scope, name, icon, search_query, filter_state, sort_state, view_key, is_default, display_order, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`,
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
      `${input.domain}.${input.scope}.${slugifyTag(input.name)}`,
      input.order,
    ],
  );
}

async function main() {
  loadEnvFile(".env.local");
  const email = process.env.LIGHT_HOUSE_ADMIN_EMAIL;
  const userResult = email
    ? await queryD1<{ id: string; email: string }>("select id, email from users where email = ? limit 1", [email])
    : await queryD1<{ id: string; email: string }>("select id, email from users limit 1");
  const user = userResult.rows[0];
  if (!user) throw new Error("No user found.");

  const [zettels, people, dailyLogs, workouts] = await Promise.all([
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
  ]);

  const zettelCandidates = zettels.rows.map(classifyZettel).filter(Boolean) as Candidate[];
  const personCandidates = people.rows.map(classifyPerson).filter(Boolean) as Candidate[];
  const dailyCandidates = dailyLogs.rows.flatMap(classifyDaily);
  const workoutCandidates = workouts.rows.map(classifyWorkout).filter(Boolean) as Candidate[];
  const allCandidates = [...zettelCandidates, ...personCandidates, ...dailyCandidates, ...workoutCandidates];

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        user,
        scanned: {
          zettels: zettels.rows.length,
          people: people.rows.length,
          dailyLogs: dailyLogs.rows.length,
          workouts: workouts.rows.length,
        },
        candidates: allCandidates.length,
        byTarget: groupBy(allCandidates, "target"),
        byAction: groupBy(allCandidates, "action"),
        byTag: allCandidates.reduce<Record<string, number>>((acc, item) => {
          for (const tag of item.tags) acc[tag] = (acc[tag] ?? 0) + 1;
          return acc;
        }, {}),
        samples: {
          media: allCandidates.filter((item) => item.target === "media").slice(0, 10),
          lifeOps: allCandidates.filter((item) => item.target === "life_ops").slice(0, 10),
          vault: allCandidates.filter((item) => item.target === "vault").slice(0, 10),
          archive: allCandidates.filter((item) => item.target === "archive").slice(0, 10),
        },
      },
      null,
      2,
    ),
  );

  if (!apply) return;

  for (const item of zettelCandidates) {
    for (const tag of item.tags) await tagEntity(user.id, "zettel", item.id, tag);
    if (item.action === "soft_hide") {
      await executeD1(`update zettels set deleted_at = datetime('now'), updated_at = datetime('now') where id = ? and user_id = ?`, [item.id, user.id]);
    }
  }
  for (const item of dailyCandidates) {
    for (const tag of item.tags) await tagEntity(user.id, "daily_log", item.id, tag);
  }
  for (const item of workoutCandidates) {
    for (const tag of item.tags) await tagEntity(user.id, "workout", item.id, tag);
  }
  for (const item of personCandidates) {
    for (const tag of item.tags) await tagEntity(user.id, "person", item.id, tag);
  }

  const views = [
    { domain: "life-ops", scope: "daily", name: "Journal Archive", icon: "book-open", query: "journal", order: 10 },
    { domain: "life-ops", scope: "daily", name: "Meditation Archive", icon: "sparkles", query: "meditation OR faith", order: 20 },
    { domain: "vault", scope: "zettels", name: "Sermons & Faith Notes", icon: "landmark", query: "sermon OR faith", order: 10 },
    { domain: "vault", scope: "zettels", name: "Creative Writing", icon: "pen-line", query: "writing", order: 20 },
    { domain: "vault", scope: "media", name: "Media Shelf", icon: "library", query: "media OR game OR book OR screen", order: 30 },
    { domain: "vault", scope: "zettels", name: "Archived Work Docs", icon: "archive", query: "archive-work", order: 90 },
  ];
  for (const view of views) await seedSavedView(user.id, view);

  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, null, 'data.reclassify', 'user', ?, ?, datetime('now'))`,
    [randomUUID(), user.id, user.id, JSON.stringify({ candidates: allCandidates.length, byTarget: groupBy(allCandidates, "target"), byAction: groupBy(allCandidates, "action") })],
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
