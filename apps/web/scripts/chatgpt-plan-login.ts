import { exec } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

// Sign in with ChatGPT (plan usage) for this personal, locally run project.
// Uses the documented self-serve dynamic registration with a 127.0.0.1 loopback
// callback. Tokens are written only to .private/chatgpt-plan (git-ignored) and
// are never printed. Run: npm exec --workspace @light-house/web -- tsx scripts/chatgpt-plan-login.ts
const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PORT = 1455;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/auth/callback`;
const DIRECTORY = fileURLToPath(new URL("../../../.private/chatgpt-plan/", import.meta.url));

const base64url = (bytes: Buffer) => bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function readJson<T>(name: string): Promise<T | null> {
  try { return JSON.parse(await readFile(`${DIRECTORY}${name}`, "utf8")) as T; } catch { return null; }
}
async function writeJsonAtomic(name: string, value: unknown) {
  await mkdir(DIRECTORY, { recursive: true });
  const temporary = `${DIRECTORY}${name}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, `${DIRECTORY}${name}`);
}

async function main() {
  const host = await readJson<{ extAgentHostId: string }>("host.json") ?? { extAgentHostId: `urn:uuid:${randomUUID()}` };
  await writeJsonAtomic("host.json", host);
  const existing = await readJson<{ clientId?: string; idToken?: string }>("credentials.json");
  const verifier = base64url(randomBytes(48));
  const state = base64url(randomBytes(24));
  const nonce = base64url(randomBytes(24));
  const params = new URLSearchParams({
    client_id: existing?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: host.extAgentHostId,
    redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPES, resource: RESOURCE,
    state, nonce, code_challenge: base64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
  });
  if (!existing?.clientId) params.set("agent_name_hint", "Light House (personal)");
  if (existing?.idToken) params.set("id_token_hint", existing.idToken);
  const authorizeUrl = `${AUTHORIZE_URL}?${params}`;

  const callback = await new Promise<URLSearchParams>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/auth/callback") { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end("<!doctype html><meta charset=utf-8><p>Light House: 연결 결과를 터미널에서 확인하세요. 이 창은 닫아도 됩니다.</p>");
      server.close();
      resolve(url.searchParams);
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log("브라우저에서 ChatGPT 로그인과 '플랜 사용' 승인을 완료해 주세요. 열리지 않으면 아래 주소를 직접 여세요.");
      console.log(authorizeUrl);
      // Also leave the address in a git-ignored file in case no browser opens.
      void writeFile(`${DIRECTORY}authorize-url.txt`, `${authorizeUrl}
`, { encoding: "utf8", mode: 0o600 });
      exec(`rundll32 url.dll,FileProtocolHandler "${authorizeUrl}"`);
    });
    setTimeout(() => { server.close(); reject(new Error("login_timeout")); }, 10 * 60_000).unref();
  });

  if (callback.get("state") !== state) throw new Error("state_mismatch");
  if (callback.get("error")) throw new Error(`authorize_${callback.get("error")}`);
  const issuedClientId = callback.get("client_id") ?? existing?.clientId ?? null;
  if (!issuedClientId?.startsWith("oaiapp_")) throw new Error("registration_incomplete");
  if (existing?.clientId && callback.get("client_id") && callback.get("client_id") !== existing.clientId) throw new Error("client_id_changed");

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: issuedClientId, code: callback.get("code") ?? "",
      code_verifier: verifier, redirect_uri: REDIRECT_URI, resource: RESOURCE }),
  });
  const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; token_type?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token || !token.refresh_token) throw new Error(`token_exchange_failed_${tokenResponse.status}_${token.error ?? "unknown"}`);
  const scopes = (token.scope ?? callback.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const planUsage = scopes.includes("chatgpt.tokens.use.direct");
  const claims = token.id_token ? JSON.parse(Buffer.from(token.id_token.split(".")[1], "base64url").toString("utf8")) as { email?: string; sub?: string; iss?: string } : {};
  await writeJsonAtomic("credentials.json", {
    clientId: issuedClientId, extAgentHostId: host.extAgentHostId, email: claims.email ?? null, subject: claims.sub ?? null, issuer: claims.iss ?? null,
    idToken: token.id_token ?? existing?.idToken ?? null, accessToken: token.access_token, refreshToken: token.refresh_token,
    tokenType: token.token_type ?? "Bearer", expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    scopes, savedAt: new Date().toISOString(),
  });

  const models = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  const listed = await models.json().catch(() => ({})) as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
  console.log(JSON.stringify({
    connected: true, planUsageGranted: planUsage, account: claims.email ?? null,
    models: models.ok ? (listed.models ?? []).filter((model) => model.visibility === "list").map((model) => ({ slug: model.slug, name: model.display_name })) : `models_request_failed_${models.status}`,
    savedTo: ".private/chatgpt-plan/credentials.json (git-ignored)",
  }, null, 2));
  if (!planUsage) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ scope: "chatgpt-plan-login", failed: true, reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "unexpected" }));
  process.exitCode = 1;
});
