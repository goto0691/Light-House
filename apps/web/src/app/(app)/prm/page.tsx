import { PRMClient } from "@/components/prm/prm-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function PrmPage() {
  const savedViews = await listSavedViews({ domain: "people", scope: "relationships" });
  return <PRMClient savedViews={savedViews} />;
}
