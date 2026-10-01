import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { canonicalTablesForSchemaVersion } from "@/lib/v2/portability/canonical-table-registry-v1";
import {
  EXPORT_ADVANCE_CALLS_PER_BATCH,
  EXPORT_ADVANCE_CALLS_PER_USER_ACTION,
  EXPORT_MAX_BATCHES_PER_USER_ACTION,
  exportUserActionsForAdvances,
} from "@/lib/v2/portability/export-continuation-policy";
import { writeExportBundle } from "@/lib/v2/portability/export-bundle-v1";
import { LIGHTHOUSE_SCHEMA_VERSION, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { verifyExportBundle } from "@/lib/v2/portability/restore-bundle-v1";
import {
  advanceResumableExportWorkflow,
  EXPORT_CENTRAL_RECEIPTS_PER_ADVANCE,
  EXPORT_MAX_DOCUMENTS_PER_ADVANCE,
  EXPORT_MAX_ORIGINALS_PER_ADVANCE,
  EXPORT_MAX_UNITS_PER_ADVANCE,
  EXPORT_MULTIPART_PART_BYTES,
  EXPORT_PENDING_OBJECT_PREFIX,
  EXPORT_VERIFY_CHUNK_BYTES,
  stageResumableExportWorkflow,
} from "@/lib/v2/portability/resumable-export-v2";
import { parseStoredZip } from "@/lib/v2/portability/zip-stream-v1";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationNames = [
  "0006_v2_source_and_document_foundation.sql", "0007_v2_document_authoring.sql", "0008_v2_ai_processing.sql", "0009_v2_grounded_enrichment.sql",
  "0010_v2_ai_runtime_governor.sql", "0011_v2_adaptive_knowledge.sql", "0012_v2_review_actions.sql", "0013_v2_entities_relations_and_presentation.sql",
  "0014_v2_retrieval_and_saved_views.sql", "0015_v2_adaptive_capture_templates.sql", "0016_v2_opt_in_rediscovery.sql", "0017_v2_portability_restore_and_legacy_migration.sql",
  "0018_v2_legacy_migration_hardening.sql", "0019_v2_resumable_restore_hardening.sql", "0020_v2_resumable_legacy_preservation_gate.sql", "0021_v2_resumable_backup_creation.sql",
  "0022_v2_resumable_export_packaging.sql", "0023_v2_resumable_backup_retention.sql",
  "0024_v2_resumable_restore_uploads.sql", "0025_v2_workflow_lease_fencing.sql",
  "0026_v2_legacy_terminal_reconciliation_guard.sql", "0027_v2_legacy_migration_quarantine.sql",
  "0028_v2_fts_source_owner_fence.sql", "0029_v2_provider_invocation_lease.sql",
  "0030_v2_object_backup_change_events.sql", "0031_v2_link_snapshot_foundation.sql", "0032_v2_prompt_curations.sql",
] as const;

const platforms = new Set<Platform>();

async function createPlatform() {
  const platform = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  await platform.env.DB.exec("create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');");
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await platform.env.DB.prepare(statement).run();
    }
  }
  platforms.add(platform);
  return platform;
}

afterAll(async () => {
  await Promise.all([...platforms].map((platform) => platform.dispose()));
});

class CountingD1 implements D1DatabaseBinding {
  statements = 0;
  private readonly prepared = new WeakMap<D1PreparedStatementBinding, D1PreparedStatementBinding>();

  constructor(private readonly inner: D1DatabaseBinding) {}

  prepare(query: string): D1PreparedStatementBinding {
    let prepared = this.inner.prepare(query);
    const owner = this;
    const wrapper: D1PreparedStatementBinding = {
      bind(...values: unknown[]) { prepared = prepared.bind(...values); owner.prepared.set(wrapper, prepared); return wrapper; },
      async first<T>() { owner.statements += 1; return prepared.first<T>(); },
      async all<T>() { owner.statements += 1; return prepared.all<T>(); },
      async run() { owner.statements += 1; return prepared.run(); },
    };
    this.prepared.set(wrapper, prepared);
    return wrapper;
  }

  async batch<T>(statements: D1PreparedStatementBinding[]) {
    this.statements += statements.length;
    return this.inner.batch<T>(statements.map((statement) => this.prepared.get(statement) ?? statement));
  }
}

class FaultR2 implements R2BucketBinding {
  operations = 0;
  aborts = 0;
  failNextPut = false;
  private pausePending = false;
  private pendingStartedResolve: (() => void) | null = null;
  private pendingReleaseResolve: (() => void) | null = null;
  private pendingStarted = Promise.resolve();
  private pendingRelease = Promise.resolve();

  constructor(readonly inner: R2BucketBinding) {}

  pauseNextPendingPut() {
    this.pausePending = true;
    this.pendingStarted = new Promise<void>((resolve) => { this.pendingStartedResolve = resolve; });
    this.pendingRelease = new Promise<void>((resolve) => { this.pendingReleaseResolve = resolve; });
  }

  waitForPausedPut() { return this.pendingStarted; }
  releasePausedPut() { this.pendingReleaseResolve?.(); }

  async head(key: string) { this.operations += 1; return this.inner.head(key); }
  async get(key: string, options?: { range?: { offset: number; length: number } }) { this.operations += 1; return this.inner.get(key, options); }
  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options?: Parameters<R2BucketBinding["put"]>[2]) {
    this.operations += 1;
    if (this.failNextPut) { this.failNextPut = false; throw new Error("injected_transient_r2_put"); }
    if (this.pausePending && key.startsWith(EXPORT_PENDING_OBJECT_PREFIX)) {
      this.pausePending = false;
      this.pendingStartedResolve?.();
      await this.pendingRelease;
    }
    return this.inner.put(key, value, options);
  }
  async delete(key: string | string[]) { this.operations += 1; return this.inner.delete(key); }

  async createMultipartUpload(key: string, options?: Parameters<NonNullable<R2BucketBinding["createMultipartUpload"]>>[1]) {
    this.operations += 1;
    if (!this.inner.createMultipartUpload) throw new Error("multipart unavailable");
    const upload = await this.inner.createMultipartUpload(key, options);
    return {
      uploadId: upload.uploadId,
      uploadPart: (partNumber: number, value: ArrayBuffer | ArrayBufferView | Blob) => upload.uploadPart(partNumber, value),
      complete: (parts: readonly { partNumber: number; etag: string }[]) => upload.complete(parts),
      abort: async () => { this.aborts += 1; return upload.abort(); },
    };
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    this.operations += 1;
    if (!this.inner.resumeMultipartUpload) throw new Error("multipart unavailable");
    const upload = this.inner.resumeMultipartUpload(key, uploadId);
    return {
      uploadPart: (partNumber: number, value: ArrayBuffer | ArrayBufferView | Blob) => upload.uploadPart(partNumber, value),
      complete: (parts: readonly { partNumber: number; etag: string }[]) => upload.complete(parts),
      abort: async () => { this.aborts += 1; return upload.abort(); },
    };
  }
}

async function seedDocument(platform: Platform, options: { largeOriginal?: boolean; smallOriginal?: boolean } = {}) {
  let attachmentId: string | undefined;
  let source: { kind: "image"; contentHash: string; attachmentId: string; metadata: { source: string } } | undefined;
  if (options.largeOriginal || options.smallOriginal) {
    const fixtureKind = options.largeOriginal ? "large" : "small";
    attachmentId = `export-${fixtureKind}-original`;
    const objectKey = `users/test/originals/${attachmentId}`;
    const bytes = new Uint8Array(options.largeOriginal ? EXPORT_MULTIPART_PART_BYTES + 321_123 : 8_193);
    for (let offset = 0; offset < bytes.byteLength; offset += 1) bytes[offset] = (offset * 31 + 17) & 0xff;
    const hash = sha256Hex(bytes);
    await platform.env.ARCHIVE_ASSETS.put(objectKey, bytes, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { reservationId: attachmentId, userId: "user-a" },
      sha256: Uint8Array.from(hash.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16)),
    });
    await platform.env.DB.prepare(`insert into v2_attachment_reservations
      (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at,verified_at,committed_at)
      values (?,'user-a','verified',?,'large fixture.png','image/png',?,?,?,'2026-08-29T10:00:00.000Z',?,null)`)
      .bind(attachmentId, objectKey, bytes.byteLength, hash, "2026-08-28T09:59:00.000Z", "2026-08-28T09:59:30.000Z").run();
    source = { kind: "image", contentHash: hash, attachmentId, metadata: { source: "resumable-export-test" } };
  }
  const capture = await prepareCaptureCommit({
    draftId: options.largeOriginal ? "export-large-draft" : options.smallOriginal ? "export-small-original-draft" : "export-small-draft",
    channel: "web",
    title: "중단 가능한 내보내기",
    bodyMarkdown: "# 다시 시작할 수 있는 기록\n\nZIP 바이트가 결정적으로 이어진다.\n",
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel: "normal",
    capturedAt: "2026-08-28T10:00:00.000Z",
    sources: source ? [source] : undefined,
  }, options.largeOriginal ? "export-large-capture" : options.smallOriginal ? "export-small-original-capture" : "export-small-capture", "2026-08-28T10:00:01.000Z");
  await new D1SourceFoundationRepository(platform.env.DB, "user-a").commitCapture(capture);
  return { attachmentId, captureId: capture.captureId, objectId: capture.objectId, revisionId: capture.revisionId, sourceItemId: capture.sources[0]!.id };
}

async function markAsSourceOnlyLegacyProjection(platform: Platform, seeded: Awaited<ReturnType<typeof seedDocument>>) {
  await platform.env.DB.batch([
    platform.env.DB.prepare(`insert into v2_legacy_source_envelopes
      (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id)
      values ('export-hidden-envelope','user-a','legacy_notes','export-hidden','{}','sha256:hidden','2026-08-28T10:00:02.000Z','legacy-schema:export','[]','export-hidden-batch')`),
    platform.env.DB.prepare(`insert into v2_legacy_source_mappings
      (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,created_at,superseded_at,superseded_by_mapping_id,target_lifecycle_status,activation_batch_id)
      values ('export-hidden-mapping','user-a','export-hidden-envelope','legacy_notes','export-hidden','legacy-export-v1',?,?,'document','source_only','2026-08-28T10:00:02.000Z',null,null,'active',null)`)
      .bind(seeded.sourceItemId, seeded.objectId),
  ]);
}

async function createJob(platform: Platform, idempotencyKey: string, includeOriginals: boolean, profile: "portable" | "migration" = "migration", privacyLevels: ("normal" | "sensitive" | "restricted")[] = ["normal"]) {
  return new D1PortabilityRepository(platform.env.DB, "user-a").createExport({
    profile,
    scope: { objects: "all", privacyLevels, includeTrash: false, includeHistory: true, includeOriginals },
    idempotencyKey,
    now: "2026-08-28T10:01:00.000Z",
  });
}

async function drive(input: { db: CountingD1; bucket: FaultR2; exportId: string; max?: number }) {
  let view: Awaited<ReturnType<typeof advanceResumableExportWorkflow>> | null = null;
  for (let step = 0; step < (input.max ?? 600); step += 1) {
    input.db.statements = 0;
    input.bucket.operations = 0;
    view = await advanceResumableExportWorkflow({
      db: input.db,
      bucket: input.bucket,
      userId: "user-a",
      exportId: input.exportId,
      now: new Date(Date.UTC(2026, 7, 28, 11, 0, step)).toISOString(),
    });
    expect(input.db.statements).toBeLessThanOrEqual(20);
    expect(input.bucket.operations).toBeLessThanOrEqual(9);
    if (view.status === "succeeded" || view.status === "failed") return view;
  }
  throw new Error(`Export did not terminate: ${JSON.stringify(view)}`);
}

async function seedSyntheticManifestReceipts(db: TestD1, exportId: string, count: number, currentCorpusShape: boolean) {
  await db.prepare(`with digits(d) as (values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)), numbers(n) as (
      select a.d+10*b.d+100*c.d+1000*d.d from digits a cross join digits b cross join digits c cross join digits d
    )
    insert into v2_export_files
      (export_id,user_id,ordinal,entry_kind,table_name,source_ref,path,media_type,include_in_manifest,local_offset,size_bytes,crc32,sha256,record_count,created_at,completed_at)
    select ?,'user-a',n,
      case when ?=1 and n between 1 and 3000 then case when n%2=1 then 'document_markdown' else 'document_metadata' end when ?=1 and n=3001 then 'canonical_jsonl' else 'synthetic' end,
      case when ?=1 and n=3001 then 'v2_attachment_reservations' else null end,
      null,
      case when ?=1 and n=0 then 'README.md' when ?=1 and n between 1 and 3000 then printf('documents/doc-%04d/%s',cast((n-1)/2 as integer),case when n%2=1 then 'index.md' else 'metadata.json' end) when ?=1 and n=3001 then 'attachments/metadata.jsonl' else printf('synthetic/%05d.json',n) end,
      'application/octet-stream',1,0,1,0,printf('%064x',n+1),
      case when ?=1 and n between 1 and 3001 then 1 else 0 end,
      '2026-08-28T14:00:00.000Z','2026-08-28T14:00:00.000Z'
    from numbers where n<? order by n`)
    .bind(exportId, currentCorpusShape ? 1 : 0, currentCorpusShape ? 1 : 0, currentCorpusShape ? 1 : 0, currentCorpusShape ? 1 : 0, currentCorpusShape ? 1 : 0, currentCorpusShape ? 1 : 0, currentCorpusShape ? 1 : 0, count).run();
  await db.prepare("update v2_export_jobs set build_phase='packaging',cursor_json=?,entry_count=? where id=?")
    .bind(JSON.stringify({ phase: "manifest" }), count, exportId).run();
}

describe("resumable export workflow v2", () => {
  test("omits source-only projections from portable exports while migration archives retain their provenance and originals", async () => {
    const platform = await createPlatform();
    const seeded = await seedDocument(platform, { smallOriginal: true });
    const native = await seedDocument(platform);
    const malformedRevision = await seedDocument(platform);
    const crossOwnerCapture = await prepareCaptureCommit({
      draftId: "export-user-b-draft",
      channel: "web",
      title: "다른 사용자의 원문",
      bodyMarkdown: "이 원문은 user-a archive에 들어가면 안 된다.",
      aiEnabled: false,
      clientTimezone: "Asia/Seoul",
      privacyLevel: "normal",
      capturedAt: "2026-08-28T10:00:02.000Z",
    }, "export-user-b-capture", "2026-08-28T10:00:02.000Z");
    await new D1SourceFoundationRepository(platform.env.DB, "user-b").commitCapture(crossOwnerCapture);
    await platform.env.DB.prepare("update v2_documents set current_revision_id=? where object_id=?")
      .bind(crossOwnerCapture.revisionId, malformedRevision.objectId).run();
    await markAsSourceOnlyLegacyProjection(platform, seeded);
    await platform.env.DB.batch([
      platform.env.DB.prepare(`insert into v2_predicate_definitions
        (id,user_id,key,label,definition,status,origin,schema_version,created_at,updated_at)
        values ('export-cross-predicate','user-a','mentions_cross_owner','cross owner','test','active','user_created',1,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at)
        values ('export-user-b-entity','user-b','entity','active','2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at)
        values ('export-user-b-entity','person','다른 사용자의 대상','resolved','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_field_definitions
        (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
        values ('export-user-b-field','user-b','private_field','private','private','short_text','active','user_created',1,1,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_type_definitions
        (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
        values ('export-user-b-type','user-b','foreign_type_secret','다른 사용자의 비밀 분류','document','active','user_created','private',1,1,0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_field_definitions
        (id,user_id,key,label,definition,data_type,status,origin,schema_version,usage_count,created_at,updated_at)
        values ('export-user-a-field','user-a','own_field','own','own','short_text','active','user_created',1,1,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_type_definitions
        (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at)
        values ('export-user-a-type','user-a','own_type','내 분류','document','active','user_created','own',1,1,0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_object_type_assignments
        (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
        values ('export-cross-type-assignment','user-a',?,'export-user-b-type','primary','import','accepted',0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_processing_jobs
        (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,input_hash,created_at)
        values ('export-user-b-job','user-b',?,?,'analyze','queued','interactive','export-user-b-job',0,3,'2026-08-28T10:00:03.000Z','sha256:cross','2026-08-28T10:00:03.000Z')`)
        .bind(crossOwnerCapture.captureId, native.objectId),
      platform.env.DB.prepare(`insert into v2_processing_runs
        (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,grounding_query_count,cited_source_count,created_at)
        values ('export-user-b-run','export-user-b-job','user-b','structured','foreign-model','prompt-v1','analysis-v1','registry-v1','config-v1','sha256:cross','succeeded',0,0,'2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_object_type_assignments
        (id,user_id,object_id,type_definition_id,role,source_class,review_status,processing_run_id,locked_by_user,created_at,updated_at)
        values ('export-current-assignment-foreign-run','user-a',?,'export-user-a-type','primary','ai','proposed','export-user-b-run',0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_property_values
        (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
        values ('export-user-b-property','user-b',?,'export-user-b-field','text','cross-owner secret','"cross-owner secret"','user_explicit','low','accepted',1,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_property_values
        (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
        values ('export-current-property-foreign-field','user-a',?,'export-user-b-field','text','must be excluded','"must be excluded"','user_explicit','low','proposed',0,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_property_values
        (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
        values ('export-current-valid-property','user-a',?,'export-user-a-field','text','valid','"valid"','user_explicit','low','accepted',1,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_property_values
        (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,processing_run_id,locked_by_user,created_at)
        values ('export-current-property-foreign-run','user-a',?,'export-user-a-field','text','must be excluded','"must be excluded"','ai_inferred','low','proposed','export-user-b-run',0,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_property_values
        (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
        values ('export-user-b-property-on-own-field','user-b',?,'export-user-a-field','text','foreign parent','"foreign parent"','user_explicit','low','proposed',0,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_property_values
        (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,supersedes_value_id,locked_by_user,created_at)
        values ('export-current-property-foreign-supersedes','user-a',?,'export-user-a-field','text','must be excluded','"must be excluded"','user_explicit','low','proposed','export-user-b-property-on-own-field',0,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_type_presentation_profiles
        (id,user_id,type_definition_id,icon_key,accent_role,source,version,status,created_at,updated_at)
        values ('export-current-profile-foreign-type','user-a','export-user-b-type','type.document','neutral','user',1,'active','2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_capture_templates
        (id,user_id,name,icon_key,origin,status,current_version_id,pinned,usage_count,created_at,updated_at)
        values ('export-user-b-template','user-b','foreign template','type.template','user_created','active',null,0,0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_capture_template_versions
        (id,template_id,version_number,definition_json,registry_snapshot_version,created_at)
        values ('export-user-b-template-version','export-user-b-template',1,'{}','registry-v1','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare("update v2_capture_templates set current_version_id='export-user-b-template-version' where id='export-user-b-template'"),
      platform.env.DB.prepare(`insert into v2_capture_templates
        (id,user_id,name,icon_key,origin,status,current_version_id,pinned,usage_count,created_at,updated_at)
        values ('export-current-template-foreign-version','user-a','malformed template','type.template','user_created','active','export-user-b-template-version',0,0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_capture_templates
        (id,user_id,name,icon_key,origin,status,current_version_id,pinned,usage_count,created_at,updated_at)
        values ('export-current-template-chain','user-a','malformed chain','type.template','user_created','active','export-current-version-foreign-previous',0,0,'2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_capture_template_versions
        (id,template_id,version_number,definition_json,registry_snapshot_version,previous_version_id,created_at)
        values ('export-current-version-foreign-previous','export-current-template-chain',2,'{}','registry-v1','export-user-b-template-version','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_capture_template_sessions
        (id,user_id,draft_id,capture_id,template_version_id,state,applied_at,submitted_at,input_snapshot_json)
        values ('export-current-session-foreign-version','user-a','malformed-session',?,'export-user-b-template-version','submitted','2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z','[]')`)
        .bind(native.captureId),
      platform.env.DB.prepare(`insert into v2_capture_input_values
        (id,session_id,user_id,item_key,binding_snapshot_json,value_kind,value_json,input_order,blank_state,client_timestamp,created_at)
        values ('export-current-input-foreign-session','export-current-session-foreign-version','user-a','note','{}','text','"secret"',0,'answered','2026-08-28T10:00:03.000Z','2026-08-28T10:00:03.000Z')`),
      platform.env.DB.prepare(`insert into v2_template_source_links
        (template_version_id,source_document_id,source_revision_id,role,created_at)
        values ('export-user-b-template-version',?,?,'example','2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId, native.revisionId),
      platform.env.DB.prepare(`insert into v2_template_pattern_observations
        (id,user_id,pattern_signature,signature_version,source_document_id,source_revision_id,observed_date,features_json,cluster_id,outcome,created_at)
        values ('export-current-observation-foreign-revision','user-a','foreign-revision',1,?,?,'2026-08-28','{}','cluster-x','observed','2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId, crossOwnerCapture.revisionId),
      platform.env.DB.prepare(`insert into v2_evidence_refs
        (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
        values ('export-current-evidence-foreign-target','user-a','property_value','export-current-property-foreign-field',?,'text_span','{"start":0,"end":1}','2026-08-28T10:00:03.000Z')`)
        .bind(native.sourceItemId),
      platform.env.DB.prepare(`insert into v2_evidence_refs
        (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
        values ('export-current-evidence-foreign-source','user-a','property_value','export-current-valid-property',?,'text_span','{"start":0,"end":1}','2026-08-28T10:00:03.000Z')`)
        .bind(crossOwnerCapture.sources[0]!.id),
      platform.env.DB.prepare(`insert into v2_review_items
        (id,user_id,object_id,kind,status,payload_json,created_at)
        values ('export-user-b-review','user-b',?,'analysis_review','open','{"secret":true}','2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId),
      platform.env.DB.prepare(`insert into v2_document_source_links
        (document_object_id,source_item_id,role,source_order,created_at)
        values (?,?,'evidence',99,'2026-08-28T10:00:03.000Z')`)
        .bind(native.objectId, crossOwnerCapture.sources[0]!.id),
    ]);
    await platform.env.DB.prepare(`insert into v2_relation_edges
      (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,locked_by_user,created_at)
      values ('export-cross-relation','user-a',?,'export-cross-predicate','export-user-b-entity','user_explicit','low','accepted',1,'2026-08-28T10:00:03.000Z')`)
      .bind(native.objectId).run();
    const malformedCanonicalRows = [
      ["objects/type-assignments.jsonl", "export-cross-type-assignment"],
      ["objects/type-assignments.jsonl", "export-current-assignment-foreign-run"],
      ["objects/property-values.jsonl", "export-current-property-foreign-field"],
      ["objects/property-values.jsonl", "export-current-property-foreign-run"],
      ["objects/property-values.jsonl", "export-current-property-foreign-supersedes"],
      ["registries/presentation-profiles.jsonl", "export-current-profile-foreign-type"],
      ["registries/templates.jsonl", "export-current-template-foreign-version"],
      ["registries/templates.jsonl", "export-current-template-chain"],
      ["registries/template-versions.jsonl", "export-current-version-foreign-previous"],
      ["sources/template-sessions.jsonl", "export-current-session-foreign-version"],
      ["sources/template-input-values.jsonl", "export-current-input-foreign-session"],
      ["sources/template-source-links.jsonl", "export-user-b-template-version"],
      ["registries/template-pattern-observations.jsonl", "export-current-observation-foreign-revision"],
      ["objects/evidence-refs.jsonl", "export-current-evidence-foreign-target"],
      ["objects/evidence-refs.jsonl", "export-current-evidence-foreign-source"],
    ] as const;
    const objectDescriptor = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION).find((descriptor) => descriptor.table === "v2_objects")!;
    const scopedObjects = objectDescriptor.query("user-a", {
      objects: "all", privacyLevels: ["normal"], includeTrash: false, includeHistory: true, includeOriginals: true,
    });
    const objectRows = await platform.env.DB.prepare(scopedObjects.sql).bind(...scopedObjects.bindings).all<{ id: string }>();
    expect(objectRows.results.map((row) => row.id)).toContain(native.objectId);
    expect(objectRows.results.map((row) => row.id)).not.toContain("export-user-b-entity");

    const portableJob = await createJob(platform, "hidden-legacy-portable", true, "portable");
    const portable = await writeExportBundle({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", job: portableJob });
    const portableObject = await platform.env.ARCHIVE_ASSETS.get(portable.objectKey);
    const portableBytes = new Uint8Array(await portableObject!.arrayBuffer());
    expect(() => verifyExportBundle(portableBytes)).not.toThrow();
    const portableArchive = parseStoredZip(portableBytes);
    expect(portableArchive.has(`documents/${seeded.objectId}/index.md`)).toBe(false);
    expect(portableArchive.has(`documents/${native.objectId}/index.md`)).toBe(true);
    expect(portableArchive.has(`documents/${malformedRevision.objectId}/index.md`)).toBe(false);
    const portableDocument = new TextDecoder().decode(portableArchive.get(`documents/${native.objectId}/index.md`)!.bytes);
    const portableMetadata = new TextDecoder().decode(portableArchive.get(`documents/${native.objectId}/metadata.json`)!.bytes);
    expect(portableDocument).not.toContain("다른 사용자의 대상");
    expect(portableDocument).not.toContain("foreign_type_secret");
    expect(portableMetadata).not.toContain("다른 사용자의 비밀 분류");
    expect(new TextDecoder().decode(portableArchive.get("objects/type-assignments.jsonl")?.bytes ?? new Uint8Array())).not.toContain("export-cross-type-assignment");
    for (const [path, forbidden] of malformedCanonicalRows) {
      expect(new TextDecoder().decode(portableArchive.get(path)?.bytes ?? new Uint8Array()), `${path} excludes ${forbidden}`).not.toContain(forbidden);
    }
    expect(portableArchive.has(`attachments/originals/${seeded.attachmentId}/large fixture.png`)).toBe(false);
    expect(new TextDecoder().decode(portableArchive.get("migration/legacy-source-mappings.jsonl")?.bytes ?? new Uint8Array())).not.toContain("export-hidden-mapping");

    const restrictedPortableJob = await createJob(platform, "hidden-legacy-restricted-portable", false, "portable", ["normal", "restricted"]);
    const restrictedPortable = await writeExportBundle({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", job: restrictedPortableJob });
    const restrictedPortableObject = await platform.env.ARCHIVE_ASSETS.get(restrictedPortable.objectKey);
    const restrictedPortableBytes = new Uint8Array(await restrictedPortableObject!.arrayBuffer());
    expect(() => verifyExportBundle(restrictedPortableBytes)).not.toThrow();
    const restrictedPortableArchive = parseStoredZip(restrictedPortableBytes);
    expect(new TextDecoder().decode(restrictedPortableArchive.get("migration/legacy-source-mappings.jsonl")?.bytes ?? new Uint8Array())).not.toContain("export-hidden-mapping");
    expect(new TextDecoder().decode(restrictedPortableArchive.get("migration/legacy-source-envelopes.jsonl")?.bytes ?? new Uint8Array())).not.toContain("export-hidden-envelope");

    const migrationJob = await createJob(platform, "hidden-legacy-migration", true, "migration");
    const migration = await writeExportBundle({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", job: migrationJob });
    const migrationObject = await platform.env.ARCHIVE_ASSETS.get(migration.objectKey);
    const migrationBytes = new Uint8Array(await migrationObject!.arrayBuffer());
    expect(() => verifyExportBundle(migrationBytes)).not.toThrow();
    const migrationArchive = parseStoredZip(migrationBytes);
    const migrationObjects = new TextDecoder().decode(migrationArchive.get("objects/objects.jsonl")!.bytes);
    expect(migrationObjects).toContain(seeded.objectId);
    expect(migrationObjects).toContain(native.objectId);
    expect(migrationObjects).not.toContain("export-user-b-entity");
    expect(migrationArchive.has(`documents/${malformedRevision.objectId}/index.md`)).toBe(false);
    for (const [path, forbidden] of [
      ["sources/source-items.jsonl", crossOwnerCapture.sources[0]!.id],
      ["objects/document-source-links.jsonl", crossOwnerCapture.sources[0]!.id],
      ["objects/processing-jobs.jsonl", "export-user-b-job"],
      ["objects/property-values.jsonl", "export-user-b-property"],
      ["objects/review-items.jsonl", "export-user-b-review"],
      ["objects/type-assignments.jsonl", "export-cross-type-assignment"],
    ] as const) {
      expect(new TextDecoder().decode(migrationArchive.get(path)?.bytes ?? new Uint8Array())).not.toContain(forbidden);
    }
    for (const [path, forbidden] of malformedCanonicalRows) {
      expect(new TextDecoder().decode(migrationArchive.get(path)?.bytes ?? new Uint8Array()), `${path} excludes ${forbidden}`).not.toContain(forbidden);
    }
    expect(new TextDecoder().decode(migrationArchive.get("objects/property-values.jsonl")?.bytes ?? new Uint8Array())).toContain("export-current-valid-property");
    expect(migrationArchive.has(`documents/${seeded.objectId}/index.md`)).toBe(true);
    expect(new TextDecoder().decode(migrationArchive.get(`documents/${native.objectId}/index.md`)!.bytes)).not.toContain("foreign_type_secret");
    expect(new TextDecoder().decode(migrationArchive.get(`documents/${native.objectId}/metadata.json`)!.bytes)).not.toContain("다른 사용자의 비밀 분류");
    expect(migrationArchive.has(`attachments/originals/${seeded.attachmentId}/large fixture.png`)).toBe(true);
    expect(new TextDecoder().decode(migrationArchive.get("migration/legacy-source-mappings.jsonl")!.bytes)).toContain("export-hidden-mapping");
    expect(new TextDecoder().decode(migrationArchive.get("migration/legacy-source-envelopes.jsonl")!.bytes)).toContain("export-hidden-envelope");
  }, 60_000);

  test("keeps the compact portable bundle literal", async () => {
    const platform = await createPlatform();
    await seedDocument(platform);
    const queued = await createJob(platform, "resumable-export-small-literal", false, "portable");
    const legacy = await writeExportBundle({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", job: queued });
    const legacyObject = await platform.env.ARCHIVE_ASSETS.get(legacy.objectKey);
    const legacyBytes = new Uint8Array(await legacyObject!.arrayBuffer());
    await platform.env.ARCHIVE_ASSETS.delete(legacy.objectKey);
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id });
    const completed = await drive({ db: new CountingD1(platform.env.DB), bucket: new FaultR2(platform.env.ARCHIVE_ASSETS), exportId: queued.id, max: 100 });
    const object = await platform.env.ARCHIVE_ASSETS.get(legacy.objectKey);
    const actual = new Uint8Array(await object!.arrayBuffer());
    if (actual.some((byte, index) => byte !== legacyBytes[index]) || actual.byteLength !== legacyBytes.byteLength) {
      const expectedZip = parseStoredZip(legacyBytes);
      const actualZip = parseStoredZip(actual);
      const paths = [...new Set([...expectedZip.keys(), ...actualZip.keys()])];
      const changed = paths.filter((path) => {
        const left = expectedZip.get(path)?.bytes;
        const right = actualZip.get(path)?.bytes;
        return !left || !right || left.byteLength !== right.byteLength || left.some((byte, index) => byte !== right[index]);
      });
      throw new Error(`literal mismatch: ${JSON.stringify({ expectedBytes: legacyBytes.byteLength, actualBytes: actual.byteLength, changed })}`);
    }
    expect(completed.bundleSha256).toBe(legacy.sha256);
  }, 60_000);

  test("packs a small original in a bounded batched-original step", async () => {
    const platform = await createPlatform();
    const seeded = await seedDocument(platform, { smallOriginal: true });
    const queued = await createJob(platform, "resumable-export-small-original", true, "portable");
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id });
    const completed = await drive({ db: new CountingD1(platform.env.DB), bucket: new FaultR2(platform.env.ARCHIVE_ASSETS), exportId: queued.id, max: 120 });
    const object = await platform.env.ARCHIVE_ASSETS.get(completed.bundleObjectKey!);
    const archive = parseStoredZip(new Uint8Array(await object!.arrayBuffer()));
    expect(archive.get(`attachments/originals/${seeded.attachmentId}/large fixture.png`)?.bytes).toHaveLength(8_193);
  }, 60_000);

  test("a stale expired lease cannot overwrite winner pending bytes or insert receipts", async () => {
    const platform = await createPlatform();
    await seedDocument(platform);
    const queued = await createJob(platform, "resumable-export-stale-lease", false, "portable");
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id });
    const bucket = new FaultR2(platform.env.ARCHIVE_ASSETS);
    await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:30:00.000Z" });
    bucket.pauseNextPendingPut();
    const staleAdvance = advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:30:01.000Z" });
    await bucket.waitForPausedPut();
    const staleAttempt = await platform.env.DB.prepare("select object_key from v2_export_pending_segments where export_id=? limit 1").bind(queued.id).first<{ object_key: string }>();
    expect(staleAttempt?.object_key).toMatch(new RegExp(`^${EXPORT_PENDING_OBJECT_PREFIX}`));
    await platform.env.DB.prepare("update v2_export_jobs set lease_expires_at='2026-08-28T13:29:59.000Z' where id=?").bind(queued.id).run();
    const winner = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:32:02.000Z" });
    expect(winner.progress.entriesComplete).toBe(0);
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_pending_segments where export_id=?").bind(queued.id).first()).resolves.toEqual({ value: 1 });
    await expect(platform.env.ARCHIVE_ASSETS.head(staleAttempt!.object_key)).resolves.toBeNull();
    bucket.releasePausedPut();
    await expect(staleAdvance).rejects.toMatchObject({ code: "export_advance_conflict" });
    const replayed = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:32:03.000Z" });
    expect(replayed.progress.entriesComplete).toBe(1);
    const winnerRow = await platform.env.DB.prepare("select pending_object_key,state_revision from v2_export_jobs where id=?").bind(queued.id).first<{ pending_object_key: string; state_revision: number }>();
    expect(winnerRow?.pending_object_key).toMatch(new RegExp(`^${EXPORT_PENDING_OBJECT_PREFIX}`));
    expect(winnerRow?.pending_object_key).not.toBe(staleAttempt?.object_key);
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_files where export_id=?").bind(queued.id).first()).resolves.toEqual({ value: 1 });
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_pending_segments where export_id=?").bind(queued.id).first()).resolves.toEqual({ value: 1 });
    await expect(platform.env.ARCHIVE_ASSETS.head(staleAttempt!.object_key)).resolves.toBeNull();
    await expect(platform.env.ARCHIVE_ASSETS.head(winnerRow!.pending_object_key)).resolves.toMatchObject({ size: expect.any(Number) });
  }, 60_000);

  test("retains a not-yet-visible stale receipt and later cleans a post-PUT crash orphan", async () => {
    const platform = await createPlatform();
    await seedDocument(platform);
    const queued = await createJob(platform, "resumable-export-delayed-stale-put", false, "portable");
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id });
    const bucket = new FaultR2(platform.env.ARCHIVE_ASSETS);
    await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:40:00.000Z" });

    const staleKey = `${EXPORT_PENDING_OBJECT_PREFIX}users/stale/exports/${queued.id}/crashed-after-put.bin`;
    const staleBytes = new TextEncoder().encode("registered-before-delayed-put");
    const staleHash = sha256Hex(staleBytes);
    await platform.env.DB.prepare(`insert into v2_export_pending_segments
      (export_id,user_id,object_key,lease_token,size_bytes,sha256,created_at) values (?,'user-a',?,'expired-stale-lease',?,?,?)`)
      .bind(queued.id, staleKey, staleBytes.byteLength, staleHash, "2026-08-28T13:40:00.500Z").run();

    const waiting = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:42:00.000Z" });
    expect(waiting.progress.entriesComplete).toBe(0);
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_pending_segments where export_id=? and object_key=?").bind(queued.id, staleKey).first()).resolves.toEqual({ value: 1 });

    await platform.env.ARCHIVE_ASSETS.put(staleKey, staleBytes);
    const resumed = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:42:01.000Z" });
    expect(resumed.progress.entriesComplete).toBe(1);
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_pending_segments where export_id=? and object_key=?").bind(queued.id, staleKey).first()).resolves.toEqual({ value: 0 });
    await expect(platform.env.ARCHIVE_ASSETS.head(staleKey)).resolves.toBeNull();
  }, 60_000);

  test("accepts 1,500-document manifest scale and fail-cleans only beyond the 10,000-entry archive cap", async () => {
    const platform = await createPlatform();
    const bucket = new FaultR2(platform.env.ARCHIVE_ASSETS);
    const current = await createJob(platform, "resumable-export-1500-doc-manifest", false, "portable");
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: current.id });
    await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: current.id, now: "2026-08-28T14:00:00.000Z" });
    await seedSyntheticManifestReceipts(platform.env.DB, current.id, 3_002, true);
    const accepted = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: current.id, now: "2026-08-28T14:00:01.000Z" });
    expect(accepted).toMatchObject({ status: "running", buildPhase: "central_directory", manifest: { counts: { documents: 1_500, attachments: 1 } } });
    expect(accepted.manifest?.files).toHaveLength(3_002);
    const estimatedSmallDocumentAdvances = Math.ceil(1_500 / EXPORT_MAX_DOCUMENTS_PER_ADVANCE) + canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION).length * 2 + 20;
    // v2-032 adds three prompt-curation tables (43 -> 46), putting this estimate at exactly 300.
    // The guarantee that matters is unchanged: a small-document export fits one 600-call user action.
    expect(estimatedSmallDocumentAdvances).toBeLessThanOrEqual(300);
    expect(exportUserActionsForAdvances(estimatedSmallDocumentAdvances)).toBe(1);
    expect(EXPORT_MAX_UNITS_PER_ADVANCE).toBe(32);
    const estimatedSourceOnlyMigrationAdvances = estimatedSmallDocumentAdvances + Math.ceil(1_355 / EXPORT_MAX_UNITS_PER_ADVANCE) * 4;
    expect(estimatedSourceOnlyMigrationAdvances).toBeLessThan(500);
    const currentR2Objects = 584;
    const currentR2Bytes = 3_809_946;
    const originalAdvances = Math.ceil(currentR2Objects / EXPORT_MAX_ORIGINALS_PER_ADVANCE)
      + Math.ceil(currentR2Bytes / (1024 * 1024)) + 2;
    const projectedEntries = 1 + 1_500 * 2 + canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION).length + currentR2Objects + 2;
    const centralAdvances = Math.ceil(projectedEntries / EXPORT_CENTRAL_RECEIPTS_PER_ADVANCE) + 1;
    // 64 MiB is the current-corpus planning envelope: over 16x the measured
    // legacy R2 bytes, with room for canonical/document text and ZIP headers.
    const verificationAdvances = Math.ceil((64 * 1024 * 1024) / EXPORT_VERIFY_CHUNK_BYTES);
    const worstCurrentAdvances = estimatedSourceOnlyMigrationAdvances + originalAdvances + centralAdvances + verificationAdvances;
    expect(EXPORT_ADVANCE_CALLS_PER_BATCH).toBe(50);
    expect(EXPORT_MAX_BATCHES_PER_USER_ACTION).toBe(12);
    expect(EXPORT_ADVANCE_CALLS_PER_USER_ACTION).toBe(600);
    // v2-031 adds four canonical tables (39 -> 43), moving this conservative
    // estimate from 595 to 603 advances. Keep the 600-call safety cap: this
    // corpus envelope may need one additional explicit Continue action.
    expect(exportUserActionsForAdvances(worstCurrentAdvances)).toBe(2);

    const over = await createJob(platform, "resumable-export-over-manifest-cap", false, "portable");
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: over.id });
    await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: over.id, now: "2026-08-28T14:01:00.000Z" });
    await seedSyntheticManifestReceipts(platform.env.DB, over.id, 9_999, false);
    const cleaning = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: over.id, now: "2026-08-28T14:01:01.000Z" });
    expect(cleaning).toMatchObject({ status: "running", buildPhase: "failure_cleanup", failureCode: "export_manifest_file_limit" });
    const failed = await advanceResumableExportWorkflow({ db: platform.env.DB, bucket, userId: "user-a", exportId: over.id, now: "2026-08-28T14:01:02.000Z" });
    expect(failed).toMatchObject({ status: "failed", failureCode: "export_manifest_file_limit" });
  }, 90_000);

  test("resumes across pages and an 8 MiB boundary, and is byte-identical to Export Bundle v1", async () => {
    const platform = await createPlatform();
    await seedDocument(platform, { largeOriginal: true });
    for (let index = 0; index < 20; index += 1) {
      await platform.env.DB.prepare("insert into v2_saved_views (id,user_id,view_key,name,icon_key,query_plan_json,display_json,source,status,pinned,created_at,updated_at) values (?,'user-a',?,?,?,'{}','{}','user_created','active',0,'2026-08-28T10:00:30.000Z','2026-08-28T10:00:30.000Z')")
        .bind(`export-view-${String(index).padStart(2, "0")}`, `export-view-${String(index).padStart(2, "0")}`, `내보내기 보기 ${index}`, "archive").run();
    }
    const queued = await createJob(platform, "resumable-export-literal", true);
    const legacy = await writeExportBundle({ db: platform.env.DB, bucket: platform.env.ARCHIVE_ASSETS, userId: "user-a", job: queued });
    const legacyObject = await platform.env.ARCHIVE_ASSETS.get(legacy.objectKey);
    const legacyBytes = new Uint8Array(await legacyObject!.arrayBuffer());
    await platform.env.ARCHIVE_ASSETS.delete(legacy.objectKey);

    const staged = await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id, now: "2026-08-28T10:02:00.000Z" });
    expect(staged).toMatchObject({ status: "queued", workflowVersion: 2, buildPhase: "staging" });
    const db = new CountingD1(platform.env.DB);
    const bucket = new FaultR2(platform.env.ARCHIVE_ASSETS);
    const initialized = await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T10:02:01.000Z" });
    expect(initialized).toMatchObject({ status: "running", buildPhase: "packaging" });

    const activeRevision = initialized.stateRevision;
    await platform.env.DB.prepare("update v2_export_jobs set lease_token='other-owner',lease_expires_at='2026-08-28T10:04:00.000Z' where id=?").bind(queued.id).run();
    const duplicate = await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T10:03:00.000Z" });
    expect(duplicate.stateRevision).toBe(activeRevision);
    await platform.env.DB.prepare("update v2_export_jobs set lease_expires_at='2026-08-28T10:02:59.000Z' where id=?").bind(queued.id).run();

    bucket.failNextPut = true;
    await expect(advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T10:03:01.000Z" }))
      .rejects.toMatchObject({ code: "export_retryable_storage_error" });
    await expect(platform.env.DB.prepare("select status,lease_token from v2_export_jobs where id=?").bind(queued.id).first())
      .resolves.toEqual({ status: "running", lease_token: null });

    const completed = await drive({ db, bucket, exportId: queued.id });
    expect(completed).toMatchObject({ status: "succeeded", buildPhase: "complete", bundleSizeBytes: legacy.bytes });
    const finalObject = await platform.env.ARCHIVE_ASSETS.get(legacy.objectKey);
    const finalBytes = new Uint8Array(await finalObject!.arrayBuffer());
    // Keep exact byte equality without constructing a multi-million-element
    // assertion diff, which can exhaust the test worker's heap on Linux.
    expect(finalBytes.byteLength).toBe(legacyBytes.byteLength);
    expect(finalBytes.findIndex((byte, index) => byte !== legacyBytes[index])).toBe(-1);
    expect(completed.bundleSha256).toBe(legacy.sha256);
    const parsed = parseStoredZip(finalBytes, { maxFiles: 10_000, maxTotalBytes: 50_000_000, maxEntryBytes: 20_000_000 });
    expect(parsed.has("README.md")).toBe(true);
    expect(parsed.has("manifest.json")).toBe(true);
    expect(parsed.has("checksums.sha256")).toBe(true);
    expect([...parsed.keys()].some((path) => path.startsWith("attachments/originals/export-large-original/"))).toBe(true);
    const parts = await platform.env.DB.prepare("select part_number,size_bytes from v2_export_multipart_parts where export_id=? order by part_number").bind(queued.id).all<{ part_number: number; size_bytes: number }>();
    expect(parts.results.length).toBeGreaterThan(1);
    expect(parts.results.slice(0, -1).every((part) => part.size_bytes === EXPORT_MULTIPART_PART_BYTES)).toBe(true);
    expect(parts.results.reduce((total, part) => total + part.size_bytes, 0)).toBe(finalBytes.byteLength);
    // With v2-032 tables this takes ~171s alone (2026-09-28); the full suite adds contention. Assertions are unchanged.
  }, 300_000);

  test("fails closed on source mutation and aborts/cleans multipart state", async () => {
    const platform = await createPlatform();
    await seedDocument(platform);
    const queued = await createJob(platform, "resumable-export-source-change", false);
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id });
    const db = new CountingD1(platform.env.DB);
    const bucket = new FaultR2(platform.env.ARCHIVE_ASSETS);
    await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T12:00:00.000Z" });
    await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T12:00:01.000Z" });
    await platform.env.DB.prepare("insert into v2_change_events (user_id,aggregate_kind,aggregate_id,operation,occurred_at) values ('user-a','object','changed-during-export','upsert','2026-08-28T12:00:02.000Z')").run();
    const cleaning = await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T12:00:03.000Z" });
    expect(cleaning).toMatchObject({ status: "running", buildPhase: "failure_cleanup", failureCode: "export_source_changed_retry" });
    const failed = await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T12:00:04.000Z" });
    expect(failed).toMatchObject({ status: "failed", buildPhase: "complete", failureCode: "export_source_changed_retry" });
    expect(bucket.aborts).toBeGreaterThan(0);
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_files where export_id=?").bind(queued.id).first()).resolves.toEqual({ value: 0 });
    await expect(platform.env.DB.prepare("select count(*) as value from v2_export_multipart_parts where export_id=?").bind(queued.id).first()).resolves.toEqual({ value: 0 });
  }, 60_000);

  test("detects a corrupt persisted pending segment before advancing and cleans it", async () => {
    const platform = await createPlatform();
    await seedDocument(platform);
    const queued = await createJob(platform, "resumable-export-corrupt-pack", false);
    await stageResumableExportWorkflow({ db: platform.env.DB, userId: "user-a", exportId: queued.id });
    const db = new CountingD1(platform.env.DB);
    const bucket = new FaultR2(platform.env.ARCHIVE_ASSETS);
    await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:00:00.000Z" });
    await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:00:01.000Z" });
    const pending = await platform.env.DB.prepare("select pending_object_key from v2_export_jobs where id=?").bind(queued.id).first<{ pending_object_key: string }>();
    expect(pending?.pending_object_key).toBeTruthy();
    await platform.env.ARCHIVE_ASSETS.put(pending!.pending_object_key, "corrupt");
    const cleaning = await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:00:02.000Z" });
    expect(cleaning).toMatchObject({ status: "running", buildPhase: "failure_cleanup" });
    const failed = await advanceResumableExportWorkflow({ db, bucket, userId: "user-a", exportId: queued.id, now: "2026-08-28T13:00:03.000Z" });
    expect(failed).toMatchObject({ status: "failed", failureCode: "export_pending_corrupt" });
    await expect(platform.env.ARCHIVE_ASSETS.head(pending!.pending_object_key)).resolves.toBeNull();
  }, 60_000);
});
