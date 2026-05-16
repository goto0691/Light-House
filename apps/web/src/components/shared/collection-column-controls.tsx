"use client";

import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type CollectionColumnDefinition = {
  key: string;
  label: string;
  defaultVisible?: boolean;
};

type CollectionColumnControlsProps = {
  columns: CollectionColumnDefinition[];
  onChange: (visibleKeys: string[]) => void;
  visibleKeys: string[];
  className?: string;
  title?: string;
};

export function CollectionColumnControls({
  className,
  columns,
  onChange,
  title = "표시 속성",
  visibleKeys,
}: CollectionColumnControlsProps) {
  const validKeys = new Set(columns.map((column) => column.key));
  const normalizedVisibleKeys = visibleKeys.filter((key) => validKeys.has(key));
  const orderedColumns = [
    ...normalizedVisibleKeys.map((key) => columns.find((column) => column.key === key)).filter((column): column is CollectionColumnDefinition => Boolean(column)),
    ...columns.filter((column) => !normalizedVisibleKeys.includes(column.key)),
  ];

  function toggleColumn(key: string) {
    if (normalizedVisibleKeys.includes(key)) {
      onChange(normalizedVisibleKeys.filter((item) => item !== key));
      return;
    }
    const insertIndex = columns.findIndex((column) => column.key === key);
    const next = [...normalizedVisibleKeys];
    const nextIndex = next.findIndex((item) => columns.findIndex((column) => column.key === item) > insertIndex);
    if (nextIndex === -1) {
      next.push(key);
    } else {
      next.splice(nextIndex, 0, key);
    }
    onChange(next);
  }

  function moveColumn(key: string, direction: -1 | 1) {
    const index = normalizedVisibleKeys.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= normalizedVisibleKeys.length) return;
    const next = [...normalizedVisibleKeys];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  }

  return (
    <details className={cn("group relative", className)}>
      <summary className="focus-ring inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/8">
        <Settings2 className="h-4 w-4" />
        {title}
        <span className="rounded-md border border-white/10 bg-black/10 px-2 py-0.5 text-[10px] text-muted-foreground">
          {normalizedVisibleKeys.length}
        </span>
      </summary>
      <div className="glass-elevated absolute right-0 z-30 mt-2 w-[min(92vw,360px)] p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <button
            className="focus-ring rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/8 hover:text-foreground"
            onClick={() => onChange(columns.filter((column) => column.defaultVisible).map((column) => column.key))}
            type="button"
          >
            기본값
          </button>
        </div>
        <div className="mt-3 grid gap-1.5">
          {orderedColumns.map((column) => {
            const visible = normalizedVisibleKeys.includes(column.key);
            const visibleIndex = normalizedVisibleKeys.indexOf(column.key);
            return (
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-white/10 bg-black/10 px-2 py-2" key={column.key}>
                <label className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  <input checked={visible} onChange={() => toggleColumn(column.key)} type="checkbox" />
                  <span className="truncate">{column.label}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button
                    aria-label={`${column.label} 위로`}
                    className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-40"
                    disabled={!visible || visibleIndex <= 0}
                    onClick={() => moveColumn(column.key, -1)}
                    type="button"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    aria-label={`${column.label} 아래로`}
                    className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-40"
                    disabled={!visible || visibleIndex < 0 || visibleIndex >= normalizedVisibleKeys.length - 1}
                    onClick={() => moveColumn(column.key, 1)}
                    type="button"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

export function defaultVisibleColumnKeys(columns: CollectionColumnDefinition[]) {
  return columns.filter((column) => column.defaultVisible).map((column) => column.key);
}

export function savedViewColumnKeys(value: unknown, columns: CollectionColumnDefinition[]) {
  if (!Array.isArray(value)) return defaultVisibleColumnKeys(columns);
  const validKeys = new Set(columns.map((column) => column.key));
  const keys = value.filter((item): item is string => typeof item === "string" && validKeys.has(item));
  return keys.length ? keys : defaultVisibleColumnKeys(columns);
}
