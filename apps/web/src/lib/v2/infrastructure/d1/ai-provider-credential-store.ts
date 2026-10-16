import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

/** ChatGPT plan credential (Sign in with ChatGPT, plan usage scope). */
export type OpenAIPlanCredential = Readonly<{
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: readonly string[];
  accountHint: string | null;
}>;
export type OpenAIPlanCredentialRecord = Readonly<{
  credential: OpenAIPlanCredential;
  status: "active" | "inactive";
  pausedUntil: string | null;
  lastErrorCode: string | null;
  version: number;
}>;
export interface OpenAIPlanCredentialStore {
  load(): Promise<OpenAIPlanCredentialRecord | null>;
  /** Compare-and-set on version; false when another worker changed the row first. */
  replace(credential: OpenAIPlanCredential, expectedVersion: number, now: Date): Promise<boolean>;
  markInactive(code: string, expectedVersion: number, now: Date): Promise<void>;
  pause(until: Date, code: string, expectedVersion: number, now: Date): Promise<void>;
}

const PROVIDER = "openai_plan";
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A 32-byte AES-GCM key from base64 or base64url. Anything else disables the store. */
export async function importCredentialKey(value: string | undefined): Promise<CryptoKey | null> {
  if (!value?.trim()) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = base64ToBytes(value.trim().replace(/-/g, "+").replace(/_/g, "/")); } catch { return null; }
  if (bytes.byteLength !== 32) return null;
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function validCredential(value: unknown): value is OpenAIPlanCredential {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.clientId === "string" && item.clientId.startsWith("oaiapp_") && typeof item.accessToken === "string" && Boolean(item.accessToken)
    && typeof item.refreshToken === "string" && Boolean(item.refreshToken) && typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt))
    && Array.isArray(item.scopes) && item.scopes.every((scope) => typeof scope === "string")
    && (item.accountHint === null || typeof item.accountHint === "string");
}

export class D1OpenAIPlanCredentialStore implements OpenAIPlanCredentialStore {
  constructor(private readonly db: D1DatabaseBinding, private readonly key: CryptoKey) {}

  private async encrypt(credential: OpenAIPlanCredential) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(PROVIDER) }, this.key,
      encoder.encode(JSON.stringify(credential))));
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
  }

  async load(): Promise<OpenAIPlanCredentialRecord | null> {
    let row: { status: "active" | "inactive"; ciphertext: string; iv: string; version: number; paused_until: string | null; last_error_code: string | null } | null;
    try {
      row = await this.db.prepare("select status,ciphertext,iv,version,paused_until,last_error_code from v2_ai_provider_credentials where provider=? limit 1")
        .bind(PROVIDER).first();
    } catch (error) {
      if (/no such table/i.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
    if (!row) return null;
    let credential: unknown;
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(row.iv), additionalData: encoder.encode(PROVIDER) }, this.key, base64ToBytes(row.ciphertext));
      credential = JSON.parse(new TextDecoder().decode(plain));
    } catch { return null; }
    if (!validCredential(credential)) return null;
    return { credential, status: row.status, pausedUntil: row.paused_until, lastErrorCode: row.last_error_code, version: row.version };
  }

  /** Install or replace after a fresh sign-in; reactivates a disconnected credential. */
  async install(credential: OpenAIPlanCredential, now: Date) {
    if (!validCredential(credential)) throw new Error("credential_invalid");
    const sealed = await this.encrypt(credential);
    await this.db.prepare(`insert into v2_ai_provider_credentials(provider,status,ciphertext,iv,version,paused_until,last_error_code,updated_at)
      values (?,'active',?,?,1,null,null,?)
      on conflict(provider) do update set status='active',ciphertext=excluded.ciphertext,iv=excluded.iv,version=v2_ai_provider_credentials.version+1,
        paused_until=null,last_error_code=null,updated_at=excluded.updated_at`).bind(PROVIDER, sealed.ciphertext, sealed.iv, now.toISOString()).run();
  }

  async replace(credential: OpenAIPlanCredential, expectedVersion: number, now: Date) {
    const sealed = await this.encrypt(credential);
    const result = await this.db.prepare(`update v2_ai_provider_credentials set ciphertext=?,iv=?,version=version+1,updated_at=?
      where provider=? and version=? and status='active'`).bind(sealed.ciphertext, sealed.iv, now.toISOString(), PROVIDER, expectedVersion).run() as { meta?: { changes?: number }; changes?: number };
    return (result.meta?.changes ?? result.changes ?? 0) === 1;
  }

  async markInactive(code: string, expectedVersion: number, now: Date) {
    await this.db.prepare(`update v2_ai_provider_credentials set status='inactive',last_error_code=?,version=version+1,updated_at=?
      where provider=? and version=?`).bind(code, now.toISOString(), PROVIDER, expectedVersion).run();
  }

  async pause(until: Date, code: string, expectedVersion: number, now: Date) {
    await this.db.prepare(`update v2_ai_provider_credentials set paused_until=?,last_error_code=?,updated_at=?
      where provider=? and version=? and status='active'`).bind(until.toISOString(), code, now.toISOString(), PROVIDER, expectedVersion).run();
  }
}
