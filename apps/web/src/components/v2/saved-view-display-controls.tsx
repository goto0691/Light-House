"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { SAVED_VIEW_BUILTIN_FIELDS } from "@/lib/v2/retrieval/saved-view-fields";
import { parseSavedViewFieldLookup } from "@/lib/v2/retrieval/saved-view-field-lookup";
import "@/app/v2/saved-view-display.css";

export const savedViewBuiltinFields = SAVED_VIEW_BUILTIN_FIELDS.map((field) => ({ key: field.fieldKey, label: field.label }));
export const defaultSavedViewDisplay: V2SavedViewDisplay = { layout: "list", density: "comfortable", groupBy: null, visibleFields: [] };
type Field = { key: string; label: string };
const validKey = /^[a-z][a-z0-9_.-]{0,99}$/;

export function SavedViewDisplayControls({ value, onChange, disabled = false, onAccessDenied }: { value: V2SavedViewDisplay; onChange: (value: V2SavedViewDisplay) => void; disabled?: boolean; onAccessDenied?: () => void }) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<Field[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [labelError, setLabelError] = useState("");
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [denied, setDenied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const lookupController = useRef<AbortController | null>(null), lookupEpoch = useRef(0);
  const accessClosed = useRef(false), deniedHandler = useRef(onAccessDenied);
  useEffect(() => { deniedHandler.current = onAccessDenied; }, [onAccessDenied]);
  useEffect(() => () => { controller.current?.abort(); lookupController.current?.abort(); epoch.current += 1; lookupEpoch.current += 1; }, []);
  const closeAccess = useCallback(() => {
    accessClosed.current = true; controller.current?.abort(); lookupController.current?.abort(); epoch.current += 1; lookupEpoch.current += 1;
    setDenied(true); setLabels(new Map()); setCatalog([]); setBusy(false); setError(""); setLabelError("");
    deniedHandler.current?.();
  }, []);
  // Stable selection identity: searching another catalog page must not erase selected labels.
  const lookupKeys = JSON.stringify(value.visibleFields.filter((key) => !savedViewBuiltinFields.some((field) => field.key === key)));
  useEffect(() => {
    const keys = JSON.parse(lookupKeys) as string[];
    if (!keys.length || accessClosed.current) return;
    const current = ++lookupEpoch.current, request = new AbortController();
    lookupController.current?.abort(); lookupController.current = request;
    async function load() {
      try {
        const params = new URLSearchParams(keys.map((key) => ["key", key]));
        const response = await fetch(`/api/v2/saved-view-fields?${params}`, { cache: "no-store", signal: request.signal });
        if (current !== lookupEpoch.current || request.signal.aborted || accessClosed.current) return;
        if ([401, 403, 404, 423].includes(response.status)) { closeAccess(); return; }
        const body: unknown = await response.json();
        if (current !== lookupEpoch.current || request.signal.aborted || accessClosed.current) return;
        if (!response.ok) throw new Error("lookup_failed");
        const fields = parseSavedViewFieldLookup(body, keys);
        setLabels((previous) => {
          const next = new Map(previous);
          keys.forEach((key) => next.delete(key)); fields.forEach((field) => next.set(field.key, field.label));
          return next;
        });
        setLabelError("");
      } catch {
        if (current === lookupEpoch.current && !request.signal.aborted && !accessClosed.current)
          setLabelError("선택한 필드 이름을 확인하지 못했습니다. 키와 순서는 유지됩니다.");
      }
    }
    void load();
    return () => { request.abort(); lookupEpoch.current += 1; };
  }, [lookupKeys, lookupAttempt, closeAccess]);
  const known = new Map<string, string>([...savedViewBuiltinFields.map((field) => [field.key, field.label] as const), ...labels]);
  function toggle(key: string) {
    if (disabled || accessClosed.current) return;
    const fields = value.visibleFields.includes(key) ? value.visibleFields.filter((field) => field !== key) : [...value.visibleFields, key];
    if (fields.length <= 8) onChange({ ...value, visibleFields: fields });
  }
  function move(index: number, direction: number) {
    const target = index + direction;
    if (disabled || accessClosed.current || target < 0 || target >= value.visibleFields.length) return;
    const fields = [...value.visibleFields]; [fields[index], fields[target]] = [fields[target], fields[index]];
    onChange({ ...value, visibleFields: fields });
  }
  async function search(more: boolean) {
    if (disabled || busy || accessClosed.current) return;
    const current = ++epoch.current, nextPage = more ? page + 1 : 1, q = more ? catalogQuery : query.trim();
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v2/saved-view-fields?${new URLSearchParams({ q, page: String(nextPage) })}`, { cache: "no-store", signal: request.signal });
      if (current !== epoch.current || request.signal.aborted || accessClosed.current) return;
      if ([401, 403, 404, 423].includes(response.status)) { closeAccess(); return; }
      const body = await response.json() as { fields?: Field[]; page?: number; pageSize?: number; totalPages?: number; totalCount?: number };
      if (current !== epoch.current || request.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.fields) || body.fields.length > 20 || body.fields.some((field) => !field || typeof field.key !== "string" || !validKey.test(field.key) || typeof field.label !== "string")
        || new Set(body.fields.map((field) => field.key)).size !== body.fields.length
        || body.page !== nextPage || body.pageSize !== 20 || !Number.isSafeInteger(body.totalPages) || !Number.isSafeInteger(body.totalCount) || Number(body.totalCount) < 0
        || body.totalPages !== Math.max(1, Math.ceil(Number(body.totalCount) / 20))) throw new Error("표시 필드를 불러오지 못했습니다. 선택한 필드는 유지됩니다.");
      setCatalog((previous) => [...new Map([...(more ? previous : []), ...body.fields!].map((field) => [field.key, field])).values()]);
      setLabels((previous) => new Map([...previous, ...body.fields!.map((field) => [field.key, field.label] as const)]));
      setCatalogQuery(q); setPage(nextPage); setTotalPages(body.totalPages!); setTotal(body.totalCount!);
    } catch (caught) { if (current === epoch.current && !request.signal.aborted) setError(caught instanceof Error ? caught.message : "표시 필드를 불러오지 못했습니다."); }
    finally { if (current === epoch.current && !request.signal.aborted) setBusy(false); }
  }
  if (denied) return <p role="alert">필드 목록을 읽을 권한을 다시 확인해 주세요.</p>;
  return <fieldset className="v2-view-display-controls" disabled={disabled}><legend>표시 방식</legend>
    <div className="v2-view-display-options"><label>레이아웃<select value={value.layout} onChange={(event) => onChange({ ...value, layout: event.target.value as V2SavedViewDisplay["layout"] })}><option value="list">목록</option><option value="cards">카드</option><option value="timeline">타임라인</option><option value="table">표</option></select></label>
      <label>화면 밀도<select value={value.density} onChange={(event) => onChange({ ...value, density: event.target.value as V2SavedViewDisplay["density"] })}><option value="comfortable">여유 있게</option><option value="compact">촘촘하게</option></select></label>
      <label>묶어 보기<select value={value.groupBy ?? ""} onChange={(event) => onChange({ ...value, groupBy: (event.target.value || null) as V2SavedViewDisplay["groupBy"] })}><option value="">묶지 않음</option><option value="type">분류별</option><option value="captured_month">보관 월별</option><option value="written_month">작성 월별</option></select></label></div>
    <p>묶음은 현재 페이지 안에서만 표시합니다. 검색 조건·정렬·페이지에 포함된 기록은 바꾸지 않습니다.</p>
    <fieldset><legend>표시 필드 · 최대 8개 ({value.visibleFields.length}/8)</legend>
      <div className="v2-view-field-choices">{savedViewBuiltinFields.map((field) => <label key={field.key}><input type="checkbox" checked={value.visibleFields.includes(field.key)} disabled={!value.visibleFields.includes(field.key) && value.visibleFields.length >= 8} onChange={() => toggle(field.key)} />{field.label}</label>)}</div>
      {value.visibleFields.length ? <ul className="v2-view-selected-fields" aria-label="선택한 표시 필드">{value.visibleFields.map((key, index) => <li key={key}><span>{known.get(key) ?? `${key} · 기존 필드`}</span><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${known.get(key) ?? key} 위로 이동`}>↑</button><button type="button" disabled={index === value.visibleFields.length - 1} onClick={() => move(index, 1)} aria-label={`${known.get(key) ?? key} 아래로 이동`}>↓</button><button type="button" onClick={() => toggle(key)} aria-label={`${known.get(key) ?? key} 표시에서 제거`}>제거</button></li>)}</ul> : <p>기록 제목과 검색 근거는 항상 표시합니다. 추가 표시 필드를 선택할 수 있습니다.</p>}
      <div className="v2-view-field-search"><label>추가 필드 검색<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} /></label><button type="button" disabled={busy} onClick={() => void search(false)}>필드 검색</button></div>
      {page ? <p role="status">필드 {total}개 중 {catalog.length}개 표시</p> : null}
      <div className="v2-view-field-choices">{catalog.filter((field) => !savedViewBuiltinFields.some((builtin) => builtin.key === field.key)).map((field) => <label key={field.key}><input type="checkbox" checked={value.visibleFields.includes(field.key)} disabled={!value.visibleFields.includes(field.key) && value.visibleFields.length >= 8} onChange={() => toggle(field.key)} />{field.label}</label>)}</div>
      {page > 0 && page < totalPages ? <button type="button" disabled={busy} onClick={() => void search(true)}>표시 필드 더 보기</button> : null}
      {error ? <p role="alert">{error}</p> : null}
      {labelError ? <div><p role="alert">{labelError}</p><button type="button" onClick={() => setLookupAttempt((attempt) => attempt + 1)}>선택한 필드 이름 다시 불러오기</button></div> : null}
    </fieldset>
  </fieldset>;
}
