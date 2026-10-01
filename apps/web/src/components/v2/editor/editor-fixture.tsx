"use client";

import {
  AlignLeft,
  Check,
  Code2,
  Eye,
  FileText,
  Focus,
  History,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { EDITOR_SPIKE_MARKDOWN, EDITOR_SPIKE_TITLE } from "@/components/v2/editor/editor-fixture-content";
import {
  createLongMarkdownFixture,
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

const modeItems: Array<{ key: EditorMode; label: string; icon: typeof FileText }> = [
  { key: "visual", label: "시각 문서", icon: FileText },
  { key: "source", label: "Markdown 소스", icon: Code2 },
  { key: "read", label: "읽기", icon: Eye },
];

type SaveState = "saving" | "saved";

export function EditorFixture() {
  const [mode, setMode] = useState<EditorMode>("visual");
  const [title, setTitle] = useState(EDITOR_SPIKE_TITLE);
  const [bodyMarkdown, setBodyMarkdown] = useState(EDITOR_SPIKE_MARKDOWN);
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [checkpointCount, setCheckpointCount] = useState(0);
  const composingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const modeSnapshotsRef = useRef<Record<EditorMode, EditorSelectionSnapshot>>({
    visual: { ...EMPTY_EDITOR_SNAPSHOT, anchor: 1, head: 1 },
    source: EMPTY_EDITOR_SNAPSHOT,
    read: { ...EMPTY_EDITOR_SNAPSHOT, anchor: 1, head: 1 },
  });

  const metrics = useMemo(() => getMarkdownMetrics(bodyMarkdown), [bodyMarkdown]);
  const checksum = useMemo(() => markdownChecksum(bodyMarkdown), [bodyMarkdown]);
  const outline = useMemo(
    () =>
      bodyMarkdown
        .split("\n")
        .flatMap((line) => {
          const match = /^(#{1,3})\s+(.+)$/u.exec(line);
          return match ? [{ level: match[1].length, label: match[2] }] : [];
        })
        .slice(0, 12),
    [bodyMarkdown],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  function scheduleLocalCheckpoint() {
    setSaveState("saving");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setSaveState("saved");
      setCheckpointCount((current) => current + 1);
      saveTimerRef.current = null;
    }, 350);
  }

  function updateMarkdown(nextMarkdown: string) {
    setBodyMarkdown(nextMarkdown);
    scheduleLocalCheckpoint();
  }

  function saveNow() {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    setSaveState("saved");
    setCheckpointCount((current) => current + 1);
  }

  function handleKeyDownCapture(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      !shouldHandleManualSaveShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        isComposing: composingRef.current || event.nativeEvent.isComposing,
      })
    ) {
      return;
    }

    event.preventDefault();
    saveNow();
  }

  function resetFixture() {
    setTitle(EDITOR_SPIKE_TITLE);
    updateMarkdown(EDITOR_SPIKE_MARKDOWN);
    modeSnapshotsRef.current = {
      visual: { ...EMPTY_EDITOR_SNAPSHOT, anchor: 1, head: 1 },
      source: EMPTY_EDITOR_SNAPSHOT,
      read: { ...EMPTY_EDITOR_SNAPSHOT, anchor: 1, head: 1 },
    };
  }

  const activeSnapshot = modeSnapshotsRef.current[mode];
  const editorSurface =
    mode === "source" ? (
      <CodeMirrorMarkdownEditor
        markdown={bodyMarkdown}
        onChange={updateMarkdown}
        onCompositionChange={(isComposing) => {
          composingRef.current = isComposing;
        }}
        onSnapshot={(snapshot) => {
          modeSnapshotsRef.current.source = snapshot;
        }}
        snapshot={activeSnapshot}
      />
    ) : (
      <MilkdownMarkdownEditor
        markdown={bodyMarkdown}
        onChange={updateMarkdown}
        onCompositionChange={(isComposing) => {
          composingRef.current = isComposing;
        }}
        onSnapshot={(snapshot) => {
          modeSnapshotsRef.current[mode] = snapshot;
        }}
        readOnly={mode === "read"}
        snapshot={activeSnapshot}
      />
    );

  return (
    <section
      aria-label="Markdown 편집기 기술 스파이크"
      className={`v2-editor-fixture${focusMode ? " is-focus" : ""}`}
      onCompositionEndCapture={() => {
        composingRef.current = false;
      }}
      onCompositionStartCapture={() => {
        composingRef.current = true;
      }}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <header className="v2-editor-header">
        <div className="v2-editor-header__document">
          <FileText aria-hidden="true" size={17} />
          <span><strong>집필 편집기</strong><small>Markdown 정본 기술 스파이크</small></span>
        </div>
        <div aria-label="편집 모드" className="v2-editor-modes" role="group">
          {modeItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-pressed={mode === item.key}
                key={item.key}
                onClick={() => setMode(item.key)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="v2-editor-header__actions">
          <button onClick={resetFixture} type="button"><RotateCcw aria-hidden="true" size={15} /> 초기화</button>
          <button aria-pressed={focusMode} onClick={() => setFocusMode((current) => !current)} type="button">
            {focusMode ? <Minimize2 aria-hidden="true" size={15} /> : <Maximize2 aria-hidden="true" size={15} />}
            {focusMode ? "집중 끝내기" : "집중 모드"}
          </button>
        </div>
      </header>

      <div className="v2-editor-workspace">
        <aside aria-label="문서 개요" className="v2-editor-outline">
          <div className="v2-editor-panel-heading"><AlignLeft aria-hidden="true" size={15} /><strong>개요</strong></div>
          <nav>
            {outline.length > 0 ? outline.map((item, index) => (
              <button className={`is-level-${item.level}`} key={`${item.label}-${index}`} type="button">{item.label}</button>
            )) : <p>제목을 추가하면 개요가 생깁니다.</p>}
          </nav>
        </aside>

        <article className="v2-editor-document">
          <label className="v2-editor-title">
            <span className="sr-only">문서 제목</span>
            <input
              aria-label="문서 제목"
              onChange={(event) => {
                setTitle(event.target.value);
                scheduleLocalCheckpoint();
              }}
              value={title}
            />
          </label>
          <div className="v2-editor-surface" data-editor-mode={mode}>
            {editorSurface}
          </div>
        </article>

        <aside aria-label="문서 정보" className="v2-editor-inspector">
          <div className="v2-editor-panel-heading"><Focus aria-hidden="true" size={15} /><strong>문서 정보</strong></div>
          <dl className="v2-editor-metrics">
            <div><dt>정본</dt><dd>body_markdown</dd></div>
            <div><dt>문자</dt><dd data-testid="markdown-character-count">{metrics.characters.toLocaleString("ko-KR")}</dd></div>
            <div><dt>줄</dt><dd>{metrics.lines.toLocaleString("ko-KR")}</dd></div>
            <div><dt>단어</dt><dd>{metrics.words.toLocaleString("ko-KR")}</dd></div>
            <div><dt>체크섬</dt><dd><code>{checksum}</code></dd></div>
          </dl>
          <div className="v2-editor-spike-tools">
            <strong>스파이크 도구</strong>
            <button onClick={() => updateMarkdown(createLongMarkdownFixture())} type="button">5만 자 fixture 불러오기</button>
            <p>시각↔소스↔읽기 전환 뒤 같은 Markdown을 사용합니다.</p>
          </div>
          <div className="v2-editor-revision-note">
            <History aria-hidden="true" size={15} />
            <span><strong>working copy</strong><small>서버 revision 연결 전 fixture</small></span>
          </div>
        </aside>
      </div>

      <footer className="v2-editor-footer">
        <p aria-live="polite" className="v2-editor-save-state">
          {saveState === "saving" ? <span className="v2-editor-saving-dot" /> : <Check aria-hidden="true" size={15} />}
          {saveState === "saving" ? "로컬에 저장 중" : "로컬에 저장됨"}
          <small data-testid="save-checkpoint-count">체크포인트 {checkpointCount}</small>
        </p>
        <p className="v2-editor-shortcut">Ctrl/Cmd + Enter로 체크포인트 저장 · IME 조합 중에는 실행하지 않음</p>
        <button className="v2-editor-save-button" onClick={saveNow} type="button"><Save aria-hidden="true" size={15} /> 지금 저장</button>
      </footer>
    </section>
  );
}

function EditorLoading() {
  return <div aria-live="polite" className="v2-editor-loading">편집기를 불러오는 중…</div>;
}
