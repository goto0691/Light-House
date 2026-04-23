import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { Sparkline } from "@/components/shared/sparkline";

type TrendsGridProps = {
  sleep: number[];
  deepWork: number[];
  heatmap: Array<{ date: string; value: number }>;
};

export function TrendsGrid({ sleep, deepWork, heatmap }: TrendsGridProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Trends</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Mood / Sleep / Energy</h1>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-muted-foreground">Sleep Pattern</p>
            <Sparkline className="mt-4 h-20 w-full" data={sleep} />
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-muted-foreground">Deep Work Trend</p>
            <Sparkline className="mt-4 h-20 w-full" data={deepWork} />
          </div>
        </div>
      </GlassCard>
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Heatmap</p>
        <h2 className="mt-3 font-display text-4xl text-foreground">Habit Activity</h2>
        <div className="mt-5">
          <Heatmap data={heatmap} />
        </div>
      </GlassCard>
    </div>
  );
}
