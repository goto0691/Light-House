"use client";

import { Tag } from "@/components/shared/tag";
import { cn } from "@/lib/utils/cn";

export type PersonFilterKey = "all" | "needs-contact" | "favorites" | "5" | "15" | "50" | "150";

type PersonFilterTabsProps = {
  value: PersonFilterKey;
  onChange: (value: PersonFilterKey) => void;
};

const FILTERS: Array<{ key: PersonFilterKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "needs-contact", label: "연락 필요" },
  { key: "favorites", label: "즐겨찾기" },
  { key: "5", label: "핵심 5" },
  { key: "15", label: "친밀 15" },
  { key: "50", label: "친구 50" },
  { key: "150", label: "느슨한 150" },
];

export function PersonFilterTabs({ value, onChange }: PersonFilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((filter) => (
        <button
          className={cn(
            "rounded-md border px-3 py-2 text-xs font-medium",
            value === filter.key ? "border-primary/20 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground",
          )}
          aria-pressed={value === filter.key}
          key={filter.key}
          onClick={() => onChange(filter.key)}
          type="button"
        >
          {filter.key === "5" || filter.key === "15" || filter.key === "50" || filter.key === "150" ? (
            <span className="inline-flex items-center gap-2">
              <span>{filter.label}</span>
              <Tag size="sm" value={filter.key} variant="dunbar" />
            </span>
          ) : (
            filter.label
          )}
        </button>
      ))}
    </div>
  );
}
