import type { V2SavedViewFieldRenderer } from "./saved-view-fields";

export const SAVED_FIELD_PAGE_CONTRACT = "saved-field-page.v1" as const;
export const SAVED_FIELD_PAGE_UNITS = 4096;
/** An explicit single-value read, not the default list projection budget. */
export const SAVED_FIELD_MAX_STORED_BYTES = 2 * 1024 * 1024;
export type SavedFieldPage = Readonly<{
  contract: typeof SAVED_FIELD_PAGE_CONTRACT;
  recordId: string; propertyId: string; fieldKey: string; privacyLevel: "normal";
  revision: string; renderer: V2SavedViewFieldRenderer; sourceLabel: string;
  lockedByUser: boolean; unit: string | null; totalUtf16: number;
  offset: number; end: number; nextOffset: number | null; text: string; totalStoredBytes: number;
}>;

export function savedFieldTextEnd(text: string, offset: number) {
  let end = Math.min(text.length, offset + SAVED_FIELD_PAGE_UNITS);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return end;
}
