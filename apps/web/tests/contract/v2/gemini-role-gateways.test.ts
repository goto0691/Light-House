import { describe, expect, test, vi } from "vitest";

import {
  GeminiGroundedResearchGateway,
  GeminiMainAnalyzerGateway,
  GeminiProviderError,
  msUntilPacificMidnight,
  type GeminiClientBinding,
} from "@/lib/v2/ai/gemini-role-gateways";
import { DEFAULT_V2_MODEL_ROUTES, getV2ModelRoutes } from "@/lib/v2/ai/model-routing";
import type { V2StructuredModelRequest } from "@/lib/v2/ai/gateway";

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["place_review", "workout_log", "unknown"] },
    rating: { type: ["number", "null"], minimum: 0, maximum: 5 },
  },
  required: ["title", "kind", "rating"],
} as const;

const structuredRequest: V2StructuredModelRequest = {
  role: "main_analyzer",
  schemaId: "capture-analysis.v1",
  promptVersion: "capture-analysis.v1",
  inputHash: "sha256:synthetic-capture",
  deadlineMs: 1_000,
  systemInstruction: "Extract only what is supported by the source.",
  parts: [
    { text: "오늘 5.2km를 달렸고 몸이 가벼웠다." },
    { inlineData: { mimeType: "image/png", data: "c3ludGhldGlj" } },
  ],
  responseJsonSchema: analysisSchema,
};

function createClient(input: {
  structured?: unknown;
  interaction?: unknown;
  generateError?: unknown;
}) {
  const generateContent = input.generateError
    ? vi.fn().mockRejectedValue(input.generateError)
    : vi.fn().mockResolvedValue({
        text: JSON.stringify(input.structured),
        modelVersion: "gemini-3.6-flash",
        usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 12 },
      });
  const create = vi.fn().mockResolvedValue(input.interaction ?? {});
  return {
    client: { models: { generateContent }, interactions: { create } } as GeminiClientBinding,
    generateContent,
    create,
  };
}

describe("Gemini role gateways", () => {
  test("pins the two user-selected stable model aliases without fallback", () => {
    expect(DEFAULT_V2_MODEL_ROUTES).toEqual({
      main_analyzer: "gemini-3.6-flash",
      grounded_enricher: "gemini-3.5-flash-lite",
    });
    expect(getV2ModelRoutes({ GEMINI_MAIN_MODEL: "main-fixed", GEMINI_GROUNDED_MODEL: "search-fixed" })).toEqual({
      main_analyzer: "main-fixed",
      grounded_enricher: "search-fixed",
    });
  });

  test("sends Korean multimodal input with JSON Schema only to the main analyzer", async () => {
    const { client, generateContent } = createClient({
      structured: { title: "5.2km 달리기", kind: "workout_log", rating: null },
    });
    const gateway = new GeminiMainAnalyzerGateway(client);

    await expect(gateway.generate(structuredRequest)).resolves.toMatchObject({
      data: { title: "5.2km 달리기", kind: "workout_log", rating: null },
      modelId: "gemini-3.6-flash",
      role: "main_analyzer",
      tokenUsage: { input: 25, output: 12 },
    });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.6-flash",
        contents: [{ role: "user", parts: structuredRequest.parts }],
        config: expect.objectContaining({ responseJsonSchema: analysisSchema }),
      }),
    );
    expect(JSON.stringify(generateContent.mock.calls[0])).not.toContain("google_search");
  });

  test("rejects syntactically valid JSON that violates the application schema", async () => {
    const { client } = createClient({ structured: { title: "달리기", kind: "workout_log", rating: 9 } });
    const gateway = new GeminiMainAnalyzerGateway(client);
    await expect(gateway.generate(structuredRequest)).rejects.toMatchObject({ code: "invalid_schema", retryable: false });
  });

  test("maps provider quota failures without switching to the other role model", async () => {
    const { client, generateContent, create } = createClient({
      generateError: { status: 429, message: "RESOURCE_EXHAUSTED quota" },
    });
    const gateway = new GeminiMainAnalyzerGateway(client);
    await expect(gateway.generate(structuredRequest)).rejects.toMatchObject({ code: "quota_exhausted", retryable: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    [400, "invalid_request", "provider_unavailable", false],
    [401, "authentication", "provider_unavailable", false],
    [403, "permission_or_model_access", "provider_unavailable", false],
    [404, "model_unavailable_or_access", "provider_unavailable", false],
    [408, "timeout", "timeout", true],
    [413, "request_too_large", "provider_unavailable", false],
    [429, "quota_or_rate_limit", "quota_exhausted", true],
    [500, "provider_server", "provider_unavailable", true],
    [503, "provider_server", "provider_unavailable", true],
  ] as const)("classifies HTTP %i without retaining provider response text", async (status, category, code, retryable) => {
    const { client } = createClient({
      generateError: { status, message: "PRIVATE_CAPTURE_TEXT raw response and key=SYNTHETIC_SECRET" },
    });
    const gateway = new GeminiMainAnalyzerGateway(client);
    const error = await gateway.generate(structuredRequest).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(error).toMatchObject({ status, category, code, retryable });
    expect((error as GeminiProviderError).message).toBe(`Gemini request failed: ${category} (HTTP ${status}).`);
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_CAPTURE_TEXT|SYNTHETIC_SECRET/);
  });

  function quotaBody(quotaId: string, retryDelay: string) {
    return JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "PRIVATE_CAPTURE_TEXT quota detail key=SYNTHETIC_SECRET", details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId, quotaValue: "20" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
    ] } });
  }

  test("a daily free-tier quota waits until after the Pacific midnight reset without keeping quota details", async () => {
    vi.useFakeTimers();
    try {
      // 2026-09-28 09:30 UTC = 02:30 PDT, so the reset is 21.5 hours away.
      vi.setSystemTime(new Date("2026-09-28T09:30:00.000Z"));
      const { client } = createClient({ generateError: { status: 429, message: quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20.587s") } });
      const error = await new GeminiMainAnalyzerGateway(client).generate(structuredRequest).catch((failure: unknown) => failure) as GeminiProviderError;
      expect(error).toMatchObject({ status: 429, code: "quota_exhausted", retryable: true, quotaWindow: "daily" });
      expect(error.retryAfterMs).toBe(21.5 * 60 * 60_000 + 5 * 60_000);
      expect(JSON.stringify(error)).not.toMatch(/PRIVATE_CAPTURE_TEXT|SYNTHETIC_SECRET|FreeTier|free_tier|"20"/);
    } finally { vi.useRealTimers(); }
  });

  test("a per-minute quota uses only the provider's numeric retry delay", async () => {
    const { client } = createClient({ generateError: { status: 429, message: quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "20.587s") } });
    const error = await new GeminiMainAnalyzerGateway(client).generate(structuredRequest).catch((failure: unknown) => failure) as GeminiProviderError;
    expect(error).toMatchObject({ code: "quota_exhausted", quotaWindow: "per_minute", retryAfterMs: 20_587 });
  });

  test("an unparseable quota body keeps the default governor pacing", async () => {
    const { client } = createClient({ generateError: { status: 429, message: "{not json" } });
    const error = await new GeminiMainAnalyzerGateway(client).generate(structuredRequest).catch((failure: unknown) => failure) as GeminiProviderError;
    expect(error).toMatchObject({ code: "quota_exhausted", quotaWindow: "unknown", retryAfterMs: null });
  });

  test("computes the Pacific midnight distance on both sides of the UTC date line", () => {
    expect(msUntilPacificMidnight(new Date("2026-09-28T06:59:00.000Z"))).toBe(60_000); // 23:59 PDT
    expect(msUntilPacificMidnight(new Date("2026-12-28T08:00:00.000Z"))).toBe(24 * 60 * 60_000); // 00:00 PST
  });

  test("classifies a transport failure without echoing an SDK exception", async () => {
    const { client } = createClient({ generateError: new Error("PRIVATE_CAPTURE_TEXT key=SYNTHETIC_SECRET") });
    const error = await new GeminiMainAnalyzerGateway(client).generate(structuredRequest).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: null, category: "transport_or_sdk", code: "provider_unavailable", retryable: true });
    expect((error as GeminiProviderError).message).toBe("Gemini request failed: transport_or_sdk (HTTP unavailable).");
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_CAPTURE_TEXT|SYNTHETIC_SECRET/);
  });

  test.each(["API_KEY_INVALID", "UNKNOWN_PRIVATE_REASON"])("only exposes allowlisted Google ErrorInfo reason %s", async (reason) => {
    const { client } = createClient({ generateError: { status: 400, message: JSON.stringify({ error: {
      message: "PRIVATE_CAPTURE_TEXT key=SYNTHETIC_SECRET", details: [{
        "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, metadata: { key: "SYNTHETIC_SECRET" },
      }],
    } }) } });
    const error = await new GeminiMainAnalyzerGateway(client).generate(structuredRequest).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 400, providerReason: reason === "API_KEY_INVALID" ? reason : null });
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_CAPTURE_TEXT|SYNTHETIC_SECRET|UNKNOWN_PRIVATE_REASON/);
  });

  test("classifies an abort as a timeout without retaining its message", async () => {
    const { client } = createClient({ generateError: { name: "AbortError", message: "PRIVATE_CAPTURE_TEXT" } });
    const error = await new GeminiMainAnalyzerGateway(client).generate(structuredRequest).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: null, category: "timeout", code: "timeout", retryable: true });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_CAPTURE_TEXT");
  });

  test("uses the same safe classification for grounded research errors", async () => {
    const client: GeminiClientBinding = {
      models: { generateContent: vi.fn() },
      interactions: { create: vi.fn().mockRejectedValue({ status: 403, message: "PRIVATE_CAPTURE_TEXT" }) },
    };
    const error = await new GeminiGroundedResearchGateway(client).research({
      role: "grounded_enricher",
      prompt: "Synthetic query",
      promptVersion: "entity-enrichment.v1",
      inputHash: "sha256:synthetic",
      deadlineMs: 1_000,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 403, category: "permission_or_model_access", code: "provider_unavailable", retryable: false });
    expect(JSON.stringify(error)).not.toContain("PRIVATE_CAPTURE_TEXT");
  });

  test("preserves Google Search queries and UTF-8 byte-range citations in a grounded envelope", async () => {
    const answer = "영화의 감독은 홍길동이다.";
    const prefixBytes = new TextEncoder().encode("영화의 감독은 ").byteLength;
    const citedBytes = new TextEncoder().encode("홍길동").byteLength;
    const { client, create } = createClient({
      interaction: {
        output_text: answer,
        usage: { total_input_tokens: 18, total_output_tokens: 9 },
        steps: [
          { type: "google_search_call", arguments: { queries: ["영화 감독 공식 정보"] } },
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: answer,
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/official-film",
                    title: "공식 영화 정보",
                    start_index: prefixBytes,
                    end_index: prefixBytes + citedBytes,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const gateway = new GeminiGroundedResearchGateway(client);

    const result = await gateway.research({
      role: "grounded_enricher",
      prompt: "이 영화의 감독을 공식 출처로 확인해줘.",
      promptVersion: "entity-enrichment.v1",
      inputHash: "sha256:synthetic-film",
      deadlineMs: 3_000,
    });
    expect(result).toMatchObject({
      modelId: "gemini-3.5-flash-lite",
      answer,
      queries: ["영화 감독 공식 정보"],
      citations: [expect.objectContaining({ citedText: "홍길동", url: "https://example.com/official-film" })],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.5-flash-lite",
        tools: [{ type: "google_search" }],
        store: false,
      }),
      { timeout: 3_000, maxRetries: 0 },
    );
    expect(JSON.stringify(create.mock.calls[0])).not.toContain("response_format");
  });

  test("does not accept an external fact when the search response has no citation", async () => {
    const { client } = createClient({
      interaction: { output_text: "확인되지 않은 외부 사실", steps: [{ type: "model_output", content: [] }] },
    });
    const gateway = new GeminiGroundedResearchGateway(client);
    await expect(
      gateway.research({
        role: "grounded_enricher",
        prompt: "외부 사실을 찾아줘.",
        promptVersion: "entity-enrichment.v1",
        inputHash: "sha256:no-citation",
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "invalid_schema", retryable: false });
  });
});
