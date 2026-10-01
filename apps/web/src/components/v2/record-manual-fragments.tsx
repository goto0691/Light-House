"use client";

import { Copy, Scissors } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LinkPresentationV1, PresentedLinkSource } from "@/lib/v2/domain/link-presentation-v1";
import type { ManualLinkFragmentPage, ManualLinkFragmentReceipt, StoredManualLinkFragment } from "@/lib/v2/domain/manual-link-fragment-v1";
import type { PromptCopyRole } from "@/lib/v2/domain/prompt-curation-v1";
import { useLinkDraftRecovery, type LinkRecoveryIdentity } from "@/components/v2/editor/use-link-draft-recovery";
import { LinkDraftRecoveryControls } from "@/components/v2/editor/link-draft-recovery-controls";
import { manualFragmentRequest, manualFragmentScope, parseManualFragmentDraft, type ManualFragmentDraft, type ManualFragmentBasis } from "@/lib/v2/editor/manual-fragment-draft";
import { assertManualFragmentReceipt } from "@/lib/v2/editor/manual-fragment-receipt";
import { canonicalLinkJson } from "@/lib/v2/domain/link-snapshot-v1";
const SourceRangePicker = dynamic(() => import("@/components/v2/source-range-picker").then((module) => module.SourceRangePicker), { ssr: false, loading: () => <p>원문 선택 도구를 준비하고 있습니다.</p> });

const roles = { prompt: "프롬프트", negative_prompt: "네거티브 프롬프트", parameters: "설정값" } as const;
const coverage: Record<string, string> = { complete: "사용자가 선택한 원문 범위 확보", partial: "일부 원문만 확보", truncated: "잘린 원문",
  ocr_unverified: "OCR 미확인", selection_unverified: "선택 범위 미검증", unknown: "전체 범위 미확인" };
type Basis = ManualFragmentBasis;
type Draft = ManualFragmentDraft;
class ManualRequestError extends Error { constructor(readonly status: number, message: string, readonly code: string | null) { super(message); } }
async function responseJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json().catch(() => null);
  const detail = value && typeof value === "object" && "error" in value ? value.error : null;
  const message = detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string" ? detail.message : null;
  const code = detail && typeof detail === "object" && "code" in detail && typeof detail.code === "string" ? detail.code : null;
  if (!response.ok) throw new ManualRequestError(response.status, response.status === 409
    ? "자료 버전이 변경되었습니다. 선택 범위는 유지했습니다. 상태 새로고침 후 현재 버전으로 다시 확인해 주세요."
    : message ?? "요청을 완료하지 못했습니다.", code);
  if (!value || typeof value !== "object") throw new Error("서버 응답을 확인하지 못했습니다. 선택 범위는 유지했습니다.");
  return value as T;
}
function basisOf(data: LinkPresentationV1): Basis {
  return { expectedRevisionId: data.currentRevisionId!, expectedSnapshotId: data.selectedSnapshot!.id, expectedManifestHash: data.selectedSnapshot!.manifestHash };
}
function sameBasis(a: Basis, b: Basis) { return a.expectedRevisionId === b.expectedRevisionId && a.expectedSnapshotId === b.expectedSnapshotId && a.expectedManifestHash === b.expectedManifestHash; }
function sourceUrl(value: string | undefined) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

/** The guard unmounts all local source state when the parent becomes inaccessible. */
type Props = { recordId: string; data: LinkPresentationV1; recoveryIdentity: LinkRecoveryIdentity; onAccessDenied: () => void; onSaved?: () => void };
export function RecordManualFragments(props: Props) {
  const { recordId, data, recoveryIdentity } = props;
  if (!data.schemaAvailable || !data.selectedSnapshot || !data.currentRevisionId || data.unavailableReason || data.capabilities.reason === "restricted_record_locked") return null;
  return <ManualWorkspace key={`${recoveryIdentity.ownerId}:${recordId}`} {...props} />;
}

function ManualWorkspace({ recordId, data, recoveryIdentity, onAccessDenied, onSaved }: Props) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<Draft | null>(null);
  const [activated, setActivated] = useState(false), [localBusy, setLocalBusy] = useState(false), [conflict, setConflict] = useState(false);
  const [page, setPage] = useState<ManualLinkFragmentPage | null>(null), [busyScope, setBusyScope] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [denied, setDenied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const draftRef = useRef<Draft | null>(null), staged = useRef(false), localSequence = useRef(0);
  const sequence = useRef(0), controllers = useRef(new Set<AbortController>());
  const basis = basisOf(data), snapshotId = basis.expectedSnapshotId;
  const canWrite = Boolean(data.capabilities.canCreateManualFragment ?? data.capabilities.canCreateSnapshot) && snapshotId === data.currentSnapshotId;
  const scope = `${recordId}:${basis.expectedRevisionId}:${snapshotId}:${basis.expectedManifestHash}:${canWrite}`;
  const busy = busyScope === scope || localBusy, staleDraft = Boolean(draft && !sameBasis(draft.basis, basis));
  const recovery = useLinkDraftRecovery({ identity: recoveryIdentity, kind: "manual", parse: parseManualFragmentDraft, onAccessDenied, active: activated && !denied });
  const sources = data.members.filter((member) => member.kind === "url" && member.memberId && member.manualLink && member.rawText?.length);
  const visiblePage = page?.selectedSnapshotId === snapshotId ? page : null;
  const endpoint = `/api/v2/records/${encodeURIComponent(recordId)}/links/fragments`;

  useLayoutEffect(() => {
    const active = controllers.current;
    return () => { for (const controller of active) controller.abort(); active.clear(); localSequence.current += 1; };
  }, [scope]);
  useEffect(() => {
    if (!draft?.range) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft?.range]);

  async function operate<T>(work: (signal: AbortSignal) => Promise<T>, apply: (result: T, current: () => boolean) => void | Promise<void>, missingFragmentId?: string) {
    if (busy) return;
    const token = ++sequence.current, controller = new AbortController(); controllers.current.add(controller);
    const current = () => !controller.signal.aborted && sequence.current === token;
    setBusyScope(scope); setError(""); setMessage("");
    try { const value = await work(controller.signal); if (current()) await apply(value, current); }
    catch (caught) {
      if (!current()) return;
      if (caught instanceof ManualRequestError && ([401, 403, 423].includes(caught.status) || caught.code === "record_not_found")) {
        recovery.suspend(); staged.current = false;
        setDenied(true); setPage(null); setDraft(null); draftRef.current = null; setFallback(null);
        setError("접근 권한이나 잠금 상태가 변경되어 표시 내용을 닫았습니다. 다시 인증한 뒤 불러와 주세요.");
      } else if (caught instanceof ManualRequestError && caught.code === "manual_link_fragment_not_found" && missingFragmentId) {
        setPage((prior) => prior ? { ...prior, items: prior.items.filter((item) => item.id !== missingFragmentId) } : null);
        setFallback(null); setError("이 발췌를 더 이상 찾을 수 없어 목록에서 닫았습니다. 다른 선택은 유지했습니다. 목록을 다시 불러와 주세요.");
      } else {
        if (caught instanceof ManualRequestError && caught.status === 409) setConflict(true);
        setError(caught instanceof TypeError ? "연결을 확인해 주세요. 선택한 범위와 요청 키는 유지했습니다." : caught instanceof Error ? caught.message : "요청에 실패했습니다.");
      }
    } finally { controllers.current.delete(controller); if (current()) setBusyScope(null); }
  }
  function initialDraft(member: PresentedLinkSource): Draft {
    return parseManualFragmentDraft({ contract: "manual-fragment-draft.v1", basis, source: {
      sourceItemId: member.sourceItemId, memberId: member.memberId, memberKey: member.memberKey, contentHash: member.contentHash,
      rawText: member.rawText, manualLink: member.manualLink, sourceOrder: member.sourceOrder,
    }, role: "prompt", range: null, pending: null });
  }
  function display(next: Draft | null) { draftRef.current = next; setDraft(next); }
  function update(next: Draft) {
    const token = recovery.stage(next, `${manualFragmentScope(next.basis)}:${next.source.memberId}`);
    staged.current = true; display(next); return token;
  }
  async function local(work: () => Promise<void>) {
    if (busy) return;
    const token = ++localSequence.current;
    setLocalBusy(true); setError("");
    try { await work(); } catch (caught) { if (token === localSequence.current) setError(caught instanceof Error ? caught.message : "초안을 확인하지 못했습니다."); }
    finally { setLocalBusy(false); }
  }
  async function choose(member: PresentedLinkSource | undefined) {
    const next = member ? initialDraft(member) : null, current = draftRef.current, version = localSequence.current;
    if (staged.current) await recovery.park();
    if (version !== localSequence.current || current !== draftRef.current) throw new Error("선택 중 입력 또는 자료가 변경되었습니다. 다시 선택해 주세요.");
    staged.current = false; if (next) update(next); else display(null); setConflict(false); setError(""); setMessage("");
  }
  async function rebase() {
    if (draftRef.current?.pending && !conflict) throw new Error("이전 요청의 저장 결과를 먼저 확인해 주세요.");
    const current = draftRef.current, version = localSequence.current;
    const matching = sources.find((source) => source.sourceItemId === current?.source.sourceItemId && source.contentHash === current.source.contentHash && source.rawText === current.source.rawText);
    const next = current && matching ? { ...initialDraft(matching), role: current.role, range: current.range } : sources[0] ? initialDraft(sources[0]) : null;
    if (staged.current) await recovery.park();
    if (version !== localSequence.current || current !== draftRef.current) throw new Error("확인 중 입력 또는 자료가 변경되었습니다. 다시 확인해 주세요.");
    staged.current = false; if (next) update(next); else display(null); setConflict(false);
    setMessage(matching ? "같은 원문의 선택 범위를 현재 버전에서 다시 확인했습니다." : "원문이 달라졌습니다. 현재 자료에서 범위를 다시 선택해 주세요.");
  }
  async function load(more = false) {
    const query = new URLSearchParams({ snapshotId });
    if (more && visiblePage?.nextCursor) query.set("cursor", visiblePage.nextCursor);
    await operate((signal) => fetch(`${endpoint}?${query}`, { cache: "no-store", signal }).then(responseJson<ManualLinkFragmentPage>), (incoming) => {
      if (incoming.contract !== "manual-link-fragment.v1" || incoming.recordId !== recordId || incoming.selectedSnapshotId !== snapshotId || !Array.isArray(incoming.items)) throw new Error("요청한 자료 버전의 발췌 목록이 아닙니다.");
      setPage(more && visiblePage ? { ...incoming, items: [...visiblePage.items, ...incoming.items.filter((item) => !visiblePage.items.some((prior) => prior.id === item.id))] } : incoming);
      setDenied(false);
      if (incoming.currentRevisionId !== basis.expectedRevisionId || incoming.currentSnapshotId !== data.currentSnapshotId) setError("본문 또는 자료 버전이 변경되었습니다. 상태 새로고침 후 선택을 확인해 주세요.");
    });
  }
  async function save() {
    const currentDraft = draftRef.current;
    if (!currentDraft?.range || denied || (!currentDraft.pending && (!canWrite || staleDraft))) return;
    await operate(async (signal) => {
      // Cached source bytes never authorize a new selection or an old pending replay.
      const checked = await fetch(`/api/v2/records/${encodeURIComponent(recordId)}/links?${new URLSearchParams({ snapshotId: currentDraft.basis.expectedSnapshotId })}`, { cache: "no-store", signal }).then(responseJson<{ links: LinkPresentationV1 }>);
      const fresh = checked.links, member = fresh?.members?.find((row) => row.memberId === currentDraft.source.memberId);
      if (fresh?.contract !== "link-presentation.v1" || fresh.recordId !== recordId || fresh.unavailableReason || fresh.selectedSnapshot?.id !== currentDraft.basis.expectedSnapshotId
        || fresh.selectedSnapshot.manifestHash !== currentDraft.basis.expectedManifestHash || !member || member.sourceItemId !== currentDraft.source.sourceItemId
        || member.kind !== "url" || member.sourceOrder !== currentDraft.source.sourceOrder || member.memberKey !== currentDraft.source.memberKey || member.contentHash !== currentDraft.source.contentHash || member.rawText !== currentDraft.source.rawText
        || canonicalLinkJson(member.manualLink) !== canonicalLinkJson(currentDraft.source.manualLink)) throw new Error("보관 원문·자료 버전을 다시 확인하지 못했습니다. 초안과 요청 키는 유지했습니다.");
      if (!currentDraft.pending && (fresh.currentRevisionId !== currentDraft.basis.expectedRevisionId || fresh.currentSnapshotId !== currentDraft.basis.expectedSnapshotId
        || !(fresh.capabilities.canCreateManualFragment ?? fresh.capabilities.canCreateSnapshot))) throw new ManualRequestError(409, "자료 버전이 변경되었습니다. 선택 범위는 유지했습니다. 상태 새로고침 후 현재 버전으로 다시 확인해 주세요.", "manual_link_fragment_conflict");
      if (signal.aborted || draftRef.current !== currentDraft) throw new Error("요청 준비 중 입력이 변경되었습니다.");
      const request = currentDraft.pending ?? manualFragmentRequest(currentDraft, crypto.randomUUID());
      const token = update({ ...currentDraft, pending: request });
      if (recovery.enabled && recovery.policy.privacyLevel !== "restricted" && !await recovery.flush()) throw new Error("기기 복구 사본을 저장하지 못했습니다. 보호 정책·저장 공간을 확인하거나 기기 복구를 직접 끈 뒤 저장해 주세요.");
      if (signal.aborted) throw new Error("자료 확인 중 화면이 변경되었습니다. 요청을 보존했습니다.");
      const result = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal }).then(responseJson<ManualLinkFragmentReceipt>);
      return { result: await assertManualFragmentReceipt(result, { request, source: currentDraft.source }), token };
    }, async ({ result, token }, current) => {
      const item = result.item;
      await recovery.saved(token); if (!current()) return;
      if (item.snapshotId === snapshotId) setPage((prior) => ({ contract: result.contract, recordId, currentRevisionId: basis.expectedRevisionId, currentSnapshotId: data.currentSnapshotId,
        selectedSnapshotId: snapshotId, isHistorical: false, items: [item, ...(prior?.selectedSnapshotId === snapshotId ? prior.items.filter((row) => row.id !== item.id) : [])],
        nextCursor: prior?.selectedSnapshotId === snapshotId ? prior.nextCursor : null }));
      staged.current = false; display({ ...currentDraft, range: null, pending: null }); setConflict(false);
      setMessage("수동 발췌를 저장했습니다. 원문·본문·AI 결과는 변경하지 않았습니다.");
      onSaved?.();
    });
  }
  async function copy(item: StoredManualLinkFragment, select = false) {
    await operate((signal) => fetch(`${endpoint}/${encodeURIComponent(item.id)}?${new URLSearchParams({ snapshotId: item.snapshotId })}`, { cache: "no-store", signal })
      .then(responseJson<{ contract: string; item: StoredManualLinkFragment }>), async (result, current) => {
      if (result.contract !== "manual-link-fragment.v1" || result.item?.id !== item.id || result.item.snapshotId !== item.snapshotId
        || result.item.fragment.rawText !== item.fragment.rawText || result.item.fragment.rawTextHash !== item.fragment.rawTextHash) throw new Error("조각의 보존 정보가 변경되었습니다. 목록을 다시 불러와 주세요.");
      if (select) {
        const element = document.getElementById(`manual-source-${item.id}`);
        if (!element) throw new Error("선택할 발췌 내용을 찾지 못했습니다.");
        const range = document.createRange(); range.selectNodeContents(element);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); element.focus();
        setMessage("권한과 원문을 다시 확인했습니다. 기기의 복사 기능을 사용하세요. 줄바꿈은 기기에 따라 달라질 수 있습니다."); return;
      }
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(result.item.fragment.rawText);
        if (current()) { setFallback(null); setMessage("확인한 발췌 원문만 그대로 복사했습니다."); }
      } catch { if (current()) { setFallback(item.id); setMessage("자동 복사를 사용할 수 없습니다. 원문 선택 버튼으로 권한을 다시 확인하고 직접 복사할 수 있습니다."); } }
    }, item.id);
  }

  return <section className="v2-manual-fragments" aria-labelledby="manual-fragments-heading">
    <header><div><h3 id="manual-fragments-heading">내가 고른 원문 조각</h3><p>AI 실행과 별도로 보관합니다. 프롬프트·네거티브·설정값을 나누어 발췌하세요.</p></div>
      <button aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open); if (!open) {
        setActivated(true);
        if (!draft && !denied && !recovery.hasSuspended && sources[0]) { try { display(initialDraft(sources[0])); } catch (caught) { setError(caught instanceof Error ? caught.message : "원문을 확인하지 못했습니다."); } }
        void load();
      } }} type="button"><Scissors size={16} aria-hidden="true" />{open ? "수동 발췌 접기" : "수동 발췌 열기"}</button></header>
    <div hidden={!open}>
      {denied ? <p className="v2-manual-warning">잠금·인증 확인 필요 · 발췌 내용은 숨겼습니다.</p> : <>
        {activated ? <LinkDraftRecoveryControls recovery={recovery} label="발췌 초안 기기 복구" busy={busy} restoreDisabled={Boolean(draft?.pending) || recovery.hasSuspended}
          describe={(copy) => <>수동 발췌 · {roles[copy.role]}{copy.pending ? " · 저장 결과 미확인" : ""}</>}
          action={local} onRestore={(value) => { display(value); staged.current = true; setConflict(false); setMessage("발췌 초안을 복구했습니다. 원문을 다시 확인한 뒤 직접 저장해 주세요."); }} /> : null}
        {!canWrite ? <p className="v2-manual-warning">선택한 자료에서는 발췌를 추가할 수 없습니다. 이미 보관한 조각은 열람할 수 있습니다.</p> : null}
        {recovery.hasSuspended ? <div className="v2-manual-warning"><p>인증 오류 전에 이 화면에서 숨긴 입력이 있습니다. 다시 열 때 권한을 확인합니다. 기기 저장·자동 업로드는 하지 않습니다.</p>
          <button disabled={busy} onClick={() => void local(async () => { display(await recovery.resumeSuspended()); staged.current = true; setConflict(false); setMessage("이 화면에서 숨긴 초안을 다시 열었습니다. 직접 저장 결과를 확인해 주세요."); })} type="button">이 화면의 숨긴 초안 다시 열기</button>
        </div> : null}
        {staleDraft ? <p className="v2-manual-warning">이전 버전에서 고른 범위를 유지하고 있습니다. 현재 버전으로 다시 확인한 뒤 저장하세요.</p> : null}
        {draft?.pending ? <p className="v2-manual-warning">저장 결과를 확인하기 전에는 원문·범위·역할을 바꾸지 않습니다. 재시도는 원래 자료 버전과 같은 요청 키를 사용합니다.</p> : null}
        {draft?.pending && (staleDraft || !canWrite) ? <button disabled={busy || data.capabilities.reason === "v2_write_disabled"} onClick={() => void save()} type="button">이전 요청 결과 다시 확인</button> : null}
        {canWrite && (!draft || staleDraft || conflict) ? <button disabled={busy || recovery.hasSuspended || Boolean(draft?.pending) && !conflict} onClick={() => void local(rebase)} type="button">현재 버전으로 선택 다시 확인</button> : null}
        {draft ? <div className="v2-manual-selector">
          <div className="v2-link-version-controls"><label>발췌할 원문<select disabled={busy || !canWrite || staleDraft || Boolean(draft.pending)} value={draft.source.memberId} onChange={(event) => { const selected = sources.find((source) => source.memberId === event.target.value); void local(() => choose(selected)); }}>
            {staleDraft || !sources.some((source) => source.memberId === draft.source.memberId) ? <option value={draft.source.memberId}>복구한 자료 · {draft.source.manualLink.url}</option> : null}
            {!staleDraft ? sources.map((source) => <option key={source.memberId} value={source.memberId!}>자료 {source.sourceOrder + 1} · {source.manualLink!.url}</option>) : null}
          </select></label><label>발췌 역할<select disabled={busy || !canWrite || staleDraft || Boolean(draft.pending)} value={draft.role} onChange={(event) => update({ ...draft, role: event.target.value as PromptCopyRole })}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <p>발췌 범위 선택</p><SourceRangePicker key={`${draft.basis.expectedRevisionId}:${draft.basis.expectedSnapshotId}:${draft.source.memberId}`}
            source={draft.source.rawText} range={draft.range} disabled={busy || !canWrite || staleDraft || Boolean(draft.pending)}
            onSelection={(range, selectionError) => {
              const prior = draftRef.current;
              if (prior && !prior.pending && prior.source === draft.source && sameBasis(prior.basis, draft.basis)
                && (prior.range?.textStart !== range?.textStart || prior.range?.textEnd !== range?.textEnd)) update({ ...prior, range });
              setError(selectionError);
            }} />
          <p id="manual-selection-help">텍스트를 드래그하거나 키보드 Shift+방향키로 선택하세요. 이 칸에서는 원문을 수정하지 않습니다. 줄바꿈·공백은 원본 그대로 저장됩니다.</p>
          <p>{coverage[draft.source.manualLink.completeness]} · 전체 스레드 확보를 의미하지 않습니다.</p>
          {draft.range ? <div className="v2-manual-preview"><p>선택한 {roles[draft.role]} · 원본 위치 {draft.range.textStart}–{draft.range.textEnd}</p><pre aria-label="선택한 발췌 미리보기">{draft.source.rawText.slice(draft.range.textStart, draft.range.textEnd)}</pre></div> : <p>저장할 범위를 먼저 선택해 주세요.</p>}
          <button className="v2-link-primary" disabled={busy || !draft.range || !canWrite || staleDraft} onClick={() => void save()} type="button">선택 범위 발췌 저장</button>
          <p className="v2-link-muted">다른 원문을 선택하면 현재 초안을 먼저 보존합니다. 복구용 저장이 꺼졌거나 실패한 경우 전환을 멈추고 현재 선택을 유지합니다.</p>
        </div> : canWrite ? <p>발췌할 외부 원문 텍스트가 없습니다. 먼저 자료 추가에서 원문을 보관해 주세요.</p> : null}
        <div className="v2-link-fragments">{visiblePage?.items.map((item) => { const member = data.members.find((source) => source.memberId === item.primaryMemberId); const url = sourceUrl(member?.manualLink?.url); return <article className="v2-link-fragment" key={item.id} data-manual-fragment={item.id}>
          <header><h4>{roles[item.fragment.role]}</h4><span>원문 발췌 · 내가 선택한 범위</span></header>
          {member ? <p className="v2-manual-source">자료 {member.sourceOrder + 1} · <a href={`#source-${encodeURIComponent(member.sourceItemId)}`}>보관 원문으로 이동</a>{url ? <> · <a href={url} target="_blank" rel="noreferrer">{url}</a></> : null}</p> : <p>출처 자료를 확인할 수 없습니다. 자료 버전을 다시 불러와 주세요.</p>}
          <p>{coverage[item.fragment.completeness] ?? "확보 범위 미확인"} · {item.reviewStatus === "confirmed" ? "사용자 선택 · 사실 검증 아님" : item.reviewStatus === "rejected" ? "거절된 조각 · 원문 유지" : "이전 자료의 조각"}</p>
          <pre id={`manual-source-${item.id}`} tabIndex={0} aria-label="보관한 수동 발췌 원문">{item.fragment.rawText}</pre>
          <p>원본 위치 {item.fragment.textStart}–{item.fragment.textEnd}</p>
          <div className="v2-link-toolbar"><button disabled={busy} type="button" onClick={() => void copy(item)}><Copy size={15} aria-hidden="true" />수동 발췌 원문 복사</button>
            {fallback === item.id ? <button disabled={busy} onClick={() => void copy(item, true)} type="button">수동 발췌 원문 선택</button> : null}</div>
        </article>; })}</div>
        {visiblePage && !visiblePage.items.length ? <p>이 자료 버전에 저장한 수동 발췌가 없습니다.</p> : null}
      </>}
      <div className="v2-link-toolbar"><button disabled={busy} onClick={() => void load()} type="button">{denied ? "권한 확인하고 발췌 불러오기" : "수동 발췌 목록 새로고침"}</button>
        {visiblePage?.nextCursor && !denied ? <button disabled={busy} onClick={() => void load(true)} type="button">이전 수동 발췌 더 보기</button> : null}</div>
      {error ? <p className="v2-product-error" role="alert">{error}</p> : null}<p role="status" className="v2-manual-message">{message}</p>
    </div>
  </section>;
}
