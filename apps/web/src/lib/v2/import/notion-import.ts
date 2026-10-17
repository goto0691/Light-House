import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { notionDateOnly, notionDateToIso, notionRecordBody, type NotionExport, type NotionPage } from "@/lib/v2/import/notion-export";
import { NOTION_DATABASES, NOTION_PERSON_DATABASES, notionEntityPredicate, notionFieldValue, notionLinkPredicate, splitNotionList } from "@/lib/v2/import/notion-mapping";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { createOwnerStructureTemplates } from "@/lib/v2/templates/owner-structure-templates";

export type NotionImportStats = {
  pages: number; created: number; replayed: number;
  values: number; valuesKept: number; typeConflicts: number;
  entityLinks: number; pageLinks: number; personLinks: number; mirroredLinks: number; unresolvedLinks: number;
  byDatabase: Record<string, number>; dated: number; templates: string[];
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
  const stats: NotionImportStats = { pages: 0, created: 0, replayed: 0, values: 0, valuesKept: 0, typeConflicts: 0, entityLinks: 0, pageLinks: 0, personLinks: 0, mirroredLinks: 0, unresolvedLinks: 0, byDatabase: {}, dated: 0, templates: [] };
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
 * After an import: each record the owner has not touched since takes its own date
 * (Notion 날짜/생성 일시) as its written and last-changed date, so the library reads
 * as the owner kept it over time rather than as one batch; the capture keeps the
 * real save time. Then each category gets its input guide draft. Idempotent.
 */
export async function finishNotionImport(db: D1DatabaseBinding, userId: string, now: string) {
  const untouched = `select d.object_id from v2_documents d join v2_capture_bundles c on c.id=d.capture_id
    where c.user_id=? and c.draft_id like 'notion:%' and d.current_version=1 and d.written_at is null`;
  const own = `(select c.captured_at from v2_documents d join v2_capture_bundles c on c.id=d.capture_id where d.object_id=v2_objects.id)`;
  const pending = await db.prepare(`select count(*) as n from (${untouched})`).bind(userId).first<{ n: number }>();
  await db.batch([
    db.prepare(`update v2_objects set created_at=min(created_at,${own}),updated_at=${own} where user_id=? and id in (${untouched})`).bind(userId, userId),
    db.prepare(`update v2_documents set written_at=(select c.captured_at from v2_capture_bundles c where c.id=v2_documents.capture_id)
      where object_id in (${untouched})`).bind(userId),
  ]);
  return { dated: Number(pending?.n ?? 0), templates: await createOwnerStructureTemplates(db, userId, { now }) };
}
