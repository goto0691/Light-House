import { notFound } from "next/navigation";

import { EntityContextShell } from "@/components/shared/context/entity-context-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { Tag } from "@/components/shared/tag";
import { MediaPropertiesPanel } from "@/components/vault/media-properties-panel";
import type { MediaMock } from "@/lib/mock/vault";
import { getContextBundle } from "@/lib/server/context";
import { getVaultMedia } from "@/lib/server/vault";

const MEDIA_TYPE_LABELS: Record<MediaMock["mediaType"], string> = {
  book: "책",
  game: "게임",
  screen: "영상",
};

const MEDIA_STATUS_LABELS: Record<MediaMock["status"], string> = {
  backlog: "대기",
  completed: "완료",
  consuming: "보는 중",
  dropped: "중단",
};

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ mediaId: string }>;
}) {
  const { mediaId } = await params;
  const media = await getVaultMedia(mediaId);
  if (!media) notFound();

  const bundle = await getContextBundle("media", mediaId);

  return (
    <EntityContextShell
      bundle={bundle}
      mainSlot={
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.08em] text-primary">미디어 상세</p>
                <h1 className="mt-3 font-display text-4xl text-foreground">{media.title}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{[media.creator, media.platformOrPublisher, media.genre].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Tag value={MEDIA_TYPE_LABELS[media.mediaType]} variant="custom" />
                <Tag value={MEDIA_STATUS_LABELS[media.status]} variant="status" />
              </div>
            </div>
            <p className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-muted-foreground">{media.review}</p>
          </GlassCard>
          <MediaPropertiesPanel media={media} />
        </div>
      }
      railDefaultLens="people"
    />
  );
}
