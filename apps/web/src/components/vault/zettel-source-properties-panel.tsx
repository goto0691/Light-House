"use client";

import { SourcePropertyInspector, type SourceRecordInfo, type SourcePropertyTarget } from "@/components/shared/properties/source-property-inspector";
import type { ZettelFormState } from "@/components/vault/zettel-form";
import type { SourceDocumentInfo } from "@/lib/mock/vault";
import type { PropertyDefinition } from "@/lib/properties/types";
import { ZETTEL_PROPERTY_DEFINITIONS } from "@/lib/properties/zettel";
import { normalizeZettelDocumentKind } from "@/lib/vault/zettel-properties";

type ZettelSourcePropertyTarget =
  | "skip"
  | "title"
  | "summary"
  | "category"
  | "documentKind"
  | "status"
  | "aliases"
  | "sourceReliability"
  | "reviewCadence"
  | "reviewDueAt"
  | "source"
  | "sourceUrl"
  | "originalCreatedAt"
  | "tags";

type ZettelSourcePropertiesPanelProps = {
  form: ZettelFormState;
  onChange: (patch: Partial<ZettelFormState>) => void;
  sourceDocument?: SourceDocumentInfo | null;
  compact?: boolean;
};

const TARGET_OPTIONS: Array<SourcePropertyTarget<ZettelFormState> & { value: ZettelSourcePropertyTarget }> = [
  { value: "skip", label: "원본 유지" },
  { value: "title", label: "제목", apply: ({ form, sourceDocument, value }) => propertyPatch("title", value, form, sourceDocument) },
  { value: "summary", label: "요약", apply: ({ form, sourceDocument, value }) => propertyPatch("summary", value, form, sourceDocument) },
  { value: "category", label: "카테고리", apply: ({ form, sourceDocument, value }) => propertyPatch("category", value, form, sourceDocument) },
  { value: "documentKind", label: "문서 종류", apply: ({ form, sourceDocument, value }) => propertyPatch("documentKind", value, form, sourceDocument) },
  { value: "status", label: "상태", apply: ({ form, sourceDocument, value }) => propertyPatch("status", value, form, sourceDocument) },
  { value: "tags", label: "태그", apply: ({ form, sourceDocument, value }) => propertyPatch("tags", value, form, sourceDocument) },
  { value: "aliases", label: "별칭", apply: ({ form, sourceDocument, value }) => propertyPatch("aliases", value, form, sourceDocument) },
  { value: "sourceReliability", label: "출처 신뢰도", apply: ({ form, sourceDocument, value }) => propertyPatch("sourceReliability", value, form, sourceDocument) },
  { value: "reviewCadence", label: "검토 주기", apply: ({ form, sourceDocument, value }) => propertyPatch("reviewCadence", value, form, sourceDocument) },
  { value: "reviewDueAt", label: "검토일", apply: ({ form, sourceDocument, value }) => propertyPatch("reviewDueAt", value, form, sourceDocument) },
  { value: "source", label: "출처", apply: ({ form, sourceDocument, value }) => propertyPatch("source", value, form, sourceDocument) },
  { value: "sourceUrl", label: "출처 URL", apply: ({ form, sourceDocument, value }) => propertyPatch("sourceUrl", value, form, sourceDocument) },
  { value: "originalCreatedAt", label: "원본 생성일", apply: ({ form, sourceDocument, value }) => propertyPatch("originalCreatedAt", value, form, sourceDocument) },
];

const ZETTEL_SOURCE_DEFINITIONS: PropertyDefinition[] = [
  {
    key: "zettel.title",
    entityType: "zettel",
    field: "title",
    label: "제목",
    group: "identity",
    valueType: "text",
    sourceAliases: ["title", "name", "제목", "이름"],
  },
  {
    key: "zettel.summary",
    entityType: "zettel",
    field: "summary",
    label: "요약",
    group: "review",
    valueType: "longText",
    sourceAliases: ["summary", "description", "요약", "설명"],
  },
  ...ZETTEL_PROPERTY_DEFINITIONS,
];

export function ZettelSourcePropertiesPanel({ compact = false, form, onChange, sourceDocument }: ZettelSourcePropertiesPanelProps) {
  return (
    <SourcePropertyInspector
      canonicalEntityType="zettel"
      compact={compact}
      definitions={ZETTEL_SOURCE_DEFINITIONS}
      form={form}
      onChange={onChange}
      sourceDocument={sourceDocument}
      targets={TARGET_OPTIONS}
    />
  );
}

function propertyPatch(target: ZettelSourcePropertyTarget, value: string, form: ZettelFormState, sourceDocument: SourceRecordInfo): Partial<ZettelFormState> {
  if (target === "title") return { title: value };
  if (target === "summary") return { summary: value };
  if (target === "category") return { category: compactSingleLine(value, 80) };
  if (target === "documentKind") return { documentKind: normalizeZettelDocumentKind(value) };
  if (target === "status") return { status: normalizeStatus(value) || form.status };
  if (target === "aliases") return { aliases: mergeAliases(form.aliases, value) };
  if (target === "sourceReliability") return { sourceReliability: normalizeSourceReliability(value) };
  if (target === "reviewCadence") return { reviewCadence: normalizeReviewCadence(value) };
  if (target === "reviewDueAt") return { reviewDueAt: normalizeDate(value) || form.reviewDueAt };
  if (target === "source") return { source: sourceDocument.sourceDatabase ?? compactSingleLine(value, 80) };
  if (target === "sourceUrl") return { sourceUrl: firstUrl(value) ?? sourceDocument.url ?? form.sourceUrl };
  if (target === "originalCreatedAt") return { originalCreatedAt: normalizeDate(value) || form.originalCreatedAt };
  if (target === "tags") return { tags: mergeTags(form.tags, value) };
  return {};
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function compactSingleLine(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/[^\s)\]}>"']+/i)?.[0] ?? null;
}

function normalizeDate(value: string) {
  const direct = value.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (direct) return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeStatus(value: string) {
  const text = normalize(value);
  if (text.includes("review") || text.includes("검토")) return "needs_review";
  if (text.includes("archive") || text.includes("보관")) return "archived";
  if (text.includes("active") || text.includes("진행") || text.includes("활성")) return "active";
  if (text.includes("draft") || text.includes("초안")) return "draft";
  return "";
}

function normalizeSourceReliability(value: string) {
  const text = normalize(value);
  if (text.includes("primary") || text.includes("1차") || text.includes("원문") || text.includes("직접")) return "primary";
  if (text.includes("secondary") || text.includes("2차") || text.includes("해설")) return "secondary";
  if (text.includes("tertiary") || text.includes("3차") || text.includes("요약")) return "tertiary";
  if (text.includes("personal") || text.includes("개인")) return "personal";
  if (text.includes("import") || text.includes("notion") || text.includes("legacy") || text.includes("가져")) return "imported";
  if (text.includes("mixed") || text.includes("혼합")) return "mixed";
  return "unknown";
}

function normalizeReviewCadence(value: string) {
  const text = normalize(value);
  if (text.includes("week") || text.includes("주")) return "weekly";
  if (text.includes("month") || text.includes("월")) return "monthly";
  if (text.includes("quarter") || text.includes("분기")) return "quarterly";
  if (text.includes("year") || text.includes("년")) return "yearly";
  return "none";
}

function mergeTags(currentTags: string[], value: string) {
  const next = value
    .split(/[,;/\n|]+/)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((item) => compactSingleLine(item, 40));
  const unique = new Map(currentTags.map((tag) => [tag.toLowerCase(), tag]));
  next.forEach((tag) => unique.set(tag.toLowerCase(), tag));
  return [...unique.values()];
}

function mergeAliases(currentAliases: string[], value: string) {
  const next = value
    .split(/[,;/\n|]+/)
    .map((item) => compactSingleLine(item, 80))
    .filter(Boolean);
  const unique = new Map(currentAliases.map((alias) => [alias.toLowerCase(), alias]));
  next.forEach((alias) => unique.set(alias.toLowerCase(), alias));
  return [...unique.values()];
}
