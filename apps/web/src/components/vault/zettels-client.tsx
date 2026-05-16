"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Save, Settings2, Trash2, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterState } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
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
import type { SavedView } from "@/lib/server/ui-state";
import { mergePagedZettelPage, mergeZettelList, mergeZettelListItems, removeZettelFromList } from "@/lib/vault/zettel-list-state";
import { getZettelSearchText, normalizeZettelDocumentKind } from "@/lib/vault/zettel-properties";
import { useVaultStore } from "@/stores/use-vault-store";

type ZettelsClientProps = {
  deferInitialZettels?: boolean;
  initialSelectedZettel?: ZettelMock | null;
  initialZettels?: ZettelMock[];
  savedViews: SavedView[];
  selectedZettelId?: string;
};

type ZettelListHydrationState = {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  nextOffset?: number | null;
  total: number;
};

type ZettelListIndexItem = {
  zettel: ZettelMock;
  categorySearchText: string;
  createdAtTime: number;
  documentKind: string;
  propertySearchText: string;
  reviewCadence: string;
  reviewCadenceSearchValue: string;
  searchText: string;
  sourceReliability: string;
  sourceReliabilitySearchValue: string;
  status: string;
  statusSearchValue: string;
  tags: string[];
  title: string;
  type: string;
  typeSearchValue: string;
  updatedAtTime: number;
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

export function ZettelsClient({ deferInitialZettels = false, initialSelectedZettel, initialZettels, savedViews, selectedZettelId }: ZettelsClientProps) {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const storeZettels = useVaultStore((state) => state.zettels);
  const storeSelectedZettelId = useVaultStore((state) => state.selectedZettelId);
  const selectZettel = useVaultStore((state) => state.selectZettel);
  const usesInitialZettels = Boolean(initialZettels) || deferInitialZettels;
  const [localZettels, setLocalZettels] = useState(() => mergeZettelList(initialZettels ?? [], initialSelectedZettel));
  const [listHydration, setListHydration] = useState<ZettelListHydrationState>(() =>
    deferInitialZettels ? { status: "loading", total: 0 } : { status: "ready", nextOffset: null, total: initialZettels?.length ?? 0 },
  );
  const listRequestIdRef = useRef(0);
  const [loadedDetailIds, setLoadedDetailIds] = useState<Set<string>>(() => new Set(initialSelectedZettel?.id ? [initialSelectedZettel.id] : []));
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const zettels = usesInitialZettels ? localZettels : storeZettels;
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(
    () => searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "all",
  );
  const [selectedZettelIdState, setSelectedZettelIdState] = useState<string | null>(() => selectedZettelId ?? null);
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
  const [creatingDraftOpen, setCreatingDraftOpen] = useState(() => searchParams.get("new") === "1");
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const isCreating = creatingDraftOpen;
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = Boolean(activeView && !activeView.id.startsWith("default-"));
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
  const zettelListRequestKey = useMemo(
    () =>
      buildZettelListRequestParams({
        activeView,
        categoryTags,
        documentKindFilter,
        limit: LIST_PAGE_SIZE,
        offset: 0,
        propertyTags,
        query,
        reviewCadenceFilter,
        sortKey,
        sourceReliabilityFilter,
        statusFilter,
        typeFilter,
      }).toString(),
    [
      activeView,
      categoryTags,
      documentKindFilter,
      propertyTags,
      query,
      reviewCadenceFilter,
      sortKey,
      sourceReliabilityFilter,
      statusFilter,
      typeFilter,
    ],
  );

  const categoryFilterTerms = useMemo(() => categoryTags.map((tag) => tag.toLowerCase()), [categoryTags]);
  const propertyFilterTerms = useMemo(() => propertyTags.map((tag) => tag.toLowerCase()), [propertyTags]);
  const queryTerm = query.trim().toLowerCase();
  const zettelIndex = useMemo(() => zettels.map(createZettelListIndexItem), [zettels]);
  const zettelById = useMemo(() => new Map(zettels.map((zettel) => [zettel.id, zettel])), [zettels]);
  const activeViewMatcher = useMemo(() => (activeView ? createSavedViewMatcher(activeView) : null), [activeView]);
  const viewZettelIndex = useMemo(() => (activeViewMatcher ? zettelIndex.filter(activeViewMatcher) : zettelIndex), [activeViewMatcher, zettelIndex]);
  const visibleZettels = useMemo(() => sortZettelIndexItems(viewZettelIndex.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (documentKindFilter && item.documentKind !== documentKindFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (sourceReliabilityFilter && item.sourceReliability !== sourceReliabilityFilter) return false;
    if (reviewCadenceFilter && item.reviewCadence !== reviewCadenceFilter) return false;
    if (categoryFilterTerms.length && !categoryFilterTerms.some((tag) => item.categorySearchText.includes(tag))) return false;
    if (propertyFilterTerms.length && !propertyFilterTerms.every((tag) => item.propertySearchText.includes(tag))) return false;
    if (queryTerm && !item.searchText.includes(queryTerm)) return false;
    return true;
  }), sortKey).map((item) => item.zettel), [
    categoryFilterTerms,
    documentKindFilter,
    propertyFilterTerms,
    queryTerm,
    reviewCadenceFilter,
    sortKey,
    sourceReliabilityFilter,
    statusFilter,
    typeFilter,
    viewZettelIndex,
  ]);
  const selected = useMemo(() => (isCreating || !selectedZettelIdState ? null : zettelById.get(selectedZettelIdState) ?? null), [isCreating, selectedZettelIdState, zettelById]);
  const listedZettels = useMemo(() => visibleZettels.slice(0, visibleLimit), [visibleLimit, visibleZettels]);
  const pagedListedZettels = deferInitialZettels ? visibleZettels : listedZettels;
  const zettelResultTotal = deferInitialZettels ? listHydration.total : visibleZettels.length;
  const canLoadMoreZettels = deferInitialZettels ? Boolean(listHydration.nextOffset) : visibleLimit < visibleZettels.length;
  const categoryOptions = useMemo(() => Array.from(new Set(zettels.map((zettel) => zettel.category).filter(Boolean))).sort(), [zettels]);
  const categorySuggestions = useMemo(() => buildCategorySuggestions(zettels), [zettels]);
  const sourcePropertySuggestions = useMemo(() => buildSourcePropertySuggestions(zettels), [zettels]);
  const filterBarInitialFilters = useMemo(() => getFilterBarInitialFilters(activeView), [activeView]);

  const mergeLocalZettel = useCallback((zettel: ZettelMock) => {
    if (!usesInitialZettels) return;
    setLocalZettels((current) => mergeZettelList(current, zettel));
    setLoadedDetailIds((current) => {
      const next = new Set(current);
      next.add(zettel.id);
      return next;
    });
  }, [usesInitialZettels]);

  const mergeLocalZettels = useCallback((nextZettels: ZettelMock[]) => {
    if (!usesInitialZettels) return;
    setLocalZettels((current) => mergeZettelListItems(current, nextZettels));
    setLoadedDetailIds((current) => {
      const next = new Set(current);
      nextZettels.forEach((item) => next.add(item.id));
      return next;
    });
  }, [usesInitialZettels]);

  const removeLocalZettel = useCallback((zettelId: string) => {
    if (!usesInitialZettels) return;
    setLocalZettels((current) => removeZettelFromList(current, zettelId));
    setLoadedDetailIds((current) => {
      const next = new Set(current);
      next.delete(zettelId);
      return next;
    });
  }, [usesInitialZettels]);

  const hydrateZettelList = useCallback(async (options?: { mode?: "replace" | "append"; offset?: number }) => {
    if (!usesInitialZettels) return;

    const mode = options?.mode ?? "replace";
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    const offset = options?.offset ?? 0;
    const params = new URLSearchParams(zettelListRequestKey);
    params.set("limit", String(LIST_PAGE_SIZE));
    params.set("offset", String(offset));

    setListHydration((current) => ({ ...current, status: "loading", error: undefined }));
    try {
      const response = await fetch(`/api/vault/zettels?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        nextOffset?: number | null;
        total?: number;
        zettels?: ZettelMock[];
      } | null;
      if (!response.ok || !payload?.zettels) throw new Error(payload?.error ?? "지식 목록을 불러오지 못했습니다.");
      if (listRequestIdRef.current !== requestId) return;
      setLocalZettels((current) => mergePagedZettelPage(current, payload.zettels ?? [], { loadedDetailIds, mode }));
      setListHydration({
        status: "ready",
        nextOffset: payload.nextOffset ?? null,
        total: payload.total ?? payload.zettels.length,
      });
    } catch (error) {
      if (listRequestIdRef.current !== requestId) return;
      setListHydration((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "지식 목록을 불러오지 못했습니다.",
        total: mode === "append" ? current.total : 0,
      }));
    }
  }, [loadedDetailIds, usesInitialZettels, zettelListRequestKey]);

  const ensureZettelDetail = useCallback(async (zettelId: string, options?: { force?: boolean }) => {
    if (!usesInitialZettels) return;
    if (!options?.force && loadedDetailIds.has(zettelId)) return;

    setDetailLoadingId(zettelId);
    setDetailError(null);
    try {
      const response = await fetch(`/api/vault/zettels/${encodeURIComponent(zettelId)}/details`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as { zettel?: ZettelMock; error?: string } | null;
      if (!response.ok || !payload?.zettel) throw new Error(payload?.error ?? "지식 상세를 불러오지 못했습니다.");
      setLocalZettels((current) => mergeZettelList(current, payload.zettel));
      setLoadedDetailIds((current) => {
        const next = new Set(current);
        next.add(zettelId);
        return next;
      });
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "지식 상세를 불러오지 못했습니다.");
    } finally {
      setDetailLoadingId((current) => (current === zettelId ? null : current));
    }
  }, [loadedDetailIds, usesInitialZettels]);

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  useEffect(() => {
    if (!deferInitialZettels) return;
    void hydrateZettelList();
    // The request key carries the server-side query contract. `hydrateZettelList`
    // also closes over loaded detail ids so detail payloads can be preserved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferInitialZettels, zettelListRequestKey]);

  useEffect(() => {
    if (!usesInitialZettels) return;
    setLocalZettels(mergeZettelList(initialZettels ?? [], initialSelectedZettel));
    if (!initialSelectedZettel?.id) return;
    setLoadedDetailIds((current) => {
      const next = new Set(current);
      next.add(initialSelectedZettel.id);
      return next;
    });
  }, [initialSelectedZettel, initialZettels, usesInitialZettels]);

  useEffect(() => {
    function syncFromBrowserLocation() {
      const params = new URLSearchParams(window.location.search);
      const detailMatch = window.location.pathname.match(/^\/vault\/zettels\/([^/]+)$/);
      const nextIsCreating = params.get("new") === "1";
      setActiveViewKeyState(params.get("view") ?? getDefaultSavedViewKey(localSavedViews) ?? "all");
      setCreatingDraftOpen(nextIsCreating);
      setSelectedZettelIdState(nextIsCreating || !detailMatch ? null : decodeURIComponent(detailMatch[1]));
    }

    window.addEventListener("popstate", syncFromBrowserLocation);
    return () => window.removeEventListener("popstate", syncFromBrowserLocation);
  }, [localSavedViews]);

  useEffect(() => {
    if (!selected?.id) return;
    if (storeSelectedZettelId !== selected.id) selectZettel(selected.id);
  }, [selectZettel, selected?.id, storeSelectedZettelId]);

  useEffect(() => {
    if (!selectedZettelIdState || isCreating) return;
    void ensureZettelDetail(selectedZettelIdState);
  }, [ensureZettelDetail, isCreating, selectedZettelIdState]);

  function setZettelsLocation({
    mode = "push",
    newOpen = false,
    selectedId = selectedZettelIdState,
    viewKey = activeViewKey,
  }: {
    mode?: "push" | "replace";
    newOpen?: boolean;
    selectedId?: string | null;
    viewKey?: string | null;
  }) {
    const params = new URLSearchParams();
    if (viewKey) params.set("view", viewKey);
    if (newOpen) params.set("new", "1");
    const path = selectedId && !newOpen ? `/vault/zettels/${encodeURIComponent(selectedId)}` : "/vault/zettels";
    const query = params.toString();
    window.history[mode === "replace" ? "replaceState" : "pushState"](null, "", query ? `${path}?${query}` : path);
  }

  function selectSavedView(viewKey: string) {
    setActiveViewKeyState(viewKey);
    setCreatingDraftOpen(false);
    setSelectedZettelIdState(null);
    setZettelsLocation({ selectedId: null, viewKey });
  }

  function openZettel(id: string) {
    setCreatingDraftOpen(false);
    selectZettel(id);
    setSelectedZettelIdState(id);
    setZettelsLocation({ selectedId: id });
    void ensureZettelDetail(id);
  }

  function openNewZettel() {
    setCreatingDraftOpen(true);
    setSelectedZettelIdState(null);
    setZettelsLocation({ newOpen: true, selectedId: null });
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
      name: name ?? activeView?.name ?? "지식 뷰",
      icon: activeView?.icon ?? "library",
      searchQuery: query.trim(),
      filterState,
      sortState: { key: sortKey || getSavedViewSortKey(activeView) || "updated-desc" },
    };
  }

  async function saveCurrentView() {
    const name = window.prompt("저장할 조회 이름", query.trim() || activeView?.name || "지식 뷰");
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
      if (!response.ok || !payload.views) throw new Error(payload.error ?? "저장된 뷰 생성에 실패했습니다.");
      setLocalSavedViews(payload.views);
      setActiveViewKeyState(viewKey);
      setZettelsLocation({ selectedId: selectedZettelIdState, viewKey });
      toast.success("현재 조회를 저장했습니다.");
    } catch (error) {
      toast.error("뷰 저장에 실패했습니다.", {
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
      if (!response.ok || !payload.views) throw new Error(payload.error ?? "저장된 뷰 업데이트에 실패했습니다.");
      setLocalSavedViews(payload.views);
      toast.success("저장된 뷰를 업데이트했습니다.");
    } catch (error) {
      toast.error("저장된 뷰 업데이트에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function deleteActiveView() {
    if (!activeView || !activeViewIsPersisted || !window.confirm(`"${activeView.name}" 뷰를 삭제할까요?`)) return;
    try {
      const response = await fetch(`/api/saved-views/${activeView.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "저장된 뷰 삭제에 실패했습니다.");
      const refreshed = await fetch("/api/saved-views?domain=library&scope=knowledge", { cache: "no-store" });
      const refreshedPayload = (await refreshed.json()) as { views?: SavedView[]; error?: string };
      if (!refreshed.ok || !refreshedPayload.views) throw new Error(refreshedPayload.error ?? "저장된 뷰 목록을 다시 불러오지 못했습니다.");
      setLocalSavedViews(refreshedPayload.views);
      const nextViewKey = getDefaultSavedViewKey(refreshedPayload.views) ?? "all";
      setActiveViewKeyState(nextViewKey);
      setSelectedZettelIdState(null);
      setZettelsLocation({ mode: "replace", selectedId: null, viewKey: nextViewKey });
      toast.success("저장된 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("저장된 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function patchSavedView(view: SavedView, input: Partial<SavedView>, successMessage: string) {
    if (!isPersistedSavedView(view)) return;
    setViewMutationId(view.id);
    try {
      const response = await fetch(`/api/saved-views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name ?? view.name,
          icon: input.icon === undefined ? view.icon : input.icon,
          searchQuery: input.searchQuery ?? view.searchQuery,
          filterState: input.filterState ?? view.filterState,
          sortState: input.sortState ?? view.sortState,
          viewKey: input.viewKey ?? getSavedViewKey(view),
          isDefault: input.isDefault ?? view.isDefault,
          displayOrder: input.displayOrder ?? view.displayOrder,
        }),
      });
      const payload = (await response.json()) as { views?: SavedView[]; error?: string };
      if (!response.ok || !payload.views) throw new Error(payload.error ?? "저장된 뷰 업데이트에 실패했습니다.");
      setLocalSavedViews(payload.views);
      toast.success(successMessage);
    } catch (error) {
      toast.error("저장된 뷰를 업데이트하지 못했습니다.", {
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
      "현재 조건으로 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifyViewKey(name)}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const response = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: view.domain,
          scope: view.scope,
          name,
          icon: view.icon ?? "library",
          searchQuery: view.searchQuery,
          filterState: view.filterState,
          sortState: view.sortState,
          viewKey,
          displayOrder: localSavedViews.length,
        }),
      });
      const payload = (await response.json()) as { views?: SavedView[]; error?: string };
      if (!response.ok || !payload.views) throw new Error(payload.error ?? "저장된 뷰 복제에 실패했습니다.");
      setLocalSavedViews(payload.views);
      setActiveViewKeyState(viewKey);
      setSelectedZettelIdState(null);
      setZettelsLocation({ selectedId: null, viewKey });
      toast.success("기본 뷰를 편집 가능한 뷰로 복제했습니다.");
    } catch (error) {
      toast.error("뷰를 복제하지 못했습니다.", {
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
      const response = await fetch(`/api/saved-views/${view.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "저장된 뷰 삭제에 실패했습니다.");
      const refreshed = await fetch("/api/saved-views?domain=library&scope=knowledge", { cache: "no-store" });
      const refreshedPayload = (await refreshed.json()) as { views?: SavedView[]; error?: string };
      if (!refreshed.ok || !refreshedPayload.views) throw new Error(refreshedPayload.error ?? "저장된 뷰 목록을 다시 불러오지 못했습니다.");
      const nextViewKey = activeViewKey === getSavedViewKey(view) ? getDefaultSavedViewKey(refreshedPayload.views) ?? "all" : activeViewKey;
      setLocalSavedViews(refreshedPayload.views);
      setActiveViewKeyState(nextViewKey);
      if (activeViewKey === getSavedViewKey(view)) {
        setSelectedZettelIdState(null);
        setZettelsLocation({ mode: "replace", selectedId: null, viewKey: nextViewKey });
      }
      toast.success("저장된 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("저장된 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  function deleteSelected() {
    if (!selected || !window.confirm(`"${selected.title}" 지식을 삭제할까요?`)) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/vault/zettels/${selected.id}/delete`, { method: "POST" });
        const payload = (await response.json().catch(() => null)) as { deletedId?: string; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? "지식 삭제에 실패했습니다.");
        removeLocalZettel(payload?.deletedId ?? selected.id);
        toast.success("지식을 삭제했습니다.");
        setSelectedZettelIdState(null);
        setZettelsLocation({ mode: "replace", selectedId: null });
      } catch (error) {
        toast.error("지식 삭제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  if (!zettels.length && !isCreating) {
    if (listHydration.status === "loading") {
      return (
        <PageLayout>
          <PageHeader
            description="목록에서는 제목과 핵심 단서만 훑고, 선택하면 지식 읽기 화면으로 전환됩니다."
            eyebrow="지식금고"
            title="지식금고"
          />
          <PageBody className="zettels-read-body">
            <GlassCard className="max-h-none" priority="secondary">
              <p className="text-sm text-muted-foreground">지식 목록을 불러오는 중입니다.</p>
            </GlassCard>
          </PageBody>
        </PageLayout>
      );
    }

    if (listHydration.status === "error") {
      return (
        <EmptyState
          cta={{ label: "다시 불러오기", onClick: () => void hydrateZettelList() }}
          description={listHydration.error ?? "지식 목록을 불러오지 못했습니다."}
          illustration="zettel"
          title="지식 목록을 열 수 없습니다"
        />
      );
    }

    return (
      <EmptyState
        cta={{ label: "첫 지식 쓰기", hotkey: "Cmd+N", onClick: openNewZettel }}
        description="생각은 쓰는 순간 연결을 얻습니다. 첫 지식을 만들어 지식금고에 불을 켜보세요."
        illustration="zettel"
        title="첫 번째 지식을 남겨보세요"
      />
    );
  }

  const selectedReady = Boolean(selected && (!usesInitialZettels || loadedDetailIds.has(selected.id)));
  const showDetailLoading = Boolean(!isCreating && selectedZettelIdState && (!selectedReady || detailLoadingId === selectedZettelIdState) && !detailError);
  const showDetailError = Boolean(!isCreating && selectedZettelIdState && detailError && !selectedReady);
  const showListSurface = !selectedZettelIdState && !isCreating;

  return (
    <PageLayout>
      {showListSurface || isCreating ? (
        <PageHeader
          actions={
            <div className="flex flex-wrap gap-2">
              {!isCreating ? (
                <button className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={openNewZettel} type="button">
                  <Plus className="h-4 w-4" />
                  새 지식
                </button>
              ) : null}
              <Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground hover:bg-white/8" href="/vault/zettels/graph">
                <Workflow className="h-4 w-4" />
                그래프
              </Link>
              {!isCreating ? (
                <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  지식 {zettelResultTotal}개
                </span>
              ) : null}
            </div>
          }
          description={isCreating ? "새 지식을 작성하고 필요한 속성만 함께 정리합니다." : "목록에서는 제목과 핵심 단서만 훑고, 선택하면 지식 읽기 화면으로 전환됩니다."}
          eyebrow="지식금고"
          title={isCreating ? "새 지식" : "지식금고"}
        />
      ) : null}

      {showListSurface ? (
        <PageToolbar>
          <SavedViewTabs activeViewKey={getSavedViewKey(activeView) ?? activeViewKey} basePath="/vault/zettels" onSelect={selectSavedView} views={localSavedViews} />
          <FilterBar
            key={activeViewKey}
            filters={[
              { kind: "select", key: "type", label: "지식 유형", options: ZETTEL_TYPE_OPTIONS },
              { kind: "select", key: "documentKind", label: "문서 종류", options: DOCUMENT_KIND_OPTIONS },
              { kind: "select", key: "status", label: "상태", options: ZETTEL_STATUS_OPTIONS },
              { kind: "select", key: "sourceReliability", label: "신뢰도", options: ZETTEL_SOURCE_RELIABILITY_OPTIONS },
              { kind: "select", key: "reviewCadence", label: "검토 주기", options: ZETTEL_REVIEW_CADENCE_OPTIONS },
              { kind: "tag", key: "category", label: "분류 태그", suggestions: categorySuggestions },
              { kind: "tag", key: "property", label: "속성 검색", suggestions: sourcePropertySuggestions },
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
            syncUrl={false}
            rightSlot={
              <>
                <button
                  className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/8"
                  onClick={() => setViewManagerOpen((open) => !open)}
                  type="button"
                >
                  <Settings2 className="h-4 w-4" />
                  뷰 관리
                </button>
                {activeViewIsPersisted ? (
                  <button
                    className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/8"
                    onClick={() => void updateActiveView()}
                    type="button"
                  >
                    <Save className="h-4 w-4" />
                    현재 뷰 업데이트
                  </button>
                ) : null}
                <button
                  className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/8"
                  onClick={() => void saveCurrentView()}
                  type="button"
                >
                  <Save className="h-4 w-4" />
                  뷰 저장
                </button>
                {activeViewIsPersisted ? (
                  <button
                    aria-label="저장된 뷰 삭제"
                    className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-black/10 text-muted-foreground hover:bg-white/8 hover:text-foreground"
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
              { value: "updated-desc", label: "최근 수정순" },
              { value: "created-desc", label: "최근 생성순" },
              { value: "title-asc", label: "제목 가나다순" },
              { value: "kind-asc", label: "문서 종류순" },
            ]}
          />
          {viewManagerOpen ? (
            <SavedViewManager
              activeViewKey={activeViewKey}
              mutationId={viewMutationId}
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
        </PageToolbar>
      ) : null}

      <PageBody className="zettels-read-body">
        {selectedReady || isCreating ? (
          <ZettelReaderPane
            categoryOptions={categoryOptions}
            contextRefreshKey={contextRefreshKey}
            isPending={isPending}
            mode={isCreating ? "new" : "existing"}
            onBackToList={() => {
              setCreatingDraftOpen(false);
              selectZettel("");
              setSelectedZettelIdState(null);
              setZettelsLocation({ selectedId: null });
            }}
            onCancelNew={() => {
              setCreatingDraftOpen(false);
              setZettelsLocation({ mode: "replace", newOpen: false, selectedId: null });
            }}
            onDelete={selected ? deleteSelected : undefined}
            onRelationsChanged={() => setContextRefreshKey((value) => value + 1)}
            onZettelChange={mergeLocalZettel}
            onZettelsChange={mergeLocalZettels}
            onSaved={(zettelId) => {
              setCreatingDraftOpen(false);
              selectZettel(zettelId);
              setSelectedZettelIdState(zettelId);
              setLoadedDetailIds((current) => {
                const next = new Set(current);
                next.add(zettelId);
                return next;
              });
              setZettelsLocation({ mode: "replace", selectedId: zettelId });
            }}
            zettel={selected}
          />
        ) : showDetailLoading ? (
          <GlassCard className="mx-auto max-w-4xl" priority="secondary">
            <p className="text-sm text-muted-foreground">지식 상세를 불러오는 중입니다.</p>
          </GlassCard>
        ) : showDetailError ? (
          <EmptyState
            cta={{ label: "목록으로 돌아가기", onClick: () => {
              setSelectedZettelIdState(null);
              setDetailError(null);
              setZettelsLocation({ selectedId: null });
            } }}
            description={detailError ?? "지식 상세를 불러오지 못했습니다."}
            illustration="zettel"
            title="지식을 열 수 없습니다"
          />
        ) : (
          <GlassCard className="max-h-none" priority="secondary">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs tracking-[0.08em] text-primary">지식 목록</p>
                  <p className="mt-1 text-xs text-muted-foreground">목록에서는 핵심 단서만 보고, 선택하면 읽기 화면으로 넘어갑니다.</p>
                </div>
                <span className="rounded-md border border-white/10 bg-black/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {pagedListedZettels.length}/{zettelResultTotal}
                </span>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {pagedListedZettels.length ? (
                  pagedListedZettels.map((zettel) => (
                    <ZettelCard key={zettel.id} onSelect={() => openZettel(zettel.id)} zettel={zettel} />
                  ))
                ) : (
              <EmptyState description="검색어나 필터를 바꾸면 다른 항목들이 다시 나타납니다." illustration="zettel" title="이 조건에 맞는 지식이 없습니다" />
                )}
              </div>
              {canLoadMoreZettels ? (
                <button
                  className="focus-ring mt-4 w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground hover:bg-white/8"
                  disabled={listHydration.status === "loading"}
                  onClick={() => {
                    if (deferInitialZettels) {
                      void hydrateZettelList({ mode: "append", offset: listHydration.nextOffset ?? pagedListedZettels.length });
                      return;
                    }
                    setVisiblePage((current) => ({
                      key: filterKey,
                      limit: (current.key === filterKey ? current.limit : LIST_PAGE_SIZE) + LIST_PAGE_SIZE,
                    }));
                  }}
                  type="button"
                >
                  {listHydration.status === "loading" ? "불러오는 중" : "더 보기"}
                </button>
              ) : null}
          </GlassCard>
        )}
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

function createZettelListIndexItem(zettel: ZettelMock): ZettelListIndexItem {
  const status = zettel.status ?? "";
  const sourceReliability = getSourceReliabilityValue(zettel);
  const reviewCadence = getReviewCadenceValue(zettel);

  return {
    zettel,
    categorySearchText: getCategorySearchText(zettel),
    createdAtTime: getTimeValue(zettel.createdAt),
    documentKind: normalizeZettelDocumentKind(zettel.documentKind),
    propertySearchText: getSourcePropertySearchText(zettel),
    reviewCadence,
    reviewCadenceSearchValue: normalizeFilterValue(reviewCadence),
    searchText: getZettelSearchText(zettel),
    sourceReliability,
    sourceReliabilitySearchValue: normalizeFilterValue(sourceReliability),
    status,
    statusSearchValue: normalizeFilterValue(status),
    tags: zettel.tags.map(normalizeFilterValue),
    title: zettel.title,
    type: zettel.type,
    typeSearchValue: normalizeFilterValue(zettel.type),
    updatedAtTime: getTimeValue(zettel.updatedAt ?? zettel.createdAt),
  };
}

function getSavedViewKey(view: SavedView | null | undefined) {
  return view?.viewKey ?? view?.id ?? null;
}

function getDefaultSavedViewKey(views: SavedView[]) {
  return getSavedViewKey(views.find((view) => view.isDefault)) ?? getSavedViewKey(views[0]);
}

function isPersistedSavedView(view: SavedView | null | undefined) {
  return Boolean(view && !view.id.startsWith("default-"));
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
    .slice(0, 48) || "knowledge-view";
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
    item.sourcePropertySearchText ?? "",
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

function sortZettelIndexItems(items: ZettelListIndexItem[], sortKey: string) {
  const sorted = [...items];
  if (sortKey === "title-asc") return sorted.sort((left, right) => left.title.localeCompare(right.title, "ko-KR"));
  if (sortKey === "kind-asc") {
    return sorted.sort((left, right) => left.documentKind.localeCompare(right.documentKind));
  }
  if (sortKey === "created-desc") {
    return sorted.sort((left, right) => right.createdAtTime - left.createdAtTime);
  }
  return sorted.sort((left, right) => Number(right.zettel.pinned ?? false) - Number(left.zettel.pinned ?? false) || right.updatedAtTime - left.updatedAtTime);
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

function buildZettelListRequestParams(input: {
  activeView: SavedView | null | undefined;
  categoryTags: string[];
  documentKindFilter: string;
  limit: number;
  offset: number;
  propertyTags: string[];
  query: string;
  reviewCadenceFilter: string;
  sortKey: string;
  sourceReliabilityFilter: string;
  statusFilter: string;
  typeFilter: string;
}) {
  const params = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
    sort: input.sortKey || getSavedViewSortKey(input.activeView) || "updated-desc",
  });

  appendQueryValue(params, "q", input.activeView?.searchQuery);
  appendSavedViewFilterParams(params, input.activeView?.filterState);
  appendQueryValue(params, "q", input.query);
  appendQueryValue(params, "type", input.typeFilter);
  appendQueryValue(params, "documentKind", input.documentKindFilter);
  appendQueryValue(params, "status", input.statusFilter);
  appendQueryValue(params, "sourceReliability", input.sourceReliabilityFilter);
  appendQueryValue(params, "reviewCadence", input.reviewCadenceFilter);
  input.categoryTags.forEach((tag) => appendQueryValue(params, "category", tag));
  input.propertyTags.forEach((tag) => appendQueryValue(params, "property", tag));
  return params;
}

function appendSavedViewFilterParams(params: URLSearchParams, filterState: SavedView["filterState"] | undefined) {
  if (!filterState) return;

  asStringArray(filterState.kind).forEach((value) => appendQueryValue(params, "kind", value));
  asStringArray(filterState.documentKind).forEach((value) => appendQueryValue(params, "documentKind", value));
  asStringArray(filterState.type).forEach((value) => appendQueryValue(params, "type", value));
  asStringArray(filterState.status).forEach((value) => appendQueryValue(params, "status", value));
  asStringArray(filterState.sourceReliability).forEach((value) => appendQueryValue(params, "sourceReliability", value));
  asStringArray(filterState.reviewCadence).forEach((value) => appendQueryValue(params, "reviewCadence", value));
  asStringArray(filterState.category).forEach((value) => appendQueryValue(params, "category", value));
  asStringArray(filterState.tags).forEach((value) => appendQueryValue(params, "tags", value));
  asStringArray(filterState.property).forEach((value) => appendQueryValue(params, "property", value));
  asStringArray(filterState.sourceProperty).forEach((value) => appendQueryValue(params, "sourceProperty", value));
  appendBooleanQueryValue(params, "hasSourceDocument", filterState.hasSourceDocument);
  appendBooleanQueryValue(params, "hasBacklinks", filterState.hasBacklinks);
  appendBooleanQueryValue(params, "hasOutgoingLinks", filterState.hasOutgoingLinks);
}

function appendQueryValue(params: URLSearchParams, key: string, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (trimmed) params.append(key, trimmed);
}

function appendBooleanQueryValue(params: URLSearchParams, key: string, value: unknown) {
  if (typeof value === "boolean") params.set(key, String(value));
}

function oneSelectValue(value: unknown) {
  const values = asStringArray(value);
  return values.length === 1 ? values[0] : null;
}

function createSavedViewMatcher(view: SavedView) {
  const kinds = asStringArray(view.filterState.kind).map(normalizeZettelDocumentKind).filter(Boolean);
  const documentKinds = asStringArray(view.filterState.documentKind).map(normalizeZettelDocumentKind).filter(Boolean);
  const statuses = asStringArray(view.filterState.status).map(normalizeFilterValue);
  const types = asStringArray(view.filterState.type).map(normalizeFilterValue);
  const sourceReliabilities = asStringArray(view.filterState.sourceReliability).map(normalizeFilterValue);
  const reviewCadences = asStringArray(view.filterState.reviewCadence).map(normalizeFilterValue);
  const categories = asStringArray(view.filterState.category).map(normalizeFilterValue);
  const tags = asStringArray(view.filterState.tags).map(normalizeFilterValue);
  const propertyTerms = [...asStringArray(view.filterState.property), ...asStringArray(view.filterState.sourceProperty)].map(normalizeFilterValue);
  const viewSearch = normalizeFilterValue(view.searchQuery);

  return (item: ZettelListIndexItem) => {
    if (viewSearch && !item.searchText.includes(viewSearch)) return false;
    if (types.length && !types.includes(item.typeSearchValue)) return false;
    if (kinds.length && !kinds.some((kind) => item.documentKind === kind || item.searchText.includes(kind))) return false;
    if (documentKinds.length && !documentKinds.some((kind) => item.documentKind === kind || item.searchText.includes(kind))) return false;
    if (statuses.length && !statuses.includes(item.statusSearchValue)) return false;
    if (sourceReliabilities.length && !sourceReliabilities.includes(item.sourceReliabilitySearchValue)) return false;
    if (reviewCadences.length && !reviewCadences.includes(item.reviewCadenceSearchValue)) return false;
    if (categories.length && !categories.some((category) => item.categorySearchText.includes(category))) return false;
    if (tags.length && !tags.every((tag) => item.tags.some((itemTag) => itemTag.includes(tag)))) return false;
    if (propertyTerms.length && !propertyTerms.every((term) => item.propertySearchText.includes(term))) return false;
    if (view.filterState.hasSourceDocument === true && !item.zettel.sourceDocument) return false;
    if (view.filterState.hasSourceDocument === false && item.zettel.sourceDocument) return false;
    if (view.filterState.hasBacklinks === true && !item.zettel.backlinks.length) return false;
    if (view.filterState.hasOutgoingLinks === true && !item.zettel.outgoingLinks.length) return false;
    return true;
  };
}
