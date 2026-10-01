import { Search, SlidersHorizontal } from "lucide-react";

import { SaveSearchView } from "@/components/v2/save-search-view";
import { SearchResults } from "@/components/v2/search-results";
import type { V2RetrievalResult } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";

const plan = defaultV2QueryPlan({ fullText: "서울숲", typeKeys: ["running_log"] });
const results: readonly V2RetrievalResult[] = [
  { recordId: "search-running", title: "서울숲 아침 달리기", snippet: "오늘 아침 서울숲에서 5km를 달렸다. 전날보다 호흡이 편안했다.", privacyLevel: "normal", capturedAt: "2026-08-12T07:20:00.000Z", writtenAt: null, updatedAt: "2026-08-12T07:20:00.000Z", typeKey: "running_log", typeLabel: "달리기 기록", iconKey: "type.running", inclusionReasons: ["제목에 ‘서울숲’ 포함", "달리기 기록 분류"] },
  { recordId: "search-sensitive", title: "서울숲에서 나눈 대화", snippet: null, privacyLevel: "sensitive", capturedAt: "2026-08-10T19:00:00.000Z", writtenAt: null, updatedAt: "2026-08-10T19:00:00.000Z", typeKey: "conversation", typeLabel: "대화 기록", iconKey: "type.conversation", inclusionReasons: ["원본·OCR·녹취에 ‘서울숲’ 포함"] },
];

export function SearchFixture() {
  return <section aria-label="검색 fixture" className="v2-search-page v2-search-fixture"><div className="v2-search-main"><header><p>키워드와 정확한 조건을 함께 사용합니다</p><h1>기록 검색</h1></header><form className="v2-search-form"><label className="v2-search-query"><Search aria-hidden="true" size={19} /><span>검색어</span><input aria-label="검색어" defaultValue="서울숲" type="search" /><button type="button">검색</button></label><details><summary><SlidersHorizontal aria-hidden="true" size={14} /> 정밀 조건</summary></details></form><div className="v2-search-summary"><span><strong>2</strong>개 결과 · 의미 검색 없이 원문과 구조 조건으로 찾음</span><SaveSearchView plan={plan} /></div><SearchResults queried results={results} /></div></section>;
}
