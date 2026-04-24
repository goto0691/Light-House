"use client";

import Link from "next/link";
import { useState } from "react";

import { HitThemUpPanel } from "@/components/prm/hit-them-up-panel";
import { PersonCard } from "@/components/prm/person-card";
import { PersonFilterTabs, type PersonFilterKey } from "@/components/prm/person-filter-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageBody, PageHeader, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { usePRMStore } from "@/stores/use-prm-store";

export function PRMClient() {
  const people = usePRMStore((state) => state.people);
  const [filter, setFilter] = useState<PersonFilterKey>("all");
  const [query, setQuery] = useState("");
  const needsContact = people
    .filter((person) => person.daysSinceContact > person.cadenceDays)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);
  const visiblePeople = people.filter((person) => {
    if (filter === "needs-contact" && person.daysSinceContact <= person.cadenceDays) return false;
    if (filter === "favorites" && !person.favorite) return false;
    if ((filter === "5" || filter === "15" || filter === "50" || filter === "150") && `${person.layer}` !== filter) return false;
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
        <FilterBar
          filters={[]}
          onChange={(state) => setQuery(state.q)}
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
