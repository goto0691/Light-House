"use client";

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useEffect, useLayoutEffect, useRef } from "react";
import { sourceTextareaValue, textareaSelectionToSourceRange } from "@/lib/v2/domain/textarea-source-range";

type SourceRange = { textStart: number; textEnd: number };
type Props = { source: string; range: SourceRange | null; disabled: boolean; onSelection: (range: SourceRange | null, error: string) => void };

/** Readonly document, focusable selection surface. Native readonly textareas on
 * Windows Chromium do not support caret movement with Shift+arrow keys. */
export function SourceRangePicker({ source, range, disabled, onSelection }: Props) {
  const hostRef = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const callback = useRef(onSelection), unavailable = useRef(disabled), syncing = useRef(false), activeSource = useRef<string | null>(source);
  useLayoutEffect(() => { callback.current = onSelection; unavailable.current = disabled; }, [onSelection, disabled]);
  // Reject late notifications before passive cleanup destroys an old view.
  useLayoutEffect(() => { activeSource.current = source; return () => { activeSource.current = null; }; }, [source]);

  useEffect(() => {
    if (!hostRef.current) return;
    const displayed = sourceTextareaValue(source);
    const view = new EditorView({ parent: hostRef.current, state: EditorState.create({ doc: displayed, extensions: [
      minimalSetup, EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorState.allowMultipleSelections.of(false),
      // The original is never an editing buffer, including paste/drop/IME input.
      EditorState.changeFilter.of(() => false),
      EditorView.contentAttributes.of({ tabindex: "0", role: "textbox", "aria-label": "발췌 범위 선택", "aria-readonly": "true", "aria-multiline": "true", "aria-describedby": "manual-selection-help" }),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet || syncing.current || unavailable.current || activeSource.current !== source) return;
        const selection = update.state.selection.main;
        try { callback.current(selection.empty ? null : textareaSelectionToSourceRange(source, displayed, selection.from, selection.to), ""); }
        catch (error) { callback.current(null, error instanceof Error ? error.message : "선택 범위를 확인해 주세요."); }
      }),
    ] }) });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, [source]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const from = range ? sourceTextareaValue(source.slice(0, range.textStart)).length : selection.head;
    const to = range ? sourceTextareaValue(source.slice(0, range.textEnd)).length : from;
    if (selection.from === from && selection.to === to) return;
    syncing.current = true;
    try { view.dispatch({ selection: EditorSelection.single(from, to) }); }
    finally { syncing.current = false; }
  }, [range, source]);

  return <div aria-disabled={disabled} className="v2-source-range-picker" inert={disabled} ref={hostRef} />;
}
