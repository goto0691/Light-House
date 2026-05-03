"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Save, Trash2, Workflow } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ContextBundlePanel } from "@/components/shared/context/context-bundle-panel";
import { ContextMapMini } from "@/components/shared/context/context-map-mini";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterState } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import { ZettelCard } from "@/components/vault/zettel-card";
import { ZettelReaderPane } from "@/components/vault/zettel-reader-pane";
import {
  DOCUMENT_KIND_OPTIONS,
  ZETTEL_REVIEW_CADENCE_OPTIONS,
  ZETTEL_SOURCE_RELIABILITY_OPTIONS,
  ZETTEL_STATUS_OPTIONS,
  ZETTEL_TYPE_OPTIONS,
} from "@/components/vault/zettel-form";
import type { ZettelMock } from "@/lib/mock/vault";
import { postSnapshotMutation } from "@/lib/snapshot-client";
import type { SavedView } from "@/lib/server/ui-state";
import { getZettelSearchText, normalizeZettelDocumentKind } from "@/lib/vault/zettel-properties";
import { useVaultStore } from "@/stores/use-vault-store";

type ZettelsClientProps = {
  savedViews: SavedView[];
  selectedZettelId?: string;
};

const LIST_PAGE_SIZE = 40;
const ZETTEL_VIEW_FILTER_KEYS = [
  "kind",
  "documentKind",
  "type",
  "status",
  "sourceReliability",
  "reviewCadence",
  "category",
  "tags",
  "property",
  "sourceProperty",
];

export function ZettelsClient({ savedViews, selectedZettelId }: ZettelsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const zettels = useVaultStore((state) => state.zettels);
  const storeSelectedZettelId = useVaultStore((state) => state.selectedZettelId);
  const selectZettel = useVaultStore((state) => state.selectZettel);
  const replaceSnapshot = useVaultStore((state) => state.replaceSnapshot);
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [documentKindFilter, setDocumentKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceReliabilityFilter, setSourceReliabilityFilter] = useState("");
  const [reviewCadenceFilter, setReviewCadenceFilter] = useState("");
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [propertyTags, setPropertyTags] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState("updated-desc");
  const [contextRefreshKey, setContextRefreshKey] = useState(0);
  const [creatingDraftOpen, setCreatingDraftOpen] = useState(false);
  const isCreating = creatingDraftOpen || searchParams.get("new") === "1";
  const activeViewKey = searchParams.get("view") ?? getSavedViewKey(localSavedViews.find((view) => view.isDefault)) ?? getSavedViewKey(localSavedViews[0]) ?? "all";
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKey) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewIsPersisted = Boolean(activeView && !activeView.id.startsWith("default-"));
  const resolvedSelectedId = selectedZettelId ?? storeSelectedZettelId;
  const filterKey = [
    activeViewKey,
    query,
    typeFilter,
    documentKindFilter,
    statusFilter,
    sourceReliabilityFilter,
    reviewCadenceFilter,
    categoryTags.join("|"),
    propertyTags.join("|"),
    sortKey,
  ].join("\u0000");
  const [visiblePage, setVisiblePage] = useState({ key: filterKey, limit: LIST_PAGE_SIZE });
  const visibleLimit = visiblePage.key === filterKey ? visiblePage.limit : LIST_PAGE_SIZE;

  const viewZettels = activeView ? zettels.filter((item) => zettelMatchesSavedView(item, activeView)) : zettels;
  const visibleZettels = sortZettels(viewZettels.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (documentKindFilter && normalizeZettelDocumentKind(item.documentKind) !== documentKindFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (sourceReliabilityFilter && getSourceReliabilityValue(item) !== sourceReliabilityFilter) return false;
    if (reviewCadenceFilter && getReviewCadenceValue(item) !== reviewCadenceFilter) return false;
    if (categoryTags.length && !categoryTags.some((tag) => getCategorySearchText(item).includes(tag.toLowerCase()))) return false;
    if (propertyTags.length && !propertyTags.every((tag) => getSourcePropertySearchText(item).includes(tag.toLowerCase()))) return false;
    if (query && !getZettelSearchText(item).includes(query.toLowerCase())) return false;
    return true;
  }), sortKey);
  const selected = isCreating ? null : zettels.find((item) => item.id === resolvedSelectedId) ?? visibleZettels[0] ?? zettels[0];
  const listedZettels = visibleZettels.slice(0, visibleLimit);
  const categoryOptions = useMemo(() => Array.from(new Set(zettels.map((zettel) => zettel.category).filter(Boolean))).sort(), [zettels]);
  const categorySuggestions = useMemo(() => buildCategorySuggestions(zettels), [zettels]);
  const sourcePropertySuggestions = useMemo(() => buildSourcePropertySuggestions(zettels), [zettels]);
  const filterBarInitialFilters = useMemo(() => getFilterBarInitialFilters(activeView), [activeView]);

  useEffect(() => {
    if (!selected?.id) return;
    if (storeSelectedZettelId !== selected.id) selectZettel(selected.id);
  }, [selectZettel, selected?.id, storeSelectedZettelId]);

  function openZettel(id: string) {
    setCreatingDraftOpen(false);
    selectZettel(id);
    router.push(`/vault/zettels/${id}`);
  }

  function openNewZettel() {
    setCreatingDraftOpen(true);
    router.push("/vault/zettels?new=1");
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = {
      ...(activeView?.filterState ?? {}),
    };
    ZETTEL_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (typeFilter) filterState.type = [typeFilter];
    if (documentKindFilter) filterState.documentKind = [documentKindFilter];
    if (statusFilter) filterState.status = [statusFilter];
    if (sourceReliabilityFilter) filterState.sourceReliability = [sourceReliabilityFilter];
    if (reviewCadenceFilter) filterState.reviewCadence = [reviewCadenceFilter];
    if (categoryTags.length) filterState.category = categoryTags;
    if (propertyTags.length) filterState.property = propertyTags;

    return {
      domain: "library",
      scope: "knowledge",
      name: name ?? activeView?.name ?? "Zettel View",
      icon: activeView?.icon ?? "library",
      searchQuery: query.trim(),
      filterState,
      sortState: { key: sortKey || getSavedViewSortKey(activeView) || "updated-desc" },
    };
  }

  async function saveCurrentView() {
    const name = window.prompt("저장할 조회 이름", query.trim() || activeView?.name || "Zettel View");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifyViewKey(name)}-${Date.now().toString(36)}`;
      const response = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildSavedViewPayload(name),
          viewKey,
          displayOrder: localSavedViews.length,
        }),
      });
      const payload = (await response.json()) as { views?: SavedView[]; error?: string };
      if (!response.ok || !payload.views) throw new Error(payload.error ?? "Saved view 저장에 실패했습니다.");
      setLocalSavedViews(payload.views);
      router.push(`/vault/zettels?view=${encodeURIComponent(viewKey)}`);
      toast.success("현재 조회를 저장했습니다.");
    } catch (error) {
      toast.error("Saved view 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function updateActiveView() {
    if (!activeView || !activeViewIsPersisted) return;
    try {
      const response = await fetch(`/api/saved-views/${activeView.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildSavedViewPayload(),
          viewKey: getSavedViewKey(activeView),
          displayOrder: activeView.displayOrder,
        }),
      });
      const payload = (await response.json()) as { views?: SavedView[]; error?: string };
      if (!response.ok || !payload.views) throw new Error(payload.error ?? "Saved view 업데이트에 실패했습니다.");
      setLocalSavedViews(payload.views);
      toast.success("Saved view를 업데이트했습니다.");
    } catch (error) {
      toast.error("Saved view 업데이트에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function deleteActiveView() {
    if (!activeView || !activeViewIsPersisted || !window.confirm(`"${activeView.name}" saved view를 삭제할까요?`)) return;
    try {
      const response = await fetch(`/api/saved-views/${activeView.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Saved view 삭제에 실패했습니다.");
      const refreshed = await fetch("/api/saved-views?domain=library&scope=knowledge", { cache: "no-store" });
      const refreshedPayload = (await refreshed.json()) as { views?: SavedView[]; error?: string };
      if (!refreshed.ok || !refreshedPayload.views) throw new Error(refreshedPayload.error ?? "Saved view 목록을 다시 불러오지 못했습니다.");
      setLocalSavedViews(refreshedPayload.views);
      router.push("/vault/zettels");
      toast.success("Saved view를 삭제했습니다.");
    } catch (error) {
      toast.error("Saved view 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  function deleteSelected() {
    if (!selected || !window.confirm(`"${selected.title}" 메모를 삭제할까요?`)) return;
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/vault/zettels/${selected.id}/delete`,
          undefined,
          replaceSnapshot,
        );
        toast.success("Zettel을 삭제했습니다.");
        router.push("/vault/zettels");
      } catch (error) {
        toast.error("메모 삭제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  if (!zettels.length && !isCreating) {
    return (
      <EmptyState
        cta={{ label: "첫 Zettel 쓰기", hotkey: "Cmd+N", onClick: () => router.push("/vault/zettels?new=1") }}
        description="생각은 쓰는 순간 연결을 얻습니다. 첫 메모를 만들어 Vault에 불을 켜보세요."
        illustration="zettel"
        title="첫 번째 원석을 던져보세요"
      />
    );
  }

  const contextPanel =
    selected && !isCreating ? (
      <ContextBundlePanel
        density="drawer"
        entityId={selected.id}
        entityType="zettel"
        mainSlot={(bundle) => <ContextMapMini bundle={bundle} />}
        railDefaultLens="zettels"
        refreshKey={`${selected.id}:${contextRefreshKey}`}
      />
    ) : null;
  const bodyGridClassName = isCreating
    ? "grid gap-4"
    : "grid gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]";

  return (
    <PageLayout>
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            {!isCreating ? (
              <button className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={openNewZettel} type="button">
                <Plus className="h-4 w-4" />
                새 메모
              </button>
            ) : null}
            <Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition hover:bg-white/8" href="/vault/zettels/graph">
              <Workflow className="h-4 w-4" />
              Graph
            </Link>
            <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {visibleZettels.length} notes
            </span>
          </div>
        }
        description="메모를 고르고, 읽고, 고치는 흐름을 한 화면에서 이어갑니다."
        eyebrow="Vault"
        title="Zettelkasten"
      />

      {!isCreating ? (
        <PageToolbar>
          <SavedViewTabs activeViewKey={getSavedViewKey(activeView) ?? activeViewKey} basePath="/vault/zettels" views={localSavedViews} />
          <FilterBar
            key={activeViewKey}
            filters={[
              { kind: "select", key: "type", label: "Type", options: ZETTEL_TYPE_OPTIONS },
              { kind: "select", key: "documentKind", label: "Kind", options: DOCUMENT_KIND_OPTIONS },
              { kind: "select", key: "status", label: "Status", options: ZETTEL_STATUS_OPTIONS },
              { kind: "select", key: "sourceReliability", label: "Reliability", options: ZETTEL_SOURCE_RELIABILITY_OPTIONS },
              { kind: "select", key: "reviewCadence", label: "Review", options: ZETTEL_REVIEW_CADENCE_OPTIONS },
              { kind: "tag", key: "category", label: "Category tag", suggestions: categorySuggestions },
              { kind: "tag", key: "property", label: "Property search", suggestions: sourcePropertySuggestions },
            ]}
            onChange={(state) => {
              setQuery(state.q);
              setTypeFilter(typeof state.filters.type === "string" ? state.filters.type : "");
              setDocumentKindFilter(typeof state.filters.documentKind === "string" ? state.filters.documentKind : "");
              setStatusFilter(typeof state.filters.status === "string" ? state.filters.status : "");
              setSourceReliabilityFilter(typeof state.filters.sourceReliability === "string" ? state.filters.sourceReliability : "");
              setReviewCadenceFilter(typeof state.filters.reviewCadence === "string" ? state.filters.reviewCadence : "");
              setCategoryTags(Array.isArray(state.filters.category) ? state.filters.category : []);
              setPropertyTags(Array.isArray(state.filters.property) ? state.filters.property : []);
              setSortKey(state.sort ?? "updated-desc");
            }}
            initialFilters={filterBarInitialFilters}
            initialQuery={activeView?.searchQuery}
            initialSort={getSavedViewSortKey(activeView)}
            rightSlot={
              <>
                {activeViewIsPersisted ? (
                  <button
                    className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-white/8"
                    onClick={() => void updateActiveView()}
                    type="button"
                  >
                    <Save className="h-4 w-4" />
                    Update View
                  </button>
                ) : null}
                <button
                  className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-white/8"
                  onClick={() => void saveCurrentView()}
                  type="button"
                >
                  <Save className="h-4 w-4" />
                  Save View
                </button>
                {activeViewIsPersisted ? (
                  <button
                    aria-label="Delete saved view"
                    className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
                    onClick={() => void deleteActiveView()}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </>
            }
            searchPlaceholder="제목, 본문, 태그, 속성 검색"
            sortOptions={[
              { value: "updated-desc", label: "Recently Updated" },
              { value: "created-desc", label: "Recently Created" },
              { value: "title-asc", label: "Title A-Z" },
              { value: "kind-asc", label: "Kind" },
            ]}
          />
        </PageToolbar>
      ) : null}

      <PageBody className="zettels-read-body">
        <div className={bodyGridClassName}>
          {selected || isCreating ? (
            <div className="order-1 min-w-0 xl:order-2">
              <ZettelReaderPane
                categoryOptions={categoryOptions}
                contextRefreshKey={contextRefreshKey}
                isPending={isPending}
                mode={isCreating ? "new" : "existing"}
                onCancelNew={() => {
                  setCreatingDraftOpen(false);
                  router.push("/vault/zettels");
                }}
                onDelete={selected ? deleteSelected : undefined}
                onRelationsChanged={() => setContextRefreshKey((value) => value + 1)}
                onSaved={(zettelId) => {
                  setCreatingDraftOpen(false);
                  selectZettel(zettelId);
                  router.push(`/vault/zettels/${zettelId}`);
                }}
                zettel={selected}
              />
              {contextPanel ? <div className="mt-4">{contextPanel}</div> : null}
            </div>
          ) : (
            <div className="order-1 min-w-0 xl:order-2">
              <EmptyState description="목록에서 메모를 선택하거나 새 메모를 만듭니다." illustration="zettel" title="메모를 선택해 주세요" />
            </div>
          )}

          {!isCreating ? (
            <GlassCard className="order-2 max-h-none xl:order-1 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto" priority="secondary">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-primary">Notes</p>
                  <p className="mt-1 text-xs text-muted-foreground">목록은 읽기와 선택만 담당합니다.</p>
                </div>
                <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {listedZettels.length}/{visibleZettels.length}
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {listedZettels.length ? (
                  listedZettels.map((zettel) => (
                    <ZettelCard key={zettel.id} onSelect={() => openZettel(zettel.id)} selected={selected?.id === zettel.id} zettel={zettel} />
                  ))
                ) : (
                  <EmptyState description="검색어나 필터를 바꾸면 다른 메모들이 다시 나타납니다." illustration="zettel" title="이 조건에 맞는 메모가 없습니다" />
                )}
              </div>
              {visibleLimit < visibleZettels.length ? (
                <button
                  className="focus-ring mt-4 w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground transition hover:bg-white/8"
                  onClick={() =>
                    setVisiblePage((current) => ({
                      key: filterKey,
                      limit: (current.key === filterKey ? current.limit : LIST_PAGE_SIZE) + LIST_PAGE_SIZE,
                    }))
                  }
                  type="button"
                >
                  더 보기
                </button>
              ) : null}
            </GlassCard>
          ) : null}
        </div>
      </PageBody>
    </PageLayout>
  );
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function normalizeFilterValue(value: string) {
  return value.toLowerCase().replaceAll("_", " ").trim();
}

function getSavedViewKey(view: SavedView | null | undefined) {
  return view?.viewKey ?? view?.id ?? null;
}

function getSavedViewSortKey(view: SavedView | null | undefined) {
  const key = view?.sortState.key;
  return typeof key === "string" ? key : undefined;
}

function slugifyViewKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48) || "zettel-view";
}

function getCategorySearchText(item: ZettelMock) {
  return [item.category, item.tags.join(" ")].join(" ").toLowerCase();
}

function getSourcePropertySearchText(item: ZettelMock) {
  return [
    (item.aliases ?? []).join(" "),
    item.sourceReliability ?? "",
    item.reviewCadence ?? "",
    item.reviewDueAt ?? "",
    item.source ?? "",
    item.sourceUrl ?? "",
    item.originalCreatedAt ?? "",
    item.sourceDocument?.sourceDatabase ?? "",
    item.sourceDocument?.url ?? "",
    item.sourceDocument?.documentRole ?? "",
    item.sourceDocument?.status ?? "",
    item.sourceDocument?.properties.flatMap((property) => [property.name, property.value, property.type ?? ""]).join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function buildCategorySuggestions(items: ZettelMock[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    [item.category, ...item.tags].forEach((value) => addSuggestion(counts, value));
  }
  return sortSuggestions(counts, 24);
}

function buildSourcePropertySuggestions(items: ZettelMock[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    (item.aliases ?? []).forEach((alias) => addSuggestion(counts, alias));
    if (item.sourceReliability) addSuggestion(counts, item.sourceReliability);
    if (item.reviewCadence) addSuggestion(counts, item.reviewCadence);
    if (item.reviewDueAt) addSuggestion(counts, item.reviewDueAt);
    if (item.source) addSuggestion(counts, item.source);
    if (item.sourceDocument?.sourceDatabase) addSuggestion(counts, item.sourceDocument.sourceDatabase);
    for (const property of item.sourceDocument?.properties ?? []) {
      addSuggestion(counts, property.name);
      addSuggestion(counts, compactSuggestion(property.value));
    }
  }
  return sortSuggestions(counts, 32);
}

function addSuggestion(counts: Map<string, number>, value: string | null | undefined) {
  const suggestion = compactSuggestion(value ?? "");
  if (!suggestion || suggestion.length < 2) return;
  counts.set(suggestion, (counts.get(suggestion) ?? 0) + 1);
}

function compactSuggestion(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function sortSuggestions(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko-KR"))
    .slice(0, limit)
    .map(([value]) => value);
}

function sortZettels(items: ZettelMock[], sortKey: string) {
  const sorted = [...items];
  if (sortKey === "title-asc") return sorted.sort((left, right) => left.title.localeCompare(right.title, "ko-KR"));
  if (sortKey === "kind-asc") {
    return sorted.sort((left, right) => normalizeZettelDocumentKind(left.documentKind).localeCompare(normalizeZettelDocumentKind(right.documentKind)));
  }
  if (sortKey === "created-desc") {
    return sorted.sort((left, right) => getTimeValue(right.createdAt) - getTimeValue(left.createdAt));
  }
  return sorted.sort((left, right) => Number(right.pinned ?? false) - Number(left.pinned ?? false) || getTimeValue(right.updatedAt ?? right.createdAt) - getTimeValue(left.updatedAt ?? left.createdAt));
}

function getTimeValue(value: string | null | undefined) {
  return value ? new Date(value).getTime() || 0 : 0;
}

function getSourceReliabilityValue(item: ZettelMock) {
  return item.sourceReliability ?? "unknown";
}

function getReviewCadenceValue(item: ZettelMock) {
  return item.reviewCadence ?? "none";
}

function getFilterBarInitialFilters(view: SavedView | null | undefined): FilterState {
  const filterState = view?.filterState ?? {};
  return {
    type: oneSelectValue(filterState.type),
    documentKind: oneSelectValue(filterState.documentKind) || oneSelectValue(filterState.kind),
    status: oneSelectValue(filterState.status),
    sourceReliability: oneSelectValue(filterState.sourceReliability),
    reviewCadence: oneSelectValue(filterState.reviewCadence),
    category: asStringArray(filterState.category),
    property: [...asStringArray(filterState.property), ...asStringArray(filterState.sourceProperty)],
  };
}

function oneSelectValue(value: unknown) {
  const values = asStringArray(value);
  return values.length === 1 ? values[0] : null;
}

function zettelMatchesSavedView(item: ZettelMock, view: SavedView) {
  const kinds = asStringArray(view.filterState.kind).map(normalizeZettelDocumentKind).filter(Boolean);
  const documentKinds = asStringArray(view.filterState.documentKind).map(normalizeZettelDocumentKind).filter(Boolean);
  const statuses = asStringArray(view.filterState.status).map(normalizeFilterValue);
  const types = asStringArray(view.filterState.type).map(normalizeFilterValue);
  const sourceReliabilities = asStringArray(view.filterState.sourceReliability).map(normalizeFilterValue);
  const reviewCadences = asStringArray(view.filterState.reviewCadence).map(normalizeFilterValue);
  const categories = asStringArray(view.filterState.category).map(normalizeFilterValue);
  const tags = asStringArray(view.filterState.tags).map(normalizeFilterValue);
  const propertyTerms = [...asStringArray(view.filterState.property), ...asStringArray(view.filterState.sourceProperty)].map(normalizeFilterValue);
  const itemKind = normalizeZettelDocumentKind(item.documentKind);
  const itemStatus = normalizeFilterValue(item.status ?? "");
  const itemType = normalizeFilterValue(item.type);
  const itemSourceReliability = normalizeFilterValue(getSourceReliabilityValue(item));
  const itemReviewCadence = normalizeFilterValue(getReviewCadenceValue(item));
  const haystack = getZettelSearchText(item);
  const categoryHaystack = getCategorySearchText(item);
  const propertyHaystack = getSourcePropertySearchText(item);
  const viewSearch = normalizeFilterValue(view.searchQuery);

  if (viewSearch && !haystack.includes(viewSearch)) return false;
  if (types.length && !types.includes(itemType)) return false;
  if (kinds.length && !kinds.some((kind) => itemKind === kind || haystack.includes(kind))) return false;
  if (documentKinds.length && !documentKinds.some((kind) => itemKind === kind || haystack.includes(kind))) return false;
  if (statuses.length && !statuses.includes(itemStatus)) return false;
  if (sourceReliabilities.length && !sourceReliabilities.includes(itemSourceReliability)) return false;
  if (reviewCadences.length && !reviewCadences.includes(itemReviewCadence)) return false;
  if (categories.length && !categories.some((category) => categoryHaystack.includes(category))) return false;
  if (tags.length && !tags.every((tag) => item.tags.some((itemTag) => normalizeFilterValue(itemTag).includes(tag)))) return false;
  if (propertyTerms.length && !propertyTerms.every((term) => propertyHaystack.includes(term))) return false;
  if (view.filterState.hasSourceDocument === true && !item.sourceDocument) return false;
  if (view.filterState.hasSourceDocument === false && item.sourceDocument) return false;
  if (view.filterState.hasBacklinks === true && !item.backlinks.length) return false;
  if (view.filterState.hasOutgoingLinks === true && !item.outgoingLinks.length) return false;
  return true;
}
