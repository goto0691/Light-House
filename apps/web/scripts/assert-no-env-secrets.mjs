import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  loadEnvAuditCorpus,
  nextEnvFilePaths,
  scanArtifactsForEnvSecrets,
} from "./secret-artifact-audit.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = path.resolve(appDir, "..", "..");
const targets = process.argv.slice(2).map((target) => path.resolve(process.cwd(), target));
if (!targets.length) targets.push(path.join(appDir, ".open-next"));
for (const target of targets) {
  if (!existsSync(target)) throw new Error(`Artifact target does not exist: ${path.relative(monorepoRoot, target)}`);
}

const corpus = loadEnvAuditCorpus(nextEnvFilePaths(monorepoRoot, appDir));
const result = scanArtifactsForEnvSecrets({ targets, workspaceRoot: monorepoRoot, corpus });

console.log(`artifact-secret-audit: keys=${new Set(corpus.entries.map((entry) => entry.key)).size} files=${result.files.length} hits=${result.hits.length}`);
if (result.hits.length) {
  for (const hit of result.hits) {
    console.error(`artifact-secret-hit: key=${hit.key} file=${path.relative(monorepoRoot, hit.file)}`);
  }
  process.exitCode = 1;
}
