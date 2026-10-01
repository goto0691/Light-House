export type AnalysisExtractionSource = Readonly<{
  kind: "image_ocr" | "transcript_extract" | "document_extract";
  originalSourceItemId: string;
}>;

/** Read only the provenance written by the analysis runner. Unknown metadata stays unclassified. */
export function readAnalysisExtractionSource(value: unknown): AnalysisExtractionSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (metadata.purpose !== "analysis_extraction"
    || !["image_ocr", "transcript_extract", "document_extract"].includes(String(metadata.extraction_kind))
    || typeof metadata.derived_from_source_item_id !== "string"
    || !metadata.derived_from_source_item_id.trim()
    || typeof metadata.processing_run_id !== "string"
    || !metadata.processing_run_id.trim()) return null;
  return {
    kind: metadata.extraction_kind as AnalysisExtractionSource["kind"],
    originalSourceItemId: metadata.derived_from_source_item_id,
  };
}

export function analysisExtractionLabel(kind: AnalysisExtractionSource["kind"]) {
  if (kind === "image_ocr") return "이미지에서 읽은 텍스트 · AI 추출";
  if (kind === "transcript_extract") return "음성·영상에서 읽은 텍스트 · AI 추출";
  return "문서에서 읽은 텍스트 · AI 추출";
}
