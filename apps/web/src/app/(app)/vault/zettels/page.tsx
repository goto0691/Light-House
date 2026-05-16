import { ZettelsClient } from "@/components/vault/zettels-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function ZettelsPage() {
  const savedViews = await listSavedViews({ domain: "library", scope: "knowledge" });

  return <ZettelsClient deferInitialZettels initialZettels={[]} savedViews={savedViews} />;
}
