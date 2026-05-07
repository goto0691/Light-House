import { AssetsClient } from "@/components/vault/assets-client";
import { listSavedViews } from "@/lib/server/ui-state";

export default async function AssetsPage() {
  const savedViews = await listSavedViews({ domain: "assets", scope: "inventory" });
  return <AssetsClient savedViews={savedViews} />;
}
