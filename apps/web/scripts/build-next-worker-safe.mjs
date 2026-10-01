import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// This command is invoked only by OpenNext's build phase, never by its runtime.
if (process.env.LIGHT_HOUSE_SAFE_WORKER_BUILD !== "1") {
  throw new Error("Direct OpenNext builds are disabled. Run `npm run build:worker --workspace @light-house/web`.");
}
if (process.argv.length > 2) throw new Error("The safe Next build command accepts no arguments.");

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build", "--webpack"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`Next build interrupted by ${result.signal}.`);
process.exitCode = result.status ?? 1;
