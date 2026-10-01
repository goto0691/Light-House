import { canonicalLinkJson, linkSha256Hex, LinkSnapshotError, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import { MANUAL_LINK_FRAGMENT_CONTRACT, parseManualLinkFragmentRequest, type CreateManualLinkFragmentRequest, type ManualLinkFragmentReceipt } from "@/lib/v2/domain/manual-link-fragment-v1";
import { captureRecoveryInput } from "@/lib/v2/editor/editor-working-copy";
import { parseManualFragmentDraft, type ManualFragmentDraftSource } from "@/lib/v2/editor/manual-fragment-draft";

function invalid(): never { throw new LinkSnapshotError("manual_fragment_receipt_invalid", "발췌 저장 응답이 선택한 원문·범위와 일치하지 않습니다. 초안과 같은 요청 키를 유지했습니다."); }
function check(value: unknown): asserts value { if (!value) invalid(); }
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).length === fields.length && Object.keys(value).every((key) => fields.includes(key)));
  return value as Record<string, unknown>;
}
function id(value: unknown) {
  check(typeof value === "string" && value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)); return value;
}

/** Validate the direct POST /links/fragments response before durable cleanup.
 * The receipt does not expose ownerId, recordId, sourceItemId, manifest proof or
 * request-key binding. Authenticated server SQL remains responsible for these;
 * cached source metadata is never promoted to authorization or DB evidence.
 */
export async function assertManualFragmentReceipt(value: unknown, context: {
  request: CreateManualLinkFragmentRequest; source: ManualFragmentDraftSource;
}): Promise<ManualLinkFragmentReceipt> {
  try {
    const captured = captureRecoveryInput({ value, context });
    const request = parseManualLinkFragmentRequest(captured.context.request);
    const draft = parseManualFragmentDraft({ contract: "manual-fragment-draft.v1", basis: {
      expectedRevisionId: request.expectedRevisionId, expectedSnapshotId: request.expectedSnapshotId, expectedManifestHash: request.expectedManifestHash,
    }, source: captured.context.source, role: request.role, range: { textStart: request.textStart, textEnd: request.textEnd }, pending: request });
    const receipt = object(captured.value, ["contract", "item", "replayed"]);
    check(receipt.contract === MANUAL_LINK_FRAGMENT_CONTRACT && typeof receipt.replayed === "boolean");
    const item = object(receipt.item, ["id", "fragmentKey", "snapshotId", "primaryMemberId", "createdAt", "stateVersion", "reviewStatus", "fragment"]);
    const fragmentId = id(item.id);
    check(item.fragmentKey === `manual-${fragmentId}` && item.snapshotId === request.expectedSnapshotId && item.primaryMemberId === request.memberId);
    check(typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) && Number.isSafeInteger(item.stateVersion) && Number(item.stateVersion) >= 1
      && ["confirmed", "rejected", "superseded"].includes(String(item.reviewStatus)));
    // A replay can return a later review state; it must still be the exact
    // preserved user-selected fragment, not a newly confirmed AI interpretation.
    const source = draft.source, rawText = source.rawText.slice(request.textStart, request.textEnd);
    check(await linkSha256Hex(source.rawText) === normalizeLinkHash(source.contentHash));
    const expected = { memberKey: source.memberKey, sourceClass: "source_extract", role: request.role, selectionOrigin: "user_selected",
      textStart: request.textStart, textEnd: request.textEnd, rawText, rawTextHash: await linkSha256Hex(rawText), completeness: source.manualLink.completeness };
    check(canonicalLinkJson(item.fragment) === canonicalLinkJson(expected));
    return captured.value as ManualLinkFragmentReceipt;
  } catch { invalid(); }
}
