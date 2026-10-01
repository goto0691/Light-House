import { validateV2QueryPlan, type V2RetrievalQueryPlanV1 } from "@/lib/v2/retrieval/query-plan-v1";

export type V2SavedViewDisplay = Readonly<{
  layout: "list" | "cards" | "timeline" | "table";
  density: "comfortable" | "compact";
  groupBy: null | "type" | "captured_month" | "written_month";
  visibleFields: readonly string[];
}>;

export type V2SavedViewDefinition = Readonly<{
  name: string;
  description: string | null;
  iconKey: string;
  queryPlan: V2RetrievalQueryPlanV1;
  display: V2SavedViewDisplay;
}>;

export class V2SavedViewValidationError extends Error {
  constructor(readonly code: "saved_view_invalid" | "saved_view_pin_limit" | "saved_view_display_conflict", message: string) { super(message); this.name = "V2SavedViewValidationError"; }
}

const canonicalKey = /^[a-z][a-z0-9_.-]{0,99}$/;
export const SAVED_VIEW_RECORD_METADATA_KEYS = Object.freeze(["@record.captured_at", "@record.written_at", "@record.updated_at", "@record.type"] as const);
function invalid(message: string): never { throw new V2SavedViewValidationError("saved_view_invalid", message); }

/** Own primitive data only, before callers enter an asynchronous read. */
export function captureSavedViewVisibleFields(value: unknown): readonly string[] {
  const fail = (): never => invalid("The saved view visible fields are invalid.");
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length > 8 || Reflect.ownKeys(value).length !== length + 1) return fail();
  const fields: string[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string"
      || !canonicalKey.test(descriptor.value) && !(SAVED_VIEW_RECORD_METADATA_KEYS as readonly string[]).includes(descriptor.value)) return fail();
    if (!fields.includes(descriptor.value)) fields.push(descriptor.value);
  }
  return Object.freeze(fields);
}

export function validateSavedViewDisplay(value: unknown): V2SavedViewDisplay {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("The saved view display contract is invalid.");
  const display = value as Record<string, unknown>;
  const keys = Object.keys(display).sort();
  if (keys.join(",") !== ["density", "groupBy", "layout", "visibleFields"].sort().join(",")) invalid("The saved view display contains unsupported keys.");
  if (!(["list", "cards", "timeline", "table"] as const).includes(display.layout as never)) invalid("The saved view layout is invalid.");
  if (!(["comfortable", "compact"] as const).includes(display.density as never)) invalid("The saved view density is invalid.");
  if (display.groupBy !== null && !(["type", "captured_month", "written_month"] as const).includes(display.groupBy as never)) invalid("The saved view grouping is invalid.");
  return { layout: display.layout as V2SavedViewDisplay["layout"], density: display.density as V2SavedViewDisplay["density"], groupBy: display.groupBy as V2SavedViewDisplay["groupBy"], visibleFields: captureSavedViewVisibleFields(display.visibleFields) };
}

export function validateSavedViewDefinition(value: unknown): V2SavedViewDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("The saved view definition is invalid.");
  const definition = value as Record<string, unknown>;
  const keys = Object.keys(definition).sort();
  if (keys.join(",") !== ["name", "description", "iconKey", "queryPlan", "display"].sort().join(",")) invalid("The saved view definition contains unsupported keys.");
  if (typeof definition.name !== "string" || !definition.name.trim() || definition.name.trim().length > 80) invalid("The saved view name is invalid.");
  if (definition.description !== null && (typeof definition.description !== "string" || definition.description.length > 300)) invalid("The saved view description is invalid.");
  if (typeof definition.iconKey !== "string" || definition.iconKey.length > 100) invalid("The saved view icon is invalid.");
  return { name: definition.name.trim(), description: typeof definition.description === "string" ? definition.description.trim() || null : null, iconKey: definition.iconKey, queryPlan: validateV2QueryPlan(definition.queryPlan), display: validateSavedViewDisplay(definition.display) };
}
