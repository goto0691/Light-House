"use client";

import { Pin, PinOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SavedViewDisplayControls } from "@/components/v2/saved-view-display-controls";
import { validateSavedViewDisplay, type V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";

export function SavedViewActions({ viewId, pinned, display, displayRevision, onDisplaySaved }: { viewId: string; pinned: boolean; display: V2SavedViewDisplay; displayRevision: string; onDisplaySaved?: (display: V2SavedViewDisplay, revision: string) => void }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(display), [revision, setRevision] = useState(displayRevision);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<V2SavedViewDisplay | null>(null), [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const controller = useRef<AbortController | null>(null), epoch = useRef(0);
  useEffect(() => () => { controller.current?.abort(); epoch.current += 1; }, []);
  function closeAccess() {
    controller.current?.abort(); epoch.current += 1; setBusy(false); setDenied(true); setMessage(""); setLatest(null);
    setError("이 목록을 수정할 권한을 다시 확인해 주세요.");
  }
  function begin() { controller.current?.abort(); const request = new AbortController(); controller.current = request; const current = ++epoch.current; setBusy(true); setError(null); setMessage(""); return { request, current }; }
  function parseView(body: unknown) {
    const data = body as { view?: { id?: string; display?: unknown; displayRevision?: string } };
    if (!data?.view || data.view.id !== viewId || typeof data.view.displayRevision !== "string" || !/^[a-f0-9]{64}$/.test(data.view.displayRevision)) throw new Error("같은 목록의 표시 설정을 확인하지 못했습니다. 입력은 유지됩니다.");
    return { display: validateSavedViewDisplay(data.view.display), revision: data.view.displayRevision };
  }
  async function updateDisplay(reload = false) {
    if (busy || denied || !reload && conflict && !latest) return;
    const { request, current } = begin();
    const selected = validateSavedViewDisplay(draft);
    try {
      const response = await fetch(`/api/v2/saved-views/${encodeURIComponent(viewId)}`, reload ? { cache: "no-store", signal: request.signal } : { method: "PATCH", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "display", display: selected, expectedRevision: revision }) });
      if (current !== epoch.current || request.signal.aborted) return;
      if ([401, 403, 404, 423].includes(response.status)) { closeAccess(); return; }
      const body: unknown = await response.json().catch(() => null);
      if (current !== epoch.current || request.signal.aborted) return;
      if (response.status === 409) { setConflict(true); setLatest(null); throw new Error("다른 곳에서 표시 설정이 바뀌었습니다. 입력은 유지됩니다. 최신 설정을 명시적으로 불러온 뒤 다시 적용해 주세요."); }
      if (!response.ok) throw new Error(reload ? "최신 설정을 불러오지 못했습니다. 입력은 유지됩니다." : "표시 설정을 저장하지 못했습니다. 입력은 유지됩니다.");
      const fresh = parseView(body);
      if (reload) { setRevision(fresh.revision); setLatest(fresh.display); setMessage("최신 저장 기준을 확인했습니다. 아래 내 입력은 바꾸지 않았습니다. 다시 적용해야 저장됩니다."); }
      else {
        if (JSON.stringify(fresh.display) !== JSON.stringify(selected)) throw new Error("저장 응답이 선택한 표시 설정과 다릅니다. 입력은 유지됩니다.");
        setRevision(fresh.revision); setDraft(fresh.display); setConflict(false); setLatest(null); setMessage("표시 설정을 저장했습니다."); onDisplaySaved?.(fresh.display, fresh.revision); router.refresh();
      }
    } catch (caught) { if (current === epoch.current && !request.signal.aborted) setError(caught instanceof Error ? caught.message : "표시 설정을 확인하지 못했습니다."); }
    finally { if (current === epoch.current && !request.signal.aborted) setBusy(false); }
  }
  async function toggle() {
    if (busy || denied) return;
    const { request, current } = begin();
    try {
      const response = await fetch(`/api/v2/saved-views/${encodeURIComponent(viewId)}`, { method: "PATCH", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pin", pinned: !pinned }) });
      if (current !== epoch.current || request.signal.aborted) return;
      if ([401, 403, 404, 423].includes(response.status)) { closeAccess(); return; }
      const body = await response.json() as { error?: { message?: string } };
      if (current !== epoch.current || request.signal.aborted) return;
      if (!response.ok) throw new Error(body.error?.message || "고정 상태를 바꾸지 못했습니다.");
      router.refresh();
    } catch (caught) { if (current === epoch.current && !request.signal.aborted) setError(caught instanceof Error ? caught.message : "고정 상태를 바꾸지 못했습니다."); }
    finally { if (current === epoch.current && !request.signal.aborted) setBusy(false); }
  }
  return <div className="v2-saved-view-management"><div className="v2-saved-view-actions"><button disabled={busy || denied} onClick={() => void toggle()} type="button">{pinned ? <PinOff aria-hidden="true" size={15} /> : <Pin aria-hidden="true" size={15} />}{pinned ? "메뉴에서 해제" : "메뉴에 고정"}</button><button type="button" aria-expanded={open} disabled={busy || denied} onClick={() => setOpen((value) => !value)}>{open ? "표시 설정 접기" : "표시 설정"}</button></div>
    {open && !denied ? <section className="v2-saved-view-display-editor" aria-label="목록 표시 설정"><SavedViewDisplayControls value={draft} onChange={setDraft} disabled={busy} onAccessDenied={closeAccess} />
      {latest ? <p>현재 저장된 방식: {latest.layout} · {latest.density} · {latest.visibleFields.length}개 필드. 내 입력은 아래 저장 버튼으로 명시적으로 적용합니다.</p> : null}
      <footer>{conflict ? <button type="button" disabled={busy} onClick={() => void updateDisplay(true)}>최신 설정 다시 불러오기</button> : null}<button type="button" disabled={busy || conflict && !latest} onClick={() => void updateDisplay()}>{conflict ? "내 표시 설정 다시 적용" : "표시 설정 저장"}</button></footer></section> : null}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </div>;
}
