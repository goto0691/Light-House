import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getZettelOptionLabel, ZETTEL_SOURCE_RELIABILITY_OPTIONS, ZETTEL_STATUS_OPTIONS, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
import { cn } from "@/lib/utils/cn";
import type { ZettelMock } from "@/lib/mock/vault";
import { getZettelDocumentKindLabel } from "@/lib/vault/zettel-properties";

type ZettelCardProps = {
  zettel: ZettelMock;
  selected?: boolean;
  onSelect: () => void;
  actions?: React.ReactNode;
};

export function ZettelCard({ zettel, selected, onSelect, actions }: ZettelCardProps) {
  const documentKindLabel = getZettelDocumentKindLabel(zettel.documentKind);
  const sourceReliabilityLabel = getZettelOptionLabel(ZETTEL_SOURCE_RELIABILITY_OPTIONS, zettel.sourceReliability, zettel.sourceReliability ?? "");
  const statusLabel = getZettelOptionLabel(ZETTEL_STATUS_OPTIONS, zettel.status, zettel.status ?? "");
  const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, zettel.type, zettel.type);

  return (
    <GlassCard
      className={cn(
        "border p-3",
        selected ? "border-primary/35 bg-primary/10 shadow-[var(--shadow-glow)]" : "border-white/10 bg-white/5",
      )}
      interactive
      priority="secondary"
    >
      <button className="focus-ring block w-full text-left" onClick={onSelect} type="button">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-sm font-medium leading-6 text-foreground">{zettel.title}</h3>
          <Tag value={typeLabel} variant="neutral" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Tag value={zettel.category} variant="custom" />
          {documentKindLabel ? <Tag value={documentKindLabel} variant="neutral" /> : null}
          {statusLabel ? <Tag value={statusLabel} variant="status" /> : null}
          {zettel.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} value={`#${tag}`} variant="neutral" />
          ))}
          {(zettel.aliases ?? []).slice(0, 2).map((alias) => (
            <Tag key={alias} value={alias} variant="neutral" />
          ))}
          {sourceReliabilityLabel && zettel.sourceReliability !== "unknown" ? <Tag value={sourceReliabilityLabel} variant="neutral" /> : null}
          {zettel.reviewDueAt ? (
            <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              review {zettel.reviewDueAt.slice(0, 10)}
            </span>
          ) : null}
          <span className="tabular-nums rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {zettel.backlinks.length} backlinks
          </span>
          {zettel.outgoingLinks.length ? (
            <span className="tabular-nums rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {zettel.outgoingLinks.length} outgoing
            </span>
          ) : null}
        </div>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{zettel.summary}</p>
      </button>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </GlassCard>
  );
}
