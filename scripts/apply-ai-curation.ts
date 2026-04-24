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

async function applyReview(row: ReviewRow) {
  if (!row.entityId) return { action: "skip", reason: "missing entity id" };
  const confidence = row.confidence ?? 0;
  if (confidence < minConfidence) return { action: "skip", reason: "low confidence" };

  const payload = row.payload ? JSON.parse(row.payload) : {};

  if (row.issueType === "ai:archive_work" && row.entityType === "zettel") {
    await tagEntity(row.userId, "zettel", row.entityId, "archive-work", "Archive Work");
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
         and issue_type in ('ai:archive_work', 'ai:delete_auto_log')
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
