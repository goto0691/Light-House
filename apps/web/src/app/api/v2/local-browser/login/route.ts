import { callLocalBrowserRunner, requireLocalBrowserRunner } from "@/lib/v2/collect/local-browser-runner-client";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";

/** Opens the site's own login page in the helper's Chrome window; the owner signs in there themselves. */
export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    requireLocalBrowserRunner();
    await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request, { maxBytes: 512 });
    if (body.site !== "threads" && body.site !== "instagram") throw new V2HttpError(400, "invalid_field", "site must be threads or instagram.");
    await callLocalBrowserRunner("/login-window", { site: body.site });
    return Response.json({ opened: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
