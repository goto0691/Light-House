import { afterEach, describe, expect, test, vi } from "vitest";

import { assertV2MutationRequest } from "@/lib/v2/http/request-policy";

function request(headers: Record<string, string> = {}) {
  return new Request("https://lighthouse.test/api/v2/captures/commit", { method: "POST", headers });
}

describe("V2 mutation request policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("accepts same-origin JSON and multipart requests from the configured app", () => {
    expect(() =>
      assertV2MutationRequest(
        request({ origin: "https://lighthouse.test", "content-type": "application/json; charset=utf-8" }),
        { allowedOrigin: "https://lighthouse.test" },
      ),
    ).not.toThrow();
    expect(() =>
      assertV2MutationRequest(
        request({ origin: "https://lighthouse.test", "content-type": "multipart/form-data; boundary=abc" }),
        { allowedOrigin: "https://lighthouse.test", contentTypes: ["multipart/form-data"] },
      ),
    ).not.toThrow();
  });

  test("rejects missing and cross-site Origin before authentication or repository work", () => {
    expect(() => assertV2MutationRequest(request({ "content-type": "application/json" }))).toThrowError(
      expect.objectContaining({ code: "origin_rejected", status: 403 }),
    );
    expect(() =>
      assertV2MutationRequest(request({ origin: "https://evil.test", "content-type": "application/json" })),
    ).toThrowError(expect.objectContaining({ code: "origin_rejected", status: 403 }));
  });

  test("does not trust a build-time development app URL as an extra production origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(() =>
      assertV2MutationRequest(request({ origin: "http://localhost:3000", "content-type": "application/json" })),
    ).toThrowError(expect.objectContaining({ code: "origin_rejected", status: 403 }));
  });

  test("rejects form-urlencoded and missing content types", () => {
    expect(() =>
      assertV2MutationRequest(
        request({ origin: "https://lighthouse.test", "content-type": "application/x-www-form-urlencoded" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "content_type_rejected", status: 415 }));
  });
});
