import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import { compareReports } from "./compare";
import { CONTRACT, EvaluationInputError, corpusDigest, digest, type Expected, type Identity, type ObservationSet } from "./contracts";
import { evaluateRecorded } from "./evaluator";
import { loadPrivateCorpus, runPrivate, runSynthetic, writeNewReport } from "./recorded-input";
import { METRICS, parseReport, promotion, serializeReport, summarize } from "./report";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const identity: Identity = { build_sha: "a".repeat(40), schema_sha256: sha("schema"), model_config_sha256: sha("fake-model"), prompt_sha256: sha("prompt"), registry_sha256: sha("registry") };
const secret = "PRIVATE_SOURCE_QUERY_LABEL_VALUE_NAME_PROVIDER_ERROR_CREDENTIAL";
function expected(caseId = "GC-01"): Expected {
  return {
    version: 1, case_id: caseId, authoring_status: "draft", source_hashes: [sha(secret)],
    must_create: {}, must_preserve: [{ exact_typed_value: { id: secret, value_type: "rating", value: 4.5, scale_max: 5 } }],
    must_not_assert: [], acceptable_variants: { primary_type: ["place_review", secret] }, required_evidence: [],
    recall_queries: [{ id: secret, query: secret, required_ids: [secret], top_k: 10 }], severity_overrides: {},
  };
}
function setup() {
  const want = [expected()];
  const observations: ObservationSet = {
    contract: CONTRACT, mode: "synthetic", identity: structuredClone(identity), corpus_sha256: corpusDigest("synthetic-test", want),
    cases: [{ case_id: "GC-01", source_hashes: [sha(secret)], typed_values: [{ id: secret, value_type: "rating", value: 4.5, scale_max: 5 }], primary_types: [secret], recall_results: [{ id: secret, ranked_ids: [secret] }], fatal_failures: [] }],
  };
  return { want, observations };
}
function evaluate(data = setup()) {
  data.observations.corpus_sha256 = corpusDigest("synthetic-test", data.want);
  return evaluateRecorded({ mode: "synthetic", identity, corpus_sha256: data.observations.corpus_sha256, expected: data.want, observations: data.observations, readiness: { current_hashes_verified: false, human_approved_cases: 0, ready_cases: 0 } });
}
function inputError(code: string) { return (error: unknown) => error instanceof EvaluationInputError && error.code === code; }
async function temporary<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "lighthouse-recorded-eval-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function privateCorpus(root: string) {
  await mkdir(join(root, "sources")); await mkdir(join(root, "expected"));
  const entries = Array.from({ length: 20 }, (_, index) => ({ ...expected(`GC-${String(index + 1).padStart(2, "0")}`), authoring_status: "human_approved" as const }));
  await writeFile(join(root, "sources/source.txt"), secret);
  for (const item of entries) await writeFile(join(root, `expected/${item.case_id}.yaml`), stringify(item));
  const manifestPath = join(root, "manifest.yaml");
  await writeFile(manifestPath, stringify({ version: 1, corpus_id: "private-test-fixture", privacy: "private_local_only", cases: entries.map((item) => ({ case_id: item.case_id, slot_kind: "synthetic", status: "ready", source_paths: ["sources/source.txt"], expected_path: `expected/${item.case_id}.yaml` })) }));
  const observations = { ...setup().observations, mode: "private-recorded", corpus_sha256: corpusDigest("private-test-fixture", entries), cases: entries.map((item) => ({ ...setup().observations.cases[0], case_id: item.case_id })) };
  const identityPath = join(root, "identity.json"); const observationsPath = join(root, "observations.json");
  await writeFile(identityPath, JSON.stringify(identity)); await writeFile(observationsPath, JSON.stringify(observations));
  return { manifestPath, identityPath, observationsPath, entries, observations };
}

test("supported measurements succeed without claiming synthetic/private/provider/release PASS", () => {
  const report = evaluate();
  for (const metric of Object.values(report.aggregate.metrics)) assert.equal(metric.rate, 1);
  assert.equal(report.provenance, "synthetic-recordings");
  assert.equal(report.live_provider_verified, false);
  assert.equal(report.promotion.eligible, false);
  assert.equal(report.promotion.decision, "review_required");
  assert.equal(report.rubric.average_points, null);
  assert.equal(report.rubric.cases_at_or_above_13, null);
  assert.equal(report.rubric.policy, "per_case_vs_average_unresolved");
  assert.doesNotMatch(serializeReport(report), new RegExp(secret));
});
test("source hashes compare the exact unordered set and cannot hide missing/extra hashes", () => {
  const data = setup(); data.want[0].source_hashes.push(sha("second")); data.observations.cases[0].source_hashes = [...data.want[0].source_hashes].reverse();
  assert.equal(evaluate(data).aggregate.metrics.source_hash_equality.rate, 1);
  data.observations.cases[0].source_hashes = [sha("second")];
  assert.equal(evaluate(data).aggregate.fatal_count, 1);
  data.observations.cases[0].source_hashes.push(sha("unexpected"));
  assert.equal(evaluate(data).aggregate.metrics.source_hash_equality.rate, 0);
});
test("typed value type, scale and unit are exact, never normalized or coerced", () => {
  for (const actual of [
    { id: secret, value_type: "number", value: 4.5 },
    { id: secret, value_type: "text", value: "4.5" },
    { id: secret, value_type: "rating", value: 9, scale_max: 10 },
    { id: secret, value_type: "rating", value: 4.5, scale_max: 5, unit: "stars" },
  ]) {
    const data = setup(); data.observations.cases[0].typed_values = [actual as never];
    assert.equal(evaluate(data).aggregate.fatal_count, 1);
  }
});
test("false, zero, exact text and exact date strings preserve their typed representation", () => {
  for (const value of [
    { id: secret, value_type: "boolean", value: false }, { id: secret, value_type: "number", value: 0, unit: "km" },
    { id: secret, value_type: "text", value: " line\n" }, { id: secret, value_type: "date", value: "2026-10" },
  ]) {
    const data = setup(); data.want[0].must_preserve = [{ exact_typed_value: JSON.parse(JSON.stringify(value)) }]; data.observations.cases[0].typed_values = [value as never];
    assert.equal(evaluate(data).aggregate.metrics.exact_typed_value_recall.rate, 1);
  }
});
test("missing observations remain unknown while an observed absent value is a measured miss", () => {
  const data = setup(); const observed = data.observations.cases[0];
  delete observed.source_hashes; delete observed.typed_values; delete observed.primary_types; delete observed.recall_results;
  const report = evaluate(data);
  assert.equal(report.aggregate.unknown_count, 4);
  for (const metric of Object.values(report.aggregate.metrics)) assert.equal(metric.rate, null);
  assert.equal(report.promotion.decision, "blocked");
  const empty = setup(); empty.observations.cases[0].typed_values = [];
  assert.equal(evaluate(empty).aggregate.metrics.exact_typed_value_recall.rate, 0);
  assert.equal(evaluate(empty).aggregate.major_count, 1);
});
test("one alias target has recall denominator one; precision penalizes extra unaccepted labels", () => {
  const data = setup(); data.observations.cases[0].primary_types = [secret, "unaccepted"];
  const metrics = evaluate(data).aggregate.metrics;
  assert.deepEqual(metrics.type_alias_precision, { matched: 1, total: 2, unknown: 0, rate: 0.5 });
  assert.deepEqual(metrics.type_alias_recall, { matched: 1, total: 1, unknown: 0, rate: 1 });
  data.observations.cases[0].primary_types = [];
  assert.equal(evaluate(data).aggregate.metrics.type_alias_recall.rate, 0);
  assert.equal(evaluate(data).aggregate.metrics.type_alias_precision.rate, null);
});
test("rank 1/5/10 boundaries and all-required query success use IDs without query text", () => {
  for (const rank of [1, 5, 6, 10, 11]) {
    const data = setup(); data.observations.cases[0].recall_results![0].ranked_ids = Array.from({ length: rank }, (_, index) => index === rank - 1 ? secret : `filler-${index}`);
    const metrics = evaluate(data).aggregate.metrics;
    for (const k of [1, 5, 10] as const) assert.equal(metrics[`ranked_id_top${k}`].rate, rank <= k ? 1 : 0);
  }
  const data = setup(); data.want[0].recall_queries[0].required_ids = [secret, "second"];
  const metrics = evaluate(data).aggregate.metrics;
  assert.equal(metrics.ranked_id_top10.rate, 0.5); assert.equal(metrics.query_all_required_top10.rate, 0);
});
test("extra free rules and unknown keys block promotion even with every supported metric at one", () => {
  const data = setup(); const item = data.want[0];
  item.must_create = { documents: 1, entities: [{ kind: secret }] };
  item.must_preserve.push({ arbitrary: secret }); item.must_not_assert = [secret];
  item.required_evidence = [{ target: secret, locator_kind: "text_span" }];
  item.acceptable_variants.unknown_rule = [secret]; item.severity_overrides[secret] = "minor";
  item.recall_queries.push({ query: secret, expected_in_top: 10 });
  const report = evaluate(data);
  for (const metric of Object.values(report.aggregate.metrics)) assert.equal(metric.rate, 1);
  assert.equal(report.aggregate.unknown_count, 10);
  assert.equal(report.promotion.decision, "blocked");
  assert.doesNotMatch(serializeReport(report), new RegExp(secret));
});
test("extra keys inside an otherwise recognized rule make the entire rule unsupported", () => {
  const data = setup(); (data.want[0].must_preserve[0].exact_typed_value as Record<string, unknown>).precision = "approximate";
  const report = evaluate(data);
  assert.equal(report.aggregate.metrics.exact_typed_value_recall.total, 0);
  assert.ok(report.aggregate.unknown_count > 0);
  data.want[0].recall_queries[0].allowed_privacy = ["normal"];
  assert.equal(evaluate(data).aggregate.metrics.ranked_id_top10.total, 0);
});
test("known fatal failures cannot be averaged away or downgraded by severity overrides", () => {
  const data = setup(); data.observations.cases[0].fatal_failures = ["RESTRICTED_EXPOSURE", "WRONG_ENTITY_MERGE"];
  data.want[0].severity_overrides.RESTRICTED_EXPOSURE = "minor";
  const report = evaluate(data);
  assert.equal(report.aggregate.fatal_count, 2); assert.equal(report.promotion.decision, "blocked");
});
test("absent criteria produce null metrics rather than an invented perfect score", () => {
  const data = setup(); data.want[0].must_preserve = []; data.want[0].acceptable_variants = {}; data.want[0].recall_queries = [];
  data.observations.cases[0].typed_values = []; data.observations.cases[0].primary_types = []; data.observations.cases[0].recall_results = [];
  const report = evaluate(data);
  for (const key of METRICS.filter((key) => key !== "source_hash_equality")) assert.equal(report.aggregate.metrics[key].rate, null);
  assert.equal(report.promotion.eligible, false);
});
test("missing, extra, duplicate and mismatched case IDs fail closed", () => {
  for (const mutate of [
    (data: ReturnType<typeof setup>) => { data.observations.cases = []; },
    (data: ReturnType<typeof setup>) => { data.observations.cases.push(data.observations.cases[0]); },
    (data: ReturnType<typeof setup>) => { data.observations.cases[0].case_id = "GC-02"; },
  ]) { const data = setup(); mutate(data); assert.throws(() => evaluate(data), inputError("CASE_SET_MISMATCH")); }
});
test("input identity and mode mismatches fail closed", () => {
  const data = setup(); data.observations.identity.prompt_sha256 = sha("other");
  assert.throws(() => evaluate(data), inputError("IDENTITY_MISMATCH"));
  data.observations.identity = identity; data.observations.mode = "private-recorded";
  assert.throws(() => evaluate(data), inputError("MODE_MISMATCH"));
});
test("observation schema rejects duplicate IDs/hashes/ranks, raw errors, invalid typed values and injected expectations", () => {
  for (const mutate of [
    (item: Record<string, unknown>) => { item.provider_error = secret; },
    (item: Record<string, unknown>) => { item.expected = secret; },
    (item: Record<string, unknown>) => { item.source_hashes = [sha(secret), sha(secret)]; },
    (item: Record<string, unknown>) => { item.typed_values = [null]; },
    (item: Record<string, unknown>) => { item.typed_values = [{ id: secret, value_type: "number", value: "4.5" }]; },
    (item: Record<string, unknown>) => { item.typed_values = [{ id: secret, value_type: "rating", value: 4.5, scale_max: 0 }]; },
    (item: Record<string, unknown>) => { item.typed_values = [setup().observations.cases[0].typed_values![0], setup().observations.cases[0].typed_values![0]]; },
    (item: Record<string, unknown>) => { item.recall_results = [{ id: secret, ranked_ids: [secret, secret] }]; },
    (item: Record<string, unknown>) => { item.fatal_failures = [secret]; },
  ]) { const data = setup(); mutate(data.observations.cases[0] as unknown as Record<string, unknown>); assert.throws(() => evaluate(data), inputError("INPUT_INVALID")); }
});
test("malformed/free non-JSON expected data never becomes a successful score", () => {
  const data = setup(); data.want[0].must_create.private = Infinity;
  assert.throws(() => evaluate(data), inputError("INPUT_INVALID"));
  const circular = setup(); circular.want[0].must_create.self = circular.want[0].must_create;
  assert.throws(() => evaluateRecorded({ mode: "synthetic", identity, corpus_sha256: sha("unused"), expected: circular.want, observations: circular.observations, readiness: { current_hashes_verified: false, ready_cases: 0, human_approved_cases: 0 } }), inputError("INPUT_INVALID"));
});
test("unsafe exact numeric integers are rejected in expected and observed typed values", () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1)]) {
    const data = setup(); data.want[0].must_preserve = [{ exact_typed_value: { id: secret, value_type: "number", value } }];
    assert.throws(() => evaluate(data), inputError("INPUT_INVALID"));
    const observed = setup(); observed.observations.cases[0].typed_values = [{ id: secret, value_type: "number", value }];
    assert.throws(() => evaluate(observed), inputError("INPUT_INVALID"));
  }
});
test("reports reject matched-plus-unknown counts exceeding total even with recomputed summaries", () => {
  const report = evaluate(); const item = report.cases[0];
  item.metrics.source_hash_equality.unknown = 1; item.metrics.source_hash_equality.rate = null;
  item.issues.push({ code: "SOURCE_OBSERVATION_MISSING", count: 1, severity: "unknown" }); item.unknown_count = 1;
  report.aggregate = summarize(report.cases); report.promotion = promotion(report.mode, report.aggregate);
  assert.throws(() => parseReport(report), inputError("REPORT_INVALID"));
});
test("reports reject concealed measured failures and unknown observations despite matching summaries", () => {
  for (const key of ["source_hash_equality", "exact_typed_value_recall", "type_alias_recall", "query_all_required_top10"] as const) {
    for (const unknown of [0, 1]) {
      const report = evaluate(); const metric = report.cases[0].metrics[key];
      metric.matched = 0; metric.unknown = unknown; metric.rate = unknown ? null : 0;
      report.aggregate = summarize(report.cases); report.promotion = promotion(report.mode, report.aggregate);
      assert.throws(() => parseReport(report), inputError("REPORT_INVALID"));
    }
  }
});
test("comparison permits build/model/prompt/registry experiments and reports deltas", () => {
  const baseline = evaluate(); const candidate = structuredClone(baseline);
  for (const key of ["model_config_sha256", "prompt_sha256", "registry_sha256"] as const) candidate.identity[key] = sha(`new-${key}`);
  candidate.identity.build_sha = "b".repeat(40);
  const result = compareReports(baseline, candidate);
  assert.equal(result.compatible, true); assert.equal(result.identity_changes.length, 4);
  assert.equal(result.metrics!.ranked_id_top10.rate_delta, 0); assert.equal(result.promotion_eligible, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});
test("comparison rejects changed corpus/expected/schema without computing a delta", () => {
  for (const kind of ["corpus", "schema"]) {
    const baseline = evaluate(); const candidate = structuredClone(baseline);
    if (kind === "corpus") candidate.corpus_sha256 = sha("changed expected or source"); else candidate.identity.schema_sha256 = sha("changed schema");
    const result = compareReports(baseline, candidate);
    assert.equal(result.compatible, false); assert.equal(result.metrics, null); assert.equal(result.failures, null);
  }
});
test("reports reject injected data, contradictory summary/promotion, invalid hash and duplicate cases", () => {
  for (const mutate of [
    (value: Record<string, unknown>) => { value.secret = secret; },
    (value: Record<string, unknown>) => { (value.identity as Identity).build_sha = secret; },
    (value: Record<string, unknown>) => { (value.aggregate as { fatal_count: number }).fatal_count = 1; },
    (value: Record<string, unknown>) => { (value.promotion as { eligible: boolean }).eligible = true; },
    (value: Record<string, unknown>) => { (value.cases as unknown[]).push((value.cases as unknown[])[0]); },
  ]) { const report = evaluate(); mutate(report as unknown as Record<string, unknown>); assert.throws(() => parseReport(report), inputError("REPORT_INVALID")); }
});
test("a synthetic fixture's observation corpus digest cannot be stale", async () => temporary(async (root) => {
  const data = setup(); data.want[0].must_not_assert.push(secret);
  const path = join(root, "fixture.json");
  await writeFile(path, JSON.stringify({ synthetic_fixture_version: 1, corpus_id: "synthetic-test", identity, expected: data.want, observations: data.observations }));
  await assert.rejects(runSynthetic(path), inputError("CORPUS_IDENTITY_MISMATCH"));
}));
test("private recorded mode verifies all20 current human-approved source hashes", async () => temporary(async (root) => {
  const input = await privateCorpus(root);
  const report = await runPrivate(input.manifestPath, input.identityPath, input.observationsPath);
  assert.equal(report.readiness.ready_cases, 20); assert.equal(report.provenance, "private-recorded-observations");
  assert.equal(report.live_provider_verified, false); assert.equal(report.promotion.eligible, false);
  assert.doesNotMatch(serializeReport(report), new RegExp(secret));
  const synthetic = evaluate(); assert.equal(compareReports(synthetic, report).compatible, false);
}));
test("direct evaluator DTO projects readiness without leaking caller-supplied properties", () => {
  const data = setup(); data.want = Array.from({ length: 20 }, (_, index) => ({ ...expected(`GC-${String(index + 1).padStart(2, "0")}`), authoring_status: "human_approved" }));
  data.observations.mode = "private-recorded";
  data.observations.cases = data.want.map((item) => ({ ...setup().observations.cases[0], case_id: item.case_id }));
  data.observations.corpus_sha256 = corpusDigest("synthetic-test", data.want);
  const report = evaluateRecorded({ mode: "private-recorded", identity, corpus_sha256: data.observations.corpus_sha256, expected: data.want, observations: data.observations,
    readiness: { current_hashes_verified: true, human_approved_cases: 20, ready_cases: 20, source: secret, provider_error: secret } as never });
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  assert.doesNotThrow(() => serializeReport(report));
  assert.throws(() => evaluateRecorded({ mode: "private-recorded", identity, corpus_sha256: data.observations.corpus_sha256, expected: data.want, observations: data.observations,
    readiness: { current_hashes_verified: secret, human_approved_cases: 20, ready_cases: 20 } as never }), inputError("CORPUS_NOT_READY"));
});
test("private source mutation or draft expected invalidates readiness immediately", async () => temporary(async (root) => {
  const input = await privateCorpus(root);
  await writeFile(join(root, "sources/source.txt"), "changed");
  await assert.rejects(runPrivate(input.manifestPath, input.identityPath, input.observationsPath), inputError("CORPUS_NOT_READY"));
  await writeFile(join(root, "sources/source.txt"), secret);
  await writeFile(join(root, "expected/GC-20.yaml"), stringify({ ...input.entries[19], authoring_status: "draft" }));
  await assert.rejects(loadPrivateCorpus(input.manifestPath), inputError("CORPUS_NOT_READY"));
}));
test("private approved expected edits invalidate the recorded observation identity", async () => temporary(async (root) => {
  const input = await privateCorpus(root);
  input.entries[0].must_not_assert.push(secret);
  await writeFile(join(root, "expected/GC-01.yaml"), stringify(input.entries[0]));
  await assert.rejects(runPrivate(input.manifestPath, input.identityPath, input.observationsPath), inputError("CORPUS_IDENTITY_MISMATCH"));
}));
test("private source and expected paths cannot follow an outside-root symlink", async () => temporary(async (root) => {
  const corpusRoot = join(root, "corpus"); await mkdir(corpusRoot); const input = await privateCorpus(corpusRoot);
  // Windows directory junctions exercise the same realpath boundary without requiring symlink privileges.
  const outside = join(root, "outside"); await mkdir(outside);
  for (const item of input.entries) await writeFile(join(outside, `${item.case_id}.yaml`), stringify(item));
  await rm(join(corpusRoot, "expected"), { recursive: true });
  await symlink(outside, join(corpusRoot, "expected"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(loadPrivateCorpus(input.manifestPath), inputError("CORPUS_NOT_READY"));
}));
test("exclusive output never overwrites inputs or follows an existing/dangling symlink", async () => temporary(async (root) => {
  const path = join(root, "private-source"); await writeFile(path, secret);
  await assert.rejects(writeNewReport(path, "safe report"), inputError("REPORT_WRITE_FAILED"));
  assert.equal(await readFile(path, "utf8"), secret);
  const existingTarget = process.platform === "win32" ? join(root, "protected-directory") : path;
  if (process.platform === "win32") await mkdir(existingTarget);
  for (const [name, target] of [["existing", existingTarget], ["dangling", join(root, "absent")]]) {
    const link = join(root, name); await symlink(target, link, process.platform === "win32" ? "junction" : "file");
    await assert.rejects(writeNewReport(link, "safe report"), inputError("REPORT_WRITE_FAILED"));
  }
  const newPath = join(root, "new-report"); await writeNewReport(newPath, "safe report");
  assert.equal(await readFile(newPath, "utf8"), "safe report");
  // POSIX mode bits are not an access-control mechanism on Windows.
  if (process.platform !== "win32") assert.equal((await stat(newPath)).mode & 0o777, 0o600);
}));
test("CLI redacts parser, file-system, schema and argument errors on stdout and stderr", async () => temporary(async (root) => {
  const invalidJson = join(root, secret); await writeFile(invalidJson, `{${secret}`);
  const cli = resolve("tools/v2-eval/run.ts");
  for (const args of [["--mode", "synthetic", "--fixture", invalidJson], ["--mode", "synthetic", "--fixture", join(root, secret, "missing")], ["--unknown", secret]]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
    assert.equal(result.stderr, ""); assert.equal(JSON.parse(result.stdout).decision, "blocked");
  }
  const compare = spawnSync(process.execPath, ["--import", "tsx", resolve("tools/v2-eval/compare.ts"), "--baseline", invalidJson, "--candidate", invalidJson], { encoding: "utf8" });
  assert.equal(compare.status, 1); assert.doesNotMatch(compare.stdout + compare.stderr, new RegExp(secret));
}));
test("private CLI never emits YAML unknown-tag source lines from manifest or expected files", async () => temporary(async (root) => {
  const input = await privateCorpus(root);
  const originalManifest = await readFile(input.manifestPath, "utf8");
  const expectedPath = join(root, "expected/GC-01.yaml"); const originalExpected = await readFile(expectedPath, "utf8");
  for (const target of ["manifest", "expected"]) {
    await writeFile(input.manifestPath, target === "manifest" ? originalManifest.replace("corpus_id: private-test-fixture", `corpus_id: !${secret} ${secret}`) : originalManifest);
    await writeFile(expectedPath, target === "expected" ? originalExpected.replace("authoring_status: human_approved", `authoring_status: !${secret} human_approved`) : originalExpected);
    const result = spawnSync(process.execPath, ["--import", "tsx", "tools/v2-eval/run.ts", "--mode", "private-recorded", "--manifest", input.manifestPath, "--identity", input.identityPath, "--observations", input.observationsPath], { encoding: "utf8" });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).code, "CORPUS_CHANGED");
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret)); assert.equal(result.stderr, "");
  }
}));
test("checked-in synthetic demo has stable private-safe report bytes and explicit exit2", async () => {
  const report = await runSynthetic(resolve("tools/v2-eval/fixtures/synthetic-demo.json"));
  const result = spawnSync(process.execPath, ["--import", "tsx", "tools/v2-eval/run.ts", "--mode", "synthetic", "--fixture", "tools/v2-eval/fixtures/synthetic-demo.json"], { encoding: "utf8" });
  assert.equal(result.status, 2); assert.equal(result.stderr, ""); assert.equal(result.stdout, serializeReport(report));
  assert.equal(result.stdout, await readFile("tools/v2-eval/fixtures/synthetic-demo.report.json", "utf8"));
});
test("canonical identity is independent of expected object key ordering", () => {
  assert.equal(digest({ b: { d: 1, c: 2 }, a: 0 }), digest({ a: 0, b: { c: 2, d: 1 } }));
  const report = evaluate();
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  assert.doesNotThrow(() => parseReport(reorder(report)));
});
