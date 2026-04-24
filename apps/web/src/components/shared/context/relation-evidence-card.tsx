import type { ContextEdge } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";

const KIND_LABELS: Record<ContextEdge["kind"], string> = {
  explicit: "확정",
  source: "원본",
  mention: "멘션",
  inferred: "검토 필요",
  semantic: "추천",
};

const KIND_TONES: Record<ContextEdge["kind"], string> = {
  explicit: "border-[hsl(var(--color-feedback-success)/0.22)] bg-[hsl(var(--color-feedback-success)/0.1)] text-[hsl(var(--color-feedback-success))]",
  source: "border-primary/20 bg-primary/10 text-primary",
  mention: "border-[hsl(var(--color-feedback-info)/0.22)] bg-[hsl(var(--color-feedback-info)/0.1)] text-[hsl(var(--color-feedback-info))]",
  inferred: "border-[hsl(var(--color-feedback-warning)/0.24)] bg-[hsl(var(--color-feedback-warning)/0.1)] text-[hsl(var(--color-feedback-warning))]",
  semantic: "border-white/10 bg-white/6 text-muted-foreground",
};

export function RelationKindBadge({ kind, className }: { kind: ContextEdge["kind"]; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]", KIND_TONES[kind], className)}>
      {KIND_LABELS[kind]}
    </span>
  );
}

export function RelationEvidenceCard({ edge, className }: { edge: ContextEdge; className?: string }) {
  return (
    <section className={cn("rounded-md border border-white/10 bg-black/10 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-primary">{edge.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">confidence {(edge.confidence * 100).toFixed(0)}%</p>
        </div>
        <RelationKindBadge kind={edge.kind} />
      </div>

      <div className="mt-3 grid gap-2">
        {edge.evidence.map((item, index) => (
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs" key={`${edge.id}:${index}`}>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span className="font-medium uppercase tracking-[0.12em] text-foreground">{item.source}</span>
              {item.table ? <span>{item.table}</span> : null}
              {item.propertyName ? <span>{item.propertyName}</span> : null}
            </div>
            {item.snippet ? <p className="mt-1 line-clamp-2 text-muted-foreground">{item.snippet}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
