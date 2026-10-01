import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings }));
import { GET, POST } from "@/app/api/v2/records/[recordId]/links/curations/[groupKey]/revisions/[revisionId]/migration/route";
import { canonicalLinkJson, linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { parseMigratePromptCurationRequest, type CreatePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { planPromptCurationMigration, type PromptCurationMigrationPlan } from "@/lib/v2/domain/prompt-curation-migration";
import { loadCurationCatalog } from "@/lib/v2/infrastructure/d1/prompt-curation-catalog";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";
import { exactLinkGateway } from "../../support/link-sqlite";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";

let db: LinkSqlite;
const origin = "https://lighthouse.test", expiry = "2099-01-01T00:00:00Z";
const repo = (binding: D1DatabaseBinding = db, user = "link-owner") => new D1PromptCurationRepository(binding, user);
beforeEach(() => {
  db = new LinkSqlite(32);
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "0");
  harness.session.mockResolvedValue({ sessionId: "migration-test", userId: "link-owner", email: "fixture@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db });
});
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function seedCoverage(coverage: "complete" | "partial" | "ocr_unverified") {
  const rawText = "  exact prompt 👀\r\n--ar 3:2\n";
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "AI range coverage fixture", bodyMarkdown: "PRIVATE MEMO",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(), sources: [{ kind: "url", rawText,
      contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://example.test/source", purpose: "prompt", completeness: coverage }) }] }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner"), projection = await snapshots.bootstrapManualSources({
    documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID() });
  return { capture, snapshots, projection, rawText, sources: projection.members.map((member) => ({ id: member.sourceItemId })) };
}
async function fixture(mode: "same" | "missing" | "duplicate" | "replacement" = "same", restricted = false, itemCount = 2, ai = false,
  coverage: "unknown" | "complete" | "partial" | "ocr_unverified" = "unknown") {
  const base = coverage === "unknown" ? await seedLinkRecord(db, { privacyLevel: restricted ? "restricted" : "normal" }) : await seedCoverage(coverage),
    { capture, projection, snapshots, rawText } = base;
  const options = { restrictedGrantExpiresAt: restricted ? expiry : undefined };
  const fragment = await new D1ManualLinkFragmentRepository(db, "link-owner").create(capture.objectId, {
    expectedRevisionId: capture.revisionId, expectedSnapshotId: projection!.snapshot.id, expectedManifestHash: projection!.snapshot.manifestHash,
    memberId: projection!.members[0].id, textStart: 0, textEnd: rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  }, options);
  let fragmentId = fragment.item.id;
  if (ai) {
    const links = new D1LinkAnalysisRepository(db);
    await links.enqueue("link-owner", { documentId: capture.objectId, expectedRevisionId: capture.revisionId,
      expectedSnapshotId: projection!.snapshot.id, expectedManifestHash: projection!.snapshot.manifestHash });
    expect(await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), governor: new D1AiRuntimeGovernor(db),
      gateway: exactLinkGateway(), workerId: "migration-fixture" })).toMatchObject({ outcome: "succeeded" });
    fragmentId = (db.sql.prepare("select id from v2_link_fragments where processing_run_id is not null and document_object_id=?").get(capture.objectId) as { id: string }).id;
  }
  const input: CreatePromptCurationRequest = { expectedRevisionId: capture.revisionId, expectedSnapshotId: projection!.snapshot.id,
    expectedManifestHash: projection!.snapshot.manifestHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "이관 원본", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "unconfirmed",
      items: Array.from({ length: itemCount }, (_, position) => ({ itemKey: `item-${position}`, fragmentId,
        expectedFragmentStateVersion: 1, copyRole: "prompt" as const, position })), examples: [] } };
  const saved = await repo().create(capture.objectId, input, options);
  const newSource = { rawText: mode === "missing" ? "unrelated" : rawText, metadata: makeManualLinkMetadata({ url: "https://example.test/source", purpose: "prompt" }) };
  const target = await snapshots.createSnapshot({ documentId: capture.objectId, expectedRevisionId: capture.revisionId,
    expectedSnapshotId: projection!.snapshot.id, expectedSnapshotVersion: 1,
    sourceItemIds: mode === "same" ? projection!.members.map((row) => row.sourceItemId) : [],
    newManualSources: mode === "same" ? [] : mode === "duplicate" ? [newSource, newSource] : [newSource],
    idempotencyKey: crypto.randomUUID(), restrictedUnlocked: restricted });
  const plan = await repo().previewMigration(capture.objectId, input.groupKey, saved.item.id, options);
  const request = { expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId,
    expectedManifestHash: plan.expectedManifestHash, expectedPlanHash: plan.planHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
  return { ...base, options, input, saved, target, plan, request };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const migrate = (item: Fixture, binding: D1DatabaseBinding = db, value: unknown = item.request) => repo(binding).migrate(item.capture.objectId, item.input.groupKey, item.saved.item.id, value, item.options);
const counts = () => ["v2_link_curation_revisions", "v2_link_curation_items", "v2_link_fragments", "v2_link_fragment_evidence", "v2_idempotency_records", "v2_audit_events"].map((name) => db.sql.prepare(`select count(*) as n from ${name}`).get()!.n);
function route(item: Fixture, method: "GET" | "POST", value: unknown = item.request, query = "", headers: Record<string, string> = {}) {
  const path = `${origin}/api/v2/records/${item.capture.objectId}/links/curations/${item.input.groupKey}/revisions/${item.saved.item.id}/migration${query}`;
  return (method === "GET" ? GET : POST)(new Request(path, method === "GET" ? undefined : { method, headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) }),
    { params: Promise.resolve({ recordId: item.capture.objectId, groupKey: item.input.groupKey, revisionId: item.saved.item.id }) });
}
function concurrentBinding() {
  let arrivals = 0, release!: () => void, tail: Promise<unknown> = Promise.resolve();
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { prepare: (query: string) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
    if (++arrivals === 2) release(); await ready;
    const result = tail.then(() => db.batch<T>(statements)); tail = result.catch(() => {}); return result;
  } } satisfies D1DatabaseBinding;
}

describe("explicit snapshot migration: actual SQLite and HTTP", () => {
  test.each([1, 64])("repository SQL work stays bounded for %i items", async (itemCount) => {
    const item = await fixture("same", false, itemCount); let statements = 0;
    const binding: D1DatabaseBinding = { prepare(query) {
      let actual = db.prepare(query);
      const statement: D1PreparedStatementBinding = { bind(...values) { actual = actual.bind(...values); return statement; },
        first<T>() { statements++; return actual.first<T>(); }, all<T>() { statements++; return actual.all<T>(); }, run() { statements++; return actual.run(); } };
      return statement;
    }, batch: (values) => db.batch(values) };
    await migrate(item, binding);
    console.info(`migration repository statements (${itemCount} items): ${statements}; excludes HTTP authentication`);
    expect(statements).toBeLessThanOrEqual(40);
  });
  test.each(["unknown", "complete", "partial", "ocr_unverified"] as const)("an AI-selected range retains %s source scope with new locked manual evidence", async (coverage) => {
    const item = await fixture("same", false, 1, true, coverage), beforeJobs = db.sql.prepare("select * from v2_processing_jobs").all();
    expect(item.saved.item.items[0].fragment.selectionOrigin).toBe("ai_selected");
    const result = await migrate(item);
    expect(item.plan.selectionConfirmations).toEqual(["item-0"]);
    expect(result.item.items[0].fragment).toEqual({ ...item.saved.item.items[0].fragment, selectionOrigin: "user_selected", completeness: coverage });
    expect(result.item.prepared.channels.prompt.warnings).toContain(coverage === "unknown" ? "unknown_source_completeness"
      : coverage === "partial" ? "partial_source" : coverage === "ocr_unverified" ? "ocr_unverified" : "unknown_total_parts");
    expect(result.item.prepared.channels.prompt.warnings).not.toContain("selection_unverified");
    expect(db.sql.prepare("select processing_run_id,locked_by_user,state_version,review_status from v2_link_fragments where id=?")
      .get(result.item.content.items[0].fragmentId)).toEqual({ processing_run_id: null, locked_by_user: 1, state_version: 1, review_status: "confirmed" });
    expect(db.sql.prepare("select * from v2_processing_jobs").all()).toEqual(beforeJobs);
  });
  test("migrated groups can be edited and migrated again with all role channels separate", async () => {
    const item = await fixture(), first = await migrate(item), extra = [];
    for (const [index, role] of (["negative_prompt", "parameters"] as const).entries()) {
      const fragment = await new D1ManualLinkFragmentRepository(db, "link-owner").create(item.capture.objectId, {
        expectedRevisionId: item.capture.revisionId, expectedSnapshotId: item.target.snapshot.id, expectedManifestHash: item.target.snapshot.manifestHash,
        memberId: item.target.members[0].id, textStart: index * 3, textEnd: index * 3 + 3, role, idempotencyKey: crypto.randomUUID(),
      });
      extra.push({ itemKey: role, fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: role, position: 0 });
    }
    const edited = await repo().revise(item.capture.objectId, first.item.groupKey, { expectedRevisionId: item.capture.revisionId,
      expectedSnapshotId: item.target.snapshot.id, expectedManifestHash: item.target.snapshot.manifestHash,
      expectedCurationRevisionId: first.item.id, expectedCurationRevisionNumber: 1, action: "edit", idempotencyKey: crypto.randomUUID(),
      content: { ...first.item.content, orderConfirmation: "user_confirmed", items: [...first.item.content.items, ...extra] } });
    await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId,
      expectedSnapshotId: item.target.snapshot.id, expectedSnapshotVersion: 2, sourceItemIds: item.target.members.map((row) => row.sourceItemId), idempotencyKey: crypto.randomUUID() });
    const plan = await repo().previewMigration(item.capture.objectId, edited.item.groupKey, edited.item.id);
    const second = await repo().migrate(item.capture.objectId, edited.item.groupKey, edited.item.id, { expectedRevisionId: plan.expectedRevisionId,
      expectedSnapshotId: plan.expectedSnapshotId, expectedManifestHash: plan.expectedManifestHash, expectedPlanHash: plan.planHash,
      groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
    expect(second.item.basedOnRevisionId).toBe(edited.item.id);
    expect((await repo().copy(item.capture.objectId, second.item.groupKey, second.item.id, { role: "prompt", mode: "available_only" })).text).toBe([item.rawText, item.rawText].join("\n"));
    expect((await repo().copy(item.capture.objectId, second.item.groupKey, second.item.id, { role: "negative_prompt", mode: "available_only" })).text).toBe(item.rawText.slice(0, 3));
    expect((await repo().copy(item.capture.objectId, second.item.groupKey, second.item.id, { role: "parameters", mode: "available_only" })).text).toBe(item.rawText.slice(3, 6));
    expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  });
  test.each(["same", "replacement"] as const)("preserves every duplicate, bytes, warnings and origin through %s matching", async (mode) => {
    const item = await fixture(mode), before = counts(), result = await migrate(item);
    expect(item.plan.ready).toBe(true); expect(item.plan.items).toHaveLength(2);
    expect(item.plan.items[0].match).toBe(mode === "same" ? "member_key" : "fingerprint");
    expect(result.item).toMatchObject({ changeReason: "migrate", revisionNumber: 1, parentRevisionId: null, basedOnRevisionId: item.saved.item.id,
      status: "active", snapshotId: item.target.snapshot.id });
    expect(result.item.items.map((entry) => entry.fragment.rawText)).toEqual([item.rawText, item.rawText]);
    expect(result.item.items.every((entry) => entry.fragment.selectionOrigin === "user_selected")).toBe(true);
    expect(result.item.content.orderConfirmation).toBe("unconfirmed");
    expect(result.item.prepared.channels.prompt.warnings).toEqual(item.saved.item.prepared.channels.prompt.warnings);
    expect(new Set(result.item.content.items.map((entry) => entry.fragmentId)).size).toBe(1);
    expect(result.item.content.items[0].fragmentId).not.toBe(item.input.content.items[0].fragmentId);
    expect(counts().slice(0, 4)).toEqual([2, 4, 2, 2]);
    expect((await repo().get(item.capture.objectId, item.input.groupKey)).item).toEqual(item.saved.item);
    expect((await migrate(item)).item).toEqual(result.item); expect(counts().slice(0, 4)).toEqual([2, 4, 2, 2]);
    expect(before.slice(0, 4)).toEqual([1, 2, 1, 1]);
  });
  test.each(["missing", "duplicate"] as const)("reports %s and never drops items or chooses a candidate", async (mode) => {
    const item = await fixture(mode), before = counts();
    expect(item.plan).toMatchObject({ ready: false, items: [] });
    expect(item.plan.issues).toEqual([0, 1].map((n) => ({ kind: "item", key: `item-${n}`, reason: mode === "missing" ? "missing" : "ambiguous" })));
    await expect(migrate(item)).rejects.toMatchObject({ code: "prompt_curation_migration_conflict" }); expect(counts()).toEqual(before);
  });
  test("same snapshot preview is read-only and blocked", async () => {
    const item = await fixture();
    db.sql.prepare("update v2_documents set current_link_snapshot_id=? where object_id=?").run(item.projection!.snapshot.id, item.capture.objectId);
    const plan = await repo().previewMigration(item.capture.objectId, item.input.groupKey, item.saved.item.id);
    expect(plan.ready).toBe(false); expect(plan.issues[0].reason).toBe("same_snapshot");
  });
  test.each(["source", "target", "privacy", "snapshot", "receipt"])("%s changes at atomic boundary cannot leave partial migration", async (kind) => {
    const item = await fixture("replacement"), before = counts();
    db.beforeBatch = () => {
      db.beforeBatch = null;
      if (kind === "source" || kind === "target") db.sql.prepare("update v2_source_items set raw_text='changed' where id=?")
        .run(kind === "source" ? item.projection!.members[0].sourceItemId : item.target.members[0].sourceItemId);
      else if (kind === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      else if (kind === "snapshot") db.sql.prepare("update v2_documents set current_link_snapshot_id=? where object_id=?").run(item.projection!.snapshot.id, item.capture.objectId);
      else db.sql.exec("create trigger migration_receipt_failure before insert on v2_idempotency_records when NEW.operation='prompt_curation.migrate.v1' begin select raise(abort,'migration injected final failure'); end");
    };
    await expect(migrate(item)).rejects.toBeDefined(); expect(counts()).toEqual(before);
  });
  test.each(["same", "different"])("concurrent %s request keys create just one group and manual fragment", async (kind) => {
    const item = await fixture(), binding = concurrentBinding();
    const results = await Promise.allSettled([migrate(item, binding), migrate(item, binding, kind === "same" ? item.request : { ...item.request, idempotencyKey: crypto.randomUUID() })]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(kind === "same" ? 2 : 1);
    expect(counts().slice(0, 4)).toEqual([2, 4, 2, 2]);
  });
  test("response loss replays the same result even after a later snapshot", async () => {
    const item = await fixture(); let lost = false;
    const binding: D1DatabaseBinding = { prepare: (query) => db.prepare(query), async batch(statements) {
      const value = await db.batch(statements); lost = true; throw Object.assign(new Error("lost response"), { value });
    } };
    // Repository recovers a post-commit failure from its original request receipt.
    const result = await migrate(item, binding); expect(lost).toBe(true); expect(result.replayed).toBe(true);
    await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.capture.revisionId,
      expectedSnapshotId: item.target.snapshot.id, expectedSnapshotVersion: 2, sourceItemIds: item.target.members.map((entry) => entry.sourceItemId), idempotencyKey: crypto.randomUUID() });
    expect((await migrate(item)).item).toEqual(result.item);
  });
  test("a valid sibling receipt cannot be substituted", async () => {
    const item = await fixture(), saved = await migrate(item);
    db.sql.prepare("update v2_idempotency_records set response_json=? where operation='prompt_curation.migrate.v1'").run(canonicalLinkJson({ revisionId: item.saved.item.id }));
    await expect(migrate(item)).rejects.toMatchObject({ code: "prompt_curation_not_found" });
    expect(saved.item.id).not.toBe(item.saved.item.id);
  });
  test("64 duplicate items need one new fragment and retain all positions", async () => {
    const item = await fixture("same", false, 64), result = await migrate(item);
    expect(result.item.content.items.map((entry) => entry.position)).toEqual(Array.from({ length: 64 }, (_, n) => n));
    expect(counts().slice(0, 4)).toEqual([2, 128, 2, 2]);
  });
  test("preview GET and explicit POST are private, no-store and work with AI disabled", async () => {
    const item = await fixture(), before = counts(), preview = await route(item, "GET");
    expect(preview.status).toBe(200); expect(await preview.json()).toEqual(item.plan); expect(counts()).toEqual(before);
    const created = await route(item, "POST"), replay = await route(item, "POST");
    expect(created.status).toBe(201); expect(replay.status).toBe(200);
    for (const response of [preview, created, replay]) expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  test.each(["owner", "grant", "unauthenticated", "write_flag", "origin", "query", "extra", "plan"])("HTTP rejects %s without writes", async (kind) => {
    const item = await fixture("same", kind === "grant"), before = counts();
    if (kind === "owner") harness.session.mockResolvedValue({ userId: "other-owner", expiresAt: Date.now() + 60_000 });
    if (kind === "unauthenticated") harness.session.mockResolvedValue(null);
    if (kind === "write_flag") vi.stubEnv("FLAG_V2_WRITE", "0");
    const response = await route(item, "POST", kind === "extra" ? { ...item.request, rawText: "invented" } : kind === "plan"
      ? { ...item.request, expectedPlanHash: "f".repeat(64) } : item.request, kind === "query" ? "?foo=bar" : "", kind === "origin" ? { Origin: "https://foreign.test" } : {});
    const expectedStatus: Record<string, number> = { owner: 404, grant: 423, unauthenticated: 401, write_flag: 503, origin: 403, query: 400, extra: 400, plan: 409 };
    expect(response.status).toBe(expectedStatus[kind]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(counts()).toEqual(before);
  });
  test("restricted grant is rechecked after commit and before receipt replay", async () => {
    const item = await fixture("same", true), grantExpiry = new Date(Date.now() + 60_000).toISOString();
    const binding: D1DatabaseBinding = { prepare: (query) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
      const result = await db.batch<T>(statements); vi.spyOn(Date, "now").mockReturnValue(Date.parse(grantExpiry) + 1); return result;
    } };
    await expect(repo(binding).migrate(item.capture.objectId, item.input.groupKey, item.saved.item.id, item.request,
      { restrictedGrantExpiresAt: grantExpiry })).rejects.toMatchObject({ code: "restricted_record_locked" });
    expect(counts().slice(0, 4)).toEqual([2, 4, 2, 2]);
    vi.restoreAllMocks(); expect((await migrate(item)).replayed).toBe(true);
  });
  test("a new attachment added after planning is fenced even when no image was selected", async () => {
    const item = await fixture("replacement"), now = new Date().toISOString(), attachmentId = crypto.randomUUID();
    db.sql.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
      values(?,'link-owner','verified',?,'late.png','image/png',8,?,?,'2099-01-01T00:00:00Z',?)`)
      .run(attachmentId, `fixture/${attachmentId}`, "b".repeat(64), now, now);
    const before = counts();
    db.beforeBatch = () => { db.beforeBatch = null;
      db.sql.prepare("insert into v2_source_attachment_links(user_id,source_item_id,attachment_id,created_at) values('link-owner',?,?,?)")
        .run(item.target.members[0].sourceItemId, attachmentId, now);
    };
    await expect(migrate(item)).rejects.toMatchObject({ code: "prompt_curation_migration_conflict" }); expect(counts()).toEqual(before);
  });
  test.each(["member_key_changed", "range_changed", "coverage_changed"])("pure matching blocks %s without approximate fallback", async (kind) => {
    const item = await fixture(), source = await loadCurationCatalog(db, "link-owner", item.capture.objectId, item.projection!, item.saved.item.content, false);
    const targets = item.target.members.map((member, index) => index ? member : kind === "member_key_changed"
      ? { ...member, sourceFingerprint: "c".repeat(64) } : kind === "range_changed" ? { ...member, rawText: "different raw text" }
        : { ...member, manualLink: { ...member.manualLink!, completeness: "complete" as const } });
    const p = item.plan;
    const plan = await planPromptCurationMigration({ recordId: p.recordId, sourceGroupKey: p.sourceGroupKey, sourceRevisionId: p.sourceRevisionId,
      sourceSnapshotId: p.sourceSnapshotId, sourceManifestHash: p.sourceManifestHash, expectedRevisionId: p.expectedRevisionId,
      expectedSnapshotId: p.expectedSnapshotId, expectedManifestHash: p.expectedManifestHash }, item.saved.item.content, source.input, targets);
    expect(plan.ready).toBe(false); expect(plan.items).toHaveLength(0);
    expect(plan.issues.every((issue) => issue.reason === (kind === "member_key_changed" ? "changed" : kind))).toBe(true);
  });
});

describe("migration parser captures only bounded identity claims", () => {
  const valid = () => ({ expectedRevisionId: "revision", expectedSnapshotId: "snapshot", expectedManifestHash: "a".repeat(64),
    expectedPlanHash: "b".repeat(64), groupKey: "group", idempotencyKey: "request" });
  test("fresh deep capture", () => { const input = valid(), parsed = parseMigratePromptCurationRequest(input); input.groupKey = "changed"; expect(parsed.groupKey).toBe("group"); });
  test.each(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "expectedPlanHash", "groupKey", "idempotencyKey"])("rejects missing %s and getters without invoking them", (key) => {
    const input = valid() as Record<string, unknown>; delete input[key]; expect(() => parseMigratePromptCurationRequest(input)).toThrow();
    const getter = vi.fn(() => "value"); Object.defineProperty(input, key, { get: getter }); expect(() => parseMigratePromptCurationRequest(input)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  test.each(["", "a".repeat(201), "bad\u0000key", "\ud800"])("rejects malformed ID %j", (groupKey) => expect(() => parseMigratePromptCurationRequest({ ...valid(), groupKey })).toThrow());
  test.each([null, [], Object.create({ groupKey: "inherited" }), { ...valid(), content: {} }, { ...valid(), expectedPlanHash: "B".repeat(64) }])("rejects noncontract request %#", (value) => expect(() => parseMigratePromptCurationRequest(value)).toThrow());
  test("plan digest is a digest of exact preview fields", async () => {
    const item = await fixture(), { planHash, ...fields } = item.plan as PromptCurationMigrationPlan;
    expect(planHash).toBe(await linkSha256Hex(canonicalLinkJson(fields)));
  });
});
