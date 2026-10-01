import { canonicalLinkJson, linkSha256Hex, normalizeLinkHash } from "@/lib/v2/domain/link-snapshot-v1";
import { MANUAL_LINK_LIMITS } from "@/lib/v2/domain/manual-link-source";

export const PROMPT_CURATION_MANIFEST_VERSION = "prompt-curation-manifest.v1" as const;
export const PROMPT_CURATION_RENDER_VERSION = "prompt-curation-render.v1" as const;
export const PROMPT_CURATION_ROLES = ["prompt", "negative_prompt", "parameters"] as const;
/** Frozen application budgets, not platform limits. Output matches link-analysis.v1. */
export const PROMPT_CURATION_LIMITS = { sources: 40, items: 64, examples: 64, textBytes: MANUAL_LINK_LIMITS.textBytes, outputTextBytes: 200_000 } as const;
export type PromptCopyRole = typeof PROMPT_CURATION_ROLES[number];
export type PromptSourceCompleteness = "complete" | "partial" | "truncated" | "ocr_unverified" | "selection_unverified" | "unknown";
export type PromptPartClaim = Readonly<{ value: number | null; origin: "unknown" | "source_explicit" | "user_declared" }>;
export type PromptParts = Readonly<{ number: PromptPartClaim; total: PromptPartClaim }>;
/** The repository must establish owner/snapshot membership before constructing this catalog. */
export type PromptCurationSource = Readonly<{
  memberKey: string; sourceFingerprint: string; rawText: string; contentHash: string;
  completeness: PromptSourceCompleteness; parts: PromptParts;
}>;
export type ManualPromptSelection = Readonly<{ textStart: number; textEnd: number; role: PromptCopyRole }>;
export type PromptCurationFragment = Readonly<{
  memberKey: string; sourceClass: "source_extract"; role: PromptCopyRole; selectionOrigin: "user_selected" | "ai_selected";
  textStart: number; textEnd: number; rawText: string; rawTextHash: string; completeness: PromptSourceCompleteness;
}>;
export type PromptCurationItem = Readonly<{ itemKey: string; copyRole: PromptCopyRole; position: number; fragment: PromptCurationFragment }>;
/** Whole, verified images only. This pure layer cannot establish R2/DB ownership or commitment. */
export type PromptCurationExample = Readonly<{
  exampleKey: string; itemKey: string | null; memberKey: string; sourceFingerprint: string;
  sha256: string; mimeType: string; sizeBytes: number; position: number; evidenceMethod: "unresolved" | "user_confirmed";
}>;
export type PromptCurationInput = Readonly<{
  snapshotManifestHash: string; title: string; relationKind: "continuation" | "collection" | "alternatives";
  relationshipConfirmation: "unconfirmed" | "user_confirmed"; orderConfirmation: "unconfirmed" | "user_confirmed";
  separator: "\n"; sources: readonly PromptCurationSource[]; items: readonly PromptCurationItem[]; examples: readonly PromptCurationExample[];
}>;
export type PromptCurationWarning = "unknown_total_parts" | "unknown_part_numbers" | "missing_parts" | "conflicting_part_claims"
  | "duplicate_part_number" | "partial_source" | "ocr_unverified" | "selection_unverified" | "unknown_source_completeness"
  | "duplicate_text_preserved" | "image_pair_unconfirmed";
export type PromptCurationCoverage = Readonly<{
  status: "declared_parts_present" | "partial" | "unknown" | "conflicting";
  selectedSourceCount: number; totalParts: number | null; numberedParts: readonly number[]; missingParts: readonly number[] | null;
  unknownNumberCount: number; claims: readonly Readonly<{ memberKey: string; parts: PromptParts }>[];
  /** A checked sequence is not proof of the complete external post/thread. */
  externalScope: "unverified";
}>;
export type PromptCurationChannel = Readonly<{
  role: PromptCopyRole; itemKeys: readonly string[]; byteLength: number; coverage: PromptCurationCoverage;
  warnings: readonly PromptCurationWarning[]; canStandardCopy: boolean; canAvailableOnlyCopy: boolean;
  blockedReason: "empty_channel" | "relation_not_continuation" | "relationship_unconfirmed" | "order_unconfirmed" | null;
}>;
export type PreparedPromptCuration = Readonly<{
  manifestVersion: typeof PROMPT_CURATION_MANIFEST_VERSION; renderVersion: typeof PROMPT_CURATION_RENDER_VERSION;
  manifestJson: string; manifestHash: string; channels: Readonly<Record<PromptCopyRole, PromptCurationChannel>>;
}>;
export type PromptCurationCopy = Readonly<{
  kind: "assembled_source_fragments"; renderVersion: typeof PROMPT_CURATION_RENDER_VERSION;
  role: PromptCopyRole; mode: "standard" | "available_only"; text: string; sha256: string; byteLength: number;
  separator: "\n"; itemKeys: readonly string[]; coverage: PromptCurationCoverage; warnings: readonly PromptCurationWarning[];
}>;
export class PromptCurationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PromptCurationError"; }
}

const encoder = new TextEncoder();
const completenessValues = ["complete", "partial", "truncated", "ocr_unverified", "selection_unverified", "unknown"] as const;
function fail(code: string, message: string): never { throw new PromptCurationError(code, message); }
/** Capture the whole invocation before the first digest yields. TypeScript
 * readonly does not prevent a caller from mutating its objects during await.
 * Preserve unknown keys for the exact allowlist validator; never JSON-roundtrip
 * them away. Accessors, cycles and non-data objects are not contract inputs. */
function captureInput<T>(input: T): T {
  const ancestors = new Set<object>();
  let nodes = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 4096 || depth > 12) return fail("prompt_curation_input_limit", "The input structure exceeds its bounded contract.");
    if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
    if (typeof value !== "object" || ancestors.has(value)) return fail("prompt_curation_invalid", "Only acyclic plain input data is supported.");
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail("prompt_curation_invalid", "Only plain input data is supported.");
    const keys = Reflect.ownKeys(value);
    if (keys.length > (array ? PROMPT_CURATION_LIMITS.items + 1 : 20)) return fail("prompt_curation_input_limit", "The input structure exceeds its bounded contract.");
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || array && !/^(0|[1-9]\d*)$/.test(key)) return fail("prompt_curation_unknown_field", "Input contains an unsupported own field.");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return fail("prompt_curation_invalid", "Input accessors are not supported.");
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (array && (value as unknown[]).length !== (result as unknown[]).length) return fail("prompt_curation_invalid", "Sparse input arrays are not supported.");
    ancestors.delete(value);
    return result;
  }
  return copy(input, 0) as T;
}
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail("prompt_curation_invalid", `${label} must be a plain object.`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key))) return fail("prompt_curation_unknown_field", `${label} contains an unsupported field; database row IDs are not manifest data.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) return fail("prompt_curation_invalid", `${label} is invalid.`);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) return fail("prompt_curation_invalid", `${label} is not supported.`);
  return value as T;
}
function hash(value: unknown) {
  if (typeof value !== "string") return fail("prompt_curation_hash_invalid", "A preserved SHA-256 hash is required.");
  try { return normalizeLinkHash(value); } catch { return fail("prompt_curation_hash_invalid", "A preserved SHA-256 hash is invalid."); }
}
function integer(value: unknown, label: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return fail("prompt_curation_invalid", `${label} is out of range.`);
  return value as number;
}
function wellFormed(value: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function exactRange(text: string, start: unknown, end: unknown) {
  const textStart = integer(start, "UTF-16 range start", 0, text.length), textEnd = integer(end, "UTF-16 range end", 0, text.length);
  if (textEnd <= textStart) return fail("prompt_curation_range_invalid", "Select a non-empty forward range.");
  for (const offset of [textStart, textEnd]) {
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return fail("prompt_curation_range_invalid", "A UTF-16 range must not split a surrogate pair.");
  }
  return { textStart, textEnd, rawText: text.slice(textStart, textEnd) };
}
function partClaim(value: unknown): PromptPartClaim {
  const claim = object(value, ["value", "origin"], "part claim");
  const origin = choice(claim.origin, ["unknown", "source_explicit", "user_declared"] as const, "part origin");
  if (origin === "unknown") {
    if (claim.value !== null) return fail("prompt_curation_invalid", "An unknown part claim must not invent a number.");
    return { value: null, origin };
  }
  return { value: integer(claim.value, "part number/count", 1, 100), origin };
}
function parts(value: unknown): PromptParts {
  const input = object(value, ["number", "total"], "part declarations"), number = partClaim(input.number), total = partClaim(input.total);
  if (number.value !== null && total.value !== null && number.value > total.value) return fail("prompt_curation_invalid", "The declared part exceeds its declared total.");
  return { number, total };
}
async function source(input: unknown): Promise<PromptCurationSource> {
  const value = object(input, ["memberKey", "sourceFingerprint", "rawText", "contentHash", "completeness", "parts"], "source catalog member");
  if (typeof value.rawText !== "string" || !wellFormed(value.rawText)) return fail("prompt_curation_source_invalid", "The preserved source must contain well-formed Unicode text.");
  if (encoder.encode(value.rawText).byteLength > PROMPT_CURATION_LIMITS.textBytes) return fail("prompt_curation_input_limit", "The preserved source exceeds the text budget.");
  const contentHash = hash(value.contentHash);
  if (await linkSha256Hex(value.rawText) !== contentHash) return fail("prompt_curation_source_hash_mismatch", "The preserved source does not match its hash.");
  return { memberKey: string(value.memberKey, "member key"), sourceFingerprint: hash(value.sourceFingerprint), rawText: value.rawText,
    contentHash, completeness: choice(value.completeness, completenessValues, "source completeness"), parts: parts(value.parts) };
}

export async function extractManualPromptFragment(input: PromptCurationSource, selection: ManualPromptSelection): Promise<PromptCurationFragment> {
  const captured = captureInput({ input, selection });
  const member = await source(captured.input), selected = object(captured.selection, ["textStart", "textEnd", "role"], "manual source selection");
  const range = exactRange(member.rawText, selected.textStart, selected.textEnd);
  return { memberKey: member.memberKey, sourceClass: "source_extract", role: choice(selected.role, PROMPT_CURATION_ROLES, "fragment role"),
    selectionOrigin: "user_selected", ...range, rawTextHash: await linkSha256Hex(range.rawText), completeness: member.completeness };
}

function coverage(members: readonly PromptCurationSource[]): { coverage: PromptCurationCoverage; warnings: PromptCurationWarning[] } {
  const warnings: PromptCurationWarning[] = [];
  const totals = [...new Set(members.flatMap((member) => member.parts.total.value === null ? [] : [member.parts.total.value]))];
  const numbers = members.flatMap((member) => member.parts.number.value === null ? [] : [member.parts.number.value]);
  const numberedParts = [...new Set(numbers)].sort((a, b) => a - b), unknownNumberCount = members.length - numbers.length;
  const totalParts = totals.length === 1 ? totals[0] : null;
  const duplicate = numberedParts.length !== numbers.length;
  const conflict = totals.length > 1 || duplicate || Boolean(totalParts !== null && numberedParts.some((part) => part > totalParts));
  if (!totals.length) warnings.push("unknown_total_parts");
  if (unknownNumberCount) warnings.push("unknown_part_numbers");
  if (totals.length > 1 || totalParts !== null && numberedParts.some((part) => part > totalParts)) warnings.push("conflicting_part_claims");
  if (duplicate) warnings.push("duplicate_part_number");
  const missingParts = totalParts === null || unknownNumberCount || conflict ? null
    : Array.from({ length: totalParts }, (_, index) => index + 1).filter((part) => !numberedParts.includes(part));
  if (missingParts?.length) warnings.push("missing_parts");
  const status = conflict ? "conflicting" : totalParts === null || unknownNumberCount ? "unknown" : missingParts?.length ? "partial" : "declared_parts_present";
  return { coverage: { status, selectedSourceCount: members.length, totalParts, numberedParts, missingParts, unknownNumberCount,
    claims: members.map((member) => ({ memberKey: member.memberKey, parts: member.parts })), externalScope: "unverified" }, warnings };
}
function codeUnits(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

async function normalize(input: PromptCurationInput) {
  const value = object(input, ["snapshotManifestHash", "title", "relationKind", "relationshipConfirmation", "orderConfirmation", "separator", "sources", "items", "examples"], "curation");
  const snapshotManifestHash = hash(value.snapshotManifestHash), title = string(value.title, "curation title", 200);
  const relationKind = choice(value.relationKind, ["continuation", "collection", "alternatives"] as const, "fragment relationship");
  const relationshipConfirmation = choice(value.relationshipConfirmation, ["unconfirmed", "user_confirmed"] as const, "relationship confirmation");
  const orderConfirmation = choice(value.orderConfirmation, ["unconfirmed", "user_confirmed"] as const, "order confirmation");
  if (value.separator !== "\n") return fail("prompt_curation_separator_invalid", "The initial curation contract inserts exactly one LF separator.");
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > PROMPT_CURATION_LIMITS.sources) return fail("prompt_curation_input_limit", "Provide between 1 and 40 source members.");
  const sources = await Promise.all(value.sources.map(source)), sourceMap = new Map(sources.map((member) => [member.memberKey, member]));
  if (sourceMap.size !== sources.length) return fail("prompt_curation_source_invalid", "Source member keys must be unique.");
  if (sources.reduce((sum, member) => sum + encoder.encode(member.rawText).byteLength, 0) > PROMPT_CURATION_LIMITS.textBytes) return fail("prompt_curation_input_limit", "The source catalog exceeds the text budget.");
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > PROMPT_CURATION_LIMITS.items) return fail("prompt_curation_input_limit", "Select between 1 and 64 fragments.");
  const items: PromptCurationItem[] = [];
  const itemKeys = new Set<string>();
  for (const rawItem of value.items) {
    const item = object(rawItem, ["itemKey", "copyRole", "position", "fragment"], "curation item"), itemKey = string(item.itemKey, "stable item key");
    if (itemKeys.has(itemKey)) return fail("prompt_curation_order_invalid", "Stable item keys must be unique.");
    itemKeys.add(itemKey);
    const copyRole = choice(item.copyRole, PROMPT_CURATION_ROLES, "copy role"), position = integer(item.position, "copy position", 0, PROMPT_CURATION_LIMITS.items - 1);
    const fragment = object(item.fragment, ["memberKey", "sourceClass", "role", "selectionOrigin", "textStart", "textEnd", "rawText", "rawTextHash", "completeness"], "source fragment");
    if (fragment.sourceClass !== "source_extract") return fail("prompt_curation_source_class_invalid", "Only exact source extracts belong to a prompt assembly; AI interpretations and user rewrites remain separate.");
    const role = choice(fragment.role, PROMPT_CURATION_ROLES, "fragment role");
    if (role !== copyRole) return fail("prompt_curation_role_mismatch", "Prompt, negative prompt and parameters must stay in their original channels.");
    const memberKey = string(fragment.memberKey, "fragment source key"), member = sourceMap.get(memberKey);
    if (!member) return fail("prompt_curation_source_invalid", "A selected fragment is not in the verified source catalog.");
    const range = exactRange(member.rawText, fragment.textStart, fragment.textEnd), rawTextHash = hash(fragment.rawTextHash);
    if (typeof fragment.rawText !== "string" || fragment.rawText !== range.rawText || await linkSha256Hex(range.rawText) !== rawTextHash) return fail("prompt_curation_fragment_hash_mismatch", "A fragment differs from its exact preserved source range.");
    items.push({ itemKey, copyRole, position, fragment: { memberKey, sourceClass: "source_extract", role,
      selectionOrigin: choice(fragment.selectionOrigin, ["user_selected", "ai_selected"] as const, "selection origin"), ...range, rawTextHash,
      completeness: choice(fragment.completeness, completenessValues, "fragment completeness") } });
  }
  items.sort((a, b) => PROMPT_CURATION_ROLES.indexOf(a.copyRole) - PROMPT_CURATION_ROLES.indexOf(b.copyRole) || a.position - b.position);
  for (const role of PROMPT_CURATION_ROLES) if (items.filter((item) => item.copyRole === role).some((item, index) => item.position !== index)) return fail("prompt_curation_order_invalid", "Positions must be unique and contiguous within each role; input array order does not confirm sequence.");
  if (!Array.isArray(value.examples) || value.examples.length > PROMPT_CURATION_LIMITS.examples) return fail("prompt_curation_input_limit", "Too many image examples.");
  const exampleKeys = new Set<string>(), imageIdentities = new Map<string, string>();
  const examples: PromptCurationExample[] = value.examples.map((raw) => {
    const example = object(raw, ["exampleKey", "itemKey", "memberKey", "sourceFingerprint", "sha256", "mimeType", "sizeBytes", "position", "evidenceMethod"], "whole image example");
    const exampleKey = string(example.exampleKey, "example key");
    if (exampleKeys.has(exampleKey)) return fail("prompt_curation_image_invalid", "Example keys must be unique.");
    exampleKeys.add(exampleKey);
    const itemKey = example.itemKey === null ? null : string(example.itemKey, "example target key");
    if (itemKey !== null && !itemKeys.has(itemKey) || relationKind === "alternatives" && itemKey === null) return fail("prompt_curation_image_invalid", "An example must target an existing item; alternatives require an individual target.");
    const memberKey = string(example.memberKey, "image source key"), sourceFingerprint = hash(example.sourceFingerprint), sha256 = hash(example.sha256);
    const mimeType = string(example.mimeType, "image MIME type", 100), sizeBytes = integer(example.sizeBytes, "image size", 1, Number.MAX_SAFE_INTEGER);
    if (!/^image\/[a-z0-9.+-]+$/.test(mimeType) || sourceMap.has(memberKey)) return fail("prompt_curation_image_invalid", "An example must be a distinct verified image source, not an external text member.");
    const imageIdentity = canonicalLinkJson({ sourceFingerprint, sha256, mimeType, sizeBytes });
    if (imageIdentities.has(memberKey) && imageIdentities.get(memberKey) !== imageIdentity) return fail("prompt_curation_image_invalid", "One image member cannot refer to conflicting preserved image identities.");
    imageIdentities.set(memberKey, imageIdentity);
    return { exampleKey, itemKey, memberKey, sourceFingerprint, sha256, mimeType, sizeBytes,
      position: integer(example.position, "image position", 0, PROMPT_CURATION_LIMITS.examples - 1),
      evidenceMethod: choice(example.evidenceMethod, ["unresolved", "user_confirmed"] as const, "image correspondence") };
  }).sort((a, b) => a.position - b.position);
  if (examples.some((example, index) => example.position !== index)) return fail("prompt_curation_order_invalid", "Example positions must be unique and contiguous.");
  let outputBytes = 0;
  const channels = {} as Record<PromptCopyRole, PromptCurationChannel>;
  // Part claims describe the selected source sequence, not a requirement that
  // every source contain every role. An unselected catalog member is not proof
  // of a selected curation part, while a selected negative-only post is present.
  const selectedMembers = [...new Set(items.map((item) => item.fragment.memberKey))]
    .map((key) => sourceMap.get(key)!).sort((a, b) => codeUnits(a.memberKey, b.memberKey));
  for (const role of PROMPT_CURATION_ROLES) {
    const selected = items.filter((item) => item.copyRole === role);
    const members = [...new Set(selected.map((item) => item.fragment.memberKey))].map((key) => sourceMap.get(key)!).sort((a, b) => codeUnits(a.memberKey, b.memberKey));
    const { coverage: scope, warnings } = coverage(selectedMembers);
    const states = [...members.map((member) => member.completeness), ...selected.map((item) => item.fragment.completeness)];
    if (states.some((state) => state === "partial" || state === "truncated")) warnings.push("partial_source");
    if (states.includes("ocr_unverified")) warnings.push("ocr_unverified");
    if (states.includes("selection_unverified")) warnings.push("selection_unverified");
    if (states.includes("unknown")) warnings.push("unknown_source_completeness");
    if (new Set(selected.map((item) => item.fragment.rawTextHash)).size !== selected.length) warnings.push("duplicate_text_preserved");
    if (examples.some((example) => example.evidenceMethod === "unresolved" && (example.itemKey === null || selected.some((item) => item.itemKey === example.itemKey)))) warnings.push("image_pair_unconfirmed");
    const byteLength = selected.reduce((sum, item) => sum + encoder.encode(item.fragment.rawText).byteLength, 0) + Math.max(0, selected.length - 1);
    outputBytes += byteLength;
    const blockedReason = !selected.length ? "empty_channel" : relationKind !== "continuation" ? "relation_not_continuation"
      : relationshipConfirmation !== "user_confirmed" ? "relationship_unconfirmed" : orderConfirmation !== "user_confirmed" ? "order_unconfirmed" : null;
    const incomplete = scope.status !== "declared_parts_present" || warnings.some((warning) => ["partial_source", "ocr_unverified", "unknown_source_completeness"].includes(warning));
    channels[role] = { role, itemKeys: selected.map((item) => item.itemKey), byteLength, coverage: scope, warnings,
      canStandardCopy: blockedReason === null && !incomplete, canAvailableOnlyCopy: blockedReason === null, blockedReason };
  }
  if (outputBytes > PROMPT_CURATION_LIMITS.outputTextBytes) return fail("prompt_curation_output_limit", "The complete role-separated output exceeds its byte budget; no fragments were truncated.");
  const manifestJson = canonicalLinkJson({ manifestVersion: PROMPT_CURATION_MANIFEST_VERSION, renderVersion: PROMPT_CURATION_RENDER_VERSION,
    snapshotManifestHash, title, relationKind, relationshipConfirmation, orderConfirmation, separator: "\n",
    items: items.map((item) => { const member = sourceMap.get(item.fragment.memberKey)!; return {
      itemKey: item.itemKey, role: item.copyRole, position: item.position, memberKey: member.memberKey, sourceFingerprint: member.sourceFingerprint,
      sourceContentHash: member.contentHash, sourceCompleteness: member.completeness, parts: member.parts,
      textStart: item.fragment.textStart, textEnd: item.fragment.textEnd, rawTextHash: item.fragment.rawTextHash,
      completeness: item.fragment.completeness, selectionOrigin: item.fragment.selectionOrigin,
    }; }), examples });
  return { items, prepared: { manifestVersion: PROMPT_CURATION_MANIFEST_VERSION, renderVersion: PROMPT_CURATION_RENDER_VERSION,
    manifestJson, manifestHash: await linkSha256Hex(manifestJson), channels } satisfies PreparedPromptCuration };
}

export async function preparePromptCuration(input: PromptCurationInput): Promise<PreparedPromptCuration> {
  return (await normalize(captureInput(input))).prepared;
}

export async function copyPromptCuration(input: PromptCurationInput, request: { role: PromptCopyRole; mode: "standard" | "available_only" }): Promise<PromptCurationCopy> {
  const captured = captureInput({ input, request });
  const value = object(captured.request, ["role", "mode"], "copy request"), role = choice(value.role, PROMPT_CURATION_ROLES, "copy role");
  const mode = choice(value.mode, ["standard", "available_only"] as const, "copy mode"), { items, prepared } = await normalize(captured.input), channel = prepared.channels[role];
  if (channel.blockedReason) return fail("prompt_curation_copy_blocked", `Combined copy is unavailable: ${channel.blockedReason}. Individual original copy remains separate.`);
  if (mode === "standard" && !channel.canStandardCopy) return fail("prompt_curation_incomplete_copy_required", "Use the explicit available-fragments-only action; missing or unverified source scope remains visible.");
  const text = items.filter((item) => item.copyRole === role).map((item) => item.fragment.rawText).join("\n");
  return { kind: "assembled_source_fragments", renderVersion: PROMPT_CURATION_RENDER_VERSION, role, mode, text,
    sha256: await linkSha256Hex(text), byteLength: encoder.encode(text).byteLength, separator: "\n",
    itemKeys: channel.itemKeys, coverage: channel.coverage, warnings: channel.warnings };
}
