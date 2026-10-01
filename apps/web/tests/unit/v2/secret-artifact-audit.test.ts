import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

type AuditModule = Readonly<{
  isSecretKey(name: string): boolean;
  loadEnvAuditCorpus(files: readonly string[]): { keys: Set<string>; entries: readonly unknown[] };
  scanArtifactsForEnvSecrets(input: { targets: readonly string[]; workspaceRoot: string; corpus: unknown }): { files: string[]; hits: { key: string; file: string }[] };
}>;

const auditModule =
  // @ts-expect-error The production build gate is an executable ESM utility without declarations.
  await import("../../../scripts/secret-artifact-audit.mjs") as AuditModule;
const {
  isSecretKey,
  loadEnvAuditCorpus,
  scanArtifactsForEnvSecrets,
} = auditModule;

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Worker artifact secret audit", () => {
  test("treats public-prefixed credential names as secrets", () => {
    expect(isSecretKey("CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(isSecretKey("NEXT_PUBLIC_API_KEY")).toBe(true);
    expect(isSecretKey("NEXT_PUBLIC_APP_URL")).toBe(false);
    expect(isSecretKey("GEMINI_MODEL")).toBe(false);
  });

  test("rejects a populated public-prefixed secret before a build starts", () => {
    const workspace = temporaryDirectory("light-house-secret-env-");
    const environmentFile = path.join(workspace, ".env.local");
    writeFileSync(environmentFile, "NEXT_PUBLIC_API_KEY=should-never-be-public\n");

    expect(() => loadEnvAuditCorpus([environmentFile])).toThrow(/public environment variable/i);
  });

  test("finds raw and JSON-escaped secret values without logging the value", () => {
    const workspace = temporaryDirectory("light-house-secret-scan-");
    const environmentFile = path.join(workspace, ".env.local");
    const artifacts = path.join(workspace, "artifacts");
    mkdirSync(artifacts);
    writeFileSync(environmentFile, `CRON_SECRET='alpha"beta-secret'\n`);
    writeFileSync(path.join(artifacts, "raw.bin"), 'prefix alpha"beta-secret suffix');
    writeFileSync(path.join(artifacts, "escaped.js"), 'const value = "alpha\\\"beta-secret";');
    const corpus = loadEnvAuditCorpus([environmentFile]);

    const result = scanArtifactsForEnvSecrets({ targets: [artifacts], workspaceRoot: workspace, corpus });

    expect(result.files).toHaveLength(2);
    expect(result.hits.map((hit: { key: string }) => hit.key)).toEqual(["CRON_SECRET", "CRON_SECRET"]);
  });

  test("refuses to scan a target outside the declared workspace", () => {
    const workspace = temporaryDirectory("light-house-secret-root-");
    const outside = temporaryDirectory("light-house-secret-outside-");
    const corpus = loadEnvAuditCorpus([]);

    expect(() => scanArtifactsForEnvSecrets({ targets: [outside], workspaceRoot: workspace, corpus })).toThrow(/outside the workspace/i);
  });
});
