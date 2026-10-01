import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const fetch = vi.fn(async () => new Response("online"));
  const caches = { match: vi.fn(async () => new Response("offline capture")), open: vi.fn(), keys: vi.fn(), delete: vi.fn() };
  vm.runInNewContext(source, {
    self: { location: { origin: "https://lighthouse.local" }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) },
    fetch, caches, URL, Response,
  });
  function request(path: string, mode = "navigate", method = "GET") {
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { url: new URL(path, "https://lighthouse.local").href, mode, method }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  }
  return { request, fetch, caches };
}

describe("shared legacy and V2 service worker", () => {
  it("preserves network-first legacy navigation", async () => {
    const w = worker();
    expect(await (await w.request("/vault/zettels"))!.text()).toBe("online");
    expect(w.caches.open).not.toHaveBeenCalled();
  });

  it("keeps the V2 offline capture shell", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error("offline"));
    expect(await (await w.request("/v2/capture"))!.text()).toBe("offline capture");
    expect(w.caches.match).toHaveBeenCalledWith("/offline-capture.html");
  });

  it("gives legacy navigation a no-store offline fallback", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error("offline"));
    const response = await w.request("/dashboard");
    expect(response!.status).toBe(503);
    expect(response!.headers.get("cache-control")).toBe("no-store");
    expect(await response!.text()).toContain("오프라인");
    expect(w.caches.match).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/upload/files/private/original", "no-cors", "GET"],
    ["/api/v2/captures/commit", "cors", "POST"],
    ["https://other.invalid/", "navigate", "GET"],
  ])("does not intercept or cache %s", (path, mode, method) => {
    const w = worker();
    expect(w.request(path, mode, method)).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.caches.open).not.toHaveBeenCalled();
  });

  it("does not erase V2 registrations or local caches when opening a legacy page", () => {
    const provider = readFileSync(new URL("../../../src/components/providers/pwa-provider.tsx", import.meta.url), "utf8");
    expect(provider).not.toContain("unregister(");
    expect(provider).not.toContain("caches.delete(");
    expect(provider).toContain('register("/sw.js")');
  });
});
