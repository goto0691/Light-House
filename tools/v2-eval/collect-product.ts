import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EvaluationInputError } from "./contracts";
import { PRODUCT_RECEIPT_CONTRACT, ProductCollectionError, collectProductObservations, writeProductCollection } from "./product-observations";

/** No artifact paths, identities, values, source text, queries, or error messages reach stdout/stderr. */
export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const allowed = ["--manifest", "--identity", "--mapping", "--export-root", "--output", "--receipt"];
    const options: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.includes(args[index]) || Object.hasOwn(options, args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new ProductCollectionError("COLLECTION_ARGUMENTS_INVALID");
      options[args[index]] = args[index + 1];
    }
    if (allowed.some((option) => !options[option])) throw new ProductCollectionError("COLLECTION_ARGUMENTS_INVALID");
    const collection = await collectProductObservations({ manifest: options["--manifest"], identity: options["--identity"], mapping: options["--mapping"], exportRoot: options["--export-root"] });
    await writeProductCollection(options["--manifest"], options["--output"], options["--receipt"], collection);
    process.stdout.write(`${JSON.stringify({ contract: PRODUCT_RECEIPT_CONTRACT, code: "COLLECTION_CREATED", cases: collection.observations.cases.length, live_provider_verified: false, live_search_executed: false, promotion_eligible: false })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ contract: PRODUCT_RECEIPT_CONTRACT, code: error instanceof ProductCollectionError || error instanceof EvaluationInputError ? error.code : "COLLECTION_INTERNAL_ERROR", promotion_eligible: false })}\n`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().then((code) => { process.exitCode = code; });
