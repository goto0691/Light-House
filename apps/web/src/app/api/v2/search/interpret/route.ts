import { ulid } from "ulidx";

import { V2ModelError } from "@/lib/v2/ai/gateway";
import { createGeminiRoleGateways, GeminiProviderError } from "@/lib/v2/ai/gemini-role-gateways";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { readNaturalQueryCatalog } from "@/lib/v2/infrastructure/d1/natural-query-catalog-repository";
import { NaturalQueryError, parseNaturalQuestion, prepareNaturalQueryRequest, resolveNaturalQueryDraft, seoulToday } from "@/lib/v2/retrieval/natural-query-v1";
import { NATURAL_QUERY_INTERPRETATION_CONTRACT, naturalSearchHref } from "@/lib/v2/retrieval/plan-presentation";

const MAX_BODY_BYTES = 4096;
const KEYWORD_FALLBACK = "키워드 검색은 그대로 사용할 수 있습니다.";

class InterpretHttpError extends V2HttpError {
  constructor(status: number, code: string, message: string, readonly retryable: boolean, readonly retryAt: string | null = null) {
    super(status, code, message);
  }
}

function laterIso(...values: (string | null | undefined)[]) {
  const times = values.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return times.length ? new Date(Math.max(...times.map((value) => Date.parse(value)))).toISOString() : null;
}

/** Only the category crosses this boundary; provider text and the question are never echoed or logged. */
function providerFailure(error: unknown, retryAt: string | null): InterpretHttpError {
  const rateLimited = () => new InterpretHttpError(429, "search_quota_exhausted", `AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요. ${KEYWORD_FALLBACK}`, true, retryAt);
  const timeout = () => new InterpretHttpError(504, "natural_query_timeout", "AI 해석 시간이 초과되었습니다. 다시 시도하거나 키워드로 검색해 주세요.", true, retryAt);
  const unavailable = () => new InterpretHttpError(503, "natural_query_provider_unavailable", `AI 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요. ${KEYWORD_FALLBACK}`, true, retryAt);
  const rejected = () => new InterpretHttpError(502, "natural_query_provider_rejected", `AI 서비스가 이 요청을 처리하지 못했습니다. ${KEYWORD_FALLBACK}`, false);
  if (error instanceof GeminiProviderError) {
    if (error.category === "quota_or_rate_limit") return rateLimited();
    if (error.category === "timeout") return timeout();
    if (error.category === "provider_server" || error.category === "transport_or_sdk") return unavailable();
    return rejected();
  }
  if (error instanceof V2ModelError) {
    if (error.code === "quota_exhausted") return rateLimited();
    if (error.code === "timeout") return timeout();
    if (error.code === "invalid_schema") return new InterpretHttpError(502, "natural_query_invalid_output", "AI 해석 결과를 검색 조건으로 확인하지 못했습니다. 다시 시도하거나 키워드로 검색해 주세요.", true);
    return error.retryable ? unavailable() : rejected();
  }
  return unavailable();
}

function errorResponse(error: unknown) {
  let response: Response;
  if (error instanceof InterpretHttpError) {
    response = Response.json({ error: { code: error.code, message: error.message, retryable: error.retryable, retryAt: error.retryAt } }, { status: error.status });
    const seconds = error.retryAt ? Math.ceil((Date.parse(error.retryAt) - Date.now()) / 1000) : 0;
    if (seconds > 0) response.headers.set("Retry-After", String(seconds));
  } else if (error instanceof NaturalQueryError && error.code === "natural_query_question_invalid") {
    response = Response.json({ error: { code: error.code, message: error.message, retryable: false, retryAt: null } }, { status: 400 });
  } else response = v2ErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * One explicit provider call per user action. It shares the main-analyzer
 * governor with the durable queue: a paused or exhausted quota, or a probe
 * lease held by queued work, rejects the request before any provider call.
 */
export async function POST(request: Request) {
  try {
    const flags = requireV2Route();
    const context = await requireV2RequestContext(request, { mutation: true });
    if (!flags.ai) throw new InterpretHttpError(503, "v2_ai_disabled", `AI 해석이 꺼져 있습니다. ${KEYWORD_FALLBACK}`, false);
    const body = await readJsonObject(request, { maxBytes: MAX_BODY_BYTES });
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "question"))
      throw new InterpretHttpError(400, "natural_query_request_invalid", "질문만 보내 주세요.", false);
    const question = parseNaturalQuestion(body.question);
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new InterpretHttpError(503, "gemini_not_configured", `AI 해석이 아직 설정되지 않았습니다. ${KEYWORD_FALLBACK}`, false);
    const db = getV2CloudflareBindings().db;
    const catalog = await readNaturalQueryCatalog(db, context.userId);
    const today = seoulToday();
    const prepared = await prepareNaturalQueryRequest({ question, today, catalog });

    const governor = new D1AiRuntimeGovernor(db);
    const owner = `http-${crypto.randomUUID()}:search_interpret:${ulid()}`;
    const permit = await governor.tryAcquire("main_analyzer", owner, new Date());
    if (!permit.allowed) {
      if (permit.state === "quota_exhausted")
        throw new InterpretHttpError(429, "search_quota_exhausted", `AI 사용량 한도를 회복하는 중입니다. ${KEYWORD_FALLBACK}`, true, permit.retryAt);
      throw new InterpretHttpError(503, "search_ai_paused", `AI가 잠시 쉬거나 다른 기록을 처리하는 중입니다. 잠시 후 다시 시도해 주세요. ${KEYWORD_FALLBACK}`, true, permit.retryAt);
    }
    let draft: unknown;
    try {
      try {
        draft = (await createGeminiRoleGateways(apiKey).mainAnalyzer.generate<unknown>(prepared.request)).data;
      } catch (error) {
        if (!(error instanceof V2ModelError)) throw providerFailure(error, null);
        const failedAt = new Date();
        await governor.recordFailure("main_analyzer", owner, error.code, failedAt, error.retryAfterMs);
        const hinted = error.retryAfterMs ? new Date(failedAt.getTime() + error.retryAfterMs).toISOString() : null;
        const state = error.code === "invalid_schema" ? null : await governor.inspect("main_analyzer");
        throw providerFailure(error, laterIso(hinted, state?.retry_after));
      }
      // A draft that fails local validation still counts as a provider success for pacing.
      await governor.recordSuccess("main_analyzer", owner, new Date());
    } finally {
      await governor.release("main_analyzer", owner, new Date());
    }
    let interpretation: ReturnType<typeof resolveNaturalQueryDraft>;
    try { interpretation = resolveNaturalQueryDraft(draft, { question, today, catalog }); }
    catch (error) {
      if (error instanceof NaturalQueryError) throw providerFailure(new V2ModelError("invalid_schema", "Natural query draft rejected.", false), null);
      throw error;
    }
    return Response.json({
      contract: NATURAL_QUERY_INTERPRETATION_CONTRACT, today, plan: interpretation.plan, href: naturalSearchHref(interpretation.plan),
      chips: interpretation.chips, dropped: interpretation.dropped,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
