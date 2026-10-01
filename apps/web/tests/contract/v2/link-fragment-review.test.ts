import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ getSession: vi.fn(), getActiveRestrictedGrant: vi.fn(), getV2CloudflareBindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.getSession }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.getActiveRestrictedGrant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.getV2CloudflareBindings }));

import { PATCH } from "@/app/api/v2/records/[recordId]/links/fragments/[fragmentId]/route";
import type { LinkFragmentReviewRequest } from "@/lib/v2/domain/link-presentation-v1";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { exactLinkText, linkFixture, LinkMemoryD1, seedLinkRun } from "./link-presentation-fixture";

let db: LinkMemoryD1;
beforeEach(() => {
  db = new LinkMemoryD1(); vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1");
  harness.getSession.mockResolvedValue({ sessionId: "session", userId: "link-owner", email: "synthetic@example.test", expiresAt: Date.now() + 100_000 });
  harness.getActiveRestrictedGrant.mockResolvedValue(null); harness.getV2CloudflareBindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
async function fixture(privacy: "normal" | "restricted" = "normal") {
  const item = await linkFixture(db, { privacy }), run = await seedLinkRun(db, item);
  const input: LinkFragmentReviewRequest = { action: "confirm", expectedRevisionId: item.capture.revisionId, expectedSnapshotId: item.projection!.snapshot.id,
    expectedRunId: run.id, expectedStateVersion: 1, idempotencyKey: "review-one" };
  return { ...item, run, input };
}
function route(item: Awaited<ReturnType<typeof fixture>>, input: Record<string, unknown> = item.input, fragmentId = item.run.extractId, origin = "https://lighthouse.test") {
  return PATCH(new Request(`https://lighthouse.test/api/v2/records/${item.capture.objectId}/links/fragments/${fragmentId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(input),
  }), { params: Promise.resolve({ recordId: item.capture.objectId, fragmentId }) });
}
function unchanged(item: Awaited<ReturnType<typeof fixture>>) {
  expect(db.sql.prepare("select review_status,state_version,locked_by_user from v2_link_fragments where id=?").get(item.run.extractId)).toEqual({ review_status: "proposed", state_version: 1, locked_by_user: 0 });
  expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.fragment_reviewed'").get()).toEqual({ n: 0 });
}

describe("dedicated link fragment review HTTP and transactional CAS", () => {
  test("confirms exact original without mutating its contents or treating interpretation as personal fact", async () => {
    const item = await fixture(), before = db.sql.prepare("select * from v2_source_items").all();
    const response = await route(item); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ fragmentId: item.run.extractId, reviewStatus: "confirmed", stateVersion: 2, replayed: false });
    expect(db.sql.prepare("select raw_text,source_class,locked_by_user from v2_link_fragments where id=?").get(item.run.extractId)).toEqual({ raw_text: exactLinkText, source_class: "source_extract", locked_by_user: 1 });
    const interpretation = await route(item, { ...item.input, idempotencyKey: "review-idea" }, item.run.insightId); expect(interpretation.status).toBe(200);
    expect(db.sql.prepare("select raw_text,source_class,review_status from v2_link_fragments where id=?").get(item.run.insightId)).toEqual({ raw_text: null, source_class: "ai_interpretation", review_status: "confirmed" });
    expect(db.sql.prepare("select * from v2_source_items").all()).toEqual(before);
    expect(db.sql.prepare("select count(*) as n from v2_property_values").get()).toEqual({ n: 0 });
  });
  test("replays the same request and rejects reused key with changed action or stale state", async () => {
    const item = await fixture(); expect((await route(item)).status).toBe(200);
    expect(await (await route(item)).json()).toMatchObject({ replayed: true, stateVersion: 2 });
    expect((await route(item, { ...item.input, action: "reject" })).status).toBe(409);
    expect((await route(item, { ...item.input, action: "reject", idempotencyKey: "new-key" })).status).toBe(409);
    expect((await route(item, { ...item.input, action: "reject", expectedStateVersion: 2, idempotencyKey: "reject-two" })).status).toBe(200);
    expect((await route(item)).status).toBe(409);
  });
  test("blocks restricted review without server grant, ignores forged unlock, and allows valid grant", async () => {
    const item = await fixture("restricted");
    expect((await route(item)).status).toBe(423); unchanged(item);
    expect((await route(item, { ...item.input, restrictedUnlocked: true })).status).toBe(400); unchanged(item);
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2000-01-01T00:00:00Z" }); expect((await route(item)).status).toBe(423);
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00Z" }); expect((await route(item)).status).toBe(200);
    harness.getActiveRestrictedGrant.mockResolvedValue(null);
    const replay = await route(item); expect(replay.status).toBe(423); expect(JSON.stringify(await replay.json())).not.toContain("fragmentId");
  });
  test("refuses another owner and never accepts a fragment from another document/run", async () => {
    const item = await fixture(), other = await fixture();
    expect((await route(item, item.input, other.run.extractId)).status).toBe(404);
    await expect(new D1LinkPresentationRepository(db, "link-other").reviewFragment(item.capture.objectId, item.run.extractId, item.input)).rejects.toMatchObject({ code: "link_record_not_found" }); unchanged(item);
  });
  test.each(["privacy", "snapshot", "revision", "run", "state", "legacy"] as const)("rolls back atomically when %s changes between reads and batch", async (change) => {
    const item = await fixture();
    db.beforeBatch = () => {
      db.beforeBatch = null;
      if (change === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      if (change === "snapshot") db.sql.prepare("update v2_documents set current_link_snapshot_id=null where object_id=?").run(item.capture.objectId);
      if (change === "revision") db.sql.prepare("update v2_documents set current_revision_id=null where object_id=?").run(item.capture.objectId);
      if (change === "run") db.sql.prepare("update v2_documents set published_link_run_id=null where object_id=?").run(item.capture.objectId);
      if (change === "state") db.sql.prepare("update v2_link_fragments set state_version=2 where id=?").run(item.run.extractId);
      if (change === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:hidden' where id=?").run(item.capture.captureId);
    };
    const response = await route(item); expect([409, 423, 404]).toContain(response.status);
    expect(db.sql.prepare("select review_status,locked_by_user from v2_link_fragments where id=?").get(item.run.extractId)).toEqual({ review_status: "proposed", locked_by_user: 0 });
    expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.fragment_reviewed'").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) as n from v2_idempotency_records where operation='link_fragment.review.v1'").get()).toEqual({ n: 0 });
  });
  test("rechecks privacy during receipt replay and never returns an old receipt after new snapshot", async () => {
    const item = await fixture(); expect((await route(item)).status).toBe(200);
    db.afterRead = (query) => { if (!query.includes("select payload_hash,response_json")) return; db.afterRead = null;
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId); };
    expect((await route(item)).status).toBe(423);
    db.sql.prepare("update v2_documents set privacy_level='normal' where object_id=?").run(item.capture.objectId);
    await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId, expectedSnapshotId: item.projection!.snapshot.id,
      expectedSnapshotVersion: 1, sourceItemIds: item.projection!.members.map((m) => m.sourceItemId), idempotencyKey: "new-snapshot" });
    expect((await route(item)).status).toBe(409);
  });
  test("old confirmed run remains immutable when a rerun becomes current", async () => {
    const item = await fixture(); expect((await route(item)).status).toBe(200);
    await seedLinkRun(db, item, { id: "new-published-run" });
    expect((await route(item, { ...item.input, action: "reject", expectedStateVersion: 2, idempotencyKey: "old-reject" })).status).toBe(409);
    expect(db.sql.prepare("select review_status from v2_link_fragments where id=?").get(item.run.extractId)).toEqual({ review_status: "confirmed" });
  });
  test("never publishes or reviews a run whose input hash disagrees with its job", async () => {
    const item = await fixture();
    db.sql.prepare("update v2_processing_runs set input_hash='different-input' where id=?").run(item.run.id);
    expect(await new D1LinkPresentationRepository(db, "link-owner").project(item.capture.objectId)).toMatchObject({ publishedRun: null, selectedRun: null, fragments: [] });
    expect((await route(item)).status).toBe(404); unchanged(item);
  });
  test("preserves same-origin/authentication/feature gates and rejects unknown data rewrites", async () => {
    const item = await fixture(); expect((await route(item, { ...item.input, rawText: "overwrite" })).status).toBe(400);
    expect((await route(item, item.input, item.run.extractId, "https://attacker.test")).status).toBe(403);
    vi.stubEnv("FLAG_V2_WRITE", "0"); expect((await route(item)).status).toBe(503); vi.stubEnv("FLAG_V2_WRITE", "1");
    harness.getSession.mockResolvedValue(null); expect((await route(item)).status).toBe(401); unchanged(item);
  });
  test("direct callers default to locked and 0030 mutations fail closed", async () => {
    const item = await fixture("restricted");
    await expect(new D1LinkPresentationRepository(db, "link-owner").reviewFragment(item.capture.objectId, item.run.extractId, item.input)).rejects.toMatchObject({ code: "restricted_record_locked" });
    db.sql.close(); db = new LinkMemoryD1(30); harness.getV2CloudflareBindings.mockReturnValue({ db });
    expect((await route(item)).status).toBe(503);
  });
  test.each(["source", "fragment_hash", "evidence_range"] as const)("does not confirm corrupted %s through direct PATCH", async (corruption) => {
    const item = await fixture();
    if (corruption === "source") db.sql.prepare("update v2_source_items set raw_text='corrupted preserved text' where id=?").run(item.projection!.members[0].sourceItemId);
    if (corruption === "fragment_hash") {
      // Simulate an invalid restored/imported row, not an authorized mutation path.
      db.sql.exec("drop trigger trg_v2_link_fragment_immutable");
      db.sql.prepare("update v2_link_fragments set raw_text_hash=? where id=?").run("0".repeat(64), item.run.extractId);
    }
    if (corruption === "evidence_range") {
      db.sql.exec("drop trigger trg_v2_link_fragment_evidence_immutable");
      db.sql.prepare("update v2_link_fragment_evidence set text_end=999999 where fragment_id=?").run(item.run.extractId);
    }
    await expect(new D1LinkPresentationRepository(db, "link-owner").project(item.capture.objectId)).rejects.toMatchObject({ code: expect.stringMatching(/invalid|mismatch/) });
    expect((await route(item)).status).toBe(400); unchanged(item);
  });
  test("validates exact source integrity before idempotent receipt replay", async () => {
    const item = await fixture(); expect((await route(item)).status).toBe(200);
    db.sql.prepare("update v2_source_items set raw_text='changed after receipt' where id=?").run(item.projection!.members[0].sourceItemId);
    const replay = await route(item); expect(replay.status).toBe(400);
    expect(JSON.stringify(await replay.json())).not.toContain("fragmentId");
    expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.fragment_reviewed'").get()).toEqual({ n: 1 });
  });
  test("bounds total exact evidence payload for oversized imported overlapping spans on GET and PATCH", async () => {
    const seed = await linkFixture(db, { rawText: "x".repeat(100_000) }), run = await seedLinkRun(db, seed);
    const item = { ...seed, run, input: { action: "confirm", expectedRevisionId: seed.capture.revisionId, expectedSnapshotId: seed.projection!.snapshot.id,
      expectedRunId: run.id, expectedStateVersion: 1, idempotencyKey: "large-review" } as LinkFragmentReviewRequest };
    db.sql.prepare(`insert into v2_link_fragment_evidence(id,user_id,fragment_id,member_id,relation_kind,evidence_method,text_start,text_end,display_order,created_at)
      select 'extra-large-evidence',user_id,fragment_id,member_id,relation_kind,evidence_method,text_start,text_end,1,created_at from v2_link_fragment_evidence where fragment_id=?`).run(run.insightId);
    await expect(new D1LinkPresentationRepository(db, "link-owner").project(item.capture.objectId)).rejects.toMatchObject({ code: "link_fragment_integrity_invalid" });
    expect((await route(item)).status).toBe(400); unchanged(item);
  });
});
