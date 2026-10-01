import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET } from "@/app/api/v2/records/[recordId]/search-location/route";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { recordLocationTextHash, serializeRecordLocation, type V2RecordLocationV1 } from "@/lib/v2/retrieval/record-location-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

const owner = "link-owner", rawText = "  preserved 👀 prompt\r\nSECRET ORIGINAL MUST NOT LEAK  ";
type Seed = Awaited<ReturnType<typeof seedLinkRecord>>;
let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1");
  harness.session.mockResolvedValue({ sessionId: "damage-session", userId: owner, email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

function location(seed: Seed, snapshot = true): V2RecordLocationV1 {
  const projection = seed.projection!, member = projection.members[0];
  return { contract: "record-location.v1", kind: "source", sourceItemId: member.sourceItemId,
    snapshotId: snapshot ? projection.snapshot.id : null, manifestHash: snapshot ? projection.snapshot.manifestHash : null,
    memberId: snapshot ? member.id : null, textHash: recordLocationTextHash(rawText), range: { start: 2, end: 11 } };
}
function read(seed: Seed, selected = location(seed)) {
  const query = new URLSearchParams({ loc: serializeRecordLocation(selected) });
  return GET(new Request(`https://lighthouse.test/api/v2/records/${seed.capture.objectId}/search-location?${query}`),
    { params: Promise.resolve({ recordId: seed.capture.objectId }) });
}
function totalChanges() { return db.sql.prepare("select total_changes() as count").get()!.count; }
async function denial(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const result = await response.json();
  if (result === null || typeof result !== "object" || Array.isArray(result)) throw new Error("Expected an error object");
  expect(result).toMatchObject({ error: { code } });
  expect(Object.keys(result)).toEqual(["error"]);
  for (const secret of [rawText, "SECRET ORIGINAL", "PRIVATE MEMO", "Synthetic link", "example.test/source"])
    expect(JSON.stringify(result)).not.toContain(secret);
}

function beforeFinalFrame(action: () => void) {
  let frameReads = 0;
  const binding: D1DatabaseBinding = { batch: db.batch.bind(db), prepare(sql) {
    let statement = db.prepare(sql);
    const wrapped: D1PreparedStatementBinding = {
      bind(...values) { statement = statement.bind(...values); return wrapped; },
      all: () => statement.all(), run: () => statement.run(),
      async first<T>() {
        if (sql.includes("as material_json") && ++frameReads === 2) action();
        return statement.first<T>();
      },
    };
    return wrapped;
  } };
  return { binding, frameReads: () => frameReads };
}

describe("stored source damage: exact HTTP response using real local SQLite", () => {
  test.each(["{", "{}"])("snapshot metadata %j is an explicit integrity denial, not a generic server error", async (metadata) => {
    const seed = await seedLinkRecord(db, { rawText });
    // Direct fixture SQL models already damaged stored data, not a supported
    // application mutation. The locator retains the original snapshot/hash.
    db.sql.prepare("update v2_source_items set source_metadata=? where id=?").run(metadata, seed.sources[0].id);
    const before = totalChanges();
    await denial(await read(seed), 400, "record_location_integrity_invalid");
    expect(totalChanges()).toBe(before);
    expect(db.sql.prepare("select raw_text from v2_source_items where id=?").get(seed.sources[0].id)!.raw_text).toBe(rawText);
  });

  test("malformed unversioned metadata is an explicit integrity denial without rewriting source bytes", async () => {
    const seed = await seedLinkRecord(db, { rawText });
    db.sql.prepare("update v2_source_items set source_metadata='{' where id=?").run(seed.sources[0].id);
    const before = totalChanges();
    await denial(await read(seed, location(seed, false)), 400, "record_location_integrity_invalid");
    expect(totalChanges()).toBe(before);
    expect(db.sql.prepare("select raw_text from v2_source_items where id=?").get(seed.sources[0].id)!.raw_text).toBe(rawText);
  });

  test("missing external metadata does not overwrite an owner denial or expose an original", async () => {
    const seed = await seedLinkRecord(db, { rawText });
    db.sql.prepare("update v2_source_items set source_metadata='{}' where id=?").run(seed.sources[0].id);
    harness.session.mockResolvedValue({ sessionId: "other-session", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 60_000 });
    const before = totalChanges();
    await denial(await read(seed), 404, "record_location_not_found");
    expect(totalChanges()).toBe(before);
  });
});

describe("selected snapshot version: distinguish normal protection from damaged schema", () => {
  test("the real immutable trigger blocks an ordinary snapshot version UPDATE", async () => {
    const seed = await seedLinkRecord(db, { rawText }), snapshotId = seed.projection!.snapshot.id;
    expect(db.sql.prepare("select name from sqlite_master where type='trigger' and name='trg_v2_link_snapshot_immutable'").get()).toBeDefined();
    expect(() => db.sql.prepare("update v2_link_snapshots set snapshot_version=91 where id=?").run(snapshotId)).toThrow("link_snapshot_immutable");
    expect(db.sql.prepare("select snapshot_version from v2_link_snapshots where id=?").get(snapshotId)!.snapshot_version).toBe(1);
    const before = totalChanges(), response = await read(seed);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ text: rawText, context: { snapshotId, snapshotVersion: 1 } });
    expect(totalChanges()).toBe(before);
  });

  test.each([false, true])("damaged-schema selected snapshot version change cannot pass the final frame; historical=%s", async (historical) => {
    const seed = await seedLinkRecord(db, { rawText }), snapshotId = seed.projection!.snapshot.id;
    if (historical) await seed.snapshots.createSnapshot({ documentId: seed.capture.objectId, expectedRevisionId: seed.capture.revisionId,
      expectedSnapshotId: snapshotId, expectedSnapshotVersion: 1, sourceItemIds: seed.sources.map((source) => source.id), idempotencyKey: crypto.randomUUID() });
    // Explicit corruption fixture: the normal immutable trigger is removed in
    // this in-memory database only. This is not an application race claim.
    db.sql.exec("drop trigger trg_v2_link_snapshot_immutable");
    expect(db.sql.prepare("select name from sqlite_master where type='trigger' and name='trg_v2_link_snapshot_immutable'").get()).toBeUndefined();
    let changesAfterDamage: ReturnType<typeof totalChanges> | undefined;
    const hook = beforeFinalFrame(() => {
      db.sql.prepare("update v2_link_snapshots set snapshot_version=91 where id=?").run(snapshotId);
      changesAfterDamage = totalChanges();
    });
    harness.bindings.mockReturnValue({ db: hook.binding });
    const response = await read(seed);
    expect(hook.frameReads()).toBe(2);
    expect(db.sql.prepare("select snapshot_version from v2_link_snapshots where id=?").get(snapshotId)!.snapshot_version).toBe(91);
    // Either an explicit changed frame or its exact proof may detect the drift;
    // success, generic 500, and retargeting to the latest snapshot are forbidden.
    expect([400, 409]).toContain(response.status);
    await denial(response, response.status, response.status === 400 ? "record_location_integrity_invalid" : "record_location_conflict");
    expect(totalChanges()).toBe(changesAfterDamage);
  });
});
