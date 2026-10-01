export type EditorMode = "visual" | "source" | "read";

export type EditorSelectionSnapshot = Readonly<{
  anchor: number;
  head: number;
  scrollTop: number;
}>;

export const EMPTY_EDITOR_SNAPSHOT: EditorSelectionSnapshot = {
  anchor: 0,
  head: 0,
  scrollTop: 0,
};

export function clampEditorSnapshot(
  snapshot: EditorSelectionSnapshot | undefined,
  documentLength: number,
): EditorSelectionSnapshot {
  const max = Math.max(0, documentLength);
  const clamp = (value: number) => Math.min(max, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));

  return {
    anchor: clamp(snapshot?.anchor ?? 0),
    head: clamp(snapshot?.head ?? snapshot?.anchor ?? 0),
    scrollTop: Math.max(0, Number.isFinite(snapshot?.scrollTop) ? snapshot?.scrollTop ?? 0 : 0),
  };
}

export function shouldHandleManualSaveShortcut(input: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}) {
  return input.key === "Enter" && Boolean(input.ctrlKey || input.metaKey) && !input.isComposing;
}

export function normalizeLineEndings(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

export function markdownChecksum(markdown: string) {
  const normalized = normalizeLineEndings(markdown);
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getMarkdownMetrics(markdown: string) {
  const normalized = normalizeLineEndings(markdown);

  return {
    characters: normalized.length,
    lines: normalized.length === 0 ? 0 : normalized.split("\n").length,
    words: normalized.trim() === "" ? 0 : normalized.trim().split(/\s+/u).length,
  };
}

export function createLongMarkdownFixture(minimumCharacters = 50_000) {
  const section = `## 반복해서 떠오른 장면\n\n비가 그친 뒤의 골목은 조용했고, 창문마다 다른 빛이 머물렀다. 나는 그 장면이 왜 오래 남는지 천천히 적어 보기로 했다.\n\n- 원본의 표현을 지운 채 정리하지 않는다.\n- 날짜와 장소는 확실한 근거가 있을 때만 연결한다.\n- 다음에 찾을 단어를 본문 안에 자연스럽게 남긴다.\n\n> 기록은 기억을 대신하는 결론이 아니라, 다시 돌아갈 수 있는 입구다.\n\n`;
  let markdown = "# 긴 글 편집 성능 fixture\n\n";
  let index = 1;

  // Milkdown intentionally canonicalizes some repeated blank space. Keep a
  // small margin so the parsed/serialized document still exercises 50k+ text.
  while (markdown.length < minimumCharacters + 1_000) {
    markdown += `${section.replace("장면", `장면 ${index}`)}\n`;
    index += 1;
  }

  return markdown;
}
