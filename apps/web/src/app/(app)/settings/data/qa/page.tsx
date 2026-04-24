import { MigrationQaDashboard } from "@/components/settings/migration-qa-dashboard";
import { getMigrationQaOverview } from "@/lib/server/settings";

export default async function MigrationQaPage() {
  const overview = await getMigrationQaOverview();
  return <MigrationQaDashboard overview={overview} />;
}
