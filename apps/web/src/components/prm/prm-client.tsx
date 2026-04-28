"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { HitThemUpPanel } from "@/components/prm/hit-them-up-panel";
import { PersonCard } from "@/components/prm/person-card";
import { PersonFilterTabs, type PersonFilterKey } from "@/components/prm/person-filter-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import type { PersonMock } from "@/lib/mock/prm";
import type { SavedView } from "@/lib/server/ui-state";
import { usePRMStore } from "@/stores/use-prm-store";

type PRMClientProps = {
  savedViews: SavedView[];
};

export function PRMClient({ savedViews }: PRMClientProps) {
  const searchParams = useSearchParams();
  const people = usePRMStore((state) => state.people);
  const [filter, setFilter] = useState<PersonFilterKey>("all");
  const [query, setQuery] = useState("");
  const [groupTags, setGroupTags] = useState<string[]>([]);
  const activeViewKey = searchParams.get("view") ?? savedViews.find((view) => view.isDefault)?.viewKey ?? savedViews[0]?.viewKey ?? "core";
  const activeView = savedViews.find((view) => view.viewKey === activeViewKey) ?? savedViews.find((view) => view.isDefault) ?? savedViews[0];
  const needsContact = people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);
  const viewPeople = activeView ? people.filter((person) => personMatchesSavedView(person, activeView)) : people;
  const visiblePeople = viewPeople.filter((person) => {
    if (filter === "needs-contact" && person.daysSinceContact <= person.cadenceDays) return false;
    if (filter === "favorites" && !person.favorite) return false;
    if ((filter === "5" || filter === "15" || filter === "50" || filter === "150") && `${person.layer}` !== filter) return false;
    if (groupTags.length && !groupTags.some((tag) => person.groups.some((group) => group.toLowerCase().includes(tag.toLowerCase())))) return false;
    if (query && !`${person.name} ${person.nickname ?? ""} ${person.bio} ${person.groups.join(" ")}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <PageLayout>
      <PageHeader
        eyebrow="PRM"
        title="관계"
        description="연락 리듬, 친밀도, 선물과 관계선을 한 화면에서 정리합니다."
        actions={
          <>
            <Link className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" href="/prm/gifts">
              Gifts
            </Link>
            <Link className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" href="/prm/graph">
              Graph
            </Link>
          </>
        }
      />

      <PersonFilterTabs onChange={setFilter} value={filter} />
      <PageToolbar>
        <SavedViewTabs activeViewKey={activeView?.viewKey ?? activeViewKey} basePath="/prm" views={savedViews} />
        <FilterBar
          filters={[{ kind: "tag", key: "group", label: "Group tag" }]}
          onChange={(state) => {
            setQuery(state.q);
            setGroupTags(Array.isArray(state.filters.group) ? state.filters.group : []);
          }}
          rightSlot={<span className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{visiblePeople.length} people</span>}
          searchPlaceholder="이름, 그룹, 메모 키워드 검색"
        />
      </PageToolbar>

      <PageBody aside={<HitThemUpPanel people={needsContact} />} asideWidth="md">
        <div className="app-grid app-grid-cards">
          {visiblePeople.length ? visiblePeople.map((person) => (
            <PersonCard key={person.id} person={person} />
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
  const hasGifts = typeof view.filterState.hasGifts === "boolean" ? view.filterState.hasGifts : null;
  const linkedDailyEntries = typeof view.filterState.linkedDailyEntries === "boolean" ? view.filterState.linkedDailyEntries : null;

  if (layers.length && !layers.includes(person.layer)) return false;
  if (statuses.length && !statuses.includes(person.status)) return false;
  if (hasGifts !== null && (person.giftsCount > 0) !== hasGifts) return false;
  if (linkedDailyEntries !== null && person.timeline.some((item) => item.kind === "daily_entry") !== linkedDailyEntries) return false;
  return true;
}
