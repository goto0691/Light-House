export const FACET_PAGE_CONTRACT = "facet-page.v1" as const;
export const FACET_PAGE_SIZE = 20 as const;
export type FacetKind = "type" | "entity" | "month";
export type FacetRequest = Readonly<{ kind: FacetKind; query: string; page: number; selectedKey: string | null }>;
export type FacetItem = Readonly<{ key: string; label: string; count: number; entityKind: string | null }>;
export type FacetPage = Readonly<{
  contract: typeof FACET_PAGE_CONTRACT; kind: FacetKind; query: string;
  page: number; pageSize: typeof FACET_PAGE_SIZE; totalCount: number; totalPages: number;
  items: readonly FacetItem[]; selected: FacetItem | null;
}>;

const canonicalKey = /^[a-z][a-z0-9_.-]{0,99}$/;
const monthKey = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const cleanText = (value: string) => !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value);
function invalid(): never { throw new Error("The facet page is invalid."); }
const safeInteger = (value: unknown, minimum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}

/** Capture primitive values before any schema probe or database await. */
export function captureFacetRequest(input: FacetRequest): FacetRequest {
  const { kind, query, page, selectedKey } = input;
  if (!["type", "entity", "month"].includes(kind) || typeof query !== "string" || query.length > 100 || !cleanText(query)
    || !safeInteger(page, 1) || !(selectedKey === null || (kind === "type" && typeof selectedKey === "string" && canonicalKey.test(selectedKey)))) invalid();
  return Object.freeze({ kind, query: query.trim(), page, selectedKey });
}

export function parseFacetRequest(params: URLSearchParams): FacetRequest {
  const allowed = ["kind", "q", "page", "selected"];
  if ([...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)) invalid();
  const rawPage = params.get("page") ?? "1";
  if (!/^[1-9][0-9]*$/.test(rawPage)) invalid();
  return captureFacetRequest({ kind: params.get("kind") as FacetKind, query: params.get("q") ?? "", page: Number(rawPage), selectedKey: params.get("selected") });
}

function readItem(value: unknown, kind: FacetKind): FacetItem {
  const item = exactObject(value, ["key", "label", "count", "entityKind"]);
  if (typeof item.key !== "string" || !item.key || !cleanText(item.key)
    // Stored labels can contain line breaks/tabs under the existing analysis contract; render as text, not a query.
    || typeof item.label !== "string" || !item.label || !safeInteger(item.count, 1)
    || (kind === "type" && !canonicalKey.test(item.key))
    || (kind === "month" && (!monthKey.test(item.key) || item.label !== item.key))
    || (kind === "entity" ? typeof item.entityKind !== "string" || !item.entityKind || !cleanText(item.entityKind) : item.entityKind !== null)) invalid();
  return Object.freeze({ key: item.key, label: item.label, count: item.count, entityKind: item.entityKind as string | null });
}

/** A response is scoped to this request; it cannot silently replace a selected key. */
export function validateFacetPage(body: unknown, candidate: FacetRequest): FacetPage {
  const request = captureFacetRequest(candidate);
  const row = exactObject(body, ["contract", "kind", "query", "page", "pageSize", "totalCount", "totalPages", "items", "selected"]);
  if (row.contract !== FACET_PAGE_CONTRACT || row.kind !== request.kind || row.query !== request.query || row.pageSize !== FACET_PAGE_SIZE
    || !safeInteger(row.totalCount, 0) || !safeInteger(row.totalPages, 1) || !safeInteger(row.page, 1)
    || row.totalPages !== Math.max(1, Math.ceil(row.totalCount / FACET_PAGE_SIZE)) || row.page !== Math.min(request.page, row.totalPages)
    || !Array.isArray(row.items) || row.items.length !== Math.min(FACET_PAGE_SIZE, Math.max(0, row.totalCount - (row.page - 1) * FACET_PAGE_SIZE))) invalid();
  const items = row.items.map((value) => readItem(value, request.kind));
  if (new Set(items.map((item) => item.key)).size !== items.length) invalid();
  for (let index = 1; index < items.length; index++) {
    if (request.kind === "month" ? items[index - 1].key <= items[index].key : items[index - 1].count < items[index].count) invalid();
  }
  const selected = row.selected === null ? null : readItem(row.selected, request.kind);
  if (selected && (request.kind !== "type" || selected.key !== request.selectedKey)) invalid();
  const inPage = items.find((item) => item.key === request.selectedKey);
  if (inPage && (!selected || inPage.label !== selected.label || inPage.count !== selected.count || inPage.entityKind !== selected.entityKind)) invalid();
  return Object.freeze({ contract: FACET_PAGE_CONTRACT, kind: request.kind, query: request.query, page: row.page, pageSize: FACET_PAGE_SIZE,
    totalCount: row.totalCount, totalPages: row.totalPages, items: Object.freeze(items), selected });
}
