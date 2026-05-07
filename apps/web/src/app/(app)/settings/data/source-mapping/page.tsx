import { SourceMappingWorkbench } from "@/components/settings/source-mapping-workbench";
import { getSourcePropertyWorkbench } from "@/lib/server/source-workbench";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function SourceMappingPage() {
  const [workbench, savedViews] = await Promise.all([
    getSourcePropertyWorkbench(),
    listSavedViews({ domain: "sources", scope: "qa" }),
  ]);

  return <SourceMappingWorkbench savedViews={savedViews} workbench={workbench} />;
}
