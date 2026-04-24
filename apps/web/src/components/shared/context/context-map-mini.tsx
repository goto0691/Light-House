"use client";

import type { ContextBundle, ContextNode } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";

function positionFor(index: number, total: number) {
  if (index === 0) return { x: 50, y: 50 };
  const angle = ((index - 1) / Math.max(1, total - 1)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 50 + Math.cos(angle) * 34,
    y: 50 + Math.sin(angle) * 34,
  };
}

function toneClass(node: ContextNode) {
  if (node.type === "person") return "border-[hsl(var(--color-feedback-info)/0.45)] bg-[hsl(var(--color-feedback-info)/0.18)]";
  if (node.type === "media") return "border-primary/45 bg-primary/18";
  if (node.type === "place") return "border-[hsl(var(--color-feedback-success)/0.45)] bg-[hsl(var(--color-feedback-success)/0.16)]";
  if (node.tone === "warning") return "border-[hsl(var(--color-feedback-warning)/0.5)] bg-[hsl(var(--color-feedback-warning)/0.18)]";
  return "border-white/20 bg-white/12";
}

export function ContextMapMini({ bundle, className, onOpenNode }: { bundle: ContextBundle; className?: string; onOpenNode?: (node: ContextNode) => void }) {
  const visibleNodes = [bundle.focus, ...bundle.nodes.filter((node) => !(node.type === bundle.focus.type && node.id === bundle.focus.id)).slice(0, 10)];
  const positions = new Map(visibleNodes.map((node, index) => [`${node.type}:${node.id}`, positionFor(index, visibleNodes.length)]));

  return (
    <section className={cn("rounded-lg border border-white/10 bg-white/5 p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Context Map</p>
          <p className="mt-1 text-xs text-muted-foreground">{bundle.edges.length} edges</p>
        </div>
      </div>
      <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-black/15">
        <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
          {bundle.edges.slice(0, 18).map((edge) => {
            const from = positions.get(`${edge.from.type}:${edge.from.id}`);
            const to = positions.get(`${edge.to.type}:${edge.to.id}`);
            if (!from || !to) return null;
            return (
              <line
                key={edge.id}
                stroke={edge.kind === "source" ? "hsl(var(--color-primary) / 0.45)" : "hsl(var(--color-border) / 0.55)"}
                strokeDasharray={edge.kind === "source" || edge.kind === "inferred" ? "3 3" : undefined}
                strokeWidth="0.8"
                x1={from.x}
                x2={to.x}
                y1={from.y}
                y2={to.y}
              />
            );
          })}
        </svg>
        {visibleNodes.map((node) => {
          const point = positions.get(`${node.type}:${node.id}`) ?? { x: 50, y: 50 };
          const isFocus = node.type === bundle.focus.type && node.id === bundle.focus.id;
          return (
            <button
              aria-label={`${node.title} 열기`}
              className={cn(
                "focus-ring absolute grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-[10px] font-semibold text-foreground shadow-sm transition hover:scale-105",
                toneClass(node),
                isFocus && "h-12 w-12 border-primary bg-primary/20 text-primary",
              )}
              key={`${node.type}:${node.id}`}
              onClick={() => onOpenNode?.(node)}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              type="button"
              title={node.title}
            >
              {node.type.slice(0, 1).toUpperCase()}
            </button>
          );
        })}
      </div>
    </section>
  );
}
