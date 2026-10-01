import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { LEGACY_ADAPTERS_V1, validateAdapterCoverage } from "../../apps/web/src/lib/v2/migration/legacy-adapters-v1";

const valueAfter = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const input = valueAfter("--columns");
const output = valueAfter("--out");
if (!input || !output) throw new Error("Usage: --columns <inventory/columns.jsonl> --out <mapping/field-coverage.csv>");
async function main() {
const rows = (await readFile(path.resolve(input), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { table: string; name: string });
const reports = LEGACY_ADAPTERS_V1.map((adapter) => ({ adapter, report: validateAdapterCoverage(adapter, rows.filter((row) => row.table === adapter.table).map((row) => row.name)) }));
const excluded = new Set(["users", "sessions"]);
const registered = new Set(LEGACY_ADAPTERS_V1.map((adapter) => adapter.table));
const isDerivedFtsTable = (table: string) => /_fts(?:_|$)/.test(table);
const derivedFtsTables = [...new Set(rows.map((row) => row.table))].filter(isDerivedFtsTable).sort();
const unregisteredTables = [...new Set(rows.map((row) => row.table))].filter((table) => !table.startsWith("v2_") && !isDerivedFtsTable(table) && !registered.has(table) && !excluded.has(table)).sort();
const csv = ["table,adapter_version,total_columns,covered_columns,valid,missing_columns,stale_contract_columns", ...reports.map(({ adapter, report }) => [adapter.table, adapter.version, report.total, report.covered, report.valid, report.missing.join("|"), report.stale.join("|")].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\n") + "\n";
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(path.resolve(output), csv, "utf8");
const invalid = reports.filter(({ report }) => !report.valid);
process.stdout.write(`${JSON.stringify({ adapters: reports.length, valid: reports.length - invalid.length, invalid: invalid.map(({ adapter, report }) => ({ table: adapter.table, missing: report.missing })), unregisteredTables, explicitlyExcludedTables: [...excluded], derivedFtsTables }, null, 2)}\n`);
if (invalid.length || unregisteredTables.length) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Adapter coverage validation failed."}\n`); process.exitCode = 1; });
