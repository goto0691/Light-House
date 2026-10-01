"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseFacetRequest, validateFacetPage, type FacetItem, type FacetPage } from "@/lib/v2/retrieval/facet-page";
import "./facet-discovery.css";

export function SearchTypeSelector({ initialPage, selectedKey = "" }: { initialPage: FacetPage; selectedKey?: string }) {
  const [selected, setSelected] = useState(selectedKey), [selectedItem, setSelectedItem] = useState<FacetItem | null>(initialPage.selected);
  const [catalog, setCatalog] = useState(initialPage), [query, setQuery] = useState(initialPage.query), [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState("");
  const epoch = useRef(0), controller = useRef<AbortController | null>(null), closed = useRef(false), trigger = useRef<HTMLButtonElement>(null), panelId = useId();
  useEffect(() => () => { controller.current?.abort(); epoch.current += 1; }, []);
  function dismiss() { setOpen(false); trigger.current?.focus(); }
  function choose(item: FacetItem | null) {
    if (closed.current) return;
    controller.current?.abort(); epoch.current += 1; setBusy(false); setError(""); setSelected(item?.key ?? ""); setSelectedItem(item); dismiss();
  }
  async function load(page: number, nextQuery: string) {
    if (closed.current || busy) return;
    const current = ++epoch.current, request = new AbortController(); controller.current?.abort(); controller.current = request; setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ kind: "type", q: nextQuery, page: String(page), ...(selected ? { selected } : {}) });
      const expected = parseFacetRequest(params);
      const response = await fetch(`/api/v2/explore-facets?${params}`, { cache: "no-store", signal: request.signal });
      if (current !== epoch.current || request.signal.aborted || closed.current) return;
      if ([401, 403, 404, 423].includes(response.status)) {
        closed.current = true; controller.current?.abort(); epoch.current += 1; setBusy(false); setDenied(true); setOpen(false); setSelectedItem(null); setError(""); return;
      }
      const body: unknown = await response.json();
      if (current !== epoch.current || request.signal.aborted || closed.current) return;
      if (!response.ok) throw new Error("분류 목록을 불러오지 못했습니다. 선택한 분류는 유지됩니다.");
      const next = validateFacetPage(body, expected); setCatalog(next); setSelectedItem(next.selected);
    } catch { if (current === epoch.current && !request.signal.aborted && !closed.current) setError("같은 조건의 분류 목록을 확인하지 못했습니다. 선택은 유지되며 다시 시도할 수 있습니다."); }
    finally { if (current === epoch.current && !request.signal.aborted && !closed.current) setBusy(false); }
  }
  return <fieldset className="v2-type-selector"><legend>분류</legend><input type="hidden" name="type" value={selected} />
    {denied ? <p role="alert">분류 정보를 읽을 권한을 다시 확인해 주세요. 선택 키는 유지됩니다{selected ? `: ${selected}` : "."}</p> : <>
      <button ref={trigger} type="button" aria-controls={panelId} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{selected ? selectedItem?.label ?? `${selected} · 현재 이름 확인 불가` : "모든 분류"}<span aria-hidden="true"> ▾</span></button>
      {open ? <div id={panelId} className="v2-type-selector-panel" role="region" aria-label="분류 선택" onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
        <p>선택만으로 기록 검색을 실행하지 않습니다. 조건을 정한 뒤 검색 버튼을 누르세요.</p>
        <label>분류 이름 검색<input type="search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!event.nativeEvent.isComposing) void load(1, query); } }} /></label>
        <button type="button" disabled={busy} onClick={() => void load(1, query)}>분류 목록 검색</button>
        <button type="button" onClick={() => choose(null)}>모든 분류 선택</button>
        <p role="status">{busy ? "분류 확인 중…" : `${catalog.totalCount}개 분류 · ${catalog.page}/${catalog.totalPages}페이지 · ${catalog.items.length}개 표시`}</p>
        {catalog.items.length ? <ul>{catalog.items.map((item) => <li key={item.key}><button type="button" aria-pressed={selected === item.key} onClick={() => choose(item)}>{item.label}{" "}<small>{item.count}개 기록</small></button></li>)}</ul> : <p>현재 조건에 맞는 분류가 없습니다.</p>}
        <nav aria-label="분류 선택 페이지"><button type="button" disabled={busy || catalog.page <= 1} onClick={() => void load(catalog.page - 1, catalog.query)}>이전 분류</button><button type="button" disabled={busy || catalog.page >= catalog.totalPages} onClick={() => void load(catalog.page + 1, catalog.query)}>다음 분류</button></nav>
        {error ? <p role="alert">{error}</p> : null}
      </div> : null}
    </>}
  </fieldset>;
}
