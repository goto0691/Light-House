import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";

import { validateCorpusManifest } from "../../../../../tools/v2-eval/manifest";

const tempRoots: string[] = [];

type TestManifestCase = {
  case_id: string;
  slot_kind: string;
  status: "awaiting_source" | "expected_draft" | "ready";
  source_paths: string[];
  expected_path: string;
};

async function makeCorpus() {
  const root = await mkdtemp(join(tmpdir(), "lighthouse-corpus-"));
  tempRoots.push(root);
  await mkdir(join(root, "sources"));
  await mkdir(join(root, "expected"));
  const cases: TestManifestCase[] = Array.from({ length: 20 }, (_, index) => ({
    case_id: `GC-${String(index + 1).padStart(2, "0")}`,
    slot_kind: `slot_${index + 1}`,
    status: "awaiting_source",
    source_paths: [],
    expected_path: `expected/GC-${String(index + 1).padStart(2, "0")}.yaml`,
  }));
  return { root, cases };
}

function expected(caseId: string, sourceHashes: string[], authoringStatus = "human_approved") {
  return {
    version: 1,
    case_id: caseId,
    authoring_status: authoringStatus,
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

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("private golden corpus manifest", () => {
  test("accepts a 20-slot structure and counts a hash-verified, human-approved case", async () => {
    const { root, cases } = await makeCorpus();
    const bytes = Buffer.from("synthetic private source boundary");
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    await writeFile(join(root, "sources", "GC-01.txt"), bytes);
    await writeFile(join(root, "expected", "GC-01.yaml"), stringify(expected("GC-01", [hash])));
    cases[0] = {
      ...cases[0],
      status: "ready",
      source_paths: ["sources/GC-01.txt"],
    };
    await writeFile(
      join(root, "manifest.yaml"),
      stringify({ version: 1, corpus_id: "contract-test", privacy: "private_local_only", cases }),
    );

    await expect(validateCorpusManifest(join(root, "manifest.yaml"))).resolves.toMatchObject({
      structurallyValid: true,
      readyForPrivateEvaluation: false,
      caseCount: 20,
      readyCount: 1,
      errors: [],
    });
  });

  test("fails closed on a source path that escapes the private corpus root", async () => {
    const { root, cases } = await makeCorpus();
    await writeFile(join(root, "expected", "GC-01.yaml"), stringify(expected("GC-01", [])));
    cases[0] = {
      ...cases[0],
      status: "ready",
      source_paths: ["../outside.txt"],
    };
    await writeFile(
      join(root, "manifest.yaml"),
      stringify({ version: 1, corpus_id: "contract-test", privacy: "private_local_only", cases }),
    );

    const report = await validateCorpusManifest(join(root, "manifest.yaml"));
    expect(report.structurallyValid).toBe(false);
    expect(report.errors.join("\n")).toContain("cannot traverse directories");
  });

  test("does not count a ready case when the approved source hash differs", async () => {
    const { root, cases } = await makeCorpus();
    await writeFile(join(root, "sources", "GC-01.txt"), "actual source");
    const wrongHash = `sha256:${"0".repeat(64)}`;
    await writeFile(join(root, "expected", "GC-01.yaml"), stringify(expected("GC-01", [wrongHash])));
    cases[0] = {
      ...cases[0],
      status: "ready",
      source_paths: ["sources/GC-01.txt"],
    };
    await writeFile(
      join(root, "manifest.yaml"),
      stringify({ version: 1, corpus_id: "contract-test", privacy: "private_local_only", cases }),
    );

    const report = await validateCorpusManifest(join(root, "manifest.yaml"));
    expect(report.readyCount).toBe(0);
    expect(report.errors).toContain("GC-01 source hashes do not match the human-approved expected file");
  });
});
