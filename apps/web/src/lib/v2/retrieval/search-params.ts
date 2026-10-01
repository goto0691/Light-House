import { defaultV2QueryPlan, type V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";

type SearchParamSource = Pick<URLSearchParams, "get">;
const CANONICAL_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
export function searchPageFromParams(params: SearchParamSource) {
  const page = Number(params.get("page") ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
function safeDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function queryPlanFromSearchParams(params: SearchParamSource): V2RetrievalQueryPlanV1 {
  const rawQuery = params.get("q")?.trim() || null;
  const q = rawQuery ? rawQuery.slice(0, 300) : null;
  const typeKeys = (params.get("type") ?? "").split(",").map((value) => value.trim()).filter((value) => CANONICAL_KEY.test(value)).slice(0, 20);
  const ratingRaw = params.get("rating");
  const rating = ratingRaw === null || ratingRaw === "" ? null : Number(ratingRaw);
  let from = safeDay(params.get("from"));
  let to = safeDay(params.get("to"));
  if (from && to && from > to) { from = null; to = null; }
  const sortField = params.get("sort");
  const direction = params.get("direction");
  const rawEntityId = params.get("entity")?.trim() || null;
  const entityId = rawEntityId && rawEntityId.length <= 100 ? rawEntityId : null;
  const rawEntityKind = params.get("entity_kind")?.trim() || null;
  const entityKind = rawEntityKind && CANONICAL_KEY.test(rawEntityKind) ? rawEntityKind : null;
  const rawEntityName = params.get("entity_name")?.trim() || null;
  const entityName = rawEntityName ? rawEntityName.slice(0, 200) : null;
  const allowedSort = ["relevance", "updated_at", "captured_at", "written_at", "title"] as const;
  return defaultV2QueryPlan({
    fullText: q,
    typeKeys,
    propertyFilters: rating !== null && Number.isFinite(rating) && rating >= 0 && rating <= 5 ? [{ fieldKey: "user_rating", operator: "gte", value: rating }] : [],
    entityFilters: entityId || entityKind || entityName ? [{ ...(entityId ? { targetObjectId: entityId } : {}), ...(entityKind ? { entityKind } : {}), ...(entityName ? { canonicalName: entityName } : {}) }] : [],
    dateFilter: from || to ? { axis: "captured_at", from, to } : null,
    sort: {
      field: allowedSort.includes(sortField as never) ? sortField as V2RetrievalQueryPlanV1["sort"]["field"] : q ? "relevance" : "updated_at",
      direction: direction === "asc" ? "asc" : "desc",
    },
    limit: 50,
  });
}
