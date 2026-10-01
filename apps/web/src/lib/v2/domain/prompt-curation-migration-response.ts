import { canonicalLinkJson, linkSha256Hex, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import type { LinkPresentationV1, PresentedLinkSource } from "@/lib/v2/domain/link-presentation-v1";
import { PROMPT_CURATION_MIGRATION_CONTRACT, migrationCoverageMatches, type PromptCurationMigrationPlan } from "@/lib/v2/domain/prompt-curation-migration";
import { parseCreatePromptCurationRequest, parseMigratePromptCurationRequest, promptCurationId, type MigratePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { preparePromptCuration, PromptCurationError, type PromptCurationInput, type PromptCurationSource } from "@/lib/v2/domain/prompt-curation-v1";
import { STORED_PROMPT_CURATION_CONTRACT, type PromptCurationReceipt, type StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";

function invalid(): never { throw new PromptCurationError("prompt_curation_response_invalid", "이관 응답이 확인한 원문·자료 버전과 일치하지 않습니다. 다시 확인해 주세요."); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function equal(a: unknown, b: unknown) { check(canonicalLinkJson(a) === canonicalLinkJson(b)); }

/** Capture before the first digest, without invoking getters or JSON hooks. */
function capture<T>(value: T): T {
  const ancestors = new Set<object>(); let nodes = 0, characters = 0;
  function copy(value: unknown, depth: number): unknown {
    check(++nodes <= 30_000 && depth <= 24);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { characters += value.length; check(characters <= 2_000_000); return value; }
    if (typeof value === "number") { check(Number.isFinite(value)); return value; }
    check(value && typeof value === "object" && !ancestors.has(value));
    const array = Array.isArray(value); check(array ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value)));
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
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  equal(Object.keys(value).sort(), [...fields].sort()); return value as Record<string, unknown>;
}
function list(value: unknown, max = 64): unknown[] { check(Array.isArray(value) && value.length <= max); return value; }
function id(value: unknown): string { try { return promptCurationId(value); } catch { return invalid(); } }
function hash(value: unknown): string { check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value)); return value; }
type PreviewContext = { recordId: string; source: StoredPromptCuration; target: LinkPresentationV1 };
type ReceiptContext = { source: StoredPromptCuration; plan: PromptCurationMigrationPlan; groupKey: string; target: LinkPresentationV1 };
type RecoveryContext = PreviewContext & { request: MigratePromptCurationRequest };
type RecoveryReceiptContext = Omit<RecoveryContext, "recordId"> & { plan: PromptCurationMigrationPlan };
function ownData(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === "string"); const descriptor = Object.getOwnPropertyDescriptor(value, key); check(descriptor && "value" in descriptor);
    result[key] = descriptor.value;
  }
  return result;
}
/** History, unselected source catalogs and current AI output are not evidence
 * for this operation. Keep the actual current IDs; never forge an old current
 * snapshot to pass current-preview validation. Inspect descriptors before any
 * read, then capture only the selected (at most 40-member) target proof. */
function invocation<T>(value: unknown, context: T, fields: readonly string[]): { value: unknown; context: T } {
  const input = ownData(context); object(input, fields);
  const projection = ownData(input.target), target: Record<string, unknown> = Object.create(null);
  for (const key of ["contract", "schemaAvailable", "recordId", "currentRevisionId", "currentSnapshotId", "selectedSnapshot", "members"]) target[key] = projection[key];
  if (Object.hasOwn(projection, "unavailableReason")) target.unavailableReason = projection.unavailableReason;
  return capture({ value, context: { ...input, target } as T });
}
function recoveryRequest(value: unknown, source: StoredPromptCuration, plan: unknown) {
  const request = parseMigratePromptCurationRequest(value), row = ownData(plan);
  check(request.groupKey !== source.groupKey);
  equal([request.expectedRevisionId, request.expectedSnapshotId, request.expectedManifestHash, request.expectedPlanHash],
    [row.expectedRevisionId, row.expectedSnapshotId, row.expectedManifestHash, row.planHash]);
  return request;
}
type ManifestItem = { itemKey: string; sourceFingerprint: string; sourceContentHash: string; sourceCompleteness: PromptCurationSource["completeness"]; parts: PromptCurationSource["parts"] };
async function sourceManifest(source: StoredPromptCuration) {
  check(source.prepared.manifestHash === source.manifestHash && await linkSha256Hex(source.prepared.manifestJson) === source.manifestHash);
  const manifest = JSON.parse(source.prepared.manifestJson) as { items: ManifestItem[]; snapshotManifestHash: string };
  check(Array.isArray(manifest.items) && manifest.items.length === source.items.length);
  return manifest;
}
function targetMember(target: LinkPresentationV1, memberId: string) {
  const matches = target.members.filter((member) => member.memberId === memberId);
  check(matches.length === 1 && matches[0].memberKey); return matches[0];
}
function mappedSource(member: PresentedLinkSource, fingerprint: string): PromptCurationSource {
  check(member.kind === "url" && member.manualLink && typeof member.rawText === "string" && member.memberKey);
  const claim = (value: number | null) => ({ value, origin: value === null ? "unknown" as const : "user_declared" as const });
  return { memberKey: member.memberKey, sourceFingerprint: fingerprint, rawText: member.rawText, contentHash: normalizeLinkHash(member.contentHash),
    completeness: member.manualLink.completeness, parts: { number: claim(member.manualLink.partNumber), total: claim(member.manualLink.totalParts) } };
}

/** UI response validation is not an owner/DB proof. The projection deliberately
 * omits full source metadata/fingerprint; the authenticated server's matching
 * verdict remains authoritative, bound here to its exact snapshot manifest. */
export async function assertMigrationPreview(value: unknown, context: PreviewContext): Promise<PromptCurationMigrationPlan> {
  try { const captured = invocation(value, context, ["recordId", "source", "target"]); return await preview(captured.value, captured.context); } catch { return invalid(); }
}
/** Validate cached review/pending intent against fresh exact source revision
 * and original target snapshot reads. This grants no write permission: a stale
 * new request still fails server CAS, while an exact committed receipt may replay. */
export async function assertMigrationRecovery(value: unknown, context: RecoveryContext): Promise<PromptCurationMigrationPlan> {
  try {
    const captured = invocation(value, context, ["recordId", "source", "target", "request"]);
    const request = recoveryRequest(captured.context.request, captured.context.source, captured.value);
    return await preview(captured.value, captured.context, request);
  } catch { return invalid(); }
}
async function preview(value: unknown, { recordId, source, target }: PreviewContext, originalBasis?: MigratePromptCurationRequest) {
  const row = object(value, ["contract", "recordId", "sourceGroupKey", "sourceRevisionId", "sourceSnapshotId", "sourceManifestHash", "expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "items", "examples", "issues", "selectionConfirmations", "ready", "planHash"]);
  check(row.contract === PROMPT_CURATION_MIGRATION_CONTRACT && target.contract === "link-presentation.v1" && target.schemaAvailable && !target.unavailableReason
    && target.recordId === id(recordId) && target.selectedSnapshot && target.currentRevisionId && target.currentSnapshotId);
  id(target.currentRevisionId); id(target.currentSnapshotId); id(source.groupKey); id(source.id); id(source.snapshotId); hash(source.manifestHash);
  const selectedId = id(target.selectedSnapshot.id), selectedHash = hash(target.selectedSnapshot.manifestHash);
  if (!originalBasis) check(selectedId === target.currentSnapshotId);
  else check(selectedId === originalBasis.expectedSnapshotId && selectedHash === originalBasis.expectedManifestHash);
  const members = list(target.members, 40);
  for (const key of ["memberId", "memberKey", "sourceItemId"] as const) check(new Set(members.map((raw) => id((raw as PresentedLinkSource)[key]))).size === members.length);
  equal([row.recordId, row.sourceGroupKey, row.sourceRevisionId, row.sourceSnapshotId, row.sourceManifestHash, row.expectedRevisionId, row.expectedSnapshotId, row.expectedManifestHash],
    [recordId, source.groupKey, source.id, source.snapshotId, source.manifestHash, originalBasis?.expectedRevisionId ?? target.currentRevisionId, selectedId, selectedHash]);
  const { planHash, ...body } = row; check(await linkSha256Hex(canonicalLinkJson(body)) === hash(planHash));
  const manifest = await sourceManifest(source), itemKeys = new Set<string>(), exampleKeys = new Set<string>();
  for (const raw of list(row.items)) {
    const entry = object(raw, ["itemKey", "fragmentId", "memberId", "match"]), key = id(entry.itemKey);
    check(!itemKeys.has(key)); itemKeys.add(key);
    const original = source.items.find((item) => item.itemKey === key), stored = source.content.items.find((item) => item.itemKey === key), claim = manifest.items.find((item) => item.itemKey === key);
    check(original && stored && claim && entry.fragmentId === stored.fragmentId);
    const member = targetMember(target, id(entry.memberId)), mapped = mappedSource(member, hash(claim.sourceFingerprint));
    check(entry.match === "member_key" ? member.memberKey === original.fragment.memberKey : entry.match === "fingerprint" && !target.members.some((candidate) => candidate.memberKey === original.fragment.memberKey));
    check(mapped.contentHash === claim.sourceContentHash && await linkSha256Hex(mapped.rawText) === mapped.contentHash);
    equal(mapped.parts, claim.parts); check(mapped.completeness === claim.sourceCompleteness && migrationCoverageMatches(original.fragment, mapped.completeness));
    check(mapped.rawText.slice(original.fragment.textStart, original.fragment.textEnd) === original.fragment.rawText && await linkSha256Hex(original.fragment.rawText) === original.fragment.rawTextHash);
  }
  for (const raw of list(row.examples)) {
    const entry = object(raw, ["exampleKey", "memberId", "attachmentId", "match"]), key = id(entry.exampleKey);
    check(!exampleKeys.has(key)); exampleKeys.add(key);
    const original = source.examples.find((example) => example.exampleKey === key); check(original);
    const member = targetMember(target, id(entry.memberId)), images = member.attachments.filter((image) => image.id === entry.attachmentId);
    check(member.kind === "image" && images.length === 1);
    check(entry.match === "member_key" ? member.memberKey === original.memberKey : entry.match === "fingerprint" && !target.members.some((candidate) => candidate.memberKey === original.memberKey));
    const image = images[0]; check(normalizeLinkHash(image.sha256) === original.sha256 && image.mimeType === original.mimeType && image.sizeBytes === original.sizeBytes);
  }
  const issues = list(row.issues, 129); let sameSnapshot = false;
  for (const raw of issues) {
    const issue = object(raw, ["kind", "key", "reason"]), key = id(issue.key);
    if (issue.kind === "snapshot") { check(!sameSnapshot && issue.reason === "same_snapshot" && key === selectedId && source.snapshotId === selectedId); sameSnapshot = true; continue; }
    check(issue.kind === "item" || issue.kind === "example");
    check(["missing", "changed", "ambiguous", ...(issue.kind === "item" ? ["range_changed", "coverage_changed"] : [])].includes(String(issue.reason)));
    const keys = issue.kind === "item" ? itemKeys : exampleKeys, originals = issue.kind === "item" ? source.items.map((item) => item.itemKey) : source.examples.map((item) => item.exampleKey);
    check(originals.includes(key) && !keys.has(key)); keys.add(key);
  }
  equal([...itemKeys].sort(), source.items.map((item) => item.itemKey).sort()); equal([...exampleKeys].sort(), source.examples.map((example) => example.exampleKey).sort());
  check(sameSnapshot === (source.snapshotId === selectedId) && row.ready === (issues.length === 0));
  equal(row.selectionConfirmations, source.items.filter((item) => item.fragment.selectionOrigin === "ai_selected").map((item) => item.itemKey));
  return row as unknown as PromptCurationMigrationPlan;
}

export async function assertMigrationReceipt(value: unknown, context: ReceiptContext): Promise<PromptCurationReceipt> {
  try { const captured = invocation(value, context, ["source", "plan", "groupKey", "target"]); return await receipt(captured.value, captured.context); } catch { return invalid(); }
}
/** The request key is captured and strictly parsed, never regenerated. Its
 * actual idempotency binding is server-side because receipts omit that key. */
export async function assertMigrationRecoveryReceipt(value: unknown, context: RecoveryReceiptContext): Promise<PromptCurationReceipt> {
  try {
    const captured = invocation(value, context, ["source", "target", "plan", "request"]), { source, plan, target } = captured.context;
    const request = recoveryRequest(captured.context.request, source, plan);
    return await receipt(captured.value, { source, target, plan, groupKey: request.groupKey }, request);
  } catch { return invalid(); }
}
async function receipt(value: unknown, { source, plan, groupKey, target }: ReceiptContext, originalBasis?: MigratePromptCurationRequest): Promise<PromptCurationReceipt> {
    await preview(plan, { recordId: plan.recordId, source, target }, originalBasis); check(plan.ready && id(groupKey) !== source.groupKey);
    const receipt = object(value, ["contract", "item", "replayed"]);
    check(receipt.contract === STORED_PROMPT_CURATION_CONTRACT && typeof receipt.replayed === "boolean");
    const row = object(receipt.item, ["id", "groupKey", "snapshotId", "revisionNumber", "parentRevisionId", "basedOnRevisionId", "changeReason", "title", "relationKind", "status", "createdAt", "manifestHash", "content", "prepared", "items", "examples"]);
    check(id(row.id) !== source.id && row.groupKey === groupKey && row.snapshotId === plan.expectedSnapshotId && row.revisionNumber === 1
      && row.parentRevisionId === null && row.basedOnRevisionId === source.id && row.changeReason === "migrate" && row.status === "active"
      && typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)));
    const content = parseCreatePromptCurationRequest({ expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId,
      expectedManifestHash: plan.expectedManifestHash, idempotencyKey: "response-validation", groupKey, content: row.content }).content;
    equal([row.title, row.relationKind, content.title, content.relationKind, content.relationshipConfirmation, content.orderConfirmation],
      [source.title, source.relationKind, source.content.title, source.content.relationKind, source.content.relationshipConfirmation, source.content.orderConfirmation]);
    check(content.items.length === source.content.items.length && content.examples.length === source.content.examples.length);
    const fragmentIds = new Map<string, string>();
    for (const item of content.items) {
      const original = source.content.items.find((entry) => entry.itemKey === item.itemKey); check(original);
      check(item.copyRole === original.copyRole && item.position === original.position && item.expectedFragmentStateVersion === 1
        && !source.content.items.some((entry) => entry.fragmentId === item.fragmentId));
      if (fragmentIds.has(original.fragmentId)) check(fragmentIds.get(original.fragmentId) === item.fragmentId);
      else { check(![...fragmentIds.values()].includes(item.fragmentId)); fragmentIds.set(original.fragmentId, item.fragmentId); }
    }
    for (const example of content.examples) {
      const original = source.content.examples.find((entry) => entry.exampleKey === example.exampleKey), mapping = plan.examples.find((entry) => entry.exampleKey === example.exampleKey);
      check(original && mapping); equal(example, { ...original, memberId: mapping.memberId, attachmentId: mapping.attachmentId });
    }
    const manifest = await sourceManifest(source), sources = new Map<string, PromptCurationSource>();
    const items = source.items.map((item) => {
      const mapping = plan.items.find((entry) => entry.itemKey === item.itemKey), claim = manifest.items.find((entry) => entry.itemKey === item.itemKey); check(mapping && claim);
      const member = targetMember(target, mapping.memberId), memberSource = mappedSource(member, claim.sourceFingerprint);
      sources.set(memberSource.memberKey, memberSource);
      return { ...item, fragment: { ...item.fragment, memberKey: memberSource.memberKey, selectionOrigin: "user_selected" as const, completeness: memberSource.completeness } };
    });
    const examples = source.examples.map((example) => {
      const mapping = plan.examples.find((entry) => entry.exampleKey === example.exampleKey); check(mapping);
      return { ...example, memberKey: targetMember(target, mapping.memberId).memberKey! };
    });
    const input: PromptCurationInput = { snapshotManifestHash: plan.expectedManifestHash, title: content.title, relationKind: content.relationKind,
      relationshipConfirmation: content.relationshipConfirmation, orderConfirmation: content.orderConfirmation, separator: "\n", sources: [...sources.values()], items, examples };
    const prepared = await preparePromptCuration(input);
    equal(row.prepared, prepared); check(row.manifestHash === prepared.manifestHash);
    const byItemKey = (value: unknown) => list(value).map((item) => {
      check(item && typeof item === "object" && !Array.isArray(item)); return item as Record<string, unknown>;
    }).sort((a, b) => String(a.itemKey) < String(b.itemKey) ? -1 : String(a.itemKey) > String(b.itemKey) ? 1 : 0);
    equal(byItemKey(row.items), byItemKey(items)); equal(row.examples, examples);
    return receipt as unknown as PromptCurationReceipt;
}
