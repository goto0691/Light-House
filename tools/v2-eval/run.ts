import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EvaluationInputError, invalid } from "./contracts";
import { runPrivate, runSynthetic, writeNewReport } from "./recorded-input";
import { serializeReport } from "./report";

export function argumentsFor(args: string[], allowed: readonly string[]) {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) invalid("INVALID_ARGUMENTS");
    options[args[i]] = args[i + 1];
  }
  return options;
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = argumentsFor(args, ["--mode", "--fixture", "--manifest", "--identity", "--observations", "--output"]);
    let report;
    if (options["--mode"] === "synthetic" && options["--fixture"] && !options["--manifest"] && !options["--identity"] && !options["--observations"]) {
      report = await runSynthetic(options["--fixture"]);
    } else if (options["--mode"] === "private-recorded" && options["--manifest"] && options["--identity"] && options["--observations"] && !options["--fixture"]) {
      report = await runPrivate(options["--manifest"], options["--identity"], options["--observations"]);
    } else invalid("INVALID_ARGUMENTS");
    const output = serializeReport(report);
    if (options["--output"]) await writeNewReport(options["--output"], output);
    process.stdout.write(output);
    // No exit-0 promotion path exists: the rubric and other release gates are not scored here.
    return report.promotion.decision === "blocked" ? 1 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ contract: "recorded-evaluation-v1", decision: "blocked", code: error instanceof EvaluationInputError ? error.code : "INTERNAL_ERROR" })}\n`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().then((code) => { process.exitCode = code; });
