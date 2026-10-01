"use client";

import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootAttrsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  commonmark,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { callCommand, getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { Bold, Heading2, Italic, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type EditorSelectionSnapshot } from "@/lib/v2/editor/editor-contract";

type MilkdownMarkdownEditorProps = {
  markdown: string;
  readOnly?: boolean;
  snapshot?: EditorSelectionSnapshot;
  onChange: (markdown: string) => void;
  onCompositionChange: (isComposing: boolean) => void;
  onSnapshot: (snapshot: EditorSelectionSnapshot) => void;
};

export function MilkdownMarkdownEditor(props: MilkdownMarkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownMarkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

function MilkdownMarkdownEditorInner({
  markdown,
  readOnly = false,
  snapshot,
  onChange,
  onCompositionChange,
  onSnapshot,
}: MilkdownMarkdownEditorProps) {
  const scrollHostRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(markdown);
  const initialSnapshotRef = useRef(snapshot);
  const onChangeRef = useRef(onChange);
  const onSnapshotRef = useRef(onSnapshot);
  const lastEmittedRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const commandSelectionRef = useRef<{ anchor: number; head: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSnapshotRef.current = onSnapshot;
  }, [onChange, onSnapshot]);

  useEffect(() => {
    function updateNativeSelectionState() {
      const host = scrollHostRef.current;
      const selection = document.getSelection();
      const hasNativeSelection = Boolean(
        !readOnly
        && host
        && selection
        && !selection.isCollapsed
        && selection.anchorNode
        && host.contains(selection.anchorNode),
      );
      if (hasNativeSelection) setHasSelection(true);
    }

    document.addEventListener("selectionchange", updateNativeSelectionState);
    return () => document.removeEventListener("selectionchange", updateNativeSelectionState);
  }, [readOnly]);

  const { get, loading } = useEditor(
    (container) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, container);
          ctx.set(defaultValueCtx, initialMarkdownRef.current);
          ctx.set(rootAttrsCtx, {
            "aria-label": readOnly ? "읽기 모드 본문" : "시각 문서 편집기",
            "aria-readonly": readOnly ? "true" : "false",
            "data-editor-kind": readOnly ? "read" : "visual",
            role: readOnly ? "document" : "textbox",
          });
          ctx.set(editorViewOptionsCtx, {
            editable: () => !readOnly,
          });

          const listeners = ctx.get(listenerCtx);
          listeners
            .mounted((listenerContext) => {
              const view = listenerContext.get(editorViewCtx);
              const host = scrollHostRef.current;
              const max = Math.max(1, view.state.doc.content.size);
              const restoredAnchor = Math.min(max, Math.max(1, initialSnapshotRef.current?.anchor ?? 1));
              const restoredHead = Math.min(max, Math.max(1, initialSnapshotRef.current?.head ?? restoredAnchor));

              try {
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, restoredAnchor, restoredHead)));
              } catch {
                view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
              }

              requestAnimationFrame(() => {
                if (host) host.scrollTop = Math.max(0, initialSnapshotRef.current?.scrollTop ?? 0);
                if (!readOnly) view.focus();
              });
            })
            .markdownUpdated((_listenerContext, nextMarkdown, previousMarkdown) => {
              if (syncingRef.current || nextMarkdown === previousMarkdown) return;
              lastEmittedRef.current = nextMarkdown;
              onChangeRef.current(nextMarkdown);
            })
            .selectionUpdated((listenerContext, selection) => {
              const host = scrollHostRef.current;
              const nextSnapshot = {
                anchor: selection.anchor,
                head: selection.head,
                scrollTop: host?.scrollTop ?? 0,
              };
              if (host) {
                host.dataset.selectionAnchor = String(nextSnapshot.anchor);
                host.dataset.selectionHead = String(nextSnapshot.head);
                host.dataset.scrollTop = String(Math.round(nextSnapshot.scrollTop));
              }
              onSnapshotRef.current(nextSnapshot);
              if (!selection.empty) {
                commandSelectionRef.current = { anchor: selection.anchor, head: selection.head };
                setHasSelection(true);
              }
            });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        .use(listener),
    [readOnly],
  );

  useEffect(() => {
    if (loading) return;
    const editor = get();
    if (!editor) return;
    if (markdown === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }

    const current = editor.action(getMarkdown());
    if (current === markdown) return;
    syncingRef.current = true;
    editor.action(replaceAll(markdown));
    syncingRef.current = false;
  }, [get, loading, markdown]);

  function runEditorCommand(command: "strong" | "emphasis" | "heading" | "quote") {
    const editor = get();
    if (!editor) return;

    const selection = commandSelectionRef.current;
    if (selection) {
      const view = editor.ctx.get(editorViewCtx);
      const max = Math.max(1, view.state.doc.content.size);
      const anchor = Math.min(max, Math.max(1, selection.anchor));
      const head = Math.min(max, Math.max(1, selection.head));
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    }

    if (command === "strong") editor.action(callCommand(toggleStrongCommand.key));
    if (command === "emphasis") editor.action(callCommand(toggleEmphasisCommand.key));
    if (command === "heading") editor.action(callCommand(wrapInHeadingCommand.key, 2));
    if (command === "quote") editor.action(callCommand(wrapInBlockquoteCommand.key));
    const nextMarkdown = editor.action(getMarkdown());
    lastEmittedRef.current = nextMarkdown;
    onChangeRef.current(nextMarkdown);
    commandSelectionRef.current = null;
    setHasSelection(false);
  }

  return (
    <div
      className={`v2-milkdown-shell${readOnly ? " is-readonly" : ""}`}
      data-loading={loading ? "true" : "false"}
      data-testid={readOnly ? "read-editor" : "visual-editor"}
      onCompositionEndCapture={() => onCompositionChange(false)}
      onCompositionStartCapture={() => onCompositionChange(true)}
      onMouseDownCapture={(event) => {
        if (!(event.target as Element).closest(".v2-selection-toolbar")) setHasSelection(false);
      }}
      onScrollCapture={() => {
        const editor = get();
        const host = scrollHostRef.current;
        if (!editor || !host) return;
        const view = editor.ctx.get(editorViewCtx);
        const nextSnapshot = {
          anchor: view.state.selection.anchor,
          head: view.state.selection.head,
          scrollTop: host.scrollTop,
        };
        host.dataset.scrollTop = String(Math.round(host.scrollTop));
        onSnapshotRef.current(nextSnapshot);
      }}
      ref={scrollHostRef}
    >
      {!readOnly ? (
        <div aria-label="선택 영역 서식" className="v2-selection-toolbar" hidden={!hasSelection} role="toolbar">
          <button aria-label="굵게" disabled={!hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("strong")} type="button"><Bold aria-hidden="true" size={16} /></button>
          <button aria-label="기울임" disabled={!hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("emphasis")} type="button"><Italic aria-hidden="true" size={16} /></button>
          <button aria-label="제목 2" disabled={!hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("heading")} type="button"><Heading2 aria-hidden="true" size={17} /></button>
          <button aria-label="인용문" disabled={!hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("quote")} type="button"><Quote aria-hidden="true" size={16} /></button>
        </div>
      ) : null}
      {loading ? <p className="v2-editor-loading">문서 표면을 준비하는 중…</p> : null}
      <Milkdown />
    </div>
  );
}
