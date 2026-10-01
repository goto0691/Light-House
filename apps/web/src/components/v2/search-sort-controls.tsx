import type { V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";
import "./search-sort-controls.css";

/** The form displays and resubmits the same validated ordering used by retrieval. */
export function SearchSortControls({ sort }: { sort: V2RetrievalQueryPlanV1["sort"] }) {
  return <>
    <label>정렬<select className="v2-search-sort-control" key={sort.field} defaultValue={sort.field} name="sort">
      <option value="relevance">관련도</option>
      <option value="updated_at">수정일</option>
      <option value="captured_at">기록일</option>
      <option value="written_at">작성·경험일</option>
      <option value="title">제목</option>
    </select></label>
    <label>정렬 방향<select className="v2-search-sort-control" key={sort.direction} defaultValue={sort.direction} name="direction">
      <option value="desc">내림차순</option>
      <option value="asc">오름차순</option>
    </select></label>
  </>;
}
