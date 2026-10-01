import { resolve } from "node:path";

import { validateCorpusManifest } from "./manifest";

async function main() {
  const requireReady = process.argv.includes("--require-ready");
  const providedPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const manifestPath = resolve(providedPath ?? ".private/golden-corpus/manifest.yaml");
  const report = await validateCorpusManifest(manifestPath);

  console.log(JSON.stringify({ manifestPath, ...report }, null, 2));
  if (!report.structurallyValid || (requireReady && !report.readyForPrivateEvaluation)) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
