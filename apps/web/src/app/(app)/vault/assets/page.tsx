import { GlassCard } from "@/components/shared/glass-card";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function AssetsPage() {
  await seedVaultSupportData();
  const snapshot = await getVaultSnapshot();
  return (
    <GlassCard>
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Assets</p>
      <h1 className="mt-3 text-3xl font-semibold">장비 & 수집품</h1>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.assets.map((asset) => (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" key={asset.id}>
            <p className="text-sm font-medium text-foreground">{asset.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{asset.brand}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-primary">{asset.category}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
