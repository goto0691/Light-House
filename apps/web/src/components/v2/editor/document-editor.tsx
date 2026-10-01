"use client";

import { AlignLeft, AlertTriangle, Check, Code2, Eye, FileText, Focus, History, Maximize2, Minimize2, Save } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EditorWorkingCopyStore, type EditorWorkingCopy } from "@/lib/v2/editor/editor-working-copy";

import {
  EMPTY_EDITOR_SNAPSHOT,
  getMarkdownMetrics,
  markdownChecksum,
  shouldHandleManualSaveShortcut,
  type EditorMode,
  type EditorSelectionSnapshot,
} from "@/lib/v2/editor/editor-contract";

const CodeMirrorMarkdownEditor = dynamic(
  () => import("@/components/v2/editor/code-mirror-markdown-editor").then((module) => module.CodeMirrorMarkdownEditor),
  { ssr: false, loading: () => <EditorLoading /> },
);
const MilkdownMarkdownEditor = dynamic(
  () => import("@/components/v2/editor/milkdown-markdown-editor").then((module) => module.MilkdownMarkdownEditor),
  { ssr: false, loading: () => <EditorLoading /> },
);

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";
type EditorDocument = {
  recordId: string;
  title: string;
  bodyMarkdown: string;
  currentRevisionId: string;
  currentVersion: number;
  writtenAt: string | null;
  documentStatus: "inbox" | "draft" | "revising" | "finished" | "archived";
  privacyLevel: "normal" | "sensitive" | "restricted";
  sourceCount: number;
};

type RevisionResponse =
  | { outcome: "saved"; revisionId: string; version: number; savedAt: string }
  | { outcome: "conflict"; forkRevisionId: string; currentRevisionId: string; currentVersion: number; savedAt: string }
  | { error: { message?: string } };

const modeItems: Array<{ key: EditorMode; label: string; icon: typeof FileText }> = [
  { key: "visual", label: "시각 문서", icon: FileText },
  { key: "source", label: "Markdown 소스", icon: Code2 },
  { key: "read", label: "읽기", icon: Eye },
];

function toLocalDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function DocumentEditor({ initial, writeEnabled, ownerId }: { initial: EditorDocument; writeEnabled: boolean; ownerId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<EditorMode>("visual");
  const [title, setTitle] = useState(initial.title);
  const [bodyMarkdown, setBodyMarkdown] = useState(initial.bodyMarkdown);
  const [writtenAt, setWrittenAt] = useState(toLocalDateTime(initial.writtenAt));
  const [documentStatus, setDocumentStatus] = useState(initial.documentStatus);
  const [privacyLevel, setPrivacyLevel] = useState(initial.privacyLevel);
  const [currentRevisionId, setCurrentRevisionId] = useState(initial.currentRevisionId);
  const [currentVersion, setCurrentVersion] = useState(initial.currentVersion);
  const [focusMode, setFocusMode] = useState(false);
  const [recordInfoOpen, setRecordInfoOpen] = useState(false);
  const recordInfoId = useId();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [sensitiveOptIn, setSensitiveOptIn] = useState(false);
  const [localStatus, setLocalStatus] = useState<"checking" | "ready" | "saved" | "failed" | "disabled">("checking");
  const [recoveryCopies, setRecoveryCopies] = useState<EditorWorkingCopy[]>([]);
  const copyStoreRef = useRef(new EditorWorkingCopyStore());
  const copyIdRef = useRef(`editor-${ownerId}-${initial.recordId}-${crypto.randomUUID()}`);
  const recoveredFromRef = useRef<string | null>(null);
  const savedGenerationRef = useRef(0);
  const flushLocalRef = useRef<() => Promise<boolean>>(async () => false);
  const generationRef = useRef(0);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const composingRef = useRef(false);
  const retryKeysRef = useRef(new Map<number, string>());
  const timerRef = useRef<number | null>(null);
  const modeSnapshotsRef = useRef<Record<EditorMode, EditorSelectionSnapshot>>({
    visual: { ...EMPTY_EDITOR_SNAPSHOT, anchor: 1, head: 1 },
    source: EMPTY_EDITOR_SNAPSHOT,
    read: { ...EMPTY_EDITOR_SNAPSHOT, anchor: 1, head: 1 },
  });

  const metrics = useMemo(() => getMarkdownMetrics(bodyMarkdown), [bodyMarkdown]);
  const checksum = useMemo(() => markdownChecksum(bodyMarkdown), [bodyMarkdown]);
  const outline = useMemo(() => bodyMarkdown.split("\n").flatMap((line) => {
    const match = /^(#{1,3})\s+(.+)$/u.exec(line);
    return match ? [{ level: match[1].length, label: match[2] }] : [];
  }).slice(0, 12), [bodyMarkdown]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await copyStoreRef.current.observeServerPolicy({ ownerId, recordId: initial.recordId, currentVersion: initial.currentVersion, privacyLevel: initial.privacyLevel });
      if (initial.privacyLevel === "restricted") {
        if (active) setLocalStatus("disabled");
        return;
      }
      const copies = await copyStoreRef.current.list(ownerId, initial.recordId, sensitiveOptIn);
      if (!active) return;
      setRecoveryCopies(copies.filter((copy) => copy.id !== copyIdRef.current && (copy.bodyMarkdown !== initial.bodyMarkdown || copy.title !== initial.title || copy.writtenAt !== toLocalDateTime(initial.writtenAt) || copy.documentStatus !== initial.documentStatus || copy.privacyLevel !== initial.privacyLevel)));
      setLocalStatus(initial.privacyLevel === "sensitive" && !sensitiveOptIn ? "disabled" : "ready");
    };
    void load().catch(() => { if (active) setLocalStatus("failed"); });
    return () => { active = false; };
  }, [initial.bodyMarkdown, initial.currentVersion, initial.documentStatus, initial.privacyLevel, initial.recordId, initial.title, initial.writtenAt, ownerId, sensitiveOptIn]);

  const persistCurrent = useCallback(async () => {
    if (generationRef.current === savedGenerationRef.current) return false;
    try {
      const persisted = await copyStoreRef.current.put({
        id: copyIdRef.current, ownerId, recordId: initial.recordId, generation: generationRef.current,
        baseRevisionId: currentRevisionId, baseVersion: currentVersion, title, bodyMarkdown, writtenAt, documentStatus, privacyLevel,
        updatedAt: new Date().toISOString(),
      }, sensitiveOptIn);
      setLocalStatus(persisted ? "saved" : "disabled");
      return persisted;
    } catch {
      setLocalStatus("failed");
      return false;
    }
  }, [bodyMarkdown, currentRevisionId, currentVersion, documentStatus, initial.recordId, ownerId, privacyLevel, sensitiveOptIn, title, writtenAt]);

  useEffect(() => {
    flushLocalRef.current = persistCurrent;
    const protection = privacyLevel !== "normal" ? copyStoreRef.current.protectLocalPrivacy({ ownerId, recordId: initial.recordId, currentVersion, privacyLevel }) : null;
    if (protection) void protection.catch(() => setLocalStatus("failed"));
    if (privacyLevel === "restricted" || (privacyLevel === "sensitive" && !sensitiveOptIn)) {
      void protection?.then(() => setLocalStatus("disabled")).catch(() => setLocalStatus("failed"));
      return;
    }
    if (generationRef.current === savedGenerationRef.current) return;
    const timer = window.setTimeout(() => void persistCurrent(), 300);
    return () => window.clearTimeout(timer);
  }, [currentVersion, initial.recordId, ownerId, persistCurrent, privacyLevel, sensitiveOptIn]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generationRef.current === savedGenerationRef.current) return;
      void flushLocalRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    const visibility = () => { if (document.visibilityState === "hidden") void flushLocalRef.current(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      void flushLocalRef.current();
    };
  }, []);

  function restoreWorkingCopy(copy: EditorWorkingCopy) {
    setTitle(copy.title); setBodyMarkdown(copy.bodyMarkdown); setWrittenAt(copy.writtenAt);
    setDocumentStatus(copy.documentStatus); setPrivacyLevel(copy.privacyLevel);
    setCurrentRevisionId(copy.baseRevisionId); setCurrentVersion(copy.baseVersion);
    recoveredFromRef.current = copy.id;
    setRecoveryCopies([]);
    markDirty();
  }

  async function leaveEditor() {
    if (generationRef.current === savedGenerationRef.current) { router.push(`/v2/records/${initial.recordId}`); return; }
    await persistCurrent();
    await saveCurrent();
    const canRecover = generationRef.current === savedGenerationRef.current || await flushLocalRef.current();
    if (canRecover) router.push(`/v2/records/${initial.recordId}`);
    else setError("아직 저장되지 않아 이 화면에 머뭅니다. 연결을 확인한 뒤 다시 저장해주세요.");
  }

  function markDirty() {
    generationRef.current += 1;
    if (conflictRef.current) {
      setSaveState("conflict");
      return;
    }
    setError(null);
    setSaveState("dirty");
  }

  function compositionChange(value: boolean) {
    composingRef.current = value;
    setIsComposing(value);
  }

  async function saveCurrent() {
    if (!writeEnabled || savingRef.current || composingRef.current || conflictRef.current || !title.trim()) return;
    const generation = generationRef.current;
    const idempotencyKey = retryKeysRef.current.get(generation) ?? `document-${initial.recordId}-${generation}-${crypto.randomUUID()}`;
    retryKeysRef.current.set(generation, idempotencyKey);
    savingRef.current = true;
    setSaveState("saving");
    setError(null);
    try {
      const response = await fetch(`/api/v2/records/${initial.recordId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          expectedVersion: currentVersion,
          expectedRevisionId: currentRevisionId,
          title,
          bodyMarkdown,
          writtenAt: writtenAt ? new Date(writtenAt).toISOString() : null,
          documentStatus,
          privacyLevel,
        }),
      });
      const result = (await response.json()) as RevisionResponse;
      if (response.status === 409 && "outcome" in result && result.outcome === "conflict") {
        conflictRef.current = true;
        setCurrentRevisionId(result.currentRevisionId);
        setCurrentVersion(result.currentVersion);
        setSaveState("conflict");
        setError("다른 창에서 먼저 저장되었습니다. 내 편집은 fork revision으로 보존했으며 서버 본문을 자동으로 덮지 않았습니다.");
        return;
      }
      if (!response.ok || !("outcome" in result) || result.outcome !== "saved") {
        throw new Error("error" in result ? result.error.message || "저장하지 못했습니다." : "저장하지 못했습니다.");
      }
      setCurrentRevisionId(result.revisionId);
      setCurrentVersion(result.version);
      await copyStoreRef.current.observeServerPolicy({ ownerId, recordId: initial.recordId, currentVersion: result.version, privacyLevel }).catch(() => setLocalStatus("failed"));
      savedGenerationRef.current = generation;
      await copyStoreRef.current.remove(copyIdRef.current, generation).catch(() => setLocalStatus("failed"));
      if (recoveredFromRef.current) { await copyStoreRef.current.remove(recoveredFromRef.current).catch(() => setLocalStatus("failed")); recoveredFromRef.current = null; }
      retryKeysRef.current.delete(generation);
      setSaveState(generationRef.current === generation ? "saved" : "dirty");
    } catch (caught) {
      setSaveState("error");
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally {
      savingRef.current = false;
    }
  }

  useEffect(() => {
    if (saveState !== "dirty" || isComposing || !writeEnabled) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void saveCurrent();
    }, 1200);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [bodyMarkdown, currentRevisionId, currentVersion, documentStatus, isComposing, privacyLevel, saveState, title, writeEnabled, writtenAt]);

  function handleKeyDownCapture(event: ReactKeyboardEvent<HTMLElement>) {
    if (!shouldHandleManualSaveShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: composingRef.current || event.nativeEvent.isComposing })) return;
    event.preventDefault();
    void saveCurrent();
  }

  const activeSnapshot = modeSnapshotsRef.current[mode];
  const editorSurface = mode === "source" ? (
    <CodeMirrorMarkdownEditor markdown={bodyMarkdown} onChange={(value) => { setBodyMarkdown(value); markDirty(); }} onCompositionChange={compositionChange} onSnapshot={(snapshot) => { modeSnapshotsRef.current.source = snapshot; }} snapshot={activeSnapshot} />
  ) : (
    <MilkdownMarkdownEditor markdown={bodyMarkdown} onChange={(value) => { setBodyMarkdown(value); markDirty(); }} onCompositionChange={compositionChange} onSnapshot={(snapshot) => { modeSnapshotsRef.current[mode] = snapshot; }} readOnly={mode === "read"} snapshot={activeSnapshot} />
  );

  return (
    <section className={`v2-editor-fixture${focusMode ? " is-focus" : ""}${recordInfoOpen ? " is-info-open" : ""}`} onCompositionEndCapture={() => compositionChange(false)} onCompositionStartCapture={() => compositionChange(true)} onKeyDownCapture={handleKeyDownCapture}>
      <header className="v2-editor-header">
        <div className="v2-editor-header__document"><FileText aria-hidden="true" size={17} /><span><strong>기록 편집</strong><small>revision {currentVersion}</small></span></div>
        <div aria-label="편집 모드" className="v2-editor-modes" role="group">
          {modeItems.map((item) => { const Icon = item.icon; return <button aria-pressed={mode === item.key} key={item.key} onClick={() => setMode(item.key)} type="button"><Icon aria-hidden="true" size={15} />{item.label}</button>; })}
        </div>
        <div className="v2-editor-header__actions">
          <Link className="v2-editor-back-link" href={`/v2/records/${initial.recordId}`} onNavigate={(event) => { if (generationRef.current !== savedGenerationRef.current) { event.preventDefault(); void leaveEditor(); } }}>기록으로</Link>
          <button aria-label={focusMode ? "집중 끝내기" : "집중 모드"} aria-pressed={focusMode} onClick={() => { setRecordInfoOpen(false); setFocusMode((current) => !current); }} type="button">{focusMode ? <Minimize2 aria-hidden="true" size={15} /> : <Maximize2 aria-hidden="true" size={15} />}<span>{focusMode ? "집중 끝내기" : "집중 모드"}</span></button>
          <button aria-controls={recordInfoId} aria-expanded={recordInfoOpen} aria-label={recordInfoOpen ? "기록 정보 닫기" : "기록 정보 열기"} className="v2-editor-info-toggle" onClick={() => { setRecordInfoOpen((current) => !current); setFocusMode(false); }} type="button"><Focus aria-hidden="true" size={15} /><span>기록 정보</span></button>
        </div>
      </header>

      {recoveryCopies.length ? <div className="v2-editor-conflict" role="status"><span>이 기기에 저장되지 않은 편집 사본 {recoveryCopies.length}개가 있습니다.</span>{recoveryCopies.map((copy) => <button key={copy.id} onClick={() => restoreWorkingCopy(copy)} type="button">{new Date(copy.updatedAt).toLocaleString("ko-KR")} 사본 복구</button>)}<button onClick={() => { void Promise.all(recoveryCopies.map((copy) => copyStoreRef.current.remove(copy.id))).then(() => setRecoveryCopies([])); }} type="button">사본 버리고 서버 내용 유지</button></div> : null}
      {saveState === "conflict" ? <div className="v2-editor-conflict" role="alert"><AlertTriangle aria-hidden="true" size={17} /><span>{error}</span><button onClick={() => { void persistCurrent().then((saved) => { if (saved || generationRef.current === savedGenerationRef.current) window.location.reload(); else setError("현재 변경을 복구할 수 있도록 먼저 본문을 복사하거나 저장해주세요."); }); }} type="button">서버 최신본 열기</button></div> : null}
      <div className="v2-editor-workspace">
        <aside aria-label="문서 개요" className="v2-editor-outline"><div className="v2-editor-panel-heading"><AlignLeft aria-hidden="true" size={15} /><strong>개요</strong></div><nav>{outline.length ? outline.map((item, index) => <button className={`is-level-${item.level}`} key={`${item.label}-${index}`} type="button">{item.label}</button>) : <p>본문 제목이 여기에 표시됩니다.</p>}</nav></aside>
        <article className="v2-editor-document">
          <label className="v2-editor-title"><span className="sr-only">문서 제목</span><input aria-label="문서 제목" onChange={(event) => { setTitle(event.target.value); markDirty(); }} value={title} /></label>
          <div className="v2-editor-surface" data-editor-mode={mode}>{editorSurface}</div>
        </article>
        <aside aria-label="문서 정보" className="v2-editor-inspector" id={recordInfoId}>
          <div className="v2-editor-panel-heading"><Focus aria-hidden="true" size={15} /><strong>문서 정보</strong></div>
          <div className="v2-editor-fields">
            <label><span>작성 시각</span><input onChange={(event) => { setWrittenAt(event.target.value); markDirty(); }} type="datetime-local" value={writtenAt} /></label>
            <label><span>문서 상태</span><select onChange={(event) => { setDocumentStatus(event.target.value as EditorDocument["documentStatus"]); markDirty(); }} value={documentStatus}><option value="inbox">받은 기록</option><option value="draft">초안</option><option value="revising">다듬는 중</option><option value="finished">완성</option><option value="archived">보관</option></select></label>
            <label><span>공개 범위</span><select onChange={(event) => { setPrivacyLevel(event.target.value as EditorDocument["privacyLevel"]); markDirty(); }} value={privacyLevel}><option value="normal">일반</option><option value="sensitive">민감</option><option value="restricted">잠금</option></select></label>
          </div>
          <dl className="v2-editor-metrics"><div><dt>문자</dt><dd>{metrics.characters.toLocaleString("ko-KR")}</dd></div><div><dt>단어</dt><dd>{metrics.words.toLocaleString("ko-KR")}</dd></div><div><dt>원본 근거</dt><dd>{initial.sourceCount}</dd></div><div><dt>체크섬</dt><dd><code>{checksum}</code></dd></div></dl>
          <div className="v2-editor-revision-note"><History aria-hidden="true" size={15} /><span><strong>revision {currentVersion}</strong><small>저장할 때마다 불변 이력 추가</small></span></div>
        </aside>
      </div>
      <footer className="v2-editor-footer">
        <p aria-live="polite" className="v2-editor-save-state">{saveState === "saved" ? <Check aria-hidden="true" size={15} /> : saveState === "conflict" ? <AlertTriangle aria-hidden="true" size={15} /> : <span className="v2-editor-saving-dot" />}{!writeEnabled ? "쓰기 기능 꺼짐" : saveState === "saving" ? "서버 revision 저장 중" : saveState === "dirty" ? "변경됨" : saveState === "error" ? "저장 실패 · 다시 시도 가능" : saveState === "conflict" ? "충돌 fork 보존됨" : "서버에 저장됨"}</p>
        <p className="v2-editor-shortcut">Ctrl/Cmd + Enter로 저장 · IME 조합 중에는 저장하지 않음</p>
        <button className="v2-editor-save-button" disabled={!writeEnabled || saveState === "saving" || saveState === "conflict" || !title.trim()} onClick={() => void saveCurrent()} type="button"><Save aria-hidden="true" size={15} /> 지금 저장</button>
      </footer>
      <div className="v2-editor-local-copy" aria-live="polite">
        <span>{localStatus === "saved" ? "이 기기에 편집 복구 사본 저장됨" : localStatus === "failed" ? "기기 복구 사본 저장 실패 · 서버 저장 전에는 화면을 닫지 마세요" : privacyLevel === "restricted" ? "잠금 기록은 기기에 복구 사본을 남기지 않습니다" : privacyLevel === "sensitive" && !sensitiveOptIn ? "민감 기록의 기기 복구 사본 사용 안 함" : localStatus === "disabled" ? "기기 복구 사본 사용이 제한되었습니다. 개인정보 설정을 새로고침해 확인하세요" : "변경 내용은 기기 복구 사본에도 저장됩니다"}</span>
        {privacyLevel === "sensitive" ? <label><input type="checkbox" checked={sensitiveOptIn} onChange={(event) => {
          setSensitiveOptIn(event.target.checked);
          if (!event.target.checked) { setRecoveryCopies([]); void copyStoreRef.current.removeRecord(ownerId, initial.recordId).catch(() => setLocalStatus("failed")); }
        }} /> 이 기기에 암호화해 편집 사본 저장</label> : null}
      </div>
      {error && saveState !== "conflict" ? <p className="v2-editor-floating-error" role="alert">{error}</p> : null}
    </section>
  );
}

function EditorLoading() { return <div aria-live="polite" className="v2-editor-loading">편집기를 불러오는 중…</div>; }
