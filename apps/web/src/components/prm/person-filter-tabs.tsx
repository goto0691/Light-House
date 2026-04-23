"use client";

import { Tag } from "@/components/shared/tag";
import { cn } from "@/lib/utils/cn";

export type PersonFilterKey = "all" | "needs-contact" | "favorites" | "5" | "15" | "50" | "150";

type PersonFilterTabsProps = {
  value: PersonFilterKey;
  onChange: (value: PersonFilterKey) => void;
};

const FILTERS: Array<{ key: PersonFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs-contact", label: "Hit Them Up" },
  { key: "favorites", label: "Favorites" },
  { key: "5", label: "Layer 5" },
  { key: "15", label: "Layer 15" },
  { key: "50", label: "Layer 50" },
  { key: "150", label: "Layer 150" },
];

export function PersonFilterTabs({ value, onChange }: PersonFilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((filter) => (
        <button
          className={cn(
            "rounded-full border px-3 py-2 text-xs uppercase tracking-[0.16em] transition",
            value === filter.key ? "border-primary/20 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground",
          )}
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
