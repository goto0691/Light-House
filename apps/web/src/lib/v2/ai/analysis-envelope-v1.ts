import { validateJsonSchemaValue } from "@/lib/v2/ai/safe-json-schema";

export const ANALYSIS_SCHEMA_VERSION = "analysis-v1";
export const ANALYSIS_PROMPT_VERSION = "analysis-main-multimodal-v2";
export const ANALYSIS_VALIDATOR_VERSION = "analysis-semantic-v3";
export const ANALYSIS_REGISTRY_VERSION = "registry-bootstrap-v1";
export const ANALYSIS_MODEL_CONFIG_VERSION = "gemini-roles-v1";

/** `quote` is the model's copy of the evidence text; the server re-anchors offsets from it. */
export type AnalysisEvidenceRef = Readonly<{ source_item_id: string; start: number | null; end: number | null; quote?: string | null }>;
export type AnalysisEnvelopeV1 = Readonly<{
  contract_version: "analysis-v1";
  capture_id: string;
  analyzed_revision_id: string;
  language: string;
  bundle_summary: string;
  source_extractions?: readonly Readonly<{ source_item_id: string; text: string; kind: "image_ocr" | "transcript_extract" | "document_extract" }>[];
  document_proposals: readonly Readonly<{
    temp_id: string;
    source_item_ids: readonly string[];
    suggested_title: string | null;
    type_assignments: readonly Readonly<{ type_key: string; label: string; registry_action: "reuse" | "alias_candidate" | "child_candidate" | "propose_new" | "unresolved"; evidence_refs: readonly AnalysisEvidenceRef[] }>[];
  }>[];
  entity_proposals: readonly Readonly<{ temp_id: string; entity_kind: string; mention: string; resolution_status: "local_candidate" | "external_required" | "unresolved"; evidence_refs: readonly AnalysisEvidenceRef[] }>[];
  event_proposals: readonly Readonly<{ temp_id: string; event_type_key: string; occurred_at_start: string | null; evidence_refs: readonly AnalysisEvidenceRef[] }>[];
  field_proposals: readonly Readonly<{
    temp_id: string;
    field_key: string;
    value: string | number | boolean | null;
    value_type: "text" | "number" | "boolean" | "date" | "rating";
    rating_original?: Readonly<{ value: number; maximum: number }>;
    claim_risk: "low" | "autobiographical" | "social_high_risk";
    disposition: "accepted" | "proposed";
    evidence_refs: readonly AnalysisEvidenceRef[];
  }>[];
  enrichment_requests: readonly Readonly<{ request_id: string; entity_kind: "place" | "work" | "book" | "game"; query: string; requested_fields: readonly string[] }>[];
  review_items: readonly Readonly<{ code: string; message: string }>[];
  warnings: readonly string[];
}>;

const evidenceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source_item_id", "start", "end"],
  properties: {
    source_item_id: { type: "string", minLength: 1 },
    start: { type: ["integer", "null"], minimum: 0 },
    end: { type: ["integer", "null"], minimum: 0 },
    quote: { type: ["string", "null"], maxLength: 500 },
  },
} as const;

/** Re-anchors quoted evidence in a schema-valid draft before semantic validation,
 * so an out-of-range model offset with a verifiable quote is repaired rather than
 * failing the analysis. Refs without a quote still face the strict bounds check.
 * Extraction texts come from the draft; the validator still proves each belongs to
 * a supplied attachment. */
export function anchorEvidenceQuotesInDraft(value: unknown, sourceTexts: ReadonlyMap<string, string>): unknown {
  if (!validateJsonSchemaValue(ANALYSIS_ENVELOPE_V1_SCHEMA, value).valid) return value;
  const draft = value as AnalysisEnvelopeV1;
  const texts = new Map(sourceTexts);
  for (const extraction of draft.source_extractions ?? []) if (!texts.has(extraction.source_item_id)) texts.set(extraction.source_item_id, extraction.text);
  return anchorEvidenceQuotes(draft, texts).envelope;
}

export type EvidenceAnchorResult = Readonly<{ envelope: AnalysisEnvelopeV1; reanchored: number; unverified: number; demoted: number }>;

/** Model character offsets are unreliable (tokenisation). When a ref carries a
 * quote, place it at the occurrence of that exact text nearest the model's
 * offset. A quote absent from the source clears the offsets, and an accepted
 * field left without verifiable evidence becomes a proposal for the user. */
export function anchorEvidenceQuotes(envelope: AnalysisEnvelopeV1, texts: ReadonlyMap<string, string>): EvidenceAnchorResult {
  let reanchored = 0, unverified = 0;
  const anchor = (ref: AnalysisEvidenceRef): AnalysisEvidenceRef => {
    const text = texts.get(ref.source_item_id);
    const quote = typeof ref.quote === "string" ? ref.quote : "";
    if (!quote.trim() || text === undefined) return ref;
    if (ref.start !== null && ref.end !== null && text.slice(ref.start, ref.end) === quote) return ref;
    const occurrences: number[] = [];
    for (let index = text.indexOf(quote); index !== -1 && occurrences.length < 1000; index = text.indexOf(quote, index + 1)) occurrences.push(index);
    if (!occurrences.length) { unverified += 1; return { ...ref, start: null, end: null }; }
    const target = ref.start ?? 0;
    const start = occurrences.reduce((best, index) => Math.abs(index - target) < Math.abs(best - target) ? index : best, occurrences[0]);
    reanchored += 1;
    return { ...ref, start, end: start + quote.length };
  };
  const refs = (items: readonly AnalysisEvidenceRef[]) => items.map(anchor);
  let demoted = 0;
  const next: AnalysisEnvelopeV1 = {
    ...envelope,
    document_proposals: envelope.document_proposals.map((item) => ({ ...item, type_assignments: item.type_assignments.map((type) => ({ ...type, evidence_refs: refs(type.evidence_refs) })) })),
    entity_proposals: envelope.entity_proposals.map((item) => ({ ...item, evidence_refs: refs(item.evidence_refs) })),
    event_proposals: envelope.event_proposals.map((item) => ({ ...item, evidence_refs: refs(item.evidence_refs) })),
    field_proposals: envelope.field_proposals.map((item) => {
      const evidence = refs(item.evidence_refs);
      const verifiable = evidence.some((ref) => ref.start !== null && ref.end !== null && ref.end > ref.start);
      if (item.disposition === "accepted" && !verifiable) { demoted += 1; return { ...item, disposition: "proposed" as const, evidence_refs: evidence }; }
      return { ...item, evidence_refs: evidence };
    }),
  };
  return { envelope: next, reanchored, unverified, demoted };
}

export const ANALYSIS_ENVELOPE_V1_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["contract_version", "capture_id", "analyzed_revision_id", "language", "bundle_summary", "document_proposals", "entity_proposals", "event_proposals", "field_proposals", "enrichment_requests", "review_items", "warnings"],
  properties: {
    contract_version: { const: "analysis-v1" },
    capture_id: { type: "string", minLength: 1 },
    analyzed_revision_id: { type: "string", minLength: 1 },
    language: { type: "string", minLength: 2, maxLength: 16 },
    bundle_summary: { type: "string", maxLength: 2000 },
    source_extractions: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["source_item_id", "text", "kind"], properties: { source_item_id: { type: "string", minLength: 1 }, text: { type: "string", maxLength: 50000 }, kind: { enum: ["image_ocr", "transcript_extract", "document_extract"] } } } },
    document_proposals: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["temp_id", "source_item_ids", "suggested_title", "type_assignments"],
        properties: {
          temp_id: { type: "string", minLength: 1 },
          source_item_ids: { type: "array", maxItems: 100, items: { type: "string", minLength: 1 } },
          suggested_title: { type: ["string", "null"], maxLength: 200 },
          type_assignments: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type_key", "label", "registry_action", "evidence_refs"],
              properties: {
                type_key: { type: "string", minLength: 1, maxLength: 100 },
                label: { type: "string", minLength: 1, maxLength: 100 },
                registry_action: { enum: ["reuse", "alias_candidate", "child_candidate", "propose_new", "unresolved"] },
                evidence_refs: { type: "array", maxItems: 24, items: evidenceRefSchema },
              },
            },
          },
        },
      },
    },
    entity_proposals: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["temp_id", "entity_kind", "mention", "resolution_status", "evidence_refs"], properties: { temp_id: { type: "string", minLength: 1 }, entity_kind: { type: "string", minLength: 1, maxLength: 100 }, mention: { type: "string", minLength: 1, maxLength: 500 }, resolution_status: { enum: ["local_candidate", "external_required", "unresolved"] }, evidence_refs: { type: "array", maxItems: 24, items: evidenceRefSchema } } } },
    event_proposals: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["temp_id", "event_type_key", "occurred_at_start", "evidence_refs"], properties: { temp_id: { type: "string", minLength: 1 }, event_type_key: { type: "string", minLength: 1, maxLength: 100 }, occurred_at_start: { type: ["string", "null"], maxLength: 40 }, evidence_refs: { type: "array", maxItems: 24, items: evidenceRefSchema } } } },
    field_proposals: { type: "array", maxItems: 300, items: { type: "object", additionalProperties: false, required: ["temp_id", "field_key", "value", "value_type", "claim_risk", "disposition", "evidence_refs"], properties: { temp_id: { type: "string", minLength: 1 }, field_key: { type: "string", minLength: 1, maxLength: 100 }, value: { type: ["string", "number", "boolean", "null"] }, value_type: { enum: ["text", "number", "boolean", "date", "rating"] }, rating_original: { type: "object", additionalProperties: false, required: ["value", "maximum"], properties: { value: { type: "number", minimum: 0 }, maximum: { type: "number", minimum: 0 } } }, claim_risk: { enum: ["low", "autobiographical", "social_high_risk"] }, disposition: { enum: ["accepted", "proposed"] }, evidence_refs: { type: "array", maxItems: 24, items: evidenceRefSchema } } } },
    enrichment_requests: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["request_id", "entity_kind", "query", "requested_fields"], properties: { request_id: { type: "string", minLength: 1 }, entity_kind: { enum: ["place", "work", "book", "game"] }, query: { type: "string", minLength: 2, maxLength: 500 }, requested_fields: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 100 } } } } },
    review_items: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["code", "message"], properties: { code: { type: "string", minLength: 1 }, message: { type: "string", minLength: 1, maxLength: 1000 } } } },
    warnings: { type: "array", maxItems: 100, items: { type: "string", maxLength: 1000 } },
  },
} as const;

export class AnalysisEnvelopeValidationError extends Error {
  readonly code = "analysis_envelope_invalid";
  constructor(message: string) { super(message); this.name = "AnalysisEnvelopeValidationError"; }
}

export function validateAnalysisEnvelopeV1(value: unknown, context: { captureId: string; revisionId: string; sourceLengths: ReadonlyMap<string, number | null>; attachmentKinds?: ReadonlyMap<string, string> }): AnalysisEnvelopeV1 {
  const schemaValidation = validateJsonSchemaValue(ANALYSIS_ENVELOPE_V1_SCHEMA, value);
  if (!schemaValidation.valid) throw new AnalysisEnvelopeValidationError(schemaValidation.errors.join(" "));
  const envelope = value as AnalysisEnvelopeV1;
  if (envelope.capture_id !== context.captureId || envelope.analyzed_revision_id !== context.revisionId) throw new AnalysisEnvelopeValidationError("Analysis target identifiers do not match the job snapshot.");
  const sourceLengths = new Map(context.sourceLengths);
  const extracted = new Set<string>();
  let extractedLength = 0;
  for (const extraction of envelope.source_extractions ?? []) {
    const mime = context.attachmentKinds?.get(extraction.source_item_id);
    const expectedKind = mime?.startsWith("image/") ? "image_ocr" : mime?.startsWith("audio/") || mime?.startsWith("video/") ? "transcript_extract" : "document_extract";
    if (!mime || !sourceLengths.has(extraction.source_item_id) || extracted.has(extraction.source_item_id) || extraction.kind !== expectedKind) throw new AnalysisEnvelopeValidationError("Source extraction must name a unique attachment supplied to this model request.");
    extracted.add(extraction.source_item_id);
    extractedLength += extraction.text.length;
    if (extractedLength > 100_000) throw new AnalysisEnvelopeValidationError("Source extraction exceeds the capture text budget.");
    sourceLengths.set(extraction.source_item_id, extraction.text.length);
  }
  for (const sourceId of context.attachmentKinds?.keys() ?? []) {
    if (!extracted.has(sourceId)) throw new AnalysisEnvelopeValidationError("Every supplied attachment requires a source extraction, even when its text is empty.");
  }
  const refs = [
    ...envelope.document_proposals.flatMap((item) => item.type_assignments.flatMap((type) => type.evidence_refs)),
    ...envelope.entity_proposals.flatMap((item) => item.evidence_refs),
    ...envelope.event_proposals.flatMap((item) => item.evidence_refs),
    ...envelope.field_proposals.flatMap((item) => item.evidence_refs),
  ];
  for (const proposal of envelope.document_proposals) for (const sourceId of proposal.source_item_ids) if (!context.sourceLengths.has(sourceId)) throw new AnalysisEnvelopeValidationError("A document proposal references an unknown source item.");
  const canonicalKey = /^[a-z][a-z0-9_.-]{0,99}$/;
  const tempIds = new Set<string>();
  for (const proposal of envelope.document_proposals) {
    if (tempIds.has(proposal.temp_id)) throw new AnalysisEnvelopeValidationError("Analysis proposal temp IDs must be unique.");
    tempIds.add(proposal.temp_id);
    for (const assignment of proposal.type_assignments) if (!canonicalKey.test(assignment.type_key)) throw new AnalysisEnvelopeValidationError("Type keys must be canonical lowercase registry keys.");
  }
  for (const proposal of [...envelope.entity_proposals, ...envelope.event_proposals, ...envelope.field_proposals]) {
    if (tempIds.has(proposal.temp_id)) throw new AnalysisEnvelopeValidationError("Analysis proposal temp IDs must be unique.");
    tempIds.add(proposal.temp_id);
  }
  for (const entity of envelope.entity_proposals) if (!canonicalKey.test(entity.entity_kind)) throw new AnalysisEnvelopeValidationError("Entity kinds must be canonical lowercase registry keys.");
  for (const event of envelope.event_proposals) {
    if (!canonicalKey.test(event.event_type_key)) throw new AnalysisEnvelopeValidationError("Event type keys must be canonical lowercase registry keys.");
    if (event.occurred_at_start && Number.isNaN(Date.parse(event.occurred_at_start)) && !/^\d{4}(?:-\d{2})?$/.test(event.occurred_at_start)) throw new AnalysisEnvelopeValidationError("Event dates must use an ISO-compatible precision.");
  }
  for (const field of envelope.field_proposals) {
    if (!canonicalKey.test(field.field_key)) throw new AnalysisEnvelopeValidationError("Field keys must be canonical lowercase registry keys.");
    const validValue = field.value === null
      || (field.value_type === "text" && typeof field.value === "string")
      || (field.value_type === "number" && typeof field.value === "number" && Number.isFinite(field.value))
      || (field.value_type === "boolean" && typeof field.value === "boolean")
      || (field.value_type === "date" && typeof field.value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(field.value))
      || (field.value_type === "rating" && typeof field.value === "number" && Number.isFinite(field.value) && field.value >= 0 && field.value <= 5);
    if (!validValue) throw new AnalysisEnvelopeValidationError("A field value does not match its declared value type.");
    if (field.rating_original && (field.value_type !== "rating" || typeof field.value !== "number" || field.rating_original.maximum <= 0 || field.rating_original.value > field.rating_original.maximum || Math.abs(field.value - 5 * field.rating_original.value / field.rating_original.maximum) > 0.000001)) throw new AnalysisEnvelopeValidationError("Ratings must be normalized to five using the explicitly recorded original scale.");
    if (field.disposition === "accepted" && !field.evidence_refs.some((ref) => ref.start !== null && ref.end !== null && ref.end > ref.start)) {
      throw new AnalysisEnvelopeValidationError("Accepted field values require direct text evidence.");
    }
  }
  for (const request of envelope.enrichment_requests) {
    if (!request.requested_fields.length || request.requested_fields.some((key) => !canonicalKey.test(key))) throw new AnalysisEnvelopeValidationError("Grounded enrichment fields must use canonical lowercase registry keys.");
  }
  for (const ref of refs) {
    if (!context.sourceLengths.has(ref.source_item_id)) throw new AnalysisEnvelopeValidationError("Evidence references an unknown source item.");
    const length = sourceLengths.get(ref.source_item_id) ?? null;
    if ((ref.start === null) !== (ref.end === null)) throw new AnalysisEnvelopeValidationError("Evidence offsets must both be null or integers.");
    if (ref.start !== null && ref.end !== null && (length === null || ref.end < ref.start || ref.end > length)) throw new AnalysisEnvelopeValidationError("Evidence offsets are outside the source text or extraction bounds.");
  }
  if (envelope.field_proposals.some((field) => field.claim_risk === "social_high_risk" && field.disposition === "accepted")) throw new AnalysisEnvelopeValidationError("Social high-risk claims cannot be auto-accepted.");
  return envelope;
}
