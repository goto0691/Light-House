import { AISettingsClient } from "@/components/settings/ai-settings-client";
import { getAISettingsOverview } from "@/lib/server/settings";

export default async function AISettingsPage() {
  const overview = await getAISettingsOverview();
  return <AISettingsClient initial={overview} />;
}
