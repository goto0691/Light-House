import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { RecordSourceMaterials } from "@/components/v2/record-source-materials";
import { readAnalysisExtractionSource } from "@/lib/v2/domain/analysis-extraction-source";
import type { V2RecordProjection } from "@/lib/v2/infrastructure/d1/source-foundation-repository";

test("labels derived image text separately from the stored original and links back to its attachment", () => {
  const sources: V2RecordProjection["sources"] = [
    { id: "image-one", kind: "image", displayOrder: 0, rawText: null, contentHash: "hash-one", attachmentId: "attachment-one", filename: "synthetic.png", mimeType: "image/png", sizeBytes: 4, manualLink: null },
    { id: "analysis_source:run-one:image-one", kind: "text", displayOrder: 1, rawText: "합성 지도 코드 QX742", contentHash: "hash-two", attachmentId: null, filename: null, mimeType: null, sizeBytes: null, manualLink: null,
      analysisExtraction: { kind: "image_ocr", originalSourceItemId: "image-one" } },
  ];
  const html = renderToStaticMarkup(React.createElement(RecordSourceMaterials, { sources }));
  expect(html).toContain("이미지에서 읽은 텍스트 · AI 추출");
  expect(html).toContain("AI 추출 텍스트 복사");
  expect(html).toContain("첨부 원본으로");
  expect(html).toContain('href="#source-image-one"');
  expect(html).not.toContain("text 원본");
});

test("only runner-shaped metadata receives AI extraction provenance", () => {
  expect(readAnalysisExtractionSource({ purpose: "analysis_extraction", extraction_kind: "image_ocr", derived_from_source_item_id: "image-one", processing_run_id: "run-one" }))
    .toEqual({ kind: "image_ocr", originalSourceItemId: "image-one" });
  expect(readAnalysisExtractionSource({ purpose: "analysis_extraction", extraction_kind: "image_ocr", derived_from_source_item_id: "image-one" })).toBeNull();
  expect(readAnalysisExtractionSource({ purpose: "analysis_extraction", extraction_kind: "unknown", derived_from_source_item_id: "image-one", processing_run_id: "run-one" })).toBeNull();
});
