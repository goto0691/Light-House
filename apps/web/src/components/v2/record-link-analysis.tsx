"use client";

import { Check, ChevronDown, RefreshCw, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LinkSnapshotEditor, type LinkSnapshotSelection } from "@/components/v2/link-snapshot-editor";
import { ExactSourceText } from "@/components/v2/record-source-materials";
import { RecordManualFragments } from "@/components/v2/record-manual-fragments";
import { RecordPromptCurations } from "@/components/v2/record-prompt-curations";
import { VideoAnalysisRequest, type VideoAnalysisTarget } from "@/components/v2/record-video-analysis";
import type { LinkRecoveryIdentity } from "@/components/v2/editor/use-link-draft-recovery";
import { assertSnapshotReceipt } from "@/lib/v2/editor/link-snapshot-receipt";
import { revokeLinkDraftAccess } from "@/lib/v2/editor/link-draft-access";
import type { LinkPresentationV1, PresentedLinkFragment } from "@/lib/v2/domain/link-presentation-v1";
import { formatTimecode, parseYouTubeVideoUrl, VIDEO_ANALYSIS_LIMITS } from "@/lib/v2/domain/video-analysis-source";
import "@/app/v2/link-analysis.css";
import "@/app/v2/prompt-curations.css";

const roles: Record<string, string> = { source: "원문", prompt: "프롬프트", negative_prompt: "네거티브 프롬프트", parameters: "설정값", quote: "인용", insight: "인사이트", visual_tip: "구도·이미지 팁", transcript: "사용자 제공 자막", caption: "캡션" };
const statuses: Record<string, string> = { queued: "예약 처리 대기 · 다음 처리 주기에 분석됩니다", leased: "실행 준비", running: "텍스트 정리 중", retry_wait: "재시도 대기", needs_review: "확인 필요", succeeded: "정리 완료", partial: "일부 자료만 처리", stale: "이전 자료의 결과", superseded: "이전 작업", failed: "정리 실패", dead_letter: "정리 중단" };
const reasons: Record<string, string> = {
  link_snapshot_required: "먼저 원문을 선택해 자료 버전을 저장해 주세요.", link_history_read_only: "과거 자료와 실행 결과는 읽기 전용입니다.",
  restricted_ai_forbidden: "제한된 기록은 잠금을 해제해도 외부 AI로 전송하지 않습니다.", restricted_record_locked: "제한된 기록의 잠금을 먼저 해제해 주세요.",
  v2_write_disabled: "현재 쓰기 기능이 비활성화되어 있습니다.", v2_ai_disabled: "현재 AI 기능이 비활성화되어 있습니다.",
  link_analysis_needs_input: "분석할 외부 원문이 필요합니다. URL만 있는 자료와 첨부는 보관만 유지합니다.",
  link_snapshot_schema_unavailable: "링크 분석 저장 기능이 아직 준비되지 않았습니다. 원문 보관은 유지합니다.",
};
const activeStatuses = new Set(["queued", "leased", "running", "retry_wait"]);
type Selection = { snapshotId?: string; runId?: string };
const collectionReasons: Record<string, string> = {
  invalid_url: "주소 형식을 확인해 주세요.", unsafe_host: "안전하게 확인할 수 없는 주소입니다.",
  host_not_allowed: "이 주소는 현재 자동 수집 대상이 아닙니다.", unsupported_provider: "이 서비스는 자동 수집을 지원하지 않습니다.",
  dns_unverified: "주소의 네트워크 위치를 확인하지 못했습니다.", dns_not_public: "공개 인터넷 주소가 아니어서 수집을 중단했습니다.",
  transport_unavailable: "현재 환경에서 공개 페이지 연결을 사용할 수 없습니다.", transport_failed: "페이지 연결에 실패했습니다.",
  timeout: "페이지 응답 시간이 초과됐습니다.", redirect_missing: "페이지 이동 주소를 확인하지 못했습니다.",
  redirect_blocked: "이동한 주소에 접근할 수 없습니다.", redirect_limit: "페이지 이동 횟수가 한도를 넘었습니다.",
  login_required: "로그인이 필요한 페이지입니다.", unauthorized: "접근 권한이 필요한 페이지입니다.",
  forbidden: "사이트가 공개 접근을 거부했습니다.", rate_limited: "사이트가 요청 횟수를 제한했습니다.",
  http_error: "사이트가 페이지를 제공하지 않았습니다.", response_too_large: "페이지가 수집 크기 한도를 넘었습니다.",
  unsupported_mime: "지원하지 않는 페이지 형식입니다.", unsupported_charset: "지원하지 않는 문자 인코딩입니다.",
  invalid_text: "페이지 텍스트를 안전하게 읽지 못했습니다.", empty_content: "읽을 수 있는 본문을 찾지 못했습니다.",
  html_visible_text_only: "표시 가능한 HTML 텍스트만 확보했습니다. 원본 전체 범위는 확인하지 않았습니다.",
  http_partial_content: "서버가 일부 내용만 제공했습니다. 원본 전체 범위는 확인하지 않았습니다.",
};
function collectionStatus(coverage: NonNullable<NonNullable<LinkPresentationV1["selectedSnapshot"]>["coverage"]>) {
  const detail = coverage.reason ? collectionReasons[coverage.reason] ?? "수집 범위를 확인하지 못했습니다." : null;
  if (coverage.status === "captured") return `공개 웹 텍스트를 보관했습니다. ${detail ?? "댓글·이미지·연속글은 별도로 확인해야 합니다."}`;
  if (coverage.status === "partial") return `공개 웹 텍스트 일부를 보관했습니다. ${detail ?? "페이지 전체와 연결된 자료의 확보 범위는 미확인입니다."}`;
  if (coverage.status === "needs_input") return `자동 수집에 추가 입력이 필요합니다. ${detail ?? "접근 범위를 확인하지 못했습니다."} URL과 기존 원문은 유지됩니다. 확인한 글을 직접 붙여넣거나 이미지·캡처를 첨부해 주세요.`;
  return `자동 수집을 완료하지 못했습니다. ${detail ?? "접근 범위를 확인하지 못했습니다."} URL과 기존 원문은 유지됩니다. 확인한 글을 직접 붙여넣거나 이미지·캡처를 첨부해 주세요.`;
}
function requestError(error: unknown, fallback: string) {
  return error instanceof TypeError ? "연결을 확인한 뒤 다시 시도해 주세요. 원문과 입력 내용은 유지됩니다." : error instanceof Error ? error.message : fallback;
}

function statusLabel(data: LinkPresentationV1) {
  if (data.unavailableReason) return "링크 정리 상태 확인 필요 · 원문은 원본과 첨부에서 확인";
  if (!data.schemaAvailable) return "분석 기능 준비 전 · 원문 보관 유지";
  if (data.isHistorical) return "과거 자료·실행 결과 열람 · 읽기 전용";
  if (data.latestAttempt?.isCurrent && data.latestAttempt.lastErrorCode === "quota_exhausted") return "AI 할당량 대기 · 원문은 보관되어 있습니다";
  if (data.latestAttempt?.isCurrent && data.latestAttempt.status === "succeeded" && data.selectedRun?.status === "partial") return "일부 자료만 처리 · 텍스트 외 자료는 보관만 유지";
  if (data.latestAttempt?.isCurrent) return statuses[data.latestAttempt.status] ?? "처리 상태 확인 필요";
  if (data.selectedRun) return statuses[data.selectedRun.status] ?? "분석 결과";
  return "아직 AI로 정리하지 않았습니다";
}

class LinkRequestError extends Error { constructor(readonly status: number, readonly code: string | null, message: string) { super(message); } }
class LinkStaleResponse extends Error { constructor() { super("더 최신 상태 확인이 진행되어 이전 응답을 적용하지 않았습니다."); } }
function retryHint(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "";
  return ` 다시 시도 가능: ${new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))} 이후.`;
}
async function readJson(response: Response) {
  const body = await response.json().catch(() => ({})) as { links?: LinkPresentationV1; error?: { code?: string; message?: string; retryAt?: unknown } };
  if (!response.ok) throw new LinkRequestError(response.status, body?.error?.code ?? null, response.status === 409 ? "자료가 변경되었습니다. 최신 상태를 불러온 뒤 입력을 확인하고 다시 저장해 주세요." : `${body?.error?.message || "요청을 완료하지 못했습니다."}${retryHint(body?.error?.retryAt)}`);
  if (!body || typeof body !== "object") throw new Error("링크 정리 응답을 확인하지 못했습니다.");
  return body;
}

export function RecordLinkAnalysis({ recordId, initial, recoveryIdentity }: { recordId: string; initial: LinkPresentationV1; recoveryIdentity: LinkRecoveryIdentity }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [pollStopped, setPollStopped] = useState(false);
  const [selectedRunControl, setSelectedRunControl] = useState("");
  const [manualRevision, setManualRevision] = useState(0);
  const selectionRef = useRef<Selection>({});
  const requestSequence = useRef(0);
  const analyzeKey = useRef<{ identity: string; key: string } | null>(null);
  const collectKey = useRef<{ identity: string; key: string } | null>(null);
  const [collectingSourceId, setCollectingSourceId] = useState<string | null>(null);
  const videoKey = useRef<{ identity: string; key: string } | null>(null);
  const [analyzingVideoId, setAnalyzingVideoId] = useState<string | null>(null);
  const reviewKeys = useRef(new Map<string, string>());
  const endpoint = `/api/v2/records/${encodeURIComponent(recordId)}/links`;
  const currentActive = Boolean(!data.isHistorical && data.latestAttempt?.isCurrent && activeStatuses.has(data.latestAttempt.status));

  const revokeAccess = useCallback(() => {
    // Stop child debounces/in-flight persistence synchronously, before React
    // removes their views and invokes normal navigation cleanup.
    revokeLinkDraftAccess({ ownerId: recoveryIdentity.ownerId, recordId });
    requestSequence.current += 1;
    setData((current) => ({ ...current, unavailableReason: "link_access_denied", currentRevisionId: null, currentSnapshotId: null,
      currentSnapshotVersion: 0, selectedSnapshot: null, members: [], availableSources: [], fragments: [],
      snapshotHistory: { items: [], nextCursor: null }, runHistory: { items: [], nextCursor: null }, selectedRun: null, publishedRun: null, latestAttempt: null,
      capabilities: { canCreateSnapshot: false, canCreateManualFragment: false, canAnalyze: false, canReview: false, reason: "restricted_record_locked" } }));
    setEditorMounted(false); setEditorOpen(false); setMessage(""); selectionRef.current = {}; setSelectedRunControl("");
    analyzeKey.current = null; reviewKeys.current.clear();
    collectKey.current = null; setCollectingSourceId(null);
    videoKey.current = null; setAnalyzingVideoId(null);
    setError("접근 권한이나 잠금 상태가 변경되어 링크 원문과 입력을 닫았습니다. 다시 인증한 뒤 불러와 주세요.");
  }, [recoveryIdentity.ownerId, recordId]);

  // Every parent request, including pagination and mutations, shares the same
  // access boundary. A redacted 200 is a denial, not an empty page to merge.
  const readAuthorized = useCallback(async (response: Response, sequence: number) => {
    let body: Awaited<ReturnType<typeof readJson>>;
    try { body = await readJson(response); }
    catch (caught) {
      if (sequence !== requestSequence.current) throw new LinkStaleResponse();
      if (caught instanceof LinkRequestError && ([401, 403, 423].includes(caught.status)
        || caught.code === "record_not_found" || caught.code === "link_record_not_found" || caught.status === 404 && !caught.code)) {
        revokeAccess();
        throw new Error("접근 권한이나 잠금 상태가 변경되어 링크 원문과 입력을 닫았습니다. 다시 인증한 뒤 불러와 주세요.");
      }
      throw caught;
    }
    if (sequence !== requestSequence.current) throw new LinkStaleResponse();
    if (body.links && (body.links.capabilities.reason === "restricted_record_locked" || body.links.unavailableReason === "restricted_record_locked")) {
      revokeAccess();
      throw new Error("접근 권한이나 잠금 상태가 변경되어 링크 원문과 입력을 닫았습니다. 다시 인증한 뒤 불러와 주세요.");
    }
    return body;
  }, [revokeAccess]);

  const refresh = useCallback(async (selection = selectionRef.current) => {
    const sequence = ++requestSequence.current;
    const params = new URLSearchParams();
    if (selection.snapshotId) params.set("snapshotId", selection.snapshotId);
    if (selection.runId) params.set("runId", selection.runId);
    const body = await readAuthorized(await fetch(`${endpoint}${params.size ? `?${params}` : ""}`, { cache: "no-store" }), sequence);
    // The helper's async return is another boundary at which a child may revoke access.
    if (sequence !== requestSequence.current) throw new LinkStaleResponse();
    if (!body.links) throw new Error("링크 정리 상태를 불러오지 못했습니다.");
    const incoming = body.links;
    selectionRef.current = selection; setSelectedRunControl(selection.runId ?? "");
    setData((current) => sequence === requestSequence.current ? incoming : current);
    return incoming;
  }, [endpoint, readAuthorized]);

  useEffect(() => {
    if (!currentActive) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (cancelled) return;
      if (document.hidden) { timer = setTimeout(() => void poll(), 10_000); return; }
      try { await refresh(); } catch (caught) { if (!cancelled && !(caught instanceof LinkStaleResponse)) setError(requestError(caught, "처리 상태를 불러오지 못했습니다. 새로고침으로 다시 확인하세요.")); }
      if (cancelled) return;
      attempts += 1;
      if (attempts >= 12) { setPollStopped(true); return; }
      timer = setTimeout(() => void poll(), Math.min(10_000, 2000 * (attempts + 1)));
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentActive, data.latestAttempt?.id, refresh]);

  async function select(selection: Selection) {
    setError(""); setBusy(true);
    try { await refresh(selection); setMessage(""); }
    catch (caught) { if (!(caught instanceof LinkStaleResponse)) setError(requestError(caught, "상태를 불러오지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function moreHistory(kind: "snapshot" | "run") {
    const cursor = kind === "snapshot" ? data.snapshotHistory.nextCursor : data.runHistory.nextCursor;
    if (!cursor || busy) return;
    setBusy(true); setError("");
    const sequence = ++requestSequence.current;
    try {
      const params = new URLSearchParams({ [`${kind}Cursor`]: cursor });
      if (data.selectedSnapshot) params.set("snapshotId", data.selectedSnapshot.id);
      if (selectionRef.current.runId) params.set("runId", selectionRef.current.runId);
      const body = await readAuthorized(await fetch(`${endpoint}?${params}`, { cache: "no-store" }), sequence);
      if (sequence !== requestSequence.current) throw new LinkStaleResponse();
      if (!body.links) throw new Error("이력을 불러오지 못했습니다.");
      const incoming = body.links;
      setData((current) => sequence !== requestSequence.current ? current : kind === "snapshot" ? { ...current, snapshotHistory: { items: [...current.snapshotHistory.items, ...incoming.snapshotHistory.items.filter((item) => !current.snapshotHistory.items.some((prior) => prior.id === item.id))], nextCursor: incoming.snapshotHistory.nextCursor } }
        : { ...current, runHistory: { items: [...current.runHistory.items, ...incoming.runHistory.items.filter((item) => !current.runHistory.items.some((prior) => prior.id === item.id))], nextCursor: incoming.runHistory.nextCursor } });
    } catch (caught) { if (!(caught instanceof LinkStaleResponse)) setError(requestError(caught, "이력을 불러오지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function analyze() {
    const snapshot = data.selectedSnapshot;
    if (busy || !snapshot || !data.currentRevisionId || !data.capabilities.canAnalyze || data.isHistorical) return;
    setBusy(true); setError(""); setMessage(""); setPollStopped(false);
    const sequence = requestSequence.current;
    try {
      const identity = `${data.currentRevisionId}:${snapshot.id}:${snapshot.manifestHash}`;
      if (analyzeKey.current?.identity !== identity) analyzeKey.current = { identity, key: crypto.randomUUID() };
      await readAuthorized(await fetch(`${endpoint}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevisionId: data.currentRevisionId, expectedSnapshotId: snapshot.id, expectedManifestHash: snapshot.manifestHash, idempotencyKey: analyzeKey.current.key }) }), sequence);
      if (sequence !== requestSequence.current) throw new LinkStaleResponse();
      await refresh({});
      if (sequence + 1 !== requestSequence.current) throw new LinkStaleResponse();
      analyzeKey.current = null;
      setMessage("텍스트 정리를 요청했습니다. 원문·내 메모는 변경하지 않습니다.");
    } catch (caught) { if (!(caught instanceof LinkStaleResponse)) setError(requestError(caught, "정리를 요청하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function saveSnapshot(selection: LinkSnapshotSelection) {
    if (busy || !data.currentRevisionId || !data.capabilities.canCreateSnapshot || data.isHistorical) throw new Error("현재 자료 버전에서만 원문을 보강할 수 있습니다.");
    setBusy(true); setError("");
    const saveSequence = requestSequence.current;
    try {
      const receipt = await readAuthorized(await fetch(`${endpoint}/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection) }), saveSequence);
      await assertSnapshotReceipt(receipt, { ownerId: recoveryIdentity.ownerId, recordId, request: selection });
      if (saveSequence !== requestSequence.current) throw new Error("저장 확인 중 화면 상태가 바뀌었습니다. 보존한 요청으로 결과를 다시 확인해 주세요.");
      await refresh({});
      if (saveSequence + 1 !== requestSequence.current) throw new Error("다른 상태 확인이 진행되어 저장 요청을 보존했습니다. 다시 확인해 주세요.");
      setEditorOpen(false); setEditorMounted(false); setEditorGeneration((value) => value + 1);
      setMessage("새 자료 버전을 저장했습니다. 필요할 때 AI 정리를 별도로 요청하세요.");
      router.refresh();
    } finally { setBusy(false); }
  }

  async function collect(sourceItemId: string) {
    if (busy || data.isHistorical || !data.capabilities.canCreateSnapshot || !data.currentRevisionId
      || recoveryIdentity.privacyLevel === "restricted") return;
    const source = data.availableSources.find((item) => item.sourceItemId === sourceItemId);
    if (!source || source.manualLink?.provider !== "web" || source.rawText?.trim()) return;
    setBusy(true); setCollectingSourceId(sourceItemId); setError(""); setMessage("");
    const sequence = requestSequence.current;
    const identity = `${sourceItemId}:${data.currentRevisionId}:${data.currentSnapshotId ?? ""}:${data.currentSnapshotVersion}`;
    if (collectKey.current?.identity !== identity) collectKey.current = { identity, key: crypto.randomUUID() };
    try {
      const body = await readAuthorized(await fetch(`${endpoint}/collect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        sourceItemId, expectedRevisionId: data.currentRevisionId, expectedSnapshotId: data.currentSnapshotId,
        expectedSnapshotVersion: data.currentSnapshotVersion, idempotencyKey: collectKey.current.key,
      }) }), sequence);
      if (sequence !== requestSequence.current) throw new LinkStaleResponse();
      if (body.links?.contract !== "link-presentation.v1" || body.links.recordId !== recordId) throw new Error("수집 후 기록 상태를 확인하지 못했습니다. 새로고침으로 다시 확인해 주세요.");
      selectionRef.current = {}; setSelectedRunControl(""); setData(body.links);
      collectKey.current = null;
      setMessage(body.links.selectedSnapshot?.acquisitionMethod === "public_fetch" && body.links.selectedSnapshot.coverage
        ? collectionStatus(body.links.selectedSnapshot.coverage) : "수집 결과를 저장했습니다. 확보 범위를 확인해 주세요.");
      router.refresh();
    } catch (caught) { if (!(caught instanceof LinkStaleResponse)) setError(requestError(caught, "공개 웹 텍스트를 수집하지 못했습니다. URL과 원문은 그대로 보존됩니다.")); }
    finally { setBusy(false); setCollectingSourceId(null); }
  }

  async function analyzeVideo(sourceItemId: string, range: { startSeconds: number | null; endSeconds: number | null }) {
    if (busy || data.isHistorical || !data.capabilities.canCreateSnapshot || !data.currentRevisionId
      || recoveryIdentity.privacyLevel === "restricted") return;
    const source = data.availableSources.find((item) => item.sourceItemId === sourceItemId);
    if (!source?.manualLink || source.manualLink.provider !== "youtube") return;
    setBusy(true); setAnalyzingVideoId(sourceItemId); setError(""); setMessage("");
    const sequence = requestSequence.current;
    const identity = `${sourceItemId}:${range.startSeconds ?? ""}:${range.endSeconds ?? ""}:${data.currentRevisionId}:${data.currentSnapshotId ?? ""}:${data.currentSnapshotVersion}`;
    if (videoKey.current?.identity !== identity) videoKey.current = { identity, key: crypto.randomUUID() };
    try {
      const body = await readAuthorized(await fetch(`${endpoint}/video-analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        sourceItemId, expectedRevisionId: data.currentRevisionId, expectedSnapshotId: data.currentSnapshotId,
        expectedSnapshotVersion: data.currentSnapshotVersion, startSeconds: range.startSeconds, endSeconds: range.endSeconds, idempotencyKey: videoKey.current.key,
      }) }), sequence);
      if (sequence !== requestSequence.current) throw new LinkStaleResponse();
      if (body.links?.contract !== "link-presentation.v1" || body.links.recordId !== recordId) throw new Error("영상 분석 후 기록 상태를 확인하지 못했습니다. 새로고침으로 다시 확인해 주세요.");
      selectionRef.current = {}; setSelectedRunControl(""); setData(body.links);
      videoKey.current = null;
      const coverage = body.links.selectedSnapshot?.acquisitionMethod === "api" ? body.links.selectedSnapshot.coverage : null;
      const clip = body.links.members.map((member) => member.videoAnalysis).find((note) => note?.requestedSourceItemId === sourceItemId
        && (range.startSeconds === null || note.requestedStartSeconds === range.startSeconds));
      setMessage(`${coverage?.status === "partial" ? "AI 영상 분석 노트를 새 자료 버전으로 보관했습니다" : "AI 영상 분석 결과를 확인했습니다"}${clip ? ` · ${formatTimecode(clip.requestedStartSeconds)}–${formatTimecode(clip.requestedEndSeconds)} 구간` : ""} · 원본 영상 미보관 · 공식 자막 아님. 원본과 첨부에서 시각별 내용을 확인하세요.`);
      router.refresh();
    } catch (caught) { if (!(caught instanceof LinkStaleResponse)) setError(requestError(caught, "영상을 분석하지 못했습니다. 영상 링크와 메모는 그대로 보존됩니다.")); }
    finally { setBusy(false); setAnalyzingVideoId(null); }
  }

  async function review(fragment: PresentedLinkFragment, action: "confirm" | "reject") {
    if (busy || !data.capabilities.canReview || data.isHistorical || !data.currentRevisionId || !fragment.runId) return;
    setBusy(true); setError("");
    const sequence = requestSequence.current;
    const identity = `${fragment.id}:${fragment.stateVersion}:${action}`;
    if (!reviewKeys.current.has(identity)) reviewKeys.current.set(identity, crypto.randomUUID());
    try {
      await readAuthorized(await fetch(`${endpoint}/fragments/${encodeURIComponent(fragment.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, expectedRevisionId: data.currentRevisionId, expectedSnapshotId: fragment.snapshotId, expectedRunId: fragment.runId, expectedStateVersion: fragment.stateVersion, idempotencyKey: reviewKeys.current.get(identity),
      }) }), sequence);
      if (sequence !== requestSequence.current) throw new LinkStaleResponse();
      await refresh();
      if (sequence + 1 !== requestSequence.current) throw new LinkStaleResponse();
      reviewKeys.current.delete(identity);
      setMessage(action === "confirm" ? "외부 자료의 정리 결과를 확인했습니다. 개인 사실로 전환하지 않습니다." : "이 제안을 거절했습니다. 원문은 유지됩니다.");
    } catch (caught) { if (!(caught instanceof LinkStaleResponse)) setError(requestError(caught, "검토 결과를 저장하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  const unavailable = data.members.filter((member) => !member.videoAnalysis && (!member.manualLink || !member.rawText?.trim()));
  const videoNotes = data.members.filter((member) => member.videoAnalysis);
  const videoTargets: VideoAnalysisTarget[] = data.availableSources.flatMap((source) => source.kind === "url" && source.manualLink?.provider === "youtube"
    && !source.publicFetch && parseYouTubeVideoUrl(source.manualLink.url) ? [{
      sourceItemId: source.sourceItemId, url: source.manualLink.url, savedStartSeconds: source.manualLink.startSeconds,
      clips: data.members.flatMap((member) => member.videoAnalysis?.requestedSourceItemId === source.sourceItemId ? [member.videoAnalysis] : []),
    }] : []);
  const collectibleSources = data.availableSources.filter((source) => source.manualLink?.provider === "web" && !source.rawText?.trim());
  const fetchedSourceIds = new Set(data.availableSources.flatMap((source) => source.publicFetch ? [source.publicFetch.requestedSourceItemId] : []));
  const snapshotChoices = [...data.snapshotHistory.items, ...(data.selectedSnapshot && !data.snapshotHistory.items.some((item) => item.id === data.selectedSnapshot!.id) ? [data.selectedSnapshot] : [])];
  const runChoices = [...data.runHistory.items, ...(data.selectedRun && !data.runHistory.items.some((item) => item.id === data.selectedRun!.id) ? [data.selectedRun] : [])];
  return <section className="v2-record-link-analysis" aria-labelledby="link-analysis-heading">
    <header><div><p className="v2-link-eyebrow">원문과 분리된 정리</p><h2 id="link-analysis-heading">링크 정리</h2></div><button disabled={busy} onClick={() => void select(selectionRef.current)} type="button"><RefreshCw aria-hidden="true" size={15} /> 상태 새로고침</button></header>
    <p className="v2-link-status" aria-live="polite">{statusLabel(data)}</p>
    <p className="v2-link-principle">직접 제공하거나 공개 웹에서 확보한 외부 텍스트만 별도 요청으로 분석합니다. 내 메모·이미지 OCR은 포함하지 않으며, 영상은 아래의 별도 영상 분석으로만 처리합니다.</p>
    {data.selectedSnapshot?.acquisitionMethod === "public_fetch" && data.selectedSnapshot.coverage ? <p className="v2-link-coverage" role="status">{collectionStatus(data.selectedSnapshot.coverage)}</p> : null}
    {collectibleSources.length ? <div className="v2-link-unavailable" aria-label="공개 웹 텍스트 수집">
      <p>서버에 수집이 허용된 공개 웹 호스트에서만 읽을 수 있는 텍스트를 확보합니다. 다시 수집하면 이전 자료 버전을 보존하고 새 버전을 만듭니다. Threads·Instagram의 글·이미지·댓글은 자동으로 가져오지 않습니다.</p>
      {collectibleSources.map((source, index) => <div key={source.sourceItemId}>
        <p className="v2-source-url">{source.manualLink!.url}</p>
        <button disabled={busy || data.isHistorical || !data.capabilities.canCreateSnapshot || recoveryIdentity.privacyLevel === "restricted"} onClick={() => void collect(source.sourceItemId)} type="button">
          {collectingSourceId === source.sourceItemId ? `공개 텍스트 ${index + 1} 수집 중` : fetchedSourceIds.has(source.sourceItemId) ? `공개 웹 텍스트 ${index + 1} 다시 수집` : `공개 웹 텍스트 ${index + 1} 수집`}
        </button>
      </div>)}
    </div> : null}
    {videoTargets.length ? <div className="v2-link-unavailable v2-video-requests" aria-label="YouTube 영상 AI 분석">
      <p>공개 YouTube 영상만 AI로 분석합니다. 한 번에 최대 {VIDEO_ANALYSIS_LIMITS.maxWindowSeconds / 60}분 구간을 분석하며, 원본 영상은 저장하지 않습니다. 결과는 시각 근거가 붙은 AI 노트로 원문과 구분해 보관하고, 긴 영상은 이어서 분석할 수 있습니다. 비공개·일부 공개 영상은 분석할 수 없으니 자막이나 메모를 직접 붙여 넣어 주세요.</p>
      {!data.capabilities.canCreateSnapshot || recoveryIdentity.privacyLevel === "restricted" ? <p className="v2-link-muted">{recoveryIdentity.privacyLevel === "restricted" ? "제한된 기록의 영상은 외부 AI로 보내지 않습니다." : "현재 이 기록에서 새 자료 버전을 만들 수 없습니다."}</p> : null}
      {videoTargets.map((target, index) => <VideoAnalysisRequest disabled={busy || data.isHistorical || !data.capabilities.canCreateSnapshot || recoveryIdentity.privacyLevel === "restricted"}
        index={index} key={target.sourceItemId} onAnalyze={(range) => void analyzeVideo(target.sourceItemId, range)} running={analyzingVideoId === target.sourceItemId} target={target} />)}
    </div> : null}
    {data.availableSources.some((source) => source.manualLink && ["threads", "instagram"].includes(source.manualLink.provider)) ? <p className="v2-link-muted">Threads·Instagram은 현재 자동 수집을 지원하지 않습니다. URL은 유지되며, 자료 추가·선택 변경에서 확인한 글을 직접 붙여넣거나 새 기록에 이미지·캡처를 첨부할 수 있습니다. 보이지 않는 댓글·연속글·이미지는 확보된 자료로 표시하지 않습니다.</p> : null}
    {data.latestAttempt?.isCurrent && data.latestAttempt.status === "queued" ? <p className="v2-link-muted">요청은 저장되었습니다. 예약 처리기가 실행되어야 분석이 시작됩니다. 로컬 개발 환경에서는 별도 처리기 실행이 필요합니다.</p> : null}
    <div className="v2-link-version-controls"><label>자료 버전<select aria-label="자료 버전" disabled={busy || !snapshotChoices.length} onChange={(event) => void select(event.target.value ? { snapshotId: event.target.value } : {})} value={data.selectedSnapshot?.id ?? ""}>
      {!data.selectedSnapshot ? <option value="">아직 자료 버전 없음</option> : null}{snapshotChoices.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>v{snapshot.snapshotVersion}{snapshot.id === data.currentSnapshotId ? " · 현재 자료" : " · 과거 자료"} · {snapshot.sourceCount}개</option>)}
    </select></label><label>분석 실행<select aria-label="분석 실행" disabled={busy || !runChoices.length} onChange={(event) => void select({ snapshotId: data.selectedSnapshot?.id, ...(event.target.value ? { runId: event.target.value } : {}) })} value={selectedRunControl}>
      <option value="">{data.selectedSnapshot?.id === data.currentSnapshotId ? "현재 게시된 결과" : "이 자료 버전의 최신 결과"}</option>{runChoices.map((run, index) => <option key={run.id} value={run.id}>실행 {index + 1} · {statuses[run.status] ?? "상태 확인 필요"}{run.isPublished ? " · 현재 결과" : " · 과거 결과"}</option>)}
    </select></label></div>
    <div className="v2-link-toolbar">{data.snapshotHistory.nextCursor ? <button disabled={busy} onClick={() => void moreHistory("snapshot")} type="button">이전 자료 버전 더 보기</button> : null}{data.runHistory.nextCursor ? <button disabled={busy} onClick={() => void moreHistory("run")} type="button">이전 분석 실행 더 보기</button> : null}</div>
    {data.isHistorical ? <p className="v2-link-warning">과거 자료·실행 결과입니다. 여기서는 원문을 복사하고 근거를 열람할 수 있으며, 분석·확인·수정은 현재 버전에서 진행합니다.</p> : null}
    {data.capabilities.reason ? <p className="v2-link-muted">{reasons[data.capabilities.reason] ?? "링크 정리 상태를 확인한 뒤 다시 시도해 주세요. 원문은 원본과 첨부에서 확인할 수 있습니다."}</p> : null}
    <div className="v2-link-toolbar"><button className="v2-link-primary" disabled={busy || !data.capabilities.canAnalyze || data.isHistorical || currentActive || !data.selectedSnapshot} onClick={() => void analyze()} type="button"><Sparkles aria-hidden="true" size={16} />{data.publishedRun ? "다시 AI로 정리" : "AI로 정리"}</button>
      <button aria-expanded={editorOpen} disabled={busy || !data.capabilities.canCreateSnapshot || data.isHistorical} onClick={() => { setEditorMounted(true); setEditorOpen((open) => !open); }} type="button"><ChevronDown aria-hidden="true" size={16} />자료 추가·선택 변경</button>
    </div>
    {!data.selectedSnapshot && data.capabilities.canCreateSnapshot ? <p>먼저 포함할 원문을 선택하여 자료 버전을 저장해 주세요. 페이지를 여는 것만으로 분석을 시작하지 않습니다.</p> : null}
    {editorMounted && data.currentRevisionId ? <div hidden={!editorOpen}><LinkSnapshotEditor key={editorGeneration} basis={{ expectedRevisionId: data.currentRevisionId, expectedSnapshotId: data.currentSnapshotId, expectedSnapshotVersion: data.currentSnapshotVersion }} recoveryIdentity={recoveryIdentity} onAccessDenied={revokeAccess} disabled={busy || !data.capabilities.canCreateSnapshot || data.isHistorical} onSave={saveSnapshot} selectedSourceIds={(data.selectedSnapshot ? data.members : data.availableSources).map((source) => source.sourceItemId)} sources={data.availableSources.map((source) => ({ sourceItemId: source.sourceItemId, rawText: source.rawText, isManual: Boolean(source.manualLink), label: source.manualLink ? `${roles[source.manualLink.role]} · ${source.manualLink.url}` : source.videoAnalysis ? `AI 영상 분석 노트 · ${formatTimecode(source.videoAnalysis.requestedStartSeconds)}–${formatTimecode(source.videoAnalysis.requestedEndSeconds)}` : source.attachments[0]?.filename ?? `${source.kind} 첨부` }))} /></div> : null}
    {pollStopped && currentActive ? <p className="v2-link-muted">자동 상태 확인을 잠시 멈췄습니다. 상태 새로고침으로 다시 확인하세요.</p> : null}
    {error ? <p className="v2-product-error" role="alert">{error}</p> : null}<p className="v2-link-message" role="status">{message}</p>
    {data.selectedSnapshot ? <p className="v2-link-coverage">선택한 자료 {data.members.length}개 · 텍스트 입력 가능 {data.members.length - unavailable.length - videoNotes.length}개{videoNotes.length ? ` · AI 영상 분석 노트 ${videoNotes.length}개(텍스트 정리 대상 아님)` : ""} · 미처리 자료 {unavailable.length}개. 전체 스레드·영상 범위는 확인하지 않았습니다.</p> : null}
    {unavailable.length ? <details className="v2-link-unavailable"><summary>미처리 자료 {unavailable.length}개 보기</summary><ul>{unavailable.map((member) => <li key={member.sourceItemId}>{member.manualLink?.url ?? member.attachments[0]?.filename ?? `${member.kind} 자료`} · {member.manualLink ? "URL만 보관·텍스트 미확보" : "첨부 원본 보관·분석 안 함"}</li>)}</ul></details> : null}
    <div className="v2-link-fragments">{data.fragments.map((fragment) => <article className="v2-link-fragment" data-source-class={fragment.sourceClass} data-review-status={fragment.reviewStatus} id={`link-fragment-${fragment.id}`} key={fragment.id}>
      <header><h3>{roles[fragment.role] ?? "외부 자료"}</h3><span>{fragment.sourceClass === "ai_interpretation" ? "AI 해석 후보 · 외부 글의 요약" : fragment.sourceClass === "source_extract" ? "원문 발췌 · AI가 선택한 범위" : "사용자가 보관한 내용"}</span></header>
      <p className="v2-link-fragment-state">{fragment.reviewStatus === "confirmed" ? "사용자 확인됨 · 사실 검증 아님" : fragment.reviewStatus === "rejected" ? "거절한 제안 · 원문 유지" : fragment.reviewStatus === "superseded" ? "이전 자료의 제안" : "확인 필요"} · {fragment.completeness === "ocr_unverified" ? "OCR 미확인" : fragment.completeness === "truncated" ? "부분 원문" : "선택 범위 미검증"}</p>
      {fragment.sourceClass === "source_extract" && fragment.rawText !== null ? <ExactSourceText copyLabel="발췌 원문 복사" label={`${fragment.fragmentKey} 발췌 원문`} text={fragment.rawText} /> : fragment.sourceClass === "ai_interpretation" && fragment.derivedText !== null ? <ExactSourceText copyLabel="AI 해석만 복사" selectionLabel="해석 선택" copiedMessage="AI 해석만 복사했습니다. 원문이 아닙니다." label={`${fragment.fragmentKey} AI 해석`} text={fragment.derivedText} /> : null}
      <details className="v2-link-evidence"><summary>근거 {fragment.evidence.length}개</summary>{fragment.evidence.map((evidence) => <div key={evidence.id}>
        <p>자료 {evidence.memberKey} · {evidence.textStart === null ? "범위 미확인" : `원문 위치 ${evidence.textStart}–${evidence.textEnd}`}</p>{evidence.quote !== null ? <pre>{evidence.quote}</pre> : null}<a href={`#source-${evidence.sourceItemId}`}>원본 위치로</a>
      </div>)}</details>
      <footer><button disabled={busy || !data.capabilities.canReview || data.isHistorical || fragment.reviewStatus === "rejected"} onClick={() => void review(fragment, "reject")} type="button"><X aria-hidden="true" size={14} />제안 거절</button><button disabled={busy || !data.capabilities.canReview || data.isHistorical || fragment.reviewStatus === "confirmed"} onClick={() => void review(fragment, "confirm")} type="button"><Check aria-hidden="true" size={14} />{fragment.sourceClass === "ai_interpretation" ? "이 해석 보관" : "발췌 확인"}</button></footer>
    </article>)}</div>
    {data.selectedRun && !data.fragments.length ? <p className="v2-link-empty">선택한 실행에서 보관할 정리 결과를 찾지 못했습니다. 원문은 그대로 남아 있습니다.</p> : null}
    <RecordManualFragments recordId={recordId} data={data} recoveryIdentity={recoveryIdentity} onAccessDenied={revokeAccess} onSaved={() => setManualRevision((value) => value + 1)} />
    <RecordPromptCurations recordId={recordId} data={data} recoveryIdentity={recoveryIdentity} onAccessDenied={revokeAccess} manualRevision={manualRevision} onOpenSnapshot={busy ? undefined : (snapshotId) => void select({ snapshotId })} />
  </section>;
}
