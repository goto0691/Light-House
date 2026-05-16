"use client";

import { BentoCard, BentoGrid } from "@/components/shared/bento-grid";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";

export type LayoutWidget = {
  id: string;
  pageKey: string;
  widgetKey: string;
  titleOverride: string | null;
  layout: Record<string, unknown>;
  isHidden: boolean;
  displayOrder: number;
};

type BentoLayoutEditorProps = {
  items: LayoutWidget[];
  onChange: (items: LayoutWidget[]) => void;
};

function moveItem(items: LayoutWidget[], itemId: string, direction: -1 | 1) {
  const next = items.slice();
  const currentIndex = next.findIndex((entry) => entry.id === itemId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= next.length) return items;
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next.map((entry, order) => ({ ...entry, displayOrder: order }));
}

export function BentoLayoutEditor({ items, onChange }: BentoLayoutEditorProps) {
  const ordered = items.slice().sort((left, right) => left.displayOrder - right.displayOrder);
  const visible = ordered.filter((item) => !item.isHidden);

  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.08em] text-primary">대시보드 배치</p>
          <p className="mt-2 text-sm text-muted-foreground">위젯 표시 여부와 순서를 조정하는 저장형 레이아웃 편집기입니다.</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm text-foreground">표시 {visible.length}개</div>
      </div>

      <BentoGrid>
        {visible.map((item, index) => {
          const colSpan = typeof item.layout.colSpan === "number" ? item.layout.colSpan : 4;
          const rowSpan = typeof item.layout.rowSpan === "number" ? item.layout.rowSpan : 1;

          return (
            <BentoCard colSpan={colSpan} key={item.id} priority={index === 0 ? "hero" : index < 3 ? "primary" : "secondary"} rowSpan={rowSpan}>
              <GlassCard className="h-full p-4" interactive>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl text-foreground">{item.titleOverride ?? item.widgetKey}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{JSON.stringify(item.layout)}</p>
                  </div>
                  <Tag value={item.pageKey} variant="neutral" />
                </div>
              </GlassCard>
            </BentoCard>
          );
        })}
      </BentoGrid>

      <div className="space-y-3">
        {ordered.map((item, index) => (
          <div className="grid gap-3 rounded-lg border border-white/10 bg-black/10 p-4 md:grid-cols-[1fr_auto_auto_auto]" key={item.id}>
            <div>
              <p className="text-sm font-medium text-foreground">{item.widgetKey}</p>
              <p className="mt-1 text-xs text-muted-foreground">{JSON.stringify(item.layout)}</p>
            </div>
            <button
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/8"
              disabled={index === 0}
              onClick={() => onChange(moveItem(ordered, item.id, -1))}
              type="button"
            >
              위로
            </button>
            <button
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/8"
              onClick={() =>
                onChange(ordered.map((entry) => (entry.id === item.id ? { ...entry, isHidden: !entry.isHidden } : entry)))
              }
              type="button"
            >
              {item.isHidden ? "표시" : "숨김"}
            </button>
            <button
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/8"
              disabled={index === ordered.length - 1}
              onClick={() => onChange(moveItem(ordered, item.id, 1))}
              type="button"
            >
              아래로
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
