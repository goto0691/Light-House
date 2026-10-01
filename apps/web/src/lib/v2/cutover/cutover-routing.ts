import type { V2ServerFeatureFlags } from "@/lib/v2/config/feature-flags";

export function resolveAuthenticatedHome(flags: Pick<V2ServerFeatureFlags, "routes" | "defaultLibrary">) {
  return flags.routes && flags.defaultLibrary ? "/v2/library" : "/dashboard";
}
