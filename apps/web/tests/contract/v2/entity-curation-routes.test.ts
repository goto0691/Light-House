import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { POST as merge } from "@/app/api/v2/entities/[entityId]/merge/route";
import { POST as rename } from "@/app/api/v2/entities/[entityId]/rename/route";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { LinkSqlite } from "../../support/link-sqlite";

const OWNER = "link-owner", now = "2026-10-18T03:00:00.000Z";
let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(33);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1");
  harness.session.mockResolvedValue({ sessionId: "owner-session", userId: OWNER, email: "owner@example.test", expiresAt: Date.now() + 100_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

const call = (handler: typeof merge, entityId: string, body: unknown, origin = "https://lighthouse.test") => handler(
  new Request(`https://lighthouse.test/api/v2/entities/${entityId}/x`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ entityId }) });

describe("entity rename and merge routes", () => {
  test("merging needs the owner's explicit confirmation and a same-origin request", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, OWNER);
    const english = await knowledge.ensureEntity("organization", "Warner Bros.", now), korean = await knowledge.ensureEntity("organization", "워너 브라더스", now);
    expect((await call(merge, korean, { sourceEntityId: english })).status).toBe(400);
    expect((await call(merge, korean, { sourceEntityId: english, confirmed: true }, "https://elsewhere.test")).status).toBe(403);
    const merged = await call(merge, korean, { sourceEntityId: english, confirmed: true });
    expect(merged.status).toBe(201);
    expect(await merged.json()).toMatchObject({ entityId: korean, mergedId: english });
    expect((await call(merge, korean, { sourceEntityId: english, confirmed: true })).status).toBe(404);
  });

  test("another owner's entity is not found and a blank name is refused", async () => {
    const foreign = await new D1ImportedKnowledgeRepository(db, "other-owner").ensureEntity("person", "남의 사람", now);
    expect((await call(rename, foreign, { name: "바꾼 이름" })).status).toBe(404);
    const mine = await new D1ImportedKnowledgeRepository(db, OWNER).ensureEntity("person", "내 사람", now);
    expect((await call(rename, mine, { name: "   " })).status).toBe(400);
    expect((await call(rename, mine, { name: "고친 이름" })).status).toBe(200);
    expect(db.sql.prepare("select canonical_name from v2_entity_records where object_id=?").get(foreign)).toEqual({ canonical_name: "남의 사람" });
  });
});
