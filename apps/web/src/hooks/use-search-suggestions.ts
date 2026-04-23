"use client";

import { useEffect, useState } from "react";

import type { SearchItem } from "@/lib/mock/search";

export function useSearchSuggestions(input: {
  query: string;
  types?: string[];
  enabled?: boolean;
  limit?: number;
}) {
  const { query, types, enabled = true, limit = 8 } = input;
  const [results, setResults] = useState<SearchItem[]>([]);

  useEffect(() => {
    if (!enabled || !query.trim()) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set("q", query.trim());
        if (types?.length) {
          params.set("types", types.join(","));
        }
        const response = await fetch(`/api/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search fetch failed");
        const payload = (await response.json()) as { results?: SearchItem[] };
        setResults(payload.results?.slice(0, limit) ?? []);
      } catch {
        setResults([]);
      }
    }, 140);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [enabled, limit, query, types]);

  return results;
}
