"use client";

import { useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { GiftBoard } from "@/components/prm/gift-board";
import { GiftCard } from "@/components/prm/gift-card";
import {
  CollectionColumnControls,
  savedViewColumnKeys,
  type CollectionColumnDefinition,
} from "@/components/shared/collection-column-controls";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
import { PropertyPanel } from "@/components/shared/properties/property-panel";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import type { GiftMock } from "@/lib/mock/prm";
import { GIFT_DIRECTION_OPTIONS, GIFT_PROPERTY_DEFINITIONS, GIFT_PROPERTY_GROUPS } from "@/lib/properties/gift";
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
import { usePRMStore } from "@/stores/use-prm-store";

type GiftForm = {
  personId: string;
  title: string;
  direction: "given" | "received";
  occurredAt: string;
  satisfaction: string;
  notes: string;
};

type GiftsBoardClientProps = {
  savedViews: SavedView[];
};

const GIFT_VIEW_FILTER_KEYS = ["direction", "hasSatisfaction"];
const GIFT_COLUMNS: CollectionColumnDefinition[] = [
  ...GIFT_PROPERTY_DEFINITIONS
    .filter((definition) => definition.defaultVisibleInList && definition.field !== "title")
    .map((definition) => ({
      key: definition.field,
      label: definition.label,
      defaultVisible: true,
    })),
  { key: "notes", label: "메모" },
];

export function GiftsBoardClient({ savedViews }: GiftsBoardClientProps) {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const gifts = usePRMStore((state) => state.gifts);
  const people = usePRMStore((state) => state.people);
  const replaceSnapshot = usePRMStore((state) => state.replaceSnapshot);
  const [form, setForm] = useState<GiftForm>({
    personId: people[0]?.id ?? "",
    title: "",
    direction: "given",
    occurredAt: new Date().toISOString().slice(0, 10),
    satisfaction: "",
    notes: "",
  });
  const peopleMap = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const peopleOptions = useMemo(() => people.map((person) => ({ value: person.id, label: person.name })), [people]);
  const initialActiveViewKey = searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "all";
  const initialActiveView = savedViews.find((view) => getSavedViewKey(view) === initialActiveViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(initialActiveViewKey);
  const [query, setQuery] = useState(initialActiveView?.searchQuery ?? "");
  const [directionFilter, setDirectionFilter] = useState<string[]>(() => asStringArray(initialActiveView?.filterState.direction));
  const [reactionFilter, setReactionFilter] = useState(initialActiveView?.filterState.hasSatisfaction === true ? "with-reaction" : "");
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const activeViewIsPersisted = isPersistedSavedView(activeView);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(initialActiveView?.sortState.columns, GIFT_COLUMNS));
  const viewGifts = activeView ? gifts.filter((gift) => giftMatchesSavedView(gift, activeView, peopleMap)) : gifts;
  const filteredGifts = viewGifts.filter((gift) => {
    if (directionFilter.length && !directionFilter.includes(gift.direction)) return false;
    if (reactionFilter === "with-reaction" && !gift.satisfaction?.trim()) return false;
    if (query && !giftSearchText(gift, peopleMap).includes(query.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  function setGiftsLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/prm/gifts?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, GIFT_COLUMNS));
    setDirectionFilter(asStringArray(view.filterState.direction));
    setReactionFilter(view.filterState.hasSatisfaction === true ? "with-reaction" : "");
    setQuery(view.searchQuery);
    setGiftsLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    const filterState: Record<string, unknown> = { ...(activeView?.filterState ?? {}) };
    GIFT_VIEW_FILTER_KEYS.forEach((key) => delete filterState[key]);
    if (directionFilter.length) filterState.direction = directionFilter;
    if (reactionFilter === "with-reaction") filterState.hasSatisfaction = true;

    return {
      domain: "gifts",
      scope: "relationships",
      name: name ?? activeView?.name ?? "선물 뷰",
      icon: activeView?.icon ?? "gift",
      searchQuery: query.trim(),
      filterState,
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 선물 뷰 이름", query.trim() || activeView?.name || "선물 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "gift-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setGiftsLocation(viewKey);
      toast.success("선물 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("선물 뷰 저장에 실패했습니다.", {
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
      toast.error("선물 뷰 업데이트에 실패했습니다.", {
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
      "현재 조건으로 선물 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "gift-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "gift",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, GIFT_COLUMNS));
      setDirectionFilter(asStringArray(view.filterState.direction));
      setReactionFilter(view.filterState.hasSatisfaction === true ? "with-reaction" : "");
      setQuery(view.searchQuery);
      setGiftsLocation(viewKey);
      toast.success("선물 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("선물 뷰 복제에 실패했습니다.", {
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
      setVisibleColumnKeys(savedViewColumnKeys(nextView?.sortState.columns, GIFT_COLUMNS));
      setDirectionFilter(asStringArray(nextView?.filterState.direction));
      setReactionFilter(nextView?.filterState.hasSatisfaction === true ? "with-reaction" : "");
      setQuery(nextView?.searchQuery ?? "");
      setGiftsLocation(nextViewKey);
      toast.success("선물 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("선물 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  function submit() {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/prm/people/${form.personId}/gifts`,
          {
            title: form.title,
            direction: form.direction,
            occurredAt: form.occurredAt,
            satisfaction: form.satisfaction,
            notes: form.notes,
          },
          replaceSnapshot,
        );
        setForm((current) => ({
          ...current,
          title: "",
          occurredAt: new Date().toISOString().slice(0, 10),
          satisfaction: "",
          notes: "",
        }));
        toast.success("선물을 기록했습니다.");
      } catch (error) {
        toast.error("선물 기록에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  function removeGift(giftId: string) {
    startTransition(async () => {
      try {
        await postSnapshotMutation<{ snapshot: Parameters<typeof replaceSnapshot>[0] }, Parameters<typeof replaceSnapshot>[0]>(
          `/api/prm/gifts/${giftId}/delete`,
          undefined,
          replaceSnapshot,
        );
        toast.success("선물을 목록에서 제거했습니다.");
      } catch (error) {
        toast.error("선물 삭제에 실패했습니다.", {
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
        });
      }
    });
  }

  return (
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs tracking-[0.08em] text-primary">관계 선물</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">선물 보드</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">준 선물과 받은 선물을 한 화면에서 보고, 인물별 선물 기록을 바로 남길 수 있도록 구성했습니다.</p>
          </div>
          <span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
            표시 {filteredGifts.length}개 / 전체 {gifts.length}개
          </span>
        </div>
      </GlassCard>

      <SavedViewTabs activeViewKey={activeViewKey} basePath="/prm/gifts" onSelect={selectSavedView} views={localSavedViews} />

      <FilterBar
        key={activeViewKey}
        filters={[
          { kind: "multi", key: "direction", label: "방향", options: GIFT_DIRECTION_OPTIONS },
          { kind: "select", key: "reactionState", label: "반응", options: [{ value: "with-reaction", label: "반응 기록" }] },
        ]}
        initialFilters={{ direction: directionFilter, reactionState: reactionFilter }}
        initialQuery={query}
        onChange={(state) => {
          setQuery(state.q);
          setDirectionFilter(Array.isArray(state.filters.direction) ? state.filters.direction : []);
          setReactionFilter(typeof state.filters.reactionState === "string" ? state.filters.reactionState : "");
        }}
        rightSlot={
          <>
            <CollectionColumnControls columns={GIFT_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
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
        searchPlaceholder="선물 이름, 인물, 만족도 검색"
        syncUrl={false}
      />

      {viewManagerOpen ? (
        <SavedViewManager
          activeViewKey={activeViewKey}
          createCurrentLabel={activeViewIsPersisted ? "현재 상태 새 뷰" : "편집본 만들기"}
          mutationId={viewMutationId}
          onCreateCurrent={() => void createSavedViewFromCurrent(activeViewIsPersisted ? undefined : `${activeView?.name ?? "선물 뷰"} 편집본`)}
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

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <PropertyPanel<GiftForm>
            definitions={GIFT_PROPERTY_DEFINITIONS}
            fieldOptions={{ personId: { options: peopleOptions } }}
            form={form}
            groups={GIFT_PROPERTY_GROUPS}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            title="새 선물 속성"
          />
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={isPending || !form.personId || !form.title.trim()} onClick={submit} type="button">
            {isPending ? "저장 중..." : "선물 저장"}
          </button>
        </div>

        <GiftBoard
          gifts={filteredGifts.filter((gift) => gift.direction === "given")}
          renderGift={(gift) => <GiftCard gift={gift} onDelete={() => removeGift(gift.id)} personName={peopleMap.get(gift.personId) ?? "알 수 없음"} visibleFields={visibleColumnKeys} />}
          title="준 선물"
        />
        <GiftBoard
          gifts={filteredGifts.filter((gift) => gift.direction === "received")}
          renderGift={(gift) => <GiftCard gift={gift} onDelete={() => removeGift(gift.id)} personName={peopleMap.get(gift.personId) ?? "알 수 없음"} visibleFields={visibleColumnKeys} />}
          title="받은 선물"
        />
      </section>
    </section>
  );
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function giftMatchesSavedView(gift: GiftMock, view: SavedView, peopleMap: Map<string, string>) {
  const directions = asStringArray(view.filterState.direction);
  const searchQuery = view.searchQuery.trim().toLowerCase();

  if (directions.length && !directions.includes(gift.direction)) return false;
  if (view.filterState.hasSatisfaction === true && !gift.satisfaction?.trim()) return false;
  if (searchQuery && !giftSearchText(gift, peopleMap).includes(searchQuery)) return false;
  return true;
}

function giftSearchText(gift: GiftMock, peopleMap: Map<string, string>) {
  return [gift.title, peopleMap.get(gift.personId), gift.direction, gift.occurredAt, gift.satisfaction, gift.notes].filter(Boolean).join(" ").toLowerCase();
}
