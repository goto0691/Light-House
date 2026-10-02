import {
  CONTRACT, canonical, exactKeys, expectedResults, identity, invalid, observationSet, record, strings, typedValue,
  type Expected, type Identity, type Mode, type Observation, type TypedValue,
} from "./contracts";
import { emptyMetrics, finalizeMetrics, promotion, summarize, type CaseReport, type EvaluationReport, type IssueCode } from "./report";

function scoreCase(expected: Expected, observed: Observation): CaseReport {
  const metrics = emptyMetrics();
  const issues: CaseReport["issues"] = [];
  function issue(code: IssueCode, severity: "fatal" | "major" | "unknown", count = 1) {
    if (!count) return;
    const existing = issues.find((item) => item.code === code);
    if (existing) existing.count += count;
    else issues.push({ code, severity, count });
  }
  for (const code of observed.fatal_failures) issue(code, "fatal");
  metrics.source_hash_equality.total = 1;
  if (expected.source_hashes.length === 0 || observed.source_hashes === undefined) {
    metrics.source_hash_equality.unknown = 1;
    issue(expected.source_hashes.length === 0 ? "SOURCE_EXPECTATION_EMPTY" : "SOURCE_OBSERVATION_MISSING", "unknown");
  } else if (canonical([...expected.source_hashes].sort()) === canonical([...observed.source_hashes].sort())) {
    metrics.source_hash_equality.matched = 1;
  } else issue("SOURCE_MUTATION", "fatal");

  // expected-v1 intentionally has free-form objects. Only this explicitly named
  // deterministic subset is executable; no semantic interpretation is implied.
  issue("UNSUPPORTED_MUST_CREATE", "unknown", Object.keys(expected.must_create).length);
  issue("UNSUPPORTED_MUST_NOT_ASSERT", "unknown", expected.must_not_assert.length);
  issue("UNSUPPORTED_REQUIRED_EVIDENCE", "unknown", expected.required_evidence.reduce((n, item) => n + Math.max(1, Object.keys(item).length), 0));
  issue("UNSUPPORTED_SEVERITY_OVERRIDE", "unknown", Object.keys(expected.severity_overrides).length);
  const typedIds = new Set<string>();
  for (const rule of expected.must_preserve) {
    if (!exactKeys(rule, ["exact_typed_value"]) || !typedValue(rule.exact_typed_value)) {
      issue("UNSUPPORTED_MUST_PRESERVE", "unknown", Math.max(1, Object.keys(rule).length));
      continue;
    }
    const wanted: TypedValue = rule.exact_typed_value;
    if (typedIds.has(wanted.id)) invalid();
    typedIds.add(wanted.id);
    metrics.exact_typed_value_recall.total += 1;
    if (observed.typed_values === undefined) {
      metrics.exact_typed_value_recall.unknown += 1;
      issue("TYPED_OBSERVATION_MISSING", "unknown");
      continue;
    }
    const actual = observed.typed_values.find((item) => item.id === wanted.id);
    if (!actual) issue("TYPED_VALUE_MISSING", "major");
    else if (canonical(wanted) === canonical(actual)) metrics.exact_typed_value_recall.matched += 1;
    else issue("USER_VALUE_OVERWRITE", "fatal");
  }
  issue("UNSCOPED_OBSERVATION", "unknown", observed.typed_values?.filter((item) => !typedIds.has(item.id)).length ?? 0);

  for (const [key, aliases] of Object.entries(expected.acceptable_variants)) {
    if (key !== "primary_type" || !strings(aliases, false)) {
      issue("UNSUPPORTED_ACCEPTABLE_VARIANT", "unknown");
      continue;
    }
    metrics.type_alias_recall.total = 1; // One concept, not one target per alias.
    if (observed.primary_types === undefined) {
      metrics.type_alias_precision.total = 1;
      metrics.type_alias_precision.unknown = 1;
      metrics.type_alias_recall.unknown = 1;
      issue("TYPE_OBSERVATION_MISSING", "unknown");
      continue;
    }
    metrics.type_alias_precision.total = observed.primary_types.length;
    metrics.type_alias_precision.matched = observed.primary_types.filter((type) => aliases.includes(type)).length;
    metrics.type_alias_recall.matched = metrics.type_alias_precision.matched > 0 ? 1 : 0;
    if (metrics.type_alias_recall.matched === 0 || metrics.type_alias_precision.matched !== metrics.type_alias_precision.total) issue("TYPE_ALIAS_MISMATCH", "major");
  }
  if (!Object.hasOwn(expected.acceptable_variants, "primary_type") && observed.primary_types?.length) issue("UNSCOPED_OBSERVATION", "unknown", observed.primary_types.length);

  const recallIds = new Set<string>();
  for (const rule of expected.recall_queries) {
    if (!record(rule) || !exactKeys(rule, ["id", "required_ids", "top_k"], ["query"])
      || typeof rule.id !== "string" || !rule.id || rule.id.length > 1000
      || !strings(rule.required_ids, false) || rule.top_k !== 10
      || (rule.query !== undefined && typeof rule.query !== "string")) {
      issue("UNSUPPORTED_RECALL_RULE", "unknown", Math.max(1, Object.keys(rule).length));
      continue;
    }
    if (recallIds.has(rule.id)) invalid();
    recallIds.add(rule.id);
    const actual = observed.recall_results?.find((item) => item.id === rule.id);
    for (const k of [1, 5, 10] as const) {
      const metric = metrics[`ranked_id_top${k}`];
      metric.total += rule.required_ids.length;
      if (!actual) metric.unknown += rule.required_ids.length;
      else metric.matched += rule.required_ids.filter((id) => actual.ranked_ids.slice(0, k).includes(id)).length;
    }
    metrics.query_all_required_top10.total += 1;
    if (!actual) {
      metrics.query_all_required_top10.unknown += 1;
      issue("RECALL_OBSERVATION_MISSING", "unknown");
    } else if (rule.required_ids.every((id) => actual.ranked_ids.slice(0, 10).includes(id))) metrics.query_all_required_top10.matched += 1;
    else issue("RECALL_TOP10_MISS", "major");
  }
  issue("UNSCOPED_OBSERVATION", "unknown", observed.recall_results?.filter((item) => !recallIds.has(item.id)).length ?? 0);
  return { case_id: expected.case_id, metrics: finalizeMetrics(metrics), issues, unknown_count: issues.filter((item) => item.severity === "unknown").reduce((n, item) => n + item.count, 0) };
}

export function evaluateRecorded(input: {
  mode: Mode; identity: Identity; corpus_sha256: string; expected: unknown; observations: unknown;
  readiness: EvaluationReport["readiness"];
}): EvaluationReport {
  const approved = expectedResults(input.expected);
  const requiredIdentity = identity(input.identity);
  const observed = observationSet(input.observations);
  if (observed.mode !== input.mode) invalid("MODE_MISMATCH");
  if (canonical(requiredIdentity) !== canonical(observed.identity)) invalid("IDENTITY_MISMATCH");
  if (observed.corpus_sha256 !== input.corpus_sha256) invalid("CORPUS_IDENTITY_MISMATCH");
  const ids = approved.map((item) => item.case_id).sort();
  if (canonical(ids) !== canonical(observed.cases.map((item) => item.case_id).sort())) invalid("CASE_SET_MISMATCH");
  const humanCount = approved.filter((item) => item.authoring_status === "human_approved").length;
  const delegatedCount = approved.filter((item) => item.authoring_status === "assistant_reviewed").length;
  if (input.mode === "private-recorded" && (approved.length !== 20 || humanCount + delegatedCount !== 20
    || input.readiness.current_hashes_verified !== true || input.readiness.ready_cases !== 20
    || input.readiness.human_approved_cases !== humanCount || (input.readiness.user_delegated_cases ?? 0) !== delegatedCount)) invalid("CORPUS_NOT_READY");
  const cases = [...approved].sort((a, b) => a.case_id.localeCompare(b.case_id)).map((item) => scoreCase(item, observed.cases.find((entry) => entry.case_id === item.case_id)!));
  const aggregate = summarize(cases);
  return {
    contract: CONTRACT, report_version: 1, mode: input.mode,
    provenance: input.mode === "synthetic" ? "synthetic-recordings" : "private-recorded-observations",
    live_provider_verified: false, identity: requiredIdentity, corpus_sha256: observed.corpus_sha256,
    readiness: input.mode === "synthetic" ? { current_hashes_verified: false, human_approved_cases: 0, ready_cases: 0 } : {
      current_hashes_verified: input.readiness.current_hashes_verified,
      human_approved_cases: input.readiness.human_approved_cases,
      ready_cases: input.readiness.ready_cases,
      ...(delegatedCount ? { user_delegated_cases: delegatedCount } : {}),
    },
    cases, aggregate,
    rubric: { status: "not_scored", maximum: 16, threshold: 13, average_points: null, cases_at_or_above_13: null, policy: "per_case_vs_average_unresolved" },
    promotion: promotion(input.mode, aggregate),
  };
}
