import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { getPlatformProxy } from "wrangler";

import { D1OpenAIPlanCredentialStore, importCredentialKey } from "../src/lib/v2/infrastructure/d1/ai-provider-credential-store";
import type { D1DatabaseBinding } from "../src/lib/v2/infrastructure/d1/source-commit-repository";

// Moves the signed-in ChatGPT plan credential into the app's LOCAL D1 (encrypted), so the
// running app owns token refresh from one place. Removes the tokens from the login file.
// Requires migration 0033 on the local database: `npx wrangler d1 migrations apply light_house_db --local`.
// Usage: npm exec --workspace @light-house/web -- tsx scripts/chatgpt-plan-install.ts --model=<slug>
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));
const CREDENTIAL_FILE = `${ROOT}.private/chatgpt-plan/credentials.json`;

async function ensureEnv(model: string | undefined) {
  let text = await readFile(ENV_FILE, "utf8").catch(() => "");
  const has = (name: string) => new RegExp(`^${name}=.+`, "m").test(text);
  const changed: string[] = [];
  if (!has("V2_AI_CREDENTIAL_KEY")) { text += `${text.endsWith("\n") || !text ? "" : "\n"}V2_AI_CREDENTIAL_KEY=${randomBytes(32).toString("base64")}\n`; changed.push("V2_AI_CREDENTIAL_KEY"); }
  if (model && !has("OPENAI_PLAN_MODEL")) { text += `OPENAI_PLAN_MODEL=${model}\n`; changed.push("OPENAI_PLAN_MODEL"); }
  else if (model) { text = text.replace(/^OPENAI_PLAN_MODEL=.*$/m, `OPENAI_PLAN_MODEL=${model}`); changed.push("OPENAI_PLAN_MODEL"); }
  if (changed.length) await writeFile(ENV_FILE, text, { encoding: "utf8", mode: 0o600 });
  const key = /^V2_AI_CREDENTIAL_KEY=(.+)$/m.exec(text)?.[1]?.trim();
  return { key, changed, model: /^OPENAI_PLAN_MODEL=(.+)$/m.exec(text)?.[1]?.trim() ?? null };
}

async function main() {
  const model = process.argv.slice(2).find((arg) => arg.startsWith("--model="))?.slice(8);
  if (model !== undefined && !/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(model)) throw new Error("model_invalid");
  const saved = JSON.parse(await readFile(CREDENTIAL_FILE, "utf8")) as Record<string, unknown>;
  if (typeof saved.accessToken !== "string" || typeof saved.refreshToken !== "string") throw new Error("no_tokens_in_login_file");
  const env = await ensureEnv(model);
  if (!env.model) throw new Error("model_required");
  const key = await importCredentialKey(env.key);
  if (!key) throw new Error("credential_key_invalid");
  const platform = await getPlatformProxy<{ DB: D1DatabaseBinding }>({ configPath: `${ROOT}wrangler.toml` });
  try {
    const table = await platform.env.DB.prepare("select name from sqlite_master where type='table' and name='v2_ai_provider_credentials'").first();
    if (!table) throw new Error("migration_0033_not_applied_locally");
    await new D1OpenAIPlanCredentialStore(platform.env.DB, key).install({
      clientId: String(saved.clientId), accessToken: saved.accessToken, refreshToken: saved.refreshToken, expiresAt: String(saved.expiresAt),
      scopes: Array.isArray(saved.scopes) ? saved.scopes.map(String) : [], accountHint: typeof saved.email === "string" ? saved.email : null,
    }, new Date());
  } finally { await platform.dispose(); }
  // The app's D1 copy now owns refresh-token rotation; a second copy would go stale.
  const { accessToken: _access, refreshToken: _refresh, ...rest } = saved;
  void _access; void _refresh;
  await writeFile(CREDENTIAL_FILE, `${JSON.stringify({ ...rest, tokensMovedTo: "local-d1", movedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ installed: "local-d1", model: env.model, envUpdated: env.changed, loginFileTokensRemoved: true }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ scope: "chatgpt-plan-install", failed: true, reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "unexpected" }));
  process.exitCode = 1;
});
