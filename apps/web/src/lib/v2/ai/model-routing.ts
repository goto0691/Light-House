import { V2ModelError, type V2ModelRole } from "@/lib/v2/ai/gateway";

export const DEFAULT_V2_MODEL_ROUTES = {
  main_analyzer: "gemini-3.6-flash",
  grounded_enricher: "gemini-3.5-flash-lite",
} as const;

export type V2ModelRoutes = Readonly<{
  main_analyzer: string;
  grounded_enricher: string;
}>;

export function getV2ModelRoutes(env: Record<string, string | undefined> = process.env): V2ModelRoutes {
  return {
    main_analyzer: env.GEMINI_MAIN_MODEL?.trim() || DEFAULT_V2_MODEL_ROUTES.main_analyzer,
    grounded_enricher: env.GEMINI_GROUNDED_MODEL?.trim() || DEFAULT_V2_MODEL_ROUTES.grounded_enricher,
  };
}

export function resolveV2ModelForRole(role: V2ModelRole, routes = getV2ModelRoutes()) {
  if (role === "embedding_provider") {
    throw new V2ModelError("provider_unavailable", "Embedding requests require a dedicated embedding gateway.", false);
  }
  return routes[role];
}
