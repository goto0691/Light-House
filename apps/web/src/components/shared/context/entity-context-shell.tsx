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
  const [currentBundle, setCurrentBundle] = useState(bundle);

  useEffect(() => {
    setCurrentBundle(bundle);
  }, [bundle]);

  function updateBundle(nextBundle: ContextBundle) {
    setCurrentBundle(nextBundle);
    onBundleUpdate?.(nextBundle);
  }

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
              <p className="text-xs tracking-[0.08em] text-primary">{formatEntityType(currentBundle.focus.type)}</p>
              <h2 className="mt-2 truncate font-display text-2xl text-foreground">{currentBundle.focus.title}</h2>
              {currentBundle.focus.subtitle ? <p className="mt-1 text-sm text-muted-foreground">{currentBundle.focus.subtitle}</p> : null}
            </div>
            {actionsSlot}
          </div>
          {currentBundle.focus.preview ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{currentBundle.focus.preview}</p> : null}
        </header>

        {mainSlot}
        {!isDrawer ? <ContextTimeline bundle={currentBundle} onOpenNode={onOpenNode} /> : null}
        {!isDrawer ? <SourceTracePanel bundle={currentBundle} onResolved={updateBundle} /> : null}
      </div>

      <ContextRail
        bundle={currentBundle}
        className={cn(isNarrow && "order-last")}
        defaultLens={railDefaultLens}
        density={isNarrow || isDrawer ? "accordion" : "rail"}
        onDetachEdge={onDetachEdge}
        onOpenNode={onOpenNode}
      />
    </section>
  );
}

function formatEntityType(type: string) {
  const labels: Record<string, string> = {
    asset: "자산",
    career: "커리어",
    daily_entry: "일일 기록",
    daily_log: "일일 로그",
    gift: "선물",
    interaction: "상호작용",
    media: "미디어",
    person: "사람",
    place: "장소",
    project: "프로젝트",
    source_document: "원본 문서",
    tag: "태그",
    task: "작업",
    workout: "운동",
    zettel: "지식",
  };
  return labels[type] ?? type;
}
