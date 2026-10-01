import { canonicalLinkJson, LinkSnapshotError, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import { parseManualLinkFragmentRequest, type CreateManualLinkFragmentRequest } from "@/lib/v2/domain/manual-link-fragment-v1";
import { MANUAL_LINK_LIMITS, normalizeManualLinkSource, type ManualLinkSourceV1 } from "@/lib/v2/domain/manual-link-source";
import { PROMPT_CURATION_ROLES, type PromptCopyRole } from "@/lib/v2/domain/prompt-curation-v1";
import { captureRecoveryInput } from "@/lib/v2/editor/editor-working-copy";

export type ManualFragmentBasis = Readonly<{ expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string }>;
export type ManualFragmentDraftSource = Readonly<{
  sourceItemId: string; memberId: string; memberKey: string; contentHash: string; rawText: string; manualLink: ManualLinkSourceV1; sourceOrder: number;
}>;
export type ManualFragmentDraft = Readonly<{
  contract: "manual-fragment-draft.v1";
  basis: ManualFragmentBasis;
  source: ManualFragmentDraftSource;
  role: PromptCopyRole;
  range: Readonly<{ textStart: number; textEnd: number }> | null;
  pending: CreateManualLinkFragmentRequest | null;
}>;

function invalid(): never { throw new LinkSnapshotError("manual_fragment_draft_invalid", "발췌 초안의 원문·범위·대기 요청을 확인하지 못했습니다. 원래 사본은 변경하지 않았습니다."); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).length === fields.length && Object.keys(value).every((key) => fields.includes(key)));
  return value as Record<string, unknown>;
}
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function id(value: unknown): string {
  check(typeof value === "string" && value.trim() && value.length <= 200 && wellFormed(value) && !/[\u0000-\u001f\u007f]/.test(value)); return value;
}
function basis(value: unknown): ManualFragmentBasis {
  const input = object(value, ["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash"]);
  check(typeof input.expectedManifestHash === "string" && /^[a-f0-9]{64}$/.test(input.expectedManifestHash));
  return { expectedRevisionId: id(input.expectedRevisionId), expectedSnapshotId: id(input.expectedSnapshotId), expectedManifestHash: input.expectedManifestHash };
}
function range(value: unknown, rawText: string): ManualFragmentDraft["range"] {
  if (value === null) return null;
  const input = object(value, ["textStart", "textEnd"]);
  check(Number.isSafeInteger(input.textStart) && Number.isSafeInteger(input.textEnd));
  const textStart = input.textStart as number, textEnd = input.textEnd as number;
  // A collapsed, unfinished selection may be restored, but cannot be submitted.
  check(textStart >= 0 && textEnd >= textStart && textEnd <= rawText.length);
  for (const offset of [textStart, textEnd]) {
    const before = rawText.charCodeAt(offset - 1), after = rawText.charCodeAt(offset);
    check(!(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff));
  }
  return { textStart, textEnd };
}
function source(value: unknown): ManualFragmentDraftSource {
  const input = object(value, ["sourceItemId", "memberId", "memberKey", "contentHash", "rawText", "manualLink", "sourceOrder"]);
  check(typeof input.rawText === "string" && input.rawText.length <= 500_000 && wellFormed(input.rawText));
  check(typeof input.contentHash === "string"); normalizeLinkHash(input.contentHash);
  check(Number.isSafeInteger(input.sourceOrder) && Number(input.sourceOrder) >= 0 && Number(input.sourceOrder) < 40);
  const manualLink = normalizeManualLinkSource(input.manualLink);
  // This is a captured server source, not the editable link-entry form. Reject
  // unnormalised/corrupt metadata instead of silently rewriting its provenance.
  check(canonicalLinkJson(input.manualLink) === canonicalLinkJson(manualLink));
  return { sourceItemId: id(input.sourceItemId), memberId: id(input.memberId), memberKey: id(input.memberKey), contentHash: input.contentHash,
    rawText: input.rawText, manualLink, sourceOrder: input.sourceOrder as number };
}
function requestFor(draft: ManualFragmentDraft, key: string): CreateManualLinkFragmentRequest {
  check(draft.range && draft.range.textEnd > draft.range.textStart);
  check(new TextEncoder().encode(draft.source.rawText).byteLength <= MANUAL_LINK_LIMITS.textBytes);
  return parseManualLinkFragmentRequest({ ...draft.basis, memberId: draft.source.memberId, ...draft.range, role: draft.role, idempotencyKey: id(key) });
}

/** Pure syntax/captured-input validation, never current owner/source authority.
 * The caller must reauthenticate/reload the source before a new submission.
 * Hash equality is checked asynchronously by the receipt assertion and server.
 */
export function parseManualFragmentDraft(value: unknown): ManualFragmentDraft {
  try {
    const input = object(captureRecoveryInput(value), ["contract", "basis", "source", "role", "range", "pending"]);
    check(input.contract === "manual-fragment-draft.v1" && PROMPT_CURATION_ROLES.includes(input.role as PromptCopyRole));
    const capturedSource = source(input.source);
    const draft: ManualFragmentDraft = { contract: "manual-fragment-draft.v1", basis: basis(input.basis), source: capturedSource,
      role: input.role as PromptCopyRole, range: range(input.range, capturedSource.rawText), pending: null };
    if (input.pending === null) return draft;
    const submitted = parseManualLinkFragmentRequest(input.pending), expected = requestFor(draft, submitted.idempotencyKey);
    check(canonicalLinkJson(submitted) === canonicalLinkJson(expected));
    return { ...draft, pending: expected };
  } catch { invalid(); }
}

export function manualFragmentScope(value: ManualFragmentBasis): string {
  const checked = basis(captureRecoveryInput(value));
  return JSON.stringify([checked.expectedRevisionId, checked.expectedSnapshotId, checked.expectedManifestHash]);
}

/** Existing pending requests retain their key; a caller must explicitly clear
 * pending before asking for a new operation. Never retarget it to current props. */
export function manualFragmentRequest(value: ManualFragmentDraft, idempotencyKey: string): CreateManualLinkFragmentRequest {
  try {
    const draft = parseManualFragmentDraft(value);
    if (draft.pending) { check(draft.pending.idempotencyKey === id(idempotencyKey)); return draft.pending; }
    return requestFor(draft, idempotencyKey);
  } catch { invalid(); }
}
