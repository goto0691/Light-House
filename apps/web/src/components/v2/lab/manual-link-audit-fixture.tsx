import { RecordSourceMaterials } from "@/components/v2/record-source-materials";
import { makeManualLinkMetadata, type ManualLinkInput } from "@/lib/v2/domain/manual-link-source";
import type { V2RecordProjection } from "@/lib/v2/infrastructure/d1/source-foundation-repository";

const promptText = "  synthetic prompt: window light\r\nkeep  double spaces\r\n  ";

function source(id: string, displayOrder: number, rawText: string, input: ManualLinkInput): V2RecordProjection["sources"][number] {
  return {
    id, displayOrder, rawText, kind: "url", contentHash: "synthetic-fixture-not-a-verified-hash",
    attachmentId: null, filename: null, mimeType: null, sizeBytes: null,
    manualLink: makeManualLinkMetadata(input).manualLinkV1,
  };
}

/** Synthetic input for real React rendering, not source acquisition or persistence evidence. */
export function ManualLinkAuditFixture() {
  const sources: V2RecordProjection["sources"] = [
    source("manual-prompt", 0, promptText, { url: "https://example.com/synthetic-prompt", purpose: "prompt", role: "prompt", completeness: "partial", partNumber: 1, totalParts: 3 }),
    source("manual-ocr", 1, "수평선 O도를 확인", { url: "https://example.com/synthetic-composition", purpose: "visual_tip", role: "caption", completeness: "ocr_unverified" }),
    source("manual-transcript", 2, "02:00 지금 보이는 것은 사용자가 제공한 자막입니다.", { url: "https://example.com/synthetic-video", purpose: "video_note", role: "transcript", completeness: "partial", startSeconds: 120, endSeconds: 300 }),
    source("manual-link-only", 3, "", { url: "https://example.com/synthetic-insight", purpose: "insight", completeness: "unknown" }),
    { id: "manual-image", displayOrder: 4, rawText: null, kind: "image", contentHash: "synthetic-fixture-not-a-verified-hash", attachmentId: "manual-synthetic-image", filename: "synthetic-reference.png", mimeType: "image/png", sizeBytes: 1, manualLink: null },
  ];
  return <main className="v2-product-shell"><article className="v2-product-card"><h1>수동 링크 보관 · 실제 컴포넌트 검증</h1><p>합성 자료입니다. 외부 수집, AI 분석, 실제 원본 보관을 검증한 화면이 아닙니다. 첨부 이미지는 테스트에서만 응답을 대체합니다.</p><RecordSourceMaterials sources={sources} /></article></main>;
}
