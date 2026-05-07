import Link from "next/link";

import { CareerPropertiesPanel } from "@/components/life-ops/career-properties-panel";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { CareerLog } from "@/lib/mock/life-ops";
import { CAREER_CATEGORY_OPTIONS } from "@/lib/properties/career";
import { optionLabel } from "@/lib/properties/types";

type CareerNodeProps = {
  item: CareerLog;
  onDelete: () => void;
};

export function CareerNode({ item, onDelete }: CareerNodeProps) {
  const categoryLabel = optionLabel(CAREER_CATEGORY_OPTIONS, item.category, item.category);

  return (
    <div className="flex gap-4">
      <div className="mt-2 h-3 w-3 rounded-full bg-primary" />
      <div className="flex-1 space-y-3">
        <GlassCard className="p-4" interactive>
          <div className="flex items-start justify-between gap-3">
            <Link className="block" href={`/life-ops/career/${item.id}`} scroll={false}>
              <p className="text-sm text-muted-foreground">{item.period}</p>
              <h2 className="mt-1 font-display text-3xl text-foreground">{item.organization}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{item.role}</p>
            </Link>
            <div className="flex items-center gap-2">
              <Tag value={categoryLabel} variant="custom" />
              <button className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground" onClick={onDelete} type="button">
                삭제
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{item.description || "설명 없음"}</p>
        </GlassCard>
        <details className="rounded-lg border border-white/10 bg-white/5 p-3">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground">속성 편집</summary>
          <div className="mt-3">
            <CareerPropertiesPanel item={item} />
          </div>
        </details>
      </div>
    </div>
  );
}
