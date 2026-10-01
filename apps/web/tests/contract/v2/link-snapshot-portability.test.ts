import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { createLinkSourceFingerprint, hashLinkSourceManifest, LINK_SNAPSHOT_MANIFEST_VERSION } from "@/lib/v2/domain/link-snapshot-v1";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { backupRootHash, createBackupSnapshot, validateBackupManifest } from "@/lib/v2/portability/backup-snapshot-v1";
import { CANONICAL_TABLES_V1, canonicalTablesForSchemaVersion, RESTORE_TABLE_ORDER_V2 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { writeExportBundle } from "@/lib/v2/portability/export-bundle-v1";
import { canonicalJson, exportRootHash, LIGHTHOUSE_SCHEMA_VERSION, sha256Hex, unwrapCanonicalRow } from "@/lib/v2/portability/portability-contract-v1";
import { advanceBackupWorkflow, stageBackupWorkflow } from "@/lib/v2/portability/resumable-backup-v2";
import { advanceRestoreWorkflow, approveRestoreWorkflow, stageArchiveRestore } from "@/lib/v2/portability/resumable-restore-v2";
import { createRestoreDryRun, importVerifiedBundle, sanitizeRestoredLinkJob, validateCanonicalArchiveFiles, validateReferenceClosure, verifyExportBundle, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";
import { createStoredZipStream, type StreamingZipEntry } from "@/lib/v2/portability/zip-stream-v1";

type TestD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
type TestEnv = { DB: TestD1; ARCHIVE_ASSETS: R2BucketBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<TestEnv>>>;
const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationsPath = fileURLToPath(new URL("../../../../../migrations", import.meta.url));
const platforms: Platform[] = [];
const now = "2026-09-08T09:00:00.000Z";
const rawText = "  portrait 👤\r\n  warm light\n";
let source: Platform;
let fixture: Awaited<ReturnType<typeof seed>>;
let archive: { bytes: Uint8Array; bundle: VerifiedExportBundle };

async function platform() {
  const value = await getPlatformProxy<TestEnv>({ configPath, persist: false, remoteBindings: false });
  platforms.push(value);
  await value.env.DB.exec("create table users(id text primary key not null); insert into users values ('owner'),('other'),('target'),('backup-owner'),('workflow-owner'),('workflow-full-owner');");
  const names = (await readdir(migrationsPath)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort();
  for (const name of names) for (const statement of (await readFile(`${migrationsPath}/${name}`, "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await value.env.DB.prepare(statement).run();
  return value;
}

async function seed(value: Platform, userId: string, prefix: string, privacyLevel: "normal" | "restricted" = "normal") {
  const prepared = await prepareCaptureCommit({ draftId: prefix, channel: "web", title: "Link archive fixture", bodyMarkdown: "My note, not the external author.", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now,
    sources: [rawText, "negative: blur"].map((text, index) => ({ kind: "url", rawText: text, contentHash: `sha256:${sha256Hex(text)}`, metadata: { manualLinkV1: { contract: "manual-link-source.v1", url: `https://www.threads.com/@fixture/post/${index}`, canonicalUrl: `https://www.threads.com/@fixture/post/${index}`, provider: "threads", purpose: "prompt", role: index ? "negative_prompt" : "prompt", completeness: "complete", publisher: "Fixture author", partNumber: index + 1, totalParts: 2, startSeconds: null, endSeconds: null } } })),
  }, prefix, now);
  await new D1SourceFoundationRepository(value.env.DB, userId).commitCapture(prepared);
  const sources = prepared.sources.slice(1);
  const fingerprints = await Promise.all(sources.map((item) => createLinkSourceFingerprint({ kind: item.kind, contentHash: item.contentHash, rawText: item.rawText, metadata: JSON.parse(item.metadataJson!), attachments: [] })));
  const snapshots = [];
  for (let version = 1; version <= 2; version += 1) {
    const id = `${prefix}-${version === 1 ? "z-parent" : "a-child"}`;
    const members = sources.map((item, index) => ({ id: `${id}-member-${index}`, sourceItemId: item.id, memberKey: `stable-member-${index}`, sourceOrder: index, sourceFingerprint: fingerprints[index] }));
    const manifestHash = await hashLinkSourceManifest({ members });
    await value.env.DB.prepare("insert into v2_link_snapshots(id,user_id,document_object_id,capture_id,parent_snapshot_id,snapshot_version,manifest_version,manifest_hash,acquisition_method,adapter_version,capture_state,coverage_json,created_at) values (?,?,?,?,?,?,?,?,'user_paste','fixture.v1','captured','{}',?)")
      .bind(id, userId, prepared.objectId, prepared.captureId, snapshots[0]?.id ?? null, version, LINK_SNAPSHOT_MANIFEST_VERSION, manifestHash, now).run();
    for (const member of members) await value.env.DB.prepare("insert into v2_link_snapshot_sources(id,user_id,snapshot_id,source_item_id,member_key,source_order,source_fingerprint) values (?,?,?,?,?,?,?)").bind(member.id, userId, id, member.sourceItemId, member.memberKey, member.sourceOrder, member.sourceFingerprint).run();
    snapshots.push({ id, manifestHash, members });
  }
  const current = snapshots[1];
  for (const [suffix, status] of [["done", "succeeded"], ["pending", "leased"]] as const) {
    await value.env.DB.prepare("insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at,lease_owner,lease_expires_at,input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version) values (?,?,?,?,'link_analyze',?,?,3,?,?,?,?,?,?,?, ?,?)")
      .bind(`${prefix}-${suffix}-job`, userId, prepared.captureId, prepared.objectId, status, `${prefix}-original-${suffix}-key`, now, prepared.revisionId, current.manifestHash, now, suffix === "pending" ? "source-worker" : null, suffix === "pending" ? "2099-01-01T00:00:00.000Z" : null, current.id, current.manifestHash, LINK_SNAPSHOT_MANIFEST_VERSION).run();
  }
  await value.env.DB.prepare("insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at) values (?,?,?,'main_analyzer','synthetic','fixture.v1','fixture.v1','fixture.v1','fixture.v1',?,'succeeded',?)").bind(`${prefix}-run`, `${prefix}-done-job`, userId, current.manifestHash, now).run();
  await value.env.DB.prepare("insert into v2_link_fragments(id,user_id,document_object_id,snapshot_id,primary_member_id,processing_run_id,fragment_key,role,source_class,text_start,text_end,raw_text,raw_text_hash,completeness,display_order,review_status,locked_by_user,created_at) values (?,?,?,?,?,?,'prompt-0','prompt','source_extract',0,?,?,?,'complete',0,'confirmed',1,?)").bind(`${prefix}-fragment`, userId, prepared.objectId, current.id, current.members[0].id, `${prefix}-run`, rawText.length, rawText, sha256Hex(rawText), now).run();
  await value.env.DB.prepare("insert into v2_link_fragment_evidence(id,user_id,fragment_id,member_id,relation_kind,evidence_method,display_order,locked_by_user,created_at) values (?,?,?,?,'supports','user_confirmed',0,1,?)").bind(`${prefix}-evidence`, userId, `${prefix}-fragment`, current.members[1].id, now).run();
  await value.env.DB.prepare("update v2_documents set current_link_snapshot_id=?,link_snapshot_version=2,published_link_run_id=? where object_id=?").bind(current.id, `${prefix}-run`, prepared.objectId).run();
  return { prepared, snapshots, prefix };
}

async function exportArchive(value: Platform, userId: string) {
  const repository = new D1PortabilityRepository(value.env.DB, userId);
  const job = await repository.createExport({ profile: "migration", scope: { objects: "all", privacyLevels: ["normal"], includeTrash: true, includeHistory: true, includeOriginals: true }, idempotencyKey: `export-${userId}`, now });
  const claimed = await repository.claimExport(job.id, now);
  const written = await writeExportBundle({ db: value.env.DB, bucket: value.env.ARCHIVE_ASSETS, userId, job: claimed });
  const object = await value.env.ARCHIVE_ASSETS.get(written.objectKey);
  const bytes = new Uint8Array(await object!.arrayBuffer());
  return { bytes, bundle: verifyExportBundle(bytes) };
}

async function historicalArchive() {
  const counts: Record<string, number> = {};
  const payloads = [{ path: "README.md", source: "Synthetic pre-snapshot v2-030 fixture", records: 0, mediaType: "text/markdown" }];
  for (const descriptor of canonicalTablesForSchemaVersion("v2-030")) {
    const rows = (descriptor.table === "v2_processing_jobs" || descriptor.table === "v2_processing_runs" ? [] : archive.bundle.rowsByTable.get(descriptor.table) ?? []).map((row) => {
      const value = { ...row, schema_version: "v2-030" } as Record<string, unknown>;
      if (descriptor.table === "v2_documents") for (const column of ["current_link_snapshot_id", "link_snapshot_version", "published_link_run_id"]) delete value[column];
      return value;
    });
    counts[descriptor.table] = rows.length;
    payloads.push({ path: descriptor.path, source: rows.map(canonicalJson).join("\n") + (rows.length ? "\n" : ""), records: rows.length, mediaType: "application/x-ndjson" });
  }
  const files = payloads.map((payload) => ({ path: payload.path, bytes: new TextEncoder().encode(payload.source).byteLength, mediaType: payload.mediaType, sha256: sha256Hex(payload.source), records: payload.records }));
  const manifest = { ...archive.bundle.manifest, schemaVersion: "v2-030" as const, files, counts, rootHash: exportRootHash(files) };
  async function* entries(): AsyncGenerator<StreamingZipEntry> {
    for (const payload of payloads) yield payload;
    yield { path: "manifest.json", source: canonicalJson(manifest) };
    yield { path: "checksums.sha256", source: files.map((file) => `${file.sha256}  ${file.path}\n`).join("") };
  }
  return new Uint8Array(await new Response(createStoredZipStream(entries())).arrayBuffer());
}

beforeAll(async () => {
  source = await platform();
  fixture = await seed(source, "owner", "main");
  await seed(source, "owner", "restricted", "restricted");
  await seed(source, "other", "other");
  archive = await exportArchive(source, "owner");
}, 90_000);
afterAll(async () => { await Promise.all(platforms.map((value) => value.dispose())); });

async function collisionTarget() {
  const target = await platform();
  await seed(target, "other", "main");
  await target.env.DB.prepare("insert into v2_objects(id,user_id,object_kind,lifecycle_status,created_at,updated_at) values (?,'other','entity','active',?,?)").bind(fixture.prepared.objectId, now, now).run();
  const unrelated = await prepareCaptureCommit({ draftId: "unrelated-target", channel: "web", title: "Unrelated target record", bodyMarkdown: "Existing target work must not be replaced.", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now }, "unrelated-target", now);
  await new D1SourceFoundationRepository(target.env.DB, "target").commitCapture(unrelated);
  await target.env.DB.prepare("insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at) values ('existing-target-key-owner','target',?,?,'analyze','queued','main-original-pending-key',3,?,?,?,?)")
    .bind(unrelated.captureId, unrelated.objectId, now, unrelated.revisionId, sha256Hex("unrelated"), now).run();
  return target;
}

async function assertRestored(value: Platform, userId: string) {
  const snapshots = (await value.env.DB.prepare("select * from v2_link_snapshots where user_id=? order by snapshot_version").bind(userId).all<Record<string, unknown>>()).results;
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0].parent_snapshot_id).toBeNull();
  expect(snapshots[1].parent_snapshot_id).toBe(snapshots[0].id);
  expect(snapshots.map((row) => row.manifest_hash)).toEqual(fixture.snapshots.map((row) => row.manifestHash));
  const document = await value.env.DB.prepare("select * from v2_documents where object_id=?").bind(snapshots[1].document_object_id).first<Record<string, unknown>>();
  expect(document).toMatchObject({ current_link_snapshot_id: snapshots[1].id, link_snapshot_version: 2 });
  const fragment = await value.env.DB.prepare("select * from v2_link_fragments where user_id=?").bind(userId).first<Record<string, unknown>>();
  expect(fragment).toMatchObject({ snapshot_id: snapshots[1].id, document_object_id: snapshots[1].document_object_id, raw_text: rawText, raw_text_hash: sha256Hex(rawText), locked_by_user: 1 });
  expect(document!.published_link_run_id).toBe(fragment!.processing_run_id);
  const members = (await value.env.DB.prepare("select member_key,source_order,source_fingerprint from v2_link_snapshot_sources where snapshot_id=? order by source_order").bind(snapshots[1].id).all<Record<string, unknown>>()).results;
  expect(members).toEqual(fixture.snapshots[1].members.map((member) => ({ member_key: member.memberKey, source_order: member.sourceOrder, source_fingerprint: member.sourceFingerprint })));
  const evidence = await value.env.DB.prepare("select * from v2_link_fragment_evidence where user_id=?").bind(userId).first<Record<string, unknown>>();
  expect(evidence).toMatchObject({ fragment_id: fragment!.id, evidence_method: "user_confirmed", locked_by_user: 1 });
  const jobs = (await value.env.DB.prepare("select * from v2_processing_jobs where user_id=? and stage='link_analyze'").bind(userId).all<Record<string, unknown>>()).results;
  expect(jobs).toHaveLength(2);
  expect(jobs.find((row) => row.status === "superseded")).toMatchObject({ lease_owner: null, lease_expires_at: null, last_error_code: "restore_audit_only", input_link_snapshot_id: snapshots[1].id });
  expect(jobs.every((row) => String(row.idempotency_key).startsWith("restored-link:"))).toBe(true);
  expect(jobs.every((row) => !String(row.idempotency_key).includes("original"))).toBe(true);
  expect(new Set(jobs.map((row) => row.idempotency_key)).size).toBe(2);
  expect(await value.env.DB.prepare("select count(*) as count from v2_processing_outbox where user_id=?").bind(userId).first()).toEqual({ count: 0 });
  return snapshots;
}

// Archive verification/materialization is covered by the archive workflow above.
// This fixture starts at its durable hand-off to isolate repeated-import planning
// against the exact normalized graph that a first restore would have written.
async function stageRepeatedRestore(target: Platform, batchId: string) {
  let rowCount = 0;
  const staged: { table: string; key: string; hash: string; json: string; position: number }[] = [];
  for (const [tableIndex, descriptor] of RESTORE_TABLE_ORDER_V2.entries()) {
    const rows = [...archive.bundle.rowsByTable.get(descriptor.table) ?? []];
    if (descriptor.table === "v2_link_snapshots") rows.sort((a, b) => Number(a.snapshot_version) - Number(b.snapshot_version));
    for (const [rowIndex, envelope] of rows.entries()) {
      const original = unwrapCanonicalRow(envelope, descriptor.table);
      const normalized = sanitizeRestoredLinkJob(descriptor.table, { ...original, ...("user_id" in original ? { user_id: "target" } : {}) });
      const columns = Object.keys(normalized);
      await target.env.DB.prepare(`insert into ${descriptor.table} (${columns.map((column) => `"${column}"`).join(",")}) values (${columns.map(() => "?").join(",")})`).bind(...columns.map((column) => normalized[column])).run();
      staged.push({ table: descriptor.table, key: canonicalJson(Object.fromEntries(descriptor.primaryKey.map((column) => [column, original[column]]))), hash: sha256Hex(canonicalJson(original)), json: canonicalJson(envelope), position: tableIndex * 1_000_000_000_000 + rowIndex });
      rowCount += 1;
    }
  }
  const summary = {
    sourceKind: "archive", counts: { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 },
    manifest: archive.bundle.manifest,
    tables: RESTORE_TABLE_ORDER_V2.map((descriptor) => ({ table: descriptor.table, rows: 0, create: 0, reuse: 0, fork: 0, conflict: 0 })),
    warnings: [], indexedFiles: 0, verifiedFiles: 0, materializedRows: rowCount, rollbackPreserved: 0,
  };
  await target.env.DB.prepare(`insert into v2_restore_batches
    (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_size_bytes,cursor_json,state_revision,last_progress_at)
    values (?,'target',?,?,?,'pending','planning',?,'{}',?,2,'archive',0,'{}',0,?)`)
    .bind(batchId, batchId, archive.bundle.archiveSha256, archive.bundle.manifest.rootHash, canonicalJson(summary), now, now).run();
  for (const row of staged) await target.env.DB.prepare(`insert into v2_restore_rows
    (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,source_row_json,candidate_row_json,plan_position,apply_status,rollback_status,r2_status,updated_at)
    values (?,?,?,?,'pending','{}',?,?,'{}',?,'pending','not_applicable','not_applicable',?)`)
    .bind(batchId, row.table, row.key, row.hash, now, row.json, row.position, now).run();
  return { rowCount, staged };
}

describe("link snapshot canonical portability", () => {
  test("exports only the scoped owner graph and validates document/capture/member identities", () => {
    expect(archive.bundle.manifest.schemaVersion).toBe("v2-032");
    expect(archive.bundle.rowsByTable.get("v2_link_snapshots")).toHaveLength(2);
    expect(archive.bundle.rowsByTable.get("v2_link_snapshot_sources")).toHaveLength(4);
    expect(archive.bundle.rowsByTable.get("v2_link_fragments")).toHaveLength(1);
    const corrupted = new Map(archive.bundle.rowsByTable);
    corrupted.set("v2_link_snapshot_sources", archive.bundle.rowsByTable.get("v2_link_snapshot_sources")!.map((row, index) => index ? row : { ...row, user_id: "other" }));
    expect(() => validateReferenceClosure(corrupted)).toThrow(/inconsistent owner/);
    const invalidPointer = new Map(archive.bundle.rowsByTable);
    invalidPointer.set("v2_documents", archive.bundle.rowsByTable.get("v2_documents")!.map((row) => ({ ...row, current_link_snapshot_id: fixture.snapshots[0].id })));
    expect(() => validateReferenceClosure(invalidPointer)).toThrow(/inconsistent owner/);
  });

  test("keeps v2-030 archives supported and rejects missing current canonical members", () => {
    expect(canonicalTablesForSchemaVersion("v2-030").some((row) => row.table.startsWith("v2_link_"))).toBe(false);
    expect(CANONICAL_TABLES_V1.length - canonicalTablesForSchemaVersion("v2-030").length).toBe(7);
    const oldPaths = new Set(canonicalTablesForSchemaVersion("v2-030").map((row) => row.path));
    const oldFiles = archive.bundle.manifest.files.filter((file) => !file.path.includes("link-") || oldPaths.has(file.path));
    expect(() => validateCanonicalArchiveFiles({ ...archive.bundle.manifest, schemaVersion: "v2-030", files: oldFiles, rootHash: exportRootHash(oldFiles) })).not.toThrow();
    const files = archive.bundle.manifest.files.filter((file) => file.path !== "sources/link-snapshots.jsonl");
    expect(() => validateCanonicalArchiveFiles({ ...archive.bundle.manifest, files, rootHash: exportRootHash(files) })).toThrow(/missing sources\/link-snapshots/);
  });

  test("verifies and restores a complete historical v2-030 archive without inventing snapshots", async () => {
    const historical = verifyExportBundle(await historicalArchive());
    expect(historical.manifest.schemaVersion).toBe("v2-030");
    expect(historical.rowsByTable.has("v2_link_snapshots")).toBe(false);
    const target = await platform();
    const dryRun = await createRestoreDryRun(target.env.DB, "target", historical);
    await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", bundle: historical, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "historical-restore", now });
    expect(await target.env.DB.prepare("select current_link_snapshot_id,link_snapshot_version,published_link_run_id from v2_documents").first()).toEqual({ current_link_snapshot_id: null, link_snapshot_version: 0, published_link_run_id: null });
    expect(await target.env.DB.prepare("select count(*) as count from v2_link_snapshots").first()).toEqual({ count: 0 });
  }, 90_000);

  test("restores a forked two-snapshot graph, soft pointers, exact text and audit-only jobs using legacy import", async () => {
    const target = await collisionTarget();
    const dryRun = await createRestoreDryRun(target.env.DB, "target", archive.bundle);
    expect(dryRun.counts.fork).toBeGreaterThan(4);
    const result = await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", bundle: archive.bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "legacy-link-restore", now });
    expect(result.status).toBe("succeeded");
    const snapshots = await assertRestored(target, "target");
    expect(snapshots[1].id).not.toBe(fixture.snapshots[1].id);
    expect(snapshots[1].document_object_id).not.toBe(fixture.prepared.objectId);
    expect(await target.env.DB.prepare("select id,status from v2_processing_jobs where user_id='target' and idempotency_key='main-original-pending-key'").first()).toEqual({ id: "existing-target-key-owner", status: "queued" });
  }, 120_000);

  test("resumable restore plans parent-first, remaps all soft pointers and never resumes imported provider work", async () => {
    const target = await collisionTarget();
    const staged = await stageArchiveRestore({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", idempotencyKey: "workflow-link-restore", archiveSha256: sha256Hex(archive.bytes), fileName: "links.zip", body: archive.bytes, sizeBytes: archive.bytes.byteLength, now });
    let view = staged;
    for (let step = 0; step < 600 && !["awaiting_approval", "failed"].includes(view.status); step += 1) view = await advanceRestoreWorkflow({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId: staged.batchId, now });
    expect(view.status, JSON.stringify(view)).toBe("awaiting_approval");
    expect(view.dryRun!.counts.fork).toBeGreaterThan(4);
    view = await approveRestoreWorkflow({ db: target.env.DB, userId: "target", batchId: staged.batchId, expectedDryRunHash: view.dryRun!.dryRunHash, expectedRevision: view.stateRevision, now });
    for (let step = 0; step < 600 && !["succeeded", "failed"].includes(view.status); step += 1) view = await advanceRestoreWorkflow({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId: staged.batchId, now });
    expect(view.status, JSON.stringify(view)).toBe("succeeded");
    await assertRestored(target, "target");
    expect(await target.env.DB.prepare("select id,status from v2_processing_jobs where user_id='target' and idempotency_key='main-original-pending-key'").first()).toEqual({ id: "existing-target-key-owner", status: "queued" });
    // 0032 prompt-curation tables add restore steps; measured 184s alone on 2026-09-28. Assertions are unchanged.
  }, 300_000);

  test("repeated restore reuses the same normalized graph with deferred document pointers", async () => {
    const target = await platform();
    const batchId = "repeat-normalized-link-restore";
    const prepared = await stageRepeatedRestore(target, batchId);
    let view = await advanceRestoreWorkflow({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId, now });
    for (let step = 0; step < 600 && !["awaiting_approval", "failed"].includes(view.status); step += 1) view = await advanceRestoreWorkflow({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId, now });
    expect(view.status, JSON.stringify(view)).toBe("awaiting_approval");
    expect(view.dryRun!.counts).toEqual({ create: 0, reuse: prepared.rowCount, fork: 0, conflict: 0, invalid: 0 });
    view = await approveRestoreWorkflow({ db: target.env.DB, userId: "target", batchId, expectedDryRunHash: view.dryRun!.dryRunHash, expectedRevision: view.stateRevision, now });
    for (let step = 0; step < 600 && !["succeeded", "failed"].includes(view.status); step += 1) view = await advanceRestoreWorkflow({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId: "target", batchId, now });
    expect(view.status, JSON.stringify(view)).toBe("succeeded");
    await assertRestored(target, "target");
    expect(await target.env.DB.prepare("select count(*) as count from v2_documents").first()).toEqual({ count: 1 });
    expect(await target.env.DB.prepare("select count(*) as count from v2_objects").first()).toEqual({ count: 1 });
    for (const row of prepared.staged) expect(await target.env.DB.prepare("select source_row_json,source_row_hash from v2_restore_rows where restore_batch_id=? and table_name=? and row_key=?").bind(batchId, row.table, row.key).first()).toEqual({ source_row_json: row.json, source_row_hash: row.hash });
    expect(archive.bundle.rowsByTable.get("v2_processing_jobs")!.find((row) => row.id === "main-pending-job")).toMatchObject({ status: "leased", idempotency_key: "main-original-pending-key", lease_owner: "source-worker" });
  }, 180_000);

  test("full plus incremental backup records all four new change kinds and restores into a fresh database", async () => {
    const userId = "backup-owner";
    const base = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, kind: "full", now });
    await seed(source, userId, "delta");
    const delta = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, kind: "incremental", now });
    expect(delta.baseSnapshotId).toBe(base.snapshotId);
    const kinds = (await source.env.DB.prepare("select distinct aggregate_kind from v2_change_events where user_id=? and sequence>? and aggregate_kind like 'link_%'").bind(userId, base.endSequence).all<{ aggregate_kind: string }>()).results.map((row) => row.aggregate_kind);
    expect(kinds.sort()).toEqual(["link_fragment", "link_fragment_evidence", "link_snapshot", "link_snapshot_source"]);
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: delta.snapshotId });
    const target = await platform();
    const dryRun = await createRestoreDryRun(target.env.DB, userId, bundle);
    await importVerifiedBundle({ db: target.env.DB, bucket: target.env.ARCHIVE_ASSETS, userId, bundle, expectedDryRunHash: dryRun.dryRunHash, idempotencyKey: "delta-restore", now });
    await assertRestored(target, userId);
    await source.env.DB.prepare("delete from v2_link_fragment_evidence where id='delta-evidence'").run();
    const deleted = await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, kind: "incremental", now });
    const tombstoneBundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: deleted.snapshotId });
    expect(tombstoneBundle.rowsByTable.get("v2_link_fragment_evidence")).toHaveLength(0);
  }, 180_000);

  test("resumable backup includes new table delta metadata and enforces version-specific manifest coverage", async () => {
    const userId = "workflow-owner";
    await createBackupSnapshot({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, kind: "full", now });
    await seed(source, userId, "workflow-delta");
    let result = await stageBackupWorkflow({ db: source.env.DB, userId, kind: "incremental", idempotencyKey: "link-incremental", now });
    for (let step = 0; step < 600 && !["succeeded", "failed"].includes(result.status); step += 1) result = await advanceBackupWorkflow({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: result.snapshotId, now });
    expect(result.status, JSON.stringify(result)).toBe("succeeded");
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: result.snapshotId });
    expect(bundle.rowsByTable.get("v2_link_snapshots")).toHaveLength(2);
    expect(bundle.rowsByTable.get("v2_link_fragment_evidence")).toHaveLength(1);
    const row = await source.env.DB.prepare("select manifest_object_key from v2_backup_snapshots where id=?").bind(result.snapshotId).first<{ manifest_object_key: string }>();
    const object = await source.env.ARCHIVE_ASSETS.get(row!.manifest_object_key);
    const manifest = validateBackupManifest(JSON.parse(new TextDecoder().decode(await object!.arrayBuffer())));
    expect(manifest.schemaVersion).toBe(LIGHTHOUSE_SCHEMA_VERSION);
    expect(Object.entries(manifest.metadataModes).filter(([path]) => path.includes("link-")).every(([, mode]) => mode === "delta")).toBe(true);
    expect(() => validateBackupManifest({ ...manifest, metadataFiles: manifest.metadataFiles.filter((file) => !file.path.startsWith("sources/link-snapshots.jsonl")) })).toThrow(/metadata_contract/);
    const historical = { ...manifest, schemaVersion: "v2-030" as const, metadataFiles: manifest.metadataFiles.filter((file) => !file.path.includes("link-")), metadataModes: Object.fromEntries(Object.entries(manifest.metadataModes).filter(([path]) => !path.includes("link-"))) };
    expect(validateBackupManifest({ ...historical, rootHash: backupRootHash(historical) }).schemaVersion).toBe("v2-030");
    expect(canonicalJson(bundle.rowsByTable.get("v2_link_snapshots"))).toContain(fixture.snapshots[0].manifestHash);
  }, 180_000);

  test("resumable backup full workflow preserves the same canonical graph without a base", async () => {
    const userId = "workflow-full-owner";
    await seed(source, userId, "workflow-full");
    let result = await stageBackupWorkflow({ db: source.env.DB, userId, kind: "full", idempotencyKey: "link-full", now });
    for (let step = 0; step < 600 && !["succeeded", "failed"].includes(result.status); step += 1) result = await advanceBackupWorkflow({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: result.snapshotId, now });
    expect(result.status, JSON.stringify(result)).toBe("succeeded");
    const bundle = await materializeVerifiedBackup({ db: source.env.DB, bucket: source.env.ARCHIVE_ASSETS, userId, snapshotId: result.snapshotId });
    expect(bundle.rowsByTable.get("v2_link_snapshots")).toHaveLength(2);
    expect(bundle.rowsByTable.get("v2_link_snapshot_sources")).toHaveLength(4);
    expect(bundle.rowsByTable.get("v2_link_fragments")).toHaveLength(1);
    expect(bundle.rowsByTable.get("v2_link_fragment_evidence")).toHaveLength(1);
  }, 180_000);
});
