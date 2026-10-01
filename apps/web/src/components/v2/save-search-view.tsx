"use client";

import { BookmarkPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import { SavedViewDisplayControls, defaultSavedViewDisplay } from "@/components/v2/saved-view-display-controls";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { captureSavedViewCreateDefinition, confirmSavedViewCreateResponse } from "@/lib/v2/retrieval/saved-view-create-response";

export function SaveSearchView({ plan }: { plan: V2RetrievalQueryPlanV1 }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<V2SavedViewDisplay>(defaultSavedViewDisplay);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null), epoch = useRef(0);
  useEffect(() => () => { controller.current?.abort(); epoch.current += 1; }, []);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      nameInput.current?.focus();
    }
  }, [open]);
  function close() { if (!busy) { dialog.current?.close(); setOpen(false); trigger.current?.focus(); } }
  function closeAccess() {
    controller.current?.abort(); epoch.current += 1; setDenied(true); setBusy(false); dialog.current?.close(); setOpen(false);
    setError("목록을 저장할 권한을 다시 확인해 주세요. 입력은 이 화면에 보존됩니다.");
  }
  function dialogKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:enabled,input:enabled,select:enabled,[tabindex="0"]')].filter((element) => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function save() {
    if (busy || denied) return;
    if (!name.trim()) { setError("목록 이름을 입력해주세요."); return; }
    const current = ++epoch.current, request = new AbortController(); controller.current?.abort(); controller.current = request;
    setBusy(true); setError(null); closeButton.current?.focus();
    try {
      const selected = captureSavedViewCreateDefinition({ name, description: null, iconKey: "type.collection", queryPlan: plan, display });
      const response = await fetch("/api/v2/saved-views", { method: "POST", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) });
      if (current !== epoch.current || request.signal.aborted) return;
      if ([401, 403, 404, 423].includes(response.status)) { closeAccess(); return; }
      const body: unknown = await response.json();
      if (current !== epoch.current || request.signal.aborted) return;
      if (!response.ok) {
        const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
        throw new Error(typeof message === "string" ? message : "목록을 저장하지 못했습니다. 입력은 유지됩니다.");
      }
      if (response.status !== 201) throw new Error("목록 생성 응답을 확인하지 못했습니다. 입력은 유지됩니다.");
      const id = confirmSavedViewCreateResponse(body, selected);
      router.push(`/v2/library/views/${encodeURIComponent(id)}`);
    } catch (caught) { if (current === epoch.current && !request.signal.aborted) { setError(caught instanceof Error ? caught.message : "목록을 저장하지 못했습니다."); setBusy(false); } }
  }

  return <>
    <button className="v2-save-view-button" ref={trigger} disabled={denied} onClick={() => setOpen(true)} type="button"><BookmarkPlus aria-hidden="true" size={15} /> 현재 조건을 내 목록으로 저장</button>
    {denied && error ? <p role="alert">{error}</p> : null}
    {open ? <dialog ref={dialog} aria-labelledby="save-view-heading" aria-modal="true" className="v2-save-view-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={dialogKeys}><header><div><p>검색 조건과 표시 방식</p><h2 id="save-view-heading">내 목록으로 저장</h2></div><button ref={closeButton} aria-label="내 목록 저장 닫기" aria-disabled={busy} onClick={close} type="button"><X aria-hidden="true" size={18} /></button></header><label>목록 이름<input ref={nameInput} disabled={busy} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="예: 다시 가고 싶은 장소" value={name} /></label><SavedViewDisplayControls value={display} onChange={setDisplay} disabled={busy} onAccessDenied={closeAccess} /><p>저장해도 왼쪽 메뉴에 자동 고정되지 않습니다. 필요할 때 목록 화면에서 직접 고정할 수 있습니다.</p>{error ? <p className="v2-product-error" role="alert">{error}</p> : null}<footer><button disabled={busy} onClick={close} type="button">취소</button><button className="is-primary" disabled={busy} onClick={() => void save()} type="button">저장</button></footer></dialog> : null}
  </>;
}
