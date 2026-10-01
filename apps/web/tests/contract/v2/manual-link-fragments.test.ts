import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET, POST } from "@/app/api/v2/records/[recordId]/links/fragments/route";
import { GET as GET_FRAGMENT } from "@/app/api/v2/records/[recordId]/links/fragments/[fragmentId]/route";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { parseManualLinkFragmentRequest, type CreateManualLinkFragmentRequest, type ManualLinkFragmentReceipt } from "@/lib/v2/domain/manual-link-fragment-v1";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite();
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1");
  harness.session.mockResolvedValue({ sessionId: "manual-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 100_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
const repo = () => new D1ManualLinkFragmentRepository(db, "link-owner");
async function fixture(options: Parameters<typeof seedLinkRecord>[1] = {}) {
  const item = await seedLinkRecord(db, options);
  const input: CreateManualLinkFragmentRequest = { expectedRevisionId: item.capture.revisionId, expectedSnapshotId: item.projection!.snapshot.id,
    expectedManifestHash: item.projection!.snapshot.manifestHash, memberId: item.projection!.members[0].id,
    textStart: 0, textEnd: item.rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID() };
  return { ...item, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function post(item: Fixture, value: unknown = item.input, headers: Record<string, string> = {}) {
  return POST(new Request(`https://lighthouse.test/api/v2/records/${item.capture.objectId}/links/fragments`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://lighthouse.test", ...headers }, body: JSON.stringify(value),
  }), { params: Promise.resolve({ recordId: item.capture.objectId }) });
}
function get(recordId: string, query = "") {
  return GET(new Request(`https://lighthouse.test/api/v2/records/${recordId}/links/fragments${query}`), { params: Promise.resolve({ recordId }) });
}
function getFragment(item: Fixture, fragmentId: string, query = `?snapshotId=${item.input.expectedSnapshotId}`) {
  return GET_FRAGMENT(new Request(`https://lighthouse.test/api/v2/records/${item.capture.objectId}/links/fragments/${fragmentId}${query}`),
    { params: Promise.resolve({ recordId: item.capture.objectId, fragmentId }) });
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: { code: code ?? expect.any(String), message: expect.any(String) } });
}
function noWrites() {
  for (const table of ["v2_link_fragments", "v2_link_fragment_evidence"]) expect(db.sql.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 0 });
  expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.fragment_created'").get()).toEqual({ n: 0 });
  expect(db.sql.prepare("select count(*) as n from v2_idempotency_records where operation='link_fragment.create.v1'").get()).toEqual({ n: 0 });
}
/** Mutate real SQL at an awaited read boundary, not repository result data. */
function afterRead(predicate: (query: string) => boolean, mutate: () => void): D1DatabaseBinding {
  let fired = false;
  return {
    prepare(query) {
      let actual = db.prepare(query);
      const after = () => { if (!fired && predicate(query)) { fired = true; mutate(); } };
      const statement: D1PreparedStatementBinding = {
        bind(...values) { actual = actual.bind(...values); return statement; },
        async first<T>() { const result = await actual.first<T>(); after(); return result; },
        async all<T>() { const result = await actual.all<T>(); after(); return result; },
        run: () => actual.run(),
      };
      return statement;
    },
    batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements),
  };
}

describe("manual exact source fragments: actual HTTP and SQLite transactions", () => {
  test("single-fragment GET revalidates exact original for copying, including preserved historical selections", async () => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    const read = await getFragment(item, saved.item.id); expect(read.status).toBe(200); expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await read.json()).toEqual({ contract: saved.contract, item: saved.item });
    await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId,
      expectedSnapshotId: item.input.expectedSnapshotId, expectedSnapshotVersion: 1, sourceItemIds: item.projection!.members.map((m) => m.sourceItemId), idempotencyKey: "single-next" });
    const before = db.sql.prepare("select total_changes() as n").get();
    expect(await (await getFragment(item, saved.item.id)).json()).toEqual({ contract: saved.contract, item: saved.item });
    expect(db.sql.prepare("select total_changes() as n").get()).toEqual(before);
  });
  test("single-fragment GET cannot use a stale receipt to bypass owner, source version or expired grant", async () => {
    const item = await fixture(), other = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    await error(await getFragment(other, saved.item.id), 404);
    await error(await getFragment(item, saved.item.id, `?snapshotId=${other.input.expectedSnapshotId}`), 404);
    harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 100_000 });
    await error(await getFragment(item, saved.item.id), 404);
    harness.session.mockResolvedValue({ sessionId: "manual-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 100_000 });
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
    harness.grant.mockResolvedValue({ expiresAt: "2000-01-01T00:00:00Z" }); await error(await getFragment(item, saved.item.id), 423);
  });
  test.each(["source", "privacy"])("single-fragment copy read fences a concurrent %s change", async (change) => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    let fired = false;
    harness.bindings.mockReturnValue({ db: afterRead((query) => query.includes("as evidence_valid"), () => {
      fired = true;
      if (change === "source") db.sql.prepare("update v2_source_items set raw_text='late rewrite' where id=?").run(item.projection!.members[0].sourceItemId);
      else db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
    }) });
    await error(await getFragment(item, saved.item.id), change === "source" ? 400 : 423); expect(fired).toBe(true);
  });
  test("single-fragment copy route enforces auth and strict query while allowing read-only mode", async () => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    for (const query of ["", "?snapshotId=", "?snapshotId=a&snapshotId=b", `?snapshotId=${item.input.expectedSnapshotId}&restrictedUnlocked=1`]) await error(await getFragment(item, saved.item.id, query), 400);
    vi.stubEnv("FLAG_V2_WRITE", "0"); expect((await getFragment(item, saved.item.id)).status).toBe(200);
    harness.session.mockResolvedValue(null); await error(await getFragment(item, saved.item.id), 401);
  });
  test("preserves exact CRLF/space/emoji text and independent manual origin without creating AI jobs or changing originals", async () => {
    const item = await fixture(), before = db.sql.prepare("select * from v2_source_items").all();
    const response = await post(item); expect(response.status).toBe(201); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const saved = await response.json() as ManualLinkFragmentReceipt;
    expect(saved).toMatchObject({ contract: "manual-link-fragment.v1", replayed: false, item: { stateVersion: 1, reviewStatus: "confirmed",
      fragment: { rawText: item.rawText, rawTextHash: await linkSha256Hex(item.rawText), sourceClass: "source_extract", selectionOrigin: "user_selected", completeness: "unknown" } } });
    expect(db.sql.prepare("select processing_run_id,locked_by_user from v2_link_fragments where id=?").get(saved.item.id)).toEqual({ processing_run_id: null, locked_by_user: 1 });
    expect(db.sql.prepare("select * from v2_source_items").all()).toEqual(before);
    expect(db.sql.prepare("select count(*) as n from v2_processing_jobs").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) as n from v2_property_values").get()).toEqual({ n: 0 });
    expect(await new D1LinkPresentationRepository(db, "link-owner").project(item.capture.objectId)).toMatchObject({ selectedRun: null, fragments: [] });
    expect(await (await get(item.capture.objectId)).json()).toMatchObject({ items: [saved.item], isHistorical: false, nextCursor: null });
  });
  test("splits prompt/negative/parameters on one line using server ranges, without source numbering", async () => {
    const item = await fixture({ rawText: "1/3:  bright light 👀  | negative:  blur  | --ar 3:2" });
    for (const [role, exact] of [["prompt", " bright light 👀  "], ["negative_prompt", " blur  "], ["parameters", "--ar 3:2"]] as const) {
      const start = item.rawText.indexOf(exact);
      const saved = await repo().create(item.capture.objectId, { ...item.input, role, textStart: start, textEnd: start + exact.length, idempotencyKey: role });
      expect(saved.item.fragment).toMatchObject({ role, rawText: exact, textStart: start, textEnd: start + exact.length });
    }
    expect((await repo().list(item.capture.objectId)).items).toHaveLength(3);
  });
  test.each(["rawText", "sourceClass", "processingRunId", "restrictedUnlocked", "restrictedGrantExpiresAt", "completeness"])("rejects client %s instead of accepting authority or rewritten text", async (field) => {
    const item = await fixture(); await error(await post(item, { ...item.input, [field]: "forged" }), 400, "manual_link_fragment_invalid"); noWrites();
  });
  test.each([[0, 0], [-1, 2], [0, 10000], [0.5, 3], [0, 1.5], [2, 3], [0, 2]])("rejects invalid/surrogate-splitting UTF-16 range %s..%s", async (textStart, textEnd) => {
    const item = await fixture({ rawText: "a👀b" }); await error(await post(item, { ...item.input, textStart, textEnd }), 400); noWrites();
  });
  test("defensively captures requests before awaits and rejects accessors without evaluating them", async () => {
    const item = await fixture(), mutable = { ...item.input };
    const pending = repo().create(item.capture.objectId, mutable);
    mutable.role = "parameters"; mutable.textEnd = 1; mutable.idempotencyKey = "changed";
    expect((await pending).item.fragment).toMatchObject({ role: "prompt", rawText: item.rawText });
    const getter = vi.fn(() => 0), hostile = { ...item.input };
    Object.defineProperty(hostile, "textStart", { get: getter });
    expect(() => parseManualLinkFragmentRequest(hostile)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => parseManualLinkFragmentRequest({ ...item.input, [Symbol("hidden")]: true })).toThrow();
  });
  test("same key replays once, while a different span or role cannot reuse its receipt", async () => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    const response = await post(item); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...saved, replayed: true });
    await error(await post(item, { ...item.input, textEnd: 2 }), 409, "idempotency_conflict");
    await error(await post(item, { ...item.input, role: "parameters" }), 409, "idempotency_conflict");
    expect(db.sql.prepare("select count(*) as n from v2_link_fragments").get()).toEqual({ n: 1 });
  });
  test.each(["missing", "expired", "active"])("restricted reads, writes and receipt replay require a live server grant: %s", async (grant) => {
    const item = await fixture({ privacyLevel: "restricted" });
    if (grant !== "missing") harness.grant.mockResolvedValue({ expiresAt: grant === "active" ? "2099-01-01T00:00:00Z" : "2000-01-01T00:00:00Z" });
    if (grant !== "active") { await error(await post(item), 423, "restricted_record_locked"); await error(await get(item.capture.objectId), 423); noWrites(); return; }
    expect((await post(item)).status).toBe(201); expect((await get(item.capture.objectId)).status).toBe(200);
    harness.grant.mockResolvedValue(null); await error(await post(item), 423); await error(await get(item.capture.objectId), 423);
  });
  test("SQL clock rejects an expired grant even when the earlier application clock considered it active", async () => {
    const item = await fixture({ privacyLevel: "restricted" }), actualNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(actualNow - 60_000);
    await expect(repo().create(item.capture.objectId, item.input, { restrictedGrantExpiresAt: new Date(actualNow - 30_000).toISOString() }))
      .rejects.toMatchObject({ code: "manual_link_fragment_conflict" }); noWrites();
  });
  test("grant expiry after commit withholds the response but safely replays the saved fragment after reauthentication", async () => {
    const item = await fixture({ privacyLevel: "restricted" }), expiry = new Date(Date.now() + 60_000).toISOString();
    const binding: D1DatabaseBinding = { prepare: (query) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
      const result = await db.batch<T>(statements); vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiry) + 1); return result;
    } };
    await expect(new D1ManualLinkFragmentRepository(binding, "link-owner").create(item.capture.objectId, item.input, { restrictedGrantExpiresAt: expiry }))
      .rejects.toMatchObject({ code: "restricted_record_locked" });
    expect(db.sql.prepare("select count(*) as n from v2_link_fragments").get()).toEqual({ n: 1 });
    vi.restoreAllMocks();
    expect(await repo().create(item.capture.objectId, item.input, { restrictedGrantExpiresAt: "2099-01-01T00:00:00Z" })).toMatchObject({ replayed: true });
  });
  test("denies foreign owners, snapshots and personal memo source IDs", async () => {
    const item = await fixture(), other = await fixture();
    await expect(new D1ManualLinkFragmentRepository(db, "other-owner").create(item.capture.objectId, item.input)).rejects.toMatchObject({ code: "record_not_found" });
    await expect(new D1ManualLinkFragmentRepository(db, "other-owner").list(item.capture.objectId)).rejects.toMatchObject({ code: "record_not_found" });
    await error(await post(item, { ...item.input, memberId: other.input.memberId }), 400);
    const memo = db.sql.prepare("select id from v2_source_items where capture_id=? and item_kind<>'url'").get(item.capture.captureId) as { id: string };
    await error(await post(item, { ...item.input, memberId: memo.id }), 400);
    await error(await get(item.capture.objectId, `?snapshotId=${other.input.expectedSnapshotId}`), 404); noWrites();
  });
  test.each(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash"])("rejects stale %s before writing", async (field) => {
    const item = await fixture(); await error(await post(item, { ...item.input, [field]: field.endsWith("Hash") ? "0".repeat(64) : "stale" }), 409); noWrites();
  });
  test.each(["privacy", "snapshot", "revision", "legacy", "source", "source_metadata", "source_hash", "member_removed", "lifecycle"])("atomic fence rolls back all four writes after concurrent %s change", async (change) => {
    const item = await fixture();
    db.beforeBatch = () => {
      db.beforeBatch = null;
      if (change === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      if (change === "snapshot") db.sql.prepare("update v2_documents set current_link_snapshot_id=null where object_id=?").run(item.capture.objectId);
      if (change === "revision") db.sql.prepare("update v2_documents set current_revision_id=null where object_id=?").run(item.capture.objectId);
      if (change === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:hidden' where id=?").run(item.capture.captureId);
      if (change === "source") db.sql.prepare("update v2_source_items set raw_text='rewritten' where id=?").run(item.projection!.members[0].sourceItemId);
      if (change === "source_metadata") db.sql.prepare("update v2_source_items set source_metadata='{}' where id=?").run(item.projection!.members[0].sourceItemId);
      if (change === "source_hash") db.sql.prepare("update v2_source_items set content_hash=? where id=?").run("0".repeat(64), item.projection!.members[0].sourceItemId);
      if (change === "member_removed") db.sql.prepare("delete from v2_link_snapshot_sources where id=?").run(item.input.memberId);
      if (change === "lifecycle") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(item.capture.objectId);
    };
    const response = await post(item); expect([400, 404, 409, 423]).toContain(response.status); noWrites();
  });
  test("a failure in the final receipt insert rolls back fragment, evidence and audit", async () => {
    const item = await fixture();
    db.sql.exec("create trigger test_receipt_failure before insert on v2_idempotency_records when NEW.operation='link_fragment.create.v1' begin select raise(abort,'injected storage failure'); end");
    await error(await post(item), 500, "internal_error"); noWrites();
  });
  test.each(["source", "fragment_hash", "evidence_range", "extra_evidence"])("GET and idempotency replay reject stored %s corruption", async (change) => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    if (change === "source") db.sql.prepare("update v2_source_items set raw_text='corrupted' where id=?").run(item.projection!.members[0].sourceItemId);
    if (change === "fragment_hash") {
      db.sql.exec("drop trigger trg_v2_link_fragment_immutable"); db.sql.prepare("update v2_link_fragments set raw_text_hash=? where id=?").run("0".repeat(64), saved.item.id);
    }
    if (change === "evidence_range") {
      db.sql.exec("drop trigger trg_v2_link_fragment_evidence_immutable"); db.sql.prepare("update v2_link_fragment_evidence set text_end=99999 where fragment_id=?").run(saved.item.id);
    }
    if (change === "extra_evidence") db.sql.prepare(`insert into v2_link_fragment_evidence select ?,user_id,fragment_id,member_id,relation_kind,evidence_method,
      text_start,text_end,image_region_json,start_seconds,end_seconds,display_order,locked_by_user,state_version,created_at from v2_link_fragment_evidence where fragment_id=?`).run(crypto.randomUUID(), saved.item.id);
    await error(await get(item.capture.objectId), 400); await error(await post(item), 400);
  });
  test("record privacy changes during list or receipt replay never return previously read source text", async () => {
    const item = await fixture(); await repo().create(item.capture.objectId, item.input);
    for (const kind of ["list", "replay"]) {
      db.sql.prepare("update v2_documents set privacy_level='normal' where object_id=?").run(item.capture.objectId);
      harness.bindings.mockReturnValue({ db: afterRead((query) => kind === "list" ? query.includes("as evidence_valid") : query.startsWith("select payload_hash,response_json"),
        () => db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId)) });
      await error(kind === "list" ? await get(item.capture.objectId) : await post(item), 423);
    }
  });
  test.each(["list", "replay"])("final %s response rejects source mutation after the validated snapshot read", async (kind) => {
    const item = await fixture(); await repo().create(item.capture.objectId, item.input);
    let fired = false;
    harness.bindings.mockReturnValue({ db: afterRead((query) => query.includes("as evidence_valid"), () => {
      fired = true; db.sql.prepare("update v2_source_items set raw_text='late corruption' where id=?").run(item.projection!.members[0].sourceItemId);
    }) });
    await error(kind === "list" ? await get(item.capture.objectId) : await post(item), 400, "manual_link_fragment_integrity_invalid");
    expect(fired).toBe(true);
  });
  test("paging reaches more than 50 fragments with same-timestamp tie breaks and rejects a different record cursor", async () => {
    const item = await fixture({ rawText: "short" }), other = await fixture();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const saved: string[] = [];
    for (let index = 0; index < 55; index++) saved.push((await repo().create(item.capture.objectId, { ...item.input, idempotencyKey: `page-${index}` })).item.id);
    expect(db.sql.prepare("select count(distinct created_at) as n from v2_link_fragments where document_object_id=?").get(item.capture.objectId)).toEqual({ n: 1 });
    const first = await repo().list(item.capture.objectId); expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
    await expect(repo().list(other.capture.objectId, { cursor: first.nextCursor! })).rejects.toMatchObject({ code: "manual_link_fragment_cursor_invalid" });
    const seen = first.items.map((row) => row.id);
    let cursor = first.nextCursor;
    while (cursor) { const page = await repo().list(item.capture.objectId, { cursor }); seen.push(...page.items.map((row) => row.id)); cursor = page.nextCursor; }
    expect(seen).toEqual([...saved].sort().reverse()); expect(new Set(seen).size).toBe(55);
  });
  test.each([false, true])("concurrent idempotency winner is preserved and the loser's whole transaction rolls back (different payload: %s)", async (different) => {
    const item = await fixture(); let raced = false;
    const binding: D1DatabaseBinding = { prepare: (query) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
      if (!raced) { raced = true; await repo().create(item.capture.objectId, { ...item.input, ...(different ? { role: "parameters" } : {}) }); }
      return db.batch<T>(statements);
    } };
    const pending = new D1ManualLinkFragmentRepository(binding, "link-owner").create(item.capture.objectId, item.input);
    if (different) await expect(pending).rejects.toMatchObject({ code: "idempotency_conflict" });
    else expect(await pending).toMatchObject({ replayed: true });
    expect(raced).toBe(true);
    for (const table of ["v2_link_fragments", "v2_link_fragment_evidence"]) expect(db.sql.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 1 });
    expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.fragment_created'").get()).toEqual({ n: 1 });
    expect(db.sql.prepare("select count(*) as n from v2_idempotency_records where operation='link_fragment.create.v1'").get()).toEqual({ n: 1 });
  });
  test("page byte budget preserves every large fragment via cursors without truncation", async () => {
    const item = await fixture({ rawText: "한".repeat(25_000) });
    for (let index = 0; index < 3; index++) await repo().create(item.capture.objectId, { ...item.input, idempotencyKey: `large-${index}` });
    let cursor: string | undefined, count = 0;
    do {
      const page = await repo().list(item.capture.objectId, { cursor }); expect(page.items).toHaveLength(1);
      expect(page.items[0].fragment.rawText).toBe(item.rawText); count++; cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(count).toBe(3);
  });
  test("new snapshot keeps manual history read-only and does not silently move existing selections", async () => {
    const item = await fixture(); const saved = await repo().create(item.capture.objectId, item.input);
    const newer = await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId,
      expectedSnapshotId: item.input.expectedSnapshotId, expectedSnapshotVersion: 1, sourceItemIds: item.projection!.members.map((m) => m.sourceItemId), idempotencyKey: "next-snapshot" });
    expect(await repo().list(item.capture.objectId)).toMatchObject({ items: [], selectedSnapshotId: newer.snapshot.id, isHistorical: false });
    expect(await repo().list(item.capture.objectId, { snapshotId: item.input.expectedSnapshotId })).toMatchObject({ items: [saved.item], isHistorical: true });
    const replay = await post(item); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ...saved, replayed: true });
    await error(await post(item, { ...item.input, idempotencyKey: "fresh-old-snapshot" }), 409);
  });
  test("GET is side-effect free, and schema 0030 returns a private unavailable error without removing originals", async () => {
    const item = await fixture(); await repo().create(item.capture.objectId, item.input);
    const before = db.sql.prepare("select total_changes() as n").get(); await get(item.capture.objectId); expect(db.sql.prepare("select total_changes() as n").get()).toEqual(before);
    db.sql.close(); db = new LinkSqlite(30); harness.bindings.mockReturnValue({ db });
    const original = await seedLinkRecord(db, { snapshot: false }); const sources = db.sql.prepare("select * from v2_source_items").all();
    await error(await get(original.capture.objectId), 503, "link_snapshot_schema_unavailable");
    await error(await post(item), 503, "link_snapshot_schema_unavailable"); expect(db.sql.prepare("select * from v2_source_items").all()).toEqual(sources);
  });
  test("empty current snapshot is a valid empty list without writes", async () => {
    const item = await seedLinkRecord(db, { snapshot: false });
    expect(await repo().list(item.capture.objectId)).toMatchObject({ selectedSnapshotId: null, items: [], nextCursor: null }); noWrites();
  });
  test("HTTP keeps auth, feature, origin, content type, payload size and strict query boundaries", async () => {
    const item = await fixture();
    await error(await post(item, item.input, { Origin: "https://attacker.test" }), 403, "origin_rejected");
    await error(await post(item, item.input, { "Content-Type": "text/plain" }), 415, "content_type_rejected");
    await error(await post(item, { ...item.input, idempotencyKey: "x".repeat(10_000) }), 413, "request_too_large");
    for (const query of ["?limit=999", "?snapshotId=a&snapshotId=b", "?cursor=", "?snapshotId="]) await error(await get(item.capture.objectId, query), 400);
    vi.stubEnv("FLAG_V2_WRITE", "0"); await error(await post(item), 503, "v2_write_disabled"); expect((await get(item.capture.objectId)).status).toBe(200);
    vi.stubEnv("FLAG_V2_WRITE", "1"); harness.session.mockResolvedValue(null); await error(await post(item), 401); await error(await get(item.capture.objectId), 401);
    noWrites();
  });
});
