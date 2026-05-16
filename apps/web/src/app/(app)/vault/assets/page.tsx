import { AssetsClient } from "@/components/vault/assets-client";
import { listSavedViews } from "@/lib/server/ui-state";
import { getVaultAssetList } from "@/lib/server/vault";

export default async function AssetsPage() {
  const [assets, savedViews] = await Promise.all([getVaultAssetList(), listSavedViews({ domain: "assets", scope: "inventory" })]);
  return <AssetsClient initialAssets={assets} savedViews={savedViews} />;
}
