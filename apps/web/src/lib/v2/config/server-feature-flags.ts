import "server-only";

import { parseBooleanFlag, type V2ServerFeatureFlags } from "@/lib/v2/config/feature-flags";

export function getV2ServerFeatureFlags(): V2ServerFeatureFlags {
  const isDevelopment = process.env.NODE_ENV !== "production";

  return {
    routes: parseBooleanFlag(process.env.FLAG_V2_ROUTES, isDevelopment),
    write: parseBooleanFlag(process.env.FLAG_V2_WRITE, false),
    ai: parseBooleanFlag(process.env.FLAG_V2_AI, false),
    offline: parseBooleanFlag(process.env.FLAG_V2_OFFLINE, false),
    defaultLibrary: parseBooleanFlag(process.env.FLAG_V2_DEFAULT_LIBRARY, false),
    legacyReadonly: parseBooleanFlag(process.env.FLAG_V2_LEGACY_READONLY, false),
  };
}
