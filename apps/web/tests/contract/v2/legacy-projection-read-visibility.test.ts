import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import type { GroundedResultEnvelopeV1 } from "@/lib/v2/ai/grounded-result-v1";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1RediscoveryRepository } from "@/lib/v2/infrastructure/d1/rediscovery-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { SYSTEM_TEMPLATE_SEEDS } from "@/lib/v2/templates/system-template-seeds";
import { TEMPLATE_REGISTRY_SNAPSHOT_VERSION } from "@/lib/v2/templates/template-definition-v1";

type TestD1 = D1DatabaseBinding & {
  exec(query: string): Promise<unknown>;
  prepare(query: string): D1PreparedStatementBinding;
};

type MappingStatus = "source_only" | "knowledge_pending" | "superseded" | "quarantined" | "projected";
type SeededRecord = Awaited<ReturnType<typeof prepareCaptureCommit>> & { key: string; mappingStatus: MappingStatus | null };

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationNames = [
  "0006_v2_source_and_document_foundation.sql",
  "0007_v2_document_authoring.sql",
  "0008_v2_ai_processing.sql",
  "0009_v2_grounded_enrichment.sql",
  "0010_v2_ai_runtime_governor.sql",
  "0011_v2_adaptive_knowledge.sql",
  "0012_v2_review_actions.sql",
  "0013_v2_entities_relations_and_presentation.sql",
  "0014_v2_retrieval_and_saved_views.sql",
  "0015_v2_adaptive_capture_templates.sql",
  "0016_v2_opt_in_rediscovery.sql",
  "0017_v2_portability_restore_and_legacy_migration.sql",
  "0018_v2_legacy_migration_hardening.sql",
  "0029_v2_provider_invocation_lease.sql",
] as const;

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;
let db: TestD1;

async function applyMigration(name: string) {
  const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
  const sql = await readFile(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function seedRecord(key: string, index: number, mappingStatus: MappingStatus | null): Promise<SeededRecord> {
  const committedAt = `2026-06-01T09:00:${String(index).padStart(2, "0")}.000Z`;
  const prepared = await prepareCaptureCommit({
    draftId: `visibility-${key}`,
    channel: "import",
    title: `가시성 ${key}`,
    bodyMarkdown: `# ${key}\n\n레거시 투영 가시성 계약 본문`,
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel: "normal",
    capturedAt: "2026-06-01T09:00:00.000Z",
  }, `visibility-${key}`, committedAt);
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(prepared);
  if (mappingStatus) {
    await db.prepare(
      `insert into v2_legacy_source_envelopes
       (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
       values (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `envelope-${key}`,
      "user-a",
      "legacy_notes",
      `legacy-${key}`,
      JSON.stringify({ key }),
      `row-hash-${key}`,
      committedAt,
      "legacy-schema:test",
      "[]",
      "visibility-fixture",
    ).run();
    await db.prepare(
      `insert into v2_legacy_source_mappings
       (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `mapping-${key}`,
      "user-a",
      `envelope-${key}`,
      "legacy_notes",
      `legacy-${key}`,
      "visibility-adapter-v1",
      prepared.sources[0]?.id ?? null,
      prepared.objectId,
      "document",
      mappingStatus,
      "active",
      committedAt,
    ).run();
  }
  return { ...prepared, key, mappingStatus };
}

async function enablePatternConsent(records: readonly SeededRecord[]) {
  for (const record of records) {
    await db.prepare("update v2_capture_bundles set ai_enabled=1 where id=? and user_id='user-a'").bind(record.captureId).run();
  }
}

function sortedRecordIds(rows: readonly { recordId: string }[]) {
  return rows.map((row) => row.recordId).sort();
}

function beforeNextBatch(before: () => Promise<unknown>): D1DatabaseBinding {
  let pending = true;
  return {
    prepare(query: string) {
      return db.prepare(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatementBinding[]) {
      if (pending) {
        pending = false;
        await before();
      }
      return db.batch<T>(statements);
    },
  };
}

function beforeBatchOrdinal(ordinal: number, before: () => Promise<unknown>): D1DatabaseBinding {
  let batchCount = 0;
  return {
    prepare(query: string) {
      return db.prepare(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatementBinding[]) {
      batchCount += 1;
      if (batchCount === ordinal) await before();
      return db.batch<T>(statements);
    },
  };
}

function failNextBatchAfterStatement(afterStatement: number, onBatch: (statementCount: number) => void): D1DatabaseBinding {
  let pending = true;
  return {
    prepare(query: string) {
      return db.prepare(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatementBinding[]) {
      if (!pending) return db.batch<T>(statements);
      pending = false;
      onBatch(statements.length);
      if (afterStatement < 1 || afterStatement >= statements.length) throw new Error("The injected batch failure must split the batch.");
      const failure = db.prepare("insert into v2_missing_template_publication_failure (id) values ('forced')");
      return db.batch<T>([
        ...statements.slice(0, afterStatement),
        failure,
        ...statements.slice(afterStatement),
      ]);
    },
  };
}

async function addMapping(input: { key: string; objectId: string; sourceItemId?: string | null; status: MappingStatus }) {
  await db.prepare(
    `insert into v2_legacy_source_envelopes
     (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
     values (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `envelope-${input.key}`, "user-a", "legacy_notes", `legacy-${input.key}`, "{}", `row-hash-${input.key}`,
    "2026-08-29T11:00:00.000Z", "legacy-schema:test", "[]", "visibility-fixture",
  ).run();
  await db.prepare(
    `insert into v2_legacy_source_mappings
     (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,created_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `mapping-${input.key}`, "user-a", `envelope-${input.key}`, "legacy_notes", `legacy-${input.key}`,
    "visibility-adapter-v1", input.sourceItemId ?? null, input.objectId, "document", input.status, "active", "2026-08-29T11:00:00.000Z",
  ).run();
}

async function queueAnalysis(record: SeededRecord, suffix: string) {
  await db.prepare(
    `insert into v2_processing_outbox (id,user_id,capture_id,event_type,payload_json,status,created_at)
     values (?,'user-a',?,'analyze',?,'pending','2026-08-29T11:10:00.000Z')`,
  ).bind(`outbox-${suffix}`, record.captureId, JSON.stringify({ captureId: record.captureId })).run();
}

function emptyEnvelope(record: SeededRecord): AnalysisEnvelopeV1 {
  return {
    contract_version: "analysis-v1",
    capture_id: record.captureId,
    analyzed_revision_id: record.revisionId,
    language: "ko",
    bundle_summary: "visibility fence",
    document_proposals: [],
    entity_proposals: [],
    event_proposals: [],
    field_proposals: [],
    enrichment_requests: [],
    review_items: [],
    warnings: [],
  };
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec("create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');");
  for (const name of migrationNames) await applyMigration(name);
}, 30_000);

afterAll(async () => platform.dispose());

describe("legacy projection visibility boundary", () => {
  test("fails closed across direct, list, search, review, rediscovery, receipt, relation, trash, and restore surfaces", async () => {
    const definitions: readonly [string, MappingStatus | null][] = [
      ["source-only", "source_only"],
      ["knowledge-pending", "knowledge_pending"],
      ["superseded", "superseded"],
      ["quarantined", "quarantined"],
      ["projected", "projected"],
      ["mixed", "projected"],
      ["native", null],
    ];
    const records = await Promise.all(definitions.map(([key, status], index) => seedRecord(key, index, status)));
    const mixed = records.find((record) => record.key === "mixed");
    const projected = records.find((record) => record.key === "projected");
    const sourceOnly = records.find((record) => record.key === "source-only");
    const native = records.find((record) => record.mappingStatus === null);
    if (!mixed || !projected || !sourceOnly || !native) throw new Error("Expected mixed, projected, source-only, and native fixtures.");
    await db.prepare(
      `insert into v2_legacy_source_envelopes
       (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
       values ('envelope-mixed-hidden','user-a','legacy_notes','legacy-mixed-hidden','{}','row-hash-mixed-hidden','2026-06-01T09:01:00.000Z','legacy-schema:test','[]','visibility-fixture')`,
    ).run();
    await db.prepare(
      `insert into v2_legacy_source_mappings
       (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,created_at)
       values ('mapping-mixed-hidden','user-a','envelope-mixed-hidden','legacy_notes','legacy-mixed-hidden','visibility-adapter-v1',?,?,'document','source_only','active','2026-06-01T09:01:00.000Z')`,
    ).bind(mixed.sources[0]?.id ?? null, mixed.objectId).run();
    // A different user's non-projected mapping must not affect this owner's
    // native object, even if a corrupt cross-owner foreign key points at it.
    await db.prepare(
      `insert into v2_legacy_source_envelopes
       (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
       values ('envelope-other-user','user-b','legacy_notes','legacy-other-user','{}','row-hash-other-user','2026-06-01T09:02:00.000Z','legacy-schema:test','[]','visibility-fixture')`,
    ).run();
    await db.prepare(
      `insert into v2_legacy_source_mappings
       (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,created_at)
       values ('mapping-other-user','user-b','envelope-other-user','legacy_notes','legacy-other-user','visibility-adapter-v1',null,?,'document','source_only','active','2026-06-01T09:02:00.000Z')`,
    ).bind(native.objectId).run();
    const hidden = records.filter((record) => record.mappingStatus && record.mappingStatus !== "projected").concat(mixed);
    const visibleIds = [projected.objectId, native.objectId].sort();

    await db.prepare(
      `insert into v2_type_definitions
       (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
       values ('visibility-type','user-a','visibility_record','가시성 기록','document','active','imported','가시성 경계 테스트',1,0,0,'2026-06-01T10:00:00.000Z','2026-06-01T10:00:00.000Z')`,
    ).run();
    for (const [index, record] of records.entries()) {
      await db.prepare(
        `insert into v2_object_type_assignments
         (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
         values (?, 'user-a',?,'visibility-type','primary','import','accepted',0,'2026-06-01T10:00:00.000Z','2026-06-01T10:00:00.000Z')`,
      ).bind(`visibility-assignment-${index}`, record.objectId).run();
      await db.prepare(
        `insert into v2_review_items (id,user_id,object_id,kind,status,payload_json,created_at)
         values (?, 'user-a',?,'analysis_review','open','{}','2026-06-01T10:00:00.000Z')`,
      ).bind(`visibility-review-${index}`, record.objectId).run();
    }

    await db.prepare(
      `insert into v2_predicate_definitions
       (id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at)
       values ('visibility-predicate','user-a','references_record','참조','가시성 연결','active','imported',1,'2026-06-01T10:00:00.000Z','2026-06-01T10:00:00.000Z')`,
    ).run();
    await db.prepare(
      `insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at)
       values (?,'person','숨겨진연결대상','resolved','2026-06-01T10:00:00.000Z')`,
    ).bind(sourceOnly.objectId).run();
    for (const [index, target] of records.filter((record) => record.objectId !== native.objectId).entries()) {
      await db.prepare(
        `insert into v2_relation_edges
         (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,locked_by_user,created_at)
         values (?, 'user-a',?,'visibility-predicate',?,'imported','low','accepted',0,'2026-06-01T10:00:00.000Z')`,
      ).bind(`visibility-relation-${index}`, native.objectId, target.objectId).run();
    }

    const source = new D1SourceFoundationRepository(db, "user-a");
    for (const record of hidden) {
      await expect(source.getRecord(record.objectId)).resolves.toBeNull();
      await expect(source.getReceipt(record.captureId)).resolves.toBeNull();
    }
    await expect(source.getRecord(projected.objectId)).resolves.toMatchObject({ recordId: projected.objectId });
    await expect(source.getRecord(native.objectId)).resolves.toMatchObject({ recordId: native.objectId });
    await expect(source.getReceipt(projected.captureId)).resolves.toMatchObject({ recordId: projected.objectId });
    await expect(source.getReceipt(native.captureId)).resolves.toMatchObject({ recordId: native.objectId });

    const library = await new D1DocumentAuthoringRepository(db, "user-a").listRecords();
    expect(sortedRecordIds(library)).toEqual(visibleIds);

    const retrieval = new D1RetrievalRepository(db, "user-a");
    expect(sortedRecordIds(await retrieval.search(defaultV2QueryPlan()))).toEqual(visibleIds);
    await expect(retrieval.search(defaultV2QueryPlan({ fullText: "숨겨진연결대상" }))).resolves.toEqual([]);
    await expect(retrieval.search(defaultV2QueryPlan({ entityFilters: [{ targetObjectId: sourceOnly.objectId }] }))).resolves.toEqual([]);
    await expect(retrieval.listEntityFacets()).resolves.not.toContainEqual(expect.objectContaining({ objectId: sourceOnly.objectId }));
    await expect(retrieval.listTypeFacets()).resolves.toEqual([{ key: "visibility_record", label: "가시성 기록", count: 2 }]);
    await expect(retrieval.listTimelineFacets()).resolves.toEqual([{ month: "2026-06", count: 2 }]);

    const reviewRecords = await new D1ReviewRepository(db, "user-a").listOpenRecords();
    expect(sortedRecordIds(reviewRecords)).toEqual(visibleIds);

    const rediscovery = new D1RediscoveryRepository(db, "user-a");
    const now = new Date("2026-08-29T10:00:00.000Z");
    await rediscovery.updatePreference({ enabled: true, includeSensitive: false }, now.toISOString());
    expect(sortedRecordIds(await rediscovery.deck(now, 10))).toEqual(visibleIds);
    for (const record of hidden) {
      await expect(rediscovery.recordEvent(record.objectId, "opened", now.toISOString())).rejects.toMatchObject({ code: "rediscovery_event_invalid" });
    }

    const presentation = await new D1PresentationRepository(db, "user-a").project(native.objectId);
    expect(presentation.connections.map((connection) => connection.targetObjectId)).toEqual([projected.objectId]);

    for (const [index, record] of hidden.entries()) {
      await expect(source.trashRecord(record.objectId, {
        auditEventId: `hidden-trash-${index}`,
        deletedAt: "2026-08-29T10:05:00.000Z",
        purgeAfter: "2026-11-27T10:05:00.000Z",
      })).resolves.toBeNull();
      await expect(source.restoreRecord(record.objectId, {
        auditEventId: `hidden-restore-${index}`,
        restoredAt: "2026-08-29T10:06:00.000Z",
      })).resolves.toBeNull();
    }
    const hiddenLifecycle = await db.prepare(
      `select o.id,o.lifecycle_status from v2_objects o
       where o.id in (${hidden.map(() => "?").join(",")}) order by o.id`,
    ).bind(...hidden.map((record) => record.objectId)).all<{ id: string; lifecycle_status: string }>();
    expect(hiddenLifecycle.results.every((row) => row.lifecycle_status === "active")).toBe(true);

    const trashRace = new D1SourceFoundationRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='source_only' where id='mapping-projected'",
    ).run()), "user-a");
    await expect(trashRace.trashRecord(projected.objectId, {
      auditEventId: "race-trash-must-not-commit",
      deletedAt: "2026-08-29T10:06:10.000Z",
      purgeAfter: "2026-11-27T10:06:10.000Z",
    })).resolves.toBeNull();
    await expect(db.prepare("select lifecycle_status from v2_objects where id=?").bind(projected.objectId).first()).resolves.toEqual({ lifecycle_status: "active" });
    await expect(db.prepare("select count(*) as value from v2_deletion_tombstones where object_id=?").bind(projected.objectId).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_audit_events where id='race-trash-must-not-commit'").first()).resolves.toEqual({ value: 0 });

    await db.prepare("update v2_legacy_source_mappings set status='projected' where id='mapping-projected'").run();
    await db.prepare("update v2_objects set lifecycle_status='deleted',deleted_at='2026-08-29T10:06:20.000Z' where id=?").bind(projected.objectId).run();
    await db.prepare(
      `insert into v2_deletion_tombstones (object_id,user_id,deleted_at,purge_after,reason)
       values (?,'user-a','2026-08-29T10:06:20.000Z','2026-11-27T10:06:20.000Z','user_request')`,
    ).bind(projected.objectId).run();
    const restoreRace = new D1SourceFoundationRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='superseded' where id='mapping-projected'",
    ).run()), "user-a");
    await expect(restoreRace.restoreRecord(projected.objectId, {
      auditEventId: "race-restore-must-not-commit",
      restoredAt: "2026-08-29T10:06:30.000Z",
    })).resolves.toBeNull();
    await expect(db.prepare("select lifecycle_status from v2_objects where id=?").bind(projected.objectId).first()).resolves.toEqual({ lifecycle_status: "deleted" });
    await expect(db.prepare("select restored_at from v2_deletion_tombstones where object_id=?").bind(projected.objectId).first()).resolves.toEqual({ restored_at: null });
    await expect(db.prepare("select count(*) as value from v2_audit_events where id='race-restore-must-not-commit'").first()).resolves.toEqual({ value: 0 });
    await db.prepare("delete from v2_deletion_tombstones where object_id=?").bind(projected.objectId).run();
    await db.prepare("update v2_objects set lifecycle_status='active',deleted_at=null where id=?").bind(projected.objectId).run();
    await db.prepare("update v2_legacy_source_mappings set status='projected' where id='mapping-projected'").run();

    for (const [index, record] of [projected, native].entries()) {
      await expect(source.trashRecord(record.objectId, {
        auditEventId: `visible-trash-${index}`,
        deletedAt: "2026-08-29T10:07:00.000Z",
        purgeAfter: "2026-11-27T10:07:00.000Z",
      })).resolves.toMatchObject({ lifecycleStatus: "deleted", replayed: false });
      await expect(source.restoreRecord(record.objectId, {
        auditEventId: `visible-restore-${index}`,
        restoredAt: "2026-08-29T10:08:00.000Z",
      })).resolves.toMatchObject({ lifecycleStatus: "active", replayed: false });
    }
    await expect(db.prepare("select count(*) as value from v2_deletion_tombstones").first()).resolves.toEqual({ value: 2 });
  }, 30_000);

  test("blocks document mutation, idempotent replay, review resolution, and template learning for hidden or mixed projections", async () => {
    const raceRecord = await seedRecord("mutation-race", 20, "projected");
    const raceEdit = await prepareDocumentRevision({
      expectedVersion: 1,
      expectedRevisionId: raceRecord.revisionId,
      title: "숨겨지면 저장하지 않음",
      bodyMarkdown: `${raceRecord.bodyMarkdown}\n\n매핑 전환과 경합하는 편집`,
      writtenAt: null,
      documentStatus: "revising",
      privacyLevel: "normal",
    }, "visibility-revision-race", "2026-08-29T11:01:00.000Z");
    const racingAuthor = new D1DocumentAuthoringRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='source_only' where id='mapping-mutation-race'",
    ).run()), "user-a");
    await expect(racingAuthor.saveRevision(raceRecord.objectId, raceEdit)).rejects.toMatchObject({ code: "document_not_found" });
    await expect(db.prepare("select count(*) as value from v2_document_revisions where id=?").bind(raceEdit.revisionId).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_idempotency_records where idempotency_key=?").bind(raceEdit.idempotencyKey).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_audit_events where id=?").bind(raceEdit.auditEventId).first()).resolves.toEqual({ value: 0 });

    const replayRecord = await seedRecord("mutation-replay", 21, "projected");
    const replayEdit = await prepareDocumentRevision({
      expectedVersion: 1,
      expectedRevisionId: replayRecord.revisionId,
      title: "한 번만 저장",
      bodyMarkdown: `${replayRecord.bodyMarkdown}\n\n투영 상태에서 저장`,
      writtenAt: null,
      documentStatus: "revising",
      privacyLevel: "normal",
    }, "visibility-revision-replay", "2026-08-29T11:02:00.000Z");
    const author = new D1DocumentAuthoringRepository(db, "user-a");
    await expect(author.saveRevision(replayRecord.objectId, replayEdit)).resolves.toMatchObject({ replayed: false });
    await db.prepare("update v2_legacy_source_mappings set status='quarantined' where id='mapping-mutation-replay'").run();
    await expect(author.saveRevision(replayRecord.objectId, replayEdit)).rejects.toMatchObject({ code: "document_not_found" });

    const mixedRecord = await seedRecord("mutation-mixed", 22, "projected");
    await addMapping({ key: "mutation-mixed-hidden", objectId: mixedRecord.objectId, sourceItemId: mixedRecord.sources[0]?.id, status: "source_only" });
    const mixedEdit = await prepareDocumentRevision({
      expectedVersion: 1,
      expectedRevisionId: mixedRecord.revisionId,
      title: "혼합 매핑",
      bodyMarkdown: `${mixedRecord.bodyMarkdown}\n\n혼합 상태 편집`,
      writtenAt: null,
      documentStatus: "revising",
      privacyLevel: "normal",
    }, "visibility-revision-mixed", "2026-08-29T11:03:00.000Z");
    await expect(author.saveRevision(mixedRecord.objectId, mixedEdit)).rejects.toMatchObject({ code: "document_not_found" });

    const reviewRecord = await seedRecord("review-race", 23, "projected");
    await enablePatternConsent([reviewRecord]);
    await db.prepare(
      `insert into v2_review_items (id,user_id,object_id,kind,status,payload_json,created_at)
       values ('review-race-item','user-a',?,'analysis_review','open','{}','2026-08-29T11:04:00.000Z')`,
    ).bind(reviewRecord.objectId).run();
    const racingReview = new D1ReviewRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='superseded' where id='mapping-review-race'",
    ).run()), "user-a");
    await expect(racingReview.resolve("review-race-item", { action: "dismiss", now: "2026-08-29T11:05:00.000Z" })).rejects.toMatchObject({ code: "review_not_found" });
    await expect(db.prepare("select status from v2_review_items where id='review-race-item'").first()).resolves.toEqual({ status: "open" });
    await expect(db.prepare("select count(*) as value from v2_review_receipts where review_item_id='review-race-item'").first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_audit_events where json_extract(metadata_json,'$.reviewId')='review-race-item'").first()).resolves.toEqual({ value: 0 });
    await db.prepare("update v2_legacy_source_mappings set status='projected' where id='mapping-review-race'").run();
    const reviews = new D1ReviewRepository(db, "user-a");
    await expect(reviews.resolve("review-race-item", { action: "dismiss", now: "2026-08-29T11:06:00.000Z" })).resolves.toMatchObject({ replayed: false });
    await db.prepare("update v2_legacy_source_mappings set status='source_only' where id='mapping-review-race'").run();
    await expect(reviews.resolve("review-race-item", { action: "dismiss" })).rejects.toMatchObject({ code: "review_not_found" });

    const templateResult = await new D1TemplateRepository(db, "user-a").observePattern({
      patternSignature: "visibility.hidden.pattern",
      sourceDocumentId: reviewRecord.objectId,
      sourceRevisionId: reviewRecord.revisionId,
      observedDate: "2026-08-29",
      typeKey: "hidden_record",
      features: { fields: ["secret"] },
      candidateDefinition: SYSTEM_TEMPLATE_SEEDS[0].definition,
    }, "2026-08-29T11:07:00.000Z");
    expect(templateResult).toMatchObject({ generated: false, documents: 0, dates: 0, template: null });
    await expect(db.prepare("select count(*) as value from v2_template_pattern_observations where pattern_signature='visibility.hidden.pattern'").first()).resolves.toEqual({ value: 0 });

    const patternRecords = await Promise.all([
      seedRecord("pattern-race-one", 24, "projected"),
      seedRecord("pattern-race-two", 25, "projected"),
      seedRecord("pattern-race-three", 26, "projected"),
    ]);
    await enablePatternConsent(patternRecords);
    const patternSignature = "visibility.atomic.pattern";
    for (const [index, record] of patternRecords.slice(0, 2).entries()) {
      await new D1TemplateRepository(db, "user-a").observePattern({
        patternSignature,
        sourceDocumentId: record.objectId,
        sourceRevisionId: record.revisionId,
        observedDate: `2026-08-${String(20 + index).padStart(2, "0")}`,
        features: { fields: ["rating"] },
        candidateDefinition: SYSTEM_TEMPLATE_SEEDS[0].definition,
      }, `2026-08-${String(20 + index).padStart(2, "0")}T10:00:00.000Z`);
    }
    const thirdPattern = patternRecords[2];
    const patternRaceRepository = new D1TemplateRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='quarantined' where id='mapping-pattern-race-three'",
    ).run()), "user-a");
    await expect(patternRaceRepository.observePattern({
      patternSignature,
      sourceDocumentId: thirdPattern.objectId,
      sourceRevisionId: thirdPattern.revisionId,
      observedDate: "2026-08-22",
      features: { fields: ["rating"] },
      candidateDefinition: SYSTEM_TEMPLATE_SEEDS[0].definition,
    }, "2026-08-22T10:00:00.000Z")).resolves.toMatchObject({ generated: false, template: null });
    await expect(db.prepare("select count(*) as value from v2_capture_templates where pattern_signature=?").bind(patternSignature).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_template_source_links where source_document_id=?").bind(thirdPattern.objectId).first()).resolves.toEqual({ value: 0 });
  }, 60_000);

  test("rolls back generated template publication when the former between-batches window fails", async () => {
    const patternRecords = await Promise.all([
      seedRecord("pattern-rollback-one", 27, "projected"),
      seedRecord("pattern-rollback-two", 28, "projected"),
      seedRecord("pattern-rollback-three", 29, "projected"),
    ]);
    await enablePatternConsent(patternRecords);
    const patternSignature = "visibility.atomic.rollback.pattern";
    for (const [index, record] of patternRecords.slice(0, 2).entries()) {
      await new D1TemplateRepository(db, "user-a").observePattern({
        patternSignature,
        sourceDocumentId: record.objectId,
        sourceRevisionId: record.revisionId,
        observedDate: `2026-08-${String(24 + index).padStart(2, "0")}`,
        features: { fields: ["rating"] },
        candidateDefinition: SYSTEM_TEMPLATE_SEEDS[0].definition,
        sourceModel: "template-atomic-rollback-model",
        promptVersion: "template-atomic-rollback-v1",
      }, `2026-08-${String(24 + index).padStart(2, "0")}T10:00:00.000Z`);
    }

    let batchCalls = 0;
    let publicationStatementCount = 0;
    const repository = new D1TemplateRepository(failNextBatchAfterStatement(2, (statementCount) => {
      batchCalls += 1;
      publicationStatementCount = statementCount;
    }), "user-a");
    const thirdPattern = patternRecords[2];
    await expect(repository.observePattern({
      patternSignature,
      sourceDocumentId: thirdPattern.objectId,
      sourceRevisionId: thirdPattern.revisionId,
      observedDate: "2026-08-26",
      features: { fields: ["rating"] },
      candidateDefinition: SYSTEM_TEMPLATE_SEEDS[0].definition,
      sourceModel: "template-atomic-rollback-model",
      promptVersion: "template-atomic-rollback-v1",
    }, "2026-08-26T10:00:00.000Z")).rejects.toThrow();

    expect(batchCalls).toBe(1);
    expect(publicationStatementCount).toBeGreaterThanOrEqual(5);
    await expect(db.prepare("select count(*) as value from v2_capture_templates where user_id='user-a' and pattern_signature=?").bind(patternSignature).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_capture_template_versions where source_model='template-atomic-rollback-model'").first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_template_source_links l join v2_capture_template_versions v on v.id=l.template_version_id where v.source_model='template-atomic-rollback-model'").first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select outcome,count(*) as value from v2_template_pattern_observations where user_id='user-a' and pattern_signature=? group by outcome").bind(patternSignature).all()).resolves.toMatchObject({ results: [{ outcome: "observed", value: 3 }] });
  }, 30_000);

  test("returns the fully published winner when another observer wins the same-pattern insert race", async () => {
    const patternRecords = await Promise.all([
      seedRecord("pattern-winner-one", 37, "projected"),
      seedRecord("pattern-winner-two", 38, "projected"),
      seedRecord("pattern-winner-three", 39, "projected"),
    ]);
    await enablePatternConsent(patternRecords);
    const patternSignature = "visibility.atomic.winner.pattern";
    for (const [index, record] of patternRecords.slice(0, 2).entries()) {
      await new D1TemplateRepository(db, "user-a").observePattern({
        patternSignature,
        sourceDocumentId: record.objectId,
        sourceRevisionId: record.revisionId,
        observedDate: `2026-08-${String(27 + index).padStart(2, "0")}`,
        features: { fields: ["rating"] },
        candidateDefinition: SYSTEM_TEMPLATE_SEEDS[1].definition,
      }, `2026-08-${String(27 + index).padStart(2, "0")}T10:00:00.000Z`);
    }

    const winnerTemplateId = "template-pattern-race-winner";
    const winnerVersionId = "version-pattern-race-winner";
    const winnerDefinition = SYSTEM_TEMPLATE_SEEDS[0].definition;
    const winnerNow = "2026-08-29T10:00:00.000Z";
    const racingRepository = new D1TemplateRepository(beforeNextBatch(() => db.batch([
      db.prepare(
        `insert into v2_capture_templates
         (id,user_id,name,description,icon_key,origin,status,current_version_id,pattern_signature,pinned,usage_count,created_at,updated_at)
         values (?,?,?,?,?,'ai_derived','generated_draft',null,?,0,0,?,?)`,
      ).bind(winnerTemplateId, "user-a", winnerDefinition.name, winnerDefinition.description ?? null, "type.template", patternSignature, winnerNow, winnerNow),
      db.prepare(
        `insert into v2_capture_template_versions
         (id,template_id,version_number,definition_json,registry_snapshot_version,source_model,prompt_version,approved_at,previous_version_id,created_at)
         values (?,?,1,?,?,?,?,null,null,?)`,
      ).bind(winnerVersionId, winnerTemplateId, JSON.stringify(winnerDefinition), TEMPLATE_REGISTRY_SNAPSHOT_VERSION, "template-race-winner-model", "template-race-winner-v1", winnerNow),
      db.prepare(
        `insert into v2_template_source_links (template_version_id,source_document_id,source_revision_id,role,created_at)
         select ?,p.source_document_id,p.source_revision_id,'pattern_source',?
         from v2_template_pattern_observations p
         join v2_documents d on d.object_id=p.source_document_id and d.current_revision_id=p.source_revision_id
         join v2_objects o on o.id=p.source_document_id and o.user_id=p.user_id
         where p.user_id=? and p.pattern_signature=? and p.outcome in ('observed','generated')`,
      ).bind(winnerVersionId, winnerNow, "user-a", patternSignature),
      db.prepare(
        `update v2_template_pattern_observations set outcome='generated'
         where user_id=? and pattern_signature=? and outcome in ('observed','generated')`,
      ).bind("user-a", patternSignature),
      db.prepare(
        `update v2_capture_templates set current_version_id=?
         where id=? and user_id=? and pattern_signature=? and current_version_id is null`,
      ).bind(winnerVersionId, winnerTemplateId, "user-a", patternSignature),
    ])), "user-a");

    const thirdPattern = patternRecords[2];
    await expect(racingRepository.observePattern({
      patternSignature,
      sourceDocumentId: thirdPattern.objectId,
      sourceRevisionId: thirdPattern.revisionId,
      observedDate: "2026-08-29",
      features: { fields: ["rating"] },
      candidateDefinition: SYSTEM_TEMPLATE_SEEDS[1].definition,
      sourceModel: "template-race-loser-model",
      promptVersion: "template-race-loser-v1",
    }, winnerNow)).resolves.toMatchObject({
      generated: false,
      documents: 3,
      dates: 3,
      template: { id: winnerTemplateId, currentVersionId: winnerVersionId, name: winnerDefinition.name },
    });

    await expect(db.prepare("select id,current_version_id from v2_capture_templates where user_id='user-a' and pattern_signature=?").bind(patternSignature).all()).resolves.toMatchObject({ results: [{ id: winnerTemplateId, current_version_id: winnerVersionId }] });
    await expect(db.prepare("select count(*) as value from v2_capture_template_versions v join v2_capture_templates t on t.id=v.template_id where t.user_id='user-a' and t.pattern_signature=?").bind(patternSignature).first()).resolves.toEqual({ value: 1 });
    await expect(db.prepare("select count(*) as value from v2_capture_template_versions where source_model='template-race-loser-model'").first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_template_source_links where template_version_id=? and role='pattern_source'").bind(winnerVersionId).first()).resolves.toEqual({ value: 3 });
    await expect(db.prepare("select outcome,count(*) as value from v2_template_pattern_observations where user_id='user-a' and pattern_signature=? group by outcome").bind(patternSignature).all()).resolves.toMatchObject({ results: [{ outcome: "generated", value: 3 }] });
  }, 30_000);

  test("does not call AI or commit knowledge when a projected mapping becomes hidden between queue phases", async () => {
    const hiddenOutbox = await seedRecord("processing-hidden-outbox", 30, "source_only");
    await queueAnalysis(hiddenOutbox, "processing-hidden-outbox");
    const baseQueue = new D1ProcessingQueueRepository(db);
    await expect(baseQueue.dispatchPending(10, "2026-08-29T12:00:00.000Z")).resolves.toBe(0);
    await expect(db.prepare("select status from v2_processing_outbox where id='outbox-processing-hidden-outbox'").first()).resolves.toEqual({ status: "failed" });

    const beginRace = await seedRecord("processing-begin-race", 31, "projected");
    await queueAnalysis(beginRace, "processing-begin-race");
    await expect(baseQueue.dispatchPending(10, "2026-08-29T12:01:00.000Z")).resolves.toBe(1);
    // Claim first terminalizes hidden jobs and recovers expired leases; the next batch begins the run.
    const beginRaceQueue = new D1ProcessingQueueRepository(beforeBatchOrdinal(3, async () => {
      await expect(db.prepare("select status from v2_processing_jobs where object_id=?").bind(beginRace.objectId).first()).resolves.toEqual({ status: "leased" });
      await db.prepare(
        "update v2_legacy_source_mappings set status='source_only' where id='mapping-processing-begin-race'",
      ).run();
    }));
    const gateway = new FakeV2StructuredModelGateway("success", emptyEnvelope(beginRace));
    await expect(runNextAnalysisJob({ queue: beginRaceQueue, gateway, workerId: "visibility-begin-worker", now: new Date("2026-08-29T12:01:01.000Z") })).resolves.toMatchObject({ outcome: "superseded" });
    expect(gateway.calls).toHaveLength(0);
    await expect(db.prepare("select status,last_error_code from v2_processing_jobs where object_id=?").bind(beginRace.objectId).first()).resolves.toEqual({ status: "superseded", last_error_code: "legacy_projection_hidden" });
    await expect(db.prepare("select count(*) as value from v2_processing_runs where job_id in (select id from v2_processing_jobs where object_id=?)").bind(beginRace.objectId).first()).resolves.toEqual({ value: 0 });

    const completionRace = await seedRecord("processing-complete-race", 32, "projected");
    await queueAnalysis(completionRace, "processing-complete-race");
    await baseQueue.dispatchPending(10, "2026-08-29T12:02:00.000Z");
    const claimed = await baseQueue.claim("visibility-complete-worker", new Date("2026-08-29T12:02:01.000Z"));
    if (!claimed || claimed.objectId !== completionRace.objectId) throw new Error("Expected the completion-race job.");
    const completionRunId = "visibility-completion-run";
    await expect(baseQueue.beginRun(claimed, {
      runId: completionRunId,
      modelId: "fake:main_analyzer",
      promptVersion: "analysis-main-v1",
      schemaVersion: "analysis-v1",
      registryVersion: "registry-bootstrap-v1",
      modelConfigVersion: "gemini-roles-v1",
      now: "2026-08-29T12:02:02.000Z",
    })).resolves.toBe(true);
    const completionQueue = new D1ProcessingQueueRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='quarantined' where id='mapping-processing-complete-race'",
    ).run()));
    await expect(completionQueue.completeAnalysis({
      job: claimed,
      runId: completionRunId,
      envelope: emptyEnvelope(completionRace),
      outputHash: "hidden-output",
      modelId: "fake:main_analyzer",
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      schemaVersion: "analysis-v1",
      validatorVersion: "analysis-semantic-v1",
      now: "2026-08-29T12:02:03.000Z",
    })).resolves.toEqual({ stale: true });
    await expect(db.prepare("select status,last_error_code from v2_processing_jobs where id=?").bind(claimed.id).first()).resolves.toEqual({ status: "superseded", last_error_code: "legacy_projection_hidden" });
    await expect(db.prepare("select status from v2_processing_runs where id=?").bind(completionRunId).first()).resolves.toEqual({ status: "superseded" });
    await expect(db.prepare("select count(*) as value from v2_analysis_proposals where job_id=?").bind(claimed.id).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_property_values where owner_object_id=?").bind(completionRace.objectId).first()).resolves.toEqual({ value: 0 });
    await expect(baseQueue.getCaptureProcessing(completionRace.captureId, "user-a")).resolves.toBeNull();

    const failRace = await seedRecord("processing-fail-race", 33, "projected");
    await queueAnalysis(failRace, "processing-fail-race");
    await baseQueue.dispatchPending(10, "2026-08-29T12:03:00.000Z");
    const failJob = await baseQueue.claim("visibility-fail-worker", new Date("2026-08-29T12:03:01.000Z"));
    if (!failJob || failJob.objectId !== failRace.objectId) throw new Error("Expected the failure-race job.");
    const failRunId = "visibility-failure-run";
    await baseQueue.beginRun(failJob, {
      runId: failRunId,
      modelId: "fake:main_analyzer",
      promptVersion: "analysis-main-v1",
      schemaVersion: "analysis-v1",
      registryVersion: "registry-bootstrap-v1",
      modelConfigVersion: "gemini-roles-v1",
      now: "2026-08-29T12:03:02.000Z",
    });
    const failQueue = new D1ProcessingQueueRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='source_only' where id='mapping-processing-fail-race'",
    ).run()));
    await expect(failQueue.failJob(failJob, { runId: failRunId, errorClass: "V2ModelError", errorCode: "provider_unavailable", retryable: true, now: new Date("2026-08-29T12:03:03.000Z") })).resolves.toMatchObject({ retry: false });
    await expect(db.prepare("select status,last_error_code from v2_processing_jobs where id=?").bind(failJob.id).first()).resolves.toEqual({ status: "superseded", last_error_code: "legacy_projection_hidden" });
    await expect(db.prepare("select status from v2_processing_runs where id=?").bind(failRunId).first()).resolves.toEqual({ status: "superseded" });
  }, 80_000);

  test("rolls back review target and grounded-enrichment writes when linked targets become hidden at commit", async () => {
    const subject = await seedRecord("review-target-subject", 40, null);
    await db.prepare(
      `insert into v2_processing_jobs
       (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at,finished_at)
       values ('review-target-job','user-a',?,?,'analyze','succeeded','interactive','review-target-job',1,4,'2026-08-29T13:00:00.000Z',?,?,'2026-08-29T13:00:00.000Z','2026-08-29T13:00:01.000Z')`,
    ).bind(subject.captureId, subject.objectId, subject.revisionId, subject.sources[0]?.contentHash ?? "hash").run();
    await db.prepare(
      `insert into v2_processing_runs
       (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at,finished_at)
       values ('review-target-run','review-target-job','user-a','main_analyzer','fake:main','p','s','r','m',?,'succeeded','2026-08-29T13:00:00.000Z','2026-08-29T13:00:01.000Z')`,
    ).bind(subject.sources[0]?.contentHash ?? "hash").run();
    await db.prepare(
      `insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at)
       values ('review-hidden-entity','user-a','entity','active','2026-08-29T13:00:00.000Z','2026-08-29T13:00:00.000Z')`,
    ).run();
    await db.prepare(
      `insert into v2_entity_records (object_id,proposal_temp_id,processing_run_id,entity_kind,canonical_name,resolution_status,created_at)
       values ('review-hidden-entity','entity-hidden','review-target-run','work','숨겨질 작품','external_required','2026-08-29T13:00:00.000Z')`,
    ).run();
    await addMapping({ key: "review-hidden-entity", objectId: "review-hidden-entity", status: "projected" });
    await db.prepare(
      `insert into v2_predicate_definitions
       (id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at)
       values ('review-target-predicate','user-a','mentions_hidden','언급','테스트','active','imported',1,'2026-08-29T13:00:00.000Z','2026-08-29T13:00:00.000Z')`,
    ).run();
    await db.prepare(
      `insert into v2_relation_edges
       (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,processing_run_id,locked_by_user,created_at)
       values ('review-target-relation','user-a',?,'review-target-predicate','review-hidden-entity','ai_inferred','low','proposed','review-target-run',0,'2026-08-29T13:00:00.000Z')`,
    ).bind(subject.objectId).run();
    await db.prepare(
      `insert into v2_review_items (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
       values ('review-target-item','user-a',?,'review-target-run','analysis_review','open',?,'2026-08-29T13:00:00.000Z')`,
    ).bind(subject.objectId, JSON.stringify({ entityTempId: "entity-hidden" })).run();
    const targetRace = new D1ReviewRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='source_only' where id='mapping-review-hidden-entity'",
    ).run()), "user-a");
    await expect(targetRace.resolve("review-target-item", { action: "accept", now: "2026-08-29T13:00:02.000Z" })).rejects.toMatchObject({ code: "review_target_missing" });
    await expect(db.prepare("select resolution_status from v2_entity_records where object_id='review-hidden-entity'").first()).resolves.toEqual({ resolution_status: "external_required" });
    await expect(db.prepare("select review_status,locked_by_user from v2_relation_edges where id='review-target-relation'").first()).resolves.toEqual({ review_status: "proposed", locked_by_user: 0 });
    await expect(db.prepare("select status from v2_review_items where id='review-target-item'").first()).resolves.toEqual({ status: "open" });
    await expect(db.prepare("select count(*) as value from v2_review_receipts where review_item_id='review-target-item'").first()).resolves.toEqual({ value: 0 });
    await db.prepare("update v2_legacy_source_mappings set status='projected' where id='mapping-review-hidden-entity'").run();
    const targetReviews = new D1ReviewRepository(db, "user-a");
    await expect(targetReviews.resolve("review-target-item", { action: "accept", now: "2026-08-29T13:00:03.000Z" })).resolves.toMatchObject({ replayed: false, resultStatus: "accepted" });
    await db.prepare("update v2_legacy_source_mappings set status='quarantined' where id='mapping-review-hidden-entity'").run();
    await expect(targetReviews.resolve("review-target-item", { action: "accept" })).rejects.toMatchObject({ code: "review_target_missing" });

    const groundingRecord = await seedRecord("grounding-complete-race", 41, "projected");
    await db.prepare(
      `insert into v2_processing_jobs
       (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
       values ('grounding-race-job','user-a',?,?,'grounded_enrich','queued','interactive','grounding-race-job',0,3,'2026-08-29T13:01:00.000Z',?,?,'2026-08-29T13:01:00.000Z')`,
    ).bind(groundingRecord.captureId, groundingRecord.objectId, groundingRecord.revisionId, groundingRecord.sources[0]?.contentHash ?? "hash").run();
    await db.prepare(
      `insert into v2_grounding_requests
       (id,analysis_job_id,processing_job_id,user_id,capture_id,object_id,input_revision_id,request_key,entity_kind,query_text,query_hash,requested_fields_json,status,created_at)
       values ('grounding-race-request','grounding-race-job','grounding-race-job','user-a',?,?,?,'work-lookup','work','작품 정보','query-hash','["director"]','queued','2026-08-29T13:01:00.000Z')`,
    ).bind(groundingRecord.captureId, groundingRecord.objectId, groundingRecord.revisionId).run();
    const groundingQueue = new D1ProcessingQueueRepository(db);
    const groundingJob = await groundingQueue.claim("visibility-grounding-worker", new Date("2026-08-29T13:01:01.000Z"), 120_000, "grounded_enrich");
    if (!groundingJob || groundingJob.id !== "grounding-race-job") throw new Error("Expected the grounding-race job.");
    await expect(groundingQueue.loadGroundingInput(groundingJob)).resolves.toMatchObject({ requestId: "grounding-race-request" });
    const groundingRunId = "grounding-race-run";
    await expect(groundingQueue.beginGroundingRun(groundingJob, {
      runId: groundingRunId,
      modelId: "fake:grounded_enricher",
      promptVersion: "grounded-enrichment-v1",
      schemaVersion: "grounded-result-v1",
      registryVersion: "registry-bootstrap-v1",
      modelConfigVersion: "gemini-roles-v1",
      now: "2026-08-29T13:01:02.000Z",
    })).resolves.toBe(true);
    const groundedEnvelope: GroundedResultEnvelopeV1 = {
      contract_version: "grounded-result-v1",
      identity_status: "resolved",
      canonical_name: "작품",
      summary: "확인됨",
      facts: [{ field_key: "director", label: "감독", value_type: "text", value: "홍길동", citation_urls: ["https://example.test/work"] }],
    };
    const groundingCompletion = new D1ProcessingQueueRepository(beforeNextBatch(() => db.prepare(
      "update v2_legacy_source_mappings set status='quarantined' where id='mapping-grounding-complete-race'",
    ).run()));
    await expect(groundingCompletion.completeGrounding({
      job: groundingJob,
      requestId: "grounding-race-request",
      runId: groundingRunId,
      answer: JSON.stringify(groundedEnvelope),
      envelope: groundedEnvelope,
      citations: [{ url: "https://example.test/work", title: "작품", startByte: 0, endByte: 3, citedText: "작품" }],
      queries: ["작품 정보"],
      outputHash: "grounding-hidden-output",
      modelId: "fake:grounded_enricher",
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      now: "2026-08-29T13:01:03.000Z",
    })).resolves.toEqual({ stale: true });
    await expect(db.prepare("select count(*) as value from v2_grounding_results where request_id='grounding-race-request'").first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_property_values where owner_object_id=?").bind(groundingRecord.objectId).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select status from v2_grounding_requests where id='grounding-race-request'").first()).resolves.toEqual({ status: "stale" });
    await expect(db.prepare("select status,last_error_code from v2_processing_jobs where id='grounding-race-job'").first()).resolves.toEqual({ status: "superseded", last_error_code: "legacy_projection_hidden" });
    await expect(db.prepare("select status from v2_processing_runs where id=?").bind(groundingRunId).first()).resolves.toEqual({ status: "superseded" });
  }, 80_000);
});
