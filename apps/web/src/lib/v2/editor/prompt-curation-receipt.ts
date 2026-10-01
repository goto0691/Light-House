import { canonicalLinkJson, linkSha256Hex, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import type { LinkPresentationV1, PresentedLinkSource } from "@/lib/v2/domain/link-presentation-v1";
import { LINK_FRAGMENT_EVIDENCE_CONTRACT, type LinkFragmentEvidenceV1 } from "@/lib/v2/domain/link-fragment-evidence-v1";
import type { StoredManualLinkFragment } from "@/lib/v2/domain/manual-link-fragment-v1";
import { parseCreatePromptCurationRequest, parseRevisePromptCurationRequest, promptCurationId, type PromptCurationContent } from "@/lib/v2/domain/prompt-curation-request";
import { extractManualPromptFragment, preparePromptCuration, PromptCurationError, type PromptCurationFragment, type PromptCurationInput, type PromptCurationSource } from "@/lib/v2/domain/prompt-curation-v1";
import { STORED_PROMPT_CURATION_CONTRACT, type PromptCurationReceipt, type StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";
import { parsePromptCurationDraft, type PromptCurationPending } from "@/lib/v2/editor/prompt-curation-draft";

export type PromptCurationReceiptContext = Readonly<{
  recordId: string; pending: PromptCurationPending; snapshot: LinkPresentationV1;
  parent: StoredPromptCuration | null; restoreTarget: StoredPromptCuration | null;
  manualFragments?: readonly StoredManualLinkFragment[];
  aiFragments?: readonly LinkFragmentEvidenceV1[];
}>;
function invalid(): never { throw new PromptCurationError("prompt_curation_receipt_invalid", "저장 응답이 원래 정리본 요청·원문·버전과 일치하지 않습니다. 입력과 대기 요청을 유지했습니다."); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function equal(a: unknown, b: unknown) { check(canonicalLinkJson(a) === canonicalLinkJson(b)); }
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value)); const names = Object.keys(value);
  check(names.every((key) => keys.includes(key)) && keys.every((key) => names.includes(key) || optional.includes(key))); return value as Record<string, unknown>;
}
function list(value: unknown, max = 64): unknown[] { check(Array.isArray(value) && value.length <= max); return value; }
function hash(value: unknown): string { check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value)); return value; }
function integer(value: unknown, min = 1): number { check(Number.isSafeInteger(value) && Number(value) >= min); return value as number; }
function ownData(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === "string"); const descriptor = Object.getOwnPropertyDescriptor(value, key); check(descriptor && "value" in descriptor);
    result[key] = descriptor.value;
  }
  return result;
}
function verificationContext(context: PromptCurationReceiptContext): PromptCurationReceiptContext {
  const input = ownData(context), projection = ownData(input.snapshot);
  object(input, ["recordId", "pending", "snapshot", "parent", "restoreTarget", "manualFragments", "aiFragments"], ["manualFragments", "aiFragments"]);
  // Historical pages / availableSources are not receipt evidence. A long-lived
  // record can legitimately accumulate more of them than one snapshot's budget.
  // Read descriptors first, then capture just the selected authenticated proof.
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of ["contract", "schemaAvailable", "recordId", "selectedSnapshot", "members", "fragments", "selectedRun"]) snapshot[key] = projection[key];
  if (Object.hasOwn(projection, "unavailableReason")) snapshot.unavailableReason = projection.unavailableReason;
  return { ...input, snapshot } as unknown as PromptCurationReceiptContext;
}
function capture<T>(value: T): T {
  const ancestors = new Set<object>(); let nodes = 0, characters = 0;
  function copy(value: unknown, depth: number): unknown {
    check(++nodes <= 100_000 && depth <= 28);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { characters += value.length; check(characters <= 8_000_000); return value; }
    if (typeof value === "number") { check(Number.isFinite(value)); return value; }
    check(value && typeof value === "object" && !ancestors.has(value)); const array = Array.isArray(value);
    check(array ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const keys = Reflect.ownKeys(value); check(keys.length <= 257);
    if (array) check(value.length <= 256 && keys.length === value.length + 1);
    ancestors.add(value); const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && key === "length") continue;
      check(typeof key === "string" && (!array || /^(0|[1-9]\d*)$/.test(key)));
      const descriptor = Object.getOwnPropertyDescriptor(value, key); check(descriptor && "value" in descriptor);
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value); return result;
  }
  return copy(value, 0) as T;
}
function pending(value: PromptCurationPending): PromptCurationPending {
  const row = object(value, ["kind", "groupKey", "request", "originals"]);
  check(row.kind === "create" || row.kind === "revise");
  const request = row.kind === "create" ? parseCreatePromptCurationRequest(row.request) : parseRevisePromptCurationRequest(row.request);
  const isEdit = "action" in request && request.action === "edit";
  const draft = "content" in request ? { basis: { expectedRevisionId: request.expectedRevisionId, expectedSnapshotId: request.expectedSnapshotId, expectedManifestHash: request.expectedManifestHash },
    groupKey: row.groupKey, head: isEdit ? { id: request.expectedCurationRevisionId, revisionNumber: request.expectedCurationRevisionNumber } : null,
    content: request.content, originals: row.originals, dirty: true, conflict: false } : null;
  return parsePromptCurationDraft({ contract: "prompt-curation-draft.v1", draft, pending: row }).pending!;
}
function contentIdentity(content: PromptCurationContent) {
  return { ...content, items: [...content.items].sort((a, b) => a.copyRole < b.copyRole ? -1 : a.copyRole > b.copyRole ? 1 : a.position - b.position),
    examples: [...content.examples].sort((a, b) => a.position - b.position) };
}
function member(snapshot: LinkPresentationV1, key: string): PresentedLinkSource {
  const rows = snapshot.members.filter((entry) => entry.memberKey === key); check(rows.length === 1 && rows[0].memberId); return rows[0];
}
function mappedSource(source: PresentedLinkSource, fingerprint: string): PromptCurationSource {
  check(source.memberKey && source.kind === "url" && typeof source.rawText === "string" && source.manualLink);
  const claim = (value: number | null) => ({ value, origin: value === null ? "unknown" as const : "user_declared" as const });
  return { memberKey: source.memberKey, sourceFingerprint: hash(fingerprint), rawText: source.rawText, contentHash: normalizeLinkHash(source.contentHash), completeness: source.manualLink.completeness,
    parts: { number: claim(source.manualLink.partNumber), total: claim(source.manualLink.totalParts) } };
}
const storedKeys = ["id", "groupKey", "snapshotId", "revisionNumber", "parentRevisionId", "basedOnRevisionId", "changeReason", "title", "relationKind", "status", "createdAt", "manifestHash", "content", "prepared", "items", "examples"];

async function stored(value: StoredPromptCuration, snapshot: LinkPresentationV1, groupKey: string): Promise<StoredPromptCuration> {
  const row = object(value, storedKeys); promptCurationId(row.id); integer(row.revisionNumber);
  check(row.groupKey === groupKey && row.snapshotId === snapshot.selectedSnapshot!.id && ["active", "archived"].includes(String(row.status)));
  check(["create", "edit", "undo", "archive", "unarchive", "migrate"].includes(String(row.changeReason)));
  if (row.parentRevisionId !== null) promptCurationId(row.parentRevisionId);
  if (row.basedOnRevisionId !== null) promptCurationId(row.basedOnRevisionId);
  check(typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)));
  const content = parseCreatePromptCurationRequest({ expectedRevisionId: "receipt-validation", expectedSnapshotId: row.snapshotId,
    expectedManifestHash: snapshot.selectedSnapshot!.manifestHash, idempotencyKey: "receipt-validation", groupKey, content: row.content }).content;
  equal([row.title, row.relationKind], [content.title, content.relationKind]);
  const prepared = object(row.prepared, ["manifestVersion", "renderVersion", "manifestJson", "manifestHash", "channels"]);
  check(typeof prepared.manifestJson === "string" && prepared.manifestJson.length <= 1_000_000 && prepared.manifestHash === hash(row.manifestHash)
    && await linkSha256Hex(prepared.manifestJson) === row.manifestHash);
  const manifest = object(JSON.parse(prepared.manifestJson), ["manifestVersion", "renderVersion", "snapshotManifestHash", "title", "relationKind", "relationshipConfirmation", "orderConfirmation", "separator", "items", "examples"]);
  check(manifest.snapshotManifestHash === snapshot.selectedSnapshot!.manifestHash);
  const manifestItems = list(manifest.items), items = list(row.items), examples = list(row.examples);
  check(items.length === content.items.length && manifestItems.length === items.length && examples.length === content.examples.length);
  const sources = new Map<string, PromptCurationSource>(), seen = new Set<string>();
  for (const raw of items) {
    const item = object(raw, ["itemKey", "copyRole", "position", "fragment"]), key = promptCurationId(item.itemKey);
    check(!seen.has(key)); seen.add(key);
    const selection = content.items.find((entry) => entry.itemKey === key); check(selection);
    equal([item.copyRole, item.position], [selection.copyRole, selection.position]);
    const fragment = object(item.fragment, ["memberKey", "sourceClass", "role", "selectionOrigin", "textStart", "textEnd", "rawText", "rawTextHash", "completeness"]);
    const matches = manifestItems.filter((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).itemKey === key); check(matches.length === 1);
    const claim = matches[0] as Record<string, unknown>, source = member(snapshot, promptCurationId(fragment.memberKey));
    const mapped = mappedSource(source, hash(claim.sourceFingerprint));
    if (sources.has(mapped.memberKey)) equal(sources.get(mapped.memberKey), mapped); else sources.set(mapped.memberKey, mapped);
  }
  const imageKeys = new Set<string>();
  for (const raw of examples) {
    const example = object(raw, ["exampleKey", "itemKey", "memberKey", "sourceFingerprint", "sha256", "mimeType", "sizeBytes", "position", "evidenceMethod"]), key = promptCurationId(example.exampleKey);
    check(!imageKeys.has(key)); imageKeys.add(key);
    const selection = content.examples.find((entry) => entry.exampleKey === key); check(selection);
    const source = member(snapshot, promptCurationId(example.memberKey)), images = source.attachments.filter((entry) => entry.id === selection.attachmentId);
    check(source.kind === "image" && source.memberId === selection.memberId && images.length === 1);
    equal([example.itemKey, example.position, example.evidenceMethod, example.sha256, example.mimeType, example.sizeBytes],
      [selection.itemKey, selection.position, selection.evidenceMethod, normalizeLinkHash(images[0].sha256), images[0].mimeType, images[0].sizeBytes]);
  }
  const input: PromptCurationInput = { snapshotManifestHash: snapshot.selectedSnapshot!.manifestHash, title: content.title, relationKind: content.relationKind,
    relationshipConfirmation: content.relationshipConfirmation, orderConfirmation: content.orderConfirmation, separator: "\n", sources: [...sources.values()],
    items: items as unknown as PromptCurationInput["items"], examples: examples as unknown as PromptCurationInput["examples"] };
  equal(prepared, await preparePromptCuration(input));
  return value;
}
function previousFragment(parent: StoredPromptCuration | null, fragmentId: string, stateVersion: number) {
  if (!parent) return null;
  const selections = parent.content.items.filter((entry) => entry.fragmentId === fragmentId && entry.expectedFragmentStateVersion >= stateVersion);
  const fragments = selections.map((entry) => parent.items.find((item) => item.itemKey === entry.itemKey)?.fragment);
  if (!fragments.length) return null; check(fragments[0]);
  for (const fragment of fragments) equal(fragment, fragments[0]); return fragments[0];
}
function proofFragment(selection: PromptCurationContent["items"][number], context: PromptCurationReceiptContext, historical: ReadonlyMap<string, PromptCurationFragment>): PromptCurationFragment {
  const exact = historical.get(selection.fragmentId); if (exact) return exact;
  const manuals = (context.manualFragments ?? []).filter((entry) => entry.id === selection.fragmentId); check(manuals.length <= 1);
  if (manuals.length) {
    const row = manuals[0]; check(row.snapshotId === context.pending.request.expectedSnapshotId && integer(row.stateVersion) >= selection.expectedFragmentStateVersion
      && row.fragment.selectionOrigin === "user_selected" && row.primaryMemberId === member(context.snapshot, row.fragment.memberKey).memberId); return row.fragment;
  }
  const ai = context.snapshot.fragments.filter((entry) => entry.id === selection.fragmentId); check(ai.length <= 1);
  if (ai.length) {
    const row = ai[0]; check(row.snapshotId === context.pending.request.expectedSnapshotId && row.runId && context.snapshot.selectedRun?.id === row.runId
      && context.snapshot.selectedRun.snapshotId === row.snapshotId && row.sourceClass === "source_extract" && row.rawText !== null
      && row.rawTextHash && row.derivedText === null && row.role === selection.copyRole && integer(row.stateVersion) >= selection.expectedFragmentStateVersion && row.evidence.length === 1);
    const evidence = row.evidence[0], source = member(context.snapshot, evidence.memberKey);
    check(evidence.memberId === row.primaryMemberId && source.memberId === row.primaryMemberId && evidence.sourceItemId === source.sourceItemId
      && evidence.relationKind === "supports" && evidence.evidenceMethod === "ai_proposed" && evidence.displayOrder === 0 && evidence.textStart !== null && evidence.textEnd !== null);
    return { memberKey: evidence.memberKey, sourceClass: "source_extract", role: selection.copyRole, selectionOrigin: "ai_selected", textStart: evidence.textStart,
      textEnd: evidence.textEnd, rawText: row.rawText, rawTextHash: normalizeLinkHash(row.rawTextHash), completeness: row.completeness as PromptCurationFragment["completeness"] };
  }
  const prior = previousFragment(context.parent, selection.fragmentId, selection.expectedFragmentStateVersion); check(prior); return prior;
}

function validateBasis(context: PromptCurationReceiptContext): PromptCurationReceiptContext {
  const operation = pending(context.pending), { snapshot } = context, request = operation.request;
  check(snapshot.contract === "link-presentation.v1" && snapshot.schemaAvailable && !snapshot.unavailableReason && snapshot.recordId === promptCurationId(context.recordId)
    && snapshot.selectedSnapshot?.id === request.expectedSnapshotId && snapshot.selectedSnapshot.manifestHash === request.expectedManifestHash);
  list(snapshot.members, 40); check(new Set(snapshot.members.map((entry) => entry.memberId)).size === snapshot.members.length
    && new Set(snapshot.members.map((entry) => entry.memberKey)).size === snapshot.members.length
    && new Set(snapshot.members.map((entry) => entry.sourceItemId)).size === snapshot.members.length);
  return { ...context, pending: operation };
}

/** An exact authenticated lookup is historical content evidence, not permission
 * to create a new curation. Review state may advance after an old request commits;
 * only the server's original idempotent receipt can settle that pending request. */
async function historicalFragments(context: PromptCurationReceiptContext): Promise<Map<string, PromptCurationFragment>> {
  const proofs = new Map<string, PromptCurationFragment>(), values = list(context.aiFragments ?? []);
  if (context.aiFragments === undefined) return proofs; // Older callers retain fail-closed projection/parent proof.
  const operation = context.pending, request = operation.request;
  const content = "content" in request ? request.content : null;
  const expected = content ? operation.originals.filter((row) => row.origin === "ai" || row.isManual === false) : [];
  check(values.length === expected.length);
  for (const value of values) {
    const dto = object(value, ["contract", "recordId", "snapshotId", "snapshotManifestHash", "run", "fragment"]);
    check(dto.contract === LINK_FRAGMENT_EVIDENCE_CONTRACT && dto.recordId === context.recordId
      && dto.snapshotId === request.expectedSnapshotId && dto.snapshotManifestHash === request.expectedManifestHash);
    const run = object(dto.run, ["id", "jobId", "snapshotId", "documentRevisionId", "status", "createdAt", "finishedAt", "isPublished"]);
    for (const key of ["id", "jobId", "documentRevisionId"]) promptCurationId(run[key]);
    check(run.snapshotId === dto.snapshotId && ["succeeded", "partial"].includes(String(run.status)) && typeof run.isPublished === "boolean"
      && typeof run.createdAt === "string" && Number.isFinite(Date.parse(run.createdAt))
      && typeof run.finishedAt === "string" && Number.isFinite(Date.parse(run.finishedAt)));
    const row = object(dto.fragment, ["id", "fragmentKey", "snapshotId", "runId", "role", "sourceClass", "rawText", "rawTextHash", "derivedText", "completeness", "reviewStatus", "lockedByUser", "stateVersion", "displayOrder", "primaryMemberId", "evidence"]);
    const id = promptCurationId(row.id), original = expected.find((entry) => entry.id === id);
    check(original && !proofs.has(id) && content); promptCurationId(row.fragmentKey);
    const selections = content.items.filter((entry) => entry.fragmentId === id); check(selections.length > 0);
    check(row.snapshotId === dto.snapshotId && row.runId === run.id && row.sourceClass === "source_extract" && row.derivedText === null
      && typeof row.rawText === "string" && typeof row.rawTextHash === "string" && typeof row.lockedByUser === "boolean"
      && ["proposed", "confirmed", "rejected", "superseded"].includes(String(row.reviewStatus)));
    integer(row.displayOrder, 0); integer(row.stateVersion);
    for (const selection of selections) check(row.role === selection.copyRole && Number(row.stateVersion) >= selection.expectedFragmentStateVersion
      && original.stateVersion === selection.expectedFragmentStateVersion);
    const evidence = list(row.evidence, 1); check(evidence.length === 1);
    const reference = object(evidence[0], ["id", "memberId", "memberKey", "sourceItemId", "relationKind", "evidenceMethod", "textStart", "textEnd", "quote", "displayOrder"]);
    promptCurationId(reference.id);
    const source = member(context.snapshot, promptCurationId(reference.memberKey));
    check(reference.memberId === row.primaryMemberId && source.memberId === row.primaryMemberId && reference.sourceItemId === source.sourceItemId
      && reference.relationKind === "supports" && reference.evidenceMethod === "ai_proposed" && reference.displayOrder === 0 && reference.quote === row.rawText);
    // Reuse exact UTF-16/surrogate/range/whole-source hash validation. This DTO
    // omits fingerprints; the temporary value below is never ownership evidence
    // and is not used in the receipt manifest. Ownership stays server-side.
    const fragment = await extractManualPromptFragment(mappedSource(source, hash(normalizeLinkHash(source.contentHash))), {
      textStart: integer(reference.textStart, 0), textEnd: integer(reference.textEnd, 0), role: selections[0].copyRole,
    });
    check(fragment.rawText === row.rawText && fragment.rawTextHash === normalizeLinkHash(row.rawTextHash));
    check(["complete", "partial", "truncated", "ocr_unverified", "selection_unverified", "unknown"].includes(String(row.completeness)));
    equal([original.rawText, original.role, original.completeness, original.snapshotId], [row.rawText, row.role, row.completeness, dto.snapshotId]);
    if (original.memberId !== null) check(original.memberId === source.memberId);
    if (original.sourceItemId !== null) check(original.sourceItemId === source.sourceItemId);
    if (original.sourceUrl !== null) check(source.manualLink && new URL(source.manualLink.url).href === original.sourceUrl);
    proofs.set(id, { ...fragment, selectionOrigin: "ai_selected", completeness: row.completeness as PromptCurationFragment["completeness"] });
  }
  return proofs;
}

/** Preflight immediately after exact evidence GETs and before sending the
 * unchanged pending POST. Capture the whole invocation before any digest await. */
export async function assertPromptCurationAiEvidence(value: unknown, context: Omit<PromptCurationReceiptContext, "aiFragments">): Promise<readonly LinkFragmentEvidenceV1[]> {
  try {
    const captured = capture(verificationContext({ ...ownData(context), aiFragments: value } as PromptCurationReceiptContext));
    const checked = validateBasis(captured); await historicalFragments(checked); return checked.aiFragments!;
  } catch { return invalid(); }
}

/** Call only with freshly authenticated original-snapshot/revision/fragment GETs.
 * This checks immutable content and transitions, not browser access authority.
 * The DTO omits source fingerprints/full metadata and owner/idempotency receipt
 * binding; these remain the authenticated repository's proof responsibility.
 * A missing old AI selection is not reconstructed from equal text: keep pending.
 */
export async function assertPromptCurationReceipt(value: unknown, context: PromptCurationReceiptContext): Promise<PromptCurationReceipt> {
  try {
    const captured = capture({ value, context: verificationContext(context) });
    object(captured.context, ["recordId", "pending", "snapshot", "parent", "restoreTarget", "manualFragments", "aiFragments"], ["manualFragments", "aiFragments"]);
    const checkedContext = validateBasis(captured.context), operation = checkedContext.pending;
    const { snapshot, parent, restoreTarget } = checkedContext, request = operation.request;
    check(snapshot.contract === "link-presentation.v1" && snapshot.schemaAvailable && !snapshot.unavailableReason && snapshot.recordId === promptCurationId(checkedContext.recordId)
      && snapshot.selectedSnapshot?.id === request.expectedSnapshotId && snapshot.selectedSnapshot.manifestHash === request.expectedManifestHash);
    list(snapshot.members, 40); check(new Set(snapshot.members.map((entry) => entry.memberId)).size === snapshot.members.length
      && new Set(snapshot.members.map((entry) => entry.memberKey)).size === snapshot.members.length
      && new Set(snapshot.members.map((entry) => entry.sourceItemId)).size === snapshot.members.length);
    list(checkedContext.manualFragments ?? []);
    const historical = await historicalFragments(checkedContext);
    const wrapper = object(captured.value, ["contract", "item", "replayed"]); check(wrapper.contract === STORED_PROMPT_CURATION_CONTRACT && typeof wrapper.replayed === "boolean");
    const item = await stored(wrapper.item as StoredPromptCuration, snapshot, operation.groupKey);
    let expectedContent: PromptCurationContent, expectedStatus: StoredPromptCuration["status"];
    if (operation.kind === "create") {
      check(parent === null && restoreTarget === null && item.revisionNumber === 1 && item.parentRevisionId === null && item.basedOnRevisionId === null && item.changeReason === "create");
      expectedContent = operation.request.content; expectedStatus = "active";
    } else {
      const revision = operation.request; check(parent); await stored(parent, snapshot, operation.groupKey);
      check(parent.id === revision.expectedCurationRevisionId && parent.revisionNumber === revision.expectedCurationRevisionNumber && item.id !== parent.id
        && item.parentRevisionId === parent.id && item.revisionNumber === parent.revisionNumber + 1 && item.changeReason === revision.action);
      if (revision.action === "undo") {
        check(restoreTarget); await stored(restoreTarget, snapshot, operation.groupKey);
        check(restoreTarget.id === revision.restoreRevisionId && restoreTarget.revisionNumber <= parent.revisionNumber && item.id !== restoreTarget.id && item.basedOnRevisionId === restoreTarget.id);
        expectedContent = restoreTarget.content; expectedStatus = restoreTarget.status;
      } else {
        check(restoreTarget === null && item.basedOnRevisionId === null);
        expectedContent = revision.action === "edit" ? revision.content : parent.content;
        expectedStatus = revision.action === "archive" ? "archived" : revision.action === "unarchive" ? "active" : parent.status;
      }
    }
    equal(contentIdentity(item.content), contentIdentity(expectedContent)); check(item.status === expectedStatus);
    const transitionsOnly = operation.kind === "revise" && operation.request.action !== "edit";
    for (const selection of expectedContent.items) {
      const actual = item.items.find((entry) => entry.itemKey === selection.itemKey); check(actual);
      const proof = transitionsOnly ? (restoreTarget ?? parent)!.items.find((entry) => entry.itemKey === selection.itemKey)?.fragment : proofFragment(selection, checkedContext, historical);
      check(proof); equal(actual.fragment, proof);
      const original = operation.originals.find((entry) => entry.id === selection.fragmentId); check(original);
      equal([original.rawText, original.role, original.completeness, original.snapshotId, original.stateVersion],
        [proof.rawText, proof.role, proof.completeness, request.expectedSnapshotId, selection.expectedFragmentStateVersion]);
      const source = member(snapshot, proof.memberKey);
      if (original.memberId !== null) check(original.memberId === source.memberId);
      if (original.sourceItemId !== null) check(original.sourceItemId === source.sourceItemId);
      if (original.sourceUrl !== null) check(source.manualLink && new URL(source.manualLink.url).href === original.sourceUrl);
      if (original.origin === "manual" || original.isManual === true) check(proof.selectionOrigin === "user_selected");
      if (original.origin === "ai" || original.isManual === false) check(proof.selectionOrigin === "ai_selected");
    }
    check(new Set(expectedContent.items.map((entry) => entry.fragmentId)).size === operation.originals.length);
    return wrapper as unknown as PromptCurationReceipt;
  } catch { return invalid(); }
}
