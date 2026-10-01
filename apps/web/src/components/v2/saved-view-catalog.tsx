"use client";

import { Bookmark, ChevronLeft, ChevronRight, Pin, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { captureSavedViewCatalogRequest, parseSavedViewCatalogRequest, savedViewCatalogParams, validateSavedViewCatalogPage, type SavedViewCatalogPage, type SavedViewCatalogRequest } from "@/lib/v2/retrieval/saved-view-catalog";
import { SemanticIcon } from "./semantic-icon";
import "./saved-view-catalog.css";

type HistoryMode = "push" | "replace";
function requestFromPage(page: SavedViewCatalogPage): SavedViewCatalogRequest { return { query: page.query, page: page.page, pinnedOnly: page.pinnedOnly }; }
function currentRequest() {
  const actual = new URLSearchParams(location.search), params = new URLSearchParams();
  for (const key of ["q", "page", "pinned"]) for (const value of actual.getAll(key)) params.append(key, value);
  return parseSavedViewCatalogRequest(params);
}
function writeHistory(request: SavedViewCatalogRequest, mode: HistoryMode) {
  // The mobile More sheet owns a temporary history entry. Do not stack a catalog
  // entry carrying its marker: closing the sheet must still pop exactly once.
  if (history.state?.lightHouseMore) return false;
  const url = new URL(location.href);
  for (const key of ["q", "page", "pinned"]) url.searchParams.delete(key);
  for (const [key, value] of savedViewCatalogParams(request)) url.searchParams.set(key, value);
  if (url.href === location.href) return true;
  if (mode === "push") history.pushState(history.state, "", url); else history.replaceState(history.state, "", url);
  return true;
}

/** Catalog metadata only. A saved view's record query is loaded only when its link is opened. */
export function SavedViewCatalog({ initialPage }: { initialPage: SavedViewCatalogPage }) {
  const id = useId(), [page, setPage] = useState<SavedViewCatalogPage | null>(initialPage);
  const [query, setQuery] = useState(initialPage.query), [pinnedOnly, setPinnedOnly] = useState(initialPage.pinnedOnly);
  const [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState<string | null>(null), [retryable, setRetryable] = useState(false);
  const epoch = useRef(0), controller = useRef<AbortController | null>(null), closed = useRef(false), draftRevision = useRef(0);
  const retry = useRef<{ request: SavedViewCatalogRequest; mode: HistoryMode } | null>(null);
  const pendingHistory = useRef<{ request: SavedViewCatalogRequest; mode: HistoryMode } | null>(null);
  const current = useRef(initialPage), heading = useRef<HTMLHeadingElement>(null);
  const cancel = useCallback(() => { ++epoch.current; controller.current?.abort(); controller.current = null; }, []);
  const load = useCallback(async (candidate: SavedViewCatalogRequest, mode: HistoryMode, focus = false) => {
    if (closed.current) return;
    let request: SavedViewCatalogRequest;
    try { request = captureSavedViewCatalogRequest(candidate); }
    catch { cancel(); retry.current = null; setRetryable(false); setBusy(false); setError("목록 검색 조건을 확인해 주세요."); return; }
    const requestEpoch = ++epoch.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const isCurrent = () => !closed.current && requestEpoch === epoch.current && !abort.signal.aborted;
    const inputRevision = draftRevision.current;
    retry.current = { request, mode }; setRetryable(false); setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v2/saved-views?${savedViewCatalogParams(request)}`, { cache: "no-store", signal: abort.signal });
      if (!isCurrent()) return;
      if ([401, 403, 404, 423].includes(response.status)) {
        closed.current = true; ++epoch.current; abort.abort(); retry.current = null; pendingHistory.current = null;
        setPage(null); setQuery(""); setPinnedOnly(false); setError(null); setDenied(true); setBusy(false); return;
      }
      if (!response.ok) throw new Error("catalog_failed");
      const body: unknown = await response.json();
      if (!isCurrent()) return;
      const result = validateSavedViewCatalogPage(body, request);
      current.current = result; setPage(result);
      if (inputRevision === draftRevision.current) { setQuery(result.query); setPinnedOnly(result.pinnedOnly); }
      retry.current = null;
      const historyRequest = requestFromPage(result);
      pendingHistory.current = writeHistory(historyRequest, mode) ? null : { request: historyRequest, mode };
      if (focus) heading.current?.focus();
    } catch {
      if (isCurrent()) { setRetryable(true); setError("목록을 불러오지 못했습니다. 입력한 조건은 유지됩니다. 다시 시도해 주세요."); }
    } finally { if (isCurrent()) { controller.current = null; setBusy(false); } }
  }, [cancel]);
  useEffect(() => {
    writeHistory(requestFromPage(initialPage), "replace");
    function back() {
      if (closed.current) return;
      if (history.state?.lightHouseMore) return;
      if (pendingHistory.current) {
        const pending = pendingHistory.current; pendingHistory.current = null; writeHistory(pending.request, pending.mode); return;
      }
      try {
        const request = currentRequest();
        if (request.query === current.current.query && request.page === current.current.page && request.pinnedOnly === current.current.pinnedOnly && !controller.current) return;
        ++draftRevision.current; setQuery(request.query); setPinnedOnly(request.pinnedOnly); void load(request, "replace");
      } catch { cancel(); setBusy(false); retry.current = null; setRetryable(false); setError("주소의 목록 검색 조건을 확인해 주세요."); }
    }
    window.addEventListener("popstate", back);
    return () => { window.removeEventListener("popstate", back); cancel(); };
  }, [initialPage, load, cancel]);
  function submit(event: FormEvent) { event.preventDefault(); void load({ query, pinnedOnly, page: 1 }, "push"); }
  return <section className="v2-product-card v2-saved-catalog" aria-labelledby={`${id}-title`}>
    <header><p>검색 조건을 다시 쓰지 않아도 됩니다</p><h1 id={`${id}-title`} ref={heading} tabIndex={-1}>내 목록</h1><p>목록 이름으로 찾고, 저장한 조건을 열어 기록을 다시 살펴보세요.</p></header>
    {denied ? <div role="alert" className="v2-saved-catalog-denied"><h2>목록 접근이 종료되었습니다.</h2><p>계정과 접근 권한을 확인한 뒤 이 화면을 다시 열어 주세요.</p><Link href="/v2/library">보관함으로</Link></div> : <>
      <form onSubmit={submit} role="search" aria-label="내 목록 이름 검색" className="v2-saved-catalog-form">
        <label htmlFor={`${id}-query`}>목록 이름</label><div className="v2-saved-catalog-search"><input id={`${id}-query`} name="q" type="search" maxLength={100} value={query} placeholder="예: 다시 보고 싶은 영화" onChange={(event) => { ++draftRevision.current; setQuery(event.target.value); }} /><button type="submit"><Search aria-hidden="true" size={16} /> 찾기</button></div>
        <label className="v2-saved-catalog-pinned"><input type="checkbox" checked={pinnedOnly} onChange={(event) => { ++draftRevision.current; setPinnedOnly(event.target.checked); }} /> 고정한 목록만</label>
      </form>
      {error ? <div role="alert" className="v2-saved-catalog-error"><p>{error}</p>{retryable ? <button type="button" disabled={busy} onClick={() => { if (retry.current) void load(retry.current.request, retry.current.mode); }}>다시 시도</button> : null}</div> : null}
      {page ? <>
        <p role="status" aria-live="polite" className="v2-saved-catalog-status">{busy ? "목록을 불러오는 중입니다. 아래는 이전 결과입니다." : error ? "아래는 마지막으로 확인한 목록입니다." : `${page.query ? `“${page.query}” 이름 검색 · ` : ""}${page.pinnedOnly ? "고정한 목록 · " : ""}전체 ${page.totalCount}개 · ${page.page} / ${page.totalPages}페이지`}</p>
        <div aria-busy={busy} className="v2-saved-catalog-results">
          {page.views.length ? <ul className="v2-saved-catalog-grid">{page.views.map((view) => <li key={view.id}><Link href={`/v2/library/views/${encodeURIComponent(view.id)}`} prefetch={false}><span className="v2-saved-catalog-icon"><SemanticIcon context="saved_view" iconKey={view.iconKey} size={20} /></span><div><h2>{view.name || "이름 없는 목록"}</h2><p>{view.description || "저장한 검색 조건으로 기록을 다시 살펴보세요."}</p><small>{view.pinned ? <><Pin aria-hidden="true" size={11} /> 메뉴에 고정됨</> : "필요할 때 열기"}</small></div></Link></li>)}</ul>
            : <div className="v2-saved-catalog-empty"><Bookmark aria-hidden="true" size={30} /><h2>{page.query || page.pinnedOnly ? "조건에 맞는 목록이 없습니다." : "저장한 목록이 없습니다."}</h2><p>{page.query || page.pinnedOnly ? "다른 이름으로 찾거나 전체 목록을 확인해 보세요." : "검색 결과에서 현재 조건을 내 목록으로 저장할 수 있습니다."}</p>{page.query || page.pinnedOnly ? <button type="button" onClick={() => { setQuery(""); setPinnedOnly(false); void load({ query: "", pinnedOnly: false, page: 1 }, "push"); }}>전체 목록 보기</button> : <Link href="/v2/search">검색하러 가기</Link>}</div>}
        </div>
        <nav aria-label="내 목록 페이지" className="v2-saved-catalog-pagination"><button type="button" disabled={busy || page.page <= 1} onClick={() => void load({ ...requestFromPage(page), page: page.page - 1 }, "push", true)}><ChevronLeft aria-hidden="true" size={16} /> 이전</button><span>{page.page} / {page.totalPages}</span><button type="button" disabled={busy || page.page >= page.totalPages} onClick={() => void load({ ...requestFromPage(page), page: page.page + 1 }, "push", true)}>다음 <ChevronRight aria-hidden="true" size={16} /></button></nav>
      </> : null}
    </>}
  </section>;
}
