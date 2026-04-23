"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { MediaCard } from "@/components/vault/media-card";
import { MediaMasonry } from "@/components/vault/media-masonry";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

export function MediaClient() {
  const [isPending, startTransition] = useTransition();
  const media = useVaultStore((state) => state.media);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const visibleItems = media.filter((item) => {
    if (typeFilter && item.mediaType !== typeFilter) return false;
    if (query && !`${item.title} ${item.creator} ${item.review}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Vault Media</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">통합 미디어 갤러리</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">게임, 책, 영상 기록을 하나의 서가처럼 모아두고 상태 전환과 상세 Drawer를 바로 이어갑니다.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {visibleItems.length} items
          </span>
        </div>
      </GlassCard>

      <FilterBar
        filters={[
          {
            kind: "select",
            key: "mediaType",
            label: "Type",
            options: [
              { value: "game", label: "Games" },
              { value: "book", label: "Books" },
              { value: "screen", label: "Screens" },
            ],
          },
        ]}
        onChange={(state) => {
          setQuery(state.q);
          setTypeFilter(typeof state.filters.mediaType === "string" ? state.filters.mediaType : "");
        }}
        searchPlaceholder="제목, 창작자, 리뷰 키워드 검색"
      />

      {visibleItems.length ? (
        <MediaMasonry
          items={visibleItems}
          renderCard={(item) => (
            <MediaCard
              actionLabel={item.status}
              disabled={isPending}
              item={item}
              onCycleStatus={() => {
                startTransition(async () => {
                  try {
                    await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
                      `/api/vault/media/${item.id}/cycle-status`,
                      undefined,
                      replaceSnapshot,
                    );
                    toast.success(`${item.title} 상태를 변경했습니다.`);
                  } catch (error) {
                    toast.error("미디어 상태 변경에 실패했습니다.", {
                      description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                    });
                  }
                });
              }}
            />
          )}
        />
      ) : (
        <EmptyState description="제목, 창작자, 타입 필터를 다시 조정해보세요." illustration="generic" title="이 조건에 맞는 미디어가 없습니다" />
      )}
    </section>
  );
}
