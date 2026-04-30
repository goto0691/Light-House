import type { ZettelMock } from "@/lib/mock/vault";
import { normalizeZettelDocumentKind, ZETTEL_DOCUMENT_KIND_OPTIONS } from "@/lib/vault/zettel-properties";

export type ZettelFormState = {
  title: string;
  content: string;
  tags: string[];
  type: ZettelMock["type"];
  documentKind: string;
  category: string;
  status: string;
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

export function buildZettelForm(zettel?: ZettelMock | null): ZettelFormState {
  return {
    title: zettel?.title ?? "",
    content: zettel?.content ?? "",
    tags: zettel?.tags ?? [],
    type: zettel?.type ?? "fleeting",
    documentKind: normalizeZettelDocumentKind(zettel?.documentKind),
    category: zettel?.category ?? "",
    status: zettel?.status ?? "draft",
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
    type: form.type,
    category: form.category,
    status: form.status,
    documentKind: form.documentKind,
    originalCreatedAt: form.originalCreatedAt,
    source: form.source,
    sourceUrl: form.sourceUrl,
    summary: form.summary,
  };
}
