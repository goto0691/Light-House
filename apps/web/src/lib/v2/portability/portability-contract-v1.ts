import { createHash } from "node:crypto";

export const LIGHTHOUSE_EXPORT_FORMAT = "lighthouse-export" as const;
export const LIGHTHOUSE_EXPORT_VERSION = 1 as const;
export const LIGHTHOUSE_SCHEMA_VERSION = "v2-032" as const;
export const SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS = ["v2-017", "v2-018", "v2-020", "v2-030", "v2-031", LIGHTHOUSE_SCHEMA_VERSION] as const;
export type LighthouseSchemaVersion = typeof SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS[number];

function schemaVersionParts(value: string) {
  const match = /^v(\d+)-(\d+)$/.exec(value);
  if (!match) throw new PortabilityContractError("Unsupported schema version.");
  return [Number(match[1]), Number(match[2])] as const;
}

export function compareLighthouseSchemaVersions(left: string, right: string) {
  const [leftMajor, leftRevision] = schemaVersionParts(left);
  const [rightMajor, rightRevision] = schemaVersionParts(right);
  return leftMajor === rightMajor ? leftRevision - rightRevision : leftMajor - rightMajor;
}

export type ExportProfile = "portable" | "migration";
export type ExportPrivacyLevel = "normal" | "sensitive" | "restricted";

export type ExportScopeV1 = Readonly<{
  objects: "all";
  privacyLevels: readonly ExportPrivacyLevel[];
  includeTrash: boolean;
  includeHistory: boolean;
  includeOriginals: boolean;
}>;

export type ExportFileManifestV1 = Readonly<{
  path: string;
  bytes: number;
  mediaType: string;
  sha256: string;
  records: number;
}>;

export type ExportManifestV1 = Readonly<{
  format: typeof LIGHTHOUSE_EXPORT_FORMAT;
  version: typeof LIGHTHOUSE_EXPORT_VERSION;
  profile: ExportProfile;
  exportId: string;
  createdAt: string;
  sourceAppVersion: string;
  schemaVersion: LighthouseSchemaVersion;
  userTimezone: string;
  scope: ExportScopeV1;
  counts: Readonly<Record<string, number>>;
  files: readonly ExportFileManifestV1[];
  rootHash: string;
  baseSequence: number;
  endSequence: number;
  warnings: readonly string[];
}>;

export class PortabilityContractError extends Error {
  readonly code = "portability_contract_invalid";

  constructor(message: string) {
    super(message);
    this.name = "PortabilityContractError";
  }
}

// The archive's schema version and a native row's schema_version are distinct.
// Earlier envelopes overwrote the latter; missing historical values cannot be
// recovered safely by guessing a default during restore.
export const CANONICAL_ROW_SCHEMA_VERSION_FIELD = "__lighthouse_row_schema_version";
const NATIVE_SCHEMA_VERSION_TABLES = new Set([
  "v2_processing_runs", "v2_analysis_proposals", "v2_type_definitions",
  "v2_field_definitions", "v2_predicate_definitions", "v2_unit_definitions",
]);

export function envelopeCanonicalRow(row: Record<string, unknown>, exportId: string) {
  if (Object.hasOwn(row, CANONICAL_ROW_SCHEMA_VERSION_FIELD) || Object.hasOwn(row, "user_scope_export_id")) {
    throw new PortabilityContractError("Canonical row collides with reserved archive metadata.");
  }
  return {
    ...row,
    ...(Object.hasOwn(row, "schema_version") ? { [CANONICAL_ROW_SCHEMA_VERSION_FIELD]: row.schema_version } : {}),
    schema_version: LIGHTHOUSE_SCHEMA_VERSION,
    user_scope_export_id: exportId,
  };
}

export function unwrapCanonicalRow(row: Record<string, unknown>, table: string): Record<string, unknown> {
  const { schema_version: _schema, user_scope_export_id: _scope, [CANONICAL_ROW_SCHEMA_VERSION_FIELD]: nativeVersion, ...value } = row;
  const hasNativeVersion = Object.hasOwn(row, CANONICAL_ROW_SCHEMA_VERSION_FIELD);
  if (NATIVE_SCHEMA_VERSION_TABLES.has(table)) {
    if (!hasNativeVersion) {
      throw new PortabilityContractError(`${table} is missing its native schema_version; re-export from the source instead of guessing a value.`);
    }
    const textVersion = table === "v2_processing_runs" || table === "v2_analysis_proposals";
    if (textVersion ? typeof nativeVersion !== "string" : !Number.isSafeInteger(nativeVersion)) {
      throw new PortabilityContractError(`${table} has an invalid native schema_version.`);
    }
    value.schema_version = nativeVersion;
  } else if (hasNativeVersion) {
    throw new PortabilityContractError(`${table} has unexpected reserved native schema metadata.`);
  }
  return value;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeExportScope(value: unknown, options: { restrictedUnlocked: boolean }): ExportScopeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PortabilityContractError("Export scope must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set(["objects", "privacyLevels", "includeTrash", "includeHistory", "includeOriginals"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    throw new PortabilityContractError("Export scope has unsupported keys.");
  }
  const rawLevels = candidate.privacyLevels ?? ["normal"];
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
    throw new PortabilityContractError("At least one privacy level is required.");
  }
  const privacyLevels = [...new Set(rawLevels)] as unknown[];
  if (privacyLevels.some((level) => level !== "normal" && level !== "sensitive" && level !== "restricted")) {
    throw new PortabilityContractError("Export privacy level is invalid.");
  }
  if (privacyLevels.includes("restricted") && !options.restrictedUnlocked) {
    throw new PortabilityContractError("Restricted export requires a recent reauthentication grant.");
  }
  return {
    objects: "all",
    privacyLevels: privacyLevels as ExportPrivacyLevel[],
    includeTrash: candidate.includeTrash === true,
    includeHistory: candidate.includeHistory !== false,
    includeOriginals: candidate.includeOriginals !== false,
  };
}

/**
 * A migration archive is a recovery artifact, not a selectively shareable
 * document export. It must retain every privacy class, tombstone/history, and
 * original so the archive can reconstruct the account without silently
 * dropping unclassified legacy envelopes. Callers must still require a recent
 * restricted grant before invoking this normalization.
 */
export function normalizeExportScopeForProfile(
  profile: ExportProfile,
  value: unknown,
  options: { restrictedUnlocked: boolean },
): ExportScopeV1 {
  const requested = normalizeExportScope(value, options);
  if (profile !== "migration") return requested;
  if (!options.restrictedUnlocked) {
    throw new PortabilityContractError("Migration export requires a recent reauthentication grant.");
  }
  return {
    objects: "all",
    privacyLevels: ["normal", "sensitive", "restricted"],
    includeTrash: true,
    includeHistory: true,
    includeOriginals: true,
  };
}

export function parseExportProfile(value: unknown): ExportProfile {
  if (value === "portable" || value === "migration") return value;
  throw new PortabilityContractError("Export profile must be portable or migration.");
}

export function exportRootHash(files: readonly ExportFileManifestV1[]) {
  const rootInput = files
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\0${file.records}\n`)
    .join("");
  return `sha256:${sha256Hex(rootInput)}`;
}

export function validateExportManifest(value: unknown): ExportManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PortabilityContractError("Manifest must be an object.");
  const manifest = value as Partial<ExportManifestV1>;
  if (manifest.format !== LIGHTHOUSE_EXPORT_FORMAT || manifest.version !== LIGHTHOUSE_EXPORT_VERSION) throw new PortabilityContractError("Unsupported export format.");
  if (manifest.profile !== "portable" && manifest.profile !== "migration") throw new PortabilityContractError("Unsupported export profile.");
  if (!SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.includes(manifest.schemaVersion as LighthouseSchemaVersion)) throw new PortabilityContractError("Unsupported schema version.");
  if (!manifest.exportId || !manifest.createdAt || !manifest.scope || !Array.isArray(manifest.files)) throw new PortabilityContractError("Manifest is incomplete.");
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.records) || file.records < 0) {
      throw new PortabilityContractError("Manifest file entry is invalid.");
    }
  }
  if (manifest.rootHash !== exportRootHash(manifest.files)) throw new PortabilityContractError("Manifest root hash does not match its files.");
  return manifest as ExportManifestV1;
}
