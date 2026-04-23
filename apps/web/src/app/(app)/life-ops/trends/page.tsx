import { TrendsGrid } from "@/components/life-ops/trends-grid";
import { getHeatmapMock } from "@/lib/mock/life-ops";
import { getLifeOpsTrendSeries, seedLifeOpsSupportData } from "@/lib/server/life-ops";

export default async function LifeOpsTrendsPage() {
  await seedLifeOpsSupportData();
  const trends = await getLifeOpsTrendSeries(7);
  const rows = trends.rows.reverse();
  return <TrendsGrid deepWork={rows.map((row) => Number(row.deepWorkMinutes ?? 0))} heatmap={getHeatmapMock()} sleep={rows.map((row) => Number(row.sleepHours ?? 0))} />;
}
