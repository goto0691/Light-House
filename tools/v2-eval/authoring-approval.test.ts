import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import { approvedExpected, expectedRulesDigest } from "./authoring-approval";
import { expectedResults, type Expected } from "./contracts";
import { validateCorpusManifest } from "./manifest";
import { loadPrivateCorpus } from "./recorded-input";

const sha = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function delegated(caseId = "GC-01") {
  const expected: Expected = {
    version: 1, case_id: caseId, authoring_status: "assistant_reviewed", source_hashes: [sha("synthetic source")],
    must_create: {}, must_preserve: [], must_not_assert: [], acceptable_variants: {}, required_evidence: [], recall_queries: [], severity_overrides: {},
    approval: { kind: "user_delegated", delegated_at: "2026-01-01T00:00:00Z", user_request_sha256: sha("synthetic delegation"),
      authored_by: "author", reviewed_by: "independent-reviewer", reviewed_at: "2026-01-01T01:00:00Z", grounding_path: `grounding/${caseId}.json`, grounding_sha256: sha("") },
  };
  const proof = { version: 1, case_id: caseId, rules_sha256: expectedRulesDigest(expected), source_hashes: expected.source_hashes,
    delegation: { kind: expected.approval!.kind, delegated_at: expected.approval!.delegated_at, user_request_sha256: expected.approval!.user_request_sha256 },
    authored_by: "author", reviewed_by: "independent-reviewer", reviewed_at: "2026-01-01T01:00:00Z", evidence_checked: true, findings: [] };
  const bytes = Buffer.from(JSON.stringify(proof));
  expected.approval!.grounding_sha256 = sha(bytes);
  return { expected, bytes };
}

test("delegated answers require an independent, hash-bound source review and are not human-approved", async () => {
  const { expected, bytes } = delegated();
  assert.equal(expectedResults([expected])[0].authoring_status, "assistant_reviewed");
  assert.equal(await approvedExpected(expected, async () => bytes), true);
  assert.equal(await approvedExpected({ ...expected, authoring_status: "draft" }, async () => bytes), false);
  const noApproval = structuredClone(expected); delete noApproval.approval;
  assert.throws(() => expectedResults([noApproval]));
});

test("edited rules, source identity and review proof cannot retain delegated approval", async () => {
  for (const change of [
    (item: Expected) => item.must_not_assert.push("new source interpretation"),
    (item: Expected) => item.source_hashes.push(sha("different source")),
    (item: Expected) => { item.approval!.reviewed_by = item.approval!.authored_by; },
    (item: Expected) => { item.approval!.reviewed_at = "2025-12-31T23:00:00Z"; },
    (item: Expected) => { item.approval!.delegated_at = "2026-01-01T00:30:00Z"; },
    (item: Expected) => { item.approval!.user_request_sha256 = sha("another delegation"); },
  ]) {
    const { expected, bytes } = delegated(); change(expected);
    assert.equal(await approvedExpected(expected, async () => bytes), false);
  }
  const { expected, bytes } = delegated();
  assert.equal(await approvedExpected(expected, async () => Buffer.concat([bytes, Buffer.from(" ")])), false);
  assert.equal(await approvedExpected(expected, async () => { throw new Error("private error"); }), false);
});

test("delegation metadata cannot be attached to a human approval or bypass the strict schema", () => {
  const { expected } = delegated();
  assert.throws(() => expectedResults([{ ...expected, authoring_status: "human_approved" }]));
  assert.throws(() => expectedResults([{ ...expected, approval: { ...expected.approval, raw_private_data: "forbidden" } }]));
  assert.throws(() => expectedResults([{ ...expected, approval: { ...expected.approval, delegated_at: "yesterday" } }]));
});

test("current private readiness counts reviewed delegated cases separately and invalidates a changed proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "lighthouse-delegated-corpus-"));
  try {
    for (const directory of ["sources", "expected", "grounding"]) await mkdir(join(root, directory));
    await writeFile(join(root, "sources/source.txt"), "synthetic source");
    const cases = [];
    for (let index = 1; index <= 20; index += 1) {
      const caseId = `GC-${String(index).padStart(2, "0")}`;
      const { expected, bytes } = delegated(caseId);
      await writeFile(join(root, `expected/${caseId}.yaml`), stringify(expected));
      await writeFile(join(root, `grounding/${caseId}.json`), bytes);
      cases.push({ case_id: caseId, slot_kind: "synthetic", status: "ready", source_paths: ["sources/source.txt"], expected_path: `expected/${caseId}.yaml` });
    }
    const manifest = join(root, "manifest.yaml");
    await writeFile(manifest, stringify({ version: 1, corpus_id: "synthetic-delegation-test", privacy: "private_local_only", cases }));
    assert.equal((await validateCorpusManifest(manifest)).readyCount, 20);
    const corpus = await loadPrivateCorpus(manifest);
    assert.deepEqual(corpus.readiness, { current_hashes_verified: true, human_approved_cases: 0, ready_cases: 20, user_delegated_cases: 20 });
    const path = join(root, "expected/GC-01.yaml");
    assert.ok((await readFile(path, "utf8")).includes("assistant_reviewed"));
    await writeFile(join(root, "grounding/GC-01.json"), "{}");
    assert.equal((await validateCorpusManifest(manifest)).readyCount, 19);
    await assert.rejects(loadPrivateCorpus(manifest));
  } finally { await rm(root, { recursive: true, force: true }); }
});
