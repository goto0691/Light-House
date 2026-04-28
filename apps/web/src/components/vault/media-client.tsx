"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { MediaCard } from "@/components/vault/media-card";
import { MediaMasonry } from "@/components/vault/media-masonry";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import type { MediaMock } from "@/lib/mock/vault";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import type { SavedView } from "@/lib/server/ui-state";
import { useVaultStore } from "@/stores/use-vault-store";

type MediaClientProps = {
  savedViews: SavedView[];
};

export function MediaClient({ savedViews }: MediaClientProps) {
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const media = useVaultStore((state) => state.media);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const activeViewKey = searchParams.get("view") ?? savedViews.find((view) => view.isDefault)?.viewKey ?? savedViews[0]?.viewKey ?? "all";
  const activeView = savedViews.find((view) => view.viewKey === activeViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];

  const viewItems = activeView ? media.filter((item) => mediaMatchesSavedView(item, activeView)) : media;
  const visibleItems = viewItems.filter((item) => {
    if (typeFilter && item.mediaType !== typeFilter) return false;
    if (statusFilter.length && !statusFilter.includes(item.status)) return false;
    if (query && !`${item.title} ${item.creator} ${item.review} ${item.genre ?? ""} ${item.platformOrPublisher ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const propertyCount = visibleItems.filter((item) => item.sourceDocument).length;

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">Vault Media</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">통합 미디어 갤러리</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">게임, 책, 영상 기록을 하나의 서가처럼 모아두고 상태 전환과 상세 Drawer를 바로 이어갑니다.</p>
          </div>
          <div className="grid gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground sm:grid-cols-3 xl:min-w-[360px]">
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2">{visibleItems.length} visible</span>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2">{media.length} total</span>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2">{propertyCount} properties</span>
          </div>
        </div>
      </GlassCard>

      <SavedViewTabs activeViewKey={activeView?.viewKey ?? activeViewKey} basePath="/vault/media" views={savedViews} />

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
          {
            kind: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "backlog", label: "Backlog" },
              { value: "consuming", label: "Consuming" },
              { value: "completed", label: "Completed" },
              { value: "dropped", label: "Dropped" },
            ],
          },
        ]}
        onChange={(state) => {
          setQuery(state.q);
          setTypeFilter(typeof state.filters.mediaType === "string" ? state.filters.mediaType : "");
          setStatusFilter(Array.isArray(state.filters.status) ? state.filters.status : []);
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

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function mediaMatchesSavedView(item: MediaMock, view: SavedView) {
  const mediaType = typeof view.filterState.mediaType === "string" ? view.filterState.mediaType : "";
  const statuses = asStringArray(view.filterState.status);
  const rewatchValue = typeof view.filterState.rewatchValue === "boolean" ? view.filterState.rewatchValue : null;

  if (mediaType && item.mediaType !== mediaType) return false;
  if (statuses.length && !statuses.includes(item.status)) return false;
  if (rewatchValue !== null && Boolean(item.rewatchValue) !== rewatchValue) return false;
  return true;
}
