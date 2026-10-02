import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EvaluationInputError } from "../contracts";
import { ProductCollectionError } from "../product-observations";
import { PRIVATE_REPLAY_CONTRACT, PrivateReplayError, replayPrivateProduct } from "./replay";

export async function main(args = process.argv.slice(2)) {
  try {
    const allowed = ["--manifest", "--identity", "--output-directory"], options: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.includes(args[index]) || Object.hasOwn(options, args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new PrivateReplayError("PRIVATE_REPLAY_ARGUMENTS_INVALID");
      options[args[index]] = args[index + 1];
    }
    if (allowed.some((option) => !options[option])) throw new PrivateReplayError("PRIVATE_REPLAY_ARGUMENTS_INVALID");
    const run = await replayPrivateProduct({ manifest: options["--manifest"], identity: options["--identity"], outputDirectory: options["--output-directory"] });
    process.stdout.write(`${JSON.stringify({ contract: PRIVATE_REPLAY_CONTRACT, code: "PRIVATE_REPLAY_CREATED", cases: run.observations.cases.length, source_hash_equality: run.receipt.source_hash_equality, ranked_id_top1: run.receipt.ranked_id_top1, ranked_id_top10: run.receipt.ranked_id_top10, primary_type_quality: "unknown-not-analyzed", typed_value_quality: "unknown-not-extracted", live_provider_verified: false, worker_runtime_verified: false, promotion_eligible: false, decision: run.report.promotion.decision })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ contract: PRIVATE_REPLAY_CONTRACT, code: error instanceof PrivateReplayError || error instanceof ProductCollectionError || error instanceof EvaluationInputError ? error.code : "PRIVATE_REPLAY_INTERNAL_ERROR", promotion_eligible: false })}\n`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().then((code) => { process.exitCode = code; });
