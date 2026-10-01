import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, test, vi } from "vitest";

import { sqliteUnicodeCaseVariants, sqliteUnicodeLiteralPattern } from "@/lib/v2/retrieval/unicode-search-pattern";
import { firstRecordTextMatch } from "@/lib/v2/retrieval/record-location-v1";

const database = new DatabaseSync(":memory:");
const statement = database.prepare("select ? glob ? as matched");
afterAll(() => database.close());
function sqlMatches(text: string, token: string) {
  return statement.get(text, sqliteUnicodeLiteralPattern(token))!.matched === 1;
}
function jsMatches(text: string, token: string) { return firstRecordTextMatch(text, [token]) !== null; }

// Verify the checked-in generated classes, not a runtime network response. This
// fingerprint was derived from the official C/S rows before code generation.
const implementation = readFileSync(new URL("../../../src/lib/v2/retrieval/unicode-search-pattern.ts", import.meta.url), "utf8");
const generated = /const SIMPLE_CASE_FOLD_GROUPS = (\[[\s\S]*?\]);/.exec(implementation)![1];
const groups = JSON.parse(generated.replace(/,\s*\]/, "]")) as string[];

describe("single-scalar Unicode case alternatives", () => {
  test("returns every pinned class in codepoint order, without changing its pattern or exposing mutable shared data", () => {
    for (const group of groups) for (const character of group) {
      const variants = sqliteUnicodeCaseVariants(character);
      expect(variants).toEqual([...group]);
      expect(Object.isFrozen(variants)).toBe(true);
      expect(variants.every((value) => Array.from(value).length === 1)).toBe(true);
      expect(sqliteUnicodeLiteralPattern(character)).toBe(`*[${variants.join("")}]*`);
    }
  });

  test.each(["한", "👀", "\u{10ffff}", "İ", "ı", "[", "]", "*", "?", "%", "_", "'", "\r", "\n"])
    ("returns the original nonfolding scalar %j exactly", (character) => {
    const variants = sqliteUnicodeCaseVariants(character);
    expect(variants).toEqual([character]); expect(Object.isFrozen(variants)).toBe(true);
  });

  test("preserves simple C/S, not full or Turkic alternatives", () => {
    expect(sqliteUnicodeCaseVariants("É")).toEqual(["É", "é"]);
    expect(sqliteUnicodeCaseVariants("ß")).toEqual(["ß", "ẞ"]);
    expect(sqliteUnicodeCaseVariants("ς")).toEqual(["Σ", "ς", "σ"]);
    expect(sqliteUnicodeCaseVariants("K")).toEqual(["K", "k", "K"]);
    expect(sqliteUnicodeCaseVariants("ſ")).toEqual(["S", "s", "ſ"]);
    expect(sqliteUnicodeCaseVariants("i")).toEqual(["I", "i"]);
    expect(sqliteUnicodeCaseVariants("𐐨")).toEqual(["𐐀", "𐐨"]);
  });

  test("a caller cannot poison subsequent case alternatives or GLOB generation", () => {
    const variants = sqliteUnicodeCaseVariants("K") as string[];
    expect(() => { variants[0] = "x"; }).toThrow(TypeError);
    expect(() => variants.push("y")).toThrow(TypeError);
    expect(sqliteUnicodeCaseVariants("K")).toEqual(["K", "k", "K"]);
    expect(sqliteUnicodeLiteralPattern("k")).toBe("*[KkK]*");
    const literal = sqliteUnicodeCaseVariants("👀") as string[];
    expect(() => { literal[0] = "x"; }).toThrow(TypeError);
    expect(sqliteUnicodeCaseVariants("👀")).toEqual(["👀"]);
  });

  test.each(["", "ab", "한글", "👀a", "👀👀", "\0", "\ud800", "\udc00", "a\ud800", "\udc00a", "x".repeat(301)])
    ("rejects non-scalar or lossy input %#", (character) => {
    expect(() => sqliteUnicodeCaseVariants(character)).toThrow(RangeError);
  });

  test("rejects nonstring scalar input without invoking coercion hooks", () => {
    const hook = vi.fn(() => "a");
    for (const candidate of [null, undefined, 1, ["a"], { toString: hook, valueOf: hook }])
      expect(() => sqliteUnicodeCaseVariants(candidate as unknown as string)).toThrow(RangeError);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe("pinned Unicode 16.0 default simple case-fold classes", () => {
  test("records the primary source, byte digest and independently derived class fingerprint", () => {
    expect(implementation).toContain("https://www.unicode.org/Public/16.0.0/ucd/CaseFolding.txt");
    expect(implementation).toContain("Source bytes: 86092; SHA-256: 6f1f9c588eb4a5c718d9e8f93b782685e5c7fec872cf05e8e6878053599e09bb");
    expect(implementation).toContain("UNICODE LICENSE V3");
    expect(createHash("sha256").update(groups.join(" "), "utf8").digest("hex"))
      .toBe("b97ebbdf941cb23d8e96c61df3a97934620390509c05ae0587315b2fd0fb3335");
    expect(groups).toHaveLength(1454);
    expect(groups.reduce((count, group) => count + [...group].length, 0)).toBe(2938);
    expect(new Set(groups.flatMap((group) => [...group])).size).toBe(2938);
    expect(Math.max(...groups.map((group) => [...group].length))).toBe(4);
    expect(Math.max(...groups.map((group) => group.length))).toBe(4);
    for (const group of groups) expect(group).not.toMatch(/[\[\]*?^\-\u0000]/);
  });

  test("every generated equivalence and a disjoint class agree with actual SQLite GLOB and RegExp iu", () => {
    let comparisons = 0;
    groups.forEach((group, index) => {
      const members = [...group], other = [...groups[(index + 1) % groups.length]][0];
      for (const token of members) {
        expect(sqliteUnicodeLiteralPattern(token)).toBe(`*[${group}]*`);
        for (const member of members) {
          const value = `\r\n👤${member}\n`;
          expect(jsMatches(value, token), `${token.codePointAt(0)?.toString(16)} / ${member.codePointAt(0)?.toString(16)}`).toBe(true);
          expect(sqlMatches(value, token)).toBe(true);
          comparisons++;
        }
        expect(jsMatches(other, token)).toBe(false);
        expect(sqlMatches(other, token)).toBe(false);
      }
    });
    expect(comparisons).toBe(5972);
  });

  test.each([
    ["É", "é"], ["ß", "ẞ"], ["Σ", "σ", "ς"], ["K", "k", "K"], ["S", "s", "ſ"],
    ["Θ", "θ", "ϑ", "ϴ"], ["Т", "т", "ᲄ", "ᲅ"], ["𐐀", "𐐨"],
  ])("handles the entire explicit equivalence class %#", (...members) => {
    for (const token of members) for (const value of members) {
      expect(jsMatches(value, token)).toBe(true);
      expect(sqlMatches(value, token)).toBe(true);
    }
  });

  test.each([
    ["İ", "i"], ["İ", "I"], ["ı", "I"], ["ı", "i"], ["ß", "ss"], ["ẞ", "SS"],
    ["é", "e\u0301"], ["É", "e"], ["Ａ", "a"], ["한글", "한글"], ["ﬀ", "ff"],
  ])("does not add Full/Turkic/normalization equivalence %#", (left, right) => {
    expect(sqlMatches(left, right)).toBe(false);
    expect(sqlMatches(right, left)).toBe(false);
    expect(jsMatches(left, right)).toBe(false);
    expect(jsMatches(right, left)).toBe(false);
  });
});

describe("bound literal GLOB syntax, substrings and limits", () => {
  test.each(["[", "]", "*", "?", "[]", "[x]", "[^x]", "[a-z]", "[[]", "[]]", "**??", "%", "_", "\\", "'", '"', "--", ";", "^", "-", "한글", "👤", "\r\n"])("preserves literal token %j through a bound SQLite parameter", (token) => {
    expect(sqlMatches(`before ${token} after`, token)).toBe(true);
    expect(sqlMatches("ordinary unrelated text", token)).toBe(false);
    expect(sqlMatches(`before ${token} after`, token)).toBe(jsMatches(`before ${token} after`, token));
  });

  test("only the two code-owned outer wildcards broaden the search", () => {
    expect(sqliteUnicodeLiteralPattern("[]*?%_'")).toBe("*[[][]][*][?]%_'*");
    expect(sqlMatches("axb", "a?b")).toBe(false);
    expect(sqlMatches("arbitraryb", "a*b")).toBe(false);
    expect(sqlMatches("x", "[x]")).toBe(false);
    expect(sqlMatches("a", "[a-z]")).toBe(false);
    expect(sqlMatches("aXb", "a_b")).toBe(false);
    expect(sqlMatches("ab", "a%b")).toBe(false);
    expect(sqlMatches("anything", "' OR 1=1 --")).toBe(false);
    expect(sqlMatches("' OR 1=1 --", "' OR 1=1 --")).toBe(true);
  });

  test("combines Unicode classes with emoji, CRLF and metacharacters without changing the matched original range", () => {
    const token = "é [σ]*?👤", value = "İ\r\n👤 É [ς]*?👤 next";
    expect(sqlMatches(value, token)).toBe(true);
    const range = firstRecordTextMatch(value, [token]);
    expect(range).toEqual({ start: 6, end: 15 });
    expect(value.slice(range!.start, range!.end)).toBe("É [ς]*?👤");
    expect(sqlMatches(value.replace("*?", "xx"), token)).toBe(false);
  });

  test("handles the maximum input and generated class/UTF-8 bounds without truncation", () => {
    const value = "Т".repeat(300), token = "ᲅ".repeat(300), pattern = sqliteUnicodeLiteralPattern(token);
    expect(pattern.length).toBe(1802);
    expect(Buffer.byteLength(pattern, "utf8")).toBeLessThanOrEqual(4202);
    expect(sqlMatches(value, token)).toBe(true);
    expect(sqlMatches(value.slice(1), token)).toBe(false);
    expect(sqlMatches("👤".repeat(150), "👤".repeat(150))).toBe(true);
    expect(sqlMatches("[".repeat(300), "[".repeat(300))).toBe(true);
  });

  test.each(["", "x".repeat(301), "👤".repeat(151), "\0", "a\0b", "\ud800", "\udc00", "a\ud800b", "a\udc00b"])("rejects out-of-bound or lossy SQLite text input %#", (token) => {
    expect(() => sqliteUnicodeLiteralPattern(token)).toThrow(RangeError);
  });

  test("rejects non-string input without running coercion hooks", () => {
    const hook = vi.fn(() => "a"), candidate = { toString: hook, valueOf: hook };
    for (const value of [null, undefined, 1, ["a"], candidate])
      expect(() => sqliteUnicodeLiteralPattern(value as unknown as string)).toThrow(RangeError);
    expect(hook).not.toHaveBeenCalled();
  });

  test("documents and reproduces why NUL cannot be accepted as literal GLOB input", () => {
    expect(statement.get("a\0b", "*b*")!.matched).toBe(0);
    expect(jsMatches("a\0b", "b")).toBe(true);
  });
});
