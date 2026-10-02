import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AUTHORIZATION_CONTRACT, describeLiveTarget, fail, LIVE_CONTRACT, outputPath, writePrivateJson } from "./boundary";
import { publicErrorCode } from "./run";

/** Read-only local preparation. Writes an unauthorized request; no env/key loader or model factory. */
export async function prepareLiveApproval(manifest: string, outputDirectory: string, requestPath: string) {
  const prepared = await describeLiveTarget(manifest, outputDirectory), path = await outputPath(prepared.root, requestPath);
  if (path === prepared.output) fail("PRIVATE_LIVE_OUTPUT_INVALID");
  await writePrivateJson(path, { contract: AUTHORIZATION_CONTRACT, target: prepared.target, authorized: false,
    approval: { kind: "user_explicit_private_transmission", user_request_sha256: null, recorded_at: null } });
  return { target: prepared.target, readiness: prepared.corpus.readiness };
}
export async function main(args = process.argv.slice(2)) {
  try {
    const allowed = ["--manifest", "--output-directory", "--approval-request"], options: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.includes(args[index]) || Object.hasOwn(options, args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) fail("PRIVATE_LIVE_ARGUMENTS_INVALID");
      options[args[index]] = args[index + 1];
    }
    if (allowed.some((option) => !options[option])) fail("PRIVATE_LIVE_ARGUMENTS_INVALID");
    const prepared = await prepareLiveApproval(options["--manifest"], options["--output-directory"], options["--approval-request"]);
    process.stdout.write(`${JSON.stringify({ contract: LIVE_CONTRACT, code: "PRIVATE_LIVE_APPROVAL_REQUEST_CREATED", approved_cases: 20,
      source_bytes: prepared.target.source_bytes, runtime_source_clean: prepared.target.runtime_source_clean, max_provider_calls: 20, provider_calls: 0, authorized: false, promotion_eligible: false })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ contract: LIVE_CONTRACT, code: publicErrorCode(error), provider_calls: 0, authorized: false, promotion_eligible: false })}\n`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().then((code) => { process.exitCode = code; });
