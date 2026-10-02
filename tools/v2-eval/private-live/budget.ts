import { GoogleGenAI } from "@google/genai";

import { GeminiMainAnalyzerGateway, GeminiProviderError, type GeminiClientBinding } from "@/lib/v2/ai/gemini-role-gateways";
import { V2ModelError, type V2StructuredModelGateway, type V2StructuredModelRequest, type V2StructuredModelResult } from "@/lib/v2/ai/gateway";
import type { V2ModelRoutes } from "@/lib/v2/ai/model-routing";
import { fail, MAX_PROVIDER_CALLS } from "./boundary";

export type SafeProviderFailure = { status: number | null; category: string; code: string; quota_window: string | null; retry_after_ms: number | null };
export type CallObservation = { input_hash: string; status: "reserved" | "succeeded" | "failed"; input_tokens: number | null; output_tokens: number | null; latency_ms: number; failure?: SafeProviderFailure };
function safeTokens(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function safeFailure(error: unknown): SafeProviderFailure {
  if (error instanceof GeminiProviderError) return { status: error.status, category: error.category, code: error.code, quota_window: error.quotaWindow, retry_after_ms: error.retryAfterMs };
  if (error instanceof V2ModelError) return { status: null, category: "model_error", code: error.code, quota_window: null, retry_after_ms: error.retryAfterMs };
  return { status: null, category: "unclassified_failure", code: "provider_unavailable", quota_window: null, retry_after_ms: null };
}
/** SDK has no retry path when retryOptions is absent. Tests exercise the installed SDK transport. */
export function createLiveGateway(routes: V2ModelRoutes): V2StructuredModelGateway {
  const apiKey = process.env.GEMINI_API_KEY?.trim(); if (!apiKey) fail("PRIVATE_LIVE_KEY_MISSING");
  const sdk = new GoogleGenAI({ apiKey, vertexai: false, apiVersion: "v1beta", httpOptions: { baseUrl: "https://generativelanguage.googleapis.com" } });
  return { async generate<T>(request: V2StructuredModelRequest) {
    let usageKnown = false;
    const client: GeminiClientBinding = { models: { async generateContent(input) {
      const response = await sdk.models.generateContent(input as unknown as Parameters<typeof sdk.models.generateContent>[0]);
      usageKnown = safeTokens(response.usageMetadata?.promptTokenCount) !== null && safeTokens(response.usageMetadata?.candidatesTokenCount) !== null;
      return response;
    } }, interactions: { async create() { throw new V2ModelError("provider_unavailable", "Grounded enrichment is outside the authorized evaluation.", false); } } };
    const result = await new GeminiMainAnalyzerGateway(client, routes).generate<T>(request);
    // Production stores zero defaults; observability must distinguish missing provider usage from measured zero.
    return usageKnown ? result : { ...result, tokenUsage: undefined };
  } };
}
/** Limits all generate attempts, including failures. First failure closes the gate permanently. */
export class OnePassBudgetGateway implements V2StructuredModelGateway {
  readonly calls: CallObservation[] = [];
  private readonly inputs = new Set<string>();
  private halted = false;
  constructor(private readonly delegate: V2StructuredModelGateway, private readonly modelId: string,
    private readonly beforeCall: () => Promise<void>, private readonly saveAttempt: (call: CallObservation, index: number) => Promise<void>,
    private readonly saveResult: (result: V2StructuredModelResult<unknown>, index: number) => Promise<void>) {}
  async generate<T>(request: V2StructuredModelRequest): Promise<V2StructuredModelResult<T>> {
    if (this.halted || this.calls.length >= MAX_PROVIDER_CALLS || this.inputs.has(request.inputHash)) fail("PRIVATE_LIVE_BUDGET_EXHAUSTED");
    if (request.role !== "main_analyzer" || request.deadlineMs !== 90_000) fail("PRIVATE_LIVE_INPUT_INVALID");
    try { await this.beforeCall(); } catch (error) { this.halted = true; throw error; }
    // Approval rechecks can yield. Revalidate and reserve synchronously after that await.
    if (this.halted || this.calls.length >= MAX_PROVIDER_CALLS || this.inputs.has(request.inputHash)) fail("PRIVATE_LIVE_BUDGET_EXHAUSTED");
    const started = Date.now(), call: CallObservation = { input_hash: request.inputHash, status: "reserved", input_tokens: null, output_tokens: null, latency_ms: 0 };
    this.inputs.add(request.inputHash); this.calls.push(call); const reservation = this.calls.length;
    try {
      await this.saveAttempt(call, reservation);
      if (this.halted) fail("PRIVATE_LIVE_BUDGET_EXHAUSTED");
      const result = await this.delegate.generate<T>(request);
      if (result.role !== request.role || result.inputHash !== request.inputHash || result.modelId !== this.modelId) fail("PRIVATE_LIVE_IDENTITY_CHANGED");
      await this.saveResult(result, reservation);
      call.status = "succeeded"; call.input_tokens = safeTokens(result.tokenUsage?.input); call.output_tokens = safeTokens(result.tokenUsage?.output);
      return result;
    } catch (error) {
      this.halted = true; call.status = "failed"; call.failure = safeFailure(error);
      // Unknown SDK errors may contain request/output/key strings. Never retain their message or cause.
      if (error instanceof V2ModelError) throw error;
      throw new V2ModelError("provider_unavailable", "The private evaluation stopped after a failed invocation.", false);
    } finally { call.latency_ms = Math.max(0, Date.now() - started); }
  }
  stop() { this.halted = true; }
  get stopped() { return this.halted; }
}
