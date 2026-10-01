import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(import.meta.dirname, "..", "..", "apps", "web"), process.env.NODE_ENV !== "production");

type WranglerResult = { results?: Record<string, unknown>[] } | { result?: { results?: Record<string, unknown>[] } };
const args = new Set(process.argv.slice(2));
const valueAfter = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const mode = args.has("--remote") ? "--remote" : "--local";
const database = valueAfter("--database") ?? "DB";
const config = valueAfter("--config") ?? "wrangler.toml";
const runId = valueAfter("--run-id") ?? new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = path.resolve(valueAfter("--out") ?? path.join("artifacts", "v2-migration", runId));

function assertReadOnly(sql: string) {
  if (!/^\s*(select|pragma)\b/i.test(sql) || /\b(insert|update|delete|drop|alter|create|replace|vacuum|attach)\b/i.test(sql)) throw new Error("Inventory accepts read-only SELECT or PRAGMA only.");
}

function runWrangler(args: string[]) {
  const executable = process.execPath;
  const wranglerBin = path.resolve("node_modules", "wrangler", "bin", "wrangler.js");
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, [wranglerBin, ...args], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(`Wrangler inventory query failed: ${(stderr || stdout).trim().slice(0, 500)}`)); return; }
      resolve({ stdout, stderr });
    });
  });
}

async function wranglerBatchRows(sqls: readonly string[]) {
  if (!sqls.length) return [];
  sqls.forEach(assertReadOnly);
  // Windows CreateProcess has a relatively small command-line limit. A V2
  // database has enough tables that joining every PRAGMA/count query into one
  // --command argument can fail with spawn ENAMETOOLONG. Keep each invocation
  // comfortably below that boundary while preserving result order.
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchLength = 0;
  for (const sql of sqls) {
    const nextLength = batchLength + sql.length + (batch.length ? 1 : 0);
    if (batch.length && (batch.length >= 48 || nextLength > 12_000)) {
      batches.push(batch);
      batch = [];
      batchLength = 0;
    }
    batch.push(sql);
    batchLength += sql.length + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length) batches.push(batch);

  const rows: Record<string, unknown>[][] = [];
  for (const statements of batches) {
    const { stdout } = await runWrangler(["d1", "execute", database, mode, "--config", config, "--command", statements.join(";"), "--json"]);
    try {
      const parsed = JSON.parse(stdout) as WranglerResult | WranglerResult[];
      const items = Array.isArray(parsed) ? parsed : [parsed];
      rows.push(...items.map((item) => ("results" in item ? item.results : item.result?.results) ?? []));
    } catch { throw new Error("Wrangler returned invalid JSON."); }
  }
  return rows;
}

async function wranglerRows(sql: string) { return (await wranglerBatchRows([sql]))[0] ?? []; }

function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("D1 returned an unsafe identifier.");
  return value;
}

async function main() {
if (mode === "--remote" && !process.env.CLOUDFLARE_API_TOKEN) {
  const identity = await runWrangler(["whoami"]);
  if (/not authenticated/i.test(`${identity.stdout}\n${identity.stderr}`)) throw new Error("Wrangler is not authenticated. Run `wrangler login` or set CLOUDFLARE_API_TOKEN before remote inventory.");
}
const tables = (await wranglerRows(`select name,sql from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' and name<>'d1_migrations' order by name`)).map((row) => ({ name: identifier(row.name), sqlHashInput: typeof row.sql === "string" ? row.sql : "" }));
const tableRows: Record<string, unknown>[] = [];
const columnRows: Record<string, unknown>[] = [];
const rowCounts: Record<string, number> = {};
const timestampRanges: Record<string, Record<string, unknown>> = {};

const schemaResults = await wranglerBatchRows(tables.flatMap((table) => [`pragma table_info("${table.name}")`, `select count(*) as value from "${table.name}"`]));
const rangeQueries: { table: string; column: string; sql: string }[] = [];
for (const [tableIndex, table] of tables.entries()) {
  const columns = schemaResults[tableIndex * 2] ?? [];
  columnRows.push(...columns.map((column) => ({ table: table.name, ...column })));
  const count = schemaResults[tableIndex * 2 + 1] ?? [];
  rowCounts[table.name] = Number(count[0]?.value ?? 0);
  const names = new Set(columns.map((column) => String(column.name)));
  const timestampColumns = ["created_at", "updated_at", "deleted_at", "date", "occurred_at", "visited_at"].filter((name) => names.has(name));
  for (const column of timestampColumns) {
    rangeQueries.push({ table: table.name, column, sql: `select min("${column}") as minimum,max("${column}") as maximum,sum(case when "${column}" is null or trim(cast("${column}" as text))='' then 1 else 0 end) as empty_count from "${table.name}"` });
  }
  timestampRanges[table.name] = {};
  tableRows.push({ name: table.name, rowCount: rowCounts[table.name], columnCount: columns.length, hasUserScope: names.has("user_id") });
}
const rangeResults = await wranglerBatchRows(rangeQueries.map((query) => query.sql));
for (const [index, query] of rangeQueries.entries()) timestampRanges[query.table][query.column] = rangeResults[index]?.[0] ?? {};

const inventoryDir = path.join(outputRoot, "inventory");
await mkdir(inventoryDir, { recursive: true });
const jsonl = (rows: readonly unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
await Promise.all([
  writeFile(path.join(outputRoot, "run.json"), JSON.stringify({ runId, capturedAt: new Date().toISOString(), mode: mode.slice(2), database, config, readOnly: true, contentIncluded: false }, null, 2) + "\n", "utf8"),
  writeFile(path.join(inventoryDir, "tables.jsonl"), jsonl(tableRows), "utf8"),
  writeFile(path.join(inventoryDir, "columns.jsonl"), jsonl(columnRows), "utf8"),
  writeFile(path.join(inventoryDir, "row-counts.json"), JSON.stringify(rowCounts, null, 2) + "\n", "utf8"),
  writeFile(path.join(inventoryDir, "timestamp-ranges.json"), JSON.stringify(timestampRanges, null, 2) + "\n", "utf8"),
]);
process.stdout.write(`${JSON.stringify({ runId, outputRoot, mode: mode.slice(2), tables: tables.length, rows: Object.values(rowCounts).reduce((sum, value) => sum + value, 0), contentIncluded: false }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Inventory failed."}\n`); process.exitCode = 1; });
