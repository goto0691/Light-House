"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import type { ContextBundle, ContextSearchResult, EntityType, RelationKind } from "@/lib/context/types";

const DEFAULT_TYPES: EntityType[] = ["person", "zettel", "media", "place", "task", "daily_log"];
const RELATION_OPTIONS: Array<{ label: string; value: RelationKind }> = [
  { label: "직접", value: "explicit" },
  { label: "언급", value: "mention" },
  { label: "원천", value: "source" },
  { label: "의미", value: "semantic" },
];

type SmartAttachPanelProps = {
  focusId: string;
  focusType: EntityType;
  onAttached?: (bundle: ContextBundle) => void;
  targetTypes?: EntityType[];
};

export function SmartAttachPanel({ focusId, focusType, onAttached, targetTypes = DEFAULT_TYPES }: SmartAttachPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContextSearchResult[]>([]);
  const [relationKind, setRelationKind] = useState<RelationKind>("explicit");
  const [isPending, startTransition] = useTransition();

  const filteredTypes = useMemo(() => targetTypes.filter((type) => type !== focusType), [focusType, targetTypes]);
  const titleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of results) {
      counts.set(`${result.type}:${result.title}`, (counts.get(`${result.type}:${result.title}`) ?? 0) + 1);
    }
    return counts;
  }, [results]);

  useEffect(() => {
    const controller = new AbortController();
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      setResults([]);
      return () => controller.abort();
    }

    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmedQuery, types: filteredTypes.join(",") });
        const response = await fetch(`/api/context/search?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search failed");
        const payload = (await response.json()) as { results: ContextSearchResult[] };
        setResults(payload.results.filter((item) => !(item.type === focusType && item.id === focusId)).slice(0, 8));
      } catch (error) {
        if (!controller.signal.aborted) setResults([]);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [filteredTypes, focusId, focusType, query]);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Smart Attach</p>
          <p className="mt-1 text-xs text-muted-foreground">현재 항목에 연결할 데이터를 검색합니다.</p>
        </div>
        <select
          className="rounded-xl border border-white/10 bg-black/20 px-2 py-2 text-xs text-foreground outline-none"
          onChange={(event) => setRelationKind(event.target.value as RelationKind)}
          value={relationKind}
        >
          {RELATION_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <input
        className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="인물, 메모, 장소, 미디어 검색"
        value={query}
      />
      <div className="mt-3 space-y-2">
        {results.map((result) => (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/10 px-3 py-3" key={`${result.type}:${result.id}`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{result.title}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{resultLabel(result, titleCounts)}</p>
            </div>
            <button
              className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    const response = await fetch("/api/context/edges", {
                      body: JSON.stringify({
                        focusId,
                        focusType,
                        relationKind,
                        targetId: result.id,
                        targetType: result.type,
                      }),
                      headers: { "Content-Type": "application/json" },
                      method: "POST",
                    });
                    if (!response.ok) throw new Error("Attach failed");
                    const payload = (await response.json()) as { bundle: ContextBundle };
                    toast.success("맥락 연결을 추가했습니다.");
                    setQuery("");
                    setResults([]);
                    onAttached?.(payload.bundle);
                  } catch (error) {
                    toast.error("맥락 연결에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
              type="button"
            >
              연결
            </button>
          </div>
        ))}
        {query.trim().length >= 2 && !results.length ? <p className="text-xs text-muted-foreground">검색 결과가 없습니다.</p> : null}
      </div>
    </section>
  );
}

function resultLabel(result: ContextSearchResult, titleCounts: Map<string, number>) {
  const duplicate = (titleCounts.get(`${result.type}:${result.title}`) ?? 0) > 1;
  const base = result.disambiguationLabel ?? result.subtitle ?? result.type;
  if (result.type === "person" || duplicate) {
    return `${base} · ID ${result.id}`;
  }
  return base;
}
