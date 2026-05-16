"use client";

import { useEffect, useMemo, useState } from "react";

import { KeyHint } from "@/components/shared/key-hint";
import { useSearchSuggestions } from "@/hooks/use-search-suggestions";
import type { SearchItem } from "@/lib/mock/search";
import { resolveEditorPrefix } from "@/lib/utils/search-prefix";

function formatSuggestion(item: SearchItem, mode: Exclude<SuggestionMode, null>) {
  if (mode === "person") return `@${item.title}`;
  if (mode === "zettel") return `[[${item.title}]]`;
  return `#${item.title}`;
}

type SuggestionMode = "person" | "zettel" | "tag" | null;

function getFallbackSuggestions(query: string, mode: Exclude<SuggestionMode, null>) {
  const source =
    mode === "person"
      ? ["재민", "민서", "은지"]
      : mode === "zettel"
        ? ["존재의 불안", "듄: 파트 2", "호떡집 본점"]
        : ["심리학", "실존주의", "비즈니스"];
  return source
    .filter((item) => item.includes(query))
    .map((item) => (mode === "person" ? `@${item}` : mode === "zettel" ? `[[${item}]]` : `#${item}`));
}

export function ZenEditor({
  placeholder = "생각을 적어 보세요. @사람, [[지식]], #태그 스텁이 열립니다.",
  serif = false,
  value,
  onChange,
}: {
  placeholder?: string;
  serif?: boolean;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = useState("");
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const currentValue = value ?? internalValue;
  const autoSaveKey = `zen-editor:${placeholder}`;
  const suggestionContext = useMemo(() => resolveEditorPrefix(currentValue), [currentValue]);
  const remoteResults = useSearchSuggestions({
    query: suggestionContext.query,
    types:
      suggestionContext.mode === "person"
        ? ["person"]
        : suggestionContext.mode === "zettel"
          ? ["zettel", "media", "place"]
          : suggestionContext.mode === "tag"
            ? ["tag"]
            : undefined,
    enabled: Boolean(suggestionContext.mode),
  });

  const suggestions = useMemo(() => {
    if (!suggestionContext.mode) return [];
    if (remoteResults.length) return remoteResults.map((item) => formatSuggestion(item, suggestionContext.mode));
    return getFallbackSuggestions(suggestionContext.query, suggestionContext.mode);
  }, [remoteResults, suggestionContext]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [suggestions.length, currentValue]);

  useEffect(() => {
    if (value !== undefined) return;
    const restored = window.localStorage.getItem(autoSaveKey);
    if (restored) {
      setInternalValue(restored);
    }
  }, [autoSaveKey, value]);

  const setValue = (next: string) => {
    if (value === undefined) {
      setInternalValue(next);
      window.localStorage.setItem(autoSaveKey, next);
    }
    onChange?.(next);
  };

  const replaceTrailingToken = (suggestion: string) => {
    const next = currentValue.replace(/(?:\[\[[^\s\]]*|[@#][^\s]*)$/, `${suggestion} `);
    setValue(next);
  };

  return (
    <div className="glass rounded-lg p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">마크다운 편집기</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{currentValue.length}자</span>
          {suggestionContext.mode ? <span>연결 검색</span> : null}
          <KeyHint keys="Cmd+/" />
        </div>
      </div>
      <textarea
        className={cnEditor(serif)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (!suggestions.length) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedSuggestionIndex((current) => (current + 1) % suggestions.length);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
          }

          if (event.key === "Tab" || event.key === "Enter") {
            event.preventDefault();
            replaceTrailingToken(suggestions[selectedSuggestionIndex] ?? suggestions[0]);
          }
        }}
        placeholder={placeholder}
        style={{ minHeight: "32.5rem" }}
        value={currentValue}
      />
      {suggestions.length ? (
        <div className="mt-3 rounded-md border border-white/10 bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">추천 연결</p>
          <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              className={`focus-ring rounded-md border px-3 py-1 text-xs ${
                suggestions[selectedSuggestionIndex] === suggestion
                  ? "border-primary/30 bg-primary/12 text-primary"
                  : "border-white/10 bg-white/8 text-primary [@media(hover:hover)]:hover:bg-primary/12"
              }`}
              key={suggestion}
              onClick={() => replaceTrailingToken(suggestion)}
              onMouseEnter={() => setSelectedSuggestionIndex(suggestions.indexOf(suggestion))}
              type="button"
            >
              {suggestion}
            </button>
          ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function cnEditor(serif: boolean) {
  return [
    "min-h-[520px] w-full resize-y border-0 bg-transparent text-base text-foreground outline-none md:text-[17px]",
    serif ? "font-serif leading-9" : "font-sans leading-8",
  ].join(" ");
}
