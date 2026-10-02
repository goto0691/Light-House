import { createHash } from "node:crypto";

import Ajv2020 from "ajv/dist/2020";

import expectedSchema from "./schemas/expected-result.schema.json";
import type { UserDelegatedApproval } from "./authoring-approval";

export const CONTRACT = "recorded-evaluation-v1" as const;
export const CASE_ID = /^GC-(0[1-9]|1[0-9]|20)$/;
export const HASH = /^sha256:[a-f0-9]{64}$/;
export const IDENTITY_KEYS = ["build_sha", "schema_sha256", "model_config_sha256", "prompt_sha256", "registry_sha256"] as const;
export type Identity = Record<(typeof IDENTITY_KEYS)[number], string>;
export type Mode = "synthetic" | "private-recorded";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Expected = {
  version: 1;
  case_id: string;
  authoring_status: "draft" | "human_approved" | "assistant_reviewed";
  approval?: UserDelegatedApproval;
  source_hashes: string[];
  must_create: Record<string, Json>;
  must_preserve: Record<string, Json>[];
  must_not_assert: string[];
  acceptable_variants: Record<string, Json>;
  required_evidence: Record<string, Json>[];
  recall_queries: Record<string, Json>[];
  severity_overrides: Record<string, "fatal" | "major" | "minor">;
};
export type TypedValue = {
  id: string;
  value_type: "text" | "number" | "boolean" | "date" | "rating";
  value: string | number | boolean;
  unit?: string;
  scale_max?: number;
};
export const FATAL_CODES = [
  "SOURCE_MUTATION", "USER_VALUE_OVERWRITE", "WRONG_ENTITY_MERGE", "RESTRICTED_EXPOSURE",
  "HIGH_RISK_AUTO_ACCEPTED", "RESTORE_HASH_MISMATCH", "CANONICAL_DUPLICATE",
] as const;
export type FatalCode = (typeof FATAL_CODES)[number];
export type Observation = {
  case_id: string;
  source_hashes?: string[];
  typed_values?: TypedValue[];
  primary_types?: string[];
  recall_results?: { id: string; ranked_ids: string[] }[];
  fatal_failures: FatalCode[];
};
export type ObservationSet = {
  contract: typeof CONTRACT;
  mode: Mode;
  identity: Identity;
  corpus_sha256: string;
  cases: Observation[];
};

export const INPUT_CODES = [
  "INVALID_ARGUMENTS", "INPUT_READ_FAILED", "INPUT_INVALID", "IDENTITY_INVALID", "IDENTITY_MISMATCH",
  "CORPUS_NOT_READY", "CORPUS_CHANGED", "CORPUS_IDENTITY_MISMATCH", "MODE_MISMATCH", "CASE_SET_MISMATCH",
  "REPORT_INVALID", "REPORT_WRITE_FAILED", "INTERNAL_ERROR",
] as const;
export type InputCode = (typeof INPUT_CODES)[number];
export class EvaluationInputError extends Error {
  constructor(readonly code: InputCode) { super(code); }
}
export function invalid(code: InputCode = "INPUT_INVALID"): never { throw new EvaluationInputError(code); }
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
export function strings(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 10_000
    && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 10_000)
    && new Set(value).size === value.length;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function jsonSafe(value: unknown, depth = 0, ancestors = new Set<unknown>(), budget = { nodes: 0 }): boolean {
  if (depth > 64 || ++budget.nodes > 100_000) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return safeNumber(value);
  if (!record(value) && !Array.isArray(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((item) => jsonSafe(item, depth + 1, ancestors, budget));
  ancestors.delete(value);
  return valid;
}
function safeNumber(value: number) {
  return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
}
export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
export function corpusDigest(corpusId: string, expected: Expected[]): string {
  return digest({ corpus_id: corpusId, expected: [...expected].sort((a, b) => a.case_id.localeCompare(b.case_id)) });
}
export function identity(value: unknown): Identity {
  if (!record(value) || !exactKeys(value, IDENTITY_KEYS)
    || !IDENTITY_KEYS.every((key) => typeof value[key] === "string"
      && (key === "build_sha" ? /^[a-f0-9]{40}$/ : HASH).test(value[key] as string))) invalid("IDENTITY_INVALID");
  // Reconstruct; no caller-supplied unknown property can reach a report.
  return Object.fromEntries(IDENTITY_KEYS.map((key) => [key, value[key]])) as Identity;
}
const ajv = new Ajv2020({ allErrors: false, strict: false });
const validateExpected = ajv.compile<Expected>(expectedSchema);
export function expectedResults(value: unknown): Expected[] {
  if (!jsonSafe(value) || !Array.isArray(value) || value.length === 0 || value.length > 20
    || !value.every((item) => validateExpected(item))
    || new Set(value.map((item) => item.case_id)).size !== value.length) invalid();
  return value as Expected[];
}
export function typedValue(value: unknown): value is TypedValue {
  if (!record(value) || !exactKeys(value, ["id", "value_type", "value"], ["unit", "scale_max"])
    || typeof value.id !== "string" || !value.id || value.id.length > 1000
    || (value.unit !== undefined && (typeof value.unit !== "string" || !value.unit || value.unit.length > 1000))) return false;
  if (value.scale_max !== undefined && (value.value_type !== "rating" || typeof value.scale_max !== "number"
    || !safeNumber(value.scale_max) || value.scale_max <= 0)) return false;
  switch (value.value_type) {
    case "text": return typeof value.value === "string";
    // Dates are exact authored strings, not inferred/normalized dates or precision.
    case "date": return typeof value.value === "string" && value.value.length > 0;
    case "boolean": return typeof value.value === "boolean";
    case "number": return typeof value.value === "number" && safeNumber(value.value);
    case "rating": return typeof value.value === "number" && safeNumber(value.value)
      && typeof value.scale_max === "number" && value.value >= 0 && value.value <= value.scale_max;
    default: return false;
  }
}
function observation(value: unknown): value is Observation {
  if (!record(value) || !exactKeys(value, ["case_id", "fatal_failures"], ["source_hashes", "typed_values", "primary_types", "recall_results"])
    || typeof value.case_id !== "string" || !CASE_ID.test(value.case_id)
    || !strings(value.fatal_failures) || !value.fatal_failures.every((code) => FATAL_CODES.includes(code as FatalCode))) return false;
  if (value.source_hashes !== undefined && (!strings(value.source_hashes) || !value.source_hashes.every((hash) => HASH.test(hash)))) return false;
  if (value.primary_types !== undefined && !strings(value.primary_types)) return false;
  if (value.typed_values !== undefined && (!Array.isArray(value.typed_values) || value.typed_values.length > 10_000
    || !value.typed_values.every(typedValue) || new Set(value.typed_values.map((item) => item.id)).size !== value.typed_values.length)) return false;
  if (value.recall_results !== undefined && (!Array.isArray(value.recall_results) || value.recall_results.length > 10_000
    || !value.recall_results.every((item) => record(item) && exactKeys(item, ["id", "ranked_ids"])
      && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 1000 && strings(item.ranked_ids))
    || new Set(value.recall_results.map((item) => item.id)).size !== value.recall_results.length)) return false;
  return true;
}
export function observationSet(value: unknown): ObservationSet {
  if (!record(value) || !exactKeys(value, ["contract", "mode", "identity", "corpus_sha256", "cases"])
    || value.contract !== CONTRACT || !["synthetic", "private-recorded"].includes(value.mode as string)
    || typeof value.corpus_sha256 !== "string" || !HASH.test(value.corpus_sha256)
    || !Array.isArray(value.cases) || value.cases.length > 20 || !value.cases.every(observation)) invalid();
  const parsedIdentity = identity(value.identity);
  if (new Set(value.cases.map((item) => item.case_id)).size !== value.cases.length) invalid("CASE_SET_MISMATCH");
  return { contract: CONTRACT, mode: value.mode as Mode, identity: parsedIdentity, corpus_sha256: value.corpus_sha256, cases: value.cases };
}
