"use client";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { Tag } from "@/components/shared/tag";
import { MediaPropertiesPanel } from "@/components/vault/media-properties-panel";
import type { MediaMock } from "@/lib/mock/vault";
import { useVaultStore } from "@/stores/use-vault-store";

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

export function MediaDrawer({ id }: { id: string }) {
  const media = useVaultStore((state) => state.media.find((item) => item.id === id));

  if (!media) {
    return <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-4 text-sm text-muted-foreground">미디어를 찾지 못했습니다.</div>;
  }

  return (
    <ContextBundlePanel
      density="drawer"
      enableAttach
      entityId={id}
      entityType="media"
      mainSlot={() => (
        <div className="space-y-4">
          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.16em] text-primary">{MEDIA_TYPE_LABELS[media.mediaType]}</p>
                <h3 className="mt-2 text-2xl font-semibold text-foreground">{media.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{[media.creator, media.platformOrPublisher, media.genre].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Tag value={MEDIA_TYPE_LABELS[media.mediaType]} variant="custom" />
                <Tag value={MEDIA_STATUS_LABELS[media.status]} variant="status" />
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Detail label="평점" value={media.rating ? `${media.rating}/5` : null} />
              <Detail label="기록일" value={media.loggedAt?.slice(0, 10) ?? null} />
              <Detail label="시작일" value={media.startedAt?.slice(0, 10) ?? null} />
              <Detail label="완료일" value={media.completedAt?.slice(0, 10) ?? null} />
              <Detail label="원제" value={media.originalTitle} />
              <Detail label="세부 타입" value={media.subtype ?? media.screenKind} />
              <Detail label="스튜디오" value={media.studio} />
              <Detail label="출시" value={media.releaseYear ? String(media.releaseYear) : null} />
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs tracking-[0.08em] text-primary">감상</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{media.review}</p>
            {media.evaluation ? <p className="mt-3 text-sm text-muted-foreground">평가: {media.evaluation}</p> : null}
            {media.relationNote ? <p className="mt-2 text-sm text-muted-foreground">연결 설명: {media.relationNote}</p> : null}
          </section>

          <MediaPropertiesPanel media={media} />
        </div>
      )}
      railDefaultLens="source"
    />
  );
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}
