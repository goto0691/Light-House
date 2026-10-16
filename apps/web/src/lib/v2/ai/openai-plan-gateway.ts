import {
  V2ModelError, type V2ModelErrorCode, type V2ModelInputPart, type V2StructuredModelGateway, type V2StructuredModelRequest, type V2StructuredModelResult,
} from "@/lib/v2/ai/gateway";
import { dropNullOptionals, toOpenAIStrictJsonSchema } from "@/lib/v2/ai/openai-wire-schema";
import { validateJsonSchemaValue } from "@/lib/v2/ai/safe-json-schema";
import type { OpenAIPlanCredential, OpenAIPlanCredentialStore } from "@/lib/v2/infrastructure/d1/ai-provider-credential-store";

export const OPENAI_PLAN_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const OPENAI_PLAN_API = "https://api.openai.com/v1";
const REFRESH_MARGIN_MS = 2 * 60_000;
const USAGE_LIMIT_PAUSE_MS = 60 * 60_000;

export type OpenAIPlanFailureCategory =
  | "not_configured" | "paused" | "subscription_inactive" | "usage_limit" | "unsupported_input"
  | "invalid_request" | "provider_server" | "transport" | "timeout" | "incomplete";

/** Only the category, HTTP status and an allowlisted OpenAI code cross this boundary. */
export class OpenAIPlanProviderError extends V2ModelError {
  constructor(readonly category: OpenAIPlanFailureCategory, readonly status: number | null, readonly providerCode: string | null, code: V2ModelErrorCode, retryable: boolean) {
    super(code, `OpenAI plan request failed: ${category} (HTTP ${status ?? "unavailable"}).`, retryable);
    this.name = "V2ModelError";
  }
  /** Provider-side unavailability: the request may be answered by the fallback provider. */
  get fallbackEligible() { return this.category !== "invalid_request"; }
}

const SAFE_CODES = new Set([
  "subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable", "subscription_sharing_user_not_eligible",
  "subscription_sharing_invalid_user", "invalid_grant", "rate_limit_exceeded", "insufficient_quota", "model_not_found", "invalid_json_schema",
]);

function classify(status: number | null, code: string | null): OpenAIPlanProviderError {
  const safe = code && SAFE_CODES.has(code) ? code : null;
  if (safe === "subscription_sharing_invalid_user" || safe === "subscription_sharing_user_not_eligible" || safe === "invalid_grant" || status === 401 || status === 403) {
    return new OpenAIPlanProviderError("subscription_inactive", status, safe, "provider_unavailable", false);
  }
  if (safe === "subscription_sharing_usage_limit_exceeded" || safe === "subscription_sharing_usage_unavailable" || status === 429) {
    return new OpenAIPlanProviderError("usage_limit", status, safe, "quota_exhausted", true);
  }
  if (status === 408) return new OpenAIPlanProviderError("timeout", status, safe, "timeout", true);
  if (status !== null && status >= 500) return new OpenAIPlanProviderError("provider_server", status, safe, "provider_unavailable", true);
  if (status !== null) return new OpenAIPlanProviderError("invalid_request", status, safe, "provider_unavailable", false);
  return new OpenAIPlanProviderError("transport", null, safe, "provider_unavailable", true);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ContentPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string } | { type: "input_file"; filename: string; file_data: string };

/** Video/audio and provider-fetched URLs are not available on ChatGPT plan usage. */
export function openAIPlanSupportsParts(parts: readonly V2ModelInputPart[] | undefined) {
  return (parts ?? []).every((part) => "text" in part
    || ("inlineData" in part && (part.inlineData.mimeType.startsWith("image/") || part.inlineData.mimeType === "application/pdf")));
}

function content(parts: readonly V2ModelInputPart[]): ContentPart[] {
  return parts.map((part, index): ContentPart => {
    if ("text" in part) return { type: "input_text", text: part.text };
    if ("inlineData" in part && part.inlineData.mimeType.startsWith("image/")) return { type: "input_image", image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
    if ("inlineData" in part && part.inlineData.mimeType === "application/pdf") return { type: "input_file", filename: `attachment-${index + 1}.pdf`, file_data: `data:application/pdf;base64,${part.inlineData.data}` };
    throw new OpenAIPlanProviderError("unsupported_input", null, null, "provider_unavailable", false);
  });
}

function schemaName(schemaId: string) {
  return schemaId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "structured_output";
}

/** Reads the Responses SSE stream; only `response.completed` counts as success. */
async function readStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "";
  let usage: { input_tokens?: number; output_tokens?: number } | undefined;
  let model: string | undefined;
  const handle = (event: Record<string, unknown>) => {
    const type = event.type;
    if (type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    else if (type === "response.completed") {
      const response = event.response as { usage?: typeof usage; model?: string } | undefined;
      usage = response?.usage; model = response?.model;
      return "completed" as const;
    } else if (type === "response.failed" || type === "error") {
      const error = ((event.response as { error?: { code?: string } } | undefined)?.error ?? (event as { error?: { code?: string } }).error ?? event) as { code?: unknown };
      throw classify(null, typeof error.code === "string" ? error.code : null);
    } else if (type === "response.incomplete") {
      throw new OpenAIPlanProviderError("incomplete", null, null, "invalid_schema", false);
    }
    return null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
      if (handle(event) === "completed") { await reader.cancel().catch(() => undefined); return { text, usage, model }; }
    }
    if (done) break;
  }
  throw new OpenAIPlanProviderError("incomplete", null, null, "provider_unavailable", true);
}

export type OpenAIPlanDependencies = Readonly<{
  store: OpenAIPlanCredentialStore;
  model: string;
  fetch?: typeof fetch;
  now?: () => Date;
}>;

/** main_analyzer on the owner's ChatGPT plan (Sign in with ChatGPT, plan usage scope). */
export class OpenAIPlanMainAnalyzerGateway implements V2StructuredModelGateway {
  constructor(private readonly dependencies: OpenAIPlanDependencies) {}

  private get fetch() { return this.dependencies.fetch ?? fetch; }
  private now() { return this.dependencies.now?.() ?? new Date(); }

  /** Cheap pre-check so a paused/inactive or unsupported request goes straight to the fallback. */
  async ready(request: V2StructuredModelRequest) {
    if (!openAIPlanSupportsParts(request.parts)) return false;
    const record = await this.dependencies.store.load();
    return Boolean(record && record.status === "active" && !(record.pausedUntil && Date.parse(record.pausedUntil) > this.now().getTime()));
  }

  private async refresh(credential: OpenAIPlanCredential, version: number): Promise<OpenAIPlanCredential> {
    const response = await this.fetch(OPENAI_PLAN_TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: credential.clientId, refresh_token: credential.refreshToken }),
    }).catch(() => { throw classify(null, null); });
    const token = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!response.ok || !token.access_token) {
      const failure = classify(response.status === 400 && token.error === "invalid_grant" ? 401 : response.status, token.error ?? null);
      if (failure.category === "subscription_inactive") await this.dependencies.store.markInactive(failure.providerCode ?? "refresh_rejected", version, this.now());
      throw failure;
    }
    const next: OpenAIPlanCredential = { ...credential, accessToken: token.access_token, refreshToken: token.refresh_token ?? credential.refreshToken,
      expiresAt: new Date(this.now().getTime() + (token.expires_in ?? 3600) * 1000).toISOString(),
      scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : credential.scopes };
    if (await this.dependencies.store.replace(next, version, this.now())) return next;
    // Another worker refreshed first; its rotated token is the current one.
    const current = await this.dependencies.store.load();
    if (current?.status === "active" && Date.parse(current.credential.expiresAt) - this.now().getTime() > REFRESH_MARGIN_MS) return current.credential;
    throw new OpenAIPlanProviderError("transport", null, null, "provider_unavailable", true);
  }

  private async credential() {
    const record = await this.dependencies.store.load();
    if (!record || record.status !== "active") throw new OpenAIPlanProviderError("not_configured", null, null, "provider_unavailable", false);
    if (record.pausedUntil && Date.parse(record.pausedUntil) > this.now().getTime()) throw new OpenAIPlanProviderError("paused", null, record.lastErrorCode, "quota_exhausted", true);
    if (!record.credential.scopes.includes("chatgpt.tokens.use.direct")) {
      await this.dependencies.store.markInactive("plan_usage_not_granted", record.version, this.now());
      throw new OpenAIPlanProviderError("subscription_inactive", null, null, "provider_unavailable", false);
    }
    const credential = Date.parse(record.credential.expiresAt) - this.now().getTime() > REFRESH_MARGIN_MS ? record.credential : await this.refresh(record.credential, record.version);
    return { credential, version: record.version };
  }

  async generate<T>(request: V2StructuredModelRequest): Promise<V2StructuredModelResult<T>> {
    if (request.role !== "main_analyzer" || !request.systemInstruction?.trim() || !request.parts?.length || !request.responseJsonSchema) {
      throw new V2ModelError("invalid_schema", "Structured requests require the main analyzer role, instruction, parts, and JSON Schema.", false);
    }
    const input = content(request.parts);
    const { credential, version } = await this.credential();
    const startedAt = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), request.deadlineMs);
    try {
      let response: Response;
      try {
        response = await this.fetch(`${OPENAI_PLAN_API}/responses`, {
          method: "POST", signal: abort.signal,
          headers: { Authorization: `Bearer ${credential.accessToken}`, "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            model: this.dependencies.model, instructions: request.systemInstruction, store: false, stream: true,
            input: [{ type: "message", role: "user", content: input }],
            text: { format: { type: "json_schema", name: schemaName(request.schemaId), strict: true, schema: toOpenAIStrictJsonSchema(request.responseJsonSchema) } },
          }),
        });
      } catch (error) {
        throw (error as { name?: string })?.name === "AbortError" ? new OpenAIPlanProviderError("timeout", null, null, "timeout", true) : classify(null, null);
      }
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
        throw classify(response.status, typeof body?.error?.code === "string" ? body.error.code : null);
      }
      let streamed: Awaited<ReturnType<typeof readStream>>;
      try { streamed = await readStream(response.body); }
      catch (error) {
        if (error instanceof OpenAIPlanProviderError) throw error;
        throw (error as { name?: string })?.name === "AbortError" ? new OpenAIPlanProviderError("timeout", null, null, "timeout", true) : classify(null, null);
      }
      let data: unknown;
      try { data = dropNullOptionals(JSON.parse(streamed.text), request.responseJsonSchema); }
      catch { throw new V2ModelError("invalid_schema", "The plan model returned invalid JSON.", false); }
      const validation = validateJsonSchemaValue(request.responseJsonSchema, data);
      if (!validation.valid) throw new V2ModelError("invalid_schema", validation.errors.join(" "), false);
      return {
        data: data as T, role: request.role, modelId: `openai-plan:${streamed.model ?? this.dependencies.model}`, inputHash: request.inputHash,
        outputHash: await sha256(JSON.stringify(data)),
        tokenUsage: { input: streamed.usage?.input_tokens ?? 0, output: streamed.usage?.output_tokens ?? 0 },
        latencyMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (error) {
      if (error instanceof OpenAIPlanProviderError && error.category === "subscription_inactive") await this.dependencies.store.markInactive(error.providerCode ?? "subscription_inactive", version, this.now());
      if (error instanceof OpenAIPlanProviderError && error.category === "usage_limit") await this.dependencies.store.pause(new Date(this.now().getTime() + USAGE_LIMIT_PAUSE_MS), error.providerCode ?? "usage_limit", version, this.now());
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
