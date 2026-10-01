import { describe, expect, test } from "vitest";
import { canonicalLinkJson, createLinkSourceFingerprint, hashLinkSourceManifest, linkSha256Hex, type LinkSnapshotMemberV1 } from "@/lib/v2/domain/link-snapshot-v1";
import { unavailableLinkPresentation, type LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { planPromptCurationMigration } from "@/lib/v2/domain/prompt-curation-migration";
import { assertMigrationPreview, assertMigrationReceipt, assertMigrationRecovery, assertMigrationRecoveryReceipt } from "@/lib/v2/domain/prompt-curation-migration-response";
import type { MigratePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { extractManualPromptFragment, preparePromptCuration, type PromptCurationInput } from "@/lib/v2/domain/prompt-curation-v1";
import { STORED_PROMPT_CURATION_CONTRACT, type PromptCurationReceipt, type StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";

const copy = <T>(value: T): T => structuredClone(value);
async function fixture(completeness: "unknown" | "complete" | "partial" | "ocr_unverified" = "unknown", ai = false) {
  const rawText = "  portrait 🙂\r\nnegative: blur  ", split = rawText.indexOf("negative:");
  const metadata = makeManualLinkMetadata({ url: "https://example.invalid/response", completeness, partNumber: 1, totalParts: 1 });
  const contentHash = await linkSha256Hex(rawText), imageHash = "e".repeat(64);
  const fingerprint = await createLinkSourceFingerprint({ kind: "url", contentHash, rawText, metadata, attachments: [] });
  const member: LinkSnapshotMemberV1 = { id: "new-member", snapshotId: "new-snapshot", sourceItemId: "source-item", memberKey: "new-source-key", sourceOrder: 0,
    sourceFingerprint: fingerprint, kind: "url", rawText, contentHash, metadata, manualLink: metadata.manualLinkV1, attachments: [] };
  const image: LinkSnapshotMemberV1 = { id: "new-image", snapshotId: "new-snapshot", sourceItemId: "image-item", memberKey: "new-image-key", sourceOrder: 1,
    sourceFingerprint: "d".repeat(64), kind: "image", rawText: null, contentHash: imageHash, metadata: null, manualLink: null,
    attachments: [{ id: "attachment", sha256: imageHash, mimeType: "image/png", sizeBytes: 8, filename: "synthetic.png" }] };
  const sources: PromptCurationInput["sources"] = [{ memberKey: "old-source-key", sourceFingerprint: fingerprint, rawText, contentHash, completeness,
    parts: { number: { value: 1, origin: "user_declared" }, total: { value: 1, origin: "user_declared" } } }];
  const prompt = await extractManualPromptFragment(sources[0], { textStart: 0, textEnd: split, role: "prompt" });
  const negative = await extractManualPromptFragment(sources[0], { textStart: split, textEnd: rawText.length, role: "negative_prompt" });
  const aiFragment = (fragment: typeof prompt) => ai ? { ...fragment, selectionOrigin: "ai_selected" as const,
    completeness: completeness === "partial" ? "truncated" as const : completeness === "ocr_unverified" ? "ocr_unverified" as const : "selection_unverified" as const } : fragment;
  const input: PromptCurationInput = { snapshotManifestHash: "a".repeat(64), title: "그대로 보존", relationKind: "continuation", relationshipConfirmation: "user_confirmed",
    orderConfirmation: "user_confirmed", separator: "\n", sources, items: [
      { itemKey: "prompt", copyRole: "prompt", position: 0, fragment: aiFragment(prompt) },
      { itemKey: "duplicate", copyRole: "prompt", position: 1, fragment: aiFragment(prompt) },
      { itemKey: "negative", copyRole: "negative_prompt", position: 0, fragment: aiFragment(negative) }],
    examples: [{ exampleKey: "image", itemKey: null, memberKey: "old-image-key", sourceFingerprint: image.sourceFingerprint,
      sha256: imageHash, mimeType: "image/png", sizeBytes: 8, position: 0, evidenceMethod: "unresolved" }] };
  const prepared = await preparePromptCuration(input);
  const source: StoredPromptCuration = { id: "old-revision", groupKey: "old-group", snapshotId: "old-snapshot", revisionNumber: 3, parentRevisionId: "parent",
    basedOnRevisionId: null, changeReason: "edit", title: input.title, relationKind: input.relationKind, status: "active", createdAt: "2026-09-08T00:00:00Z", manifestHash: prepared.manifestHash,
    content: { title: input.title, relationKind: input.relationKind, relationshipConfirmation: input.relationshipConfirmation, orderConfirmation: input.orderConfirmation,
      items: input.items.map((item) => ({ itemKey: item.itemKey, fragmentId: item.copyRole === "prompt" ? "old-prompt" : "old-negative", expectedFragmentStateVersion: 1, copyRole: item.copyRole, position: item.position })),
      examples: [{ exampleKey: "image", itemKey: null, memberId: "old-image", attachmentId: "old-attachment", position: 0, evidenceMethod: "unresolved" }] },
    prepared, items: input.items, examples: input.examples };
  const targetHash = await hashLinkSourceManifest({ members: [member, image] });
  const target: LinkPresentationV1 = { ...unavailableLinkPresentation("record", ""), currentRevisionId: "document-revision", currentSnapshotId: "new-snapshot", currentSnapshotVersion: 2,
    selectedSnapshot: { id: "new-snapshot", parentSnapshotId: "old-snapshot", snapshotVersion: 2, manifestVersion: "link-source-manifest.v1", manifestHash: targetHash,
      acquisitionMethod: "user_paste", adapterVersion: "manual-v1", captureState: "captured", createdAt: "2026-09-08T01:00:00Z", sourceCount: 2 },
    members: [member, image].map((item) => ({ sourceItemId: item.sourceItemId, memberId: item.id, memberKey: item.memberKey, sourceOrder: item.sourceOrder, kind: item.kind,
      rawText: item.rawText, contentHash: item.contentHash, manualLink: item.manualLink, attachments: item.attachments })) };
  const plan = await planPromptCurationMigration({ recordId: "record", sourceGroupKey: source.groupKey, sourceRevisionId: source.id, sourceSnapshotId: source.snapshotId,
    sourceManifestHash: source.manifestHash, expectedRevisionId: target.currentRevisionId!, expectedSnapshotId: target.currentSnapshotId!, expectedManifestHash: targetHash }, source.content, input, [member, image]);
  const migratedInput: PromptCurationInput = { ...input, snapshotManifestHash: targetHash,
    sources: sources.map((item) => ({ ...item, memberKey: member.memberKey })),
    items: input.items.map((item) => ({ ...item, fragment: { ...item.fragment, memberKey: member.memberKey, selectionOrigin: "user_selected", completeness } })),
    examples: input.examples.map((example) => ({ ...example, memberKey: image.memberKey })) };
  const migratedPrepared = await preparePromptCuration(migratedInput);
  const receipt: PromptCurationReceipt = { contract: STORED_PROMPT_CURATION_CONTRACT, replayed: false, item: { ...source, id: "new-revision", groupKey: "new-group",
    snapshotId: "new-snapshot", revisionNumber: 1, parentRevisionId: null, basedOnRevisionId: source.id, changeReason: "migrate", manifestHash: migratedPrepared.manifestHash,
    content: { ...source.content, items: source.content.items.map((item) => ({ ...item, fragmentId: item.copyRole === "prompt" ? "new-prompt" : "new-negative" })),
      examples: source.content.examples.map((example) => ({ ...example, memberId: image.id, attachmentId: "attachment" })) },
    prepared: migratedPrepared, items: migratedInput.items, examples: migratedInput.examples } };
  return { source, target, plan, receipt, context: { source, target, plan, groupKey: "new-group" } };
}
async function rehash(plan: Awaited<ReturnType<typeof fixture>>["plan"]) {
  const { planHash: _hash, ...body } = plan; void _hash; plan.planHash = await linkSha256Hex(canonicalLinkJson(body));
}

describe("bounded browser migration response validation", () => {
  test.each(["unknown", "complete", "partial", "ocr_unverified"] as const)("accepts exact manual/AI %s scope without upgrading source coverage", async (scope) => {
    for (const ai of [false, true]) {
      const data = await fixture(scope, ai);
      expect(await assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).toEqual(data.plan);
      expect(await assertMigrationReceipt(data.receipt, data.context)).toEqual(data.receipt);
      expect(await assertMigrationReceipt({ ...data.receipt, replayed: true }, data.context)).toEqual({ ...data.receipt, replayed: true });
    }
  });
  test("a blocked preview partitions every item/image into match or issue", async () => {
    const data = await fixture(); data.plan.items.splice(1, 1); data.plan.issues.push({ kind: "item", key: "duplicate", reason: "ambiguous" }); data.plan.ready = false; await rehash(data.plan);
    expect(await assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).toEqual(data.plan);
    await expect(assertMigrationReceipt(data.receipt, data.context)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test.each(["digest", "record", "revision", "missing_item", "duplicate_item", "wrong_member", "wrong_fragment", "selection", "ready", "image", "unknown_field"])("rejects forged preview %s", async (kind) => {
    const data = await fixture("unknown", true), plan = data.plan;
    if (kind === "digest") plan.planHash = "f".repeat(64);
    if (kind === "record") plan.recordId = "other";
    if (kind === "revision") plan.expectedRevisionId = "other";
    if (kind === "missing_item") plan.items.pop();
    if (kind === "duplicate_item") plan.items[1] = { ...plan.items[0] };
    if (kind === "wrong_member") plan.items[0].memberId = "unknown";
    if (kind === "wrong_fragment") plan.items[0].fragmentId = "unknown";
    if (kind === "selection") plan.selectionConfirmations = [];
    if (kind === "ready") plan.ready = false;
    if (kind === "image") plan.examples[0].attachmentId = "other";
    if (kind === "unknown_field") Object.assign(plan, { authority: true });
    if (kind !== "digest") await rehash(plan);
    await expect(assertMigrationPreview(plan, { recordId: "record", source: data.source, target: data.target })).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test.each(["group", "revision", "parent", "based_on", "snapshot", "title", "text", "range", "role", "duplicate_identity", "state", "image", "warnings", "hash"])("rejects forged receipt %s", async (kind) => {
    const data = await fixture(), receipt = copy(data.receipt), row = receipt.item;
    const mutable = row as unknown as Record<string, unknown>;
    if (kind === "group") mutable.groupKey = "other";
    if (kind === "revision") mutable.revisionNumber = 2;
    if (kind === "parent") mutable.parentRevisionId = "parent";
    if (kind === "based_on") mutable.basedOnRevisionId = "other";
    if (kind === "snapshot") mutable.snapshotId = "other";
    if (kind === "title") mutable.title = "rewritten";
    if (kind === "text") Object.assign(row.items[0].fragment, { rawText: "rewritten" });
    if (kind === "range") Object.assign(row.items[0].fragment, { textEnd: 3 });
    if (kind === "role") Object.assign(row.content.items[0], { copyRole: "parameters" });
    if (kind === "duplicate_identity") Object.assign(row.content.items[1], { fragmentId: "third-fragment" });
    if (kind === "state") Object.assign(row.content.items[0], { expectedFragmentStateVersion: 2 });
    if (kind === "image") Object.assign(row.content.examples[0], { itemKey: "negative" });
    if (kind === "warnings") Object.assign(row.prepared.channels.prompt, { warnings: [] });
    if (kind === "hash") mutable.manifestHash = "b".repeat(64);
    await expect(assertMigrationReceipt(receipt, data.context)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test("captures response and context before any awaited digest", async () => {
    const data = await fixture(); const expected = copy(data.receipt);
    const pending = assertMigrationReceipt(data.receipt, data.context);
    Object.assign(data.receipt.item, { title: "late change" }); Object.assign(data.target, { currentSnapshotId: "late" });
    expect(await pending).toEqual(expected);
  });
  test.each(["scope", "raw", "coverage", "parts", "image", "duplicate_member"])("rejects a changed preview target %s", async (kind) => {
    const data = await fixture();
    if (kind === "scope") Object.assign(data.target, { currentSnapshotId: "other" });
    if (kind === "raw") Object.assign(data.target.members[0], { rawText: "different raw" });
    if (kind === "coverage") Object.assign(data.target.members[0].manualLink!, { completeness: "complete" });
    if (kind === "parts") Object.assign(data.target.members[0].manualLink!, { totalParts: 2 });
    if (kind === "image") Object.assign(data.target.members[1].attachments[0], { sha256: "f".repeat(64) });
    if (kind === "duplicate_member") Object.assign(data.target, { members: [...data.target.members, data.target.members[0]] });
    await expect(assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test("rejects a large response before digest or rendering", async () => {
    const data = await fixture(); Object.assign(data.plan, { extra: "x".repeat(2_000_001) });
    await expect(assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test.each(["getter", "cycle", "sparse", "prototype"])("rejects non-data %s without invoking getters", async (kind) => {
    const data = await fixture(); let called = false;
    if (kind === "getter") Object.defineProperty(data.plan, "ready", { get: () => { called = true; return true; } });
    if (kind === "cycle") Object.assign(data.plan, { self: data.plan });
    if (kind === "sparse") delete data.plan.items[0];
    if (kind === "prototype") Object.setPrototypeOf(data.plan, { instruction: "trust me" });
    await expect(assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).rejects.toBeDefined(); expect(called).toBe(false);
  });
});

async function recoveryFixture() {
  const data = await fixture("partial", true);
  const request: MigratePromptCurationRequest = { expectedRevisionId: data.plan.expectedRevisionId, expectedSnapshotId: data.plan.expectedSnapshotId,
    expectedManifestHash: data.plan.expectedManifestHash, expectedPlanHash: data.plan.planHash, groupKey: data.receipt.item.groupKey, idempotencyKey: "original-migration-key" };
  Object.assign(data.target, { currentRevisionId: "later-document", currentSnapshotId: "later-snapshot", currentSnapshotVersion: 5, isHistorical: true });
  return { ...data, request, recovery: { recordId: "record", source: data.source, target: data.target, request },
    recoveryReceipt: { source: data.source, target: data.target, plan: data.plan, request } };
}

describe("historical migration review and exact pending receipts", () => {
  test("validates original basis without replacing actual current IDs or weakening current preview/receipt", async () => {
    const data = await recoveryFixture(), target = copy(data.target), request = copy(data.request);
    await expect(assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    await expect(assertMigrationReceipt(data.receipt, data.context)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
    for (const replayed of [false, true]) expect(await assertMigrationRecoveryReceipt({ ...data.receipt, replayed }, data.recoveryReceipt)).toEqual({ ...data.receipt, replayed });
    expect(data.target).toEqual(target); expect(data.request).toEqual(request);
    expect(data.target.selectedSnapshot!.id).toBe("new-snapshot"); expect(data.target.currentSnapshotId).toBe("later-snapshot");
  });
  test("a document-only advance also leaves the original pending revision unchanged", async () => {
    const data = await recoveryFixture(); Object.assign(data.target, { currentSnapshotId: data.plan.expectedSnapshotId });
    await expect(assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
  });
  test("not-ready historical review remains readable but cannot validate a receipt", async () => {
    const data = await recoveryFixture(); data.plan.items.splice(1, 1); data.plan.issues.push({ kind: "item", key: "duplicate", reason: "ambiguous" });
    data.plan.ready = false; await rehash(data.plan); Object.assign(data.request, { expectedPlanHash: data.plan.planHash });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test("same-snapshot issue refers to the original selected target, not the later current pointer", async () => {
    const data = await recoveryFixture(); Object.assign(data.source, { snapshotId: data.plan.expectedSnapshotId }); data.plan.sourceSnapshotId = data.source.snapshotId;
    data.plan.issues.push({ kind: "snapshot", key: data.plan.expectedSnapshotId, reason: "same_snapshot" }); data.plan.ready = false;
    await rehash(data.plan); Object.assign(data.request, { expectedPlanHash: data.plan.planHash });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
    data.plan.issues[0].key = data.target.currentSnapshotId!; await rehash(data.plan); Object.assign(data.request, { expectedPlanHash: data.plan.planHash });
    await expect(assertMigrationRecovery(data.plan, data.recovery)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test.each(["revision", "snapshot", "manifest", "plan_hash", "empty_key", "unsafe_key", "same_group", "empty_group", "unknown_request"])("rejects wrong original request %s at recovery and receipt", async (kind) => {
    const data = await recoveryFixture();
    if (kind === "revision") Object.assign(data.request, { expectedRevisionId: data.target.currentRevisionId });
    if (kind === "snapshot") Object.assign(data.request, { expectedSnapshotId: data.target.currentSnapshotId });
    if (kind === "manifest") Object.assign(data.request, { expectedManifestHash: "f".repeat(64) });
    if (kind === "plan_hash") Object.assign(data.request, { expectedPlanHash: "f".repeat(64) });
    if (kind === "empty_key") Object.assign(data.request, { idempotencyKey: "" });
    if (kind === "unsafe_key") Object.assign(data.request, { idempotencyKey: "bad\u0080" });
    if (kind === "same_group") Object.assign(data.request, { groupKey: data.source.groupKey });
    if (kind === "empty_group") Object.assign(data.request, { groupKey: "" });
    if (kind === "unknown_request") Object.assign(data.request, { confirmed: true });
    await expect(assertMigrationRecovery(data.plan, data.recovery)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test.each(["record", "source_id", "source_group", "source_snapshot", "source_manifest", "target_contract", "schema", "redacted", "selected_snapshot", "selected_manifest", "missing_current", "source_text", "source_hash", "target_image", "member_key_collision", "source_id_collision"])("rejects altered historical evidence %s", async (kind) => {
    const data = await recoveryFixture();
    if (kind === "record") Object.assign(data.target, { recordId: "another-record" });
    if (kind === "source_id") Object.assign(data.source, { id: "another-revision" });
    if (kind === "source_group") Object.assign(data.source, { groupKey: "another-group" });
    if (kind === "source_snapshot") Object.assign(data.source, { snapshotId: "another-source-snapshot" });
    if (kind === "source_manifest") Object.assign(data.source, { manifestHash: "f".repeat(64) });
    if (kind === "target_contract") Object.assign(data.target, { contract: "future" });
    if (kind === "schema") Object.assign(data.target, { schemaAvailable: false });
    if (kind === "redacted") Object.assign(data.target, { unavailableReason: "restricted_record_locked" });
    if (kind === "selected_snapshot") Object.assign(data.target.selectedSnapshot!, { id: data.target.currentSnapshotId });
    if (kind === "selected_manifest") Object.assign(data.target.selectedSnapshot!, { manifestHash: "b".repeat(64) });
    if (kind === "missing_current") Object.assign(data.target, { currentRevisionId: null });
    if (kind === "source_text") Object.assign(data.target.members[0], { rawText: "different" });
    if (kind === "source_hash") Object.assign(data.target.members[0], { contentHash: "f".repeat(64) });
    if (kind === "target_image") Object.assign(data.target.members[1].attachments[0], { sha256: "f".repeat(64) });
    if (kind === "member_key_collision") Object.assign(data.target.members[1], { memberKey: data.target.members[0].memberKey });
    if (kind === "source_id_collision") Object.assign(data.target.members[1], { sourceItemId: data.target.members[0].sourceItemId });
    await expect(assertMigrationRecovery(data.plan, data.recovery)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test("receipt must use exactly the captured new group, not another otherwise valid new group", async () => {
    const data = await recoveryFixture(); Object.assign(data.request, { groupKey: "different-new-group" });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test.each(["group", "based_on", "snapshot", "text", "range", "selection_origin", "image", "warning", "ready", "unknown_receipt"])("rejects altered recovery receipt %s", async (kind) => {
    const data = await recoveryFixture();
    if (kind === "group") Object.assign(data.receipt.item, { groupKey: "other" });
    if (kind === "based_on") Object.assign(data.receipt.item, { basedOnRevisionId: "other" });
    if (kind === "snapshot") Object.assign(data.receipt.item, { snapshotId: data.target.currentSnapshotId });
    if (kind === "text") Object.assign(data.receipt.item.items[0].fragment, { rawText: "rewritten" });
    if (kind === "range") Object.assign(data.receipt.item.items[0].fragment, { textEnd: 2 });
    if (kind === "selection_origin") Object.assign(data.receipt.item.items[0].fragment, { selectionOrigin: "ai_selected" });
    if (kind === "image") Object.assign(data.receipt.item.content.examples[0], { attachmentId: "other" });
    if (kind === "warning") Object.assign(data.receipt.item.prepared.channels.prompt, { warnings: [] });
    if (kind === "ready") data.plan.ready = false;
    if (kind === "unknown_receipt") Object.assign(data.receipt, { keyVerified: true });
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test("captures plan, receipt, original key, source and target synchronously before digests", async () => {
    const data = await recoveryFixture(), plan = copy(data.plan), receipt = copy(data.receipt);
    const review = assertMigrationRecovery(data.plan, data.recovery), saving = assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt);
    Object.assign(data.request, { groupKey: "late", idempotencyKey: "late", expectedRevisionId: "late" }); data.plan.planHash = "f".repeat(64);
    Object.assign(data.source, { id: "late" }); Object.assign(data.target.members[0], { rawText: "late" }); Object.assign(data.receipt.item, { title: "late" });
    expect(await review).toEqual(plan); expect(await saving).toEqual(receipt);
  });
  test.each(["context", "target", "source", "request", "plan", "member", "unused_target_field"])("rejects %s accessors without invoking code", async (kind) => {
    const data = await recoveryFixture(); let calls = 0;
    const get = () => { calls++; return "forged"; };
    if (kind === "context") { Object.defineProperty(data.recovery, "target", { get }); Object.defineProperty(data.recoveryReceipt, "target", { get }); }
    if (kind === "target") Object.defineProperty(data.target, "members", { get });
    if (kind === "source") Object.defineProperty(data.source, "prepared", { get });
    if (kind === "request") Object.defineProperty(data.request, "idempotencyKey", { get });
    if (kind === "plan") Object.defineProperty(data.plan, "items", { get });
    if (kind === "member") Object.defineProperty(data.target.members[0], "rawText", { get });
    if (kind === "unused_target_field") Object.defineProperty(data.target, "availableSources", { get });
    await expect(assertMigrationRecovery(data.plan, data.recovery)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" }); expect(calls).toBe(0);
  });
  test.each(["context_extra", "context_prototype", "request_prototype", "array_subclass", "array_symbol", "array_sparse", "cycle", "budget"])("rejects non-data or over-budget recovery %s", async (kind) => {
    const data = await recoveryFixture();
    if (kind === "context_extra") { Object.assign(data.recovery, { permission: true }); Object.assign(data.recoveryReceipt, { permission: true }); }
    if (kind === "context_prototype") { Object.setPrototypeOf(data.recovery, { permission: true }); Object.setPrototypeOf(data.recoveryReceipt, { permission: true }); }
    if (kind === "request_prototype") Object.setPrototypeOf(data.request, { permission: true });
    if (kind === "array_subclass") Object.setPrototypeOf(data.plan.items, Object.create(Array.prototype));
    if (kind === "array_symbol") Object.assign(data.plan.items, { [Symbol("extra")]: true });
    if (kind === "array_sparse") delete data.plan.items[0];
    if (kind === "cycle") Object.assign(data.plan, { self: data.plan });
    if (kind === "budget") Object.assign(data.plan, { extra: "x".repeat(2_000_001) });
    await expect(assertMigrationRecovery(data.plan, data.recovery)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
  test("unrelated histories/catalogs do not block selected snapshot verification", async () => {
    const data = await recoveryFixture();
    Object.assign(data.target, { availableSources: Array.from({ length: 300 }, () => ({ rawText: "x".repeat(10_000) })), snapshotHistory: { items: Array(300).fill({ id: "unrelated" }), nextCursor: null } });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
    expect(await assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).toEqual(data.receipt);
    Object.assign(data.target, { currentRevisionId: data.plan.expectedRevisionId, currentSnapshotId: data.plan.expectedSnapshotId });
    expect(await assertMigrationPreview(data.plan, { recordId: "record", source: data.source, target: data.target })).toEqual(data.plan);
    expect(await assertMigrationReceipt(data.receipt, data.context)).toEqual(data.receipt);
  });
  test("selected target member budget is 40 and is not relaxed by projection", async () => {
    const data = await recoveryFixture();
    const extra = Array.from({ length: 38 }, (_, n) => ({ ...data.target.members[0], memberId: `extra-member-${n}`, memberKey: `extra-key-${n}`, sourceItemId: `extra-source-${n}` }));
    Object.assign(data.target, { members: [...data.target.members, ...extra] });
    expect(await assertMigrationRecovery(data.plan, data.recovery)).toEqual(data.plan);
    Object.assign(data.target, { members: [...data.target.members, { ...extra[0], memberId: "forty-one", memberKey: "forty-one", sourceItemId: "forty-one" }] });
    await expect(assertMigrationRecovery(data.plan, data.recovery)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
    await expect(assertMigrationRecoveryReceipt(data.receipt, data.recoveryReceipt)).rejects.toMatchObject({ code: "prompt_curation_response_invalid" });
  });
});
