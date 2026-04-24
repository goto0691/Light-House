import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import type { AssetMock } from "@/lib/mock/vault";
import Link from "next/link";

export function AssetCard({ asset }: { asset: AssetMock }) {
  return (
    <GlassCard className="p-4" interactive>
      <Link className="block" href={`/vault/assets/${asset.id}`}>
        <p className="font-display text-2xl text-foreground">{asset.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{asset.brand}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Tag value={asset.category} variant="custom" />
          <Tag value={asset.condition} variant="neutral" />
        </div>
      </Link>
    </GlassCard>
  );
}
