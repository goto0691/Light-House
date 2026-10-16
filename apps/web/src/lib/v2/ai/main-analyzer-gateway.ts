import { V2ModelError, type V2StructuredModelGateway, type V2StructuredModelRequest, type V2StructuredModelResult } from "@/lib/v2/ai/gateway";
import { createGeminiRoleGateways } from "@/lib/v2/ai/gemini-role-gateways";
import { OpenAIPlanMainAnalyzerGateway, OpenAIPlanProviderError } from "@/lib/v2/ai/openai-plan-gateway";
import { D1OpenAIPlanCredentialStore, importCredentialKey } from "@/lib/v2/infrastructure/d1/ai-provider-credential-store";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type PrimaryGateway = V2StructuredModelGateway & { ready(request: V2StructuredModelRequest): Promise<boolean> };

/** The owner's ChatGPT plan first; Gemini (main role, default gemini-3.6-flash) when the
 * plan is not connected, disconnected/expired, over its usage cap, or the input needs
 * video/audio. The fallback is an explicit owner decision (2026-10-16), never silent:
 * every result records its provider in `modelId` (`openai-plan:*` vs the Gemini model). */
export class MainAnalyzerFallbackGateway implements V2StructuredModelGateway {
  constructor(private readonly primary: PrimaryGateway | null, private readonly fallback: V2StructuredModelGateway | null) {}

  async generate<T>(request: V2StructuredModelRequest): Promise<V2StructuredModelResult<T>> {
    if (this.primary && await this.primary.ready(request)) {
      try { return await this.primary.generate<T>(request); }
      catch (error) {
        // A model answer that fails validation is not a provider outage; keep it as that result.
        if (!(error instanceof OpenAIPlanProviderError) || !error.fallbackEligible || !this.fallback) throw error;
      }
    }
    if (!this.fallback) throw new V2ModelError("provider_unavailable", "No AI provider is available for this request.", false);
    return this.fallback.generate<T>(request);
  }
}

export type MainAnalyzerEnv = Readonly<Record<string, string | undefined>>;

export function mainAnalyzerConfigured(env: MainAnalyzerEnv = process.env) {
  return Boolean(env.GEMINI_API_KEY?.trim() || (env.V2_AI_CREDENTIAL_KEY?.trim() && env.OPENAI_PLAN_MODEL?.trim()));
}

export async function createMainAnalyzerGateway(db: D1DatabaseBinding, env: MainAnalyzerEnv = process.env): Promise<V2StructuredModelGateway | null> {
  const gemini = env.GEMINI_API_KEY?.trim() ? createGeminiRoleGateways(env.GEMINI_API_KEY).mainAnalyzer : null;
  const key = await importCredentialKey(env.V2_AI_CREDENTIAL_KEY);
  const model = env.OPENAI_PLAN_MODEL?.trim();
  const plan = key && model ? new OpenAIPlanMainAnalyzerGateway({ store: new D1OpenAIPlanCredentialStore(db, key), model }) : null;
  if (!plan && !gemini) return null;
  return new MainAnalyzerFallbackGateway(plan, gemini);
}
