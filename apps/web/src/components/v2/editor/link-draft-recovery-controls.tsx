"use client";

import type { ReactNode } from "react";
import type { useLinkDraftRecovery } from "./use-link-draft-recovery";

export function LinkDraftRecoveryControls<T>({ recovery, label, busy, restoreDisabled, describe, onRestore, action }: {
  recovery: ReturnType<typeof useLinkDraftRecovery<T>>;
  label: string;
  busy: boolean;
  restoreDisabled?: boolean;
  describe: (payload: T) => ReactNode;
  onRestore: (payload: T) => void;
  action: (work: () => Promise<void>) => Promise<void>;
}) {
  return <aside className="v2-link-recovery" aria-label={label}>
    <p className="v2-link-muted">기기 복구 사본은 서버 저장이 아닙니다. 복구해도 자동 업로드하지 않습니다. 브라우저 데이터 삭제·기기 장애에 대비해 서버에 저장해 주세요.</p>
    {recovery.policy.privacyLevel === "restricted" ? <p>제한된 기록은 기기에 저장하지 않습니다.</p> : <label>
      <input checked={recovery.enabled} disabled={busy} onChange={(event) => { const value = event.target.checked; void action(() => recovery.consent(value)); }} type="checkbox" />
      {recovery.policy.privacyLevel === "sensitive" ? "민감 초안을 이 기기에 암호화하여 복구하는 데 동의" : "이 화면의 초안을 이 기기에 복구용으로 저장"}
    </label>}
    <p aria-live="polite" data-testid="link-draft-recovery-status">{!recovery.enabled || recovery.policy.privacyLevel === "restricted" ? "기기 복구 꺼짐 · 미저장 입력은 현재 화면에서만 유지" : recovery.status}</p>
    {recovery.copies.length ? <div><p>이 기록의 다른 초안 {recovery.copies.length}개 · 내용은 복구를 선택한 뒤 표시합니다.</p><ul>
      {recovery.copies.map((copy) => <li key={copy.id}><span>{new Date(copy.updatedAt).toLocaleString("ko-KR")} · {describe(copy.payload)}</span>
        <button disabled={busy || restoreDisabled || !recovery.ready} onClick={() => void action(async () => onRestore(await recovery.restore(copy)))} type="button">이 초안 복구</button>
        <button disabled={busy} onClick={() => void action(() => recovery.discard(copy))} type="button">이 기기 사본 삭제</button>
      </li>)}
    </ul></div> : null}
  </aside>;
}
