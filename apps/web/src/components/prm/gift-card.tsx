import { Tag } from "@/components/shared/tag";
import { GlassCard } from "@/components/shared/glass-card";
import type { GiftMock } from "@/lib/mock/prm";
import Link from "next/link";

type GiftCardProps = {
  gift: GiftMock;
  personName: string;
  onDelete: () => void;
};

export function GiftCard({ gift, personName, onDelete }: GiftCardProps) {
  return (
    <GlassCard className="p-4" interactive>
      <Link className="block" href={`/prm/gifts/${gift.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl text-foreground">{gift.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{personName}</p>
        </div>
        <Tag value={gift.direction === "given" ? "given" : "received"} variant="custom" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{gift.occurredAt}</span>
        {gift.satisfaction ? <Tag value={gift.satisfaction} variant="neutral" /> : null}
      </div>
      </Link>
      <button className="mt-4 rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" onClick={onDelete} type="button">
        삭제
      </button>
    </GlassCard>
  );
}
