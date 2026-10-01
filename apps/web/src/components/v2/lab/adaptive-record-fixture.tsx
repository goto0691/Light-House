"use client";

import { FileText } from "lucide-react";

import { RecordKnowledge, RecordTypeBadge } from "@/components/v2/record-knowledge";
import type { PresentedField, RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";

const evidence = [{
  evidenceId: "evidence-running-1",
  sourceItemId: "source-running-1",
  locatorKind: "text_span",
  locator: { start: 18, end: 31 },
  quote: "오늘 아침 5km를 31분 12초에 달렸다.",
}] as const;

const distance: PresentedField = {
  propertyId: "property-distance", fieldKey: "distance", label: "거리", dataType: "decimal", value: 5,
  renderer: "number", sourceClass: "user_explicit", sourceLabel: "원문에서 명시함", claimRisk: "low",
  reviewStatus: "accepted", lockedByUser: false, evidence,
};

const duration: PresentedField = {
  propertyId: "property-duration", fieldKey: "duration", label: "운동 시간(분)", dataType: "decimal", value: 31.2,
  renderer: "number", sourceClass: "image_ocr", sourceLabel: "이미지에서 읽음", claimRisk: "low",
  reviewStatus: "accepted", lockedByUser: false, evidence: [{ ...evidence[0], evidenceId: "evidence-running-2", locatorKind: "image_region", quote: "운동 앱 캡처 · 31:12" }],
};

const proposedIntent: PresentedField = {
  propertyId: "property-intent", fieldKey: "other_person_intent", label: "함께 뛴 사람의 의도", dataType: "short_text", value: "관계를 회복하고 싶어 했다",
  renderer: "text", sourceClass: "ai_inferred", sourceLabel: "AI 해석", claimRisk: "social_high_risk",
  reviewStatus: "proposed", lockedByUser: false, evidence,
};

const presentation: RecordKnowledgePresentation = {
  contractVersion: "record-presentation-v1",
  displayType: { typeKey: "running_log", label: "달리기 기록", iconKey: "type.running", status: "candidate", tentative: true, recordPresetKey: "record.workout.v1" },
  highlights: [distance, duration],
  sections: [{ key: "user_facts", title: "내 기록", fields: [distance, duration] }],
  connections: [{
    relationId: "relation-park", predicateKey: "mentions_entity", predicateLabel: "언급한 대상", targetObjectId: "entity-park",
    targetKind: "entity", targetLabel: "서울숲", sourceLabel: "AI 해석", evidence,
  }],
  modules: [{
    moduleKey: "workout.metrics.v1", presentationVersion: 1, presentationKind: "metric_grid", title: "활동 수치",
    fields: [distance, duration], sourceLabels: ["원문에서 명시함", "이미지에서 읽음"], previewPolicy: "full",
  }],
  reviewItems: [
    {
      reviewId: "review-type", kind: "analysis_review", payload: { code: "type_confirmation", target: "type", key: "running_log", label: "달리기 기록" },
      field: null, requiresHighRiskConfirmation: false,
    },
    {
      reviewId: "review-intent", kind: "high_risk_claim", payload: { code: "field_confirmation", fieldKey: "other_person_intent", proposalTempId: "proposal-intent" },
      field: proposedIntent, requiresHighRiskConfirmation: true,
    },
  ],
};

export function AdaptiveRecordFixture() {
  return (
    <section aria-label="적응형 기록 표현 fixture" className="v2-product-shell v2-adaptive-fixture">
      <article className="v2-product-card v2-record-page">
        <header className="v2-record-heading">
          <RecordTypeBadge presentation={presentation} />
          <p>2026. 8. 12. 오전 7:20</p>
          <h1>서울숲 아침 달리기</h1>
          <span className="v2-record-privacy">normal</span>
        </header>
        <RecordKnowledge presentation={{ ...presentation, sections: [], connections: [], modules: [], reviewItems: [] }} />
        <div className="v2-record-markdown" data-testid="adaptive-record-body">
          <p>오늘 아침 서울숲에서 5km를 31분 12초에 달렸다.</p>
          <p>친구와 함께 달렸고, 지난 대화 이후 조금 편해진 느낌이 들었다.</p>
        </div>
        <RecordKnowledge presentation={{ ...presentation, highlights: [] }} />
        <section aria-labelledby="adaptive-source-heading" className="v2-record-sources">
          <h2 id="adaptive-source-heading">원본과 첨부</h2>
          <ul><li id="source-source-running-1"><FileText aria-hidden="true" size={17} /><span><strong>운동 메모와 앱 캡처</strong><small>텍스트 원문 · 이미지 1개</small></span><a className="v2-record-original" href="#field-property-distance">관련 필드로</a></li></ul>
        </section>
      </article>
    </section>
  );
}
