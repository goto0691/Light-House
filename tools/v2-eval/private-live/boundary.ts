import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

import { ANALYSIS_ENVELOPE_V1_SCHEMA, ANALYSIS_MODEL_CONFIG_VERSION, ANALYSIS_PROMPT_VERSION, ANALYSIS_REGISTRY_VERSION } from "@/lib/v2/ai/analysis-envelope-v1";
import { getV2ModelRoutes } from "@/lib/v2/ai/model-routing";
import { canonical, digest, exactKeys, HASH, record, type Expected, type Identity } from "../contracts";
import { loadPrivateCorpus } from "../recorded-input";

export const LIVE_CONTRACT = "private-live-product-evaluation-v1" as const;
export const AUTHORIZATION_CONTRACT = "private-live-authorization-v1" as const;
export const MAX_PROVIDER_CALLS = 20;
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const LIVE_CODES = ["PRIVATE_LIVE_ARGUMENTS_INVALID", "PRIVATE_LIVE_APPROVAL_REQUIRED", "PRIVATE_LIVE_AUTHORIZATION_MISMATCH", "PRIVATE_LIVE_PATH_INVALID", "PRIVATE_LIVE_INPUT_INVALID", "PRIVATE_LIVE_SOURCE_CHANGED", "PRIVATE_LIVE_SOURCE_NOT_CLEAN", "PRIVATE_LIVE_IDENTITY_CHANGED", "PRIVATE_LIVE_OUTPUT_INVALID", "PRIVATE_LIVE_CAPTURE_INVALID", "PRIVATE_LIVE_EXPORT_INVALID", "PRIVATE_LIVE_KEY_MISSING", "PRIVATE_LIVE_BUDGET_EXHAUSTED", "PRIVATE_LIVE_INTERNAL_ERROR"] as const;
export type LiveCode = (typeof LIVE_CODES)[number];
export class PrivateLiveError extends Error { constructor(readonly code: LiveCode) { super(code); } }
export function fail(code: LiveCode): never { throw new PrivateLiveError(code); }
export function byteHash(value: Uint8Array | string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
export function inside(root: string, path: string) { const rel = relative(root, path); return Boolean(rel) && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); }
export async function privateFile(root: string, path: string, absolute = false) {
  if ((!absolute && isAbsolute(path)) || path.split(/[\\/]/).includes("..")) fail("PRIVATE_LIVE_PATH_INVALID");
  const candidate = resolve(root, path); if (!inside(root, candidate)) fail("PRIVATE_LIVE_PATH_INVALID");
  const canonicalPath = await realpath(candidate); if (!inside(root, canonicalPath)) fail("PRIVATE_LIVE_PATH_INVALID");
  const info = await stat(canonicalPath); if (!info.isFile() || info.size > MAX_INPUT_BYTES) fail("PRIVATE_LIVE_INPUT_INVALID");
  const bytes = await readFile(canonicalPath); if (bytes.length > MAX_INPUT_BYTES) fail("PRIVATE_LIVE_INPUT_INVALID");
  return bytes;
}
export async function outputPath(root: string, path: string, requireFresh = true) {
  const candidate = resolve(path), parent = await realpath(dirname(candidate));
  if (!inside(root, candidate) || (parent !== root && !inside(root, parent))) fail("PRIVATE_LIVE_PATH_INVALID");
  const canonicalPath = resolve(parent, basename(candidate));
  if (requireFresh) {
    try { await lstat(canonicalPath); fail("PRIVATE_LIVE_OUTPUT_INVALID"); }
    catch (error) { if (error instanceof PrivateLiveError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return canonicalPath;
}
export async function writePrivateJson(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
function decodeExact(bytes: Buffer) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail("PRIVATE_LIVE_INPUT_INVALID"); }
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("PRIVATE_LIVE_INPUT_INVALID");
  return text;
}
/** Do not enumerate the parent environment: even a pre-authorization read may access provider keys. */
export function gitProcessEnvironment(): NodeJS.ProcessEnv {
  // The app augments ProcessEnv with required application fields; this child intentionally receives none of them.
  const env = Object.create(null) as NodeJS.ProcessEnv;
  env.GIT_OPTIONAL_LOCKS = "0"; env.GIT_TERMINAL_PROMPT = "0";
  for (const name of ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "SystemDrive", "WINDIR"]) {
    const value = process.env[name]; if (value !== undefined) env[name] = value;
  }
  return env;
}
export async function currentIdentity() {
  const env = gitProcessEnvironment();
  const build_sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: REPOSITORY_ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  const sourceClean = !execFileSync("git", ["status", "--porcelain", "--", "apps/web/src", "tools/v2-eval", "migrations", "package.json", "package-lock.json", "apps/web/package.json"], { cwd: REPOSITORY_ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const routes = getV2ModelRoutes();
  const migrations = (await readdir(resolve(REPOSITORY_ROOT, "migrations"))).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort();
  if (migrations.length !== 27) fail("PRIVATE_LIVE_INPUT_INVALID");
  const migrationHashes = await Promise.all(migrations.map(async (name) => ({ name, sha256: byteHash(await readFile(resolve(REPOSITORY_ROOT, "migrations", name))) })));
  const runtimeFiles = ["package-lock.json", "apps/web/src/lib/v2/ai/processing-runner.ts", "apps/web/src/lib/v2/ai/analysis-envelope-v1.ts", "apps/web/src/lib/v2/ai/gemini-role-gateways.ts", "apps/web/src/lib/v2/ai/gemini-wire-schema.ts", "apps/web/src/lib/v2/infrastructure/d1/processing-queue-repository.ts", "apps/web/src/lib/v2/infrastructure/d1/knowledge-reconciler.ts"];
  // All runner files are bound as well as the deployed analysis prompt/validator implementation.
  const liveFiles = (await readdir(fileURLToPath(new URL("./", import.meta.url)))).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort().map((name) => `tools/v2-eval/private-live/${name}`);
  const runtimeHashes = await Promise.all([...runtimeFiles, ...liveFiles].map(async (name) => ({ name, sha256: byteHash(await readFile(resolve(REPOSITORY_ROOT, name))) })));
  const identity: Identity = { build_sha, schema_sha256: digest({ schema: ANALYSIS_ENVELOPE_V1_SCHEMA, migrations: migrationHashes }),
    model_config_sha256: digest({ version: ANALYSIS_MODEL_CONFIG_VERSION, routes, sdk_http_attempts: 1, provider_calls: MAX_PROVIDER_CALLS, deadline_ms: 90_000, enabled_roles: ["main_analyzer"] }),
    prompt_sha256: digest({ version: ANALYSIS_PROMPT_VERSION, runtime_files: runtimeHashes }),
    registry_sha256: digest({ version: ANALYSIS_REGISTRY_VERSION, isolated_initial_registry: "empty-no-expected-seeding" }) };
  return { identity, routes, dirty, sourceClean, runtimeHashes };
}
export type LiveTarget = {
  contract: typeof LIVE_CONTRACT; corpus_sha256: string; identity: Identity; output_directory: string; runtime_source_clean: boolean;
  provider: "google-gemini"; role: "main_analyzer"; configured_model_id: string; approved_cases: 20; source_bytes: number;
  max_provider_calls: 20; max_calls_per_input: 1; sdk_http_attempts: 1; automatic_retry: false; model_fallback: false;
  transmits: ["approved-source-title", "approved-source-raw-text", "production-analysis-prompt"];
  grounded_enrichment_enabled: false; case_ids: string[];
};
export type LiveSource = { expected: Expected; bytes: Buffer; text: string; title: string };
export async function describeLiveTarget(manifestPath: string, outputDirectory: string, requireFresh = true) {
  const corpus = await loadPrivateCorpus(manifestPath), root = await realpath(dirname(resolve(manifestPath)));
  const output = await outputPath(root, outputDirectory, requireFresh), current = await currentIdentity();
  const document = parseDocument((await privateFile(root, resolve(manifestPath), true)).toString("utf8"), { logLevel: "silent" });
  const manifest: unknown = document.toJS();
  if (document.errors.length || document.warnings.length || !record(manifest) || !Array.isArray(manifest.cases)) fail("PRIVATE_LIVE_INPUT_INVALID");
  const sources: LiveSource[] = [];
  for (const expected of [...corpus.expected].sort((left, right) => left.case_id.localeCompare(right.case_id))) {
    const item = manifest.cases.find((value: unknown) => record(value) && value.case_id === expected.case_id);
    if (!record(item) || !Array.isArray(item.source_paths) || item.source_paths.length !== 1 || typeof item.source_paths[0] !== "string") fail("PRIVATE_LIVE_INPUT_INVALID");
    const bytes = await privateFile(root, item.source_paths[0]), text = decodeExact(bytes);
    if (canonical(expected.source_hashes) !== canonical([byteHash(bytes)])) fail("PRIVATE_LIVE_SOURCE_CHANGED");
    const heading = /^\uFEFF?# ([^\r\n]+)(?:\r?\n|$)/.exec(text); if (!heading || !heading[1].trim()) fail("PRIVATE_LIVE_INPUT_INVALID");
    sources.push({ expected, bytes, text, title: heading[1] });
  }
  if (sources.length !== 20) fail("PRIVATE_LIVE_INPUT_INVALID");
  const target: LiveTarget = { contract: LIVE_CONTRACT, corpus_sha256: corpus.corpus_sha256, identity: current.identity,
    output_directory: relative(root, output).split(sep).join("/"), runtime_source_clean: current.sourceClean, provider: "google-gemini", role: "main_analyzer", configured_model_id: current.routes.main_analyzer,
    approved_cases: 20, source_bytes: sources.reduce((total, source) => total + source.bytes.length, 0), max_provider_calls: 20, max_calls_per_input: 1,
    sdk_http_attempts: 1, automatic_retry: false, model_fallback: false, transmits: ["approved-source-title", "approved-source-raw-text", "production-analysis-prompt"],
    grounded_enrichment_enabled: false, case_ids: sources.map((source) => source.expected.case_id) };
  return { corpus, root, output, current, target, sources };
}
export type LiveAuthorization = { contract: typeof AUTHORIZATION_CONTRACT; target: LiveTarget; authorized: true; approval: { kind: "user_explicit_private_transmission"; user_request_sha256: string; recorded_at: string } };
export function assertAuthorization(value: unknown, target: LiveTarget): asserts value is LiveAuthorization {
  if (!record(value) || !exactKeys(value, ["contract", "target", "authorized", "approval"]) || value.authorized !== true) fail("PRIVATE_LIVE_APPROVAL_REQUIRED");
  if (value.contract !== AUTHORIZATION_CONTRACT || canonical(value.target) !== canonical(target)) fail("PRIVATE_LIVE_AUTHORIZATION_MISMATCH");
  if (!record(value.approval) || !exactKeys(value.approval, ["kind", "user_request_sha256", "recorded_at"])
    || value.approval.kind !== "user_explicit_private_transmission" || typeof value.approval.user_request_sha256 !== "string" || !HASH.test(value.approval.user_request_sha256)
    || typeof value.approval.recorded_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.approval.recorded_at)
    || !Number.isFinite(Date.parse(value.approval.recorded_at)) || Date.parse(value.approval.recorded_at) > Date.now()
    || new Date(value.approval.recorded_at).toISOString() !== value.approval.recorded_at) fail("PRIVATE_LIVE_APPROVAL_REQUIRED");
}
