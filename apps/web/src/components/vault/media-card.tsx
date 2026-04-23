import Link from "next/link";

import { Tag } from "@/components/shared/tag";
import { GlassCard } from "@/components/shared/glass-card";
import type { MediaMock } from "@/lib/mock/vault";

type MediaCardProps = {
  item: MediaMock;
  actionLabel?: string;
  onCycleStatus: () => void;
  disabled?: boolean;
};

export function MediaCard({ item, actionLabel, onCycleStatus, disabled }: MediaCardProps) {
  return (
    <GlassCard className="p-5" interactive>
      <Link className="block transition hover:-translate-y-0.5" href={`/vault?detail=media:${item.id}`}>
        <div className="aspect-[4/3] rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,rgba(212,175,55,0.14),rgba(94,140,255,0.12),rgba(255,255,255,0.05))]" />
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl text-foreground">{item.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{item.creator}</p>
          </div>
          <Tag value={item.mediaType} variant="custom" />
        </div>
      </Link>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Tag value={item.status} variant="status" />
        <button
          className="rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-primary transition hover:bg-primary/15"
          disabled={disabled}
          onClick={onCycleStatus}
          type="button"
        >
          {actionLabel ?? "상태 순환"}
        </button>
      </div>
    </GlassCard>
  );
}
