import { IntegrationsClient } from "@/components/settings/integrations-client";
import { getIntegrationSettingsOverview } from "@/lib/server/settings";

export default async function IntegrationsPage() {
  const overview = await getIntegrationSettingsOverview();
  return <IntegrationsClient initial={overview} />;
}
