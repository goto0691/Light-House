import { SearchQueryBox } from "@/components/v2/natural-search-panel";
import { SearchSortControls } from "@/components/v2/search-sort-controls";

/** Browser fixture for the natural-language interpretation panel. API responses are synthetic in e2e specs. */
export function NaturalSearchAuditFixture() {
  return <main className="v2-search-page v2-search-fixture">
    <section className="v2-search-main">
      <header><p>키워드와 정확한 조건을 함께 사용합니다</p><h1>기록 검색</h1></header>
      <form action="/v2/search" className="v2-search-form" method="get">
        <SearchQueryBox defaultQuery="" naturalSearch />
        <details open><summary>정밀 조건</summary><div className="v2-search-filters">
          <SearchSortControls sort={{ field: "written_at", direction: "asc" }} />
        </div></details>
      </form>
    </section>
  </main>;
}
