import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";

import { validateCorpusManifest } from "../../../../../tools/v2-eval/manifest";

type ManifestCase = {
  case_id: string;
  slot_kind: string;
  status: "awaiting_source" | "expected_draft" | "ready";
  source_paths: string[];
  expected_path: string;
};

const tempRoots: string[] = [];
const sourceA = "synthetic source A";
const sourceB = "synthetic source B";
const hash = (source: string) => `sha256:${createHash("sha256").update(source).digest("hex")}`;

function approvedExpected(caseId: string, sourceHashes: string[]) {
  return {
    version: 1,
    case_id: caseId,
    authoring_status: "human_approved",
    source_hashes: sourceHashes,
    must_create: {},
    must_preserve: [],
    must_not_assert: [],
    acceptable_variants: {},
    required_evidence: [],
    recall_queries: [],
    severity_overrides: {},
  };
}

async function makeCorpus() {
  const tempRoot = await mkdtemp(join(tmpdir(), "lighthouse-manifest-safety-"));
  tempRoots.push(tempRoot);
  const root = join(tempRoot, "corpus");
  const outside = join(tempRoot, "outside");
  await Promise.all([
    mkdir(join(root, "sources"), { recursive: true }),
    mkdir(join(root, "expected"), { recursive: true }),
    mkdir(outside),
  ]);
  const cases: ManifestCase[] = Array.from({ length: 20 }, (_, index) => ({
    case_id: `GC-${String(index + 1).padStart(2, "0")}`,
    slot_kind: `synthetic_slot_${index + 1}`,
    status: "awaiting_source",
    source_paths: [],
    expected_path: `expected/GC-${String(index + 1).padStart(2, "0")}.yaml`,
  }));
  const manifest = { version: 1, corpus_id: "synthetic-safety-test", privacy: "private_local_only", cases };
  const manifestPath = join(root, "manifest.yaml");
  async function saveManifest(value: unknown = manifest) {
    await writeFile(manifestPath, stringify(value));
    return manifestPath;
  }
  async function saveExpected(value: unknown = approvedExpected("GC-01", [hash(sourceA)])) {
    await writeFile(join(root, "expected", "GC-01.yaml"), stringify(value));
  }
  await writeFile(join(root, "sources", "a.txt"), sourceA);
  return { root, tempRoot, outside, cases, manifest, manifestPath, saveManifest, saveExpected };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("private corpus manifest safety", () => {
  test.each([
    ["null manifest", null],
    ["scalar manifest", "invalid"],
    ["array manifest", []],
    ["missing cases", {}],
    ["null cases", { cases: null }],
    ["object cases", { cases: {} }],
    ["string cases", { cases: "invalid" }],
    ["null case", { cases: [null] }],
  ])("returns an invalid report for %s instead of throwing", async (_name, value) => {
    const corpus = await makeCorpus();
    await corpus.saveManifest(value);

    const report = await validateCorpusManifest(corpus.manifestPath);
    expect(report).toMatchObject({ structurallyValid: false, readyForPrivateEvaluation: false, readyCount: 0 });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain("manifest");
  });

  test("does not inspect a schema-invalid ready case", async () => {
    const corpus = await makeCorpus();
    await corpus.saveExpected();
    await corpus.saveManifest({
      ...corpus.manifest,
      cases: corpus.cases.map((item, index) => index === 0 ? { ...item, status: "ready", source_paths: null } : item),
    });

    await expect(validateCorpusManifest(corpus.manifestPath)).resolves.toMatchObject({
      structurallyValid: false,
      readyForPrivateEvaluation: false,
      caseCount: 20,
      readyCount: 0,
    });
  });

  test.each([
    ["null", null],
    ["invalid source hashes", { ...approvedExpected("GC-01", []), source_hashes: null }],
    ["missing required content", { version: 1, case_id: "GC-01", authoring_status: "human_approved", source_hashes: [hash(sourceA)] }],
  ])("does not count a ready case with a schema-invalid expected result: %s", async (_name, value) => {
    const corpus = await makeCorpus();
    corpus.cases[0].status = "ready";
    corpus.cases[0].source_paths = ["sources/a.txt"];
    await corpus.saveExpected(value);
    await corpus.saveManifest();

    const report = await validateCorpusManifest(corpus.manifestPath);
    expect(report).toMatchObject({ structurallyValid: false, readyForPrivateEvaluation: false, readyCount: 0 });
    expect(report.errors.join("\n")).toContain("GC-01 expected");
  });

  test.each(["same path", "distinct paths with identical bytes"])("rejects duplicate actual hashes for %s", async (kind) => {
    const corpus = await makeCorpus();
    await writeFile(join(corpus.root, "sources", "duplicate.txt"), sourceA);
    corpus.cases[0].status = "ready";
    corpus.cases[0].source_paths = ["sources/a.txt", kind === "same path" ? "sources/a.txt" : "sources/duplicate.txt"];
    await corpus.saveExpected(approvedExpected("GC-01", [hash(sourceA), hash(sourceB)]));
    await corpus.saveManifest();

    const report = await validateCorpusManifest(corpus.manifestPath);
    expect(report).toMatchObject({ structurallyValid: false, readyForPrivateEvaluation: false, readyCount: 0 });
    expect(report.errors).toContain("GC-01 source hashes do not match the human-approved expected file");
  });

  test("compares exact hashes independently of source path order", async () => {
    const corpus = await makeCorpus();
    await writeFile(join(corpus.root, "sources", "b.txt"), sourceB);
    corpus.cases[0].status = "ready";
    corpus.cases[0].source_paths = ["sources/b.txt", "sources/a.txt"];
    await corpus.saveExpected(approvedExpected("GC-01", [hash(sourceA), hash(sourceB)]));
    await corpus.saveManifest();

    await expect(validateCorpusManifest(corpus.manifestPath)).resolves.toMatchObject({
      structurallyValid: true,
      readyForPrivateEvaluation: false,
      readyCount: 1,
      errors: [],
    });
  });

  test.each(["file", "directory"])("rejects a source %s symlink outside the corpus root", async (kind) => {
    const corpus = await makeCorpus();
    await writeFile(join(corpus.outside, "a.txt"), sourceA);
    await symlink(kind === "file" ? join(corpus.outside, "a.txt") : corpus.outside, join(corpus.root, "source-link"), kind === "file" ? "file" : "dir");
    corpus.cases[0].status = "ready";
    corpus.cases[0].source_paths = [kind === "file" ? "source-link" : "source-link/a.txt"];
    await corpus.saveExpected();
    await corpus.saveManifest();

    const report = await validateCorpusManifest(corpus.manifestPath);
    expect(report).toMatchObject({ structurallyValid: false, readyForPrivateEvaluation: false, readyCount: 0 });
    expect(report.errors.join("\n")).toContain("Path escapes the private corpus root");
  });

  test.each(["ready", "awaiting_source"] as const)("rejects an expected-result symlink outside the corpus root for %s", async (status) => {
    const corpus = await makeCorpus();
    await writeFile(join(corpus.outside, "expected.yaml"), stringify(approvedExpected("GC-01", [hash(sourceA)])));
    await symlink(join(corpus.outside, "expected.yaml"), join(corpus.root, "expected-link.yaml"), "file");
    corpus.cases[0].status = status;
    corpus.cases[0].source_paths = ["sources/a.txt"];
    corpus.cases[0].expected_path = "expected-link.yaml";
    await corpus.saveManifest();

    const report = await validateCorpusManifest(corpus.manifestPath);
    expect(report).toMatchObject({ structurallyValid: false, readyForPrivateEvaluation: false, readyCount: 0 });
    expect(report.errors.join("\n")).toContain("Path escapes the private corpus root");
  });

  test("accepts symlinks that stay inside the canonical corpus root", async () => {
    const corpus = await makeCorpus();
    await symlink(join(corpus.root, "sources"), join(corpus.root, "source-link"), "dir");
    await symlink(corpus.root, join(corpus.tempRoot, "corpus-link"), "dir");
    corpus.cases[0].status = "ready";
    corpus.cases[0].source_paths = ["source-link/a.txt"];
    await corpus.saveExpected();
    await corpus.saveManifest();

    await expect(validateCorpusManifest(join(corpus.tempRoot, "corpus-link", "manifest.yaml"))).resolves.toMatchObject({
      structurallyValid: true,
      readyForPrivateEvaluation: false,
      readyCount: 1,
      errors: [],
    });
  });

  test.each(["draft", "human_approved"])("requires all 20 hash-verified expected results to be human-approved: final case %s", async (authoringStatus) => {
    const corpus = await makeCorpus();
    for (const item of corpus.cases) {
      item.status = "ready";
      item.source_paths = ["sources/a.txt"];
      await writeFile(join(corpus.root, item.expected_path), stringify({
        ...approvedExpected(item.case_id, [hash(sourceA)]),
        authoring_status: item.case_id === "GC-20" ? authoringStatus : "human_approved",
      }));
    }
    await corpus.saveManifest();

    await expect(validateCorpusManifest(corpus.manifestPath)).resolves.toMatchObject({
      structurallyValid: authoringStatus === "human_approved",
      readyForPrivateEvaluation: authoringStatus === "human_approved",
      caseCount: 20,
      readyCount: authoringStatus === "human_approved" ? 20 : 19,
      expectedDraftCount: authoringStatus === "draft" ? 1 : 0,
    });
  });
});
