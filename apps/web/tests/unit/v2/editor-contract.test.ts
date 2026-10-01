import { describe, expect, it } from "vitest";

import {
  clampEditorSnapshot,
  createLongMarkdownFixture,
  getMarkdownMetrics,
  markdownChecksum,
  normalizeLineEndings,
  shouldHandleManualSaveShortcut,
} from "@/lib/v2/editor/editor-contract";

describe("V2 editor contract", () => {
  it("clamps mode snapshots to the active document", () => {
    expect(clampEditorSnapshot({ anchor: -10, head: 200, scrollTop: -1 }, 80)).toEqual({
      anchor: 0,
      head: 80,
      scrollTop: 0,
    });
  });

  it("accepts Ctrl/Cmd+Enter as a manual save shortcut", () => {
    expect(shouldHandleManualSaveShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(shouldHandleManualSaveShortcut({ key: "Enter", metaKey: true })).toBe(true);
    expect(shouldHandleManualSaveShortcut({ key: "Enter" })).toBe(false);
  });

  it("never handles the save shortcut during IME composition", () => {
    expect(shouldHandleManualSaveShortcut({ key: "Enter", ctrlKey: true, isComposing: true })).toBe(false);
  });

  it("normalizes Windows and classic Mac line endings only", () => {
    expect(normalizeLineEndings("첫 줄\r\n둘째 줄\r셋째 줄")).toBe("첫 줄\n둘째 줄\n셋째 줄");
  });

  it("creates stable checksums across line-ending variants", () => {
    expect(markdownChecksum("# 제목\r\n\r\n본문")).toBe(markdownChecksum("# 제목\n\n본문"));
  });

  it("reports document metrics without treating an empty body as one line", () => {
    expect(getMarkdownMetrics("")).toEqual({ characters: 0, lines: 0, words: 0 });
    expect(getMarkdownMetrics("한 줄\n두 번째 줄")).toEqual({ characters: 10, lines: 2, words: 5 });
  });

  it("builds a deterministic Markdown fixture of at least 50,000 characters", () => {
    const first = createLongMarkdownFixture();
    const second = createLongMarkdownFixture();
    expect(first.length).toBeGreaterThanOrEqual(50_000);
    expect(first).toBe(second);
    expect(first).toContain("# 긴 글 편집 성능 fixture");
    expect(first).toContain("> 기록은 기억을 대신하는 결론이 아니라");
  });
});
