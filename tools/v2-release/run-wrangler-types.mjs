import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
