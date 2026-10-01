"use client";

import { useRef, useState } from "react";
import { LinkCapturePanel } from "@/components/v2/link-capture-panel";
import { useLinkDraftRecovery, type LinkRecoveryIdentity } from "@/components/v2/editor/use-link-draft-recovery";
import { parseSnapshotDraft, snapshotRequest, snapshotScope, type SnapshotBasis, type SnapshotDraft, type SnapshotRequest } from "@/lib/v2/editor/link-snapshot-draft";

export type LinkSnapshotSelection = SnapshotRequest;

export function LinkSnapshotEditor({ sources, selectedSourceIds, disabled, basis, recoveryIdentity, onAccessDenied, onSave }: {
  sources: readonly Readonly<{ sourceItemId: string; label: string; rawText: string | null; isManual: boolean }>[];
  selectedSourceIds: readonly string[];
  disabled: boolean;
  basis: SnapshotBasis;
  recoveryIdentity: LinkRecoveryIdentity;
  onAccessDenied: () => void;
  onSave: (selection: LinkSnapshotSelection) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SnapshotDraft>(() => ({ contract: "link-snapshot-draft.v1", basis, selected: [...selectedSourceIds], additions: [], pending: null }));
  const draftRef = useRef(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const recovery = useLinkDraftRecovery({ identity: recoveryIdentity, kind: "snapshot", parse: parseSnapshotDraft, onAccessDenied });
  const { selected, additions } = draft;
  const changedBasis = snapshotScope(draft.basis) !== snapshotScope(basis);
  const bytes = sources.filter((source) => selected.includes(source.sourceItemId)).reduce((sum, source) => sum + new TextEncoder().encode(source.rawText ?? "").byteLength, 0)
    + additions.reduce((sum, source) => sum + new TextEncoder().encode(source.value).byteLength, 0);
  const manualCount = sources.filter((source) => source.isManual && selected.includes(source.sourceItemId)).length + additions.length;
  const missingSelected = selected.filter((id) => !sources.some((source) => source.sourceItemId === id));

  function update(next: SnapshotDraft) {
    draftRef.current = next; setDraft(next);
    return recovery.stage(next, snapshotScope(next.basis));
  }
  async function action(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); }
    catch (caught) { setError(caught instanceof TypeError ? "연결을 확인한 뒤 다시 저장해 주세요." : caught instanceof Error ? caught.message : "자료 버전을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function save() {
    await action(async () => {
      const current = draftRef.current;
      let request = current.pending;
      if (!request) {
        if (changedBasis) throw new Error("기준 자료가 변경되었습니다. 현재 버전으로 적용할지 먼저 확인해 주세요.");
        if (missingSelected.length) throw new Error("현재 목록에 없는 선택 자료가 있습니다. 원래 버전을 확인해 주세요.");
        if (selected.length + additions.length < 1 || selected.length + additions.length > 40) throw new Error("자료는 1–40개를 선택해 주세요.");
        if (manualCount > 20) throw new Error("한 자료 버전의 수동 링크 원문은 20개까지 보관할 수 있습니다.");
        if (bytes > 100_000) throw new Error("선택한 원문은 UTF-8 기준 100,000 bytes 이하여야 합니다. 내용을 자르지 않고 선택을 조정해 주세요.");
        request = snapshotRequest(current, crypto.randomUUID());
      }
      const saveToken = update({ ...current, pending: request });
      if (recovery.enabled && recovery.policy.privacyLevel !== "restricted" && !await recovery.flush()) throw new Error("기기 복구 사본을 저장하지 못했습니다. 보호 정책·저장 공간을 확인하거나 기기 복구를 직접 끈 뒤 서버에 저장해 주세요.");
      try { await onSave(request); }
      catch (caught) {
        if (caught && typeof caught === "object" && "status" in caught && caught.status === 409) setConflict(true);
        throw caught;
      }
      await recovery.saved(saveToken);
    });
  }

  return <section className="v2-link-snapshot-editor" aria-label="자료 버전 편집">
    <p>선택 변경과 추가 원문은 새 자료 버전으로 보관합니다. 이전 원문은 삭제하지 않으며 AI 분석은 별도로 요청합니다.</p>
    <aside className="v2-link-recovery" aria-label="자료 초안 기기 복구">
      <p className="v2-link-muted">기기 복구 사본은 서버 저장이 아닙니다. 복구해도 자동 업로드하지 않습니다. 브라우저 데이터 삭제·기기 장애에 대비해 서버에 저장해 주세요.</p>
      {recovery.policy.privacyLevel === "restricted" ? <p>제한된 기록은 기기에 저장하지 않습니다.</p> : <label>
        <input checked={recovery.enabled} disabled={busy} onChange={(event) => { const checked = event.target.checked; void action(() => recovery.consent(checked)); }} type="checkbox" />
        {recovery.policy.privacyLevel === "sensitive" ? "민감 초안을 이 기기에 암호화하여 복구하는 데 동의" : "이 화면의 초안을 이 기기에 복구용으로 저장"}
      </label>}
      <p role="status">{!recovery.enabled || recovery.policy.privacyLevel === "restricted" ? "기기 복구 꺼짐 · 미저장 입력은 현재 화면에서만 유지" : recovery.status}</p>
      {recovery.copies.length ? <div><p>이 기록의 다른 자료 초안 {recovery.copies.length}개 · 내용은 복구를 선택한 뒤 표시합니다.</p><ul>
        {recovery.copies.map((copy) => <li key={copy.id}><span>{new Date(copy.updatedAt).toLocaleString("ko-KR")} · 기준 v{copy.payload.basis.expectedSnapshotVersion}{copy.payload.pending ? " · 저장 결과 미확인" : ""}</span>
          <button disabled={busy || disabled || !recovery.ready || Boolean(draft.pending)} onClick={() => void action(async () => { const restored = await recovery.restore(copy); draftRef.current = restored; setDraft(restored); setConflict(false); })} type="button">이 초안 복구</button>
          <button disabled={busy} onClick={() => void action(() => recovery.discard(copy))} type="button">이 기기 사본 삭제</button>
        </li>)}
      </ul></div> : null}
    </aside>
    {draft.pending ? <p className="v2-link-warning">저장 요청을 보존하고 있습니다. 결과 재확인 전에는 내용을 바꾸지 않습니다. 재시도는 원래 기준 버전과 같은 요청 키를 사용합니다.</p> : null}
    {changedBasis || conflict ? <div className="v2-link-warning"><p>초안 기준 v{draft.basis.expectedSnapshotVersion} · 서버 현재 v{basis.expectedSnapshotVersion}. 최신 원문을 확인한 뒤 적용해 주세요. 과거 초안은 자동으로 새 버전으로 바꾸지 않습니다.</p>
      <button disabled={disabled || busy || Boolean(draft.pending) && !conflict} onClick={() => { update({ ...draft, basis, pending: null }); setConflict(false); setError(""); }} type="button">현재 자료 버전을 기준으로 편집 계속</button>
    </div> : null}
    {missingSelected.length ? <p role="alert">초안의 선택 자료 {missingSelected.length}개를 현재 목록에서 찾지 못했습니다. 선택을 자동 삭제하지 않았습니다.</p> : null}
    <fieldset disabled={disabled || busy || Boolean(draft.pending)}><legend>이 버전에 포함할 기존 자료</legend>
      {sources.length ? sources.map((source) => <label key={source.sourceItemId}>
        <input checked={selected.includes(source.sourceItemId)} onChange={(event) => update({ ...draft, selected: event.target.checked ? [...selected, source.sourceItemId] : selected.filter((id) => id !== source.sourceItemId) })} type="checkbox" />
        <span>{source.label}</span>
      </label>) : <p>아래에 출처 URL과 원문을 추가해 주세요.</p>}
    </fieldset>
    <LinkCapturePanel context="snapshot" disabled={disabled || busy || Boolean(draft.pending)} items={additions} nextOrder={Math.max(-1, ...additions.map((item) => item.order)) + 1} onChange={(items) => update({ ...draft, additions: items })} />
    <p className="v2-link-budget">선택 {selected.length + additions.length}/40개 · 수동 링크 {manualCount}/20개 · 원문 {bytes.toLocaleString("ko-KR")}/100,000 bytes</p>
    {error ? <p className="v2-product-error" role="alert">{error} 입력 내용은 유지되어 있습니다.</p> : null}
    <button className="v2-link-primary" disabled={disabled || busy} onClick={() => void save()} type="button">{busy ? "자료 버전 저장 중" : "새 자료 버전 저장"}</button>
  </section>;
}
