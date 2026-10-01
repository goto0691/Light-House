import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));

import { GET, POST } from "@/app/api/v2/records/[recordId]/links/curations/route";
import { GET as GET_GROUP } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/route";
import { POST as REVISE } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/route";
import { GET as COPY } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/copy/route";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { CreatePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import type { PromptCurationDetail, PromptCurationPage, PromptCurationReceipt } from "@/lib/v2/domain/stored-prompt-curation";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { PROMPT_CURATION_REQUEST_BYTES } from "@/lib/v2/server/prompt-curation-http";
import { LinkSqlite } from "../../support/link-sqlite";

let db: LinkSqlite;
const origin = "https://lighthouse.test";
const session = (userId = "link-owner") => ({ sessionId: "curation-session", userId, email: "synthetic@example.test", expiresAt: Date.now() + 100_000 });
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "0");
  harness.session.mockResolvedValue(session()); harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function fixture({ complete = false, image = false, privacyLevel = "normal" as "normal" | "restricted" } = {}) {
  const rawText = "  exact prompt 👀\r\nkeep  spaces\r\n--ar 3:2  ", now = new Date().toISOString(), attachmentId = crypto.randomUUID();
  const imageHash = await linkSha256Hex("synthetic image header; no decoding or object-store claim");
  if (image) db.sql.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
    values(?,'link-owner','verified',?,'synthetic.png','image/png',8,?,?,'2099-01-01T00:00:00Z',?)`)
    .run(attachmentId, `synthetic/${attachmentId}.png`, imageHash, now, now);
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Synthetic HTTP curation", bodyMarkdown: "PRIVATE PERSONAL MEMO",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now,
    sources: [{ kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`,
      metadata: makeManualLinkMetadata({ url: "https://example.test/source", purpose: "prompt", completeness: complete ? "complete" : "unknown",
        partNumber: complete ? 1 : null, totalParts: complete ? 1 : null }) },
    ...(image ? [{ kind: "image" as const, contentHash: `sha256:${imageHash}`, attachmentId }] : [])],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner");
  const projection = await snapshots.bootstrapManualSources({ documentId: capture.objectId, expectedRevisionId: capture.revisionId,
    idempotencyKey: crypto.randomUUID(), restrictedUnlocked: privacyLevel === "restricted" });
  const fragment = await new D1ManualLinkFragmentRepository(db, "link-owner").create(capture.objectId, {
    expectedRevisionId: capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash,
    memberId: projection.members[0].id, textStart: 0, textEnd: rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  }, { restrictedGrantExpiresAt: privacyLevel === "restricted" ? "2099-01-01T00:00:00Z" : undefined });
  const input: CreatePromptCurationRequest = { expectedRevisionId: capture.revisionId, expectedSnapshotId: projection.snapshot.id,
    expectedManifestHash: projection.snapshot.manifestHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "사용자 정리본", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [{ itemKey: "first", fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 }], examples: [] } };
  return { rawText, capture, snapshots, projection, fragment, input, attachmentId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
}
const base = (recordId: string) => `/api/v2/records/${encodeURIComponent(recordId)}/links/curations`;
function post(item: Fixture, value: unknown = item.input, headers: Record<string, string> = {}, query = "") {
  return POST(request(`${base(item.capture.objectId)}${query}`, value, headers), { params: Promise.resolve({ recordId: item.capture.objectId }) });
}
function list(recordId: string, query = "") {
  return GET(request(`${base(recordId)}${query}`), { params: Promise.resolve({ recordId }) });
}
function get(item: Fixture, query = "", groupKey = item.input.groupKey) {
  return GET_GROUP(request(`${base(item.capture.objectId)}/${encodeURIComponent(groupKey)}${query}`), { params: Promise.resolve({ recordId: item.capture.objectId, groupKey }) });
}
function revise(item: Fixture, value: unknown, headers: Record<string, string> = {}, query = "") {
  return REVISE(request(`${base(item.capture.objectId)}/${encodeURIComponent(item.input.groupKey)}/revisions${query}`, value, headers),
    { params: Promise.resolve({ recordId: item.capture.objectId, groupKey: item.input.groupKey }) });
}
function copy(item: Fixture, revisionId: string, query = "?channel=prompt&mode=available_only", groupKey = item.input.groupKey) {
  return COPY(request(`${base(item.capture.objectId)}/${encodeURIComponent(groupKey)}/revisions/${encodeURIComponent(revisionId)}/copy${query}`),
    { params: Promise.resolve({ recordId: item.capture.objectId, groupKey, revisionId }) });
}
function revisionBasis(item: Fixture, saved: PromptCurationReceipt) {
  return { expectedRevisionId: item.input.expectedRevisionId, expectedSnapshotId: item.input.expectedSnapshotId, expectedManifestHash: item.input.expectedManifestHash,
    expectedCurationRevisionId: saved.item.id, expectedCurationRevisionNumber: saved.item.revisionNumber, idempotencyKey: crypto.randomUUID() };
}
async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); return response.json() as Promise<T>;
}
async function error(response: Response, status: number, code?: string) {
  expect(await json(response, status)).toEqual({ error: { code: code ?? expect.any(String), message: expect.any(String) } });
}
const count = (table: string) => (db.sql.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
function noCuration() {
  for (const table of ["v2_link_curation_revisions", "v2_link_curation_items", "v2_link_curation_examples"]) expect(count(table)).toBe(0);
  expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.curation_saved'").get()).toEqual({ n: 0 });
  expect(db.sql.prepare("select count(*) as n from v2_idempotency_records where operation like 'prompt_curation.%'").get()).toEqual({ n: 0 });
}
/** Wrap only the D1 binding; all SQL/result validation remains real. */
function afterRead(predicate: (query: string) => boolean, mutate: () => void): D1DatabaseBinding {
  let fired = false;
  return { prepare(query) {
    let actual = db.prepare(query);
    const after = () => { if (!fired && predicate(query)) { fired = true; mutate(); } };
    const statement: D1PreparedStatementBinding = {
      bind(...values) { actual = actual.bind(...values); return statement; },
      async first<T>() { const result = await actual.first<T>(); after(); return result; },
      async all<T>() { const result = await actual.all<T>(); after(); return result; }, run: () => actual.run(),
    }; return statement;
  }, batch: <T>(statements: D1PreparedStatementBinding[]) => db.batch<T>(statements) };
}

describe("curation routes: actual HTTP handlers and 0032 SQLite, auth/binding doubles only", () => {
  test("creates, replays, lists and reads exact material with AI disabled and no GET writes", async () => {
    const item = await fixture(), originals = db.sql.prepare("select * from v2_source_items").all();
    const saved = await json<PromptCurationReceipt>(await post(item), 201);
    expect(saved).toMatchObject({ contract: "stored-prompt-curation.v1", replayed: false, item: { revisionNumber: 1 } });
    expect(saved.item.items[0].fragment.rawText).toBe(item.rawText);
    expect(await json(await post(item))).toEqual({ ...saved, replayed: true });
    const changes = db.sql.prepare("select total_changes() as n").get();
    const page = await json<PromptCurationPage>(await list(item.capture.objectId));
    expect(page).toMatchObject({ items: [{ id: saved.item.id }], nextCursor: null });
    expect(JSON.stringify(page)).not.toContain(item.rawText); expect(JSON.stringify(page)).not.toContain("PRIVATE PERSONAL MEMO");
    expect((await json<PromptCurationDetail>(await get(item))).item).toEqual(saved.item);
    expect(await json(await copy(item, saved.item.id))).toMatchObject({ text: item.rawText, role: "prompt", mode: "available_only",
      kind: "assembled_source_fragments", sha256: await linkSha256Hex(item.rawText), byteLength: new TextEncoder().encode(item.rawText).length });
    expect(db.sql.prepare("select total_changes() as n").get()).toEqual(changes);
    expect(db.sql.prepare("select * from v2_source_items").all()).toEqual(originals); expect(count("v2_processing_jobs")).toBe(0);
  });
  test("edits, undoes, archives and unarchives as new revisions, preserving historic copy", async () => {
    const item = await fixture({ complete: true }), first = await json<PromptCurationReceipt>(await post(item), 201);
    const edit = { ...revisionBasis(item, first), action: "edit", content: { ...item.input.content, title: "정리본 수정" } };
    const second = await json<PromptCurationReceipt>(await revise(item, edit), 201);
    expect(await json(await revise(item, edit))).toEqual({ ...second, replayed: true });
    const undo = await json<PromptCurationReceipt>(await revise(item, { ...revisionBasis(item, second), action: "undo", restoreRevisionId: first.item.id }), 201);
    expect(undo.item).toMatchObject({ revisionNumber: 3, basedOnRevisionId: first.item.id, parentRevisionId: second.item.id, title: first.item.title });
    const archived = await json<PromptCurationReceipt>(await revise(item, { ...revisionBasis(item, undo), action: "archive" }), 201);
    const active = await json<PromptCurationReceipt>(await revise(item, { ...revisionBasis(item, archived), action: "unarchive" }), 201);
    expect(active.item).toMatchObject({ revisionNumber: 5, status: "active" });
    expect(await json(await get(item, `?revisionId=${first.item.id}`))).toMatchObject({ isHistorical: true, item: first.item, head: { id: active.item.id } });
    expect(await json(await copy(item, first.item.id, "?channel=prompt"))).toMatchObject({ mode: "standard", text: item.rawText });
    expect(count("v2_link_curation_revisions")).toBe(5);
  });
  test("copy separates roles and retains intentional duplicate originals and embedded CRLF", async () => {
    const item = await fixture({ complete: true });
    const roles = ["negative_prompt", "parameters"] as const;
    const fragments = await Promise.all(roles.map((role) => new D1ManualLinkFragmentRepository(db, "link-owner").create(item.capture.objectId, {
      expectedRevisionId: item.input.expectedRevisionId, expectedSnapshotId: item.input.expectedSnapshotId, expectedManifestHash: item.input.expectedManifestHash,
      memberId: item.projection.members[0].id, textStart: role === "parameters" ? item.rawText.indexOf("--ar") : 2, textEnd: item.rawText.length, role, idempotencyKey: role,
    })));
    const content = { ...item.input.content, items: [...item.input.content.items, { ...item.input.content.items[0], itemKey: "duplicate", position: 1 },
      ...fragments.map((fragment, index) => ({ itemKey: roles[index], fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: roles[index], position: 0 }))] };
    const saved = await json<PromptCurationReceipt>(await post(item, { ...item.input, content }), 201);
    expect(await json(await copy(item, saved.item.id, "?channel=prompt"))).toMatchObject({ text: `${item.rawText}\n${item.rawText}` });
    for (const [index, role] of roles.entries()) expect(await json(await copy(item, saved.item.id, `?channel=${role}`))).toMatchObject({ text: fragments[index].item.fragment.rawText, role });
  });
  test.each(["collection", "alternatives", "unconfirmed"])("maps %s copy refusal to 409 instead of internal error", async (kind) => {
    const item = await fixture();
    const content = { ...item.input.content, ...(kind === "unconfirmed" ? { orderConfirmation: "unconfirmed" } : { relationKind: kind }) };
    const saved = await json<PromptCurationReceipt>(await post(item, { ...item.input, content }), 201);
    await error(await copy(item, saved.item.id), 409, "prompt_curation_copy_blocked");
  });
  test("default standard copy cannot erase unknown coverage and explicit available-only preserves warnings", async () => {
    const item = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201);
    await error(await copy(item, saved.item.id, "?channel=prompt"), 409, "prompt_curation_incomplete_copy_required");
    expect(await json(await copy(item, saved.item.id))).toMatchObject({ warnings: expect.arrayContaining(["unknown_total_parts"]), text: item.rawText });
  });
  test("64 items and 64 committed-image examples with maximum Unicode stable keys cross the actual route", async () => {
    const item = await fixture({ image: true }), key = (index: number) => `${"한".repeat(197)}${String(index).padStart(3, "0")}`;
    const content = { ...item.input.content, title: "한".repeat(200),
      items: Array.from({ length: 64 }, (_, position) => ({ ...item.input.content.items[0], itemKey: key(position), position })),
      examples: Array.from({ length: 64 }, (_, position) => ({ exampleKey: key(position), itemKey: key(position), memberId: item.projection.members[1].id,
        attachmentId: item.attachmentId, position, evidenceMethod: "user_confirmed" as const })) };
    const input = { ...item.input, groupKey: "한".repeat(200), idempotencyKey: "요".repeat(200), content };
    const saved = await json<PromptCurationReceipt>(await post(item, input), 201);
    expect(saved.item.content.items).toHaveLength(64); expect(saved.item.content.examples).toHaveLength(64);
    expect(count("v2_link_curation_items")).toBe(64); expect(count("v2_link_curation_examples")).toBe(64);
    const maximized = { ...input, expectedRevisionId: "한".repeat(200), expectedSnapshotId: "글".repeat(200), content: { ...content,
      items: content.items.map((row) => ({ ...row, fragmentId: "한".repeat(200) })),
      examples: content.examples.map((row) => ({ ...row, memberId: "한".repeat(200), attachmentId: "한".repeat(200) })) } };
    const bytes = new TextEncoder().encode(JSON.stringify(maximized)).length;
    expect(bytes).toBeGreaterThan(230_000); expect(bytes).toBeLessThanOrEqual(PROMPT_CURATION_REQUEST_BYTES);
    // Legal transport/parser shape reaches actual repository CAS, not 413/400.
    await error(await post(item, { ...maximized, idempotencyKey: "다".repeat(200) }), 409, "prompt_curation_conflict");
  });
  test.each(["missing", "expired", "active"])("restricted read/write/copy/replay require a live grant: %s", async (grant) => {
    const item = await fixture({ privacyLevel: "restricted" });
    if (grant !== "missing") harness.grant.mockResolvedValue({ expiresAt: grant === "active" ? "2099-01-01T00:00:00Z" : "2000-01-01T00:00:00Z" });
    if (grant !== "active") { await error(await post(item), 423); await error(await list(item.capture.objectId), 423); noCuration(); return; }
    const saved = await json<PromptCurationReceipt>(await post(item), 201);
    expect((await get(item)).status).toBe(200); expect((await copy(item, saved.item.id)).status).toBe(200);
    harness.grant.mockResolvedValue(null);
    for (const response of [await post(item), await get(item), await copy(item, saved.item.id)]) await error(response, 423, "restricted_record_locked");
  });
  test("expiry after commit withholds response and reauthentication replays the same saved version", async () => {
    const item = await fixture({ privacyLevel: "restricted" }), expiry = new Date(Date.now() + 60_000).toISOString();
    harness.grant.mockResolvedValue({ expiresAt: expiry });
    harness.bindings.mockReturnValue({ db: { prepare: (query: string) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
      const result = await db.batch<T>(statements); vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiry) + 1); return result;
    } } });
    await error(await post(item), 423); expect(count("v2_link_curation_revisions")).toBe(1);
    vi.restoreAllMocks(); harness.bindings.mockReturnValue({ db }); harness.grant.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00Z" });
    expect(await json(await post(item))).toMatchObject({ replayed: true, item: { revisionNumber: 1 } });
  });
  test("SQL clock rejects expiry even if the application clock still considers the grant valid", async () => {
    const item = await fixture({ privacyLevel: "restricted" }), now = Date.now();
    harness.grant.mockResolvedValue({ expiresAt: new Date(now - 30_000).toISOString() }); vi.spyOn(Date, "now").mockReturnValue(now - 60_000);
    await error(await post(item), 409, "prompt_curation_conflict"); noCuration();
  });
  test.each(["source", "privacy", "expiry"])("copy rechecks a concurrent %s change before releasing source text", async (kind) => {
    const item = await fixture({ privacyLevel: kind === "expiry" ? "restricted" : "normal" }), expiry = new Date(Date.now() + 60_000).toISOString();
    harness.grant.mockResolvedValue(kind === "expiry" ? { expiresAt: expiry } : null);
    const saved = await json<PromptCurationReceipt>(await post(item), 201); let fired = false;
    harness.bindings.mockReturnValue({ db: afterRead((query) => query.includes("as evidence_json"), () => {
      fired = true;
      if (kind === "source") db.sql.prepare("update v2_source_items set raw_text='concurrent changed original' where id=?").run(item.projection.members[0].sourceItemId);
      else if (kind === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      else vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiry) + 1);
    }) });
    await error(await copy(item, saved.item.id), kind === "source" ? 409 : 423); expect(fired).toBe(true);
  });
  test("foreign owner/record/group/revision and hidden or deleted records cannot use saved receipts", async () => {
    const item = await fixture(), other = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201);
    await error(await get(other, "", item.input.groupKey), 404); await error(await copy(other, saved.item.id, undefined, item.input.groupKey), 404);
    await error(await get(item, "", "missing"), 404); await error(await copy(item, "missing"), 404);
    harness.session.mockResolvedValue(session("other-owner"));
    for (const response of [await list(item.capture.objectId), await get(item), await copy(item, saved.item.id), await post(item)]) await error(response, 404);
    harness.session.mockResolvedValue(session());
    db.sql.prepare("update v2_capture_bundles set draft_id='legacy:hidden' where id=?").run(item.capture.captureId);
    await error(await get(item), 404); await error(await post(item), 404);
    db.sql.prepare("update v2_objects set lifecycle_status='deleted' where id=?").run(other.capture.objectId);
    await error(await list(other.capture.objectId), 404);
  });
  test("write flag blocks both mutations but all read routes work without write or AI", async () => {
    const item = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201);
    vi.stubEnv("FLAG_V2_WRITE", "0");
    await error(await post(item), 503, "v2_write_disabled"); await error(await revise(item, { ...revisionBasis(item, saved), action: "archive" }), 503);
    for (const response of [await list(item.capture.objectId), await get(item), await copy(item, saved.item.id)]) expect(response.status).toBe(200);
    expect(count("v2_processing_jobs")).toBe(0);
  });
  test.each(["unauthenticated", "routes_disabled"])("all five handlers gate %s with private errors", async (kind) => {
    const item = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201);
    if (kind === "unauthenticated") harness.session.mockResolvedValue(null); else vi.stubEnv("FLAG_V2_ROUTES", "0");
    for (const response of [await list(item.capture.objectId), await get(item), await copy(item, saved.item.id), await post(item), await revise(item, { ...revisionBasis(item, saved), action: "archive" })])
      await error(response, kind === "unauthenticated" ? 401 : 404);
  });
  test.each(["create", "revise"])("%s requires same origin JSON and rejects mutation query fields", async (kind) => {
    const item = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201), input = { ...revisionBasis(item, saved), action: "archive" };
    const invoke = (headers: Record<string, string>, query = "") => kind === "create" ? post(item, item.input, headers, query) : revise(item, input, headers, query);
    await error(await invoke({ Origin: "https://foreign.test" }), 403, "origin_rejected");
    await error(await invoke({ Origin: "" }), 403); await error(await invoke({ "Content-Type": "text/plain" }), 415);
    await error(await invoke({}, "?restrictedUnlocked=true"), 400); expect(count("v2_link_curation_revisions")).toBe(1);
  });
  test.each(["rawText", "userId", "restrictedUnlocked", "restrictedGrantExpiresAt", "sourceClass", "sha256"])("rejects client %s authority instead of trusting request content", async (field) => {
    const item = await fixture(); await error(await post(item, { ...item.input, [field]: "forged" }), 400, "prompt_curation_request_invalid");
    await error(await post(item, { ...item.input, content: { ...item.input.content, items: [{ ...item.input.content.items[0], [field]: "forged" }] } }), 400);
    noCuration();
  });
  test.each(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash"])("stale %s does not save a partial curation", async (field) => {
    const item = await fixture(); await error(await post(item, { ...item.input, [field]: field.endsWith("Hash") ? "0".repeat(64) : "stale" }), 409); noCuration();
  });
  test("same idempotency key cannot rewrite content and old head cannot overwrite a new revision", async () => {
    const item = await fixture(), first = await json<PromptCurationReceipt>(await post(item), 201);
    await error(await post(item, { ...item.input, content: { ...item.input.content, title: "different" } }), 409, "idempotency_conflict");
    const edit = { ...revisionBasis(item, first), action: "edit", content: { ...item.input.content, title: "second" } };
    await json(await revise(item, edit), 201);
    await error(await revise(item, { ...edit, content: { ...edit.content, title: "different" } }), 409, "idempotency_conflict");
    await error(await revise(item, { ...revisionBasis(item, first), action: "archive" }), 409, "prompt_curation_conflict");
    expect(count("v2_link_curation_revisions")).toBe(2);
  });
  test("source snapshot advancement leaves history readable but prevents writes through stale basis", async () => {
    const item = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201);
    await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId,
      expectedSnapshotId: item.input.expectedSnapshotId, expectedSnapshotVersion: 1, sourceItemIds: item.projection.members.map((row) => row.sourceItemId), idempotencyKey: "next" });
    expect(await json(await get(item))).toMatchObject({ isHistorical: true });
    expect(await json(await list(item.capture.objectId, `?snapshotId=${item.input.expectedSnapshotId}`))).toMatchObject({ isHistorical: true, items: [{ id: saved.item.id }] });
    expect((await copy(item, saved.item.id)).status).toBe(200);
    await error(await revise(item, { ...revisionBasis(item, saved), action: "archive" }), 409);
  });
  test("HTTP cursors cross 50 groups and 50 versions without duplicates and reject another cursor scope", async () => {
    const item = await fixture(), first = await json<PromptCurationReceipt>(await post(item), 201);
    let latest = first;
    for (let index = 1; index < 51; index++) {
      latest = await json<PromptCurationReceipt>(await revise(item, { ...revisionBasis(item, latest), action: "edit",
        content: { ...item.input.content, title: `revision ${index + 1}` } }), 201);
      await json(await post(item, { ...item.input, groupKey: `group-${index}`, idempotencyKey: `group-${index}` }), 201);
    }
    const groups: string[] = [], versions: number[] = [];
    let groupCursor: string | null = null, historyCursor: string | null = null, firstGroupCursor = "", firstHistoryCursor = "";
    do {
      const page: PromptCurationPage = await json<PromptCurationPage>(await list(item.capture.objectId, groupCursor ? `?cursor=${encodeURIComponent(groupCursor)}` : ""));
      expect(page.items.length).toBeLessThanOrEqual(20); groups.push(...page.items.map((row) => row.groupKey));
      groupCursor = page.nextCursor; firstGroupCursor ||= groupCursor ?? "";
    } while (groupCursor);
    do {
      const detail: PromptCurationDetail = await json<PromptCurationDetail>(await get(item, historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}` : ""));
      expect(detail.item.id).toBe(latest.item.id); expect(detail.history.items.length).toBeLessThanOrEqual(20);
      versions.push(...detail.history.items.map((row) => row.revisionNumber)); historyCursor = detail.history.nextCursor; firstHistoryCursor ||= historyCursor ?? "";
    } while (historyCursor);
    expect(groups).toHaveLength(51); expect(new Set(groups).size).toBe(51);
    expect(versions).toEqual(Array.from({ length: 51 }, (_, index) => 51 - index));
    await error(await get(item, `?cursor=${encodeURIComponent(firstGroupCursor)}`), 400, "prompt_curation_cursor_invalid");
    await error(await list(item.capture.objectId, `?cursor=${encodeURIComponent(firstHistoryCursor)}`), 400, "prompt_curation_cursor_invalid");
    await error(await get(item, `?cursor=${encodeURIComponent(firstHistoryCursor)}`, "group-1"), 400, "prompt_curation_cursor_invalid");
    const other = await fixture(); await error(await list(other.capture.objectId, `?cursor=${encodeURIComponent(firstGroupCursor)}`), 400);
  }, 15_000);
  test.each(["source", "privacy", "fragment"])("HTTP save rolls back the entire curation when %s changes at final batch", async (kind) => {
    const item = await fixture(); let fired = false;
    db.beforeBatch = () => {
      db.beforeBatch = null; fired = true;
      if (kind === "source") db.sql.prepare("update v2_source_items set raw_text='changed after preparation' where id=?").run(item.projection.members[0].sourceItemId);
      if (kind === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      if (kind === "fragment") db.sql.prepare("update v2_link_fragments set state_version=state_version+1 where id=?").run(item.fragment.item.id);
    };
    await error(await post(item), kind === "privacy" ? 423 : 409); expect(fired).toBe(true); noCuration();
  });
  test.each(["?unknown=1", "?snapshotId=", "?snapshotId=a&snapshotId=b", "?cursor=", "?cursor=a&cursor=b", "?cursor=garbage", "?snapshotId=%00"])("list rejects unsupported/duplicate/invalid query %s", async (query) => {
    const item = await fixture(); await error(await list(item.capture.objectId, query), 400);
  });
  test.each(["?unknown=1", "?revisionId=", "?revisionId=a&revisionId=b", "?cursor=", "?cursor=a&cursor=b", "?cursor=garbage", "?revisionId=%00"])("detail rejects unsupported/duplicate/invalid query %s", async (query) => {
    const item = await fixture(); await post(item); await error(await get(item, query), 400);
  });
  test.each(["", "?channel=", "?channel=insight", "?channel=Prompt", "?channel=prompt&channel=parameters", "?channel=prompt&mode=", "?channel=prompt&mode=auto", "?channel=prompt&mode=standard&mode=available_only", "?channel=prompt&restrictedUnlocked=1"])("copy rejects ambiguous/invalid query %s", async (query) => {
    const item = await fixture(), saved = await json<PromptCurationReceipt>(await post(item), 201); await error(await copy(item, saved.item.id, query), 400);
  });
  test.each(["create", "revise"])("%s bounds streamed JSON bytes and rejects malformed shapes without writes", async (kind) => {
    const item = await fixture(), headers = { "Content-Type": "application/json", Origin: origin };
    const invoke = (body: string, extra: Record<string, string> = {}) => {
      const req = new Request(`${origin}${base(item.capture.objectId)}`, { method: "POST", headers: { ...headers, ...extra }, body });
      return kind === "create" ? POST(req, { params: Promise.resolve({ recordId: item.capture.objectId }) })
        : REVISE(req, { params: Promise.resolve({ recordId: item.capture.objectId, groupKey: item.input.groupKey }) });
    };
    for (const body of ["{", "[]", "null", '"text"']) await error(await invoke(body), 400);
    await error(await invoke(JSON.stringify(item.input), { "Content-Length": String(PROMPT_CURATION_REQUEST_BYTES + 1) }), 413);
    await error(await invoke(JSON.stringify({ huge: "x".repeat(PROMPT_CURATION_REQUEST_BYTES) }), { "Content-Length": "1" }), 413);
    await error(await invoke(JSON.stringify({ huge: "한".repeat(90_000) })), 413); noCuration();
  });
  test("schema 0031 returns 503 privately without mutating or silently initializing storage", async () => {
    db.sql.close(); db = new LinkSqlite(31); harness.bindings.mockReturnValue({ db });
    await error(await list("synthetic"), 503, "prompt_curation_schema_unavailable");
    expect(db.sql.prepare("select name from sqlite_master where name='v2_link_curation_revisions'").get()).toBeUndefined();
  });
  test("unexpected SQL failure returns only a private generic error and rolls back the entire mutation", async () => {
    const item = await fixture(); db.sql.exec("create trigger fail_http_curation before insert on v2_idempotency_records when NEW.operation='prompt_curation.create.v1' begin select raise(abort,'SECRET SYNTHETIC SQL DETAIL'); end");
    const response = await post(item); await error(response, 500, "internal_error"); noCuration();
  });
});
