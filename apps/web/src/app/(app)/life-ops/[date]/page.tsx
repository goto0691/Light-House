import { DailyLogClient } from "@/components/life-ops/daily-log-client";
import { getLifeOpsHabitHeatmap, getLifeOpsLog } from "@/lib/server/life-ops";

export default async function DailyLogPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const [initialLog, heatmap] = await Promise.all([getLifeOpsLog(date), getLifeOpsHabitHeatmap()]);
  return <DailyLogClient date={date} heatmap={heatmap} initialLog={initialLog} />;
}
