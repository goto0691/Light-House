import { fileURLToPath } from "node:url";

import { getPlatformProxy } from "wrangler";

import type { V2StructuredModelGateway } from "../src/lib/v2/ai/gateway";
import { createMainAnalyzerGateway } from "../src/lib/v2/ai/main-analyzer-gateway";
import type { D1DatabaseBinding } from "../src/lib/v2/infrastructure/d1/source-commit-repository";

/** The production main-analyzer path for live checks: ChatGPT plan (credential in the
 * app's local D1) first, Gemini fallback. Call after loading .env.local. */
export async function openLiveMainAnalyzer(): Promise<{ gateway: V2StructuredModelGateway; dispose(): Promise<void> }> {
  const platform = await getPlatformProxy<{ DB: D1DatabaseBinding }>({ configPath: fileURLToPath(new URL("../../../wrangler.toml", import.meta.url)) });
  const gateway = await createMainAnalyzerGateway(platform.env.DB, process.env);
  if (!gateway) { await platform.dispose(); throw new Error("ai_not_configured"); }
  return { gateway, dispose: () => platform.dispose() };
}
