import { existsSync, readFileSync } from "node:fs";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: { changes?: number }; results?: T[]; success?: boolean }>;
  success?: boolean;
};

type CountRow = { value: number };
type TextRow = { id: string; value: string | null };

const apply = process.argv.includes("--apply");

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

async function count(sql: string, params: unknown[] = []) {
  return Number((await queryD1<CountRow>(sql, params)).rows[0]?.value ?? 0);
}

async function countSafe(sql: string, params: unknown[] = []) {
  try {
    return await count(sql, params);
  } catch {
    return 0;
  }
}

async function exec(summary: Record<string, number>, label: string, sql: string, params: unknown[] = []) {
  if (!apply) {
    summary[label] = -1;
    return;
  }
  const result = await queryD1(sql, params);
  summary[label] = (summary[label] ?? 0) + Number(result.meta.changes ?? 0);
}

async function execSafe(summary: Record<string, number>, label: string, sql: string, params: unknown[] = []) {
  try {
    await exec(summary, label, sql, params);
  } catch (error) {
    summary[`${label}.skipped`] = 1;
    if (apply) console.warn(`${label} skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function scrubText(value: string | null | undefined) {
  let text = value ?? "";
  text = text.replace(/^\s*(컨텐츠|콘텐츠)\s*로그\s*[:：].*(?:\.md|\b[a-f0-9]{24,}\b).*$/gim, "");
  text = text.replace(/^\s*(source|출처)\s*[:：]\s*(notion|notion-import|notion markdown)\s*$/gim, "");
  text = text.replace(/\bnotion-import\b/gi, "");
  text = text.replace(/\bNotion Markdown\b/g, "");
  text = text.replace(/\s*\(https?:\/\/(?:www\.)?notion\.so\/[^)\s]+\)/gi, "");
  text = text.replace(/https?:\/\/(?:www\.)?notion\.so\/\S+/gi, "");
  text = text.replace(/\([^()\n]*[a-f0-9%]{16,}[^()\n]*\.md\)/gi, "");
  text = text.replace(/\[[^\]\n]+\]\([^)\n]*\.md\)/gi, (match) => match.replace(/^\[([^\]\n]+)\].*$/, "$1"));
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text || null;
}

async function scrubTableText(summary: Record<string, number>, table: string, column: string, where = "1=1") {
  const rows = (await queryD1<TextRow>(`select id, ${column} as value from ${table} where ${where} and ${column} is not null`)).rows;
  let changed = 0;
  for (const row of rows) {
    const next = scrubText(row.value);
    if ((row.value ?? null) === next) continue;
    changed += 1;
    await exec(summary, `${table}.${column}.scrubbed`, `update ${table} set ${column} = ?, updated_at = datetime('now') where id = ?`, [next, row.id]);
  }
  if (!apply) summary[`${table}.${column}.would_scrub`] = changed;
}

async function refreshFts() {
  if (!apply) return;
  await queryD1("delete from zettels_fts");
  await queryD1(
    `insert into zettels_fts(zettel_id, title, content_text, summary, category)
     select id, title, coalesce(content_text, ''), coalesce(summary, ''), coalesce(category, '')
     from zettels
     where deleted_at is null`,
  );
  await queryD1("delete from media_fts");
  await queryD1(
    `insert into media_fts(media_id, title, original_title, creator, review)
     select id, title, coalesce(original_title, ''), coalesce(creator, ''), coalesce(review, '')
     from media_logs
     where deleted_at is null`,
  );
  await queryD1("delete from daily_logs_fts");
  await queryD1(
    `insert into daily_logs_fts(log_id, date, journal, meditation, gratitude)
     select id, date, coalesce(journal, ''), coalesce(meditation, ''), coalesce(gratitude, '')
     from daily_logs
     where deleted_at is null`,
  );
}

async function main() {
  loadEnv();
  const summary: Record<string, number> = {};

  summary.sourceDocuments = await count("select count(*) value from source_documents");
  summary.sourceDocumentProperties = await count("select count(*) value from source_document_properties");
  summary.sourceDocumentRelations = await count("select count(*) value from source_document_relations");
  summary.migrationReviewItems = await count("select count(*) value from migration_review_items");
  summary.importBatches = await countSafe("select count(*) value from import_batches");
  summary.deletedZettels = await count("select count(*) value from zettels where deleted_at is not null");
  summary.deletedWorkouts = await count("select count(*) value from workouts where deleted_at is not null");
  summary.migrationAuditLogs = await count("select count(*) value from audit_logs where action like 'migration.%' or action like 'settings.data.notion_%' or import_batch_id is not null");
  summary.notionTags = await count("select count(*) value from tags where slug in ('needs-review', 'auto-log', 'empty-import')");
  summary.activeNeedsReviewTaggings = await count(
    `select count(*) value
     from taggings tg
     inner join tags t on t.id = tg.tag_id
     where t.slug in ('needs-review', 'auto-log', 'empty-import')`,
  );

  await scrubTableText(summary, "media_logs", "content", "deleted_at is null");
  await scrubTableText(summary, "media_logs", "review", "deleted_at is null");
  await scrubTableText(summary, "media_logs", "evaluation", "deleted_at is null");
  await scrubTableText(summary, "zettels", "content", "deleted_at is null");
  await scrubTableText(summary, "zettels", "content_text", "deleted_at is null");
  await scrubTableText(summary, "zettels", "summary", "deleted_at is null");
  await scrubTableText(summary, "daily_logs", "journal", "deleted_at is null");
  await scrubTableText(summary, "daily_logs", "meditation", "deleted_at is null");

  for (const table of ["projects", "tasks", "zettels", "people", "interactions", "gifts", "daily_logs", "workouts", "career_history", "media_logs"]) {
    await execSafe(summary, `${table}.identity_cleared`, `update ${table} set notion_source_id = null, import_batch_id = null, updated_at = datetime('now') where notion_source_id is not null or import_batch_id is not null`);
  }

  await exec(summary, "zettels.source_cleared", `update zettels set source = null, source_url = null, updated_at = datetime('now') where source like '%notion%' or source_url like '%notion%'`);

  await exec(summary, "source_document_properties.deleted", "delete from source_document_properties");
  await exec(summary, "source_document_relations.deleted", "delete from source_document_relations");
  await exec(summary, "migration_review_items.deleted", "delete from migration_review_items");
  await exec(summary, "source_documents.deleted", "delete from source_documents");
  await execSafe(summary, "import_batches.deleted", "delete from import_batches");

  await exec(summary, "migration_audit_logs.deleted", "delete from audit_logs where action like 'migration.%' or action like 'settings.data.notion_%' or import_batch_id is not null");
  await exec(summary, "audit_logs.import_batch_cleared", "update audit_logs set import_batch_id = null where import_batch_id is not null");

  await exec(
    summary,
    "migration_contexts.normalized",
    `update daily_log_people_relations
     set context = 'related'
     where lower(context) like '%migration%' or lower(context) like '%notion%'`,
  );
  await exec(
    summary,
    "relation_contexts.normalized",
    `update zettel_people_relations
     set context = 'related'
     where lower(context) like '%migration%' or lower(context) like '%notion%'`,
  );
  await exec(
    summary,
    "media_relation_contexts.normalized",
    `update media_people_relations
     set context = 'related'
     where lower(context) like '%migration%' or lower(context) like '%notion%'`,
  );

  await exec(
    summary,
    "migration_taggings.deleted",
    `delete from taggings
     where tag_id in (select id from tags where slug in ('needs-review', 'auto-log', 'empty-import'))`,
  );
  await exec(summary, "migration_tags.deleted", "delete from tags where slug in ('needs-review', 'auto-log', 'empty-import')");

  await exec(
    summary,
    "archive_work_zettels.purged",
    `delete from zettels
     where id in (
       select z.id
       from zettels z
       inner join taggings tg on tg.taggable_type = 'zettel' and tg.taggable_id = z.id
       inner join tags t on t.id = tg.tag_id
       where t.slug = 'archive-work'
         and z.title <> '네트워크 관련 CMD 명령어'
     )`,
  );
  await exec(
    summary,
    "archive_work_taggings.deleted",
    `delete from taggings
     where tag_id in (select id from tags where slug = 'archive-work')`,
  );
  await exec(summary, "archive_work_tags.deleted", "delete from tags where slug = 'archive-work'");

  await exec(summary, "deleted_zettels.purged", "delete from zettels where deleted_at is not null");
  await exec(summary, "deleted_workouts.purged", "delete from workouts where deleted_at is not null");
  await exec(summary, "orphan_zettel_media.deleted", "delete from zettel_media_relations where zettel_id not in (select id from zettels) or media_id not in (select id from media_logs)");
  await exec(summary, "orphan_zettel_people.deleted", "delete from zettel_people_relations where zettel_id not in (select id from zettels) or person_id not in (select id from people)");
  await exec(summary, "orphan_zettel_links.deleted", "delete from zettel_links where source_id not in (select id from zettels) or target_id not in (select id from zettels)");

  await refreshFts();

  const remaining = {
    sourceDocuments: await count("select count(*) value from source_documents"),
    migrationReviewItems: await count("select count(*) value from migration_review_items"),
    importBatches: await countSafe("select count(*) value from import_batches"),
    deletedZettels: await count("select count(*) value from zettels where deleted_at is not null"),
    deletedWorkouts: await count("select count(*) value from workouts where deleted_at is not null"),
    notionIdentityRows:
      (await countSafe("select count(*) value from zettels where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from media_logs where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from daily_logs where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from people where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from projects where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from tasks where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from workouts where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from gifts where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from interactions where notion_source_id is not null or import_batch_id is not null")) +
      (await countSafe("select count(*) value from career_history where notion_source_id is not null or import_batch_id is not null")),
    visibleNotionText:
      (await count("select count(*) value from media_logs where deleted_at is null and (content like '%notion%' or review like '%notion%' or evaluation like '%notion%' or content like '%.md%' or review like '%.md%')")) +
      (await count("select count(*) value from zettels where deleted_at is null and (content like '%notion%' or content_text like '%notion%' or summary like '%notion%' or content like '%.md%' or content_text like '%.md%')")),
  };

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summary, remaining }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
