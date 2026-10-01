import { LinkAnalysisValidationError } from "@/lib/v2/ai/link-analysis-v1";
import { LINK_SNAPSHOT_MAX_SOURCES } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata, ManualLinkValidationError, type ManualLinkInput } from "@/lib/v2/domain/manual-link-source";
import { v2ErrorResponse, V2HttpError, type V2RequestContext } from "@/lib/v2/http/request-context";
import type { LinkAnalysisJobRequest } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import type { CreateLinkSnapshotInput, PublicFetchSnapshotRequest, VideoAnalysisSnapshotRequest } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";

export const LINK_PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function linkErrorResponse(error: unknown) {
  const code = (error as { code?: string })?.code;
  const response = code?.endsWith("_schema_unavailable")
    ? Response.json({ error: { code, message: "링크 정리 저장소가 아직 준비되지 않았습니다. 기존 원문은 보존됩니다." } }, { status: 503 })
    : error instanceof LinkAnalysisValidationError && error.code === "link_analysis_needs_input"
      ? Response.json({ error: { code, message: "분석할 외부 원문을 먼저 추가해 주세요. URL만으로는 내용을 읽지 않습니다." } }, { status: 422 })
      : error instanceof ManualLinkValidationError
        ? Response.json({ error: { code: "manual_link_invalid", message: error.message } }, { status: 400 })
        : v2ErrorResponse(error);
  response.headers.set("Cache-Control", LINK_PRIVATE_HEADERS["Cache-Control"]);
  return response;
}

export function linkGrantUnlocked(context: V2RequestContext) {
  return Boolean(context.restrictedGrant && Date.parse(context.restrictedGrant.expiresAt) > Date.now());
}

function string(value: unknown, name: string, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new V2HttpError(400, "link_request_invalid", `${name} 형식을 확인해 주세요.`);
  return value;
}
function knownFields(input: Record<string, unknown>, names: readonly string[]) {
  if (Object.keys(input).some((key) => !names.includes(key))) throw new V2HttpError(400, "link_request_invalid", "지원하지 않는 요청 필드가 있습니다.");
}

export function parseLinkSnapshotRequest(recordId: string, value: Record<string, unknown>): Omit<CreateLinkSnapshotInput, "restrictedUnlocked" | "now"> {
  knownFields(value, ["expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "sourceItemIds", "newManualSources", "idempotencyKey"]);
  if (!Number.isSafeInteger(value.expectedSnapshotVersion) || (value.expectedSnapshotVersion as number) < 0) throw new V2HttpError(400, "link_request_invalid", "자료 버전이 올바르지 않습니다.");
  if (!Array.isArray(value.sourceItemIds) || value.sourceItemIds.length > LINK_SNAPSHOT_MAX_SOURCES) throw new V2HttpError(400, "link_request_invalid", "선택할 원문 목록을 확인해 주세요.");
  if (value.newManualSources !== undefined && (!Array.isArray(value.newManualSources) || value.newManualSources.length > 20)) throw new V2HttpError(400, "link_request_invalid", "새 원문은 최대 20개까지 추가할 수 있습니다.");
  const additions = (value.newManualSources as unknown[] | undefined ?? []).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new V2HttpError(400, "link_request_invalid", "새 원문의 형식이 올바르지 않습니다.");
    const source = entry as Record<string, unknown>;
    knownFields(source, ["rawText", "link"]);
    if (typeof source.rawText !== "string") throw new V2HttpError(400, "link_request_invalid", "붙여넣은 원문은 텍스트여야 합니다.");
    return { rawText: source.rawText, metadata: makeManualLinkMetadata(source.link as ManualLinkInput) };
  });
  return {
    documentId: recordId, expectedRevisionId: string(value.expectedRevisionId, "본문 버전"),
    expectedSnapshotId: value.expectedSnapshotId === null ? null : string(value.expectedSnapshotId, "자료 ID"),
    expectedSnapshotVersion: value.expectedSnapshotVersion as number,
    sourceItemIds: value.sourceItemIds.map((id) => string(id, "원문 ID")), newManualSources: additions,
    idempotencyKey: string(value.idempotencyKey, "요청 키"),
  };
}

export function parsePublicFetchRequest(recordId: string, value: Record<string, unknown>): PublicFetchSnapshotRequest {
  knownFields(value, ["sourceItemId", "expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "idempotencyKey"]);
  if (!Number.isSafeInteger(value.expectedSnapshotVersion) || (value.expectedSnapshotVersion as number) < 0
    || ((value.expectedSnapshotVersion as number) === 0) !== (value.expectedSnapshotId === null)) {
    throw new V2HttpError(400, "link_request_invalid", "자료 버전과 이전 자료 ID를 확인해 주세요.");
  }
  return {
    documentId: recordId, sourceItemId: string(value.sourceItemId, "URL 자료 ID"),
    expectedRevisionId: string(value.expectedRevisionId, "본문 버전"),
    expectedSnapshotId: value.expectedSnapshotId === null ? null : string(value.expectedSnapshotId, "자료 ID"),
    expectedSnapshotVersion: value.expectedSnapshotVersion as number,
    idempotencyKey: string(value.idempotencyKey, "요청 키"),
  };
}

function optionalSeconds(value: unknown, name: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 606_000) throw new V2HttpError(400, "link_request_invalid", `${name}을 초 단위 정수로 입력해 주세요.`);
  return value;
}

export function parseVideoAnalysisRequest(recordId: string, value: Record<string, unknown>): VideoAnalysisSnapshotRequest {
  knownFields(value, ["sourceItemId", "expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "startSeconds", "endSeconds", "idempotencyKey"]);
  if (!Number.isSafeInteger(value.expectedSnapshotVersion) || (value.expectedSnapshotVersion as number) < 0
    || ((value.expectedSnapshotVersion as number) === 0) !== (value.expectedSnapshotId === null)) {
    throw new V2HttpError(400, "link_request_invalid", "자료 버전과 이전 자료 ID를 확인해 주세요.");
  }
  const startSeconds = optionalSeconds(value.startSeconds, "시작 시각");
  const endSeconds = optionalSeconds(value.endSeconds, "끝 시각");
  if (endSeconds !== null && startSeconds === null) throw new V2HttpError(400, "link_request_invalid", "끝 시각을 정하려면 시작 시각도 입력해 주세요.");
  return {
    documentId: recordId, sourceItemId: string(value.sourceItemId, "영상 링크 ID"),
    expectedRevisionId: string(value.expectedRevisionId, "본문 버전"),
    expectedSnapshotId: value.expectedSnapshotId === null ? null : string(value.expectedSnapshotId, "자료 ID"),
    expectedSnapshotVersion: value.expectedSnapshotVersion as number,
    startSeconds, endSeconds, idempotencyKey: string(value.idempotencyKey, "요청 키"),
  };
}

export function parseLinkAnalysisRequest(recordId: string, value: Record<string, unknown>): LinkAnalysisJobRequest {
  knownFields(value, ["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "idempotencyKey"]);
  const hash = string(value.expectedManifestHash, "자료 해시", 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new V2HttpError(400, "link_request_invalid", "자료 해시가 올바르지 않습니다.");
  return {
    documentId: recordId, expectedRevisionId: string(value.expectedRevisionId, "본문 버전"),
    expectedSnapshotId: string(value.expectedSnapshotId, "자료 ID"), expectedManifestHash: hash,
    idempotencyKey: string(value.idempotencyKey, "요청 키"),
  };
}
