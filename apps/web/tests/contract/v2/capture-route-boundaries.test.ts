import { afterEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  getActiveRestrictedGrant: vi.fn(),
  getSession: vi.fn(),
  getV2CloudflareBindings: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: harness.getSession,
}));

vi.mock("@/lib/v2/auth/restricted-grant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v2/auth/restricted-grant")>()),
  getActiveRestrictedGrant: harness.getActiveRestrictedGrant,
}));

vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v2/infrastructure/cloudflare/runtime-bindings")>()),
  getV2CloudflareBindings: harness.getV2CloudflareBindings,
}));

import { POST as commitCapture } from "@/app/api/v2/captures/commit/route";
import { readJsonObject } from "@/lib/v2/http/route-helpers";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("V2 capture route boundaries", () => {
  test.each([null, [], "not-an-object", { kind: "url", rawText: 42 }, { kind: "url", metadata: [] }])("rejects malformed source item without a server error: %j", async (source) => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "1");
    harness.getV2CloudflareBindings.mockReturnValue({ db: {} });
    harness.getSession.mockResolvedValue({ sessionId: "session-current", userId: "user-a", email: "owner@example.test", expiresAt: Date.now() + 100000 });
    harness.getActiveRestrictedGrant.mockResolvedValue(null);
    const response = await commitCapture(new Request("https://lighthouse.test/api/v2/captures/commit", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "malformed", Origin: "https://lighthouse.test" },
      body: JSON.stringify({ draftId: "manual", channel: "web", bodyMarkdown: "memo", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-09-08T00:00:00Z", sources: [source] }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_field" } });
  });
  test("bounded capture reader counts actual UTF-8 bytes without relying on Content-Length", async () => {
    const request = new Request("https://lighthouse.test", { method: "POST", body: JSON.stringify({ text: "한글".repeat(30) }) });
    expect(request.headers.has("content-length")).toBe(false);
    await expect(readJsonObject(request, { maxBytes: 100 })).rejects.toMatchObject({ status: 413, code: "request_too_large" });
  });
  test("bounded reader retains valid JSON and rejects wrong shape", async () => {
    await expect(readJsonObject(new Request("https://lighthouse.test", { method: "POST", body: '{"text":"한글"}' }), { maxBytes: 100 })).resolves.toEqual({ text: "한글" });
    await expect(readJsonObject(new Request("https://lighthouse.test", { method: "POST", body: "[]" }), { maxBytes: 100 })).rejects.toMatchObject({ code: "invalid_json_shape" });
  });
  test("rejects public attempts to mint reserved legacy capture provenance", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "1");
    vi.stubEnv("FLAG_V2_WRITE", "1");
    harness.getV2CloudflareBindings.mockReturnValue({ db: {} });
    harness.getSession.mockResolvedValue({
      sessionId: "session-current",
      userId: "user-a",
      email: "owner@example.test",
      displayName: "Owner",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    harness.getActiveRestrictedGrant.mockResolvedValue(null);

    const response = await commitCapture(new Request("https://lighthouse.test/api/v2/captures/commit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "public-forgery",
        Origin: "https://lighthouse.test",
      },
      body: JSON.stringify({
        draftId: "LEGACY:forged-native-capture",
        channel: "web",
        title: "공개 입력",
        bodyMarkdown: "정상 글을 legacy provenance로 위장하려는 요청",
        aiEnabled: false,
        clientTimezone: "Asia/Seoul",
        privacyLevel: "normal",
        capturedAt: "2026-08-29T00:00:00.000Z",
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_field" } });
  });
});
