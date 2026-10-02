import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { parseDocument } from "yaml";

import { corpusDigest, exactKeys, expectedResults, identity, invalid, record, type Expected } from "./contracts";
import { evaluateRecorded } from "./evaluator";
import { validateCorpusManifest } from "./manifest";
import manifestSchema from "./schemas/golden-corpus-manifest.schema.json";
import { approvedExpected } from "./authoring-approval";
import type { EvaluationReport } from "./report";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export async function readJson(path: string): Promise<unknown> {
  try {
    if ((await stat(path)).size > MAX_INPUT_BYTES) invalid();
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch { return invalid("INPUT_READ_FAILED"); }
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel.length > 0 && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
async function privatePath(root: string, path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) invalid("CORPUS_CHANGED");
  const candidate = resolve(root, path);
  if (!inside(root, candidate)) invalid("CORPUS_CHANGED");
  const canonical = await realpath(candidate);
  if (!inside(root, canonical)) invalid("CORPUS_CHANGED");
  return canonical;
}
async function readYaml(path: string): Promise<unknown> {
  if ((await stat(path)).size > MAX_INPUT_BYTES) invalid("CORPUS_CHANGED");
  const document = parseDocument(await readFile(path, "utf8"), { logLevel: "silent" });
  if (document.errors.length || document.warnings.length) invalid("CORPUS_CHANGED");
  return document.toJS() as unknown;
}
type Manifest = { corpus_id: string; cases: { case_id: string; status: string; source_paths: string[]; expected_path: string }[] };
const validateManifest = new Ajv2020({ strict: false }).compile<Manifest>(manifestSchema);

/** A fresh readiness check and independently hash-checked snapshot, never a cached readyCount. */
export async function loadPrivateCorpus(manifestPath: string): Promise<{ corpus_sha256: string; expected: Expected[]; readiness: EvaluationReport["readiness"] }> {
  const readiness = await validateCorpusManifest(manifestPath);
  // Existing validator's diagnostic strings can contain private paths. Never return them.
  if (!readiness.readyForPrivateEvaluation || readiness.readyCount !== 20) invalid("CORPUS_NOT_READY");
  try {
    const root = await realpath(dirname(resolve(manifestPath)));
    if (!inside(root, await realpath(manifestPath))) invalid("CORPUS_CHANGED");
    const manifest = await readYaml(manifestPath);
    if (!validateManifest(manifest) || new Set(manifest.cases.map((item) => item.case_id)).size !== 20) invalid("CORPUS_CHANGED");
    const expected: Expected[] = [];
    for (const item of manifest.cases) {
      const entry = expectedResults([await readYaml(await privatePath(root, item.expected_path))])[0];
      if (item.status !== "ready" || entry.case_id !== item.case_id || !item.source_paths.length
        || !await approvedExpected(entry, async (path) => readFile(await privatePath(root, path)))) invalid("CORPUS_CHANGED");
      const hashes: string[] = [];
      for (const path of item.source_paths) {
        const bytes = await readFile(await privatePath(root, path));
        hashes.push(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
      }
      if (JSON.stringify(hashes.sort()) !== JSON.stringify([...entry.source_hashes].sort())) invalid("CORPUS_CHANGED");
      expected.push(entry);
    }
    const human = expected.filter((item) => item.authoring_status === "human_approved").length;
    const delegated = expected.length - human;
    return { corpus_sha256: corpusDigest(manifest.corpus_id, expected), expected,
      readiness: { current_hashes_verified: true, human_approved_cases: human, ready_cases: 20,
        ...(delegated ? { user_delegated_cases: delegated } : {}) } };
  } catch { return invalid("CORPUS_CHANGED"); }
}

export async function runPrivate(manifestPath: string, identityPath: string, observationsPath: string) {
  const corpus = await loadPrivateCorpus(manifestPath);
  const requiredIdentity = identity(await readJson(identityPath));
  const observations = await readJson(observationsPath);
  const report = evaluateRecorded({
    mode: "private-recorded", identity: requiredIdentity, ...corpus, observations,
    readiness: corpus.readiness,
  });
  // Recheck current files after scoring, so a changed source/expected cannot retain an old ready result.
  const current = await loadPrivateCorpus(manifestPath);
  if (current.corpus_sha256 !== corpus.corpus_sha256) invalid("CORPUS_CHANGED");
  return report;
}
export async function runSynthetic(fixturePath: string) {
  const fixture = await readJson(fixturePath);
  if (!record(fixture) || !exactKeys(fixture, ["synthetic_fixture_version", "corpus_id", "identity", "expected", "observations"])
    || fixture.synthetic_fixture_version !== 1 || typeof fixture.corpus_id !== "string" || !fixture.corpus_id) invalid();
  const expected = expectedResults(fixture.expected);
  return evaluateRecorded({
    mode: "synthetic", identity: identity(fixture.identity), expected, observations: fixture.observations,
    corpus_sha256: corpusDigest(fixture.corpus_id, expected),
    readiness: { current_hashes_verified: false, human_approved_cases: 0, ready_cases: 0 },
  });
}

/** Exclusive creation prevents replacement of any input, source, expected, report or symlink. */
export async function writeNewReport(path: string, contents: string) {
  try {
    const parent = await realpath(dirname(resolve(path)));
    if (!(await lstat(parent)).isDirectory()) invalid("REPORT_WRITE_FAILED");
    // wx uses O_EXCL: even a dangling final symlink is rejected, and no existing file is truncated.
    await writeFile(resolve(parent, basename(resolve(path))), contents, { flag: "wx", mode: 0o600 });
  } catch { return invalid("REPORT_WRITE_FAILED"); }
}
