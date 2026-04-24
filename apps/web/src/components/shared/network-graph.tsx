import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type NetworkGraphNode = {
  id: string;
  label: string;
  tone?: "gold" | "info" | "success" | "warning" | "muted";
};

export type NetworkGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

const toneClasses = {
  gold: "border-primary/25 bg-primary/12 text-primary",
  info: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  success: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  warning: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  muted: "border-white/10 bg-white/6 text-muted-foreground",
};

export function NetworkGraph({
  nodes,
  edges,
  emptySlot,
  className,
}: {
  nodes: NetworkGraphNode[];
  edges: NetworkGraphEdge[];
  emptySlot?: ReactNode;
  className?: string;
}) {
  if (!nodes.length) {
    return <div className={cn("rounded-lg border border-dashed border-white/15 bg-white/5 p-6 text-sm text-muted-foreground", className)}>{emptySlot ?? "연결된 노드가 없습니다."}</div>;
  }

  const edgeSet = new Set(edges.flatMap((edge) => [edge.source, edge.target]));

  return (
    <div className={cn("rounded-lg border border-white/10 bg-black/10 p-4", className)}>
      <div className="flex flex-wrap gap-2">
        {nodes.map((node) => (
          <span className={cn("rounded-full border px-3 py-1.5 text-xs", toneClasses[node.tone ?? (edgeSet.has(node.id) ? "gold" : "muted")])} key={node.id}>
            {node.label}
          </span>
        ))}
      </div>
      {edges.length ? (
        <div className="mt-4 space-y-2">
          {edges.slice(0, 12).map((edge) => (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" key={edge.id}>
              <span>{edge.source}</span>
              <span className="text-primary">→</span>
              <span>{edge.target}</span>
              {edge.label ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">{edge.label}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
