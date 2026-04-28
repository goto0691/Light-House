"use client";

import Link from "next/link";

import type { SavedView } from "@/lib/server/ui-state";
import { cn } from "@/lib/utils/cn";

type SavedViewTabsProps = {
  activeViewKey: string;
  basePath: string;
  views: SavedView[];
};

export function SavedViewTabs({ activeViewKey, basePath, views }: SavedViewTabsProps) {
  return (
    <nav aria-label="Saved views" className="flex gap-2 overflow-x-auto rounded-lg border border-white/10 bg-white/5 p-1">
      {views.map((view) => {
        const viewKey = view.viewKey ?? view.id;
        const active = activeViewKey === viewKey;
        const params = new URLSearchParams({ view: viewKey });

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] transition",
              active ? "bg-primary/14 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-muted-foreground hover:bg-white/6 hover:text-foreground",
            )}
            href={`${basePath}?${params.toString()}`}
            key={view.id}
          >
            {view.name}
          </Link>
        );
      })}
    </nav>
  );
}
