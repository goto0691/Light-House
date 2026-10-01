import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { savedViewFieldCatalog, savedViewSelectedFieldLabels } from "@/lib/v2/infrastructure/d1/saved-view-field-catalog";
import { validateSavedViewFieldLookupKeys } from "@/lib/v2/retrieval/saved-view-field-lookup";

export async function GET(request: Request) {
  try {
    requireV2Route();
    const context = await requireV2RequestContext(request);
    const params = new URL(request.url).searchParams;
    if (params.has("key")) {
      let keys: readonly string[];
      try {
        if ([...params.keys()].some((key) => key !== "key")) throw new Error("Mixed lookup modes.");
        keys = validateSavedViewFieldLookupKeys(params.getAll("key"));
      } catch {
        throw new V2HttpError(400, "saved_view_fields_invalid", "The selected field lookup is invalid.");
      }
      const labels = await savedViewSelectedFieldLabels(getV2CloudflareBindings().db, context.userId, keys);
      return Response.json(labels, { headers: { "Cache-Control": "private, no-store" } });
    }
    const query = params.get("q") ?? "", rawPage = params.get("page") ?? "1";
    if ([...params.keys()].some((key) => !["q", "page"].includes(key) || params.getAll(key).length !== 1)
      || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)
      || !/^[1-9][0-9]*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage))) {
      throw new V2HttpError(400, "saved_view_fields_invalid", "The field catalog query is invalid.");
    }
    const catalog = await savedViewFieldCatalog(getV2CloudflareBindings().db, context.userId, query.trim(), Number(rawPage));
    return Response.json(catalog, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = v2ErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
