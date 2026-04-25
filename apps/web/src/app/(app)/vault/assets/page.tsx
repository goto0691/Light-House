import { AssetCard } from "@/components/vault/asset-card";
import { GlassCard } from "@/components/shared/glass-card";
import { getVaultSnapshot } from "@/lib/server/vault";

export default async function AssetsPage() {
  const snapshot = await getVaultSnapshot();
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Assets</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">장비 & 수집품</h1>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.assets.map((asset) => <AssetCard asset={asset} key={asset.id} />)}
      </div>
    </GlassCard>
  );
}
