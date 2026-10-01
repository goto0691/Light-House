import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { canonicalLinkJson, linkSha256Hex, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import type { StoredManualLinkFragment } from "@/lib/v2/domain/manual-link-fragment-v1";
import { preparePromptCuration, type PromptCurationInput } from "@/lib/v2/domain/prompt-curation-v1";
import type { CreatePromptCurationRequest, PromptCurationContent, RevisePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import type { PromptCurationReceipt, StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";
import type { PromptCurationPending } from "@/lib/v2/editor/prompt-curation-draft";
import type { LinkFragmentEvidenceV1 } from "@/lib/v2/domain/link-fragment-evidence-v1";
import { assertPromptCurationAiEvidence, assertPromptCurationReceipt, type PromptCurationReceiptContext } from "@/lib/v2/editor/prompt-curation-receipt";
import { D1LinkFragmentEvidenceRepository } from "@/lib/v2/infrastructure/d1/link-fragment-evidence-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1LinkPresentationRepository } from "@/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1ManualLinkFragmentRepository } from "@/lib/v2/infrastructure/d1/manual-link-fragment-repository";
import { D1PromptCurationRepository } from "@/lib/v2/infrastructure/d1/prompt-curation-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { exactLinkGateway, LinkSqlite } from "../../support/link-sqlite";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Case = { receipt: PromptCurationReceipt; context: PromptCurationReceiptContext };
const clone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
const repeated = "  alpha🙂\r\n", rawText = `${repeated}${repeated}negative: blur\r\n--ar 3:2  `;
let db: LinkSqlite, cases: Record<string, Case>, createInput: CreatePromptCurationRequest;
let captureId: string;
beforeAll(async () => {
  db = new LinkSqlite(32);
  const now = new Date().toISOString(), attachmentId = crypto.randomUUID(), imageHash = "b".repeat(64);
  // Synthetic verified image reservation. The real capture commit publishes it;
  // this is SQLite membership/commitment coverage, not image transport/R2.
  db.sql.prepare(`insert into v2_attachment_reservations(id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at)
    values(?,'link-owner','verified',?,'example.png','image/png',8,?,?,'2099-01-01T00:00:00.000Z',?)`).run(attachmentId, `fixture/${attachmentId}`, imageHash, now, now);
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Receipt fixture", bodyMarkdown: "PRIVATE MEMO NOT A SOURCE", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now, sources: [
      { kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://example.test/source", purpose: "prompt", completeness: "partial", partNumber: 2, totalParts: 3 }) },
      { kind: "image", contentHash: `sha256:${imageHash}`, attachmentId },
    ] }, crypto.randomUUID());
  captureId = capture.captureId;
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner"), projection = (await snapshots.bootstrapManualSources({ documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID() }))!;
  const source = projection.members.find((row) => row.kind === "url")!, image = projection.members.find((row) => row.kind === "image")!;
  const basis = { expectedRevisionId: capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash };
  const manualRepo = new D1ManualLinkFragmentRepository(db, "link-owner"), roles = ["prompt", "negative_prompt", "parameters"] as const;
  const bounds = [[0, repeated.length], [repeated.length * 2, rawText.indexOf("--ar")], [rawText.indexOf("--ar"), rawText.length]];
  const fragments: StoredManualLinkFragment[] = [];
  for (let index = 0; index < 3; index++) {
    const saved = await manualRepo.create(capture.objectId, { ...basis, memberId: source.id, textStart: bounds[index][0], textEnd: bounds[index][1], role: roles[index], idempotencyKey: crypto.randomUUID() });
    fragments.push((await manualRepo.get(capture.objectId, saved.item.id, { snapshotId: projection.snapshot.id })).item);
  }
  const snapshot = (await new D1LinkPresentationRepository(db, "link-owner").project(capture.objectId, { snapshotId: projection.snapshot.id }))!;
  const repo = new D1PromptCurationRepository(db, "link-owner");
  const content: PromptCurationContent = { title: "  보관🙂\r\n ", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
    items: [
      { itemKey: "prompt-2", fragmentId: fragments[0].id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 1 },
      { itemKey: "negative", fragmentId: fragments[1].id, expectedFragmentStateVersion: 1, copyRole: "negative_prompt", position: 0 },
      { itemKey: "prompt-1", fragmentId: fragments[0].id, expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 },
      { itemKey: "parameters", fragmentId: fragments[2].id, expectedFragmentStateVersion: 1, copyRole: "parameters", position: 0 },
    ], examples: [
      { exampleKey: "item-image", itemKey: "prompt-2", memberId: image.id, attachmentId, position: 1, evidenceMethod: "user_confirmed" },
      { exampleKey: "whole-image", itemKey: null, memberId: image.id, attachmentId, position: 0, evidenceMethod: "unresolved" },
    ] };
  const originals = (content: PromptCurationContent) => [...new Set(content.items.map((row) => row.fragmentId))].map((id) => {
    const fragment = fragments.find((row) => row.id === id)!;
    return { id, snapshotId: projection.snapshot.id, memberId: source.id, rawText: fragment.fragment.rawText, role: fragment.fragment.role, stateVersion: 1,
      origin: "manual" as const, isManual: true, completeness: fragment.fragment.completeness, sourceItemId: source.sourceItemId, sourceUrl: new URL(source.manualLink!.url).href };
  });
  createInput = { ...basis, idempotencyKey: "create-receipt-key", groupKey: "receipt-group", content };
  const pending: PromptCurationPending = { kind: "create", groupKey: createInput.groupKey, request: createInput, originals: originals(content) };
  const context: PromptCurationReceiptContext = { recordId: capture.objectId, pending, snapshot, parent: null, restoreTarget: null, manualFragments: fragments };
  const created = await repo.create(capture.objectId, createInput);
  cases = { create: { receipt: created, context }, createReplay: { receipt: await repo.create(capture.objectId, createInput), context } };
  const bulkContent: PromptCurationContent = { ...content, items: Array.from({ length: 64 }, (_, position) => ({ ...content.items[0], itemKey: `i-${position}-${"한".repeat(190)}`, position })),
    examples: Array.from({ length: 64 }, (_, position) => ({ ...content.examples[1], exampleKey: `e-${position}-${"한".repeat(190)}`, position })) };
  const bulkRequest = { ...createInput, groupKey: "bulk-group", idempotencyKey: "bulk-key", content: bulkContent };
  const bulkPending: PromptCurationPending = { kind: "create", groupKey: bulkRequest.groupKey, request: bulkRequest, originals: originals(bulkContent) };
  cases.bulk = { receipt: await repo.create(capture.objectId, bulkRequest), context: { ...context, pending: bulkPending } };
  let parent = created.item;
  for (const action of ["edit", "archive", "unarchive", "undo"] as const) {
    const authenticatedParent = (await repo.get(capture.objectId, createInput.groupKey, { revisionId: parent.id })).item;
    const restoreTarget = action === "undo" ? (await repo.get(capture.objectId, createInput.groupKey, { revisionId: cases.archive.receipt.item.id })).item : null;
    const request: RevisePromptCurationRequest = { ...basis, idempotencyKey: `${action}-receipt-key`, expectedCurationRevisionId: parent.id, expectedCurationRevisionNumber: parent.revisionNumber,
      ...(action === "edit" ? { action, content: { ...content, title: "편집🙂  " } } : action === "undo" ? { action, restoreRevisionId: restoreTarget!.id } : { action }) };
    const expectedContent = request.action === "edit" ? request.content : (restoreTarget ?? authenticatedParent).content;
    const pending: PromptCurationPending = { kind: "revise", groupKey: createInput.groupKey, request, originals: originals(expectedContent) };
    const context = { recordId: capture.objectId, pending, snapshot, parent: authenticatedParent, restoreTarget, manualFragments: fragments };
    const receipt = await repo.revise(capture.objectId, pending.groupKey, request);
    cases[action] = { receipt, context }; cases[`${action}Replay`] = { receipt: await repo.revise(capture.objectId, pending.groupKey, request), context }; parent = receipt.item;
  }
  // Actual model-double -> processing repository -> published projection ->
  // curation repository path. No real provider request.
  const links = new D1LinkAnalysisRepository(db);
  await links.enqueue("link-owner", { documentId: capture.objectId, ...basis });
  expect(await runNextLinkAnalysisJob({ links, queue: new D1ProcessingQueueRepository(db), governor: new D1AiRuntimeGovernor(db), gateway: exactLinkGateway(), workerId: "receipt-test" })).toMatchObject({ outcome: "succeeded" });
  const aiSnapshot = (await new D1LinkPresentationRepository(db, "link-owner").project(capture.objectId, { snapshotId: projection.snapshot.id }))!, ai = aiSnapshot.fragments[0];
  const aiContent: PromptCurationContent = { ...content, items: [{ itemKey: "ai-item", fragmentId: ai.id, expectedFragmentStateVersion: ai.stateVersion, copyRole: "prompt", position: 0 }], examples: [] };
  const aiRequest = { ...createInput, groupKey: "ai-group", idempotencyKey: "ai-create", content: aiContent };
  const aiReceipt = await repo.create(capture.objectId, aiRequest);
  const aiPending: PromptCurationPending = { kind: "create", groupKey: aiRequest.groupKey, request: aiRequest, originals: [{ ...originals(content)[0], id: ai.id,
    rawText: ai.rawText!, stateVersion: ai.stateVersion, completeness: aiReceipt.item.items[0].fragment.completeness, origin: "ai", isManual: false }] };
  cases.ai = { receipt: aiReceipt, context: { ...context, pending: aiPending, snapshot: aiSnapshot } };
});
afterAll(() => { db?.sql.close(); vi.restoreAllMocks(); });

function reject(receipt: unknown, context = cases.create.context) {
  return expect(assertPromptCurationReceipt(receipt, context)).rejects.toMatchObject({ code: "prompt_curation_receipt_invalid" });
}
async function reprepare(item: Mutable<StoredPromptCuration>, context: PromptCurationReceiptContext) {
  const manifest = JSON.parse(item.prepared.manifestJson) as { items: { memberKey: string; sourceFingerprint: string }[] };
  const sources = [...new Set(item.items.map((entry) => entry.fragment.memberKey))].map((key) => {
    const member = context.snapshot.members.find((entry) => entry.memberKey === key)!, link = member.manualLink!;
    const claim = (value: number | null) => ({ value, origin: value === null ? "unknown" as const : "user_declared" as const });
    return { memberKey: key, sourceFingerprint: manifest.items.find((entry) => entry.memberKey === key)!.sourceFingerprint, rawText: member.rawText!, contentHash: normalizeLinkHash(member.contentHash),
      completeness: link.completeness, parts: { number: claim(link.partNumber), total: claim(link.totalParts) } };
  });
  const input: PromptCurationInput = { ...item.content, snapshotManifestHash: context.snapshot.selectedSnapshot!.manifestHash, separator: "\n", sources, items: item.items, examples: item.examples };
  const prepared = await preparePromptCuration(input); item.prepared = clone(prepared); item.manifestHash = prepared.manifestHash;
}

test.each(["create", "createReplay", "edit", "editReplay", "archive", "archiveReplay", "unarchive", "unarchiveReplay", "undo", "undoReplay", "ai", "bulk"])("accepts actual LinkSqlite/repository %s receipt", async (kind) => {
  const { receipt, context } = cases[kind]; expect(await assertPromptCurationReceipt(receipt, context)).toEqual(receipt);
  expect(JSON.stringify(receipt)).not.toContain("PRIVATE MEMO");
});
test("keeps LF-only join metadata, exact CRLF originals, role positions, duplicate selection and image confirmations", async () => {
  const receipt = await assertPromptCurationReceipt(cases.create.receipt, cases.create.context);
  expect(receipt.item.items.filter((entry) => entry.copyRole === "prompt").map((entry) => entry.fragment.rawText)).toEqual([repeated, repeated]);
  expect(receipt.item.prepared.channels.prompt.warnings).toEqual(expect.arrayContaining(["partial_source", "duplicate_text_preserved", "image_pair_unconfirmed"]));
  expect(receipt.item.prepared.channels.prompt.canStandardCopy).toBe(false);
  expect(receipt.item.examples.map((entry) => entry.itemKey)).toEqual(["prompt-2", null]);
});
test("exact old replay accepts the authenticated original snapshot after current document/snapshot advance", async () => {
  const source = cases.create.context, repo = new D1PromptCurationRepository(db, "link-owner"), snapshots = new D1LinkSnapshotRepository(db, "link-owner");
  await snapshots.createSnapshot({ documentId: source.recordId, expectedRevisionId: createInput.expectedRevisionId, expectedSnapshotId: createInput.expectedSnapshotId,
    expectedSnapshotVersion: source.snapshot.selectedSnapshot!.snapshotVersion, sourceItemIds: source.snapshot.members.map((row) => row.sourceItemId), idempotencyKey: "advanced-snapshot" });
  const revision = await prepareDocumentRevision({ expectedRevisionId: createInput.expectedRevisionId, expectedVersion: 1, title: "Later personal title", bodyMarkdown: "NEW PRIVATE MEMO",
    documentStatus: "draft", privacyLevel: "normal", writtenAt: null }, crypto.randomUUID());
  expect(await new D1DocumentAuthoringRepository(db, "link-owner").saveRevision(source.recordId, revision)).toMatchObject({ outcome: "saved" });
  const snapshot = (await new D1LinkPresentationRepository(db, "link-owner").project(source.recordId, { snapshotId: createInput.expectedSnapshotId }))!;
  expect(snapshot.currentRevisionId).not.toBe(createInput.expectedRevisionId); expect(snapshot.currentSnapshotId).not.toBe(createInput.expectedSnapshotId);
  const receipt = await repo.create(source.recordId, createInput); expect(receipt.replayed).toBe(true);
  expect(await assertPromptCurationReceipt(receipt, { ...source, snapshot })).toEqual(receipt);
});
test("newer fragment review versions are accepted as proof for exact old requests", async () => {
  const { receipt, context } = clone(cases.create); context.manualFragments!.forEach((entry) => { entry.stateVersion += 2; entry.reviewStatus = "rejected"; });
  expect(await assertPromptCurationReceipt(receipt, context)).toEqual(receipt);
});
test("authenticated parent supplies stored exact originals even when a current candidate page omits them", async () => {
  const { receipt, context } = clone(cases.edit); context.manualFragments = []; context.snapshot.fragments = [];
  context.pending.originals.forEach((entry) => { entry.origin = "stored"; entry.memberId = null; entry.sourceItemId = null; entry.sourceUrl = null; });
  expect(await assertPromptCurationReceipt(receipt, context)).toEqual(receipt);
});
test("a missing old AI create selection remains pending rather than inferring its range", async () => {
  const { receipt, context } = clone(cases.ai); context.snapshot.fragments = []; await reject(receipt, context);
});

function aiEvidenceCase() {
  const { receipt, context } = clone(cases.ai);
  const evidence: Mutable<LinkFragmentEvidenceV1> = { contract: "link-fragment-evidence.v1", recordId: context.recordId,
    snapshotId: context.pending.request.expectedSnapshotId, snapshotManifestHash: context.pending.request.expectedManifestHash,
    run: clone(context.snapshot.selectedRun!), fragment: clone(context.snapshot.fragments[0]) };
  context.snapshot.fragments = []; context.snapshot.selectedRun = null;
  return { receipt, context, evidence };
}

test("exact authenticated repository evidence settles old create despite absent latest projection/run history", async () => {
  const { receipt, context } = aiEvidenceCase(), request = context.pending.request;
  const value = await new D1LinkFragmentEvidenceRepository(db, "link-owner").get(context.recordId, context.pending.originals[0].id, {
    snapshotId: request.expectedSnapshotId, manifestHash: request.expectedManifestHash,
  });
  expect(value.run.isPublished).toBe(false); // The previous test advanced current document/snapshot.
  const aiFragments = await assertPromptCurationAiEvidence([value], context);
  expect(await assertPromptCurationReceipt(receipt, { ...context, aiFragments })).toEqual(receipt);
  expect(context.snapshot.selectedRun).toBeNull(); expect(context.snapshot.fragments).toEqual([]);
});

for (const status of ["proposed", "confirmed", "rejected", "superseded"] as const) test(`old exact evidence accepts later ${status} review without changing request state version`, async () => {
  const { receipt, context, evidence } = aiEvidenceCase(); evidence.fragment.reviewStatus = status; evidence.fragment.stateVersion += 3;
  evidence.run.isPublished = false; evidence.run.status = "partial";
  const before = clone(context.pending), aiFragments = await assertPromptCurationAiEvidence([evidence], context);
  expect(await assertPromptCurationReceipt(receipt, { ...context, aiFragments })).toEqual(receipt); expect(context.pending).toEqual(before);
});

const evidenceTampering: [string, (value: Mutable<LinkFragmentEvidenceV1>) => void][] = [
  ["contract", (v) => { v.contract = "other" as never; }], ["record", (v) => { v.recordId = "foreign"; }],
  ["snapshot", (v) => { v.snapshotId = "foreign"; }], ["manifest", (v) => { v.snapshotManifestHash = "a".repeat(64); }],
  ["run id", (v) => { v.run.id = "other-run"; }], ["run snapshot", (v) => { v.run.snapshotId = "other"; }],
  ["run status", (v) => { v.run.status = "superseded"; }], ["unfinished run", (v) => { v.run.finishedAt = null; }],
  ["run job", (v) => { v.run.jobId = ""; }], ["run revision", (v) => { v.run.documentRevisionId = ""; }],
  ["publication type", (v) => { v.run.isPublished = "true" as never; }], ["run date", (v) => { v.run.createdAt = "bad"; }],
  ["fragment id", (v) => { v.fragment.id = "other"; }], ["fragment key", (v) => { v.fragment.fragmentKey = ""; }],
  ["fragment snapshot", (v) => { v.fragment.snapshotId = "other"; }], ["fragment run", (v) => { v.fragment.runId = null; }],
  ["fragment class", (v) => { v.fragment.sourceClass = "ai_interpretation"; }], ["derived text", (v) => { v.fragment.derivedText = "invented"; }],
  ["fragment role", (v) => { v.fragment.role = "parameters"; }], ["raw text", (v) => { v.fragment.rawText += " "; }],
  ["raw hash", (v) => { v.fragment.rawTextHash = "0".repeat(64); }], ["completeness", (v) => { v.fragment.completeness = "invented"; }],
  ["older state", (v) => { v.fragment.stateVersion = 0; }], ["fractional state", (v) => { v.fragment.stateVersion = 1.5; }],
  ["review enum", (v) => { v.fragment.reviewStatus = "accepted" as never; }], ["lock type", (v) => { v.fragment.lockedByUser = 0 as never; }],
  ["display order", (v) => { v.fragment.displayOrder = -1; }], ["primary member", (v) => { v.fragment.primaryMemberId = "foreign"; }],
  ["empty evidence", (v) => { v.fragment.evidence = []; }], ["duplicate evidence", (v) => { v.fragment.evidence.push(clone(v.fragment.evidence[0])); }],
  ["evidence id", (v) => { v.fragment.evidence[0].id = ""; }], ["evidence member", (v) => { v.fragment.evidence[0].memberId = "foreign"; }],
  ["evidence key", (v) => { v.fragment.evidence[0].memberKey = "foreign"; }], ["evidence source", (v) => { v.fragment.evidence[0].sourceItemId = "foreign"; }],
  ["evidence relation", (v) => { v.fragment.evidence[0].relationKind = "depicts"; }], ["evidence method", (v) => { v.fragment.evidence[0].evidenceMethod = "user_confirmed"; }],
  ["evidence order", (v) => { v.fragment.evidence[0].displayOrder = 1; }], ["evidence quote", (v) => { v.fragment.evidence[0].quote = null; }],
  ["range null", (v) => { v.fragment.evidence[0].textStart = null; }], ["range reversed", (v) => { v.fragment.evidence[0].textStart = v.fragment.evidence[0].textEnd; }],
  ["range overflow", (v) => { v.fragment.evidence[0].textEnd = 1_000_000; }], ["range fractional", (v) => { v.fragment.evidence[0].textStart = 0.5; }],
  ["unknown wrapper field", (v) => { Object.assign(v, { extra: true }); }], ["unknown nested field", (v) => { Object.assign(v.fragment, { extra: true }); }],
];
test.each(evidenceTampering)("rejects exact AI evidence tampering before POST and at receipt: %s", async (_name, tamper) => {
  const { receipt, context, evidence } = aiEvidenceCase(); tamper(evidence);
  await expect(assertPromptCurationAiEvidence([evidence], context)).rejects.toMatchObject({ code: "prompt_curation_receipt_invalid" });
  await reject(receipt, { ...context, aiFragments: [evidence] });
});

test("explicit missing/duplicate/unselected AI proof cannot fall back to a valid latest projection", async () => {
  const { receipt, evidence } = aiEvidenceCase(), context = clone(cases.ai.context);
  for (const values of [[], [evidence, evidence], [{ ...evidence, fragment: { ...evidence.fragment, id: "unselected" } }]]) {
    await expect(assertPromptCurationAiEvidence(values, context)).rejects.toMatchObject({ code: "prompt_curation_receipt_invalid" });
    await reject(receipt, { ...context, aiFragments: values });
  }
});

test("exact evidence preflight captures before await and rejects getters without invoking them", async () => {
  const { context, evidence } = aiEvidenceCase(), untouched = clone(evidence);
  const pending = assertPromptCurationAiEvidence([evidence], context); evidence.fragment.rawText = "changed during digest";
  expect(await pending).toEqual([untouched]);
  let calls = 0; const accessor = clone(untouched);
  Object.defineProperty(accessor.fragment, "rawText", { enumerable: true, get() { calls++; return untouched.fragment.rawText; } });
  await expect(assertPromptCurationAiEvidence([accessor], context)).rejects.toMatchObject({ code: "prompt_curation_receipt_invalid" }); expect(calls).toBe(0);
});

test("exact AI source proof checks the whole source hash independently of the fragment hash", async () => {
  const { receipt, context, evidence } = aiEvidenceCase(); context.snapshot.members[0].contentHash = "0".repeat(64);
  await expect(assertPromptCurationAiEvidence([evidence], context)).rejects.toMatchObject({ code: "prompt_curation_receipt_invalid" });
  await reject(receipt, { ...context, aiFragments: [evidence] });
});
test("unrelated accumulated source lists do not block verification of the original bounded snapshot", async () => {
  const { receipt, context } = clone(cases.create);
  context.snapshot.availableSources = Array.from({ length: 300 }, (_, index) => ({ ...clone(context.snapshot.members[0]), sourceItemId: `unselected-${index}` }));
  expect(await assertPromptCurationReceipt(receipt, context)).toEqual(receipt);
});
test("catches coherent alternate-offset forgery when identical original text appears twice", async () => {
  const { receipt, context } = clone(cases.create);
  for (const item of receipt.item.items.filter((entry) => entry.copyRole === "prompt")) { item.fragment.textStart += repeated.length; item.fragment.textEnd += repeated.length; }
  await reprepare(receipt.item, context); expect(receipt.item.items[0].fragment.rawText).toBe(repeated);
  await reject(receipt, context);
});
test("captures response, pending, original snapshot and fragment evidence before first digest await", async () => {
  const { receipt, context } = clone(cases.create), expected = clone(receipt), work = assertPromptCurationReceipt(receipt, context);
  receipt.item.title = "late"; context.pending.request.expectedSnapshotId = "late"; context.snapshot.members[0].rawText = "late";
  context.manualFragments![0].fragment.textStart = 4;
  expect(await work).toEqual(expected);
});
test.each([null, [], "ok", { success: true }, { contract: "stored-prompt-curation.v1", replayed: false }].map((value) => [value]))("rejects malformed success JSON %j", async (value) => { await reject(value); });

const changes: [string, (data: Mutable<Case>) => void][] = [
  ["contract", (x) => { Object.assign(x.receipt, { contract: "other" }); }],
  ["replayed type", (x) => { Object.assign(x.receipt, { replayed: "true" }); }],
  ["unknown wrapper", (x) => { Object.assign(x.receipt, { verified: true }); }],
  ["unknown item", (x) => { Object.assign(x.receipt.item, { personalMemo: "private" }); }],
  ["unsafe ID", (x) => { x.receipt.item.id = "bad\u0080"; }],
  ["group", (x) => { x.receipt.item.groupKey = "other"; }],
  ["snapshot", (x) => { x.receipt.item.snapshotId = "other"; }],
  ["revision", (x) => { x.receipt.item.revisionNumber = 2; }],
  ["parent", (x) => { x.receipt.item.parentRevisionId = "parent"; }],
  ["based on", (x) => { x.receipt.item.basedOnRevisionId = "foreign"; }],
  ["change reason", (x) => { x.receipt.item.changeReason = "migrate"; }],
  ["status", (x) => { x.receipt.item.status = "archived"; }],
  ["createdAt", (x) => { x.receipt.item.createdAt = "invalid"; }],
  ["title", (x) => { x.receipt.item.title += " rewrite"; }],
  ["content title", (x) => { x.receipt.item.content.title += " rewrite"; }],
  ["content role", (x) => { x.receipt.item.content.items[0].copyRole = "parameters"; }],
  ["content fragment ID", (x) => { x.receipt.item.content.items[0].fragmentId = "foreign"; }],
  ["content version", (x) => { x.receipt.item.content.items[0].expectedFragmentStateVersion = 2; }],
  ["content extra assertion", (x) => { Object.assign(x.receipt.item.content.items[0], { confirmed: true }); }],
  ["raw trim", (x) => { x.receipt.item.items[0].fragment.rawText = repeated.trim(); }],
  ["raw line endings", (x) => { x.receipt.item.items[0].fragment.rawText = repeated.replaceAll("\r\n", "\n"); }],
  ["raw hash", (x) => { x.receipt.item.items[0].fragment.rawTextHash = "a".repeat(64); }],
  ["source class", (x) => { Object.assign(x.receipt.item.items[0].fragment, { sourceClass: "ai_interpretation" }); }],
  ["source member", (x) => { x.receipt.item.items[0].fragment.memberKey = "other"; }],
  ["unknown fragment", (x) => { Object.assign(x.receipt.item.items[0].fragment, { rewrite: true }); }],
  ["duplicate item replacement", (x) => { x.receipt.item.items[1] = clone(x.receipt.item.items[0]); }],
  ["missing item", (x) => { x.receipt.item.items.pop(); }],
  ["image target", (x) => { x.receipt.item.examples[0].itemKey = "parameters"; }],
  ["image sha", (x) => { x.receipt.item.examples[0].sha256 = "f".repeat(64); }],
  ["image MIME", (x) => { x.receipt.item.examples[0].mimeType = "image/jpeg"; }],
  ["image size", (x) => { x.receipt.item.examples[0].sizeBytes += 1; }],
  ["image missing", (x) => { x.receipt.item.examples.pop(); }],
  ["image evidence", (x) => { x.receipt.item.examples[1].evidenceMethod = "user_confirmed"; }],
  ["manifest hash", (x) => { x.receipt.item.manifestHash = "f".repeat(64); }],
  ["manifest JSON", (x) => { x.receipt.item.prepared.manifestJson += " "; }],
  ["manifest version", (x) => { Object.assign(x.receipt.item.prepared, { manifestVersion: "future" }); }],
  ["channel warnings", (x) => { x.receipt.item.prepared.channels.prompt.warnings = []; }],
  ["channel allowed", (x) => { x.receipt.item.prepared.channels.prompt.canStandardCopy = true; }],
  ["channel byte count", (x) => { x.receipt.item.prepared.channels.prompt.byteLength += 1; }],
  ["record context", (x) => { x.context.recordId = "foreign"; }],
  ["snapshot context", (x) => { x.context.snapshot.selectedSnapshot!.id = "new"; }],
  ["snapshot manifest context", (x) => { x.context.snapshot.selectedSnapshot!.manifestHash = "b".repeat(64); }],
  ["redacted snapshot", (x) => { x.context.snapshot.selectedSnapshot = null; }],
  ["unavailable snapshot", (x) => { x.context.snapshot.unavailableReason = "restricted_record_locked"; }],
  ["source raw context", (x) => { x.context.snapshot.members[0].rawText += "changed"; }],
  ["source hash context", (x) => { x.context.snapshot.members[0].contentHash = "e".repeat(64); }],
  ["source coverage context", (x) => { x.context.snapshot.members[0].manualLink!.completeness = "complete"; }],
  ["source parts context", (x) => { x.context.snapshot.members[0].manualLink!.totalParts = 4; }],
  ["source duplicate context", (x) => { x.context.snapshot.members.push(clone(x.context.snapshot.members[0])); }],
  ["source wrong image association", (x) => { x.context.snapshot.members.find((entry) => entry.kind === "image")!.attachments[0].id = "other"; }],
  ["manual missing proof", (x) => { x.context.manualFragments = []; }],
  ["manual stale proof", (x) => { x.context.manualFragments![0].stateVersion = 0; }],
  ["manual fractional proof version", (x) => { x.context.manualFragments![0].stateVersion = 1.5; }],
  ["manual other snapshot", (x) => { x.context.manualFragments![0].snapshotId = "other"; }],
  ["manual raw proof", (x) => { x.context.manualFragments![0].fragment.rawText = "other"; }],
  ["manual duplicate proof", (x) => { x.context.manualFragments!.push(clone(x.context.manualFragments![0])); }],
  ["original raw cache", (x) => { x.context.pending.originals[0].rawText += "other"; }],
  ["original member cache", (x) => { x.context.pending.originals[0].memberId = "other"; }],
  ["original source cache", (x) => { x.context.pending.originals[0].sourceItemId = "other"; }],
  ["original URL cache", (x) => { x.context.pending.originals[0].sourceUrl = "https://other.test/"; }],
];
test.each(changes)("rejects tampered response/context %s", async (_label, change) => { const data = clone(cases.create); change(data); await reject(data.receipt, data.context); });
test.each(["edit", "undo", "archive", "unarchive"])("rejects wrong %s transition parent/status/based-on", async (kind) => {
  for (const change of [
    (x: Mutable<Case>) => { x.receipt.item.parentRevisionId = "wrong"; },
    (x: Mutable<Case>) => { x.receipt.item.revisionNumber += 1; },
    (x: Mutable<Case>) => { x.context.parent = null; },
    (x: Mutable<Case>) => { x.context.parent!.id = "wrong"; },
    (x: Mutable<Case>) => { x.receipt.item.status = x.receipt.item.status === "active" ? "archived" : "active"; },
    (x: Mutable<Case>) => { x.receipt.item.basedOnRevisionId = "wrong"; },
  ]) { const data = clone(cases[kind]); change(data); await reject(data.receipt, data.context); }
});
test("undo is bound to exact restore revision, not whichever detail/current head was selected", async () => {
  const data = clone(cases.undo); data.context.restoreTarget = clone(data.context.parent); await reject(data.receipt, data.context);
});
test.each(["run", "role", "derived", "evidence", "member", "version"])("AI proof rejects inconsistent %s", async (kind) => {
  const data = clone(cases.ai), fragment = data.context.snapshot.fragments[0];
  if (kind === "run") fragment.runId = "another-run";
  if (kind === "role") fragment.role = "parameters";
  if (kind === "derived") fragment.derivedText = "AI summary";
  if (kind === "evidence") fragment.evidence[0].textEnd = 1;
  if (kind === "member") fragment.evidence[0].sourceItemId = "foreign";
  if (kind === "version") fragment.stateVersion = 1.5;
  await reject(data.receipt, data.context);
});
test.each(["origin", "coverage", "role"])("rejects coherently rehashed %s changes beyond the authenticated fragment proof", async (kind) => {
  const data = clone(cases.create);
  if (kind === "origin") data.receipt.item.items[0].fragment.selectionOrigin = "ai_selected";
  if (kind === "coverage") data.receipt.item.items[0].fragment.completeness = "complete";
  if (kind === "role") { data.receipt.item.content.relationshipConfirmation = "unconfirmed"; }
  await reprepare(data.receipt.item, data.context); await reject(data.receipt, data.context);
});
test("rejects unknown nested manifest fields even when its digest is recomputed", async () => {
  const data = clone(cases.create), manifest = JSON.parse(data.receipt.item.prepared.manifestJson); manifest.items[0].verifiedByAi = true;
  data.receipt.item.prepared.manifestJson = canonicalLinkJson(manifest); data.receipt.item.prepared.manifestHash = await linkSha256Hex(data.receipt.item.prepared.manifestJson);
  data.receipt.item.manifestHash = data.receipt.item.prepared.manifestHash; await reject(data.receipt, data.context);
});
test.each(["getter", "toJSON", "prototype", "cycle", "sparse", "subclass", "limit"])("rejects %s without executing response code or truncating data", async (kind) => {
  const data = clone(cases.create), fn = vi.fn(() => data.receipt.item);
  if (kind === "getter") Object.defineProperty(data.receipt, "item", { get: fn });
  if (kind === "toJSON") Object.assign(data.receipt, { toJSON: fn });
  if (kind === "prototype") Object.setPrototypeOf(data.receipt, { authority: true });
  if (kind === "cycle") Object.assign(data.receipt.item, { self: data.receipt });
  if (kind === "sparse") Reflect.deleteProperty(data.receipt.item.items, "0");
  if (kind === "subclass") Object.setPrototypeOf(data.receipt.item.items, Object.create(Array.prototype));
  if (kind === "limit") Object.assign(data.receipt, { extra: "x".repeat(8_000_001) });
  await reject(data.receipt, data.context); expect(fn).not.toHaveBeenCalled();
});
test("rejects context/pending accessors or prototypes without running them", async () => {
  const data = clone(cases.create), getter = vi.fn(() => data.context.snapshot);
  Object.defineProperty(data.context, "snapshot", { get: getter }); await reject(data.receipt, data.context); expect(getter).not.toHaveBeenCalled();
  const snapshot = clone(cases.create), original = vi.fn(() => snapshot.context.snapshot.members);
  Object.defineProperty(snapshot.context.snapshot, "members", { get: original }); await reject(snapshot.receipt, snapshot.context); expect(original).not.toHaveBeenCalled();
  const inherited = clone(cases.create); Object.setPrototypeOf(inherited.context.pending.request, { verified: true }); await reject(inherited.receipt, inherited.context);
});
test("SQLite fixture has real committed images and foreign-key closure", () => {
  expect(db.sql.prepare("pragma foreign_key_check").all()).toEqual([]);
  expect(db.sql.prepare("select count(*) as n from v2_attachment_reservations where status='committed' and committed_at is not null").get()).toMatchObject({ n: 1 });
  expect(db.sql.prepare("select raw_text from v2_source_items where capture_id=? and item_kind='url'").get(captureId)).toMatchObject({ raw_text: rawText });
});
