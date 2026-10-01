"use client";

import { useState } from "react";
import { SaveSearchView } from "@/components/v2/save-search-view";
import { SavedViewActions } from "@/components/v2/saved-view-actions";
import { SearchResults } from "@/components/v2/search-results";
import type { V2RetrievalResult } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { recordLocationTextHash, type V2RecordLocationV1 } from "@/lib/v2/retrieval/record-location-v1";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import type { V2SavedViewField } from "@/lib/v2/retrieval/saved-view-fields";

const initial: V2SavedViewDisplay = { layout: "list", density: "comfortable", groupBy: null, visibleFields: ["user_rating", "@record.captured_at", "legacy_custom"] };
const plan = defaultV2QueryPlan({ fullText: "archive" });
const location: V2RecordLocationV1 = { contract: "record-location.v1", kind: "source", sourceItemId: "display-source", snapshotId: null, memberId: null, manifestHash: null, textHash: recordLocationTextHash("archive keyword"), range: { start: 0, end: 7 } };
const records: readonly V2RetrievalResult[] = ["c", "a", "b", "sensitive"].map((id, index) => {
  const fields: V2SavedViewField[] = [
    { fieldKey: "user_rating", label: "내 평점", state: index === 1 ? "conflict" : index === 2 ? "missing" : "value", values: index === 2 ? [] : (index === 1 ? [2, 4] : [4.5]).map((value, position) => ({ propertyId: `rating-${index}-${position}`, value, renderer: "rating", unit: null, sourceLabel: "직접 입력", lockedByUser: index === 0 })) },
    { fieldKey: "@record.captured_at", label: "보관일", state: "value", values: [{ propertyId: null, value: index === 2 ? "2026-10-01" : "2026-09-01", renderer: "date", unit: null, sourceLabel: "기록 메타데이터", lockedByUser: false }] },
    { fieldKey: "@record.written_at", label: "작성일", state: index === 1 ? "missing" : "value", values: index === 1 ? [] : [{ propertyId: null, value: "2026-08-01", renderer: "date", unit: null, sourceLabel: "기록 메타데이터", lockedByUser: false }] },
    { fieldKey: "captured_at", label: "사용자 보관 메모", state: "value", values: [{ propertyId: "user-captured-key", value: "직접 적은 사용자 필드", renderer: "text", unit: null, sourceLabel: "직접 입력", lockedByUser: false }] },
    { fieldKey: "legacy_custom", label: "legacy_custom", state: "missing", values: [] },
    { fieldKey: "metadata_json", label: "부가 데이터", state: "value", values: [{ propertyId: "json-one", value: '{"literal":"<script>not executable</script>"}', renderer: "json", unit: null, sourceLabel: "직접 입력", lockedByUser: false }] },
  ];
  return { recordId: `display-record-${id}`, title: `기록 ${id}`, snippet: index === 2 ? null : `보관 문맥 ${id}`, privacyLevel: id === "sensitive" ? "sensitive" : "normal", capturedAt: index === 2 ? "2026-10-01T00:00:00Z" : "2026-09-01T00:00:00Z", writtenAt: index === 1 ? null : "2026-08-01T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", typeKey: index === 1 ? "book" : "game", typeLabel: index === 1 ? "책" : "게임", iconKey: "type.note", inclusionReasons: ["확인된 검색 조건 일치"],
    matches: index === 0 ? [{ id: "display-match", origin: "external_source", label: "보관 원문", snippet: "정확한 archive 근거", location, reviewStatus: null, isHistorical: true }] : [], matchCount: index === 0 ? 2 : 0,
    displayFields: id === "sensitive" ? fields.map((field) => ({ ...field, state: "private" as const, values: [] })) : fields };
});

export function SavedViewDisplayAuditFixture() {
  const [display, setDisplay] = useState(initial), [revision, setRevision] = useState(recordLocationTextHash(JSON.stringify(initial)));
  return <main className="v2-product-shell"><section className="v2-product-card v2-saved-view-page"><h1>저장 목록 표시 검증</h1><p>합성 UI·HTTP 대역 화면이며 실제 사용자 자료 검증이 아닙니다.</p>
    <pre data-testid="saved-view-display-fixture-data" hidden>{JSON.stringify({ initial, revision, plan, recordIds: records.map((record) => record.recordId) })}</pre>
    <SaveSearchView plan={plan} />
    <SavedViewActions viewId="display-view" pinned={false} display={display} displayRevision={revision} onDisplaySaved={(value, nextRevision) => { setDisplay(value); setRevision(nextRevision); }} />
    <nav aria-label="표시 검증 전환">{(["list", "cards", "timeline", "table"] as const).map((layout) => <button type="button" key={layout} onClick={() => setDisplay((value) => ({ ...value, layout }))}>{{ list: "목록 보기", cards: "카드 보기", timeline: "타임라인 보기", table: "표 보기" }[layout]}</button>)}<label>검증용 묶음<select value={display.groupBy ?? ""} onChange={(event) => setDisplay((value) => ({ ...value, groupBy: (event.target.value || null) as V2SavedViewDisplay["groupBy"] }))}><option value="">없음</option><option value="type">분류</option><option value="captured_month">보관 월</option><option value="written_month">작성 월</option></select></label></nav>
    <p data-testid="saved-display-layout">저장된 표시: {display.layout} · {display.density}</p>
    <SearchResults queried results={records} queryPlan={plan} display={display} />
  </section></main>;
}
