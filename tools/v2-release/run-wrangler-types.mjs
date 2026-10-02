import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { normalizeNodeGlobals } from "./normalize-node-globals.mjs";

const mode = process.argv[2] ?? "check";
if (mode !== "generate" && mode !== "check") {
  throw new Error("Usage: node tools/v2-release/run-wrangler-types.mjs <generate|check>");
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const args = [
  wrangler,
  "types",
  "apps/web/worker-configuration.d.ts",
  "--config",
  "wrangler.toml",
  "--env-interface",
  "CloudflareEnv",
  "--strict-vars",
  "false",
];
if (mode === "check") args.push("--check");

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

if (process.exitCode === 0) {
  const target = path.join(root, "apps", "web", "worker-configuration.d.ts");
  const source = readFileSync(target, "utf8");
  const normalized = normalizeNodeGlobals(source).replaceAll("\r\n", "\n");
  if (mode === "generate") {
    if (normalized !== source) writeFileSync(target, normalized);
  } else if (normalized !== source) {
    process.stderr.write("Worker Node globals are out of date. Run npm run bindings:types.\n");
    process.exitCode = 1;
  }
}
