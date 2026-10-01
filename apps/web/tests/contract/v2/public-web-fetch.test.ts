import { describe, expect, test, vi } from "vitest";

import {
  collectPublicWeb, extractPublicHtmlText, isPublicWebAddress, PUBLIC_WEB_MAX_BYTES,
  type PublicWebDependencies, type PublicWebTransportRequest,
} from "@/lib/v2/collect/public-web-fetch";

const URL = "https://public.example.com/article?edition=2";
const ALLOWED = ["public.example.com", "archive.example.com"];

function dependencies(responses: Response | readonly Response[], addresses: readonly string[] = ["8.8.8.8", "2606:4700:4700::1111"]) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const resolve = vi.fn(async (_hostname: string, _signal: AbortSignal) => addresses);
  const transport = vi.fn(async (_request: PublicWebTransportRequest) => {
    const response = queue.shift();
    if (!response) throw new Error("Unexpected transport request");
    return response;
  });
  return { resolve, transport } satisfies PublicWebDependencies;
}

describe("bounded public web fetch", () => {
  test("preserves a plain text response exactly and supplies no cookie or authorization headers", async () => {
    const original = "First line\n  second line & symbols < >\n";
    const deps = dependencies(new Response(original, { headers: { "content-type": "text/plain; charset=utf-8" } }));
    const result = await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps);
    expect(result).toMatchObject({ state: "captured", reason: null, sourceUrl: URL, finalUrl: URL,
      statusCode: 200, mimeType: "text/plain", extraction: "plain_text", externalScope: "unverified", rawText: original });
    expect(deps.transport).toHaveBeenCalledOnce();
    expect(deps.transport.mock.calls[0][0]).toMatchObject({ url: URL, hostname: "public.example.com",
      approvedAddresses: ["8.8.8.8", "2606:4700:4700::1111"], method: "GET", redirect: "manual", credentials: "omit" });
    expect(Object.keys(deps.transport.mock.calls[0][0])).not.toContain("headers");
  });

  test("extracts only visible HTML text and explicitly marks the extraction partial", async () => {
    const html = `<!doctype html><html><head><title>Hidden title</title><style>.secret{}</style></head>
      <body><header>Site header</header><nav>Menu</nav><main><article><h1>Garden &amp; light</h1>
      <p>A real paragraph.</p><script>ignore('secret')</script><aside>related links</aside>
      <div hidden>hidden attribute</div><div aria-hidden="true">hidden aria</div><div style="display:none">hidden style</div>
      <pre>line 1\n  line 2</pre></article></main><footer>footer</footer></body></html>`;
    const deps = dependencies(new Response(html, { headers: { "content-type": "text/html" } }));
    const result = await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps);
    expect(result).toMatchObject({ state: "partial", reason: "html_visible_text_only", extraction: "html_visible_text_v1",
      mimeType: "text/html", externalScope: "unverified" });
    expect(result.rawText).toContain("Garden & light");
    expect(result.rawText).toContain("A real paragraph.");
    expect(result.rawText).toContain("line 1\n  line 2");
    for (const omitted of ["Hidden title", "secret", "Site header", "Menu", "related links", "hidden attribute", "hidden aria", "hidden style", "footer"]) {
      expect(result.rawText).not.toContain(omitted);
    }
    expect(extractPublicHtmlText("<p>One &#38; two</p><p>Three &unknown;</p>")).toBe("One & two\nThree &unknown;");
  });

  test.each([
    ["http://public.example.com/a", "invalid_url"],
    ["https://user:pass@public.example.com/a", "invalid_url"],
    ["https://public.example.com:443/a", "invalid_url"],
    ["https://127.1/a", "unsafe_host"],
    ["https://[::1]/a", "unsafe_host"],
    ["https://metadata.google.internal/a", "unsafe_host"],
    ["https://public.example.com.evil.invalid/a", "unsafe_host"],
    ["https://other.example.com/a", "host_not_allowed"],
    ["https://www.threads.com/@someone/post/1", "unsupported_provider"],
    ["https://www.instagram.com/p/1", "unsupported_provider"],
    ["https://youtu.be/abc", "unsupported_provider"],
    ["https://instagr.am/p/1", "unsupported_provider"],
    ["https://scontent.cdninstagram.com/v/t51/1.jpg", "unsupported_provider"],
    ["https://scontent-icn2-1.xx.fbcdn.net/v/1.jpg", "unsupported_provider"],
  ])("rejects unsafe or unapproved URL %s before DNS/transport", async (url, reason) => {
    const deps = dependencies(new Response("unused"));
    expect(await collectPublicWeb({ url, allowedHosts: ALLOWED }, deps)).toMatchObject({ state: "unavailable", reason, rawText: null });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.transport).not.toHaveBeenCalled();
  });

  test.each(["www.threads.com", "threads.net", "www.instagram.com", "instagr.am"])("never fetches SNS host %s even when an operator allowlists it", async (host) => {
    const deps = dependencies(new Response("unused"));
    expect(await collectPublicWeb({ url: `https://${host}/p/1`, allowedHosts: [host] }, deps)).toMatchObject({ state: "unavailable", reason: "unsupported_provider", rawText: null });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.transport).not.toHaveBeenCalled();
  });

  test("fails closed with an empty allowed host set or missing network dependencies", async () => {
    const deps = dependencies(new Response("unused"));
    expect(await collectPublicWeb({ url: URL, allowedHosts: [] }, deps)).toMatchObject({ reason: "host_not_allowed" });
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, undefined as unknown as PublicWebDependencies))
      .toMatchObject({ reason: "transport_unavailable" });
    expect(deps.transport).not.toHaveBeenCalled();
  });

  test("rejects every non-public A or AAAA response even when another address is public", async () => {
    for (const addresses of [["8.8.8.8", "127.0.0.1"], ["8.8.8.8", "fc00::1"], ["2001:db8::1"], []]) {
      const deps = dependencies(new Response("unused"), addresses);
      const result = await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps);
      expect(result.reason).toBe(addresses.length ? "dns_not_public" : "dns_unverified");
      expect(deps.transport).not.toHaveBeenCalled();
    }
    expect(isPublicWebAddress("8.8.8.8")).toBe(true);
    expect(isPublicWebAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of ["10.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "198.18.0.1", "::1", "fe80::1", "2001:db8::1", "::ffff:8.8.8.8"]) {
      expect(isPublicWebAddress(address)).toBe(false);
    }
  });

  test("rechecks each redirect host and its public DNS before fetching it", async () => {
    const deps = dependencies([
      new Response(null, { status: 302, headers: { location: "https://archive.example.com/story" } }),
      new Response("Archived source", { headers: { "content-type": "text/plain" } }),
    ]);
    const result = await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps);
    expect(result).toMatchObject({ state: "captured", finalUrl: "https://archive.example.com/story", rawText: "Archived source" });
    expect(deps.resolve.mock.calls.map(([host]) => host)).toEqual(["public.example.com", "archive.example.com"]);
    expect(deps.transport.mock.calls.map(([request]) => request.hostname)).toEqual(["public.example.com", "archive.example.com"]);
  });

  test.each([
    [new Response(null, { status: 302, headers: { location: "http://public.example.com/insecure" } }), "redirect_blocked"],
    [new Response(null, { status: 302, headers: { location: "https://other.example.com/foreign" } }), "redirect_blocked"],
    [new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }), "redirect_blocked"],
    [new Response(null, { status: 302, headers: { location: "https://www.instagram.com/p/1" } }), "redirect_blocked"],
    [new Response(null, { status: 302, headers: { location: "https://www.threads.net/@someone/post/1" } }), "redirect_blocked"],
    [new Response(null, { status: 302 }), "redirect_missing"],
  ])("does not follow an unsafe or broken redirect (%s)", async (response, reason) => {
    const deps = dependencies(response);
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps)).toMatchObject({ state: "unavailable", reason, rawText: null });
    expect(deps.transport).toHaveBeenCalledOnce();
  });

  test("stops a redirect loop at the fixed hop limit", async () => {
    const deps = dependencies(Array.from({ length: 4 }, () => new Response(null, { status: 302, headers: { location: URL } })));
    const result = await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps);
    expect(result).toMatchObject({ state: "unavailable", reason: "redirect_limit" });
    expect(deps.transport).toHaveBeenCalledTimes(4);
  });

  test.each([
    [401, "unauthorized", "needs_input"], [403, "forbidden", "needs_input"],
    [429, "rate_limited", "unavailable"], [500, "http_error", "unavailable"],
  ] as const)("classifies HTTP %i without claiming content capture", async (status, reason, state) => {
    const deps = dependencies(new Response("Denied", { status }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps)).toMatchObject({ state, reason, statusCode: status, rawText: null });
  });

  test("recognizes a login path or a small password gate without preserving it as article text", async () => {
    const redirected = dependencies(new Response(null, { status: 302, headers: { location: "/login" } }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, redirected)).toMatchObject({ state: "needs_input", reason: "login_required" });
    expect(redirected.transport).toHaveBeenCalledOnce();
    const wall = `<html><body><form action="/signin"><p>Log in to continue</p><input type="password"></form></body></html>`;
    const deps = dependencies(new Response(wall, { headers: { "content-type": "text/html" } }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps)).toMatchObject({ state: "needs_input", reason: "login_required", rawText: null });
  });

  test("keeps MIME, charset, empty and invalid UTF-8 failures separate", async () => {
    for (const [response, reason] of [
      [new Response("binary", { headers: { "content-type": "application/pdf" } }), "unsupported_mime"],
      [new Response("latin text", { headers: { "content-type": "text/plain; charset=iso-8859-1" } }), "unsupported_charset"],
      [new Response(" \n ", { headers: { "content-type": "text/plain" } }), "empty_content"],
      [new Response(new Uint8Array([0xff]), { headers: { "content-type": "text/plain" } }), "invalid_text"],
    ] as const) {
      const deps = dependencies(response);
      expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps)).toMatchObject({ state: "needs_input", reason, rawText: null });
    }
  });

  test("does not claim complete capture for an HTTP 206 range response", async () => {
    const deps = dependencies(new Response("range only", { status: 206, headers: { "content-type": "text/plain", "content-range": "bytes 0-9/100" } }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, deps)).toMatchObject({
      state: "partial", reason: "http_partial_content", rawText: "range only", extraction: "plain_text",
    });
  });

  test("rejects oversized content-length and streaming bodies without returning truncated text", async () => {
    const announced = dependencies(new Response("short", { headers: { "content-type": "text/plain", "content-length": String(PUBLIC_WEB_MAX_BYTES + 1) } }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, announced)).toMatchObject({ state: "needs_input", reason: "response_too_large", rawText: null });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(PUBLIC_WEB_MAX_BYTES)); controller.enqueue(new Uint8Array([1])); controller.close(); } });
    const streaming = dependencies(new Response(body, { headers: { "content-type": "text/plain" } }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED }, streaming)).toMatchObject({ state: "needs_input", reason: "response_too_large", rawText: null });
  });

  test("bounds a resolver that never answers and never starts the transport", async () => {
    const transport = vi.fn(async () => new Response("not fetched"));
    const deps: PublicWebDependencies = { resolve: () => new Promise(() => undefined), transport };
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED, timeoutMs: 5 }, deps)).toMatchObject({ state: "unavailable", reason: "timeout", rawText: null });
    expect(transport).not.toHaveBeenCalled();
  });

  test("bounds a stalled response stream even when stream cancellation does not settle", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("first chunk")); },
      cancel: () => new Promise(() => undefined),
    });
    const deps = dependencies(new Response(stream, { headers: { "content-type": "text/plain" } }));
    expect(await collectPublicWeb({ url: URL, allowedHosts: ALLOWED, timeoutMs: 5 }, deps))
      .toMatchObject({ state: "unavailable", reason: "timeout", rawText: null });
  });
});
