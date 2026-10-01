"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Layers } from "lucide-react";
import { CurationImagePreview, PromptCurationEditor, curationRoles, type CurationBasis, type CurationCandidate, type CurationDraft, type CurationImage } from "@/components/v2/prompt-curation-editor";
import { PromptCurationMigration } from "@/components/v2/prompt-curation-migration";
import { useLinkDraftRecovery, type LinkRecoveryIdentity } from "@/components/v2/editor/use-link-draft-recovery";
import { LinkDraftRecoveryControls } from "@/components/v2/editor/link-draft-recovery-controls";
import { capturePromptCurationDraft, parsePromptCurationDraft, promptCurationDraftRequest, promptCurationScope, type PromptCurationRecoveryDraft, type PromptCurationPending } from "@/lib/v2/editor/prompt-curation-draft";
import { assertPromptCurationAiEvidence, assertPromptCurationReceipt } from "@/lib/v2/editor/prompt-curation-receipt";
import { authorizedReadBatch } from "@/lib/v2/editor/authorized-read-batch";
import type { LinkPresentationV1 } from "@/lib/v2/domain/link-presentation-v1";
import type { PromptCurationMigrationPlan } from "@/lib/v2/domain/prompt-curation-migration";
import { assertMigrationPreview, assertMigrationRecovery, assertMigrationRecoveryReceipt } from "@/lib/v2/domain/prompt-curation-migration-response";
import { capturePromptCurationMigrationDraft, parsePromptCurationMigrationDraft, promptCurationMigrationScope, type PromptCurationMigrationDraft } from "@/lib/v2/editor/prompt-curation-migration-draft";
import type { MigratePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import type { ManualLinkFragmentPage, StoredManualLinkFragment } from "@/lib/v2/domain/manual-link-fragment-v1";
import type { PromptCopyRole, PromptCurationCopy } from "@/lib/v2/domain/prompt-curation-v1";
import type { PromptCurationDetail, PromptCurationPage, StoredPromptCuration } from "@/lib/v2/domain/stored-prompt-curation";

const warningLabels: Record<string, string> = { unknown_total_parts: "전체 조각 수 미상", unknown_part_numbers: "파트 번호 미상", missing_parts: "누락된 파트 있음",
  conflicting_part_claims: "파트 정보 상충", duplicate_part_number: "파트 번호 중복", partial_source: "일부 원문만 확보", ocr_unverified: "OCR 미확인",
  selection_unverified: "선택 범위 미검증", unknown_source_completeness: "원문 확보 범위 미상", duplicate_text_preserved: "중복 원문 유지", image_pair_unconfirmed: "이미지 대응 미확인" };
const blockedLabels: Record<string, string> = { empty_channel: "이 역할의 조각 없음", relation_not_continuation: "이어지는 조각으로 확인되지 않은 묶음", relationship_unconfirmed: "연결 관계 확인 필요", order_unconfirmed: "순서 확인 필요" };
const relationLabels = { continuation: "이어지는 조각", collection: "같은 자료 묶음", alternatives: "서로 다른 판본" };
class CurationRequestError extends Error { constructor(readonly status: number, readonly code: string | null, message: string) { super(message); } }
function accessDenied(error: unknown) {
  return error instanceof CurationRequestError && ([401, 403, 423].includes(error.status)
    || ["record_not_found", "link_record_not_found"].includes(error.code ?? "") || error.status === 404 && !error.code);
}
async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new CurationRequestError(response.status, typeof value?.error?.code === "string" ? value.error.code : null,
    response.status === 503 ? "정리본 기능이 아직 준비되지 않았습니다. 보관 원문과 현재 입력은 유지합니다."
      : response.status === 409 ? "저장 상태나 원문 버전이 달라졌습니다. 입력을 유지했습니다. 최신 상태를 확인하고 다시 적용해 주세요."
      : typeof value?.error?.message === "string" ? value.error.message : "요청을 완료하지 못했습니다.");
  if (!value || typeof value !== "object") throw new Error("서버 응답을 확인하지 못했습니다. 입력과 요청 키는 유지했습니다.");
  return value as T;
}
function basisOf(data: LinkPresentationV1): CurationBasis { return { expectedRevisionId: data.currentRevisionId!, expectedSnapshotId: data.selectedSnapshot!.id, expectedManifestHash: data.selectedSnapshot!.manifestHash }; }
function sameBasis(a: CurationBasis, b: CurationBasis) { return a.expectedRevisionId === b.expectedRevisionId && a.expectedSnapshotId === b.expectedSnapshotId && a.expectedManifestHash === b.expectedManifestHash; }
function writable(data: LinkPresentationV1) { return Boolean(data.selectedSnapshot && data.selectedSnapshot.id === data.currentSnapshotId && (data.capabilities.canCreateManualFragment ?? data.capabilities.canCreateSnapshot)); }
function candidatesOf(data: LinkPresentationV1, manual: ManualLinkFragmentPage | null): CurationCandidate[] {
  const selected = data.selectedSnapshot?.id;
  const result: CurationCandidate[] = (manual && manual.selectedSnapshotId === selected ? manual.items : []).filter((item) => item.reviewStatus === "confirmed" && item.snapshotId === selected)
    .map((item) => ({ id: item.id, snapshotId: item.snapshotId, memberId: item.primaryMemberId, rawText: item.fragment.rawText,
      role: item.fragment.role, stateVersion: item.stateVersion, completeness: item.fragment.completeness, origin: "manual" }));
  for (const item of data.fragments) if (item.snapshotId === selected && item.sourceClass === "source_extract" && item.rawText !== null
    && item.role in curationRoles && !["rejected", "superseded"].includes(item.reviewStatus) && !result.some((row) => row.id === item.id)) {
    result.push({ id: item.id, snapshotId: item.snapshotId, memberId: item.primaryMemberId, rawText: item.rawText, role: item.role as PromptCopyRole,
      stateVersion: item.stateVersion, completeness: item.completeness, origin: "ai" });
  }
  return result.map((row) => {
    const source = data.members.find((member) => member.memberId === row.memberId);
    return { ...row, sourceItemId: source?.sourceItemId, sourceUrl: safeSourceUrl(source?.manualLink?.url) };
  });
}
function safeSourceUrl(value: string | undefined) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function storedCandidates(item: StoredPromptCuration, data?: LinkPresentationV1): CurationCandidate[] {
  return item.content.items.flatMap((selection) => { const original = item.items.find((row) => row.itemKey === selection.itemKey); return original ? [{
    id: selection.fragmentId, snapshotId: item.snapshotId, memberId: data?.members.find((row) => row.memberKey === original.fragment.memberKey)?.memberId ?? "", rawText: original.fragment.rawText, role: original.copyRole,
    stateVersion: selection.expectedFragmentStateVersion, completeness: original.fragment.completeness, origin: "stored" as const, isManual: original.fragment.selectionOrigin === "user_selected",
    sourceItemId: data?.members.find((row) => row.memberKey === original.fragment.memberKey)?.sourceItemId,
    sourceUrl: safeSourceUrl(data?.members.find((row) => row.memberKey === original.fragment.memberKey)?.manualLink?.url),
  }] : []; });
}
function imagesOf(data: LinkPresentationV1): CurationImage[] {
  return data.members.flatMap((member) => member.kind === "image" && member.memberId ? member.attachments.filter((a) => a.mimeType.startsWith("image/")).map((a) => ({
    key: JSON.stringify([member.memberId, a.id]), memberId: member.memberId!, attachmentId: a.id, filename: a.filename,
  })) : []);
}
type Pending = PromptCurationPending;
type Fresh = { scope: string; links: LinkPresentationV1; detail: PromptCurationDetail | null; manual: ManualLinkFragmentPage; draftGroup: string | null };
type CopyRequest = { groupKey: string; revisionId: string; role: PromptCopyRole; mode: "standard" | "available_only" };
type CopyReceipt = PromptCurationCopy & { contract: string; revisionId: string };
type MigrationReview = { scope: string; key: string; source: StoredPromptCuration; target: LinkPresentationV1; plan: PromptCurationMigrationPlan;
  request: MigratePromptCurationRequest; attempted: boolean; conflict: boolean; saved: StoredPromptCuration | null };

type Props = { recordId: string; data: LinkPresentationV1; recoveryIdentity: LinkRecoveryIdentity; onAccessDenied: () => void; manualRevision?: number; onOpenSnapshot?: (snapshotId: string) => void };
export function RecordPromptCurations({ recordId, data, recoveryIdentity, onAccessDenied, manualRevision = 0, onOpenSnapshot }: Props) {
  if (!data.currentRevisionId || !data.selectedSnapshot || data.unavailableReason || data.capabilities.reason === "restricted_record_locked") return null;
  return <CurationWorkspace key={`${recoveryIdentity.ownerId}:${recordId}`} recordId={recordId} incoming={data} recoveryIdentity={recoveryIdentity} onAccessDenied={onAccessDenied} manualRevision={manualRevision} onOpenSnapshot={onOpenSnapshot} />;
}

function CurationWorkspace({ recordId, incoming, recoveryIdentity, onAccessDenied, manualRevision, onOpenSnapshot }: Omit<Props, "data"> & { incoming: LinkPresentationV1; manualRevision: number }) {
  const [open, setOpen] = useState(false), [editorOpen, setEditorOpen] = useState(true), [draft, setDraft] = useState<CurationDraft | null>(null);
  const [page, setPage] = useState<PromptCurationPage | null>(null), [manual, setManual] = useState<ManualLinkFragmentPage | null>(null), [detail, setDetail] = useState<PromptCurationDetail | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [denied, setDenied] = useState(false), [busyScope, setBusyScope] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false), [fresh, setFresh] = useState<Fresh | null>(null), [pendingVisible, setPendingVisible] = useState(false);
  const [activated, setActivated] = useState(false), [localBusy, setLocalBusy] = useState(false);
  const draftRef = useRef<PromptCurationRecoveryDraft | null>(null), staged = useRef(false), localSequence = useRef(0);
  const [verified, setVerified] = useState<{ stamp: string; data: LinkPresentationV1 } | null>(null);
  const [fallback, setFallback] = useState<{ scope: string; request: CopyRequest; receipt: CopyReceipt } | null>(null);
  const [migration, setMigration] = useState<MigrationReview | null>(null);
  const [migrationHidden, setMigrationHidden] = useState(false);
  const [migrationDraft, setMigrationDraft] = useState<PromptCurationMigrationDraft | null>(null);
  const migrationRef = useRef<PromptCurationMigrationDraft | null>(null);
  const pending = useRef<Pending | null>(null), sequence = useRef(0), running = useRef<{ scope: string; controller: AbortController } | null>(null);
  const automaticRead = useRef<string | null>(null);
  const selectionElement = useRef<HTMLPreElement>(null);
  const stamp = JSON.stringify([incoming.currentRevisionId, incoming.currentSnapshotId, incoming.selectedSnapshot?.id, incoming.selectedSnapshot?.manifestHash,
    incoming.capabilities, incoming.selectedRun?.id, incoming.fragments.map((row) => [row.id, row.stateVersion, row.reviewStatus])]);
  const data = verified?.stamp === stamp ? verified.data : incoming;
  const basis = basisOf(data), canWrite = writable(data), snapshotId = basis.expectedSnapshotId;
  const scope = JSON.stringify([recordId, basis, canWrite, stamp]);
  const busy = busyScope === scope || localBusy, visiblePage = page?.selectedSnapshotId === snapshotId ? page : null;
  const recovery = useLinkDraftRecovery({ identity: recoveryIdentity, kind: "curation", parse: parsePromptCurationDraft, onAccessDenied, active: activated && !denied });
  const migrationRecovery = useLinkDraftRecovery({ identity: recoveryIdentity, kind: "migration", parse: parsePromptCurationMigrationDraft, onAccessDenied, active: activated && !denied });
  const visibleDetail = detail?.item.snapshotId === snapshotId ? detail : null;
  // A recovered migration has its own exact source/target, independent of the
  // currently selected detail. Changing scope conceals proof until a fresh read.
  const visibleMigration = migration?.scope === scope ? migration : null;
  const candidates = candidatesOf(data, manual), images = imagesOf(data), stale = Boolean(draft && !sameBasis(draft.basis, basis));
  const endpoint = `/api/v2/records/${encodeURIComponent(recordId)}/links`, groupsEndpoint = `${endpoint}/curations`;

  useLayoutEffect(() => {
    return () => { running.current?.controller.abort(); running.current = null; localSequence.current += 1; };
  }, [scope]);
  useEffect(() => {
    if (!draft?.dirty && !pendingVisible && !(migration?.attempted && !migration.saved)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [draft?.dirty, pendingVisible, migration?.attempted, migration?.saved]);
  async function operate<T>(work: (signal: AbortSignal) => Promise<T>, apply: (result: T, current: () => boolean) => void | Promise<void>, onConflict?: () => void) {
    if (running.current?.scope === scope) return;
    const token = ++sequence.current, controller = new AbortController(); running.current = { scope, controller };
    const current = () => !controller.signal.aborted && sequence.current === token;
    setBusyScope(scope); setError(""); setMessage("");
    try { const result = await work(controller.signal); if (current()) await apply(result, current); }
    catch (caught) {
      if (!current()) return;
      if (accessDenied(caught)) {
        recovery.suspend(); migrationRecovery.suspend(); staged.current = false; draftRef.current = null;
        migrationRef.current = null; setMigrationDraft(null);
        setDenied(true); setPage(null); setManual(null); setDetail(null); setDraft(null); setFallback(null); setFresh(null); setVerified(null);
        pending.current = null; setPendingVisible(false); setConflict(false); setMigration(null);
        setError("접근 권한이나 잠금 상태가 변경되어 정리본·입력·복사 내용을 닫았습니다. 다시 인증한 뒤 불러와 주세요.");
      } else {
        if (caught instanceof CurationRequestError && caught.status === 409) {
          if (onConflict) onConflict();
          else { setConflict(true); setFresh(null); }
        }
        setError(caught instanceof TypeError ? "연결을 확인해 주세요. 입력과 같은 요청 키를 유지했습니다." : caught instanceof Error ? caught.message : "요청에 실패했습니다.");
      }
    } finally { if (current()) { running.current = null; setBusyScope(null); } }
  }
  function validatePage(result: PromptCurationPage) {
    if (result.contract !== "stored-prompt-curation.v1" || result.recordId !== recordId || result.selectedSnapshotId !== snapshotId || !Array.isArray(result.items)) throw new Error("요청한 자료의 정리본 목록이 아닙니다.");
  }
  function validateManual(result: ManualLinkFragmentPage, selected = snapshotId) {
    if (result.contract !== "manual-link-fragment.v1" || result.recordId !== recordId || result.selectedSnapshotId !== selected || !Array.isArray(result.items)) throw new Error("요청한 자료의 수동 조각 목록이 아닙니다.");
  }
  async function fetchDetail(groupKey: string, signal: AbortSignal, revisionId?: string, cursor?: string) {
    const query = new URLSearchParams(); if (revisionId) query.set("revisionId", revisionId); if (cursor) query.set("cursor", cursor);
    const result = await fetch(`${groupsEndpoint}/${encodeURIComponent(groupKey)}${query.size ? `?${query}` : ""}`, { cache: "no-store", signal }).then(responseJson<PromptCurationDetail>);
    if (result.contract !== "stored-prompt-curation.v1" || result.recordId !== recordId || result.item?.groupKey !== groupKey || revisionId && result.item.id !== revisionId || !Array.isArray(result.history?.items)) throw new Error("요청한 정리본 버전과 응답이 다릅니다.");
    return result;
  }
  async function refresh(more = false) {
    const query = new URLSearchParams({ snapshotId }); if (more && visiblePage?.nextCursor) query.set("cursor", visiblePage.nextCursor);
    await operate(async (signal) => {
      const [groups, fragments] = await authorizedReadBatch([fetch(`${groupsEndpoint}?${query}`, { cache: "no-store", signal }).then(responseJson<PromptCurationPage>),
        fetch(`${endpoint}/fragments?${new URLSearchParams({ snapshotId })}`, { cache: "no-store", signal }).then(responseJson<ManualLinkFragmentPage>)] as const, accessDenied);
      validatePage(groups); validateManual(fragments); return { groups, fragments };
    }, ({ groups, fragments }) => {
      setPage(more && visiblePage ? { ...groups, items: [...visiblePage.items, ...groups.items.filter((row) => !visiblePage.items.some((prior) => prior.id === row.id))] } : groups);
      setManual(fragments); setDenied(false);
      if (groups.currentRevisionId !== basis.expectedRevisionId || groups.currentSnapshotId !== data.currentSnapshotId) {
        setConflict(true); setError("본문 또는 자료 버전이 변경되었습니다. 최신 상태를 확인해 주세요.");
      }
    });
  }
  async function moreManual() {
    if (!manual?.nextCursor) return;
    await operate((signal) => fetch(`${endpoint}/fragments?${new URLSearchParams({ snapshotId, cursor: manual.nextCursor! })}`, { cache: "no-store", signal }).then(responseJson<ManualLinkFragmentPage>), (result) => {
      validateManual(result); setManual({ ...result, items: [...manual.items, ...result.items.filter((row) => !manual.items.some((prior) => prior.id === row.id))] });
    });
  }
  async function loadDetail(groupKey: string, revisionId?: string, more = false) {
    setFallback(null);
    await operate((signal) => fetchDetail(groupKey, signal, revisionId, more ? visibleDetail?.history.nextCursor ?? undefined : undefined), (result) => {
      // Selecting an older revision must not throw away already paged history
      // (including the selected button). Explicit latest reload starts fresh.
      setDetail((more || revisionId) && visibleDetail?.item.groupKey === groupKey ? { ...result, history: {
        nextCursor: more ? result.history.nextCursor : visibleDetail.history.nextCursor,
        items: [...result.history.items, ...visibleDetail.history.items.filter((row) => !result.history.items.some((prior) => prior.id === row.id))]
          .sort((a, b) => b.revisionNumber - a.revisionNumber),
      } } : result);
    });
  }
  function display(value: PromptCurationRecoveryDraft | null) {
    draftRef.current = value; pending.current = value?.pending ?? null; setPendingVisible(Boolean(value?.pending));
    setDraft(value?.draft ? { ...value.draft, originals: value.draft.originals.map((row) => ({ ...row,
      memberId: row.memberId ?? "", isManual: row.isManual ?? undefined, sourceItemId: row.sourceItemId ?? undefined, sourceUrl: row.sourceUrl ?? undefined })) } : null);
  }
  function update(value: unknown) {
    const next = capturePromptCurationDraft(value), token = recovery.stage(next, promptCurationScope(next));
    staged.current = true; display(next); return token;
  }
  async function local(work: () => Promise<void>) {
    if (busy) return;
    const version = ++localSequence.current; setLocalBusy(true); setError("");
    try { await work(); } catch (caught) { if (version === localSequence.current) setError(caught instanceof Error ? caught.message : "초안을 확인하지 못했습니다."); }
    finally { setLocalBusy(false); }
  }
  async function park() {
    const prior = draftRef.current, version = localSequence.current;
    if (staged.current) await recovery.park();
    if (version !== localSequence.current || prior !== draftRef.current) throw new Error("초안 보존 중 입력 또는 자료가 변경되었습니다. 전환을 다시 선택해 주세요.");
    staged.current = false; display(null); setFresh(null); setConflict(false);
  }
  async function start(item?: StoredPromptCuration) {
    if (!canWrite || denied || pending.current || recovery.hasSuspended) return;
    const next = capturePromptCurationDraft({ contract: "prompt-curation-draft.v1", pending: null, draft: { basis, groupKey: item?.groupKey ?? crypto.randomUUID(), head: item ? { id: item.id, revisionNumber: item.revisionNumber } : null,
      content: item ? structuredClone(item.content) : { title: "", relationKind: "continuation", relationshipConfirmation: "unconfirmed", orderConfirmation: "unconfirmed", items: [], examples: [] },
      originals: item ? storedCandidates(item, data) : [], dirty: false, conflict: false } });
    await park(); update(next); setEditorOpen(true); setError("");
  }
  function updateDraft(content: CurationDraft["content"], originals?: CurationCandidate[]) {
    if (!draft || pending.current || denied || recovery.hasSuspended) return;
    try { update({ contract: "prompt-curation-draft.v1", pending: null, draft: { ...draft, content, originals: originals ?? draft.originals, dirty: true } }); setFresh(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "입력을 보존하지 못했습니다."); }
  }
  async function mutate(request: Pending) {
    if (denied || conflict || recovery.hasSuspended || data.capabilities.reason === "v2_write_disabled") return;
    const original = draftRef.current;
    if (!original || original.pending !== request) return;
    await operate(async (signal) => {
      const token = update(original);
      if (recovery.enabled && recovery.policy.privacyLevel !== "restricted" && !await recovery.flush()) throw new Error("기기 복구 사본을 저장하지 못했습니다. 보호 설정·저장 공간을 확인하거나 복구를 직접 끈 뒤 시도해 주세요.");
      // Recovery supplies intent, never permission. Resolve the original snapshot
      // and revision IDs afresh; a newer document must not rewrite a pending body.
      const { links: snapshot } = await fetch(`${endpoint}?${new URLSearchParams({ snapshotId: request.request.expectedSnapshotId })}`, { cache: "no-store", signal }).then(responseJson<{ links: LinkPresentationV1 }>);
      if (snapshot?.capabilities?.reason === "restricted_record_locked") throw new CurationRequestError(423, "restricted_record_locked", "잠금 확인 필요");
      if (snapshot?.contract !== "link-presentation.v1" || snapshot.recordId !== recordId || snapshot.unavailableReason
        || snapshot.selectedSnapshot?.id !== request.request.expectedSnapshotId || snapshot.selectedSnapshot.manifestHash !== request.request.expectedManifestHash) throw new Error("원래 자료 버전의 원문을 확인하지 못했습니다. 요청과 초안을 유지했습니다.");
      const parent = request.kind === "revise" ? (await fetchDetail(request.groupKey, signal, request.request.expectedCurationRevisionId)).item : null;
      const restoreTarget = request.kind === "revise" && request.request.action === "undo" ? (await fetchDetail(request.groupKey, signal, request.request.restoreRevisionId)).item : null;
      const manualIds = [...new Set(request.originals.filter((row) => row.origin === "manual" || row.isManual).map((row) => row.id))];
      const manualFragments: StoredManualLinkFragment[] = [];
      for (let offset = 0; offset < manualIds.length; offset += 4) {
        const items = await authorizedReadBatch(manualIds.slice(offset, offset + 4).map(async (id) => {
          const value = await fetch(`${endpoint}/fragments/${encodeURIComponent(id)}?${new URLSearchParams({ snapshotId: request.request.expectedSnapshotId })}`, { cache: "no-store", signal }).then(responseJson<{ contract: string; item: StoredManualLinkFragment }>);
          if (value.contract !== "manual-link-fragment.v1" || value.item?.id !== id || value.item.snapshotId !== request.request.expectedSnapshotId) throw new Error("선택한 원문 조각을 확인하지 못했습니다. 요청을 유지했습니다.");
          return value.item;
        }), accessDenied); manualFragments.push(...items);
      }
      // Resolve old AI selections by exact ID, never by matching text or the
      // currently displayed run. This remains separate historical proof.
      const aiIds = "content" in request.request ? [...new Set(request.originals.filter((row) => row.origin === "ai" || row.isManual === false).map((row) => row.id))] : [];
      const evidence: unknown[] = [];
      for (let offset = 0; offset < aiIds.length; offset += 4) {
        evidence.push(...await authorizedReadBatch(aiIds.slice(offset, offset + 4).map((id) => fetch(`${endpoint}/fragments/${encodeURIComponent(id)}/evidence?${new URLSearchParams({
          snapshotId: request.request.expectedSnapshotId, manifestHash: request.request.expectedManifestHash,
        })}`, { cache: "no-store", signal }).then(responseJson<unknown>)), accessDenied));
      }
      const context = { recordId, pending: request, snapshot, parent, restoreTarget, manualFragments };
      const aiFragments = await assertPromptCurationAiEvidence(evidence, context);
      if (signal.aborted || pending.current?.request.idempotencyKey !== request.request.idempotencyKey) throw new Error("요청 확인 중 화면 또는 입력이 변경되었습니다.");
      const url = request.kind === "create" ? groupsEndpoint : `${groupsEndpoint}/${encodeURIComponent(request.groupKey)}/revisions`;
      const value = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.request), signal }).then(responseJson<unknown>);
      const result = await assertPromptCurationReceipt(value, { ...context, aiFragments });
      // An exact replay may be older than the group's head. Never label that
      // receipt as latest or offer an edit against the wrong parent revision.
      const latest = result.replayed ? await fetchDetail(request.groupKey, signal) : null;
      return { result, latest, token };
    }, async ({ result, latest, token }, current) => {
      await recovery.saved(token); if (!current()) return;
      const item = latest?.item ?? result.item;
      if (item.snapshotId === snapshotId) {
      setDetail({ contract: result.contract, recordId, currentRevisionId: basis.expectedRevisionId, currentSnapshotId: data.currentSnapshotId, isHistorical: false,
        item, head: { id: item.id, revisionNumber: item.revisionNumber }, history: {
          items: [item, ...(visibleDetail?.item.groupKey === item.groupKey ? visibleDetail.history.items.filter((prior) => prior.id !== item.id) : [])],
          nextCursor: visibleDetail?.item.groupKey === item.groupKey ? visibleDetail.history.nextCursor : null,
        } });
      if (latest) setDetail(latest);
      setPage((prior) => ({ contract: result.contract, recordId, currentRevisionId: basis.expectedRevisionId, currentSnapshotId: data.currentSnapshotId,
        selectedSnapshotId: snapshotId, isHistorical: false, items: [item, ...(prior?.selectedSnapshotId === snapshotId ? prior.items.filter((row) => row.groupKey !== item.groupKey) : [])], nextCursor: prior?.selectedSnapshotId === snapshotId ? prior.nextCursor : null }));
      }
      staged.current = false; display(null); setFresh(null); setConflict(false); setFallback(null);
      setMessage(result.replayed ? `이전 요청의 정리본 ${result.item.revisionNumber}번째 버전 저장을 확인했습니다. 새 버전은 만들지 않았습니다.` : `정리본 ${item.revisionNumber}번째 버전을 저장했습니다. 원문과 이전 버전은 유지했습니다.`);
    });
  }
  async function save() {
    if (!draft || stale || draft.conflict || !canWrite || pending.current || !draftRef.current) return;
    try {
      const operation = promptCurationDraftRequest(draftRef.current, crypto.randomUUID());
      update({ ...draftRef.current, pending: operation }); await mutate(pending.current!);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "정리본 요청을 준비하지 못했습니다."); }
  }
  async function transition(action: "undo" | "archive" | "unarchive") {
    if (!visibleDetail || !canWrite || draft || pending.current || recovery.hasSuspended) return;
    try {
      update({ contract: "prompt-curation-draft.v1", draft: null, pending: { kind: "revise", groupKey: visibleDetail.item.groupKey,
        request: { ...basis, idempotencyKey: crypto.randomUUID(), expectedCurationRevisionId: visibleDetail.head.id, expectedCurationRevisionNumber: visibleDetail.head.revisionNumber, action,
          ...(action === "undo" ? { restoreRevisionId: visibleDetail.item.id } : {}) }, originals: storedCandidates(visibleDetail.item, data) } });
      await mutate(pending.current!);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "정리본 요청을 준비하지 못했습니다."); }
  }
  const migrationUrl = (source: StoredPromptCuration) => `${groupsEndpoint}/${encodeURIComponent(source.groupKey)}/revisions/${encodeURIComponent(source.id)}/migration`;
  function displayMigrationDraft(value: PromptCurationMigrationDraft | null) {
    migrationRef.current = value; setMigrationDraft(value);
  }
  function stageMigration(value: unknown) {
    const next = capturePromptCurationMigrationDraft(value);
    if (next.plan.recordId !== recordId) throw new Error("다른 기록의 이관 초안입니다. 기존 사본은 유지했습니다.");
    const token = migrationRecovery.stage(next, promptCurationMigrationScope(next));
    displayMigrationDraft(next); return token;
  }
  async function parkMigration() {
    const prior = migrationRef.current, version = localSequence.current;
    if (prior) await migrationRecovery.park();
    if (prior !== migrationRef.current || version !== localSequence.current) throw new Error("이관 초안 보존 중 화면이 변경되었습니다. 다시 확인해 주세요.");
    displayMigrationDraft(null); setMigration(null); setMigrationHidden(false);
  }
  async function migrationEvidence(value: PromptCurationMigrationDraft, signal: AbortSignal) {
    if (value.plan.recordId !== recordId) throw new Error("다른 기록의 이관 초안을 열 수 없습니다.");
    const [original, response] = await authorizedReadBatch([
      fetchDetail(value.plan.sourceGroupKey, signal, value.plan.sourceRevisionId),
      fetch(`${endpoint}?${new URLSearchParams({ snapshotId: value.request.expectedSnapshotId })}`, { cache: "no-store", signal }).then(responseJson<{ links: LinkPresentationV1 }>).then((response) => {
        // A redacted 200 response is still authorization denial. Convert it
        // within the sibling promise so a 503/hung source cannot swallow it.
        if (response.links?.capabilities?.reason === "restricted_record_locked" || response.links?.unavailableReason === "restricted_record_locked")
          throw new CurationRequestError(423, "restricted_record_locked", "잠금 확인 필요");
        return response;
      }),
    ] as const, accessDenied);
    const target = response.links;
    if (target?.contract !== "link-presentation.v1" || target.recordId !== recordId || target.unavailableReason
      || target.selectedSnapshot?.id !== value.request.expectedSnapshotId || target.selectedSnapshot.manifestHash !== value.request.expectedManifestHash)
      throw new Error("이관의 원래 원본·대상 자료를 확인하지 못했습니다. 초안과 요청 키는 유지했습니다.");
    const plan = await assertMigrationRecovery(value.plan, { recordId, source: original.item, target, request: value.request });
    return { source: original.item, target, plan };
  }
  async function verifyMigration(value: PromptCurationMigrationDraft) {
    // restore/resume already verified policy. Their hook state may still be
    // from the previous render; exact input identity fences this read instead.
    if (denied || migrationRef.current !== value) return;
    setMigration(null); setMigrationHidden(false);
    await operate((signal) => migrationEvidence(value, signal), (evidence) => {
      if (migrationRef.current !== value) return;
      setMigration({ ...evidence, scope, key: crypto.randomUUID(), request: value.request, attempted: value.phase === "pending", conflict: false, saved: null });
      setMessage("이관 초안을 복구했습니다. 원래 원본·대상을 확인했고 확인란은 해제했습니다. 서버 저장은 하지 않았습니다.");
    }, () => {});
  }
  function restoreMigration(value: PromptCurationMigrationDraft) {
    displayMigrationDraft(value); setMigration(null); setMigrationHidden(false);
    void verifyMigration(value);
  }
  async function prepareMigration(selectedSource?: StoredPromptCuration) {
    const source = selectedSource ?? visibleDetail?.item;
    if (!source || source.snapshotId === data.currentSnapshotId || denied || draft || pending.current || recovery.hasSuspended
      || migrationRecovery.hasSuspended || !migrationRecovery.ready || busy) return;
    const prior = migrationRef.current;
    await operate(async (signal) => {
      const { links: target } = await fetch(endpoint, { cache: "no-store", signal }).then(responseJson<{ links: LinkPresentationV1 }>);
      if (target?.capabilities?.reason === "restricted_record_locked") throw new CurationRequestError(423, "restricted_record_locked", "잠금 확인 필요");
      if (!target || target.recordId !== recordId || target.contract !== "link-presentation.v1" || target.unavailableReason || !target.currentRevisionId || !writable(target)) throw new Error("현재 자료의 쓰기 권한과 버전을 확인하지 못했습니다. 원래 정리본은 유지합니다.");
      const original = (await fetchDetail(source.groupKey, signal, source.id)).item;
      const plan = await assertMigrationPreview(await fetch(migrationUrl(original), { cache: "no-store", signal }).then(responseJson<unknown>), { recordId, source: original, target });
      const same = prior?.plan.planHash === plan.planHash;
      const request = same ? prior.request : { expectedRevisionId: plan.expectedRevisionId, expectedSnapshotId: plan.expectedSnapshotId,
        expectedManifestHash: plan.expectedManifestHash, expectedPlanHash: plan.planHash, groupKey: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
      return { scope, key: crypto.randomUUID(), source: original, target, plan, request, attempted: Boolean(same && prior.phase === "pending"), conflict: false, saved: null } satisfies MigrationReview;
    }, async (result, current) => {
      if (migrationRef.current !== prior) throw new Error("이관 준비 중 초안이 변경되었습니다. 다시 확인해 주세요.");
      // A changed plan cannot overwrite an uncertain old request, even if the
      // new source is another group. Keep an independently recoverable copy.
      if (prior && prior.request.idempotencyKey !== result.request.idempotencyKey) {
        await migrationRecovery.park();
        if (!current() || migrationRef.current !== prior) return;
      }
      stageMigration({ contract: "prompt-curation-migration-draft.v1", phase: result.attempted ? "pending" : "review", plan: result.plan, request: result.request });
      setMigration(result); setMigrationHidden(false);
    }, () => {});
  }
  async function saveMigration() {
    const review = visibleMigration, prior = migrationRef.current;
    if (!review || !prior || review.request.idempotencyKey !== prior.request.idempotencyKey || review.plan.planHash !== prior.plan.planHash || denied || draft || pending.current || recovery.hasSuspended
      || migrationRecovery.hasSuspended || !migrationRecovery.ready || busy || review.conflict || review.saved || !review.plan.ready
      || data.capabilities.reason === "v2_write_disabled") return;
    setMigration({ ...review, attempted: true });
    await operate(async (signal) => {
      const token = stageMigration({ ...prior, phase: "pending" }), original = migrationRef.current!;
      if (migrationRecovery.enabled && migrationRecovery.policy.privacyLevel !== "restricted" && !await migrationRecovery.flush())
        throw new Error("기기 이관 사본을 저장하지 못했습니다. 복구 설정·저장 공간을 확인하거나 복구를 직접 끈 뒤 시도해 주세요.");
      const evidence = await migrationEvidence(original, signal);
      if (evidence.target.capabilities.reason === "v2_write_disabled") throw new Error("현재 이관 저장이 비활성화되어 있습니다. 원래 요청은 유지했습니다.");
      if (signal.aborted || migrationRef.current !== original) throw new Error("이관 확인 중 화면 또는 초안이 변경되었습니다.");
      const value = await fetch(migrationUrl(evidence.source), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(original.request), signal }).then(responseJson<unknown>);
      const receipt = await assertMigrationRecoveryReceipt(value, { ...evidence, request: original.request });
      return { receipt, token, original, evidence };
    }, async ({ receipt, token, original, evidence }, current) => {
      await migrationRecovery.saved(token);
      if (!current() || migrationRef.current !== original) return;
      displayMigrationDraft(null);
      setMigration({ ...review, ...evidence, attempted: true, saved: receipt.item });
      setMessage(receipt.replayed ? "원래 이관 요청의 저장을 확인했습니다. 중복 정리본은 만들지 않았습니다." : "이관한 새 정리본을 저장했습니다. 원본과 이전 버전은 유지했습니다.");
    }, () => {
      setMigration({ ...review, key: crypto.randomUUID(), attempted: true, conflict: true });
    });
  }
  async function checkLatest() {
    const group = draft?.groupKey ?? pending.current?.groupKey ?? visibleDetail?.item.groupKey;
    await operate(async (signal) => {
      const response = await fetch(endpoint, { cache: "no-store", signal }).then(responseJson<{ links: LinkPresentationV1 }>);
      const links = response.links;
      if (links?.capabilities?.reason === "restricted_record_locked") throw new CurationRequestError(423, "restricted_record_locked", "잠금 확인 필요");
      if (!links || links.contract !== "link-presentation.v1" || links.recordId !== recordId || !links.currentRevisionId || !links.selectedSnapshot) throw new Error("현재 자료를 확인할 수 없습니다. 입력은 유지했습니다.");
      const fragments = await fetch(`${endpoint}/fragments?${new URLSearchParams({ snapshotId: links.selectedSnapshot.id })}`, { cache: "no-store", signal }).then(responseJson<ManualLinkFragmentPage>);
      validateManual(fragments, links.selectedSnapshot.id);
      // A first-page catalog is not proof that a selected manual fragment is
      // absent or unchanged. Resolve only missing selected IDs, bounded by the
      // 64-item contract and four concurrent authenticated reads.
      const missing = [...new Set(draft?.content.items.map((item) => item.fragmentId) ?? [])].filter((id) => {
        const original = draft?.originals.find((row) => row.id === id);
        return (original?.origin === "manual" || original?.isManual) && !fragments.items.some((row) => row.id === id);
      });
      const resolved: StoredManualLinkFragment[] = [];
      for (let offset = 0; offset < missing.length; offset += 4) {
        const chunk = await authorizedReadBatch(missing.slice(offset, offset + 4).map(async (id) => {
          const result = await fetch(`${endpoint}/fragments/${encodeURIComponent(id)}?${new URLSearchParams({ snapshotId: links.selectedSnapshot!.id })}`, { cache: "no-store", signal })
            .then(responseJson<{ contract: string; item: StoredManualLinkFragment }>);
          if (result.contract !== "manual-link-fragment.v1" || result.item?.id !== id || result.item.snapshotId !== links.selectedSnapshot!.id) throw new Error("선택한 원문 조각의 현재 상태를 확인하지 못했습니다. 입력은 유지했습니다.");
          return result.item;
        }), accessDenied);
        resolved.push(...chunk);
      }
      let next: PromptCurationDetail | null = null;
      if (group) try { next = await fetchDetail(group, signal); } catch (caught) {
        if (!(caught instanceof CurationRequestError && caught.code === "prompt_curation_not_found" && !draft?.head)) throw caught;
      }
      return { scope, links, detail: next, manual: { ...fragments, items: [...fragments.items, ...resolved] }, draftGroup: draft?.groupKey ?? null };
    }, (result) => { setFresh(result); setMessage("최신 상태를 읽었습니다. 유지한 입력을 적용할지 아래에서 직접 확인해 주세요."); });
  }
  async function applyLatest() {
    if (pending.current && !conflict) throw new Error("이전 요청의 저장 결과를 먼저 확인해 주세요. 새 요청으로 바꾸지 않았습니다.");
    if (fresh?.scope !== scope) { setFresh(null); setError("확인한 뒤 문서나 권한이 다시 변경되었습니다. 최신 상태를 다시 확인해 주세요. 입력은 유지했습니다."); return; }
    if (!fresh || !writable(fresh.links)) { setError("현재 자료는 수정할 수 없습니다. 입력은 유지했습니다."); return; }
    const latestBasis = basisOf(fresh.links);
    if (draft && (draft.groupKey !== fresh.draftGroup || draft.basis.expectedSnapshotId !== latestBasis.expectedSnapshotId || draft.basis.expectedManifestHash !== latestBasis.expectedManifestHash)) {
      setError("다른 자료 버전으로 자동 이관하지 않습니다. 이전 입력을 유지했습니다. 현재 자료에서 새 정리본을 명시적으로 만들어 주세요."); return;
    }
    let nextDraft: CurationDraft | null = null;
    if (draft) {
      const catalog = [...candidatesOf(fresh.links, fresh.manual), ...(fresh.detail ? storedCandidates(fresh.detail.item, fresh.links).filter((row) => !row.isManual) : [])];
      const items = draft.content.items.map((item) => {
        const previous = draft.originals.find((row) => row.id === item.fragmentId), current = catalog.find((row) => row.id === item.fragmentId && row.role === item.copyRole && row.rawText === previous?.rawText);
        return current ? { ...item, expectedFragmentStateVersion: current.stateVersion } : null;
      });
      if (items.some((item) => !item)) { setError("일부 선택 조각의 동일 원문과 현재 상태를 확인하지 못했습니다. 입력은 유지했습니다. 조각 목록을 확인한 뒤 다시 시도해 주세요."); return; }
      const originals = draft.originals.map((previous) => catalog.find((row) => row.id === previous.id && row.role === previous.role && row.rawText === previous.rawText) ?? previous);
      nextDraft = { ...draft, basis: latestBasis, head: fresh.detail ? fresh.detail.head : null, content: { ...draft.content, items: items.filter((item) => item !== null) }, originals, conflict: false };
    }
    await park();
    if (nextDraft) update({ contract: "prompt-curation-draft.v1", draft: nextDraft, pending: null });
    setVerified({ stamp, data: fresh.links }); setManual(fresh.manual); if (fresh.detail) setDetail(fresh.detail);
    setConflict(false); setFresh(null); setError("");
    setMessage("최신 버전의 같은 원문을 확인했습니다. 제목·순서·이미지 입력을 유지했으며 저장은 별도 버튼으로 실행합니다.");
  }
  async function copy(request: CopyRequest, select = false) {
    await operate(async (signal) => {
      const result = await fetch(`${groupsEndpoint}/${encodeURIComponent(request.groupKey)}/revisions/${encodeURIComponent(request.revisionId)}/copy?${new URLSearchParams({ channel: request.role, mode: request.mode })}`, { cache: "no-store", signal }).then(responseJson<CopyReceipt>);
      if (result.contract !== "stored-prompt-curation.v1" || result.revisionId !== request.revisionId || result.role !== request.role || result.mode !== request.mode
        || result.kind !== "assembled_source_fragments" || result.renderVersion !== "prompt-curation-render.v1" || typeof result.text !== "string"
        || new TextEncoder().encode(result.text).length !== result.byteLength || await linkSha256Hex(result.text) !== result.sha256) throw new Error("복사 응답의 정확 문자열과 해시를 확인하지 못했습니다.");
      return result;
    }, async (receipt, current) => {
      if (select) {
        if (!fallback || fallback.scope !== scope || fallback.receipt.sha256 !== receipt.sha256 || !selectionElement.current) throw new Error("복사할 원문이 달라졌습니다. 복사를 다시 요청해 주세요.");
        const range = document.createRange(); range.selectNodeContents(selectionElement.current);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); selectionElement.current.focus();
        setMessage("권한과 정확 원문을 다시 확인했습니다. 기기의 복사 기능을 사용하세요. 줄바꿈은 기기에 따라 달라질 수 있습니다."); return;
      }
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(receipt.text);
        if (current()) { setFallback(null); setMessage(`${curationRoles[request.role]} 원문 조각만 복사했습니다. ${receipt.warnings.map((warning) => warningLabels[warning] ?? warning).join(" · ")}`); }
      } catch { if (current()) { setFallback({ scope, request, receipt }); setMessage("자동 복사를 사용할 수 없습니다. 아래 버튼으로 권한을 다시 확인하고 원문을 직접 선택하세요."); } }
    });
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const identity = JSON.stringify([scope, manualRevision]);
      if (cancelled || !open || denied || running.current?.scope === scope || automaticRead.current === identity) return;
      // Mark the attempt, not only success: failures await explicit retry. A
      // revision arriving while busy stays unmatched until that operation ends.
      automaticRead.current = identity; void refresh();
    });
    return () => { cancelled = true; };
    // Only explicit opening or a parent source/version change refreshes the catalog.
    // Draft edits and fetched page state must not trigger repeated network reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, manualRevision, busyScope]);

  return <section className="v2-prompt-curations" aria-labelledby="prompt-curations-heading">
    <header><div><h3 id="prompt-curations-heading">내 프롬프트 정리본</h3><p>보관 원문을 역할·순서·예시 이미지로 정리합니다. AI 해석과 별도로 버전을 보존합니다.</p></div>
      <button type="button" aria-expanded={open} aria-controls="prompt-curations-content" onClick={() => { if (!open) { automaticRead.current = null; setActivated(true); } setOpen(!open); }}><Layers size={16} aria-hidden="true" />{open ? "정리본 접기" : "정리본 열기"}</button></header>
    <div id="prompt-curations-content" hidden={!open}>
      {denied ? <p className="v2-curation-warning">접근 내용을 닫았습니다. 다시 인증한 뒤 정리본을 불러와 주세요.</p> : <>
        {activated ? <><h4>정리본 편집 초안 복구</h4><LinkDraftRecoveryControls recovery={recovery} label="정리본 초안 기기 복구" busy={busy} restoreDisabled={pendingVisible || recovery.hasSuspended}
          describe={(copy) => <>정리본 {copy.pending?.kind === "revise" && !copy.draft ? (copy.pending.request.action === "undo" ? "되돌리기" : copy.pending.request.action === "archive" ? "보관" : "보관 해제") : "편집 초안"}{copy.pending ? " · 저장 결과 미확인" : ""}</>}
          action={local} onRestore={(value) => { display(value); staged.current = true; setConflict(value.draft?.conflict ?? false); setFresh(null); setEditorOpen(true); setMessage("초안을 복구했습니다. 서버 저장은 하지 않았습니다."); }} /></> : null}
        {recovery.hasSuspended ? <button type="button" disabled={busy || !recovery.ready} onClick={() => void local(async () => {
          display(await recovery.resumeSuspended()); staged.current = true; setEditorOpen(true); setConflict(false);
        })}>이 화면의 숨긴 정리본 초안 다시 열기</button> : null}
        {activated ? <><h4>자료 이관 초안 복구</h4><LinkDraftRecoveryControls recovery={migrationRecovery} label="이관 초안 기기 복구" busy={busy}
          restoreDisabled={Boolean(draft) || pendingVisible || recovery.hasSuspended || migrationRecovery.hasSuspended}
          describe={(copy) => <>이관 {copy.phase === "pending" ? "저장 결과 미확인" : "검토 초안"}</>}
          action={local} onRestore={restoreMigration} /></> : null}
        {migrationRecovery.hasSuspended ? <button type="button" disabled={busy || !migrationRecovery.ready || Boolean(draft) || pendingVisible}
          onClick={() => void local(async () => restoreMigration(await migrationRecovery.resumeSuspended()))}>숨겨 둔 이관 초안 다시 열기</button> : null}
        {migrationDraft && (!visibleMigration || migrationHidden) ? <div className="v2-curation-warning"><p>원래 이관 계획과 요청 키를 유지하고 있습니다. 정확한 원본·대상을 다시 읽은 뒤 표시합니다.</p>
          <button type="button" disabled={busy || !migrationRecovery.ready || migrationRecovery.hasSuspended || Boolean(draft) || pendingVisible}
            onClick={() => migrationRef.current && void verifyMigration(migrationRef.current)}>복구한 이관 원문 다시 확인</button></div> : null}
        {visibleMigration && !migrationHidden ? <PromptCurationMigration key={visibleMigration.key} source={visibleMigration.source} target={visibleMigration.target} plan={visibleMigration.plan}
          busy={busy || !migrationRecovery.ready || migrationRecovery.hasSuspended || Boolean(draft) || pendingVisible} conflict={visibleMigration.conflict} attempted={visibleMigration.attempted} saved={visibleMigration.saved}
          onSave={() => void saveMigration()} onRecheck={() => void prepareMigration(visibleMigration.source)} onClose={() => setMigrationHidden(true)}
          onOpenSnapshot={onOpenSnapshot ? () => onOpenSnapshot(visibleMigration.plan.expectedSnapshotId) : undefined} /> : null}
        {migrationDraft ? <button type="button" disabled={busy || !migrationRecovery.ready || migrationRecovery.hasSuspended}
          onClick={() => void local(parkMigration)}>이관 초안 보존하고 닫기</button> : null}
        {!canWrite ? <p className="v2-curation-warning">과거 자료 또는 읽기 전용 상태입니다. 보관한 버전과 원문은 읽고 복사할 수 있습니다.</p> : null}
        <div className="v2-curation-actions"><button type="button" disabled={busy || !canWrite || !recovery.ready || pendingVisible || recovery.hasSuspended || conflict} onClick={() => void local(() => start())}>새 정리본 만들기</button>
          <button type="button" disabled={busy} onClick={() => void refresh()}>정리본 목록 새로고침</button></div>
        {draft ? <div className="v2-curation-draft"><div className="v2-curation-actions"><button type="button" aria-expanded={editorOpen} aria-controls="prompt-curation-editor" onClick={() => setEditorOpen(!editorOpen)}>{editorOpen ? "정리본 편집 접기" : "정리본 편집 펼치기"}</button>
          <button type="button" disabled={busy} onClick={() => void local(park)}>초안 보존하고 편집 닫기</button></div>
          {(stale || draft.conflict) ? <p className="v2-curation-warning">이전 버전의 입력을 유지하고 있습니다. 최신 상태 확인 후 명시적으로 적용해야 저장할 수 있습니다.</p> : null}
          <div id="prompt-curation-editor" hidden={!editorOpen}><PromptCurationEditor key={draft.groupKey} draft={draft} candidates={candidates} images={images} disabled={busy || !canWrite || stale || draft.conflict || conflict || pendingVisible || !recovery.ready}
            onChange={updateDraft} onSave={() => void save()} /></div>
        </div> : null}
        {manual?.selectedSnapshotId === snapshotId && manual.nextCursor ? <button type="button" disabled={busy} onClick={() => void moreManual()}>이전 원문 조각 더 보기</button> : null}
        <div className="v2-curation-list" role="group" aria-label="저장한 정리본 목록">{visiblePage?.items.map((item) => <article key={item.id}><h4>{item.title}</h4><p>{relationLabels[item.relationKind]} · 버전 {item.revisionNumber} · {item.status === "archived" ? "보관 중" : "사용 중"}</p>
          <button type="button" disabled={busy} onClick={() => void loadDetail(item.groupKey)}>정리본 보기 · {item.title}</button></article>)}</div>
        {visiblePage && !visiblePage.items.length ? <p>이 자료에 저장한 정리본이 없습니다. 원문 조각을 골라 첫 정리본을 만드세요.</p> : null}
        {visiblePage?.nextCursor ? <button type="button" disabled={busy} onClick={() => void refresh(true)}>이전 정리본 더 보기</button> : null}
        {visibleDetail ? <article className="v2-curation-detail" aria-label="정리본 상세"><header><h4>{visibleDetail.item.title}</h4><p>버전 {visibleDetail.item.revisionNumber}{visibleDetail.isHistorical ? " · 이전 버전 · 원문 유지" : " · 최신 버전"} · {relationLabels[visibleDetail.item.relationKind]}</p></header>
          <p>원문 조각으로 구성한 파생 표현입니다. 전체 외부 스레드의 완전성을 확인한 것은 아닙니다.</p>
          {Object.entries(curationRoles).map(([role, label]) => { const channel = visibleDetail.item.prepared.channels[role as PromptCopyRole];
            return <section key={role} className="v2-curation-role" aria-label={`${label} 저장 내용`}><h5>{label} · {channel.itemKeys.length}조각</h5>
              {visibleDetail.item.items.filter((item) => item.copyRole === role).sort((a, b) => a.position - b.position).map((item, index) => <div key={item.itemKey}><p>{label} 조각 {index + 1} · {item.fragment.selectionOrigin === "ai_selected" ? "AI가 선택한 원문" : "사용자 선택 원문"}</p><pre aria-label={`${label} 보관 조각 ${index + 1}`}>{item.fragment.rawText}</pre></div>)}
              {channel.warnings.length ? <p className="v2-curation-warning">{channel.warnings.map((warning) => warningLabels[warning] ?? warning).join(" · ")}</p> : null}
              {channel.blockedReason ? <p>{blockedLabels[channel.blockedReason]}</p> : null}
              <div className="v2-curation-actions"><button type="button" disabled={busy || !channel.canStandardCopy} onClick={() => void copy({ groupKey: visibleDetail.item.groupKey, revisionId: visibleDetail.item.id, role: role as PromptCopyRole, mode: "standard" })}><Copy size={15} aria-hidden="true" />{label} 이어 복사</button>
                <button type="button" disabled={busy || !channel.canAvailableOnlyCopy} onClick={() => void copy({ groupKey: visibleDetail.item.groupKey, revisionId: visibleDetail.item.id, role: role as PromptCopyRole, mode: "available_only" })}>{label} 확보한 조각만 복사</button></div>
            </section>; })}
          {visibleDetail.item.content.examples.length ? <section aria-label="정리본 보관 이미지"><h5>내가 연결한 예시</h5>{visibleDetail.item.content.examples.map((example, index) => { const image = images.find((row) => row.memberId === example.memberId && row.attachmentId === example.attachmentId);
            const target = visibleDetail.item.content.items.find((item) => item.itemKey === example.itemKey);
            return <div className="v2-curation-example" key={example.exampleKey}><p>예시 {index + 1} · {example.itemKey === null ? "정리본 전체" : target ? `${curationRoles[target.copyRole]} 조각 ${target.position + 1}` : "연결한 조각 확인 필요"} · {example.evidenceMethod === "user_confirmed" ? "사용자 대응 확인" : "대응 미확인"}</p>
              {image ? <CurationImagePreview image={image} /> : <p>보관 이미지 연결은 유지됩니다. 선택한 자료의 원본/첨부에서 확인하세요.</p>}</div>; })}</section> : null}
          <div className="v2-curation-actions"><button type="button" disabled={busy || !canWrite || visibleDetail.isHistorical || pendingVisible || recovery.hasSuspended || !recovery.ready || conflict} onClick={() => void local(() => start(visibleDetail.item))}>정리본 수정</button>
            <button type="button" disabled={busy || !canWrite || !visibleDetail.isHistorical || Boolean(draft) || pendingVisible || recovery.hasSuspended || !recovery.ready || conflict} onClick={() => void transition("undo")}>이 버전으로 되돌리기</button>
            <button type="button" disabled={busy || !canWrite || visibleDetail.isHistorical || Boolean(draft) || pendingVisible || recovery.hasSuspended || !recovery.ready || conflict} onClick={() => void transition(visibleDetail.item.status === "archived" ? "unarchive" : "archive")}>{visibleDetail.item.status === "archived" ? "정리본 보관 해제" : "정리본 보관"}</button>
            <button type="button" disabled={busy} onClick={() => void loadDetail(visibleDetail.item.groupKey)}>최신 정리본 버전 보기</button></div>
          <section aria-label="정리본 버전 이력"><h5>버전 이력</h5>{visibleDetail.history.items.map((item) => <button key={item.id} type="button" disabled={busy} aria-current={item.id === visibleDetail.item.id ? "true" : undefined} onClick={() => void loadDetail(item.groupKey, item.id)}>정리본 버전 {item.revisionNumber} 보기</button>)}
            {visibleDetail.history.nextCursor ? <button type="button" disabled={busy} onClick={() => void loadDetail(visibleDetail.item.groupKey, visibleDetail.item.id, true)}>이전 정리본 버전 더 보기</button> : null}</section>
          {visibleDetail.item.snapshotId !== data.currentSnapshotId && (!visibleMigration || migrationHidden || visibleMigration.source.id !== visibleDetail.item.id) ? <button type="button" disabled={busy || Boolean(draft) || pendingVisible || recovery.hasSuspended || migrationRecovery.hasSuspended || !migrationRecovery.ready} onClick={() => void prepareMigration()}>현재 자료로 가져오기 미리보기</button> : null}
        </article> : null}
        {fallback?.scope === scope ? <div className="v2-curation-fallback"><pre ref={selectionElement} tabIndex={0} aria-label="직접 복사할 정리본 원문">{fallback.receipt.text}</pre><button type="button" disabled={busy} onClick={() => void copy(fallback.request, true)}>복사할 원문 직접 선택</button></div> : null}
        {(conflict || stale || draft?.conflict) ? <div className="v2-curation-warning"><button type="button" disabled={busy} onClick={() => void checkLatest()}>최신 상태 확인</button>
          {fresh?.scope === scope ? <><p>현재 자료 버전 {fresh.links.selectedSnapshot?.snapshotVersion} · {fresh.detail ? `정리본 최신 버전 ${fresh.detail.head.revisionNumber}` : "새 정리본"}. 입력을 적용해도 자동 저장하지 않습니다.</p><button type="button" disabled={busy} onClick={() => void local(applyLatest)}>확인한 최신 버전에 입력 적용</button></> : null}</div> : null}
        {pendingVisible ? <div className="v2-curation-warning"><p>저장 결과 미확인 · 원래 자료·정리본 버전과 같은 요청 키를 유지합니다. 재시도해도 현재 버전으로 자동 바꾸지 않습니다.</p>
          {!conflict ? <button type="button" disabled={busy || !recovery.ready || data.capabilities.reason === "v2_write_disabled"} onClick={() => pending.current && void mutate(pending.current)}>같은 요청 다시 시도</button> : null}
          {!draft ? <button type="button" disabled={busy} onClick={() => void local(park)}>대기 요청 보존하고 닫기</button> : null}</div> : null}
      </>}
      {denied ? <button type="button" disabled={busy} onClick={() => void refresh()}>권한 확인하고 정리본 불러오기</button> : null}
      {error ? <p className="v2-curation-error" role="alert">{error}</p> : null}<p role="status" className="v2-curation-message">{message}</p>
    </div>
  </section>;
}
