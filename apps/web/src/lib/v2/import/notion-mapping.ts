import { createHash } from "node:crypto";

import type { ImportedFieldDataType } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";

/**
 * The owner's Notion structure (D-115/D-119). Each imported database is one of the
 * owner's own types; each short property is one of the owner's fields, labelled as
 * in Notion; people, companies and platforms in properties become entities so a
 * record connects to them. Keys are neutral: nothing marks the data as imported.
 * Databases not listed here (workout, diary, network profiles, life log, …) are
 * not imported.
 */
export type NotionFieldMapping = Readonly<{ key: string; label: string; dataType: ImportedFieldDataType; entityKind?: string }>;
export type NotionDatabaseMapping = Readonly<{ type: Readonly<{ key: string; label: string }>; fields: Readonly<Record<string, NotionFieldMapping>> }>;

const text = (key: string, label: string, entityKind?: string): NotionFieldMapping => ({ key, label, dataType: "short_text", ...(entityKind ? { entityKind } : {}) });
const longText = (key: string, label: string): NotionFieldMapping => ({ key, label, dataType: "long_text" });
const date = (key: string, label: string): NotionFieldMapping => ({ key, label, dataType: "date" });
/** A multi-select or a comma list in Notion: several values, kept as a list. */
const list = (key: string, label: string, entityKind?: string): NotionFieldMapping => ({ key, label, dataType: "ordered_list", ...(entityKind ? { entityKind } : {}) });

export const NOTION_DATABASES: Readonly<Record<string, NotionDatabaseMapping>> = {
  "영상 로그": {
    type: { key: "video_log", label: "영상 로그" },
    fields: {
      "감독/크리에이터": list("director_creator", "감독/크리에이터", "person"),
      "날짜": date("record_date", "날짜"),
      "다시 볼 가치": { key: "rewatch_worthy", label: "다시 볼 가치", dataType: "boolean" },
      "리뷰": longText("review", "리뷰"),
      "시청상태": text("viewing_status", "시청상태"),
      "유형": text("media_type", "유형"),
      "장르": list("genre", "장르"),
      "제작사": list("production_company", "제작사", "organization"),
      "평점": text("user_rating", "평점"),
      "플랫폼": text("platform", "플랫폼", "platform"),
    },
  },
  "컨텐츠 로그": {
    type: { key: "content_log", label: "컨텐츠 로그" },
    fields: {
      "감독": list("director_creator", "감독/크리에이터", "person"),
      "날짜": date("record_date", "날짜"),
      "유형": text("media_type", "유형"),
      "장르": list("genre", "장르"),
      "제작사": list("production_company", "제작사", "organization"),
      "평가": text("evaluation", "평가"),
      "플랫폼": text("platform", "플랫폼", "platform"),
      "한줄평": longText("one_line_review", "한줄평"),
    },
  },
  "게임 로그": {
    type: { key: "game_log", label: "게임 로그" },
    fields: {
      "개발사": text("developer", "개발사", "organization"),
      "날짜": date("record_date", "날짜"),
      "리뷰": longText("review", "리뷰"),
      "상태": text("play_status", "진행 상태"),
      "장르": list("genre", "장르"),
      "평점": text("user_rating", "평점"),
      "플랫폼": text("platform", "플랫폼", "platform"),
      "플레이 타임": { key: "play_time", label: "플레이 타임", dataType: "decimal" },
    },
  },
  "1 지식 창고": {
    type: { key: "knowledge_note", label: "지식 창고" },
    fields: {
      "상태": text("note_status", "정리 상태"),
      "생성 일시": date("created_on", "생성 일시"),
      "유형": list("note_type", "글 유형"),
      "출처": text("source", "출처"),
      "카테고리": text("category", "카테고리"),
      "한 줄 요약": longText("summary", "한 줄 요약"),
    },
  },
  "묵상": {
    type: { key: "meditation", label: "묵상" },
    fields: {
      "본문말씀": text("scripture", "본문말씀"),
      "날짜": date("record_date", "날짜"),
      "배경지식": longText("background", "배경지식"),
    },
  },
};

/** Pages of these databases are people: linked records connect to a person by name only. */
export const NOTION_PERSON_DATABASES: ReadonlySet<string> = new Set(["3 네트워크"]);

const LINK_SLUGS: Readonly<Record<string, string>> = {
  "컨텐츠 로그": "content_log", "게임 로그": "game_log", "영상 로그": "video_log", "도서 로그": "book_log",
  "3. 네트워크": "person", "관련인물": "person", "관련 인물": "person", "사람": "person",
  "라이프 로그": "life_log", "2. 프로젝트": "project", "1. 지식 창고": "knowledge_note", "묵상 로그": "meditation",
  "묵상": "meditation", "일기": "diary", "운동 로그": "workout", "배경지식": "background",
};

/** A link property keeps its Notion name as the relation label. */
export function notionLinkPredicate(property: string) {
  const slug = LINK_SLUGS[property] ?? `p${createHash("sha256").update(property).digest("hex").slice(0, 8)}`;
  return { key: `link.${slug}`, label: property };
}

/** A person/company/platform taken from a property links under the field's label. */
export function notionEntityPredicate(field: NotionFieldMapping) {
  return { key: `mentions.${field.key}`, label: field.label };
}

/** Words that stand for "no one / unknown" in a person or company property; they are not entities. */
const PLACEHOLDER_NAMES = new Set(["정보 없음", "정보없음", "없음", "미상", "알 수 없음", "모름", "-", "?", "n/a", "na", "unknown", "none"]);
export const isPlaceholderName = (name: string) => PLACEHOLDER_NAMES.has(name.trim().toLowerCase());

/** Multi-select and list values are comma separated in the export. */
export const splitNotionList = (value: string) => [...new Set(value.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean))];

/** A Notion value as a typed field value, or null when it does not fit the field. */
export function notionFieldValue(field: NotionFieldMapping, raw: string, toDate: (value: string) => string | null) {
  const value = raw.trim();
  if (!value) return null;
  if (field.dataType === "date") { const day = toDate(value); return day ? { kind: "date" as const, date: day } : null; }
  if (field.dataType === "boolean") return /^(yes|no)$/i.test(value) ? { kind: "boolean" as const, boolean: /^yes$/i.test(value) } : null;
  if (field.dataType === "decimal") return /^\d+(\.\d+)?$/.test(value) ? { kind: "number" as const, number: Number(value) } : null;
  if (field.dataType === "ordered_list") { const items = splitNotionList(value); return items.length ? { kind: "list" as const, items } : null; }
  return { kind: "text" as const, text: value };
}
