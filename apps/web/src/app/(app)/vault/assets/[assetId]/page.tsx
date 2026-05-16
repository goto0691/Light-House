import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { AssetPropertiesPanel } from "@/components/vault/asset-properties-panel";
import { getContextBundle } from "@/lib/server/context";
import { getVaultAsset } from "@/lib/server/vault";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const asset = await getVaultAsset(assetId);
  if (!asset) notFound();

  const bundle = await getContextBundle("asset", assetId);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <div className="space-y-4">
          <GlassCard className="p-5">
            <p className="text-xs tracking-[0.08em] text-primary">자산 상세</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">{asset.name}</h1>
          </GlassCard>
          <AssetPropertiesPanel asset={asset} />
        </div>
      }
      railDefaultLens="source"
    />
  );
}
