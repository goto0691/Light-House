import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ANALYSIS_ENVELOPE_V1_SCHEMA } from "@/lib/v2/ai/analysis-envelope-v1";
import { V2ModelError, type V2StructuredModelGateway, type V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { MainAnalyzerFallbackGateway } from "@/lib/v2/ai/main-analyzer-gateway";
import { OpenAIPlanMainAnalyzerGateway, OpenAIPlanProviderError } from "@/lib/v2/ai/openai-plan-gateway";
import { dropNullOptionals, toOpenAIStrictJsonSchema } from "@/lib/v2/ai/openai-wire-schema";
import { validateJsonSchemaValue } from "@/lib/v2/ai/safe-json-schema";
import { D1OpenAIPlanCredentialStore, importCredentialKey, type OpenAIPlanCredential } from "@/lib/v2/infrastructure/d1/ai-provider-credential-store";
import { LinkSqlite } from "../../support/link-sqlite";

const KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-10-16T09:00:00.000Z");
const schema = {
  type: "object", additionalProperties: false, required: ["title", "items"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 20 },
    items: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["key"], properties: { key: { const: "k" }, note: { type: "string" } } } },
    rating: { type: ["number", "null"], minimum: 0 },
  },
} as const;
const request = (parts: V2StructuredModelRequest["parts"] = [{ text: "합성 입력" }]): V2StructuredModelRequest => ({
  role: "main_analyzer", schemaId: "synthetic.v1", promptVersion: "p1", inputHash: "sha256:x", deadlineMs: 5_000,
  systemInstruction: "Return JSON only.", parts, responseJsonSchema: schema,
});
const credential = (overrides: Partial<OpenAIPlanCredential> = {}): OpenAIPlanCredential => ({
  clientId: "oaiapp_synthetic", accessToken: "SYNTHETIC_ACCESS", refreshToken: "SYNTHETIC_REFRESH", expiresAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
  scopes: ["openid", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], accountHint: "owner@example.test", ...overrides,
});
function sse(events: unknown[]) {
  return new Response(events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
function completed(text: string) {
  return sse([{ type: "response.created" }, ...text.match(/.{1,7}/gsu)!.map((delta) => ({ type: "response.output_text.delta", delta })),
    { type: "response.completed", response: { model: "gpt-6.1-sol", usage: { input_tokens: 11, output_tokens: 5 } } }]);
}

let db: LinkSqlite;
let store: D1OpenAIPlanCredentialStore;
beforeEach(async () => {
  db = new LinkSqlite(32);
  db.sql.exec(readFileSync(fileURLToPath(new URL("../../../../../migrations/0033_v2_ai_provider_credentials.sql", import.meta.url)), "utf8"));
  store = new D1OpenAIPlanCredentialStore(db, (await importCredentialKey(KEY))!);
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); });

describe("OpenAI strict schema projection", () => {
  test("makes optional properties required-but-nullable, keeps local bounds out, and round-trips through null removal", () => {
    const projected = toOpenAIStrictJsonSchema(schema);
    expect(projected).toEqual({
      type: "object", additionalProperties: false, required: ["title", "items", "rating"],
      properties: {
        title: { type: "string" },
        items: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "note"], properties: { key: { type: "string", enum: ["k"] }, note: { type: ["string", "null"] } } } },
        rating: { type: ["number", "null"], minimum: 0 },
      },
    });
    const strictAnswer = { title: "t", items: [{ key: "k", note: null }], rating: null };
    const cleaned = dropNullOptionals(strictAnswer, schema);
    expect(cleaned).toEqual({ title: "t", items: [{ key: "k" }], rating: null });
    expect(validateJsonSchemaValue(schema, cleaned).valid).toBe(true);
  });

  test("projects the full analysis envelope without unsupported keywords and every object fully required", () => {
    const projected = JSON.stringify(toOpenAIStrictJsonSchema(ANALYSIS_ENVELOPE_V1_SCHEMA));
    expect(projected).not.toMatch(/"(?:const|minLength|maxLength|maxItems)":/);
    const objects = [] as { required: string[]; properties: Record<string, unknown> }[];
    (function walk(value: unknown) { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>; if (item.properties) objects.push(item as never); Object.values(item).forEach(walk); } })(JSON.parse(projected));
    expect(objects.every((item) => item.required.length === Object.keys(item.properties).length)).toBe(true);
  });
});

describe("OpenAI plan gateway", () => {
  test("sends store:false/stream:true with instructions and strict json_schema, and validates the streamed answer", async () => {
    await store.install(credential(), NOW);
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({ model: "gpt-6.1-sol", store: false, stream: true, instructions: "Return JSON only.", text: { format: { type: "json_schema", strict: true, name: "synthetic_v1" } } });
      expect(body).not.toHaveProperty("temperature");
      expect(body.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "합성 입력" }, { type: "input_image", image_url: "data:image/png;base64,QUJD" }] }]);
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer SYNTHETIC_ACCESS");
      return completed(JSON.stringify({ title: "제목", items: [{ key: "k", note: null }], rating: 4.5 }));
    });
    const gateway = new OpenAIPlanMainAnalyzerGateway({ store, model: "gpt-6.1-sol", fetch: fetch as never, now: () => NOW });
    const result = await gateway.generate(request([{ text: "합성 입력" }, { inlineData: { mimeType: "image/png", data: "QUJD" } }]));
    expect(result).toMatchObject({ data: { title: "제목", items: [{ key: "k" }], rating: 4.5 }, modelId: "openai-plan:gpt-6.1-sol", tokenUsage: { input: 11, output: 5 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("refreshes an expiring token once, stores the rotated refresh token encrypted, and never persists plain tokens", async () => {
    await store.install(credential({ expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }), NOW);
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) {
        expect(String(init!.body)).toContain("grant_type=refresh_token");
        expect(String(init!.body)).toContain("refresh_token=SYNTHETIC_REFRESH");
        return Response.json({ access_token: "ROTATED_ACCESS", refresh_token: "ROTATED_REFRESH", expires_in: 3600, scope: "chatgpt.tokens.use.direct offline_access" });
      }
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer ROTATED_ACCESS");
      return completed(JSON.stringify({ title: "t", items: [] }));
    });
    await new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => NOW }).generate(request());
    const saved = await store.load();
    expect(saved?.credential).toMatchObject({ accessToken: "ROTATED_ACCESS", refreshToken: "ROTATED_REFRESH" });
    expect(saved?.version).toBe(2);
    expect(JSON.stringify(db.sql.prepare("select * from v2_ai_provider_credentials").all())).not.toMatch(/ROTATED|SYNTHETIC|owner@example/);
  });

  test.each([
    [401, { error: { code: "subscription_sharing_invalid_user" } }, "subscription_inactive", "inactive"],
    [403, { error: { code: "subscription_sharing_user_not_eligible" } }, "subscription_inactive", "inactive"],
    [429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }, "usage_limit", "paused"],
    [500, { error: { code: "server_error", message: "PRIVATE detail" } }, "provider_server", "active"],
    [400, { error: { code: "invalid_json_schema" } }, "invalid_request", "active"],
  ])("classifies HTTP %i and updates the credential state", async (status, body, category, state) => {
    await store.install(credential(), NOW);
    const fetch = vi.fn(async () => Response.json(body, { status }));
    const error = await new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => NOW }).generate(request()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(OpenAIPlanProviderError);
    expect(error).toMatchObject({ category });
    expect(JSON.stringify(error)).not.toContain("PRIVATE");
    const saved = await store.load();
    expect(state === "inactive" ? saved?.status : state === "paused" ? Boolean(saved?.pausedUntil) : saved?.status).toBe(state === "inactive" ? "inactive" : state === "paused" ? true : "active");
  });

  test("a usage limit reported mid-stream fails the request instead of accepting partial text", async () => {
    await store.install(credential(), NOW);
    const fetch = vi.fn(async () => sse([{ type: "response.output_text.delta", delta: "{\"title\":" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]));
    await expect(new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => NOW }).generate(request())).rejects.toMatchObject({ category: "usage_limit" });
  });

  test("a revoked refresh marks the credential inactive", async () => {
    await store.install(credential({ expiresAt: NOW.toISOString() }), NOW);
    const fetch = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => NOW }).generate(request())).rejects.toMatchObject({ category: "subscription_inactive" });
    expect((await store.load())?.status).toBe("inactive");
  });

  test("a wrong encryption key reads nothing rather than corrupt credentials", async () => {
    await store.install(credential(), NOW);
    const other = new D1OpenAIPlanCredentialStore(db, (await importCredentialKey(Buffer.alloc(32, 9).toString("base64")))!);
    await expect(other.load()).resolves.toBeNull();
    await expect(importCredentialKey("short")).resolves.toBeNull();
  });
});

describe("plan-first fallback", () => {
  const fallbackResult = { data: { title: "gemini", items: [] }, role: "main_analyzer" as const, modelId: "gemini-3.6-flash", inputHash: "sha256:x", outputHash: "o", latencyMs: 1 };
  function gemini() { return { generate: vi.fn(async () => fallbackResult) } as V2StructuredModelGateway & { generate: ReturnType<typeof vi.fn> }; }

  test("uses Gemini when the plan is not connected, for video input, and after the subscription ends", async () => {
    const fallback = gemini();
    const fetch = vi.fn(async () => Response.json({ error: { code: "subscription_sharing_invalid_user" } }, { status: 401 }));
    const plan = new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => NOW });
    const gateway = new MainAnalyzerFallbackGateway(plan, fallback);
    await expect(gateway.generate(request())).resolves.toMatchObject({ modelId: "gemini-3.6-flash" });
    expect(fetch).not.toHaveBeenCalled();
    await store.install(credential(), NOW);
    await expect(gateway.generate(request([{ fileData: { fileUri: "https://www.youtube.com/watch?v=jNQXAC9IVRw" } }]))).resolves.toMatchObject({ modelId: "gemini-3.6-flash" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(gateway.generate(request())).resolves.toMatchObject({ modelId: "gemini-3.6-flash" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await store.load())?.status).toBe("inactive");
    await expect(gateway.generate(request())).resolves.toMatchObject({ modelId: "gemini-3.6-flash" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fallback.generate).toHaveBeenCalledTimes(4);
  });

  test("a plan model answer that fails validation is not retried on Gemini", async () => {
    await store.install(credential(), NOW);
    const fallback = gemini();
    const fetch = vi.fn(async () => completed(JSON.stringify({ title: "" })));
    const gateway = new MainAnalyzerFallbackGateway(new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => NOW }), fallback);
    await expect(gateway.generate(request())).rejects.toBeInstanceOf(V2ModelError);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  test("a usage cap pauses the plan for an hour and Gemini answers meanwhile", async () => {
    await store.install(credential(), NOW);
    const fallback = gemini();
    const fetch = vi.fn(async () => Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 }));
    let now = NOW;
    const gateway = new MainAnalyzerFallbackGateway(new OpenAIPlanMainAnalyzerGateway({ store, model: "m", fetch: fetch as never, now: () => now }), fallback);
    await gateway.generate(request());
    now = new Date(NOW.getTime() + 30 * 60_000);
    await gateway.generate(request());
    expect(fetch).toHaveBeenCalledTimes(1);
    now = new Date(NOW.getTime() + 61 * 60_000);
    await gateway.generate(request());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fallback.generate).toHaveBeenCalledTimes(3);
  });
});
