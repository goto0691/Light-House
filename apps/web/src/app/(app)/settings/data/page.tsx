import { DataSettingsClient } from "@/components/settings/data-settings-client";
import { getDataSettingsOverview } from "@/lib/server/settings";

export default async function DataSettingsPage() {
  const overview = await getDataSettingsOverview();
  return <DataSettingsClient initial={overview} />;
}
