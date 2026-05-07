"use client";

import Link from "next/link";

import type { SavedView } from "@/lib/server/ui-state";
import { cn } from "@/lib/utils/cn";

type SavedViewTabsProps = {
  activeViewKey: string;
  basePath: string;
  onSelect?: (viewKey: string, view: SavedView) => void;
  views: SavedView[];
};

export function SavedViewTabs({ activeViewKey, basePath, onSelect, views }: SavedViewTabsProps) {
  return (
    <nav aria-label="저장된 뷰" className="flex max-w-full min-w-0 gap-2 overflow-x-auto rounded-lg border border-white/10 bg-white/5 p-1">
      {views.map((view) => {
        const viewKey = view.viewKey ?? view.id;
        const active = activeViewKey === viewKey;
        const params = new URLSearchParams({ view: viewKey });
        const className = cn(
          "focus-ring shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition",
          active ? "bg-primary/14 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-muted-foreground hover:bg-white/6 hover:text-foreground",
        );

        if (onSelect) {
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={className}
              key={view.id}
              onClick={() => onSelect(viewKey, view)}
              type="button"
            >
              {view.name}
            </button>
          );
        }

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={className}
            href={`${basePath}?${params.toString()}`}
            key={view.id}
            scroll={false}
          >
            {view.name}
          </Link>
        );
      })}
    </nav>
  );
}
