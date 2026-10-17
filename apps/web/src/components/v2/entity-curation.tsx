"use client";

import { Check, GitMerge, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { objectParticle } from "@/lib/v2/templates/template-prompts";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(response.status === 404 ? "대상을 찾지 못했습니다. 새로 고친 뒤 다시 시도하세요." : response.status === 409 ? "그사이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요." : "저장하지 못했습니다.");
  return result;
}

/** Rename in place; the old name stays as an alternate name so later records still find this entity. */
export function EntityRenameForm({ entityId, name }: { entityId: string; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!editing) return <button className="v2-entity-action" type="button" onClick={() => { setValue(name); setEditing(true); }}><Pencil aria-hidden="true" size={14} /> 이름 고치기</button>;
  return <form className="v2-entity-rename" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await post(`/api/v2/entities/${encodeURIComponent(entityId)}/rename`, { name: value }); setEditing(false); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }}>
    <label>새 이름<input value={value} maxLength={100} required onChange={(event) => setValue(event.target.value)} autoFocus /></label>
    <button type="submit" disabled={busy || !value.trim()}><Check aria-hidden="true" size={14} /> 저장</button>
    <button type="button" onClick={() => setEditing(false)} disabled={busy}><X aria-hidden="true" size={14} /> 취소</button>
    <p>예전 이름은 다른 이름으로 남아, 그 이름으로 들어오는 기록도 이 대상에 이어집니다.</p>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}

/** Merge another entity into this one, after an explicit second confirmation. */
export function EntityMergeButton({ entityId, entityName, source }: { entityId: string; entityName: string; source: { entityId: string; name: string; kindLabel: string; links: number } }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming) return <button className="v2-entity-action" type="button" onClick={() => setConfirming(true)}><GitMerge aria-hidden="true" size={14} /> 이 대상으로 합치기</button>;
  return <div className="v2-entity-merge-confirm" role="group" aria-label="합치기 확인">
    <p>‘{source.name}’({source.kindLabel}){objectParticle(source.name)} ‘{entityName}’에 합칩니다. 연결 {source.links}개가 옮겨지고, 그 이름은 이 대상의 다른 이름으로 남습니다. 되돌리는 기능은 없습니다.</p>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { await post(`/api/v2/entities/${encodeURIComponent(entityId)}/merge`, { sourceEntityId: source.entityId, confirmed: true }); router.replace(`/v2/entities/${encodeURIComponent(entityId)}`); router.refresh(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "합치지 못했습니다."); setBusy(false); }
    }}><GitMerge aria-hidden="true" size={14} /> 합치기</button>
    <button type="button" disabled={busy} onClick={() => setConfirming(false)}>취소</button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
