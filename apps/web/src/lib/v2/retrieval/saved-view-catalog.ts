export type SavedViewCatalogRequest = Readonly<{ query: string; page: number; pinnedOnly: boolean }>;
export type SavedViewSummary = Readonly<{ id: string; name: string; description: string | null; iconKey: string; pinned: boolean; pinOrder: number | null }>;
export type SavedViewCatalogPage = Readonly<{
  contract: "saved-view-catalog.v1"; query: string; pinnedOnly: boolean; page: number; pageSize: 20;
  totalCount: number; totalPages: number; views: readonly SavedViewSummary[];
}>;

export class SavedViewCatalogRequestError extends Error {
  readonly code = "saved_view_catalog_invalid";
  constructor() { super("The saved-view catalog request is invalid."); }
}
const invalidText = /[\u0000-\u001f\u007f]|[\uD800-\uDFFF]/u;
function exact(value: object, keys: readonly string[]) { const actual = Object.keys(value); return actual.length === keys.length && actual.every((key) => keys.includes(key)); }

export function parseSavedViewCatalogRequest(params: URLSearchParams): SavedViewCatalogRequest {
  if ([...params.keys()].some((key) => !["q", "page", "pinned"].includes(key) || params.getAll(key).length !== 1)) throw new SavedViewCatalogRequestError();
  const query = params.get("q") ?? "", page = params.get("page") ?? "1", pinned = params.get("pinned") ?? "0";
  if (query.length > 100 || invalidText.test(query) || !/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page)) || !["0", "1"].includes(pinned)) throw new SavedViewCatalogRequestError();
  return Object.freeze({ query: query.trim(), page: Number(page), pinnedOnly: pinned === "1" });
}

export function captureSavedViewCatalogRequest(request: SavedViewCatalogRequest): SavedViewCatalogRequest {
  if (!request || !exact(request, ["query", "page", "pinnedOnly"]) || typeof request.query !== "string" || invalidText.test(request.query) || typeof request.page !== "number" || typeof request.pinnedOnly !== "boolean") throw new SavedViewCatalogRequestError();
  return parseSavedViewCatalogRequest(new URLSearchParams({ q: request.query, page: String(request.page), pinned: request.pinnedOnly ? "1" : "0" }));
}

export function savedViewCatalogParams(request: SavedViewCatalogRequest): URLSearchParams {
  const checked = captureSavedViewCatalogRequest(request);
  const params = new URLSearchParams();
  if (checked.query) params.set("q", checked.query);
  if (checked.page !== 1) params.set("page", String(checked.page));
  if (checked.pinnedOnly) params.set("pinned", "1");
  return params;
}

export function validateSavedViewCatalogPage(body: unknown, request: SavedViewCatalogRequest): SavedViewCatalogPage {
  const expected = captureSavedViewCatalogRequest(request), fail = (): never => { throw new Error("The saved-view catalog response is invalid."); };
  if (!body || typeof body !== "object" || Array.isArray(body) || !exact(body, ["contract", "query", "pinnedOnly", "page", "pageSize", "totalCount", "totalPages", "views"])) return fail();
  const page = body as Record<string, unknown>;
  if (page.contract !== "saved-view-catalog.v1" || page.query !== expected.query || page.pinnedOnly !== expected.pinnedOnly || page.pageSize !== 20
    || !Number.isSafeInteger(page.totalCount) || Number(page.totalCount) < 0 || page.totalPages !== Math.max(1, Math.ceil(Number(page.totalCount) / 20))
    || page.page !== Math.min(expected.page, Number(page.totalPages)) || !Array.isArray(page.views)
    || page.views.length !== Math.min(20, Number(page.totalCount) - (Number(page.page) - 1) * 20)) return fail();
  const seen = new Set<string>();
  const views = page.views.map((value: unknown): SavedViewSummary => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !exact(value, ["id", "name", "description", "iconKey", "pinned", "pinOrder"])) return fail();
    const view = value as Record<string, unknown>;
    if (typeof view.id !== "string" || !view.id || view.id.length > 200 || invalidText.test(view.id) || seen.has(view.id)
      || typeof view.name !== "string" || view.name.length > 80 || (view.description !== null && (typeof view.description !== "string" || view.description.length > 300))
      || typeof view.iconKey !== "string" || !/^[a-z][a-z0-9_.-]{0,99}$/.test(view.iconKey) || typeof view.pinned !== "boolean"
      || expected.pinnedOnly && !view.pinned || view.pinOrder !== null && (!Number.isSafeInteger(view.pinOrder) || Number(view.pinOrder) < 0)) return fail();
    seen.add(view.id);
    return Object.freeze({ id: view.id, name: view.name, description: view.description as string | null, iconKey: view.iconKey, pinned: view.pinned, pinOrder: view.pinOrder as number | null });
  });
  return Object.freeze({ contract: "saved-view-catalog.v1", query: expected.query, pinnedOnly: expected.pinnedOnly, page: Number(page.page), pageSize: 20, totalCount: Number(page.totalCount), totalPages: Number(page.totalPages), views: Object.freeze(views) });
}
