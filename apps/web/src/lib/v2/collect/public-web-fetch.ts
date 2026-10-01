/** A bounded public-web text fetch. Host policy, DNS preflight and transport are supplied by the caller. */
export const PUBLIC_WEB_MAX_BYTES = 100 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8_000;

export type PublicWebFailureReason =
  | "invalid_url" | "unsafe_host" | "host_not_allowed" | "unsupported_provider"
  | "dns_unverified" | "dns_not_public" | "transport_unavailable" | "transport_failed"
  | "timeout" | "redirect_missing" | "redirect_blocked" | "redirect_limit"
  | "login_required" | "unauthorized" | "forbidden" | "rate_limited" | "http_error"
  | "response_too_large" | "unsupported_mime" | "unsupported_charset" | "invalid_text" | "empty_content";

export type PublicWebResult = Readonly<{
  state: "captured" | "partial" | "needs_input" | "unavailable";
  reason: PublicWebFailureReason | "html_visible_text_only" | "http_partial_content" | null;
  sourceUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  mimeType: "text/plain" | "text/html" | null;
  rawText: string | null;
  /** A text/plain response is exact decoded text. HTML is a lossy visible-text extraction. */
  extraction: "plain_text" | "html_visible_text_v1" | null;
  /** Neither an HTML extraction nor a plain-text response proves coverage of linked pages or media. */
  externalScope: "unverified";
}>;

export type PublicWebTransportRequest = Readonly<{
  url: string;
  hostname: string;
  /** Public A/AAAA preflight result. It does not prove which IP the transport ultimately used. */
  approvedAddresses: readonly string[];
  method: "GET";
  redirect: "manual";
  credentials: "omit";
  signal: AbortSignal;
}>;

export type PublicWebDependencies = Readonly<{
  resolve: (hostname: string, signal: AbortSignal) => Promise<readonly string[]>;
  /** A plain fetch(url) may resolve DNS again after preflight; callers must not claim IP pinning. */
  transport: (request: PublicWebTransportRequest) => Promise<Response>;
}>;

export type PublicWebRequest = Readonly<{
  url: string;
  /** Exact DNS names, never suffixes or wildcards. The caller owns this policy. */
  allowedHosts: readonly string[];
  timeoutMs?: number;
}>;

class DeadlineError extends Error {}

function failure(sourceUrl: string, reason: PublicWebFailureReason, state: "needs_input" | "unavailable", finalUrl: string | null = null,
  statusCode: number | null = null, mimeType: PublicWebResult["mimeType"] = null): PublicWebResult {
  return { state, reason, sourceUrl, finalUrl, statusCode, mimeType, rawText: null, extraction: null, externalScope: "unverified" };
}

/** Never fetched by the server, even when an operator allowlists them or a redirect leads there.
 * Threads/Instagram content is kept as the saved URL plus what the user pastes or attaches
 * (user decision 2026-09-29); YouTube has its own explicit video adapter. */
const PROVIDER_DOMAINS = ["threads.com", "threads.net", "instagram.com", "instagr.am", "cdninstagram.com", "fbcdn.net", "youtube.com", "youtu.be"] as const;
function isProviderHost(host: string) {
  return PROVIDER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isValidDnsHost(host: string) {
  return host.length <= 253 && host.includes(".") && !host.endsWith(".")
    && host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
}

function isUnsafeHost(host: string) {
  return !isValidDnsHost(host) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
    || ["localhost", "local", "internal", "lan", "home", "corp", "test", "invalid", "onion", "arpa"]
      .some((part) => host === part || host.endsWith(`.${part}`)) || host.includes(":");
}

function validatedUrl(value: string, allowedHosts: ReadonlySet<string>): { url: URL; reason: PublicWebFailureReason | null } {
  if (typeof value !== "string" || !value || value.length > 2048 || !/^https:\/\//i.test(value)
    || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return { url: new URL("https://invalid.invalid"), reason: "invalid_url" };
  }
  let url: URL;
  try { url = new URL(value); } catch { return { url: new URL("https://invalid.invalid"), reason: "invalid_url" }; }
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1] ?? "";
  if (url.protocol !== "https:" || url.username || url.password || /:\d+$/.test(authority) || url.port || url.hostname.includes("%")) {
    return { url, reason: "invalid_url" };
  }
  const host = url.hostname.toLowerCase();
  if (isUnsafeHost(host)) return { url, reason: "unsafe_host" };
  if (isProviderHost(host)) return { url, reason: "unsupported_provider" };
  if (!allowedHosts.has(host)) return { url, reason: "host_not_allowed" };
  url.hash = "";
  return { url, reason: null };
}

function publicIpv4(ip: string) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  const rawOctets = ip.split(".");
  if (rawOctets.some((item) => item.length > 1 && item.startsWith("0"))) return false;
  const octets = rawOctets.map(Number);
  if (octets.some((item) => item > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 && (c === 0 || c === 2 || c === 99) || b === 88 && c === 99 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Groups(ip: string): number[] | null {
  if (!ip.includes(":") || ip.includes("%") || ip.includes(".")) return null;
  const pieces = ip.toLowerCase().split("::");
  if (pieces.length > 2) return null;
  const parse = (part: string) => part ? part.split(":").map((group) => /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : -1) : [];
  const left = parse(pieces[0]);
  const right = parse(pieces[1] ?? "");
  if ([...left, ...right].some((group) => group < 0)) return null;
  if (pieces.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function publicIpv6(ip: string) {
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  // Only global unicast. Reject transition, documentation and special-purpose ranges conservatively.
  const [first, second] = groups;
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2002 || first === 0x3fff) return false;
  if (first === 0x2001 && [0, 2, 3, 0x10, 0x20, 0x0db8].includes(second)) return false;
  return true;
}

export function isPublicWebAddress(ip: string) {
  return publicIpv4(ip) || publicIpv6(ip);
}

async function beforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DeadlineError();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new DeadlineError()); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

async function readBounded(response: Response, signal: AbortSignal): Promise<Uint8Array | "too_large"> {
  const size = response.headers.get("content-length");
  if (size !== null && /^\d+$/.test(size) && Number(size) > PUBLIC_WEB_MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    return "too_large";
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await beforeDeadline(reader.read(), signal);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > PUBLIC_WEB_MAX_BYTES) return "too_large";
      chunks.push(next.value);
    }
  } finally {
    if (length > PUBLIC_WEB_MAX_BYTES || signal.aborted) void reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* A timed-out read may still be pending in the injected transport. */ }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const point = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
  });
}

const OMIT = new Set(["head", "script", "style", "nav", "aside", "footer", "header", "form", "template", "svg", "iframe", "noscript", "button"]);
const BLOCK = new Set(["article", "main", "section", "div", "p", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "tr"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function hiddenAttributes(tag: string) {
  return /\shidden(?=\s|=|\/|$)/i.test(tag)
    || /\saria-hidden\s*=\s*(?:["']true["']|true)(?=\s|\/|$)/i.test(tag)
    || /\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(tag);
}

/** Returns extracted visible text, never a claim that the entire web page or linked media was preserved. */
export function extractPublicHtmlText(html: string) {
  const parts: string[] = [];
  const omitted: string[] = [];
  const breakLine = () => { if (parts.length && !/\n\s*$/.test(parts.at(-1) ?? "")) parts.push("\n"); };
  let preDepth = 0;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) { const end = html.indexOf("-->", i + 4); i = end < 0 ? html.length : end + 3; continue; }
    if (html[i] !== "<") {
      const end = html.indexOf("<", i);
      const text = html.slice(i, end < 0 ? html.length : end);
      if (!omitted.length) parts.push(preDepth ? decodeEntities(text) : decodeEntities(text).replace(/\s+/g, " "));
      i = end < 0 ? html.length : end;
      continue;
    }
    let end = i + 1;
    let quote: string | null = null;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end >= html.length) break;
    const tag = html.slice(i + 1, end);
    const match = /^\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(tag);
    if (match) {
      const closing = Boolean(match[1]);
      const name = match[2].toLowerCase();
      const selfClosing = /\/\s*$/.test(tag) || VOID.has(name);
      if (closing) {
        if (omitted.at(-1) === name) omitted.pop();
        if (!omitted.length && name === "pre") preDepth = Math.max(0, preDepth - 1);
        if (!omitted.length && BLOCK.has(name)) breakLine();
      } else if ((OMIT.has(name) || hiddenAttributes(tag)) && !selfClosing) {
        omitted.push(name);
      } else if (!omitted.length) {
        if (BLOCK.has(name)) breakLine();
        if (name === "pre" && !selfClosing) preDepth++;
      }
    }
    i = end + 1;
  }
  return parts.join("").replace(/[ \t]+\n/g, "\n").trim();
}

function loginPath(url: URL) {
  return /\/(?:login|log-in|signin|sign-in|accounts\/login)(?:\/|$)/i.test(url.pathname);
}

function loginWall(html: string, text: string) {
  return text.length < 80 && /<form\b[\s\S]*?<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html)
    && /\b(?:log\s*in|sign\s*in)\b|로그인/i.test(html);
}

export async function collectPublicWeb(input: PublicWebRequest, dependencies: PublicWebDependencies): Promise<PublicWebResult> {
  const sourceUrl = input.url;
  if (!dependencies || typeof dependencies.resolve !== "function" || typeof dependencies.transport !== "function") {
    return failure(sourceUrl, "transport_unavailable", "unavailable");
  }
  const allowed = new Set(input.allowedHosts?.map((host) => host.toLowerCase()) ?? []);
  const first = validatedUrl(sourceUrl, allowed);
  if (first.reason) return failure(sourceUrl, first.reason, "unavailable");
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), 10_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let current = first.url;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (loginPath(current)) return failure(sourceUrl, "login_required", "needs_input", current.href);
      let addresses: readonly string[];
      try { addresses = await beforeDeadline(dependencies.resolve(current.hostname, controller.signal), controller.signal); }
      catch (error) { return failure(sourceUrl, error instanceof DeadlineError ? "timeout" : "dns_unverified", "unavailable", current.href); }
      if (!Array.isArray(addresses) || !addresses.length || addresses.some((address) => typeof address !== "string")) {
        return failure(sourceUrl, "dns_unverified", "unavailable", current.href);
      }
      if (addresses.some((address) => !isPublicWebAddress(address))) return failure(sourceUrl, "dns_not_public", "unavailable", current.href);
      let response: Response;
      try {
        response = await beforeDeadline(dependencies.transport({ url: current.href, hostname: current.hostname, approvedAddresses: addresses,
          method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal }), controller.signal);
      } catch (error) { return failure(sourceUrl, error instanceof DeadlineError ? "timeout" : "transport_failed", "unavailable", current.href); }
      if (response.redirected || response.url && response.url !== current.href) {
        return failure(sourceUrl, "redirect_blocked", "unavailable", current.href, response.status);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return failure(sourceUrl, "redirect_missing", "unavailable", current.href, response.status);
        if (redirects === MAX_REDIRECTS) return failure(sourceUrl, "redirect_limit", "unavailable", current.href, response.status);
        let next: URL;
        try { next = new URL(location, current); } catch { return failure(sourceUrl, "redirect_blocked", "unavailable", current.href, response.status); }
        const checked = validatedUrl(next.href, allowed);
        if (checked.reason) return failure(sourceUrl, "redirect_blocked", "unavailable", current.href, response.status);
        void response.body?.cancel().catch(() => undefined);
        current = checked.url;
        continue;
      }
      if (response.status === 401) return failure(sourceUrl, "unauthorized", "needs_input", current.href, 401);
      if (response.status === 403) return failure(sourceUrl, "forbidden", "needs_input", current.href, 403);
      if (response.status === 429) return failure(sourceUrl, "rate_limited", "unavailable", current.href, 429);
      if (!response.ok) return failure(sourceUrl, "http_error", "unavailable", current.href, response.status);
      if (response.status !== 200 && response.status !== 206) return failure(sourceUrl, "http_error", "unavailable", current.href, response.status);
      const type = response.headers.get("content-type") ?? "";
      const mime = type.split(";", 1)[0].trim().toLowerCase();
      if (mime !== "text/html" && mime !== "text/plain") return failure(sourceUrl, "unsupported_mime", "needs_input", current.href, response.status);
      const charset = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1]?.toLowerCase();
      if (charset && charset !== "utf-8" && charset !== "utf8") return failure(sourceUrl, "unsupported_charset", "needs_input", current.href, response.status, mime);
      let bytes: Uint8Array | "too_large";
      try { bytes = await readBounded(response, controller.signal); }
      catch (error) { return failure(sourceUrl, error instanceof DeadlineError ? "timeout" : "transport_failed", "unavailable", current.href, response.status, mime); }
      if (bytes === "too_large") return failure(sourceUrl, "response_too_large", "needs_input", current.href, response.status, mime);
      let decoded: string;
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { return failure(sourceUrl, "invalid_text", "needs_input", current.href, response.status, mime); }
      const rawText = mime === "text/html" ? extractPublicHtmlText(decoded) : decoded;
      if (mime === "text/html" && loginWall(decoded, rawText)) return failure(sourceUrl, "login_required", "needs_input", current.href, response.status, mime);
      if (!rawText.trim()) return failure(sourceUrl, "empty_content", "needs_input", current.href, response.status, mime);
      return { state: mime === "text/html" || response.status === 206 ? "partial" : "captured",
        reason: response.status === 206 ? "http_partial_content" : mime === "text/html" ? "html_visible_text_only" : null,
        sourceUrl, finalUrl: current.href, statusCode: response.status, mimeType: mime, rawText,
        extraction: mime === "text/html" ? "html_visible_text_v1" : "plain_text", externalScope: "unverified" };
    }
    return failure(sourceUrl, "redirect_limit", "unavailable", current.href);
  } finally { clearTimeout(timer); controller.abort(); }
}
