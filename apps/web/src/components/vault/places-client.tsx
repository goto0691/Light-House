"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

export function PlacesClient() {
  const [isPending, startTransition] = useTransition();
  const places = useVaultStore((state) => state.places);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Places</p>
        <h1 className="mt-3 text-3xl font-semibold">장소 & 방문 기록</h1>
        <div className="mt-5 space-y-3">
          {places.map((place) => (
            <div className="block rounded-3xl border border-white/10 bg-white/5 p-4" key={place.id}>
              <Link className="block" href={`/vault?detail=place:${place.id}`}>
                <p className="text-sm font-medium text-foreground">{place.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{place.address}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-primary">{place.category}</p>
              </Link>
              <textarea
                className="mt-3 min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/10 p-3 text-sm text-foreground outline-none"
                onBlur={(event) => {
                  startTransition(async () => {
                    try {
                      await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                        `/api/vault/places/${place.id}/review`,
                        { review: event.target.value },
                        replaceSnapshot,
                      );
                      toast.success(`${place.name} 메모를 저장했습니다.`);
                    } catch (error) {
                      toast.error("장소 메모 저장에 실패했습니다.", {
                        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                      });
                    }
                  });
                }}
                disabled={isPending}
                defaultValue={place.review}
              />
            </div>
          ))}
        </div>
      </GlassCard>
      <GlassCard>
        <p className="text-xs uppercase tracking-[0.24em] text-primary">Map Placeholder</p>
        <div className="mt-4 flex min-h-[420px] items-center justify-center rounded-[28px] border border-dashed border-white/15 bg-white/5 text-sm text-muted-foreground">
          지도 연동은 Cloudflare/D1 뒤 단계에서 연결합니다.
        </div>
      </GlassCard>
    </section>
  );
}
