export const TEMPLATE_CONTRACT_VERSION = 1 as const;
export const TEMPLATE_REGISTRY_SNAPSHOT_VERSION = "registry-bootstrap-v1";

export type TemplateBlankState = "answered" | "unanswered" | "unknown" | "not_applicable" | "withheld";
export type TemplateItemKind = "field" | "relation" | "core" | "recall_cue" | "scaffold" | "attachment";
export type TemplateInputKind = "rating" | "date" | "entity_picker" | "person_picker" | "measurement" | "chips" | "text" | "long_text" | "number" | "boolean";
export type TemplateAiOperation = "none" | "extract_from_capture" | "resolve_entity" | "enrich_external" | "calculate" | "interpret_proposed";
export type TemplateValueKind = "text" | "number" | "boolean" | "date" | "rating" | "json";

export type TemplateBindingV1 = Readonly<{
  ownerRole: "primary_document" | "subject_entity" | "experience_event";
  fieldDefinitionId?: string;
  fieldKey?: string;
  predicateKey?: string;
  corePath?: "document.title" | "document.written_at" | "event.occurred_at";
}>;

export type TemplateItemV1 = Readonly<{
  key: string;
  kind: TemplateItemKind;
  prompt: string;
  helperText?: string;
  prominence: "core" | "suggested" | "optional";
  binding?: TemplateBindingV1;
  inputKind?: TemplateInputKind;
  cardinality?: "one" | "many";
  allowedAiOperations: readonly TemplateAiOperation[];
}>;

export type TemplateDefinitionV1 = Readonly<{
  contractVersion: 1;
  name: string;
  description?: string;
  expectedTypeIds: readonly string[];
  objectRoles: readonly Readonly<{
    role: "primary_document" | "subject_entity" | "experience_event";
    typeId?: string;
    optional: boolean;
  }>[];
  sections: readonly Readonly<{ key: string; label: string; items: readonly TemplateItemV1[] }>[];
}>;

export type TemplateInputSubmission = Readonly<{
  itemKey: string;
  valueKind: TemplateValueKind;
  value: unknown;
  blankState: TemplateBlankState;
  inputOrder: number;
  clientTimestamp: string;
}>;

export type TemplateSubmission = Readonly<{
  templateVersionId: string;
  appliedAt: string;
  inputs: readonly TemplateInputSubmission[];
}>;

export type PromptSafetyIssue = Readonly<{ itemKey: string; code: string; message: string }>;

const CANONICAL_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const ITEM_KINDS = new Set<TemplateItemKind>(["field", "relation", "core", "recall_cue", "scaffold", "attachment"]);
const INPUT_KINDS = new Set<TemplateInputKind>(["rating", "date", "entity_picker", "person_picker", "measurement", "chips", "text", "long_text", "number", "boolean"]);
const AI_OPERATIONS = new Set<TemplateAiOperation>(["none", "extract_from_capture", "resolve_entity", "enrich_external", "calculate", "interpret_proposed"]);
const BLANK_STATES = new Set<TemplateBlankState>(["answered", "unanswered", "unknown", "not_applicable", "withheld"]);
const VALUE_KINDS = new Set<TemplateValueKind>(["text", "number", "boolean", "date", "rating", "json"]);

export class TemplateContractValidationError extends Error {
  readonly code = "template_contract_invalid";
  constructor(message: string) { super(message); this.name = "TemplateContractValidationError"; }
}

function invalid(message: string): never { throw new TemplateContractValidationError(message); }
function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) invalid(`${label} contains missing or unsupported keys.`);
}
function textValue(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(`${label} must be non-empty text no longer than ${max} characters.`);
  return value.trim();
}

export function promptSafetyLint(definition: TemplateDefinitionV1): readonly PromptSafetyIssue[] {
  const patterns = [
    { pattern: /누구와 함께였나요\??/, code: "assumes_companion", message: "동행자가 있었다고 전제하지 않는 질문으로 바꾸세요." },
    { pattern: /가장 좋았던/, code: "assumes_positive", message: "긍정 평가를 전제하지 않는 질문으로 바꾸세요." },
    { pattern: /왜 중요했나요\??/, code: "assumes_importance", message: "중요하게 느꼈는지부터 열어 둔 질문으로 바꾸세요." },
    { pattern: /상대는 왜/, code: "infers_intent", message: "타인의 의도를 추론하도록 유도하지 마세요." },
    { pattern: /결국 무엇을 합의/, code: "assumes_agreement", message: "합의가 있었는지부터 열어 둔 질문으로 바꾸세요." },
  ];
  return definition.sections.flatMap((section) => section.items.flatMap((item) => patterns
    .filter(({ pattern }) => pattern.test(item.prompt))
    .map(({ code, message }) => ({ itemKey: item.key, code, message }))));
}

export function validateTemplateDefinitionV1(value: unknown): TemplateDefinitionV1 {
  const definition = object(value, "template definition");
  exactKeys(definition, ["contractVersion", "name", "expectedTypeIds", "objectRoles", "sections"], ["description"], "template definition");
  if (definition.contractVersion !== TEMPLATE_CONTRACT_VERSION) invalid("Unsupported template contract version.");
  const name = textValue(definition.name, "name", 100);
  const description = definition.description === undefined ? undefined : textValue(definition.description, "description", 500);
  if (!Array.isArray(definition.expectedTypeIds) || definition.expectedTypeIds.length > 8 || definition.expectedTypeIds.some((key) => typeof key !== "string" || !CANONICAL_KEY.test(key))) invalid("expectedTypeIds must contain canonical registry keys.");
  if (!Array.isArray(definition.objectRoles) || definition.objectRoles.length < 1 || definition.objectRoles.length > 8) invalid("objectRoles must contain between one and eight roles.");
  const objectRoles = definition.objectRoles.map((raw, index) => {
    const role = object(raw, `objectRoles[${index}]`);
    exactKeys(role, ["role", "optional"], ["typeId"], `objectRoles[${index}]`);
    if (!["primary_document", "subject_entity", "experience_event"].includes(String(role.role)) || typeof role.optional !== "boolean") invalid(`objectRoles[${index}] is invalid.`);
    if (role.typeId !== undefined && (typeof role.typeId !== "string" || !CANONICAL_KEY.test(role.typeId))) invalid(`objectRoles[${index}].typeId is invalid.`);
    return { role: role.role as TemplateDefinitionV1["objectRoles"][number]["role"], optional: role.optional, ...(role.typeId ? { typeId: role.typeId as string } : {}) };
  });
  if (!Array.isArray(definition.sections) || definition.sections.length < 1 || definition.sections.length > 8) invalid("sections must contain between one and eight sections.");
  const seen = new Set<string>();
  let itemCount = 0;
  const sections = definition.sections.map((raw, sectionIndex) => {
    const section = object(raw, `sections[${sectionIndex}]`);
    exactKeys(section, ["key", "label", "items"], [], `sections[${sectionIndex}]`);
    const key = textValue(section.key, `sections[${sectionIndex}].key`, 100);
    if (!CANONICAL_KEY.test(key)) invalid("Section keys must be canonical.");
    if (!Array.isArray(section.items) || section.items.length > 15) invalid("A template section can contain at most 15 items.");
    const items = section.items.map((rawItem, itemIndex) => {
      itemCount += 1;
      const item = object(rawItem, `sections[${sectionIndex}].items[${itemIndex}]`);
      exactKeys(item, ["key", "kind", "prompt", "prominence", "allowedAiOperations"], ["helperText", "binding", "inputKind", "cardinality"], "template item");
      const itemKey = textValue(item.key, "template item key", 100);
      if (!CANONICAL_KEY.test(itemKey) || seen.has(itemKey)) invalid("Template item keys must be unique canonical keys.");
      seen.add(itemKey);
      if (!ITEM_KINDS.has(item.kind as TemplateItemKind) || !["core", "suggested", "optional"].includes(String(item.prominence))) invalid(`Template item ${itemKey} has an invalid kind or prominence.`);
      if (!Array.isArray(item.allowedAiOperations) || item.allowedAiOperations.length > 6 || item.allowedAiOperations.some((operation) => !AI_OPERATIONS.has(operation as TemplateAiOperation))) invalid(`Template item ${itemKey} has unsupported AI operations.`);
      if (item.allowedAiOperations.includes("none") && item.allowedAiOperations.length > 1) invalid(`Template item ${itemKey} cannot combine none with another AI operation.`);
      if (item.inputKind !== undefined && !INPUT_KINDS.has(item.inputKind as TemplateInputKind)) invalid(`Template item ${itemKey} has an unsupported input kind.`);
      if (item.cardinality !== undefined && !["one", "many"].includes(String(item.cardinality))) invalid(`Template item ${itemKey} has invalid cardinality.`);
      let binding: TemplateBindingV1 | undefined;
      if (item.binding !== undefined) {
        const rawBinding = object(item.binding, `binding for ${itemKey}`);
        exactKeys(rawBinding, ["ownerRole"], ["fieldDefinitionId", "fieldKey", "predicateKey", "corePath"], `binding for ${itemKey}`);
        if (!["primary_document", "subject_entity", "experience_event"].includes(String(rawBinding.ownerRole))) invalid(`Binding for ${itemKey} has an invalid owner role.`);
        const targets = [rawBinding.fieldDefinitionId, rawBinding.fieldKey, rawBinding.predicateKey, rawBinding.corePath].filter((candidate) => candidate !== undefined);
        if (targets.length !== 1) invalid(`Binding for ${itemKey} must select exactly one target.`);
        for (const candidate of [rawBinding.fieldKey, rawBinding.predicateKey]) if (candidate !== undefined && (typeof candidate !== "string" || !CANONICAL_KEY.test(candidate))) invalid(`Binding for ${itemKey} has an invalid canonical key.`);
        if (rawBinding.fieldDefinitionId !== undefined && typeof rawBinding.fieldDefinitionId !== "string") invalid(`Binding for ${itemKey} has an invalid field ID.`);
        if (rawBinding.corePath !== undefined && !["document.title", "document.written_at", "event.occurred_at"].includes(String(rawBinding.corePath))) invalid(`Binding for ${itemKey} has an invalid core path.`);
        binding = rawBinding as TemplateBindingV1;
      }
      const kind = item.kind as TemplateItemKind;
      if (["field", "relation", "core"].includes(kind) && (!binding || !item.inputKind)) invalid(`Structured item ${itemKey} requires a binding and input kind.`);
      if (kind === "recall_cue" && binding) invalid(`Recall cue ${itemKey} cannot commit a structured binding.`);
      return {
        key: itemKey,
        kind,
        prompt: textValue(item.prompt, `prompt for ${itemKey}`, 300),
        ...(item.helperText === undefined ? {} : { helperText: textValue(item.helperText, `helperText for ${itemKey}`, 500) }),
        prominence: item.prominence as TemplateItemV1["prominence"],
        ...(binding ? { binding } : {}),
        ...(item.inputKind ? { inputKind: item.inputKind as TemplateInputKind } : {}),
        ...(item.cardinality ? { cardinality: item.cardinality as "one" | "many" } : {}),
        allowedAiOperations: [...item.allowedAiOperations] as TemplateAiOperation[],
      };
    });
    return { key, label: textValue(section.label, `sections[${sectionIndex}].label`, 100), items };
  });
  if (itemCount < 1 || itemCount > 30) invalid("A template must contain between one and 30 items.");
  const validated: TemplateDefinitionV1 = { contractVersion: 1, name, ...(description ? { description } : {}), expectedTypeIds: [...definition.expectedTypeIds] as string[], objectRoles, sections };
  const lint = promptSafetyLint(validated);
  if (lint.length) invalid(`Prompt safety lint failed: ${lint.map((issue) => `${issue.itemKey}:${issue.code}`).join(", ")}`);
  return validated;
}

export function itemValueKind(item: TemplateItemV1): TemplateValueKind {
  if (item.inputKind === "rating") return "rating";
  if (item.inputKind === "date") return "date";
  if (item.inputKind === "number" || item.inputKind === "measurement") return "number";
  if (item.inputKind === "boolean") return "boolean";
  if (item.inputKind === "chips" || item.cardinality === "many") return "json";
  return "text";
}

export function validateTemplateSubmission(value: unknown, definition: TemplateDefinitionV1): TemplateSubmission {
  const submission = object(value, "template submission");
  exactKeys(submission, ["templateVersionId", "appliedAt", "inputs"], [], "template submission");
  const templateVersionId = textValue(submission.templateVersionId, "templateVersionId", 200);
  if (typeof submission.appliedAt !== "string" || Number.isNaN(Date.parse(submission.appliedAt))) invalid("appliedAt must be an ISO timestamp.");
  if (!Array.isArray(submission.inputs) || submission.inputs.length > 60) invalid("Template inputs must be an array of at most 60 values.");
  const items = new Map(definition.sections.flatMap((section) => section.items).filter((item) => item.kind !== "recall_cue" && item.kind !== "scaffold").map((item) => [item.key, item]));
  const seen = new Set<string>();
  const inputs = submission.inputs.map((raw, index) => {
    const input = object(raw, `inputs[${index}]`);
    exactKeys(input, ["itemKey", "valueKind", "value", "blankState", "inputOrder", "clientTimestamp"], [], `inputs[${index}]`);
    const itemKey = textValue(input.itemKey, `inputs[${index}].itemKey`, 100);
    const item = items.get(itemKey);
    if (!item || seen.has(itemKey)) invalid("Template inputs must reference unique structured items in this version.");
    seen.add(itemKey);
    if (!VALUE_KINDS.has(input.valueKind as TemplateValueKind) || input.valueKind !== itemValueKind(item)) invalid(`Template input ${itemKey} has an invalid value kind.`);
    if (!BLANK_STATES.has(input.blankState as TemplateBlankState) || !Number.isInteger(input.inputOrder) || Number(input.inputOrder) < 0) invalid(`Template input ${itemKey} has invalid state or order.`);
    if (typeof input.clientTimestamp !== "string" || Number.isNaN(Date.parse(input.clientTimestamp))) invalid(`Template input ${itemKey} requires an ISO client timestamp.`);
    const answered = input.blankState === "answered";
    const validValue = input.valueKind === "text" ? typeof input.value === "string"
      : input.valueKind === "number" ? typeof input.value === "number" && Number.isFinite(input.value)
        : input.valueKind === "boolean" ? typeof input.value === "boolean"
          : input.valueKind === "date" ? typeof input.value === "string" && /^\d{4}-\d{2}-\d{2}/.test(input.value)
            : input.valueKind === "rating" ? typeof input.value === "number" && Number.isFinite(input.value) && input.value >= 0 && input.value <= 5
              : Array.isArray(input.value) || (input.value !== null && typeof input.value === "object");
    if (answered !== validValue) invalid(`Template input ${itemKey} must have a typed value exactly when answered.`);
    if (input.blankState === "withheld" && item.allowedAiOperations.some((operation) => operation !== "none")) {
      // The stored item policy remains immutable; withheld removes operations in the analyzer projection.
    }
    return { itemKey, valueKind: input.valueKind as TemplateValueKind, value: answered ? input.value : null, blankState: input.blankState as TemplateBlankState, inputOrder: Number(input.inputOrder), clientTimestamp: input.clientTimestamp };
  });
  return { templateVersionId, appliedAt: submission.appliedAt, inputs };
}

export function templateInputAnalyzerProjection(definition: TemplateDefinitionV1, submission: TemplateSubmission) {
  const items = new Map(definition.sections.flatMap((section) => section.items).map((item) => [item.key, item]));
  return submission.inputs.map((input) => ({
    item_key: input.itemKey,
    state: input.blankState,
    user_value: input.blankState === "answered" ? input.value : null,
    allowed_ai_operations: input.blankState === "withheld" || input.blankState === "not_applicable" ? [] : [...(items.get(input.itemKey)?.allowedAiOperations ?? [])].filter((operation) => operation !== "none"),
  }));
}
