import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getZettelOptionLabel, ZETTEL_STATUS_OPTIONS, ZETTEL_TYPE_OPTIONS } from "@/components/vault/zettel-form";
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
  const statusLabel = getZettelOptionLabel(ZETTEL_STATUS_OPTIONS, zettel.status, zettel.status ?? "");
  const typeLabel = getZettelOptionLabel(ZETTEL_TYPE_OPTIONS, zettel.type, zettel.type);
  const relationCount = zettel.backlinks.length + zettel.outgoingLinks.length;

  return (
    <GlassCard
      className={cn(
        "border p-0",
        selected ? "border-primary/35 bg-primary/10" : "border-white/10 bg-white/5",
      )}
      priority="secondary"
    >
      <button className="focus-ring block w-full rounded-md p-4 text-left hover:bg-white/6" onClick={onSelect} type="button">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-sm font-medium leading-6 text-foreground">{zettel.title}</h3>
          <Tag value={typeLabel} variant="neutral" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Tag value={zettel.category} variant="custom" />
          {documentKindLabel ? <Tag value={documentKindLabel} variant="neutral" /> : null}
          {statusLabel ? <Tag value={statusLabel} variant="status" /> : null}
          {zettel.tags.slice(0, 1).map((tag) => (
            <Tag key={tag} value={`#${tag}`} variant="neutral" />
          ))}
          {relationCount ? (
        <span className="tabular-nums rounded-md border border-white/10 bg-black/10 px-3 py-1 text-[11px] tracking-[0.08em] text-muted-foreground">
          연결 {relationCount}
        </span>
          ) : null}
        </div>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{zettel.summary}</p>
      </button>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </GlassCard>
  );
}
