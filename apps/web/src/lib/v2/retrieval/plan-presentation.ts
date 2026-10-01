import { defaultV2QueryPlan, validateV2QueryPlan, type V2PropertyFilter, type V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import { queryPlanFromSearchParams } from "@/lib/v2/retrieval/search-params";

/** Client-safe presentation of a validated retrieval plan. No provider or D1 access. */
export const NATURAL_QUERY_INTERPRETATION_CONTRACT = "natural-query-interpretation.v1" as const;
export const V2_SEARCH_PATH = "/v2/search" as const;
const MAX_PLAN_PARAM_CHARS = 16_000;

export type V2QueryPlanChipKind = "full_text" | "type" | "property" | "entity" | "date" | "sort" | "limit";
export type V2QueryPlanChip = Readonly<{ kind: V2QueryPlanChipKind; label: string; value: string }>;
export type V2QueryPlanLabels = Readonly<{
  types?: ReadonlyMap<string, string>;
  fields?: ReadonlyMap<string, string>;
}>;
export type NaturalQueryDroppedNote = Readonly<{ code: string; message: string }>;
export type NaturalQueryInterpretationResponse = Readonly<{
  contract: typeof NATURAL_QUERY_INTERPRETATION_CONTRACT;
  today: string;
  plan: V2RetrievalQueryPlanV1;
  href: string;
  chips: readonly V2QueryPlanChip[];
  dropped: readonly NaturalQueryDroppedNote[];
}>;

const ENTITY_KIND_LABELS: ReadonlyMap<string, string> = new Map([
  ["place", "장소"], ["work", "작품"], ["book", "책"], ["game", "게임"], ["movie", "영화"], ["person", "인물"],
  ["event", "사건"], ["organization", "단체"], ["topic", "주제"], ["product", "제품"],
]);
const SORT_LABELS: Readonly<Record<V2RetrievalQueryPlanV1["sort"]["field"], Readonly<Record<"asc" | "desc", string>>>> = {
  relevance: { desc: "관련도순", asc: "관련도순" },
  updated_at: { desc: "최근 수정순", asc: "오래전 수정순" },
  captured_at: { desc: "최근 기록순", asc: "오래전 기록순" },
  written_at: { desc: "최근 작성·경험일순", asc: "오래전 작성·경험일순" },
  title: { asc: "제목 가나다순", desc: "제목 역순" },
};
const CHIP_KINDS: readonly V2QueryPlanChipKind[] = ["full_text", "type", "property", "entity", "date", "sort", "limit"];

export function entityKindLabel(kind: string) { return ENTITY_KIND_LABELS.get(kind) ?? kind; }
export function dateAxisLabel(axis: "captured_at" | "written_at") { return axis === "written_at" ? "작성·경험한 날" : "기록한 날"; }

function propertyValue(filter: V2PropertyFilter) {
  if (filter.operator === "exists") return "값이 있음";
  const value = typeof filter.value === "boolean" ? (filter.value ? "예" : "아니요") : typeof filter.value === "string" ? `‘${filter.value}’` : String(filter.value);
  if (filter.operator === "contains") return `${value} 포함`;
  if (filter.operator === "gte") return `${value} 이상`;
  if (filter.operator === "lte") return `${value} 이하`;
  return value;
}

/** Readable chips for a plan. Labels come from the owner's catalog; unknown keys stay visible as keys. */
export function describeV2QueryPlan(candidate: V2RetrievalQueryPlanV1, labels: V2QueryPlanLabels = {}): readonly V2QueryPlanChip[] {
  const plan = validateV2QueryPlan(candidate);
  const chips: V2QueryPlanChip[] = [];
  if (plan.fullText) chips.push({ kind: "full_text", label: "검색어", value: plan.fullText });
  for (const key of plan.typeKeys) chips.push({ kind: "type", label: "분류", value: labels.types?.get(key) ?? key });
  for (const filter of plan.propertyFilters) chips.push({ kind: "property", label: labels.fields?.get(filter.fieldKey) ?? filter.fieldKey, value: propertyValue(filter) });
  for (const filter of plan.entityFilters) {
    const parts = [filter.entityKind ? entityKindLabel(filter.entityKind) : null, filter.canonicalName ? `‘${filter.canonicalName}’` : null, filter.targetObjectId ? "선택한 대상" : null].filter(Boolean);
    chips.push({ kind: "entity", label: "연결된 대상", value: parts.join(" · ") });
  }
  if (plan.dateFilter) {
    const { from, to } = plan.dateFilter;
    chips.push({ kind: "date", label: dateAxisLabel(plan.dateFilter.axis), value: from && to ? (from === to ? from : `${from} ~ ${to}`) : from ? `${from} 이후` : `${to}까지` });
  }
  chips.push({ kind: "sort", label: "정렬", value: SORT_LABELS[plan.sort.field][plan.sort.direction] });
  if (plan.limit !== 50) chips.push({ kind: "limit", label: "한 번에 표시", value: `${plan.limit}개` });
  return chips;
}

export function hasV2QueryConditions(plan: V2RetrievalQueryPlanV1) {
  return Boolean(plan.fullText || plan.typeKeys.length || plan.propertyFilters.length || plan.entityFilters.length || plan.dateFilter);
}

/**
 * Prefer the existing readable search params. When they cannot express the
 * plan exactly (for example a written_at range or several property filters),
 * fall back to the validated `plan` JSON parameter. Equality is checked by
 * parsing the simple params back through the page parser.
 */
export function searchParamsForPlan(candidate: V2RetrievalQueryPlanV1, options: { natural?: boolean } = {}) {
  const plan = validateV2QueryPlan(candidate);
  const simple = new URLSearchParams();
  if (plan.fullText) simple.set("q", plan.fullText);
  if (plan.typeKeys.length) simple.set("type", plan.typeKeys.join(","));
  const [rating] = plan.propertyFilters;
  if (plan.propertyFilters.length === 1 && rating.fieldKey === "user_rating" && rating.operator === "gte" && typeof rating.value === "number") simple.set("rating", String(rating.value));
  const [entity] = plan.entityFilters;
  if (plan.entityFilters.length === 1) {
    if (entity.targetObjectId) simple.set("entity", entity.targetObjectId);
    if (entity.entityKind) simple.set("entity_kind", entity.entityKind);
    if (entity.canonicalName) simple.set("entity_name", entity.canonicalName);
  }
  if (plan.dateFilter?.axis === "captured_at") {
    if (plan.dateFilter.from) simple.set("from", plan.dateFilter.from);
    if (plan.dateFilter.to) simple.set("to", plan.dateFilter.to);
  }
  simple.set("sort", plan.sort.field);
  simple.set("direction", plan.sort.direction);
  const params = JSON.stringify(queryPlanFromSearchParams(simple)) === JSON.stringify(plan) ? simple : new URLSearchParams({ plan: JSON.stringify(plan) });
  if (options.natural) params.set("nl", "1");
  return params;
}

export function naturalSearchHref(plan: V2RetrievalQueryPlanV1) {
  return `${V2_SEARCH_PATH}?${searchParamsForPlan(plan, { natural: true }).toString()}`;
}

/** Page parser: forgiving for readable params, strict for an explicit plan JSON parameter. */
export function pagePlanFromSearchParams(params: Pick<URLSearchParams, "get">): { plan: V2RetrievalQueryPlanV1; source: "params" | "plan"; invalid: boolean } {
  const encoded = params.get("plan");
  if (encoded === null) return { plan: queryPlanFromSearchParams(params), source: "params", invalid: false };
  try {
    if (!encoded || encoded.length > MAX_PLAN_PARAM_CHARS) throw new Error("plan size");
    return { plan: validateV2QueryPlan(JSON.parse(encoded)), source: "plan", invalid: false };
  } catch {
    return { plan: defaultV2QueryPlan(), source: "plan", invalid: true };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function boundedText(value: unknown, max: number) { return typeof value === "string" && value.length > 0 && value.length <= max; }

/** Client-side acceptance of the interpretation response; the href is recomputed, never trusted. */
export function readNaturalQueryInterpretation(value: unknown): NaturalQueryInterpretationResponse {
  if (!isObject(value) || value.contract !== NATURAL_QUERY_INTERPRETATION_CONTRACT || typeof value.today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.today))
    throw new Error("AI 해석 응답 형식을 확인하지 못했습니다.");
  const plan = validateV2QueryPlan(value.plan);
  const href = naturalSearchHref(plan);
  if (value.href !== href) throw new Error("AI 해석 응답의 검색 주소가 조건과 일치하지 않습니다.");
  if (!Array.isArray(value.chips) || value.chips.length > 80 || !Array.isArray(value.dropped) || value.dropped.length > 60)
    throw new Error("AI 해석 응답 형식을 확인하지 못했습니다.");
  const chips = value.chips.map((chip): V2QueryPlanChip => {
    if (!isObject(chip) || !CHIP_KINDS.includes(chip.kind as V2QueryPlanChipKind) || !boundedText(chip.label, 200) || !boundedText(chip.value, 600))
      throw new Error("AI 해석 조건을 확인하지 못했습니다.");
    return { kind: chip.kind as V2QueryPlanChipKind, label: chip.label as string, value: chip.value as string };
  });
  const dropped = value.dropped.map((note): NaturalQueryDroppedNote => {
    if (!isObject(note) || !boundedText(note.code, 80) || !boundedText(note.message, 400)) throw new Error("제외된 조건 정보를 확인하지 못했습니다.");
    return { code: note.code as string, message: note.message as string };
  });
  return { contract: NATURAL_QUERY_INTERPRETATION_CONTRACT, today: value.today, plan, href, chips, dropped };
}
