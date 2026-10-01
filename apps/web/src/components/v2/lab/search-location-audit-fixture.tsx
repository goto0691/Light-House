"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { RecordSearchLocation } from "@/components/v2/record-search-location";
import { SearchResults } from "@/components/v2/search-results";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { parseRecordLocationParam, recordLocationTextHash, serializeRecordLocation, type V2RecordLocationV1, type V2RetrievalMatch } from "@/lib/v2/retrieval/record-location-v1";

const original = "  오래 보관한 window light\r\n두 번  띄고 👩‍💻 그대로\r\n끝 공백  ";
const interpretation = "합성 AI 해석: window light는 안정적인 구도다.";
const curation = "  첫 번째 window light\r\n두 번째 조각  ";
const snapshot = { snapshotId: "snapshot-before-page-51", manifestHash: "a".repeat(64), sourceItemId: "source-before-page-51", memberId: "member-before-page-51" };
const range = { start: original.indexOf("window light"), end: original.indexOf("window light") + "window light".length };
const base = { contract: "record-location.v1" as const, textHash: recordLocationTextHash(original), range };
const locations: Readonly<Record<string, V2RecordLocationV1>> = {
  source: { ...base, ...snapshot, kind: "source" },
  manual: { ...base, ...snapshot, kind: "manual_fragment", fragmentId: "manual-before-page-51" },
  ai: { ...base, ...snapshot, kind: "ai_fragment", fragmentId: "ai-before-page-51", runId: "run-before-page-27", textHash: recordLocationTextHash(interpretation), range: { start: interpretation.indexOf("window light"), end: interpretation.indexOf("window light") + 12 } },
  curation: { ...base, kind: "curation", snapshotId: snapshot.snapshotId, manifestHash: snapshot.manifestHash, groupKey: "group-before-page-51", revisionId: "curation-before-page-27", role: "prompt", textHash: recordLocationTextHash(curation), range: { start: curation.indexOf("window light"), end: curation.indexOf("window light") + 12 } },
};
const allMatches: V2RetrievalMatch[] = Array.from({ length: 52 }, (_, index) => {
  const first = index === 1 ? { location: locations.manual, origin: "manual_extract" as const, label: "수동 발췌" } : index === 2 ? { location: locations.ai, origin: "ai_interpretation" as const, label: "AI 해석" } : { location: { ...locations.source, sourceItemId: `source-match-${index + 1}`, memberId: `member-match-${index + 1}` } as V2RecordLocationV1, origin: "external_source" as const, label: `보관 원문 ${index + 1}` };
  return { id: `match-${index + 1}`, ...first, snippet: `합성 검색 문맥 ${index + 1}`, reviewStatus: index === 2 ? "rejected" : null, isHistorical: true };
});
const plan = defaultV2QueryPlan({ fullText: "window light", propertyFilters: [{ fieldKey: "user_rating", operator: "lte", value: 4.5 }], dateFilter: { axis: "written_at", from: "2026-01-01", to: "2026-09-12" } });
const normal = { recordId: "search-location-fixture", title: "합성 검색 위치 기록", snippet: "보관한 자료의 window light", privacyLevel: "normal" as const, capturedAt: "2026-09-01T00:00:00Z", writtenAt: null, updatedAt: "2026-09-12T00:00:00Z", typeKey: "reference", typeLabel: "자료", iconKey: "type.note", inclusionReasons: ["출처별 보관 텍스트 일치"], matches: allMatches.slice(0, 3), matchCount: 52 };
const results = [normal, { ...normal, recordId: "search-location-sensitive", title: "민감 기록", privacyLevel: "sensitive" as const, snippet: "노출하면 안 되는 합성 비공개 문맥", matches: allMatches.slice(0, 1).map((match) => ({ ...match, snippet: "노출하면 안 되는 합성 비공개 근거" })), matchCount: 1 }];

/** Controlled UI fixture only; the browser tests separately supply exact API responses. */
export function SearchLocationAuditFixture() {
  const query = useSearchParams();
  const router = useRouter();
  const [draft, setDraft] = useState("현재 초안은 유지합니다.");
  let location: V2RecordLocationV1 | null = null, invalid = false;
  try { location = parseRecordLocationParam(query.getAll("loc").length > 1 ? query.getAll("loc") : query.get("loc")); }
  catch { invalid = true; }
  function navigate(next: V2RecordLocationV1) {
    router.push(`/v2-lab?${new URLSearchParams({ surface: "search-location", loc: serializeRecordLocation(next) })}`, { scroll: false });
  }
  return <main className="v2-product-shell">
    <h1>정확 검색 위치 검증 화면</h1><p>합성 자료·API 대역 검증 · 실제 제공자 또는 실제 사용자 자료 검증 아님</p>
    <pre data-testid="search-location-fixture-data" hidden>{JSON.stringify({ locations, texts: { source: original, manual: original, ai: interpretation, curation }, allMatches, plan })}</pre>
    <section aria-label="현재 기록과 초안"><h2>현재 기록</h2><p>현재 기록 본문은 바꾸지 않습니다.</p><label>현재 편집 초안<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label></section>
    <nav aria-label="검색 위치 전환">{Object.entries(locations).map(([kind, value]) => <button type="button" key={kind} onClick={() => navigate(value)}>{kind === "source" ? "이전 자료 검색 위치" : kind === "manual" ? "수동 발췌 검색 위치" : kind === "ai" ? "AI 해석 검색 위치" : "정리본 검색 위치"}</button>)}<button type="button" onClick={() => router.push("/v2-lab?surface=search-location", { scroll: false })}>현재 기록만 표시</button></nav>
    <RecordSearchLocation ownerId="search-location-owner" recordId="search-location-fixture" location={location} invalid={invalid} />
    <SearchResults queried results={results} queryPlan={plan} />
  </main>;
}
