import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import { GIFT_PROPERTY_DEFINITIONS, GIFT_PROPERTY_GROUPS } from "@/lib/properties/gift";
import { getContextBundle } from "@/lib/server/context";
import { getPRMGift } from "@/lib/server/prm";

export default async function GiftDetailPage({
  params,
}: {
  params: Promise<{ giftId: string }>;
}) {
  const { giftId } = await params;
  const detail = await getPRMGift(giftId);
  if (!detail) notFound();
  const bundle = await getContextBundle("gift", giftId);
  const detailDefinitions = GIFT_PROPERTY_DEFINITIONS.filter((definition) => definition.field !== "title");

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-6">
          <p className="text-xs tracking-[0.08em] text-primary">선물 상세</p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl text-foreground">{detail.gift.title}</h1>
              {detail.person ? <Link className="mt-2 block text-sm text-primary" href={`/prm/${detail.person.id}`}>{detail.person.name}</Link> : null}
            </div>
          </div>
          <PropertySummary
            className="mt-6"
            definitions={detailDefinitions}
            emptyMessage="선물 속성이 아직 충분히 채워지지 않았습니다."
            groups={GIFT_PROPERTY_GROUPS}
            record={detail.gift}
            title="선물 속성"
            valueOverrides={{ personId: detail.person?.name ?? "알 수 없음" }}
          />
        </GlassCard>
      }
      railDefaultLens="people"
    />
  );
}
