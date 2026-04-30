import type { ZettelMock } from "@/lib/mock/vault";
import { normalizeZettelDocumentKind, ZETTEL_DOCUMENT_KIND_OPTIONS } from "@/lib/vault/zettel-properties";

export type ZettelFormState = {
  title: string;
  content: string;
  tags: string[];
  aliases: string[];
  type: ZettelMock["type"];
  documentKind: string;
  category: string;
  status: string;
  sourceReliability: string;
  reviewCadence: string;
  reviewDueAt: string;
  summary: string;
  source: string;
  sourceUrl: string;
  originalCreatedAt: string;
};

export const ZETTEL_TYPE_OPTIONS: Array<{ value: ZettelMock["type"]; label: string }> = [
  { value: "fleeting", label: "Fleeting" },
  { value: "literature", label: "Literature" },
  { value: "permanent", label: "Permanent" },
  { value: "moc", label: "MOC" },
  { value: "reference", label: "Reference" },
];

export const ZETTEL_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "needs_review", label: "Needs Review" },
  { value: "archived", label: "Archived" },
];

export const DOCUMENT_KIND_OPTIONS = ZETTEL_DOCUMENT_KIND_OPTIONS;

export const ZETTEL_SOURCE_RELIABILITY_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "tertiary", label: "Tertiary" },
  { value: "personal", label: "Personal" },
  { value: "imported", label: "Imported" },
  { value: "mixed", label: "Mixed" },
];

export const ZETTEL_REVIEW_CADENCE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export function buildZettelForm(zettel?: ZettelMock | null): ZettelFormState {
  return {
    title: zettel?.title ?? "",
    content: zettel?.content ?? "",
    tags: zettel?.tags ?? [],
    aliases: zettel?.aliases ?? [],
    type: zettel?.type ?? "fleeting",
    documentKind: normalizeZettelDocumentKind(zettel?.documentKind),
    category: zettel?.category ?? "",
    status: zettel?.status ?? "draft",
    sourceReliability: zettel?.sourceReliability ?? "unknown",
    reviewCadence: zettel?.reviewCadence ?? "none",
    reviewDueAt: zettel?.reviewDueAt ?? "",
    summary: zettel?.summary && zettel.summary !== "요약이 아직 없습니다." ? zettel.summary : "",
    source: zettel?.source ?? "",
    sourceUrl: zettel?.sourceUrl ?? "",
    originalCreatedAt: zettel?.originalCreatedAt ?? "",
  };
}

export function zettelFormPayload(form: ZettelFormState) {
  return {
    title: form.title,
    content: form.content,
    tags: form.tags,
    aliases: form.aliases,
    type: form.type,
    category: form.category,
    status: form.status,
    documentKind: form.documentKind,
    sourceReliability: form.sourceReliability,
    reviewCadence: form.reviewCadence,
    reviewDueAt: form.reviewDueAt,
    originalCreatedAt: form.originalCreatedAt,
    source: form.source,
    sourceUrl: form.sourceUrl,
    summary: form.summary,
  };
}
