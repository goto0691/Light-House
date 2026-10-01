import { canonicalLinkJson, createLinkSourceFingerprint, hashLinkSourceManifest, LINK_SNAPSHOT_MANIFEST_VERSION,
  LINK_SNAPSHOT_MAX_SOURCES, LinkSnapshotError, normalizeLinkHash, type LinkSnapshotMemberV1 } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata, MANUAL_LINK_LIMITS, readManualLinkSource } from "@/lib/v2/domain/manual-link-source";
import { captureRecoveryInput } from "@/lib/v2/editor/editor-working-copy";
import type { SnapshotRequest } from "@/lib/v2/editor/link-snapshot-draft";

function invalid(): never {
  throw new LinkSnapshotError("link_snapshot_receipt_invalid", "저장 응답의 자료 버전·원문을 확인하지 못했습니다. 초안과 같은 요청 키를 유지했으니 저장 상태를 다시 확인해 주세요.");
}
function check(value: unknown): asserts value { if (!value) invalid(); }
function object(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  if (fields) check(Object.keys(value).length === fields.length && Object.keys(value).every((key) => fields.includes(key)));
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  check(typeof value === "string" && value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value));
  // A UTF-16 surrogate half must not turn into a replacement character in a hash/URL.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index); check(next >= 0xdc00 && next <= 0xdfff);
    } else check(code < 0xdc00 || code > 0xdfff);
  }
  return value;
}
function hash(value: unknown): string { check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value)); return value; }
function same(left: unknown, right: unknown) { check(canonicalLinkJson(left) === canonicalLinkJson(right)); }

/** Validate the complete POST response before a caller retires its pending draft.
 * This is not a server authorization/idempotency proof: the API still owns the
 * request-key -> snapshot binding, capture ownership, and existing source-ID
 * contents. The request has no prior source hashes/capture ID to compare here.
 * getSnapshot returns the CURRENT documentRevisionId, including on old receipt
 * replay; it is deliberately not equated with request.expectedRevisionId.
 */
export async function assertSnapshotReceipt(value: unknown, context: { ownerId: string; recordId: string; request: SnapshotRequest }): Promise<void> {
  try {
    // Snapshot every nested input before the first crypto await. No getters or
    // toJSON hooks are executed, and caller mutation cannot retarget validation.
    const captured = captureRecoveryInput({ value, context });
    await validate(captured.value, captured.context);
  } catch { invalid(); }
}

async function validate(value: unknown, { ownerId, recordId, request }: { ownerId: string; recordId: string; request: SnapshotRequest }) {
  id(ownerId); id(recordId);
  const input = object(request, ["expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "sourceItemIds", "newManualSources", "idempotencyKey"]);
  id(input.expectedRevisionId); id(input.idempotencyKey);
  check(Number.isSafeInteger(input.expectedSnapshotVersion) && request.expectedSnapshotVersion >= 0 && request.expectedSnapshotVersion < Number.MAX_SAFE_INTEGER);
  check((request.expectedSnapshotVersion === 0) === (input.expectedSnapshotId === null));
  if (input.expectedSnapshotId !== null) id(input.expectedSnapshotId);
  check(Array.isArray(input.sourceItemIds) && Array.isArray(input.newManualSources));
  const selected = input.sourceItemIds.map(id);
  check(new Set(selected).size === selected.length && input.newManualSources.length <= MANUAL_LINK_LIMITS.sources);
  const additions = input.newManualSources.map((entry) => {
    const added = object(entry, ["rawText", "link"]); check(typeof added.rawText === "string");
    const metadata = makeManualLinkMetadata(object(added.link) as SnapshotRequest["newManualSources"][number]["link"]);
    check(added.rawText.trim() || metadata.manualLinkV1.completeness !== "complete");
    return { rawText: added.rawText, metadata };
  });
  const total = selected.length + additions.length;
  check(total >= 1 && total <= LINK_SNAPSHOT_MAX_SOURCES);
  const envelope = object(value, ["snapshot"]);
  const receipt = object(envelope.snapshot, ["documentRevisionId", "snapshot", "members", "replayed"]);
  id(receipt.documentRevisionId); check(typeof receipt.replayed === "boolean");
  const snapshot = object(receipt.snapshot, ["id", "userId", "documentId", "captureId", "parentSnapshotId", "snapshotVersion", "manifestVersion", "manifestHash",
    "acquisitionMethod", "adapterVersion", "captureState", "coverage", "createdAt"]);
  const snapshotId = id(snapshot.id); id(snapshot.captureId);
  check(snapshot.userId === ownerId && snapshot.documentId === recordId && snapshot.parentSnapshotId === request.expectedSnapshotId
    && snapshotId !== request.expectedSnapshotId && snapshot.snapshotVersion === request.expectedSnapshotVersion + 1);
  check(snapshot.manifestVersion === LINK_SNAPSHOT_MANIFEST_VERSION && snapshot.acquisitionMethod === "user_paste" && snapshot.adapterVersion === "manual-link-snapshot.v1");
  hash(snapshot.manifestHash);
  check(typeof snapshot.createdAt === "string" && Number.isFinite(Date.parse(snapshot.createdAt)));
  check(Array.isArray(receipt.members) && receipt.members.length === total);

  const memberIds = new Set<string>(), sourceIds = new Set<string>(), keys = new Set<string>();
  const members: LinkSnapshotMemberV1[] = [];
  for (const [index, entry] of receipt.members.entries()) {
    const member = object(entry, ["id", "snapshotId", "sourceItemId", "memberKey", "sourceOrder", "sourceFingerprint", "kind", "rawText", "contentHash", "metadata", "manualLink", "attachments"]);
    const memberId = id(member.id), sourceId = id(member.sourceItemId), key = id(member.memberKey);
    check(!memberIds.has(memberId) && !sourceIds.has(sourceId) && !keys.has(key));
    memberIds.add(memberId); sourceIds.add(sourceId); keys.add(key);
    check(member.snapshotId === snapshotId && member.sourceOrder === index);
    check(member.rawText === null || typeof member.rawText === "string");
    check(typeof member.contentHash === "string");
    const contentHash = normalizeLinkHash(member.contentHash); hash(member.sourceFingerprint);
    if (member.metadata !== null) object(member.metadata);
    const manualLink = readManualLinkSource(member.metadata); same(member.manualLink, manualLink);
    check(Array.isArray(member.attachments));
    const attachmentIds = new Set<string>();
    for (const raw of member.attachments) {
      const attachment = object(raw, ["id", "sha256", "mimeType", "sizeBytes", "filename"]), attachmentId = id(attachment.id);
      check(!attachmentIds.has(attachmentId)); attachmentIds.add(attachmentId);
      check(typeof attachment.sha256 === "string" && normalizeLinkHash(attachment.sha256) === contentHash);
      check(typeof attachment.mimeType === "string" && attachment.mimeType.length > 0 && typeof attachment.filename === "string"
        && Number.isSafeInteger(attachment.sizeBytes) && Number(attachment.sizeBytes) >= 0);
    }
    check(member.kind === "url" && manualLink || ["image", "audio", "video", "document"].includes(String(member.kind)) && member.attachments.length > 0);
    if (index < selected.length) check(sourceId === selected[index]);
    else {
      const added = additions[index - selected.length];
      check(!selected.includes(sourceId) && member.kind === "url" && member.rawText === added.rawText && member.attachments.length === 0);
      same(member.metadata, added.metadata); same(member.manualLink, added.metadata.manualLinkV1);
    }
    const checked = member as unknown as LinkSnapshotMemberV1;
    check(await createLinkSourceFingerprint(checked) === member.sourceFingerprint);
    members.push(checked);
  }
  const manual = members.filter((member) => member.manualLink);
  check(manual.length >= 1 && manual.length <= MANUAL_LINK_LIMITS.sources
    && manual.reduce((bytes, member) => bytes + new TextEncoder().encode(member.rawText ?? "").byteLength, 0) <= MANUAL_LINK_LIMITS.textBytes);
  check(await hashLinkSourceManifest({ members }) === snapshot.manifestHash);
  const pastedTexts = members.filter((member) => member.rawText?.trim()).length, attachmentSources = members.filter((member) => member.attachments.length).length;
  check(snapshot.captureState === (pastedTexts || attachmentSources ? "partial" : "link_only"));
  same(snapshot.coverage, { scope: "user_selected", selectedSources: total, pastedTexts, attachmentSources, fullExternalScope: "unverified", analysis: "not_started" });
}
