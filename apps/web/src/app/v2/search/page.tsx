import { Archive, Compass, Plus, Settings, SlidersHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SearchQueryBox } from "@/components/v2/natural-search-panel";
import { SearchResults } from "@/components/v2/search-results";
import { SearchSortControls } from "@/components/v2/search-sort-controls";
import { SearchPagination } from "@/components/v2/search-pagination";
import { SaveSearchView } from "@/components/v2/save-search-view";
import { SearchTypeSelector } from "@/components/v2/search-type-selector";
import { V2MobileNavigation } from "@/components/v2/mobile-navigation";
import { requireSession } from "@/lib/auth/session";
import { getActiveRestrictedGrant, hasUnexpiredRestrictedGrant } from "@/lib/v2/auth/restricted-grant";
import { getV2ServerFeatureFlags } from "@/lib/v2/config/server-feature-flags";
import { getV2CloudflareBindings } from "@/lib/v2/infrastructure/cloudflare/runtime-bindings";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { readFacetPage } from "@/lib/v2/infrastructure/d1/facet-page-repository";
import { readNaturalQueryCatalog } from "@/lib/v2/infrastructure/d1/natural-query-catalog-repository";
import { parseFacetRequest } from "@/lib/v2/retrieval/facet-page";
import { describeV2QueryPlan, hasV2QueryConditions, pagePlanFromSearchParams } from "@/lib/v2/retrieval/plan-presentation";
import { searchPageFromParams } from "@/lib/v2/retrieval/search-params";
import "../v2-product.css";

export const metadata = { title: "검색 · Light House" };
export const dynamic = "force-dynamic";

export default async function V2SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const flags = getV2ServerFeatureFlags();
  if (!flags.routes) notFound();
  const session = await requireSession();
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
  const { plan, source: planSource, invalid: planInvalid } = pagePlanFromSearchParams(params);
  const queried = hasV2QueryConditions(plan);
  const naturalSearch = flags.ai && Boolean(process.env.GEMINI_API_KEY?.trim());
  // AI-applied or JSON plans are not fully representable by the form controls, so their conditions are listed explicitly.
  const showApplied = queried && (params.get("nl") === "1" || planSource === "plan");
  const db = getV2CloudflareBindings().db;
  const grant = await getActiveRestrictedGrant(db, { userId: session.userId, sessionId: session.sessionId });
  const repository = new D1RetrievalRepository(db, session.userId);
  const selectedType = plan.typeKeys[0] ?? "";
  const [resultPage, typeFacets, catalog] = await Promise.all([queried ? repository.searchPage(plan, Boolean(grant), searchPageFromParams(params)) : { results: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 1 }, readFacetPage(db, session.userId, parseFacetRequest(new URLSearchParams({ kind: "type", ...(selectedType ? { selected: selectedType } : {}) }))), showApplied ? readNaturalQueryCatalog(db, session.userId) : null]);
  if (grant && !hasUnexpiredRestrictedGrant(grant)) notFound();
  const results = resultPage.results;
  const appliedChips = showApplied ? describeV2QueryPlan(plan, {
    types: new Map(catalog?.types.map((type) => [type.key, type.label])), fields: new Map(catalog?.fields.map((field) => [field.key, field.label])),
  }) : [];

  return (
    <main className="v2-search-page">
      <aside className="v2-search-sidebar">
        <Link className="v2-library-brand" href="/v2/library"><span>LH</span><strong>Light House</strong></Link>
        <Link className="v2-library-new" href="/v2/capture"><Plus aria-hidden="true" size={18} /> 새 기록</Link>
        <nav aria-label="주요 탐색"><Link href="/v2/library"><Archive aria-hidden="true" size={17} /> 보관함</Link><Link href="/v2/explore"><Compass aria-hidden="true" size={17} /> 탐색</Link><Link href="/v2/review"><Sparkles aria-hidden="true" size={17} /> 확인할 내용</Link></nav>
        <Link className="v2-library-settings" href="/settings"><Settings aria-hidden="true" size={17} /> 설정</Link>
      </aside>
      <section className="v2-search-main">
        <header><p>키워드와 정확한 조건을 함께 사용합니다</p><h1>기록 검색</h1></header>
        <form className="v2-search-form" method="get">
          {params.get("entity") ? <input name="entity" type="hidden" value={params.get("entity") ?? ""} /> : null}
          <SearchQueryBox key={params.toString()} defaultQuery={params.get("q") ?? (planSource === "plan" ? plan.fullText ?? "" : "")} naturalSearch={naturalSearch} />
          <details open={Boolean(plan.typeKeys.length || plan.propertyFilters.length || plan.dateFilter)}><summary><SlidersHorizontal aria-hidden="true" size={14} /> 정밀 조건</summary><div className="v2-search-filters">
            <SearchTypeSelector key={`${params.toString()}:${JSON.stringify(typeFacets)}`} initialPage={typeFacets} selectedKey={selectedType} />
            <label>최소 평점<select defaultValue={params.get("rating") ?? ""} name="rating"><option value="">상관없음</option><option value="3">3.0 이상</option><option value="4">4.0 이상</option><option value="4.5">4.5 이상</option></select></label>
            <label>시작일<input defaultValue={params.get("from") ?? ""} name="from" type="date" /></label><label>종료일<input defaultValue={params.get("to") ?? ""} name="to" type="date" /></label>
            <SearchSortControls sort={plan.sort} />
          </div></details>
        </form>
        {planInvalid ? <p className="v2-product-error" role="alert">주소에 담긴 검색 조건을 읽지 못했습니다. 조건을 다시 입력해 주세요.</p> : null}
        {showApplied ? <section aria-labelledby="v2-applied-conditions-heading" className="v2-applied-conditions">
          <header><h2 id="v2-applied-conditions-heading">{params.get("nl") === "1" ? "AI가 해석한 조건으로 검색했습니다" : "적용한 검색 조건"}</h2><Link href="/v2/search">조건 지우기</Link></header>
          <ul aria-label="적용한 검색 조건" className="v2-natural-result__chips">{appliedChips.map((chip, index) => <li key={`${chip.kind}-${index}`} data-kind={chip.kind}><span>{chip.label}</span> <strong>{chip.value}</strong></li>)}</ul>
          {params.get("nl") === "1" ? <p>결과는 AI가 아니라 저장된 기록에서 위 조건과 정확히 일치하는 기록을 찾은 것입니다.</p> : null}
        </section> : null}
        <div className="v2-search-summary"><span>{queried ? <><strong>{resultPage.totalCount}</strong>개 결과 · 현재 {results.length}개 표시{plan.entityFilters.length ? " · 선택한 대상과 연결" : ""}</> : "검색어 또는 조건을 입력하세요"}</span>{queried ? <SaveSearchView plan={plan} /> : null}</div>
        <SearchResults queried={queried} results={results} queryPlan={plan} />
        <SearchPagination page={resultPage.page} totalPages={resultPage.totalPages} pathname="/v2/search" query={params.toString()} />
      </section>
      <V2MobileNavigation active="search" />
    </main>
  );
}
