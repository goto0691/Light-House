import type { ZettelMock } from "@/lib/mock/vault";

export type ZettelFormState = {
  title: string;
  content: string;
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

export const DOCUMENT_KIND_OPTIONS = [
  { value: "sermon", label: "Sermon" },
  { value: "sermon_note", label: "Sermon Note" },
  { value: "bible_study", label: "Bible Study" },
  { value: "meditation", label: "Meditation" },
  { value: "essay", label: "Essay" },
  { value: "reflection", label: "Reflection" },
  { value: "prompt", label: "Prompt" },
  { value: "fiction", label: "Fiction" },
  { value: "story_idea", label: "Story Idea" },
  { value: "personal_note", label: "Personal Note" },
  { value: "archive", label: "Archive" },
];

export function buildZettelForm(zettel?: ZettelMock | null): ZettelFormState {
  return {
    title: zettel?.title ?? "",
    content: zettel?.content ?? "",
    type: zettel?.type ?? "fleeting",
    documentKind: zettel?.documentKind ?? "",
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
