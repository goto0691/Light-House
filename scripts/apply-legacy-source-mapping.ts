import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Result<T> = { meta?: { changes?: number }; results?: T[]; success?: boolean };
type D1Envelope<T> = { errors?: Array<{ message?: string }>; result?: Array<D1Result<T>>; success?: boolean };

type SourceDocumentRow = {
  id: string;
  sourceId: string;
  sourceDatabase: string | null;
  title: string;
  documentRole: string | null;
  rawContent: string | null;
  rawContentPreview: string | null;
};

type SourcePropertyRow = {
  sourceDocumentId: string;
  propertyName: string;
  valueText: string | null;
  normalizedValue: string | null;
};

type EntityRow = {
  id: string;
  title?: string;
  name?: string;
  organization?: string;
  date?: string;
  mediaType?: string;
  sourceDocumentId?: string | null;
};

type SourceResolution = {
  sourceDocumentId: string;
  entityType: string;
  entityId: string;
};

const args = process.argv.slice(2);
const shouldApply = args.includes("--apply");

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

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
  const response = await fetch(endpoint, {
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

async function execD1(sql: string, params: unknown[] = []) {
  return queryD1(sql, params);
}

async function queryAll<T>(sql: string, params: unknown[] = [], pageSize = 1000) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await queryD1<T>(`${sql} limit ${pageSize} offset ${offset}`, params);
    rows.push(...page.rows);
    if (page.rows.length < pageSize) break;
  }
  return rows;
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function hashId(prefix: string, ...parts: string[]) {
  return `${prefix}_${sha1(parts.join("\u001f")).slice(0, 26)}`;
}

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function titleKey(value: string | null | undefined) {
  return compact(value)
    .replace(/[.。]+$/g, "")
    .toLowerCase();
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || sha1(value).slice(0, 16)
  );
}

function normalizeDate(value: string | null | undefined) {
  const text = compact(value);
  const korean = text.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2})[:：](\d{1,2}))?/);
  if (korean) {
    const date = `${korean[1]}-${korean[2].padStart(2, "0")}-${korean[3].padStart(2, "0")}`;
    if (!korean[4]) return date;
    let hour = Number(korean[5]);
    if (korean[4] === "오후" && hour < 12) hour += 12;
    if (korean[4] === "오전" && hour === 12) hour = 0;
    return `${date}T${String(hour).padStart(2, "0")}:${korean[6].padStart(2, "0")}:00+09:00`;
  }
  return text.match(/(\d{4})-(\d{2})-(\d{2})/)?.[0] ?? null;
}

function dateOnly(value: string | null | undefined) {
  return normalizeDate(value)?.slice(0, 10) ?? null;
}

function stripMarkdown(value: string | null | undefined) {
  return compact(
    (value ?? "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~-]/g, " "),
  );
}

function mapMediaStatus(value: string | null | undefined) {
  const status = compact(value);
  if (/완료|읽음|클리어|엔딩/i.test(status)) return "completed";
  if (/보는 중|진행|플레이중|읽는 중/i.test(status)) return "consuming";
  return "backlog";
}

function parseNumber(value: string | null | undefined) {
  const text = compact(value).replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function yesNo(value: string | null | undefined) {
  return /^(yes|true|y|1|예)$/i.test(compact(value)) ? 1 : 0;
}

function createPropertyIndex(properties: SourcePropertyRow[]) {
  const bySource = new Map<string, Map<string, SourcePropertyRow[]>>();
  for (const property of properties) {
    const sourceMap = bySource.get(property.sourceDocumentId) ?? new Map<string, SourcePropertyRow[]>();
    const list = sourceMap.get(property.propertyName) ?? [];
    list.push(property);
    sourceMap.set(property.propertyName, list);
    bySource.set(property.sourceDocumentId, sourceMap);
  }
  return bySource;
}

function prop(sourceMap: Map<string, SourcePropertyRow[]> | undefined, ...names: string[]) {
  for (const name of names) {
    const found = sourceMap?.get(name)?.find((item) => compact(item.valueText));
    if (found?.valueText) return found.valueText;
  }
  return null;
}

function propNormalized(sourceMap: Map<string, SourcePropertyRow[]> | undefined, ...names: string[]) {
  for (const name of names) {
    const found = sourceMap?.get(name)?.find((item) => compact(item.normalizedValue ?? item.valueText));
    if (found?.normalizedValue) return found.normalizedValue;
    if (found?.valueText) return found.valueText;
  }
  return null;
}

function mapByTitle(rows: EntityRow[]) {
  const map = new Map<string, EntityRow>();
  for (const row of rows) {
    const key = titleKey(row.title ?? row.name ?? row.organization);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function isPlaceholderSource(doc: SourceDocumentRow, sourceMap: Map<string, SourcePropertyRow[]> | undefined) {
  const body = compact(doc.rawContent ?? doc.rawContentPreview ?? prop(sourceMap, "본문"));
  const disabledFlags = ["오늘 일기", "오늘 묵상", "오늘 운동"].every((name) => compact(prop(sourceMap, name)).includes("❌"));
  return disabledFlags || (/^🗓️@오늘$/.test(doc.title) && body.length < 500);
}

async function bulkInsert(table: string, columns: string[], rows: unknown[][], suffix = "", maxParams = 90) {
  const chunkSize = Math.max(1, Math.floor(maxParams / columns.length));
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    await execD1(`insert into ${table} (${columns.join(", ")}) values ${placeholders} ${suffix}`, chunk.flat());
  }
}

async function bulkResolveSources(resolutions: SourceResolution[]) {
  for (let index = 0; index < resolutions.length; index += 15) {
    const chunk = resolutions.slice(index, index + 15);
    const typeCase = chunk.map(() => "when id = ? then ?").join(" ");
    const idCase = chunk.map(() => "when id = ? then ?").join(" ");
    await execD1(
      `update source_documents
       set canonical_entity_type = case ${typeCase} else canonical_entity_type end,
           canonical_entity_id = case ${idCase} else canonical_entity_id end,
           status = 'resolved',
           resolved_at = datetime('now'),
           updated_at = datetime('now')
       where id in (${chunk.map(() => "?").join(", ")})`,
      [
        ...chunk.flatMap((item) => [item.sourceDocumentId, item.entityType]),
        ...chunk.flatMap((item) => [item.sourceDocumentId, item.entityId]),
        ...chunk.map((item) => item.sourceDocumentId),
      ],
    );
  }
}

async function bulkArchiveSources(sourceDocumentIds: string[]) {
  for (let index = 0; index < sourceDocumentIds.length; index += 25) {
    const chunk = sourceDocumentIds.slice(index, index + 25);
    await execD1(
      `update source_documents
       set canonical_entity_type = 'archive',
           canonical_entity_id = id,
           status = 'archived',
           resolved_at = datetime('now'),
           updated_at = datetime('now')
       where id in (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
  }
}

async function dedupeWorkouts(userId: string) {
  const groups = await queryD1<{ date: string; title: string; count: number }>(
    `select date, title, count(*) as count
     from workouts
     where user_id = ? and deleted_at is null
     group by date, title
     having count(*) > 1`,
    [userId],
  );
  let deleted = 0;
  for (const group of groups.rows) {
    const rows = await queryD1<{ id: string; sourceDocumentId: string | null; canonicalRefs: number | null }>(
      `select w.id,
              w.source_document_id as sourceDocumentId,
              (select count(*)
               from source_documents sd
               where sd.canonical_entity_type = 'workout'
                 and sd.canonical_entity_id = w.id
                 and sd.deleted_at is null) as canonicalRefs
       from workouts w
       where w.user_id = ? and w.date = ? and w.title = ? and w.deleted_at is null
       order by canonicalRefs desc,
                case when w.source_document_id is null then 1 else 0 end,
                w.updated_at desc,
                w.id asc`,
      [userId, group.date, group.title],
    );
    const [keeper, ...duplicates] = rows.rows;
    if (!keeper || !duplicates.length) continue;
    const duplicateIds = duplicates.map((row) => row.id);
    await execD1(
      `update source_documents
       set canonical_entity_id = ?, updated_at = datetime('now')
       where canonical_entity_type = 'workout'
         and canonical_entity_id in (${duplicateIds.map(() => "?").join(", ")})`,
      [keeper.id, ...duplicateIds],
    );
    await execD1(
      `update workouts
       set deleted_at = datetime('now'), updated_at = datetime('now')
       where user_id = ? and id in (${duplicateIds.map(() => "?").join(", ")})`,
      [userId, ...duplicateIds],
    );
    deleted += duplicateIds.length;
  }
  return deleted;
}

async function main() {
  loadEnv();
  const user = (await queryD1<{ id: string }>("select id from users order by created_at asc limit 1")).rows[0];
  if (!user) throw new Error("No user found.");

  const [
    sourceDocs,
    sourceProperties,
    existingZettels,
    existingMedia,
    existingPeople,
    existingDailyLogs,
    existingWorkouts,
    existingProjects,
    existingCareer,
  ] =
    await Promise.all([
      queryAll<SourceDocumentRow>(
        `select id, source_id sourceId, source_database sourceDatabase, title, document_role documentRole,
                raw_content rawContent, raw_content_preview rawContentPreview
         from source_documents
         where source_type = 'legacy_export' and deleted_at is null
         order by id`,
      ),
      queryAll<SourcePropertyRow>(
        `select source_document_id sourceDocumentId, property_name propertyName, value_text valueText, normalized_value normalizedValue
         from source_document_properties
         order by source_document_id, property_name`,
        [],
        2000,
      ),
      queryAll<EntityRow>(`select id, title from zettels where user_id = ? and deleted_at is null`, [user.id]),
      queryAll<EntityRow>(`select id, title, media_type mediaType from media_logs where user_id = ? and deleted_at is null`, [user.id]),
      queryAll<EntityRow>(`select id, name from people where user_id = ? and deleted_at is null`, [user.id]),
      queryAll<EntityRow>(`select id, date from daily_logs where user_id = ?`, [user.id]),
      queryAll<EntityRow>(
        `select id, title, date, source_document_id as sourceDocumentId
         from workouts
         where user_id = ? and deleted_at is null
         order by case when source_document_id is null then 1 else 0 end, updated_at desc, id asc`,
        [user.id],
      ),
      queryAll<EntityRow>(`select id, title from projects where user_id = ? and deleted_at is null`, [user.id]),
      queryAll<EntityRow>(`select id, organization from career_history where user_id = ? and deleted_at is null`, [user.id]),
    ]);

  const propertiesBySource = createPropertyIndex(sourceProperties);
  const zettelByTitle = mapByTitle(existingZettels);
  const mediaByTitle = mapByTitle(existingMedia);
  const peopleByName = mapByTitle(existingPeople);
  const dailyByDate = new Map(existingDailyLogs.map((row) => [row.date ?? "", row]));
  const workoutByTitleDate = new Map(existingWorkouts.map((row) => [`${dateOnly(row.date) ?? row.date}:${titleKey(row.title)}`, row]));
  const projectByTitle = mapByTitle(existingProjects);
  const careerByOrganization = mapByTitle(existingCareer);

  const zettelRows: unknown[][] = [];
  const mediaRows: unknown[][] = [];
  const peopleRows: unknown[][] = [];
  const dailyRows: unknown[][] = [];
  const dailyEntryRows: unknown[][] = [];
  const workoutRows: unknown[][] = [];
  const projectRows: unknown[][] = [];
  const careerRows: unknown[][] = [];
  const resolutions: SourceResolution[] = [];
  const archivedSources: string[] = [];
  const seenEntityRows = new Set<string>();
  const now = new Date().toISOString();
  const summary = {
    sourceDocuments: sourceDocs.length,
    zettels: 0,
    media: 0,
    people: 0,
    dailyLogs: 0,
    dailyEntries: 0,
    workouts: 0,
    projects: 0,
    career: 0,
    archived: 0,
    dedupedWorkouts: 0,
    resolvedSources: 0,
    skipped: 0,
  };

  function remember(table: string, id: string) {
    const key = `${table}:${id}`;
    if (seenEntityRows.has(key)) return false;
    seenEntityRows.add(key);
    return true;
  }

  for (const doc of sourceDocs) {
    const role = doc.documentRole ?? "";
    const sourceMap = propertiesBySource.get(doc.id);
    const body = doc.rawContent ?? prop(sourceMap, "본문") ?? doc.rawContentPreview ?? "";

    if (role === "knowledge") {
      const existing = zettelByTitle.get(titleKey(doc.title));
      const id = existing?.id ?? hashId("ztl", doc.id);
      if (remember("zettels", id)) {
        const summaryText = prop(sourceMap, "한 줄 요약", "본문.한 줄 요약");
        const category = prop(sourceMap, "카테고리", "본문.카테고리") ?? "문서 아카이브";
        const kind = prop(sourceMap, "유형", "본문.유형") ?? "reference";
        zettelRows.push([
          id,
          user.id,
          doc.id,
          doc.title,
          slugify(doc.title),
          body,
          stripMarkdown(body),
          summaryText,
          "reference",
          category,
          "active",
          kind,
          normalizeDate(propNormalized(sourceMap, "생성 일시", "본문.생성 일시")),
          prop(sourceMap, "출처", "본문.출처"),
          now,
          now,
        ]);
        summary.zettels += 1;
      }
      resolutions.push({ sourceDocumentId: doc.id, entityType: "zettel", entityId: id });
      continue;
    }

    if (role.startsWith("media-")) {
      const existing = mediaByTitle.get(titleKey(doc.title));
      const mediaType = role === "media-game" ? "game" : role === "media-book" ? "book" : "screen";
      const id = existing?.id ?? hashId("med", mediaType, doc.title);
      if (remember("media_logs", id)) {
        const review = prop(sourceMap, "리뷰", "평가", "한줄평") ?? "";
        mediaRows.push([
          id,
          user.id,
          doc.id,
          mediaType,
          doc.title,
          null,
          prop(sourceMap, "유형", "분류"),
          prop(sourceMap, "플랫폼", "출판사"),
          prop(sourceMap, "감독/크리에이터", "감독", "개발사", "저자"),
          prop(sourceMap, "제작사", "개발사"),
          prop(sourceMap, "장르"),
          mapMediaStatus(prop(sourceMap, "시청상태", "상태")),
          parseNumber(prop(sourceMap, "평점")),
          prop(sourceMap, "평가"),
          review || stripMarkdown(body).slice(0, 1200),
          body,
          parseNumber(prop(sourceMap, "플레이 타임")),
          prop(sourceMap, "저자"),
          yesNo(prop(sourceMap, "다시 볼 가치")),
          normalizeDate(propNormalized(sourceMap, "날짜")),
          mapMediaStatus(prop(sourceMap, "시청상태", "상태")) === "completed" ? normalizeDate(propNormalized(sourceMap, "날짜")) : null,
          now,
          now,
        ]);
        summary.media += 1;
      }
      resolutions.push({ sourceDocumentId: doc.id, entityType: "media", entityId: id });
      continue;
    }

    if (role === "person") {
      const existing = peopleByName.get(titleKey(doc.title));
      const id = existing?.id ?? hashId("per", doc.title);
      if (remember("people", id)) {
        peopleRows.push([
          id,
          user.id,
          doc.id,
          doc.title,
          prop(sourceMap, "별칭"),
          normalizeDate(propNormalized(sourceMap, "생일")),
          prop(sourceMap, "생일까지"),
          prop(sourceMap, "그룹"),
          prop(sourceMap, "핵심 가치"),
          stripMarkdown(body).slice(0, 1600),
          body,
          normalizeDate(propNormalized(sourceMap, "마지막 연락일")),
          prop(sourceMap, "주소"),
          compact(prop(sourceMap, "상태")) || "active",
          /yes|true|즐겨찾기/i.test(prop(sourceMap, "즐겨찾기 1") ?? "") ? 1 : 0,
          now,
          now,
        ]);
        summary.people += 1;
      }
      resolutions.push({ sourceDocumentId: doc.id, entityType: "person", entityId: id });
      continue;
    }

    if (role === "life-log" || role === "journal" || role === "meditation") {
      const date = dateOnly(propNormalized(sourceMap, "날짜")) ?? dateOnly(doc.title);
      if (!date) {
        if (isPlaceholderSource(doc, sourceMap)) {
          archivedSources.push(doc.id);
          summary.archived += 1;
          continue;
        }
        const id = zettelByTitle.get(titleKey(doc.title))?.id ?? hashId("ztl", doc.id);
        if (remember("zettels", id)) {
          zettelRows.push([
            id,
            user.id,
            doc.id,
            doc.title,
            slugify(doc.title),
            body,
            stripMarkdown(body),
            prop(sourceMap, "한 줄 요약", "본문.한 줄 요약"),
            "reference",
            role === "meditation" ? "묵상" : "개인적 기록",
            "active",
            role,
            null,
            "legacy journal",
            now,
            now,
          ]);
          summary.zettels += 1;
        }
        resolutions.push({ sourceDocumentId: doc.id, entityType: "zettel", entityId: id });
        continue;
      }
      const dailyId = dailyByDate.get(date)?.id ?? `daily-${date}`;
      if (remember("daily_logs", dailyId)) {
        dailyRows.push([dailyId, user.id, role === "life-log" ? doc.id : null, date, now, now]);
        summary.dailyLogs += 1;
      }
      if (role === "journal" || role === "meditation") {
        const entryId = hashId("dle", doc.id);
        const kind = role === "journal" ? "journal" : "meditation";
        dailyEntryRows.push([
          entryId,
          user.id,
          dailyId,
          doc.id,
          kind,
          doc.title,
          date,
          body,
          prop(sourceMap, "감정"),
          prop(sourceMap, "사건"),
          role === "meditation" ? doc.title : null,
          prop(sourceMap, "배경지식"),
          prop(sourceMap, "태그"),
          now,
          now,
        ]);
        summary.dailyEntries += 1;
        resolutions.push({ sourceDocumentId: doc.id, entityType: "daily_entry", entityId: entryId });
      } else {
        resolutions.push({ sourceDocumentId: doc.id, entityType: "daily_log", entityId: dailyId });
      }
      continue;
    }

    if (role === "workout") {
      const dateValue = normalizeDate(propNormalized(sourceMap, "날짜")) ?? normalizeDate(doc.title);
      const date = dateOnly(dateValue);
      if (!date) {
        summary.skipped += 1;
        continue;
      }
      const key = `${date}:${titleKey(doc.title)}`;
      const existing = workoutByTitleDate.get(key);
      const id = existing?.id ?? hashId("wko", date, doc.title);
      if (remember("workouts", id)) {
        workoutRows.push([id, user.id, doc.id, doc.title, dateValue ?? date, prop(sourceMap, "운동 종류") || "운동", body, now, now]);
        summary.workouts += 1;
      }
      resolutions.push({ sourceDocumentId: doc.id, entityType: "workout", entityId: id });
      continue;
    }

    if (role === "project") {
      const existing = projectByTitle.get(titleKey(doc.title));
      const id = existing?.id ?? hashId("prj", doc.title);
      if (remember("projects", id)) {
        projectRows.push([
          id,
          user.id,
          doc.id,
          doc.title,
          slugify(doc.title),
          body || prop(sourceMap, "대분류"),
          "project",
          prop(sourceMap, "상태") || "active",
          prop(sourceMap, "대분류"),
          prop(sourceMap, "중요도"),
          prop(sourceMap, "뇌 에너지 소모"),
          prop(sourceMap, "산출물 링크"),
          normalizeDate(propNormalized(sourceMap, "작업기간")),
          now,
          now,
        ]);
        summary.projects += 1;
      }
      resolutions.push({ sourceDocumentId: doc.id, entityType: "project", entityId: id });
      continue;
    }

    if (role === "career") {
      const existing = careerByOrganization.get(titleKey(doc.title));
      const id = existing?.id ?? hashId("car", doc.title);
      if (remember("career_history", id)) {
        careerRows.push([
          id,
          user.id,
          doc.id,
          doc.title,
          prop(sourceMap, "역할") || "업무 아카이브",
          prop(sourceMap, "카테고리") || "archive",
          normalizeDate(propNormalized(sourceMap, "근무기간")) ?? "1970-01-01",
          null,
          body || prop(sourceMap, "본문"),
          now,
          now,
        ]);
        summary.career += 1;
      }
      resolutions.push({ sourceDocumentId: doc.id, entityType: "career", entityId: id });
      continue;
    }

    summary.skipped += 1;
  }

  summary.resolvedSources = resolutions.length + archivedSources.length;

  if (shouldApply) {
    await bulkInsert(
      "zettels",
      [
        "id",
        "user_id",
        "source_document_id",
        "title",
        "slug",
        "content",
        "content_text",
        "summary",
        "type",
        "category",
        "status",
        "document_kind",
        "original_created_at",
        "source",
        "created_at",
        "updated_at",
      ],
      zettelRows,
      `on conflict(id) do update set
        source_document_id = excluded.source_document_id,
        title = excluded.title,
        slug = excluded.slug,
        content = excluded.content,
        content_text = excluded.content_text,
        summary = excluded.summary,
        type = excluded.type,
        category = excluded.category,
        status = excluded.status,
        document_kind = excluded.document_kind,
        original_created_at = excluded.original_created_at,
        source = excluded.source,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "media_logs",
      [
        "id",
        "user_id",
        "source_document_id",
        "media_type",
        "title",
        "original_title",
        "subtype",
        "platform_or_publisher",
        "creator",
        "studio",
        "genre",
        "status",
        "rating",
        "evaluation",
        "review",
        "content",
        "play_time",
        "author",
        "rewatch_value",
        "logged_at",
        "completed_at",
        "created_at",
        "updated_at",
      ],
      mediaRows,
      `on conflict(id) do update set
        source_document_id = excluded.source_document_id,
        media_type = excluded.media_type,
        title = excluded.title,
        subtype = excluded.subtype,
        platform_or_publisher = excluded.platform_or_publisher,
        creator = excluded.creator,
        studio = excluded.studio,
        genre = excluded.genre,
        status = excluded.status,
        rating = excluded.rating,
        evaluation = excluded.evaluation,
        review = excluded.review,
        content = excluded.content,
        play_time = excluded.play_time,
        author = excluded.author,
        rewatch_value = excluded.rewatch_value,
        logged_at = excluded.logged_at,
        completed_at = excluded.completed_at,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "people",
      [
        "id",
        "user_id",
        "source_document_id",
        "name",
        "aliases",
        "birth_date",
        "birthday_memo",
        "groups",
        "core_value",
        "bio",
        "profile_body",
        "last_contacted_at",
        "address",
        "status",
        "is_favorite",
        "created_at",
        "updated_at",
      ],
      peopleRows,
      `on conflict(id) do update set
        source_document_id = excluded.source_document_id,
        aliases = excluded.aliases,
        birth_date = excluded.birth_date,
        birthday_memo = excluded.birthday_memo,
        groups = excluded.groups,
        core_value = excluded.core_value,
        bio = excluded.bio,
        profile_body = excluded.profile_body,
        last_contacted_at = excluded.last_contacted_at,
        address = excluded.address,
        status = excluded.status,
        is_favorite = excluded.is_favorite,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "daily_logs",
      ["id", "user_id", "source_document_id", "date", "created_at", "updated_at"],
      dailyRows,
      `on conflict(id) do update set
        source_document_id = coalesce(excluded.source_document_id, daily_logs.source_document_id),
        date = excluded.date,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "daily_log_entries",
      [
        "id",
        "user_id",
        "daily_log_id",
        "source_document_id",
        "kind",
        "title",
        "date",
        "body",
        "emotion",
        "event_summary",
        "verse",
        "background",
        "tags_snapshot",
        "created_at",
        "updated_at",
      ],
      dailyEntryRows,
      `on conflict(id) do update set
        daily_log_id = excluded.daily_log_id,
        source_document_id = excluded.source_document_id,
        kind = excluded.kind,
        title = excluded.title,
        date = excluded.date,
        body = excluded.body,
        emotion = excluded.emotion,
        event_summary = excluded.event_summary,
        verse = excluded.verse,
        background = excluded.background,
        tags_snapshot = excluded.tags_snapshot,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "workouts",
      ["id", "user_id", "source_document_id", "title", "date", "categories", "notes", "created_at", "updated_at"],
      workoutRows,
      `on conflict(id) do update set
        source_document_id = excluded.source_document_id,
        title = excluded.title,
        date = excluded.date,
        categories = excluded.categories,
        notes = excluded.notes,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "projects",
      [
        "id",
        "user_id",
        "source_document_id",
        "title",
        "slug",
        "description",
        "kind",
        "status",
        "category",
        "importance",
        "brain_energy",
        "artifact_url",
        "start_date",
        "created_at",
        "updated_at",
      ],
      projectRows,
      `on conflict(id) do update set
        source_document_id = excluded.source_document_id,
        title = excluded.title,
        slug = excluded.slug,
        description = excluded.description,
        kind = excluded.kind,
        status = excluded.status,
        category = excluded.category,
        importance = excluded.importance,
        brain_energy = excluded.brain_energy,
        artifact_url = excluded.artifact_url,
        start_date = excluded.start_date,
        updated_at = datetime('now')`,
    );
    await bulkInsert(
      "career_history",
      ["id", "user_id", "source_document_id", "organization", "role", "category", "start_date", "end_date", "description", "created_at", "updated_at"],
      careerRows,
      `on conflict(id) do update set
        source_document_id = excluded.source_document_id,
        organization = excluded.organization,
        role = excluded.role,
        category = excluded.category,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        description = excluded.description,
        updated_at = datetime('now')`,
    );
    await bulkResolveSources(resolutions);
    await bulkArchiveSources(archivedSources);
    summary.dedupedWorkouts = await dedupeWorkouts(user.id);
  }

  console.log(JSON.stringify({ mode: shouldApply ? "apply" : "dry-run", ...summary }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
