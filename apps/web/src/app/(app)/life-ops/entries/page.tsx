import { DailyEntriesClient } from "@/components/life-ops/daily-entries-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function DailyEntriesPage() {
  const views = await listSavedViews({ domain: "daily", scope: "entries" });

  return <DailyEntriesClient deferInitialEntries entries={[]} savedViews={views} />;
}
