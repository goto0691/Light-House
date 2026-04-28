import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type D1Result<T> = { meta?: { changes?: number }; results?: T[]; success?: boolean };
type D1Envelope<T> = { errors?: Array<{ message?: string }>; result?: Array<D1Result<T>>; success?: boolean };

type SourceDocumentRow = {
  id: string;
  sourceId: string;
  title: string;
  rawProperties: string | null;
  canonicalEntityType: string | null;
  canonicalEntityId: string | null;
};

type SourceRelationRow = {
  id: string;
  sourceDocumentId: string;
  relationName: string;
  targetSourceId: string | null;
  targetTitle: string | null;
  confidence: number | null;
};

type ResolvedRelation = {
  relation: SourceRelationRow;
  source: SourceDocumentRow;
  target: SourceDocumentRow;
};

const shouldApply = process.argv.includes("--apply");

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

async function queryAll<T>(sql: string, params: unknown[] = [], pageSize = 1000) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await queryD1<T>(`${sql} limit ${pageSize} offset ${offset}`, params);
    rows.push(...page.rows);
    if (page.rows.length < pageSize) break;
  }
  return rows;
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

function titleKey(value: string | null | undefined) {
  return compact(value)
    .replace(/[.。]+$/g, "")
    .toLowerCase();
}

function parseMatchedMarkdownSourceId(rawProperties: string | null) {
  if (!rawProperties) return null;
  try {
    const parsed = JSON.parse(rawProperties) as { matchedMarkdownSourceId?: unknown; markdownSourceId?: unknown };
    const matched = typeof parsed.matchedMarkdownSourceId === "string" ? parsed.matchedMarkdownSourceId : null;
    const markdown = typeof parsed.markdownSourceId === "string" ? parsed.markdownSourceId : null;
    return matched ?? markdown;
  } catch {
    return null;
  }
}

async function bulkInsert(table: string, columns: string[], rows: unknown[][], suffix = "", maxParams = 90) {
  const chunkSize = Math.max(1, Math.floor(maxParams / columns.length));
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    await execD1(`insert ${suffix.includes("or ignore") ? "or ignore " : ""}into ${table} (${columns.join(", ")}) values ${placeholders}`, chunk.flat());
  }
}

async function resolveSourceRelations(rows: ResolvedRelation[]) {
  for (let index = 0; index < rows.length; index += 15) {
    const chunk = rows.slice(index, index + 15);
    await execD1(
      `update source_document_relations
       set resolved_entity_type = case ${chunk.map(() => "when id = ? then ?").join(" ")} else resolved_entity_type end,
           resolved_entity_id = case ${chunk.map(() => "when id = ? then ?").join(" ")} else resolved_entity_id end
       where id in (${chunk.map(() => "?").join(", ")})`,
      [
        ...chunk.flatMap((item) => [item.relation.id, item.target.canonicalEntityType]),
        ...chunk.flatMap((item) => [item.relation.id, item.target.canonicalEntityId]),
        ...chunk.map((item) => item.relation.id),
      ],
    );
  }
}

function addUnique(rows: unknown[][], seen: Set<string>, key: string, row: unknown[]) {
  if (seen.has(key)) return false;
  seen.add(key);
  rows.push(row);
  return true;
}

function relationContext(relation: SourceRelationRow) {
  return relation.relationName;
}

async function main() {
  loadEnv();
  const user = (await queryD1<{ id: string }>("select id from users order by created_at asc limit 1")).rows[0];
  if (!user) throw new Error("No user found.");

  const [documents, relations] = await Promise.all([
    queryAll<SourceDocumentRow>(
      `select id, source_id as sourceId, title, raw_properties as rawProperties,
              canonical_entity_type as canonicalEntityType, canonical_entity_id as canonicalEntityId
       from source_documents
       where user_id = ? and source_type = 'legacy_export' and deleted_at is null`,
      [user.id],
      2000,
    ),
    queryAll<SourceRelationRow>(
      `select id, source_document_id as sourceDocumentId, relation_name as relationName,
              target_source_id as targetSourceId, target_title as targetTitle, confidence
       from source_document_relations
       order by created_at asc`,
      [],
      2000,
    ),
  ]);

  const byId = new Map(documents.map((document) => [document.id, document]));
  const bySourceId = new Map<string, SourceDocumentRow>();
  const titleBuckets = new Map<string, SourceDocumentRow[]>();
  for (const document of documents) {
    bySourceId.set(document.sourceId, document);
    const matched = parseMatchedMarkdownSourceId(document.rawProperties);
    if (matched) bySourceId.set(matched, document);
    const key = titleKey(document.title);
    if (key) titleBuckets.set(key, [...(titleBuckets.get(key) ?? []), document]);
  }

  const resolved: ResolvedRelation[] = [];
  const unresolved: SourceRelationRow[] = [];
  for (const relation of relations) {
    const source = byId.get(relation.sourceDocumentId);
    if (!source?.canonicalEntityType || !source.canonicalEntityId || source.canonicalEntityType === "archive") {
      unresolved.push(relation);
      continue;
    }
    const bySource = relation.targetSourceId ? bySourceId.get(relation.targetSourceId) : undefined;
    const titleMatches = titleBuckets.get(titleKey(relation.targetTitle));
    const byTitle = titleMatches?.length === 1 ? titleMatches[0] : undefined;
    const target = bySource ?? byTitle;
    if (!target?.canonicalEntityType || !target.canonicalEntityId || target.canonicalEntityType === "archive") {
      unresolved.push(relation);
      continue;
    }
    resolved.push({ relation, source, target });
  }

  const now = new Date().toISOString();
  const mediaPeopleRows: unknown[][] = [];
  const zettelPeopleRows: unknown[][] = [];
  const zettelMediaRows: unknown[][] = [];
  const dailyLogPeopleRows: unknown[][] = [];
  const dailyEntryPeopleRows: unknown[][] = [];
  const projectPeopleRows: unknown[][] = [];
  const projectZettelRows: unknown[][] = [];
  const entityLinkRows: unknown[][] = [];
  const seen = new Set<string>();

  for (const item of resolved) {
    const sourceType = item.source.canonicalEntityType!;
    const sourceId = item.source.canonicalEntityId!;
    const targetType = item.target.canonicalEntityType!;
    const targetId = item.target.canonicalEntityId!;
    const context = relationContext(item.relation);
    const confidence = item.relation.confidence ?? 0.78;
    const rawValue = item.relation.targetTitle ?? item.relation.targetSourceId ?? null;

    if (sourceType === "media" && targetType === "person") {
      addUnique(mediaPeopleRows, seen, `mp:${sourceId}:${targetId}`, [sourceId, targetId, context, now, item.relation.sourceDocumentId, confidence, rawValue]);
    } else if (sourceType === "person" && targetType === "media") {
      addUnique(mediaPeopleRows, seen, `mp:${targetId}:${sourceId}`, [targetId, sourceId, context, now, item.relation.sourceDocumentId, confidence, rawValue]);
    } else if (sourceType === "zettel" && targetType === "person") {
      addUnique(zettelPeopleRows, seen, `zp:${sourceId}:${targetId}`, [sourceId, targetId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "person" && targetType === "zettel") {
      addUnique(zettelPeopleRows, seen, `zp:${targetId}:${sourceId}`, [targetId, sourceId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "zettel" && targetType === "media") {
      addUnique(zettelMediaRows, seen, `zm:${sourceId}:${targetId}`, [sourceId, targetId, now, item.relation.sourceDocumentId, confidence, rawValue]);
    } else if (sourceType === "media" && targetType === "zettel") {
      addUnique(zettelMediaRows, seen, `zm:${targetId}:${sourceId}`, [targetId, sourceId, now, item.relation.sourceDocumentId, confidence, rawValue]);
    } else if (sourceType === "daily_log" && targetType === "person") {
      addUnique(dailyLogPeopleRows, seen, `dlp:${sourceId}:${targetId}`, [sourceId, targetId, context, now, item.relation.sourceDocumentId, confidence, rawValue]);
    } else if (sourceType === "person" && targetType === "daily_log") {
      addUnique(dailyLogPeopleRows, seen, `dlp:${targetId}:${sourceId}`, [targetId, sourceId, context, now, item.relation.sourceDocumentId, confidence, rawValue]);
    } else if (sourceType === "daily_entry" && targetType === "person") {
      addUnique(dailyEntryPeopleRows, seen, `dep:${sourceId}:${targetId}`, [sourceId, targetId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "person" && targetType === "daily_entry") {
      addUnique(dailyEntryPeopleRows, seen, `dep:${targetId}:${sourceId}`, [targetId, sourceId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "project" && targetType === "person") {
      addUnique(projectPeopleRows, seen, `pp:${sourceId}:${targetId}`, [sourceId, targetId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "person" && targetType === "project") {
      addUnique(projectPeopleRows, seen, `pp:${targetId}:${sourceId}`, [targetId, sourceId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "project" && targetType === "zettel") {
      addUnique(projectZettelRows, seen, `pz:${sourceId}:${targetId}`, [sourceId, targetId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else if (sourceType === "zettel" && targetType === "project") {
      addUnique(projectZettelRows, seen, `pz:${targetId}:${sourceId}`, [targetId, sourceId, context, item.relation.sourceDocumentId, confidence, rawValue, now]);
    } else {
      const id = hashId("eln", item.relation.id, sourceType, sourceId, targetType, targetId);
      addUnique(entityLinkRows, seen, `el:${id}`, [
        id,
        user.id,
        sourceType,
        sourceId,
        targetType,
        targetId,
        context,
        context,
        item.relation.sourceDocumentId,
        confidence,
        rawValue,
        now,
      ]);
    }
  }

  const summary = {
    mode: shouldApply ? "apply" : "dry-run",
    sourceRelations: relations.length,
    resolvedRelations: resolved.length,
    unresolvedRelations: unresolved.length,
    mediaPeople: mediaPeopleRows.length,
    zettelPeople: zettelPeopleRows.length,
    zettelMedia: zettelMediaRows.length,
    dailyLogPeople: dailyLogPeopleRows.length,
    dailyEntryPeople: dailyEntryPeopleRows.length,
    projectPeople: projectPeopleRows.length,
    projectZettel: projectZettelRows.length,
    entityLinks: entityLinkRows.length,
  };

  if (shouldApply) {
    const legacySourceWhere = "select id from source_documents where source_type = 'legacy_export'";
    await execD1(`delete from media_people_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from zettel_people_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from zettel_media_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from daily_log_people_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from daily_entry_people_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from project_people_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from project_zettel_relations where source_document_id in (${legacySourceWhere})`);
    await execD1(`delete from entity_links where source_document_id in (${legacySourceWhere})`);

    await bulkInsert("media_people_relations", ["media_id", "person_id", "context", "created_at", "source_document_id", "confidence", "raw_value"], mediaPeopleRows);
    await bulkInsert("zettel_people_relations", ["zettel_id", "person_id", "context", "source_document_id", "confidence", "raw_value", "created_at"], zettelPeopleRows, "or ignore");
    await bulkInsert("zettel_media_relations", ["zettel_id", "media_id", "created_at", "source_document_id", "confidence", "raw_value"], zettelMediaRows);
    await bulkInsert("daily_log_people_relations", ["daily_log_id", "person_id", "context", "created_at", "source_document_id", "confidence", "raw_value"], dailyLogPeopleRows);
    await bulkInsert("daily_entry_people_relations", ["daily_entry_id", "person_id", "context", "source_document_id", "confidence", "raw_value", "created_at"], dailyEntryPeopleRows, "or ignore");
    await bulkInsert("project_people_relations", ["project_id", "person_id", "role_context", "source_document_id", "confidence", "raw_value", "created_at"], projectPeopleRows, "or ignore");
    await bulkInsert("project_zettel_relations", ["project_id", "zettel_id", "context", "source_document_id", "confidence", "raw_value", "created_at"], projectZettelRows, "or ignore");
    await bulkInsert(
      "entity_links",
      ["id", "user_id", "source_type", "source_id", "target_type", "target_id", "relation_type", "context", "source_document_id", "confidence", "raw_value", "created_at"],
      entityLinkRows,
      "or ignore",
    );
    await resolveSourceRelations(resolved);
  }

  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
