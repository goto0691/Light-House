import { GlassCard } from "@/components/shared/glass-card";
import { Heatmap } from "@/components/shared/heatmap";
import { Sparkline } from "@/components/shared/sparkline";
import { getHeatmapMock } from "@/lib/mock/life-ops";
import { getLifeOpsTrendSeries, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function LifeOpsTrendsPage() {
  await seedLifeOpsSupportData();
  const trends = await getLifeOpsTrendSeries(7);
  const rows = trends.rows.reverse();
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Trends</p>
        <h1 className="mt-3 text-3xl font-semibold">Mood / Sleep / Energy</h1>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-muted-foreground">Sleep Pattern</p>
            <Sparkline className="mt-4 h-20 w-full" data={rows.map((row) => Number(row.sleepHours ?? 0))} />
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-muted-foreground">Deep Work Trend</p>
            <Sparkline className="mt-4 h-20 w-full" data={rows.map((row) => Number(row.deepWorkMinutes ?? 0))} />
          </div>
        </div>
      </GlassCard>
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Heatmap</p>
        <h2 className="mt-3 text-3xl font-semibold">Habit Activity</h2>
        <div className="mt-5">
          <Heatmap data={getHeatmapMock()} />
        </div>
      </GlassCard>
    </section>
  );
}
