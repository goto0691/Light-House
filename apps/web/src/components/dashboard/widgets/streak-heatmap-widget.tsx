import Link from "next/link";

import { BentoCard } from "@/components/shared/bento-grid";
import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";

type StreakHeatmapWidgetProps = {
  heatmapData: Array<{ date: string; value: number }>;
  bestStreak: number;
};

export function StreakHeatmapWidget({ heatmapData, bestStreak }: StreakHeatmapWidgetProps) {
  return (
    <BentoCard colSpan={8} rowSpan={2}>
      <GlassCard className="h-full" interactive>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">지속 기록</p>
            <p className="mt-2 text-sm text-muted-foreground">올해의 반복 리듬을 한눈에 봅니다.</p>
          </div>
          <span className="rounded-md border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs tracking-[0.08em] text-primary">
            최장 {bestStreak}일
          </span>
        </div>
        <div className="mt-5 overflow-hidden rounded-lg border border-white/10 bg-black/10 p-3">
          <Heatmap data={heatmapData} />
        </div>
        <div className="mt-4">
          <Link className="text-xs tracking-[0.08em] text-primary" href="/life-ops">
            달력 열기
          </Link>
        </div>
      </GlassCard>
    </BentoCard>
  );
}
