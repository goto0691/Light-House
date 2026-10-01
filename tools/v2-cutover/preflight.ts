import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";

import { evaluateCutover, type CutoverEvidenceV1, type CutoverTarget } from "../../apps/web/src/lib/v2/cutover/cutover-contract-v1";
import { validateCorpusManifest } from "../v2-eval/manifest";
import evidenceSchema from "./cutover-evidence.schema.json";

const targets = new Set<CutoverTarget>(["capture_default", "library_default", "closure"]);

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function formatErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

function recommendedEnv(evidence: ReturnType<typeof evaluateCutover>) {
  const flags = evidence.recommendedFlags;
  return {
    FLAG_V2_ROUTES: flags.routes ? "1" : "0",
    FLAG_V2_WRITE: flags.write ? "1" : "0",
    FLAG_V2_AI: flags.ai ? "1" : "0",
    FLAG_V2_OFFLINE: flags.offline ? "1" : "0",
    FLAG_V2_DEFAULT_LIBRARY: flags.defaultLibrary ? "1" : "0",
    FLAG_V2_LEGACY_READONLY: flags.legacyReadonly ? "1" : "0",
  };
}

async function main() {
  const targetValue = option("target") ?? "capture_default";
  if (!targets.has(targetValue as CutoverTarget)) throw new Error(`Unknown --target=${targetValue}. Use capture_default, library_default, or closure.`);
  const target = targetValue as CutoverTarget;
  const evidencePath = resolve(option("evidence") ?? ".private/cutover/evidence.json");
  const manifestPath = resolve(option("manifest") ?? ".private/golden-corpus/manifest.yaml");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as CutoverEvidenceV1;

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile<CutoverEvidenceV1>(evidenceSchema);
  if (!validate(evidence)) {
    console.log(JSON.stringify({ target, evidencePath, structurallyValid: false, errors: formatErrors(validate.errors) }, null, 2));
    process.exitCode = 1;
    return;
  }

  const corpus = await validateCorpusManifest(manifestPath);
  const effectiveEvidence: CutoverEvidenceV1 = {
    ...evidence,
    privateCorpus: {
      ...evidence.privateCorpus,
      totalCount: corpus.caseCount,
      readyCount: corpus.readyCount,
      approvedExpectedCount: corpus.readyCount,
    },
  };
  const evaluation = evaluateCutover(target, effectiveEvidence);
  console.log(JSON.stringify({
    target,
    evidencePath,
    manifestPath,
    corpus,
    eligible: evaluation.eligible,
    blockers: evaluation.blockers,
    recommendedEnv: evaluation.eligible ? recommendedEnv(evaluation) : null,
  }, null, 2));
  if (!corpus.structurallyValid || !evaluation.eligible) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
