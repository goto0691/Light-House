"use client";

import { useEffect, useRef, useState } from "react";

import { ContextNodeCard } from "@/components/shared/context/context-node-card";
import { RelationEvidenceCard } from "@/components/shared/context/relation-evidence-card";
import type { ContextBundle, ContextEdge, ContextLensKey, ContextNode } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";

const LENSES: Array<{ key: ContextLensKey; label: string }> = [
  { key: "overview", label: "개요" },
  { key: "people", label: "사람" },
  { key: "projects", label: "작업" },
  { key: "zettels", label: "문서" },
  { key: "media", label: "미디어" },
  { key: "dates", label: "기록" },
  { key: "places", label: "장소" },
  { key: "source", label: "속성" },
  { key: "unresolved", label: "검토" },
];

function nodesForLens(bundle: ContextBundle, lens: ContextLensKey) {
  if (bundle.pages?.[lens]) return bundle.pages[lens] ?? [];
  if (lens === "overview") {
    return [...bundle.grouped.people, ...bundle.grouped.zettels, ...bundle.grouped.media, ...bundle.grouped.projects, ...bundle.grouped.dates].slice(0, 8);
  }
  return bundle.grouped[lens] ?? [];
}

function touchingEdges(bundle: ContextBundle, node: ContextNode) {
  return bundle.edges.filter((edge) => (edge.from.type === node.type && edge.from.id === node.id) || (edge.to.type === node.type && edge.to.id === node.id));
}

export function ContextRail({
  bundle,
  defaultLens = "overview",
  density = "rail",
  onOpenNode,
  onDetachEdge,
  className,
}: {
  bundle: ContextBundle;
  defaultLens?: ContextLensKey;
  density?: "rail" | "accordion";
  onOpenNode?: (node: ContextNode) => void;
  onDetachEdge?: (edge: ContextEdge) => void;
  className?: string;
}) {
  const [lens, setLens] = useState<ContextLensKey>(defaultLens);
  const [isOpen, setIsOpen] = useState(density === "rail");
  const [selectedEdge, setSelectedEdge] = useState<ContextEdge | null>(null);
  const [pagedNodes, setPagedNodes] = useState<Partial<Record<ContextLensKey, ContextNode[]>>>({});
  const [pagination, setPagination] = useState(bundle.pagination ?? {});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nodes = pagedNodes[lens] ?? nodesForLens(bundle, lens);
  const currentPage = pagination[lens];
  const isAccordion = density === "accordion";

  useEffect(() => {
    setIsOpen(density === "rail");
  }, [density]);

  useEffect(() => {
    setPagedNodes({});
    setPagination(bundle.pagination ?? {});
  }, [bundle]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !currentPage?.hasMore || isLoadingMore || (isAccordion && !isOpen)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [currentPage?.hasMore, currentPage?.nextCursor, isAccordion, isLoadingMore, isOpen, lens]);

  async function loadMore() {
    const page = pagination[lens];
    if (!page?.hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({
        cursor: page.nextCursor ?? "0",
        lens,
        limit: String(page.limit),
      });
      const response = await fetch(`/api/context/${bundle.focus.type}/${encodeURIComponent(bundle.focus.id)}?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("context pagination failed");
      const payload = (await response.json()) as { bundle: ContextBundle };
      const nextNodes = nodesForLens(payload.bundle, lens);
      setPagedNodes((current) => ({
        ...current,
        [lens]: mergeNodes(current[lens] ?? nodesForLens(bundle, lens), nextNodes),
      }));
      setPagination((current) => ({ ...current, ...(payload.bundle.pagination ?? {}) }));
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <aside className={cn("grid gap-3", className)}>
      <section className="rounded-lg border border-white/10 bg-white/5 p-3">
        <button
          aria-expanded={!isAccordion || isOpen}
          className={cn("flex w-full items-start justify-between gap-3 text-left", isAccordion && "focus-ring min-h-11 rounded-md")}
          onClick={() => {
            if (isAccordion) setIsOpen((value) => !value);
          }}
          type="button"
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-primary">Context</p>
            <h3 className="mt-1 truncate text-base font-semibold text-foreground">{bundle.focus.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {bundle.edges.length} edges · {bundle.quality.unresolvedCount} review
            </p>
          </div>
          {bundle.quality.lowConfidenceCount ? (
            <span className="rounded-full border border-[hsl(var(--color-feedback-warning)/0.24)] bg-[hsl(var(--color-feedback-warning)/0.1)] px-2 py-1 text-[10px] text-[hsl(var(--color-feedback-warning))]">
              {bundle.quality.lowConfidenceCount}
            </span>
          ) : null}
        </button>
        <div className={cn("mt-3 flex flex-wrap gap-1.5", isAccordion && !isOpen && "hidden")}>
          {LENSES.map((item) => (
            <button
              className={cn(
                "focus-ring min-h-11 rounded-full border px-3 text-[11px] transition",
                lens === item.key ? "border-primary/30 bg-primary/12 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/6 hover:text-foreground",
              )}
              key={item.key}
              onClick={() => setLens(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className={cn("grid gap-2", isAccordion && !isOpen && "hidden")}>
        {nodes.length ? (
          nodes.map((item) => (
            <ContextNodeCard
              edges={touchingEdges(bundle, item)}
              key={`${item.type}:${item.id}`}
              node={item}
              onOpen={onOpenNode}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">이 lens에는 아직 연결된 항목이 없습니다.</div>
        )}
        {currentPage?.hasMore ? (
          <div ref={sentinelRef} className="pt-1">
            <button
              className="focus-ring min-h-11 w-full rounded-md border border-white/10 bg-black/10 px-3 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:opacity-50"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {isLoadingMore ? "불러오는 중" : `더보기 (${nodes.length}/${currentPage.total})`}
            </button>
          </div>
        ) : null}
      </section>

      {bundle.edges.length ? (
        <section className={cn("rounded-lg border border-white/10 bg-white/5 p-3", isAccordion && !isOpen && "hidden")}>
          <p className="text-[10px] uppercase tracking-[0.18em] text-primary">Evidence</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {bundle.edges.slice(0, 6).map((edge) => (
              <button
                className={cn(
                  "focus-ring min-h-11 rounded-full border px-3 text-[11px] transition",
                  selectedEdge?.id === edge.id ? "border-primary/30 bg-primary/12 text-primary" : "border-white/10 bg-black/10 text-muted-foreground hover:bg-white/6",
                )}
                key={edge.id}
                onClick={() => setSelectedEdge(edge)}
                type="button"
              >
                {edge.label}
              </button>
            ))}
          </div>
          {selectedEdge ? (
            <div className="mt-3 space-y-2">
              <RelationEvidenceCard edge={selectedEdge} />
              {selectedEdge.kind === "explicit" && onDetachEdge ? (
                <button
                  className="focus-ring min-h-11 w-full rounded-md border border-[hsl(var(--color-feedback-danger)/0.22)] bg-[hsl(var(--color-feedback-danger)/0.08)] px-3 text-xs text-[hsl(var(--color-feedback-danger))] transition hover:bg-[hsl(var(--color-feedback-danger)/0.14)]"
                  onClick={() => onDetachEdge(selectedEdge)}
                  type="button"
                >
                  관계 해제
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}

function mergeNodes(current: ContextNode[], incoming: ContextNode[]) {
  const map = new Map(current.map((node) => [`${node.type}:${node.id}`, node]));
  for (const node of incoming) {
    map.set(`${node.type}:${node.id}`, node);
  }
  return [...map.values()];
}
