import { describe, expect, test } from "vitest";

import { requireV2RequestContext } from "@/lib/v2/http/request-context";

const session = {
  sessionId: "session-current",
  userId: "user-a",
  email: "owner@example.test",
  displayName: "Owner",
  expiresAt: Date.parse("2026-08-19T00:00:00.000Z"),
};

describe("V2 request context", () => {
  test("binds a restricted grant to the authenticated user and current session", async () => {
    let resolvedInput: { userId: string; sessionId: string } | undefined;
    const context = await requireV2RequestContext(new Request("https://lighthouse.test/api/v2/records/one"), {
      sessionResolver: async () => session,
      restrictedGrantResolver: async (input) => {
        resolvedInput = input;
        return { expiresAt: "2026-08-12T10:10:00.000Z" };
      },
    });
    expect(resolvedInput).toEqual({ userId: "user-a", sessionId: "session-current" });
    expect(context).toMatchObject({ userId: "user-a", sessionId: "session-current", restrictedGrant: { expiresAt: "2026-08-12T10:10:00.000Z" } });
  });

  test("does not invent a restricted grant when no active token exists", async () => {
    const context = await requireV2RequestContext(new Request("https://lighthouse.test/api/v2/records/one"), {
      sessionResolver: async () => session,
      restrictedGrantResolver: async () => null,
    });
    expect(context.restrictedGrant).toBeUndefined();
  });
});
