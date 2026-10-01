import { validateV2QueryPlan, V2QueryPlanError } from "./query-plan-v1";
import { queryPlanFromSearchParams } from "./search-params";

/** HTTP contract is strict; browser form defaults remain independently forgiving. */
export function retrievalRequestQuery(query: URLSearchParams) {
  const allowed = query.has("plan") ? ["plan", "page"] : ["q", "type", "rating", "from", "to", "sort", "direction", "entity", "entity_kind", "entity_name", "page"];
  if ([...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1))
    throw new V2QueryPlanError("query_plan_invalid", "지원하지 않거나 중복된 검색 조건입니다.");
  const page = Number(query.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1)
    throw new V2QueryPlanError("query_plan_invalid", "검색 페이지가 올바르지 않습니다.");
  if ((query.get("q")?.trim().length ?? 0) > 300)
    throw new V2QueryPlanError("query_plan_invalid", "검색어는 300자 이내로 입력해 주세요.");
  if (!query.has("plan")) return { plan: queryPlanFromSearchParams(query), page };
  const encoded = query.get("plan")!;
  if (!encoded || encoded.length > 16_000)
    throw new V2QueryPlanError("query_plan_invalid", "검색 조건의 크기를 확인해 주세요.");
  let supplied: unknown;
  try { supplied = JSON.parse(encoded); }
  catch { throw new V2QueryPlanError("query_plan_invalid", "검색 조건의 형식을 확인해 주세요."); }
  return { plan: validateV2QueryPlan(supplied), page };
}
