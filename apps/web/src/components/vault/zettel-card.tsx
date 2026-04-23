import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { cn } from "@/lib/utils/cn";
import type { ZettelMock } from "@/lib/mock/vault";

type ZettelCardProps = {
  zettel: ZettelMock;
  selected?: boolean;
  onSelect: () => void;
  actions?: React.ReactNode;
};

export function ZettelCard({ zettel, selected, onSelect, actions }: ZettelCardProps) {
  return (
    <GlassCard
      className={cn(
        "border p-4",
        selected ? "border-primary/35 bg-primary/10 shadow-[var(--shadow-glow)]" : "border-white/10 bg-white/5",
      )}
      interactive
      priority="primary"
    >
      <button className="focus-ring block w-full text-left" onClick={onSelect} type="button">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-balance line-clamp-2 font-display text-2xl leading-8 text-foreground">{zettel.title}</h3>
          <Tag value={zettel.type} variant="neutral" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Tag value={zettel.category} variant="custom" />
          <span className="tabular-nums rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {zettel.backlinks.length} backlinks
          </span>
          {zettel.outgoingLinks.length ? (
            <span className="tabular-nums rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {zettel.outgoingLinks.length} outgoing
            </span>
          ) : null}
        </div>
        <p className="text-pretty mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{zettel.summary}</p>
      </button>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </GlassCard>
  );
}
