import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";

import { evaluateCutover, type CutoverEvidenceV1, type CutoverGate, type CutoverTarget } from "../../apps/web/src/lib/v2/cutover/cutover-contract-v1";
import { loadPrivateCorpus, readJson } from "../v2-eval/recorded-input";
import evidenceSchema from "./cutover-evidence.schema.json";
import { verifyRecordedCutoverEvidence, type CutoverCorpusSnapshot } from "./recorded-evidence";

const targets = new Set<CutoverTarget>(["capture_default", "library_default", "closure"]);
const allowedOptions = new Set(["target", "evidence", "manifest", "identity", "report"]);
const validateEvidence = new Ajv2020({ allErrors: false, strict: false }).compile<CutoverEvidenceV1>(evidenceSchema);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function options(args: string[]) {
  const values: Record<string, string> = {};
  for (const argument of args) {
    const match = /^--([a-z]+)=(.+)$/.exec(argument);
    if (!match || !allowedOptions.has(match[1]) || Object.hasOwn(values, match[1])) throw new Error("INVALID_ARGUMENTS");
    values[match[1]] = match[2];
  }
  return values;
}

function currentCandidate() {
  const gitOptions = { cwd: repositoryRoot, encoding: "utf8" as const, windowsHide: true, timeout: 10_000 };
  const head = spawnSync("git", ["rev-parse", "HEAD"], gitOptions);
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal", "--",
    "apps/web/src", "apps/web/public", "apps/web/custom-worker.ts", "apps/web/next.config.mjs",
    "apps/web/open-next.config.ts", "apps/web/package.json", "apps/web/scripts",
    "wrangler.toml", "migrations", "package.json", "package-lock.json", "tools/v2-cutover", "tools/v2-eval",
  ], gitOptions);
  const sha = head.status === 0 && /^[a-f0-9]{40}$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
  return { currentBuildSha: sha, sourceClean: sha !== null && status.status === 0 && status.stdout.trim() === "" };
}

async function optionalJson(path: string) {
  try { return await readJson(resolve(path)); } catch { return null; }
}

function publicGate(item: CutoverGate) {
  // Actual values and validation diagnostics may contain private paths, hashes,
  // IDs or arbitrary input. Only contract-owned labels and keys leave this CLI.
  return { key: item.key, label: item.label, required: item.required };
}

function recommendedEnv(evaluation: ReturnType<typeof evaluateCutover>) {
  const flags = evaluation.recommendedFlags;
  return {
    FLAG_V2_ROUTES: flags.routes ? "1" : "0",
    FLAG_V2_WRITE: flags.write ? "1" : "0",
    FLAG_V2_AI: flags.ai ? "1" : "0",
    FLAG_V2_OFFLINE: flags.offline ? "1" : "0",
    FLAG_V2_DEFAULT_LIBRARY: flags.defaultLibrary ? "1" : "0",
    FLAG_V2_LEGACY_READONLY: flags.legacyReadonly ? "1" : "0",
  };
}

export async function runPreflight(args: string[], now = new Date().toISOString()) {
  let target: CutoverTarget = "capture_default";
  try {
    const values = options(args);
    const targetValue = values.target ?? target;
    if (!targets.has(targetValue as CutoverTarget)) throw new Error("INVALID_ARGUMENTS");
    target = targetValue as CutoverTarget;
    const evidence = await optionalJson(values.evidence ?? ".private/cutover/evidence.json");
    if (!validateEvidence(evidence)) return { target, eligible: false, blockers: [{ key: "evidence_schema_invalid" }], recommendedEnv: null };

    let corpus: CutoverCorpusSnapshot | null = null;
    try { corpus = await loadPrivateCorpus(resolve(values.manifest ?? ".private/golden-corpus/manifest.yaml")); } catch { /* No private validator diagnostics leave this CLI. */ }
    const expectedIdentity = await optionalJson(values.identity ?? ".private/cutover/identity.json");
    const report = await optionalJson(values.report ?? ".private/cutover/recorded-report.json");
    const recorded = verifyRecordedCutoverEvidence({ report, expectedIdentity, corpus, ...currentCandidate() });
    const effectiveEvidence: CutoverEvidenceV1 = {
      ...evidence,
      privateCorpus: {
        totalCount: corpus?.expected.length ?? 0,
        readyCount: recorded.readyCount,
        approvedExpectedCount: recorded.approvedExpectedCount,
        fatalFailureCount: recorded.fatalFailureCount,
        evaluationPassed: recorded.evaluationPassed,
      },
      experience: { ...evidence.experience, recallTop10Rate: recorded.recallTop10Rate },
    };
    const evaluation = evaluateCutover(target, effectiveEvidence, now);
    const blockers = [...evaluation.blockers, ...recorded.gates.filter((item) => !item.passed)];
    const eligible = blockers.length === 0;
    return {
      target,
      corpus: { caseCount: corpus?.expected.length ?? 0, readyCount: recorded.readyCount, approvedExpectedCount: recorded.approvedExpectedCount },
      eligible,
      blockers: blockers.map(publicGate),
      recommendedEnv: eligible ? recommendedEnv(evaluation) : null,
    };
  } catch {
    // Do not echo paths, arguments, parser messages or Git/provider diagnostics.
    return { target, eligible: false, blockers: [{ key: "preflight_input_invalid" }], recommendedEnv: null };
  }
}

export async function main(args = process.argv.slice(2)) {
  const result = await runPreflight(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.eligible ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; }).catch(() => {
    process.stdout.write(`${JSON.stringify({ eligible: false, blockers: [{ key: "preflight_failed" }], recommendedEnv: null })}\n`);
    process.exitCode = 1;
  });
}
