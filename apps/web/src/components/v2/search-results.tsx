"use client";

import { CalendarDays, FileText, LockKeyhole, Search, Shield, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { SemanticIcon } from "@/components/v2/semantic-icon";
import { SavedFieldReader } from "@/components/v2/saved-field-reader";
import type { V2RetrievalResult } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { validateV2QueryPlan, type V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import { parseRecordLocation, recordLocationHref, RETRIEVAL_MATCHES_CONTRACT, type V2RetrievalMatch } from "@/lib/v2/retrieval/record-location-v1";
import "@/app/v2/search-location.css";
import "@/app/v2/saved-view-display.css";
import { validateSavedViewDisplay, type V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { formatSavedViewFieldValue, SAVED_VIEW_BUILTIN_FIELDS, type V2SavedViewField } from "@/lib/v2/retrieval/saved-view-fields";

type ResultWithMatches = V2RetrievalResult & { matches?: readonly V2RetrievalMatch[]; matchCount?: number };
const origins = ["document_title", "document_body", "user_note", "external_source", "source", "manual_extract", "ai_extract", "ai_interpretation", "curation"];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function readMatch(value: unknown): V2RetrievalMatch {
  if (!object(value) || typeof value.id !== "string" || !value.id || typeof value.label !== "string" || !origins.includes(String(value.origin))
    || !(value.snippet === null || typeof value.snippet === "string") || !(value.reviewStatus === null || typeof value.reviewStatus === "string") || typeof value.isHistorical !== "boolean") throw new Error("검색 근거 응답을 확인하지 못했습니다.");
  return { ...value, location: parseRecordLocation(value.location) } as V2RetrievalMatch;
}

function MatchList({ result, queryPlan, onAccessDenied }: { result: ResultWithMatches; queryPlan?: V2RetrievalQueryPlanV1; onAccessDenied: () => void }) {
  const [matches, setMatches] = useState<readonly V2RetrievalMatch[]>(result.matches ?? []);
  const [totalCount, setTotalCount] = useState(result.matchCount ?? result.matches?.length ?? 0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  async function more() {
    if (!queryPlan || busy || denied) return;
    setBusy(true); setError("");
    const current = new AbortController(); controller.current = current;
    try {
      const plan = validateV2QueryPlan(queryPlan);
      const response = await fetch(`/api/v2/records/${encodeURIComponent(result.recordId)}/search-matches?${new URLSearchParams({ plan: JSON.stringify(plan), page: String(page + 1) })}`, { cache: "no-store", signal: current.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current || current.signal.aborted) return;
      const code = object(body) && object(body.error) ? body.error.code : null;
      const redacted = object(body) && (body.unavailableReason === "restricted_record_locked" || object(body.capabilities) && body.capabilities.reason === "restricted_record_locked");
      // A successful page must reaffirm the policy of this exact record before
      // any previously rendered title, snippet, or match remains disclosed.
      const changedOrMissingPolicy = response.ok && (!object(body) || body.contract !== RETRIEVAL_MATCHES_CONTRACT
        || body.recordId !== result.recordId || !["normal", "sensitive", "restricted"].includes(String(body.privacyLevel))
        || body.privacyLevel !== result.privacyLevel);
      if ([401, 403, 423].includes(response.status) || code === "record_not_found" || code === "restricted_record_locked" || redacted || changedOrMissingPolicy) {
        setMatches([]); setTotalCount(0); setDenied(true); onAccessDenied(); return;
      }
      if (!response.ok || !object(body) || body.contract !== RETRIEVAL_MATCHES_CONTRACT || body.recordId !== result.recordId
        || JSON.stringify(validateV2QueryPlan(body.plan)) !== JSON.stringify(plan) || !Array.isArray(body.matches)
        || body.page !== page + 1 || !Number.isSafeInteger(body.totalCount) || Number(body.totalCount) < 0
        || !Number.isSafeInteger(body.pageSize) || Number(body.pageSize) < 1 || Number(body.pageSize) > 100
        || !Number.isSafeInteger(body.totalPages) || Number(body.totalPages) !== Math.max(1, Math.ceil(Number(body.totalCount) / Number(body.pageSize)))
        || body.matches.length > Number(body.pageSize)) throw new Error("같은 검색 조건의 근거를 불러오지 못했습니다. 다시 시도해 주세요.");
      const incoming = body.matches.map(readMatch);
      if (new Set(incoming.map((item) => item.id)).size !== incoming.length) throw new Error("검색 근거 응답을 확인하지 못했습니다.");
      setMatches((previous) => [...new Map([...(page === 0 ? [] : previous), ...incoming].map((item) => [item.id, item])).values()]);
      setTotalCount(Number(body.totalCount)); setPage(Number(body.page));
    } catch (caught) { if (mounted.current && !current.signal.aborted) setError(caught instanceof Error ? caught.message : "검색 근거를 불러오지 못했습니다."); }
    finally { if (mounted.current && !current.signal.aborted) setBusy(false); }
  }
  if (!totalCount && !error) return null;
  return <div className="v2-search-result-matches">
    <p className="v2-search-match-status">검색한 보관 위치 {totalCount}개{matches.length < totalCount ? ` · ${matches.length}개 표시` : ""}</p>
    {matches.length ? <ul aria-label="출처별 검색 근거" className="v2-search-match-list">{matches.map((match) => <li key={match.id}>
      <Link href={recordLocationHref(result.recordId, match.location)}><strong>{match.label}</strong>{match.isHistorical ? <small>과거 보관 버전</small> : null}{match.origin === "ai_interpretation" ? <small>AI 해석 · 저자의 원문 아님</small> : match.origin === "ai_extract" ? <small>AI가 선택한 발췌</small> : null}{match.reviewStatus === "rejected" ? <small>거절된 제안</small> : match.reviewStatus === "proposed" ? <small>미확인 제안</small> : null}</Link>
      {result.privacyLevel === "normal" && match.snippet ? <p>{match.snippet}</p> : result.privacyLevel !== "normal" ? <p>민감·보호 기록 · 검색 문맥 숨김</p> : null}
    </li>)}</ul> : null}
    {error ? <p role="alert" className="v2-search-match-status">{error}</p> : null}
    {queryPlan && !denied && (matches.length < totalCount || error) ? <button className="v2-search-match-more" disabled={busy} onClick={() => void more()} type="button">{busy ? "검색 근거 확인 중" : "이 기록의 검색 근거 더 보기"}</button> : null}
  </div>;
}

function fieldFor(result: V2RetrievalResult, key: string): V2SavedViewField {
  const supplied = (result as V2RetrievalResult & { displayFields?: readonly V2SavedViewField[] }).displayFields?.find((field) => field.fieldKey === key);
  const label = supplied?.label ?? SAVED_VIEW_BUILTIN_FIELDS.find((field) => field.fieldKey === key)?.label ?? key;
  if (result.privacyLevel !== "normal") return { fieldKey: key, label, state: "private", values: [] };
  return supplied ?? { fieldKey: key, label, state: "missing", values: [] };
}
function DisplayFieldValue({ field, recordId, onAccessDenied }: { field: V2SavedViewField; recordId: string; onAccessDenied: () => void }) {
  if (field.state === "private") return <span className="v2-view-field-empty">민감·보호 필드 숨김</span>;
  if (field.state === "missing") return <span className="v2-view-field-empty">값 없음</span>;
  return <div className="v2-view-field-values">{field.state === "conflict" ? <strong>값 충돌 · 하나로 정하지 않음</strong> : null}{field.values.map((value, index) => <div key={`${value.propertyId}:${index}`}>{value.preview ? <SavedFieldReader recordId={recordId} fieldKey={field.fieldKey} label={field.label} value={value} onAccessDenied={onAccessDenied} /> : <><span>{formatSavedViewFieldValue(value)}</span><small>{value.sourceLabel}{value.lockedByUser ? " · 사용자 잠금" : ""}</small></>}</div>)}</div>;
}
function groupLabel(result: V2RetrievalResult, display: V2SavedViewDisplay | undefined, denied: boolean) {
  if (!display?.groupBy) return null;
  if (denied) return "접근 확인 필요";
  if (result.privacyLevel !== "normal") return "민감·보호 기록";
  if (display.groupBy === "type") return result.typeLabel;
  const value = display.groupBy === "written_month" ? result.writtenAt : result.capturedAt;
  return value && /^\d{4}-\d{2}/.test(value) ? `${value.slice(0, 4)}년 ${value.slice(5, 7)}월` : "날짜 미상";
}

export function SearchResults({ results, queried, queryPlan, display }: { results: readonly V2RetrievalResult[]; queried: boolean; queryPlan?: V2RetrievalQueryPlanV1; display?: V2SavedViewDisplay }) {
  const [deniedRecords, setDeniedRecords] = useState<ReadonlySet<string>>(new Set());
  const settings = display ? validateSavedViewDisplay(display) : undefined;
  if (!queried) return <section className="v2-search-empty"><Search aria-hidden="true" size={30} /><h2>기억나는 단어부터 입력하세요.</h2><p>제목, 본문, 이미지 글자, 녹취, 확인된 대상 이름을 함께 찾습니다. 분류나 날짜만으로도 좁힐 수 있습니다.</p></section>;
  if (!results.length) return <section className="v2-search-empty"><SlidersHorizontal aria-hidden="true" size={30} /><h2>조건에 맞는 기록이 없습니다.</h2><p>검색어를 줄이거나 분류·평점·날짜 조건을 하나씩 해제해보세요. 원본은 삭제되거나 변경되지 않습니다.</p></section>;
  const matchList = (result: V2RetrievalResult) => <MatchList key={JSON.stringify([result.recordId, queryPlan, result.matches])} result={result} queryPlan={queryPlan} onAccessDenied={() => setDeniedRecords((previous) => new Set([...previous, result.recordId]))} />;
  const deniedContent = (result: V2RetrievalResult) => <p role="alert">검색 근거를 읽을 권한을 다시 확인해야 합니다. <Link href={`/v2/records/${encodeURIComponent(result.recordId)}`}>기록 접근 다시 확인</Link></p>;
  const labels = results.map((result) => groupLabel(result, settings, deniedRecords.has(result.recordId)));
  const groupingNotice = settings?.groupBy ? <p className="v2-view-grouping-notice">현재 페이지의 연속 구간만 묶습니다. 같은 묶음이 다시 나타날 수 있으며 검색 정렬·기록·페이지 순서는 그대로입니다.</p> : null;
  if (settings?.layout === "table") return <section aria-label="검색 결과" className={`v2-search-results v2-saved-results v2-saved-results--table is-${settings.density}`}>
    {groupingNotice}<div className="v2-saved-view-table-scroll" role="region" aria-label="목록 표 가로 스크롤" tabIndex={0}><table style={{ minWidth: Math.max(640, (settings.visibleFields.length + 2) * 170) }}><caption>현재 페이지의 기록 · 표시 필드 {settings.visibleFields.length}개</caption><thead><tr><th scope="col">기록</th>{settings.visibleFields.map((key) => <th scope="col" key={key}>{results.filter((result) => !deniedRecords.has(result.recordId)).map((result) => fieldFor(result, key)).find((field) => field.label !== key)?.label ?? key}</th>)}<th scope="col">검색 문맥과 정확한 보관 위치</th></tr></thead>
      <tbody>{results.map((result, index) => <Fragment key={result.recordId}>{labels[index] && (index === 0 || labels[index] !== labels[index - 1]) ? <tr className="v2-view-table-group"><th colSpan={settings.visibleFields.length + 2} scope="colgroup">{labels[index]}</th></tr> : null}
        {deniedRecords.has(result.recordId) ? <tr><td colSpan={settings.visibleFields.length + 2}>{deniedContent(result)}</td></tr> : <tr data-record-id={result.recordId}><th scope="row"><Link href={`/v2/records/${encodeURIComponent(result.recordId)}`}>{result.title}</Link></th>{settings.visibleFields.map((key) => <td key={key}><DisplayFieldValue field={fieldFor(result, key)} recordId={result.recordId} onAccessDenied={() => setDeniedRecords((previous) => new Set([...previous, result.recordId]))} /></td>)}<td>{result.privacyLevel === "normal" ? <p>{result.snippet || "보관 위치에서 정확한 자료를 확인하세요."}</p> : <p>민감·보호 기록 · 검색 문맥 숨김</p>}<ul aria-label="포함 이유">{result.inclusionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{matchList(result)}</td></tr>}
      </Fragment>)}</tbody></table></div>
  </section>;
  return (
    <section aria-label="검색 결과" className={`v2-search-results${settings ? ` v2-saved-results v2-saved-results--${settings.layout} is-${settings.density}` : ""}`}>
      {groupingNotice}
      {results.map((result, index) => <Fragment key={result.recordId}>{labels[index] && (index === 0 || labels[index] !== labels[index - 1]) ? <h2 className="v2-view-group-heading">{labels[index]}</h2> : null}<article className="v2-search-result" data-record-id={result.recordId}>
        {deniedRecords.has(result.recordId) ? deniedContent(result) : <>
        <span className="v2-search-result__icon">{result.privacyLevel === "restricted" ? <LockKeyhole aria-hidden="true" size={19} /> : result.privacyLevel === "sensitive" ? <Shield aria-hidden="true" size={19} /> : <SemanticIcon context="type" iconKey={result.iconKey} size={19} />}</span>
        <div className="v2-search-result__copy">
          {!settings ? <p><span>{result.typeLabel}</span><time dateTime={result.writtenAt ?? result.capturedAt}><CalendarDays aria-hidden="true" size={12} /> {new Date(result.writtenAt ?? result.capturedAt).toLocaleDateString("ko-KR")}</time></p> : settings.layout === "timeline" ? <p>{result.privacyLevel === "normal" ? <>{settings.groupBy === "written_month" ? "작성일" : "보관일(저장 날짜)"} · {(settings.groupBy === "written_month" ? result.writtenAt : result.capturedAt) ? <time dateTime={(settings.groupBy === "written_month" ? result.writtenAt : result.capturedAt)!}>{(settings.groupBy === "written_month" ? result.writtenAt : result.capturedAt)!.slice(0, 10)}</time> : "미상"}</> : "민감·보호 기록 · 날짜 숨김"}</p> : null}
          <h2><Link href={`/v2/records/${encodeURIComponent(result.recordId)}`}>{result.title}</Link></h2>
          {result.snippet && result.privacyLevel === "normal" ? <div className="v2-search-result__snippet">{result.snippet}</div> : <div className="v2-search-result__private"><FileText aria-hidden="true" size={14} /> {result.privacyLevel === "restricted" ? "재인증된 보호 기록 · 미리보기 숨김" : result.privacyLevel === "sensitive" ? "민감 기록 · 검색 문맥 숨김" : "보관 위치에서 정확한 자료를 확인하세요."}</div>}
          <ul aria-label="포함 이유">{result.inclusionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          {settings?.visibleFields.length ? <dl className="v2-view-record-fields">{settings.visibleFields.map((key) => { const field = fieldFor(result, key); return <div key={key}><dt>{field.label}</dt><dd><DisplayFieldValue field={field} recordId={result.recordId} onAccessDenied={() => setDeniedRecords((previous) => new Set([...previous, result.recordId]))} /></dd></div>; })}</dl> : null}
          {matchList(result)}
        </div>
        <Link className="v2-search-result__open" href={`/v2/records/${encodeURIComponent(result.recordId)}`}>현재 기록 열기</Link>
        </>}
      </article></Fragment>)}
    </section>
  );
}
