import { expect, test } from "vitest";
import { sourceTextareaValue, textareaSelectionToSourceRange } from "@/lib/v2/domain/textarea-source-range";

test("maps normalized textarea offsets to exact mixed CRLF/CR/LF source without rewriting it", () => {
  const source = "1/3:\r\n  창가 👀  \rnegative:  blur\n--ar 3:2\r\n";
  const displayed = sourceTextareaValue(source);
  expect(displayed).toBe("1/3:\n  창가 👀  \nnegative:  blur\n--ar 3:2\n");
  for (const selected of ["  창가 👀  ", "negative:  blur", "--ar 3:2"]) {
    const start = displayed.indexOf(selected), range = textareaSelectionToSourceRange(source, displayed, start, start + selected.length);
    expect(source.slice(range.textStart, range.textEnd)).toBe(selected); expect(range.textStart).toBe(source.indexOf(selected));
  }
  const whole = textareaSelectionToSourceRange(source, displayed, 0, displayed.length);
  expect(whole).toEqual({ textStart: 0, textEnd: source.length }); expect(source.slice(whole.textStart, whole.textEnd)).toBe(source);
});
test("selection across several lines retains original CRLF/CR characters and spaces", () => {
  const source = "x\r\n  same  \rsame\n  same  \r\ny", displayed = sourceTextareaValue(source);
  const start = displayed.indexOf("  same"), end = displayed.lastIndexOf("y");
  const range = textareaSelectionToSourceRange(source, displayed, start, end);
  expect(source.slice(range.textStart, range.textEnd)).toBe("  same  \rsame\n  same  \r\n");
});
test("all nonempty ranges around newline boundaries map consistently", () => {
  for (const source of ["\r\na\r\nb\r\n", "\ra\rb\r", "a\nb\n", "\r\r\n\n", " abc "]) {
    const displayed = sourceTextareaValue(source);
    for (let start = 0; start < displayed.length; start++) for (let end = start + 1; end <= displayed.length; end++) {
      const range = textareaSelectionToSourceRange(source, displayed, start, end);
      expect(sourceTextareaValue(source.slice(range.textStart, range.textEnd))).toBe(displayed.slice(start, end));
    }
  }
});
test.each([[0, 0], [-1, 2], [0, 99], [0.5, 3], [2, 3], [0, 2]])("rejects empty, invalid or emoji-splitting display range %s..%s", (start, end) => {
  expect(() => textareaSelectionToSourceRange("a👀b", "a👀b", start, end)).toThrow();
});
test("does not map edited text, collapsed whitespace or a different source", () => {
  for (const value of ["a b", "other", "  a b", "a\r\nb"]) expect(() => textareaSelectionToSourceRange("a  b", value, 0, 1)).toThrow();
});
