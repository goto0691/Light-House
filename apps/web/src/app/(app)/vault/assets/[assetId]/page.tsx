import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getContextBundle } from "@/lib/server/context";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  await seedVaultSupportData();
  const snapshot = await getVaultSnapshot();
  const asset = snapshot.assets.find((item) => item.id === assetId);
  if (!asset) notFound();

  const bundle = await getContextBundle("asset", assetId);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Asset Detail</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">{asset.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{asset.brand}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Tag value={asset.category} variant="custom" />
            <Tag value={asset.condition} variant="neutral" />
          </div>
        </GlassCard>
      }
      railDefaultLens="source"
    />
  );
}
