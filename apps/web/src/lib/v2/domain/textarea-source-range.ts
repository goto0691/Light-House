/** Textarea values normalize CRLF and lone CR to LF. Stored source offsets do
 * not. Keep this display-only conversion out of canonical storage and hashing. */
export function sourceTextareaValue(source: string) { return source.replace(/\r\n?/g, "\n"); }

export function textareaSelectionToSourceRange(source: string, displayedValue: string, start: number, end: number): { textStart: number; textEnd: number } {
  if (displayedValue !== sourceTextareaValue(source) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > displayedValue.length) throw new Error("표시된 원문과 선택 범위가 일치하지 않습니다.");
  let position = 0, offset = 0, textStart = 0;
  while (position < end) {
    if (position === start) textStart = offset;
    offset += source[offset] === "\r" && source[offset + 1] === "\n" ? 2 : 1;
    position++;
  }
  for (const boundary of [textStart, offset]) {
    const before = source.charCodeAt(boundary - 1), after = source.charCodeAt(boundary);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) throw new Error("이모지를 나누지 않도록 선택 범위를 다시 지정해 주세요.");
  }
  return { textStart, textEnd: offset };
}
