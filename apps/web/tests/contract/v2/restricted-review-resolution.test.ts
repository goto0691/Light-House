import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ getSession: vi.fn(), getActiveRestrictedGrant: vi.fn(), getV2CloudflareBindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.getSession }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.getActiveRestrictedGrant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.getV2CloudflareBindings }));

import { POST as resolveRoute } from "@/app/api/v2/review-items/[reviewId]/resolve/route";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1ReviewRepository, type ReviewResolutionAction } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly owner: MemoryD1, private readonly query: string, private readonly sql: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { const result = (this.sql.get(...this.values) ?? null) as T | null; this.owner.afterFirst?.(this.query); return result; }
  async all<T>() { return { results: this.sql.all(...this.values) as T[] }; }
  async run() { return this.sql.run(...this.values); }
}
class MemoryD1 implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  afterFirst: ((query: string) => void) | null = null;
  prepare(query: string) { return new Statement(this, query, this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.beforeBatch?.();
    this.sql.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sql.exec("commit");
      return results as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}
let db: MemoryD1;
const now = "2026-09-08T00:00:00.000Z";
beforeEach(() => {
  vi.stubEnv("FLAG_V2_ROUTES", "1");
  vi.stubEnv("FLAG_V2_WRITE", "1");
  db = new MemoryD1();
  db.sql.exec("pragma foreign_keys=on;create table users(id text primary key not null);insert into users values ('user-a'),('user-b');");
  const directory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
  for (const name of readdirSync(directory).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 31).sort()) db.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
  harness.getSession.mockResolvedValue({ sessionId: "session-a", userId: "user-a", email: "a@example.test", expiresAt: Date.now() + 100_000 });
  harness.getActiveRestrictedGrant.mockResolvedValue(null);
  harness.getV2CloudflareBindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

async function fixture(privacyLevel: "normal" | "restricted" = "restricted") {
  const item = await prepareCaptureCommit({ draftId: "review-lock", channel: "web", title: "합성 잠긴 기록", bodyMarkdown: "private synthetic note", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now }, "review-lock", now);
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(item);
  db.sql.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
    values ('review-job','user-a',?,?,'analyze','review-job-key',3,?,?,'fixture',?)`).run(item.captureId, item.objectId, now, item.revisionId, now);
  db.sql.prepare(`insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
    values ('review-run','review-job','user-a','structured','fake','p','s','r','m','fixture','succeeded',?)`).run(now);
  db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,origin,created_at,updated_at)
    values ('review-field','user-a','private_comment','합성 필드','{}','short_text','ai_proposed',?,?)`).run(now, now);
  db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,proposal_temp_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,processing_run_id,created_at)
    values ('review-property','user-a',?,'review-field','private-proposal','text','private synthetic property','"private synthetic property"','ai_inferred','low','proposed','review-run',?)`).run(item.objectId, now);
  db.sql.prepare(`insert into v2_review_items(id,user_id,object_id,processing_run_id,kind,payload_json,created_at)
    values ('private-review','user-a',?,'review-run','analysis_review','{"proposalTempId":"private-proposal","fieldKey":"private_comment"}',?)`).run(item.objectId, now);
  return item;
}
function route(action: ReviewResolutionAction, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return resolveRoute(new Request("https://lighthouse.test/api/v2/review-items/private-review/resolve", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://lighthouse.test", ...headers },
    body: JSON.stringify({ action, correctedValue: "corrected private synthetic property", ...extra }),
  }), { params: Promise.resolve({ reviewId: "private-review" }) });
}
function expectUnchanged() {
  expect(db.sql.prepare("select status from v2_review_items where id='private-review'").get()).toEqual({ status: "open" });
  expect(db.sql.prepare("select review_status,locked_by_user from v2_property_values where id='review-property'").get()).toEqual({ review_status: "proposed", locked_by_user: 0 });
  expect(db.sql.prepare("select count(*) as count from v2_review_receipts").get()).toEqual({ count: 0 });
  expect(db.sql.prepare("select count(*) as count from v2_audit_events where action='review.resolved'").get()).toEqual({ count: 0 });
}

describe("restricted review resolution at actual HTTP and SQL boundaries", () => {
  test.each(["accept", "reject", "correct", "dismiss"] as const)("requires a server grant for %s even with forged body unlock", async (action) => {
    await fixture();
    const response = await route(action, { restrictedUnlocked: true, restrictedGrant: { expiresAt: "2099-01-01T00:00:00Z" } });
    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ error: { code: "restricted_record_locked" } });
    expectUnchanged();
  });
  test("honors a valid server grant and returns a normal receipt without changing immutable originals", async () => {
    const item = await fixture();
    const before = db.sql.prepare("select * from v2_source_items where capture_id=?").all(item.captureId);
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00Z" });
    const response = await route("accept");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ resultStatus: "accepted", replayed: false });
    expect(db.sql.prepare("select review_status,locked_by_user from v2_property_values where id='review-property'").get()).toEqual({ review_status: "accepted", locked_by_user: 1 });
    expect(db.sql.prepare("select * from v2_source_items where capture_id=?").all(item.captureId)).toEqual(before);
  });
  test("does not accept an expired grant from the request context", async () => {
    await fixture();
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2000-01-01T00:00:00Z" });
    expect((await route("accept")).status).toBe(423);
    expectUnchanged();
  });
  test("denies receipt replay after the owner locks the record again", async () => {
    await fixture();
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00Z" });
    expect((await route("accept")).status).toBe(201);
    harness.getActiveRestrictedGrant.mockResolvedValue(null);
    const replay = await route("accept");
    expect(replay.status).toBe(423);
    const response = JSON.stringify(await replay.json());
    expect(response).not.toContain("receiptId");
    expect(response).not.toContain("resultStatus");
  });
  test("keeps normal records writable and rejects foreign owner or unprojected legacy reviews", async () => {
    const item = await fixture("normal");
    harness.getSession.mockResolvedValue({ sessionId: "session-b", userId: "user-b", email: "b@example.test", expiresAt: Date.now() + 100_000 });
    expect((await route("accept")).status).toBe(404);
    expectUnchanged();
    harness.getSession.mockResolvedValue({ sessionId: "session-a", userId: "user-a", email: "a@example.test", expiresAt: Date.now() + 100_000 });
    db.sql.prepare("update v2_capture_bundles set draft_id='legacy:review-hidden' where id=?").run(item.captureId);
    expect((await route("accept")).status).toBe(404);
    expectUnchanged();
    db.sql.prepare("update v2_capture_bundles set draft_id='review-lock' where id=?").run(item.captureId);
    expect((await route("accept")).status).toBe(201);
  });
  test.each(["accept", "correct"] as const)("rolls back %s if privacy changes after reads and before the D1 batch", async (action) => {
    const item = await fixture("normal");
    db.beforeBatch = () => { db.beforeBatch = null; db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.objectId); };
    expect((await route(action)).status).toBe(423);
    expectUnchanged();
    expect(db.sql.prepare("select count(*) as count from v2_property_values").get()).toEqual({ count: 1 });
  });
  test("rechecks privacy before returning an existing receipt after a read race", async () => {
    const item = await fixture("normal");
    expect((await route("accept")).status).toBe(201);
    db.afterFirst = (query) => {
      if (!query.includes("select rr.id,rr.action,rr.result_status")) return;
      db.afterFirst = null;
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.objectId);
    };
    const response = await route("accept");
    expect(response.status).toBe(423);
    expect(JSON.stringify(await response.json())).not.toContain("receiptId");
  });
  test("preserves authentication and same-origin mutation checks", async () => {
    await fixture();
    expect((await route("accept", {}, { Origin: "https://attacker.test" })).status).toBe(403);
    harness.getSession.mockResolvedValue(null);
    expect((await route("accept")).status).toBe(401);
    expectUnchanged();
  });
  test("direct repository callers default to locked without widening access", async () => {
    await fixture();
    await expect(new D1ReviewRepository(db, "user-a").resolve("private-review", { action: "accept" })).rejects.toMatchObject({ code: "restricted_record_locked" });
    expectUnchanged();
  });
});
