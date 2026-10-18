// Local hands-on check of V2: `npm run dev:local`.
// - Login, sessions and V1 queries use the local Wrangler D1 (LIGHT_HOUSE_D1_MODE=local).
// - Remote database, R2 and Cloudflare API credentials are blanked for the child process,
//   so nothing here can read or write the production D1/R2.
// - V2 write, AI, offline and the V2 Library home are on.
// - A cron stand-in runs the processing queue like the Worker's 5-minute cron.
// - The local browser helper (scripts/local-browser-runner.mjs) opens Threads/Instagram posts the owner
//   picks in a dedicated Chrome profile on this PC. Set LIGHT_HOUSE_LOCAL_BROWSER=0 to leave it off.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";

if (process.env.NODE_ENV === "production") throw new Error("dev-local is for local development only.");

const appDir = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const intervalMs = Number(process.env.LOCAL_PROCESSING_INTERVAL_MS ?? 20_000);
nextEnv.loadEnvConfig(appDir, true);

const blanked = ["CLOUDFLARE_API_TOKEN", "DATABASE_AUTH_TOKEN", "DATABASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLOUDFLARE_IMAGES_TOKEN", "WORKERS_AI_TOKEN"];
const env = {
  ...process.env,
  ...Object.fromEntries(blanked.map((name) => [name, ""])),
  LIGHT_HOUSE_D1_MODE: "local",
  FLAG_V2_ROUTES: "1",
  FLAG_V2_WRITE: "1",
  FLAG_V2_AI: "1",
  FLAG_V2_OFFLINE: "1",
  FLAG_V2_DEFAULT_LIBRARY: "1",
};
// The processing route needs a runner secret; without a configured one, use a per-run value.
env.CRON_SECRET = env.CRON_SECRET?.trim() || randomBytes(24).toString("hex");

const helpers = [];
if (process.env.LIGHT_HOUSE_LOCAL_BROWSER !== "0") {
  const helperPort = Number(process.env.LIGHT_HOUSE_LOCAL_BROWSER_PORT ?? 3101);
  const helperSecret = randomBytes(32).toString("hex");
  const profile = fileURLToPath(new URL("../../../.private/local-browser-profile", import.meta.url));
  env.LIGHT_HOUSE_LOCAL_BROWSER_URL = `http://127.0.0.1:${helperPort}`;
  env.LIGHT_HOUSE_LOCAL_BROWSER_SECRET = helperSecret;
  helpers.push(spawn(process.execPath, [fileURLToPath(new URL("./local-browser-runner.mjs", import.meta.url))], {
    cwd: appDir, stdio: "inherit",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
      LIGHT_HOUSE_LOCAL_BROWSER_PORT: String(helperPort), LIGHT_HOUSE_LOCAL_BROWSER_SECRET: helperSecret, LIGHT_HOUSE_LOCAL_BROWSER_PROFILE: profile },
  }));
}

const nextBin = createRequire(`${appDir}package.json`).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--port", String(port)], { cwd: appDir, env, stdio: "inherit" });
const stop = () => { clearInterval(timer); for (const helper of helpers) if (!helper.killed) helper.kill(); if (!child.killed) child.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => { clearInterval(timer); for (const helper of helpers) if (!helper.killed) helper.kill(); process.exit(code ?? 0); });

const secret = env.CRON_SECRET;
let busy = false;
const timer = setInterval(async () => {
  if (!secret || busy) return;
  busy = true;
  try {
    const response = await fetch(`http://localhost:${port}/api/v2/processing/run`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    if (!response.ok) return;
    const result = await response.json();
    const outcomes = [...(result.analysisOutcomes ?? []), ...(result.linkAnalysisOutcomes ?? []), ...(result.groundingOutcomes ?? [])]
      .map((outcome) => outcome?.outcome).filter((outcome) => outcome && outcome !== "idle");
    if (result.dispatched || outcomes.length) console.log(`[dev-local] processing: dispatched=${result.dispatched ?? 0} ${outcomes.join(",")}`);
  } catch {
    // The server is still starting or compiling; the next tick retries.
  } finally {
    busy = false;
  }
}, intervalMs);
