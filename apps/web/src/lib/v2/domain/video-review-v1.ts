import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import type { VideoAnalysisSourceV1 } from "@/lib/v2/domain/video-analysis-source";

export const VIDEO_REVIEW_CONTRACT = "video-item-review.v1" as const;
export type VideoReviewKind = "summary" | "segment" | "speech" | "screen_text" | "limitation";
export type VideoReviewStatus = "unreviewed" | "confirmed" | "rejected";
export type VideoReviewItem = Readonly<{ kind: VideoReviewKind; index: number; itemKey: string; status: VideoReviewStatus; stateVersion: number; reviewedAt: string | null }>;
export type VideoReviewProjection = Readonly<{
  contract: typeof VIDEO_REVIEW_CONTRACT; recordId: string; sourceItemId: string; contentHash: string;
  currentRevisionId: string; currentSnapshotId: string | null; currentSnapshotVersion: number;
  canReview: boolean; items: readonly VideoReviewItem[];
}>;
export type VideoReviewRequest = Readonly<{
  kind: VideoReviewKind; index: number; action: "confirm" | "reject"; expectedStateVersion: number;
  expectedRevisionId: string; expectedSnapshotId: string; expectedSnapshotVersion: number;
  contentHash: string; idempotencyKey: string;
}>;
export type VideoReviewReceipt = Readonly<{ itemKey: string; status: "confirmed" | "rejected"; stateVersion: number; reviewedAt: string; replayed: boolean }>;

export class VideoReviewError extends Error {
  constructor(readonly code: "video_review_invalid" | "video_review_not_found" | "video_review_conflict" | "video_review_history_invalid" | "restricted_record_locked", message: string) {
    super(message); this.name = "VideoReviewError";
  }
}

export function videoReviewItemKey(kind: VideoReviewKind, index: number) { return `${kind}:${index}`; }

export function videoReviewItems(note: VideoAnalysisSourceV1): VideoReviewItem[] {
  const refs: { kind: VideoReviewKind; count: number }[] = [
    { kind: "summary", count: 1 }, { kind: "segment", count: note.segments.length }, { kind: "speech", count: note.speech.length },
    { kind: "screen_text", count: note.screenText.length }, { kind: "limitation", count: note.limitations.length },
  ];
  return refs.flatMap(({ kind, count }) => Array.from({ length: count }, (_, index) => ({ kind, index, itemKey: videoReviewItemKey(kind, index), status: "unreviewed" as const, stateVersion: 0, reviewedAt: null })));
}

/** Restore remaps source IDs. All note text, timecodes and analysis identity are
 * hashed instead; a new analysis never inherits a user's earlier judgement. */
export function videoReviewStableJson(input: unknown) {
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sorted(child)]));
    return value;
  }
  return JSON.stringify(sorted(input));
}

export async function videoReviewNoteFingerprint(note: VideoAnalysisSourceV1, contentHash: string) {
  const stableNote = Object.fromEntries(Object.entries(note).filter(([key]) => key !== "requestedSourceItemId"));
  return linkSha256Hex(videoReviewStableJson({ contentHash, note: stableNote }));
}

export function parseVideoReviewRequest(value: Record<string, unknown>): VideoReviewRequest {
  const keys = ["kind", "index", "action", "expectedStateVersion", "expectedRevisionId", "expectedSnapshotId", "expectedSnapshotVersion", "contentHash", "idempotencyKey"];
  const invalid = () => { throw new VideoReviewError("video_review_invalid", "영상 노트 확인 요청 형식을 확인해 주세요."); };
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) return invalid();
  if (!["summary", "segment", "speech", "screen_text", "limitation"].includes(String(value.kind)) || !["confirm", "reject"].includes(String(value.action))) return invalid();
  for (const key of ["index", "expectedStateVersion", "expectedSnapshotVersion"]) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) return invalid();
  for (const key of ["expectedRevisionId", "expectedSnapshotId", "idempotencyKey"]) {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 200 || /[\u0000-\u001f]/u.test(value[key])) return invalid();
  }
  if (typeof value.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.contentHash)) return invalid();
  return value as unknown as VideoReviewRequest;
}

export function videoReviewStatusLabel(status: VideoReviewStatus) {
  return status === "confirmed" ? "사용자 확인" : status === "rejected" ? "사용자 거절" : "사용자 미확인";
}

/** A copy with decisions is a separate rendition, never the immutable AI note. */
export function renderReviewedVideoNote(rawText: string, items: readonly VideoReviewItem[]) {
  const kindLabels: Record<VideoReviewKind, string> = { summary: "요약", segment: "구간", speech: "발화", screen_text: "화면 글", limitation: "분석 한계" };
  return `[사용자 판단을 덧붙인 AI 영상 노트 · 원본 영상·공식 자막 아님]\n사용자 확인은 AI 정확성이나 외부 사실의 확정이 아닙니다.\n${items.map((item) => `${kindLabels[item.kind]} ${item.index + 1}: ${videoReviewStatusLabel(item.status)}`).join("\n")}\n\n[원 AI 노트 · 사용자 판단 반영 전]\n${rawText}`;
}
