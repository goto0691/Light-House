import { canonicalLinkJson } from "@/lib/v2/domain/link-snapshot-v1";
import { MANUAL_LINK_LIMITS } from "@/lib/v2/domain/manual-link-source";
import { parseCreatePromptCurationRequest, parseRevisePromptCurationRequest, promptCurationId, type CreatePromptCurationRequest, type PromptCurationContent, type RevisePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { PROMPT_CURATION_LIMITS, PROMPT_CURATION_ROLES, PromptCurationError, type PromptCopyRole, type PromptSourceCompleteness } from "@/lib/v2/domain/prompt-curation-v1";
import { captureRecoveryInput } from "@/lib/v2/editor/editor-working-copy";

export type PromptCurationDraftBasis = Readonly<{ expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string }>;
/** Cached display context, not source/owner authority. Null is explicit absence;
 * neither a stored candidate nor an AI selection is personal memo/AI analysis. */
export type PromptCurationDraftOriginal = Readonly<{
  id: string; snapshotId: string; memberId: string | null; rawText: string; role: PromptCopyRole;
  stateVersion: number; origin: "manual" | "ai" | "stored"; isManual: boolean | null;
  completeness: PromptSourceCompleteness; sourceItemId: string | null; sourceUrl: string | null;
}>;
export type PromptCurationEditorDraft = Readonly<{
  basis: PromptCurationDraftBasis; groupKey: string; head: Readonly<{ id: string; revisionNumber: number }> | null;
  content: PromptCurationContent; originals: readonly PromptCurationDraftOriginal[]; dirty: boolean; conflict: boolean;
}>;
export type PromptCurationPending =
  | Readonly<{ kind: "create"; groupKey: string; request: CreatePromptCurationRequest; originals: readonly PromptCurationDraftOriginal[] }>
  | Readonly<{ kind: "revise"; groupKey: string; request: RevisePromptCurationRequest; originals: readonly PromptCurationDraftOriginal[] }>;
export type PromptCurationRecoveryDraft = Readonly<{
  contract: "prompt-curation-draft.v1"; draft: PromptCurationEditorDraft | null; pending: PromptCurationPending | null;
}>;

function invalid(): never { throw new PromptCurationError("prompt_curation_draft_invalid", "정리본 초안의 원래 기준·선택 원문·대기 요청을 확인하지 못했습니다. 기존 사본은 변경하지 않았습니다."); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const names = Reflect.ownKeys(value);
  check(names.every((key) => typeof key === "string" && keys.includes(key)) && keys.every((key) => names.includes(key) || optional.includes(key)));
  const result: Record<string, unknown> = Object.create(null);
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && "value" in descriptor); result[key as string] = descriptor.value;
  }
  return result;
}
function array(value: unknown, max: number): unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  check(Number.isSafeInteger(length) && length >= 0 && length <= max && Reflect.ownKeys(value).length === length + 1);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    check(descriptor && "value" in descriptor); result.push(descriptor.value);
  }
  return result;
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  check(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max); return value as number;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  check(typeof value === "string" && choices.includes(value as T)); return value as T;
}
function text(value: unknown, max: number): string {
  check(typeof value === "string" && value.length <= max);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); check(next >= 0xdc00 && next <= 0xdfff); }
    else check(!(code >= 0xdc00 && code <= 0xdfff));
  }
  return value;
}
function basis(value: unknown): PromptCurationDraftBasis {
  const input = record(value, ["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash"]);
  check(typeof input.expectedManifestHash === "string" && /^[a-f0-9]{64}$/.test(input.expectedManifestHash));
  return { expectedRevisionId: promptCurationId(input.expectedRevisionId), expectedSnapshotId: promptCurationId(input.expectedSnapshotId), expectedManifestHash: input.expectedManifestHash };
}
function contiguous(positions: readonly number[]) { check([...positions].sort((a, b) => a - b).every((position, index) => position === index)); }
function content(value: unknown): PromptCurationContent {
  const input = record(value, ["title", "relationKind", "relationshipConfirmation", "orderConfirmation", "items", "examples"]);
  const keys = new Set<string>();
  const items = array(input.items, PROMPT_CURATION_LIMITS.items).map((value) => {
    const row = record(value, ["itemKey", "fragmentId", "expectedFragmentStateVersion", "copyRole", "position"]), itemKey = promptCurationId(row.itemKey);
    check(!keys.has(itemKey)); keys.add(itemKey);
    return { itemKey, fragmentId: promptCurationId(row.fragmentId), expectedFragmentStateVersion: integer(row.expectedFragmentStateVersion, 1),
      copyRole: choice(row.copyRole, PROMPT_CURATION_ROLES), position: integer(row.position, 0, PROMPT_CURATION_LIMITS.items - 1) };
  });
  for (const role of PROMPT_CURATION_ROLES) contiguous(items.filter((item) => item.copyRole === role).map((item) => item.position));
  const exampleKeys = new Set<string>();
  const examples = array(input.examples, PROMPT_CURATION_LIMITS.examples).map((value) => {
    const row = record(value, ["exampleKey", "itemKey", "memberId", "attachmentId", "position", "evidenceMethod"]);
    const exampleKey = promptCurationId(row.exampleKey), itemKey = row.itemKey === null ? null : promptCurationId(row.itemKey);
    check(!exampleKeys.has(exampleKey) && (itemKey === null || keys.has(itemKey))); exampleKeys.add(exampleKey);
    return { exampleKey, itemKey, memberId: promptCurationId(row.memberId), attachmentId: promptCurationId(row.attachmentId),
      position: integer(row.position, 0, PROMPT_CURATION_LIMITS.examples - 1), evidenceMethod: choice(row.evidenceMethod, ["unresolved", "user_confirmed"] as const) };
  });
  contiguous(examples.map((example) => example.position));
  // Empty/whitespace titles, no items, and an existing whole-image link after
  // switching to alternatives are genuine unfinished UI states, not requests.
  return { title: text(input.title, 200), relationKind: choice(input.relationKind, ["continuation", "collection", "alternatives"] as const),
    relationshipConfirmation: choice(input.relationshipConfirmation, ["unconfirmed", "user_confirmed"] as const),
    orderConfirmation: choice(input.orderConfirmation, ["unconfirmed", "user_confirmed"] as const), items, examples };
}
function original(value: unknown, capture: boolean): PromptCurationDraftOriginal {
  const optional = ["isManual", "sourceItemId", "sourceUrl"];
  const input = record(value, ["id", "snapshotId", "memberId", "rawText", "role", "stateVersion", "origin", "completeness", ...optional], capture ? optional : []);
  const absent = (key: string) => capture && input[key] === undefined ? null : input[key];
  const origin = choice(input.origin, ["manual", "ai", "stored"] as const), isManual = absent("isManual");
  check(isManual === null || typeof isManual === "boolean");
  check(!(origin === "manual" && isManual === false) && !(origin === "ai" && isManual === true));
  const memberId = capture && origin === "stored" && input.memberId === "" ? null : input.memberId;
  check(memberId !== null || origin === "stored");
  const sourceItemId = absent("sourceItemId"), sourceUrl = absent("sourceUrl");
  if (sourceUrl !== null) {
    // The UI caches URL.href, whose percent encoding may be longer than the
    // original 2,048 UTF-16-unit input (e.g. a Korean path). Keep it unchanged.
    const exact = text(sourceUrl, MANUAL_LINK_LIMITS.urlLength * 12), url = new URL(exact);
    check(exact.trim() === exact && !/[\u0000-\u0020\u007f-\u009f]/.test(exact) && url.protocol === "https:" && !url.username && !url.password);
  }
  const rawText = text(input.rawText, 500_000);
  return { id: promptCurationId(input.id), snapshotId: promptCurationId(input.snapshotId), memberId: memberId === null ? null : promptCurationId(memberId),
    rawText, role: choice(input.role, PROMPT_CURATION_ROLES), stateVersion: integer(input.stateVersion, 1), origin, isManual,
    completeness: choice(input.completeness, ["complete", "partial", "truncated", "ocr_unverified", "selection_unverified", "unknown"] as const),
    sourceItemId: sourceItemId === null ? null : promptCurationId(sourceItemId), sourceUrl: sourceUrl as string | null };
}
function originals(value: unknown, snapshotId: string, selections: PromptCurationContent["items"] | null, capture: boolean): readonly PromptCurationDraftOriginal[] {
  // The UI retains removed candidates in memory. Only the explicit capture
  // adapter prunes that bounded working list; persisted payloads have no extras.
  let textChars = 0;
  const rows = array(value, capture ? 1024 : PROMPT_CURATION_LIMITS.items).map((row) => {
    const checked = original(row, capture); textChars += checked.rawText.length; check(textChars <= 2_000_000); return checked;
  });
  const selected = selections ? new Set(selections.map((item) => item.fragmentId)) : null;
  const kept = new Map<string, PromptCurationDraftOriginal>();
  for (const row of rows) {
    if (selected && !selected.has(row.id)) { check(capture); continue; }
    check(row.snapshotId === snapshotId);
    const previous = kept.get(row.id);
    if (previous) { check(capture && canonicalLinkJson(previous) === canonicalLinkJson(row)); continue; }
    kept.set(row.id, row);
  }
  check(kept.size <= PROMPT_CURATION_LIMITS.items);
  for (const item of selections ?? []) {
    const row = kept.get(item.fragmentId);
    check(row && row.role === item.copyRole && row.stateVersion === item.expectedFragmentStateVersion);
  }
  // Candidate cache order carries no curation order; item keys/positions do.
  return selections ? [...new Set(selections.map((item) => item.fragmentId))].map((id) => kept.get(id)!) : [...kept.values()];
}
function editor(value: unknown, capture: boolean): PromptCurationEditorDraft {
  const input = record(value, ["basis", "groupKey", "head", "content", "originals", "dirty", "conflict"]), checkedBasis = basis(input.basis), checkedContent = content(input.content);
  const head = input.head === null ? null : record(input.head, ["id", "revisionNumber"]);
  check(typeof input.dirty === "boolean" && typeof input.conflict === "boolean");
  return { basis: checkedBasis, groupKey: promptCurationId(input.groupKey), head: head ? { id: promptCurationId(head.id), revisionNumber: integer(head.revisionNumber, 1) } : null,
    content: checkedContent, originals: originals(input.originals, checkedBasis.expectedSnapshotId, checkedContent.items, capture), dirty: input.dirty, conflict: input.conflict };
}
function requestFromDraft(draft: PromptCurationEditorDraft, key: string): PromptCurationPending {
  const idempotencyKey = promptCurationId(key);
  if (draft.head) return { kind: "revise", groupKey: draft.groupKey, originals: draft.originals, request: parseRevisePromptCurationRequest({ ...draft.basis,
    expectedCurationRevisionId: draft.head.id, expectedCurationRevisionNumber: draft.head.revisionNumber, action: "edit", content: draft.content, idempotencyKey }) };
  return { kind: "create", groupKey: draft.groupKey, originals: draft.originals, request: parseCreatePromptCurationRequest({ ...draft.basis, groupKey: draft.groupKey, content: draft.content, idempotencyKey }) };
}
function parse(value: unknown, capture: boolean): PromptCurationRecoveryDraft {
  try {
    const input = record(value, ["contract", "draft", "pending"]);
    check(input.contract === "prompt-curation-draft.v1" && (input.draft !== null || input.pending !== null));
    const draft = input.draft === null ? null : editor(input.draft, capture);
    let pending: PromptCurationPending | null = null;
    if (input.pending !== null) {
      const raw = record(input.pending, ["kind", "groupKey", "request", "originals"]), groupKey = promptCurationId(raw.groupKey);
      if (raw.kind === "create") {
        const request = parseCreatePromptCurationRequest(raw.request); check(groupKey === request.groupKey);
        pending = { kind: "create", groupKey, request, originals: originals(raw.originals, request.expectedSnapshotId, request.content.items, capture) };
      } else {
        check(raw.kind === "revise"); const request = parseRevisePromptCurationRequest(raw.request);
        pending = { kind: "revise", groupKey, request, originals: originals(raw.originals, request.expectedSnapshotId, request.action === "edit" ? request.content.items : null, capture) };
        // Archive/unarchive originals belong to expectedCurationRevisionId;
        // undo originals belong to restoreRevisionId. These cached claims need
        // authenticated revision GETs; never substitute the current head.
        if (request.action !== "edit") check(draft === null && pending.originals.length > 0);
      }
      if (pending.kind === "create" || pending.request.action === "edit") {
        check(draft && canonicalLinkJson(pending) === canonicalLinkJson(requestFromDraft(draft, pending.request.idempotencyKey)));
      }
    }
    // Shared persistence budgets apply before any caller can start an await.
    return captureRecoveryInput({ contract: "prompt-curation-draft.v1", draft, pending });
  } catch { invalid(); }
}

/** Strict persisted JSON parser. Valid data is still only a cached draft, not
 * live access, receipt proof, server source identity, or permission to submit. */
export function parsePromptCurationDraft(value: unknown): PromptCurationRecoveryDraft { return parse(value, false); }

/** Synchronous UI capture: only the three documented optional candidate fields
 * may be absent/undefined; stored missing memberId becomes null. Nothing else
 * is silently stripped, and source text is never trimmed or reconstructed. */
export function capturePromptCurationDraft(value: unknown): PromptCurationRecoveryDraft { return parse(value, true); }

export function promptCurationScope(value: PromptCurationRecoveryDraft): string {
  const checked = parsePromptCurationDraft(value), draft = checked.draft, pending = checked.pending;
  if (draft) return JSON.stringify([draft.basis.expectedRevisionId, draft.basis.expectedSnapshotId, draft.basis.expectedManifestHash, draft.groupKey,
    draft.head?.id ?? null, draft.head?.revisionNumber ?? null, draft.head ? "edit" : "create"]);
  check(pending?.kind === "revise"); const request = pending.request;
  return JSON.stringify([request.expectedRevisionId, request.expectedSnapshotId, request.expectedManifestHash, pending.groupKey,
    request.expectedCurationRevisionId, request.expectedCurationRevisionNumber, request.action, request.action === "undo" ? request.restoreRevisionId : null]);
}

/** Returns a full operation (including the revise route's group key). A saved
 * pending operation is reused only with its original key and original body.
 * Clear it explicitly before forming any new/rebased operation. */
export function promptCurationDraftRequest(value: PromptCurationRecoveryDraft, idempotencyKey: string): PromptCurationPending {
  try {
    const checked = parsePromptCurationDraft(value);
    if (checked.pending) { check(checked.pending.request.idempotencyKey === promptCurationId(idempotencyKey)); return checked.pending; }
    check(checked.draft); return requestFromDraft(checked.draft, idempotencyKey);
  } catch { invalid(); }
}
