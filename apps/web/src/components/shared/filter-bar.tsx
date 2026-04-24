"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { KeyHint } from "@/components/shared/key-hint";
import type { SavedView } from "@/lib/server/ui-state";
import { cn } from "@/lib/utils/cn";

export type FilterState = Record<string, string | string[] | null>;
export type SortOption = { value: string; label: string };
export type FilterConfig =
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "multi"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "date-range"; key: string; label: string }
  | { kind: "tag"; key: string; label: string };

type FilterBarProps = {
  searchPlaceholder?: string;
  filters: FilterConfig[];
  sortOptions?: SortOption[];
  savedViews?: SavedView[];
  onChange: (state: { q: string; filters: FilterState; sort?: string; view?: string }) => void;
  rightSlot?: React.ReactNode;
  className?: string;
};

export function FilterBar({
  searchPlaceholder = "Search",
  filters,
  sortOptions,
  savedViews,
  onChange,
  rightSlot,
  className,
}: FilterBarProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(sortOptions?.[0]?.value ?? "");
  const [selectedView, setSelectedView] = useState(savedViews?.find((view) => view.isDefault)?.id ?? "");
  const [filterState, setFilterState] = useState<FilterState>(
    filters.reduce<FilterState>((accumulator, filter) => {
      accumulator[filter.key] = filter.kind === "multi" ? [] : null;
      return accumulator;
    }, {}),
  );

  function emit(next: { q?: string; filters?: FilterState; sort?: string; view?: string }) {
    onChange({
      q: next.q ?? query,
      filters: next.filters ?? filterState,
      sort: next.sort ?? sort,
      view: next.view ?? selectedView,
    });
  }

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 md:flex-row md:items-center", className)}>
      <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            emit({ q: next });
          }}
          placeholder={searchPlaceholder}
          value={query}
        />
        <KeyHint keys="Cmd+K" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters
          .filter((filter) => filter.kind === "select")
          .map((filter) => (
            <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground" key={filter.key}>
              <span>{filter.label}</span>
              <select
                className="bg-transparent text-[11px] text-foreground outline-none"
                onChange={(event) => {
                  const next = { ...filterState, [filter.key]: event.target.value || null };
                  setFilterState(next);
                  emit({ filters: next });
                }}
                value={(filterState[filter.key] as string | null) ?? ""}
              >
                <option value="">All</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}

        {sortOptions?.length ? (
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <span>Sort</span>
            <select
              className="bg-transparent text-[11px] text-foreground outline-none"
              onChange={(event) => {
                setSort(event.target.value);
                emit({ sort: event.target.value });
              }}
              value={sort}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {savedViews?.length ? (
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <span>View</span>
            <select
              className="bg-transparent text-[11px] text-foreground outline-none"
              onChange={(event) => {
                setSelectedView(event.target.value);
                emit({ view: event.target.value });
              }}
              value={selectedView}
            >
              <option value="">Default</option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {rightSlot}
      </div>
    </div>
  );
}
