"use client";

import { useRef, useState } from "react";
import { useLinkDraftRecovery } from "@/components/v2/editor/use-link-draft-recovery";
import type { LinkDraftSaveToken } from "@/lib/v2/editor/link-draft-session";

const identity = { ownerId: "session-audit-owner", recordId: "session-audit-record", currentVersion: 1, privacyLevel: "normal" as const };
type Input = { text: string; pending: { key: string } | null };
function parse(value: unknown): Input {
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string" || !("pending" in value)) throw new Error("Invalid synthetic draft");
  if (value.pending !== null && (typeof value.pending !== "object" || !("key" in value.pending) || typeof value.pending.key !== "string")) throw new Error("Invalid synthetic pending");
  return { text: value.text, pending: value.pending as Input["pending"] };
}

/** Synthetic hook boundary only: no real submission/receipt or user record. */
export function LinkDraftSessionAuditFixture() {
  const [text, setText] = useState(""), [scope, setScope] = useState(1), [error, setError] = useState(""), [denied, setDenied] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const tokens = useRef<LinkDraftSaveToken[]>([]);
  const recovery = useLinkDraftRecovery({ identity, kind: "curation", parse, onAccessDenied: () => setDenied(true) });
  async function action(work: () => Promise<void>) { setError(""); try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Synthetic operation failed"); } }
  if (denied) return <main><h1>합성 복구 세션 검증</h1><p>인증 거절 · 합성 내용 숨김</p><p data-testid="active-scope">편집 범위 {scope}</p>{error ? <p role="alert">{error}</p> : null}</main>;
  return <main className="v2-lab"><h1>합성 복구 세션 검증</h1><p>제품 제출 경로가 아닙니다. 이 화면의 완료 통지는 가짜이며 서버 문서를 만들지 않습니다.</p>
    <p data-testid="active-scope">편집 범위 {scope}</p>
    <label>합성 초안<input value={text} onChange={(event) => { setText(event.target.value); recovery.stage({ text: event.target.value, pending: null }, `scope-${scope}`); }} /></label>
    <button disabled={!recovery.ready} onClick={() => void action(async () => { await recovery.park(); const next = scope + 1; recovery.stage({ text: `new-scope-${next}`, pending: null }, `scope-${next}`); setScope(next); setText(`new-scope-${next}`); })} type="button">보존하고 다음 범위</button>
    <button disabled={!recovery.ready} onClick={() => void action(async () => { const token = recovery.stage({ text, pending: { key: crypto.randomUUID() } }, `scope-${scope}`); if (!await recovery.flush()) throw new Error("Synthetic persistence failed"); tokens.current.push(token); setTokenCount(tokens.current.length); })} type="button">합성 저장 요청 고정</button>
    <button disabled={!tokenCount} onClick={() => void action(async () => { await recovery.saved(tokens.current[0]); tokens.current.shift(); setTokenCount(tokens.current.length); })} type="button">가장 오래된 합성 완료 통지</button>
    <p role="status">{recovery.status}</p><p data-testid="pending-tokens">고정 요청 {tokenCount}개</p>
    <p data-testid="other-drafts">다른 초안 {recovery.copies.length}개</p>
    {error ? <p role="alert">{error}</p> : null}
  </main>;
}
