import { GoogleGenAI } from "@google/genai";

import {
  V2ModelError,
  type V2GroundedCitation,
  type V2GroundedResearchGateway,
  type V2GroundedResearchRequest,
  type V2GroundedResearchResult,
  type V2ModelErrorCode,
  type V2StructuredModelGateway,
  type V2StructuredModelRequest,
  type V2StructuredModelResult,
} from "@/lib/v2/ai/gateway";
import { getV2ModelRoutes, resolveV2ModelForRole, type V2ModelRoutes } from "@/lib/v2/ai/model-routing";
import { validateJsonSchemaValue } from "@/lib/v2/ai/safe-json-schema";
import { toGeminiResponseJsonSchema } from "@/lib/v2/ai/gemini-wire-schema";

type GenerateResponseBinding = {
  text?: string;
  modelVersion?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

type InteractionAnnotationBinding = {
  type: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
};

type InteractionStepBinding =
  | { type: "google_search_call"; arguments?: { queries?: string[] } }
  | {
      type: "model_output";
      content?: Array<{ type: string; text?: string; annotations?: InteractionAnnotationBinding[] }>;
    }
  | { type: string };

type InteractionResponseBinding = {
  output_text?: string;
  steps?: InteractionStepBinding[];
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
};

function isGoogleSearchStep(
  step: InteractionStepBinding,
): step is Extract<InteractionStepBinding, { type: "google_search_call" }> {
  return step.type === "google_search_call" && "arguments" in step;
}

function isModelOutputStep(
  step: InteractionStepBinding,
): step is Extract<InteractionStepBinding, { type: "model_output" }> {
  return step.type === "model_output" && "content" in step;
}

export type GeminiClientBinding = {
  models: {
    generateContent(input: Record<string, unknown>): Promise<GenerateResponseBinding>;
  };
  interactions: {
    create(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<InteractionResponseBinding>;
  };
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type GeminiProviderFailureCategory =
  | "invalid_request"
  | "authentication"
  | "permission_or_model_access"
  | "model_unavailable_or_access"
  | "timeout"
  | "request_too_large"
  | "quota_or_rate_limit"
  | "request_rejected"
  | "provider_server"
  | "transport_or_sdk";

const SAFE_PROVIDER_REASONS = ["API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "SERVICE_DISABLED", "BILLING_DISABLED"] as const;
export type GeminiProviderReason = typeof SAFE_PROVIDER_REASONS[number];

function safeProviderReason(message: unknown): GeminiProviderReason | null {
  if (typeof message !== "string" || message.length > 65_536) return null;
  try {
    const details: unknown = JSON.parse(message)?.error?.details;
    if (!Array.isArray(details)) return null;
    for (const detail of details) {
      if (detail?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo"
        && SAFE_PROVIDER_REASONS.includes(detail.reason)) return detail.reason as GeminiProviderReason;
    }
  } catch { /* SDK text and unrecognized errors remain redacted. */ }
  return null;
}

export type GeminiQuotaWindow = "daily" | "per_minute" | "unknown";
const MAX_PROVIDER_RETRY_DELAY_MS = 26 * 60 * 60_000;
// Google resets per-day Gemini API quotas at midnight Pacific time. The margin
// keeps the first probe after the reset away from the boundary.
const DAILY_QUOTA_RESET_MARGIN_MS = 5 * 60_000;

/** Milliseconds until the next midnight in America/Los_Angeles (wall clock). */
export function msUntilPacificMidnight(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + now.getUTCMilliseconds();
  return Math.max(1_000, 24 * 60 * 60_000 - elapsed);
}

/** Reads only the quota window class and numeric retry delay; quota IDs, limits and messages are discarded. */
function safeQuotaRetry(message: unknown, now: Date): { window: GeminiQuotaWindow; retryAfterMs: number | null } {
  if (typeof message !== "string" || message.length > 65_536) return { window: "unknown", retryAfterMs: null };
  let window: GeminiQuotaWindow = "unknown";
  let delayMs: number | null = null;
  try {
    const details: unknown = JSON.parse(message)?.error?.details;
    if (!Array.isArray(details)) return { window, retryAfterMs: null };
    for (const detail of details) {
      if (detail?.["@type"] === "type.googleapis.com/google.rpc.QuotaFailure" && Array.isArray(detail.violations)) {
        for (const violation of detail.violations) {
          const quotaId = typeof violation?.quotaId === "string" ? violation.quotaId : "";
          if (/PerDay/.test(quotaId)) window = "daily";
          else if (/PerMinute/.test(quotaId) && window === "unknown") window = "per_minute";
        }
      }
      if (detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && typeof detail.retryDelay === "string") {
        const match = /^(\d{1,6})(?:\.(\d{1,9}))?s$/.exec(detail.retryDelay);
        if (match) delayMs = Number(match[1]) * 1000 + Math.round(Number(`0.${match[2] ?? "0"}`) * 1000);
      }
    }
  } catch { return { window: "unknown", retryAfterMs: null }; }
  // RetryInfo on a daily quota only describes the per-request pacing, not the reset.
  const retryAfterMs = window === "daily" ? msUntilPacificMidnight(now) + DAILY_QUOTA_RESET_MARGIN_MS : delayMs;
  return { window, retryAfterMs: retryAfterMs === null ? null : Math.min(MAX_PROVIDER_RETRY_DELAY_MS, retryAfterMs) };
}

export class GeminiProviderError extends V2ModelError {
  readonly status: number | null;
  readonly category: GeminiProviderFailureCategory;
  readonly providerReason: GeminiProviderReason | null;
  readonly quotaWindow: GeminiQuotaWindow | null;

  constructor(input: { status: number | null; category: GeminiProviderFailureCategory; code: V2ModelErrorCode; retryable: boolean; providerReason?: GeminiProviderReason | null; quotaWindow?: GeminiQuotaWindow | null; retryAfterMs?: number | null }) {
    super(input.code, `Gemini request failed: ${input.category} (HTTP ${input.status ?? "unavailable"}).`, input.retryable, input.retryAfterMs ?? null);
    this.status = input.status;
    this.category = input.category;
    this.providerReason = input.providerReason ?? null;
    this.quotaWindow = input.quotaWindow ?? null;
  }
}

function classifyProviderError(error: unknown, now = new Date()): V2ModelError {
  if (error instanceof V2ModelError) return error;
  // The SDK's ApiError.message contains the full response body. Only numeric HTTP
  // status, a known abort name, allowlisted ErrorInfo reason, and the quota
  // window class/retry delay may cross this boundary. Never retain the message,
  // cause, metadata, quota IDs/limits or unknown reason.
  const candidate = error && typeof error === "object" ? error as { status?: unknown; statusCode?: unknown; name?: unknown; message?: unknown } : null;
  const rawStatus = candidate?.status ?? candidate?.statusCode;
  const status = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : null;
  if (status === 408 || (status === null && (candidate?.name === "AbortError" || candidate?.name === "TimeoutError"))) {
    return new GeminiProviderError({ status, category: "timeout", code: "timeout", retryable: true });
  }
  if (status === 429) {
    const quota = safeQuotaRetry(candidate?.message, now);
    return new GeminiProviderError({ status, category: "quota_or_rate_limit", code: "quota_exhausted", retryable: true, quotaWindow: quota.window, retryAfterMs: quota.retryAfterMs });
  }
  if (status === 400 || status === 422) {
    return new GeminiProviderError({ status, category: "invalid_request", code: "provider_unavailable", retryable: false, providerReason: safeProviderReason(candidate?.message) });
  }
  if (status === 401) {
    return new GeminiProviderError({ status, category: "authentication", code: "provider_unavailable", retryable: false });
  }
  if (status === 403) {
    return new GeminiProviderError({ status, category: "permission_or_model_access", code: "provider_unavailable", retryable: false, providerReason: safeProviderReason(candidate?.message) });
  }
  if (status === 404) {
    return new GeminiProviderError({ status, category: "model_unavailable_or_access", code: "provider_unavailable", retryable: false });
  }
  if (status === 413) {
    return new GeminiProviderError({ status, category: "request_too_large", code: "provider_unavailable", retryable: false });
  }
  if (status !== null && status >= 500) {
    return new GeminiProviderError({ status, category: "provider_server", code: "provider_unavailable", retryable: true });
  }
  if (status !== null) {
    return new GeminiProviderError({ status, category: "request_rejected", code: "provider_unavailable", retryable: false });
  }
  return new GeminiProviderError({ status: null, category: "transport_or_sdk", code: "provider_unavailable", retryable: true });
}

function requireMainAnalyzerRequest(request: V2StructuredModelRequest) {
  if (request.role !== "main_analyzer") {
    throw new V2ModelError("provider_unavailable", "Structured generation is reserved for the main analyzer role.", false);
  }
  if (!request.systemInstruction?.trim() || !request.parts?.length || !request.responseJsonSchema) {
    throw new V2ModelError("invalid_schema", "Structured requests require instruction, parts, and JSON Schema.", false);
  }
}

function sliceUtf8Bytes(text: string, start: number, end: number) {
  return new TextDecoder().decode(new TextEncoder().encode(text).slice(start, end));
}

function extractGrounding(response: InteractionResponseBinding) {
  const queries: string[] = [];
  const citations: V2GroundedCitation[] = [];

  for (const step of response.steps ?? []) {
    if (isGoogleSearchStep(step)) {
      queries.push(...(step.arguments?.queries ?? []));
    }
    if (isModelOutputStep(step)) {
      for (const block of step.content ?? []) {
        if (block.type !== "text" || !block.text) continue;
        for (const annotation of block.annotations ?? []) {
          if (
            annotation.type !== "url_citation" ||
            !annotation.url?.startsWith("https://") ||
            !Number.isInteger(annotation.start_index) ||
            !Number.isInteger(annotation.end_index)
          ) {
            continue;
          }
          const startByte = annotation.start_index ?? 0;
          const endByte = annotation.end_index ?? startByte;
          citations.push({
            url: annotation.url,
            title: annotation.title ?? null,
            startByte,
            endByte,
            citedText: sliceUtf8Bytes(block.text, startByte, endByte),
          });
        }
      }
    }
  }

  return {
    queries: [...new Set(queries)],
    citations: citations.filter(
      (citation, index) => citations.findIndex((candidate) => candidate.url === citation.url && candidate.startByte === citation.startByte) === index,
    ),
  };
}

export class GeminiMainAnalyzerGateway implements V2StructuredModelGateway {
  constructor(
    private readonly client: GeminiClientBinding,
    private readonly routes: V2ModelRoutes = getV2ModelRoutes(),
  ) {}

  async generate<T>(request: V2StructuredModelRequest): Promise<V2StructuredModelResult<T>> {
    requireMainAnalyzerRequest(request);
    const responseJsonSchema = request.responseJsonSchema;
    if (!responseJsonSchema) {
      throw new V2ModelError("invalid_schema", "A response JSON Schema is required.", false);
    }
    const startedAt = Date.now();
    const model = resolveV2ModelForRole(request.role, this.routes);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), request.deadlineMs);

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: [{ role: "user", parts: request.parts }],
        config: {
          abortSignal: abortController.signal,
          systemInstruction: request.systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiResponseJsonSchema(responseJsonSchema),
        },
      });
      if (!response.text) {
        throw new V2ModelError("invalid_schema", "Gemini returned an empty structured response.", false);
      }

      let data: unknown;
      try {
        data = JSON.parse(response.text);
      } catch {
        throw new V2ModelError("invalid_schema", "Gemini returned invalid JSON.", false);
      }
      const validation = validateJsonSchemaValue(responseJsonSchema, data);
      if (!validation.valid) {
        throw new V2ModelError("invalid_schema", validation.errors.join(" "), false);
      }
      const serialized = JSON.stringify(data);
      return {
        data: data as T,
        role: request.role,
        modelId: model,
        inputHash: request.inputHash,
        outputHash: await sha256(serialized),
        tokenUsage: {
          input: response.usageMetadata?.promptTokenCount ?? 0,
          output: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
        latencyMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (error) {
      throw classifyProviderError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class GeminiGroundedResearchGateway implements V2GroundedResearchGateway {
  constructor(
    private readonly client: GeminiClientBinding,
    private readonly routes: V2ModelRoutes = getV2ModelRoutes(),
  ) {}

  async research(request: V2GroundedResearchRequest): Promise<V2GroundedResearchResult> {
    const startedAt = Date.now();
    const model = resolveV2ModelForRole(request.role, this.routes);

    try {
      const response = await this.client.interactions.create(
        {
          model,
          input: request.prompt,
          tools: [{ type: "google_search" }],
          store: false,
          background: false,
        },
        { timeout: request.deadlineMs, maxRetries: 0 },
      );
      const answer = response.output_text?.trim();
      if (!answer) {
        throw new V2ModelError("invalid_schema", "Gemini returned an empty grounded response.", false);
      }
      const { queries, citations } = extractGrounding(response);
      if (citations.length === 0) {
        throw new V2ModelError("invalid_schema", "Grounded research returned no verifiable URL citation.", false);
      }
      const serialized = JSON.stringify({ answer, citations, queries });
      return {
        role: request.role,
        modelId: model,
        answer,
        citations,
        queries,
        inputHash: request.inputHash,
        outputHash: await sha256(serialized),
        tokenUsage: {
          input: response.usage?.total_input_tokens ?? 0,
          output: response.usage?.total_output_tokens ?? 0,
        },
        latencyMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

export function createGeminiRoleGateways(apiKey: string, routes = getV2ModelRoutes()) {
  if (!apiKey.trim()) throw new Error("GEMINI_API_KEY is required.");
  const client = new GoogleGenAI({ apiKey }) as unknown as GeminiClientBinding;
  return {
    mainAnalyzer: new GeminiMainAnalyzerGateway(client, routes),
    groundedResearch: new GeminiGroundedResearchGateway(client, routes),
  };
}
