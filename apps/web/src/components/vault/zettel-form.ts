import type { ZettelMock } from "@/lib/mock/vault";
import {
  ZETTEL_TYPE_OPTIONS as PROPERTY_ZETTEL_TYPE_OPTIONS,
} from "@/lib/properties/zettel";
import { normalizeZettelDocumentKind, ZETTEL_DOCUMENT_KIND_OPTIONS } from "@/lib/vault/zettel-properties";

export { ZETTEL_REVIEW_CADENCE_OPTIONS, ZETTEL_SOURCE_RELIABILITY_OPTIONS, ZETTEL_STATUS_OPTIONS } from "@/lib/properties/zettel";

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

export const ZETTEL_TYPE_OPTIONS = PROPERTY_ZETTEL_TYPE_OPTIONS as Array<{ value: ZettelMock["type"]; label: string }>;

export const DOCUMENT_KIND_OPTIONS = ZETTEL_DOCUMENT_KIND_OPTIONS;

export function getZettelOptionLabel(options: Array<{ value: string; label: string }>, value: string | null | undefined, fallback = "") {
  if (!value) return fallback;
  return options.find((option) => option.value === value)?.label ?? fallback;
}

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
