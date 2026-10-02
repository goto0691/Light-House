import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import { CONTRACT, corpusDigest, digest, type Expected, type Identity, type ObservationSet } from "../v2-eval/contracts";
import { evaluateRecorded } from "../v2-eval/evaluator";
import { runPreflight } from "./preflight";
import { verifyRecordedCutoverEvidence } from "./recorded-evidence";

const identity: Identity = { build_sha: "a".repeat(40), schema_sha256: digest("schema"), model_config_sha256: digest("model"), prompt_sha256: digest("prompt"), registry_sha256: digest("registry") };
const marker = "PRIVATE_SOURCE_PATH_QUERY_TITLE_TYPED_VALUE_DO_NOT_PRINT";
const NOW = "2026-10-03T00:00:00.000Z";
const sourceSha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function recording() {
  const expected: Expected[] = Array.from({ length: 20 }, (_, index) => ({
    version: 1, case_id: `GC-${String(index + 1).padStart(2, "0")}`, authoring_status: "human_approved", source_hashes: [sourceSha(marker)],
    must_create: {}, must_preserve: [], must_not_assert: [], acceptable_variants: {}, required_evidence: [],
    recall_queries: [{ id: marker, query: marker, required_ids: [marker], top_k: 10 }], severity_overrides: {},
  }));
  const corpus = { corpus_sha256: corpusDigest("test-private-recording", expected), expected };
  const observations: ObservationSet = {
    contract: CONTRACT, mode: "private-recorded", identity, corpus_sha256: corpus.corpus_sha256,
    cases: expected.map((item) => ({ case_id: item.case_id, source_hashes: item.source_hashes, recall_results: [{ id: marker, ranked_ids: [marker] }], fatal_failures: [] })),
  };
  return { corpus, observations };
}

function report(data = recording()) {
  return evaluateRecorded({
    mode: "private-recorded", identity, ...data.corpus, observations: data.observations,
    readiness: { current_hashes_verified: true, human_approved_cases: 20, ready_cases: 20 },
  });
}

function verify(overrides: Partial<Parameters<typeof verifyRecordedCutoverEvidence>[0]> = {}) {
  const data = recording();
  return verifyRecordedCutoverEvidence({ report: report(data), expectedIdentity: identity, corpus: data.corpus, currentBuildSha: identity.build_sha, sourceClean: true, ...overrides });
}
const blockers = (result: ReturnType<typeof verify>) => result.gates.filter((item) => !item.passed).map((item) => item.key);

test("a perfect bound foundation report supplies metrics and still blocks live, rubric and promotion", () => {
  const result = verify();
  assert.deepEqual(blockers(result), ["recorded_live_provider", "recorded_rubric", "recorded_promotion"]);
  assert.equal(result.readyCount, 20);
  assert.equal(result.approvedExpectedCount, 20);
  assert.equal(result.recallTop10Rate, 1);
  assert.equal(result.evaluationPassed, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
});

test("missing report and missing expected identity cannot use old declared evaluation booleans", () => {
  for (const overrides of [{ report: null }, { expectedIdentity: null }]) {
    const result = verify(overrides);
    if ("report" in overrides) assert.ok(blockers(result).includes("recorded_report"));
    assert.ok(blockers(result).includes("candidate_identity"));
    assert.equal(result.evaluationPassed, false);
    assert.equal(result.recallTop10Rate, null);
  }
});

test("each candidate identity dimension must match the report, and the build must match current HEAD", () => {
  for (const key of Object.keys(identity) as (keyof Identity)[]) {
    const altered: Identity = { ...identity, [key]: key === "build_sha" ? "b".repeat(40) : digest(`altered-${key}`) };
    assert.ok(blockers(verify({ expectedIdentity: altered })).includes("candidate_identity"));
  }
  assert.ok(blockers(verify({ currentBuildSha: "b".repeat(40) })).includes("candidate_identity"));
  assert.ok(blockers(verify({ currentBuildSha: null })).includes("candidate_identity"));
  assert.ok(blockers(verify({ sourceClean: false })).includes("candidate_source_clean"));
});

test("a current corpus digest, exact case set and approval counts must all match", () => {
  const corpus = recording().corpus;
  assert.ok(blockers(verify({ corpus: { ...corpus, corpus_sha256: digest("changed expected") } })).includes("recorded_corpus"));
  assert.ok(blockers(verify({ corpus: { ...corpus, expected: corpus.expected.slice(1) } })).includes("recorded_corpus"));
  assert.ok(blockers(verify({ corpus: null })).includes("recorded_readiness"));
  assert.ok(blockers(verify({ corpus: { ...corpus, readiness: { current_hashes_verified: true, human_approved_cases: 19, user_delegated_cases: 1, ready_cases: 20 } } })).includes("recorded_readiness"));
});

test("human and independently reviewed user-delegated approvals remain distinct and total twenty", () => {
  const data = recording();
  data.corpus.expected[0] = {
    ...data.corpus.expected[0], authoring_status: "assistant_reviewed",
    approval: { kind: "user_delegated", delegated_at: "2026-10-02T00:00:00.000Z", user_request_sha256: digest("request"), authored_by: "author", reviewed_by: "independent-reviewer", reviewed_at: "2026-10-03T00:00:00.000Z", grounding_path: "grounding.json", grounding_sha256: digest("grounding") },
  };
  data.corpus.corpus_sha256 = corpusDigest("test-private-recording", data.corpus.expected);
  data.observations.corpus_sha256 = data.corpus.corpus_sha256;
  const readiness = { current_hashes_verified: true, human_approved_cases: 19, user_delegated_cases: 1, ready_cases: 20 };
  const mixedReport = evaluateRecorded({ mode: "private-recorded", identity, ...data.corpus, observations: data.observations, readiness });
  const result = verify({ report: mixedReport, corpus: { ...data.corpus, readiness } });
  assert.equal(result.readyCount, 20);
  assert.equal(result.approvedExpectedCount, 20);
  assert.deepEqual(blockers(result), ["recorded_live_provider", "recorded_rubric", "recorded_promotion"]);
  const wrongApprovalCounts = { ...data.corpus, readiness: { ...readiness, human_approved_cases: 20, user_delegated_cases: 0 } };
  assert.ok(blockers(verify({ report: mixedReport, corpus: wrongApprovalCounts })).includes("recorded_readiness"));
});

test("fatal failures and unsupported criteria remain blockers even with perfect source and recall metrics", () => {
  const fatal = recording();
  fatal.observations.cases[0].fatal_failures = ["RESTRICTED_EXPOSURE"];
  const fatalResult = verify({ report: report(fatal), corpus: fatal.corpus });
  assert.ok(blockers(fatalResult).includes("recorded_fatal"));
  assert.equal(fatalResult.fatalFailureCount, 1);

  const unknown = recording();
  unknown.corpus.expected[0].must_not_assert = [marker];
  unknown.corpus.corpus_sha256 = corpusDigest("test-private-recording", unknown.corpus.expected);
  unknown.observations.corpus_sha256 = unknown.corpus.corpus_sha256;
  assert.ok(blockers(verify({ report: report(unknown), corpus: unknown.corpus })).includes("recorded_unknown"));
});

test("edited aggregates and an invented live/rubric/promotion PASS are rejected by the report parser", () => {
  const changes = [
    (value: ReturnType<typeof report>) => { value.aggregate.fatal_count = 1; },
    (value: ReturnType<typeof report>) => { (value as unknown as { live_provider_verified: boolean }).live_provider_verified = true; },
    (value: ReturnType<typeof report>) => { (value.promotion as { eligible: boolean }).eligible = true; },
    (value: ReturnType<typeof report>) => { (value.rubric as { status: string }).status = "passed"; },
  ];
  for (const change of changes) {
    const altered = report(); change(altered);
    assert.ok(blockers(verify({ report: altered })).includes("recorded_report"));
  }
});

test("recall is recomputed from validated metrics and cannot be supplied when no recall was measured", () => {
  const data = recording();
  data.corpus.expected.forEach((item) => { item.recall_queries = []; });
  data.observations.cases.forEach((item) => { item.recall_results = []; });
  data.corpus.corpus_sha256 = corpusDigest("test-private-recording", data.corpus.expected);
  data.observations.corpus_sha256 = data.corpus.corpus_sha256;
  assert.equal(verify({ report: report(data), corpus: data.corpus }).recallTop10Rate, null);
});

function evidence() {
  return {
    version: 1, measuredAt: NOW, ownerCaptureStartedAt: "2026-09-01T00:00:00.000Z", captureDefaultAt: null,
    privateCorpus: { totalCount: 20, readyCount: 20, approvedExpectedCount: 20, fatalFailureCount: 0, evaluationPassed: true },
    runtime: { liveGeminiRolesPassed: true, workerDeploymentPassed: true, sourceCommitHealthy: true },
    devices: { windowsImePassed: true, androidSharePassed: true, iosFallbackPassed: true, screenReaderPassed: true },
    migration: { liveInventoryCompleted: true, r2InventoryCompleted: true, adapterCoveragePercent: 100, structuralReconciliationPassed: true, substantiveSamplePassed: true, finalDeltaReconciled: true, verifiedSnapshotAt: "2026-10-02T00:00:00.000Z" },
    experience: { usabilityPassed: true, recallTop10Rate: 1 }, operations: { legacyReadonlyGuardPassed: true, rollbackDrillPassed: true },
  };
}

async function temporary<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), `lighthouse-cutover-${marker}-`));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("CLI strips arbitrary arguments, paths, parser diagnostics and evidence values", async () => {
  await temporary(async (root) => {
    const evidencePath = join(root, "evidence.json");
    await writeFile(evidencePath, JSON.stringify({ ...evidence(), [marker]: marker }));
    const args = [`--evidence=${evidencePath}`, `--manifest=${join(root, marker)}`, `--identity=${join(root, marker)}`, `--report=${join(root, marker)}`];
    for (const arguments_ of [args, [`--target=${marker}`], [`--evidence=${marker}`, `--unknown=${marker}`], ["--target=closure", "--target=capture_default"]]) {
      const result = await runPreflight(arguments_, NOW);
      assert.equal(result.eligible, false);
      assert.equal(result.recommendedEnv, null);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
      assert.doesNotMatch(JSON.stringify(result), /evidencePath|manifestPath|instancePath/);
    }
  });
});

test("CLI ignores asserted evaluation/recall PASS without verified current corpus and report", async () => {
  await temporary(async (root) => {
    const evidencePath = join(root, "evidence.json");
    await writeFile(evidencePath, JSON.stringify(evidence()));
    const result = await runPreflight([`--evidence=${evidencePath}`, `--manifest=${join(root, marker)}`, `--identity=${join(root, marker)}`, `--report=${join(root, marker)}`], NOW);
    assert.equal(result.eligible, false);
    assert.equal(result.recommendedEnv, null);
    assert.ok(result.blockers.some((item) => item.key === "private_corpus_evaluation"));
    assert.ok(result.blockers.some((item) => item.key === "recorded_report"));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  });
});

test("CLI binds a real hash-checked corpus and validated report, and rejects a changed source", async () => {
  await temporary(async (root) => {
    await mkdir(join(root, "sources"));
    await mkdir(join(root, "expected"));
    await writeFile(join(root, "sources", "source.txt"), marker);
    const data = recording();
    for (const item of data.corpus.expected) await writeFile(join(root, "expected", `${item.case_id}.yaml`), stringify(item));
    const manifestPath = join(root, "manifest.yaml");
    await writeFile(manifestPath, stringify({ version: 1, corpus_id: "test-private-recording", privacy: "private_local_only", cases: data.corpus.expected.map((item) => ({ case_id: item.case_id, slot_kind: "synthetic", status: "ready", source_paths: ["sources/source.txt"], expected_path: `expected/${item.case_id}.yaml` })) }));
    const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
    assert.equal(head.status, 0);
    const currentIdentity = { ...identity, build_sha: head.stdout.trim() };
    const currentReport = evaluateRecorded({ mode: "private-recorded", identity: currentIdentity, ...data.corpus, observations: { ...data.observations, identity: currentIdentity }, readiness: { current_hashes_verified: true, human_approved_cases: 20, ready_cases: 20 } });
    const evidencePath = join(root, "evidence.json"); const identityPath = join(root, "identity.json"); const reportPath = join(root, "report.json");
    await writeFile(evidencePath, JSON.stringify(evidence()));
    await writeFile(identityPath, JSON.stringify(currentIdentity));
    await writeFile(reportPath, JSON.stringify(currentReport));
    const args = [`--evidence=${evidencePath}`, `--manifest=${manifestPath}`, `--identity=${identityPath}`, `--report=${reportPath}`];
    const result = await runPreflight(args, NOW);
    assert.deepEqual(result.corpus, { caseCount: 20, readyCount: 20, approvedExpectedCount: 20 });
    assert.equal(result.eligible, false);
    assert.equal(result.recommendedEnv, null);
    for (const key of ["recorded_report", "candidate_identity", "recorded_corpus", "recorded_readiness"]) assert.ok(!result.blockers.some((item) => item.key === key), key);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
    await writeFile(join(root, "sources", "source.txt"), "changed source");
    const changed = await runPreflight(args, NOW);
    assert.ok(changed.blockers.some((item) => item.key === "recorded_corpus"));
    assert.equal(changed.eligible, false);
    assert.equal(changed.recommendedEnv, null);
  });
});

test("real CLI exit and stdout remain fail-closed and sanitized for malformed private inputs", async () => {
  await temporary(async (root) => {
    const evidencePath = join(root, "evidence.json");
    await writeFile(evidencePath, marker);
    const result = spawnSync(process.execPath, ["--import", "tsx", resolve("tools/v2-cutover/preflight.ts"), `--evidence=${evidencePath}`], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).eligible, false);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, new RegExp(marker));
  });
});
