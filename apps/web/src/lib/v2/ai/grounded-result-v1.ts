import { V2ModelError } from "@/lib/v2/ai/gateway";

export type GroundedFactV1 = Readonly<{
  field_key: string;
  label: string;
  value_type: "text" | "number" | "boolean" | "date" | "json";
  value: unknown;
  citation_urls: readonly string[];
}>;

export type GroundedResultEnvelopeV1 = Readonly<{
  contract_version: "grounded-result-v1";
  identity_status: "resolved" | "ambiguous" | "not_found";
  canonical_name: string | null;
  facts: readonly GroundedFactV1[];
  summary: string;
}>;

const canonicalKey = /^[a-z][a-z0-9_.-]{0,99}$/;

function fail(message: string): never {
  throw new V2ModelError("invalid_schema", message, false);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("Grounded enrichment returned unexpected fields.");
}

export function parseGroundedResultV1(answer: string, requestedFields: readonly string[], returnedCitationUrls: readonly string[]): GroundedResultEnvelopeV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(answer); } catch { fail("Grounded enrichment must return JSON only."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Grounded enrichment returned an invalid root value.");
  const root = parsed as Record<string, unknown>;
  exactKeys(root, ["contract_version", "identity_status", "canonical_name", "facts", "summary"]);
  if (root.contract_version !== "grounded-result-v1") fail("Grounded enrichment returned the wrong contract version.");
  if (!(["resolved", "ambiguous", "not_found"] as const).includes(root.identity_status as never)) fail("Grounded enrichment returned an invalid identity status.");
  const identityStatus = root.identity_status as GroundedResultEnvelopeV1["identity_status"];
  if (identityStatus === "resolved" ? typeof root.canonical_name !== "string" || !root.canonical_name.trim() : root.canonical_name !== null) fail("Grounded enrichment returned an invalid canonical identity.");
  if (typeof root.summary !== "string" || root.summary.length > 2_000) fail("Grounded enrichment returned an invalid summary.");
  if (!Array.isArray(root.facts) || root.facts.length > 20 || (identityStatus !== "resolved" && root.facts.length)) fail("Grounded enrichment returned invalid facts for the identity state.");
  const allowed = new Set(requestedFields);
  const citations = new Set(returnedCitationUrls);
  const seen = new Set<string>();
  const facts = root.facts.map((candidate): GroundedFactV1 => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fail("Grounded enrichment returned an invalid fact.");
    const fact = candidate as Record<string, unknown>;
    exactKeys(fact, ["field_key", "label", "value_type", "value", "citation_urls"]);
    if (typeof fact.field_key !== "string" || !canonicalKey.test(fact.field_key) || !allowed.has(fact.field_key) || seen.has(fact.field_key)) return fail("Grounded enrichment returned an unrequested or duplicate field.");
    seen.add(fact.field_key);
    if (typeof fact.label !== "string" || !fact.label.trim() || fact.label.length > 120) return fail("Grounded enrichment returned an invalid field label.");
    if (!(["text", "number", "boolean", "date", "json"] as const).includes(fact.value_type as never)) return fail("Grounded enrichment returned an invalid value type.");
    const kind = fact.value_type as GroundedFactV1["value_type"];
    const valid = kind === "text" ? typeof fact.value === "string" && Boolean(fact.value.trim()) && fact.value.length <= 2_000
      : kind === "number" ? typeof fact.value === "number" && Number.isFinite(fact.value)
        : kind === "boolean" ? typeof fact.value === "boolean"
          : kind === "date" ? typeof fact.value === "string" && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(fact.value)
            : fact.value !== undefined;
    if (!valid) return fail("Grounded enrichment returned a value that does not match its type.");
    try { if (JSON.stringify(fact.value).length > 10_000) return fail("Grounded enrichment returned an oversized fact."); } catch { return fail("Grounded enrichment returned a non-serializable fact."); }
    if (!Array.isArray(fact.citation_urls) || !fact.citation_urls.length || fact.citation_urls.length > 10 || fact.citation_urls.some((url) => typeof url !== "string" || !citations.has(url))) return fail("Every grounded fact must reference returned HTTPS citations.");
    return { field_key: fact.field_key, label: fact.label.trim(), value_type: kind, value: fact.value, citation_urls: [...new Set(fact.citation_urls as string[])] };
  });
  return {
    contract_version: "grounded-result-v1",
    identity_status: identityStatus,
    canonical_name: typeof root.canonical_name === "string" ? root.canonical_name.trim() : null,
    facts,
    summary: root.summary,
  };
}
