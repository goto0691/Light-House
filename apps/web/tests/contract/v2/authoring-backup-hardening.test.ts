import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { buildKnowledgeCommitStatements } from "@/lib/v2/infrastructure/d1/knowledge-reconciler";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { createBackupSnapshot } from "@/lib/v2/portability/backup-snapshot-v1";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { createRestoreDryRun, importVerifiedBundle } from "@/lib/v2/portability/restore-bundle-v1";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationsPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const platforms: Platform[] = [];
let source: Platform;

async function createPlatform() {
  const platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  platforms.push(platform);
  await platform.env.DB.exec("create table users (id text primary key not null); insert into users (id) values ('outbox-user'),('backup-user');");
  const names = (await readdir(migrationsPath)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort();
  for (const name of names) {
    const text = await readFile(`${migrationsPath}/${name}`, "utf8");
    for (const sql of text.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await platform.env.DB.prepare(sql).run();
  }
  return platform;
}

beforeAll(async () => { source = await createPlatform(); }, 60_000);
afterAll(async () => { await Promise.all(platforms.map((platform) => platform.dispose())); });

async function seed(userId: string, aiEnabled: boolean) {
  const prepared = await prepareCaptureCommit({
    draftId: `hardening-${userId}`, channel: "web", title: "원래 제목", bodyMarkdown: "원래 문장",
    aiEnabled, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: "2026-09-08T00:00:00.000Z",
  }, `capture-${userId}`, "2026-09-08T00:00:01.000Z");
  await new D1SourceFoundationRepository(source.env.DB, userId).commitCapture(prepared);
  return prepared;
}

async function edit(prepared: Awaited<ReturnType<typeof seed>>, body: string, key: string) {
  return prepareDocumentRevision({
    expectedVersion: 1, expectedRevisionId: prepared.revisionId, title: "수정 제목", bodyMarkdown: body,
    writtenAt: null, documentStatus: "revising", privacyLevel: "normal",
  }, key, "2026-09-08T00:01:00.000Z");
}

describe("revision sources and lossless incremental backups", () => {
  test("keeps capture idempotency and queues one immutable source/outbox only for the winning revision", async () => {
    const prepared = await seed("outbox-user", true);
    const capture = new D1SourceFoundationRepository(source.env.DB, "outbox-user");
    await expect(capture.commitCapture(prepared)).resolves.toMatchObject({ disposition: "replayed" });
    const repository = new D1DocumentAuthoringRepository(source.env.DB, "outbox-user");
    const revision = await edit(prepared, "최신 문장", "winning-revision");
    await expect(repository.saveRevision(prepared.objectId, revision)).resolves.toMatchObject({ outcome: "saved" });
    await expect(repository.saveRevision(prepared.objectId, revision)).resolves.toMatchObject({ replayed: true });
    const stale = await edit(prepared, "충돌한 문장", "stale-revision");
    await expect(repository.saveRevision(prepared.objectId, stale)).resolves.toMatchObject({ outcome: "conflict" });
    const noChange = await prepareDocumentRevision({ ...revision, expectedVersion: 2, expectedRevisionId: revision.revisionId }, "unchanged-revision", "2026-09-08T00:02:00.000Z");
    await expect(repository.saveRevision(prepared.objectId, noChange)).resolves.toMatchObject({ outcome: "saved", revisionId: revision.revisionId });
    const sources = await source.env.DB.prepare("select id,raw_text,source_metadata from v2_source_items where user_id='outbox-user' order by display_order").all<{ id: string; raw_text: string; source_metadata: string | null }>();
    expect(sources.results.map((row) => row.raw_text)).toEqual(["원래 문장", "최신 문장"]);
    expect(JSON.parse(sources.results[1].source_metadata!)).toEqual({ document_revision_id: revision.revisionId, purpose: "document_revision" });
    await expect(source.env.DB.prepare("select count(*) as value from v2_processing_outbox where user_id='outbox-user'").first()).resolves.toEqual({ value: 2 });
    await expect(source.env.DB.prepare("select status,payload_json from v2_processing_outbox where id=?").bind(`revision_analysis:${revision.revisionId}`).first()).resolves.toEqual({ status: "pending", payload_json: JSON.stringify({ captureId: prepared.captureId }) });
    await expect(source.env.DB.prepare("select processing_status from v2_capture_bundles where id=?").bind(prepared.captureId).first()).resolves.toEqual({ processing_status: "pending" });
  }, 30_000);

  test("restores new entity/event parents from an incremental backup and preserves committed/fork revision metadata", async () => {
    const prepared = await seed("backup-user", false);
    const repository = new D1DocumentAuthoringRepository(source.env.DB, "backup-user");
    const committed = await edit(prepared, "수정된 본문", "backup-committed");
    const fork = await edit(prepared, "보존할 충돌 본문", "backup-fork");
    await repository.saveRevision(prepared.objectId, committed);
    await repository.saveRevision(prepared.objectId, fork);
    const base = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "backup-user", kind: "full", now: "2026-09-08T00:03:00.000Z" });
    await source.env.DB.batch([
      source.env.DB.prepare(`insert into v2_processing_jobs (id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
        values ('backup-job','backup-user',?,?,'analysis','succeeded','backup-job',1,'2026-09-08T00:04:00.000Z',?,'hash','2026-09-08T00:04:00.000Z')`).bind(prepared.captureId, prepared.objectId, committed.revisionId),
      source.env.DB.prepare(`insert into v2_processing_runs (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
        values ('backup-run','backup-job','backup-user','main_analyzer','fake','p','s','r','m','hash','succeeded','2026-09-08T00:04:00.000Z')`),
    ]);
    await source.env.DB.batch(buildKnowledgeCommitStatements(source.env.DB, {
      userId: "backup-user", objectId: prepared.objectId, runId: "backup-run", now: "2026-09-08T00:04:01.000Z",
      envelope: {
        contract_version: "analysis-v1", capture_id: prepared.captureId, analyzed_revision_id: committed.revisionId, language: "ko", bundle_summary: "테스트",
        document_proposals: [], field_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
        entity_proposals: [{ temp_id: "person-one", entity_kind: "person", mention: "함께 본 사람", resolution_status: "unresolved", evidence_refs: [] }],
        event_proposals: [{ temp_id: "event-one", event_type_key: "meeting", occurred_at_start: "2026-09-08", evidence_refs: [] }],
      },
    }));
    const incremental = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "backup-user", kind: "incremental", now: "2026-09-08T00:05:00.000Z" });
    expect(incremental.baseSnapshotId).toBe(base.snapshotId);
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId: "backup-user", snapshotId: incremental.snapshotId });
    expect(bundle.rowsByTable.get("v2_objects")?.map((row) => row.object_kind).sort()).toEqual(["document", "entity", "event"]);
    const target = await createPlatform();
    const dryRun = await createRestoreDryRun(target.env.DB, "backup-user", bundle);
    const result = await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "backup-user", bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "restore-backup-hardening", now: "2026-09-08T00:06:00.000Z" });
    expect(result.status).toBe("succeeded");
    const expected = await source.env.DB.prepare("select id,revision_status,revision_number,forked_from_version from v2_document_revisions where document_object_id=? order by id").bind(prepared.objectId).all();
    const actual = await target.env.DB.prepare("select id,revision_status,revision_number,forked_from_version from v2_document_revisions where document_object_id=? order by id").bind(prepared.objectId).all();
    expect(actual.results).toEqual(expected.results);
    expect(actual.results).toEqual(expect.arrayContaining([expect.objectContaining({ id: fork.revisionId, revision_status: "fork", revision_number: 2, forked_from_version: 1 })]));
    await expect(target.env.DB.prepare("select count(*) as value from v2_entity_records").first()).resolves.toEqual({ value: 1 });
    await expect(target.env.DB.prepare("select count(*) as value from v2_event_records").first()).resolves.toEqual({ value: 1 });
    await expect(target.env.DB.prepare("select schema_version from v2_processing_runs where id='backup-run'").first()).resolves.toEqual({ schema_version: "s" });
  }, 120_000);
});
