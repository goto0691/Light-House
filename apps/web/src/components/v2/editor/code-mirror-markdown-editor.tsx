"use client";

import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import {
  clampEditorSnapshot,
  type EditorSelectionSnapshot,
} from "@/lib/v2/editor/editor-contract";

type CodeMirrorMarkdownEditorProps = {
  markdown: string;
  snapshot?: EditorSelectionSnapshot;
  onChange: (markdown: string) => void;
  onCompositionChange: (isComposing: boolean) => void;
  onSnapshot: (snapshot: EditorSelectionSnapshot) => void;
};

const codeMirrorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--v2-text-primary)",
    fontSize: "14px",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--v2-accent-primary)",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: "1.75",
    minHeight: "580px",
    padding: "28px 32px 160px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--v2-accent-primary)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--v2-surface-selected) 68%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--v2-surface-panel)",
    borderRight: "1px solid var(--v2-border-subtle)",
    color: "var(--v2-text-muted)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--v2-accent-primary) 24%, transparent) !important",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    overflow: "auto",
  },
  ".cm-focused": {
    outline: "none",
  },
});

export function CodeMirrorMarkdownEditor({
  markdown,
  snapshot,
  onChange,
  onCompositionChange,
  onSnapshot,
}: CodeMirrorMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSnapshotRef = useRef(onSnapshot);
  const initialMarkdownRef = useRef(markdown);
  const initialSnapshotRef = useRef(snapshot);
  const lastEmittedRef = useRef<string | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSnapshotRef.current = onSnapshot;
  }, [onChange, onSnapshot]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    function publishSnapshot(view: EditorView) {
      const nextSnapshot = {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      };
      const snapshotHost = hostRef.current;
      if (snapshotHost) {
        snapshotHost.dataset.selectionAnchor = String(nextSnapshot.anchor);
        snapshotHost.dataset.selectionHead = String(nextSnapshot.head);
        snapshotHost.dataset.scrollTop = String(Math.round(nextSnapshot.scrollTop));
      }
      onSnapshotRef.current(nextSnapshot);
    }

    const restored = clampEditorSnapshot(initialSnapshotRef.current, initialMarkdownRef.current.length);
    const state = EditorState.create({
      doc: initialMarkdownRef.current,
      selection: EditorSelection.single(restored.anchor, restored.head),
      extensions: [
        basicSetup,
        markdownLanguage(),
        EditorView.lineWrapping,
        codeMirrorTheme,
        EditorView.contentAttributes.of({
          "aria-label": "Markdown 소스 편집기",
          "data-editor-kind": "source",
          spellcheck: "true",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) {
            const nextMarkdown = update.state.doc.toString();
            lastEmittedRef.current = nextMarkdown;
            onChangeRef.current(nextMarkdown);
          }
          if (update.docChanged || update.selectionSet || update.viewportChanged) publishSnapshot(update.view);
        }),
      ],
    });

    const view = new EditorView({ parent: host, state });
    viewRef.current = view;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = restored.scrollTop;
      view.focus();
      publishSnapshot(view);
    });

    return () => {
      publishSnapshot(view);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (markdown === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }

    const current = view.state.doc.toString();
    if (current === markdown) return;

    const selection = clampEditorSnapshot(
      {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      },
      markdown.length,
    );
    syncingRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: markdown },
      selection: EditorSelection.single(selection.anchor, selection.head),
    });
    syncingRef.current = false;
  }, [markdown]);

  return (
    <div
      className="v2-codemirror-editor"
      data-testid="source-editor"
      onCompositionEndCapture={() => onCompositionChange(false)}
      onCompositionStartCapture={() => onCompositionChange(true)}
      onScrollCapture={() => {
        const view = viewRef.current;
        const host = hostRef.current;
        if (!view || !host) return;
        const nextSnapshot = {
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
          scrollTop: view.scrollDOM.scrollTop,
        };
        host.dataset.scrollTop = String(Math.round(nextSnapshot.scrollTop));
        onSnapshotRef.current(nextSnapshot);
      }}
      ref={hostRef}
    />
  );
}
