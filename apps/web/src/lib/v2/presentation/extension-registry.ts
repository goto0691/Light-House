import type { PresentedEvidence, PresentedField } from "@/lib/v2/presentation/record-presentation";

export type RecordPresetDefinition = Readonly<{
  presetKey: string;
  mainVariant: "document" | "entity_overview" | "event_overview";
  moduleKeys: readonly string[];
  inspectorSectionKeys: readonly string[];
  version: number;
}>;

export type ContextModuleDefinition = Readonly<{
  moduleKey: string;
  presentationKind: "metric_grid" | "fact_summary";
  supportedObjectKinds: readonly ("document" | "entity" | "event")[];
  requiredFieldKeys: readonly string[];
  minimumMatches: number;
  privacyBehavior: "inherit" | "no_sensitive_preview" | "restricted_blocked";
  desktopVariant: "inline" | "side" | "full_width";
  mobileVariant: "inline" | "sheet" | "full_page";
  version: number;
}>;

export const contextModuleRegistry = [
  {
    moduleKey: "workout.metrics.v1", presentationKind: "metric_grid", supportedObjectKinds: ["document"],
    requiredFieldKeys: ["distance", "duration", "elapsed_time", "average_heart_rate", "pace", "calories", "steps", "cadence"],
    minimumMatches: 2, privacyBehavior: "no_sensitive_preview", desktopVariant: "inline", mobileVariant: "inline", version: 1,
  },
] as const satisfies readonly ContextModuleDefinition[];

export const recordPresetRegistry = [
  { presetKey: "record.document.v1", mainVariant: "document", moduleKeys: [], inspectorSectionKeys: ["fields", "connections", "sources"], version: 1 },
  { presetKey: "record.workout.v1", mainVariant: "document", moduleKeys: ["workout.metrics.v1"], inspectorSectionKeys: ["fields", "connections", "sources"], version: 1 },
  { presetKey: "record.place-visit.v1", mainVariant: "document", moduleKeys: [], inspectorSectionKeys: ["fields", "connections", "sources"], version: 1 },
  { presetKey: "record.media-review.v1", mainVariant: "document", moduleKeys: [], inspectorSectionKeys: ["fields", "connections", "sources"], version: 1 },
  { presetKey: "record.conversation.v1", mainVariant: "document", moduleKeys: [], inspectorSectionKeys: ["fields", "connections", "sources"], version: 1 },
] as const satisfies readonly RecordPresetDefinition[];

const presetByKey = new Map<string, RecordPresetDefinition>(recordPresetRegistry.map((item) => [item.presetKey, item]));
const moduleByKey = new Map<string, ContextModuleDefinition>(contextModuleRegistry.map((item) => [item.moduleKey, item]));

// Code-owned manifests must not become mutable runtime extension registrations.
for (const preset of recordPresetRegistry) { Object.freeze(preset.moduleKeys); Object.freeze(preset.inspectorSectionKeys); Object.freeze(preset); }
for (const definition of contextModuleRegistry) { Object.freeze(definition.requiredFieldKeys); Object.freeze(definition.supportedObjectKinds); Object.freeze(definition); }
Object.freeze(recordPresetRegistry); Object.freeze(contextModuleRegistry);

export function isAllowedRecordPreset(key: string) {
  return presetByKey.has(key);
}

export function isAllowedContextModule(key: string) {
  return moduleByKey.has(key);
}

export function resolveRecordPreset(typeKey: string | null, requestedKey?: string | null): RecordPresetDefinition {
  if (requestedKey && presetByKey.has(requestedKey)) return presetByKey.get(requestedKey) as RecordPresetDefinition;
  const key = (typeKey ?? "").toLowerCase();
  const fallbackKey = key.includes("running") || key.includes("workout") ? "record.workout.v1"
    : key.includes("restaurant") || key.includes("place") || key.includes("visit") ? "record.place-visit.v1"
      : key.includes("movie") || key.includes("game") || key.includes("book") ? "record.media-review.v1"
        : key.includes("conversation") || key.includes("transcript") ? "record.conversation.v1"
          : "record.document.v1";
  return presetByKey.get(fallbackKey) as RecordPresetDefinition;
}

export type PresentedContextModule = Readonly<{
  moduleKey: string;
  presentationVersion: number;
  presentationKind: "metric_grid" | "fact_summary";
  title: string;
  fields: readonly PresentedField[];
  sourceLabels: readonly string[];
  previewPolicy: "full" | "redacted" | "locked";
}>;

export type ContextModuleResolution = Readonly<
  { kind: "omit" } | { kind: "fallback"; reason: "version" | "invalid" }
  | { kind: "redacted"; moduleKey: string } | { kind: "ready"; module: PresentedContextModule }
>;

type JsonBudget = { nodes: number };
function invalidModule(): never { throw new Error("Invalid context module projection."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidModule();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidModule();
  return value as Record<string, unknown>;
}
function own(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return invalidModule();
  return descriptor.value;
}
function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const item = record(value), actual = Reflect.ownKeys(item);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) return invalidModule();
  for (const key of keys) own(item, key);
  return item;
}
function text(value: unknown, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.length)) return invalidModule();
  return value;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalidModule();
  return value;
}
function itemAt(value: readonly unknown[], index: number): unknown { return own(value as unknown as Record<string, unknown>, String(index)); }
function sameStringArray(value: unknown, expected: readonly string[]) {
  const items = array(value);
  return items.length === expected.length && expected.every((entry, index) => itemAt(items, index) === entry);
}
/** JSON-shaped data only: no accessors, toJSON execution, cycles, or caller-owned mutable references. */
function cloneJson(value: unknown, budget: JsonBudget, seen = new Set<object>(), depth = 0): unknown {
  if (++budget.nodes > 10_000 || depth > 32) return invalidModule();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidModule();
  if (!value || typeof value !== "object" || seen.has(value)) return invalidModule();
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    const input = array(value);
    if (input.length > 10_000 || Reflect.ownKeys(input).length !== input.length + 1) return invalidModule();
    result = Object.freeze(Array.from({ length: input.length }, (_, index) => cloneJson(itemAt(input, index), budget, seen, depth + 1)));
  } else {
    const input = record(value), output: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return invalidModule();
      // Plain objects cross the React server/client boundary. A data descriptor
      // also preserves own "__proto__" JSON keys without changing the prototype.
      Object.defineProperty(output, key, { value: cloneJson(own(input, key), budget, seen, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    result = Object.freeze(output);
  }
  seen.delete(value); return result;
}
function evidence(value: unknown): PresentedEvidence {
  const item = shape(value, ["evidenceId", "sourceItemId", "locatorKind", "locator", "quote"]);
  const sourceItemId = own(item, "sourceItemId"), quote = own(item, "quote");
  const locator = record(own(item, "locator"));
  return Object.freeze({ evidenceId: text(own(item, "evidenceId")), sourceItemId: sourceItemId === null ? null : text(sourceItemId),
    locatorKind: text(own(item, "locatorKind")), locator, quote: quote === null ? null : text(quote, true) });
}
function field(value: unknown, definition: ContextModuleDefinition): PresentedField {
  const item = shape(value, ["propertyId", "fieldKey", "label", "dataType", "value", "renderer", "sourceClass", "sourceLabel", "claimRisk", "reviewStatus", "lockedByUser", "evidence"]);
  const fieldKey = text(own(item, "fieldKey")), renderer = own(item, "renderer"), claimRisk = own(item, "claimRisk"), lockedByUser = own(item, "lockedByUser");
  if (!definition.requiredFieldKeys.includes(fieldKey) || own(item, "reviewStatus") !== "accepted" || typeof lockedByUser !== "boolean") return invalidModule();
  if (renderer !== "text" && renderer !== "number" && renderer !== "boolean" && renderer !== "date" && renderer !== "rating" && renderer !== "json") return invalidModule();
  if (claimRisk !== "low" && claimRisk !== "autobiographical" && claimRisk !== "social_high_risk") return invalidModule();
  const rawValue = own(item, "value");
  if (rawValue !== null && ((renderer === "text" || renderer === "date") && typeof rawValue !== "string"
    || (renderer === "number" || renderer === "rating") && (typeof rawValue !== "number" || !Number.isFinite(rawValue))
    || renderer === "boolean" && typeof rawValue !== "boolean")) return invalidModule();
  const evidenceRows = array(own(item, "evidence"));
  if (evidenceRows.length > 10_000) return invalidModule();
  const evidenceIds = new Set<string>(), evidenceCopy = Array.from({ length: evidenceRows.length }, (_, index) => {
    const copy = evidence(itemAt(evidenceRows, index));
    if (evidenceIds.has(copy.evidenceId)) return invalidModule(); evidenceIds.add(copy.evidenceId); return copy;
  });
  return Object.freeze({ propertyId: text(own(item, "propertyId")), fieldKey, label: text(own(item, "label"), true), dataType: text(own(item, "dataType")),
    value: rawValue, renderer, sourceClass: text(own(item, "sourceClass")), sourceLabel: text(own(item, "sourceLabel"), true),
    claimRisk, reviewStatus: "accepted", lockedByUser, evidence: Object.freeze(evidenceCopy) });
}

/** Expected projection failures never escape into the authored document or generic fields. */
export function resolvePresentedContextModule(value: unknown): ContextModuleResolution {
  try {
    let item = record(value);
    const moduleKey = own(item, "moduleKey");
    if (typeof moduleKey !== "string") return invalidModule();
    const definition = moduleByKey.get(moduleKey);
    if (!definition) return Object.freeze({ kind: "omit" });
    const previewPolicy = own(item, "previewPolicy");
    if (previewPolicy === "locked") return Object.freeze({ kind: "omit" });
    if (own(item, "presentationVersion") !== definition.version) return Object.freeze({ kind: "fallback", reason: "version" });
    if (previewPolicy === "redacted") return Object.freeze({ kind: "redacted", moduleKey });
    if (previewPolicy !== "full") return invalidModule();
    // Count the complete module, including metadata and evidence wrappers, once.
    // Locked/redacted/unknown payloads above are never traversed or retained.
    item = record(cloneJson(item, { nodes: 0 }));
    shape(item, ["moduleKey", "presentationVersion", "presentationKind", "title", "fields", "sourceLabels", "previewPolicy"]);
    if (own(item, "presentationKind") !== definition.presentationKind) return invalidModule();
    const inputs = array(own(item, "fields"));
    if (!inputs.length) return Object.freeze({ kind: "omit" });
    if (inputs.length < definition.minimumMatches || inputs.length > definition.requiredFieldKeys.length) return invalidModule();
    const ids = new Set<string>(), keys = new Set<string>();
    const fields = Array.from({ length: inputs.length }, (_, index) => {
      const copy = field(itemAt(inputs, index), definition);
      if (ids.has(copy.propertyId) || keys.has(copy.fieldKey)) return invalidModule();
      ids.add(copy.propertyId); keys.add(copy.fieldKey); return copy;
    });
    const expectedLabels = [...new Set(fields.map((entry) => entry.sourceLabel))], labelInput = array(own(item, "sourceLabels"));
    if (labelInput.length !== expectedLabels.length || expectedLabels.some((label, index) => itemAt(labelInput, index) !== label)) return invalidModule();
    return Object.freeze({ kind: "ready", module: Object.freeze({ moduleKey, presentationVersion: definition.version, presentationKind: definition.presentationKind,
      title: text(own(item, "title")), fields: Object.freeze(fields), sourceLabels: Object.freeze(expectedLabels), previewPolicy: "full" }) });
  } catch { return Object.freeze({ kind: "fallback", reason: "invalid" }); }
}

export function projectFirstContextModule(input: { preset: RecordPresetDefinition; fields: readonly PresentedField[]; privacyLevel: "normal" | "sensitive" | "restricted" }): PresentedContextModule | null {
  try {
    const request = shape(input, ["preset", "fields", "privacyLevel"]), privacyLevel = own(request, "privacyLevel");
    if (privacyLevel !== "normal" && privacyLevel !== "sensitive") return null;
    const requestedPreset = record(own(request, "preset")), preset = presetByKey.get(text(own(requestedPreset, "presetKey")));
    if (!preset || preset.version !== own(requestedPreset, "version") || preset.mainVariant !== own(requestedPreset, "mainVariant")
      || !sameStringArray(own(requestedPreset, "moduleKeys"), preset.moduleKeys)
      || !sameStringArray(own(requestedPreset, "inspectorSectionKeys"), preset.inspectorSectionKeys)) return null;
    for (const moduleKey of preset.moduleKeys.slice(0, 1)) {
      const definition = moduleByKey.get(moduleKey);
      if (!definition) continue;
      const keys = new Set<string>();
      const candidates = array(own(request, "fields")), matches: PresentedField[] = [];
      for (let index = 0; index < candidates.length; index++) {
        const candidate = record(itemAt(candidates, index)), fieldKey = text(own(candidate, "fieldKey"));
        if (own(candidate, "reviewStatus") !== "accepted" || !definition.requiredFieldKeys.includes(fieldKey) || keys.has(fieldKey)) continue;
        keys.add(fieldKey); matches.push(candidate as unknown as PresentedField);
      }
      if (matches.length < definition.minimumMatches) continue;
      if (privacyLevel === "sensitive" && definition.privacyBehavior === "no_sensitive_preview") return Object.freeze({
        moduleKey: definition.moduleKey, presentationVersion: definition.version, presentationKind: definition.presentationKind,
        title: "활동 수치", fields: Object.freeze([]), sourceLabels: Object.freeze([]), previewPolicy: "redacted",
      });
      const result = resolvePresentedContextModule({
        moduleKey: definition.moduleKey,
        presentationVersion: definition.version,
        presentationKind: definition.presentationKind,
        title: "활동 수치",
        fields: matches,
        sourceLabels: Array.from(new Set(matches.map((field) => own(record(field), "sourceLabel")))),
        previewPolicy: "full",
      });
      return result.kind === "ready" ? result.module : null;
    }
    return null;
  } catch { return null; }
}
