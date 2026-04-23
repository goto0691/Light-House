"use client";

import Link from "next/link";
import { useState } from "react";

import { HitThemUpPanel } from "@/components/prm/hit-them-up-panel";
import { PersonCard } from "@/components/prm/person-card";
import { PersonFilterTabs, type PersonFilterKey } from "@/components/prm/person-filter-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { GlassCard } from "@/components/shared/glass-card";
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
    <section className="space-y-4">
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">PRM</p>
            <h1 className="mt-3 font-display text-4xl text-foreground">관계 관리 허브</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Hit Them Up, Favorites, Dunbar 레이어를 한 화면에서 훑고 사람 Drawer로 바로 들어가는 중심 허브입니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" href="/prm/gifts">
              Gifts
            </Link>
            <Link className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-white/8 hover:text-foreground" href="/prm/graph">
              Graph
            </Link>
          </div>
        </div>
      </GlassCard>

      <PersonFilterTabs onChange={setFilter} value={filter} />
      <FilterBar
        filters={[]}
        onChange={(state) => setQuery(state.q)}
        rightSlot={<span className="rounded-full border border-white/10 bg-black/10 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{visiblePeople.length} people</span>}
        searchPlaceholder="이름, 그룹, 메모 키워드 검색"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visiblePeople.length ? visiblePeople.map((person) => (
            <PersonCard key={person.id} person={person} />
          )) : (
            <div className="md:col-span-2 2xl:col-span-3">
              <EmptyState description="검색어나 레이어 탭을 조정하면 다른 관계가 다시 보입니다." illustration="person" title="이 조건에 맞는 사람이 없습니다" />
            </div>
          )}
        </div>
        <HitThemUpPanel people={needsContact} />
      </div>
    </section>
  );
}
