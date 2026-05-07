import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { PlacePropertiesPanel } from "@/components/vault/place-properties-panel";
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
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.08em] text-primary">장소 상세</p>
                <h1 className="mt-3 font-display text-4xl text-foreground">{place.name}</h1>
              </div>
            </div>
          </GlassCard>
          <PlacePropertiesPanel place={place} />
        </div>
      }
      railDefaultLens="people"
    />
  );
}
