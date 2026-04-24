import { ulid } from "ulidx";

import { buildNotionImportPreview, parseNotionImportFile, type NotionImportBundle } from "@/lib/notion-import-core";
import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

async function writeAuditLog(userId: string, importBatchId: string, action: string, entityId: string, snapshot: string) {
  await executeD1(
    `insert into audit_logs (id, user_id, import_batch_id, action, entity_type, entity_id, snapshot, created_at)
     values (?, ?, ?, ?, 'notion_import', ?, ?, datetime('now'))`,
    [ulid(), userId, importBatchId, action, entityId, snapshot],
  );
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

export async function previewNotionImport(filename: string, bytes: Uint8Array) {
  const bundle = await parseNotionImportFile(filename, bytes);
  return buildNotionImportPreview(filename, bundle);
}

type NamedEntityRow = {
  id: string;
  title?: string | null;
  name?: string | null;
  content?: string | null;
  review?: string | null;
};

type ImportedTaskRow = {
  id: string;
  title: string;
  content: string | null;
  projectId?: string | null;
};

type ImportedZettelRow = {
  id: string;
  title: string;
  content: string | null;
};

type ImportedMediaRow = {
  id: string;
  title: string;
  review: string | null;
};

type ImportedProjectRow = {
  id: string;
  title: string;
};

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

export async function restoreImportedRelationsForUser(userId: string, importBatchId?: string) {
  const batchFilter = importBatchId ? "and import_batch_id = ?" : "";
  const params = importBatchId ? [userId, importBatchId] : [userId];

  const [peopleResult, zettelTitleResult, taskResult, projectResult, zettelResult, mediaResult] = await Promise.all([
    queryD1<NamedEntityRow>(
      `select id, name
       from people
       where user_id = ? and deleted_at is null`,
      [userId],
    ),
    queryD1<NamedEntityRow>(
      `select id, title
       from zettels
       where user_id = ? and deleted_at is null`,
      [userId],
    ),
    queryD1<ImportedTaskRow>(
      `select id, title, content, project_id as projectId
       from tasks
       where user_id = ? and deleted_at is null ${batchFilter}`,
      params,
    ),
    queryD1<ImportedProjectRow>(
      `select id, title
       from projects
       where user_id = ? and deleted_at is null`,
      [userId],
    ),
    queryD1<ImportedZettelRow>(
      `select id, title, content
       from zettels
       where user_id = ? and deleted_at is null ${batchFilter}`,
      params,
    ),
    queryD1<ImportedMediaRow>(
      `select id, title, review
       from media_logs
       where user_id = ? and deleted_at is null ${batchFilter}`,
      params,
    ),
  ]);

  let taskPeople = 0;
  let taskZettels = 0;
  let taskProjects = 0;
  let zettelPeople = 0;
  let mediaPeople = 0;

  const people = peopleResult.rows
    .map((row) => ({ id: row.id, label: row.name?.trim() ?? "" }))
    .filter((row) => row.label.length >= 2);
  const zettels = zettelTitleResult.rows
    .map((row) => ({ id: row.id, label: row.title?.trim() ?? "" }))
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
        taskProjects += Number(meta.changes ?? 0);
      }
    }
    for (const person of people) {
      if (!containsWholeText(corpus, person.label)) continue;
      const meta = await executeD1(
        `insert or ignore into task_people_relations (task_id, person_id, role_context, created_at)
         values (?, ?, 'notion-import-match', datetime('now'))`,
        [task.id, person.id],
      );
      taskPeople += Number(meta.changes ?? 0);
    }
    for (const zettel of zettels) {
      if (zettel.id === task.id || !containsWholeText(corpus, zettel.label)) continue;
      const meta = await executeD1(
        `insert or ignore into task_zettel_relations (task_id, zettel_id, created_at)
         values (?, ?, datetime('now'))`,
        [task.id, zettel.id],
      );
      taskZettels += Number(meta.changes ?? 0);
    }
  }

  for (const zettel of zettelResult.rows) {
    const corpus = `${zettel.title}\n${zettel.content ?? ""}`;
    for (const person of people) {
      if (!containsWholeText(corpus, person.label)) continue;
      const meta = await executeD1(
        `insert or ignore into zettel_people_relations (zettel_id, person_id, context, created_at)
         values (?, ?, 'notion-import-match', datetime('now'))`,
        [zettel.id, person.id],
      );
      zettelPeople += Number(meta.changes ?? 0);
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
      mediaPeople += Number(meta.changes ?? 0);
    }
  }

  const touchedProjectIds = new Set<string>();
  const linkedTasks = await queryD1<{ projectId: string | null }>(
    `select distinct project_id as projectId
     from tasks
     where user_id = ? and project_id is not null`,
    [userId],
  );
  for (const row of linkedTasks.rows) {
    if (row.projectId) touchedProjectIds.add(row.projectId);
  }
  for (const projectId of touchedProjectIds) {
    await refreshProjectProgress(userId, projectId);
  }

  const summary = `taskProjects:${taskProjects}, taskPeople:${taskPeople}, taskZettels:${taskZettels}, zettelPeople:${zettelPeople}, mediaPeople:${mediaPeople}`;
  if (importBatchId) {
    await writeAuditLog(userId, importBatchId, "settings.data.notion_restore", importBatchId, summary);
  }

  return {
    importBatchId: importBatchId ?? null,
    restored: {
      taskProjects,
      taskPeople,
      taskZettels,
      zettelPeople,
      mediaPeople,
    },
    summary,
  };
}

export async function executeNotionImportForUser(userId: string, filename: string, bytes: Uint8Array) {
  const bundle = await parseNotionImportFile(filename, bytes);
  const importBatchId = ulid();

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

  const restore = await restoreImportedRelationsForUser(userId, importBatchId);
  const summary = `zettels:${zettels}, tasks:${tasks}, projects:${projects}, people:${people}, gifts:${gifts}, dailyLogs:${dailyLogs}, workouts:${workouts}, career:${careerEntries}, media:${mediaLogs} | restored ${restore.summary}`;
  await writeAuditLog(userId, importBatchId, "settings.data.notion_import", filename, summary);

  return {
    fileName: filename,
    importBatchId,
    created: { zettels, tasks, projects, people, gifts, dailyLogs, workouts, careerEntries, mediaLogs },
    restored: restore.restored,
    warnings: bundle.warnings,
    summary,
  };
}

export async function executeNotionImport(filename: string, bytes: Uint8Array) {
  const { resolveCurrentUser } = await import("@/lib/server/session-user");
  const user = await resolveCurrentUser();
  return executeNotionImportForUser(user.id, filename, bytes);
}
