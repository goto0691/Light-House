export type V2PropertyFilter = Readonly<{
  fieldKey: string;
  operator: "exists" | "eq" | "contains" | "gte" | "lte";
  value?: string | number | boolean | null;
}>;

export type V2EntityFilter = Readonly<{
  entityKind?: string;
  canonicalName?: string;
  targetObjectId?: string;
}>;

export type V2RetrievalQueryPlanV1 = Readonly<{
  contractVersion: "retrieval-query-v1";
  targetObjectKind: "document";
  fullText: string | null;
  typeKeys: readonly string[];
  propertyFilters: readonly V2PropertyFilter[];
  entityFilters: readonly V2EntityFilter[];
  dateFilter: Readonly<{ axis: "captured_at" | "written_at"; from: string | null; to: string | null }> | null;
  sort: Readonly<{ field: "relevance" | "updated_at" | "captured_at" | "written_at" | "title"; direction: "asc" | "desc" }>;
  limit: number;
}>;

export class V2QueryPlanError extends Error {
  constructor(readonly code: "query_plan_invalid", message: string) { super(message); this.name = "V2QueryPlanError"; }
}

const canonicalKey = /^[a-z][a-z0-9_.-]{0,99}$/;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDay(value: string) {
  if (!isoDay.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function invalid(message: string): never { throw new V2QueryPlanError("query_plan_invalid", message); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("The retrieval query contains unsupported keys.");
}

export function defaultV2QueryPlan(input: Partial<V2RetrievalQueryPlanV1> = {}): V2RetrievalQueryPlanV1 {
  return validateV2QueryPlan({
    contractVersion: "retrieval-query-v1",
    targetObjectKind: "document",
    fullText: null,
    typeKeys: [],
    propertyFilters: [],
    entityFilters: [],
    dateFilter: null,
    sort: { field: input.fullText ? "relevance" : "updated_at", direction: "desc" },
    limit: 50,
    ...input,
  });
}

export function validateV2QueryPlan(value: unknown): V2RetrievalQueryPlanV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("The retrieval query must be an object.");
  const root = value as Record<string, unknown>;
  exactKeys(root, ["contractVersion", "targetObjectKind", "fullText", "typeKeys", "propertyFilters", "entityFilters", "dateFilter", "sort", "limit"]);
  if (root.contractVersion !== "retrieval-query-v1" || root.targetObjectKind !== "document") invalid("The retrieval query contract is not supported.");
  if (root.fullText !== null && (typeof root.fullText !== "string" || !root.fullText.trim() || root.fullText.trim().length > 300
    || /\u0000|[\uD800-\uDFFF]/u.test(root.fullText))) invalid("The full-text query is invalid.");
  if (!Array.isArray(root.typeKeys) || root.typeKeys.length > 20 || root.typeKeys.some((key) => typeof key !== "string" || !canonicalKey.test(key))) invalid("A type filter is invalid.");
  if (!Array.isArray(root.propertyFilters) || root.propertyFilters.length > 20) invalid("Too many property filters were requested.");
  const propertyFilters = root.propertyFilters.map((candidate): V2PropertyFilter => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return invalid("A property filter is invalid.");
    const filter = candidate as Record<string, unknown>;
    const keys = filter.operator === "exists" ? ["fieldKey", "operator"] : ["fieldKey", "operator", "value"];
    exactKeys(filter, keys);
    if (typeof filter.fieldKey !== "string" || !canonicalKey.test(filter.fieldKey)) return invalid("A property field key is invalid.");
    if (!(["exists", "eq", "contains", "gte", "lte"] as const).includes(filter.operator as never)) return invalid("A property operator is invalid.");
    const operator = filter.operator as V2PropertyFilter["operator"];
    if (operator !== "exists" && !(filter.value === null || ["string", "number", "boolean"].includes(typeof filter.value))) return invalid("A property filter value is invalid.");
    if ((operator === "gte" || operator === "lte") && (typeof filter.value !== "number" || !Number.isFinite(filter.value))) return invalid("Numeric filters require a finite number.");
    if (operator === "contains" && (typeof filter.value !== "string" || !filter.value.trim() || filter.value.length > 200)) return invalid("Contains filters require text.");
    return operator === "exists" ? { fieldKey: filter.fieldKey, operator } : { fieldKey: filter.fieldKey, operator, value: filter.value as string | number | boolean | null };
  });
  if (!Array.isArray(root.entityFilters) || root.entityFilters.length > 10) invalid("Too many entity filters were requested.");
  const entityFilters = root.entityFilters.map((candidate): V2EntityFilter => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return invalid("An entity filter is invalid.");
    const filter = candidate as Record<string, unknown>;
    if (!Object.keys(filter).length || Object.keys(filter).some((key) => !["entityKind", "canonicalName", "targetObjectId"].includes(key))) return invalid("An entity filter contains unsupported keys.");
    if (filter.entityKind !== undefined && (typeof filter.entityKind !== "string" || !canonicalKey.test(filter.entityKind))) return invalid("An entity kind is invalid.");
    if (filter.canonicalName !== undefined && (typeof filter.canonicalName !== "string" || !filter.canonicalName.trim() || filter.canonicalName.length > 200)) return invalid("An entity name is invalid.");
    if (filter.targetObjectId !== undefined && (typeof filter.targetObjectId !== "string" || !filter.targetObjectId.trim() || filter.targetObjectId.length > 100)) return invalid("An entity object ID is invalid.");
    return { entityKind: filter.entityKind as string | undefined, canonicalName: filter.canonicalName as string | undefined, targetObjectId: filter.targetObjectId as string | undefined };
  });
  let dateFilter: V2RetrievalQueryPlanV1["dateFilter"] = null;
  if (root.dateFilter !== null) {
    if (!root.dateFilter || typeof root.dateFilter !== "object" || Array.isArray(root.dateFilter)) invalid("The date filter is invalid.");
    const filter = root.dateFilter as Record<string, unknown>;
    exactKeys(filter, ["axis", "from", "to"]);
    if (!(["captured_at", "written_at"] as const).includes(filter.axis as never)) invalid("The date axis is invalid.");
    if (filter.from !== null && (typeof filter.from !== "string" || !validIsoDay(filter.from))) invalid("The start date is invalid.");
    if (filter.to !== null && (typeof filter.to !== "string" || !validIsoDay(filter.to))) invalid("The end date is invalid.");
    if (filter.from && filter.to && filter.from > filter.to) invalid("The date range is inverted.");
    dateFilter = { axis: filter.axis as "captured_at" | "written_at", from: filter.from as string | null, to: filter.to as string | null };
  }
  if (!root.sort || typeof root.sort !== "object" || Array.isArray(root.sort)) invalid("The sort definition is invalid.");
  const sort = root.sort as Record<string, unknown>;
  exactKeys(sort, ["field", "direction"]);
  if (!(["relevance", "updated_at", "captured_at", "written_at", "title"] as const).includes(sort.field as never) || !(["asc", "desc"] as const).includes(sort.direction as never)) invalid("The sort definition is invalid.");
  if (!Number.isInteger(root.limit) || (root.limit as number) < 1 || (root.limit as number) > 100) invalid("The retrieval limit is invalid.");
  return {
    contractVersion: "retrieval-query-v1", targetObjectKind: "document",
    fullText: root.fullText === null ? null : (root.fullText as string).trim(),
    typeKeys: [...new Set(root.typeKeys as string[])], propertyFilters, entityFilters, dateFilter,
    sort: { field: sort.field as V2RetrievalQueryPlanV1["sort"]["field"], direction: sort.direction as "asc" | "desc" },
    limit: root.limit as number,
  };
}
