"use client";

import { Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { readNaturalQueryInterpretation, type NaturalQueryInterpretationResponse } from "@/lib/v2/retrieval/plan-presentation";
import "./natural-search-panel.css";

const QUESTION_LIMIT = 300;
const KEYWORD_FALLBACK = "키워드 검색은 그대로 사용할 수 있습니다.";
type PanelState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "busy"; question: string }>
  | Readonly<{ status: "ready"; question: string; result: NaturalQueryInterpretationResponse }>
  | Readonly<{ status: "error"; question: string; message: string }>;

function retryTime(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) return null;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function failureMessage(status: number, body: unknown) {
  if ([401, 403, 404, 423].includes(status)) return `AI 해석 권한을 확인하지 못했습니다. 다시 로그인한 뒤 시도해 주세요. ${KEYWORD_FALLBACK}`;
  const error = body && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown; retryAt?: unknown } }).error : null;
  const retryAt = retryTime(error?.retryAt);
  if (error?.code === "search_quota_exhausted") return `AI 사용량 한도에 도달했습니다 · ${retryAt ? `${retryAt} 이후 다시 시도해 주세요.` : "잠시 후 다시 시도해 주세요."} ${KEYWORD_FALLBACK}`;
  if (error?.code === "search_ai_paused" && retryAt) return `AI가 잠시 쉬는 중입니다 · ${retryAt} 이후 다시 시도해 주세요. ${KEYWORD_FALLBACK}`;
  const message = typeof error?.message === "string" && error.message.length <= 300 ? error.message : null;
  if (message) return message;
  if (status === 429) return `AI 요청이 많습니다. 잠시 후 다시 시도해 주세요. ${KEYWORD_FALLBACK}`;
  if (status === 413 || status === 400) return "질문을 확인해 주세요. 300자 이내의 문장으로 입력할 수 있습니다.";
  return `AI 해석을 지금 사용할 수 없습니다. ${KEYWORD_FALLBACK}`;
}

/**
 * The keyword field stays the primary search. Natural-language interpretation
 * runs only on the explicit button, shows what AI understood, and navigates
 * only when the user applies the plan. Results always come from the existing
 * retrieval executor on /v2/search.
 */
export function SearchQueryBox({ defaultQuery, naturalSearch, endpoint = "/api/v2/search/interpret" }: { defaultQuery: string; naturalSearch: boolean; endpoint?: string }) {
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | null>(null), epoch = useRef(0), inFlight = useRef(false);
  const hintId = useId(), headingId = useId();
  useEffect(() => () => { controller.current?.abort(); epoch.current += 1; }, []);
  useEffect(() => { if (state.status === "ready") heading.current?.focus(); }, [state]);

  async function interpret() {
    // A ref, not render state, so a second press before re-render cannot start another provider call.
    if (inFlight.current) return;
    const question = input.current?.value.replace(/\s+/gu, " ").trim() ?? "";
    if (!question) { setState({ status: "error", question, message: "해석할 질문을 검색창에 입력해 주세요." }); input.current?.focus(); return; }
    if (question.length > QUESTION_LIMIT) { setState({ status: "error", question, message: "질문은 300자 이내로 입력해 주세요." }); input.current?.focus(); return; }
    const current = ++epoch.current, request = new AbortController();
    controller.current?.abort(); controller.current = request; inFlight.current = true;
    setState({ status: "busy", question });
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const body: unknown = await response.json().catch(() => null);
      if (current !== epoch.current || request.signal.aborted) return;
      if (!response.ok) { setState({ status: "error", question, message: failureMessage(response.status, body) }); return; }
      setState({ status: "ready", question, result: readNaturalQueryInterpretation(body) });
    } catch {
      if (current === epoch.current && !request.signal.aborted) setState({ status: "error", question, message: `AI 해석 결과를 확인하지 못했습니다. 다시 시도해 주세요. ${KEYWORD_FALLBACK}` });
    } finally {
      if (current === epoch.current) inFlight.current = false;
    }
  }
  function close() {
    controller.current?.abort(); epoch.current += 1; inFlight.current = false; setState({ status: "idle" }); trigger.current?.focus();
  }
  function panelKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
  }

  const busy = state.status === "busy";
  const result = state.status === "ready" ? state.result : null;
  const conditions = result?.chips.filter((chip) => chip.kind !== "sort" && chip.kind !== "limit") ?? [];
  return <>
    <label className="v2-search-query">
      <Search aria-hidden="true" size={19} /><span className="sr-only">검색어</span>
      <input ref={input} autoFocus defaultValue={defaultQuery} maxLength={QUESTION_LIMIT} name="q" placeholder={naturalSearch ? "기록, 문장, 사람, 장소 검색 또는 질문" : "기록, 문장, 사람, 장소 검색"} type="search" aria-describedby={naturalSearch ? hintId : undefined} />
      <button type="submit">검색</button>
    </label>
    {naturalSearch ? <div className="v2-natural-search">
      <div className="v2-natural-search__actions">
        <button ref={trigger} aria-disabled={busy} aria-describedby={hintId} className="v2-natural-search__trigger" onClick={() => void interpret()} type="button">
          <Sparkles aria-hidden="true" size={15} /> {busy ? "해석 중…" : "자연어로 해석"}
        </button>
        <p id={hintId}>예: 작년에 별점 준 게임 리뷰. 누를 때만 AI가 질문을 검색 조건으로 바꾸며, 적용하기 전에는 검색하지 않습니다.</p>
      </div>
      <p className="v2-natural-search__status" role="status" aria-live="polite">{busy ? "AI가 질문을 검색 조건으로 해석하고 있습니다…" : result ? `AI가 조건 ${conditions.length}개를 찾았습니다.` : ""}</p>
      {state.status === "error" ? <p className="v2-natural-search__error" role="alert">{state.message}</p> : null}
      {result && state.status === "ready" ? <section aria-labelledby={headingId} className="v2-natural-result" onKeyDown={panelKeys}>
        <header>
          <div><p>AI가 해석한 조건 · 제안</p><h2 id={headingId} ref={heading} tabIndex={-1}>질문을 이렇게 이해했습니다</h2></div>
          <button aria-label="AI 해석 닫기" onClick={close} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <p className="v2-natural-result__question"><span>내가 입력한 질문</span><q>{state.question}</q></p>
        {conditions.length ? <ul aria-label="AI가 해석한 검색 조건" className="v2-natural-result__chips">
          {result.chips.map((chip, index) => <li key={`${chip.kind}-${index}`} data-kind={chip.kind}><span>{chip.label}</span> <strong>{chip.value}</strong></li>)}
        </ul> : <p className="v2-natural-result__empty">검색 조건으로 바꿀 수 있는 표현을 찾지 못했습니다. 입력한 문장 그대로 키워드로 검색할 수 있습니다.</p>}
        {result.dropped.length ? <div className="v2-natural-result__dropped">
          <h3>반영하지 않은 부분</h3>
          <ul>{result.dropped.map((note, index) => <li key={`${note.code}-${index}`}>{note.message}</li>)}</ul>
        </div> : null}
        <p className="v2-natural-result__note">AI 해석은 제안입니다. 적용하면 저장된 기록에서 위 조건과 정확히 일치하는 기록만 찾습니다. 감정·의도·성격·관계에 대한 해석은 조건으로 쓰지 않습니다.</p>
        <footer>
          {conditions.length ? <Link className="v2-natural-result__apply" href={result.href}>이 조건으로 검색</Link> : null}
          <button className="v2-natural-result__keyword" type="submit">입력한 문장 그대로 키워드 검색</button>
        </footer>
      </section> : null}
    </div> : null}
  </>;
}
