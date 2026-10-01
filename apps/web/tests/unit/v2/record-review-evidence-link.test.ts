import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { RecordKnowledge } from "@/components/v2/record-knowledge";
import type { RecordKnowledgePresentation } from "@/lib/v2/presentation/record-presentation";

const presentation: RecordKnowledgePresentation = {
  contractVersion: "record-presentation-v1",
  displayType: { typeKey: null, label: "기록", iconKey: "type.document", status: "fallback", tentative: false, recordPresetKey: "record.document.v1" },
  highlights: [], sections: [], connections: [], modules: [],
  reviewItems: [{ reviewId: "review-one", kind: "analysis_review", payload: { code: "field_confirmation" }, requiresHighRiskConfirmation: false,
    field: { propertyId: "property-one", fieldKey: "map_code", label: "Map Code", dataType: "short_text", value: "QX742", renderer: "text", sourceClass: "image_ocr", sourceLabel: "이미지에서 읽음", claimRisk: "low", reviewStatus: "proposed", lockedByUser: false,
      evidence: [{ evidenceId: "evidence-one", sourceItemId: "analysis_source:run-one:image-one", locatorKind: "text_span", locator: { start: 0, end: 5 }, quote: "QX742" }] } }],
};

test("Review evidence opens the matching source on Record while Record keeps its local anchor", () => {
  const review = renderToStaticMarkup(React.createElement(RecordKnowledge, { presentation, sourceRecordId: "record-one" }));
  expect(review).toContain('href="/v2/records/record-one#source-analysis_source%3Arun-one%3Aimage-one"');
  const record = renderToStaticMarkup(React.createElement(RecordKnowledge, { presentation }));
  expect(record).toContain('href="#source-analysis_source%3Arun-one%3Aimage-one"');
});
