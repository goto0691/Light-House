import { GlassCard } from "@/components/shared/glass-card";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import type { AssetMock } from "@/lib/mock/vault";
import { ASSET_PROPERTY_DEFINITIONS, ASSET_PROPERTY_GROUPS } from "@/lib/properties/asset";
import Link from "next/link";

const DEFAULT_VISIBLE_FIELDS = ["category", "brand", "condition"];

export function AssetCard({ asset, visibleFields = DEFAULT_VISIBLE_FIELDS }: { asset: AssetMock; visibleFields?: string[] }) {
  const definitions = ASSET_PROPERTY_DEFINITIONS.filter((definition) => definition.field !== "name" && visibleFields.includes(definition.field));
  return (
    <GlassCard className="p-4">
      <Link className="block" href={`/vault/assets/${asset.id}`}>
        <p className="font-display text-2xl text-foreground">{asset.name}</p>
        <PropertySummary className="mt-4" definitions={definitions} groups={ASSET_PROPERTY_GROUPS} mode="all" record={asset} showGroupLabels={false} showTitle={false} />
        {visibleFields.includes("sourceDocument") && asset.sourceDocument ? (
          <p className="mt-3 text-xs text-muted-foreground">원본 속성 {asset.sourceDocument.properties.length}개</p>
        ) : null}
      </Link>
    </GlassCard>
  );
}
