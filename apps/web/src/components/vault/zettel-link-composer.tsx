"use client";

import { Link2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { GlassCard } from "@/components/shared/glass-card";
import { getZettelOptionLabel, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import type { SearchItem } from "@/lib/mock/search";
import type { ZettelMock } from "@/lib/mock/vault";
import { getZettelSearchText } from "@/lib/vault/zettel-properties";

type ZettelLinkComposerProps = {
  currentZettelId?: string;
  candidates: ZettelMock[];
  semanticResults?: SearchItem[];
  disabled?: boolean;
  onAddLink: (targetId: string) => void;
};

export function ZettelLinkComposer({ currentZettelId, candidates, semanticResults = [], disabled, onAddLink }: ZettelLinkComposerProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filteredCandidates = useMemo(
    () =>
      candidates
        .filter((zettel) => zettel.id !== currentZettelId)
        .filter((zettel) => {
          if (!normalized) return true;
          return getZettelSearchText(zettel).includes(normalized);
        })
        .slice(0, 8),
    [candidates, currentZettelId, normalized],
  );
  const suggested = semanticResults.filter((item) => item.id !== currentZettelId).slice(0, 5);

  return (
    <GlassCard priority="secondary">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <p className="text-xs uppercase tracking-[0.14em] text-primary">연결 작성</p>
      </div>
      <div className="mt-4 flex min-h-11 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="연결할 지식 검색"
          value={query}
        />
      </div>

      <div className="mt-4 space-y-2">
        {filteredCandidates.length ? (
          filteredCandidates.map((zettel) => {
            const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, zettel.type, zettel.type);
            return (
              <button
                className="focus-ring flex w-full items-start justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                key={zettel.id}
                onClick={() => onAddLink(zettel.id)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{zettel.title}</span>
                  <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">{zettel.category} · {typeLabel}</span>
                </span>
                <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] tracking-[0.08em] text-primary">연결</span>
              </button>
            );
          })
        ) : (
          <p className="rounded-md border border-dashed border-white/15 bg-white/5 p-3 text-sm text-muted-foreground">검색 조건에 맞는 지식이 없습니다.</p>
        )}
      </div>

      {suggested.length ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">의미 기반 추천</p>
          <div className="mt-3 space-y-2">
            {suggested.map((item) => (
              <button
                className="focus-ring block w-full rounded-md border border-white/10 bg-black/10 px-3 py-3 text-left hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                key={item.id}
                onClick={() => onAddLink(item.id)}
                type="button"
              >
                <span className="block text-sm text-foreground">{item.title}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.snippet}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}
