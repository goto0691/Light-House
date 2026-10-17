import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import { getPlatformProxy } from "wrangler";

import type { V2StructuredModelGateway } from "@/lib/v2/ai/gateway";
import { createMainAnalyzerGateway } from "@/lib/v2/ai/main-analyzer-gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { readConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { queryPlanFromSearchParams } from "@/lib/v2/retrieval/search-params";
import { observeAnalysisPatternWithRetry } from "@/lib/v2/templates/analysis-pattern-retry";

import { notionValueMatches, percentile, ratio, scoredProperty, type AiFieldValue } from "./metrics";
import { analysisMarkdown, readNotionExport, type NotionExport } from "./notion-export";
import { APPROVED_SCOPE, DATABASE_TYPES, PERSON_DATABASES, assertScope, capturedAt, relationPredicate, selectScope, type NotionLoopScope, type ScopeEntry } from "./scope";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRIVATE_DIR = `${ROOT}.private/notion-eval/`;
const SCOPE_FILE = `${PRIVATE_DIR}scope.json`;
const USER = "notion-eval-owner";
/** Undated rows are all "imported" on one fixed local day, so runs stay comparable. */
const IMPORT_DAY = "2026-10-17T03:00:00.000Z";
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;

class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { return (this.statement.get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.statement.all(...this.values) as T[] }; }
  async run() { return this.statement.run(...this.values); }
}

class MemoryD1 implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  constructor() {
    this.sql.exec(`pragma foreign_keys=on; create table users(id text primary key); insert into users values ('${USER}');`);
    const directory = `${ROOT}migrations`;
    for (const name of readdirSync(directory).filter((file) => /^\d{4}_v2_.*\.sql$/.test(file) && Number(file.slice(0, 4)) >= 6).sort()) this.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
  }
  prepare(query: string) { return new Statement(this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.sql.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sql.exec("commit");
      return results as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}

type Args = { command: "prepare" | "run"; set: "smoke" | "standard"; live: boolean; zip: string };
function parseArgs(argv: readonly string[]): Args {
  const command = argv[0] === "prepare" ? "prepare" : argv[0] === "run" ? "run" : null;
  const value = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const set = value("--set") ?? "smoke";
  const live = argv.includes("--live");
  if (!command || (set !== "smoke" && set !== "standard") || (command === "run" && live === argv.includes("--dry-run"))) {
    throw new Error("usage: prepare | run --set smoke|standard --dry-run|--live [--zip path]");
  }
  return { command, set, live, zip: value("--zip") ?? `${ROOT}migrations/Master DB-from notion.zip` };
}

type ImportedRecord = Readonly<{ pageId: string; database: string; title: string; objectId: string; captureId: string; sourceItemId: string }>;

async function importRecords(db: MemoryD1, exported: NotionExport, entries: readonly ScopeEntry[], now: string) {
  const captures = new D1SourceFoundationRepository(db, USER);
  const imported = new D1ImportedKnowledgeRepository(db, USER);
  const records: ImportedRecord[] = [];
  for (const entry of entries) {
    const page = exported.pages.get(entry.pageId)!;
    const capture = await prepareCaptureCommit({
      draftId: `notion-loop:${page.pageId}`, channel: "import", title: page.title || "제목 없음", bodyMarkdown: analysisMarkdown(page),
      aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: capturedAt(page, IMPORT_DAY),
    }, `notion-loop:${page.pageId}`, now);
    await captures.commitCapture(capture);
    await imported.assignType(capture.objectId, DATABASE_TYPES[entry.database]!, now);
    records.push({ pageId: page.pageId, database: entry.database, title: page.title, objectId: capture.objectId, captureId: capture.captureId, sourceItemId: capture.sources[0]!.id });
  }
  // Notion relations are mirrored on both pages; one owner link per pair keeps the view clean.
  const byPage = new Map(records.map((record) => [record.pageId, record]));
  const stats = { notionLinks: 0, docEdges: 0, personEdges: 0, mirroredSkipped: 0, outsideSample: 0, excludedDatabase: 0, missingPage: 0 };
  const expected = new Map<string, Map<string, string>>(); // focus -> neighbor -> expected group label
  const expect = (focus: string, neighbor: string, label: string) => { const map = expected.get(focus) ?? new Map(); map.set(neighbor, label); expected.set(focus, map); };
  const pairs = new Set<string>();
  for (const record of records) {
    const page = exported.pages.get(record.pageId)!;
    for (const property of page.properties) {
      for (const link of property.links) {
        stats.notionLinks += 1;
        const target = exported.pages.get(link.pageId);
        const provenance = { sourceItemId: record.sourceItemId, property: property.name };
        if (target && PERSON_DATABASES.has(target.database ?? "")) {
          const person = await imported.ensureEntity("person", target.title || link.title, now);
          if (await imported.addRelation({ subjectObjectId: record.objectId, objectObjectId: person, predicate: relationPredicate(property.name), provenance, now }) === "created") stats.personEdges += 1;
          expect(record.objectId, person, "사람");
          expect(person, record.objectId, DATABASE_TYPES[record.database]!.label);
          continue;
        }
        const linked = byPage.get(link.pageId);
        if (!linked) {
          if (!target) stats.missingPage += 1;
          else if (target.database && target.database in DATABASE_TYPES) stats.outsideSample += 1;
          else stats.excludedDatabase += 1;
          continue;
        }
        const pair = [record.objectId, linked.objectId].sort().join("|");
        if (pairs.has(pair)) { stats.mirroredSkipped += 1; continue; }
        pairs.add(pair);
        await imported.addRelation({ subjectObjectId: record.objectId, objectObjectId: linked.objectId, predicate: relationPredicate(property.name), provenance, now });
        stats.docEdges += 1;
        expect(record.objectId, linked.objectId, DATABASE_TYPES[linked.database]!.label);
        expect(linked.objectId, record.objectId, DATABASE_TYPES[record.database]!.label);
      }
    }
  }
  return { records, stats, expected };
}

async function analyze(db: MemoryD1, total: number) {
  loadEnvConfig(`${ROOT}apps/web`, true);
  const platform = await getPlatformProxy<{ DB: D1DatabaseBinding }>({ configPath: `${ROOT}wrangler.toml`, persist: { path: `${ROOT}apps/web/.wrangler/state/v3` } });
  try {
    const credential = await platform.env.DB.prepare("select status from v2_ai_provider_credentials where provider='openai_plan' limit 1").first<{ status: string }>();
    if (credential?.status !== "active") throw new Error("plan_not_connected");
    // Plan only: without GEMINI_API_KEY a plan outage fails instead of sending private rows to Gemini.
    const plan = await createMainAnalyzerGateway(platform.env.DB, { V2_AI_CREDENTIAL_KEY: process.env.V2_AI_CREDENTIAL_KEY, OPENAI_PLAN_MODEL: process.env.OPENAI_PLAN_MODEL });
    if (!plan) throw new Error("plan_not_configured");
    let calls = 0;
    const seen = new Set<string>();
    const gateway: V2StructuredModelGateway = {
      async generate<T>(request: Parameters<V2StructuredModelGateway["generate"]>[0]) {
        if (calls >= total || seen.has(request.inputHash)) throw new Error("notion_loop_budget_exhausted");
        calls += 1;
        seen.add(request.inputHash);
        return plan.generate<T>(request);
      },
    };
    const queue = new D1ProcessingQueueRepository(db);
    // The product dispatches at most 50 outbox rows per call; refill whenever the queue runs dry.
    await queue.dispatchPending(50);
    const observations = new Map<string, string>();
    let consecutive = 0;
    let aborted = false;
    for (let done = 0; ; done += 1) {
      const before = calls;
      const result = await runNextAnalysisJob({
        queue, gateway, workerId: "notion-loop",
        observePattern: async (job, runId, now) => { const outcome = await observeAnalysisPatternWithRetry(db, { job, runId, now }); observations.set(job.objectId, outcome); return outcome; },
      });
      if (result.outcome === "idle") {
        if (await queue.dispatchPending(50) > 0) { done -= 1; continue; }
        break;
      }
      console.log(`[analysis ${done + 1}/${total}] ${result.outcome}`);
      if (result.outcome === "succeeded") consecutive = 0;
      else if (calls > before) consecutive += 1;
      if (consecutive >= MAX_CONSECUTIVE_PROVIDER_FAILURES) { aborted = true; break; }
    }
    const undispatched = (await db.prepare("select count(*) as n from v2_processing_outbox where status='pending'").first<{ n: number }>())?.n ?? 0;
    return { providerCalls: calls, aborted, undispatched, observations };
  } finally { await platform.dispose(); }
}

type Row = Record<string, unknown>;
async function measure(db: MemoryD1, exported: NotionExport, records: readonly ImportedRecord[], relationStats: Row, expected: Map<string, Map<string, string>>, analysis: Awaited<ReturnType<typeof analyze>> | null) {
  const perRecord = [];
  const latencies: number[] = [];
  const fieldTotals = new Map<string, { scored: number; matched: number; keys: Record<string, number> }>();
  const typeStats = new Map<string, { records: number; aiTypes: Record<string, number>; reusedImported: number }>();
  const reviewCounts: number[] = [];
  const reviewKinds: Record<string, number> = {};
  let scored = 0;
  let matched = 0;
  for (const record of records) {
    const run = await db.prepare(`select r.status,r.model_id,r.latency_ms,r.validation_error_code from v2_processing_jobs j join v2_processing_runs r on r.job_id=j.id
      where j.capture_id=? and j.stage='analyze' order by r.created_at desc limit 1`).bind(record.captureId).first<{ status: string; model_id: string; latency_ms: number | null; validation_error_code: string | null }>();
    if (run?.status === "succeeded" && run.latency_ms) latencies.push(run.latency_ms);
    const proposal = await db.prepare(`select p.proposal_json from v2_analysis_proposals p join v2_processing_jobs j on j.id=p.job_id where j.capture_id=? and p.status='validated' order by p.created_at desc limit 1`)
      .bind(record.captureId).first<{ proposal_json: string }>();
    const envelope = proposal ? JSON.parse(proposal.proposal_json) as { document_proposals?: { type_assignments?: { type_key: string; registry_action: string }[] }[] } : null;
    const aiTypes = (envelope?.document_proposals ?? []).flatMap((document) => document.type_assignments ?? []);
    const importedKey = DATABASE_TYPES[record.database]!.key;
    const types = typeStats.get(record.database) ?? { records: 0, aiTypes: {}, reusedImported: 0 };
    typeStats.set(record.database, types);
    types.records += 1;
    for (const type of aiTypes) types.aiTypes[type.type_key] = (types.aiTypes[type.type_key] ?? 0) + 1;
    if (aiTypes.some((type) => type.type_key === importedKey)) types.reusedImported += 1;

    const fields = (await db.prepare(`select f.key,p.value_kind as kind,p.value_text as text,p.value_number as number,p.value_boolean as boolean,p.value_date as date,p.value_json as json,
        p.review_status,p.claim_risk from v2_property_values p join v2_field_definitions f on f.id=p.field_definition_id
      where p.owner_object_id=? and p.user_id=? and p.processing_run_id is not null and p.superseded_at is null`).bind(record.objectId, USER).all<AiFieldValue & { review_status: string; claim_risk: string }>()).results;
    const page = exported.pages.get(record.pageId)!;
    const propertyResults = [];
    for (const property of page.properties) {
      if (!scoredProperty(property.name, property.value, property.links.length > 0)) continue;
      const hit = fields.find((field) => notionValueMatches(property.value, field));
      const total = fieldTotals.get(`${record.database}/${property.name}`) ?? { scored: 0, matched: 0, keys: {} };
      fieldTotals.set(`${record.database}/${property.name}`, total);
      if (run?.status !== "succeeded") continue;
      scored += 1; total.scored += 1;
      if (hit) { matched += 1; total.matched += 1; total.keys[hit.key] = (total.keys[hit.key] ?? 0) + 1; }
      propertyResults.push({ property: property.name, matchedKey: hit?.key ?? null });
    }
    const reviews = (await db.prepare(`select kind,count(*) as n from v2_review_items where object_id=? and user_id=? and status='open' group by kind`).bind(record.objectId, USER).all<{ kind: string; n: number }>()).results;
    if (run) {
      reviewCounts.push(reviews.reduce((sum, row) => sum + row.n, 0));
      for (const row of reviews) reviewKinds[row.kind] = (reviewKinds[row.kind] ?? 0) + row.n;
    }
    perRecord.push({
      pageId: record.pageId, database: record.database, title: record.title, run, aiTypes, pattern: analysis?.observations.get(record.objectId) ?? null,
      fields: fields.map((field) => ({ key: field.key, kind: field.kind, review: field.review_status, risk: field.claim_risk })), propertyResults, reviews,
    });
  }

  const aiEntities = (await db.prepare(`select e.entity_kind as kind,e.canonical_name as name from v2_entity_records e join v2_objects o on o.id=e.object_id
    where o.user_id=? and e.processing_run_id is not null`).bind(USER).all<{ kind: string; name: string }>()).results;
  const importedPersons = (await db.prepare(`select e.canonical_name as name from v2_entity_records e join v2_objects o on o.id=e.object_id
    where o.user_id=? and e.processing_run_id is null and e.entity_kind='person'`).bind(USER).all<{ name: string }>()).results;
  const distinctEntities = new Set(aiEntities.map((entity) => `${entity.kind}|${entity.name.normalize("NFKC").trim().toLowerCase()}`));
  const importedNames = new Set(importedPersons.map((person) => person.name.trim()));

  const templates = (await new D1TemplateRepository(db, USER).list()).map((template) => ({
    status: template.status, origin: template.origin, expectedTypeIds: template.definition.expectedTypeIds,
    items: template.definition.sections.flatMap((section) => section.items.map((item) => item.binding?.fieldKey ?? item.key)),
  }));

  let groupFocus = 0;
  let groupItems = 0;
  let groupCorrect = 0;
  let groupMissing = 0;
  for (const [focus, neighbors] of expected) {
    const groups = await readConnectionGroups(db, USER, focus, { itemsPerGroup: 50 });
    if (!groups) continue;
    groupFocus += 1;
    const placed = new Map(groups.groups.flatMap((group) => group.items.map((item) => [item.objectId, group.label] as const)));
    for (const [neighbor, label] of neighbors) {
      groupItems += 1;
      if (!placed.has(neighbor)) groupMissing += 1;
      else if (placed.get(neighbor) === label) groupCorrect += 1;
    }
  }

  const retrieval = new D1RetrievalRepository(db, USER);
  let top1 = 0;
  let top10 = 0;
  for (const record of records) {
    const page = await retrieval.searchPage(queryPlanFromSearchParams(new URLSearchParams({ q: record.title })));
    const index = page.results.findIndex((result) => result.recordId === record.objectId);
    if (index === 0) top1 += 1;
    if (index >= 0 && index < 10) top10 += 1;
  }

  const importedEdges = (await db.prepare(`select count(*) as n from v2_relation_edges where user_id=? and source_class='imported' and review_status='accepted'`).bind(USER).first<{ n: number }>())?.n ?? 0;
  const aiTypeDefinitions = (await db.prepare(`select count(*) as n from v2_type_definitions where user_id=? and origin='ai_proposed'`).bind(USER).first<{ n: number }>())?.n ?? 0;
  const aiFieldDefinitions = (await db.prepare(`select count(*) as n from v2_field_definitions where user_id=? and origin='ai_proposed'`).bind(USER).first<{ n: number }>())?.n ?? 0;
  const succeeded = perRecord.filter((record) => record.run?.status === "succeeded").length;

  const summary = {
    analysis: analysis ? { records: records.length, providerCalls: analysis.providerCalls, succeeded, failed: records.length - succeeded, aborted: analysis.aborted, undispatched: analysis.undispatched,
      latencyMsP50: percentile(latencies, 0.5), latencyMsP90: percentile(latencies, 0.9) } : null,
    types: analysis ? Object.fromEntries([...typeStats].map(([database, stats]) => [database, {
      records: stats.records, distinctAiTypes: Object.keys(stats.aiTypes).length, reusedImportedRate: ratio(stats.reusedImported, stats.records), aiTypes: stats.aiTypes,
    }])) : null,
    fields: analysis ? { scored, matched, accuracy: ratio(matched, scored), perProperty: Object.fromEntries([...fieldTotals].filter(([, total]) => total.scored).map(([name, total]) => [name, {
      scored: total.scored, matched: total.matched, accuracy: ratio(total.matched, total.scored), distinctKeys: Object.keys(total.keys).length, keys: total.keys,
    }])) } : null,
    templates: analysis ? { generated: templates.filter((template) => template.status === "generated_draft").length, list: templates } : null,
    reviews: analysis ? { perRecordP50: percentile(reviewCounts, 0.5), perRecordP90: percentile(reviewCounts, 0.9), byKind: reviewKinds } : null,
    entities: analysis ? { aiCreated: aiEntities.length, aiDistinct: distinctEntities.size, duplicationRatio: ratio(aiEntities.length, distinctEntities.size),
      importedPersons: importedPersons.length, aiPersonsMatchingImported: aiEntities.filter((entity) => entity.kind === "person" && importedNames.has(entity.name.trim())).length } : null,
    relations: { ...relationStats, importedEdges, preservation: ratio(importedEdges, Number(relationStats.docEdges) + Number(relationStats.personEdges)) },
    grouping: { focusObjects: groupFocus, expectedItems: groupItems, inExpectedGroup: groupCorrect, missing: groupMissing, accuracy: ratio(groupCorrect, groupItems) },
    search: { records: records.length, titleTop1: ratio(top1, records.length), titleTop10: ratio(top10, records.length) },
    registry: analysis ? { aiTypeDefinitions, aiFieldDefinitions } : null,
  };
  return { summary, perRecord };
}

function previousSummary(set: string, live: boolean) {
  const runs = `${PRIVATE_DIR}runs/`;
  if (!existsSync(runs)) return null;
  const prior = readdirSync(runs).filter((name) => name.startsWith(`${set}-${live ? "live" : "dry"}-`)).sort().at(-1);
  return prior ? JSON.parse(readFileSync(`${runs}${prior}/summary.json`, "utf8")) as { summary: Record<string, Record<string, unknown> | null> } : null;
}

function headline(summary: Awaited<ReturnType<typeof measure>>["summary"]) {
  return {
    analysisSucceeded: summary.analysis?.succeeded ?? null, fieldAccuracy: summary.fields?.accuracy ?? null, templates: summary.templates?.generated ?? null,
    reviewsP50: summary.reviews?.perRecordP50 ?? null, entityDuplication: summary.entities?.duplicationRatio ?? null, relationPreservation: summary.relations.preservation,
    groupingAccuracy: summary.grouping.accuracy, titleTop10: summary.search.titleTop10, aiTypeDefinitions: summary.registry?.aiTypeDefinitions ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exported = await readNotionExport(readFileSync(args.zip));
  mkdirSync(PRIVATE_DIR, { recursive: true });
  if (args.command === "prepare") {
    const scope = selectScope(exported);
    assertScope(scope, exported);
    if (existsSync(SCOPE_FILE)) {
      const current = JSON.parse(readFileSync(SCOPE_FILE, "utf8")) as NotionLoopScope;
      if (JSON.stringify(current.sets) !== JSON.stringify(scope.sets)) throw new Error("scope_exists_with_different_selection");
    } else writeFileSync(SCOPE_FILE, `${JSON.stringify(scope, null, 2)}\n`, "utf8");
    const count = (entries: readonly ScopeEntry[]) => Object.fromEntries([...new Set(entries.map((entry) => entry.database))].map((database) => [database, entries.filter((entry) => entry.database === database).length]));
    console.log(JSON.stringify({ scope: SCOPE_FILE.replace(ROOT, ""), smoke: count(scope.sets.smoke), standard: count(scope.sets.standard) }, null, 2));
    return;
  }
  const scope = JSON.parse(readFileSync(SCOPE_FILE, "utf8")) as NotionLoopScope;
  assertScope(scope, exported);
  if (scope.provider !== APPROVED_SCOPE.provider) throw new Error("scope_provider_mismatch");
  const entries = scope.sets[args.set];
  const startedAt = new Date().toISOString();
  const db = new MemoryD1();
  try {
    const { records, stats, expected } = await importRecords(db, exported, entries, startedAt);
    const analysis = args.live ? await analyze(db, records.length) : null;
    const { summary, perRecord } = await measure(db, exported, records, stats, expected, analysis);
    const directory = `${PRIVATE_DIR}runs/${args.set}-${args.live ? "live" : "dry"}-${startedAt.replace(/[:.]/g, "-")}/`;
    const previous = previousSummary(args.set, args.live);
    mkdirSync(directory, { recursive: true });
    const meta = { set: args.set, mode: args.live ? "live" : "dry-run", startedAt, finishedAt: new Date().toISOString(), scopeSha256: scope.sourceSha256, records: records.length };
    writeFileSync(`${directory}summary.json`, `${JSON.stringify({ meta, summary }, null, 2)}\n`, "utf8");
    writeFileSync(`${directory}records.json`, `${JSON.stringify(perRecord, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ meta, headline: headline(summary), previousHeadline: previous ? headline(previous.summary as never) : null, summary }, null, 2));
  } finally { db.sql.close(); }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ scope: "notion-loop", failed: true, code: error instanceof Error && /^[a-z0-9_ :|.-]+$/i.test(error.message) ? error.message : "unexpected", errorClass: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
});
