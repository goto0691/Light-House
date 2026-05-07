export type PropertyEntityType =
  | "zettel"
  | "media"
  | "person"
  | "daily_log"
  | "daily_log_entry"
  | "project"
  | "task"
  | "habit"
  | "workout"
  | "career"
  | "asset"
  | "place"
  | "gift";

export type PropertyGroupKey = "identity" | "classification" | "status" | "dates" | "relations" | "source" | "review" | "domain";

export type PropertyValueType = "text" | "longText" | "select" | "multiSelect" | "date" | "number" | "boolean" | "url" | "relation";

export type PropertyDisplayKind = "text" | "textarea" | "select" | "segmented" | "chip" | "date" | "number" | "checkbox" | "url";

export type PropertyOption = {
  value: string;
  label: string;
};

export type PropertyGroupDefinition = {
  key: PropertyGroupKey;
  label: string;
  description?: string;
  defaultOpen?: boolean;
};

export type PropertyDefinition = {
  key: string;
  entityType: PropertyEntityType;
  field: string;
  label: string;
  description?: string;
  group: PropertyGroupKey;
  valueType: PropertyValueType;
  display?: PropertyDisplayKind;
  options?: PropertyOption[];
  placeholder?: string;
  allowEmpty?: boolean;
  defaultVisibleInList?: boolean;
  defaultVisibleInDetail?: boolean;
  editable?: boolean;
  sourceAliases?: string[];
};

export const COMMON_PROPERTY_GROUPS: PropertyGroupDefinition[] = [
  { key: "identity", label: "기본 정보", defaultOpen: true },
  { key: "classification", label: "분류", defaultOpen: true },
  { key: "status", label: "상태", defaultOpen: true },
  { key: "dates", label: "날짜", defaultOpen: true },
  { key: "relations", label: "관계", defaultOpen: true },
  { key: "source", label: "출처", defaultOpen: true },
  { key: "review", label: "검토", defaultOpen: true },
  { key: "domain", label: "세부 속성", defaultOpen: true },
];

export function optionLabel(options: PropertyOption[], value: string | null | undefined, fallback = "") {
  if (!value) return fallback;
  return options.find((option) => option.value === value)?.label ?? fallback;
}
