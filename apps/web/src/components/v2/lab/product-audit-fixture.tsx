import { LibraryView } from "@/components/v2/library-view";
import { RecordKnowledge } from "@/components/v2/record-knowledge";
import type { PresentedField, RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";

/** Synthetic inputs for the real product components; no persistence backend is replaced here. */
export function ProductAuditFixture({ kind }: { kind: "library" | "fields" }) {
  if (kind === "library") return <LibraryView totalCount={51} nextCursor="synthetic-next-page" records={[
    { recordId: "audit-mobile-record", title: "모바일에서 열 기록", excerpt: "단일 탭으로 기록을 엽니다.", privacyLevel: "normal", documentStatus: "draft", lifecycleStatus: "active", currentVersion: 1, writtenAt: null, capturedAt: "2026-09-08T01:00:00.000Z", updatedAt: "2026-09-08T01:00:00.000Z", locked: false },
  ]} />;
  const field = (id: string, renderer: PresentedField["renderer"], value: unknown): PresentedField => ({ propertyId: id, fieldKey: id, label: id === "audit-boolean" ? "재방문 의향" : "방문일", dataType: renderer, value, renderer, sourceClass: "ai_inferred", sourceLabel: "AI 제안", claimRisk: "low", reviewStatus: "proposed", lockedByUser: false, evidence: [] });
  const presentation: RecordKnowledgePresentation = {
    contractVersion: "record-presentation-v1", displayType: { typeKey: null, label: "기록", iconKey: "type.note", status: "fallback", tentative: false, recordPresetKey: "record.generic.v1" },
    highlights: [], sections: [], connections: [], modules: [],
    reviewItems: [field("audit-boolean", "boolean", true), field("audit-date", "date", "2026-09-08T09:00:00.000Z")].map((value) => ({ reviewId: value.propertyId, kind: "analysis_review", payload: {}, field: value, requiresHighRiskConfirmation: false })),
  };
  return <main className="v2-product-shell"><RecordKnowledge presentation={presentation} /></main>;
}
