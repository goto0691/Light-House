import { PROMPT_CURATION_MIGRATION_CONTRACT, type PromptCurationMigrationPlan } from "@/lib/v2/domain/prompt-curation-migration";
import { parseMigratePromptCurationRequest, promptCurationId, type MigratePromptCurationRequest } from "@/lib/v2/domain/prompt-curation-request";
import { PROMPT_CURATION_LIMITS, PromptCurationError } from "@/lib/v2/domain/prompt-curation-v1";
import { captureRecoveryInput } from "@/lib/v2/editor/editor-working-copy";

/** A remembered review/request, not authenticated source data or permission to
 * submit. Confirmation, grants, whole histories and server receipts stay out. */
export type PromptCurationMigrationDraft = Readonly<{
  contract: "prompt-curation-migration-draft.v1";
  phase: "review" | "pending";
  plan: PromptCurationMigrationPlan;
  request: MigratePromptCurationRequest;
}>;

function invalid(): never {
  throw new PromptCurationError("prompt_curation_migration_draft_invalid", "이관 초안의 원본·대상·계획·요청 키를 확인하지 못했습니다. 기존 사본은 변경하지 않았습니다.");
}
function check(value: unknown): asserts value { if (!value) invalid(); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const keys = Reflect.ownKeys(value);
  check(keys.length === fields.length && keys.every((key) => typeof key === "string" && fields.includes(key)));
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && "value" in descriptor); output[key as string] = descriptor.value;
  }
  return output;
}
function array(value: unknown, max: number): unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  check(Number.isSafeInteger(length) && length >= 0 && length <= max && Reflect.ownKeys(value).length === length + 1);
  const output: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    check(descriptor && "value" in descriptor); output.push(descriptor.value);
  }
  return output;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  check(typeof value === "string" && choices.includes(value as T)); return value as T;
}
function hash(value: unknown): string {
  check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value)); return value;
}
function plan(value: unknown): PromptCurationMigrationPlan {
  const row = record(value, ["contract", "recordId", "sourceGroupKey", "sourceRevisionId", "sourceSnapshotId", "sourceManifestHash",
    "expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "items", "examples", "issues", "selectionConfirmations", "ready", "planHash"]);
  check(row.contract === PROMPT_CURATION_MIGRATION_CONTRACT && typeof row.ready === "boolean");
  const basis = { recordId: promptCurationId(row.recordId), sourceGroupKey: promptCurationId(row.sourceGroupKey), sourceRevisionId: promptCurationId(row.sourceRevisionId),
    sourceSnapshotId: promptCurationId(row.sourceSnapshotId), sourceManifestHash: hash(row.sourceManifestHash), expectedRevisionId: promptCurationId(row.expectedRevisionId),
    expectedSnapshotId: promptCurationId(row.expectedSnapshotId), expectedManifestHash: hash(row.expectedManifestHash) };
  const itemKeys = new Set<string>(), exampleKeys = new Set<string>();
  const fragments = new Map<string, { memberId: string; match: "member_key" | "fingerprint" }>();
  const items = array(row.items, PROMPT_CURATION_LIMITS.items).map((value) => {
    const entry = record(value, ["itemKey", "fragmentId", "memberId", "match"]);
    const item = { itemKey: promptCurationId(entry.itemKey), fragmentId: promptCurationId(entry.fragmentId), memberId: promptCurationId(entry.memberId),
      match: choice(entry.match, ["member_key", "fingerprint"] as const) };
    check(!itemKeys.has(item.itemKey)); itemKeys.add(item.itemKey);
    // Deliberately repeated items retain their order and identity, but one
    // original fragment cannot point to two different target selections.
    const previous = fragments.get(item.fragmentId);
    check(!previous || previous.memberId === item.memberId && previous.match === item.match);
    fragments.set(item.fragmentId, item); return item;
  });
  const examples = array(row.examples, PROMPT_CURATION_LIMITS.examples).map((value) => {
    const entry = record(value, ["exampleKey", "memberId", "attachmentId", "match"]);
    const example = { exampleKey: promptCurationId(entry.exampleKey), memberId: promptCurationId(entry.memberId), attachmentId: promptCurationId(entry.attachmentId),
      match: choice(entry.match, ["member_key", "fingerprint"] as const) };
    check(!exampleKeys.has(example.exampleKey)); exampleKeys.add(example.exampleKey); return example;
  });
  let sameSnapshot = false;
  const issues = array(row.issues, 1 + PROMPT_CURATION_LIMITS.items + PROMPT_CURATION_LIMITS.examples).map((value) => {
    const entry = record(value, ["kind", "key", "reason"]), key = promptCurationId(entry.key);
    const kind = choice(entry.kind, ["snapshot", "item", "example"] as const);
    if (kind === "snapshot") {
      check(!sameSnapshot && entry.reason === "same_snapshot" && key === basis.expectedSnapshotId && basis.sourceSnapshotId === basis.expectedSnapshotId);
      sameSnapshot = true; return { kind, key, reason: "same_snapshot" as const };
    }
    const reason = choice(entry.reason, kind === "item"
      ? ["missing", "changed", "ambiguous", "range_changed", "coverage_changed"] as const : ["missing", "changed", "ambiguous"] as const);
    const keys = kind === "item" ? itemKeys : exampleKeys;
    check(!keys.has(key)); keys.add(key); return { kind, key, reason };
  });
  check(itemKeys.size >= 1 && itemKeys.size <= PROMPT_CURATION_LIMITS.items && exampleKeys.size <= PROMPT_CURATION_LIMITS.examples);
  check(sameSnapshot === (basis.sourceSnapshotId === basis.expectedSnapshotId) && row.ready === (issues.length === 0));
  const confirmedKeys = new Set<string>();
  const selectionConfirmations = array(row.selectionConfirmations, PROMPT_CURATION_LIMITS.items).map((value) => {
    const key = promptCurationId(value); check(itemKeys.has(key) && !confirmedKeys.has(key)); confirmedKeys.add(key); return key;
  });
  return { contract: PROMPT_CURATION_MIGRATION_CONTRACT, ...basis, items, examples, issues, selectionConfirmations, ready: row.ready, planHash: hash(row.planHash) };
}

/** Fixed-depth own-data parsing runs before any async hash/policy/read. IDs and
 * hashes are cached claims only: fresh exact source/target reads must validate
 * membership, plan digest, raw ranges and receipt before submission/cleanup. */
export function parsePromptCurationMigrationDraft(value: unknown): PromptCurationMigrationDraft {
  try {
    const row = record(value, ["contract", "phase", "plan", "request"]);
    check(row.contract === "prompt-curation-migration-draft.v1");
    const phase = choice(row.phase, ["review", "pending"] as const), checkedPlan = plan(row.plan), request = parseMigratePromptCurationRequest(row.request);
    check(request.expectedRevisionId === checkedPlan.expectedRevisionId && request.expectedSnapshotId === checkedPlan.expectedSnapshotId
      && request.expectedManifestHash === checkedPlan.expectedManifestHash && request.expectedPlanHash === checkedPlan.planHash
      && request.groupKey !== checkedPlan.sourceGroupKey && (phase === "review" || checkedPlan.ready));
    return captureRecoveryInput({ contract: "prompt-curation-migration-draft.v1", phase, plan: checkedPlan, request });
  } catch { return invalid(); }
}

/** UI capture is equally strict; no unknown field is stripped or normalized. */
export function capturePromptCurationMigrationDraft(value: unknown): PromptCurationMigrationDraft {
  return parsePromptCurationMigrationDraft(value);
}

/** Review and pending phases share one original request's scope. Neither a
 * current parent selection nor a changed plan/key may silently rebase it. */
export function promptCurationMigrationScope(value: PromptCurationMigrationDraft): string {
  const { plan, request } = parsePromptCurationMigrationDraft(value);
  return JSON.stringify([plan.recordId, plan.sourceGroupKey, plan.sourceRevisionId, plan.sourceSnapshotId, plan.sourceManifestHash,
    plan.expectedRevisionId, plan.expectedSnapshotId, plan.expectedManifestHash, plan.planHash, request.groupKey, request.idempotencyKey]);
}
