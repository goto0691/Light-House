"use client";

import { useState } from "react";
import { SearchResults } from "@/components/v2/search-results";
import type { V2RetrievalResult } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";

/** Synthetic previews only. Full values are supplied by the browser HTTP fixture on demand. */
export function SavedFieldReaderAuditFixture() {
  const [version, setVersion] = useState(1), [layout, setLayout] = useState<V2SavedViewDisplay["layout"]>("list"), [mounted, setMounted] = useState(true), [json, setJson] = useState(false);
  const fieldKey = json ? "long_json" : "long_note";
  const records: V2RetrievalResult[] = ["normal", "sensitive", "restricted"].map((privacy, index) => ({
    recordId: index ? `reader-${privacy}` : `reader-record-${version}`, title: index ? `${privacy} 시험 기록` : `긴 필드 시험 기록 ${version}`,
    snippet: index ? null : "보관된 긴 값의 일부만 목록에 표시합니다.", privacyLevel: privacy as V2RetrievalResult["privacyLevel"],
    capturedAt: "2026-09-22T00:00:00Z", writtenAt: null, updatedAt: "2026-09-22T00:00:00Z", typeKey: "note", typeLabel: "기록", iconKey: "type.note",
    inclusionReasons: ["표시 검증용 합성 기록"], matches: [], matchCount: 0,
    displayFields: [{ fieldKey, label: "긴 메모", state: "value", values: [{ propertyId: `reader-property-${version}`, renderer: json ? "json" : "text", sourceLabel: "직접 입력", lockedByUser: true, unit: null,
      value: json ? '{ "literal": "JSON 미리보기 ' + "다".repeat(232) : version === 1 ? '"목록 미리보기 ' + "가".repeat(244) : '"새 기록 미리보기 ' + "나".repeat(243), preview: { format: "stored_json", totalBytes: 26000 } }] }],
  }));
  return <main className="v2-product-shell"><section className="v2-product-card v2-saved-view-page"><h1>긴 필드 읽기 검증</h1><p>실제 컴포넌트·합성 HTTP 시험입니다. 개인 자료나 실제 공급자 검증이 아닙니다.</p>
    <nav aria-label="긴 필드 시험 설정">{(["list", "cards", "timeline", "table"] as const).map((item) => <button type="button" key={item} onClick={() => setLayout(item)}>{item} 보기</button>)}<button type="button" onClick={() => setVersion((current) => current + 1)}>기록 교체</button><button type="button" onClick={() => setJson((value) => !value)}>필드 형식 교체</button><button type="button" onClick={() => setMounted((current) => !current)}>{mounted ? "시험 결과 숨기기" : "시험 결과 보이기"}</button></nav>
    {mounted ? <SearchResults queried results={records} display={{ layout, density: "comfortable", groupBy: null, visibleFields: [fieldKey] }} /> : null}
  </section></main>;
}
