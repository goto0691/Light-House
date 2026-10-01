import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { parse } from "yaml";

import manifestSchema from "./schemas/golden-corpus-manifest.schema.json";
import expectedSchema from "./schemas/expected-result.schema.json";

type ManifestCase = {
  case_id: string;
  slot_kind: string;
  status: "awaiting_source" | "expected_draft" | "ready";
  source_paths: string[];
  expected_path: string;
  notes?: string;
};

type CorpusManifest = {
  version: 1;
  corpus_id: string;
  privacy: "private_local_only";
  cases: ManifestCase[];
};

type ExpectedResult = {
  version: 1;
  case_id: string;
  authoring_status: "draft" | "human_approved";
  source_hashes: string[];
};

export type CorpusValidationReport = {
  structurallyValid: boolean;
  readyForPrivateEvaluation: boolean;
  caseCount: number;
  expectedDraftCount: number;
  readyCount: number;
  errors: string[];
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateManifestSchema = ajv.compile<CorpusManifest>(manifestSchema);
const validateExpectedSchema = ajv.compile<ExpectedResult>(expectedSchema);

function formatAjvErrors(prefix: string, errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map((error) => `${prefix}${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

class PrivateCorpusPathError extends Error {}

function assertInsidePrivateRoot(root: string, path: string, candidate: string) {
  const relation = relative(root, path);
  if (!relation || isAbsolute(relation) || relation.startsWith(`..${sep}`) || relation === "..") {
    throw new PrivateCorpusPathError(`Path escapes the private corpus root: ${candidate}`);
  }
}

async function resolvePrivatePath(root: string, candidate: string) {
  if (isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) {
    throw new PrivateCorpusPathError(`Path must be relative and cannot traverse directories: ${candidate}`);
  }
  const resolved = resolve(root, candidate);
  assertInsidePrivateRoot(root, resolved, candidate);
  const canonicalPath = await realpath(resolved);
  assertInsidePrivateRoot(root, canonicalPath, candidate);
  return canonicalPath;
}

async function fileSha256(path: string) {
  const buffer = await readFile(path);
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

export async function validateCorpusManifest(manifestPath: string): Promise<CorpusValidationReport> {
  const errors: string[] = [];
  let corpusRoot: string;
  let manifest: unknown;
  try {
    corpusRoot = await realpath(dirname(resolve(manifestPath)));
    manifest = parse(await readFile(manifestPath, "utf8"), { logLevel: "silent" });
  } catch (error) {
    return {
      structurallyValid: false,
      readyForPrivateEvaluation: false,
      caseCount: 0,
      expectedDraftCount: 0,
      readyCount: 0,
      errors: [`manifest read failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  if (!validateManifestSchema(manifest)) {
    return {
      structurallyValid: false,
      readyForPrivateEvaluation: false,
      caseCount: typeof manifest === "object" && manifest !== null && "cases" in manifest && Array.isArray(manifest.cases)
        ? manifest.cases.length
        : 0,
      expectedDraftCount: 0,
      readyCount: 0,
      errors: formatAjvErrors("manifest", validateManifestSchema.errors),
    };
  }

  const expectedIds = Array.from({ length: 20 }, (_, index) => `GC-${String(index + 1).padStart(2, "0")}`);
  const caseIds = manifest.cases.map((item) => item.case_id);
  if (new Set(caseIds).size !== caseIds.length) errors.push("manifest case_id values must be unique");
  for (const expectedId of expectedIds) {
    if (!caseIds.includes(expectedId)) errors.push(`manifest is missing ${expectedId}`);
  }

  let expectedDraftCount = 0;
  let readyCount = 0;
  for (const item of manifest.cases) {
    let expected: ExpectedResult | null = null;
    try {
      const expectedPath = await resolvePrivatePath(corpusRoot, item.expected_path);
      const parsedExpected: unknown = parse(await readFile(expectedPath, "utf8"), { logLevel: "silent" });
      if (!validateExpectedSchema(parsedExpected)) {
        errors.push(...formatAjvErrors(`${item.case_id} expected`, validateExpectedSchema.errors));
        continue;
      }
      expected = parsedExpected;
      if (expected.case_id !== item.case_id) errors.push(`${item.case_id} expected file has mismatched case_id ${expected.case_id}`);
      if (expected.authoring_status === "draft") expectedDraftCount += 1;
    } catch (error) {
      if (item.status !== "awaiting_source" || error instanceof PrivateCorpusPathError) {
        errors.push(`${item.case_id} expected read failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (item.status !== "ready") continue;
    if (!expected || expected.authoring_status !== "human_approved") {
      errors.push(`${item.case_id} is ready but expected result is not human_approved`);
      continue;
    }
    if (item.source_paths.length === 0) {
      errors.push(`${item.case_id} is ready but has no source_paths`);
      continue;
    }
    try {
      const actualHashes = await Promise.all(item.source_paths.map(async (path) => fileSha256(await resolvePrivatePath(corpusRoot, path))));
      const approvedHashes = [...expected.source_hashes].sort();
      if (actualHashes.length !== approvedHashes.length || actualHashes.sort().some((hash, index) => hash !== approvedHashes[index])) {
        errors.push(`${item.case_id} source hashes do not match the human-approved expected file`);
        continue;
      }
      readyCount += 1;
    } catch (error) {
      errors.push(`${item.case_id} source read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const structurallyValid = errors.length === 0;
  return {
    structurallyValid,
    readyForPrivateEvaluation: structurallyValid && readyCount === 20,
    caseCount: manifest.cases.length,
    expectedDraftCount,
    readyCount,
    errors,
  };
}
