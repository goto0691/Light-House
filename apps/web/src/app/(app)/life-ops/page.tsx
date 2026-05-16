import { DailyLogClient } from "@/components/life-ops/daily-log-client";
import { getTodayString } from "@/lib/mock/life-ops";
import { getLifeOpsHabitHeatmap, getLifeOpsLog } from "@/lib/server/life-ops";

export default async function LifeOpsPage() {
  const date = getTodayString();
  const [initialLog, heatmap] = await Promise.all([getLifeOpsLog(date), getLifeOpsHabitHeatmap()]);

  return <DailyLogClient date={date} heatmap={heatmap} initialLog={initialLog} />;
}
