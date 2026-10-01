import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { POST } from "@/app/api/v2/records/[recordId]/links/fragments/route";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import type { CreateManualLinkFragmentRequest, ManualLinkFragmentReceipt } from "@/lib/v2/domain/manual-link-fragment-v1";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "0");
  harness.session.mockResolvedValue({ sessionId: "replay-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 100_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
const repo = (binding: D1DatabaseBinding = db) => new D1ManualLinkFragmentRepository(binding, "link-owner");
async function fixture() {
  const source = await seedLinkRecord(db);
  const input: CreateManualLinkFragmentRequest = { expectedRevisionId: source.capture.revisionId, expectedSnapshotId: source.projection!.snapshot.id,
    expectedManifestHash: source.projection!.snapshot.manifestHash, memberId: source.projection!.members[0].id,
    textStart: 0, textEnd: source.rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID() };
  return { ...source, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function post(item: Fixture, input: CreateManualLinkFragmentRequest = item.input) {
  return POST(new Request(`https://lighthouse.test/api/v2/records/${item.capture.objectId}/links/fragments`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://lighthouse.test" }, body: JSON.stringify(input),
  }), { params: Promise.resolve({ recordId: item.capture.objectId }) });
}
async function advance(item: Fixture, kind: "revision" | "snapshot" | "both") {
  if (kind !== "revision") await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId,
    expectedSnapshotId: item.input.expectedSnapshotId, expectedSnapshotVersion: 1, sourceItemIds: item.sources.map((source) => source.id), idempotencyKey: crypto.randomUUID() });
  if (kind !== "snapshot") {
    const next = await prepareDocumentRevision({ expectedRevisionId: item.capture.revisionId, expectedVersion: 1, title: "New personal title", bodyMarkdown: "NEW PRIVATE MEMO",
      documentStatus: "draft", privacyLevel: "normal", writtenAt: null }, crypto.randomUUID());
    expect(await new D1DocumentAuthoringRepository(db, "link-owner").saveRevision(item.capture.objectId, next)).toMatchObject({ outcome: "saved" });
  }
}
function totalChanges() { return db.sql.prepare("select total_changes() as n").get(); }
async function rejected(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: { code: code ?? expect.any(String), message: expect.any(String) } });
}
/** Mutate actual rows after a completed awaited SQL read, not returned DTOs. */
function afterRead(predicate: (query: string) => boolean, mutate: () => void): D1DatabaseBinding {
  let fired = false;
  return { prepare(query) {
    let actual = db.prepare(query);
    const after = () => { if (!fired && predicate(query)) { fired = true; mutate(); } };
    const statement: D1PreparedStatementBinding = {
      bind(...values) { actual = actual.bind(...values); return statement; },
      async first<T>() { const result = await actual.first<T>(); after(); return result; },
      async all<T>() { const result = await actual.all<T>(); after(); return result; },
      run: () => actual.run(),
    }; return statement;
  }, batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements) };
}

describe("manual POST receipt replay after current scope advances", () => {
  test.each(["revision", "snapshot", "both"] as const)("same original key/body is a read-only replay after real %s advancement", async (kind) => {
    const item = await fixture(), created = await post(item); expect(created.status).toBe(201);
    const saved = await created.json() as ManualLinkFragmentReceipt;
    await advance(item, kind); const before = totalChanges();
    const response = await post(item); expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ...saved, replayed: true });
    expect(totalChanges()).toEqual(before);
    expect(saved.item.fragment.rawText).toBe(item.rawText);
    expect((await repo().list(item.capture.objectId, { snapshotId: item.input.expectedSnapshotId })).items).toEqual([saved.item]);
  });

  test.each([false, true])("old scope without its exact receipt never creates a fragment (previously committed: %s)", async (committed) => {
    const item = await fixture(); if (committed) expect((await post(item)).status).toBe(201);
    await advance(item, "both"); const before = totalChanges(), batch = vi.spyOn(db, "batch");
    await rejected(await post(item, { ...item.input, idempotencyKey: crypto.randomUUID() }), 409, "manual_link_fragment_conflict");
    expect(batch).not.toHaveBeenCalled(); expect(totalChanges()).toEqual(before);
  });

  test.each(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "memberId", "textStart", "textEnd", "role"] as const)("an old key cannot acknowledge a changed %s", async (field) => {
    const item = await fixture(); expect((await post(item)).status).toBe(201); await advance(item, "both");
    const value = field === "expectedManifestHash" ? "0".repeat(64) : field === "textStart" ? 1 : field === "textEnd" ? 2 : field === "role" ? "parameters" : "different-identity";
    const before = totalChanges();
    await rejected(await post(item, { ...item.input, [field]: value }), 409, "idempotency_conflict");
    expect(totalChanges()).toEqual(before);
  });

  test("same owner's other record cannot reuse the original receipt", async () => {
    const item = await fixture(), other = await fixture(); expect((await post(item)).status).toBe(201);
    const before = totalChanges(); await rejected(await post(other, item.input), 409, "idempotency_conflict"); expect(totalChanges()).toEqual(before);
  });

  test.each(["owner", "deleted", "legacy", "restricted_missing", "restricted_expired", "restricted_active"])("progressed replay still applies current %s access before receipt lookup", async (kind) => {
    const item = await fixture(); expect((await post(item)).status).toBe(201); await advance(item, "both");
    if (kind === "owner") harness.session.mockResolvedValue({ sessionId: "other", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 100_000 });
    if (kind === "deleted") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(item.capture.objectId);
    if (kind === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:hidden' where id=?").run(item.capture.captureId);
    if (kind.startsWith("restricted")) {
      db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      if (kind !== "restricted_missing") harness.grant.mockResolvedValue({ expiresAt: kind === "restricted_active" ? "2099-01-01T00:00:00Z" : "2000-01-01T00:00:00Z" });
    }
    const before = totalChanges(), prepare = vi.spyOn(db, "prepare"), response = await post(item);
    if (kind === "restricted_active") { expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ replayed: true }); }
    else {
      await rejected(response, kind.startsWith("restricted") ? 423 : 404);
      expect(prepare.mock.calls.some(([query]) => query.startsWith("select payload_hash,response_json"))).toBe(false);
    }
    expect(totalChanges()).toEqual(before);
  });

  test.each(["null", "[]", "{}", "not json", '{"fragmentId":"missing","extra":true}', '{"fragmentId":""}'])("malformed stored receipt %s is never successful cleanup authority", async (responseJson) => {
    const item = await fixture(); expect((await post(item)).status).toBe(201); await advance(item, "both");
    db.sql.prepare("update v2_idempotency_records set response_json=? where operation='link_fragment.create.v1'").run(responseJson);
    const before = totalChanges(); await rejected(await post(item), 400, "manual_link_fragment_integrity_invalid"); expect(totalChanges()).toEqual(before);
  });

  test.each(["wrong_fragment", "foreign_fragment", "status", "missing_fragment", "missing_evidence", "original_revision", "manifest", "source", "source_metadata"])("progressed replay rejects stored %s damage without a replacement write", async (kind) => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    if (kind === "wrong_fragment" || kind === "foreign_fragment") {
      const alternate = kind === "foreign_fragment" ? await fixture() : item;
      const wrong = await repo().create(alternate.capture.objectId, { ...alternate.input, role: "parameters", idempotencyKey: crypto.randomUUID() });
      db.sql.prepare("update v2_idempotency_records set response_json=? where operation='link_fragment.create.v1' and idempotency_key=?")
        .run(JSON.stringify({ fragmentId: wrong.item.id }), item.input.idempotencyKey);
    }
    await advance(item, "both");
    if (kind === "status") db.sql.prepare("update v2_idempotency_records set status_code=500 where operation='link_fragment.create.v1'").run();
    if (kind === "missing_fragment") db.sql.prepare("delete from v2_link_fragments where id=?").run(saved.item.id);
    if (kind === "missing_evidence") db.sql.prepare("delete from v2_link_fragment_evidence where fragment_id=?").run(saved.item.id);
    if (kind === "original_revision") db.sql.prepare("delete from v2_document_revisions where id=?").run(item.input.expectedRevisionId);
    if (kind === "manifest") { db.sql.exec("drop trigger trg_v2_link_snapshot_immutable"); db.sql.prepare("update v2_link_snapshots set manifest_hash=? where id=?").run("0".repeat(64), item.input.expectedSnapshotId); }
    if (kind === "source") db.sql.prepare("update v2_source_items set raw_text='corrupt' where id=?").run(item.sources[0].id);
    if (kind === "source_metadata") db.sql.prepare("update v2_source_items set source_metadata='{}' where id=?").run(item.sources[0].id);
    const before = totalChanges(), batch = vi.spyOn(db, "batch"), response = await post(item);
    expect([400, 404]).toContain(response.status); expect(JSON.stringify(await response.json())).not.toContain(item.rawText);
    expect(batch).not.toHaveBeenCalled(); expect(totalChanges()).toEqual(before);
  });

  test.each(["receipt", "receipt_deleted", "evidence", "fragment_review", "source", "original_revision", "privacy", "lifecycle", "legacy", "grant"])("final historical replay fences a late %s change after the fragment read", async (kind) => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input); await advance(item, "both");
    const expiry = new Date(Date.now() + 60_000).toISOString();
    if (kind === "grant") { db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId); harness.grant.mockResolvedValue({ expiresAt: expiry }); }
    let fired = false;
    harness.bindings.mockReturnValue({ db: afterRead((query) => query.startsWith("select f.*") && query.includes("as evidence_valid"), () => {
      fired = true;
      if (kind === "receipt") db.sql.prepare("update v2_idempotency_records set response_json='{}' where operation='link_fragment.create.v1'").run();
      if (kind === "receipt_deleted") db.sql.prepare("delete from v2_idempotency_records where operation='link_fragment.create.v1'").run();
      if (kind === "evidence") db.sql.prepare("delete from v2_link_fragment_evidence where fragment_id=?").run(saved.item.id);
      if (kind === "fragment_review") db.sql.prepare("update v2_link_fragments set review_status='rejected',state_version=state_version+1 where id=?").run(saved.item.id);
      if (kind === "source") db.sql.prepare("update v2_source_items set raw_text='late corruption' where id=?").run(item.sources[0].id);
      if (kind === "original_revision") db.sql.prepare("delete from v2_document_revisions where id=?").run(item.input.expectedRevisionId);
      if (kind === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      if (kind === "lifecycle") db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(item.capture.objectId);
      if (kind === "legacy") db.sql.prepare("update v2_capture_bundles set draft_id='legacy:hidden' where id=?").run(item.capture.captureId);
      if (kind === "grant") vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiry) + 1);
    }) });
    const batch = vi.spyOn(db, "batch"), response = await post(item);
    expect([400, 404, 423]).toContain(response.status); expect(JSON.stringify(await response.json())).not.toContain(item.rawText);
    expect(fired).toBe(true); expect(batch).not.toHaveBeenCalled();
  });

  test("a later legitimate review is returned as history rather than silently restored to confirmed", async () => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input); await advance(item, "both");
    db.sql.prepare("update v2_link_fragments set review_status='rejected',state_version=2 where id=?").run(saved.item.id);
    const before = totalChanges(), response = await post(item); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...saved, replayed: true, item: { ...saved.item, reviewStatus: "rejected", stateVersion: 2 } });
    expect(totalChanges()).toEqual(before);
  });

  test.each([false, true])("concurrent winner can advance current scope before the losing batch recovers its receipt (different body: %s)", async (different) => {
    const item = await fixture(); let raced = false;
    const binding: D1DatabaseBinding = { prepare: (query) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
      if (!raced) {
        raced = true;
        await repo().create(item.capture.objectId, { ...item.input, ...(different ? { role: "parameters" } : {}) });
        await advance(item, "both");
      }
      return db.batch<T>(statements);
    } };
    const pending = repo(binding).create(item.capture.objectId, item.input);
    if (different) await expect(pending).rejects.toMatchObject({ code: "idempotency_conflict" });
    else expect(await pending).toMatchObject({ replayed: true, item: { snapshotId: item.input.expectedSnapshotId } });
    expect(raced).toBe(true);
    for (const table of ["v2_link_fragments", "v2_link_fragment_evidence"]) expect(db.sql.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 1 });
    expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.fragment_created'").get()).toEqual({ n: 1 });
    expect(db.sql.prepare("select count(*) as n from v2_idempotency_records where operation='link_fragment.create.v1'").get()).toEqual({ n: 1 });
  });
});
