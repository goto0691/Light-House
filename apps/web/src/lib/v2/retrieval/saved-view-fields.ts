import { SAVED_VIEW_RECORD_METADATA_KEYS } from "./saved-view-contract";
export { captureSavedViewVisibleFields } from "./saved-view-contract";

export const SAVED_FIELD_INLINE_BYTES = 2048;
export const SAVED_FIELD_PREVIEW_POINTS = 256;

export type V2SavedViewFieldRenderer = "text" | "number" | "boolean" | "date" | "rating" | "json";
export type V2SavedViewFieldValue = Readonly<{
  /** Built-in record metadata is not a property row. */
  propertyId: string | null;
  value: string | number | boolean | null;
  renderer: V2SavedViewFieldRenderer;
  unit: string | null;
  sourceLabel: string;
  lockedByUser: boolean;
  /** Only the stored JSON prefix, never a complete value or copy source. */
  preview?: Readonly<{ format: "stored_json"; totalBytes: number }>;
}>;
export type V2SavedViewField = Readonly<{
  fieldKey: string;
  label: string;
  state: "value" | "missing" | "private" | "conflict";
  values: readonly V2SavedViewFieldValue[];
}>;
export const SAVED_VIEW_BUILTIN_FIELDS = Object.freeze([
  { fieldKey: SAVED_VIEW_RECORD_METADATA_KEYS[0], label: "보관일" },
  { fieldKey: SAVED_VIEW_RECORD_METADATA_KEYS[1], label: "작성일" },
  { fieldKey: SAVED_VIEW_RECORD_METADATA_KEYS[2], label: "수정일" },
  { fieldKey: SAVED_VIEW_RECORD_METADATA_KEYS[3], label: "분류" },
] as const);
const labels = new Map<string, string>(SAVED_VIEW_BUILTIN_FIELDS.map((field) => [field.fieldKey, field.label]));

export type SavedViewFieldValueRow = Readonly<{
  propertyId: string | null; valueKind: string; valueJson: string | null; unit: string | null;
  sourceClass: string; lockedByUser: number; priority?: number;
  valuePreview?: string | null; storedBytes?: number;
}>;
export type SavedViewFieldRow = Readonly<{ fieldKey: string; label: string; values: readonly SavedViewFieldValueRow[] }>;
const sourceLabels: Readonly<Record<string, string>> = Object.freeze({
  user_locked: "사용자 잠금", user_explicit: "직접 입력", user_context: "내 글에서 확인", image_ocr: "이미지 OCR",
  transcript_extract: "녹취에서 추출", exif: "파일 메타데이터", external_grounded: "외부 출처", calculated: "계산한 값",
  ai_inferred: "AI 추론", imported: "가져온 값", metadata: "기록 메타데이터",
  type_user: "사용자가 분류", type_ai: "AI 분류", type_import: "가져온 분류",
});

export function materializeSavedViewFieldValue(row: SavedViewFieldValueRow): V2SavedViewFieldValue | null {
  if (row.valueJson === null) {
    if (!row.propertyId || typeof row.valuePreview !== "string" || !Number.isSafeInteger(row.storedBytes)
      || row.storedBytes! <= SAVED_FIELD_INLINE_BYTES || !["text", "number", "boolean", "date", "rating", "json"].includes(row.valueKind)
      || Array.from(row.valuePreview).length > SAVED_FIELD_PREVIEW_POINTS) return null;
    return { propertyId: row.propertyId, value: row.valuePreview, renderer: row.valueKind as V2SavedViewFieldRenderer,
      unit: row.unit, sourceLabel: sourceLabels[row.sourceClass] ?? "확인된 값", lockedByUser: row.lockedByUser === 1,
      preview: { format: "stored_json", totalBytes: row.storedBytes! } };
  }
  let value: unknown;
  try { value = JSON.parse(row.valueJson); } catch { return null; }
  const renderer = row.valueKind as V2SavedViewFieldRenderer;
  if (!["text", "number", "boolean", "date", "rating", "json"].includes(renderer)) return null;
  if (value !== null && (renderer === "text" || renderer === "date") && typeof value !== "string") return null;
  if (value !== null && (renderer === "number" || renderer === "rating") && (typeof value !== "number" || !Number.isFinite(value))) return null;
  if (value !== null && renderer === "boolean" && typeof value !== "boolean") return null;
  return { propertyId: row.propertyId, value: renderer === "json" ? row.valueJson : value as string | number | boolean | null,
    renderer, unit: row.unit, sourceLabel: sourceLabels[row.sourceClass] ?? "확인된 값", lockedByUser: row.lockedByUser === 1 };
}

export function preferredSavedViewFieldRows<T extends SavedViewFieldValueRow>(values: readonly T[]): readonly T[] {
  if (!values.length) return [];
  const locked = values.some((value) => value.lockedByUser === 1), tier = values.filter((value) => !locked || value.lockedByUser === 1);
  const priority = tier.reduce((minimum, value) => Math.min(minimum, value.priority ?? 0), Infinity);
  return tier.filter((value) => (value.priority ?? 0) === priority);
}

/** SQL supplies only accepted/current rows from this record's permission snapshot. */
export function presentSavedViewFields(rows: readonly SavedViewFieldRow[], privacyLevel: "normal" | "sensitive" | "restricted"): readonly V2SavedViewField[] {
  return rows.map((row) => {
    const base = { fieldKey: row.fieldKey, label: labels.get(row.fieldKey) ?? row.label };
    if (privacyLevel !== "normal") return { ...base, state: "private", values: [] };
    if (!row.values.length) return { ...base, state: "missing", values: [] };
    const selected = preferredSavedViewFieldRows(row.values);
    const values = selected.map(materializeSavedViewFieldValue);
    // Neither malformed persisted values nor duplicate same-priority rows turn
    // into a silently selected winner or an apparently absent property.
    return { ...base, state: values.length > 1 || values.some((value) => value === null) ? "conflict" : "value",
      values: values.filter((value): value is V2SavedViewFieldValue => value !== null) };
  });
}

/** Plain text only: callers render it as text, never HTML or executable JSON. */
export function formatSavedViewFieldValue(field: V2SavedViewFieldValue): string {
  if (field.value === null) return "값 없음";
  const value = field.renderer === "boolean" ? field.value ? "예" : "아니요" : String(field.value);
  if (field.renderer === "rating" && !field.unit) return `${value} (척도 미기록)`;
  return field.unit ? `${value} ${field.unit}` : value;
}
