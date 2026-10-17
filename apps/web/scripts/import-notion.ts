// Import the owner's Notion export into the app's LOCAL D1 (apps/web/.wrangler/state).
// Usage (repo root): npm run import:notion -- [--zip <path>] [--dry-run]
// The owner is the configured admin account (the one `npm run dev:local` logs in as).
// Nothing is sent to an AI provider and no remote database is touched.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import { getPlatformProxy } from "wrangler";

import { readNotionExport } from "../src/lib/v2/import/notion-export";
import { importNotionExport } from "../src/lib/v2/import/notion-import";
import { NOTION_DATABASES } from "../src/lib/v2/import/notion-mapping";
import type { D1DatabaseBinding } from "../src/lib/v2/infrastructure/d1/source-commit-repository";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APP = fileURLToPath(new URL("../", import.meta.url));
const OWNER_ID = "user-light-keeper";

async function main() {
  const args = process.argv.slice(2);
  const zipIndex = args.indexOf("--zip");
  const zip = zipIndex >= 0 ? args[zipIndex + 1]! : `${ROOT}migrations/Master DB-from notion.zip`;
  const dryRun = args.includes("--dry-run");
  loadEnvConfig(APP, true);
  const exported = await readNotionExport(readFileSync(zip));
  const counts = Object.fromEntries(Object.keys(NOTION_DATABASES).map((name) => [name, [...exported.pages.values()].filter((page) => page.database === name).length]));
  if (dryRun) { console.log(JSON.stringify({ dryRun: true, pagesByDatabase: counts }, null, 2)); return; }

  const platform = await getPlatformProxy<{ DB: D1DatabaseBinding }>({ configPath: `${ROOT}wrangler.toml`, persist: { path: `${APP}.wrangler/state/v3` }, remoteBindings: false });
  try {
    const db = platform.env.DB;
    // The login syncs the password on first sign-in; the owner row only needs to exist.
    const email = (process.env.LIGHT_HOUSE_ADMIN_EMAIL?.trim() || "keeper@lighthouse.local").toLowerCase();
    const name = process.env.LIGHT_HOUSE_ADMIN_NAME?.trim() || "Light Keeper";
    await db.prepare(`insert or ignore into users (id,email,display_name,hashed_password,locale,timezone,preferences,created_at,updated_at)
      values (?,?,?,null,'ko-KR','Asia/Seoul','{"theme":"system"}',datetime('now'),datetime('now'))`).bind(OWNER_ID, email, name).run();
    const stats = await importNotionExport(db, OWNER_ID, exported, { now: new Date().toISOString() });
    console.log(JSON.stringify({ imported: stats }, null, 2));
  } finally { await platform.dispose(); }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ scope: "import-notion", failed: true, errorClass: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message.slice(0, 200) : "unexpected" }));
  process.exitCode = 1;
});
