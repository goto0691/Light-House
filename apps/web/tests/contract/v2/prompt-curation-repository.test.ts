import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { canonicalLinkJson, linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { CreatePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { curationCatalogFence, loadCurationCatalog } from "@/lib/v2/infrastructure/d1/prompt-curation-catalog";
import { D1PromptCurationRepository, revisionFence } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { exactLinkGateway, LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(32); });
afterEach(() => { db.sql.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
const repo = (binding: D1DatabaseBinding = db, user = "link-owner") => new D1PromptCurationRepository(binding, user);
async function imageRecord() {
  const now = new Date().toISOString(), attachmentId = crypto.randomUUID(), imageHash = "b".repeat(64), rawText = "  exact prompt 👀\r\n--ar 3:2\n";
  // Synthetic pre-verified reservation: this exercises DB image membership and
  // commitment, not R2 transport, image decoding, or provider access.
  db.sql.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
    values(?,'link-owner','verified',?,'example.png','image/png',8,?,?,'2099-01-01T00:00:00.000Z',?)`)
    .run(attachmentId, `fixture/${attachmentId}.png`, imageHash, now, now);
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Image example", bodyMarkdown: "PRIVATE MEMO", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now,
    sources: [{ kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://example.test/source", purpose: "prompt" }) },
      { kind: "image", contentHash: `sha256:${imageHash}`, attachmentId }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner");
  const projection = await snapshots.bootstrapManualSources({ documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID() });
  return { capture, snapshots, projection, rawText };
}
async function fixture(withImage = false) {
  const base = withImage ? await imageRecord() : await seedLinkRecord(db), member = base.projection!.members[0];
  const fragment = await new D1ManualLinkFragmentRepository(db, "link-owner").create(base.capture.objectId, {
    expectedRevisionId: base.capture.revisionId, expectedSnapshotId: base.projection!.snapshot.id,
    expectedManifestHash: base.projection!.snapshot.manifestHash, memberId: member.id,
    textStart: 0, textEnd: base.rawText.length, role: "prompt", idempotencyKey: crypto.randomUUID(),
  });
  const input: CreatePromptCurationRequest = { expectedRevisionId: base.capture.revisionId, expectedSnapshotId: base.projection!.snapshot.id,
    expectedManifestHash: base.projection!.snapshot.manifestHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    content: { title: "내가 연결한 프롬프트", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [{ itemKey: "first", fragmentId: fragment.item.id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 }], examples: [] } };
  return { ...base, fragment, input };
}
function counts() {
  return ["v2_link_curation_revisions", "v2_link_curation_items", "v2_link_curation_examples"].map((name) => (db.sql.prepare(`select count(*) as n from ${name}`).get() as { n: number }).n);
}
function reviseInput(input: CreatePromptCurationRequest, head: { id: string; revisionNumber: number }) {
  return { expectedRevisionId: input.expectedRevisionId, expectedSnapshotId: input.expectedSnapshotId, expectedManifestHash: input.expectedManifestHash,
    expectedCurationRevisionId: head.id, expectedCurationRevisionNumber: head.revisionNumber, idempotencyKey: crypto.randomUUID() };
}
function instrument(onRead: (query: string) => void = () => {}) {
  let statements = 0;
  const binding: D1DatabaseBinding = {
    prepare(query) {
      let actual = db.prepare(query);
      const statement: D1PreparedStatementBinding = {
        bind(...values) { actual = actual.bind(...values); return statement; },
        async first<T>() { statements++; const value = await actual.first<T>(); onRead(query); return value; },
        async all<T>() { statements++; const value = await actual.all<T>(); onRead(query); return value; },
        run() { statements++; return actual.run(); },
      }; return statement;
    }, batch: (values) => db.batch(values),
  };
  return { binding, get statements() { return statements; } };
}
/** D1 serializes transactions; hold the first until both requests have reached
 * their transaction boundary, then execute each real SQLite batch in order. */
function concurrentBinding() {
  let arrivals = 0, release!: () => void, tail: Promise<unknown> = Promise.resolve();
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { prepare: (query: string) => db.prepare(query), async batch<T>(statements: D1PreparedStatementBinding[]) {
    if (++arrivals === 2) release();
    await ready;
    const result = tail.then(() => db.batch<T>(statements)); tail = result.catch(() => {}); return result;
  } } satisfies D1DatabaseBinding;
}

describe("stored curations: actual 0032 SQL, immutable versions and exact source", () => {
  test("whole and per-item image examples retain their own confirmation and survive ordered replay", async () => {
    const item = await fixture(true), image = item.projection!.members.find((member) => member.kind === "image")!, meter = instrument();
    const input: CreatePromptCurationRequest = { ...item.input, content: { ...item.input.content,
      items: [{ ...item.input.content.items[0], itemKey: "second", position: 1 }, item.input.content.items[0]],
      examples: Array.from({ length: 64 }, (_, position) => ({ exampleKey: `example-${position}`, itemKey: position === 0 ? null : position % 2 ? "first" : "second",
        memberId: image.id, attachmentId: image.attachments[0].id, position, evidenceMethod: position === 0 ? "unresolved" as const : "user_confirmed" as const })).reverse(),
    } };
    const saved = await repo(meter.binding).create(item.capture.objectId, input);
    expect(meter.statements).toBeLessThanOrEqual(35); expect(counts()).toEqual([1, 2, 64]);
    const loaded = await repo().get(item.capture.objectId, input.groupKey);
    expect(loaded.item.prepared).toEqual(saved.item.prepared);
    expect(loaded.item.examples[0]).toMatchObject({ itemKey: null, evidenceMethod: "unresolved" });
    expect((await repo().create(item.capture.objectId, input)).replayed).toBe(true);
    const copy = await repo().copy(item.capture.objectId, input.groupKey, saved.item.id, { role: "prompt", mode: "available_only" });
    expect(copy.text).toBe([item.rawText, item.rawText].join("\n")); expect(copy.warnings).toContain("image_pair_unconfirmed");
    const undoRequest = { ...reviseInput(input, saved.item), action: "archive" };
    const archived = await repo().revise(item.capture.objectId, input.groupKey, undoRequest);
    expect((await repo().revise(item.capture.objectId, input.groupKey, undoRequest)).item).toEqual(archived.item);
  });
  test("foreign image membership and revoked image commitment cannot enter a curation", async () => {
    const item = await fixture(true), other = await fixture(true), image = item.projection!.members.find((member) => member.kind === "image")!,
      foreign = other.projection!.members.find((member) => member.kind === "image")!;
    const withExample = (memberId: string, attachmentId: string) => ({ ...item.input, content: { ...item.input.content,
      examples: [{ exampleKey: "example", itemKey: "first", memberId, attachmentId, position: 0, evidenceMethod: "user_confirmed" }] } });
    await expect(repo().create(item.capture.objectId, withExample(foreign.id, foreign.attachments[0].id))).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
    db.beforeBatch = () => {
      db.beforeBatch = null;
      db.sql.prepare("update v2_attachment_reservations set status='verified',committed_at=null where id=?").run(image.attachments[0].id);
    };
    await expect(repo().create(item.capture.objectId, withExample(image.id, image.attachments[0].id))).rejects.toMatchObject({ code: "prompt_curation_conflict" });
    expect(counts()).toEqual([0, 0, 0]);
  });
  test.each(["same key", "different keys"])("two concurrent creates with %s commit once", async (mode) => {
    const item = await fixture(), binding = concurrentBinding();
    const results = await Promise.allSettled([repo(binding).create(item.capture.objectId, item.input), repo(binding).create(item.capture.objectId,
      mode === "same key" ? item.input : { ...item.input, idempotencyKey: crypto.randomUUID() })]);
    expect(counts()).toEqual([1, 1, 0]);
    if (mode === "same key") {
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(new Set(results.flatMap((result) => result.status === "fulfilled" ? [result.value.item.id] : [] )).size).toBe(1);
    } else {
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "prompt_curation_conflict" } });
    }
  });
  test.each(["get", "list", "copy", "replay"])("%s cannot return protected content after its final grant expires", async (operation) => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
    const expiry = Date.now() + 60000, options = { restrictedGrantExpiresAt: new Date(expiry).toISOString() };
    let expired = false;
    const meter = instrument((query) => {
      if (query.includes("as integrity") && query.includes("json_each")) { expired = true; vi.spyOn(Date, "now").mockReturnValue(expiry + 1); }
    });
    const repository = repo(meter.binding);
    const promise = operation === "get" ? repository.get(item.capture.objectId, item.input.groupKey, options)
      : operation === "list" ? repository.list(item.capture.objectId, options)
      : operation === "copy" ? repository.copy(item.capture.objectId, item.input.groupKey, saved.item.id, { role: "prompt", mode: "available_only" }, options)
      : repository.create(item.capture.objectId, item.input, options);
    await expect(promise).rejects.toMatchObject({ code: "restricted_record_locked" }); expect(expired).toBe(true);
  });
  test("historical curations remain readable after a new snapshot, but new writes require current sources", async () => {
    const item = await fixture(), saved = await repo().create(item.capture.objectId, item.input);
    const next = await item.snapshots.createSnapshot({ documentId: item.capture.objectId, expectedRevisionId: item.input.expectedRevisionId,
      expectedSnapshotId: item.input.expectedSnapshotId, expectedSnapshotVersion: 1, sourceItemIds: item.projection!.members.map((member) => member.sourceItemId),
      newManualSources: [{ rawText: "new external text", metadata: makeManualLinkMetadata({ url: "https://example.test/next" }) }], idempotencyKey: crypto.randomUUID() });
    expect((await repo().get(item.capture.objectId, item.input.groupKey)).isHistorical).toBe(true);
    expect((await repo().create(item.capture.objectId, item.input)).item).toEqual(saved.item);
    expect((await repo().list(item.capture.objectId)).items).toHaveLength(0);
    expect((await repo().list(item.capture.objectId, { snapshotId: item.input.expectedSnapshotId })).items).toHaveLength(1);
    await expect(repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, saved.item), action: "archive" })).rejects.toMatchObject({ code: "prompt_curation_conflict" });
    await expect(repo().create(item.capture.objectId, { ...item.input, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      expectedSnapshotId: next.snapshot.id, expectedManifestHash: next.snapshot.manifestHash })).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
  });
  test("a receipt cannot replay a different valid revision of the same group", async () => {
    const item = await fixture(), first = (await repo().create(item.capture.objectId, item.input)).item;
    const request = { ...reviseInput(item.input, first), action: "edit", content: { ...item.input.content, title: "second" } };
    const second = (await repo().revise(item.capture.objectId, item.input.groupKey, request)).item;
    const third = (await repo().revise(item.capture.objectId, item.input.groupKey,
      { ...reviseInput(item.input, second), action: "edit", content: { ...item.input.content, title: "third" } })).item;
    db.sql.prepare("update v2_idempotency_records set response_json=? where idempotency_key=?")
      .run(JSON.stringify({ revisionId: second.id }), item.input.idempotencyKey);
    await expect(repo().create(item.capture.objectId, item.input)).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
    db.sql.prepare("update v2_idempotency_records set response_json=? where idempotency_key=?")
      .run(JSON.stringify({ revisionId: third.id }), request.idempotencyKey);
    await expect(repo().revise(item.capture.objectId, item.input.groupKey, request)).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
    expect(counts()).toEqual([3, 3, 0]);
  });
  test("every catalog proof must match, regardless of the valid proof's position", async () => {
    const item = await fixture(), catalog = await loadCurationCatalog(db, "link-owner", item.capture.objectId, item.projection!, item.input.content, true);
    const corrupt = { ...catalog.proof, manifestHash: "0".repeat(64) };
    for (const proofs of [[catalog.proof, corrupt], [corrupt, catalog.proof]]) {
      expect(await db.prepare(`select ${curationCatalogFence()} as valid from v2_documents d join v2_objects o on o.id=d.object_id where d.object_id=?`)
        .bind(canonicalLinkJson(proofs), item.capture.objectId).first()).toEqual({ valid: 0 });
    }
  });
  test.each(["raw_text", "nullable_metadata", "evidence", "image_commit"])("a valid sibling catalog cannot mask corrupt %s in either order", async (field) => {
    const item = await fixture(true), image = item.projection!.members.find((member) => member.kind === "image")!;
    const content = { ...item.input.content, examples: [{ exampleKey: "image", itemKey: null, memberId: image.id,
      attachmentId: image.attachments[0].id, position: 0, evidenceMethod: "unresolved" as const }] };
    const { proof } = await loadCurationCatalog(db, "link-owner", item.capture.objectId, item.projection!, content, true);
    const corrupt = structuredClone(proof);
    if (field === "raw_text") corrupt.sources.find((source) => source.item_kind === "url")!.raw_text += "changed";
    if (field === "nullable_metadata") {
      const source = corrupt.sources.find((source) => source.item_kind === "image")!;
      expect(source.source_metadata).toBeNull(); source.source_metadata = "null";
    }
    if (field === "evidence") corrupt.fragments[0].evidence_json = "[]";
    if (field === "image_commit") corrupt.images[0].committed_at = "";
    for (const proofs of [[proof], [proof, proof], [proof, corrupt], [corrupt, proof]]) {
      expect(await db.prepare(`select ${curationCatalogFence()} as valid from v2_documents d join v2_objects o on o.id=d.object_id where d.object_id=?`)
        .bind(canonicalLinkJson(proofs), item.capture.objectId).first()).toEqual({ valid: proofs.includes(corrupt) ? 0 : 1 });
    }
  });
  test.each(["row", "item", "example", "count"])("a valid sibling revision cannot mask its changed %s proof", async (field) => {
    const item = await fixture(true), image = item.projection!.members.find((member) => member.kind === "image")!;
    const saved = (await repo().create(item.capture.objectId, { ...item.input, content: { ...item.input.content, examples: [{
      exampleKey: "image", itemKey: null, memberId: image.id, attachmentId: image.attachments[0].id, position: 0, evidenceMethod: "unresolved",
    }] } })).item;
    const proof = { row: db.sql.prepare("select * from v2_link_curation_revisions where id=?").get(saved.id), content: saved.content };
    const corrupt = structuredClone(proof);
    if (field === "row") corrupt.row!.title = "changed";
    if (field === "item") corrupt.content = { ...corrupt.content, items: [{ ...corrupt.content.items[0], fragmentId: "foreign" }] };
    if (field === "example") corrupt.content = { ...corrupt.content, examples: [{ ...corrupt.content.examples[0], itemKey: "first" }] };
    if (field === "count") corrupt.content = { ...corrupt.content, examples: [] };
    for (const proofs of [[proof], [proof, proof], [proof, corrupt], [corrupt, proof]]) {
      expect(await db.prepare(`select ${revisionFence()} as valid from v2_documents d join v2_objects o on o.id=d.object_id where d.object_id=?`)
        .bind(canonicalLinkJson(proofs), item.capture.objectId).first()).toEqual({ valid: proofs.includes(corrupt) ? 0 : 1 });
    }
  });
  test.each(["input_hash", "input_source_manifest_hash", "input_source_manifest_version"])("AI fragments require the originating run's %s to match", async (column) => {
    const item = await fixture(), links = new D1LinkAnalysisRepository(db);
    const enqueued = await links.enqueue("link-owner", { documentId: item.capture.objectId, expectedRevisionId: item.input.expectedRevisionId,
      expectedSnapshotId: item.input.expectedSnapshotId, expectedManifestHash: item.input.expectedManifestHash });
    expect(await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), governor: new D1AiRuntimeGovernor(db),
      gateway: exactLinkGateway(), workerId: "curation-test" })).toMatchObject({ outcome: "succeeded" });
    const fragment = db.sql.prepare("select id,state_version from v2_link_fragments where processing_run_id is not null").get() as { id: string; state_version: number };
    const input = { ...item.input, content: { ...item.input.content, items: [{ ...item.input.content.items[0], fragmentId: fragment.id, expectedFragmentStateVersion: fragment.state_version }] } };
    expect((await repo().create(item.capture.objectId, input)).item.items[0].fragment.selectionOrigin).toBe("ai_selected");
    if (column !== "input_hash") {
      // The existing schema already rejects manifest mutation. Assert that
      // protection before simulating a damaged/imported database without it.
      const change = () => db.sql.prepare(`update v2_processing_jobs set ${column}='corrupt' where id=?`).run(enqueued.jobId);
      expect(change).toThrow("link_job_snapshot_mismatch");
      const triggers = db.sql.prepare("select name from sqlite_master where type='trigger' and tbl_name='v2_processing_jobs' and sql like '%link_job_snapshot_mismatch%'").all() as { name: string }[];
      for (const trigger of triggers) db.sql.exec(`drop trigger "${trigger.name.replaceAll('"', '""')}"`);
    }
    db.sql.prepare(`update v2_processing_jobs set ${column}='corrupt' where id=?`).run(enqueued.jobId);
    await expect(repo().create(item.capture.objectId, input)).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
  });
  test("a damaged foreign item pointer cannot masquerade as a whole-curation image", async () => {
    const item = await fixture(true), image = item.projection!.members.find((member) => member.kind === "image")!;
    const input: CreatePromptCurationRequest = { ...item.input, content: { ...item.input.content, examples: [{
      exampleKey: "whole", itemKey: null, memberId: image.id, attachmentId: image.attachments[0].id, position: 0, evidenceMethod: "unresolved",
    }] } };
    const saved = (await repo().create(item.capture.objectId, input)).item;
    const other = await fixture(), foreign = (await repo().create(other.capture.objectId, other.input)).item;
    const foreignItem = db.sql.prepare("select id from v2_link_curation_items where curation_revision_id=?").get(foreign.id)!.id;
    const damage = () => db.sql.prepare("update v2_link_curation_examples set item_id=? where curation_revision_id=?").run(foreignItem, saved.id);
    expect(damage).toThrow("prompt_curation_immutable");
    // Disposable corruption fixture only: normal immutable/schema safeguards
    // reject this mutation before the repository's final read fence is needed.
    db.sql.exec("drop trigger trg_v2_link_curation_example_immutable"); damage();
    await expect(repo().get(item.capture.objectId, input.groupKey)).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
    await expect(repo().copy(item.capture.objectId, input.groupKey, saved.id, { role: "prompt", mode: "available_only" })).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
    await expect(repo().create(item.capture.objectId, input)).rejects.toMatchObject({ code: "prompt_curation_integrity_invalid" });
  });
  test("55 versions page in revision order even if the clock moves backwards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const clock = Date.now(), item = await fixture();
    let head = (await repo().create(item.capture.objectId, item.input)).item;
    for (let index = 1; index < 55; index++) {
      vi.setSystemTime(clock - index * 1000);
      head = (await repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, head), action: "edit", content: { ...item.input.content, title: `version ${index + 1}` } })).item;
    }
    const versions: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo().get(item.capture.objectId, item.input.groupKey, { cursor });
      expect(page.head.revisionNumber).toBe(55); expect(page.history.items.length).toBeLessThanOrEqual(20);
      versions.push(...page.history.items.map((row) => row.revisionNumber)); cursor = page.history.nextCursor ?? undefined;
    } while (cursor);
    expect(versions).toEqual(Array.from({ length: 55 }, (_, index) => 55 - index));
  }, 15000);
  test("creates, reads, replays and explicitly copies exact fragments without touching originals or starting AI", async () => {
    const item = await fixture(), before = db.sql.prepare("select * from v2_source_items").all();
    const saved = await repo().create(item.capture.objectId, item.input);
    expect(saved).toMatchObject({ contract: "stored-prompt-curation.v1", replayed: false, item: { revisionNumber: 1, parentRevisionId: null, changeReason: "create", status: "active" } });
    expect(saved.item.items[0].fragment.rawText).toBe(item.rawText); expect(counts()).toEqual([1, 1, 0]);
    expect(await repo().create(item.capture.objectId, item.input)).toEqual({ ...saved, replayed: true });
    expect((await repo().get(item.capture.objectId, item.input.groupKey)).item).toEqual(saved.item);
    expect((await repo().list(item.capture.objectId)).items).toMatchObject([{ id: saved.item.id }]);
    await expect(repo().copy(item.capture.objectId, item.input.groupKey, saved.item.id, { role: "prompt", mode: "standard" })).rejects.toMatchObject({ code: "prompt_curation_incomplete_copy_required" });
    expect(await repo().copy(item.capture.objectId, item.input.groupKey, saved.item.id, { role: "prompt", mode: "available_only" }))
      .toMatchObject({ text: item.rawText, kind: "assembled_source_fragments", warnings: expect.arrayContaining(["unknown_total_parts"]) });
    expect(db.sql.prepare("select * from v2_source_items").all()).toEqual(before);
    expect(db.sql.prepare("select count(*) as n from v2_processing_jobs").get()).toEqual({ n: 0 });
  });
  test("edits, undoes and archives by appending revisions while preserving prior material and current document", async () => {
    const item = await fixture(), first = (await repo().create(item.capture.objectId, item.input)).item;
    const edited = (await repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, first), action: "edit", content: { ...item.input.content, title: "두 번째 정리" } })).item;
    const undo = (await repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, edited), action: "undo", restoreRevisionId: first.id })).item;
    expect(undo).toMatchObject({ revisionNumber: 3, parentRevisionId: edited.id, basedOnRevisionId: first.id, title: first.title, changeReason: "undo" });
    const archived = (await repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, undo), action: "archive" })).item;
    const restored = (await repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, archived), action: "unarchive" })).item;
    expect(restored).toMatchObject({ revisionNumber: 5, parentRevisionId: archived.id, status: "active" });
    expect((await repo().get(item.capture.objectId, item.input.groupKey, { revisionId: first.id })).item).toEqual(first);
    expect(counts()).toEqual([5, 5, 0]);
    expect(db.sql.prepare("select current_revision_id from v2_documents where object_id=?").get(item.capture.objectId)).toEqual({ current_revision_id: item.capture.revisionId });
  });
  test("64 intentional duplicate fragments use bounded queries and preserve all copies", async () => {
    const item = await fixture(), meter = instrument(), input = { ...item.input, content: { ...item.input.content,
      items: Array.from({ length: 64 }, (_, position) => ({ ...item.input.content.items[0], itemKey: `item-${position}`, position })) } };
    const saved = await repo(meter.binding).create(item.capture.objectId, input);
    expect(meter.statements).toBeLessThanOrEqual(35); expect(counts()).toEqual([1, 64, 0]);
    expect((await repo().copy(item.capture.objectId, input.groupKey, saved.item.id, { role: "prompt", mode: "available_only" })).text).toBe(Array(64).fill(item.rawText).join("\n"));
  });
  test("same key cannot overwrite another group, title, sequence or request", async () => {
    const item = await fixture(); await repo().create(item.capture.objectId, item.input);
    for (const changed of [{ ...item.input, groupKey: "another" }, { ...item.input, content: { ...item.input.content, title: "changed" } }])
      await expect(repo().create(item.capture.objectId, changed)).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(counts()).toEqual([1, 1, 0]);
  });
  test("foreign record/owner and stale snapshot/head cannot read or write a curation", async () => {
    const item = await fixture(), other = await fixture(), saved = (await repo().create(item.capture.objectId, item.input)).item;
    await expect(repo(db, "other-owner").get(item.capture.objectId, item.input.groupKey)).rejects.toMatchObject({ code: "record_not_found" });
    await expect(repo().get(other.capture.objectId, item.input.groupKey)).rejects.toMatchObject({ code: "prompt_curation_not_found" });
    await expect(repo().create(item.capture.objectId, { ...item.input, idempotencyKey: "new", expectedSnapshotId: other.input.expectedSnapshotId })).rejects.toMatchObject({ code: "prompt_curation_conflict" });
    await expect(repo().revise(item.capture.objectId, item.input.groupKey, { ...reviseInput(item.input, saved), expectedCurationRevisionNumber: 2, action: "archive" })).rejects.toMatchObject({ code: "prompt_curation_conflict" });
    expect(counts()).toEqual([1, 1, 0]);
  });
  test("a failed final receipt rolls back revision, children and audit together", async () => {
    const item = await fixture();
    db.sql.exec("create trigger fail_curation_receipt before insert on v2_idempotency_records when NEW.operation='prompt_curation.create.v1' begin select raise(abort,'synthetic failure'); end");
    await expect(repo().create(item.capture.objectId, item.input)).rejects.toThrow("synthetic failure"); expect(counts()).toEqual([0, 0, 0]);
    expect(db.sql.prepare("select count(*) as n from v2_audit_events where action='link.curation_saved'").get()).toEqual({ n: 0 });
  });
  test.each(["source", "privacy", "fragment"])("the final write fence rejects concurrent %s changes with no partial curation", async (change) => {
    const item = await fixture();
    db.beforeBatch = () => {
      db.beforeBatch = null;
      if (change === "source") db.sql.prepare("update v2_source_items set raw_text='changed' where id=?").run(item.projection!.members[0].sourceItemId);
      if (change === "privacy") db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
      if (change === "fragment") db.sql.prepare("update v2_link_fragments set state_version=state_version+1 where id=?").run(item.fragment.item.id);
    };
    await expect(repo().create(item.capture.objectId, item.input)).rejects.toMatchObject({ code: change === "privacy" ? "restricted_record_locked" : "prompt_curation_conflict" });
    expect(counts()).toEqual([0, 0, 0]);
  });
  test("copy and receipt replay require a live restricted grant and reread source integrity", async () => {
    const item = await fixture(), saved = (await repo().create(item.capture.objectId, item.input)).item;
    db.sql.prepare("update v2_documents set privacy_level='restricted' where object_id=?").run(item.capture.objectId);
    await expect(repo().create(item.capture.objectId, item.input)).rejects.toMatchObject({ code: "restricted_record_locked" });
    const access = { restrictedGrantExpiresAt: new Date(Date.now() + 60000).toISOString() };
    expect((await repo().create(item.capture.objectId, item.input, access)).replayed).toBe(true);
    db.sql.prepare("update v2_source_items set raw_text='changed' where id=?").run(item.projection!.members[0].sourceItemId);
    await expect(repo().copy(item.capture.objectId, item.input.groupKey, saved.id, { role: "prompt", mode: "available_only" }, access)).rejects.toThrow();
  });
});
