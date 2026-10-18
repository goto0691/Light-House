import { parseLocalBrowserPostUrl, parseLocalBrowserResult, saveLocalBrowserCapture } from "@/lib/v2/collect/local-browser-capture";
import { callLocalBrowserRunner, requireLocalBrowserRunner } from "@/lib/v2/collect/local-browser-runner-client";
import { requireV2RequestContext, v2ErrorResponse, V2HttpError } from "@/lib/v2/http/request-context";
import { readJsonObject, requireV2Route } from "@/lib/v2/http/route-helpers";
import { getV2ArchiveAssetsBucket, getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";

const STATUS_ERRORS = {
  login_required: [409, "local_browser_login_required", "Log in to the site yourself in the helper's Chrome window, then try again."],
  blocked: [409, "local_browser_blocked", "The site showed a security check. It was not answered; try again later in your own browser."],
  unavailable: [404, "local_browser_post_unavailable", "The post could not be shown (deleted, private or not found)."],
} as const;

/** The owner asks this PC to open one Threads/Instagram post they chose and keep it as a new record. */
export async function POST(request: Request) {
  try {
    requireV2Route({ write: true });
    requireLocalBrowserRunner();
    const context = await requireV2RequestContext(request, { mutation: true });
    const body = await readJsonObject(request, { maxBytes: 2048 });
    const post = parseLocalBrowserPostUrl(body.url);
    if (!post) throw new V2HttpError(400, "local_browser_url_unsupported", "Only a single Threads or Instagram post address can be opened.");
    const result = parseLocalBrowserResult(await callLocalBrowserRunner("/capture", { url: post.url }));
    if (!result) throw new V2HttpError(502, "local_browser_failed", "The local browser helper returned an unexpected result.");
    if (result.status !== "captured") {
      const [status, code, message] = STATUS_ERRORS[result.status];
      throw new V2HttpError(status, code, message);
    }
    const saved = await saveLocalBrowserCapture(getV2CloudflareBindings().db, getV2ArchiveAssetsBucket(), context.userId,
      { url: post.url, title: result.title, screenshots: result.screenshots, now: new Date() });
    return Response.json({ ...saved, site: post.site }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return v2ErrorResponse(error);
  }
}
