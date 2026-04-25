import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getContextBundle } from "@/lib/server/context";
import { getVaultSnapshot } from "@/lib/server/vault";

export default async function PlaceDetailPage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  const snapshot = await getVaultSnapshot();
  const place = snapshot.places.find((item) => item.id === placeId);
  if (!place) notFound();

  const bundle = await getContextBundle("place", placeId);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-primary">Place Detail</p>
              <h1 className="mt-3 font-display text-4xl text-foreground">{place.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{place.address}</p>
            </div>
            <Tag value={place.category} variant="custom" />
          </div>
          <p className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{place.review || "장소 메모가 아직 없습니다."}</p>
        </GlassCard>
      }
      railDefaultLens="people"
    />
  );
}
