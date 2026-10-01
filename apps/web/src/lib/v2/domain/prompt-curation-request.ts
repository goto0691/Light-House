import { PROMPT_CURATION_LIMITS, PROMPT_CURATION_ROLES, PromptCurationError, type PromptCopyRole } from "@/lib/v2/domain/prompt-curation-v1";

export type PromptCurationContent = Readonly<{
  title: string;
  relationKind: "continuation" | "collection" | "alternatives";
  relationshipConfirmation: "unconfirmed" | "user_confirmed";
  orderConfirmation: "unconfirmed" | "user_confirmed";
  items: readonly Readonly<{ itemKey: string; fragmentId: string; expectedFragmentStateVersion: number; copyRole: PromptCopyRole; position: number }>[];
  examples: readonly Readonly<{ exampleKey: string; itemKey: string | null; memberId: string; attachmentId: string; position: number; evidenceMethod: "unresolved" | "user_confirmed" }>[];
}>;
type RequestBasis = Readonly<{ expectedRevisionId: string; expectedSnapshotId: string; expectedManifestHash: string; idempotencyKey: string }>;
export type CreatePromptCurationRequest = RequestBasis & Readonly<{ groupKey: string; content: PromptCurationContent }>;
export type MigratePromptCurationRequest = RequestBasis & Readonly<{ groupKey: string; expectedPlanHash: string }>;
type RevisionBasis = RequestBasis & Readonly<{ expectedCurationRevisionId: string; expectedCurationRevisionNumber: number }>;
export type RevisePromptCurationRequest = RevisionBasis & (
  | Readonly<{ action: "edit"; content: PromptCurationContent }>
  | Readonly<{ action: "undo"; restoreRevisionId: string }>
  | Readonly<{ action: "archive" | "unarchive" }>
);

const basisKeys = ["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "idempotencyKey"] as const;
const revisionKeys = [...basisKeys, "expectedCurationRevisionId", "expectedCurationRevisionNumber", "action"] as const;
function invalid(): never { throw new PromptCurationError("prompt_curation_request_invalid", "정리본 요청의 필드·문자열·순서·참조를 확인해 주세요."); }
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
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || !wellFormed(value)) return invalid();
  return value;
}
export function promptCurationId(value: unknown): string {
  const id = text(value);
  for (let index = 0; index < id.length; index++) {
    const unit = id.charCodeAt(index);
    if (unit <= 0x1f || unit >= 0x7f && unit <= 0x9f) return invalid();
  }
  return id;
}
/** Read descriptors, never properties: caller-provided getters are not invoked.
 * The schema has a fixed depth. Every nested value is parsed into fresh data;
 * cycles cannot occupy any permitted leaf and are rejected without recursion. */
function ownRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return invalid();
    result[key as string] = descriptor.value;
  }
  return result;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const own = Object.keys(value);
  if (own.length !== keys.length || own.some((key) => !keys.includes(key))) return invalid();
  return value;
}
function record(value: unknown, keys: readonly string[]) { return exactKeys(ownRecord(value, keys), keys); }
function array(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string" || key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) return invalid();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return invalid();
    result.push(descriptor.value);
  }
  return result;
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return invalid();
  return value as number;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) return invalid();
  return value as T;
}
function basis(value: Record<string, unknown>): RequestBasis {
  if (typeof value.expectedManifestHash !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedManifestHash)) return invalid();
  return { expectedRevisionId: promptCurationId(value.expectedRevisionId), expectedSnapshotId: promptCurationId(value.expectedSnapshotId),
    expectedManifestHash: value.expectedManifestHash, idempotencyKey: promptCurationId(value.idempotencyKey) };
}
function contiguous(positions: readonly number[]) {
  if ([...positions].sort((a, b) => a - b).some((position, index) => position !== index)) return invalid();
}
function content(input: unknown): PromptCurationContent {
  const value = record(input, ["title", "relationKind", "relationshipConfirmation", "orderConfirmation", "items", "examples"]);
  const title = text(value.title), relationKind = choice(value.relationKind, ["continuation", "collection", "alternatives"] as const);
  const relationshipConfirmation = choice(value.relationshipConfirmation, ["unconfirmed", "user_confirmed"] as const);
  const orderConfirmation = choice(value.orderConfirmation, ["unconfirmed", "user_confirmed"] as const);
  const itemKeys = new Set<string>();
  const items = array(value.items, 1, PROMPT_CURATION_LIMITS.items).map((raw) => {
    const item = record(raw, ["itemKey", "fragmentId", "expectedFragmentStateVersion", "copyRole", "position"]);
    const itemKey = promptCurationId(item.itemKey);
    if (itemKeys.has(itemKey)) return invalid();
    itemKeys.add(itemKey);
    return { itemKey, fragmentId: promptCurationId(item.fragmentId), expectedFragmentStateVersion: integer(item.expectedFragmentStateVersion, 1),
      copyRole: choice(item.copyRole, PROMPT_CURATION_ROLES), position: integer(item.position, 0, PROMPT_CURATION_LIMITS.items - 1) };
  });
  for (const role of PROMPT_CURATION_ROLES) contiguous(items.filter((item) => item.copyRole === role).map((item) => item.position));
  const exampleKeys = new Set<string>();
  const examples = array(value.examples, 0, PROMPT_CURATION_LIMITS.examples).map((raw) => {
    const example = record(raw, ["exampleKey", "itemKey", "memberId", "attachmentId", "position", "evidenceMethod"]);
    const exampleKey = promptCurationId(example.exampleKey), itemKey = example.itemKey === null ? null : promptCurationId(example.itemKey);
    if (exampleKeys.has(exampleKey) || itemKey !== null && !itemKeys.has(itemKey) || relationKind === "alternatives" && itemKey === null) return invalid();
    exampleKeys.add(exampleKey);
    return { exampleKey, itemKey, memberId: promptCurationId(example.memberId), attachmentId: promptCurationId(example.attachmentId),
      position: integer(example.position, 0, PROMPT_CURATION_LIMITS.examples - 1), evidenceMethod: choice(example.evidenceMethod, ["unresolved", "user_confirmed"] as const) };
  });
  contiguous(examples.map((example) => example.position));
  return { title, relationKind, relationshipConfirmation, orderConfirmation, items, examples };
}
function parse<T>(work: () => T): T {
  try { return work(); }
  catch { return invalid(); }
}

/** Synchronous deep capture: no caller-owned object survives into repository awaits.
 * IDs identify claims only; ownership, source text/hash, role and live versions
 * must still be checked by the repository against preserved canonical rows. */
export function parseCreatePromptCurationRequest(value: unknown): CreatePromptCurationRequest {
  return parse(() => {
    const data = record(value, [...basisKeys, "groupKey", "content"]);
    return { ...basis(data), groupKey: promptCurationId(data.groupKey), content: content(data.content) };
  });
}
export function parseMigratePromptCurationRequest(value: unknown): MigratePromptCurationRequest {
  return parse(() => {
    const data = record(value, [...basisKeys, "groupKey", "expectedPlanHash"]);
    if (typeof data.expectedPlanHash !== "string" || !/^[a-f0-9]{64}$/.test(data.expectedPlanHash)) return invalid();
    return { ...basis(data), groupKey: promptCurationId(data.groupKey), expectedPlanHash: data.expectedPlanHash };
  });
}
export function parseRevisePromptCurationRequest(value: unknown): RevisePromptCurationRequest {
  return parse(() => {
    const data = ownRecord(value, [...revisionKeys, "content", "restoreRevisionId"]);
    const action = choice(data.action, ["edit", "undo", "archive", "unarchive"] as const);
    exactKeys(data, [...revisionKeys, ...(action === "edit" ? ["content"] : action === "undo" ? ["restoreRevisionId"] : [])]);
    const common = { ...basis(data), expectedCurationRevisionId: promptCurationId(data.expectedCurationRevisionId),
      expectedCurationRevisionNumber: integer(data.expectedCurationRevisionNumber, 1) };
    if (action === "edit") return { ...common, action, content: content(data.content) };
    if (action === "undo") return { ...common, action, restoreRevisionId: promptCurationId(data.restoreRevisionId) };
    return { ...common, action };
  });
}
