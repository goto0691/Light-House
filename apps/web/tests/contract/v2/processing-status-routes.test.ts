import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
import * as route from "@/app/api/v2/processing/status/route";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { encodeProcessingCursor, type ProcessingStatusPage } from "@/lib/v2/domain/processing-status";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkMemoryD1 } from "./link-presentation-fixture";

const now = "2026-09-22T14:00:00.000Z";
let db: LinkMemoryD1;
beforeEach(() => {
  db = new LinkMemoryD1(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "0"); vi.stubEnv("FLAG_V2_AI", "0"); vi.stubEnv("GEMINI_API_KEY", "");
  harness.session.mockResolvedValue({ userId: "link-owner", email: "synthetic@example.test", sessionId: "processing-status", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs(); });
async function seed(privacy: "normal" | "sensitive" | "restricted" = "normal", owner = "link-owner") {
  const record = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: `PRIVATE ${privacy} TITLE`, bodyMarkdown: "PRIVATE BODY",
    privacyLevel: privacy, clientTimezone: "Asia/Seoul", capturedAt: now, aiEnabled: false }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(record); return record;
}
async function request(query = "", status = 200) {
  const response = await route.GET(new Request(`https://lighthouse.test/api/v2/processing/status?${query}`));
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie"); return response;
}

describe("processing status GET route with real SQLite", () => {
  test("GET works with write/AI disabled and requires no mutation origin or body", async () => {
    const record = await seed(); db.sql.exec("pragma query_only=on");
    const result = await (await request()).json() as ProcessingStatusPage;
    expect(result).toMatchObject({ contract: "processing-status.v1", filter: "all", runtime: { enabled: false, configured: false }, counts: { all: 1 },
      items: [{ recordId: record.objectId, storage: "saved", status: "unprocessed" }] });
  });
  test("only GET is exported, not mutation handlers that could retry, enqueue or unlock", () => {
    expect(Object.keys(route)).toEqual(["GET"]);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(route).not.toHaveProperty(method);
  });
  test("unauthenticated request stops before binding or SQLite and never discloses records", async () => {
    harness.session.mockResolvedValue(null); const prepare = vi.spyOn(db, "prepare");
    expect(await (await request("", 401)).json()).toMatchObject({ error: { code: "authentication_required" } });
    expect(prepare).not.toHaveBeenCalled(); expect(harness.bindings).not.toHaveBeenCalled();
  });
  test("routes disabled returns non-cacheable 404 before authentication and database", async () => {
    vi.stubEnv("FLAG_V2_ROUTES", "0"); const prepare = vi.spyOn(db, "prepare");
    await request("", 404); expect(harness.session).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
  test("session identity, not query fields, owns the status records", async () => {
    await seed(); const other = await seed("normal", "link-other");
    harness.session.mockResolvedValue({ userId: "link-other", email: "other@example.test", sessionId: "other-session", expiresAt: Date.now() + 60_000 });
    const result = await (await request()).json() as ProcessingStatusPage;
    expect(result.items.map((item) => item.recordId)).toEqual([other.objectId]); expect(result.counts.all).toBe(1);
  });
  test("active restricted grant never broadens this overview's redacted DTO", async () => {
    await seed("restricted"); await seed("sensitive"); harness.grant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00.000Z" });
    const result = await (await request()).json() as ProcessingStatusPage;
    expect(result.items.find((item) => item.privacyLevel === "restricted")).toMatchObject({ title: "잠긴 기록", status: "restricted", stages: [], partial: false, reviewPending: false });
    expect(result.items.find((item) => item.privacyLevel === "sensitive")?.title).toBe("민감 기록");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  test("a configured key yields only a boolean, never key material or provider invocation", async () => {
    vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1"); vi.stubEnv("GEMINI_API_KEY", "SYNTHETIC_SECRET_NOT_REAL");
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not be used")); db.sql.exec("pragma query_only=on");
    const result = await (await request()).json() as ProcessingStatusPage;
    expect(result.runtime).toMatchObject({ enabled: true, configured: true }); expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET"); expect(network).not.toHaveBeenCalled();
  });
  test("repository failure is fixed-message and no-store without SQL or personal payloads", async () => {
    vi.spyOn(db, "prepare").mockImplementation(() => { throw new Error("PRIVATE SQL TOKEN BODY"); });
    const text = await (await request("", 500)).text(); expect(text).toContain("internal_error"); expect(text).not.toMatch(/PRIVATE|SQL|TOKEN|BODY/);
  });
  test.each(["filter=bogus", "filter=all&filter=waiting", "cursor=a&cursor=b", "unknown=x", "userId=link-other", "cursor=%7B",
    new URLSearchParams({ cursor: encodeProcessingCursor(now, "id", "waiting") }).toString(),
    new URLSearchParams({ cursor: "x".repeat(1025) }).toString()])("rejects invalid query before SQL: %s", async (query) => {
    const prepare = vi.spyOn(db, "prepare");
    expect(await (await request(query, 400)).json()).toMatchObject({ error: { code: "processing_status_query_invalid" } }); expect(prepare).not.toHaveBeenCalled();
  });
  test("API pagination uses exact emitted cursor and preserves filter-wide totals", async () => {
    for (let index = 0; index < 21; index++) await seed();
    const first = await (await request("filter=unprocessed")).json() as ProcessingStatusPage;
    const second = await (await request(new URLSearchParams({ filter: "unprocessed", cursor: first.nextCursor! }).toString())).json() as ProcessingStatusPage;
    expect([first.items.length, second.items.length]).toEqual([20, 1]); expect(second.nextCursor).toBeNull();
    expect(first.counts).toEqual(second.counts); expect(new Set([...first.items, ...second.items].map((item) => item.recordId)).size).toBe(21);
  });
});
