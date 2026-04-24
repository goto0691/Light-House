"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ContextRail } from "@/components/shared/context/context-rail";
import { ContextTimeline } from "@/components/shared/context/context-timeline";
import { SourceTracePanel } from "@/components/shared/context/source-trace-panel";
import type { ContextBundle, ContextEdge, ContextLensKey, ContextNode } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";

export function EntityContextShell({
  bundle,
  density = "page",
  mainSlot,
  actionsSlot,
  railDefaultLens = "overview",
  onOpenNode,
  onDetachEdge,
  onBundleUpdate,
  className,
}: {
  bundle: ContextBundle;
  density?: "drawer" | "page" | "compact";
  mainSlot: ReactNode;
  actionsSlot?: ReactNode;
  railDefaultLens?: ContextLensKey;
  onOpenNode?: (node: ContextNode) => void;
  onDetachEdge?: (edge: ContextEdge) => void;
  onBundleUpdate?: (bundle: ContextBundle) => void;
  className?: string;
}) {
  const isDrawer = density === "drawer";
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <section className={cn("grid gap-4", density === "page" && "xl:grid-cols-[minmax(0,1fr)_360px]", className)}>
      <div className="min-w-0 space-y-4">
        <header className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-primary">{bundle.focus.type}</p>
              <h2 className="mt-2 truncate font-display text-2xl text-foreground">{bundle.focus.title}</h2>
              {bundle.focus.subtitle ? <p className="mt-1 text-sm text-muted-foreground">{bundle.focus.subtitle}</p> : null}
            </div>
            {actionsSlot}
          </div>
          {bundle.focus.preview ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{bundle.focus.preview}</p> : null}
        </header>

        {mainSlot}
        {!isDrawer ? <ContextTimeline bundle={bundle} onOpenNode={onOpenNode} /> : null}
        {!isDrawer ? <SourceTracePanel bundle={bundle} onResolved={onBundleUpdate} /> : null}
      </div>

      <ContextRail
        bundle={bundle}
        className={cn(isNarrow && "order-last")}
        defaultLens={railDefaultLens}
        density={isNarrow || isDrawer ? "accordion" : "rail"}
        onDetachEdge={onDetachEdge}
        onOpenNode={onOpenNode}
      />
    </section>
  );
}
