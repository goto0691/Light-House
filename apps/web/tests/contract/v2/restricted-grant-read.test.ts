import { beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: harness.cookies }));

import { getActiveRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { v2ErrorResponse } from "@/lib/v2/http/request-context";
import { DocumentRevisionLockedError } from "@/lib/v2/domain/document-revision";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

beforeEach(() => vi.clearAllMocks());

describe("restricted grant reads in a Server Component", () => {
  test("returns null for a stale cookie without attempting a forbidden cookie mutation", async () => {
    const remove = vi.fn(() => { throw new Error("Cookies can only be modified in a Server Action or Route Handler."); });
    harness.cookies.mockResolvedValue({ get: () => ({ value: "stale-local-test-token" }), delete: remove });
    const first = vi.fn(async () => null);
    const statement = { bind: vi.fn(), first, all: vi.fn(), run: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const db = { prepare: vi.fn(() => statement), batch: vi.fn() } satisfies D1DatabaseBinding;
    await expect(getActiveRestrictedGrant(db, { userId: "user-a", sessionId: "current-session" })).resolves.toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(statement.bind).toHaveBeenCalledWith("user-a", "current-session", expect.any(String), expect.any(String));
  });

  test("maps a locked revision to an actionable locked response", async () => {
    const response = v2ErrorResponse(new DocumentRevisionLockedError());
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "restricted_record_locked" } });
  });
});
