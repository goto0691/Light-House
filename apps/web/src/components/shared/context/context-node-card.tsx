import Link from "next/link";

import type { ContextEdge, ContextNode } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";
import { RelationKindBadge } from "@/components/shared/context/relation-evidence-card";

const TYPE_LABELS: Record<ContextNode["type"], string> = {
  project: "Project",
  task: "Task",
  zettel: "Zettel",
  media: "Media",
  person: "Person",
  daily_log: "Day",
  daily_entry: "Daily Entry",
  workout: "Workout",
  career: "Career",
  gift: "Gift",
  interaction: "Interaction",
  place: "Place",
  asset: "Asset",
  source_document: "Record",
  tag: "Tag",
};

export function ContextNodeCard({
  node,
  edges = [],
  onOpen,
  compact = false,
}: {
  node: ContextNode;
  edges?: ContextEdge[];
  onOpen?: (node: ContextNode) => void;
  compact?: boolean;
}) {
  const identityLabel = node.disambiguationLabel ?? (node.type === "person" && node.sourceDocumentId ? `record ${node.sourceDocumentId}` : node.subtitle);
  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary">{TYPE_LABELS[node.type]}</p>
          <h4 className="mt-1 truncate text-sm font-semibold text-foreground">{node.title}</h4>
          {identityLabel ? <p className="mt-1 truncate text-xs text-muted-foreground">{identityLabel}</p> : null}
          {node.type === "person" && node.subtitle && node.disambiguationLabel && node.subtitle !== node.disambiguationLabel ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground/80">{node.subtitle}</p>
          ) : null}
        </div>
        {node.tone === "warning" ? (
          <span className="shrink-0 rounded-full border border-[hsl(var(--color-feedback-warning)/0.24)] bg-[hsl(var(--color-feedback-warning)/0.1)] px-2 py-0.5 text-[10px] text-[hsl(var(--color-feedback-warning))]">
            검토
          </span>
        ) : null}
      </div>
      {!compact && node.preview ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{node.preview}</p> : null}
      {edges.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {edges.slice(0, 3).map((edge) => (
            <RelationKindBadge key={edge.id} kind={edge.kind} />
          ))}
        </div>
      ) : null}
    </>
  );

  if (onOpen) {
    return (
      <button
        aria-label={`${node.title} 열기`}
        className={cn("focus-ring min-h-11 w-full rounded-md border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/8", compact && "p-2")}
        onClick={() => onOpen(node)}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <Link aria-label={`${node.title} 열기`} className={cn("focus-ring block min-h-11 rounded-md border border-white/10 bg-white/5 p-3 transition hover:bg-white/8", compact && "p-2")} href={node.href}>
      {content}
    </Link>
  );
}
