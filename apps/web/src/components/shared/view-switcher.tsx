"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type ViewSwitcherProps = {
  views: Array<{ key: string; label: string; icon?: LucideIcon }>;
  current: string;
  onSwitch: (key: string) => void;
  className?: string;
};

export function ViewSwitcher({ views, current, onSwitch, className }: ViewSwitcherProps) {
  return (
    <div className={cn("inline-flex rounded-full border border-white/10 bg-white/5 p-1", className)}>
      {views.map((view) => {
        const Icon = view.icon;
        const active = current === view.key;

        return (
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.18em] transition",
              active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground",
            )}
            key={view.key}
            onClick={() => onSwitch(view.key)}
            type="button"
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            <span>{view.label}</span>
          </button>
        );
      })}
    </div>
  );
}

