import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { getLifeOpsLog, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getTodayString } from "@/lib/mock/life-ops";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function DashboardPage() {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const today = getTodayString();
  const [actionHub, log, prm, vault] = await Promise.all([
    getActionHubSnapshot(),
    getLifeOpsLog(today),
    getPRMSnapshot(),
    getVaultSnapshot(),
  ]);

  return <DashboardClient log={log} media={vault.media} people={prm.people} tasks={actionHub.tasks} zettels={vault.zettels} />;
}
