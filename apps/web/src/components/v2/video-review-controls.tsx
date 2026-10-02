"use client";

import { useEffect, useRef, useState } from "react";

import { VIDEO_REVIEW_CONTRACT, videoReviewItemKey, videoReviewStatusLabel, type VideoReviewKind, type VideoReviewProjection, type VideoReviewRequest } from "@/lib/v2/domain/video-review-v1";
import "@/components/v2/video-review.css";

export type VideoReviewContext = Readonly<{ recordId: string; sourceItemId: string; contentHash: string; currentRevisionId: string; writeEnabled: boolean }>;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** No note or decision is put in local storage. Failed writes keep the exact
 * in-memory request until a retry or a fresh server read settles the decision. */
export function useVideoReviews(context?: VideoReviewContext) {
  const [reviews, setReviews] = useState<VideoReviewProjection | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(context));
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const pending = useRef<VideoReviewRequest | null>(null);
  const lifetime = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const recordId = context?.recordId, sourceItemId = context?.sourceItemId;
  const contentHash = context?.contentHash, revisionId = context?.currentRevisionId, writeEnabled = context?.writeEnabled;
  const endpoint = recordId && sourceItemId ? `/api/v2/records/${encodeURIComponent(recordId)}/video-reviews/${encodeURIComponent(sourceItemId)}` : null;

  function rememberPending(value: VideoReviewRequest | null) { pending.current = value; setHasPending(Boolean(value)); }

  function valid(value: unknown): value is VideoReviewProjection {
    const candidate = value as VideoReviewProjection | null;
    return Boolean(candidate && candidate.contract === VIDEO_REVIEW_CONTRACT && candidate.recordId === recordId
      && candidate.sourceItemId === sourceItemId && candidate.contentHash === contentHash && typeof candidate.currentRevisionId === "string"
      && (candidate.currentSnapshotId === null || typeof candidate.currentSnapshotId === "string") && Number.isSafeInteger(candidate.currentSnapshotVersion)
      && candidate.currentSnapshotVersion >= 0 && typeof candidate.canReview === "boolean" && Array.isArray(candidate.items)
      && candidate.items.every((item) => item && ["unreviewed", "confirmed", "rejected"].includes(item.status)
        && ["summary", "segment", "speech", "screen_text", "limitation"].includes(item.kind) && Number.isSafeInteger(item.index) && item.index >= 0
        && item.itemKey === videoReviewItemKey(item.kind, item.index) && Number.isSafeInteger(item.stateVersion) && item.stateVersion >= 0
        && (item.status === "unreviewed" ? item.stateVersion === 0 && item.reviewedAt === null : item.stateVersion > 0 && Number.isFinite(Date.parse(item.reviewedAt ?? ""))))
      && new Set(candidate.items.map((item) => item.itemKey)).size === candidate.items.length);
  }

  useEffect(() => {
    const generation = ++lifetime.current;
    const abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    pending.current = null;
    if (!endpoint) return () => { lifetime.current = generation + 1; abort.abort(); };
    async function load() {
      try {
        const response = await fetch(endpoint!, { cache: "no-store", signal: abort.signal });
        if (generation !== lifetime.current) return;
        if ([401, 403, 404, 423].includes(response.status)) { setBlocked(true); setReviews(null); setMessage("영상 노트에 다시 접근하려면 기록을 새로 열어 주세요."); return; }
        const body = await response.json();
        if (generation !== lifetime.current) return;
        if (!response.ok || !object(body) || !valid(body.reviews)) throw new Error("load failed");
        setReviews(body.reviews); setHasPending(false); setMessage("");
      } catch {
        if (generation === lifetime.current && !abort.signal.aborted) setMessage("사용자 판단을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.");
      } finally { if (generation === lifetime.current) setLoading(false); }
    }
    void load();
    return () => { lifetime.current = generation + 1; abort.abort(); };
    // Identity is captured per lifetime. Other renders cannot revive its response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, contentHash, revisionId]);

  async function refresh() {
    if (!endpoint || saving) return;
    const generation = lifetime.current;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.current?.signal });
      if (generation !== lifetime.current) return;
      if ([401, 403, 404, 423].includes(response.status)) { setBlocked(true); setReviews(null); setMessage("영상 노트에 다시 접근하려면 기록을 새로 열어 주세요."); return; }
      const body = await response.json();
      if (generation !== lifetime.current) return;
      if (!response.ok || !object(body) || !valid(body.reviews)) throw new Error("load failed");
      setReviews(body.reviews); rememberPending(null);
      setMessage("최신 사용자 판단을 불러왔습니다.");
    } catch { if (generation === lifetime.current) setMessage("사용자 판단을 불러오지 못했습니다. 다시 시도해 주세요."); }
    finally { if (generation === lifetime.current) setLoading(false); }
  }

  async function decide(kind: VideoReviewKind, index: number, action: "confirm" | "reject", retry = false) {
    if (!endpoint || !reviews || saving || blocked || !writeEnabled) return;
    const itemKey = videoReviewItemKey(kind, index), item = reviews.items.find((candidate) => candidate.itemKey === itemKey);
    if (!item || !reviews.currentSnapshotId || !reviews.canReview || reviews.currentRevisionId !== revisionId) return;
    if (pending.current && !retry) { setMessage("앞선 요청의 저장 여부를 먼저 다시 확인하거나 최신 상태를 불러와 주세요."); return; }
    const request: VideoReviewRequest = retry && pending.current ? pending.current : {
      kind, index, action, expectedStateVersion: item.stateVersion, contentHash: reviews.contentHash,
      expectedRevisionId: reviews.currentRevisionId, expectedSnapshotId: reviews.currentSnapshotId, expectedSnapshotVersion: reviews.currentSnapshotVersion,
      idempotencyKey: crypto.randomUUID(),
    };
    rememberPending(request);
    const generation = lifetime.current;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.current?.signal });
      if (generation !== lifetime.current) return;
      if ([401, 403, 404, 423].includes(response.status)) { setBlocked(true); setReviews(null); rememberPending(null); setMessage("영상 노트에 다시 접근하려면 기록을 새로 열어 주세요."); return; }
      const body = await response.json();
      if (generation !== lifetime.current) return;
      if (!response.ok) {
        if (response.status === 409) { rememberPending(null); setReviews(null); setMessage("다른 화면에서 기록이나 판단이 바뀌었습니다. 최신 상태를 다시 불러와 주세요."); return; }
        throw new Error("save failed");
      }
      if (!object(body) || !valid(body.reviews) || !object(body.receipt)) throw new Error("invalid receipt");
      const receipt = body.receipt;
      const expectedStatus = request.action === "confirm" ? "confirmed" : "rejected";
      const settledItem = body.reviews.items.find((item) => item.itemKey === videoReviewItemKey(request.kind, request.index));
      if (receipt.itemKey !== videoReviewItemKey(request.kind, request.index)
        || receipt.status !== expectedStatus || receipt.stateVersion !== request.expectedStateVersion + 1
        || typeof receipt.reviewedAt !== "string" || !Number.isFinite(Date.parse(receipt.reviewedAt)) || typeof receipt.replayed !== "boolean"
        || !settledItem || settledItem.stateVersion < receipt.stateVersion || (settledItem.stateVersion === receipt.stateVersion && settledItem.status !== receipt.status)) throw new Error("invalid receipt");
      setReviews(body.reviews); rememberPending(null);
      setMessage(`${videoReviewStatusLabel(expectedStatus)}를 저장했습니다. 원 AI 노트는 그대로 보존됩니다.`);
    } catch { if (generation === lifetime.current) setMessage("저장 결과를 확인하지 못했습니다. 같은 요청 재시도 또는 최신 상태 불러오기로 확인해 주세요."); }
    finally { if (generation === lifetime.current) setSaving(false); }
  }

  function control(kind: VideoReviewKind, index: number) {
    if (!context || blocked) return null;
    const item = reviews?.items.find((candidate) => candidate.itemKey === videoReviewItemKey(kind, index));
    const disabled = loading || saving || !item || !reviews?.canReview || !writeEnabled || reviews.currentRevisionId !== revisionId || hasPending;
    return <div aria-label={`${kind === "summary" ? "요약" : kind === "segment" ? "구간" : kind === "speech" ? "발화" : kind === "screen_text" ? "화면 글" : "분석 한계"} ${index + 1} 사용자 판단`} className="v2-video-review-control" role="group">
      <span data-review-status={item?.status ?? "loading"}>{item ? videoReviewStatusLabel(item.status) : "판단 불러오는 중"}</span>
      <button aria-pressed={item?.status === "confirmed"} disabled={disabled || item?.status === "confirmed"} onClick={() => void decide(kind, index, "confirm")} type="button">확인</button>
      <button aria-pressed={item?.status === "rejected"} disabled={disabled || item?.status === "rejected"} onClick={() => void decide(kind, index, "reject")} type="button">거절</button>
    </div>;
  }

  const banner = context ? <div className="v2-video-review-banner">
    <p>확인·거절은 이 항목에 대한 내 판단입니다. AI 정확성이나 외부 사실을 확정하지 않으며 원 AI 노트는 보존합니다.</p>
    {reviews && !reviews.canReview ? <p>현재 선택본에 없는 과거 노트입니다. 저장된 판단을 읽을 수 있습니다.</p> : null}
    {reviews && reviews.currentRevisionId !== revisionId ? <p>기록 버전이 바뀌었습니다. 기록을 새로 열어 주세요.</p> : null}
    <p aria-live="polite" role="status">{message}</p>
    {!blocked ? <div className="v2-link-toolbar"><button disabled={loading || saving} onClick={() => void refresh()} type="button">{loading ? "판단 불러오는 중" : "최신 판단 다시 불러오기"}</button>
      {hasPending ? <button disabled={saving} onClick={() => { const request = pending.current; if (request) void decide(request.kind, request.index, request.action, true); }} type="button">같은 판단 요청 재시도</button> : null}</div> : null}
  </div> : null;
  return { reviews, blocked, banner, control };
}
