import type { ZettelMock } from "@/lib/mock/vault";

export type ZettelPropertyOption = {
  value: string;
  label: string;
};

export const ZETTEL_DOCUMENT_KIND_OPTIONS: ZettelPropertyOption[] = [
  { value: "reference", label: "참고 자료" },
  { value: "sermon", label: "설교" },
  { value: "sermon_note", label: "설교 노트" },
  { value: "bible_study", label: "성경 공부" },
  { value: "meditation", label: "묵상" },
  { value: "essay", label: "에세이" },
  { value: "reflection", label: "성찰" },
  { value: "letter", label: "편지 / 메시지" },
  { value: "poem", label: "시" },
  { value: "journal", label: "저널" },
  { value: "prompt", label: "프롬프트" },
  { value: "fiction", label: "소설" },
  { value: "story_idea", label: "이야기 아이디어" },
  { value: "worldbuilding", label: "세계관" },
  { value: "game_note", label: "게임 노트" },
  { value: "personality_note", label: "성격 노트" },
  { value: "psychology_note", label: "심리 노트" },
  { value: "insight", label: "인사이트" },
  { value: "scrap", label: "스크랩" },
  { value: "personal_note", label: "개인 노트" },
  { value: "archive", label: "아카이브" },
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
  return ZETTEL_DOCUMENT_KIND_OPTIONS.find((option) => option.value === normalized)?.label ?? "아카이브";
}

export function getZettelSearchText(zettel: ZettelMock) {
  const sourceProperties = zettel.sourceDocument?.properties
    .flatMap((property) => [property.name, property.value, property.type ?? ""])
    .filter(Boolean)
    .join(" ");

  return [
    zettel.title,
    zettel.summary,
    zettel.searchText ?? zettel.content,
    zettel.type,
    zettel.category,
    zettel.tags.join(" "),
    (zettel.aliases ?? []).join(" "),
    zettel.status ?? "",
    zettel.documentKind ?? "",
    zettel.sourceReliability ?? "",
    zettel.reviewCadence ?? "",
    zettel.reviewDueAt ?? "",
    normalizeZettelDocumentKind(zettel.documentKind),
    getZettelDocumentKindLabel(zettel.documentKind),
    zettel.source ?? "",
    zettel.sourceUrl ?? "",
    zettel.originalCreatedAt ?? "",
    zettel.sourceDocument?.url ?? "",
    zettel.sourcePropertySearchText ?? "",
    zettel.outgoingLinks.map((link) => link.title).join(" "),
    zettel.backlinks.join(" "),
    sourceProperties ?? "",
  ]
    .join(" ")
    .toLowerCase();
}
