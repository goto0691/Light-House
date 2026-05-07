import { DailyEntriesClient } from "@/components/life-ops/daily-entries-client";
import { getDailyEntryArchive } from "@/lib/server/life-ops";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function DailyEntriesPage() {
  const views = await listSavedViews({ domain: "daily", scope: "entries" });
  const entries = await getDailyEntryArchive();

  return <DailyEntriesClient entries={entries} savedViews={views} />;
}
