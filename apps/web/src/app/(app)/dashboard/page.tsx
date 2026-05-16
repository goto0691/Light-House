import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getActionHubTasks, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getLifeOpsHabitHeatmap, getLifeOpsLog, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getTodayString } from "@/lib/mock/life-ops";
import { getPRMPeople, seedPRMSupportData } from "@/lib/server/prm";
import { listWidgetLayouts } from "@/lib/server/ui-state";
import { getVaultMediaList, getVaultZettelList, seedVaultSupportData } from "@/lib/server/vault";

export default async function DashboardPage() {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const today = getTodayString();
  const [tasks, log, people, zettels, media, heatmap, dashboardLayouts] = await Promise.all([
    getActionHubTasks(),
    getLifeOpsLog(today),
    getPRMPeople(),
    getVaultZettelList(),
    getVaultMediaList(),
    getLifeOpsHabitHeatmap(),
    listWidgetLayouts("dashboard"),
  ]);

  return <DashboardClient dashboardLayouts={dashboardLayouts} heatmap={heatmap} log={log} media={media} people={people} tasks={tasks} zettels={zettels} />;
}
