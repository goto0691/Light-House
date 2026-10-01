import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2GroundedResearchGateway, FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import {
  V2ModelError,
  type V2GroundedResearchGateway,
  type V2StructuredModelGateway,
} from "@/lib/v2/ai/gateway";
import { runNextGroundingJob } from "@/lib/v2/ai/grounding-runner";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrations = [
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
  for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function applyMigrationTo(target: TestD1, name: string) {
  const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
  for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await target.prepare(statement).run();
  }
}

async function seedLegacyRecord(suffix: string) {
  const capture = await prepareCaptureCommit({
    draftId: `provider-${suffix}`,
    channel: "import",
    title: `provider lease ${suffix}`,
    bodyMarkdown: "영화 봄날을 보고 별점 4.5점을 남겼다.",
    aiEnabled: true,
    clientTimezone: "Asia/Seoul",
    privacyLevel: "normal",
    capturedAt: "2026-08-29T00:00:00.000Z",
  }, `provider-lease-${suffix}`, new Date().toISOString());
  await new D1SourceFoundationRepository(db, "user-a").commitCapture(capture);
  await db.batch([
    db.prepare(
      `insert into v2_legacy_source_envelopes
       (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
       values (?,'user-a','legacy_notes',?,'{}',?,'2026-08-29T00:00:00.000Z','provider-lease-schema','[]','provider-lease-fixture')`,
    ).bind(`provider-envelope-${suffix}`, `provider-legacy-${suffix}`, `provider-row-${suffix}`),
    db.prepare(
      `insert into v2_legacy_source_mappings
       (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,created_at)
       values (?,'user-a',?,'legacy_notes',?,'provider-lease-adapter',?,?,'document','projected','active','2026-08-29T00:00:01.000Z')`,
    ).bind(`provider-mapping-${suffix}`, `provider-envelope-${suffix}`, `provider-legacy-${suffix}`, capture.sources[0]!.id, capture.objectId),
  ]);
  return capture;
}

function analysisEnvelope(capture: Awaited<ReturnType<typeof seedLegacyRecord>>, enrichment = false): AnalysisEnvelopeV1 {
  const source = capture.sources[0]!;
  return {
    contract_version: "analysis-v1",
    capture_id: capture.captureId,
    analyzed_revision_id: capture.revisionId,
    language: "ko",
    bundle_summary: "영화 감상",
    document_proposals: [{
      temp_id: "doc-1",
      source_item_ids: [source.id],
      suggested_title: "봄날 감상",
      type_assignments: [{ type_key: "movie_review", label: "영화 리뷰", registry_action: "propose_new", evidence_refs: [{ source_item_id: source.id, start: 0, end: 2 }] }],
    }],
    entity_proposals: [],
    event_proposals: [],
    field_proposals: [],
    enrichment_requests: enrichment ? [{ request_id: "enrich-1", entity_kind: "work", query: "영화 봄날", requested_fields: ["director", "cast"] }] : [],
    review_items: [],
    warnings: [],
  };
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec("create table users (id text primary key not null); insert into users (id) values ('user-a');");
  for (const migration of migrations) await applyMigration(migration);
}, 30_000);

afterAll(async () => platform.dispose());

describe("provider invocation visibility lease", () => {
  test("keeps queued work idle until 0029 installs the provider invocation boundary", async () => {
    const preLeasePlatform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
    const preLeaseDb = preLeasePlatform.env.DB;
    try {
      await preLeaseDb.exec("create table users (id text primary key not null); insert into users (id) values ('user-a');");
      for (const migration of migrations.slice(0, -1)) await applyMigrationTo(preLeaseDb, migration);
      const capture = await prepareCaptureCommit({
        draftId: "provider-schema-gate",
        channel: "web",
        title: "마이그레이션 대기",
        bodyMarkdown: "0029가 적용된 뒤 분석해야 한다.",
        aiEnabled: true,
        clientTimezone: "Asia/Seoul",
        privacyLevel: "normal",
        capturedAt: "2026-08-29T00:00:00.000Z",
      }, "provider-schema-gate", "2026-08-29T00:00:01.000Z");
      await new D1SourceFoundationRepository(preLeaseDb, "user-a").commitCapture(capture);
      const queue = new D1ProcessingQueueRepository(preLeaseDb);
      await expect(queue.dispatchPending()).resolves.toBe(1);
      const gateway = new FakeV2StructuredModelGateway("success", analysisEnvelope(capture));

      await expect(runNextAnalysisJob({ queue, gateway, workerId: "pre-0029-worker" })).resolves.toEqual({ outcome: "idle" });
      expect(gateway.calls).toHaveLength(0);
      await expect(preLeaseDb.prepare("select status,attempt from v2_processing_jobs limit 1").first()).resolves.toEqual({ status: "queued", attempt: 0 });
    } finally {
      await preLeasePlatform.dispose();
    }
  }, 30_000);

  test("blocks projected-to-hidden mutation during analysis and releases the lease on provider failure", async () => {
    const capture = await seedLegacyRecord("analysis");
    const queue = new D1ProcessingQueueRepository(db);
    await expect(queue.dispatchPending()).resolves.toBe(1);
    const mutationErrors: string[] = [];
    let trashConflictCode = "";
    const gateway: V2StructuredModelGateway = {
      async generate() {
        for (const statement of [
          "update v2_legacy_source_mappings set status='source_only' where id='provider-mapping-analysis'",
          "update v2_legacy_source_mappings set projected_object_id=null where id='provider-mapping-analysis'",
          "delete from v2_legacy_source_mappings where id='provider-mapping-analysis'",
          `update v2_objects set lifecycle_status='archived' where id='${capture.objectId}'`,
          `delete from v2_objects where id='${capture.objectId}'`,
        ]) {
          try {
            await db.prepare(statement).run();
          } catch (error) {
            mutationErrors.push(error instanceof Error ? error.message : String(error));
          }
        }
        try {
          await new D1SourceFoundationRepository(db, "user-a").trashRecord(capture.objectId, {
            auditEventId: "provider-trash-audit",
            deletedAt: new Date().toISOString(),
            purgeAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          });
        } catch (error) {
          trashConflictCode = (error as { code?: string }).code ?? "";
        }
        throw new V2ModelError("provider_unavailable", "deterministic provider failure", true);
      },
    };

    await expect(runNextAnalysisJob({ queue, gateway, workerId: "analysis-race-worker" })).resolves.toMatchObject({ outcome: "retry_wait" });
    expect(mutationErrors).toHaveLength(5);
    expect(mutationErrors.every((message) => message.includes("legacy_provider_invocation_active"))).toBe(true);
    expect(trashConflictCode).toBe("provider_invocation_visibility_conflict");
    await expect(db.prepare("select status from v2_legacy_source_mappings where id='provider-mapping-analysis'").first()).resolves.toEqual({ status: "projected" });
    await expect(db.prepare("select count(*) as value from v2_provider_invocation_leases where object_id=?").bind(capture.objectId).first()).resolves.toEqual({ value: 0 });
  }, 30_000);

  test("blocks a non-projected mapping attachment during grounding and releases the lease on completion", async () => {
    const capture = await seedLegacyRecord("grounding");
    const queue = new D1ProcessingQueueRepository(db);
    await expect(queue.dispatchPending()).resolves.toBe(1);
    await expect(runNextAnalysisJob({
      queue,
      gateway: new FakeV2StructuredModelGateway("success", analysisEnvelope(capture, true)),
      workerId: "grounding-setup-worker",
    })).resolves.toMatchObject({ outcome: "succeeded" });
    await db.prepare(
      `insert into v2_legacy_source_envelopes
       (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
       values ('provider-envelope-grounding-attach','user-a','legacy_notes','provider-legacy-grounding-attach','{}','provider-row-grounding-attach','2026-08-29T00:01:00.000Z','provider-lease-schema','[]','provider-lease-fixture')`,
    ).run();
    let mutationError = "";
    const fixture = new FakeV2GroundedResearchGateway("success");
    const gateway: V2GroundedResearchGateway = {
      async research(request) {
        try {
          await db.prepare(
            `insert into v2_legacy_source_mappings
             (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,created_at)
             values ('provider-mapping-grounding-attach','user-a','provider-envelope-grounding-attach','legacy_notes','provider-legacy-grounding-attach','provider-lease-adapter',?,?,'document','source_only','active','2026-08-29T00:01:01.000Z')`,
          ).bind(capture.sources[0]!.id, capture.objectId).run();
        } catch (error) {
          mutationError = error instanceof Error ? error.message : String(error);
        }
        return fixture.research(request);
      },
    };

    await expect(runNextGroundingJob({ queue, gateway, workerId: "grounding-race-worker" })).resolves.toMatchObject({ outcome: "succeeded" });
    expect(mutationError).toContain("legacy_provider_invocation_active");
    await expect(db.prepare("select count(*) as value from v2_legacy_source_mappings where id='provider-mapping-grounding-attach'").first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare("select count(*) as value from v2_provider_invocation_leases where object_id=?").bind(capture.objectId).first()).resolves.toEqual({ value: 0 });
  }, 30_000);
});
