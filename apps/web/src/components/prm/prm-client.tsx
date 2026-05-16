"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";

import { HitThemUpPanel } from "@/components/prm/hit-them-up-panel";
import { PersonCard } from "@/components/prm/person-card";
import { PersonFilterTabs, type PersonFilterKey } from "@/components/prm/person-filter-tabs";
import {
  CollectionColumnControls,
  savedViewColumnKeys,
  type CollectionColumnDefinition,
} from "@/components/shared/collection-column-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import type { PersonMock } from "@/lib/mock/prm";
import type { PRMSnapshot } from "@/lib/server/prm";
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
import { type PRMMutationDelta, usePRMStore } from "@/stores/use-prm-store";

type PRMClientProps = {
  initialSnapshotJson?: string;
  savedViews: SavedView[];
};

const PERSON_VIEW_FILTER_KEYS = ["group", "favorite", "layer", "needsContact"];
const PERSON_CARD_COLUMNS: CollectionColumnDefinition[] = [
  { key: "nickname", label: "닉네임", defaultVisible: true },
  { key: "favorite", label: "즐겨찾기", defaultVisible: true },
  { key: "status", label: "관계 상태", defaultVisible: true },
  { key: "layer", label: "관계 레이어", defaultVisible: true },
  { key: "groups", label: "그룹", defaultVisible: true },
  { key: "bio", label: "소개", defaultVisible: true },
  { key: "cadence", label: "연락 주기", defaultVisible: true },
  { key: "interactions", label: "상호작용 수", defaultVisible: true },
  { key: "lastContact", label: "마지막 연락", defaultVisible: true },
  { key: "birthday", label: "생일", defaultVisible: true },
  { key: "gifts", label: "선물 수" },
  { key: "tasks", label: "작업 수" },
  { key: "sourceDocument", label: "원본 속성" },
];

const ALL_PEOPLE_VIEW: SavedView = {
  id: "default-people-relationships-all",
  domain: "people",
  scope: "relationships",
  name: "전체",
  icon: "users",
  searchQuery: "",
  filterState: {},
  sortState: {},
  viewKey: "all",
  isDefault: true,
  displayOrder: 0,
};

function withAllPeopleView(views: SavedView[]) {
  const hasAllView = views.some((view) => getSavedViewKey(view) === "all");
  const normalizedViews = views.map((view) => ({
    ...view,
    isDefault: hasAllView ? getSavedViewKey(view) === "all" : false,
    displayOrder: hasAllView ? view.displayOrder : view.displayOrder + 1,
  }));

  return hasAllView ? normalizedViews : [ALL_PEOPLE_VIEW, ...normalizedViews];
}

function parseInitialSnapshot(value?: string): PRMSnapshot | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as PRMSnapshot;
  } catch {
    return null;
  }
}

export function PRMClient({ initialSnapshotJson, savedViews }: PRMClientProps) {
  const searchParams = useSearchParams();
  const initialSnapshot = useMemo(() => parseInitialSnapshot(initialSnapshotJson), [initialSnapshotJson]);
  const storePeople = usePRMStore((state) => state.people);
  const storeGifts = usePRMStore((state) => state.gifts);
  const storeNetworkEdges = usePRMStore((state) => state.networkEdges);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);
  const [localSnapshot, setLocalSnapshot] = useState<PRMSnapshot | null>(initialSnapshot ?? null);
  const skipNextStoreSync = useRef(Boolean(initialSnapshot));
  const hasLocalSnapshot = localSnapshot !== null;
  const people = localSnapshot?.people ?? storePeople;
  const initialSavedViews = useMemo(() => withAllPeopleView(savedViews), [savedViews]);
  const [localSavedViews, setLocalSavedViews] = useState(initialSavedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(() => searchParams.get("view") ?? getDefaultSavedViewKey(initialSavedViews) ?? "all");
  const [filter, setFilter] = useState<PersonFilterKey>("all");
  const [query, setQuery] = useState("");
  const [groupTags, setGroupTags] = useState<string[]>([]);
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = isPersistedSavedView(activeView);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(activeView?.sortState.columns, PERSON_CARD_COLUMNS));
  const groupFilterTerms = useMemo(() => groupTags.map((tag) => tag.toLowerCase()), [groupTags]);
  const queryTerm = query.toLowerCase();
  const needsContact = useMemo(() => people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact), [people]);
  const viewPeople = useMemo(() => (activeView ? people.filter((person) => personMatchesSavedView(person, activeView)) : people), [activeView, people]);
  const visiblePeople = useMemo(() => viewPeople.filter((person) => {
    if (filter === "needs-contact" && person.daysSinceContact <= person.cadenceDays) return false;
    if (filter === "favorites" && !person.favorite) return false;
    if ((filter === "5" || filter === "15" || filter === "50" || filter === "150") && `${person.layer}` !== filter) return false;
    if (groupFilterTerms.length && !groupFilterTerms.some((tag) => person.groups.some((group) => group.toLowerCase().includes(tag)))) return false;
    if (queryTerm && !`${person.name} ${person.nickname ?? ""} ${person.bio} ${person.groups.join(" ")}`.toLowerCase().includes(queryTerm)) return false;
    return true;
  }), [filter, groupFilterTerms, queryTerm, viewPeople]);

  useEffect(() => {
    setLocalSavedViews(initialSavedViews);
  }, [initialSavedViews]);

  useEffect(() => {
    if (!initialSnapshot) return;
    skipNextStoreSync.current = true;
    setLocalSnapshot(initialSnapshot);
    replaceSnapshot(initialSnapshot);
  }, [initialSnapshot, replaceSnapshot]);

  useEffect(() => {
    if (!hasLocalSnapshot) return;
    if (skipNextStoreSync.current) {
      skipNextStoreSync.current = false;
      return;
    }

    setLocalSnapshot({ gifts: storeGifts, networkEdges: storeNetworkEdges, people: storePeople });
  }, [hasLocalSnapshot, storeGifts, storeNetworkEdges, storePeople]);

  function applyPRMDelta(delta: PRMMutationDelta) {
    setLocalSnapshot((current) => {
      if (!current) return current;
      const people = delta.person
        ? current.people.some((person) => person.id === delta.person!.id)
          ? current.people.map((person) => (person.id === delta.person!.id ? delta.person! : person))
          : [...current.people, delta.person]
        : current.people;
      const withGift = delta.gift
        ? current.gifts.some((gift) => gift.id === delta.gift!.id)
          ? current.gifts.map((gift) => (gift.id === delta.gift!.id ? delta.gift! : gift))
          : [delta.gift, ...current.gifts]
        : current.gifts;
      const gifts = delta.deletedGiftId ? withGift.filter((gift) => gift.id !== delta.deletedGiftId) : withGift;
      const withNetworkEdge = delta.networkEdge
        ? current.networkEdges.some((edge) => edge.id === delta.networkEdge!.id)
          ? current.networkEdges.map((edge) => (edge.id === delta.networkEdge!.id ? delta.networkEdge! : edge))
          : [delta.networkEdge, ...current.networkEdges]
        : current.networkEdges;
      const networkEdges = delta.deletedNetworkEdgeId ? withNetworkEdge.filter((edge) => edge.id !== delta.deletedNetworkEdgeId) : withNetworkEdge;
      return { gifts, networkEdges, people };
    });
  }

  function setPrmLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/prm?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, PERSON_CARD_COLUMNS));
    setGroupTags(asStringArray(view.filterState.group));
    setQuery(view.searchQuery);
    setPrmLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = { ...(activeView?.filterState ?? {}) };
    PERSON_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (groupTags.length) filterState.group = groupTags;
    if (filter === "favorites") filterState.favorite = true;
    if (filter === "needs-contact") filterState.needsContact = true;
    if (filter === "5" || filter === "15" || filter === "50" || filter === "150") filterState.layer = [Number(filter)];

    return {
      domain: "people",
      scope: "relationships",
      name: name ?? activeView?.name ?? "관계 뷰",
      icon: activeView?.icon ?? "heart",
      searchQuery: query.trim(),
      filterState,
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 관계 뷰 이름", query.trim() || activeView?.name || "관계 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "people-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(withAllPeopleView(views));
      setActiveViewKeyState(viewKey);
      setPrmLocation(viewKey);
      toast.success("관계 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("관계 뷰 저장에 실패했습니다.", {
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
      setLocalSavedViews(withAllPeopleView(views));
      toast.success(successMessage);
    } catch (error) {
      toast.error("관계 뷰 업데이트에 실패했습니다.", {
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
      "현재 조건으로 관계 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "people-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "heart",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(withAllPeopleView(views));
      setActiveViewKeyState(viewKey);
      setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, PERSON_CARD_COLUMNS));
      setGroupTags(asStringArray(view.filterState.group));
      setQuery(view.searchQuery);
      setPrmLocation(viewKey);
      toast.success("관계 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("관계 뷰 복제에 실패했습니다.", {
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
      const nextViews = withAllPeopleView(views);
      const nextViewKey = activeViewKey === getSavedViewKey(view) ? getDefaultSavedViewKey(nextViews) ?? "all" : activeViewKey;
      const nextView = nextViews.find((item) => getSavedViewKey(item) === nextViewKey);
      setLocalSavedViews(nextViews);
      setActiveViewKeyState(nextViewKey);
      setVisibleColumnKeys(savedViewColumnKeys(nextView?.sortState.columns, PERSON_CARD_COLUMNS));
      setGroupTags(asStringArray(nextView?.filterState.group));
      setQuery(nextView?.searchQuery ?? "");
      setPrmLocation(nextViewKey);
      toast.success("관계 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("관계 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  return (
    <PageLayout>
      <PageHeader
        eyebrow="관계"
        title="관계"
        description="연락 리듬, 친밀도, 선물과 관계선을 한 화면에서 정리합니다."
        actions={
          <>
            <Link className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-white/8 hover:text-foreground" href="/prm/gifts" scroll={false}>
              선물
            </Link>
            <Link className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-white/8 hover:text-foreground" href="/prm/graph" scroll={false}>
              관계 그래프
            </Link>
          </>
        }
      />

      <PersonFilterTabs onChange={setFilter} value={filter} />
      <PageToolbar>
        <SavedViewTabs activeViewKey={activeViewKey} basePath="/prm" onSelect={selectSavedView} views={localSavedViews} />
        <FilterBar
          key={activeViewKey}
          filters={[{ kind: "tag", key: "group", label: "그룹" }]}
          initialFilters={{ group: asStringArray(activeView?.filterState.group) }}
          initialQuery={activeView?.searchQuery ?? ""}
          onChange={(state) => {
            setQuery(state.q);
            setGroupTags(Array.isArray(state.filters.group) ? state.filters.group : []);
          }}
          rightSlot={
            <>
              <CollectionColumnControls columns={PERSON_CARD_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
              <button
                className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/8"
                onClick={() => setViewManagerOpen((open) => !open)}
                type="button"
              >
                <Settings2 className="h-4 w-4" />
                뷰 관리
              </button>
              <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">{visiblePeople.length}명</span>
            </>
          }
          searchPlaceholder="이름, 그룹, 설명 키워드 검색"
          syncUrl={false}
        />
        {viewManagerOpen ? (
          <SavedViewManager
            activeViewKey={activeViewKey}
            createCurrentLabel={activeViewIsPersisted ? "현재 상태 새 뷰" : "편집본 만들기"}
            mutationId={viewMutationId}
            onCreateCurrent={() => void createSavedViewFromCurrent(activeViewIsPersisted ? undefined : `${activeView?.name ?? "관계 뷰"} 편집본`)}
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

      <PageBody aside={<HitThemUpPanel onMutationDelta={applyPRMDelta} people={needsContact} />} asideWidth="md">
        <div className="app-grid app-grid-cards">
          {visiblePeople.length ? visiblePeople.map((person) => (
            <PersonCard key={person.id} person={person} visibleFields={visibleColumnKeys} />
          )) : (
            <div>
              <EmptyState description="검색어나 레이어 탭을 조정하면 다른 관계가 다시 보입니다." illustration="person" title="이 조건에 맞는 사람이 없습니다" />
            </div>
          )}
        </div>
      </PageBody>
    </PageLayout>
  );
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function asNumberArray(value: unknown) {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return raw.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function personMatchesSavedView(person: PersonMock, view: SavedView) {
  const layers = asNumberArray(view.filterState.layer);
  const statuses = asStringArray(view.filterState.status);
  const groups = asStringArray(view.filterState.group);
  const hasGifts = typeof view.filterState.hasGifts === "boolean" ? view.filterState.hasGifts : null;
  const linkedDailyEntries = typeof view.filterState.linkedDailyEntries === "boolean" ? view.filterState.linkedDailyEntries : null;
  const favorite = typeof view.filterState.favorite === "boolean" ? view.filterState.favorite : null;
  const needsContact = typeof view.filterState.needsContact === "boolean" ? view.filterState.needsContact : null;
  const searchQuery = view.searchQuery.trim().toLowerCase();

  if (layers.length && !layers.includes(person.layer)) return false;
  if (statuses.length && !statuses.includes(person.status)) return false;
  if (groups.length && !groups.some((tag) => person.groups.some((group) => group.toLowerCase().includes(tag.toLowerCase())))) return false;
  if (hasGifts !== null && (person.giftsCount > 0) !== hasGifts) return false;
  if (linkedDailyEntries !== null && person.timeline.some((item) => item.kind === "daily_entry") !== linkedDailyEntries) return false;
  if (favorite !== null && Boolean(person.favorite) !== favorite) return false;
  if (needsContact !== null && (person.daysSinceContact > person.cadenceDays) !== needsContact) return false;
  if (searchQuery && !`${person.name} ${person.nickname ?? ""} ${person.bio} ${person.groups.join(" ")}`.toLowerCase().includes(searchQuery)) return false;
  return true;
}
