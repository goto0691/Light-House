import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { notionDateOnly, notionDateToIso, notionRecordBody, type NotionExport, type NotionPage } from "@/lib/v2/import/notion-export";
import { isPlaceholderName, NOTION_DATABASES, NOTION_PERSON_DATABASES, notionEntityPredicate, notionFieldValue, notionLinkPredicate, splitNotionList } from "@/lib/v2/import/notion-mapping";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { createOwnerStructureTemplates } from "@/lib/v2/templates/owner-structure-templates";

export type NotionImportStats = {
  pages: number; created: number; replayed: number;
  values: number; valuesKept: number; typeConflicts: number;
  entityLinks: number; pageLinks: number; personLinks: number; mirroredLinks: number; unresolvedLinks: number;
  byDatabase: Record<string, number>; dated: number; borrowed: number; undated: number; listFields: number; placeholders: number; templates: string[];
};

type Imported = Readonly<{ page: NotionPage; database: string; objectId: string; sourceItemId: string }>;

/** The record's own date (Notion 날짜/생성 일시), or the import time for undated rows. */
export function notionCapturedAt(page: NotionPage, fallback: string) {
  const dated = page.properties.find((property) => (property.name === "날짜" || property.name === "생성 일시") && !property.links.length);
  return (dated && notionDateToIso(dated.value)) ?? fallback;
}

/**
 * Bring the owner's Notion databases into V2 as the owner's own records (D-115/D-119):
 * one record per page with the page's text, the database as its type, short
 * properties as fields, named people/companies/platforms as connected entities,
 * and relation properties as links between records. Nothing is sent to an AI
 * provider (AI analysis is off for these records). Each database then gets one
 * input guide draft from the fields the owner filled most. Re-running is idempotent.
 */
export async function importNotionExport(db: D1DatabaseBinding, userId: string, exported: NotionExport, options: Readonly<{ now: string; databases?: readonly string[] }>) {
  const allowed = new Set((options.databases ?? Object.keys(NOTION_DATABASES)).filter((name) => name in NOTION_DATABASES));
  const captures = new D1SourceFoundationRepository(db, userId);
  const knowledge = new D1ImportedKnowledgeRepository(db, userId);
  const stats: NotionImportStats = { pages: 0, created: 0, replayed: 0, values: 0, valuesKept: 0, typeConflicts: 0, entityLinks: 0, pageLinks: 0, personLinks: 0, mirroredLinks: 0, unresolvedLinks: 0, byDatabase: {}, dated: 0, borrowed: 0, undated: 0, listFields: 0, placeholders: 0, templates: [] };
  const imported = new Map<string, Imported>();
  const pages = [...exported.pages.values()].filter((page) => page.database && allowed.has(page.database))
    .sort((left, right) => left.database!.localeCompare(right.database!) || left.pageId.localeCompare(right.pageId));

  for (const page of pages) {
    const database = page.database!;
    const mapping = NOTION_DATABASES[database]!;
    const body = notionRecordBody(page) || page.title;
    if (!body.trim()) continue;
    const draftId = `notion:${page.pageId}`;
    const capture = await prepareCaptureCommit({
      draftId, channel: "import", title: page.title || null, bodyMarkdown: body, aiEnabled: false,
      clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: notionCapturedAt(page, options.now),
    }, draftId, options.now);
    const receipt = await captures.commitCapture(capture);
    const record = await captures.getRecord(receipt.recordId);
    const sourceItemId = record?.sources.find((source) => source.kind === "text")?.id ?? null;
    if (receipt.disposition === "committed") stats.created += 1; else stats.replayed += 1;
    stats.pages += 1;
    stats.byDatabase[database] = (stats.byDatabase[database] ?? 0) + 1;
    imported.set(page.pageId, { page, database, objectId: receipt.recordId, sourceItemId: sourceItemId ?? "" });

    await knowledge.assignType(receipt.recordId, mapping.type, options.now);
    for (const property of page.properties) {
      const field = mapping.fields[property.name];
      if (!field || property.links.length) continue;
      const provenance = sourceItemId ? { sourceItemId, property: property.name } : null;
      const value = notionFieldValue(field, property.value, notionDateOnly);
      if (value) {
        const outcome = await knowledge.setValue(receipt.recordId, field, value, provenance, options.now);
        if (outcome === "created") stats.values += 1;
        else if (outcome === "kept_existing") stats.valuesKept += 1;
        else if (outcome === "type_conflict") stats.typeConflicts += 1;
      }
      if (!field.entityKind) continue;
      for (const name of splitNotionList(property.value)) {
        if (isPlaceholderName(name)) continue;
        const entity = await knowledge.ensureEntity(field.entityKind, name, options.now);
        if (await knowledge.addRelation({ subjectObjectId: receipt.recordId, objectObjectId: entity, predicate: notionEntityPredicate(field), provenance: provenance ?? undefined, now: options.now }) === "created") stats.entityLinks += 1;
      }
    }
  }

  // Notion mirrors a relation on both pages: one link per pair keeps the view clean.
  const pairs = new Set<string>();
  for (const record of imported.values()) {
    for (const property of record.page.properties) {
      for (const link of property.links) {
        const target = exported.pages.get(link.pageId);
        const provenance = record.sourceItemId ? { sourceItemId: record.sourceItemId, property: property.name } : undefined;
        if (target && NOTION_PERSON_DATABASES.has(target.database ?? "")) {
          const person = await knowledge.ensureEntity("person", target.title || link.title, options.now);
          if (await knowledge.addRelation({ subjectObjectId: record.objectId, objectObjectId: person, predicate: notionLinkPredicate(property.name), provenance, now: options.now }) === "created") stats.personLinks += 1;
          continue;
        }
        const linked = imported.get(link.pageId);
        if (!linked) { stats.unresolvedLinks += 1; continue; }
        const pair = [record.objectId, linked.objectId].sort().join("|");
        if (pairs.has(pair)) { stats.mirroredLinks += 1; continue; }
        pairs.add(pair);
        if (await knowledge.addRelation({ subjectObjectId: record.objectId, objectObjectId: linked.objectId, predicate: notionLinkPredicate(property.name), provenance, now: options.now }) === "created") stats.pageLinks += 1;
      }
    }
  }
  Object.assign(stats, await finishNotionImport(db, userId, options.now));
  return stats;
}

/**
 * After an import, records the owner has not touched since get their date (D-119):
 * - a page with its own date (Notion 날짜/생성 일시) takes it as its written and
 *   last-changed date, so the library reads as the owner kept it over time;
 * - a page without one takes the earliest date of a dated record it is linked to,
 *   directly or through other undated pages (a work takes its first viewing day);
 * - a page with neither stays undated and shows no date (record-date.ts).
 * An undated page was captured at the import time itself; the capture always keeps
 * the real save time. Then each category gets its input guide draft. Idempotent.
 */
export async function finishNotionImport(db: D1DatabaseBinding, userId: string, now: string) {
  const ownDated = `select d.object_id from v2_documents d join v2_capture_bundles c on c.id=d.capture_id
    where c.user_id=? and c.draft_id like 'notion:%' and d.current_version=1 and d.written_at is null and c.captured_at<>c.committed_at`;
  const own = `(select c.captured_at from v2_documents d join v2_capture_bundles c on c.id=d.capture_id where d.object_id=v2_objects.id)`;
  const pending = await db.prepare(`select count(*) as n from (${ownDated})`).bind(userId).first<{ n: number }>();
  await db.batch([
    db.prepare(`update v2_objects set created_at=min(created_at,${own}),updated_at=${own} where user_id=? and id in (${ownDated})`).bind(userId, userId),
    db.prepare(`update v2_documents set written_at=(select c.captured_at from v2_capture_bundles c where c.id=v2_documents.capture_id)
      where object_id in (${ownDated})`).bind(userId),
  ]);
  const borrowed = await borrowLinkedDates(db, userId);
  const listFields = await upgradeListFields(db, userId, now);
  const placeholders = await retirePlaceholderEntities(db, userId, now);
  return { dated: Number(pending?.n ?? 0), ...borrowed, listFields, placeholders, templates: await createOwnerStructureTemplates(db, userId, { now }) };
}

/**
 * An earlier import made entities out of "정보 없음"-like words. One that only imported links
 * point to is archived with those links; one the owner or the analyzer also used is left alone.
 */
async function retirePlaceholderEntities(db: D1DatabaseBinding, userId: string, now: string) {
  const entities = (await db.prepare(
    `select e.object_id,e.canonical_name from v2_entity_records e join v2_objects o on o.id=e.object_id and o.user_id=? and o.lifecycle_status='active'
     where not exists (select 1 from v2_relation_edges r where r.user_id=o.user_id and (r.object_object_id=o.id or r.subject_object_id=o.id)
       and r.superseded_at is null and r.source_class<>'imported')`,
  ).bind(userId).all<{ object_id: string; canonical_name: string }>()).results.filter((entity) => isPlaceholderName(entity.canonical_name));
  for (const entity of entities) {
    await db.batch([
      db.prepare(`update v2_relation_edges set superseded_at=? where user_id=? and (object_object_id=? or subject_object_id=?) and source_class='imported' and superseded_at is null`)
        .bind(now, userId, entity.object_id, entity.object_id),
      db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where id=? and user_id=? and lifecycle_status='active'`).bind(now, entity.object_id, userId),
    ]);
  }
  return entities.length;
}

/**
 * Fields that hold several values (multi-selects such as 장르) are lists. An earlier
 * import kept them as one comma-joined text; turn those into the same items as a list.
 * Only the owner's own field definitions change, and only their representation.
 */
async function upgradeListFields(db: D1DatabaseBinding, userId: string, now: string) {
  const keys = [...new Set(Object.values(NOTION_DATABASES).flatMap((mapping) => Object.values(mapping.fields)).filter((field) => field.dataType === "ordered_list").map((field) => field.key))];
  const fields = (await db.prepare(
    `select id from v2_field_definitions where user_id=? and origin='imported' and data_type='short_text' and key in (${keys.map(() => "?").join(",")})`,
  ).bind(userId, ...keys).all<{ id: string }>()).results;
  for (const field of fields) {
    const values = (await db.prepare(`select id,value_text from v2_property_values where user_id=? and field_definition_id=? and value_kind='text'`)
      .bind(userId, field.id).all<{ id: string; value_text: string | null }>()).results;
    const statements = values.map((value) => {
      const items = splitNotionList(value.value_text ?? "");
      return db.prepare(`update v2_property_values set value_kind='json',value_text=?,value_json=? where id=? and user_id=? and value_kind='text'`)
        .bind(items.join(", "), JSON.stringify(items), value.id, userId);
    });
    statements.push(db.prepare(`update v2_field_definitions set data_type='ordered_list',updated_at=? where id=? and user_id=? and data_type='short_text'`).bind(now, field.id, userId));
    for (let index = 0; index < statements.length; index += 100) await db.batch(statements.slice(index, index + 100));
  }
  return fields.length;
}

const BORROW_DEPTH = 3;

async function borrowLinkedDates(db: D1DatabaseBinding, userId: string) {
  const documents = (await db.prepare(
    `select o.id,d.written_at,c.committed_at,
       case when c.draft_id like 'notion:%' and d.current_version=1 and c.captured_at=c.committed_at then 1 else 0 end as undated
     from v2_objects o join v2_documents d on d.object_id=o.id join v2_capture_bundles c on c.id=d.capture_id and c.user_id=o.user_id
     where o.user_id=? and o.object_kind='document' and o.lifecycle_status='active' and d.privacy_level<>'restricted'`,
  ).bind(userId).all<{ id: string; written_at: string | null; committed_at: string; undated: number }>()).results;
  const byId = new Map(documents.map((document) => [document.id, document]));
  const neighbours = new Map<string, string[]>();
  const edges = (await db.prepare(
    `select subject_object_id as a,object_object_id as b from v2_relation_edges where user_id=? and review_status='accepted' and superseded_at is null`,
  ).bind(userId).all<{ a: string; b: string }>()).results;
  for (const { a, b } of edges) {
    if (!byId.has(a) || !byId.has(b) || a === b) continue; // record-to-record links only, never through a shared person or platform
    neighbours.set(a, [...neighbours.get(a) ?? [], b]);
    neighbours.set(b, [...neighbours.get(b) ?? [], a]);
  }
  const target = (start: string) => {
    let earliest: string | null = null;
    const seen = new Set([start]);
    let frontier = [start];
    for (let depth = 0; depth < BORROW_DEPTH && frontier.length; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) for (const other of neighbours.get(id) ?? []) {
        if (seen.has(other)) continue;
        seen.add(other);
        const document = byId.get(other)!;
        if (document.undated) next.push(other);
        else if (document.written_at && (!earliest || document.written_at < earliest)) earliest = document.written_at;
      }
      frontier = next;
    }
    return earliest;
  };
  const changes = documents.filter((document) => document.undated).map((document) => ({ document, date: target(document.id) }));
  const statements = changes.filter(({ document, date }) => document.written_at !== date).flatMap(({ document, date }) => [
    db.prepare(`update v2_objects set created_at=min(created_at,coalesce(?,created_at)),updated_at=? where id=? and user_id=?`).bind(date, date ?? document.committed_at, document.id, userId),
    db.prepare(`update v2_documents set written_at=? where object_id=?`).bind(date, document.id),
  ]);
  for (let index = 0; index < statements.length; index += 100) await db.batch(statements.slice(index, index + 100));
  return { borrowed: changes.filter(({ date }) => date).length, undated: changes.filter(({ date }) => !date).length };
}
