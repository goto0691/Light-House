import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: { changes?: number }; results?: T[]; success?: boolean }>;
  success?: boolean;
};

type TableRow = { name: string };
type CountRow = { value: number };

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

async function queryAll<T>(table: string, pageSize = 500) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await queryD1<T>(`select * from ${quoteIdent(table)} limit ${pageSize} offset ${offset}`);
    rows.push(...page.rows);
    if (page.rows.length < pageSize) break;
  }
  return rows;
}

async function main() {
  loadEnv();
  const backupDir = join(process.cwd(), "logs", "backups");
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(backupDir, `d1-backup-${timestamp}.json`);
  const tables = (
    await queryD1<TableRow>(
      `select name
       from sqlite_schema
       where type = 'table'
         and name not like 'sqlite_%'
       order by name`,
    )
  ).rows.map((row) => row.name);

  const backup: {
    createdAt: string;
    tables: Record<string, { count: number; rows?: unknown[]; error?: string }>;
  } = {
    createdAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of tables) {
    try {
      const rows = await queryAll<Record<string, unknown>>(table);
      backup.tables[table] = { count: rows.length, rows };
    } catch (error) {
      const count = await queryD1<CountRow>(`select count(*) as value from ${quoteIdent(table)}`).then((result) => Number(result.rows[0]?.value ?? 0)).catch(() => -1);
      backup.tables[table] = {
        count,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  writeFileSync(outputPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, tableCount: tables.length, totalRows: Object.values(backup.tables).reduce((sum, table) => sum + Math.max(table.count, 0), 0) }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
