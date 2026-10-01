import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const profile = process.argv[2];
if (profile !== "capture" && profile !== "library") {
  throw new Error("Usage: node scripts/run-cutover-e2e.mjs <capture|library>");
}

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(webRoot, "../..");
const playwright = path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js");
const grep = profile === "capture" ? "@capture-cutover" : "@library-cutover";
const result = spawnSync(
  process.execPath,
  [playwright, "test", "tests/e2e/v2-cutover.spec.ts", "--project=desktop-chromium", "--grep", grep],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      CI: "1",
      FLAG_V2_ROUTES: "1",
      FLAG_V2_WRITE: "1",
      FLAG_V2_LEGACY_READONLY: "1",
      FLAG_V2_DEFAULT_LIBRARY: profile === "library" ? "1" : "0",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
