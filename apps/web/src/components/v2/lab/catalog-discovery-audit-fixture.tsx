"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FacetExplorePanels } from "@/components/v2/facet-explore-panels";
import { SearchTypeSelector } from "@/components/v2/search-type-selector";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";
import { FACET_PAGE_CONTRACT, type FacetItem, type FacetKind, type FacetPage } from "@/lib/v2/retrieval/facet-page";

function items(kind: FacetKind): FacetItem[] {
  if (kind === "month") return [...Array.from({ length: 40 }, (_, index) => { const date = new Date(Date.UTC(2026, 8 - index, 1)), key = date.toISOString().slice(0, 7); return { key, label: key, count: 1, entityKind: null }; }), { key: "0000-02", label: "0000-02", count: 1, entityKind: null }];
  return Array.from({ length: kind === "type" ? 75 : 82 }, (_, index) => ({ key: `${kind}_${String(index).padStart(3, "0")}`, label: `${kind === "type" ? "분류" : "대상"} ${String(index).padStart(3, "0")}`, count: 100 - index, entityKind: kind === "entity" ? "person" : null }));
}
function fixturePage(kind: FacetKind, query = "", requestedPage = 1, selectedKey: string | null = null): FacetPage {
  const all = items(kind), filtered = all.filter((item) => item.label.includes(query) || item.key.includes(query));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20)), page = Math.min(Math.max(1, requestedPage), totalPages);
  return { contract: FACET_PAGE_CONTRACT, kind, query, page, pageSize: 20, totalCount: filtered.length, totalPages, items: filtered.slice((page - 1) * 20, page * 20), selected: all.find((item) => item.key === selectedKey) ?? null };
}
function Content() {
  const params = useSearchParams(), [unknown, setUnknown] = useState(false), [submitted, setSubmitted] = useState(""), [navigationMounted, setNavigationMounted] = useState(true);
  const timerNavigation = params.get("timer_navigation") === "1";
  const selectedKey = unknown ? "unknown_type" : "type_070", initial = fixturePage("type", "", 1, selectedKey);
  const query = params.toString(), pages = (["type", "entity", "month"] as const).map((kind) => fixturePage(kind, params.get(`${kind}_q`) ?? "", Number(params.get(`${kind}_page`) ?? "1")));
  return <main className="v2-product-shell" style={{ paddingBottom: 100 }}><section className="v2-product-card"><h1>전체 탐색 검증</h1><p>실제 UI와 합성 목록·HTTP 대역입니다. 실제 개인 자료 검증은 아닙니다.</p>
    <form aria-label="기록 검색 시험" onSubmit={(event) => { event.preventDefault(); setSubmitted(new URLSearchParams([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value)])).toString()); }}>
      <label>기록 검색어<input name="q" defaultValue="archive" /></label><SearchTypeSelector key={selectedKey} initialPage={initial} selectedKey={selectedKey} /><button type="submit">기록 검색 실행</button>
    </form><p data-testid="facet-submitted">{submitted || "아직 제출 안 함"}</p><button type="button" onClick={() => setUnknown((value) => !value)}>분류 선택 대상 교체</button>
    {timerNavigation ? <button type="button" onClick={() => setNavigationMounted(false)}>모바일 탐색 제거</button> : null}
    <FacetExplorePanels key={query} pages={pages} query={query} pathname="/v2-lab" />
  </section>{navigationMounted ? <V2MobileNavigation active="explore" moreHrefOverrides={timerNavigation ? { templates: "/v2-lab?surface=product-library" } : undefined} /> : null}</main>;
}
export function CatalogDiscoveryAuditFixture() { return <Suspense fallback={<p>탐색 검증 준비 중</p>}><Content /></Suspense>; }
