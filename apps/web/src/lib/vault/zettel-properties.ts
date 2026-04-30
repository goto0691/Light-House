import type { ZettelMock } from "@/lib/mock/vault";

export type ZettelPropertyOption = {
  value: string;
  label: string;
};

export const ZETTEL_DOCUMENT_KIND_OPTIONS: ZettelPropertyOption[] = [
  { value: "reference", label: "Reference" },
  { value: "sermon", label: "Sermon" },
  { value: "sermon_note", label: "Sermon Note" },
  { value: "bible_study", label: "Bible Study" },
  { value: "meditation", label: "Meditation" },
  { value: "essay", label: "Essay" },
  { value: "reflection", label: "Reflection" },
  { value: "letter", label: "Letter / Message" },
  { value: "poem", label: "Poem" },
  { value: "journal", label: "Journal" },
  { value: "prompt", label: "Prompt" },
  { value: "fiction", label: "Fiction" },
  { value: "story_idea", label: "Story Idea" },
  { value: "worldbuilding", label: "Worldbuilding" },
  { value: "game_note", label: "Game Note" },
  { value: "personality_note", label: "Personality Note" },
  { value: "psychology_note", label: "Psychology Note" },
  { value: "insight", label: "Insight" },
  { value: "scrap", label: "Scrap" },
  { value: "personal_note", label: "Personal Note" },
  { value: "archive", label: "Archive" },
];

const DOCUMENT_KIND_VALUES = new Set(ZETTEL_DOCUMENT_KIND_OPTIONS.map((option) => option.value));

function compact(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

export function normalizeZettelDocumentKind(value: string | null | undefined) {
  const text = compact(value ?? "");
  if (!text) return "";
  if (DOCUMENT_KIND_VALUES.has(text.replaceAll(" ", "_"))) return text.replaceAll(" ", "_");
  if (DOCUMENT_KIND_VALUES.has(text)) return text;

  if (text.includes("설교노트")) return "sermon_note";
  if (text.includes("설교")) return "sermon";
  if (text.includes("bible")) return "bible_study";
  if (text.includes("묵상") || text.includes("종교")) return "meditation";
  if (text.includes("편지") || text.includes("메시지")) return "letter";
  if (text.includes("에세이") || text.includes("논쟁")) return "essay";
  if (text.includes("성찰")) return "reflection";
  if (text === "시" || text.includes("poem")) return "poem";
  if (text.includes("journal") || text.includes("일기")) return "journal";
  if (text.includes("프롬프트") || text.includes("prompt")) return "prompt";
  if (text.includes("소설") || text.includes("fiction")) return "fiction";
  if (text.includes("세계관")) return "worldbuilding";
  if (text.includes("아이디어")) return "story_idea";
  if (text.includes("게임")) return "game_note";
  if (text.includes("기질") || text.includes("성격")) return "personality_note";
  if (text.includes("심리")) return "psychology_note";
  if (text.includes("철학") || text.includes("논리") || text.includes("인사이트")) return "insight";
  if (text.includes("스크랩")) return "scrap";
  if (text.includes("개인")) return "personal_note";
  if (text.includes("archive") || text.includes("아카이브") || text.includes("잡동사니")) return "archive";

  return "archive";
}

export function getZettelDocumentKindLabel(value: string | null | undefined) {
  const normalized = normalizeZettelDocumentKind(value);
  if (!normalized) return "";
  return ZETTEL_DOCUMENT_KIND_OPTIONS.find((option) => option.value === normalized)?.label ?? "Archive";
}

export function getZettelSearchText(zettel: ZettelMock) {
  const sourceProperties = zettel.sourceDocument?.properties
    .flatMap((property) => [property.name, property.value, property.type ?? ""])
    .filter(Boolean)
    .join(" ");

  return [
    zettel.title,
    zettel.summary,
    zettel.content,
    zettel.type,
    zettel.category,
    zettel.tags.join(" "),
    zettel.status ?? "",
    zettel.documentKind ?? "",
    normalizeZettelDocumentKind(zettel.documentKind),
    getZettelDocumentKindLabel(zettel.documentKind),
    zettel.source ?? "",
    zettel.sourceUrl ?? "",
    zettel.originalCreatedAt ?? "",
    zettel.sourceDocument?.url ?? "",
    zettel.outgoingLinks.map((link) => link.title).join(" "),
    zettel.backlinks.join(" "),
    sourceProperties ?? "",
  ]
    .join(" ")
    .toLowerCase();
}
