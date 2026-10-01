"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";
import { PROCESSING_FILTER_LABELS, PROCESSING_FILTERS, PROCESSING_LABELS, PROCESSING_PAGE_SIZE, PROCESSING_STAGE_LABELS, PROCESSING_STATUS_CONTRACT, parseProcessingCursor, type ProcessingFilter, type ProcessingRuntime, type ProcessingStatus, type ProcessingStatusItem, type ProcessingStatusPage } from "@/lib/v2/domain/processing-status";
import "./processing-status-view.css";

type Location = { filter: ProcessingFilter; cursors: readonly (string | null)[]; index: number };
function first(filter: ProcessingFilter = "all"): Location { return { filter, cursors: [null], index: 0 }; }
function invalid(): never { throw new Error("Invalid processing status response."); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>, actual = Object.keys(result);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) return invalid();
  return result;
}
function count(value: unknown, positive = false): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) return invalid(); return value; }
function date(value: unknown): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return invalid(); return value; }
function nullableDate(value: unknown): string | null { return value === null ? null : date(value); }
function status(value: unknown): ProcessingStatus { if (typeof value !== "string" || !Object.hasOwn(PROCESSING_LABELS, value)) return invalid(); return value as ProcessingStatus; }
function matchesFilter(value: ProcessingStatus, filter: ProcessingFilter) { return filter === "all" || filter === "waiting" && ["queued", "processing", "retry_wait"].includes(value) || filter === "attention" && ["needs_review", "outdated"].includes(value) || filter === "completed" && value === "completed" || filter === "unprocessed" && ["unprocessed", "restricted"].includes(value); }

/** HTTP and SSR projections share the same display gate; unknown/private extra fields are not retained. */
function readPage(value: unknown, requested: Location): ProcessingStatusPage {
  const page = object(value, ["contract", "filter", "items", "counts", "nextCursor", "checkedAt", "runtime"]);
  if (page.contract !== PROCESSING_STATUS_CONTRACT || page.filter !== requested.filter || !Array.isArray(page.items) || page.items.length > PROCESSING_PAGE_SIZE) return invalid();
  const counts = object(page.counts, PROCESSING_FILTERS), copiedCounts = Object.fromEntries(PROCESSING_FILTERS.map((key) => [key, count(counts[key])])) as Record<ProcessingFilter, number>;
  if (PROCESSING_FILTERS.some((key) => copiedCounts[key] > copiedCounts.all)) return invalid();
  const ids = new Set<string>();
  const items: ProcessingStatusItem[] = page.items.map((raw) => {
    const row = object(raw, ["recordId", "title", "privacyLevel", "savedAt", "storage", "status", "partial", "reviewPending", "stages"]), rowStatus = status(row.status);
    if (typeof row.recordId !== "string" || !row.recordId || row.recordId.length > 200 || [".", ".."].includes(row.recordId) || /[\u0000-\u001f\u007f]/.test(row.recordId) || ids.has(row.recordId) || typeof row.title !== "string" || row.storage !== "saved"
      || !["normal", "sensitive", "restricted"].includes(String(row.privacyLevel)) || typeof row.partial !== "boolean" || typeof row.reviewPending !== "boolean" || !Array.isArray(row.stages) || row.stages.length > 24 || !matchesFilter(rowStatus, requested.filter)) return invalid();
    ids.add(row.recordId);
    if ((row.partial || row.reviewPending) && rowStatus !== "needs_review") return invalid();
    if (row.privacyLevel === "restricted" && (row.title !== "잠긴 기록" || rowStatus !== "restricted" || row.stages.length || row.partial || row.reviewPending)
      || row.privacyLevel !== "restricted" && rowStatus === "restricted" || row.privacyLevel === "sensitive" && row.title !== "민감 기록") return invalid();
    const stagesSeen = new Set<string>();
    const stages = row.stages.map((rawStage) => {
      const stage = object(rawStage, ["stage", "status", "count", "nextAttemptAt"]);
      if (typeof stage.stage !== "string" || !Object.hasOwn(PROCESSING_STAGE_LABELS, stage.stage)) return invalid();
      const stageStatus = status(stage.status), key = `${stage.stage}:${stageStatus}`;
      if (stagesSeen.has(key)) return invalid(); stagesSeen.add(key);
      return { stage: stage.stage as keyof typeof PROCESSING_STAGE_LABELS, status: stageStatus, count: count(stage.count, true), nextAttemptAt: nullableDate(stage.nextAttemptAt) };
    });
    return { recordId: row.recordId, title: row.title, privacyLevel: row.privacyLevel as ProcessingStatusItem["privacyLevel"], savedAt: date(row.savedAt), storage: "saved", status: rowStatus, partial: row.partial, reviewPending: row.reviewPending, stages };
  });
  if (copiedCounts[requested.filter] < items.length || page.nextCursor !== null && typeof page.nextCursor !== "string") return invalid();
  const requestCursor = parseProcessingCursor(requested.cursors[requested.index], requested.filter), nextCursor = parseProcessingCursor(page.nextCursor, requested.filter);
  for (let index = 0; index < items.length; index++) {
    const previous = index ? [items[index - 1].savedAt, items[index - 1].recordId] : requestCursor;
    if (previous && (items[index].savedAt > previous[0] || items[index].savedAt === previous[0] && items[index].recordId >= previous[1])) return invalid();
  }
  if (nextCursor && (items.length !== PROCESSING_PAGE_SIZE || nextCursor[0] !== items.at(-1)!.savedAt || nextCursor[1] !== items.at(-1)!.recordId)) return invalid();
  const runtime = object(page.runtime, ["enabled", "configured", "roles"]);
  if (typeof runtime.enabled !== "boolean" || typeof runtime.configured !== "boolean" || !Array.isArray(runtime.roles) || runtime.roles.length > 2) return invalid();
  const rolesSeen = new Set<string>();
  const roles: ProcessingRuntime["roles"] = runtime.roles.map((raw) => {
    const role = object(raw, ["role", "state", "retryAt"]);
    if (typeof role.role !== "string" || !["main_analyzer", "grounded_enricher"].includes(role.role) || rolesSeen.has(role.role) || !["unknown", "healthy", "throttled", "quota_exhausted", "circuit_open"].includes(String(role.state))) return invalid();
    rolesSeen.add(role.role);
    return { role: role.role as ProcessingRuntime["roles"][number]["role"], state: role.state as ProcessingRuntime["roles"][number]["state"], retryAt: nullableDate(role.retryAt) };
  });
  return { contract: PROCESSING_STATUS_CONTRACT, filter: requested.filter, items, counts: copiedCounts, nextCursor: page.nextCursor as string | null, checkedAt: date(page.checkedAt), runtime: { enabled: runtime.enabled, configured: runtime.configured, roles } };
}
function safeInitial(value: ProcessingStatusPage | null) { if (!value) return null; try { return readPage(value, first(value.filter)); } catch { return null; } }
function time(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); }

const runtimeLabels: Record<ProcessingRuntime["roles"][number]["state"], string> = {
  unknown: "실행 상태 미확인 · 정상 확인을 뜻하지 않습니다.", healthy: "호출 제한 없음 · 현재 실행 성공을 보장하지 않습니다.",
  throttled: "호출 간격 제한으로 대기 중입니다.", quota_exhausted: "사용량 한도로 대기 중입니다.", circuit_open: "연속 오류로 호출을 잠시 멈췄습니다.",
};
function RuntimeNotice({ runtime }: { runtime: ProcessingRuntime }) {
  return <section className="v2-processing-runtime" aria-label="분석 실행 조건"><h2>분석 실행 조건</h2>
    {!runtime.enabled ? <p>자동 분석이 꺼져 있습니다. 이미 저장한 원문은 그대로 보관됩니다.</p> : null}
    {!runtime.configured ? <p>AI 연결 설정이 준비되지 않았습니다. 이 화면에서 분석을 실행하지 않습니다.</p> : null}
    <dl>{(["main_analyzer", "grounded_enricher"] as const).map((role) => { const condition = runtime.roles.find((item) => item.role === role); return <div key={role}><dt>{role === "main_analyzer" ? "내 글·원문 분석" : "온라인 검색"}</dt><dd>{runtimeLabels[condition?.state ?? "unknown"]}{condition?.retryAt ? <small>다음 조건 확인 시각: {time(condition.retryAt)} (한국 시간). 실제 실행 시각은 보장되지 않습니다.</small> : null}</dd></div>; })}</dl>
  </section>;
}
function RecordStatus({ item }: { item: ProcessingStatusItem }) {
  return <li className="v2-processing-item"><header><div><Link href={`/v2/records/${encodeURIComponent(item.recordId)}`}>{item.title || "제목 없는 기록"}</Link><p><span className="v2-processing-saved">원문 저장 완료</span><time dateTime={item.savedAt}>{time(item.savedAt)} · 한국 시간</time></p></div><span className="v2-processing-badge" data-status={item.status}>{PROCESSING_LABELS[item.status]}</span></header>
    {item.partial ? <p className="v2-processing-note">일부 자료는 아직 분석하지 못했습니다. 분석 완료 표시는 모든 자료의 분석을 뜻하지 않습니다.</p> : null}
    {item.reviewPending ? <p className="v2-processing-note">AI 제안은 아직 확인하지 않았습니다.</p> : null}
    {item.status === "outdated" ? <p className="v2-processing-note">현재 원문과 이전 분석 결과가 다릅니다. 기록에서 내용을 확인해 주세요.</p> : null}
    {item.status === "needs_review" || item.status === "outdated" || item.reviewPending ? <p><Link href={`/v2/records/${encodeURIComponent(item.recordId)}`}>기록에서 확인하기</Link></p> : null}
    {item.stages.length ? <details><summary>단계별 작업 상태</summary><ul>{item.stages.map((stage) => <li key={`${stage.stage}:${stage.status}`}><strong>{PROCESSING_STAGE_LABELS[stage.stage]}</strong><span>{PROCESSING_LABELS[stage.status]} · 작업 {stage.count}개</span>{stage.nextAttemptAt ? <small>다음 재시도 조건 확인: {time(stage.nextAttemptAt)} (한국 시간). 실행 시각은 보장되지 않습니다.</small> : null}</li>)}</ul></details> : null}
  </li>;
}

export function ProcessingStatusView({ initialPage }: { initialPage: ProcessingStatusPage | null }) {
  const [page, setPage] = useState(() => safeInitial(initialPage)), [location, setLocation] = useState(() => first(initialPage?.filter ?? "all"));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const latest = useRef(location), currentPage = useRef(page), controller = useRef<AbortController | null>(null), epoch = useRef(0), mounted = useRef(false);
  const invalidate = useCallback(() => { ++epoch.current; controller.current?.abort(); }, []);
  const load = useCallback(async (next: Location) => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request; const ticket = ++epoch.current;
    latest.current = next; currentPage.current = null; setLocation(next); setPage(null); setError(null); setBusy(true);
    try {
      const params = new URLSearchParams({ filter: next.filter }); if (next.cursors[next.index]) params.set("cursor", next.cursors[next.index]!);
      const response = await fetch(`/api/v2/processing/status?${params}`, { cache: "no-store", credentials: "same-origin", signal: request.signal });
      if (!mounted.current || ticket !== epoch.current) return;
      if ([401, 403, 404, 423].includes(response.status)) { ++epoch.current; request.abort(); controller.current = null; latest.current = first(next.filter); setLocation(latest.current); setBusy(false); setError("권한을 다시 확인해야 합니다. 기록 제목과 상태를 닫았습니다."); return; }
      if (!response.ok) throw new Error("Status unavailable.");
      const json: unknown = await response.json(); if (!mounted.current || ticket !== epoch.current) return;
      const result = readPage(json, next); currentPage.current = result; setPage(result);
    } catch {
      if (mounted.current && ticket === epoch.current && !request.signal.aborted) setError("처리 상태를 확인하지 못했습니다. 원문 저장 여부가 바뀐 것은 아닙니다. 다시 확인해 주세요.");
    } finally { if (mounted.current && ticket === epoch.current) { setBusy(false); controller.current = null; } }
  }, []);
  useEffect(() => {
    mounted.current = true; if (!currentPage.current) void load(latest.current);
    return () => { mounted.current = false; invalidate(); };
  }, [load, invalidate]);
  function nextPage() { if (!page?.nextCursor) return; void load({ filter: location.filter, cursors: [...location.cursors.slice(0, location.index + 1), page.nextCursor], index: location.index + 1 }); }
  return <main className="v2-product-shell v2-processing-shell"><nav className="v2-product-nav" aria-label="처리 상태 상위 메뉴"><Link href="/v2/library">보관함으로</Link><Link href="/v2/review">확인할 내용</Link></nav>
    <section className="v2-product-card v2-processing-view" aria-labelledby="processing-title"><header className="v2-processing-heading"><div><p>보관함 · 보조 도구</p><h1 id="processing-title">처리 상태</h1></div><button onClick={() => void load(latest.current)} type="button">새로고침</button></header>
      <p className="v2-processing-intro">원문 저장과 AI 분석은 별개입니다. 이 화면은 저장된 기록의 상태만 조회하며 분석이나 재시도를 실행하지 않습니다.</p>
      <div className="v2-processing-filters" role="group" aria-label="처리 상태 필터">{PROCESSING_FILTERS.map((filter) => <button type="button" key={filter} aria-pressed={location.filter === filter} onClick={() => void load(first(filter))}>{PROCESSING_FILTER_LABELS[filter]}<span>{page ? page.counts[filter].toLocaleString("ko-KR") : "—"}</span></button>)}</div>
      <p className="v2-processing-result" role="status" aria-live="polite">{busy ? "처리 상태 확인 중…" : page ? `${PROCESSING_FILTER_LABELS[page.filter]} ${page.counts[page.filter].toLocaleString("ko-KR")}개 · ${location.index + 1}페이지 · ${page.items.length}개 표시` : "조회 결과 없음"}</p>
      {error ? <div role="alert" className="v2-processing-error"><p>{error}</p><button type="button" onClick={() => void load(latest.current)}>상태 다시 확인</button></div> : null}
      {page ? <><p className="v2-processing-checked">마지막 확인: <time dateTime={page.checkedAt}>{time(page.checkedAt)} · 한국 시간</time></p><RuntimeNotice runtime={page.runtime} />
        {page.items.length ? <ol className="v2-processing-list" aria-label="저장된 기록의 처리 상태">{page.items.map((item) => <RecordStatus item={item} key={item.recordId} />)}</ol> : <section className="v2-processing-empty"><h2>이 조건에 해당하는 기록이 없습니다</h2><p>다른 필터를 선택하거나 새로고침해 주세요.</p></section>}</> : null}
      <nav className="v2-processing-pagination" aria-label="처리 상태 페이지"><button type="button" disabled={location.index === 0} onClick={() => void load({ ...location, index: location.index - 1 })}>이전 페이지</button><span>{location.index + 1}페이지</span><button type="button" disabled={!page?.nextCursor} onClick={nextPage}>다음 페이지</button></nav>
    </section><V2MobileNavigation /></main>;
}
