import { V2HttpError } from "@/lib/v2/http/request-context";
import { LOCAL_BROWSER_LIMITS } from "@/lib/v2/collect/local-browser-capture";

/**
 * The address of the local browser helper, only when `npm run dev:local` started it on this PC.
 * A helper anywhere but this machine's loopback address is never called.
 */
export function localBrowserRunner(env: Readonly<Record<string, string | undefined>> = process.env) {
  const base = env.LIGHT_HOUSE_LOCAL_BROWSER_URL?.trim(), secret = env.LIGHT_HOUSE_LOCAL_BROWSER_SECRET?.trim();
  if (!base || !secret || secret.length < 32) return null;
  let url: URL;
  try { url = new URL(base); } catch { return null; }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) return null;
  return { base: url.origin, secret };
}

export function requireLocalBrowserRunner() {
  const runner = localBrowserRunner();
  if (!runner) throw new V2HttpError(404, "local_browser_unavailable", "The local browser helper runs only with npm run dev:local on this PC.");
  return runner;
}

export async function callLocalBrowserRunner(path: "/capture" | "/login-window", body: Record<string, unknown>) {
  const runner = requireLocalBrowserRunner();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), LOCAL_BROWSER_LIMITS.timeoutMs);
  try {
    const response = await fetch(`${runner.base}${path}`, {
      method: "POST", signal: abort.signal,
      headers: { Authorization: `Bearer ${runner.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => { throw new V2HttpError(503, "local_browser_unreachable", "The local browser helper is not running."); });
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new V2HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? "local_browser_busy" : "local_browser_failed", "The local browser helper could not open the post.");
    return result;
  } finally {
    clearTimeout(timer);
  }
}
