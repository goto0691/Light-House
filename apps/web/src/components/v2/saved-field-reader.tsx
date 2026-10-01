"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { V2SavedViewFieldValue } from "@/lib/v2/retrieval/saved-view-fields";
import { SAVED_FIELD_PAGE_CONTRACT, SAVED_FIELD_PAGE_UNITS as PAGE_UNITS, SAVED_FIELD_MAX_STORED_BYTES as MAX_STORED_BYTES, type SavedFieldPage as FieldPage } from "@/lib/v2/retrieval/saved-field-page";
import "./saved-field-reader.css";

type Props = Readonly<{ recordId: string; fieldKey: string; label: string; value: V2SavedViewFieldValue; onAccessDenied: () => void }>;
const responseKeys = ["contract", "recordId", "propertyId", "fieldKey", "privacyLevel", "revision", "renderer", "sourceLabel", "lockedByUser", "unit", "totalUtf16", "offset", "end", "nextOffset", "text", "totalStoredBytes"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const invalid = () => new Error("같은 필드의 완전한 응답인지 확인하지 못했습니다. 내용을 적용하지 않았습니다.");

/** Enforce a byte ceiling before JSON parsing, including chunked HTTP responses. */
async function boundedJson(response: Response, full: boolean): Promise<unknown> {
  const limit = full ? 5 * 1024 * 1024 : 32 * 1024;
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw invalid(); }
  if (!response.body) throw invalid();
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw invalid(); }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(result + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}

function readPage(body: unknown, props: Props, offset: number, previous: FieldPage | null, full: boolean): FieldPage {
  if (!object(body) || Object.keys(body).length !== responseKeys.length || responseKeys.some((key) => !Object.hasOwn(body, key))
    || body.contract !== SAVED_FIELD_PAGE_CONTRACT || body.recordId !== props.recordId || body.propertyId !== props.value.propertyId
    || body.fieldKey !== props.fieldKey || body.privacyLevel !== "normal" || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)
    || !["text", "number", "boolean", "date", "rating", "json"].includes(String(body.renderer))
    || typeof body.sourceLabel !== "string" || !body.sourceLabel.length || typeof body.lockedByUser !== "boolean"
    || !(body.unit === null || typeof body.unit === "string") || !integer(body.totalStoredBytes) || body.totalStoredBytes > MAX_STORED_BYTES || body.totalStoredBytes < 1
    || !integer(body.totalUtf16) || body.totalUtf16 > MAX_STORED_BYTES || !integer(body.offset) || body.offset !== offset
    || !integer(body.end) || body.end < offset || body.end > body.totalUtf16 || typeof body.text !== "string" || body.text.length !== body.end - offset
    || (body.nextOffset !== null && !integer(body.nextOffset)) || body.nextOffset !== (body.end === body.totalUtf16 ? null : body.end)
    || (body.totalUtf16 > offset && body.end === offset)
    || (!full && (body.text.length > PAGE_UNITS || body.end < body.totalUtf16 && body.text.length < PAGE_UNITS - 1))
    || (full && (offset !== 0 || body.end !== body.totalUtf16 || body.nextOffset !== null))) throw invalid();
  if (previous && (body.revision !== previous.revision || body.totalUtf16 !== previous.totalUtf16 || body.totalStoredBytes !== previous.totalStoredBytes
    || body.renderer !== previous.renderer || body.sourceLabel !== previous.sourceLabel || body.lockedByUser !== previous.lockedByUser || body.unit !== previous.unit)) throw invalid();
  return body as FieldPage;
}

/** A changed record/property/preview unmounts all prior text and invalidates pending requests. */
export function SavedFieldReader(props: Props) {
  if (!props.value.preview || !props.value.propertyId) return null;
  return <FieldReaderSession key={JSON.stringify([props.recordId, props.fieldKey, props.label, props.value])} {...props} />;
}

function FieldReaderSession(props: Props) {
  const { recordId, fieldKey, label, value, onAccessDenied } = props;
  const regionId = useId(), textId = useId(), trigger = useRef<HTMLButtonElement>(null), textArea = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(false), [page, setPage] = useState<FieldPage | null>(null), [history, setHistory] = useState<number[]>([0]), [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false), [previewInvalidated, setPreviewInvalidated] = useState(false), [previewSuperseded, setPreviewSuperseded] = useState(false), [limitExceeded, setLimitExceeded] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const active = useRef(true), epoch = useRef(0), controller = useRef<AbortController | null>(null), busyRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  function cancel() { epoch.current++; controller.current?.abort(); controller.current = null; busyRef.current = false; setBusy(false); }
  function close() { cancel(); setOpen(false); setPage(null); setHistory([0]); setPosition(0); setError(""); setMessage(""); trigger.current?.focus(); }
  function deny() { cancel(); setPage(null); setDenied(true); setOpen(false); setError(""); setMessage(""); onAccessDenied(); }
  async function load(offset: number, previous: FieldPage | null, purpose: "open" | "next" | "previous" | "copy-page" | "copy-full") {
    if (busyRef.current || denied || !value.propertyId) return;
    const current = new AbortController(), token = ++epoch.current, full = purpose === "copy-full";
    controller.current = current; busyRef.current = true; setBusy(true); setError(""); setMessage("");
    const stillCurrent = () => active.current && epoch.current === token && !current.signal.aborted;
    try {
      const query = new URLSearchParams({ fieldKey, offset: String(offset) });
      if (previous) query.set("revision", previous.revision);
      if (full) query.set("format", "full");
      const response = await fetch(`/api/v2/records/${encodeURIComponent(recordId)}/display-fields/${encodeURIComponent(value.propertyId)}?${query}`, { cache: "no-store", signal: current.signal });
      if (!stillCurrent()) return;
      if ([401, 403, 404, 423].includes(response.status)) { await response.body?.cancel(); if (stillCurrent()) deny(); return; }
      if (response.status === 409) {
        await response.body?.cancel(); if (!stillCurrent()) return;
        setPage(null); setPreviewInvalidated(true); setLimitExceeded(false); setHistory([0]); setPosition(0); setError("필드가 바뀌었습니다. 이전 값과 미리보기를 숨겼습니다. 현재 값을 처음부터 다시 확인해 주세요."); return;
      }
      if (response.status === 413) {
        await response.body?.cancel(); if (!stillCurrent()) return;
        setPage(null); setLimitExceeded(true); setHistory([0]); setPosition(0);
        setError(`저장된 필드가 단일 읽기 한도(${MAX_STORED_BYTES / (1024 * 1024)} MiB)를 초과해 열 수 없습니다. 원값은 그대로 보존됩니다. 한도 안의 현재 값이 준비되면 처음부터 다시 확인해 주세요.`); return;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error("필드를 불러오지 못했습니다. 원본을 변경하지 않았습니다."); }
      const body = await boundedJson(response, full);
      if (!stillCurrent()) return;
      if (!object(body) || body.recordId !== recordId || body.privacyLevel !== "normal") { deny(); return; }
      const incoming = readPage(body, props, offset, previous, full);
      if (purpose === "copy-page" || full) {
        if (!full && (!previous || incoming.text !== previous.text || incoming.end !== previous.end || incoming.nextOffset !== previous.nextOffset)) throw invalid();
        if (!stillCurrent()) return;
        if (!navigator.clipboard?.writeText) throw new Error("이 브라우저에서는 복사할 수 없습니다. 표시된 구간을 직접 선택해 주세요.");
        await navigator.clipboard.writeText(incoming.text);
        if (stillCurrent()) setMessage(full ? "전체 값을 복사했습니다." : "현재 구간을 복사했습니다.");
        return;
      }
      setPage(incoming); setPreviewSuperseded(true); setLimitExceeded(false);
      if (purpose === "next") { setHistory((items) => [...items.slice(0, position + 1), offset]); setPosition(position + 1); }
      else if (purpose === "previous") setPosition(position - 1);
      else { setHistory([0]); setPosition(0); }
      requestAnimationFrame(() => { if (stillCurrent()) { textArea.current?.scrollTo(0, 0); textArea.current?.focus(); } });
    } catch (caught) {
      if (stillCurrent()) setError(caught instanceof Error ? caught.message : "필드 응답을 확인하지 못했습니다.");
    } finally { if (stillCurrent()) { busyRef.current = false; controller.current = null; setBusy(false); } }
  }
  function begin() { setOpen(true); void load(0, null, "open"); }
  if (denied) return <p role="alert">기록 접근을 다시 확인해 주세요.</p>;
  return <div className="v2-saved-field-reader">
    {!previewInvalidated && !previewSuperseded && !limitExceeded ? <div className="v2-saved-field-preview"><span>일부 미리보기 · 저장 JSON의 앞부분 · 전체 {value.preview?.totalBytes.toLocaleString("ko-KR")}바이트</span><pre>{String(value.value)}</pre><small>{value.sourceLabel}{value.lockedByUser ? " · 사용자 잠금" : ""}</small></div> : <p className="v2-saved-field-notice">{limitExceeded ? "읽기 한도 초과로 이전 내용과 미리보기를 숨겼습니다." : previewInvalidated ? "변경된 필드의 이전 미리보기를 숨겼습니다." : "현재 값을 확인하여 목록 조회 당시 미리보기를 숨겼습니다."}</p>}
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={regionId} onClick={open ? close : begin}>{open ? "전체 값 접기" : "전체 값 열기"}</button>
    {open ? <section id={regionId} role="region" aria-label={`${label} 전체 값 읽기`} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(); } }}>
      <h3>{label} · 전체 값 읽기</h3>
      <p className="v2-saved-field-notice">열 때 다시 확인한 현재 확정값입니다. 원본을 변경하지 않고 최대 {PAGE_UNITS.toLocaleString("ko-KR")} UTF-16 단위씩 읽습니다. 이모지는 2단위일 수 있습니다. 복사할 때 현재 권한과 같은 버전을 다시 확인합니다.</p>
      {page ? <><p id={textId} className="v2-saved-field-range">{page.totalUtf16 ? `${page.offset + 1}–${page.end}` : "0"} / {page.totalUtf16.toLocaleString("ko-KR")} UTF-16 단위 · {page.renderer === "json" ? "저장 JSON 그대로" : "저장된 값"}</p><pre ref={textArea} className="v2-saved-field-text" role="region" aria-label={`${label} 현재 구간`} aria-describedby={textId} tabIndex={0}>{page.text}</pre><p className="v2-saved-field-notice">{page.sourceLabel}{page.lockedByUser ? " · 사용자 잠금" : ""}{page.unit ? ` · 단위: ${page.unit}` : ""}</p>
        <nav aria-label="필드 구간 이동"><button type="button" disabled={busy || position === 0} onClick={() => void load(history[position - 1], page, "previous")}>이전 구간</button><button type="button" disabled={busy || page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) void load(page.nextOffset, page, "next"); }}>다음 구간</button></nav>
        <div className="v2-saved-field-copy"><button type="button" disabled={busy} onClick={() => void load(page.offset, page, "copy-page")}>현재 구간 복사</button><button type="button" disabled={busy} onClick={() => void load(0, page, "copy-full")}>전체 값 복사</button></div></> : !busy ? <button type="button" onClick={() => void load(0, null, "open")}>현재 값 처음부터 확인</button> : null}
      {busy ? <div className="v2-saved-field-pending"><span role="status">현재 값 확인 중…</span><button type="button" onClick={() => { cancel(); setMessage("불러오기를 취소했습니다."); }}>불러오기 취소</button></div> : null}
      {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    </section> : null}
  </div>;
}
