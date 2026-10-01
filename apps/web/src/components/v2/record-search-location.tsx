"use client";

import { Copy, ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { onLinkDraftAccessRevoked, revokeLinkDraftAccess } from "@/lib/v2/editor/link-draft-access";
import { assertRecordLocationText, parseRecordLocation, RECORD_LOCATION_RESULT_CONTRACT, serializeRecordLocation, type V2RecordLocationResult, type V2RecordLocationV1 } from "@/lib/v2/retrieval/record-location-v1";
import "@/app/v2/search-location.css";

type Props = { ownerId: string; recordId: string; location: V2RecordLocationV1 | null; invalid?: boolean };
type ReadState = { key: string; result: V2RecordLocationResult | null; error: string; denied: boolean };
const origins = ["document_title", "document_body", "user_note", "external_source", "source", "manual_extract", "ai_extract", "ai_interpretation", "curation"];
const noReplacement = "다른 버전이나 최신 자료로 바꾸지 않았습니다.";
const deniedMessage = `이 보관 위치를 읽을 권한을 다시 확인해야 합니다. ${noReplacement}`;
const invalidMessage = `검색한 보관 위치를 확인할 수 없습니다. ${noReplacement}`;
const warningLabels: Readonly<Record<string, string>> = { unknown_total_parts: "전체 조각 수 미상", unknown_part_numbers: "조각 번호 미상", missing_parts: "누락된 조각 있음", conflicting_part_claims: "조각 번호 정보가 서로 다름", partial_source: "일부 원문만 보관됨", truncated_source: "잘린 원문", ocr_unverified: "OCR 미확인", selection_unverified: "선택 범위 미확인", unknown_source_completeness: "원문 전체 범위 미확인", duplicate_text_preserved: "같은 문구도 각각 보존됨", alternative_selection_required: "대안 중 사용할 조각을 먼저 선택해야 함", order_unconfirmed: "순서 미확인", relationship_unconfirmed: "조각 관계 미확인", rejected: "거절된 제안", superseded: "다른 조각으로 대체됨" };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stringOrNull = (value: unknown) => value === null || typeof value === "string";
const sameRange = (left: unknown, right: V2RecordLocationV1["range"]) => right === null ? left === null : object(left) && left.start === right.start && left.end === right.end && Object.keys(left).length === 2;

/** A successful HTTP response is not enough: keep the requested immutable identity. */
function readResult(value: unknown, recordId: string, requested: V2RecordLocationV1): V2RecordLocationResult {
  if (!object(value) || value.contract !== RECORD_LOCATION_RESULT_CONTRACT || value.recordId !== recordId
    || serializeRecordLocation(parseRecordLocation(value.location)) !== serializeRecordLocation(requested)
    || typeof value.text !== "string" || value.textHash !== requested.textHash || !sameRange(value.range, requested.range)
    || !origins.includes(String(value.origin)) || typeof value.label !== "string" || !stringOrNull(value.reviewStatus)
    || typeof value.isHistorical !== "boolean" || !["normal", "sensitive", "restricted"].includes(String(value.privacyLevel))) throw new Error(invalidMessage);
  assertRecordLocationText(requested, value.text);
  const context = value.context;
  if (!object(context) || ![context.documentRevisionId, context.snapshotId, context.runId, context.groupKey, context.curationRevisionId].every(stringOrNull)
    || !(context.snapshotVersion === null || Number.isSafeInteger(context.snapshotVersion) && Number(context.snapshotVersion) >= 1)) throw new Error(invalidMessage);
  if ((requested.kind === "document_title" || requested.kind === "document_body")
    && (context.documentRevisionId !== requested.revisionId || value.origin !== requested.kind)) throw new Error(invalidMessage);
  if ("snapshotId" in requested && context.snapshotId !== requested.snapshotId) throw new Error(invalidMessage);
  if (requested.kind === "manual_fragment" && value.origin !== "manual_extract") throw new Error(invalidMessage);
  if (requested.kind === "ai_fragment" && (context.runId !== requested.runId || !["ai_extract", "ai_interpretation"].includes(String(value.origin)))) throw new Error(invalidMessage);
  if (requested.kind === "source" && !["source", "user_note", "external_source"].includes(String(value.origin))) throw new Error(invalidMessage);
  if (requested.kind === "curation" && (value.origin !== "curation" || context.groupKey !== requested.groupKey || context.curationRevisionId !== requested.revisionId)) throw new Error(invalidMessage);
  if (requested.kind !== "ai_fragment" && context.runId !== null
    || requested.kind !== "curation" && (context.groupKey !== null || context.curationRevisionId !== null)
    || (requested.kind === "document_title" || requested.kind === "document_body") && (context.snapshotId !== null || context.snapshotVersion !== null)) throw new Error(invalidMessage);
  if (!stringOrNull(value.accessExpiresAt) || (value.privacyLevel === "restricted" && (typeof value.accessExpiresAt !== "string" || !Number.isFinite(Date.parse(value.accessExpiresAt))))) throw new Error(invalidMessage);
  if (!Array.isArray(value.evidence) || value.evidence.length > 512 || value.evidence.some((item) => !object(item)
    || typeof item.sourceItemId !== "string" || !stringOrNull(item.memberId) || typeof item.label !== "string" || typeof item.quote !== "string"
    || !(item.textStart === null && item.textEnd === null || Number.isSafeInteger(item.textStart) && Number.isSafeInteger(item.textEnd) && Number(item.textStart) >= 0 && Number(item.textEnd) > Number(item.textStart)))) throw new Error(invalidMessage);
  if (!Array.isArray(value.attachments) || value.attachments.length > 512 || value.attachments.some((item) => !object(item)
    || typeof item.attachmentId !== "string" || !item.attachmentId || typeof item.filename !== "string" || typeof item.mimeType !== "string"
    || !stringOrNull(item.itemKey) || !["unresolved", "user_confirmed", "source_attachment"].includes(String(item.evidenceMethod)))) throw new Error(invalidMessage);
  const copy = value.copy;
  if (!object(copy) || typeof copy.allowed !== "boolean" || ![null, "exact", "standard", "available_only"].includes(copy.mode as never)
    || copy.allowed && copy.mode === null || !stringOrNull(copy.reason) || !Array.isArray(copy.warnings) || copy.warnings.some((warning) => typeof warning !== "string")
    || !copy.allowed && copy.mode !== null || requested.kind !== "curation" && copy.allowed && copy.mode !== "exact"
    || requested.kind === "curation" && copy.allowed && (requested.role === "title" ? copy.mode !== "exact" : copy.mode === "exact")
    || ["manual_fragment", "ai_fragment"].includes(requested.kind) && ["rejected", "superseded"].includes(String(value.reviewStatus)) && copy.allowed) throw new Error(invalidMessage);
  return value as unknown as V2RecordLocationResult;
}

function accessDenied(response: Response, body: unknown) {
  const code = object(body) && object(body.error) ? body.error.code : null;
  const reason = object(body) && object(body.capabilities) ? body.capabilities.reason : null;
  return [401, 403, 423].includes(response.status) || ["record_not_found", "restricted_record_locked", "unauthorized", "forbidden"].includes(String(code))
    || reason === "restricted_record_locked" || object(body) && body.unavailableReason === "restricted_record_locked";
}

function LocationImage({ attachment }: { attachment: V2RecordLocationResult["attachments"][number] }) {
  const [failed, setFailed] = useState(false);
  const path = `/api/v2/attachments/${encodeURIComponent(attachment.attachmentId)}`;
  return <figure className="v2-search-location-image">
    {!failed && attachment.mimeType.startsWith("image/") ? <a href={path} rel="noreferrer" target="_blank" aria-label={`${attachment.filename} 보관 이미지 열기`}>
      {/* Authenticated originals must not be sent through a public optimizer cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={attachment.filename || "보관한 예시 이미지"} loading="lazy" onError={() => setFailed(true)} src={path} />
    </a> : <a href={path} rel="noreferrer" target="_blank">{attachment.filename || "보관한 첨부"} 열기</a>}
    <figcaption>{failed ? "이미지 미리보기를 불러오지 못했습니다. " : ""}{attachment.evidenceMethod === "user_confirmed" ? "사용자가 연결을 확인한 예시" : attachment.evidenceMethod === "source_attachment" ? "출처에 보관된 첨부" : "보관 이미지 · 텍스트와의 대응 미확인"}</figcaption>
  </figure>;
}

export function RecordSearchLocation(props: Props) {
  if (!props.location && !props.invalid) return null;
  // Only this read-only pane remounts. Existing Record editors keep their owner/record keys.
  // Returning to a previously opened URL must never briefly reveal its old authorization receipt.
  const scope = JSON.stringify([props.ownerId, props.recordId, props.location ? serializeRecordLocation(props.location) : null, props.invalid]);
  return <RecordSearchLocationRead {...props} key={scope} />;
}

function RecordSearchLocationRead({ ownerId, recordId, location, invalid = false }: Props) {
  const router = useRouter();
  const serialized = location ? serializeRecordLocation(location) : "";
  const key = JSON.stringify([ownerId, recordId, serialized, invalid]);
  const [state, setState] = useState<ReadState>({ key: "", result: null, error: "", denied: false });
  const [retry, setRetry] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyScope, setCopyScope] = useState("");
  const epoch = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const text = useRef<HTMLPreElement>(null);
  const visible = state.key === key ? state : null;
  const result = visible?.result;
  const copyingCurrent = copyScope === key && copying;
  const copyFailedCurrent = copyScope === key && copyFailed;

  const closeAccess = useCallback((refresh = true) => {
    epoch.current += 1;
    setState({ key, result: null, error: deniedMessage, denied: true });
    setCopyStatus(""); setCopyFailed(false); setCopying(false);
    if (refresh) { revokeLinkDraftAccess({ ownerId, recordId }); router.refresh(); }
  }, [key, ownerId, recordId, router]);

  const getExact = useCallback(async (signal?: AbortSignal, expectedEpoch?: number) => {
    if (!serialized) throw new Error(invalidMessage);
    const response = await fetch(`/api/v2/records/${encodeURIComponent(recordId)}/search-location?${new URLSearchParams({ loc: serialized })}`, { cache: "no-store", signal });
    const body: unknown = await response.json().catch(() => null);
    if (signal?.aborted || expectedEpoch !== undefined && epoch.current !== expectedEpoch) throw new Error("이전 보관 위치 요청은 닫았습니다.");
    if (accessDenied(response, body)) { closeAccess(); throw new Error(deniedMessage); }
    if (!response.ok) throw new Error(response.status === 404 ? `검색한 보관 위치를 찾지 못했습니다. ${noReplacement}` : response.status === 409 ? `검색 당시의 정확한 자료와 일치하지 않습니다. ${noReplacement}` : `검색한 보관 위치를 불러오지 못했습니다. ${noReplacement}`);
    const fresh = readResult(body, recordId, parseRecordLocation(JSON.parse(serialized)));
    if (fresh.privacyLevel === "restricted" && Date.parse(fresh.accessExpiresAt!) <= Date.now()) { closeAccess(); throw new Error(deniedMessage); }
    return fresh;
  }, [serialized, recordId, closeAccess]);

  useEffect(() => onLinkDraftAccessRevoked({ ownerId, recordId }, () => closeAccess(false)), [ownerId, recordId, closeAccess]);
  useEffect(() => {
    const current = ++epoch.current;
    const controller = new AbortController();
    if (!invalid && serialized) {
      void getExact(controller.signal, current).then((value) => {
        if (epoch.current === current && !controller.signal.aborted) setState({ key, result: value, error: "", denied: false });
      }).catch((error: unknown) => {
        if (epoch.current === current && !controller.signal.aborted) setState({ key, result: null, error: error instanceof Error ? error.message : invalidMessage, denied: false });
      });
    }
    return () => { controller.abort(); epoch.current += 1; };
  }, [key, serialized, invalid, retry, getExact]);
  useEffect(() => {
    if (!result) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    if (result.privacyLevel !== "restricted") return;
    const timeout = window.setTimeout(() => closeAccess(), Math.max(0, Date.parse(result.accessExpiresAt!) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [result, closeAccess]);

  async function copy() {
    if (!result || !result.copy.allowed || copyingCurrent) return;
    const current = epoch.current;
    setCopyScope(key); setCopying(true); setCopyStatus(""); setCopyFailed(false);
    try {
      const fresh = await getExact(undefined, current);
      if (current !== epoch.current) return;
      if (!fresh.copy.allowed || fresh.copy.mode !== result.copy.mode) throw new Error("복사 조건이 달라졌습니다. 같은 보관 위치를 다시 확인해 주세요.");
      try { if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable"); await navigator.clipboard.writeText(fresh.text); }
      catch { if (current === epoch.current) { setCopyFailed(true); setCopyStatus("자동 복사를 사용할 수 없습니다. 보관 텍스트를 선택한 뒤 기기의 복사 기능을 사용하세요."); } return; }
      if (current === epoch.current) setCopyStatus(fresh.origin === "ai_interpretation" ? "AI 해석만 그대로 복사했습니다." : fresh.copy.mode === "available_only" ? "확보한 조각만 복사했습니다. 전체 원문이 아닙니다." : "보관 텍스트를 그대로 복사했습니다.");
    } catch (error) {
      if (current === epoch.current) { setState({ key, result: null, error: error instanceof Error ? error.message : invalidMessage, denied: false }); setCopyStatus(""); }
    } finally { if (current === epoch.current) setCopying(false); }
  }
  async function selectText() {
    if (!result || !copyFailedCurrent || copyingCurrent || !text.current) return;
    const current = epoch.current;
    setCopyScope(key); setCopying(true);
    try {
      const fresh = await getExact(undefined, current);
      if (current !== epoch.current || !text.current) return;
      if (!fresh.copy.allowed || fresh.copy.mode !== result.copy.mode) throw new Error("복사 조건이 달라졌습니다. 같은 보관 위치를 다시 확인해 주세요.");
      const range = document.createRange(); range.selectNodeContents(text.current);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); text.current.focus();
    } catch (error) {
      if (current === epoch.current) setState({ key, result: null, error: error instanceof Error ? error.message : invalidMessage, denied: false });
    } finally { if (current === epoch.current) setCopying(false); }
  }
  if (!location && !invalid) return null;
  const error = invalid ? invalidMessage : visible?.error;
  const copyLabel = result?.origin === "ai_interpretation" ? "AI 해석만 복사" : result?.copy.mode === "available_only" ? "확보한 조각만 복사" : "보관 텍스트 그대로 복사";
  return <section aria-labelledby="record-search-location-heading" aria-busy={!result && !error} className="v2-search-location" id="record-search-location">
    <header><div><p><Search aria-hidden="true" size={15} /> 검색 결과에서 연 읽기 전용 자료</p><h2 id="record-search-location-heading" ref={heading} tabIndex={-1}>검색한 보관 위치</h2></div><Link href={`/v2/records/${encodeURIComponent(recordId)}`} scroll={false}>현재 기록만 보기</Link></header>
    <p className="v2-search-location-notice">아래 자료는 검색 당시의 위치로 확인합니다. 현재 기록 본문과 편집 중인 초안은 바꾸지 않습니다.</p>
    {error ? <div role="alert"><p>{error}</p>{!invalid && !visible?.denied ? <button type="button" onClick={() => { setState({ key: "", result: null, error: "", denied: false }); setRetry((value) => value + 1); }}>같은 보관 위치 다시 확인</button> : null}</div> : null}
    {!error && !result ? <p role="status">정확한 보관 위치를 확인하고 있습니다.</p> : null}
    {result ? <>
      <div className="v2-search-location-labels"><strong>{result.label}</strong><span>{result.isHistorical ? "과거 보관 버전" : "현재 버전에서 확인"}</span>{result.origin === "ai_interpretation" ? <span>AI 해석 · 저자의 원문 아님</span> : result.origin === "ai_extract" ? <span>AI가 선택한 원문 발췌</span> : null}{result.reviewStatus ? <span>{result.reviewStatus === "rejected" ? "거절된 제안 · 보관 근거로만 표시" : result.reviewStatus === "proposed" ? "확인되지 않은 제안" : result.reviewStatus === "confirmed" ? "사용자 확인됨" : result.reviewStatus}</span> : null}</div>
      <dl className="v2-search-location-versions">{result.context.documentRevisionId ? <><dt>글 버전</dt><dd>{result.context.documentRevisionId}</dd></> : null}{result.context.snapshotId ? <><dt>자료 버전</dt><dd>{result.context.snapshotVersion ?? "번호 없음"} · {result.context.snapshotId}</dd></> : null}{result.context.runId ? <><dt>분석 실행</dt><dd>{result.context.runId}</dd></> : null}{result.context.curationRevisionId ? <><dt>정리본 버전</dt><dd>{result.context.curationRevisionId}</dd></> : null}</dl>
      <div className="v2-search-location-copy">{result.copy.allowed ? <button disabled={copyingCurrent} onClick={() => void copy()} type="button"><Copy aria-hidden="true" size={15} />{copyingCurrent ? "확인 후 복사 중" : copyLabel}</button> : <p>{result.origin === "curation" ? "이 자료는 합쳐 복사할 수 없습니다. 순서·관계가 확인된 조각을 원래 정리본에서 확인해 주세요." : "거절되거나 대체된 조각은 보관 근거로만 표시하며 복사하지 않습니다."}</p>}{copyFailedCurrent ? <button disabled={copyingCurrent} onClick={() => void selectText()} type="button">보관 텍스트 선택</button> : null}</div>
      {result.copy.mode === "available_only" ? <p className="v2-search-location-warning">일부만 확보한 자료입니다. 복사에는 보관된 조각만 포함되며, 빠진 원문을 AI가 채우지 않습니다.</p> : null}
      {result.copy.warnings.length ? <details className="v2-search-location-warning"><summary>보관·복사 주의사항 {result.copy.warnings.length}개</summary><ul>{result.copy.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warningLabels[warning] ?? "보관 범위·조각 연결 상태를 원래 정리본에서 확인해 주세요."}</li>)}</ul></details> : null}
      <pre aria-label="검색한 보관 텍스트" className="v2-search-location-text" ref={text} tabIndex={0}>{result.range ? <>{result.text.slice(0, result.range.start)}<mark>{result.text.slice(result.range.start, result.range.end)}</mark>{result.text.slice(result.range.end)}</> : result.text}</pre>
      <p aria-live="polite" role="status">{copyScope === key ? copyStatus : ""}</p>
      {result.attachments.length ? <div aria-label="이 위치에 보관된 첨부" className="v2-search-location-images">{result.attachments.map((attachment, index) => <LocationImage attachment={attachment} key={`${attachment.attachmentId}:${attachment.itemKey}:${index}`} />)}</div> : null}
      {result.evidence.length ? <details className="v2-search-location-evidence"><summary>정확한 출처 근거 {result.evidence.length}개</summary>{result.evidence.map((evidence, index) => <article key={`${evidence.sourceItemId}:${evidence.memberId}:${index}`}><h3>{evidence.label}</h3><p>출처 {evidence.sourceItemId}{evidence.textStart !== null ? ` · 원문 UTF-16 범위 ${evidence.textStart}–${evidence.textEnd}` : ""}</p><pre>{evidence.quote}</pre></article>)}</details> : null}
      <details><summary><ExternalLink aria-hidden="true" size={13} /> 보존 정보</summary><code>{result.textHash}</code></details>
    </> : null}
  </section>;
}
