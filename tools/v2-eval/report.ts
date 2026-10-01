import Ajv2020 from "ajv/dist/2020";

import { CASE_ID, CONTRACT, FATAL_CODES, HASH, IDENTITY_KEYS, canonical, identity, invalid, type Identity, type Mode } from "./contracts";

export const METRICS = [
  "source_hash_equality", "exact_typed_value_recall", "type_alias_precision", "type_alias_recall",
  "ranked_id_top1", "ranked_id_top5", "ranked_id_top10", "query_all_required_top10",
] as const;
export type MetricName = (typeof METRICS)[number];
export type Metric = { matched: number; total: number; unknown: number; rate: number | null };
export type Metrics = Record<MetricName, Metric>;
export const ISSUE_CODES = [
  ...FATAL_CODES, "SOURCE_OBSERVATION_MISSING", "SOURCE_EXPECTATION_EMPTY", "TYPED_VALUE_MISSING",
  "TYPED_OBSERVATION_MISSING", "TYPE_OBSERVATION_MISSING", "TYPE_ALIAS_MISMATCH",
  "RECALL_OBSERVATION_MISSING", "RECALL_TOP10_MISS", "UNSUPPORTED_MUST_CREATE", "UNSUPPORTED_MUST_PRESERVE",
  "UNSUPPORTED_MUST_NOT_ASSERT", "UNSUPPORTED_ACCEPTABLE_VARIANT", "UNSUPPORTED_REQUIRED_EVIDENCE",
  "UNSUPPORTED_RECALL_RULE", "UNSUPPORTED_SEVERITY_OVERRIDE", "UNSCOPED_OBSERVATION",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
export type Issue = { code: IssueCode; severity: "fatal" | "major" | "unknown"; count: number };
export type CaseReport = { case_id: string; metrics: Metrics; issues: Issue[]; unknown_count: number };
export type EvaluationReport = {
  contract: typeof CONTRACT;
  report_version: 1;
  mode: Mode;
  provenance: "synthetic-recordings" | "private-recorded-observations";
  live_provider_verified: false;
  identity: Identity;
  corpus_sha256: string;
  readiness: { current_hashes_verified: boolean; human_approved_cases: number; ready_cases: number };
  cases: CaseReport[];
  aggregate: { metrics: Metrics; fatal_count: number; major_count: number; unknown_count: number };
  rubric: {
    status: "not_scored"; maximum: 16; threshold: 13;
    average_points: null; cases_at_or_above_13: null;
    policy: "per_case_vs_average_unresolved";
  };
  promotion: { eligible: false; decision: "blocked" | "review_required"; codes: string[] };
};
export function emptyMetrics(): Metrics {
  return Object.fromEntries(METRICS.map((key) => [key, { matched: 0, total: 0, unknown: 0, rate: null }])) as Metrics;
}
export function finalizeMetrics(metrics: Metrics) {
  for (const metric of Object.values(metrics)) metric.rate = metric.total > 0 && metric.unknown === 0 ? metric.matched / metric.total : null;
  return metrics;
}
export const PROMOTION_CODES = [
  "SYNTHETIC_ONLY", "RECORDED_OBSERVATIONS_ONLY", "FATAL_FAILURE", "DETERMINISTIC_FAILURE",
  "UNKNOWN_CRITERIA", "RUBRIC_NOT_SCORED", "RUBRIC_POLICY_UNRESOLVED", "OTHER_RELEASE_GATES_NOT_EVALUATED",
] as const;

const integer = { type: "integer", minimum: 0, maximum: 100_000_000 };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const metricsSchema = object(Object.fromEntries(METRICS.map((key) => [key, object({
  matched: integer, total: integer, unknown: integer, rate: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
})])));
const ajv = new Ajv2020({ allErrors: false, strict: false });
const validateReport = ajv.compile<EvaluationReport>(object({
  contract: { const: CONTRACT }, report_version: { const: 1 }, mode: { enum: ["synthetic", "private-recorded"] },
  provenance: { enum: ["synthetic-recordings", "private-recorded-observations"] }, live_provider_verified: { const: false },
  identity: object(Object.fromEntries(IDENTITY_KEYS.map((key) => [key, { type: "string", pattern: key === "build_sha" ? "^[a-f0-9]{40}$" : HASH.source }]))),
  corpus_sha256: { type: "string", pattern: HASH.source },
  readiness: object({ current_hashes_verified: { type: "boolean" }, human_approved_cases: { ...integer, maximum: 20 }, ready_cases: { ...integer, maximum: 20 } }),
  cases: { type: "array", minItems: 1, maxItems: 20, items: object({
    case_id: { type: "string", pattern: CASE_ID.source }, metrics: metricsSchema, unknown_count: integer,
    issues: { type: "array", maxItems: ISSUE_CODES.length, items: object({ code: { enum: ISSUE_CODES }, severity: { enum: ["fatal", "major", "unknown"] }, count: { ...integer, minimum: 1 } }) },
  }) },
  aggregate: object({ metrics: metricsSchema, fatal_count: integer, major_count: integer, unknown_count: integer }),
  rubric: object({ status: { const: "not_scored" }, maximum: { const: 16 }, threshold: { const: 13 }, average_points: { type: "null" }, cases_at_or_above_13: { type: "null" }, policy: { const: "per_case_vs_average_unresolved" } }),
  promotion: object({ eligible: { const: false }, decision: { enum: ["blocked", "review_required"] }, codes: { type: "array", uniqueItems: true, minItems: 1, maxItems: PROMOTION_CODES.length, items: { enum: PROMOTION_CODES } } }),
}));

export function summarize(cases: CaseReport[]): EvaluationReport["aggregate"] {
  const metrics = emptyMetrics();
  let fatal_count = 0; let major_count = 0; let unknown_count = 0;
  for (const item of cases) {
    unknown_count += item.unknown_count;
    for (const issue of item.issues) {
      if (issue.severity === "fatal") fatal_count += issue.count;
      if (issue.severity === "major") major_count += issue.count;
    }
    for (const key of METRICS) for (const field of ["matched", "total", "unknown"] as const) metrics[key][field] += item.metrics[key][field];
  }
  return { metrics: finalizeMetrics(metrics), fatal_count, major_count, unknown_count };
}
export function promotion(mode: Mode, aggregate: EvaluationReport["aggregate"]): EvaluationReport["promotion"] {
  const codes: string[] = [mode === "synthetic" ? "SYNTHETIC_ONLY" : "RECORDED_OBSERVATIONS_ONLY"];
  if (aggregate.fatal_count) codes.push("FATAL_FAILURE");
  if (aggregate.major_count) codes.push("DETERMINISTIC_FAILURE");
  if (aggregate.unknown_count) codes.push("UNKNOWN_CRITERIA");
  codes.push("RUBRIC_NOT_SCORED", "RUBRIC_POLICY_UNRESOLVED", "OTHER_RELEASE_GATES_NOT_EVALUATED");
  return { eligible: false, decision: aggregate.fatal_count || aggregate.major_count || aggregate.unknown_count ? "blocked" : "review_required", codes };
}
function assertMetricIssues(item: CaseReport) {
  const count = (code: IssueCode) => item.issues.find((issue) => issue.code === code)?.count ?? 0;
  const missed = (metric: Metric) => metric.total - metric.matched - metric.unknown;
  const source = item.metrics.source_hash_equality;
  if (source.total !== 1 || count("SOURCE_EXPECTATION_EMPTY") + count("SOURCE_OBSERVATION_MISSING") !== source.unknown
    || (missed(source) > 0 && count("SOURCE_MUTATION") < missed(source))) invalid("REPORT_INVALID");

  const typed = item.metrics.exact_typed_value_recall;
  if (count("TYPED_OBSERVATION_MISSING") !== typed.unknown || count("TYPED_VALUE_MISSING") > missed(typed)
    || count("TYPED_VALUE_MISSING") + count("USER_VALUE_OVERWRITE") < missed(typed)) invalid("REPORT_INVALID");
  // A recorded fatal can exist independently of these metrics. Never require it
  // to disappear merely because the recorded hash/value measurement agrees.
  const precision = item.metrics.type_alias_precision;
  const recall = item.metrics.type_alias_recall;
  if (recall.total > 1 || count("TYPE_OBSERVATION_MISSING") !== recall.unknown || precision.unknown !== recall.unknown
    || (recall.total === 0 && precision.total !== 0)
    || (recall.unknown === 1 && precision.total !== 1)
    || (recall.total === 1 && recall.unknown === 0 && recall.matched !== (precision.matched > 0 ? 1 : 0))
    || count("TYPE_ALIAS_MISMATCH") !== (missed(precision) > 0 || missed(recall) > 0 ? 1 : 0)) invalid("REPORT_INVALID");

  const top1 = item.metrics.ranked_id_top1; const top5 = item.metrics.ranked_id_top5; const top10 = item.metrics.ranked_id_top10;
  const queries = item.metrics.query_all_required_top10;
  if (top1.total !== top10.total || top5.total !== top10.total || top1.unknown !== top10.unknown || top5.unknown !== top10.unknown
    || top1.matched > top5.matched || top5.matched > top10.matched || top10.total < queries.total
    || top10.unknown < queries.unknown || (queries.unknown === 0 && top10.unknown !== 0)
    || (queries.total === 0 && top10.total !== 0) || top10.matched < queries.matched
    || top1.matched > queries.total - queries.unknown || top5.matched > 5 * (queries.total - queries.unknown)
    || top10.matched > 10 * (queries.total - queries.unknown) || ((missed(top10) === 0) !== (missed(queries) === 0))
    || missed(top10) < missed(queries) || count("RECALL_OBSERVATION_MISSING") !== queries.unknown
    || count("RECALL_TOP10_MISS") !== missed(queries)) invalid("REPORT_INVALID");
}
export function parseReport(value: unknown): EvaluationReport {
  if (!validateReport(value)) invalid("REPORT_INVALID");
  identity(value.identity);
  const isPrivate = value.mode === "private-recorded";
  if (value.provenance !== (isPrivate ? "private-recorded-observations" : "synthetic-recordings")
    || value.readiness.current_hashes_verified !== isPrivate
    || (isPrivate && (value.readiness.ready_cases !== 20 || value.readiness.human_approved_cases !== 20 || value.cases.length !== 20))
    || (!isPrivate && (value.readiness.ready_cases !== 0 || value.readiness.human_approved_cases !== 0))
    || new Set(value.cases.map((item) => item.case_id)).size !== value.cases.length) invalid("REPORT_INVALID");
  for (const item of value.cases) {
    if (new Set(item.issues.map((issue) => issue.code)).size !== item.issues.length
      || item.unknown_count !== item.issues.filter((issue) => issue.severity === "unknown").reduce((sum, issue) => sum + issue.count, 0)) invalid("REPORT_INVALID");
    for (const issue of item.issues) {
      const fatal = FATAL_CODES.includes(issue.code as (typeof FATAL_CODES)[number]);
      const major = ["TYPED_VALUE_MISSING", "TYPE_ALIAS_MISMATCH", "RECALL_TOP10_MISS"].includes(issue.code);
      if (issue.severity !== (fatal ? "fatal" : major ? "major" : "unknown")) invalid("REPORT_INVALID");
    }
    for (const metric of Object.values(item.metrics)) {
      if (metric.matched + metric.unknown > metric.total
        || metric.rate !== (metric.total > 0 && metric.unknown === 0 ? metric.matched / metric.total : null)) invalid("REPORT_INVALID");
    }
    assertMetricIssues(item);
  }
  const aggregate = summarize(value.cases);
  // Recompute totals and promotion instead of trusting an edited summary.
  if (canonical(value.aggregate) !== canonical(aggregate)
    || canonical(value.promotion) !== canonical(promotion(value.mode, aggregate))) invalid("REPORT_INVALID");
  return value;
}
export function serializeReport(report: EvaluationReport): string {
  return `${JSON.stringify(parseReport(report), null, 2)}\n`;
}
