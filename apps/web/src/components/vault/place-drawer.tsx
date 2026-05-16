"use client";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { useVaultStore } from "@/stores/use-vault-store";

export function PlaceDrawer({ id }: { id: string }) {
  const place = useVaultStore((state) => state.places.find((item) => item.id === id));

  if (!place) {
    return <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">장소를 찾지 못했습니다.</div>;
  }

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="place"
      mainSlot={() => (
        <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">{place.category}</p>
        <h3 className="mt-2 text-2xl font-semibold text-foreground">{place.name}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{place.address}</p>
      </section>
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs tracking-[0.08em] text-primary">검토</p>
        <p className="mt-3 text-sm text-foreground">{place.review}</p>
      </section>
    </div>
      )}
      railDefaultLens="places"
    />
  );
}
