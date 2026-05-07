"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  CollectionColumnControls,
  savedViewColumnKeys,
  type CollectionColumnDefinition,
} from "@/components/shared/collection-column-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PropertySummary } from "@/components/shared/properties/property-summary";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import type { PlaceMock } from "@/lib/mock/vault";
import { PLACE_CATEGORY_OPTIONS, PLACE_PROPERTY_DEFINITIONS, PLACE_PROPERTY_GROUPS } from "@/lib/properties/place";
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
import type { SavedView } from "@/lib/server/ui-state";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import { useVaultStore } from "@/stores/use-vault-store";

type PlacesClientProps = {
  savedViews: SavedView[];
};

const PLACE_VIEW_FILTER_KEYS = ["category", "hasReview"];
const PLACE_COLUMNS: CollectionColumnDefinition[] = [
  ...PLACE_PROPERTY_DEFINITIONS
    .filter((definition) => definition.defaultVisibleInList && definition.field !== "name")
    .map((definition) => ({
      key: definition.field,
      label: definition.label,
      defaultVisible: true,
    })),
  { key: "mapUrl", label: "지도 링크" },
  { key: "firstVisitedAt", label: "첫 방문일" },
  { key: "lastVisitedAt", label: "최근 방문일" },
  { key: "visitCount", label: "방문 수" },
  { key: "averageRating", label: "평균 평점" },
  { key: "review", label: "장소 메모" },
  { key: "sourceDocument", label: "원본 속성" },
];

export function PlacesClient({ savedViews }: PlacesClientProps) {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const places = useVaultStore((state) => state.places);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const initialActiveViewKey = searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "all";
  const initialActiveView = savedViews.find((view) => getSavedViewKey(view) === initialActiveViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(initialActiveViewKey);
  const [query, setQuery] = useState(initialActiveView?.searchQuery ?? "");
  const [categoryFilter, setCategoryFilter] = useState(typeof initialActiveView?.filterState.category === "string" ? initialActiveView.filterState.category : "");
  const [reviewFilter, setReviewFilter] = useState(initialActiveView?.filterState.hasReview === true ? "with-review" : "");
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = isPersistedSavedView(activeView);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(initialActiveView?.sortState.columns, PLACE_COLUMNS));
  const viewPlaces = activeView ? places.filter((place) => placeMatchesSavedView(place, activeView)) : places;
  const visiblePlaces = viewPlaces.filter((place) => {
    if (categoryFilter && place.category !== categoryFilter) return false;
    if (reviewFilter === "with-review" && !place.review.trim()) return false;
    if (query && !placeSearchText(place).includes(query.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  function setPlacesLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/vault/places?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, PLACE_COLUMNS));
    setCategoryFilter(typeof view.filterState.category === "string" ? view.filterState.category : "");
    setReviewFilter(view.filterState.hasReview === true ? "with-review" : "");
    setQuery(view.searchQuery);
    setPlacesLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = { ...(activeView?.filterState ?? {}) };
    PLACE_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (categoryFilter) filterState.category = categoryFilter;
    if (reviewFilter === "with-review") filterState.hasReview = true;

    return {
      domain: "places",
      scope: "visits",
      name: name ?? activeView?.name ?? "장소 뷰",
      icon: activeView?.icon ?? "map-pin",
      searchQuery: query.trim(),
      filterState,
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 장소 뷰 이름", query.trim() || activeView?.name || "장소 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "place-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setPlacesLocation(viewKey);
      toast.success("장소 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("장소 뷰 저장에 실패했습니다.", {
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
      toast.error("장소 뷰 업데이트에 실패했습니다.", {
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
      "현재 조건으로 장소 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "place-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "map-pin",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, PLACE_COLUMNS));
      setCategoryFilter(typeof view.filterState.category === "string" ? view.filterState.category : "");
      setReviewFilter(view.filterState.hasReview === true ? "with-review" : "");
      setQuery(view.searchQuery);
      setPlacesLocation(viewKey);
      toast.success("장소 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("장소 뷰 복제에 실패했습니다.", {
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
      const nextView = views.find((item) => getSavedViewKey(item) === nextViewKey);
      setLocalSavedViews(views);
      setActiveViewKeyState(nextViewKey);
      setVisibleColumnKeys(savedViewColumnKeys(nextView?.sortState.columns, PLACE_COLUMNS));
      setCategoryFilter(typeof nextView?.filterState.category === "string" ? nextView.filterState.category : "");
      setReviewFilter(nextView?.filterState.hasReview === true ? "with-review" : "");
      setQuery(nextView?.searchQuery ?? "");
      setPlacesLocation(nextViewKey);
      toast.success("장소 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("장소 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <GlassCard>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs tracking-[0.08em] text-primary">장소</p>
              <h1 className="mt-3 text-3xl font-semibold">장소 & 방문 기록</h1>
            </div>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
              표시 {visiblePlaces.length}개 / 전체 {places.length}개
            </span>
          </div>
        </GlassCard>

        <SavedViewTabs activeViewKey={activeViewKey} basePath="/vault/places" onSelect={selectSavedView} views={localSavedViews} />

        <FilterBar
          key={activeViewKey}
          filters={[
            { kind: "select", key: "category", label: "분류", options: PLACE_CATEGORY_OPTIONS },
            { kind: "select", key: "reviewState", label: "메모", options: [{ value: "with-review", label: "메모 있음" }] },
          ]}
          initialFilters={{ category: categoryFilter, reviewState: reviewFilter }}
          initialQuery={query}
          onChange={(state) => {
            setQuery(state.q);
            setCategoryFilter(typeof state.filters.category === "string" ? state.filters.category : "");
            setReviewFilter(typeof state.filters.reviewState === "string" ? state.filters.reviewState : "");
          }}
          rightSlot={
            <>
              <CollectionColumnControls columns={PLACE_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
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
          searchPlaceholder="장소명, 주소, 메모 검색"
          syncUrl={false}
        />

        {viewManagerOpen ? (
          <SavedViewManager
            activeViewKey={activeViewKey}
            createCurrentLabel={activeViewIsPersisted ? "현재 상태 새 뷰" : "편집본 만들기"}
            mutationId={viewMutationId}
            onCreateCurrent={() => void createSavedViewFromCurrent(activeViewIsPersisted ? undefined : `${activeView?.name ?? "장소 뷰"} 편집본`)}
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

        <div className="space-y-3">
          {visiblePlaces.length ? (
            visiblePlaces.map((place) => {
              const definitions = PLACE_PROPERTY_DEFINITIONS.filter((definition) => definition.field !== "name" && visibleColumnKeys.includes(definition.field));
              return (
                <div className="block rounded-lg border border-white/10 bg-white/5 p-4" key={place.id}>
                  <Link className="block" href={`/vault/places/${place.id}`}>
                    <p className="text-sm font-medium text-foreground">{place.name}</p>
                    <PropertySummary
                      className="mt-3"
                      definitions={definitions}
                      groups={PLACE_PROPERTY_GROUPS}
                      mode="all"
                      record={place}
                      showGroupLabels={false}
                      showTitle={false}
                    />
                    {visibleColumnKeys.includes("sourceDocument") && place.sourceDocument ? (
                      <span className="mt-3 inline-flex rounded-md border border-white/10 bg-black/10 px-2.5 py-1 text-[11px] text-muted-foreground">
                        원본 속성 {place.sourceDocument.properties.length}개
                      </span>
                    ) : null}
                  </Link>
                  {visibleColumnKeys.includes("review") ? (
                    <>
                      <p className="mt-4 text-[11px] tracking-[0.08em] text-muted-foreground">장소 메모</p>
                      <textarea
                        className="mt-3 min-h-[90px] w-full resize-none rounded-md border border-white/10 bg-black/10 p-3 text-sm text-foreground outline-none"
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
                    </>
                  ) : null}
                </div>
              );
            })
          ) : (
            <EmptyState description="검색어나 저장 뷰 조건을 조정해보세요." title="표시할 장소가 없습니다" />
          )}
        </div>
      </div>

      <GlassCard>
        <p className="text-xs tracking-[0.08em] text-primary">지도</p>
        <div className="mt-4 flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/5 text-sm text-muted-foreground">
          지도 연동은 Cloudflare/D1 뒤 단계에서 연결합니다.
        </div>
      </GlassCard>
    </section>
  );
}

function placeMatchesSavedView(place: PlaceMock, view: SavedView) {
  const category = typeof view.filterState.category === "string" ? view.filterState.category : "";
  const searchQuery = view.searchQuery.trim().toLowerCase();

  if (category && place.category !== category) return false;
  if (view.filterState.hasReview === true && !place.review.trim()) return false;
  if (searchQuery && !placeSearchText(place).includes(searchQuery)) return false;
  return true;
}

function placeSearchText(place: PlaceMock) {
  return [place.name, place.category, place.address, place.review].filter(Boolean).join(" ").toLowerCase();
}
