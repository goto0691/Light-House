"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { KeyHint } from "@/components/shared/key-hint";
import type { SavedView } from "@/lib/server/ui-state";
import { cn } from "@/lib/utils/cn";

export type FilterState = Record<string, string | string[] | null>;
export type SortOption = { value: string; label: string };
export type FilterConfig =
  | { kind: "select"; key: string; label: string; options: { value: string; label: string; icon?: string }[] }
  | { kind: "multi"; key: string; label: string; options: { value: string; label: string; icon?: string }[] }
  | { kind: "date-range"; key: string; label: string }
  | { kind: "tag"; key: string; label: string; suggestions?: string[] };

type FilterBarProps = {
  searchPlaceholder?: string;
  filters: FilterConfig[];
  sortOptions?: SortOption[];
  savedViews?: SavedView[];
  onChange: (state: { q: string; filters: FilterState; sort?: string; view?: string }) => void;
  rightSlot?: React.ReactNode;
  className?: string;
  initialFilters?: FilterState;
  initialQuery?: string;
  initialSort?: string;
  syncUrl?: boolean;
};

export function FilterBar({
  searchPlaceholder = "검색",
  filters,
  sortOptions,
  savedViews,
  onChange,
  rightSlot,
  className,
  initialFilters,
  initialQuery,
  initialSort,
  syncUrl = true,
}: FilterBarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState(() => searchParams.get("q") ?? initialQuery ?? "");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? initialSort ?? sortOptions?.[0]?.value ?? "");
  const [selectedView, setSelectedView] = useState(() => searchParams.get("view") ?? savedViews?.find((view) => view.isDefault)?.id ?? "");
  const [filterState, setFilterState] = useState<FilterState>(() => buildInitialFilters(filters, searchParams, initialFilters));

  function emit(next: { q?: string; filters?: FilterState; sort?: string; view?: string }) {
    const payload = {
      q: next.q ?? query,
      filters: next.filters ?? filterState,
      sort: next.sort ?? sort,
      view: next.view ?? selectedView,
    };
    onChange(payload);
    if (syncUrl) {
      syncUrlState({ currentParams: searchParams, filters, pathname, state: payload });
    }
  }

  useEffect(() => {
    onChange({ q: query, filters: filterState, sort, view: selectedView });
    // Run once so pages hydrate from URL-backed filters without waiting for input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3", className)}>
      <div className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          inputMode="search"
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

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {filters
          .filter((filter) => filter.kind === "select")
          .map((filter) => (
            <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground" key={filter.key}>
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
                <option value="">전체</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}

        {filters
          .filter((filter) => filter.kind === "multi")
          .map((filter) => {
            const values = Array.isArray(filterState[filter.key]) ? (filterState[filter.key] as string[]) : [];
            return (
              <details className="group relative" key={filter.key}>
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/6 hover:text-foreground">
                  <span>{filter.label}</span>
                  {values.length ? <span className="text-primary">{values.length}</span> : null}
                  <ChevronDown className="h-3.5 w-3.5 group-open:rotate-180" />
                </summary>
                <div className="glass-elevated absolute right-0 z-20 mt-2 grid min-w-52 gap-1 p-2">
                  {filter.options.map((option) => {
                    const checked = values.includes(option.value);
                    return (
                      <button
                        className={cn(
                          "focus-ring flex min-h-10 items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-white/6",
                          checked ? "text-primary" : "text-muted-foreground",
                        )}
                        key={option.value}
                        onClick={() => {
                          const nextValues = checked ? values.filter((value) => value !== option.value) : [...values, option.value];
                          const next = { ...filterState, [filter.key]: nextValues };
                          setFilterState(next);
                          emit({ filters: next });
                        }}
                        type="button"
                      >
                        <span>{option.icon ? `${option.icon} ` : ""}{option.label}</span>
                        {checked ? <Check className="h-4 w-4" /> : null}
                      </button>
                    );
                  })}
                </div>
              </details>
            );
          })}

        {filters
          .filter((filter) => filter.kind === "tag")
          .map((filter) => {
            const values = Array.isArray(filterState[filter.key]) ? (filterState[filter.key] as string[]) : [];
            return (
              <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-black/10 px-2 py-1.5 sm:w-auto sm:min-w-72" key={filter.key}>
                <span className="px-1 text-[11px] text-muted-foreground">{filter.label}</span>
                {values.map((value) => (
                  <button
                    aria-label={`${value} 제거`}
                    className="focus-ring inline-flex min-h-7 items-center gap-1 rounded-md bg-primary/10 px-2 text-[11px] font-medium text-primary"
                    key={value}
                    onClick={() => {
                      const next = { ...filterState, [filter.key]: values.filter((item) => item !== value) };
                      setFilterState(next);
                      emit({ filters: next });
                    }}
                    type="button"
                  >
                    #{value}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <input
                  className="min-h-7 min-w-32 flex-1 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  list={filter.suggestions?.length ? `filter-${filter.key}-suggestions` : undefined}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== ",") return;
                    event.preventDefault();
                    const value = (tagDrafts[filter.key] ?? "").trim().replace(/^#/, "");
                    if (!value || values.includes(value)) return;
                    const next = { ...filterState, [filter.key]: [...values, value] };
                    setFilterState(next);
                    setTagDrafts((drafts) => ({ ...drafts, [filter.key]: "" }));
                    emit({ filters: next });
                  }}
                  onChange={(event) => setTagDrafts((drafts) => ({ ...drafts, [filter.key]: event.target.value }))}
                  placeholder={filter.label}
                  value={tagDrafts[filter.key] ?? ""}
                />
                {filter.suggestions?.length ? (
                  <datalist id={`filter-${filter.key}-suggestions`}>
                    {filter.suggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                ) : null}
              </div>
            );
          })}

        {sortOptions?.length ? (
          <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
            <span>정렬</span>
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
          <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
            <span>뷰</span>
            <select
              className="bg-transparent text-[11px] text-foreground outline-none"
              onChange={(event) => {
                setSelectedView(event.target.value);
                emit({ view: event.target.value });
              }}
              value={selectedView}
            >
              <option value="">기본</option>
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

function buildInitialFilters(filters: FilterConfig[], searchParams: URLSearchParams, initialFilters?: FilterState): FilterState {
  const encodedFilter = searchParams.get("filter");
  const parsed = encodedFilter ? parseFilterParam(encodedFilter) : {};

  return filters.reduce<FilterState>((accumulator, filter) => {
    const urlValue = searchParams.get(filter.key) ?? parsed[filter.key] ?? initialFilters?.[filter.key];
    if (filter.kind === "multi" || filter.kind === "tag") {
      accumulator[filter.key] = Array.isArray(urlValue) ? urlValue : typeof urlValue === "string" && urlValue ? urlValue.split(",").filter(Boolean) : [];
    } else {
      accumulator[filter.key] = typeof urlValue === "string" && urlValue ? urlValue : null;
    }
    return accumulator;
  }, {});
}

function parseFilterParam(value: string): Record<string, string | string[]> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string | string[]] => typeof entry[1] === "string" || Array.isArray(entry[1])),
    );
  } catch {
    return {};
  }
}

function syncUrlState({
  pathname,
  currentParams,
  filters,
  state,
}: {
  pathname: string;
  currentParams: URLSearchParams;
  filters: FilterConfig[];
  state: { q: string; filters: FilterState; sort?: string; view?: string };
}) {
  const params = new URLSearchParams(currentParams.toString());
  params.delete("q");
  params.delete("sort");
  params.delete("view");
  params.delete("filter");
  filters.forEach((filter) => params.delete(filter.key));

  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.sort) params.set("sort", state.sort);
  if (state.view) params.set("view", state.view);

  const activeFilters = Object.fromEntries(
    Object.entries(state.filters).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value))),
  );
  if (Object.keys(activeFilters).length) {
    params.set("filter", JSON.stringify(activeFilters));
  }

  const query = params.toString();
  window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
}
