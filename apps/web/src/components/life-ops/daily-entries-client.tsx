"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";

import {
  CollectionColumnControls,
  savedViewColumnKeys,
  type CollectionColumnDefinition,
} from "@/components/shared/collection-column-controls";
import { CollectionShell } from "@/components/shared/collection-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { MarkdownView } from "@/components/shared/markdown-view";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import { SourceDocumentPanel } from "@/components/shared/source-document-panel";
import type { DailyEntry } from "@/lib/mock/life-ops";
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

type DailyEntriesClientProps = {
  deferInitialEntries?: boolean;
  entries: DailyEntry[];
  savedViews: SavedView[];
};

type DailyEntryListItem = DailyEntry & {
  backgroundPreview?: string | null;
  bodyPreview?: string;
  hasBackground?: boolean;
  hasBody?: boolean;
  hasSourceDocument?: boolean;
  isSummary?: boolean;
};

type DailyEntriesPayload = {
  entries?: DailyEntryListItem[];
  limit?: number;
  nextOffset?: number | null;
  offset?: number;
  total?: number;
};

const DAILY_ENTRY_KINDS = ["journal", "meditation", "sermon_note", "workout", "note"] as const satisfies readonly DailyEntry["kind"][];
const DAILY_ENTRY_VIEW_FILTER_KEYS = ["kind", "hasPeople", "hasEmotion"];

const KIND_LABELS: Record<DailyEntry["kind"], string> = {
  journal: "일기",
  meditation: "묵상",
  sermon_note: "설교 노트",
  workout: "운동 기록",
  note: "기록",
};

const DAILY_ENTRY_KIND_OPTIONS = DAILY_ENTRY_KINDS.map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}));

const DAILY_ENTRY_COLUMNS: CollectionColumnDefinition[] = [
  { key: "kind", label: "기록 종류", defaultVisible: true },
  { key: "date", label: "날짜", defaultVisible: true },
  { key: "emotion", label: "감정", defaultVisible: true },
  { key: "eventSummary", label: "사건 요약", defaultVisible: true },
  { key: "verse", label: "본문 말씀", defaultVisible: true },
  { key: "tagsSnapshot", label: "태그", defaultVisible: true },
  { key: "people", label: "사람 연결", defaultVisible: true },
  { key: "sourceDocument", label: "원본 속성", defaultVisible: true },
  { key: "body", label: "본문" },
  { key: "background", label: "배경" },
];

export function DailyEntriesClient({ deferInitialEntries = false, entries, savedViews }: DailyEntriesClientProps) {
  const searchParams = useSearchParams();
  const initialActiveViewKey = searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "calendar";
  const initialActiveView = savedViews.find((view) => getSavedViewKey(view) === initialActiveViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];
  const [localEntries, setLocalEntries] = useState<DailyEntryListItem[]>(entries);
  const [entriesLoading, setEntriesLoading] = useState(deferInitialEntries);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entriesTotal, setEntriesTotal] = useState(entries.length);
  const [isLoadingMoreEntries, setIsLoadingMoreEntries] = useState(false);
  const [nextEntriesOffset, setNextEntriesOffset] = useState<number | null>(null);
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(initialActiveViewKey);
  const [query, setQuery] = useState(initialActiveView?.searchQuery ?? "");
  const [kindFilter, setKindFilter] = useState<DailyEntry["kind"][]>(() => getKindFilter(initialActiveView));
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = isPersistedSavedView(activeView);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(activeView?.sortState.columns, DAILY_ENTRY_COLUMNS));
  const queryTerm = query.toLowerCase();
  const serverFiltersEntries = deferInitialEntries;
  const viewEntries = useMemo(() => (activeView ? applyDailyEntryView(localEntries, activeView, { skipSearch: serverFiltersEntries }) : localEntries), [activeView, localEntries, serverFiltersEntries]);
  const visibleEntries = useMemo(() => viewEntries.filter((entry) => {
    if (kindFilter.length && !kindFilter.includes(entry.kind)) return false;
    if (!serverFiltersEntries && queryTerm && !dailyEntrySearchText(entry).includes(queryTerm)) return false;
    return true;
  }), [kindFilter, queryTerm, serverFiltersEntries, viewEntries]);
  const entryStats = useMemo(() => ({
    kindCount: new Set(visibleEntries.map((entry) => entry.kind)).size,
    peopleLinkCount: visibleEntries.reduce((count, entry) => count + (entry.people?.length ?? 0), 0),
  }), [visibleEntries]);
  const { kindCount, peopleLinkCount } = entryStats;
  const entryRequestParams = useMemo(() => {
    const params = new URLSearchParams({ limit: "40", offset: "0" });
    const kinds = kindFilter.length ? kindFilter : getKindFilter(activeView);
    for (const kind of kinds) params.append("kind", kind);
    if (query.trim()) params.set("q", query.trim());
    if (activeView?.viewKey === "people-mentions" || activeView?.filterState.hasPeople === true) params.set("hasPeople", "1");
    if (activeView?.viewKey === "emotion-timeline" || activeView?.filterState.hasEmotion === true) params.set("hasEmotion", "1");
    return params.toString();
  }, [activeView, kindFilter, query]);

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  useEffect(() => {
    if (!deferInitialEntries) {
      setLocalEntries(entries);
      setEntriesLoading(false);
      setEntriesError(null);
      return;
    }

    const controller = new AbortController();
    setEntriesLoading(true);
    setEntriesError(null);

    async function loadEntries() {
      try {
        const response = await fetch(`/api/life-ops/entries?${entryRequestParams}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("일일 기록을 불러오지 못했습니다.");
        const payload = (await response.json()) as DailyEntriesPayload;
        setLocalEntries(payload.entries ?? []);
        setEntriesTotal(payload.total ?? payload.entries?.length ?? 0);
        setNextEntriesOffset(payload.nextOffset ?? null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setEntriesError(error instanceof Error ? error.message : "일일 기록을 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setEntriesLoading(false);
      }
    }

    void loadEntries();

    return () => {
      controller.abort();
    };
  }, [deferInitialEntries, entries, entryRequestParams]);

  function mergeEntryDetail(entry: DailyEntry) {
    setLocalEntries((current) =>
      current.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              ...entry,
              hasBackground: Boolean(entry.background?.trim()),
              hasBody: Boolean(entry.body?.trim()),
              hasSourceDocument: Boolean(entry.sourceDocument),
              isSummary: false,
            }
          : item,
      ),
    );
  }

  async function loadMoreEntries() {
    if (nextEntriesOffset === null || isLoadingMoreEntries) return;
    setIsLoadingMoreEntries(true);
    setEntriesError(null);
    try {
      const params = new URLSearchParams(entryRequestParams);
      params.set("offset", String(nextEntriesOffset));
      const response = await fetch(`/api/life-ops/entries?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("일일 기록을 더 불러오지 못했습니다.");
      const payload = (await response.json()) as DailyEntriesPayload;
      setLocalEntries((current) => mergeEntries(current, payload.entries ?? []));
      setEntriesTotal(payload.total ?? entriesTotal);
      setNextEntriesOffset(payload.nextOffset ?? null);
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : "일일 기록을 더 불러오지 못했습니다.");
    } finally {
      setIsLoadingMoreEntries(false);
    }
  }

  function setDailyEntriesLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/life-ops/entries?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, DAILY_ENTRY_COLUMNS));
    setKindFilter(getKindFilter(view));
    setQuery(view.searchQuery);
    setDailyEntriesLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = { ...(activeView?.filterState ?? {}) };
    DAILY_ENTRY_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (kindFilter.length) filterState.kind = kindFilter;
    if (activeView?.viewKey === "people-mentions" || activeView?.filterState.hasPeople === true) filterState.hasPeople = true;
    if (activeView?.viewKey === "emotion-timeline" || activeView?.filterState.hasEmotion === true) filterState.hasEmotion = true;

    return {
      domain: "daily",
      scope: "entries",
      name: name ?? activeView?.name ?? "일일 기록 뷰",
      icon: activeView?.icon ?? "calendar",
      searchQuery: query.trim(),
      filterState,
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 일일 기록 뷰 이름", query.trim() || activeView?.name || "일일 기록 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "daily-entry-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setDailyEntriesLocation(viewKey);
      toast.success("일일 기록 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("일일 기록 뷰 저장에 실패했습니다.", {
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
      toast.error("일일 기록 뷰 업데이트에 실패했습니다.", {
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
      "현재 조건으로 일일 기록 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "daily-entry-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "calendar",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, DAILY_ENTRY_COLUMNS));
      setKindFilter(getKindFilter(view));
      setQuery(view.searchQuery);
      setDailyEntriesLocation(viewKey);
      toast.success("일일 기록 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("일일 기록 뷰 복제에 실패했습니다.", {
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
      const nextViewKey = activeViewKey === getSavedViewKey(view) ? getDefaultSavedViewKey(views) ?? "calendar" : activeViewKey;
      const nextView = views.find((item) => getSavedViewKey(item) === nextViewKey);
      setLocalSavedViews(views);
      setActiveViewKeyState(nextViewKey);
      setVisibleColumnKeys(savedViewColumnKeys(nextView?.sortState.columns, DAILY_ENTRY_COLUMNS));
      setKindFilter(getKindFilter(nextView));
      setQuery(nextView?.searchQuery ?? "");
      setDailyEntriesLocation(nextViewKey);
      toast.success("일일 기록 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("일일 기록 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  return (
    <CollectionShell
      aside={<DailyEntryLens activeView={activeView} entries={visibleEntries} />}
      asideWidth="md"
      description="일기, 묵상, 설교 노트, 운동 기록을 날짜 컨테이너에 가두지 않고 속성 기반 컬렉션으로 다시 엮습니다."
      eyebrow="생활기록"
      metrics={[
        { label: "표시 중", value: visibleEntries.length },
        { label: "전체 기록", value: entriesLoading ? "불러오는 중" : entriesTotal },
        { label: "기록 종류", value: kindCount },
        { label: "사람 연결", value: peopleLinkCount },
      ]}
      title="일일 기록"
      toolbar={
        <div className="grid gap-3">
          <SavedViewTabs activeViewKey={activeViewKey} basePath="/life-ops/entries" onSelect={selectSavedView} views={localSavedViews} />
          <FilterBar
            key={activeViewKey}
            filters={[{ kind: "multi", key: "kind", label: "종류", options: DAILY_ENTRY_KIND_OPTIONS }]}
            initialFilters={{ kind: getKindFilter(activeView) }}
            initialQuery={activeView?.searchQuery ?? ""}
            onChange={(state) => {
              setQuery(state.q);
              const kinds = Array.isArray(state.filters.kind) ? state.filters.kind.filter(isDailyEntryKind) : [];
              setKindFilter(kinds);
            }}
            rightSlot={
              <>
                <CollectionColumnControls columns={DAILY_ENTRY_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
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
            searchPlaceholder="제목, 본문, 감정, 사람 검색"
            syncUrl={false}
          />
          {viewManagerOpen ? (
            <SavedViewManager
              activeViewKey={activeViewKey}
              createCurrentLabel={activeViewIsPersisted ? "현재 상태 새 뷰" : "편집본 만들기"}
              mutationId={viewMutationId}
              onCreateCurrent={() => void createSavedViewFromCurrent(activeViewIsPersisted ? undefined : `${activeView?.name ?? "일일 기록 뷰"} 편집본`)}
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
        </div>
      }
    >
      <div className="grid gap-4">
        {entriesLoading ? (
          <GlassCard className="p-5">
            <p className="text-sm text-muted-foreground">일일 기록을 불러오는 중입니다.</p>
          </GlassCard>
        ) : entriesError ? (
          <EmptyState
            description={entriesError}
            title="일일 기록을 불러오지 못했습니다."
          />
        ) : visibleEntries.length ? (
          <>
            {visibleEntries.map((entry) => (
              <DailyEntryArchiveCard entry={entry} key={entry.id} onDetailLoaded={mergeEntryDetail} visibleFields={visibleColumnKeys} />
            ))}
            {nextEntriesOffset !== null ? (
              <button
                className="focus-ring min-h-11 rounded-md border border-white/10 bg-white/5 px-4 text-sm font-medium text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-50"
                disabled={isLoadingMoreEntries}
                onClick={() => void loadMoreEntries()}
                type="button"
              >
                {isLoadingMoreEntries ? "불러오는 중" : `더 보기 (${localEntries.length}/${entriesTotal})`}
              </button>
            ) : null}
          </>
        ) : (
          <EmptyState
            description="현재 saved view 조건에 맞는 기록이 없습니다. 다른 view를 선택하거나 데이터 설정에서 컬렉션 상태를 확인하세요."
            title="표시할 일일 기록이 없습니다."
          />
        )}
      </div>
    </CollectionShell>
  );
}

function isDailyEntryKind(value: unknown): value is DailyEntry["kind"] {
  return typeof value === "string" && DAILY_ENTRY_KINDS.includes(value as DailyEntry["kind"]);
}

function getKindFilter(view: SavedView | null | undefined) {
  const raw = view?.filterState.kind;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.filter(isDailyEntryKind);
}

function mergeEntries(current: DailyEntryListItem[], incoming: DailyEntryListItem[]) {
  const map = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    map.set(entry.id, { ...map.get(entry.id), ...entry });
  }
  return [...map.values()];
}

function applyDailyEntryView(entries: DailyEntryListItem[], view: SavedView, options: { skipSearch?: boolean } = {}) {
  const kindFilter = getKindFilter(view);
  const hasPeople = view.viewKey === "people-mentions" || view.filterState.hasPeople === true;
  const hasEmotion = view.viewKey === "emotion-timeline" || view.filterState.hasEmotion === true;
  let filtered = kindFilter.length ? entries.filter((entry) => kindFilter.includes(entry.kind)) : entries;

  if (hasPeople) {
    filtered = filtered.filter((entry) => (entry.people?.length ?? 0) > 0);
  }

  if (hasEmotion) {
    filtered = filtered.filter((entry) => Boolean(entry.emotion?.trim()));
  }

  if (!options.skipSearch && view.searchQuery.trim()) {
    const query = view.searchQuery.trim().toLowerCase();
    filtered = filtered.filter((entry) => dailyEntrySearchText(entry).includes(query));
  }

  return [...filtered].sort((left, right) => {
    const dateSort = right.date.localeCompare(left.date);
    if (dateSort !== 0) return dateSort;
    return left.title.localeCompare(right.title);
  });
}

function dailyEntrySearchText(entry: DailyEntry) {
  return [
    entry.title,
    entry.body,
    entry.emotion ?? "",
    entry.eventSummary ?? "",
    entry.verse ?? "",
    entry.background ?? "",
    entry.tagsSnapshot ?? "",
    ...(entry.people?.map((person) => `${person.name} ${person.context ?? ""}`) ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function DailyEntryLens({ activeView, entries }: { activeView?: SavedView; entries: DailyEntry[] }) {
  const kindCounts = useMemo(() => DAILY_ENTRY_KINDS.map((kind) => ({
    kind,
    count: entries.filter((entry) => entry.kind === kind).length,
  })).filter((item) => item.count > 0), [entries]);
  const latestDate = entries[0]?.date ?? "-";
  const oldestDate = entries[entries.length - 1]?.date ?? "-";

  return (
    <div className="space-y-4">
      <GlassCard priority="secondary">
        <p className="text-xs text-primary">현재 뷰</p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{activeView?.name ?? "일일 기록"}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">이 화면은 저장 뷰 조건과 표시 속성으로 같은 데이터 컬렉션을 재배열합니다.</p>
        <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2">
            <span>최신</span>
            <span className="font-medium text-foreground">{latestDate}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2">
            <span>가장 오래됨</span>
            <span className="font-medium text-foreground">{oldestDate}</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard priority="secondary">
        <p className="text-xs text-muted-foreground">종류 분포</p>
        <div className="mt-3 space-y-2">
          {kindCounts.length ? (
            kindCounts.map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm" key={item.kind}>
                <span className="text-muted-foreground">{KIND_LABELS[item.kind]}</span>
                <span className="font-semibold text-foreground">{item.count}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">분포를 계산할 기록이 없습니다.</p>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function DailyEntryArchiveCard({
  entry,
  onDetailLoaded,
  visibleFields,
}: {
  entry: DailyEntryListItem;
  onDetailLoaded: (entry: DailyEntry) => void;
  visibleFields: string[];
}) {
  const [detailEntry, setDetailEntry] = useState<DailyEntryListItem>(entry);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const visible = useMemo(() => new Set(visibleFields), [visibleFields]);
  const displayEntry = detailEntry.id === entry.id ? detailEntry : entry;
  const showHeaderMeta = visible.has("kind") || visible.has("date");
  const showInlineProperties = visible.has("emotion") || visible.has("eventSummary") || visible.has("verse") || visible.has("tagsSnapshot");
  const needsDetail = Boolean(displayEntry.isSummary);

  useEffect(() => {
    setDetailEntry(entry);
    setDetailError(null);
  }, [entry]);

  const loadDetail = useCallback(async () => {
    if (!needsDetail || detailLoading) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/life-ops/entries/${encodeURIComponent(entry.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("기록 상세를 불러오지 못했습니다.");
      const payload = (await response.json()) as { entry?: DailyEntry };
      if (!payload.entry) throw new Error("기록 상세를 찾지 못했습니다.");
      const nextEntry: DailyEntryListItem = {
        ...displayEntry,
        ...payload.entry,
        hasBackground: Boolean(payload.entry.background?.trim()),
        hasBody: Boolean(payload.entry.body?.trim()),
        hasSourceDocument: Boolean(payload.entry.sourceDocument),
        isSummary: false,
      };
      setDetailEntry(nextEntry);
      onDetailLoaded(payload.entry);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "기록 상세를 불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }, [detailLoading, displayEntry, entry.id, needsDetail, onDetailLoaded]);

  useEffect(() => {
    if (visible.has("background") && displayEntry.hasBackground && needsDetail) {
      void loadDetail();
    }
  }, [displayEntry.hasBackground, loadDetail, needsDetail, visible]);

  return (
    <article className="rounded-lg border border-white/10 bg-white/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {showHeaderMeta ? (
            <div className="flex flex-wrap items-center gap-2">
              {visible.has("kind") ? (
                <span className="rounded-md border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] text-primary">{KIND_LABELS[displayEntry.kind]}</span>
              ) : null}
              {visible.has("date") ? <span className="text-sm text-muted-foreground">{displayEntry.date}</span> : null}
            </div>
          ) : null}
          <h2 className="mt-3 text-2xl font-semibold text-foreground">{displayEntry.title}</h2>
          {showInlineProperties ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {visible.has("emotion") && displayEntry.emotion ? <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1">감정: {displayEntry.emotion}</span> : null}
              {visible.has("eventSummary") && displayEntry.eventSummary ? <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1">사건: {displayEntry.eventSummary}</span> : null}
              {visible.has("verse") && displayEntry.verse ? <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1">본문: {displayEntry.verse}</span> : null}
              {visible.has("tagsSnapshot") && displayEntry.tagsSnapshot ? <span className="rounded-md border border-white/10 bg-black/10 px-2.5 py-1">태그: {displayEntry.tagsSnapshot}</span> : null}
            </div>
          ) : null}
        </div>
        <Link className="rounded-md border border-white/10 bg-black/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground" href={`/life-ops/${displayEntry.date}`} scroll={false}>
          날짜 로그 보기
        </Link>
      </div>

      {visible.has("people") && displayEntry.people?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {displayEntry.people.map((person) => (
            <Link className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground" href={`/prm/${person.id}`} key={person.id} scroll={false}>
              {person.name}
            </Link>
          ))}
        </div>
      ) : null}

      {visible.has("body") ? (
        displayEntry.hasBody || displayEntry.body || displayEntry.bodyPreview ? (
          <details className="mt-4 rounded-md border border-white/10 bg-black/10 p-4" onToggle={(event) => {
            if (event.currentTarget.open) void loadDetail();
          }}>
            <summary className="cursor-pointer text-sm font-medium text-foreground">본문 보기</summary>
            <div className="mt-3 max-h-[30rem] overflow-y-auto">
              {detailLoading ? <p className="text-sm text-muted-foreground">본문을 불러오는 중입니다.</p> : detailError ? <p className="text-sm text-muted-foreground">{detailError}</p> : <MarkdownView value={displayEntry.body || displayEntry.bodyPreview || ""} />}
            </div>
          </details>
        ) : (
          <p className="mt-4 rounded-md border border-white/10 bg-black/10 p-4 text-sm text-muted-foreground">본문이 비어 있습니다.</p>
        )
      ) : null}

      {visible.has("background") && (displayEntry.background || displayEntry.backgroundPreview || detailLoading) ? (
        <div className="mt-4 rounded-md border border-white/10 bg-black/10 p-4 text-sm leading-6 text-muted-foreground">
          <p className="text-xs text-primary">배경</p>
          <p className="mt-2 whitespace-pre-wrap">{detailLoading ? "배경을 불러오는 중입니다." : displayEntry.background ?? displayEntry.backgroundPreview}</p>
        </div>
      ) : null}

      {visible.has("sourceDocument") && (displayEntry.sourceDocument || displayEntry.hasSourceDocument) ? (
        <details className="mt-4 rounded-md border border-white/10 bg-black/10 p-4" onToggle={(event) => {
          if (event.currentTarget.open) void loadDetail();
        }}>
          <summary className="cursor-pointer text-xs text-muted-foreground">원본 속성</summary>
          <div className="mt-3">
            {detailLoading ? <p className="text-sm text-muted-foreground">원본 속성을 불러오는 중입니다.</p> : detailError ? <p className="text-sm text-muted-foreground">{detailError}</p> : displayEntry.sourceDocument ? <SourceDocumentPanel sourceDocument={displayEntry.sourceDocument} /> : <p className="text-sm text-muted-foreground">연결된 원본 속성이 없습니다.</p>}
          </div>
        </details>
      ) : null}
    </article>
  );
}
