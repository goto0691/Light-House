import { createHash } from "node:crypto";

import JSZip from "jszip";

export type NotionImportZettel = {
  notionSourceId: string;
  title: string;
  content: string;
  summary?: string;
  category?: string;
  source?: string;
  sourceUrl?: string;
  type?: "fleeting" | "permanent" | "reference";
};

export type NotionImportTask = {
  notionSourceId: string;
  title: string;
  content?: string;
  status?: "todo" | "in_progress" | "review" | "done" | "blocked";
  priority?: "P1" | "P2" | "P3";
  kind?: "development" | "writing" | "research";
  dueAt?: string;
};

export type NotionImportProject = {
  notionSourceId: string;
  title: string;
  description?: string;
  status?: "active" | "paused" | "done" | "archived";
  category?: string;
  brainEnergy?: "routine" | "normal" | "hyper_focus";
  targetDate?: string;
  priority?: "P1" | "P2" | "P3";
  kind?: "project" | "area";
};

export type NotionImportPerson = {
  notionSourceId: string;
  name: string;
  nickname?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  bio?: string;
  groups?: string[];
  address?: string;
  lastContactedAt?: string;
  status?: string;
  isFavorite?: boolean;
  coreValue?: string;
};

export type NotionImportGift = {
  notionSourceId: string;
  personName?: string;
  title: string;
  occurredAt?: string;
  satisfaction?: string;
  cost?: number;
  options?: string;
  reason?: string;
  imageUrl?: string;
};

export type NotionImportDailyLog = {
  notionSourceId: string;
  date: string;
  mood?: number;
  energyLevel?: number;
  gratitude?: string;
  journal?: string;
  meditation?: string;
  meditationVerse?: string;
};

export type NotionImportWorkout = {
  notionSourceId: string;
  date: string;
  categories: string[];
  notes?: string;
};

export type NotionImportCareer = {
  notionSourceId: string;
  organization: string;
  role: string;
  category: string;
  startDate: string;
  endDate?: string;
  description?: string;
};

export type NotionImportMediaLog = {
  notionSourceId: string;
  title: string;
  mediaType: "game" | "video" | "book" | "other";
  creator?: string;
  studio?: string;
  genre?: string;
  rating?: number;
  review?: string;
  platformOrPublisher?: string;
  status?: string;
  completedAt?: string;
  playTime?: number;
  author?: string;
  evaluation?: string;
};

export type NotionImportBundle = {
  zettels: NotionImportZettel[];
  tasks: NotionImportTask[];
  projects: NotionImportProject[];
  people: NotionImportPerson[];
  gifts: NotionImportGift[];
  dailyLogs: NotionImportDailyLog[];
  workouts: NotionImportWorkout[];
  careerEntries: NotionImportCareer[];
  mediaLogs: NotionImportMediaLog[];
  warnings: string[];
};

type CsvKind =
  | "people"
  | "tasks"
  | "projects"
  | "dailyLogs"
  | "workouts"
  | "gifts"
  | "zettels"
  | "career"
  | "media"
  | "unknown";

function emptyBundle(): NotionImportBundle {
  return {
    zettels: [],
    tasks: [],
    projects: [],
    people: [],
    gifts: [],
    dailyLogs: [],
    workouts: [],
    careerEntries: [],
    mediaLogs: [],
    warnings: [],
  };
}

function slugToTitle(filename: string) {
  return filename
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "")
    .replace(/\s+[a-f0-9]{32}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? filename;
}

function stableSourceId(namespace: string, value: string) {
  return createHash("sha1").update(`${namespace}:${value}`).digest("hex");
}

function extractFileIdentity(filename: string) {
  const normalized = filename.replace(/\\/g, "/");
  const basename = normalized.split("/").at(-1) ?? normalized;
  const notionId = basename.match(/([a-f0-9]{32})(?:_all)?\.[^.]+$/i)?.[1]?.toLowerCase();
  return {
    normalized,
    basename,
    notionId,
    fileIdentity: notionId ?? stableSourceId("file", basename.toLowerCase()),
  };
}

function sanitizeText(value: string) {
  return value.replace(/\u0000/g, "").trim();
}

function extractHeading(content: string) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}

function parseKoreanDate(value: string) {
  const normalized = value
    .trim()
    .replace(/\(GMT\+9\)/g, "")
    .replace(/\./g, "-")
    .replace(/\s+/g, " ");
  const match = normalized.match(
    /^(\d{4})년\s+(\d{1,2})월\s+(\d{1,2})일(?:\s+(오전|오후)\s+(\d{1,2}):(\d{2}))?$/,
  );

  if (!match) return undefined;

  const [, year, month, day, meridiem, rawHour, minute] = match;
  const hourNumber = rawHour ? Number(rawHour) : 0;
  const isPm = meridiem === "오후";
  const convertedHour = rawHour ? (isPm ? (hourNumber === 12 ? 12 : hourNumber + 12) : hourNumber === 12 ? 0 : hourNumber) : 0;
  return {
    date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    dateTime: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(convertedHour).padStart(2, "0")}:${minute ?? "00"}:00`,
  };
}

function normalizeDate(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const korean = parseKoreanDate(trimmed);
  if (korean) return korean.date;

  const isoDate = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateTime(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const korean = parseKoreanDate(trimmed);
  if (korean) return korean.dateTime;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeStatus(value: string | undefined): NotionImportTask["status"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "todo";
  if (["doing", "in progress", "in_progress", "working", "진행 중", "진행중"].includes(normalized)) return "in_progress";
  if (["review", "qa", "검토"].includes(normalized)) return "review";
  if (["done", "complete", "completed", "완료"].includes(normalized)) return "done";
  if (["blocked", "hold", "paused", "보류"].includes(normalized)) return "blocked";
  return "todo";
}

function normalizeProjectStatus(value: string | undefined): NotionImportProject["status"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "active";
  if (["완료", "done", "complete", "completed"].includes(normalized)) return "done";
  if (["보류", "paused", "hold", "중단"].includes(normalized)) return "paused";
  if (["archived", "archive"].includes(normalized)) return "archived";
  return "active";
}

function normalizePriority(value: string | undefined): "P1" | "P2" | "P3" {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized.includes("P1")) return "P1";
  if (normalized.includes("P3")) return "P3";
  return "P2";
}

function normalizeBrainEnergy(value: string | undefined): NotionImportProject["brainEnergy"] {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("하이퍼") || normalized.includes("hyper")) return "hyper_focus";
  if (normalized.includes("루틴") || normalized.includes("routine")) return "routine";
  return "normal";
}

function normalizeMood(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function normalizeBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return ["yes", "true", "1", "y", "예"].includes(normalized ?? "");
}

function normalizeRating(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(5, parsed));
}

function normalizeNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function splitList(value: string | undefined) {
  return (value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/g, "").trim());
}

function parseCsvRows(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { headers: [], rows: [] as Array<Record<string, string>> };
  }

  const rawHeaders = parseCsvLine(lines[0]);
  const headers = rawHeaders.map((header) => header.toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });

  return { headers, rows };
}

function classifyCsv(headers: string[], filename: string): CsvKind {
  const joined = `${filename.toLowerCase()} ${headers.join(" ")}`;

  if (/(화면이름|아이디어 내용|반응)/.test(joined)) return "tasks";
  if (/(외출자 특이사항|외출목적|외출자 이름|외출할 곳|연락처)/.test(joined)) return "zettels";
  if (/제목 없음/.test(filename) && joined.includes("이름")) return "projects";
  if (/(3 네트워크|네트워크|그룹|생일|마지막 연락일|핵심 가치|즐겨찾기)/.test(joined)) return "people";
  if (/(2 프로젝트|뇌 에너지 소모|대분류|작업기간|중요도)/.test(joined)) return "projects";
  if (/(운동 로그|운동 종류)/.test(joined)) return "workouts";
  if (/(선물|품목명|선물 사유|사람|사이즈\/옵션)/.test(joined)) return "gifts";
  if (/(라이프 로그|오늘 묵상|오늘 운동|오늘 일기)/.test(joined)) return "dailyLogs";
  if (/(일기|감정|라이프 로그|태그)/.test(joined)) return "dailyLogs";
  if (/(묵상|본문말씀|배경지식)/.test(joined)) return "dailyLogs";
  if (/(커리어|조직\/소속|근무기간)/.test(joined)) return "career";
  if (/(영상 로그|게임 로그|도서 로그|감독\/크리에이터|개발사|저자|출판사|플랫폼|플레이 타임)/.test(joined)) return "media";
  if (/(에피소드 db|작품|priority|deadline|due|status|task|todo)/.test(joined)) return "tasks";
  if (/(1 지식 창고|한 줄 요약|유형|카테고리|출처|관련인물)/.test(joined)) return "zettels";
  if (/(note|zettel|summary|content|slug|category)/.test(joined)) return "zettels";
  return "unknown";
}

function parseMarkdownEntry(filename: string, text: string, bundle: NotionImportBundle) {
  const identity = extractFileIdentity(filename);
  const content = sanitizeText(text);
  if (!content) return;

  const title = extractHeading(content) ?? slugToTitle(filename);
  const dateMatch = filename.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);

  if (dateMatch && /(daily|journal|diary|log)/i.test(filename)) {
    bundle.dailyLogs.push({
      notionSourceId: stableSourceId(identity.fileIdentity, `${title}:${dateMatch[0]}`),
      date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      journal: content,
    });
    return;
  }

  bundle.zettels.push({
    notionSourceId: identity.notionId ?? stableSourceId(identity.fileIdentity, title),
    title,
    content,
    summary: content.slice(0, 180),
    category: "Notion Markdown",
    source: "notion-import",
    type: "reference",
  });
}

function parseZettelRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle) {
  const title = row["이름"] || row.title || row.name || row["화면이름"];
  if (!title) return;

  const summary = row["한 줄 요약"] || row.summary;
  const category = row["카테고리"] || row.category || "Notion Import";
  const typeRaw = row["유형"] || row.type || "reference";
  const type = /영구|permanent/i.test(typeRaw) ? "permanent" : /fleeting|임시/i.test(typeRaw) ? "fleeting" : "reference";

  bundle.zettels.push({
    notionSourceId: stableSourceId(fileIdentity, title),
    title,
    content: [
      summary ? `한 줄 요약: ${summary}` : "",
      row["출처"] ? `출처: ${row["출처"]}` : "",
      row["관련인물"] ? `관련인물: ${row["관련인물"]}` : "",
      row["날짜"] ? `날짜: ${row["날짜"]}` : "",
      row["연락처"] ? `연락처: ${row["연락처"]}` : "",
      row["외출목적"] ? `외출목적: ${row["외출목적"]}` : "",
      row["외출자"] ? `외출자: ${row["외출자"]}` : "",
      row["외출자 이름"] ? `외출자 이름: ${row["외출자 이름"]}` : "",
      row["외출할 곳"] ? `외출할 곳: ${row["외출할 곳"]}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    summary: summary || title,
    category: row["외출목적"] ? "Operations / Leave Notes" : category,
    source: "notion-import",
    type,
  });
}

function parseProjectRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle) {
  const title = row["이름"] || row.title || row.name;
  if (!title) return;

  bundle.projects.push({
    notionSourceId: stableSourceId(fileIdentity, title),
    title,
    description: row["산출물 링크"] || undefined,
    status: normalizeProjectStatus(row["상태"]),
    category: row["대분류"] || undefined,
    brainEnergy: normalizeBrainEnergy(row["뇌 에너지 소모"]),
    targetDate: normalizeDate(row["작업기간"]),
    priority: normalizePriority(row["중요도"]),
    kind: /영역|area/i.test(row["대분류"] || "") ? "area" : "project",
  });
}

function parsePeopleRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle) {
  const name = row["이름"] || row.name || row.title;
  if (!name) return;

  bundle.people.push({
    notionSourceId: stableSourceId(fileIdentity, name),
    name,
    birthDate: normalizeDate(row["생일"]),
    groups: splitList(row["그룹"]),
    address: row["주소"] || undefined,
    lastContactedAt: normalizeDate(row["마지막 연락일"]),
    status: row["상태"] || undefined,
    isFavorite: normalizeBoolean(row["즐겨찾기 1"]),
    coreValue: row["핵심 가치"] || undefined,
    bio: row["사건"] || undefined,
  });
}

function parseDailyLogRow(
  fileIdentity: string,
  row: Record<string, string>,
  bundle: NotionImportBundle,
  source: "life" | "diary" | "meditation",
) {
  const date = normalizeDate(row["날짜"]);
  if (!date) return;

  if (source === "life") {
    bundle.dailyLogs.push({
      notionSourceId: stableSourceId(fileIdentity, date),
      date,
      journal: row["일기"] || undefined,
      meditation: row["묵상"] || row["오늘 묵상"] || undefined,
    });
    return;
  }

  if (source === "diary") {
    bundle.dailyLogs.push({
      notionSourceId: stableSourceId(fileIdentity, `${date}:${row["제목"] || ""}`),
      date,
      journal: row["제목"] || undefined,
      mood: normalizeMood(row["감정"]),
    });
    return;
  }

  bundle.dailyLogs.push({
    notionSourceId: stableSourceId(fileIdentity, `${date}:${row["본문말씀"] || ""}`),
    date,
    meditationVerse: row["본문말씀"] || undefined,
    meditation: row["배경지식"] || undefined,
  });
}

function parseWorkoutRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle) {
  const date = normalizeDate(row["날짜"]);
  if (!date) return;

  bundle.workouts.push({
    notionSourceId: stableSourceId(fileIdentity, `${date}:${row["이름"] || ""}`),
    date,
    categories: splitList(row["운동 종류"]).length ? splitList(row["운동 종류"]) : ["운동"],
    notes: row["이름"] || undefined,
  });
}

function parseGiftRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle) {
  const title = row["품목명"] || row.title || row.name;
  if (!title) return;

  bundle.gifts.push({
    notionSourceId: stableSourceId(fileIdentity, `${title}:${row["사람"] || ""}:${row["날짜"] || ""}`),
    title,
    occurredAt: normalizeDate(row["날짜"]),
    satisfaction: row["만족도"] || undefined,
    cost: normalizeNumber(row["비용"]),
    personName: row["사람"] || undefined,
    options: row["사이즈/옵션"] || undefined,
    reason: row["선물 사유"] || undefined,
    imageUrl: row["이미지"] || undefined,
  });
}

function parseCareerRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle) {
  const organization = row["조직/소속"] || row["이름"] || row.name;
  if (!organization) return;

  const period = row["근무기간"] || "";
  const [start, end] = period.split(/[~-]/).map((value) => normalizeDate(value.trim()));

  bundle.careerEntries.push({
    notionSourceId: stableSourceId(fileIdentity, `${organization}:${period}`),
    organization,
    role: row["이름"] || "기록",
    category: row["카테고리"] || "기타",
    startDate: start || normalizeDate(row["날짜"]) || "2026-01-01",
    endDate: end,
    description: row["설명"] || undefined,
  });
}

function parseMediaRow(fileIdentity: string, row: Record<string, string>, bundle: NotionImportBundle, source: "video" | "game" | "book" | "content") {
  const title = row["이름"] || row.title || row.name;
  if (!title) return;

  const mediaType = source === "game" ? "game" : source === "book" ? "book" : source === "video" ? "video" : "other";
  const status = row["시청상태"] || row["상태"] || undefined;

  bundle.mediaLogs.push({
    notionSourceId: stableSourceId(fileIdentity, `${source}:${title}`),
    title,
    mediaType,
    creator: row["감독/크리에이터"] || row["개발사"] || undefined,
    studio: row["제작사"] || undefined,
    genre: row["장르"] || row["분류"] || undefined,
    rating: normalizeRating(row["평점"] || row["평가"]),
    review: row["리뷰"] || row["한줄평"] || undefined,
    platformOrPublisher: row["플랫폼"] || row["출판사"] || undefined,
    status,
    completedAt: normalizeDate(row["날짜"]),
    playTime: normalizeNumber(row["플레이 타임"]),
    author: row["저자"] || undefined,
    evaluation: row["평가"] || undefined,
  });
}

function parseCsvEntry(filename: string, text: string, bundle: NotionImportBundle) {
  const identity = extractFileIdentity(filename);
  const { headers, rows } = parseCsvRows(text);
  const kind = classifyCsv(headers, filename);

  if (kind === "unknown") {
    bundle.warnings.push(`${filename}: 헤더를 분류하지 못해 건너뛰었습니다.`);
    return;
  }

  for (const row of rows) {
    if (kind === "people") {
      parsePeopleRow(identity.fileIdentity, row, bundle);
      continue;
    }

    if (kind === "projects") {
      parseProjectRow(identity.fileIdentity, row, bundle);
      continue;
    }

    if (kind === "workouts") {
      parseWorkoutRow(identity.fileIdentity, row, bundle);
      continue;
    }

    if (kind === "gifts") {
      parseGiftRow(identity.fileIdentity, row, bundle);
      continue;
    }

    if (kind === "dailyLogs") {
      const source = /일기/.test(filename) ? "diary" : /묵상/.test(filename) ? "meditation" : "life";
      parseDailyLogRow(identity.fileIdentity, row, bundle, source);
      continue;
    }

    if (kind === "career") {
      parseCareerRow(identity.fileIdentity, row, bundle);
      continue;
    }

    if (kind === "media") {
      const source = /게임 로그/.test(filename) ? "game" : /도서 로그/.test(filename) ? "book" : /영상 로그/.test(filename) ? "video" : "content";
      parseMediaRow(identity.fileIdentity, row, bundle, source);
      continue;
    }

    if (kind === "tasks") {
      const title = row["이름"] || row.title || row.name || row["작품"] || row["화면이름"];
      if (!title) continue;
      bundle.tasks.push({
        notionSourceId: stableSourceId(identity.fileIdentity, `${title}:${row["날짜"] || row.date || ""}`),
        title,
        content: row["아이디어 내용"] || row.content || row.notes || row.description,
        status: normalizeStatus(row.status || row["상태"]),
        priority: normalizePriority(row.priority || row["중요도"]),
        kind:
          /write|essay|article|draft|소설|에피소드/i.test(row.kind || row.category || row["작품"] || "")
            ? "writing"
            : /research|study|조사|아이디어|기획/i.test(row.kind || row.category || row["아이디어 내용"] || "")
              ? "research"
              : "development",
        dueAt: normalizeDate(row.due || row.deadline || row.date || row["날짜"]),
      });
      continue;
    }

    parseZettelRow(identity.fileIdentity, row, bundle);
  }
}

async function parseZip(bytes: Uint8Array, bundle: NotionImportBundle) {
  const archive = await JSZip.loadAsync(bytes);
  const files = Object.values(archive.files).filter((entry) => !entry.dir);

  for (const file of files) {
    const filename = file.name;
    if (/\.(md|markdown|txt)$/i.test(filename)) {
      parseMarkdownEntry(filename, await file.async("text"), bundle);
      continue;
    }

    if (/\.csv$/i.test(filename)) {
      parseCsvEntry(filename, await file.async("text"), bundle);
      continue;
    }

    if (/\.json$/i.test(filename)) {
      const raw = sanitizeText(await file.async("text"));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const csvText = [
            Object.keys(parsed[0] as Record<string, unknown>).join(","),
            ...parsed.map((row) =>
              Object.values(row as Record<string, unknown>)
                .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
                .join(","),
            ),
          ].join("\n");
          parseCsvEntry(filename, csvText, bundle);
        }
      } catch {
        bundle.warnings.push(`${filename}: JSON 파싱에 실패했습니다.`);
      }
    }
  }
}

export async function parseNotionImportFile(filename: string, bytes: Uint8Array): Promise<NotionImportBundle> {
  const bundle = emptyBundle();
  const normalizedName = filename.toLowerCase();

  if (normalizedName.endsWith(".zip")) {
    await parseZip(bytes, bundle);
    return bundle;
  }

  const text = new TextDecoder().decode(bytes);
  if (normalizedName.endsWith(".csv")) {
    parseCsvEntry(filename, text, bundle);
    return bundle;
  }

  if (normalizedName.endsWith(".md") || normalizedName.endsWith(".markdown") || normalizedName.endsWith(".txt")) {
    parseMarkdownEntry(filename, text, bundle);
    return bundle;
  }

  bundle.warnings.push(`${filename}: 지원하지 않는 파일 형식입니다. zip, csv, md만 가져올 수 있습니다.`);
  return bundle;
}

export function buildNotionImportPreview(filename: string, bundle: NotionImportBundle) {
  return {
    fileName: filename,
    counts: {
      zettels: bundle.zettels.length,
      tasks: bundle.tasks.length,
      projects: bundle.projects.length,
      people: bundle.people.length,
      gifts: bundle.gifts.length,
      dailyLogs: bundle.dailyLogs.length,
      workouts: bundle.workouts.length,
      careerEntries: bundle.careerEntries.length,
      mediaLogs: bundle.mediaLogs.length,
    },
    samples: {
      zettels: bundle.zettels.slice(0, 5),
      tasks: bundle.tasks.slice(0, 5),
      projects: bundle.projects.slice(0, 5),
      people: bundle.people.slice(0, 5),
      gifts: bundle.gifts.slice(0, 5),
      dailyLogs: bundle.dailyLogs.slice(0, 5),
      workouts: bundle.workouts.slice(0, 5),
      careerEntries: bundle.careerEntries.slice(0, 5),
      mediaLogs: bundle.mediaLogs.slice(0, 5),
    },
    warnings: bundle.warnings,
  };
}
