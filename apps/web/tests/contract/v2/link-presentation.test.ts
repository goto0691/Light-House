import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ getSession: vi.fn(), getActiveRestrictedGrant: vi.fn(), getV2CloudflareBindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.getSession }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.getActiveRestrictedGrant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.getV2CloudflareBindings }));

import { GET } from "@/app/api/v2/records/[recordId]/links/route";
import { unavailableLinkPresentation, type LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { exactLinkText, linkFixture, LinkMemoryD1, seedLinkRun } from "./link-presentation-fixture";

let db: LinkMemoryD1;
beforeEach(() => {
  db = new LinkMemoryD1();
  for (const flag of ["FLAG_V2_ROUTES", "FLAG_V2_WRITE", "FLAG_V2_AI"]) vi.stubEnv(flag, "1");
  harness.getSession.mockResolvedValue({ sessionId: "session", userId: "link-owner", email: "synthetic@example.test", expiresAt: Date.now() + 100_000 });
  harness.getActiveRestrictedGrant.mockResolvedValue(null); harness.getV2CloudflareBindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
const repository = () => new D1LinkPresentationRepository(db, "link-owner");
function route(recordId: string, query = "") {
  return GET(new Request(`https://lighthouse.test/api/v2/records/${recordId}/links${query}`), { params: Promise.resolve({ recordId }) });
}
async function readLinks(response: Response) { return (await response.json() as { links: LinkPresentationV1 }).links; }

describe("link presentation current and history read boundaries", () => {
  test("projects exact external sources, whitelisted metadata and proposed evidence without memo or GET writes", async () => {
    const fixture = await linkFixture(db), attempt = await seedLinkRun(db, fixture);
    const before = db.sql.prepare("select count(*) as n from v2_change_events").get();
    const response = await route(fixture.capture.objectId);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const links = await readLinks(response);
    expect(links.members).toHaveLength(1); expect(links.availableSources).toHaveLength(1);
    expect(links.members[0].rawText).toBe(exactLinkText);
    expect(links.fragments[0]).toMatchObject({ rawText: exactLinkText, sourceClass: "source_extract", reviewStatus: "proposed", evidence: [{ quote: exactLinkText }] });
    expect(links.fragments[1]).toMatchObject({ rawText: null, sourceClass: "ai_interpretation", reviewStatus: "proposed" });
    expect(links.selectedRun).toMatchObject({ id: attempt.id, isPublished: true });
    expect(links.capabilities).toMatchObject({ canCreateSnapshot: true, canAnalyze: true, canReview: true, canCreateManualFragment: true });
    expect(JSON.stringify(links)).not.toContain("PERSONAL MEMO"); expect(JSON.stringify(links)).not.toContain("DO NOT PROJECT");
    expect(db.sql.prepare("select count(*) as n from v2_change_events").get()).toEqual(before);
  });
  test("does not bootstrap, enqueue or expose an implicit legacy URL on GET", async () => {
    const fixture = await linkFixture(db, { snapshot: false });
    db.sql.prepare(`insert into v2_source_items(id,user_id,capture_id,item_kind,display_order,raw_text,content_hash,created_at)
      values ('legacy-url','link-owner',?,'url',99,'https://example.test/legacy','legacy-hash',?)`).run(fixture.capture.captureId, "2026-09-08T00:00:00Z");
    db.sql.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,'legacy-url','identifier',99,?)")
      .run(fixture.capture.objectId, "2026-09-08T00:00:00Z");
    const response = await route(fixture.capture.objectId);
    const links = await readLinks(response);
    expect(links).toMatchObject({ selectedSnapshot: null, selectedRun: null, fragments: [], capabilities: { canAnalyze: false, canCreateSnapshot: true, canCreateManualFragment: false } });
    expect(links.availableSources.map((item) => item.sourceItemId)).not.toContain("legacy-url");
    expect(db.sql.prepare("select count(*) as n from v2_link_snapshots").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) as n from v2_processing_jobs").get()).toEqual({ n: 0 });
  });
  test("lists only owned committed attachments in original source order without exposing storage keys", async () => {
    const fixture = await linkFixture(db), hash = "a".repeat(64), now = "2026-09-08T00:00:00Z";
    for (const [id, order, status] of [["committed-image", 88, "committed"], ["uncommitted-image", 89, "verified"]] as const) {
      db.sql.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at)
        values (?,'link-owner','verified',?,?,'image/png',8,?,?,?)`).run(id, `PRIVATE-R2-KEY-${id}`, `${id}.png`, hash, now, now);
      db.sql.prepare("insert into v2_source_items(id,user_id,capture_id,item_kind,display_order,content_hash,created_at) values (?,'link-owner',?,'image',?,?,?)")
        .run(`${id}-source`, fixture.capture.captureId, order, `sha256:${hash}`, now);
      db.sql.prepare("insert into v2_source_attachment_links(user_id,source_item_id,attachment_id,created_at) values ('link-owner',?,?,?)").run(`${id}-source`, id, now);
      db.sql.prepare("update v2_attachment_reservations set status=? where id=?").run(status, id);
      db.sql.prepare("insert into v2_document_source_links(document_object_id,source_item_id,role,source_order,created_at) values (?,?,'illustration',?,?)")
        .run(fixture.capture.objectId, `${id}-source`, order, now);
    }
    const links = (await repository().project(fixture.capture.objectId))!;
    expect(links.availableSources.map((item) => item.sourceItemId)).toEqual([fixture.projection!.members[0].sourceItemId, "committed-image-source"]);
    expect(links.availableSources[1].attachments[0]).toMatchObject({ id: "committed-image", mimeType: "image/png", sizeBytes: 8 });
    expect(JSON.stringify(links)).not.toContain("PRIVATE-R2-KEY");
  });
  test("treats rerun outputs separately and keeps previously confirmed fragments selectable read-only", async () => {
    const fixture = await linkFixture(db), old = await seedLinkRun(db, fixture, { id: "run-old" });
    db.sql.prepare("update v2_link_fragments set review_status='confirmed',locked_by_user=1,state_version=2 where id=?").run(old.extractId);
    const current = await seedLinkRun(db, fixture, { id: "run-new", createdAt: "2026-09-08T00:01:00.000Z" });
    const fresh = await repository().project(fixture.capture.objectId, { writeEnabled: true, aiEnabled: true });
    expect(fresh?.selectedRun?.id).toBe(current.id); expect(fresh?.runHistory.items).toHaveLength(2);
    const history = await repository().project(fixture.capture.objectId, { runId: old.id, writeEnabled: true, aiEnabled: true });
    expect(history).toMatchObject({ isHistorical: true, capabilities: { canAnalyze: false, canReview: false, canCreateSnapshot: false } });
    expect(history?.fragments[0].reviewStatus).toBe("confirmed"); expect(history?.publishedRun?.id).toBe(current.id);
  });
  test("new source version keeps old sources and runs available only in history", async () => {
    const fixture = await linkFixture(db), old = await seedLinkRun(db, fixture);
    const newer = await fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId, expectedRevisionId: fixture.capture.revisionId,
      expectedSnapshotId: fixture.projection!.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: fixture.projection!.members.map((m) => m.sourceItemId), idempotencyKey: "next" });
    expect(await repository().project(fixture.capture.objectId)).toMatchObject({ currentSnapshotId: newer.snapshot.id, selectedRun: null, fragments: [], publishedRun: null });
    const history = await repository().project(fixture.capture.objectId, { snapshotId: fixture.projection!.snapshot.id, runId: old.id, writeEnabled: true });
    expect(history).toMatchObject({ isHistorical: true, selectedRun: { id: old.id }, capabilities: { canReview: false } });
    expect(history?.fragments[0].rawText).toBe(exactLinkText);
  });
  test("body revision changes never present stale published pointer as current analysis", async () => {
    const fixture = await linkFixture(db), old = await seedLinkRun(db, fixture);
    db.sql.prepare(`insert into v2_document_revisions(id,document_object_id,parent_revision_id,revision_number,body_markdown,content_hash,author_kind,change_reason,created_at)
      select 'revision-new',document_object_id,id,revision_number+1,body_markdown||'changed','new-content-hash',author_kind,change_reason,created_at from v2_document_revisions where id=?`).run(fixture.capture.revisionId);
    db.sql.prepare("update v2_documents set current_revision_id='revision-new' where object_id=?").run(fixture.capture.objectId);
    expect(await repository().project(fixture.capture.objectId)).toMatchObject({ currentRevisionId: "revision-new", publishedRun: null, selectedRun: null, fragments: [] });
    expect(await repository().project(fixture.capture.objectId, { runId: old.id, writeEnabled: true })).toMatchObject({ isHistorical: true, selectedRun: { id: old.id }, capabilities: { canReview: false } });
  });
  test("paginates both histories with explicit scoped cursors and no hidden truncation", async () => {
    const fixture = await linkFixture(db);
    for (let index = 0; index < 21; index++) await seedLinkRun(db, fixture, { id: `page-run-${String(index).padStart(2, "0")}` });
    let projection = fixture.projection!;
    for (let index = 1; index < 21; index++) projection = await fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId,
      expectedRevisionId: fixture.capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedSnapshotVersion: index,
      sourceItemIds: projection.members.map((member) => member.sourceItemId), idempotencyKey: `page-${index}` });
    const first = (await repository().project(fixture.capture.objectId, { snapshotId: fixture.projection!.snapshot.id }))!;
    expect(first.snapshotHistory.items).toHaveLength(20); expect(first.runHistory.items).toHaveLength(20);
    expect(first.snapshotHistory.nextCursor).toBeTruthy(); expect(first.runHistory.nextCursor).toBeTruthy();
    const second = (await repository().project(fixture.capture.objectId, { snapshotId: fixture.projection!.snapshot.id,
      snapshotCursor: first.snapshotHistory.nextCursor!, runCursor: first.runHistory.nextCursor! }))!;
    expect(second.snapshotHistory.items).toHaveLength(1); expect(second.runHistory.items).toHaveLength(1);
    expect(second.snapshotHistory.nextCursor).toBeNull(); expect(second.runHistory.nextCursor).toBeNull();
    expect(second.selectedRun?.id).toBe(first.selectedRun?.id);
    await expect(repository().project(fixture.capture.objectId, { runCursor: first.runHistory.nextCursor! })).rejects.toMatchObject({ code: "link_history_cursor_invalid" });
  });
  test("redacts locked records including IDs and allows manual review but never AI with server grant", async () => {
    const fixture = await linkFixture(db, { privacy: "restricted" }); await seedLinkRun(db, fixture);
    const locked = await route(fixture.capture.objectId);
    expect(await readLinks(locked)).toMatchObject({ currentRevisionId: null, currentSnapshotId: null, members: [], availableSources: [], fragments: [], capabilities: { reason: "restricted_record_locked" } });
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00Z" });
    const unlocked = await readLinks(await route(fixture.capture.objectId));
    expect(unlocked.members).toHaveLength(1); expect(unlocked.capabilities).toMatchObject({ canCreateSnapshot: true, canAnalyze: false, canReview: true, reason: "restricted_ai_forbidden" });
  });
  test("returns no foreign-owner, deleted or unprojected legacy record", async () => {
    const fixture = await linkFixture(db);
    expect(await new D1LinkPresentationRepository(db, "link-other").project(fixture.capture.objectId)).toBeNull();
    db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(fixture.capture.objectId);
    expect((await route(fixture.capture.objectId)).status).toBe(404);
    db.sql.prepare("update v2_objects set lifecycle_status='active' where id=?").run(fixture.capture.objectId);
    db.sql.prepare("update v2_capture_bundles set draft_id='legacy:hidden' where id=?").run(fixture.capture.captureId);
    expect(await repository().project(fixture.capture.objectId)).toBeNull();
  });
  test("rechecks privacy after source reads and current pointer after history reads", async () => {
    const fixture = await linkFixture(db); await seedLinkRun(db, fixture);
    db.afterRead = (query) => { if (!query.includes("from v2_link_fragment_evidence")) return; db.afterRead = null;
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId); };
    expect(await repository().project(fixture.capture.objectId)).toMatchObject({ members: [], fragments: [], currentRevisionId: null });
    db.sql.prepare("update v2_documents set privacy_level='normal' where object_id=?").run(fixture.capture.objectId);
    db.afterRead = (query) => { if (!query.includes("from v2_link_fragment_evidence")) return; db.afterRead = null;
      db.sql.prepare("update v2_documents set published_link_run_id=null where object_id=?").run(fixture.capture.objectId); };
    await expect(repository().project(fixture.capture.objectId)).rejects.toMatchObject({ code: "link_projection_conflict" });
  });
  test("rejects a selected analysis whose run status changes during projection", async () => {
    const fixture = await linkFixture(db), attempt = await seedLinkRun(db, fixture);
    db.afterRead = (query) => { if (!query.includes("from v2_link_fragment_evidence")) return; db.afterRead = null;
      db.sql.prepare("update v2_processing_runs set status='superseded' where id=?").run(attempt.id); };
    await expect(repository().project(fixture.capture.objectId)).rejects.toMatchObject({ code: "link_projection_conflict" });
  });
  test("gracefully supports 0030 without GET bootstrap and preserves known-failure fallback semantics", async () => {
    db.sql.close(); db = new LinkMemoryD1(30); harness.getV2CloudflareBindings.mockReturnValue({ db });
    const fixture = await linkFixture(db, { snapshot: false });
    const response = await route(fixture.capture.objectId), links = await readLinks(response);
    expect(response.status).toBe(200); expect(links.schemaAvailable).toBe(false); expect(links.availableSources).toHaveLength(1);
    expect(links.capabilities.canCreateSnapshot).toBe(false);
    expect(unavailableLinkPresentation("r", "link_projection_conflict")).toMatchObject({ schemaAvailable: true, unavailableReason: "link_projection_conflict", fragments: [], capabilities: { canReview: false } });
  });
  test("does not enable actions by default and preserves HTTP authentication/query guards", async () => {
    const fixture = await linkFixture(db);
    expect((await repository().project(fixture.capture.objectId))?.capabilities).toMatchObject({ canCreateSnapshot: false, canCreateManualFragment: false });
    expect((await route(fixture.capture.objectId, "?restrictedUnlocked=1")).status).toBe(400);
    expect((await route(fixture.capture.objectId, "?runId=missing")).status).toBe(404);
    harness.getSession.mockResolvedValue(null);
    const response = await route(fixture.capture.objectId); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("manual fragment capability is scoped to the current source snapshot, not the selected AI run", () => {
  test.each([
    { write: true, ai: true }, { write: true, ai: false },
    { write: false, ai: true }, { write: false, ai: false },
  ])("keeps historical run access separate with write=$write and ai=$ai", async ({ write, ai }) => {
    const fixture = await linkFixture(db), old = await seedLinkRun(db, fixture, { id: "capability-old" });
    const current = await seedLinkRun(db, fixture, { id: "capability-current", createdAt: "2026-09-08T00:01:00.000Z" });
    vi.stubEnv("FLAG_V2_WRITE", write ? "1" : "0"); vi.stubEnv("FLAG_V2_AI", ai ? "1" : "0");
    const before = db.sql.prepare("select count(*) as n from v2_change_events").get();
    const response = await route(fixture.capture.objectId, `?runId=${old.id}`);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const links = await readLinks(response);
    expect(links).toMatchObject({
      currentSnapshotId: fixture.projection!.snapshot.id, selectedSnapshot: { id: fixture.projection!.snapshot.id },
      selectedRun: { id: old.id, isPublished: false }, publishedRun: { id: current.id }, isHistorical: true,
      capabilities: { canCreateManualFragment: write, canCreateSnapshot: false, canAnalyze: false, canReview: false },
    });
    expect(links.members[0].rawText).toBe(exactLinkText);
    expect(db.sql.prepare("select count(*) as n from v2_change_events").get()).toEqual(before);
  });

  test.each([false, true])("does not allow manual creation on a historical snapshot with explicit run=%s", async (selectRun) => {
    const fixture = await linkFixture(db), old = await seedLinkRun(db, fixture, { id: "past-snapshot-run" });
    const previous = fixture.projection!;
    const current = await fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId, expectedRevisionId: fixture.capture.revisionId,
      expectedSnapshotId: previous.snapshot.id, expectedSnapshotVersion: 1, sourceItemIds: previous.members.map((member) => member.sourceItemId),
      idempotencyKey: "capability-next-snapshot" });
    const currentResponse = await route(fixture.capture.objectId);
    expect(currentResponse.status).toBe(200);
    expect(await readLinks(currentResponse)).toMatchObject({ selectedSnapshot: { id: current.snapshot.id }, selectedRun: null,
      capabilities: { canCreateManualFragment: true } });
    const response = await route(fixture.capture.objectId, `?snapshotId=${previous.snapshot.id}${selectRun ? `&runId=${old.id}` : ""}`);
    expect(response.status).toBe(200);
    const links = await readLinks(response);
    expect(links).toMatchObject({ currentSnapshotId: current.snapshot.id, selectedSnapshot: { id: previous.snapshot.id }, isHistorical: true,
      capabilities: { canCreateManualFragment: false, canCreateSnapshot: false, canAnalyze: false, canReview: false } });
    expect(links.members[0].rawText).toBe(exactLinkText);
  });

  test.each([false, true])("requires a live server grant for restricted manual creation with historical run=%s", async (selectOldRun) => {
    const fixture = await linkFixture(db, { privacy: "restricted" });
    const old = await seedLinkRun(db, fixture, { id: "restricted-old" });
    const current = await seedLinkRun(db, fixture, { id: "restricted-current", createdAt: "2026-09-08T00:01:00.000Z" });
    const query = selectOldRun ? `?runId=${old.id}` : "";
    const lockedResponse = await route(fixture.capture.objectId, query);
    expect(lockedResponse.status).toBe(200);
    const locked = await readLinks(lockedResponse);
    expect(locked).toMatchObject({ currentRevisionId: null, currentSnapshotId: null, selectedSnapshot: null, members: [], availableSources: [],
      fragments: [], selectedRun: null, capabilities: { reason: "restricted_record_locked" } });
    // The optional DTO capability is fail-closed when absent on a redacted response.
    expect(Boolean(locked.capabilities.canCreateManualFragment)).toBe(false);
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00Z" });
    const unlockedResponse = await route(fixture.capture.objectId, query);
    expect(unlockedResponse.status).toBe(200);
    const unlocked = await readLinks(unlockedResponse);
    expect(unlocked).toMatchObject({ currentSnapshotId: fixture.projection!.snapshot.id, selectedSnapshot: { id: fixture.projection!.snapshot.id },
      selectedRun: { id: selectOldRun ? old.id : current.id }, isHistorical: selectOldRun,
      capabilities: { canCreateManualFragment: true, canAnalyze: false } });
    expect(unlocked.members[0].rawText).toBe(exactLinkText);
    vi.stubEnv("FLAG_V2_WRITE", "0");
    const readOnlyResponse = await route(fixture.capture.objectId, query);
    expect(readOnlyResponse.status).toBe(200);
    expect((await readLinks(readOnlyResponse)).capabilities.canCreateManualFragment).toBe(false);
    vi.stubEnv("FLAG_V2_WRITE", "1");
    harness.getActiveRestrictedGrant.mockResolvedValue({ expiresAt: "2000-01-01T00:00:00Z" });
    const expiredResponse = await route(fixture.capture.objectId, query);
    expect(expiredResponse.status).toBe(200);
    const expired = await readLinks(expiredResponse);
    expect(expired).toMatchObject({ members: [], currentSnapshotId: null, capabilities: { reason: "restricted_record_locked" } });
    expect(Boolean(expired.capabilities.canCreateManualFragment)).toBe(false);
  });

  test("withdraws manual capability when the record becomes restricted during source projection", async () => {
    const fixture = await linkFixture(db); await seedLinkRun(db, fixture);
    let tightenedPrivacy = false;
    db.afterRead = (query) => {
      if (!query.includes("from v2_link_fragment_evidence")) return;
      db.afterRead = null; tightenedPrivacy = true;
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
    };
    const response = await route(fixture.capture.objectId);
    expect(response.status).toBe(200); expect(tightenedPrivacy).toBe(true);
    const links = await readLinks(response);
    expect(links).toMatchObject({ currentRevisionId: null, currentSnapshotId: null, selectedSnapshot: null, members: [], availableSources: [],
      fragments: [], capabilities: { reason: "restricted_record_locked" } });
    expect(Boolean(links.capabilities.canCreateManualFragment)).toBe(false);
  });
});
