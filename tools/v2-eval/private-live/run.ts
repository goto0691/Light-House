import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EvaluationInputError } from "../contracts";
import { ProductCollectionError } from "../product-observations";
import { fail, LIVE_CONTRACT, PrivateLiveError } from "./boundary";
import { runPrivateLive } from "./pipeline";

export function parseLiveArguments(args: string[]) {
  // Reject before any source/env/key read or gateway construction.
  if (args.filter((argument) => argument === "--live").length !== 1) fail("PRIVATE_LIVE_APPROVAL_REQUIRED");
  const allowed = ["--manifest", "--authorization", "--output-directory"], options: Record<string, string> = {};
  const values = args.filter((argument) => argument !== "--live");
  for (let index = 0; index < values.length; index += 2) {
    if (!allowed.includes(values[index]) || Object.hasOwn(options, values[index]) || !values[index + 1] || values[index + 1].startsWith("--")) fail("PRIVATE_LIVE_ARGUMENTS_INVALID");
    options[values[index]] = values[index + 1];
  }
  if (allowed.some((option) => !options[option])) fail("PRIVATE_LIVE_ARGUMENTS_INVALID");
  return { live: true, manifest: options["--manifest"], authorization: options["--authorization"], outputDirectory: options["--output-directory"] };
}
export function publicErrorCode(error: unknown) { return error instanceof PrivateLiveError || error instanceof ProductCollectionError || error instanceof EvaluationInputError ? error.code : "PRIVATE_LIVE_INTERNAL_ERROR"; }
export async function main(args = process.argv.slice(2)) {
  try {
    const result = await runPrivateLive(parseLiveArguments(args)), receipt = result.receipt;
    process.stdout.write(`${JSON.stringify({ contract: LIVE_CONTRACT, code: "PRIVATE_LIVE_CREATED", cases: 20, provider_calls: receipt.provider_calls, max_provider_calls: 20,
      analysis_succeeded: receipt.analysis_succeeded, analysis_not_attempted: receipt.analysis_not_attempted, source_hash_equality: receipt.source_hash_equality,
      ranked_id_top1: receipt.ranked_id_top1, ranked_id_top10: receipt.ranked_id_top10, semantic_rubric: "unknown-review-required", typed_value_quality: receipt.typed_value_quality,
      live_provider_verified: receipt.live_provider_verified, worker_runtime_verified: false, promotion_eligible: false, decision: "blocked" })}\n`);
    return receipt.all_model_analyses_succeeded ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ contract: LIVE_CONTRACT, code: publicErrorCode(error), promotion_eligible: false, decision: "blocked" })}\n`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().then((code) => { process.exitCode = code; });
