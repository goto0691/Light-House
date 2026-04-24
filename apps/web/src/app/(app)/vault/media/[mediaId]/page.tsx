import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { getContextBundle } from "@/lib/server/context";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ mediaId: string }>;
}) {
  const { mediaId } = await params;
  await seedVaultSupportData();
  const snapshot = await getVaultSnapshot();
  const media = snapshot.media.find((item) => item.id === mediaId);
  if (!media) notFound();

  const bundle = await getContextBundle("media", mediaId);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <GlassCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-primary">Media Detail</p>
              <h1 className="mt-3 font-display text-4xl text-foreground">{media.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{media.creator}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tag value={media.mediaType} variant="custom" />
              <Tag value={media.status} variant="status" />
            </div>
          </div>
          <p className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{media.review}</p>
        </GlassCard>
      }
      railDefaultLens="people"
    />
  );
}
