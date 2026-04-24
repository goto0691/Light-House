import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path, { resolve } from "node:path";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import JSZip from "jszip";
import sharp from "sharp";
import { ulid } from "ulidx";

import { parseNotionImportFile, type NotionImportBundle } from "../apps/web/src/lib/notion-import-core";

type D1Meta = {
  changed_db?: boolean;
  changes?: number;
};

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: D1Meta; results?: T[]; success?: boolean }>;
  success?: boolean;
};

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    if (!key) continue;
    process.env[key] = rest.join("=");
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const token = process.env.CLOUDFLARE_API_TOKEN ?? required("DATABASE_AUTH_TOKEN");

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  const payload = (await response.json()) as D1Envelope<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).join(" | ") || "D1 query failed.");
  }

  const result = payload.result?.[0];
  if (!result || result.success === false) {
    throw new Error("D1 returned no result.");
  }

  return {
    meta: result.meta ?? {},
    rows: result.results ?? [],
  };
}

async function executeD1(sql: string, params: unknown[] = []) {
  return queryD1(sql, params);
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

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "file";
}

function buildAttachmentKeys(filename: string, mimeType: string) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const ext = path.extname(filename) || (mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg");
  const basename = sanitizeSegment(path.basename(filename, path.extname(filename)));
  const id = ulid().toLowerCase();

  return {
    id,
    originalKey: `originals/${yyyy}/${mm}/${id}-${basename}${ext}`,
    previewKey: `previews/${yyyy}/${mm}/${id}-${basename}.webp`,
    nasPath: `photos/${yyyy}/${mm}/${id}-${basename}${ext}`,
  };
}

function getBucketName() {
  return required("R2_BUCKET");
}

function getR2PublicUrl() {
  return process.env.R2_PUBLIC_URL?.replace(/\/$/, "") || "";
}

function buildInternalVariantUrl(attachmentId: string, variant: "preview" | "original") {
  return `/api/upload/files/${attachmentId}/${variant}`;
}

function createR2Client() {
  const accountId = required("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function getMimeType(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function extractNotionIdFromFilename(filename: string) {
  return filename.match(/([a-f0-9]{32})(?:_all)?\.[^.]+$/i)?.[1]?.toLowerCase() ?? null;
}

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function containsWholeText(haystack: string, needle: string) {
  const source = normalizeForMatch(haystack);
  const target = normalizeForMatch(needle);
  if (!target || target.length < 2) return false;
  return source.includes(target);
}

async function ensureUser() {
  const email = process.env.LIGHT_HOUSE_ADMIN_EMAIL ?? "keeper@lighthouse.local";
  const displayName = process.env.LIGHT_HOUSE_ADMIN_NAME ?? "Light Keeper";

  const existing = await queryD1<{ id: string }>("select id from users where email = ? limit 1", [email]);
  if (existing.rows[0]?.id) {
    return { id: existing.rows[0].id, email };
  }

  const userId = "user-light-keeper";
  await executeD1(
    `insert into users (id, email, display_name, locale, timezone, preferences, created_at, updated_at)
     values (?, ?, ?, 'ko-KR', 'Asia/Seoul', '{"theme":"system"}', datetime('now'), datetime('now'))`,
    [userId, email, displayName],
  );

  return { id: userId, email };
}

async function writeAuditLog(userId: string, importBatchId: string, action: string, entityId: string, snapshot: string) {
  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, 'notion_import', ?, ?, datetime('now'))`,
    [ulid(), userId, importBatchId, action, entityId, snapshot],
  );
}

async function findExistingId(table: string, userId: string, notionSourceId: string) {
  const found = await queryD1<{ id: string }>(
    `select id
     from ${table}
     where user_id = ? and notion_source_id = ?
     limit 1`,
    [userId, notionSourceId],
  );
  return found.rows[0]?.id ?? null;
}

async function findLegacyId(sql: string, params: unknown[]) {
  const found = await queryD1<{ id: string }>(sql, params);
  return found.rows[0]?.id ?? null;
}

async function insertZettels(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.zettels) {
    const matchedId =
      (await findExistingId("zettels", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from zettels where user_id = ? and title = ? limit 1`, [userId, entry.title]));

    if (matchedId) {
      await executeD1(
        `update zettels
         set notion_source_id = coalesce(notion_source_id, ?),
             title = ?,
             content = ?,
             content_text = ?,
             summary = ?,
             type = ?,
             category = ?,
             source = ?,
             source_url = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.title, entry.content, entry.content, entry.summary ?? entry.content.slice(0, 180), entry.type ?? "reference", entry.category ?? "Notion Import", entry.source ?? "notion-import", entry.sourceUrl ?? null, importBatchId, matchedId],
      );
      continue;
    }

    const id = ulid();
    await executeD1(
      `insert into zettels
        (id, user_id, notion_source_id, import_batch_id, title, slug, content, content_text, summary, type, category, source, source_url, pinned, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [id, userId, entry.notionSourceId, importBatchId, entry.title, `${slugify(entry.title)}-${id.slice(-6).toLowerCase()}`, entry.content, entry.content, entry.summary ?? entry.content.slice(0, 180), entry.type ?? "reference", entry.category ?? "Notion Import", entry.source ?? "notion-import", entry.sourceUrl ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertTasks(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.tasks) {
    const matchedId =
      (await findExistingId("tasks", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from tasks where user_id = ? and title = ? limit 1`, [userId, entry.title]));

    if (matchedId) {
      await executeD1(
        `update tasks
         set notion_source_id = coalesce(notion_source_id, ?),
             title = ?,
             kind = ?,
             content = ?,
             status = ?,
             priority = ?,
             due_at = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.title, entry.kind ?? "development", entry.content ?? null, entry.status ?? "todo", entry.priority ?? "P2", entry.dueAt ?? null, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into tasks
        (id, user_id, notion_source_id, import_batch_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
       values (?, ?, ?, ?, null, ?, ?, ?, ?, ?, 'normal', ?, 0, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, entry.title, entry.kind ?? "development", entry.content ?? null, entry.status ?? "todo", entry.priority ?? "P2", entry.dueAt ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertProjects(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.projects) {
    const description = [entry.description, entry.brainEnergy ? `Brain Energy: ${entry.brainEnergy}` : null, entry.priority ? `Priority: ${entry.priority}` : null]
      .filter(Boolean)
      .join("\n");

    const matchedId =
      (await findExistingId("projects", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from projects where user_id = ? and title = ? limit 1`, [userId, entry.title]));

    if (matchedId) {
      await executeD1(
        `update projects
         set notion_source_id = coalesce(notion_source_id, ?),
             title = ?,
             description = ?,
             kind = ?,
             status = ?,
             category = ?,
             target_date = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.title, description, entry.kind ?? "project", entry.status ?? "active", entry.category ?? null, entry.targetDate ?? null, importBatchId, matchedId],
      );
      continue;
    }

    const id = ulid();
    await executeD1(
      `insert into projects
        (id, user_id, notion_source_id, import_batch_id, title, slug, description, kind, status, category, target_date, pinned, progress, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))`,
      [id, userId, entry.notionSourceId, importBatchId, entry.title, `${slugify(entry.title)}-${id.slice(-6).toLowerCase()}`, description, entry.kind ?? "project", entry.status ?? "active", entry.category ?? null, entry.targetDate ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertPeople(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.people) {
    const matchedId =
      (await findExistingId("people", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from people where user_id = ? and name = ? limit 1`, [userId, entry.name]));

    if (matchedId) {
      await executeD1(
        `update people
         set notion_source_id = coalesce(notion_source_id, ?),
             name = ?,
             nickname = ?,
             birth_date = ?,
             groups = ?,
             bio = ?,
             phone = ?,
             email = ?,
             address = ?,
             core_value = ?,
             last_contacted_at = ?,
             status = ?,
             is_favorite = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.name, entry.nickname ?? null, entry.birthDate ?? null, JSON.stringify(entry.groups ?? []), entry.bio ?? null, entry.phone ?? null, entry.email ?? null, entry.address ?? null, entry.coreValue ?? null, entry.lastContactedAt ?? null, entry.status ?? "active", entry.isFavorite ? 1 : 0, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into people
        (id, user_id, notion_source_id, import_batch_id, name, nickname, birth_date, groups, bio, phone, email, address, core_value, last_contacted_at, status, is_favorite, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, entry.name, entry.nickname ?? null, entry.birthDate ?? null, JSON.stringify(entry.groups ?? []), entry.bio ?? null, entry.phone ?? null, entry.email ?? null, entry.address ?? null, entry.coreValue ?? null, entry.lastContactedAt ?? null, entry.status ?? "active", entry.isFavorite ? 1 : 0],
    );
    created += 1;
  }
  return created;
}

async function resolvePeopleMap(userId: string) {
  const found = await queryD1<{ id: string; name: string }>(
    `select id, name
     from people
     where user_id = ?`,
    [userId],
  );

  const map = new Map<string, string>();
  for (const row of found.rows) {
    map.set(row.name.trim(), row.id);
  }
  return map;
}

async function insertGifts(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  const peopleMap = await resolvePeopleMap(userId);
  let created = 0;

  for (const entry of bundle.gifts) {
    if (!entry.personName) continue;
    const personId = peopleMap.get(entry.personName.trim());
    if (!personId) continue;

    const occurredAt = entry.occurredAt ?? new Date().toISOString().slice(0, 10);
    const matchedId =
      (await findExistingId("gifts", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from gifts where user_id = ? and person_id = ? and title = ? and occurred_at = ? limit 1`, [userId, personId, entry.title, occurredAt]));

    if (matchedId) {
      await executeD1(
        `update gifts
         set notion_source_id = coalesce(notion_source_id, ?),
             person_id = ?,
             title = ?,
             occurred_at = ?,
             reason = ?,
             cost = ?,
             satisfaction = ?,
             options = ?,
             image_url = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, personId, entry.title, occurredAt, entry.reason ?? null, entry.cost ?? null, entry.satisfaction ?? null, entry.options ?? null, entry.imageUrl ?? null, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into gifts
        (id, user_id, notion_source_id, import_batch_id, person_id, direction, title, occurred_at, reason, cost, satisfaction, options, image_url, notes, created_at, updated_at)
       values (?, ?, ?, ?, ?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, null, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, personId, entry.title, occurredAt, entry.reason ?? null, entry.cost ?? null, entry.satisfaction ?? null, entry.options ?? null, entry.imageUrl ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertDailyLogs(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.dailyLogs) {
    const matchedId =
      (await findExistingId("daily_logs", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from daily_logs where user_id = ? and date = ? limit 1`, [userId, entry.date]));

    if (matchedId) {
      await executeD1(
        `update daily_logs
         set notion_source_id = coalesce(notion_source_id, ?),
             mood = coalesce(?, mood),
             energy_level = coalesce(?, energy_level),
             gratitude = coalesce(?, gratitude),
             journal = coalesce(?, journal),
             meditation = coalesce(?, meditation),
             meditation_verse = coalesce(?, meditation_verse),
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.mood ?? null, entry.energyLevel ?? null, entry.gratitude ?? null, entry.journal ?? null, entry.meditation ?? null, entry.meditationVerse ?? null, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into daily_logs
        (id, user_id, notion_source_id, import_batch_id, date, mood, energy_level, gratitude, journal, meditation, meditation_verse, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, entry.date, entry.mood ?? null, entry.energyLevel ?? null, entry.gratitude ?? null, entry.journal ?? null, entry.meditation ?? null, entry.meditationVerse ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertWorkouts(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.workouts) {
    const matchedId =
      (await findExistingId("workouts", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from workouts where user_id = ? and date = ? and coalesce(notes, '') = ? limit 1`, [userId, entry.date, entry.notes ?? ""]));

    if (matchedId) {
      await executeD1(
        `update workouts
         set notion_source_id = coalesce(notion_source_id, ?),
             date = ?,
             categories = ?,
             notes = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.date, JSON.stringify(entry.categories), entry.notes ?? null, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into workouts
        (id, user_id, notion_source_id, import_batch_id, date, categories, notes, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, entry.date, JSON.stringify(entry.categories), entry.notes ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertCareerEntries(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.careerEntries) {
    const matchedId =
      (await findExistingId("career_history", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from career_history where user_id = ? and organization = ? and role = ? and start_date = ? limit 1`, [userId, entry.organization, entry.role, entry.startDate]));

    if (matchedId) {
      await executeD1(
        `update career_history
         set notion_source_id = coalesce(notion_source_id, ?),
             organization = ?,
             role = ?,
             category = ?,
             start_date = ?,
             end_date = ?,
             description = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.organization, entry.role, entry.category, entry.startDate, entry.endDate ?? null, entry.description ?? null, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into career_history
        (id, user_id, notion_source_id, import_batch_id, organization, role, category, start_date, end_date, description, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, entry.organization, entry.role, entry.category, entry.startDate, entry.endDate ?? null, entry.description ?? null],
    );
    created += 1;
  }
  return created;
}

async function insertMediaLogs(userId: string, importBatchId: string, bundle: NotionImportBundle) {
  let created = 0;
  for (const entry of bundle.mediaLogs) {
    const matchedId =
      (await findExistingId("media_logs", userId, entry.notionSourceId)) ??
      (await findLegacyId(`select id from media_logs where user_id = ? and media_type = ? and title = ? limit 1`, [userId, entry.mediaType, entry.title]));

    if (matchedId) {
      await executeD1(
        `update media_logs
         set notion_source_id = coalesce(notion_source_id, ?),
             media_type = ?,
             title = ?,
             creator = ?,
             studio = ?,
             genre = ?,
             status = ?,
             rating = ?,
             evaluation = ?,
             review = ?,
             content = ?,
             platform_or_publisher = ?,
             play_time = ?,
             author = ?,
             completed_at = ?,
             import_batch_id = ?,
             updated_at = datetime('now')
         where id = ?`,
        [entry.notionSourceId, entry.mediaType, entry.title, entry.creator ?? null, entry.studio ?? null, entry.genre ?? null, entry.status ?? "completed", entry.rating ?? null, entry.evaluation ?? null, entry.review ?? null, entry.content ?? null, entry.platformOrPublisher ?? null, entry.playTime ?? null, entry.author ?? null, entry.completedAt ?? null, importBatchId, matchedId],
      );
      continue;
    }

    await executeD1(
      `insert into media_logs
        (id, user_id, notion_source_id, import_batch_id, media_type, title, creator, studio, genre, status, rating, evaluation, review, content, platform_or_publisher, play_time, author, completed_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [ulid(), userId, entry.notionSourceId, importBatchId, entry.mediaType, entry.title, entry.creator ?? null, entry.studio ?? null, entry.genre ?? null, entry.status ?? "completed", entry.rating ?? null, entry.evaluation ?? null, entry.review ?? null, entry.content ?? null, entry.platformOrPublisher ?? null, entry.playTime ?? null, entry.author ?? null, entry.completedAt ?? null],
    );
    created += 1;
  }
  return created;
}

async function refreshProjectProgress(userId: string, projectId: string) {
  const stats = await queryD1<{ total: number | null; done: number | null }>(
    `select count(*) as total, sum(case when status = 'done' then 1 else 0 end) as done
     from tasks
     where user_id = ? and project_id = ? and deleted_at is null`,
    [userId, projectId],
  );
  const total = Number(stats.rows[0]?.total ?? 0);
  const done = Number(stats.rows[0]?.done ?? 0);
  const progress = total ? Math.round((done / total) * 100) : 0;

  await executeD1(
    `update projects
     set progress = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [progress, projectId, userId],
  );
}

async function restoreImportedRelations(userId: string, importBatchId: string) {
  const [peopleResult, zettelResult, projectResult, taskResult, importedZettels, mediaResult] = await Promise.all([
    queryD1<{ id: string; name: string }>(`select id, name from people where user_id = ? and deleted_at is null`, [userId]),
    queryD1<{ id: string; title: string }>(`select id, title from zettels where user_id = ? and deleted_at is null`, [userId]),
    queryD1<{ id: string; title: string }>(`select id, title from projects where user_id = ? and deleted_at is null`, [userId]),
    queryD1<{ id: string; title: string; content: string | null; projectId: string | null }>(
      `select id, title, content, project_id as projectId
       from tasks
       where user_id = ? and deleted_at is null and import_batch_id = ?`,
      [userId, importBatchId],
    ),
    queryD1<{ id: string; title: string; content: string | null }>(
      `select id, title, content
       from zettels
       where user_id = ? and deleted_at is null and import_batch_id = ?`,
      [userId, importBatchId],
    ),
    queryD1<{ id: string; title: string; review: string | null }>(
      `select id, title, review
       from media_logs
       where user_id = ? and deleted_at is null and import_batch_id = ?`,
      [userId, importBatchId],
    ),
  ]);

  let taskProjects = 0;
  let taskPeople = 0;
  let taskZettels = 0;
  let zettelPeople = 0;
  let mediaPeople = 0;

  const people = peopleResult.rows
    .map((row) => ({ id: row.id, label: row.name.trim() }))
    .filter((row) => row.label.length >= 2);
  const zettels = zettelResult.rows
    .map((row) => ({ id: row.id, label: row.title.trim() }))
    .filter((row) => row.label.length >= 2);
  const projects = projectResult.rows
    .map((row) => ({ id: row.id, label: row.title.trim() }))
    .filter((row) => row.label.length >= 3)
    .sort((a, b) => b.label.length - a.label.length);

  for (const task of taskResult.rows) {
    const corpus = `${task.title}\n${task.content ?? ""}`;
    if (!task.projectId) {
      const matchedProject = projects.find((project) => containsWholeText(corpus, project.label));
      if (matchedProject) {
        const meta = await executeD1(
          `update tasks
           set project_id = ?, updated_at = datetime('now')
           where id = ? and user_id = ? and project_id is null`,
          [matchedProject.id, task.id, userId],
        );
        taskProjects += Number(meta.meta?.changes ?? 0);
      }
    }
    for (const person of people) {
      if (!containsWholeText(corpus, person.label)) continue;
      const meta = await executeD1(
        `insert or ignore into task_people_relations (task_id, person_id, role_context, created_at)
         values (?, ?, 'notion-import-match', datetime('now'))`,
        [task.id, person.id],
      );
      taskPeople += Number(meta.meta?.changes ?? 0);
    }
    for (const zettel of zettels) {
      if (!containsWholeText(corpus, zettel.label)) continue;
      const meta = await executeD1(
        `insert or ignore into task_zettel_relations (task_id, zettel_id, created_at)
         values (?, ?, datetime('now'))`,
        [task.id, zettel.id],
      );
      taskZettels += Number(meta.meta?.changes ?? 0);
    }
  }

  for (const zettel of importedZettels.rows) {
    const corpus = `${zettel.title}\n${zettel.content ?? ""}`;
    for (const person of people) {
      if (!containsWholeText(corpus, person.label)) continue;
      const meta = await executeD1(
        `insert or ignore into zettel_people_relations (zettel_id, person_id, context, created_at)
         values (?, ?, 'notion-import-match', datetime('now'))`,
        [zettel.id, person.id],
      );
      zettelPeople += Number(meta.meta?.changes ?? 0);
    }
  }

  for (const media of mediaResult.rows) {
    const corpus = `${media.title}\n${media.review ?? ""}`;
    for (const person of people) {
      if (!containsWholeText(corpus, person.label)) continue;
      const meta = await executeD1(
        `insert or ignore into media_people_relations (media_id, person_id, context, created_at)
         values (?, ?, 'notion-import-match', datetime('now'))`,
        [media.id, person.id],
      );
      mediaPeople += Number(meta.meta?.changes ?? 0);
    }
  }

  const linkedProjects = await queryD1<{ projectId: string | null }>(
    `select distinct project_id as projectId
     from tasks
     where user_id = ? and project_id is not null`,
    [userId],
  );
  for (const row of linkedProjects.rows) {
    if (row.projectId) {
      await refreshProjectProgress(userId, row.projectId);
    }
  }

  const summary = `taskProjects:${taskProjects}, taskPeople:${taskPeople}, taskZettels:${taskZettels}, zettelPeople:${zettelPeople}, mediaPeople:${mediaPeople}`;
  await writeAuditLog(userId, importBatchId, "settings.data.notion_restore", importBatchId, summary);
  return summary;
}

type ArchiveAsset = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  zettelNotionSourceId: string;
};

async function extractArchiveAssets(filePath: string, bytes: Uint8Array) {
  if (!filePath.toLowerCase().endsWith(".zip")) {
    return [] as ArchiveAsset[];
  }

  const archive = await JSZip.loadAsync(bytes);
  const files = Object.values(archive.files).filter((entry) => !entry.dir);
  const markdowns = await Promise.all(
    files
      .filter((entry) => /\.(md|markdown|txt)$/i.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        notionId: extractNotionIdFromFilename(entry.name),
        text: await entry.async("text"),
      })),
  );

  const assets: ArchiveAsset[] = [];
  for (const entry of files) {
    if (!/\.(png|jpe?g|webp|gif|svg|pdf)$/i.test(entry.name)) continue;
    const basename = entry.name.split("/").at(-1) ?? entry.name;
    const owner = markdowns.find((markdown) => markdown.notionId && (markdown.text.includes(basename) || markdown.text.includes(entry.name)));
    if (!owner?.notionId) continue;

    assets.push({
      filename: basename,
      bytes: new Uint8Array(await entry.async("uint8array")),
      mimeType: getMimeType(basename),
      zettelNotionSourceId: owner.notionId,
    });
  }

  return assets;
}

async function importArchiveAssets(userId: string, importBatchId: string, filePath: string, bytes: Uint8Array) {
  const assets = await extractArchiveAssets(filePath, bytes);
  if (!assets.length) {
    return { imported: 0, skipped: 0, summary: "attachments:0" };
  }

  const zettelRows = await queryD1<{ id: string; notionSourceId: string | null }>(
    `select id, notion_source_id as notionSourceId
     from zettels
     where user_id = ? and notion_source_id is not null and deleted_at is null`,
    [userId],
  );
  const zettelMap = new Map(zettelRows.rows.map((row) => [row.notionSourceId ?? "", row.id]));
  const client = createR2Client();

  let imported = 0;
  let skipped = 0;

  for (const asset of assets) {
    const ownerId = zettelMap.get(asset.zettelNotionSourceId);
    if (!ownerId) {
      skipped += 1;
      continue;
    }

    const existing = await queryD1<{ id: string }>(
      `select id
       from attachments
       where user_id = ? and owner_type = 'zettel' and owner_id = ? and filename = ?
       limit 1`,
      [userId, ownerId, asset.filename],
    );
    if (existing.rows[0]?.id) {
      skipped += 1;
      continue;
    }

    const attachmentId = ulid();
    const keys = buildAttachmentKeys(asset.filename, asset.mimeType);
    await client.send(
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: keys.originalKey,
        Body: Buffer.from(asset.bytes),
        ContentType: asset.mimeType,
      }),
    );

    let cdnUrl = buildInternalVariantUrl(attachmentId, "original");
    const meta: Record<string, unknown> = {
      version: 1,
      storage: {
        provider: "r2",
        bucket: getBucketName(),
        originalKey: keys.originalKey,
        previewKey: keys.previewKey,
        nasPath: keys.nasPath,
        previewStatus: "skipped",
      },
      urls: {
        preview: buildInternalVariantUrl(attachmentId, "preview"),
        original: buildInternalVariantUrl(attachmentId, "original"),
      },
    };

    if (asset.mimeType.startsWith("image/")) {
      const image = sharp(Buffer.from(asset.bytes));
      const info = await image.metadata();
      const previewBuffer = await image.rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      await client.send(
        new PutObjectCommand({
          Bucket: getBucketName(),
          Key: keys.previewKey,
          Body: previewBuffer,
          ContentType: "image/webp",
        }),
      );
      meta.storage = {
        provider: "r2",
        bucket: getBucketName(),
        originalKey: keys.originalKey,
        previewKey: keys.previewKey,
        nasPath: keys.nasPath,
        previewStatus: "ready",
      };
      meta.image = {
        originalMimeType: asset.mimeType,
        previewMimeType: "image/webp",
        width: info.width,
        height: info.height,
      };
      cdnUrl = buildInternalVariantUrl(attachmentId, "preview");
    }

    await executeD1(
      `insert into attachments
        (id, user_id, owner_type, owner_id, kind, r2_key, cdn_url, filename, mime_type, size_bytes, meta, created_at, updated_at)
       values (?, ?, 'zettel', ?, 'notion-import', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        attachmentId,
        userId,
        ownerId,
        keys.originalKey,
        cdnUrl,
        asset.filename,
        asset.mimeType,
        asset.bytes.length,
        JSON.stringify(meta),
      ],
    );
    imported += 1;
  }

  const summary = `attachments:${imported}, skipped:${skipped}, publicBase:${getR2PublicUrl() || "internal"}`;
  await writeAuditLog(userId, importBatchId, "settings.data.notion_assets", filePath, summary);
  return { imported, skipped, summary };
}

async function executeImport(userId: string, filePath: string) {
  const importBatchId = ulid();
  const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), filePath)));
  const bundle = await parseNotionImportFile(filePath, bytes);

  const [zettels, tasks, projects, people, gifts, dailyLogs, workouts, careerEntries, mediaLogs] = await Promise.all([
    insertZettels(userId, importBatchId, bundle),
    insertTasks(userId, importBatchId, bundle),
    insertProjects(userId, importBatchId, bundle),
    insertPeople(userId, importBatchId, bundle),
    insertGifts(userId, importBatchId, bundle),
    insertDailyLogs(userId, importBatchId, bundle),
    insertWorkouts(userId, importBatchId, bundle),
    insertCareerEntries(userId, importBatchId, bundle),
    insertMediaLogs(userId, importBatchId, bundle),
  ]);

  const restoreSummary = await restoreImportedRelations(userId, importBatchId);
  const assetResult = await importArchiveAssets(userId, importBatchId, filePath, bytes);
  const summary = `zettels:${zettels}, tasks:${tasks}, projects:${projects}, people:${people}, gifts:${gifts}, dailyLogs:${dailyLogs}, workouts:${workouts}, career:${careerEntries}, media:${mediaLogs} | restored ${restoreSummary} | ${assetResult.summary}`;
  await writeAuditLog(userId, importBatchId, "settings.data.notion_import", filePath, summary);

  return {
    summary,
    warnings: bundle.warnings,
  };
}

async function main() {
  loadEnvFile();

  const filePaths = process.argv.slice(2);
  if (!filePaths.length) {
    throw new Error("Usage: npm run db:notion-import -- <path-to-export.zip> [more-files...]");
  }

  const user = await ensureUser();

  for (const filePath of filePaths) {
    const result = await executeImport(user.id, filePath);

    console.log(`Imported ${filePath}`);
    console.log(result.summary);
    if (result.warnings.length) {
      console.log(`Warnings (${result.warnings.length})`);
      for (const warning of result.warnings) {
        console.log(`- ${warning}`);
      }
    }
  }
}

void main();
