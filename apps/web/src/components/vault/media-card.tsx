import Link from "next/link";

import { Tag } from "@/components/shared/tag";
import { GlassCard } from "@/components/shared/glass-card";
import type { MediaMock } from "@/lib/mock/vault";
import { MEDIA_STATUS_OPTIONS, MEDIA_TYPE_OPTIONS } from "@/lib/properties/media";
import { optionLabel } from "@/lib/properties/types";

type MediaCardProps = {
  item: MediaMock;
  actionLabel?: string;
  onCycleStatus: () => void;
  disabled?: boolean;
  visibleFields?: string[];
};

export function MediaCard({ item, actionLabel, onCycleStatus, disabled, visibleFields = DEFAULT_VISIBLE_FIELDS }: MediaCardProps) {
  const isVisible = (field: string) => visibleFields.includes(field);
  const metaItems = [
    isVisible("platformOrPublisher") && item.platformOrPublisher ? ["플랫폼/출판사", item.platformOrPublisher] : null,
    isVisible("genre") && item.genre ? ["장르", item.genre] : null,
    isVisible("rating") && item.rating ? ["평점", `${item.rating}`] : null,
    isVisible("rewatchValue") && item.rewatchValue ? ["다시 볼 가치", "있음"] : null,
    isVisible("sourceDocument") && item.sourceDocument ? ["원본 속성", `${item.sourceDocument.properties.length}개`] : null,
  ].filter((item): item is [string, string] => Boolean(item));

  return (
    <GlassCard className="p-5" interactive>
      <Link className="block hover:opacity-95" href={`/vault/media/${item.id}`} scroll={false}>
        <div className="aspect-[4/3] rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(212,175,55,0.14),rgba(94,140,255,0.12),rgba(255,255,255,0.05))]" />
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl text-foreground">{item.title}</h3>
            {isVisible("creator") ? <p className="mt-1 text-sm text-muted-foreground">{item.creator}</p> : null}
          </div>
          {isVisible("mediaType") ? <Tag value={optionLabel(MEDIA_TYPE_OPTIONS, item.mediaType, item.mediaType)} variant="custom" /> : null}
        </div>
        {metaItems.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {metaItems.map(([label, value]) => (
          <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[11px] text-muted-foreground" key={label}>
                {label}: <span className="text-foreground">{value}</span>
              </span>
            ))}
          </div>
        ) : null}
      </Link>
      <div className="mt-4 flex items-center justify-between gap-3">
        {isVisible("status") ? <Tag value={optionLabel(MEDIA_STATUS_OPTIONS, item.status, item.status)} variant="status" /> : <span />}
        <button
          className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] text-primary hover:bg-primary/15"
          disabled={disabled}
          onClick={onCycleStatus}
          type="button"
        >
          {actionLabel ?? "상태 순환"}
        </button>
      </div>
    </GlassCard>
  );
}

const DEFAULT_VISIBLE_FIELDS = ["creator", "mediaType", "platformOrPublisher", "genre", "status", "rating", "sourceDocument"];
