import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isSecretKey,
  loadEnvAuditCorpus,
  nextEnvFilePaths,
  scanArtifactsForEnvSecrets,
} from "./secret-artifact-audit.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = path.resolve(appDir, "..", "..");
const wranglerPath = path.join(monorepoRoot, "wrangler.toml");
const openNextDir = path.join(appDir, ".open-next");
const nextDir = path.join(appDir, ".next");
const openNextCli = path.join(monorepoRoot, "node_modules", "@opennextjs", "cloudflare", "dist", "cli", "index.js");
const buildLockPath = path.join(appDir, ".opennext-build.lock");
const attestationPath = path.join(openNextDir, "safe-build-attestation.mjs");
const hiddenSuffix = ".opennext-build-hidden";
const envFiles = nextEnvFilePaths(monorepoRoot, appDir);
const realWorkspaceRoot = realpathSync(monorepoRoot);

const safeBuildVars = new Set([
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_FLAG_AI_ROUTING",
  "NEXT_PUBLIC_FLAG_SEMANTIC_SEARCH",
  "NEXT_PUBLIC_FLAG_PWA",
  "GEMINI_MODEL",
  "GEMINI_MAIN_MODEL",
  "GEMINI_GROUNDED_MODEL",
  "R2_BUCKET",
  "FLAG_V2_ROUTES",
  "FLAG_V2_WRITE",
  "FLAG_V2_AI",
  "FLAG_V2_OFFLINE",
  "FLAG_V2_DEFAULT_LIBRARY",
  "FLAG_V2_LEGACY_READONLY",
]);

function assertGeneratedDirectory(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${monorepoRoot}${path.sep}`)) throw new Error(`Unsafe generated directory: ${resolved}`);
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new Error(`Refusing to remove symbolic-link output: ${resolved}`);
  return resolved;
}

function removeGeneratedOutput(target) {
  rmSync(assertGeneratedDirectory(target), { recursive: true, force: true });
}

function assertArtifactDirectory(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${monorepoRoot}${path.sep}`)) throw new Error(`Artifact directory is outside the workspace: ${resolved}`);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Artifact output is not a real directory: ${resolved}`);
  const real = realpathSync(resolved);
  if (!real.startsWith(`${realWorkspaceRoot}${path.sep}`)) throw new Error(`Artifact directory resolves outside the workspace: ${resolved}`);
  return { resolved, real };
}

function assertArtifactFile(target, parentDirectory) {
  const resolved = path.resolve(target);
  const parent = assertArtifactDirectory(parentDirectory);
  if (!resolved.startsWith(`${parent.resolved}${path.sep}`)) throw new Error(`Artifact file is outside its expected directory: ${resolved}`);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Artifact output is not a real file: ${resolved}`);
  const real = realpathSync(resolved);
  if (!real.startsWith(`${parent.real}${path.sep}`)) throw new Error(`Artifact file resolves outside its expected directory: ${resolved}`);
  return resolved;
}

function acquireBuildLock() {
  let handle;
  try {
    handle = openSync(buildLockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Another safe Worker build is active, or a prior interrupted build left a lock: ${buildLockPath}. If no build is active, run \`npm run recover:worker-build --workspace @light-house/web\`.`);
    }
    throw error;
  }
  try {
    writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    closeSync(handle);
    unlinkSync(buildLockPath);
    throw error;
  }
  return () => {
    try {
      closeSync(handle);
    } finally {
      if (existsSync(buildLockPath)) unlinkSync(buildLockPath);
    }
  };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function removeConfirmedStaleBuildLock() {
  if (!existsSync(buildLockPath)) return;
  let ownerPid = null;
  try {
    const parsed = JSON.parse(readFileSync(buildLockPath, "utf8"));
    ownerPid = Number.isSafeInteger(parsed?.pid) ? parsed.pid : null;
  } catch {
    ownerPid = null;
  }
  if (ownerPid && processIsAlive(ownerPid)) {
    throw new Error(`Refusing to recover an active Worker build lock owned by PID ${ownerPid}.`);
  }
  unlinkSync(buildLockPath);
}

function restoreStaleBackups() {
  for (const original of envFiles) {
    const backup = `${original}${hiddenSuffix}`;
    if (!existsSync(backup)) continue;
    if (existsSync(original)) throw new Error(`Both an environment file and its stale build backup exist: ${original}`);
    renameSync(backup, original);
    console.warn(`Restored a stale environment-file backup: ${path.relative(monorepoRoot, original)}`);
  }
}

function hideEnvironmentFiles() {
  const moved = [];
  try {
    for (const original of envFiles) {
      if (!existsSync(original)) continue;
      const backup = `${original}${hiddenSuffix}`;
      if (existsSync(backup)) throw new Error(`Environment build backup already exists: ${backup}`);
      renameSync(original, backup);
      moved.push({ original, backup });
    }
  } catch (error) {
    restoreEnvironmentFiles(moved);
    throw error;
  }
  return moved;
}

function restoreEnvironmentFiles(moved) {
  const collisions = [];
  for (const item of [...moved].reverse()) {
    if (!existsSync(item.backup)) {
      collisions.push(`missing backup for ${item.original}`);
      continue;
    }
    if (existsSync(item.original)) {
      collisions.push(`restore target already exists for ${item.original}`);
      continue;
    }
    renameSync(item.backup, item.original);
  }
  if (collisions.length) throw new Error(`Environment-file restore failed: ${collisions.join("; ")}`);
}

function parseWranglerVars() {
  const values = {};
  let inVars = false;
  for (const rawLine of readFileSync(wranglerPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "[vars]") {
      inVars = true;
      continue;
    }
    if (inVars && line.startsWith("[")) break;
    if (!inVars || !line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/);
    if (!match || !safeBuildVars.has(match[1])) continue;
    values[match[1]] = JSON.parse(match[2]);
  }
  return values;
}

function terminateChildTree(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return null;
  try {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      if (result.error) return result.error;
      if (result.status !== 0 && child.exitCode === null) return new Error(`taskkill exited with status ${result.status}.`);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") return error;
  }
  return null;
}

function processGroupIsAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

async function ensurePosixProcessGroupStopped(pid, signal) {
  if (!processGroupIsAlive(pid)) return null;
  try {
    process.kill(-pid, signal === "SIGHUP" ? "SIGHUP" : "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") return error;
  }
  if (await waitForProcessGroupExit(pid, 5_000)) return null;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") return error;
  }
  return await waitForProcessGroupExit(pid, 5_000) ? null : new Error(`Process group ${pid} remained alive after SIGKILL.`);
}

async function runOpenNext(childEnv) {
  const child = spawn(process.execPath, [openNextCli, "build", "--config", wranglerPath], {
    cwd: appDir,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let interrupted = null;
  let terminationError = null;
  const signals = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map(signals.map((signal) => [signal, () => {
    interrupted = signal;
    terminationError ??= terminateChildTree(child, signal);
  }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (process.platform !== "win32" && child.pid && (interrupted || result.signal)) {
      terminationError ??= await ensurePosixProcessGroupStopped(child.pid, interrupted ?? result.signal ?? "SIGTERM");
    }
    if (terminationError) throw new Error(`OpenNext build interruption failed to terminate its process tree: ${terminationError.message}`);
    if (interrupted || result.signal) throw new Error(`OpenNext build interrupted by ${interrupted ?? result.signal}.`);
    if (result.code !== 0) throw new Error(`OpenNext build failed with exit code ${result.code}.`);
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

async function buildWorker() {
  const corpus = loadEnvAuditCorpus(envFiles);
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(childEnv)) {
    if (!isSecretKey(key)) continue;
    if (key.startsWith("NEXT_PUBLIC_") && value) throw new Error(`Refusing a public process environment variable with a secret-bearing name: ${key}`);
    delete childEnv[key];
  }
  for (const key of corpus.keys) delete childEnv[key];
  Object.assign(childEnv, parseWranglerVars(), {
    NODE_ENV: "production",
    LIGHT_HOUSE_SAFE_WORKER_BUILD: "1",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
  });

  removeGeneratedOutput(openNextDir);
  removeGeneratedOutput(nextDir);
  const moved = hideEnvironmentFiles();
  let buildError = null;
  try {
    await runOpenNext(childEnv);
  } catch (error) {
    buildError = error;
  } finally {
    try {
      restoreEnvironmentFiles(moved);
    } catch (restoreError) {
      buildError = restoreError;
    }
  }

  if (buildError) {
    removeGeneratedOutput(openNextDir);
    removeGeneratedOutput(nextDir);
    throw buildError;
  }

  try {
    const openNextOutput = assertArtifactDirectory(openNextDir);
    assertArtifactDirectory(nextDir);
    const compiledEnvPath = path.join(openNextDir, "cloudflare", "next-env.mjs");
    const compiledEnv = readFileSync(assertArtifactFile(compiledEnvPath, path.join(openNextDir, "cloudflare")), "utf8");
    for (const mode of ["production", "development", "test"]) {
      if (!compiledEnv.includes(`export const ${mode} = {};`)) {
        throw new Error(`OpenNext emitted non-empty compiled environment data for ${mode}.`);
      }
    }

    // The adapter imports its compiled config during Worker initialization.
    // A successful compilation alone must not attest a config that needs the
    // build process flag (or local credentials) merely to initialize.
    const runtimeEnv = { ...childEnv };
    delete runtimeEnv.LIGHT_HOUSE_SAFE_WORKER_BUILD;
    const runtimeConfigs = [
      assertArtifactFile(path.join(openNextDir, ".build", "open-next.config.edge.mjs"), path.join(openNextDir, ".build")),
      assertArtifactFile(path.join(openNextDir, "middleware", "open-next.config.mjs"), path.join(openNextDir, "middleware")),
    ];
    const runtimeCheck = spawnSync(process.execPath, [
      "--input-type=module", "--eval",
      "import { pathToFileURL } from 'node:url'; for (const file of process.argv.slice(1)) { const config = (await import(pathToFileURL(file).href)).default; if (!config?.default) throw new Error('Invalid runtime configuration'); }",
      ...runtimeConfigs,
    ], { cwd: appDir, env: runtimeEnv, encoding: "utf8", windowsHide: true, timeout: 30_000 });
    if (runtimeCheck.error || runtimeCheck.status !== 0) {
      throw new Error("Compiled Worker configuration cannot initialize without build-only flags. No safe-build attestation was issued.");
    }

    if (path.dirname(attestationPath) !== openNextOutput.resolved) throw new Error("Unsafe Worker attestation path.");
    writeFileSync(attestationPath, "export const SAFE_WORKER_BUILD_ATTESTATION = \"light-house-worker-safe-v1\";\n", { flag: "wx" });
    const audit = scanArtifactsForEnvSecrets({
      targets: [openNextDir, nextDir],
      workspaceRoot: monorepoRoot,
      corpus,
    });
    if (audit.hits.length) {
      const summary = audit.hits.map((hit) => `${hit.key}:${path.relative(monorepoRoot, hit.file)}`).join(", ");
      throw new Error(`Worker build contains environment secret values: ${summary}`);
    }

    console.log(`safe-worker-build: masked_env_files=${moved.length} audited_files=${audit.files.length} secret_hits=0`);
  } catch (error) {
    removeGeneratedOutput(openNextDir);
    removeGeneratedOutput(nextDir);
    throw error;
  }
}

const recoverOnly = process.argv.slice(2).includes("--recover-stale-lock");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--recover-stale-lock");
if (unknownArguments.length) throw new Error(`Unknown safe-build arguments: ${unknownArguments.join(", ")}`);
if (recoverOnly) removeConfirmedStaleBuildLock();
const releaseBuildLock = acquireBuildLock();
try {
  restoreStaleBackups();
  if (recoverOnly) {
    console.log("safe-worker-build-recovery: lock=cleared env_backups=restored");
  } else {
    await buildWorker();
  }
} finally {
  releaseBuildLock();
}
