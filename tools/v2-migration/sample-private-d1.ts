import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

import {
  LEGACY_ADAPTERS_V1,
  validateAdapterCoverage,
  type LegacyAdapterV1,
} from "../../apps/web/src/lib/v2/migration/legacy-adapters-v1";
import { canonicalJson, sha256Hex } from "../../apps/web/src/lib/v2/portability/portability-contract-v1";
import {
  assertReadOnlySql,
  candidateReasons,
  candidateSqlPredicate,
  computeBaseSampleSize,
  computeEvenSampleIndexes,
  isPrivateArtifactOutput,
  PRIVATE_SAMPLE_FORMAT,
  PRIVATE_SAMPLE_VERSION,
} from "./private-sample-core";

loadEnvConfig(path.resolve(import.meta.dirname, "..", "..", "apps", "web"), process.env.NODE_ENV !== "production");

type WranglerResult = { results?: Record<string, unknown>[] } | { result?: { results?: Record<string, unknown>[] } };
type TableInfoRow = { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
type SelectedSample = {
  format: typeof PRIVATE_SAMPLE_FORMAT;
  version: typeof PRIVATE_SAMPLE_VERSION;
  table: string;
  adapterVersion: string;
  legacyId: string;
  rowHash: string;
  reasons: string[];
  row: Record<string, unknown>;
};

const HELP = `Project Light-House private legacy sample extractor

Usage:
  npx tsx tools/v2-migration/sample-private-d1.ts --user <legacy-user-id> [options]

Options:
  --remote                 Read the configured remote D1 database (default: local)
  --local                  Read the local D1 database
  --database <binding>     Wrangler D1 binding/name (default: DB)
  --config <path>          Wrangler config (default: wrangler.toml)
  --run-id <id>            Artifact run directory name (default: timestamp)
  --out <path>             Must be a child of artifacts/v2-migration
  --plan-only              Read schema/counts and write a private plan; do not fetch row bodies
  --help                   Show this help

Safety:
  This command only issues SELECT and PRAGMA statements. It never calls source_only,
  knowledge, or any migration API. Private output is no-overwrite and must be ignored by Git.
`;

const rawArgs = process.argv.slice(2);
const has = (name: string) => rawArgs.includes(name);
const valueAfter = (name: string) => {
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : undefined;
};

function validateArguments() {
  const valueFlags = new Set(["--database", "--config", "--run-id", "--out", "--user"]);
  const booleanFlags = new Set(["--remote", "--local", "--plan-only", "--help"]);
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (valueFlags.has(argument)) {
      if (!rawArgs[index + 1] || rawArgs[index + 1].startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
    } else if (!booleanFlags.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (has("--remote") && has("--local")) throw new Error("Choose either --remote or --local.");
}

function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("D1 returned an unsafe identifier.");
  return value;
}

function sqlLiteral(value: string) {
  if (value.includes("\0")) throw new Error("User scope contains a null byte.");
  return `'${value.replaceAll("'", "''")}'`;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runProcess(executable: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

async function runWrangler(args: string[]) {
  const wranglerBin = path.resolve("node_modules", "wrangler", "bin", "wrangler.js");
  const result = await runProcess(process.execPath, [wranglerBin, ...args]);
  if (result.code !== 0) throw new Error(`Wrangler read-only query failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  return result;
}

async function wranglerBatchRows(sqls: readonly string[], options: { database: string; mode: "--local" | "--remote"; config: string }) {
  if (!sqls.length) return [];
  sqls.forEach(assertReadOnlySql);
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchLength = 0;
  for (const sql of sqls) {
    const nextLength = batchLength + sql.length + (batch.length ? 1 : 0);
    if (batch.length && (batch.length >= 32 || nextLength > 10_000)) {
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
    const result = await runWrangler(["d1", "execute", options.database, options.mode, "--config", options.config, "--command", statements.join(";"), "--json"]);
    let parsed: WranglerResult | WranglerResult[];
    try {
      parsed = JSON.parse(result.stdout) as WranglerResult | WranglerResult[];
    } catch {
      throw new Error("Wrangler returned invalid JSON for a read-only query.");
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    rows.push(...items.map((item) => {
      if ("results" in item) return item.results ?? [];
      if ("result" in item) return item.result?.results ?? [];
      return [];
    }));
  }
  return rows;
}

function identityOrder(adapter: LegacyAdapterV1) {
  return (adapter.identityColumns ?? ["id"]).map((column) => column === "rowid" ? "legacy.rowid" : `legacy.\"${identifier(column)}\"`).join(",");
}

function selectedColumns(adapter: LegacyAdapterV1) {
  return `legacy.*${(adapter.identityColumns ?? ["id"]).includes("rowid") ? ",legacy.rowid as __legacy_identity_rowid" : ""}`;
}

function legacyIdFromRow(adapter: LegacyAdapterV1, row: Readonly<Record<string, unknown>>) {
  const columns = adapter.identityColumns ?? ["id"];
  const values = columns.map((column) => column === "rowid" ? row.__legacy_identity_rowid : row[column]);
  if (values.some((value) => value === null || value === undefined || (typeof value !== "string" && typeof value !== "number"))) {
    throw new Error(`Legacy identity is invalid for ${adapter.table}.`);
  }
  return columns.length === 1 ? String(values[0]) : canonicalJson(values);
}

function stripSamplingMetadata(raw: Readonly<Record<string, unknown>>) {
  const row = { ...raw };
  delete row.__private_sample_index;
  delete row.__private_sample_row_count;
  delete row.__legacy_identity_rowid;
  return row;
}

async function assertIgnoredOutput(outputRoot: string) {
  if (!isPrivateArtifactOutput(outputRoot)) throw new Error("Private samples must be written to a child directory of artifacts/v2-migration.");
  const samplePath = path.join(outputRoot, "inventory", "samples.private.jsonl");
  const relative = path.relative(process.cwd(), samplePath);
  const result = await runProcess("git", ["check-ignore", "--quiet", "--no-index", "--", relative]);
  if (result.code !== 0) throw new Error("Private sample path is not ignored by Git. Refusing to read row bodies.");
}

async function writeNew(file: string, body: string) {
  try {
    await access(file, constants.F_OK);
    throw new Error(`Refusing to overwrite existing private artifact: ${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(file, body, { encoding: "utf8", flag: "wx" });
}

async function main() {
  validateArguments();
  if (has("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const userId = valueAfter("--user")?.trim();
  if (!userId) throw new Error("--user <legacy-user-id> is required so private rows cannot cross user scope.");
  const mode: "--local" | "--remote" = has("--remote") ? "--remote" : "--local";
  const database = valueAfter("--database") ?? "DB";
  const config = valueAfter("--config") ?? "wrangler.toml";
  const runId = valueAfter("--run-id") ?? new Date().toISOString().replace(/[:.]/g, "-");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error("--run-id must be a simple path-safe identifier.");
  const outputRoot = path.resolve(valueAfter("--out") ?? path.join("artifacts", "v2-migration", runId));
  await assertIgnoredOutput(outputRoot);
  if (mode === "--remote" && !process.env.CLOUDFLARE_API_TOKEN) {
    const identity = await runWrangler(["whoami"]);
    if (/not authenticated/i.test(`${identity.stdout}\n${identity.stderr}`)) throw new Error("Wrangler is not authenticated. Run `wrangler login` before remote sampling.");
  }
  const wranglerOptions = { database, mode, config };
  const userScope = sqlLiteral(userId);

  const tableResult = await wranglerBatchRows([
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' order by name",
  ], wranglerOptions);
  const presentTables = new Set((tableResult[0] ?? []).map((row) => identifier(row.name)));
  const adapters = LEGACY_ADAPTERS_V1.filter((adapter) => presentTables.has(adapter.table));
  const schemaRows = await wranglerBatchRows(adapters.map((adapter) => `pragma table_info(\"${identifier(adapter.table)}\")`), wranglerOptions);
  const schemas = adapters.map((adapter, index) => {
    const columns = (schemaRows[index] ?? []) as TableInfoRow[];
    const names = columns.map((column) => identifier(column.name));
    const coverage = validateAdapterCoverage(adapter, names);
    if (!coverage.valid) throw new Error(`Adapter ${adapter.version} has uncovered columns: ${coverage.missing.join(", ")}`);
    return { adapter, columns: names };
  });
  const countQueries = schemas.map(({ adapter }) => `select count(*) as value from ${adapter.scopeFrom ?? `${identifier(adapter.table)} legacy`} where ${adapter.scopeUserColumn ?? "legacy.user_id"}=${userScope}`);
  const countRows = await wranglerBatchRows(countQueries, wranglerOptions);
  const plans = schemas.map(({ adapter, columns }, index) => {
    const rowCount = Number(countRows[index]?.[0]?.value ?? 0);
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new Error(`Invalid row count for ${adapter.table}.`);
    const baseSampleSize = computeBaseSampleSize(rowCount);
    return {
      adapter,
      columns,
      rowCount,
      baseSampleSize,
      sampleIndexes: computeEvenSampleIndexes(rowCount, baseSampleSize),
      candidatePredicate: candidateSqlPredicate(adapter, columns),
    };
  });

  const inventoryDir = path.join(outputRoot, "inventory");
  await mkdir(inventoryDir, { recursive: true });
  const publicPlan = {
    format: PRIVATE_SAMPLE_FORMAT,
    version: PRIVATE_SAMPLE_VERSION,
    generatedAt: new Date().toISOString(),
    mode: mode.slice(2),
    database,
    config,
    userScopeHash: `sha256:${sha256Hex(userId)}`,
    readOnly: true,
    migrationApisCalled: false,
    rowBodiesFetched: !has("--plan-only"),
    samplingPolicy: "rows<5:all; otherwise max(5,min(20,ceil(5%))); plus all detected damage/high-risk/attachment candidates",
    tables: plans.map((plan) => ({
      table: plan.adapter.table,
      adapterVersion: plan.adapter.version,
      rowCount: plan.rowCount,
      baseSampleSize: plan.baseSampleSize,
      candidateScan: Boolean(plan.candidatePredicate),
    })),
  };
  await writeNew(path.join(inventoryDir, "private-sample-plan.json"), `${JSON.stringify(publicPlan, null, 2)}\n`);
  if (has("--plan-only")) {
    process.stdout.write(`${JSON.stringify({ outputRoot, mode: mode.slice(2), readOnly: true, planOnly: true, nonEmptyTables: plans.filter((plan) => plan.rowCount > 0).length }, null, 2)}\n`);
    return;
  }

  const activePlans = plans.filter((plan) => plan.rowCount > 0);
  const baseQueries = activePlans.map((plan) => {
    const indexes = plan.sampleIndexes.join(",");
    return `select * from (select ${selectedColumns(plan.adapter)},row_number() over (order by ${identityOrder(plan.adapter)})-1 as __private_sample_index,count(*) over () as __private_sample_row_count from ${plan.adapter.scopeFrom ?? `${identifier(plan.adapter.table)} legacy`} where ${plan.adapter.scopeUserColumn ?? "legacy.user_id"}=${userScope}) sample where __private_sample_index in (${indexes}) order by __private_sample_index`;
  });
  const candidatePlans = activePlans.filter((plan) => plan.candidatePredicate);
  const candidateQueries = candidatePlans.map((plan) => `select ${selectedColumns(plan.adapter)} from ${plan.adapter.scopeFrom ?? `${identifier(plan.adapter.table)} legacy`} where ${plan.adapter.scopeUserColumn ?? "legacy.user_id"}=${userScope} and ${plan.candidatePredicate} order by ${identityOrder(plan.adapter)}`);
  const [baseRows, candidateRows] = await Promise.all([
    wranglerBatchRows(baseQueries, wranglerOptions),
    wranglerBatchRows(candidateQueries, wranglerOptions),
  ]);

  const selected = new Map<string, SelectedSample & { baseSelected: boolean }>();
  const addRows = (plan: (typeof activePlans)[number], rows: readonly Record<string, unknown>[], baseSelected: boolean) => {
    for (const raw of rows) {
      const legacyId = legacyIdFromRow(plan.adapter, raw);
      const row = stripSamplingMetadata(raw);
      const key = `${plan.adapter.table}\0${legacyId}`;
      const rowHash = `sha256:${sha256Hex(canonicalJson(row))}`;
      const reasons = new Set(candidateReasons(plan.adapter, row, plan.columns));
      if (baseSelected) reasons.add("BASE_DETERMINISTIC");
      const existing = selected.get(key);
      if (existing) {
        if (existing.rowHash !== rowHash) throw new Error(`Legacy identity ${plan.adapter.table}/${legacyId} changed or is duplicated with different content during sampling.`);
        for (const reason of reasons) existing.reasons.push(reason);
        existing.reasons = [...new Set(existing.reasons)].sort();
        existing.baseSelected ||= baseSelected;
        continue;
      }
      selected.set(key, {
        format: PRIVATE_SAMPLE_FORMAT,
        version: PRIVATE_SAMPLE_VERSION,
        table: plan.adapter.table,
        adapterVersion: plan.adapter.version,
        legacyId,
        rowHash,
        reasons: [...reasons].sort(),
        row,
        baseSelected,
      });
    }
  };
  activePlans.forEach((plan, index) => {
    const rows = baseRows[index] ?? [];
    if (rows.length !== plan.baseSampleSize || rows.some((row) => Number(row.__private_sample_row_count) !== plan.rowCount)) {
      throw new Error(`Legacy table ${plan.adapter.table} changed while its private sample was being selected. Start a new run.`);
    }
    addRows(plan, rows, true);
  });
  candidatePlans.forEach((plan, index) => addRows(plan, candidateRows[index] ?? [], false));

  const ordered = [...selected.values()].sort((left, right) => compareText(left.table, right.table) || compareText(left.legacyId, right.legacyId));
  const samples = ordered.map(({ baseSelected: _baseSelected, ...sample }) => sample);
  const reasonCounts: Record<string, number> = {};
  const tableCounts: Record<string, { totalRows: number; baseTarget: number; selected: number; addedCandidates: number }> = {};
  for (const plan of activePlans) tableCounts[plan.adapter.table] = { totalRows: plan.rowCount, baseTarget: plan.baseSampleSize, selected: 0, addedCandidates: 0 };
  for (const sample of ordered) {
    tableCounts[sample.table].selected += 1;
    if (!sample.baseSelected) tableCounts[sample.table].addedCandidates += 1;
    for (const reason of sample.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  const sampleRootHash = `sha256:${sha256Hex(samples.map((sample) => `${sample.table}\0${sample.legacyId}\0${sample.rowHash}\0${sample.reasons.join("|")}`).join("\n"))}`;
  const manifest = {
    format: PRIVATE_SAMPLE_FORMAT,
    version: PRIVATE_SAMPLE_VERSION,
    generatedAt: new Date().toISOString(),
    mode: mode.slice(2),
    database,
    config,
    userScopeHash: `sha256:${sha256Hex(userId)}`,
    readOnly: true,
    migrationApisCalled: false,
    contentFile: "samples.private.jsonl",
    selectedRows: samples.length,
    baseSelectedRows: ordered.filter((sample) => sample.baseSelected).length,
    addedCandidateRows: ordered.filter((sample) => !sample.baseSelected).length,
    reasonCounts,
    tableCounts,
    sampleRootHash,
  };
  await writeNew(path.join(inventoryDir, "samples.private.jsonl"), samples.map((sample) => canonicalJson(sample)).join("\n") + (samples.length ? "\n" : ""));
  await writeNew(path.join(inventoryDir, "private-sample-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputRoot, mode: mode.slice(2), readOnly: true, selectedRows: samples.length, baseSelectedRows: manifest.baseSelectedRows, addedCandidateRows: manifest.addedCandidateRows, sampleRootHash }, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Private sampling failed."}\n`);
  process.exitCode = 1;
});
