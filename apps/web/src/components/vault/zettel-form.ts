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
  { value: "fleeting", label: "임시" },
  { value: "literature", label: "문헌" },
  { value: "permanent", label: "영구" },
  { value: "moc", label: "MOC" },
  { value: "reference", label: "참고" },
];

export const ZETTEL_STATUS_OPTIONS = [
  { value: "draft", label: "초안" },
  { value: "active", label: "활성" },
  { value: "needs_review", label: "검토 필요" },
  { value: "archived", label: "보관" },
];

export const DOCUMENT_KIND_OPTIONS = ZETTEL_DOCUMENT_KIND_OPTIONS;

export const ZETTEL_SOURCE_RELIABILITY_OPTIONS = [
  { value: "unknown", label: "미상" },
  { value: "primary", label: "1차 출처" },
  { value: "secondary", label: "2차 출처" },
  { value: "tertiary", label: "3차 출처" },
  { value: "personal", label: "개인 기록" },
  { value: "imported", label: "가져옴" },
  { value: "mixed", label: "혼합" },
];

export const ZETTEL_REVIEW_CADENCE_OPTIONS = [
  { value: "none", label: "없음" },
  { value: "weekly", label: "매주" },
  { value: "monthly", label: "매월" },
  { value: "quarterly", label: "분기" },
  { value: "yearly", label: "매년" },
];

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
