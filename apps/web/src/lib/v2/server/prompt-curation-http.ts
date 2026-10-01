import { PromptCurationError, type PromptCopyRole } from "@/lib/v2/domain/prompt-curation-v1";
import { linkErrorResponse, LINK_PRIVATE_HEADERS } from "@/lib/v2/http/link-route-helpers";
import { V2HttpError } from "@/lib/v2/http/request-context";

// 64 items plus 64 examples, including maximum-length Unicode IDs. This is a
// transport budget, not permission to add content/source assertions to JSON.
export const PROMPT_CURATION_REQUEST_BYTES = 256_000;
export { LINK_PRIVATE_HEADERS as PROMPT_CURATION_PRIVATE_HEADERS };

export function promptCurationQuery(request: Request, allowed: readonly string[]) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1 || !query.get(key)?.trim())) {
    throw new V2HttpError(400, "prompt_curation_request_invalid", "지원하지 않거나 중복된 정리본 조회 필드입니다.");
  }
  return query;
}

export function promptCurationCopyQuery(request: Request): { role: PromptCopyRole; mode: "standard" | "available_only" } {
  const query = promptCurationQuery(request, ["channel", "mode"]);
  const role = query.get("channel"), mode = query.get("mode") ?? "standard";
  if ((role !== "prompt" && role !== "negative_prompt" && role !== "parameters") || (mode !== "standard" && mode !== "available_only")) {
    throw new V2HttpError(400, "prompt_curation_request_invalid", "복사 역할과 원문 확보 범위 선택을 확인해 주세요.");
  }
  return { role, mode };
}

export function promptCurationErrorResponse(error: unknown) {
  if (error instanceof PromptCurationError && ["prompt_curation_copy_blocked", "prompt_curation_incomplete_copy_required", "prompt_curation_integrity_invalid"].includes(error.code)) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: 409, headers: LINK_PRIVATE_HEADERS });
  }
  return linkErrorResponse(error);
}
