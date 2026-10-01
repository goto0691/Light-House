import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTRACT, EvaluationInputError, IDENTITY_KEYS, invalid } from "./contracts";
import { readJson, writeNewReport } from "./recorded-input";
import { METRICS, parseReport } from "./report";
import { argumentsFor } from "./run";

export function compareReports(baselineInput: unknown, candidateInput: unknown) {
  const baseline = parseReport(baselineInput);
  const candidate = parseReport(candidateInput);
  const incompatibilities: string[] = [];
  if (baseline.mode !== candidate.mode) incompatibilities.push("PROVENANCE_MISMATCH");
  if (baseline.corpus_sha256 !== candidate.corpus_sha256) incompatibilities.push("CORPUS_OR_EXPECTED_MISMATCH");
  if (baseline.identity.schema_sha256 !== candidate.identity.schema_sha256) incompatibilities.push("SCHEMA_SEMANTICS_MISMATCH");
  if (baseline.cases.map((item) => item.case_id).sort().join() !== candidate.cases.map((item) => item.case_id).sort().join()) incompatibilities.push("CASE_SET_MISMATCH");
  const identity_changes = IDENTITY_KEYS.filter((key) => baseline.identity[key] !== candidate.identity[key]);
  const compatible = incompatibilities.length === 0;
  return {
    contract: CONTRACT, comparison_version: 1, compatible, incompatibilities, identity_changes,
    baseline_identity: baseline.identity, candidate_identity: candidate.identity,
    // Incompatible artifacts are never merged, subtracted or ranked.
    metrics: compatible ? Object.fromEntries(METRICS.map((key) => {
      const before = baseline.aggregate.metrics[key]; const after = candidate.aggregate.metrics[key];
      return [key, { baseline: before, candidate: after, rate_delta: before.rate === null || after.rate === null ? null : after.rate - before.rate }];
    })) : null,
    failures: compatible ? {
      baseline_fatal: baseline.aggregate.fatal_count, candidate_fatal: candidate.aggregate.fatal_count,
      baseline_major: baseline.aggregate.major_count, candidate_major: candidate.aggregate.major_count,
      baseline_unknown: baseline.aggregate.unknown_count, candidate_unknown: candidate.aggregate.unknown_count,
    } : null,
    promotion_eligible: false,
  };
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = argumentsFor(args, ["--baseline", "--candidate", "--output"]);
    if (!options["--baseline"] || !options["--candidate"]) invalid("INVALID_ARGUMENTS");
    const report = compareReports(await readJson(options["--baseline"]), await readJson(options["--candidate"]));
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options["--output"]) await writeNewReport(options["--output"], output);
    process.stdout.write(output);
    // Exit 0 means comparable, never promotion approved or candidate quality passed.
    return report.compatible ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ contract: CONTRACT, compatible: false, code: error instanceof EvaluationInputError ? error.code : "INTERNAL_ERROR", promotion_eligible: false })}\n`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().then((code) => { process.exitCode = code; });
