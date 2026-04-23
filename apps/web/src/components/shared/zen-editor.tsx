"use client";

import { useMemo, useState } from "react";

const PEOPLE = ["재민", "민서", "은지"];
const ENTITIES = ["존재의 불안", "듄: 파트 2", "호떡집 본점"];
const TAGS = ["심리학", "실존주의", "비즈니스"];

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
  const currentValue = value ?? internalValue;

  const suggestions = useMemo(() => {
    if (currentValue.endsWith("@")) return PEOPLE.map((item) => `@${item}`);
    if (currentValue.endsWith("[[")) return ENTITIES.map((item) => `[[${item}]]`);
    if (currentValue.endsWith("#")) return TAGS.map((item) => `#${item}`);
    return [];
  }, [currentValue]);

  const setValue = (next: string) => {
    if (value === undefined) {
      setInternalValue(next);
    }
    onChange?.(next);
  };

  return (
    <div className="glass rounded-[24px] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Zen Editor Stub</p>
        <p className="text-xs text-muted-foreground">{currentValue.length} chars</p>
      </div>
      <textarea
        className={cnEditor(serif)}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        value={currentValue}
      />
      {suggestions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs text-primary"
              key={suggestion}
              onClick={() => setValue(`${currentValue}${suggestion} `)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function cnEditor(serif: boolean) {
  return [
    "min-h-[220px] w-full resize-none border-0 bg-transparent text-sm text-foreground outline-none",
    serif ? "font-serif leading-8" : "font-sans leading-7",
  ].join(" ");
}
