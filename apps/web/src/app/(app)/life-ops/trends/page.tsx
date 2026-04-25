import { TrendsGrid } from "@/components/life-ops/trends-grid";
import { getLifeOpsHabitHeatmap, getLifeOpsTrendSeries } from "@/lib/server/life-ops";

export default async function LifeOpsTrendsPage() {
  const [trends, heatmap] = await Promise.all([getLifeOpsTrendSeries(7), getLifeOpsHabitHeatmap()]);
  const rows = trends.rows.reverse();
  return <TrendsGrid deepWork={rows.map((row) => Number(row.deepWorkMinutes ?? 0))} heatmap={heatmap} sleep={rows.map((row) => Number(row.sleepHours ?? 0))} />;
}
