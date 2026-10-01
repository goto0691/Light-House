"use client";

import { Check, CloudOff, FileText, Image, Lightbulb, LoaderCircle, Paperclip, Send, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrowserCaptureSyncTransport, drainOutbox, syncDraft, type OfflineCommitReceipt } from "@/lib/v2/offline/capture-sync";
import { IndexedDbCaptureStore } from "@/lib/v2/offline/indexeddb-capture-store";
import type { LocalAttachmentBlob, LocalAttachmentInput, LocalCaptureChannel, LocalDraft, LocalSourceItem } from "@/lib/v2/offline/local-capture";
import { SyncQueueSheet } from "@/components/v2/sync-queue-sheet";
import { initialTemplateInputs, TemplateAssistPanel, type CaptureTemplateOption } from "@/components/v2/template-assist-panel";
import { LinkCapturePanel } from "@/components/v2/link-capture-panel";
import { hasManualLinkSource } from "@/lib/v2/domain/manual-link-source";
import { serializeLocalSourceItems, type OrderedCaptureCommitSource } from "@/lib/v2/offline/serialize-source-items";
import type { TemplateInputSubmission } from "@/lib/v2/templates/template-definition-v1";

type SubmitState = "editing" | "uploading" | "committing" | "queued" | "committed" | "failed";
type LocalState = "idle" | "loading" | "saving" | "saved" | "waiting" | "blocked" | "failed";
type ComposerFile = Readonly<{ localAttachmentId: string; file: File; sourceOrder: number }>;

function asFile(blob: Blob, filename: string) {
  return new File([blob], filename, { type: blob.type || "application/octet-stream" });
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attachmentRow(draftId: string, item: ComposerFile, hash: string): LocalAttachmentBlob {
  return {
    localAttachmentId: item.localAttachmentId,
    draftId,
    blob: item.file,
    filename: item.file.name,
    mime: item.file.type || "application/octet-stream",
    bytes: item.file.size,
    sha256: hash,
    sourceOrder: item.sourceOrder,
    createdAt: new Date().toISOString(),
    uploadProgress: 0,
    uploadStatus: "pending",
    reservationId: null,
    reservationExpiresAt: null,
    attempt: 0,
    nextAttemptAt: null,
    lastErrorClass: null,
  };
}

export function CaptureComposer({ offlineEnabled, writeEnabled, initialDraftId = null, initialTemplateVersionId = null }: { offlineEnabled: boolean; writeEnabled: boolean; initialDraftId?: string | null; initialTemplateVersionId?: string | null }) {
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState<"normal" | "sensitive" | "restricted">("normal");
  const [sensitiveOptIn, setSensitiveOptIn] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>("editing");
  const [localState, setLocalState] = useState<LocalState>(initialDraftId ? "loading" : "idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OfflineCommitReceipt | null>(null);
  const [localChangesRetained, setLocalChangesRetained] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [templates, setTemplates] = useState<readonly CaptureTemplateOption[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<CaptureTemplateOption | null>(null);
  const [templateInputs, setTemplateInputs] = useState<readonly TemplateInputSubmission[]>([]);
  const [sourceItems, setSourceItems] = useState<readonly LocalSourceItem[]>([]);
  const storeRef = useRef<IndexedDbCaptureStore | null>(null);
  const transportRef = useRef(new BrowserCaptureSyncTransport());
  const [draftId] = useState(() => initialDraftId || `draft-${crypto.randomUUID()}`);
  const draftIdRef = useRef(draftId);
  const localVersionRef = useRef(1);
  const volatileIdempotencyRef = useRef(`volatile-${crypto.randomUUID()}`);
  const channelRef = useRef<LocalCaptureChannel>("web");
  const capturedAtRef = useRef(new Date().toISOString());
  const sourceItemsRef = useRef<readonly LocalSourceItem[]>([]);
  const submittingRef = useRef(false);
  const queuedRef = useRef(false);
  const checkpointTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const restoringRef = useRef(Boolean(initialDraftId));
  const hasLocalPayloadRef = useRef(false);
  const hasManualLinks = sourceItems.some((source) => hasManualLinkSource(source.metadata));

  if (!storeRef.current) storeRef.current = new IndexedDbCaptureStore();

  const loadTemplates = useCallback(async (versionId?: string | null) => {
    setTemplatesLoading(true);
    try {
      const response = await fetch(`/api/v2/templates?${versionId ? `version=${encodeURIComponent(versionId)}` : "capture=1"}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("입력 도움을 불러오지 못했습니다.");
      const payload = await response.json() as { templates?: CaptureTemplateOption[] };
      const loaded = payload.templates ?? [];
      if (versionId) {
        const restored = loaded.find((template) => template.currentVersionId === versionId) ?? null;
        if (restored) {
          setSelectedTemplate(restored);
          setTemplateInputs((current) => current.length ? current : initialTemplateInputs(restored.definition));
        }
      } else setTemplates(loaded);
      return loaded;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "입력 도움을 불러오지 못했습니다.");
      return [];
    } finally { setTemplatesLoading(false); }
  }, []);

  useEffect(() => {
    if (initialDraftId || !initialTemplateVersionId) return;
    setAssistOpen(true);
    void loadTemplates(initialTemplateVersionId);
  }, [initialDraftId, initialTemplateVersionId, loadTemplates]);

  const refreshPendingCount = useCallback(async () => {
    if (!offlineEnabled || !storeRef.current) return;
    setPendingCount((await storeRef.current.listDrafts()).length);
  }, [offlineEnabled]);

  useEffect(() => {
    if (!offlineEnabled || !initialDraftId || !storeRef.current) return;
    let active = true;
    void Promise.all([storeRef.current.getDraft(initialDraftId), storeRef.current.getDraftAttachments(initialDraftId)]).then(([draft, attachments]) => {
      if (!active) return;
      if (!draft) {
        setLocalState("failed");
        setError("이 기기에 저장된 공유 기록을 찾지 못했습니다.");
        return;
      }
      setTitle(draft.title ?? "");
      setBodyMarkdown(draft.bodyMarkdown);
      setPrivacyLevel(draft.privacyLevel);
      setSensitiveOptIn(draft.privacyLevel === "sensitive");
      setAiEnabled(draft.aiEnabled);
      setFiles(attachments.map((attachment) => ({ localAttachmentId: attachment.localAttachmentId, file: asFile(attachment.blob, attachment.filename), sourceOrder: attachment.sourceOrder })));
      localVersionRef.current = draft.localVersion + 1;
      channelRef.current = draft.captureChannel;
      capturedAtRef.current = draft.capturedAt;
      sourceItemsRef.current = draft.sourceItems;
      setSourceItems(draft.sourceItems);
      hasLocalPayloadRef.current = true;
      restoringRef.current = false;
      setTemplateInputs(draft.templateValues);
      if (draft.templateVersionId) void loadTemplates(draft.templateVersionId);
      setLocalState(draft.state === "waiting_network" ? "waiting" : "saved");
      if (draft.state === "waiting_network") {
        queuedRef.current = true;
        setSubmitState("queued");
        if (navigator.onLine) window.dispatchEvent(new Event("online"));
      }
      void refreshPendingCount();
    });
    return () => { active = false; };
  }, [initialDraftId, loadTemplates, offlineEnabled, refreshPendingCount]);

  const checkpoint = useCallback(async (forSubmission = false) => {
    const store = storeRef.current;
    if (!store || !offlineEnabled) return null;
    if (submittingRef.current && !forSubmission) return null;
    if (!title.trim() && !bodyMarkdown.trim() && files.length === 0 && sourceItems.length === 0 && !templateInputs.some((input) => input.blankState === "answered")) {
      // Only an already checkpointed draft becoming empty is a removal. Initial
      // hydration and failed restore must never delete a draft we have not read.
      if (!restoringRef.current && hasLocalPayloadRef.current) {
        hasLocalPayloadRef.current = false;
        const emptyCleanup = checkpointTailRef.current.catch(() => undefined).then(async () => {
          await store.purgeDraftPayload(draftIdRef.current);
          const url = new URL(window.location.href);
          if (!hasLocalPayloadRef.current && url.searchParams.get("draftId") === draftIdRef.current) {
            url.searchParams.delete("draftId");
            window.history.replaceState(window.history.state, "", url);
          }
        });
        checkpointTailRef.current = emptyCleanup;
        await emptyCleanup;
        if (!hasLocalPayloadRef.current) setLocalState("idle");
        await refreshPendingCount();
      }
      return null;
    }
    setLocalState("saving");
    const version = localVersionRef.current;
    localVersionRef.current += 1;
    const attachments: LocalAttachmentInput[] = files.map((item) => ({ localAttachmentId: item.localAttachmentId, blob: item.file, filename: item.file.name, sourceOrder: item.sourceOrder }));
    hasLocalPayloadRef.current = true;
    const pendingCheckpoint = checkpointTailRef.current.catch(() => undefined).then(() => store.checkpoint({
      draftId: draftIdRef.current,
      title,
      bodyMarkdown,
      aiEnabled: hasManualLinks ? false : aiEnabled,
      captureChannel: channelRef.current,
      privacyLevel,
      templateVersionId: selectedTemplate?.currentVersionId ?? null,
      templateValues: templateInputs,
      attachments,
      sourceItems,
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localVersion: version,
      capturedAt: capturedAtRef.current,
    }, { sensitiveOptIn }));
    checkpointTailRef.current = pendingCheckpoint;
    const result = await pendingCheckpoint;
    setLocalState(result.persisted ? "saved" : "blocked");
    if (!result.persisted && result.reason === "draft_limit") setError("미전송 기록이 50개입니다. 먼저 전송하거나 필요 없는 임시 기록을 정리하세요.");
    if (result.persisted && window.location.pathname === "/v2/capture" && !new URL(window.location.href).searchParams.has("draftId")) {
      const url = new URL(window.location.href);
      url.searchParams.set("draftId", draftIdRef.current);
      window.history.replaceState(window.history.state, "", url);
    }
    await refreshPendingCount();
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      const ratio = estimate.quota ? (estimate.usage ?? 0) / estimate.quota : 0;
      setStorageWarning(ratio >= 0.85 ? "브라우저 저장 공간이 85% 이상 찼습니다. 새 첨부 전에 임시 기록을 전송하거나 정리하세요." : ratio >= 0.7 ? "브라우저 저장 공간이 70% 이상 사용 중입니다." : null);
    }
    return result;
  }, [aiEnabled, bodyMarkdown, files, hasManualLinks, offlineEnabled, privacyLevel, refreshPendingCount, selectedTemplate, sensitiveOptIn, sourceItems, templateInputs, title]);

  useEffect(() => {
    if (!offlineEnabled || !storeRef.current || privacyLevel === "normal" || (privacyLevel === "sensitive" && sensitiveOptIn)) return;
    const store = storeRef.current;
    const cleanup = checkpointTailRef.current.catch(() => undefined).then(() => store.purgeDraftPayload(draftIdRef.current));
    checkpointTailRef.current = cleanup;
    void cleanup.then(() => setLocalState("blocked")).catch(() => setLocalState("failed"));
  }, [offlineEnabled, privacyLevel, sensitiveOptIn]);

  useEffect(() => {
    if (!offlineEnabled || submitState === "committed" || submitState === "queued" || submitState === "uploading" || submitState === "committing") return;
    const timeout = window.setTimeout(() => void checkpoint().catch(() => setLocalState("failed")), 800);
    return () => window.clearTimeout(timeout);
  }, [checkpoint, offlineEnabled, submitState]);

  useEffect(() => {
    if (!offlineEnabled || !storeRef.current) return;
    const drain = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine || !storeRef.current) return;
      if (queuedRef.current && !submittingRef.current) {
        submittingRef.current = true;
        setSubmitState("committing");
        void checkpointTailRef.current.catch(() => undefined).then(() => syncDraft({ store: storeRef.current!, transport: transportRef.current, draftId: draftIdRef.current })).then((result) => {
          if (result.outcome === "committed") {
            queuedRef.current = false;
            setReceipt(result.receipt);
            setLocalChangesRetained(result.localChangesRetained);
            setSubmitState("committed");
          } else {
            const waiting = result.outcome === "waiting_network" || result.outcome === "authentication_required";
            queuedRef.current = waiting;
            setSubmitState(waiting ? "queued" : "failed");
            setError(result.outcome === "idle" ? "다른 창에서 이 임시 기록의 상태가 바뀌었습니다. 전송 대기 목록을 확인해주세요." : result.error.message);
          }
        }).catch(() => setSubmitState("queued")).finally(() => { submittingRef.current = false; void refreshPendingCount(); });
      }
      void drainOutbox({ store: storeRef.current, transport: transportRef.current, concurrency: window.innerWidth < 768 ? 2 : 3, excludeDraftIds: [draftIdRef.current] }).then(() => refreshPendingCount());
    };
    window.addEventListener("online", drain);
    document.addEventListener("visibilitychange", drain);
    drain();
    return () => {
      window.removeEventListener("online", drain);
      document.removeEventListener("visibilitychange", drain);
    };
  }, [offlineEnabled, refreshPendingCount]);

  async function addFiles(list: FileList | null) {
    if (!list || submittingRef.current || queuedRef.current) return;
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && (estimate.usage ?? 0) / estimate.quota >= 0.85) {
        setStorageWarning("저장 공간을 확보하기 전에는 새 첨부를 추가하지 않습니다.");
        return;
      }
    }
    if (submittingRef.current || queuedRef.current) return;
    setFiles((current) => {
      const nextOrder = current.reduce((max, item) => Math.max(max, item.sourceOrder), sourceItemsRef.current.reduce((max, item) => Math.max(max, item.order), 0)) + 1;
      const added = Array.from(list).map((file, index) => ({ localAttachmentId: `${draftIdRef.current}:attachment:${crypto.randomUUID()}`, file, sourceOrder: nextOrder + index }));
      return [...current, ...added].slice(0, 20);
    });
  }

  function pasteAttachments(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length > 0) void addFiles(event.clipboardData.files);
  }

  function dropAttachments(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  }

  async function submitVolatile() {
    if (!navigator.onLine) throw new Error("잠금 기록과 기기 저장을 선택하지 않은 민감 기록은 오프라인에서 보존할 수 없습니다.");
    const transport = transportRef.current;
    const sources: OrderedCaptureCommitSource[] = [];
    for (const item of files) {
      const hash = await sha256(item.file);
      const row = attachmentRow(draftIdRef.current, item, hash);
      const reservation = await transport.reserve(row);
      await transport.upload(row, reservation);
      await transport.verify(reservation.reservation.id);
      sources.push({ sourceOrder: item.sourceOrder, kind: item.file.type.startsWith("image/") ? "image" : item.file.type.startsWith("audio/") ? "audio" : item.file.type.startsWith("video/") ? "video" : "document", contentHash: hash, attachmentId: reservation.reservation.id, metadata: { filename: item.file.name, mimeType: item.file.type, sizeBytes: item.file.size } });
    }
    const draft: LocalDraft = {
      draftId: draftIdRef.current, title: title.trim() || null, bodyMarkdown, aiEnabled: hasManualLinks ? false : aiEnabled, captureChannel: channelRef.current,
      privacyLevel, templateVersionId: selectedTemplate?.currentVersionId ?? null, templateValues: templateInputs, attachmentIds: files.map((item) => item.localAttachmentId),
      sourceItems: sourceItemsRef.current, createdAt: capturedAtRef.current, capturedAt: capturedAtRef.current,
      updatedAt: new Date().toISOString(), clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, localVersion: localVersionRef.current, state: "committing",
    };
    return transport.commit(draft, await serializeLocalSourceItems(sourceItemsRef.current, sources), volatileIdempotencyRef.current);
  }

  async function openAssistance() {
    setAssistOpen(true);
    if (!templates.length) await loadTemplates();
  }

  async function chooseTemplate(template: CaptureTemplateOption | null) {
    if (submittingRef.current || queuedRef.current) return;
    if (!template) {
      setSelectedTemplate(null);
      return;
    }
    let selected = template;
    if (template.status === "suggested") {
      try {
        const response = await fetch(`/api/v2/templates/${encodeURIComponent(template.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "try" }) });
        if (response.ok) selected = ((await response.json()) as { template: CaptureTemplateOption }).template;
      } catch { /* The capture can still use the already eligible suggested version. */ }
    }
    if (submittingRef.current || queuedRef.current) return;
    const previous = new Map(templateInputs.map((input) => [input.itemKey, input]));
    setSelectedTemplate(selected);
    setTemplateInputs(initialTemplateInputs(selected.definition).map((input) => previous.get(input.itemKey)?.valueKind === input.valueKind ? previous.get(input.itemKey) as TemplateInputSubmission : input));
  }

  async function submit() {
    if (!writeEnabled || submittingRef.current || (!bodyMarkdown.trim() && files.length === 0 && sourceItems.length === 0 && !templateInputs.some((input) => input.blankState === "answered"))) return;
    submittingRef.current = true;
    queuedRef.current = false;
    setError(null);
    setSubmitState(files.length ? "uploading" : "committing");
    try {
      const persistent = privacyLevel === "normal" || (privacyLevel === "sensitive" && sensitiveOptIn);
      if (!offlineEnabled || !persistent) {
        await checkpointTailRef.current.catch(() => undefined);
        if (!persistent && storeRef.current) await storeRef.current.purgeDraftPayload(draftIdRef.current);
        const committed = await submitVolatile();
        setReceipt(committed);
        setSubmitState("committed");
        return;
      }
      await checkpointTailRef.current.catch(() => undefined);
      const saved = await checkpoint(true);
      if (!saved?.persisted || !storeRef.current) throw new Error("이 기록은 기기에 임시 저장할 수 없습니다.");
      const result = await syncDraft({ store: storeRef.current, transport: transportRef.current, draftId: draftIdRef.current });
      if (result.outcome === "committed") {
        setReceipt(result.receipt);
        setLocalChangesRetained(result.localChangesRetained);
        setSubmitState("committed");
        setLocalState("idle");
      } else if (result.outcome === "waiting_network" || result.outcome === "authentication_required") {
        setSubmitState("queued");
        queuedRef.current = true;
        setLocalState("waiting");
        setError(result.outcome === "authentication_required" ? "로그인한 뒤 전송을 다시 시작하세요. 이 기기의 임시 기록은 유지됩니다." : "연결되면 이 기기에서 전송을 계속합니다.");
      } else if (result.outcome !== "idle") {
        setSubmitState("failed");
        setError(result.error.message);
      } else {
        setSubmitState("failed");
        setError("다른 창에서 이 임시 기록의 상태가 바뀌었습니다. 전송 대기 목록을 확인해주세요.");
      }
      await refreshPendingCount();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
      setSubmitState("failed");
    } finally {
      submittingRef.current = false;
    }
  }

  if (receipt) {
    return (
      <section className="v2-product-card v2-product-receipt" aria-labelledby="capture-success-title">
        <span className="v2-product-success"><Check aria-hidden="true" size={25} /></span>
        <h1 id="capture-success-title">원본 저장 완료</h1>
        <p>입력한 본문·자료와 첨부 {receipt.attachmentCount}개를 서버 정본에 저장했습니다. {localChangesRetained ? "전송 중 다른 창에서 바뀐 임시 기록은 이 기기에 보존했습니다." : "이 기기의 원본 임시 사본을 정리했습니다."}</p>
        {hasManualLinks ? <p>링크는 사용자가 입력한 원문과 함께 보관했습니다. 외부 게시물·이미지·영상의 자동 수집이나 AI 분석은 수행하지 않았습니다.</p> : null}
        <dl>
          <div><dt>저장 시각</dt><dd>{new Date(receipt.committedAt).toLocaleString("ko-KR")}</dd></div>
          <div><dt>AI 정리</dt><dd>{receipt.aiProcessing === "queued" ? "대기 중" : "사용 안 함"}</dd></div>
        </dl>
        <Link className="v2-product-primary" href={`/v2/records/${receipt.recordId}`}>기록 열기</Link>
        {localChangesRetained ? <a href={`/v2/capture?draftId=${encodeURIComponent(draftId)}`}>전송되지 않은 변경 확인</a> : null}
      </section>
    );
  }

  const busy = submitState === "uploading" || submitState === "committing";
  const stateLabel = localState === "loading" ? "공유 기록 불러오는 중" : localState === "saving" ? "이 기기에 저장 중" : localState === "saved" ? "이 기기에 임시 저장됨" : localState === "waiting" ? "연결되면 전송" : localState === "blocked" ? "기기에 저장하지 않음" : localState === "failed" ? "로컬 저장 실패" : "새 기록";
  return (
    <div className={`v2-capture-layout${assistOpen ? " has-assist" : ""}`}>
    <section className="v2-product-card" aria-labelledby="capture-title" onDragOver={(event) => event.preventDefault()} onDrop={dropAttachments}>
      <header className="v2-product-heading">
        <div><p>자유 기록</p><h1 id="capture-title">먼저 남겨두세요.</h1></div>
        <span className="v2-product-local-state" data-state={localState}>{localState === "waiting" ? <CloudOff aria-hidden="true" size={13} /> : null}{stateLabel}</span>
      </header>

      {!writeEnabled ? <p className="v2-product-warning"><ShieldAlert aria-hidden="true" size={17} /> V2 쓰기 기능이 아직 비활성화되어 있습니다.</p> : null}
      {pendingCount > 0 ? <button className="v2-product-sync-note" onClick={() => setQueueOpen(true)} type="button">이 기기의 전송 대기 {pendingCount}개 보기</button> : null}
      {storageWarning ? <p className="v2-product-sync-note">{storageWarning}</p> : null}
      <fieldset disabled={busy || submitState === "queued"} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <button aria-expanded={assistOpen} className="v2-template-launcher" onClick={() => void openAssistance()} type="button"><Lightbulb aria-hidden="true" size={16} />{selectedTemplate ? `${selectedTemplate.name} 도움 사용 중` : "도움받아 쓰기"}</button>
      <label className="v2-product-field"><span>제목 <small>선택</small></span><input onChange={(event) => setTitle(event.target.value)} placeholder="비워두면 첫 문장에서 만듭니다" value={title} /></label>
      <label className="v2-product-field">
        <span className={hasManualLinks ? undefined : "sr-only"}>{hasManualLinks ? "내 메모 · 선택" : "기록 본문"}</span>
        <textarea aria-label="기록 본문" autoFocus disabled={localState === "loading"} onChange={(event) => setBodyMarkdown(event.target.value)} onPaste={pasteAttachments} placeholder={hasManualLinks ? "이 자료를 남기는 이유나 내 생각을 적어두세요. 출처의 원문은 아래에 따로 붙여넣습니다." : "무엇이든 쓰거나 이미지와 파일을 붙여두세요. 분류는 나중에 합니다."} value={bodyMarkdown} />
      </label>

      <LinkCapturePanel disabled={busy || submitState === "queued" || localState === "loading"} items={sourceItems} nextOrder={Math.max(0, ...sourceItems.map((source) => source.order), ...files.map((file) => file.sourceOrder)) + 1} onChange={(items) => { if (submittingRef.current || queuedRef.current) return; sourceItemsRef.current = items; setSourceItems(items); }} />

      {files.length ? <ul className="v2-product-files" aria-label="첨부 파일">{files.map((item) => (
        <li key={item.localAttachmentId}>{item.file.type.startsWith("image/") ? <Image aria-hidden="true" size={17} /> : <FileText aria-hidden="true" size={17} />}<span><strong>{item.file.name}</strong><small>{Math.ceil(item.file.size / 1024).toLocaleString()} KB</small></span><button aria-label={`${item.file.name} 제거`} onClick={() => setFiles((current) => current.filter((file) => file.localAttachmentId !== item.localAttachmentId))} type="button"><X aria-hidden="true" size={16} /></button></li>
      ))}</ul> : null}

      <div className="v2-product-controls">
        <label className="v2-product-attachment"><Paperclip aria-hidden="true" size={17} /> 첨부<input accept="image/*,audio/*,video/*,application/pdf,text/plain,text/markdown" multiple onChange={(event) => void addFiles(event.target.files)} type="file" /></label>
        <label>공개 범위<select onChange={(event) => { const next = event.target.value as typeof privacyLevel; setPrivacyLevel(next); if (next !== "sensitive") setSensitiveOptIn(false); }} value={privacyLevel}><option value="normal">일반</option><option value="sensitive">민감</option><option value="restricted">잠금</option></select></label>
        <label className="v2-product-toggle"><input checked={hasManualLinks ? false : aiEnabled} disabled={hasManualLinks} onChange={(event) => setAiEnabled(event.target.checked)} type="checkbox" /> 저장 후 AI 정리{hasManualLinks ? " · 수동 링크 자료에서는 사용 안 함" : ""}</label>
      </div>
      {privacyLevel === "sensitive" ? <label className="v2-sensitive-opt-in"><input checked={sensitiveOptIn} onChange={(event) => setSensitiveOptIn(event.target.checked)} type="checkbox" /><span><strong>이 기기에 암호화해 임시 저장</strong><small>선택하지 않으면 오프라인 복구 사본을 만들지 않습니다.</small></span></label> : null}
      {privacyLevel === "restricted" ? <p className="v2-product-warning"><ShieldAlert aria-hidden="true" size={17} /> 잠금 기록은 브라우저에 남기지 않습니다. 온라인 상태에서 이 탭을 닫기 전에 저장하세요.</p> : null}
      <p className="v2-product-drop-hint">스크린샷은 본문에 바로 붙여넣고, 여러 파일은 이 화면에 끌어놓을 수 있습니다.</p>
      </fieldset>
      {error ? <p className={submitState === "queued" ? "v2-product-queued" : "v2-product-error"} role="status">{error}</p> : null}
      <footer className="v2-product-footer">
        <p>원본 저장과 AI 정리는 별개입니다.</p>
        <button className="v2-product-primary" disabled={!writeEnabled || busy || localState === "loading" || (!bodyMarkdown.trim() && files.length === 0 && sourceItems.length === 0 && !templateInputs.some((input) => input.blankState === "answered"))} onClick={submit} type="button">{busy ? <LoaderCircle aria-hidden="true" className="v2-spinner" size={17} /> : <Send aria-hidden="true" size={17} />}{submitState === "uploading" ? "첨부 전송 중" : submitState === "committing" ? "원본 저장 중" : submitState === "queued" ? "지금 다시 전송" : "원본 저장"}</button>
      </footer>
      {storeRef.current ? <SyncQueueSheet currentDraftId={draftIdRef.current} onChanged={() => void refreshPendingCount()} onClose={() => setQueueOpen(false)} open={queueOpen} store={storeRef.current} transport={transportRef.current} /> : null}
    </section>
    {assistOpen ? <TemplateAssistPanel disabled={busy || submitState === "queued"} inputs={templateInputs} loading={templatesLoading} onAppendRecall={(answer) => setBodyMarkdown((current) => `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${answer}`)} onClose={() => setAssistOpen(false)} onInputsChange={setTemplateInputs} onSelect={(template) => void chooseTemplate(template)} selected={selectedTemplate} templates={templates} /> : null}
    </div>
  );
}
