import { existsSync, readFileSync } from "node:fs";

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<{ meta?: { changes?: number }; results?: T[]; success?: boolean }>;
  success?: boolean;
};

const apply = process.argv.includes("--apply");
const continueExisting = process.argv.includes("--continue-existing");
const migrationPath = process.argv.find((arg) => arg.endsWith(".sql")) ?? process.argv[2];

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

function stripSqlComments(sql: string) {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function splitStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    current += char;

    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      if (quote === char && next === char) {
        current += next;
        index += 1;
        continue;
      }
      quote = quote ? null : char;
      continue;
    }

    if (char === ";" && !quote) {
      const statement = current.replace(/;\s*$/, "").trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function isExistingSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("duplicate column name") || message.includes("already exists") || message.includes("duplicate index");
}

async function main() {
  loadEnv();
  if (!migrationPath || !existsSync(migrationPath)) {
    throw new Error("Usage: npm run db:apply-migration -- <path-to-migration.sql> [--apply] [--continue-existing]");
  }

  const statements = splitStatements(stripSqlComments(readFileSync(migrationPath, "utf8")));
  const summary = {
    mode: apply ? "apply" : "dry-run",
    migrationPath,
    statements: statements.length,
    applied: 0,
    skippedExisting: 0,
    failed: 0,
    failures: [] as Array<{ index: number; statement: string; error: string }>,
  };

  for (const [index, statement] of statements.entries()) {
    if (!apply) continue;
    try {
      await queryD1(statement);
      summary.applied += 1;
    } catch (error) {
      if (continueExisting && isExistingSchemaError(error)) {
        summary.skippedExisting += 1;
        continue;
      }
      summary.failed += 1;
      summary.failures.push({
        index: index + 1,
        statement: statement.slice(0, 220),
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
