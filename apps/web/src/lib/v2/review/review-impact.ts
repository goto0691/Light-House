/**
 * Review impact (07 §12, 15 IA, D-041). `확인할 내용` lists only what needs the
 * owner's judgment: conflicts, ambiguous identity, high-risk claims, failed
 * processing and questions the analyzer raised itself. Routine AI proposals
 * (a new type, an AI field, a single-candidate mention, an event, a warning)
 * stay open on their record but do not fill the inbox. Unknown kinds or codes
 * are high so nothing new is hidden by default.
 */
export type ReviewImpact = "high" | "low";

const LOW_ANALYSIS_CODES = ["type_confirmation", "field_confirmation", "event_confirmation"] as const;
const HIGH_WARNING_CODES = ["processing_lease_exhausted", "attachment_analysis_unavailable"] as const;

export function reviewImpact(kind: string, payload: Readonly<Record<string, unknown>>): ReviewImpact {
  const code = typeof payload.code === "string" ? payload.code : null;
  if (kind === "high_risk_claim" || kind === "value_conflict") return "high";
  if (kind === "registry_conflict") return payload.target === "type" && payload.action === "reuse" ? "low" : "high";
  if (kind === "analysis_warning") return code && (HIGH_WARNING_CODES as readonly string[]).includes(code) ? "high" : "low";
  if (kind === "analysis_review") {
    if (code === "entity_resolution") return typeof payload.candidates === "number" && payload.candidates >= 2 ? "high" : "low";
    return code && (LOW_ANALYSIS_CODES as readonly string[]).includes(code) ? "low" : "high";
  }
  return "high";
}

/** The same rule over a `v2_review_items` row alias, for counting in SQL. Malformed payloads read as `{}`. */
export function reviewImpactSql(alias: string) {
  const payload = `(case when json_valid(${alias}.payload_json) then ${alias}.payload_json else '{}' end)`;
  const field = (path: string) => `json_extract(${payload},'$.${path}')`;
  const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(",");
  return `(case
    when ${alias}.kind in ('high_risk_claim','value_conflict') then 'high'
    when ${alias}.kind='registry_conflict' then case when ${field("target")}='type' and ${field("action")}='reuse' then 'low' else 'high' end
    when ${alias}.kind='analysis_warning' then case when ${field("code")} in (${list(HIGH_WARNING_CODES)}) then 'high' else 'low' end
    when ${alias}.kind='analysis_review' then case
      when ${field("code")}='entity_resolution' then case when json_type(${payload},'$.candidates') in ('integer','real') and ${field("candidates")}>=2 then 'high' else 'low' end
      when ${field("code")} in (${list(LOW_ANALYSIS_CODES)}) then 'low'
      else 'high' end
    else 'high' end)`;
}
