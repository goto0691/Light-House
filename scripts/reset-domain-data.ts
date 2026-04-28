import { existsSync, readFileSync } from "node:fs";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: { changes?: number }; results?: T[]; success?: boolean }>;
  success?: boolean;
};

type TableRow = { name: string };
type CountRow = { value: number };

const apply = process.argv.includes("--apply");

const RESET_TABLES = [
  "zettels_fts",
  "media_fts",
  "daily_logs_fts",
  "entity_links",
  "taggings",
  "attachments",
  "notifications",
  "quick_captures",
  "ai_conversations",
  "audit_logs",
  "project_people_relations",
  "project_zettel_relations",
  "task_people_relations",
  "task_zettel_relations",
  "checklists",
  "daily_entry_people_relations",
  "daily_log_people_relations",
  "media_people_relations",
  "zettel_people_relations",
  "zettel_media_relations",
  "zettel_links",
  "place_visits",
  "network_edges",
  "gifts",
  "interactions",
  "tasks",
  "projects",
  "daily_log_entries",
  "habit_logs",
  "health_metrics",
  "workouts",
  "career_history",
  "daily_logs",
  "habits",
  "media_logs",
  "zettels",
  "assets",
  "places",
  "people",
  "tags",
  "import_jobs",
  "import_batches",
] as const;

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

function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function countRows(table: string) {
  try {
    const result = await queryD1<CountRow>(`select count(*) as value from ${quoteIdent(table)}`);
    return Number(result.rows[0]?.value ?? 0);
  } catch {
    return 0;
  }
}

async function main() {
  loadEnv();
  const tableRows = await queryD1<TableRow>(
    `select name
     from sqlite_schema
     where type = 'table'
       and name not like 'sqlite_%'`,
  );
  const existingTables = new Set(tableRows.rows.map((row) => row.name));
  const summary: Record<string, { before: number; after?: number; changes?: number; skipped?: boolean }> = {};

  for (const table of RESET_TABLES) {
    if (!existingTables.has(table)) {
      summary[table] = { before: 0, skipped: true };
      continue;
    }
    const before = await countRows(table);
    summary[table] = { before };
    if (!apply || before === 0) {
      summary[table].after = before;
      summary[table].changes = 0;
      continue;
    }
    const result = await queryD1(`delete from ${quoteIdent(table)}`);
    const after = await countRows(table);
    summary[table].after = after;
    summary[table].changes = Number(result.meta.changes ?? before - after);
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summary }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
