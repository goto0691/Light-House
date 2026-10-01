import { normalizeManualLinkSource, type ManualLinkInput } from "@/lib/v2/domain/manual-link-source";
import type { LocalSourceItem } from "@/lib/v2/offline/local-capture";

export type SnapshotBasis = Readonly<{ expectedRevisionId: string; expectedSnapshotId: string | null; expectedSnapshotVersion: number }>;
export type SnapshotRequest = SnapshotBasis & Readonly<{
  sourceItemIds: readonly string[];
  newManualSources: readonly Readonly<{ rawText: string; link: ManualLinkInput }>[];
  idempotencyKey: string;
}>;
export type SnapshotDraft = Readonly<{
  contract: "link-snapshot-draft.v1";
  basis: SnapshotBasis;
  selected: readonly string[];
  additions: readonly LocalSourceItem[];
  pending: SnapshotRequest | null;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("초안 형식을 확인하지 못했습니다.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("지원하지 않는 초안 필드입니다.");
}
function string(value: unknown, max = 2048): string {
  if (typeof value !== "string" || value.length > max) throw new Error("초안의 텍스트 범위를 확인해 주세요.");
  return value;
}
function id(value: unknown): string { const result = string(value, 200); if (!result) throw new Error("초안 식별자가 없습니다."); return result; }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("초안 버전이 올바르지 않습니다."); return value as number; }
function ids(value: unknown) {
  if (!Array.isArray(value) || value.length > 40) throw new Error("초안 자료 개수가 올바르지 않습니다.");
  const result = value.map(id);
  if (new Set(result).size !== result.length) throw new Error("초안 자료가 중복되었습니다.");
  return result;
}
export function snapshotBasis(value: unknown): SnapshotBasis {
  const source = record(value);
  keys(source, ["expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion"]);
  return { expectedRevisionId: id(source.expectedRevisionId), expectedSnapshotId: source.expectedSnapshotId === null ? null : id(source.expectedSnapshotId), expectedSnapshotVersion: integer(source.expectedSnapshotVersion) };
}
export function snapshotScope(basis: SnapshotBasis): string { return JSON.stringify([basis.expectedRevisionId, basis.expectedSnapshotId, basis.expectedSnapshotVersion]); }

/** Draft fields intentionally do not use the submission normalizer: unfinished URL/numbers survive. */
export function parseSnapshotDraft(value: unknown): SnapshotDraft {
  const source = record(value);
  keys(source, ["contract", "basis", "selected", "additions", "pending"]);
  if (source.contract !== "link-snapshot-draft.v1" || !Array.isArray(source.additions) || source.additions.length > 20) throw new Error("지원하지 않는 자료 초안입니다.");
  const basis = snapshotBasis(source.basis), selected = ids(source.selected);
  const additions = source.additions.map((item): LocalSourceItem => {
    const entry = record(item); keys(entry, ["sourceId", "order", "kind", "value", "metadata"]);
    if (entry.kind !== "url") throw new Error("자료 초안에는 수동 원문만 추가할 수 있습니다.");
    const metadata = record(entry.metadata); keys(metadata, ["manualLinkV1"]);
    const link = record(metadata.manualLinkV1);
    keys(link, ["contract", "url", "canonicalUrl", "provider", "purpose", "role", "completeness", "publisher", "partNumber", "totalParts", "startSeconds", "endSeconds"]);
    if (link.contract !== "manual-link-source.v1") throw new Error("지원하지 않는 링크 초안입니다.");
    for (const key of ["url", "canonicalUrl", "provider", "purpose", "role", "completeness"]) string(link[key], 8192);
    if (link.publisher !== null) string(link.publisher, 2000);
    for (const key of ["partNumber", "totalParts", "startSeconds", "endSeconds"]) {
      if (link[key] !== null && typeof link[key] !== "string" && !(typeof link[key] === "number" && Number.isFinite(link[key]))) throw new Error("초안 숫자 입력이 올바르지 않습니다.");
      if (typeof link[key] === "string") string(link[key], 8192);
    }
    return { sourceId: id(entry.sourceId), order: integer(entry.order), kind: "url", value: string(entry.value, 500_000), metadata: { manualLinkV1: { ...link } } };
  });
  if (new Set(additions.map((item) => item.sourceId)).size !== additions.length || additions.reduce((size, item) => size + item.value.length, 0) > 1_000_000) throw new Error("자료 초안의 크기 또는 식별자를 확인해 주세요.");
  let pending: SnapshotRequest | null = null;
  if (source.pending !== null) {
    const request = record(source.pending);
    keys(request, ["expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "sourceItemIds", "newManualSources", "idempotencyKey"]);
    const expected = snapshotRequest({ contract: "link-snapshot-draft.v1", basis, selected, additions, pending: null }, id(request.idempotencyKey));
    // Preserve the exact request only if it is derived from these exact inputs and frozen basis.
    if (JSON.stringify(request) !== JSON.stringify(expected)) throw new Error("대기 중인 저장 요청과 초안이 일치하지 않습니다.");
    pending = expected;
  }
  return { contract: "link-snapshot-draft.v1", basis, selected, additions, pending };
}

export function snapshotRequest(draft: SnapshotDraft, idempotencyKey: string): SnapshotRequest {
  const newManualSources = draft.additions.map((source) => {
    const { url, purpose, role, completeness, publisher, partNumber, totalParts, startSeconds, endSeconds } = normalizeManualLinkSource(source.metadata?.manualLinkV1);
    return { rawText: source.value, link: { url, purpose, role, completeness, publisher, partNumber, totalParts, startSeconds, endSeconds } };
  });
  return { ...draft.basis, sourceItemIds: draft.selected, newManualSources, idempotencyKey };
}
