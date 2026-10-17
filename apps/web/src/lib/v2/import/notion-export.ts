import { createHash } from "node:crypto";

import JSZip from "jszip";

/** One Notion relation target inside a property value: `Title (Encoded%20Title%20<id>.md)`. */
export type NotionLink = Readonly<{ title: string; pageId: string }>;
export type NotionProperty = Readonly<{ name: string; value: string; links: readonly NotionLink[] }>;
export type NotionPage = Readonly<{
  pageId: string;
  title: string;
  database: string | null;
  properties: readonly NotionProperty[];
  body: string;
}>;
export type NotionDatabase = Readonly<{ name: string; columns: readonly string[]; rowTitles: ReadonlySet<string> }>;
export type NotionExport = Readonly<{ sha256: string; databases: ReadonlyMap<string, NotionDatabase>; pages: ReadonlyMap<string, NotionPage> }>;

const PAGE_FILE = /([0-9a-f]{32})\.md$/;
const DATABASE_FILE = /^(?:.*\/)?(.+?) ([0-9a-f]{32})_all\.csv$/;
const LINK = /\(([^()]*?)([0-9a-f]{32})\.md\)/g;
const PROPERTY_LINE = /^([^:#>\-*\s][^:]{0,40}?):\s(.*)$/;

/** RFC 4180 CSV with quoted fields and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") { field += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export function parseLinks(value: string): NotionLink[] {
  const links: NotionLink[] = [];
  for (const match of value.matchAll(LINK)) {
    let title = match[1] ?? "";
    try { title = decodeURIComponent(title); } catch { /* keep the raw path text */ }
    links.push({ title: title.trim(), pageId: match[2]! });
  }
  return links;
}

/** `# Title`, then the first `Key: value` block, then the free body. */
export function parsePage(pageId: string, markdown: string): Omit<NotionPage, "database"> {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  const title = (lines[0] ?? "").replace(/^#\s+/, "").trim();
  let index = 1;
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  const properties: NotionProperty[] = [];
  while (index < lines.length) {
    const match = PROPERTY_LINE.exec(lines[index]!);
    if (!match) break;
    properties.push({ name: match[1]!.trim(), value: match[2]!.trim(), links: parseLinks(match[2]!) });
    index += 1;
  }
  return { pageId, title, properties, body: lines.slice(index).join("\n").trim() };
}

/** A page belongs to the database whose columns cover all its properties; the row title breaks ties. */
export function detectDatabase(page: Omit<NotionPage, "database">, databases: ReadonlyMap<string, NotionDatabase>): string | null {
  const keys = page.properties.map((property) => property.name);
  const candidates = [...databases.values()].filter((database) => keys.every((key) => database.columns.includes(key)));
  if (!candidates.length) return null;
  candidates.sort((left, right) => Number(right.rowTitles.has(page.title)) - Number(left.rowTitles.has(page.title)) || left.columns.length - right.columns.length);
  return candidates[0]!.name;
}

export async function readNotionExport(bytes: Buffer): Promise<NotionExport> {
  const zip = await JSZip.loadAsync(bytes);
  const databases = new Map<string, NotionDatabase>();
  const seen = new Set<string>();
  for (const file of Object.values(zip.files)) {
    const match = DATABASE_FILE.exec(file.name);
    if (file.dir || !match || seen.has(match[2]!)) continue;
    seen.add(match[2]!);
    const rows = parseCsv((await file.async("string")).replace(/^﻿/, ""));
    const columns = rows[0] ?? [];
    if (!columns.length || databases.has(match[1]!)) continue;
    databases.set(match[1]!, { name: match[1]!, columns, rowTitles: new Set(rows.slice(1).map((row) => (row[0] ?? "").trim())) });
  }
  const pages = new Map<string, NotionPage>();
  for (const file of Object.values(zip.files)) {
    const match = PAGE_FILE.exec(file.name);
    if (file.dir || !match) continue;
    const page = parsePage(match[1]!, await file.async("string"));
    pages.set(page.pageId, { ...page, database: detectDatabase(page, databases) });
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), databases, pages };
}

/** "2022년 12월 3일", optionally "오후 11:52", optionally a "→ end" range: the start, as UTC ISO. */
export function notionDateToIso(value: string): string | null {
  const match = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!match[4]) return new Date(Date.UTC(year, month - 1, day, 12)).toISOString(); // 21:00 KST: unambiguous local day
  let hour = Number(match[5]) % 12;
  if (match[4] === "오후") hour += 12;
  return new Date(Date.UTC(year, month - 1, day, hour - 9, Number(match[6]))).toISOString();
}

export function notionDateOnly(value: string): string | null {
  const match = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(value);
  return match ? `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}` : null;
}

/**
 * The record body as the owner wrote it: the non-relation property lines, then the
 * free text. Relation properties become links instead, so other people's names and
 * page references never enter the body (or any provider text). Body links keep only
 * their visible text.
 */
export function notionRecordBody(page: NotionPage): string {
  const kept = page.properties.filter((property) => !property.links.length).map((property) => `${property.name}: ${property.value}`);
  const body = page.body.replace(/\[([^\]]*)\]\([^)]*?\.md\)/g, "$1").replace(LINK, "");
  return [kept.join("\n"), body].filter((part) => part.trim()).join("\n\n");
}

/** The page as analysis input: its title heading followed by the record body. */
export function analysisMarkdown(page: NotionPage): string {
  return [`# ${page.title}`, notionRecordBody(page)].filter((part) => part.trim()).join("\n\n");
}
