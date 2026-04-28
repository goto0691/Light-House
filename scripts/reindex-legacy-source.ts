import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import JSZip from "jszip";

type D1Result<T> = { meta?: { changes?: number }; results?: T[]; success?: boolean };
type D1Envelope<T> = { errors?: Array<{ message?: string }>; result?: Array<D1Result<T>>; success?: boolean };
type CsvRow = Record<string, string>;

type MarkdownDoc = {
  archiveIndex: number;
  path: string;
  id: string | null;
  sourceId: string;
  title: string;
  titleKey: string;
  content: string;
  properties: Record<string, string>;
  body: string;
};

type SourceDocumentRecord = {
  id: string;
  sourceId: string;
  sourcePath: string;
  sourceDatabase: string;
  title: string;
  documentRole: string;
  status: string;
  rawProperties: Record<string, unknown>;
  rawContent: string | null;
  rawContentPreview: string | null;
  rawContentHash: string | null;
};

type PropertyRecord = {
  id: string;
  sourceDocumentId: string;
  propertyKey: string;
  propertyName: string;
  propertyType: string;
  valueText: string;
  valueJson: string;
  normalizedValue: string | null;
};

type RelationRecord = {
  id: string;
  sourceDocumentId: string;
  relationName: string;
  targetSourceId: string | null;
  targetTitle: string | null;
  confidence: number;
};

const DEFAULT_ZIPS = [
  "migrations/Master DB-from notion.zip",
  "migrations/Pneos' Master Dashboard-from notion.zip",
];

const RELATION_HEADERS = new Set([
  "1. 지식 창고",
  "2. 프로젝트",
  "3. 네트워크",
  "4. 라이프 오퍼레이션",
  "관련인물",
  "관련 인물",
  "묵상 로그",
  "라이프 로그",
  "운동 로그",
  "일기",
  "묵상",
  "배경지식",
  "사건",
  "선물",
  "영상 로그",
  "게임 로그",
  "도서 로그",
  "컨텐츠 로그",
  "에피소드 DB",
  "작품",
  "사람",
]);

const NOISE_DATABASE_PATTERNS = [/^국군수도병원/i, /^외출자 특이사항/i, /^제목 없음/i];

const DATABASE_ROLES: Array<{ pattern: RegExp; role: string }> = [
  { pattern: /^1 지식 창고/, role: "knowledge" },
  { pattern: /^2 프로젝트/, role: "project" },
  { pattern: /^3 네트워크/, role: "person" },
  { pattern: /^라이프 로그/, role: "life-log" },
  { pattern: /^일기/, role: "journal" },
  { pattern: /^묵상/, role: "meditation" },
  { pattern: /^운동 로그/, role: "workout" },
  { pattern: /^영상 로그/, role: "media-video" },
  { pattern: /^게임 로그/, role: "media-game" },
  { pattern: /^도서 로그/, role: "media-book" },
  { pattern: /^컨텐츠 로그/, role: "media-content" },
  { pattern: /^선물/, role: "gift" },
  { pattern: /^커리어&히스토리/, role: "career" },
  { pattern: /^에피소드 DB/, role: "episode" },
];

const args = process.argv.slice(2);
const shouldApply = args.includes("--apply");
const shouldReset = args.includes("--reset");
const csvOnly = args.includes("--csv-only");
const zipPaths = args
  .filter((arg) => arg.startsWith("--zip="))
  .map((arg) => arg.slice("--zip=".length))
  .filter(Boolean);

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.trim().match(/^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/);
      if (!match) continue;
      process.env[match[1]] ??= match[2].replace(/^"|"$/g, "");
    }
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function queryD1<T>(sql: string, params: unknown[] = []) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${requiredEnv("CLOUDFLARE_ACCOUNT_ID")}/d1/database/${requiredEnv("CLOUDFLARE_D1_DATABASE_ID")}/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? requiredEnv("DATABASE_AUTH_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const payload = (await response.json()) as D1Envelope<T>;
  const result = payload.result?.[0];
  if (!response.ok || payload.success === false || result?.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 query failed.");
  }
  return { rows: result?.results ?? [], meta: result?.meta ?? {} };
}

async function execD1(sql: string, params: unknown[] = []) {
  return queryD1(sql, params);
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function hashId(prefix: string, ...parts: string[]) {
  return `${prefix}_${sha1(parts.join("\u001f")).slice(0, 26)}`;
}

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function titleKey(value: string) {
  return compact(value)
    .replace(/[.。]+$/g, "")
    .toLowerCase();
}

function normalizePropertyKey(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || `prop_${sha1(value).slice(0, 12)}`;
}

function normalizeKoreanDate(value: string) {
  const dateTime = value.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2})[:：](\d{1,2}))?/);
  if (dateTime) {
    const year = dateTime[1];
    const month = dateTime[2].padStart(2, "0");
    const day = dateTime[3].padStart(2, "0");
    if (!dateTime[4]) return `${year}-${month}-${day}`;
    let hour = Number(dateTime[5]);
    const minute = dateTime[6].padStart(2, "0");
    if (dateTime[4] === "오후" && hour < 12) hour += 12;
    if (dateTime[4] === "오전" && hour === 12) hour = 0;
    return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${minute}:00+09:00`;
  }

  const isoDate = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return isoDate?.[0] ?? null;
}

function inferPropertyType(name: string, value: string) {
  if (RELATION_HEADERS.has(name) || /\([^)]+[0-9a-f]{32}\.md\)/i.test(value)) return "relation";
  if (/url|링크/i.test(name) || /^https?:\/\//i.test(value)) return "url";
  if (/날짜|생일|일시|기간|연락일/i.test(name) || normalizeKoreanDate(value)) return "date";
  if (/^(yes|no|true|false)$/i.test(value)) return "boolean";
  if (/^-?\d+(?:\.\d+)?$/.test(value.replace(/,/g, ""))) return "number";
  if (value.includes(",") && value.length < 240) return "multi_select";
  return "text";
}

function normalizedValue(type: string, value: string) {
  if (type === "date") return normalizeKoreanDate(value) ?? value.slice(0, 256);
  if (type === "number") return value.replace(/,/g, "");
  if (type === "boolean") return /^(yes|true)$/i.test(value) ? "true" : "false";
  return compact(value).toLowerCase().slice(0, 256) || null;
}

function sanitizeLegacyText(value: string) {
  return value.replace(
    /https?:\/\/(?:www\.)?notion\.so\/[^)\s",\]]*?([0-9a-f]{32})(?:\?[^)\s",\]]*)?/gi,
    "page-ref:$1",
  );
}

function sanitizeLegacyValue<T>(value: T): T {
  if (typeof value === "string") return sanitizeLegacyText(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeLegacyValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitizeLegacyValue(nested)]),
    ) as T;
  }
  return value;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((cell) => cell.trim()));
}

function csvDatabaseName(entryName: string) {
  const basename = entryName.split("/").pop() ?? entryName;
  return basename
    .replace(/\.csv$/i, "")
    .replace(/_all$/i, "")
    .replace(/\s+[0-9a-f]{32}$/i, "")
    .trim();
}

function markdownId(entryName: string) {
  return (entryName.match(/([0-9a-f]{32})\.md$/i)?.[1] ?? null)?.toLowerCase() ?? null;
}

function markdownTitle(entryName: string, content: string) {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1];
  if (heading) return compact(heading);
  const basename = entryName.split("/").pop() ?? entryName;
  return basename.replace(/\.md$/i, "").replace(/\s+[0-9a-f]{32}$/i, "").trim();
}

function parseMarkdownProperties(content: string) {
  const properties: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let start = lines.findIndex((line) => line.startsWith("# "));
  start = start === -1 ? 0 : start + 1;

  for (let index = start; index < Math.min(lines.length, start + 30); index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (Object.keys(properties).length > 0) break;
      continue;
    }
    const match = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
    if (!match) {
      if (Object.keys(properties).length > 0) break;
      continue;
    }
    properties[match[1].trim()] = match[2].trim();
  }

  const bodyStart = lines.findIndex((line, index) => index > start && !line.trim());
  return {
    properties,
    body: bodyStart === -1 ? content : lines.slice(bodyStart + 1).join("\n").trim(),
  };
}

function inferRoleFromDatabase(database: string) {
  return DATABASE_ROLES.find((rule) => rule.pattern.test(database))?.role ?? "legacy-document";
}

function inferMarkdownDatabase(doc: MarkdownDoc) {
  const keys = new Set(Object.keys(doc.properties));
  if (keys.has("감정") || doc.properties["태그"]?.includes("일기")) return "일기";
  if (keys.has("본문말씀") || keys.has("오늘 묵상")) return "묵상";
  if (keys.has("시청상태") || keys.has("다시 볼 가치")) return "영상 로그";
  if (keys.has("플레이 타임") || keys.has("개발사")) return "게임 로그";
  if (keys.has("저자") || keys.has("출판사")) return "도서 로그";
  if (keys.has("그룹") || keys.has("생일") || keys.has("핵심 가치")) return "3 네트워크";
  if (keys.has("운동 종류")) return "운동 로그";
  return "1 지식 창고";
}

function shouldSkipDatabase(database: string) {
  return NOISE_DATABASE_PATTERNS.some((pattern) => pattern.test(database));
}

function titleFromRow(database: string, row: CsvRow) {
  return compact(row["이름"] || row["제목"] || row["품목명"] || row["본문말씀"] || row["화면이름"] || row["날짜"] || database);
}

function isEmptyAutoLifeLog(database: string, row: CsvRow) {
  if (!/^라이프 로그/.test(database)) return false;
  const meaningfulKeys = ["묵상", "오늘 묵상", "오늘 운동", "오늘 일기", "운동 로그", "일기"];
  return meaningfulKeys.every((key) => !compact(row[key]));
}

function isEmptyWorkout(database: string, row: CsvRow) {
  if (!/^운동 로그/.test(database)) return false;
  return !compact(row["운동 종류"]) && !compact(row["라이프 로그"]);
}

function splitRelationTargets(value: string) {
  const targets: Array<{ title: string; sourceId: string | null }> = [];
  const linkedPattern = /([^,;\n()]+?)\s*\((?:[^)]*?)([0-9a-f]{32})(?:\.md|\?[^)]*)?\)/gi;
  for (const match of value.matchAll(linkedPattern)) {
    targets.push({ title: compact(match[1]), sourceId: `md:${match[2].toLowerCase()}` });
  }
  if (targets.length) return targets;

  return value
    .split(/[;\n,]/)
    .map((part) => compact(part))
    .filter(Boolean)
    .slice(0, 20)
    .map((title) => ({ title, sourceId: null }));
}

function addProperty(
  properties: PropertyRecord[],
  sourceDocumentId: string,
  name: string,
  value: string,
  sequence: number,
) {
  const cleaned = sanitizeLegacyText(value).trim();
  if (!cleaned) return;
  const type = inferPropertyType(name, cleaned);
  properties.push({
    id: hashId("sdp", sourceDocumentId, name, String(sequence), cleaned),
    sourceDocumentId,
    propertyKey: normalizePropertyKey(name),
    propertyName: name,
    propertyType: type,
    valueText: cleaned,
    valueJson: JSON.stringify(cleaned),
    normalizedValue: normalizedValue(type, cleaned),
  });
}

function addRelations(
  relations: RelationRecord[],
  sourceDocumentId: string,
  name: string,
  value: string,
  sequenceStart: number,
) {
  if (!RELATION_HEADERS.has(name) && !/\([^)]+[0-9a-f]{32}(?:\.md|\?[^)]*)?\)/i.test(value)) return 0;
  let added = 0;
  for (const [index, target] of splitRelationTargets(value).entries()) {
    relations.push({
      id: hashId("sdr", sourceDocumentId, name, String(sequenceStart + index), target.title, target.sourceId ?? ""),
      sourceDocumentId,
      relationName: name,
      targetSourceId: target.sourceId,
      targetTitle: target.title || null,
      confidence: target.sourceId ? 0.86 : 0.62,
    });
    added += 1;
  }
  return added;
}

async function loadArchives() {
  const archives = [];
  for (const [archiveIndex, zipPath] of (zipPaths.length ? zipPaths : DEFAULT_ZIPS).entries()) {
    if (!existsSync(zipPath)) throw new Error(`Archive not found: ${zipPath}`);
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    archives.push({ archiveIndex: archiveIndex + 1, zipPath, zip });
  }
  return archives;
}

async function collectMarkdownDocs(archives: Awaited<ReturnType<typeof loadArchives>>) {
  const markdownDocs: MarkdownDoc[] = [];
  const byTitle = new Map<string, MarkdownDoc[]>();
  const bySourceId = new Map<string, MarkdownDoc>();

  for (const archive of archives) {
    const files = Object.values(archive.zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".md"));
    for (const file of files) {
      const content = (await file.async("string")).trim();
      if (!content || /^#\s*(MASTER DB|PNEOS? MASTER DASHBOARD)/i.test(content)) continue;
      const id = markdownId(file.name);
      const title = markdownTitle(file.name, content);
      const parsed = parseMarkdownProperties(content);
      const doc: MarkdownDoc = {
        archiveIndex: archive.archiveIndex,
        path: `archive-${archive.archiveIndex}/${file.name}`,
        id,
        sourceId: id ? `md:${id}` : `md:${sha1(`${archive.archiveIndex}:${file.name}`).slice(0, 32)}`,
        title,
        titleKey: titleKey(title),
        content,
        properties: parsed.properties,
        body: parsed.body,
      };
      markdownDocs.push(doc);
      bySourceId.set(doc.sourceId, doc);
      byTitle.set(doc.titleKey, [...(byTitle.get(doc.titleKey) ?? []), doc]);
    }
  }

  return { markdownDocs, byTitle, bySourceId };
}

async function buildRecords() {
  const archives = await loadArchives();
  const { markdownDocs, byTitle } = await collectMarkdownDocs(archives);
  const documents: SourceDocumentRecord[] = [];
  const properties: PropertyRecord[] = [];
  const relations: RelationRecord[] = [];
  const matchedMarkdownSourceIds = new Set<string>();
  const seenCsvRows = new Set<string>();
  const stats = {
    archives: archives.length,
    csvRowsSeen: 0,
    csvRowsSkippedNoise: 0,
    csvRowsSkippedAuto: 0,
    csvRowsSkippedDuplicate: 0,
    csvDocuments: 0,
    markdownPagesSeen: markdownDocs.length,
    markdownPagesMatched: 0,
    markdownStandaloneDocuments: 0,
    properties: 0,
    relations: 0,
  };

  for (const archive of archives) {
    const csvFiles = Object.values(archive.zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith("_all.csv"),
    );
    for (const file of csvFiles) {
      const sourceDatabase = csvDatabaseName(file.name);
      const role = inferRoleFromDatabase(sourceDatabase);
      const rows = parseCsv(await file.async("string"));
      const headers = rows[0] ?? [];
      if (!headers.length) continue;

      for (const cells of rows.slice(1)) {
        stats.csvRowsSeen += 1;
        const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
        const title = titleFromRow(sourceDatabase, row);
        if (!title || shouldSkipDatabase(sourceDatabase)) {
          stats.csvRowsSkippedNoise += 1;
          continue;
        }
        if (isEmptyAutoLifeLog(sourceDatabase, row) || isEmptyWorkout(sourceDatabase, row)) {
          stats.csvRowsSkippedAuto += 1;
          continue;
        }

        const rowHash = sha1(`${sourceDatabase}\n${title}\n${JSON.stringify(row)}`);
        if (seenCsvRows.has(rowHash)) {
          stats.csvRowsSkippedDuplicate += 1;
          continue;
        }
        seenCsvRows.add(rowHash);

        const markdownCandidates = byTitle.get(titleKey(title)) ?? [];
        const markdown = markdownCandidates.length === 1 ? markdownCandidates[0] : null;
        if (markdown) {
          matchedMarkdownSourceIds.add(markdown.sourceId);
          stats.markdownPagesMatched += 1;
        }

        const sourceId = `csv:${rowHash.slice(0, 32)}`;
        const documentId = hashId("src", "csv", rowHash);
        const rawContent = markdown?.content ? sanitizeLegacyText(markdown.content) : null;
        documents.push({
          id: documentId,
          sourceId,
          sourcePath: `archive-${archive.archiveIndex}/${file.name}`,
          sourceDatabase,
          title,
          documentRole: role,
          status: "staged",
          rawProperties: sanitizeLegacyValue({
            archive: archive.archiveIndex,
            sourceDatabase,
            row,
            matchedMarkdownSourceId: markdown?.sourceId ?? null,
          }),
          rawContent,
          rawContentPreview: rawContent
            ? rawContent.slice(0, 1200)
            : sanitizeLegacyText(compact(Object.values(row).join(" | "))).slice(0, 1200),
          rawContentHash: rawContent ? sha1(rawContent) : null,
        });
        stats.csvDocuments += 1;

        let propertySequence = 0;
        for (const header of headers) {
          const value = row[header] ?? "";
          addProperty(properties, documentId, header, value, propertySequence);
          propertySequence += 1;
          stats.relations += addRelations(relations, documentId, header, value, propertySequence * 100);
        }
        if (markdown) {
          addProperty(properties, documentId, "본문", markdown.body || markdown.content, propertySequence + 1);
          for (const [key, value] of Object.entries(markdown.properties)) {
            propertySequence += 1;
            addProperty(properties, documentId, `본문.${key}`, value, propertySequence);
          }
        }
      }
    }
  }

  if (!csvOnly) {
    for (const doc of markdownDocs) {
      if (matchedMarkdownSourceIds.has(doc.sourceId)) continue;
      const sourceDatabase = inferMarkdownDatabase(doc);
      if (shouldSkipDatabase(sourceDatabase)) continue;
      const documentId = hashId("src", "md", doc.sourceId);
      const rawContent = sanitizeLegacyText(doc.content);
      documents.push({
        id: documentId,
        sourceId: doc.sourceId,
        sourcePath: doc.path,
        sourceDatabase,
        title: doc.title,
        documentRole: inferRoleFromDatabase(sourceDatabase),
        status: "staged",
        rawProperties: sanitizeLegacyValue({
          archive: doc.archiveIndex,
          markdownSourceId: doc.sourceId,
          markdownProperties: doc.properties,
        }),
        rawContent,
        rawContentPreview: rawContent.slice(0, 1200),
        rawContentHash: sha1(rawContent),
      });
      stats.markdownStandaloneDocuments += 1;
      let propertySequence = 0;
      for (const [key, value] of Object.entries(doc.properties)) {
        addProperty(properties, documentId, key, value, propertySequence);
        propertySequence += 1;
        stats.relations += addRelations(relations, documentId, key, value, propertySequence * 100);
      }
      addProperty(properties, documentId, "본문", doc.body || doc.content, propertySequence + 1);
    }
  }

  const uniqueDocuments = Array.from(new Map(documents.map((document) => [document.id, document])).values());
  const validDocumentIds = new Set(uniqueDocuments.map((document) => document.id));
  const uniqueProperties = Array.from(
    new Map(properties.filter((property) => validDocumentIds.has(property.sourceDocumentId)).map((property) => [property.id, property])).values(),
  );
  const uniqueRelations = Array.from(
    new Map(relations.filter((relation) => validDocumentIds.has(relation.sourceDocumentId)).map((relation) => [relation.id, relation])).values(),
  );

  stats.properties = uniqueProperties.length;
  stats.relations = uniqueRelations.length;
  return { documents: uniqueDocuments, properties: uniqueProperties, relations: uniqueRelations, stats };
}

async function bulkInsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  suffix = "",
  maxParams = 90,
) {
  const chunkSize = Math.max(1, Math.floor(maxParams / columns.length));
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    await execD1(`insert into ${table} (${columns.join(", ")}) values ${placeholders} ${suffix}`, chunk.flat());
  }
}

async function resetLegacySource() {
  const legacyWhere = "source_type in ('legacy_export', 'notion') or import_batch_id like 'legacy-source-reindex:%'";
  const affected = `select id from source_documents where ${legacyWhere}`;
  await execD1(`delete from migration_review_items where source_document_id in (${affected})`);
  await execD1(`delete from entity_links where source_document_id in (${affected})`);
  await execD1(`delete from source_document_relations where source_document_id in (${affected})`);
  await execD1(`delete from source_document_properties where source_document_id in (${affected})`);
  await execD1(`delete from source_documents where ${legacyWhere}`);
}

async function applyRecords(records: Awaited<ReturnType<typeof buildRecords>>) {
  loadEnv();
  const user = (await queryD1<{ id: string }>("select id from users order by created_at asc limit 1")).rows[0];
  if (!user) throw new Error("No user found.");
  if (shouldReset) await resetLegacySource();

  const importBatchId = `legacy-source-reindex:${new Date().toISOString()}`;
  await bulkInsert(
    "source_documents",
    [
      "id",
      "user_id",
      "source_type",
      "source_id",
      "import_batch_id",
      "source_database",
      "source_path",
      "title",
      "document_role",
      "status",
      "raw_properties",
      "raw_content",
      "raw_content_preview",
      "raw_content_hash",
      "resolved_at",
    ],
    records.documents.map((doc) => [
      doc.id,
      user.id,
      "legacy_export",
      doc.sourceId,
      importBatchId,
      doc.sourceDatabase,
      doc.sourcePath,
      doc.title,
      doc.documentRole,
      doc.status,
      JSON.stringify(doc.rawProperties),
      doc.rawContent,
      doc.rawContentPreview,
      doc.rawContentHash,
      null,
    ]),
    `on conflict(id) do update set
      user_id = excluded.user_id,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      import_batch_id = excluded.import_batch_id,
      source_database = excluded.source_database,
      source_path = excluded.source_path,
      title = excluded.title,
      document_role = excluded.document_role,
      status = excluded.status,
      raw_properties = excluded.raw_properties,
      raw_content = excluded.raw_content,
      raw_content_preview = excluded.raw_content_preview,
      raw_content_hash = excluded.raw_content_hash,
      deleted_at = null,
      updated_at = datetime('now')`,
  );

  await bulkInsert(
    "source_document_properties",
    ["id", "source_document_id", "property_key", "property_name", "property_type", "value_text", "value_json", "normalized_value"],
    records.properties.map((property) => [
      property.id,
      property.sourceDocumentId,
      property.propertyKey,
      property.propertyName,
      property.propertyType,
      property.valueText,
      property.valueJson,
      property.normalizedValue,
    ]),
    `on conflict(id) do update set
      source_document_id = excluded.source_document_id,
      property_key = excluded.property_key,
      property_name = excluded.property_name,
      property_type = excluded.property_type,
      value_text = excluded.value_text,
      value_json = excluded.value_json,
      normalized_value = excluded.normalized_value`,
    48,
  );

  await bulkInsert(
    "source_document_relations",
    ["id", "source_document_id", "relation_name", "target_source_id", "target_title", "confidence"],
    records.relations.map((relation) => [
      relation.id,
      relation.sourceDocumentId,
      relation.relationName,
      relation.targetSourceId,
      relation.targetTitle,
      relation.confidence,
    ]),
    `on conflict(id) do update set
      source_document_id = excluded.source_document_id,
      relation_name = excluded.relation_name,
      target_source_id = excluded.target_source_id,
      target_title = excluded.target_title,
      confidence = excluded.confidence`,
  );

  return { importBatchId, userId: user.id };
}

async function main() {
  const records = await buildRecords();
  const summary: Record<string, unknown> = {
    mode: shouldApply ? "apply" : "dry-run",
    reset: shouldReset,
    csvOnly,
    ...records.stats,
    sourceDocuments: records.documents.length,
    sourceDocumentProperties: records.properties.length,
    sourceDocumentRelations: records.relations.length,
    byDatabase: records.documents.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.sourceDatabase] = (acc[doc.sourceDatabase] ?? 0) + 1;
      return acc;
    }, {}),
  };

  if (shouldApply) {
    summary.applied = await applyRecords(records);
  }

  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
