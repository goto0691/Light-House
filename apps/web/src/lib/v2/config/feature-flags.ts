export type V2ServerFeatureFlags = Readonly<{
  routes: boolean;
  write: boolean;
  ai: boolean;
  offline: boolean;
  defaultLibrary: boolean;
  legacyReadonly: boolean;
}>;

export type V2PublicFeatureFlags = Readonly<Pick<V2ServerFeatureFlags, "routes" | "offline">>;

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

export function parseBooleanFlag(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

export function toPublicV2FeatureFlags(flags: V2ServerFeatureFlags): V2PublicFeatureFlags {
  return {
    routes: flags.routes,
    offline: flags.offline,
  };
}
