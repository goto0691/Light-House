import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn(), collect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
vi.mock("@/lib/v2/collect/public-web-runtime", () => ({ collectConfiguredPublicWeb: harness.collect }));

import { POST as collect } from "@/app/api/v2/records/[recordId]/links/collect/route";
import type { PublicWebResult } from "@/lib/v2/collect/public-web-fetch";
import type { LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => {
  db = new LinkSqlite();
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "0");
  harness.session.mockResolvedValue({ sessionId: "link-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 100_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function request(recordId: string, body: Record<string, unknown>) {
  return collect(new Request(`https://lighthouse.test/api/v2/records/${recordId}/links/collect`, {
    method: "POST", headers: { Origin: "https://lighthouse.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ recordId }) });
}
function basis(f: Awaited<ReturnType<typeof seedLinkRecord>>, key: string, snapshotId = f.projection!.snapshot.id, version = f.projection!.snapshot.snapshotVersion) {
  return { sourceItemId: f.sources[0].id, expectedRevisionId: f.capture.revisionId, expectedSnapshotId: snapshotId,
    expectedSnapshotVersion: version, idempotencyKey: key };
}
function result(url: string, state: PublicWebResult["state"], reason: PublicWebResult["reason"], rawText: string | null): PublicWebResult {
  return { state, reason, sourceUrl: url, finalUrl: url, statusCode: state === "needs_input" ? 403 : 200,
    mimeType: rawText ? "text/html" : null, rawText, extraction: rawText ? "html_visible_text_v1" : null, externalScope: "unverified" };
}

describe("public web collection HTTP and real SQLite boundary", () => {
  test("preserves URL and note through failure, then stores a distinct immutable partial original without AI dispatch", async () => {
    const f = await seedLinkRecord(db, { rawText: "" });
    const url = "https://example.test/source";
    harness.collect.mockResolvedValueOnce(result(url, "needs_input", "forbidden", null));
    const first = await request(f.capture.objectId, basis(f, "collect-one"));
    expect(first.status).toBe(201); expect(first.headers.get("cache-control")).toBe("private, no-store");
    const blocked = ((await first.json()) as { links: LinkPresentationV1 }).links;
    expect(blocked.selectedSnapshot).toMatchObject({ acquisitionMethod: "public_fetch", captureState: "needs_input",
      coverage: { status: "needs_input", reason: "forbidden" } });
    expect(blocked.members).toHaveLength(1);
    expect(db.sql.prepare("select body_markdown from v2_documents where object_id=?").get(f.capture.objectId)).toEqual({ body_markdown: "PRIVATE MEMO" });
    expect(db.sql.prepare("select raw_text from v2_source_items where id=?").get(f.sources[0].id)).toEqual({ raw_text: "" });
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs").get()).toEqual({ n: 0 });

    const exact = "  public synthetic text\r\nTwo  spaces  ";
    harness.collect.mockResolvedValueOnce(result(url, "partial", "html_visible_text_only", exact));
    const second = await request(f.capture.objectId, basis(f, "collect-two", blocked.currentSnapshotId!, blocked.currentSnapshotVersion));
    expect(second.status).toBe(201);
    const captured = ((await second.json()) as { links: LinkPresentationV1 }).links;
    expect(captured.selectedSnapshot).toMatchObject({ acquisitionMethod: "public_fetch", captureState: "partial",
      coverage: { status: "partial", reason: "html_visible_text_only" } });
    expect(captured.members).toHaveLength(2);
    expect(captured.members.find((member: { publicFetch?: unknown }) => member.publicFetch)?.rawText).toBe(exact);
    expect(captured.members.find((member: { publicFetch?: unknown }) => member.publicFetch)?.publicFetch).toMatchObject({
      requestedSourceItemId: f.sources[0].id, requestedUrl: url, finalUrl: url, contentType: "text/html", extractionVersion: "html_visible_text_v1",
    });
    expect(db.sql.prepare("select raw_text from v2_source_items where id=?").get(f.sources[0].id)).toEqual({ raw_text: "" });
    expect(db.sql.prepare("select count(*) n from v2_processing_jobs").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  test("replays one gesture without another outbound request and denies wrong owner or restricted records before network", async () => {
    const f = await seedLinkRecord(db, { rawText: "" });
    const body = basis(f, "same-gesture");
    harness.collect.mockResolvedValue(result("https://example.test/source", "needs_input", "forbidden", null));
    expect((await request(f.capture.objectId, body)).status).toBe(201);
    expect((await request(f.capture.objectId, body)).status).toBe(200);
    expect(harness.collect).toHaveBeenCalledTimes(1);
    harness.session.mockResolvedValue({ sessionId: "other-session", userId: "other-owner", email: "other@example.test", expiresAt: Date.now() + 100_000 });
    expect((await request(f.capture.objectId, { ...body, idempotencyKey: "other" })).status).toBe(404);
    expect(harness.collect).toHaveBeenCalledTimes(1);
    harness.session.mockResolvedValue({ sessionId: "link-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 100_000 });
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(f.capture.objectId);
    expect((await request(f.capture.objectId, { ...body, idempotencyKey: "restricted" })).status).toBe(404);
    expect(harness.collect).toHaveBeenCalledTimes(1);
  });
});
