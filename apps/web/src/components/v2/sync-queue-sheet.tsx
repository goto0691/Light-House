"use client";

import { CloudUpload, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { syncDraft, type BrowserCaptureSyncTransport } from "@/lib/v2/offline/capture-sync";
import type { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import type { LocalDraft } from "@/lib/v2/offline/local-capture";

export function SyncQueueSheet({ currentDraftId, onChanged, onClose, open, store, transport }: {
  currentDraftId: string;
  onChanged(): void;
  onClose(): void;
  open: boolean;
  store: IndexedDbCaptureStore;
  transport: BrowserCaptureSyncTransport;
}) {
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setDrafts((await store.listDrafts()).reverse());
    onChanged();
  }

  useEffect(() => {
    if (open) void refresh();
    // onChanged is intentionally called only when the sheet refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="v2-sync-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="sync-queue-title" aria-modal="true" className="v2-sync-sheet" role="dialog">
        <header><div><p>이 기기의 임시 보관함</p><h2 id="sync-queue-title">전송 대기 {drafts.length}개</h2></div><button aria-label="전송 대기 닫기" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button></header>
        <p className="v2-sync-sheet-help">서버 원본 저장이 끝난 항목만 자동으로 로컬 payload를 지웁니다.</p>
        {message ? <p className="v2-sync-sheet-message" role="status">{message}</p> : null}
        {drafts.length ? <ul>{drafts.map((draft) => {
          const current = draft.draftId === currentDraftId;
          return <li key={draft.draftId}>
            <span><strong>{draft.privacyLevel === "sensitive" ? "민감한 임시 기록" : draft.title || draft.bodyMarkdown.split(/\r?\n/).find(Boolean)?.slice(0, 60) || "첨부 기록"}</strong><small>{current ? "현재 작성 중" : draft.state === "waiting_network" ? "연결 대기" : "이 기기에 저장됨"} · {new Date(draft.updatedAt).toLocaleString("ko-KR")}</small></span>
            <div>
              <button disabled={current || busyId === draft.draftId} onClick={async () => {
                setBusyId(draft.draftId); setMessage(null);
                const result = await syncDraft({ store, transport, draftId: draft.draftId });
                setMessage(result.outcome === "committed" ? "서버 원본 저장을 완료했습니다." : result.outcome === "waiting_network" ? "연결되면 다시 전송할 수 있습니다." : result.outcome === "authentication_required" ? "로그인한 뒤 다시 전송하세요." : "해당 기록을 확인해야 합니다.");
                setBusyId(null); await refresh();
              }} type="button"><RotateCw aria-hidden="true" size={14} /> {busyId === draft.draftId ? "전송 중" : "재전송"}</button>
              <button className="is-danger" disabled={current} onClick={async () => {
                if (confirmDiscardId !== draft.draftId) { setConfirmDiscardId(draft.draftId); return; }
                await store.purgeDraftPayload(draft.draftId); setConfirmDiscardId(null); setMessage("이 기기의 임시 사본을 삭제했습니다."); await refresh();
              }} type="button"><Trash2 aria-hidden="true" size={14} /> {confirmDiscardId === draft.draftId ? "삭제 확인" : "이 기기에서 삭제"}</button>
            </div>
          </li>;
        })}</ul> : <div className="v2-sync-sheet-empty"><CloudUpload aria-hidden="true" size={28} /><p>전송을 기다리는 기록이 없습니다.</p></div>}
      </section>
    </div>
  );
}
