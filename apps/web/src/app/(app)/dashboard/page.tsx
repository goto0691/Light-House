import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getLifeOpsHabitHeatmap, getLifeOpsLog, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getTodayString } from "@/lib/mock/life-ops";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { listWidgetLayouts } from "@/lib/server/ui-state";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function DashboardPage() {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const today = getTodayString();
  const [actionHub, log, prm, vault, heatmap, dashboardLayouts] = await Promise.all([
    getActionHubSnapshot(),
    getLifeOpsLog(today),
    getPRMSnapshot(),
    getVaultSnapshot(),
    getLifeOpsHabitHeatmap(),
    listWidgetLayouts("dashboard"),
  ]);

  return <DashboardClient dashboardLayouts={dashboardLayouts} heatmap={heatmap} log={log} media={vault.media} people={prm.people} tasks={actionHub.tasks} zettels={vault.zettels} />;
}
