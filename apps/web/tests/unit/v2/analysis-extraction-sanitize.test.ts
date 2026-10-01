import { describe, expect, test } from "vitest";

import { anchorEvidenceQuotes, anchorEvidenceQuotesInDraft, validateAnalysisEnvelopeV1, type AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { dropUnrequestedSourceExtractions } from "@/lib/v2/ai/processing-runner";

const text = "합성 검증 글: 파란 종이비행기를 만들었다. 별점 4.5/5.";
function envelope(extractions: { source_item_id: string; text: string; kind: string }[]) {
  return { contract_version: "analysis-v1", capture_id: "C", analyzed_revision_id: "R", language: "ko", bundle_summary: "요약",
    source_extractions: extractions, document_proposals: [], entity_proposals: [], event_proposals: [],
    field_proposals: [{ temp_id: "f1", field_key: "rating", value: 4.5, value_type: "rating", claim_risk: "low", disposition: "accepted",
      evidence_refs: [{ source_item_id: "text-source", start: 28, end: 33 }] }],
    enrichment_requests: [], review_items: [], warnings: [] };
}
const context = (attachments: [string, string][] = []) => ({ captureId: "C", revisionId: "R",
  sourceLengths: new Map<string, number | null>([["text-source", text.length], ...attachments.map(([id]) => [id, null] as [string, null])]), attachmentKinds: new Map(attachments) });

describe("unrequested source extractions (observed from a live Gemini response)", () => {
  test("an extraction for a text source is dropped with a warning instead of failing the whole analysis", () => {
    const raw = envelope([{ source_item_id: "text-source", text, kind: "document_extract" }]);
    expect(() => validateAnalysisEnvelopeV1(raw, context())).toThrow(/unique attachment/);
    const cleaned = validateAnalysisEnvelopeV1(dropUnrequestedSourceExtractions(raw, new Map()), context());
    expect(cleaned.source_extractions).toEqual([]);
    expect(cleaned.warnings).toEqual(["unrequested_source_extraction_dropped:1"]);
    expect(cleaned.field_proposals).toHaveLength(1);
  });

  test("a supplied attachment still requires its own extraction and its extraction is kept", () => {
    const withImage = envelope([{ source_item_id: "image-source", text: "ORBIT", kind: "image_ocr" }, { source_item_id: "text-source", text, kind: "document_extract" }]);
    const cleaned = validateAnalysisEnvelopeV1(dropUnrequestedSourceExtractions(withImage, new Map([["image-source", "image/png"]])), context([["image-source", "image/png"]]));
    expect(cleaned.source_extractions).toEqual([{ source_item_id: "image-source", text: "ORBIT", kind: "image_ocr" }]);
    const missing = envelope([{ source_item_id: "text-source", text, kind: "document_extract" }]);
    expect(() => validateAnalysisEnvelopeV1(dropUnrequestedSourceExtractions(missing, new Map([["image-source", "image/png"]])), context([["image-source", "image/png"]])))
      .toThrow(/Every supplied attachment requires a source extraction/);
  });

  test("leaves envelopes without unrequested extractions untouched", () => {
    const raw = envelope([]);
    expect(dropUnrequestedSourceExtractions(raw, new Map())).toBe(raw);
    expect(dropUnrequestedSourceExtractions(null, new Map())).toBeNull();
  });
});

describe("quote-anchored evidence offsets", () => {
  const base = (refs: { start: number | null; end: number | null; quote?: string | null }[], disposition: "accepted" | "proposed" = "accepted") =>
    validateAnalysisEnvelopeV1({ ...envelope([]), field_proposals: [{ temp_id: "f1", field_key: "rating", value: 4.5, value_type: "rating", claim_risk: "low", disposition,
      evidence_refs: refs.map((ref) => ({ source_item_id: "text-source", ...ref })) }] }, context());
  const texts = new Map([["text-source", text]]);

  test("moves a miscounted span (live Gemini offset 23-28 for 4.5/5) onto the quoted text", () => {
    const result = anchorEvidenceQuotes(base([{ start: 23, end: 28, quote: "4.5/5" }]), texts);
    const ref = result.envelope.field_proposals[0].evidence_refs[0];
    expect(text.slice(ref.start!, ref.end!)).toBe("4.5/5");
    expect(result).toMatchObject({ reanchored: 1, unverified: 0, demoted: 0 });
    expect(result.envelope.field_proposals[0].disposition).toBe("accepted");
  });

  test("keeps an exact span, picks the nearest of repeated quotes and ignores refs without a quote", () => {
    const repeated = "별점 4 그리고 다시 별점 4";
    const repeatedTexts = new Map([["text-source", repeated]]);
    const env = validateAnalysisEnvelopeV1({ ...envelope([]), field_proposals: [{ temp_id: "f1", field_key: "rating", value: 4, value_type: "rating", claim_risk: "low", disposition: "accepted",
      evidence_refs: [{ source_item_id: "text-source", start: 13, end: 15, quote: "별점 4" }, { source_item_id: "text-source", start: 0, end: 4, quote: "별점 4" }, { source_item_id: "text-source", start: 1, end: 3 }] }] },
      { ...context(), sourceLengths: new Map([["text-source", repeated.length]]) });
    const refs = anchorEvidenceQuotes(env, repeatedTexts).envelope.field_proposals[0].evidence_refs;
    expect(refs.map((ref) => [ref.start, ref.end])).toEqual([[12, 16], [0, 4], [1, 3]]);
  });

  test("a quote absent from the source clears offsets and demotes an accepted field to a proposal", () => {
    const result = anchorEvidenceQuotes(base([{ start: 28, end: 33, quote: "별점 5/5" }]), texts);
    expect(result.envelope.field_proposals[0]).toMatchObject({ disposition: "proposed", evidence_refs: [{ start: null, end: null, quote: "별점 5/5" }] });
    expect(result).toMatchObject({ reanchored: 0, unverified: 1, demoted: 1 });
    const kept: AnalysisEnvelopeV1 = base([{ start: 28, end: 33, quote: "별점 5/5" }, { start: 28, end: 33, quote: "4.5/5" }]);
    expect(anchorEvidenceQuotes(kept, texts).envelope.field_proposals[0].disposition).toBe("accepted");
  });
});

test("an out-of-range offset with a verifiable quote is repaired before the bounds check (live Gemini 29-35 on a 34-char text)", () => {
  const raw = { ...envelope([]), field_proposals: [{ temp_id: "f1", field_key: "rating", value: 4.5, value_type: "rating", claim_risk: "low", disposition: "accepted",
    evidence_refs: [{ source_item_id: "text-source", start: 29, end: 35, quote: "별점 4.5/5." }] }] };
  expect(() => validateAnalysisEnvelopeV1(raw, context())).toThrow(/outside the source text/);
  const repaired = validateAnalysisEnvelopeV1(anchorEvidenceQuotesInDraft(raw, new Map([["text-source", text]])), context());
  const ref = repaired.field_proposals[0].evidence_refs[0];
  expect(text.slice(ref.start!, ref.end!)).toBe("별점 4.5/5.");
  const unquoted = { ...raw, field_proposals: [{ ...raw.field_proposals[0], evidence_refs: [{ source_item_id: "text-source", start: 29, end: 35 }] }] };
  expect(() => validateAnalysisEnvelopeV1(anchorEvidenceQuotesInDraft(unquoted, new Map([["text-source", text]])), context())).toThrow(/outside the source text/);
});
