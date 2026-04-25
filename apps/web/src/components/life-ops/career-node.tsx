import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { CareerLog } from "@/lib/mock/life-ops";
import Link from "next/link";

type CareerNodeProps = {
  item: CareerLog;
  onDelete: () => void;
};

export function CareerNode({ item, onDelete }: CareerNodeProps) {
  return (
    <div className="flex gap-4">
      <div className="mt-2 h-3 w-3 rounded-full bg-primary" />
      <GlassCard className="flex-1 p-4" interactive>
        <div className="flex items-start justify-between gap-3">
          <Link className="block" href={`/life-ops/career/${item.id}`}>
            <p className="text-sm text-muted-foreground">{item.period}</p>
            <h2 className="mt-1 font-display text-3xl text-foreground">{item.organization}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{item.role}</p>
          </Link>
          <div className="flex items-center gap-2">
            <Tag value={item.category} variant="custom" />
            <button className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" onClick={onDelete} type="button">
              삭제
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{item.description || "설명 없음"}</p>
      </GlassCard>
    </div>
  );
}
