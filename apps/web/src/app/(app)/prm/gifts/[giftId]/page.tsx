import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
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

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-primary">Gift Detail</p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl text-foreground">{detail.gift.title}</h1>
              {detail.person ? <Link className="mt-2 block text-sm text-primary" href={`/prm/${detail.person.id}`}>{detail.person.name}</Link> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Tag value={detail.gift.direction} variant="custom" />
              <Tag value={detail.gift.occurredAt} variant="neutral" />
            </div>
          </div>
          {detail.gift.satisfaction ? <p className="mt-5 text-sm text-muted-foreground">반응: {detail.gift.satisfaction}</p> : null}
          <p className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{detail.gift.notes || "선물 메모가 아직 없습니다."}</p>
        </GlassCard>
      }
      railDefaultLens="people"
    />
  );
}
