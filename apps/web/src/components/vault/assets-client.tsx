"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";

import { AssetCard } from "@/components/vault/asset-card";
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
import type { AssetMock } from "@/lib/mock/vault";
import { ASSET_CATEGORY_OPTIONS, ASSET_CONDITION_OPTIONS, ASSET_PROPERTY_DEFINITIONS } from "@/lib/properties/asset";
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
import { useVaultStore } from "@/stores/use-vault-store";

type AssetsClientProps = {
  initialAssets: AssetMock[];
  savedViews: SavedView[];
};

const ASSET_VIEW_FILTER_KEYS = ["category", "condition"];
const ASSET_COLUMNS: CollectionColumnDefinition[] = [
  ...ASSET_PROPERTY_DEFINITIONS
    .filter((definition) => definition.defaultVisibleInList && definition.field !== "name")
    .map((definition) => ({
      key: definition.field,
      label: definition.label,
      defaultVisible: true,
    })),
  { key: "modelName", label: "모델명" },
  { key: "acquiredDate", label: "취득일" },
  { key: "acquiredPrice", label: "취득가" },
  { key: "notes", label: "메모" },
  { key: "sourceDocument", label: "원본 속성" },
];

export function AssetsClient({ initialAssets, savedViews }: AssetsClientProps) {
  const searchParams = useSearchParams();
  const [assets, setAssets] = useState(initialAssets);
  const replaceAssets = useVaultStore((state) => state.replaceAssets);
  const initialActiveViewKey = searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "all";
  const initialActiveView = savedViews.find((view) => getSavedViewKey(view) === initialActiveViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(initialActiveViewKey);
  const [query, setQuery] = useState(initialActiveView?.searchQuery ?? "");
  const [categoryFilter, setCategoryFilter] = useState(typeof initialActiveView?.filterState.category === "string" ? initialActiveView.filterState.category : "");
  const [conditionFilter, setConditionFilter] = useState<string[]>(() => asStringArray(initialActiveView?.filterState.condition));
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = isPersistedSavedView(activeView);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(initialActiveView?.sortState.columns, ASSET_COLUMNS));
  const viewAssets = activeView ? assets.filter((asset) => assetMatchesSavedView(asset, activeView)) : assets;
  const visibleAssets = viewAssets.filter((asset) => {
    if (categoryFilter && asset.category !== categoryFilter) return false;
    if (conditionFilter.length && !conditionFilter.includes(asset.condition)) return false;
    if (query && !assetSearchText(asset).includes(query.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  useEffect(() => {
    setAssets(initialAssets);
    replaceAssets(initialAssets);
  }, [initialAssets, replaceAssets]);

  function setAssetsLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/vault/assets?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, ASSET_COLUMNS));
    setCategoryFilter(typeof view.filterState.category === "string" ? view.filterState.category : "");
    setConditionFilter(asStringArray(view.filterState.condition));
    setQuery(view.searchQuery);
    setAssetsLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = { ...(activeView?.filterState ?? {}) };
    ASSET_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (categoryFilter) filterState.category = categoryFilter;
    if (conditionFilter.length) filterState.condition = conditionFilter;

    return {
      domain: "assets",
      scope: "inventory",
      name: name ?? activeView?.name ?? "자산 뷰",
      icon: activeView?.icon ?? "package",
      searchQuery: query.trim(),
      filterState,
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 자산 뷰 이름", query.trim() || activeView?.name || "자산 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "asset-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setAssetsLocation(viewKey);
      toast.success("자산 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("자산 뷰 저장에 실패했습니다.", {
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
      toast.error("자산 뷰 업데이트에 실패했습니다.", {
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
      "현재 조건으로 자산 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "asset-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "package",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, ASSET_COLUMNS));
      setCategoryFilter(typeof view.filterState.category === "string" ? view.filterState.category : "");
      setConditionFilter(asStringArray(view.filterState.condition));
      setQuery(view.searchQuery);
      setAssetsLocation(viewKey);
      toast.success("자산 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("자산 뷰 복제에 실패했습니다.", {
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
      setVisibleColumnKeys(savedViewColumnKeys(nextView?.sortState.columns, ASSET_COLUMNS));
      setCategoryFilter(typeof nextView?.filterState.category === "string" ? nextView.filterState.category : "");
      setConditionFilter(asStringArray(nextView?.filterState.condition));
      setQuery(nextView?.searchQuery ?? "");
      setAssetsLocation(nextViewKey);
      toast.success("자산 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("자산 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  return (
    <section className="space-y-4">
      <GlassCard>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">자산</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">장비 & 수집품</h1>
          </div>
          <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
            표시 {visibleAssets.length}개 / 전체 {assets.length}개
          </span>
        </div>
      </GlassCard>

      <SavedViewTabs activeViewKey={activeViewKey} basePath="/vault/assets" onSelect={selectSavedView} views={localSavedViews} />

      <FilterBar
        key={activeViewKey}
        filters={[
          { kind: "select", key: "category", label: "분류", options: ASSET_CATEGORY_OPTIONS },
          { kind: "multi", key: "condition", label: "상태", options: ASSET_CONDITION_OPTIONS },
        ]}
        initialFilters={{ category: categoryFilter, condition: conditionFilter }}
        initialQuery={query}
        onChange={(state) => {
          setQuery(state.q);
          setCategoryFilter(typeof state.filters.category === "string" ? state.filters.category : "");
          setConditionFilter(Array.isArray(state.filters.condition) ? state.filters.condition : []);
        }}
        rightSlot={
          <>
            <CollectionColumnControls columns={ASSET_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/8"
              onClick={() => setViewManagerOpen((open) => !open)}
              type="button"
            >
              <Settings2 className="h-4 w-4" />
              뷰 관리
            </button>
          </>
        }
        searchPlaceholder="자산명, 브랜드, 모델, 메모 검색"
        syncUrl={false}
      />

      {viewManagerOpen ? (
        <SavedViewManager
          activeViewKey={activeViewKey}
          createCurrentLabel={activeViewIsPersisted ? "현재 상태 새 뷰" : "편집본 만들기"}
          mutationId={viewMutationId}
          onCreateCurrent={() => void createSavedViewFromCurrent(activeViewIsPersisted ? undefined : `${activeView?.name ?? "자산 뷰"} 편집본`)}
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

      {visibleAssets.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleAssets.map((asset) => <AssetCard asset={asset} key={asset.id} visibleFields={visibleColumnKeys} />)}
        </div>
      ) : (
        <EmptyState description="검색어나 저장 뷰 조건을 조정해보세요." title="표시할 자산이 없습니다" />
      )}
    </section>
  );
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function assetMatchesSavedView(asset: AssetMock, view: SavedView) {
  const category = typeof view.filterState.category === "string" ? view.filterState.category : "";
  const conditions = asStringArray(view.filterState.condition);
  const searchQuery = view.searchQuery.trim().toLowerCase();

  if (category && asset.category !== category) return false;
  if (conditions.length && !conditions.includes(asset.condition)) return false;
  if (searchQuery && !assetSearchText(asset).includes(searchQuery)) return false;
  return true;
}

function assetSearchText(asset: AssetMock) {
  return [asset.name, asset.brand, asset.condition, asset.category, asset.modelName, asset.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
