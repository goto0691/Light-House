import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/records/[recordId]/recovery-policy/route";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
type Privacy = "normal" | "sensitive" | "restricted";
type Fixture = Awaited<ReturnType<typeof seedLinkRecord>>;
const ownerId = "link-owner";
const sourceText = "  PRIVATE SOURCE 👀\r\n--ar 3:2\n";

beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1");
  vi.stubEnv("FLAG_V2_WRITE", "1");
  vi.stubEnv("FLAG_V2_AI", "1");
  harness.session.mockResolvedValue({ sessionId: "link-policy-session", userId: ownerId, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null);
  harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

async function seed(privacyLevel: Privacy = "normal") {
  const fixture = await seedLinkRecord(db, { rawText: sourceText, snapshot: false, privacyLevel: privacyLevel === "sensitive" ? "normal" : privacyLevel });
  if (privacyLevel === "sensitive") db.sql.prepare("update v2_documents set privacy_level='sensitive' where object_id=?").run(fixture.capture.objectId);
  return fixture;
}

function read(recordId: string) {
  return GET(new Request(`https://lighthouse.test/api/v2/records/${encodeURIComponent(recordId)}/recovery-policy`), { params: Promise.resolve({ recordId }) });
}

async function assertPolicy(response: Response, fixture: Fixture, privacyLevel: Privacy, contentReadable: boolean, currentVersion = 1) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const payload: unknown = await response.json();
  // Equality, not a subset match: an unlocked response must also contain no content fields.
  expect(payload).toEqual({ recoveryPolicy: { ownerId, recordId: fixture.capture.objectId, currentVersion, privacyLevel }, contentReadable });
  const serialized = JSON.stringify(payload);
  for (const secret of ["PRIVATE MEMO", "PRIVATE SOURCE", "Synthetic link", "https://example.test/source", fixture.capture.captureId, fixture.capture.revisionId]) expect(serialized).not.toContain(secret);
}

async function assertError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const payload: unknown = await response.json();
  expect(payload).toEqual({ error: { code, message: expect.any(String) } });
  const serialized = JSON.stringify(payload);
  for (const secret of ["PRIVATE MEMO", "PRIVATE SOURCE", "Synthetic link", "https://example.test/source"]) expect(serialized).not.toContain(secret);
  return payload;
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

/** Read-boundary hooks still execute the real repository query and return its real row. */
function atPolicyRead(point: "before" | "after", action: () => void) {
  let fired = false;
  const wrapped: D1DatabaseBinding = {
    prepare(query) {
      let actual = db.prepare(query);
      const statement: D1PreparedStatementBinding = {
        bind(...values) { actual = actual.bind(...values); return statement; },
        async first<T>() {
          const matches = query.includes("o.id as record_id,d.current_version,d.privacy_level");
          if (matches && !fired && point === "before") { fired = true; action(); }
          const row = await actual.first<T>();
          if (matches && !fired && point === "after") { fired = true; action(); }
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

test.each(["normal", "sensitive"] as const)("%s returns only owner-scoped policy metadata without a grant", async (privacyLevel) => {
  const fixture = await seed(privacyLevel);
  await assertPolicy(await read(fixture.capture.objectId), fixture, privacyLevel, true);
  expect(harness.grant).toHaveBeenCalledWith(db, { userId: ownerId, sessionId: "link-policy-session" });
});

test.each(["missing", "expired", "invalid", "active", "exact-expiry"] as const)("restricted %s grant exposes policy but never source/body", async (grant) => {
  const fixture = await seed("restricted");
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  if (grant !== "missing") harness.grant.mockResolvedValue({ expiresAt: grant === "invalid" ? "invalid-date" : new Date(now + (grant === "active" ? 60_000 : grant === "exact-expiry" ? 0 : -60_000)).toISOString() });
  await assertPolicy(await read(fixture.capture.objectId), fixture, "restricted", grant === "active");
});

test("a grant expiring after the real policy query is not marked content-readable", async () => {
  const fixture = await seed("restricted");
  const startedAt = Date.now(), expiresAt = startedAt + 10_000;
  const now = vi.spyOn(Date, "now").mockReturnValue(startedAt);
  harness.grant.mockResolvedValue({ expiresAt: new Date(expiresAt).toISOString() });
  const assertFired = atPolicyRead("after", () => { now.mockReturnValue(expiresAt); });
  await assertPolicy(await read(fixture.capture.objectId), fixture, "restricted", false);
  assertFired();
});

test.each(["normal", "sensitive", "restricted"] as const)("write and AI flags do not disable %s local-copy protection metadata", async (privacyLevel) => {
  const fixture = await seed(privacyLevel);
  vi.stubEnv("FLAG_V2_WRITE", "0"); vi.stubEnv("FLAG_V2_AI", "0");
  await assertPolicy(await read(fixture.capture.objectId), fixture, privacyLevel, privacyLevel !== "restricted");
});

test.each(["normal", "sensitive", "restricted"] as const)("latest %s privacy/version is read from SQL rather than session metadata", async (privacyLevel) => {
  const fixture = await seed();
  const assertFired = atPolicyRead("before", () => db.sql.prepare("update v2_documents set current_version=7,privacy_level=? where object_id=?").run(privacyLevel, fixture.capture.objectId));
  await assertPolicy(await read(fixture.capture.objectId), fixture, privacyLevel, privacyLevel !== "restricted", 7);
  assertFired();
});

test("foreign owner and missing record have indistinguishable metadata-only 404 responses", async () => {
  const fixture = await seed("restricted");
  harness.session.mockResolvedValue({ sessionId: "foreign", userId: "other-owner", email: "foreign@example.test", expiresAt: Date.now() + 60_000 });
  const foreign = await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
  const missing = await assertError(await read("missing-record"), 404, "record_not_found");
  expect(foreign).toEqual(missing);
  expect(JSON.stringify(foreign)).not.toContain(fixture.capture.objectId);
});

test("anonymous requests are denied before resolving grants or database bindings", async () => {
  harness.session.mockResolvedValue(null);
  await assertError(await read("known-record"), 401, "authentication_required");
  expect(harness.grant).not.toHaveBeenCalled();
  expect(harness.bindings).not.toHaveBeenCalled();
});

test("disabled V2 route fails closed without reading session or database", async () => {
  vi.stubEnv("FLAG_V2_ROUTES", "0");
  await assertError(await read("known-record"), 404, "v2_routes_disabled");
  expect(harness.session).not.toHaveBeenCalled();
  expect(harness.bindings).not.toHaveBeenCalled();
});

test.each(["capture_owner", "revision_document"] as const)("an inconsistent %s relation does not reveal even the privacy policy", async (identity) => {
  const fixture = await seed();
  if (identity === "capture_owner") db.sql.prepare("update v2_capture_bundles set user_id='other-owner' where id=?").run(fixture.capture.captureId);
  else {
    const other = await seed();
    db.sql.prepare("update v2_documents set current_revision_id=? where object_id=?").run(other.capture.revisionId, fixture.capture.objectId);
  }
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test.each(["unattached", "pending", "future-status"])("legacy %s projections remain invisible to metadata-only GET", async (status) => {
  const fixture = await seed();
  hideOrphan(fixture.capture.captureId);
  if (status !== "unattached") addMapping(fixture.capture.objectId, status);
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test("legacy projected visibility is revoked by any pending mapping", async () => {
  const fixture = await seed();
  hideOrphan(fixture.capture.captureId); addMapping(fixture.capture.objectId, "projected");
  await assertPolicy(await read(fixture.capture.objectId), fixture, "normal", true);
  addMapping(fixture.capture.objectId, "pending");
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
});

test.each(["owner", "legacy"] as const)("%s visibility changed before policy SQL is rejected", async (mutation) => {
  const fixture = await seed();
  const assertFired = atPolicyRead("before", () => {
    if (mutation === "owner") db.sql.prepare("update v2_objects set user_id='other-owner' where id=?").run(fixture.capture.objectId);
    else hideOrphan(fixture.capture.captureId);
  });
  await assertError(await read(fixture.capture.objectId), 404, "record_not_found");
  assertFired();
});

test("real policy-query failures are sanitized, not misreported as absent or readable", async () => {
  const fixture = await seed();
  const assertFired = atPolicyRead("before", () => { throw new Error("PRIVATE MEMO / PRIVATE SOURCE / database details"); });
  const payload = await assertError(await read(fixture.capture.objectId), 500, "internal_error");
  expect(payload).toEqual({ error: { code: "internal_error", message: "The request could not be completed." } });
  assertFired();
});

test.each(["session", "grant", "bindings"] as const)("%s infrastructure failures remain private no-store and content-free", async (dependency) => {
  if (dependency === "bindings") harness.bindings.mockImplementation(() => { throw new Error("PRIVATE MEMO / infrastructure details"); });
  else harness[dependency].mockRejectedValue(new Error("PRIVATE MEMO / infrastructure details"));
  const payload = await assertError(await read("known-record"), 500, "internal_error");
  expect(payload).toEqual({ error: { code: "internal_error", message: "The request could not be completed." } });
});
