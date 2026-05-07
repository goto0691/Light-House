"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";

import { MediaCard } from "@/components/vault/media-card";
import { MediaMasonry } from "@/components/vault/media-masonry";
import {
  CollectionColumnControls,
  savedViewColumnKeys,
  type CollectionColumnDefinition,
} from "@/components/shared/collection-column-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import type { MediaMock } from "@/lib/mock/vault";
import { MEDIA_PROPERTY_DEFINITIONS, MEDIA_STATUS_OPTIONS, MEDIA_TYPE_OPTIONS } from "@/lib/properties/media";
import { optionLabel } from "@/lib/properties/types";
import {
  createSavedViewClient,
  deleteSavedViewClient,
  getDefaultSavedViewKey,
  getSavedViewKey,
  isPersistedSavedView,
  listSavedViewsClient,
  slugifySavedViewKey,
  updateSavedViewClient,
} from "@/lib/saved-view-client";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import type { SavedView } from "@/lib/server/ui-state";
import { useVaultStore } from "@/stores/use-vault-store";

type MediaClientProps = {
  savedViews: SavedView[];
};

const MEDIA_VIEW_FILTER_KEYS = ["mediaType", "status", "rewatchValue"];
const MEDIA_CARD_COLUMNS: CollectionColumnDefinition[] = [
  ...MEDIA_PROPERTY_DEFINITIONS
    .filter((definition) => definition.defaultVisibleInList && definition.field !== "title")
    .map((definition) => ({
      key: definition.field,
      label: definition.label,
      defaultVisible: definition.field !== "rewatchValue",
    })),
  { key: "sourceDocument", label: "원본 속성", defaultVisible: true },
];

export function MediaClient({ savedViews }: MediaClientProps) {
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const media = useVaultStore((state) => state.media);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(() => searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = isPersistedSavedView(activeView);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(activeView?.sortState.columns, MEDIA_CARD_COLUMNS));

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  const viewItems = activeView ? media.filter((item) => mediaMatchesSavedView(item, activeView)) : media;
  const visibleItems = viewItems.filter((item) => {
    if (typeFilter && item.mediaType !== typeFilter) return false;
    if (statusFilter.length && !statusFilter.includes(item.status)) return false;
    if (query && !`${item.title} ${item.creator} ${item.review} ${item.genre ?? ""} ${item.platformOrPublisher ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const propertyCount = visibleItems.filter((item) => item.sourceDocument).length;

  function setMediaLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/vault/media?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, MEDIA_CARD_COLUMNS));
    setMediaLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = { ...(activeView?.filterState ?? {}) };
    MEDIA_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (typeFilter) filterState.mediaType = typeFilter;
    if (statusFilter.length) filterState.status = statusFilter;

    return {
      domain: "media",
      scope: "items",
      name: name ?? activeView?.name ?? "미디어 뷰",
      icon: activeView?.icon ?? "clapperboard",
      searchQuery: query.trim(),
      filterState,
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 미디어 뷰 이름", query.trim() || activeView?.name || "미디어 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "media-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setMediaLocation(viewKey);
      toast.success("미디어 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("미디어 뷰 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function patchSavedView(view: SavedView, input: Partial<SavedView>, successMessage: string) {
    if (!isPersistedSavedView(view)) return;
    setViewMutationId(view.id);
    try {
      const views = await updateSavedViewClient(view.id, {
        name: input.name ?? view.name,
        icon: input.icon === undefined ? view.icon : input.icon,
        searchQuery: input.searchQuery ?? view.searchQuery,
        filterState: input.filterState ?? view.filterState,
        sortState: input.sortState ?? view.sortState,
        viewKey: input.viewKey ?? getSavedViewKey(view),
        isDefault: input.isDefault ?? view.isDefault,
        displayOrder: input.displayOrder ?? view.displayOrder,
      });
      setLocalSavedViews(views);
      toast.success(successMessage);
    } catch (error) {
      toast.error("미디어 뷰 업데이트에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  async function renameSavedView(view: SavedView) {
    const nextName = (viewRenameDrafts[view.id] ?? view.name).trim();
    if (!nextName || nextName === view.name) return;
    await patchSavedView(view, { name: nextName }, "뷰 이름을 바꿨습니다.");
  }

  async function overwriteSavedView(view: SavedView) {
    if (!isPersistedSavedView(view)) return;
    const nextName = (viewRenameDrafts[view.id] ?? view.name).trim() || view.name;
    await patchSavedView(
      view,
      {
        ...buildSavedViewPayload(nextName),
        viewKey: getSavedViewKey(view),
        isDefault: view.isDefault,
        displayOrder: view.displayOrder,
      },
      "현재 조건으로 미디어 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "media-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "clapperboard",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setMediaLocation(viewKey);
      toast.success("미디어 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("미디어 뷰 복제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  async function deleteSavedViewFromManager(view: SavedView) {
    if (!isPersistedSavedView(view) || !window.confirm(`"${view.name}" 뷰를 삭제할까요?`)) return;
    setViewMutationId(view.id);
    try {
      await deleteSavedViewClient(view.id);
      const views = await listSavedViewsClient(view.domain, view.scope);
      const nextViewKey = activeViewKey === getSavedViewKey(view) ? getDefaultSavedViewKey(views) ?? "all" : activeViewKey;
      setLocalSavedViews(views);
      setActiveViewKeyState(nextViewKey);
      setVisibleColumnKeys(savedViewColumnKeys(views.find((item) => getSavedViewKey(item) === nextViewKey)?.sortState.columns, MEDIA_CARD_COLUMNS));
      setMediaLocation(nextViewKey);
      toast.success("미디어 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("미디어 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">Vault Media</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">통합 미디어 갤러리</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">게임, 책, 영상 기록을 하나의 서가처럼 모아두고 상태 전환과 상세 Drawer를 바로 이어갑니다.</p>
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 xl:min-w-[360px]">
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2">표시 {visibleItems.length}개</span>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2">전체 {media.length}개</span>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2">원본 속성 {propertyCount}개</span>
          </div>
        </div>
      </GlassCard>

      <SavedViewTabs activeViewKey={activeViewKey} basePath="/vault/media" onSelect={selectSavedView} views={localSavedViews} />

      <FilterBar
        filters={[
          {
            kind: "select",
            key: "mediaType",
            label: "타입",
            options: MEDIA_TYPE_OPTIONS,
          },
          {
            kind: "multi",
            key: "status",
            label: "상태",
            options: MEDIA_STATUS_OPTIONS,
          },
        ]}
        onChange={(state) => {
          setQuery(state.q);
          setTypeFilter(typeof state.filters.mediaType === "string" ? state.filters.mediaType : "");
          setStatusFilter(Array.isArray(state.filters.status) ? state.filters.status : []);
        }}
        rightSlot={
          <>
            <CollectionColumnControls columns={MEDIA_CARD_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-white/8"
              onClick={() => setViewManagerOpen((open) => !open)}
              type="button"
            >
              <Settings2 className="h-4 w-4" />
              뷰 관리
            </button>
          </>
        }
        searchPlaceholder="제목, 창작자, 리뷰 키워드 검색"
      />

      {viewManagerOpen ? (
        <SavedViewManager
          activeViewKey={activeViewKey}
          createCurrentLabel={activeViewIsPersisted ? "현재 상태 새 뷰" : "편집본 만들기"}
          mutationId={viewMutationId}
          onCreateCurrent={() => void createSavedViewFromCurrent(activeViewIsPersisted ? undefined : `${activeView?.name ?? "미디어 뷰"} 편집본`)}
          onDelete={(view) => void deleteSavedViewFromManager(view)}
          onDuplicate={(view) => void duplicateSavedView(view)}
          onMakeDefault={(view) => void makeSavedViewDefault(view)}
          onOverwrite={(view) => void overwriteSavedView(view)}
          onRename={(view) => void renameSavedView(view)}
          onRenameDraftChange={(viewId, name) => setViewRenameDrafts((current) => ({ ...current, [viewId]: name }))}
          renameDrafts={viewRenameDrafts}
          views={localSavedViews}
        />
      ) : null}

      {visibleItems.length ? (
        <MediaMasonry
          items={visibleItems}
          renderCard={(item) => (
            <MediaCard
              actionLabel={optionLabel(MEDIA_STATUS_OPTIONS, item.status, item.status)}
              disabled={isPending}
              item={item}
              visibleFields={visibleColumnKeys}
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
