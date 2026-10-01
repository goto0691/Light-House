import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/records/[recordId]/route";
import { D1SourceFoundationRepository, type V2RecordProjection, type V2RecordRecoveryPolicy } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
type RecordResponse = V2RecordProjection & { recoveryPolicy: V2RecordRecoveryPolicy; linkPresentation: LinkPresentationV1; presentation: unknown };
beforeEach(() => {
  db = new LinkSqlite();
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1");
  harness.session.mockResolvedValue({ sessionId: "recovery-policy-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null);
  harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function read(recordId: string) {
  return GET(new Request(`https://lighthouse.test/api/v2/records/${recordId}`), { params: Promise.resolve({ recordId }) });
}

async function assertError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
}

function hideOrphan(captureId: string) {
  db.sql.prepare("update v2_capture_bundles set draft_id=? where id=?").run(`legacy:unattached:${captureId}`, captureId);
}

function addMapping(recordId: string, status: string) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.sql.prepare(`insert into v2_legacy_source_envelopes
    (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,import_batch_id)
    values (?,'link-owner','posts',?,'{}',?,?,'{}','synthetic-import')`).run(id, id, id, now);
  db.sql.prepare(`insert into v2_legacy_source_mappings
    (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,projected_object_id,projection_kind,status,created_at)
    values (?,'link-owner',?,'posts',?,'synthetic.v1',?,'document',?,?)`).run(id, id, id, recordId, status, now);
}

/** The hook mutates the real SQL database; repository result rows are never mocked.
 * before_policy is after both content projections, proving the final route fence.
 */
function atReadBoundary(point: "after_record" | "before_policy", mutate: () => void) {
  let fired = false;
  const wrapped: D1DatabaseBinding = {
    prepare(query) {
      let actual = db.prepare(query);
      const statement: D1PreparedStatementBinding = {
        bind(...values) { actual = actual.bind(...values); return statement; },
        async first<T>() {
          if (!fired && point === "before_policy" && query.includes("o.id as record_id,d.current_version,d.privacy_level")) { fired = true; mutate(); }
          const row = await actual.first<T>();
          if (!fired && point === "after_record" && query.includes("o.id as record_id,o.lifecycle_status")) { fired = true; mutate(); }
          return row;
        },
        all: <T>() => actual.all<T>(),
        run: () => actual.run(),
      };
      return statement;
    },
    batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements),
  };
  harness.bindings.mockReturnValue({ db: wrapped });
  return () => expect(fired).toBe(true);
}

test.each(["normal", "sensitive", "restricted"] as const)("owner recovery policy exposes only its three allowed non-content fields: %s", async (privacyLevel) => {
  const fixture = await seedLinkRecord(db, { privacyLevel: privacyLevel === "sensitive" ? "normal" : privacyLevel });
  if (privacyLevel === "sensitive") db.sql.prepare("update v2_documents set privacy_level=? where object_id=?").run(privacyLevel, fixture.capture.objectId);
  const repo = new D1SourceFoundationRepository(db, "link-owner");
  expect(await repo.getRecoveryPolicy(fixture.capture.objectId)).toEqual({ recordId: fixture.capture.objectId, currentVersion: 1, privacyLevel });
});

test("policy denies another owner and a missing record, including known valid record IDs", async () => {
  const fixture = await seedLinkRecord(db);
  expect(await new D1SourceFoundationRepository(db, "other-owner").getRecoveryPolicy(fixture.capture.objectId)).toBeNull();
  expect(await new D1SourceFoundationRepository(db, "link-owner").getRecoveryPolicy("missing")).toBeNull();
  harness.session.mockResolvedValue({ sessionId: "foreign", userId: "other-owner", email: "foreign@example.test", expiresAt: Date.now() + 60_000 });
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test.each(["capture_owner", "revision_document"] as const)("policy and GET fail closed for broken %s identity", async (identity) => {
  const fixture = await seedLinkRecord(db);
  if (identity === "capture_owner") {
    db.sql.prepare("update v2_capture_bundles set user_id='other-owner' where id=?").run(fixture.capture.captureId);
  } else {
    const other = await seedLinkRecord(db);
    db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(other.capture.revisionId, fixture.capture.objectId);
  }
  expect(await new D1SourceFoundationRepository(db, "link-owner").getRecoveryPolicy(fixture.capture.objectId)).toBeNull();
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test.each(["unattached", "pending", "future-status"])("policy and actual GET hide legacy projection %s", async (status) => {
  const fixture = await seedLinkRecord(db);
  hideOrphan(fixture.capture.captureId);
  if (status !== "unattached") addMapping(fixture.capture.objectId, status);
  expect(await new D1SourceFoundationRepository(db, "link-owner").getRecoveryPolicy(fixture.capture.objectId)).toBeNull();
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test("a projected legacy record is visible but one non-projected mapping hides it again", async () => {
  const fixture = await seedLinkRecord(db);
  hideOrphan(fixture.capture.captureId); addMapping(fixture.capture.objectId, "projected");
  expect((await read(fixture.capture.objectId)).status).toBe(200);
  addMapping(fixture.capture.objectId, "pending");
  expect(await new D1SourceFoundationRepository(db, "link-owner").getRecoveryPolicy(fixture.capture.objectId)).toBeNull();
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test("normal GET preserves the actual body and exact source while adding a minimal recovery policy", async () => {
  const fixture = await seedLinkRecord(db);
  const response = await read(fixture.capture.objectId);
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const payload = await response.json() as RecordResponse;
  expect(payload).toMatchObject({ title: "Synthetic link", bodyMarkdown: "PRIVATE MEMO", locked: false, currentRevisionId: fixture.capture.revisionId,
    currentVersion: 1, recoveryPolicy: { recordId: fixture.capture.objectId, privacyLevel: "normal", currentVersion: 1 } });
  expect(payload.sources.some((source) => source.rawText === fixture.rawText)).toBe(true);
  expect(payload.linkPresentation.members[0].rawText).toBe(fixture.rawText);
  expect(Object.keys(payload.recoveryPolicy).sort()).toEqual(["currentVersion", "privacyLevel", "recordId"]);
});

test.each(["missing", "expired", "active"])("restricted GET with %s grant keeps policy separate from content visibility", async (grant) => {
  const fixture = await seedLinkRecord(db, { privacyLevel: "restricted" });
  if (grant !== "missing") harness.grant.mockResolvedValue({ expiresAt: new Date(Date.now() + (grant === "active" ? 60_000 : -60_000)).toISOString() });
  const response = await read(fixture.capture.objectId);
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const payload = await response.json() as RecordResponse;
  expect(payload.recoveryPolicy).toEqual({ recordId: fixture.capture.objectId, currentVersion: 1, privacyLevel: "restricted" });
  if (grant === "active") {
    expect(payload).toMatchObject({ bodyMarkdown: "PRIVATE MEMO", currentVersion: 1, currentRevisionId: fixture.capture.revisionId, locked: false });
    expect(payload.linkPresentation.members[0].rawText).toBe(fixture.rawText);
  } else {
    expect(payload).toMatchObject({ title: null, bodyMarkdown: null, currentRevisionId: null, currentVersion: null,
      writtenAt: null, documentStatus: null, locked: true, sources: [] });
    expect(payload.presentation).toMatchObject({ highlights: [], sections: [], connections: [], modules: [], reviewItems: [] });
    expect(payload.linkPresentation).toMatchObject({ members: [], availableSources: [], fragments: [], currentRevisionId: null, selectedSnapshot: null });
    const serialized = JSON.stringify(payload);
    for (const secret of ["PRIVATE MEMO", "Synthetic link", fixture.rawText, fixture.capture.revisionId]) expect(serialized).not.toContain(secret);
  }
});

test.each(["after_record", "before_policy"] as const)("final policy rejects privacy/version/owner/legacy mutations at %s", async (point) => {
  for (const mutation of ["privacy", "version", "owner", "legacy"] as const) {
    const fixture = await seedLinkRecord(db);
    const assertFired = atReadBoundary(point, () => {
      if (mutation === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(fixture.capture.objectId);
      if (mutation === "version") db.sql.prepare("update v2_documents set current_version=current_version+1 where object_id=?").run(fixture.capture.objectId);
      if (mutation === "owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(fixture.capture.objectId);
      if (mutation === "legacy") hideOrphan(fixture.capture.captureId);
    });
    await assertError(await read(fixture.capture.objectId), mutation === "owner" || mutation === "legacy" ? 404 : 409,
      mutation === "owner" || mutation === "legacy" ? "record_not_found" : "record_changed_during_read");
    assertFired();
  }
});

test("locked content stays redacted when only the recovery version advances during the read", async () => {
  const fixture = await seedLinkRecord(db, { privacyLevel: "restricted" });
  const assertFired = atReadBoundary("before_policy", () => db.sql.prepare("update v2_documents set current_version=current_version+1 where object_id=?").run(fixture.capture.objectId));
  const response = await read(fixture.capture.objectId);
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ locked: true, bodyMarkdown: null, currentVersion: null, sources: [],
    recoveryPolicy: { recordId: fixture.capture.objectId, currentVersion: 2, privacyLevel: "restricted" } });
  assertFired();
});

test("a restricted-to-normal privacy race rejects the previously redacted response", async () => {
  const fixture = await seedLinkRecord(db, { privacyLevel: "restricted" });
  const assertFired = atReadBoundary("before_policy", () => db.sql.prepare("update v2_documents set privacy_level='normal' where object_id=?").run(fixture.capture.objectId));
  await assertError(await read(fixture.capture.objectId), 409, "record_changed_during_read");
  assertFired();
});

test("authentication and internal policy-read failures also return private no-store without content", async () => {
  const fixture = await seedLinkRecord(db);
  harness.session.mockResolvedValueOnce(null);
  await assertError(await read(fixture.capture.objectId), 401, "authentication_required");
  const assertFired = atReadBoundary("before_policy", () => { throw new Error("Synthetic policy read failed with PRIVATE MEMO"); });
  await assertError(await read(fixture.capture.objectId), 500, "internal_error");
  assertFired();
});

test.each(["after_record", "before_policy"] as const)("an unlock grant expiring at %s cannot expose previously projected content", async (point) => {
  const fixture = await seedLinkRecord(db, { privacyLevel: "restricted" });
  const startedAt = Date.now(), expiresAt = startedAt + 10_000;
  harness.grant.mockResolvedValue({ expiresAt: new Date(expiresAt).toISOString() });
  const now = vi.spyOn(Date, "now").mockReturnValue(startedAt);
  const assertFired = atReadBoundary(point, () => { now.mockReturnValue(expiresAt + 1); });
  const response = await read(fixture.capture.objectId);
  await assertError(response, 423, "restricted_record_locked");
  assertFired();
});
