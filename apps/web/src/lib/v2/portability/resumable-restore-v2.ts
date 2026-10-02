import { createHash } from "node:crypto";
import { ulid } from "ulidx";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding, R2ObjectBodyBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import {
  runWorkflowLeaseFencedBatch,
  runRestoreTransitionFencedBatch,
  WorkflowLeaseLostError,
  d1ResultChanges,
} from "@/lib/v2/infrastructure/d1/workflow-lease-fence-v1";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";
import { normalizeLegacyRestoreRow } from "@/lib/v2/portability/legacy-restore-compatibility";
import {
  BACKUP_DELTA_OPERATION_FIELD,
  backupBasePath,
  isBackupDeltaTombstone,
  rollbackTombstoneAggregateKind,
  uploadVerifiedStream,
  validateBackupManifest,
  type BackupManifestV1,
} from "@/lib/v2/portability/backup-snapshot-v1";
import {
  CANONICAL_TABLE_BY_NAME,
  CANONICAL_TABLE_BY_PATH,
  CANONICAL_TABLES_V1,
  CANONICAL_SOFT_REFERENCES_V1,
  RESTORE_TABLE_ORDER_V2,
  type CanonicalTableDescriptor,
} from "@/lib/v2/portability/canonical-table-registry-v1";
import {
  canonicalJson,
  sha256Hex,
  unwrapCanonicalRow,
  SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS,
  validateExportManifest,
  type ExportManifestV1,
  type LighthouseSchemaVersion,
} from "@/lib/v2/portability/portability-contract-v1";
import { RestoreContractError, sanitizeRestoredLinkJob, validateCanonicalArchiveFiles, validateCurationChildCounts, validateLinkRestoreRow, type RestoreDryRun } from "@/lib/v2/portability/restore-bundle-v1";
import { assertSafeZipPath, crc32 } from "@/lib/v2/portability/zip-stream-v1";

const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_ARCHIVE_FILES = 10_000;
const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_CHAIN_DEPTH = 128;
const MATERIALIZE_WINDOW_BYTES = 2 * 1024 * 1024;
const INDEX_FILES_PER_ADVANCE = 20;
const MATERIALIZE_ROWS_PER_ADVANCE = 8;
const CLEANUP_OBJECTS_PER_ADVANCE = 80;
const LEASE_MILLISECONDS = 2 * 60 * 1000;
const RESTORE_WORKFLOW_VERSION = 2;
const PENDING_HASH = "pending";

type RestoreStatus =
  | "backup_indexing"
  | "indexing"
  | "manifesting"
  | "verifying"
  | "materializing"
  | "planning"
  | "rewriting"
  | "awaiting_approval"
  | "applying"
  | "validating"
  | "cleaning"
  | "failure_cleaning"
  | "succeeded"
  | "failed"
  | "rollback_requested"
  | "rolling_back"
  | "rolled_back"
  | "rollback_conflicted";

type RestoreBatchRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  archive_sha256: string;
  manifest_root_hash: string;
  dry_run_hash: string;
  status: RestoreStatus;
  summary_json: string;
  collision_map_json: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  rolled_back_at: string | null;
  failure_code: string | null;
  workflow_version: number;
  source_kind: "archive" | "backup" | "legacy_inline";
  source_ref: string | null;
  source_object_key: string | null;
  source_size_bytes: number | null;
  cursor_json: string;
  plan_chain_hash: string | null;
  planned_row_count: number;
  applied_row_count: number;
  rollback_conflict_count: number;
  state_revision: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_progress_at: string | null;
};

type ClaimedRestoreBatch = RestoreBatchRow & { lease_token: string; lease_expires_at: string };

async function runRestoreFencedBatch(input: {
  db: D1DatabaseBinding;
  batch: ClaimedRestoreBatch;
  nextStatus: RestoreStatus;
  statements?: readonly D1PreparedStatementBinding[];
  parentProgress: D1PreparedStatementBinding;
  now: string;
}) {
  return runWorkflowLeaseFencedBatch({
    db: input.db,
    fence: {
      kind: "restore",
      workflowId: input.batch.id,
      userId: input.batch.user_id,
      leaseToken: input.batch.lease_token,
      stateRevision: input.batch.state_revision,
      expectedStatus: input.batch.status,
    },
    nextStatus: input.nextStatus,
    statements: input.statements,
    parentProgress: input.parentProgress,
    now: input.now,
  });
}

type RestoreFileRow = {
  restore_batch_id: string;
  file_id: string;
  ordinal: number;
  kind: string;
  table_name: string | null;
  path: string;
  source_object_key: string;
  data_offset: number;
  byte_length: number;
  expected_sha256: string | null;
  expected_crc32: number | null;
  expected_records: number;
  schema_version: LighthouseSchemaVersion | null;
  source_scope_id: string | null;
  layer_ordinal: number | null;
  metadata_mode: "full" | "delta" | null;
  status: string;
  next_byte_offset: number;
  next_record: number;
};

type RestoreRow = {
  restore_batch_id: string;
  table_name: string;
  row_key: string;
  source_row_hash: string;
  disposition: string;
  restored_row_key: string;
  source_row_json: string | null;
  candidate_row_json: string | null;
  restored_row_hash: string | null;
  target_row_hash: string | null;
  plan_position: number | null;
  apply_sequence: number | null;
  apply_status: string;
  rollback_status: string;
  observed_row_hash: string | null;
  r2_object_key: string | null;
  r2_sha256: string | null;
  r2_size_bytes: number | null;
  r2_status: string | null;
};

type WorkflowCursor = {
  centralIndex?: number;
  manifestIndex?: number;
  backupSnapshotId?: string;
  backupDepth?: number;
  backupFileIndex?: number;
  backupBlobIndex?: number;
  backupRoots?: string[];
  backupVisited?: string[];
  backupNewer?: { snapshotId: string; baseSnapshotId: string | null; baseSequence: number; schemaVersion: LighthouseSchemaVersion };
  semanticBatchIds?: string[];
  semanticIndex?: number;
  cleanupTerminalStatus?: "succeeded" | "failed" | "rolled_back" | "rollback_conflicted";
};

type WorkflowSummary = {
  fileName?: string;
  sourceKind: "archive" | "backup";
  manifest?: {
    profile: "migration";
    schemaVersion: LighthouseSchemaVersion;
    rootHash: string;
    exportId: string;
    scope: ExportManifestV1["scope"];
    counts: Readonly<Record<string, number>>;
    endSequence: number;
  };
  counts: { create: number; reuse: number; fork: number; conflict: number; invalid: number };
  tables: { table: string; rows: number; create: number; reuse: number; fork: number; conflict: number }[];
  warnings: string[];
  indexedFiles: number;
  verifiedFiles: number;
  materializedRows: number;
  rollbackPreserved: number;
};

type CentralEntry = {
  path: string;
  crc32: number;
  bytes: number;
  localOffset: number;
};

function nowIso(value?: string) {
  return value ?? new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function emptySummary(sourceKind: "archive" | "backup", fileName?: string): WorkflowSummary {
  return {
    fileName,
    sourceKind,
    counts: { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 },
    tables: RESTORE_TABLE_ORDER_V2.map((descriptor) => ({ table: descriptor.table, rows: 0, create: 0, reuse: 0, fork: 0, conflict: 0 })),
    warnings: [],
    indexedFiles: 0,
    verifiedFiles: 0,
    materializedRows: 0,
    rollbackPreserved: 0,
  };
}

function ownerHash(userId: string) {
  return sha256Hex(userId).slice(0, 24);
}

function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
}

function bytesToHex(value?: ArrayBuffer) {
  return value ? Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
}

type FixedLengthStreamConstructor = new (expectedLength: number) => {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

export async function putVerifiedFixedLengthStream(input: {
  bucket: R2BucketBinding;
  key: string;
  body: ReadableStream<Uint8Array>;
  size: number;
  sha256: string;
  mediaType: string;
  customMetadata: Record<string, string>;
}) {
  const FixedLength = (globalThis as typeof globalThis & { FixedLengthStream?: FixedLengthStreamConstructor }).FixedLengthStream;
  if (!FixedLength) {
    await uploadVerifiedStream({
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      mediaType: input.mediaType,
      expectedHash: input.sha256,
      expectedBytes: input.size,
      customMetadata: input.customMetadata,
    });
    return;
  }
  const fixed = new FixedLength(input.size);
  try {
    await Promise.all([
      input.bucket.put(input.key, fixed.readable, {
        httpMetadata: { contentType: input.mediaType },
        customMetadata: input.customMetadata,
        sha256: hexToBytes(input.sha256),
      }),
      input.body.pipeTo(fixed.writable),
    ]);
  } catch (error) {
    // R2 PUT may have raced with a newer lease writing the same content-addressed
    // key. A failed/stale writer cannot prove it owns the visible object, so it
    // must never delete that key here. Workflow rollback only removes objects
    // after checking restoreBatchId/userId and live D1 references.
    throw error;
  }
}

function normalizeForUser(row: Record<string, unknown>, userId: string, table: string) {
  const value = { ...unwrapCanonicalRow(row, table) };
  if ("user_id" in value) value.user_id = userId;
  return normalizeLegacyRestoreRow(table, value);
}

function rowKey(descriptor: CanonicalTableDescriptor, row: Record<string, unknown>) {
  const key = Object.fromEntries(descriptor.primaryKey.map((column) => [column, row[column]]));
  if (Object.values(key).some((value) => typeof value !== "string" && typeof value !== "number")) {
    throw new RestoreContractError("row_key_invalid", `${descriptor.table} has an invalid primary key.`);
  }
  return canonicalJson(key);
}

function descriptorOrdinal(table: string) {
  const index = RESTORE_TABLE_ORDER_V2.findIndex((descriptor) => descriptor.table === table);
  if (index < 0) throw new RestoreContractError("row_schema_invalid", `Unknown canonical table: ${table}`);
  return index;
}

function stableForkId(batchId: string, table: string, sourceKey: string) {
  return `fork_${sha256Hex(`${batchId}\0${table}\0${sourceKey}`).slice(0, 26)}`;
}

async function getBatch(db: D1DatabaseBinding, userId: string, batchId: string) {
  return db.prepare(`select * from v2_restore_batches where id=? and user_id=? limit 1`).bind(batchId, userId).first<RestoreBatchRow>();
}

function workflowView(batch: RestoreBatchRow, fileCounts?: { total: number; complete: number }) {
  const summary = parseJson<WorkflowSummary>(batch.summary_json, emptySummary(batch.source_kind === "backup" ? "backup" : "archive"));
  const dryRun: RestoreDryRun | undefined = batch.dry_run_hash !== PENDING_HASH && summary.manifest ? {
    archiveSha256: batch.archive_sha256,
    manifestRootHash: batch.manifest_root_hash,
    dryRunHash: batch.dry_run_hash,
    counts: summary.counts,
    tables: summary.tables,
    warnings: summary.warnings,
  } : undefined;
  return {
    batchId: batch.id,
    restoreId: batch.id,
    status: batch.status,
    stateRevision: batch.state_revision,
    failureCode: batch.failure_code,
    progress: {
      filesComplete: fileCounts?.complete ?? summary.verifiedFiles,
      filesTotal: fileCounts?.total ?? summary.indexedFiles,
      rowsMaterialized: summary.materializedRows,
      rowsPlanned: batch.planned_row_count,
      rowsApplied: batch.applied_row_count,
      rollbackConflicts: batch.rollback_conflict_count,
    },
    manifest: summary.manifest,
    dryRun,
  };
}

export async function getRestoreWorkflow(db: D1DatabaseBinding, userId: string, batchId: string) {
  const batch = await getBatch(db, userId, batchId);
  if (!batch) throw new RestoreContractError("restore_not_found", "Restore batch was not found.");
  const counts = await db.prepare(`select count(*) as total,sum(case when status in ('verified','consumed','ignored') then 1 else 0 end) as complete from v2_restore_files where restore_batch_id=?`).bind(batchId).first<{ total: number; complete: number | null }>();
  return workflowView(batch, { total: Number(counts?.total ?? 0), complete: Number(counts?.complete ?? 0) });
}

export async function cleanupNextRestoreGeneration(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; now?: string }) {
  const now = nowIso(input.now);
  const receipt = await input.db.prepare(`select r.restore_id,r.user_id,r.object_key,r.armed_at,r.not_before,r.first_deleted_at,r.delete_attempt_count
      from v2_restore_generation_cleanup_receipts r
      where (r.armed_at is not null and r.not_before<=?)
         or (r.armed_at is null and not exists (
           select 1 from v2_restore_batches b
           where b.id=r.restore_id and b.user_id=r.user_id and b.lease_token is not null and b.lease_expires_at>?
             and substr(r.object_key,length(r.object_key)-length(b.lease_token)+1)=b.lease_token
         ))
      order by coalesce(r.not_before,r.created_at),r.restore_id
      limit 1`)
    .bind(now, now).first<{ restore_id: string; user_id: string; object_key: string; armed_at: string | null; not_before: string | null; first_deleted_at: string | null; delete_attempt_count: number }>();
  if (!receipt) return { cleaned: 0 };
  if (!receipt.object_key.includes(`/restore-generations/${receipt.restore_id}/`)) throw new RestoreContractError("restore_generation_key_invalid", "Restore generation cleanup receipt is invalid.");
  if (!receipt.armed_at) {
    const attemptToken = receipt.object_key.split("/attempts/").at(-1) ?? "";
    const owner = await input.db.prepare(`select lease_token,lease_expires_at from v2_restore_batches where id=? and user_id=?`).bind(receipt.restore_id, receipt.user_id).first<{ lease_token: string | null; lease_expires_at: string | null }>();
    if (owner?.lease_token === attemptToken && owner.lease_expires_at && owner.lease_expires_at > now) return { cleaned: 0, deferred: 1 };
    const notBefore = new Date(new Date(now).getTime() + LEASE_MILLISECONDS * 5).toISOString();
    await input.db.prepare(`update v2_restore_generation_cleanup_receipts set armed_at=?,not_before=? where restore_id=? and user_id=? and object_key=? and armed_at is null`)
      .bind(now, notBefore, receipt.restore_id, receipt.user_id, receipt.object_key).run();
    return { cleaned: 0, armed: 1, restoreId: receipt.restore_id };
  }
  const canonical = await input.db.prepare(`select 1 as value from v2_attachment_reservations where user_id=? and object_key=? and status='committed' limit 1`)
    .bind(receipt.user_id, receipt.object_key).first<{ value: number }>();
  if (canonical) {
    await input.db.prepare(`delete from v2_restore_generation_cleanup_receipts where restore_id=? and user_id=? and object_key=?`).bind(receipt.restore_id, receipt.user_id, receipt.object_key).run();
    return { cleaned: 0, preserved: 1, restoreId: receipt.restore_id };
  }
  await input.bucket.delete(receipt.object_key);
  // Keep a durable tombstone until this generation is either adopted by a
  // committed reservation or the owning restore is deliberately removed.
  // A timed-out PUT can become visible after an earlier DELETE, so retiring
  // the receipt on elapsed time alone can recreate an untracked orphan.
  const firstDeletedAt = receipt.first_deleted_at ?? now;
  const ageMilliseconds = new Date(now).getTime() - new Date(firstDeletedAt).getTime();
  const retryDelay = ageMilliseconds >= 24 * 60 * 60 * 1_000
    ? 24 * 60 * 60 * 1_000
    : LEASE_MILLISECONDS * 5;
  const retryAt = new Date(new Date(now).getTime() + retryDelay).toISOString();
  await input.db.prepare(`update v2_restore_generation_cleanup_receipts set first_deleted_at=coalesce(first_deleted_at,?),delete_attempt_count=delete_attempt_count+1,not_before=? where restore_id=? and user_id=? and object_key=? and armed_at is not null`)
    .bind(now, retryAt, receipt.restore_id, receipt.user_id, receipt.object_key).run();
  return { cleaned: 1, restoreId: receipt.restore_id };
}

async function findIdempotentBatch(db: D1DatabaseBinding, userId: string, idempotencyKey: string) {
  return db.prepare(`select * from v2_restore_batches where user_id=? and idempotency_key=? limit 1`).bind(userId, idempotencyKey).first<RestoreBatchRow>();
}

export async function stageArchiveRestore(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  userId: string;
  idempotencyKey: string;
  archiveSha256: string;
  fileName: string;
  body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | Blob;
  sizeBytes: number;
  now?: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.archiveSha256)) throw new RestoreContractError("archive_hash_invalid", "Archive SHA-256 is invalid.");
  const existing = await findIdempotentBatch(input.db, input.userId, input.idempotencyKey);
  if (existing) {
    if (existing.archive_sha256 !== input.archiveSha256 || existing.source_size_bytes !== input.sizeBytes) throw new RestoreContractError("idempotency_conflict", "Restore idempotency key was used for another archive.");
    return workflowView(existing);
  }
  const createdAt = nowIso(input.now);
  const batchId = ulid();
  const objectKey = `users/${ownerHash(input.userId)}/restore-staging/${batchId}/${input.archiveSha256}.zip`;
  const streamBody = typeof input.body === "object" && input.body !== null && "getReader" in input.body
    ? input.body as ReadableStream<Uint8Array>
    : null;
  if (streamBody) {
    await putVerifiedFixedLengthStream({
      bucket: input.bucket,
      key: objectKey,
      body: streamBody,
      size: input.sizeBytes,
      sha256: input.archiveSha256,
      mediaType: "application/zip",
      customMetadata: { userId: input.userId, restoreBatchId: batchId, sha256: input.archiveSha256 },
    });
  } else {
    await input.bucket.put(objectKey, input.body, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { userId: input.userId, restoreBatchId: batchId, sha256: input.archiveSha256 },
      sha256: hexToBytes(input.archiveSha256),
    });
  }
  const stored = await input.bucket.head(objectKey);
  if (!stored || stored.size !== input.sizeBytes || (bytesToHex(stored.checksums.sha256) && bytesToHex(stored.checksums.sha256) !== input.archiveSha256)) {
    await input.bucket.delete(objectKey).catch(() => undefined);
    throw new RestoreContractError("archive_upload_invalid", "The staged archive failed size or checksum verification.");
  }
  const summary = emptySummary("archive", input.fileName.slice(0, 255));
  try {
    await input.db.prepare(`insert into v2_restore_batches
      (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_ref,source_object_key,source_size_bytes,cursor_json,state_revision,last_progress_at)
      values (?,?,?,?,?,?,'indexing',?,'{}',?,?,'archive',?,?,?,'{}',0,?)`)
      .bind(batchId, input.userId, input.idempotencyKey, input.archiveSha256, PENDING_HASH, PENDING_HASH, canonicalJson(summary), createdAt, RESTORE_WORKFLOW_VERSION, input.fileName.slice(0, 255), objectKey, input.sizeBytes, createdAt).run();
  } catch (error) {
    const raced = await findIdempotentBatch(input.db, input.userId, input.idempotencyKey);
    if (!raced || raced.archive_sha256 !== input.archiveSha256) {
      await input.bucket.delete(objectKey).catch(() => undefined);
      throw error;
    }
    if (raced.source_object_key !== objectKey) await input.bucket.delete(objectKey).catch(() => undefined);
    return workflowView(raced);
  }
  return getRestoreWorkflow(input.db, input.userId, batchId);
}

export async function stageArchiveRestoreFromObject(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  userId: string;
  idempotencyKey: string;
  archiveSha256: string;
  fileName: string;
  objectKey: string;
  sizeBytes: number;
  restoreUploadId: string;
  restoreUploadLeaseToken: string;
  now?: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.archiveSha256)) throw new RestoreContractError("archive_hash_invalid", "Archive SHA-256 is invalid.");
  const existing = await findIdempotentBatch(input.db, input.userId, input.idempotencyKey);
  if (existing) {
    if (existing.source_kind !== "archive" || existing.archive_sha256 !== input.archiveSha256 || existing.source_size_bytes !== input.sizeBytes || existing.source_object_key !== input.objectKey) {
      throw new RestoreContractError("idempotency_conflict", "Restore idempotency key was used for another archive.");
    }
    return workflowView(existing);
  }
  const expectedPrefix = `users/${ownerHash(input.userId)}/restore-staging/`;
  const stored = input.objectKey.startsWith(expectedPrefix) ? await input.bucket.head(input.objectKey) : null;
  if (
    !stored
    || stored.size !== input.sizeBytes
    || stored.customMetadata?.userId !== input.userId
    || stored.customMetadata?.restoreUploadId !== input.restoreUploadId
    || stored.customMetadata?.sha256 !== input.archiveSha256
  ) throw new RestoreContractError("archive_upload_invalid", "The multipart archive staging object is not a verified owner-scoped upload.");

  const createdAt = nowIso(input.now);
  const batchId = ulid();
  const summary = emptySummary("archive", input.fileName.slice(0, 255));
  try {
    await input.db.prepare(`insert into v2_restore_batches
      (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_ref,source_object_key,source_size_bytes,cursor_json,state_revision,last_progress_at)
      select ?,?,?,?,?,?,'indexing',?,'{}',?,?,'archive',?,?,?,'{}',0,?
      where exists (
        select 1 from v2_restore_uploads u
        where u.id=? and u.user_id=? and u.status='assembling' and u.phase='staging' and u.lease_token=?
          and u.final_object_key=? and u.expected_archive_sha256=? and u.expected_size_bytes=?
      )`)
      .bind(
        batchId, input.userId, input.idempotencyKey, input.archiveSha256, PENDING_HASH, PENDING_HASH,
        canonicalJson(summary), createdAt, RESTORE_WORKFLOW_VERSION, input.fileName.slice(0, 255), input.objectKey, input.sizeBytes, createdAt,
        input.restoreUploadId, input.userId, input.restoreUploadLeaseToken, input.objectKey, input.archiveSha256, input.sizeBytes,
      ).run();
  } catch (error) {
    const raced = await findIdempotentBatch(input.db, input.userId, input.idempotencyKey);
    if (!raced || raced.source_kind !== "archive" || raced.archive_sha256 !== input.archiveSha256 || raced.source_size_bytes !== input.sizeBytes || raced.source_object_key !== input.objectKey) throw error;
    return workflowView(raced);
  }
  const persisted = await findIdempotentBatch(input.db, input.userId, input.idempotencyKey);
  if (!persisted) throw new RestoreContractError("restore_upload_revision_conflict", "Restore upload lease changed before the archive handoff was committed.");
  if (persisted.source_kind !== "archive" || persisted.archive_sha256 !== input.archiveSha256 || persisted.source_size_bytes !== input.sizeBytes || persisted.source_object_key !== input.objectKey) {
    throw new RestoreContractError("idempotency_conflict", "Restore idempotency key was used for another archive.");
  }
  return workflowView(persisted);
}

export async function stageBackupRestore(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  userId: string;
  idempotencyKey: string;
  snapshotId: string;
  now?: string;
}) {
  const existing = await findIdempotentBatch(input.db, input.userId, input.idempotencyKey);
  if (existing) {
    if (existing.source_kind !== "backup" || existing.source_ref !== input.snapshotId) throw new RestoreContractError("idempotency_conflict", "Restore idempotency key was used for another backup.");
    return workflowView(existing);
  }
  const snapshot = await input.db.prepare(`select id from v2_backup_snapshots where id=? and user_id=? and status='succeeded' limit 1`).bind(input.snapshotId, input.userId).first<{ id: string }>();
  if (!snapshot) throw new RestoreContractError("backup_restore_not_found", "The selected verified backup was not found.");
  const createdAt = nowIso(input.now);
  const batchId = ulid();
  const cursor: WorkflowCursor = { backupSnapshotId: input.snapshotId, backupDepth: 0, backupFileIndex: 0, backupBlobIndex: 0, backupRoots: [], backupVisited: [] };
  await input.db.prepare(`insert into v2_restore_batches
    (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,workflow_version,source_kind,source_ref,source_size_bytes,cursor_json,state_revision,last_progress_at)
    values (?,?,?,?,?,?,'backup_indexing',?,'{}',?,?,'backup',?,0,?,0,?)`)
    .bind(batchId, input.userId, input.idempotencyKey, PENDING_HASH, PENDING_HASH, PENDING_HASH, canonicalJson(emptySummary("backup")), createdAt, RESTORE_WORKFLOW_VERSION, input.snapshotId, canonicalJson(cursor), createdAt).run();
  return getRestoreWorkflow(input.db, input.userId, batchId);
}

async function rangeBytes(bucket: R2BucketBinding, key: string, offset: number, length: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new RestoreContractError("archive_range_invalid", "Archive byte range is invalid.");
  }
  if (length === 0) return new Uint8Array();
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) throw new RestoreContractError("restore_source_missing", "The staged restore source is missing.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== length) throw new RestoreContractError("archive_range_invalid", "The staged archive returned an incomplete byte range.");
  return bytes;
}

async function archiveCentralEntries(bucket: R2BucketBinding, key: string, size: number) {
  if (size < 22) throw new RestoreContractError("archive_invalid", "ZIP is truncated.");
  const tailLength = Math.min(size, 65_557);
  const tailOffset = size - tailLength;
  const tail = await rangeBytes(bucket, key, tailOffset, tailLength);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tailView.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new RestoreContractError("archive_invalid", "ZIP central directory is missing.");
  const count = tailView.getUint16(eocd + 10, true);
  const centralBytes = tailView.getUint32(eocd + 12, true);
  const centralOffset = tailView.getUint32(eocd + 16, true);
  const commentLength = tailView.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength !== tail.byteLength || count === 0xffff || centralBytes === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new RestoreContractError("archive_invalid", "ZIP64 and trailing data are not supported by restore v2.");
  }
  if (count > MAX_ARCHIVE_FILES || centralBytes > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new RestoreContractError("archive_limit", "ZIP exceeds the restore file or central-directory budget.");
  }
  if (centralOffset + centralBytes !== tailOffset + eocd) {
    throw new RestoreContractError("archive_invalid", "ZIP central directory is not contiguous with its end record.");
  }
  const central = await rangeBytes(bucket, key, centralOffset, centralBytes);
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const results: CentralEntry[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  let payloadBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > central.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new RestoreContractError("archive_invalid", "ZIP central entry is invalid.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const bytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if ((flags & 1) !== 0 || method !== 0 || compressedBytes !== bytes) throw new RestoreContractError("archive_invalid", "Only unencrypted stored ZIP entries are supported.");
    if (cursor + 46 + nameLength + extraLength + entryCommentLength > central.byteLength) throw new RestoreContractError("archive_invalid", "ZIP central entry is truncated.");
    const path = decoder.decode(central.subarray(cursor + 46, cursor + 46 + nameLength));
    assertSafeZipPath(path);
    if (seen.has(path)) throw new RestoreContractError("archive_invalid", "ZIP contains duplicate paths.");
    seen.add(path);
    payloadBytes += bytes;
    if (payloadBytes > size) throw new RestoreContractError("archive_invalid", "ZIP payload sizes are inconsistent with the archive.");
    results.push({ path, crc32: expectedCrc, bytes, localOffset });
    cursor += 46 + nameLength + extraLength + entryCommentLength;
  }
  if (cursor !== central.byteLength) throw new RestoreContractError("archive_invalid", "ZIP central directory byte count is inconsistent.");
  return results;
}

function fileKind(path: string) {
  if (path === "manifest.json") return "manifest";
  if (path === "checksums.sha256") return "checksums";
  if (path === "README.md") return "readme";
  if (CANONICAL_TABLE_BY_PATH.has(path)) return "metadata";
  if (path.startsWith("attachments/originals/")) return "original";
  return "payload";
}

async function archiveDataOffset(input: { bucket: R2BucketBinding; key: string; file: RestoreFileRow }) {
  const header = await rangeBytes(input.bucket, input.key, input.file.data_offset, 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 || (view.getUint16(6, true) & 1) !== 0 || view.getUint16(8, true) !== 0) {
    throw new RestoreContractError("archive_invalid", `ZIP local entry is invalid: ${input.file.path}`);
  }
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = decoder.decode(await rangeBytes(input.bucket, input.key, input.file.data_offset + 30, nameLength));
  if (name !== input.file.path) throw new RestoreContractError("archive_invalid", "ZIP local and central paths do not match.");
  return input.file.data_offset + 30 + nameLength + extraLength;
}

async function readArchiveFile(input: { bucket: R2BucketBinding; key: string; file: RestoreFileRow; maxBytes: number }) {
  if (input.file.byte_length > input.maxBytes) throw new RestoreContractError("archive_limit", `${input.file.path} exceeds its restore processing budget.`);
  const dataOffset = await archiveDataOffset(input);
  const bytes = await rangeBytes(input.bucket, input.key, dataOffset, input.file.byte_length);
  if (input.file.expected_crc32 !== null && crc32(bytes) !== input.file.expected_crc32) throw new RestoreContractError("archive_crc_mismatch", `ZIP CRC mismatch: ${input.file.path}`);
  return { bytes, dataOffset };
}

function parseChecksums(bytes: Uint8Array) {
  const checksums = new Map<string, string>();
  for (const [index, line] of decoder.decode(bytes).split("\n").entries()) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new RestoreContractError("checksums_invalid", `checksums.sha256:${index + 1} is invalid.`);
    assertSafeZipPath(match[2]);
    if (checksums.has(match[2])) throw new RestoreContractError("checksums_invalid", "Checksum file contains a duplicate path.");
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

async function updateProgress(
  db: D1DatabaseBinding,
  batch: ClaimedRestoreBatch,
  input: { status?: RestoreStatus; cursor?: WorkflowCursor; summary?: WorkflowSummary; now: string; extraSql?: string; extraBindings?: unknown[] },
) {
  const status = input.status ?? batch.status;
  const parentProgress = db.prepare(`update v2_restore_batches set status=?,cursor_json=?,summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null${input.extraSql ?? ""} where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(status, canonicalJson(input.cursor ?? parseJson<WorkflowCursor>(batch.cursor_json, {})), canonicalJson(input.summary ?? parseJson<WorkflowSummary>(batch.summary_json, emptySummary(batch.source_kind === "backup" ? "backup" : "archive"))), input.now, ...(input.extraBindings ?? []), batch.id, batch.user_id, batch.status, batch.lease_token, batch.state_revision);
  await runRestoreFencedBatch({ db, batch, nextStatus: status, parentProgress, now: input.now });
}

async function indexArchiveFiles(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  if (!input.batch.source_object_key || input.batch.source_size_bytes === null) throw new RestoreContractError("restore_source_missing", "Archive staging metadata is missing.");
  const entries = await archiveCentralEntries(input.bucket, input.batch.source_object_key, input.batch.source_size_bytes);
  const cursor = parseJson<WorkflowCursor>(input.batch.cursor_json, {});
  const start = cursor.centralIndex ?? 0;
  const chunk = entries.slice(start, start + INDEX_FILES_PER_ADVANCE);
  const statements: D1PreparedStatementBinding[] = chunk.map((entry, offset) => input.db.prepare(`insert into v2_restore_files
    (restore_batch_id,user_id,file_id,ordinal,kind,path,source_object_key,data_offset,byte_length,expected_crc32,status)
    values (?,?,?,?,?,?,?,?,?,?,'indexed') on conflict(restore_batch_id,file_id) do nothing`)
    .bind(input.batch.id, input.batch.user_id, sha256Hex(entry.path), start + offset, fileKind(entry.path), entry.path, input.batch.source_object_key, entry.localOffset, entry.bytes, entry.crc32));
  const next = start + chunk.length;
  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary("archive"));
  summary.indexedFiles = entries.length;
  const nextStatus: RestoreStatus = next >= entries.length ? "manifesting" : "indexing";
  const parentProgress = input.db.prepare(`update v2_restore_batches set status=?,cursor_json=?,summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(nextStatus, canonicalJson({ centralIndex: next >= entries.length ? 0 : next }), canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus, statements, parentProgress });
}

async function loadArchiveManifest(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: RestoreBatchRow }) {
  if (!input.batch.source_object_key) throw new RestoreContractError("restore_source_missing", "Archive staging object is missing.");
  const rows = await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and path in ('manifest.json','checksums.sha256')`).bind(input.batch.id).all<RestoreFileRow>();
  const manifestFile = rows.results.find((file) => file.path === "manifest.json");
  const checksumFile = rows.results.find((file) => file.path === "checksums.sha256");
  if (!manifestFile || !checksumFile) throw new RestoreContractError("bundle_incomplete", "Bundle requires manifest and checksums.");
  const manifestRead = await readArchiveFile({ bucket: input.bucket, key: input.batch.source_object_key, file: manifestFile, maxBytes: MAX_METADATA_FILE_BYTES });
  const checksumRead = await readArchiveFile({ bucket: input.bucket, key: input.batch.source_object_key, file: checksumFile, maxBytes: MAX_METADATA_FILE_BYTES });
  let raw: unknown;
  try { raw = JSON.parse(decoder.decode(manifestRead.bytes)); } catch { throw new RestoreContractError("manifest_invalid", "manifest.json is not JSON."); }
  const manifest = validateExportManifest(raw);
  if (manifest.profile !== "migration") throw new RestoreContractError("restore_profile_invalid", "Only migration bundles can be restored.");
  validateCanonicalArchiveFiles(manifest);
  const checksums = parseChecksums(checksumRead.bytes);
  if (checksums.size !== manifest.files.length || manifest.files.some((file) => checksums.get(file.path) !== file.sha256)) {
    throw new RestoreContractError("checksums_invalid", "Checksum coverage must exactly match manifest payload files.");
  }
  return { manifest, checksums, manifestFile, checksumFile, manifestDataOffset: manifestRead.dataOffset, checksumDataOffset: checksumRead.dataOffset };
}

async function manifestArchiveFiles(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const loaded = await loadArchiveManifest(input);
  const cursor = parseJson<WorkflowCursor>(input.batch.cursor_json, {});
  const start = cursor.manifestIndex ?? 0;
  const chunk = loaded.manifest.files.slice(start, start + INDEX_FILES_PER_ADVANCE);
  if (chunk.some((file) => file.path === "manifest.json" || file.path === "checksums.sha256")) throw new RestoreContractError("manifest_invalid", "Manifest control files cannot list themselves as payloads.");
  const statements: D1PreparedStatementBinding[] = chunk.map((file) => {
    const descriptor = CANONICAL_TABLE_BY_PATH.get(file.path);
    const ordinal = descriptor ? descriptorOrdinal(descriptor.table) : RESTORE_TABLE_ORDER_V2.length + loaded.manifest.files.indexOf(file);
    return input.db.prepare(`update v2_restore_files set expected_sha256=?,expected_records=?,schema_version=?,source_scope_id=?,table_name=?,kind=?,ordinal=? where restore_batch_id=? and path=? and byte_length=?`)
      .bind(file.sha256, file.records, loaded.manifest.schemaVersion, loaded.manifest.exportId, descriptor?.table ?? null, descriptor ? "metadata" : fileKind(file.path), ordinal, input.batch.id, file.path, file.bytes);
  });
  const next = start + chunk.length;
  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary("archive"));
  summary.manifest = {
    profile: "migration",
    schemaVersion: loaded.manifest.schemaVersion,
    rootHash: loaded.manifest.rootHash,
    exportId: loaded.manifest.exportId,
    scope: loaded.manifest.scope,
    counts: loaded.manifest.counts,
    endSequence: loaded.manifest.endSequence,
  };
  if (next >= loaded.manifest.files.length) {
    const indexed = await input.db.prepare(`select path,byte_length from v2_restore_files where restore_batch_id=?`).bind(input.batch.id).all<{ path: string; byte_length: number }>();
    const indexedByPath = new Map(indexed.results.map((file) => [file.path, file.byte_length]));
    const manifestPaths = new Set(loaded.manifest.files.map((file) => file.path));
    if (
      loaded.manifest.files.some((file) => indexedByPath.get(file.path) !== file.bytes)
      || indexed.results.some((file) => file.path !== "manifest.json" && file.path !== "checksums.sha256" && !manifestPaths.has(file.path))
      || !indexedByPath.has("README.md")
    ) throw new RestoreContractError("bundle_unmanifested_file", "Archive and manifest file coverage do not match.");
    statements.push(input.db.prepare(`update v2_restore_files set status='consumed',verified_at=?,consumed_at=?,next_byte_offset=byte_length,next_record=expected_records,data_offset=case path when 'manifest.json' then ? when 'checksums.sha256' then ? else data_offset end where restore_batch_id=? and path in ('manifest.json','checksums.sha256')`)
      .bind(input.now, input.now, loaded.manifestDataOffset, loaded.checksumDataOffset, input.batch.id));
  }
  const nextStatus: RestoreStatus = next >= loaded.manifest.files.length ? "verifying" : "manifesting";
  const parentProgress = input.db.prepare(`update v2_restore_batches set status=?,manifest_root_hash=?,cursor_json=?,summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(nextStatus, loaded.manifest.rootHash, canonicalJson({ manifestIndex: next >= loaded.manifest.files.length ? 0 : next }), canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus, statements, parentProgress });
}

async function loadBackupManifest(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: RestoreBatchRow; snapshotId: string }) {
  const snapshot = await input.db.prepare(`select id,status,manifest_object_key,manifest_root_hash,base_snapshot_id from v2_backup_snapshots where id=? and user_id=? limit 1`)
    .bind(input.snapshotId, input.batch.user_id)
    .first<{ id: string; status: string; manifest_object_key: string | null; manifest_root_hash: string | null; base_snapshot_id: string | null }>();
  if (!snapshot || snapshot.status !== "succeeded" || !snapshot.manifest_object_key || !snapshot.manifest_root_hash) {
    throw new RestoreContractError("backup_chain_snapshot_invalid", "Backup chain contains an unavailable snapshot.");
  }
  const object = await input.bucket.get(snapshot.manifest_object_key);
  if (!object) throw new RestoreContractError("backup_chain_manifest_missing", "Backup manifest is missing.");
  if (object.size <= 0 || object.size > MAX_BACKUP_MANIFEST_BYTES) {
    throw new RestoreContractError("backup_chain_manifest_invalid", "Backup manifest exceeds the restore processing budget.");
  }
  let manifest: BackupManifestV1;
  try { manifest = validateBackupManifest(JSON.parse(await new Response(object.body).text())); }
  catch { throw new RestoreContractError("backup_chain_manifest_invalid", "Backup manifest is invalid."); }
  if (
    manifest.snapshotId !== snapshot.id
    || manifest.rootHash !== snapshot.manifest_root_hash
    || manifest.baseSnapshotId !== snapshot.base_snapshot_id
    || object.customMetadata?.rootHash !== manifest.rootHash
  ) throw new RestoreContractError("backup_chain_manifest_invalid", "Backup manifest does not match its D1 checkpoint.");
  return { manifest, manifestObjectKey: snapshot.manifest_object_key };
}

async function indexBackupFiles(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const cursor = parseJson<WorkflowCursor>(input.batch.cursor_json, {});
  const snapshotId = cursor.backupSnapshotId ?? input.batch.source_ref;
  if (!snapshotId) throw new RestoreContractError("backup_chain_snapshot_invalid", "Backup restore cursor is missing.");
  const visited = cursor.backupVisited ?? [];
  const depth = cursor.backupDepth ?? 0;
  if (depth >= MAX_BACKUP_CHAIN_DEPTH || visited.includes(snapshotId)) {
    throw new RestoreContractError("backup_chain_cycle_invalid", "Backup chain is cyclic or exceeds the supported depth.");
  }
  const { manifest } = await loadBackupManifest({ ...input, snapshotId });
  const newer = cursor.backupNewer;
  if (newer) {
    if (
      newer.baseSnapshotId !== manifest.snapshotId
      || newer.baseSequence !== manifest.endSequence
      || SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.indexOf(newer.schemaVersion) < SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.indexOf(manifest.schemaVersion)
    ) throw new RestoreContractError("backup_chain_sequence_invalid", "Backup chain sequence or schema continuity is invalid.");
  }
  const metadataStart = cursor.backupFileIndex ?? 0;
  if (metadataStart < manifest.metadataFiles.length) {
    const chunk = manifest.metadataFiles.slice(metadataStart, metadataStart + INDEX_FILES_PER_ADVANCE);
    const statements = chunk.map((file) => {
      const basePath = backupBasePath(file.path);
      const descriptor = basePath ? CANONICAL_TABLE_BY_PATH.get(basePath) : undefined;
      if (!basePath || !descriptor) throw new RestoreContractError("backup_chain_metadata_contract_invalid", `Backup contains an unknown metadata path: ${file.path}`);
      const key = `users/${ownerHash(input.batch.user_id)}/backups/snapshots/${manifest.snapshotId}/metadata/${file.path}`;
      const fragmentNumber = Number(/\.parts\/(\d{8})\.jsonl$/.exec(file.path)?.[1] ?? 0);
      return input.db.prepare(`insert into v2_restore_files
        (restore_batch_id,user_id,file_id,ordinal,kind,table_name,path,source_object_key,data_offset,byte_length,expected_sha256,expected_records,schema_version,source_scope_id,layer_ordinal,metadata_mode,status)
        values (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,'indexed') on conflict(restore_batch_id,file_id) do nothing`)
        .bind(input.batch.id, input.batch.user_id, `metadata:${manifest.snapshotId}:${sha256Hex(file.path)}`, descriptorOrdinal(descriptor.table) * 100_000 + fragmentNumber, "metadata", descriptor.table, file.path, key, file.bytes, file.sha256, file.records, manifest.schemaVersion, manifest.snapshotId, -depth, manifest.metadataModes[file.path] ?? manifest.metadataModes[basePath]);
    });
    const next = metadataStart + chunk.length;
    const nextCursor = { ...cursor, backupFileIndex: next };
    const parentProgress = input.db.prepare(`update v2_restore_batches set cursor_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
      .bind(canonicalJson(nextCursor), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
    await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
    return;
  }
  const blobStart = cursor.backupBlobIndex ?? 0;
  if (blobStart < manifest.blobs.length) {
    const chunk = manifest.blobs.slice(blobStart, blobStart + INDEX_FILES_PER_ADVANCE);
    const statements = chunk.map((blob, offset) => input.db.prepare(`insert into v2_restore_files
      (restore_batch_id,user_id,file_id,ordinal,kind,path,source_object_key,data_offset,byte_length,expected_sha256,expected_records,schema_version,source_scope_id,layer_ordinal,status)
      values (?,?,?,?,?,?,?,?,?,?,0,?,?,?,'indexed') on conflict(restore_batch_id,file_id) do nothing`)
      .bind(input.batch.id, input.batch.user_id, `blob:${blob.sha256}`, RESTORE_TABLE_ORDER_V2.length * 100_000 + blobStart + offset, "original", `backup-blobs/${blob.sha256}`, blob.objectKey, 0, blob.bytes, blob.sha256, manifest.schemaVersion, manifest.snapshotId, -depth));
    const nextCursor = { ...cursor, backupBlobIndex: blobStart + chunk.length };
    const parentProgress = input.db.prepare(`update v2_restore_batches set cursor_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
      .bind(canonicalJson(nextCursor), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
    await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
    return;
  }
  const roots = [...(cursor.backupRoots ?? []), manifest.rootHash];
  const nextVisited = [...visited, manifest.snapshotId];
  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary("backup"));
  const nextSnapshotId = manifest.snapshotKind === "incremental" ? manifest.baseSnapshotId : null;
  if (manifest.snapshotKind === "incremental" && !nextSnapshotId) throw new RestoreContractError("backup_chain_base_full_missing", "Incremental backup is missing its base snapshot.");
  if (manifest.snapshotKind === "full" && manifest.baseSnapshotId !== null) throw new RestoreContractError("backup_chain_manifest_invalid", "Full backup must not reference another base.");
  if (nextSnapshotId) {
    const nextCursor: WorkflowCursor = {
      backupSnapshotId: nextSnapshotId,
      backupDepth: depth + 1,
      backupFileIndex: 0,
      backupBlobIndex: 0,
      backupRoots: roots,
      backupVisited: nextVisited,
      backupNewer: { snapshotId: manifest.snapshotId, baseSnapshotId: manifest.baseSnapshotId, baseSequence: manifest.baseSequence, schemaVersion: manifest.schemaVersion },
    };
    await updateProgress(input.db, input.batch, { cursor: nextCursor, summary, now: input.now });
    return;
  }
  const selected = input.batch.source_ref!;
  const selectedManifest = selected === manifest.snapshotId ? manifest : (await loadBackupManifest({ ...input, snapshotId: selected })).manifest;
  const fileCount = await input.db.prepare(`select count(*) as value from v2_restore_files where restore_batch_id=?`).bind(input.batch.id).first<{ value: number }>();
  summary.indexedFiles = Number(fileCount?.value ?? 0);
  summary.manifest = {
    profile: "migration",
    schemaVersion: selectedManifest.schemaVersion,
    rootHash: selectedManifest.rootHash,
    exportId: `backup:${selectedManifest.snapshotId}`,
    scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true },
    counts: {},
    endSequence: selectedManifest.endSequence,
  };
  const orderedRoots = roots.slice().reverse();
  await updateProgress(input.db, input.batch, {
    status: "verifying",
    cursor: {},
    summary,
    now: input.now,
    extraSql: ",archive_sha256=?,manifest_root_hash=?",
    extraBindings: [sha256Hex(canonicalJson(orderedRoots)), selectedManifest.rootHash],
  });
}

async function verifyNextFile(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const file = await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and status='indexed' order by layer_ordinal,ordinal,file_id limit 1`).bind(input.batch.id).first<RestoreFileRow>();
  if (!file) {
    await updateProgress(input.db, input.batch, { status: "materializing", cursor: {}, now: input.now });
    return;
  }
  let dataOffset = file.data_offset;
  let verifiedSourceKey = file.source_object_key;
  if (input.batch.source_kind === "archive") {
    if (!input.batch.source_object_key) throw new RestoreContractError("restore_source_missing", "Archive staging object is missing.");
    dataOffset = await archiveDataOffset({ bucket: input.bucket, key: input.batch.source_object_key, file });
    if (file.kind === "original") {
      if (!file.expected_sha256) throw new RestoreContractError("checksum_mismatch", `Attachment checksum is missing: ${file.path}`);
      const source = await input.bucket.get(input.batch.source_object_key, { range: { offset: dataOffset, length: file.byte_length } });
      if (!source) throw new RestoreContractError("restore_source_missing", `Attachment range is missing: ${file.path}`);
      verifiedSourceKey = `users/${ownerHash(input.batch.user_id)}/restore-staging/${input.batch.id}/verified/${file.expected_sha256}`;
      await putVerifiedFixedLengthStream({
        bucket: input.bucket,
        key: verifiedSourceKey,
        body: source.body,
        size: file.byte_length,
        sha256: file.expected_sha256,
        mediaType: "application/octet-stream",
        customMetadata: { userId: input.batch.user_id, restoreBatchId: input.batch.id, sha256: file.expected_sha256 },
      });
      const verified = await input.bucket.head(verifiedSourceKey);
      if (!verified || verified.size !== file.byte_length || verified.customMetadata?.restoreBatchId !== input.batch.id) throw new RestoreContractError("checksum_mismatch", `Attachment checksum failed: ${file.path}`);
      dataOffset = 0;
    } else {
      const read = await readArchiveFile({ bucket: input.bucket, key: input.batch.source_object_key, file, maxBytes: MAX_METADATA_FILE_BYTES });
      if (!file.expected_sha256 || sha256Hex(read.bytes) !== file.expected_sha256) throw new RestoreContractError("checksum_mismatch", `Payload checksum failed: ${file.path}`);
      dataOffset = read.dataOffset;
    }
  } else if (file.kind === "original") {
    const object = await input.bucket.head(file.source_object_key);
    if (!object || object.size !== file.byte_length || object.customMetadata?.sha256 !== file.expected_sha256) throw new RestoreContractError("backup_chain_blob_invalid", `Backup blob failed validation: ${file.path}`);
  } else {
    if (file.byte_length > MAX_METADATA_FILE_BYTES) throw new RestoreContractError("archive_limit", `${file.path} exceeds the metadata processing budget.`);
    const object = await input.bucket.get(file.source_object_key);
    if (!object) throw new RestoreContractError("backup_chain_metadata_invalid", `Backup metadata is missing: ${file.path}`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== file.byte_length || !file.expected_sha256 || sha256Hex(bytes) !== file.expected_sha256 || object.customMetadata?.sha256 !== file.expected_sha256) {
      throw new RestoreContractError("backup_chain_metadata_invalid", `Backup metadata failed validation: ${file.path}`);
    }
  }
  const terminal = file.kind === "metadata" ? "verified" : "consumed";
  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
  summary.verifiedFiles += 1;
  const statements = [
    input.db.prepare(`update v2_restore_files set status=?,source_object_key=?,data_offset=?,next_byte_offset=?,next_record=?,verified_at=?,consumed_at=case when ?='consumed' then ? else consumed_at end where restore_batch_id=? and file_id=?`)
      .bind(terminal, verifiedSourceKey, dataOffset, terminal === "consumed" ? file.byte_length : 0, terminal === "consumed" ? file.expected_records : 0, input.now, terminal, input.now, input.batch.id, file.file_id),
  ];
  const parentProgress = input.db.prepare(`update v2_restore_batches set summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
}

function parseJsonLine(bytes: Uint8Array, file: RestoreFileRow, record: number) {
  if (bytes.byteLength > 96 * 1024) throw new RestoreContractError("row_schema_invalid", `${file.path}:${record + 1} exceeds the D1 row budget.`);
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(bytes)); }
  catch { throw new RestoreContractError("jsonl_invalid", `${file.path}:${record + 1} is not JSON.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RestoreContractError("jsonl_invalid", `${file.path}:${record + 1} must be an object.`);
  const row = parsed as Record<string, unknown>;
  if (row.schema_version !== file.schema_version || row.user_scope_export_id !== file.source_scope_id) {
    throw new RestoreContractError("jsonl_invalid", `${file.path}:${record + 1} has the wrong restore scope or schema.`);
  }
  return row;
}

function planPosition(descriptor: CanonicalTableDescriptor, sourceKey: string) {
  return descriptorOrdinal(descriptor.table) * 1_000_000_000_000 + Number.parseInt(sha256Hex(sourceKey).slice(0, 9), 16);
}

async function materializeNextRows(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const file = await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and kind='metadata' and status in ('verified','materializing') order by layer_ordinal,ordinal,file_id limit 1`).bind(input.batch.id).first<RestoreFileRow>();
  if (!file) {
    const count = await input.db.prepare(`select count(*) as value from v2_restore_rows where restore_batch_id=?`).bind(input.batch.id).first<{ value: number }>();
    const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
    summary.materializedRows = Number(count?.value ?? 0);
    await updateProgress(input.db, input.batch, { status: "planning", cursor: {}, summary, now: input.now });
    return;
  }
  const descriptor = file.table_name ? CANONICAL_TABLE_BY_NAME.get(file.table_name) : undefined;
  if (!descriptor || !file.schema_version || !file.source_scope_id) throw new RestoreContractError("row_schema_invalid", `Restore metadata is incomplete: ${file.path}`);
  const offset = file.next_byte_offset;
  const remaining = file.byte_length - offset;
  const readLength = Math.min(remaining, MATERIALIZE_WINDOW_BYTES);
  const window = readLength ? await rangeBytes(input.bucket, file.source_object_key, file.data_offset + offset, readLength) : new Uint8Array();
  const parsedRows: { row: Record<string, unknown>; bytes: number }[] = [];
  let cursor = 0;
  while (cursor < window.byteLength && parsedRows.length < MATERIALIZE_ROWS_PER_ADVANCE) {
    const newline = window.indexOf(10, cursor);
    if (newline < 0) {
      if (offset + window.byteLength >= file.byte_length) throw new RestoreContractError("jsonl_invalid", `${file.path} must end with LF.`);
      if (cursor === 0) throw new RestoreContractError("row_schema_invalid", `${file.path} contains a row larger than the materialization window.`);
      break;
    }
    const line = window.subarray(cursor, newline);
    if (!line.byteLength) throw new RestoreContractError("jsonl_invalid", `${file.path}:${file.next_record + parsedRows.length + 1} is empty.`);
    parsedRows.push({ row: parseJsonLine(line, file, file.next_record + parsedRows.length), bytes: newline + 1 - cursor });
    cursor = newline + 1;
  }
  if (!remaining && file.expected_records !== file.next_record) throw new RestoreContractError("count_mismatch", `${file.path} record count does not match its manifest.`);
  const statements: D1PreparedStatementBinding[] = [];
  if (file.next_record === 0 && file.metadata_mode === "full") {
    statements.push(input.db.prepare(`delete from v2_restore_rows where restore_batch_id=? and table_name=?`).bind(input.batch.id, descriptor.table));
  }
  let consumedBytes = 0;
  for (const [index, parsed] of parsedRows.entries()) {
    consumedBytes += parsed.bytes;
    const row = parsed.row;
    if (BACKUP_DELTA_OPERATION_FIELD in row) {
      if (file.metadata_mode !== "delta" || !isBackupDeltaTombstone(row)) throw new RestoreContractError("backup_restore_delta_operation_invalid", `${file.path} contains an invalid delta operation.`);
      const sourceKey = rowKey(descriptor, row);
      statements.push(input.db.prepare(`delete from v2_restore_rows where restore_batch_id=? and table_name=? and row_key=?`).bind(input.batch.id, descriptor.table, sourceKey));
      continue;
    }
    const sourceKey = rowKey(descriptor, row);
    const sourceHash = sha256Hex(canonicalJson(unwrapCanonicalRow(row, descriptor.table)));
    const sql = input.batch.source_kind === "backup"
      ? `insert into v2_restore_rows
          (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,source_row_json,candidate_row_json,plan_position,apply_status,rollback_status,r2_status,updated_at)
          values (?,?,?,?,'pending','{}',?,?,'{}',?,'pending','not_applicable','not_applicable',?)
          on conflict(restore_batch_id,table_name,row_key) do update set source_row_hash=excluded.source_row_hash,source_row_json=excluded.source_row_json,candidate_row_json='{}',disposition='pending',restored_row_key='{}',plan_position=excluded.plan_position,apply_status='pending',rollback_status='not_applicable',r2_status='not_applicable',updated_at=excluded.updated_at`
      : `insert into v2_restore_rows
          (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at,source_row_json,candidate_row_json,plan_position,apply_status,rollback_status,r2_status,updated_at)
          values (?,?,?,?,'pending','{}',?,?,'{}',?,'pending','not_applicable','not_applicable',?)`;
    statements.push(input.db.prepare(sql).bind(input.batch.id, descriptor.table, sourceKey, sourceHash, input.now, canonicalJson(row), planPosition(descriptor, sourceKey) + index, input.now));
  }
  const nextByteOffset = offset + consumedBytes;
  const nextRecord = file.next_record + parsedRows.length;
  const done = nextByteOffset === file.byte_length;
  if (done && nextRecord !== file.expected_records) throw new RestoreContractError("count_mismatch", `${file.path} record count does not match its manifest.`);
  if (!done && parsedRows.length === 0) throw new RestoreContractError("restore_progress_invalid", `${file.path} materialization made no progress.`);
  statements.push(input.db.prepare(`update v2_restore_files set status=?,next_byte_offset=?,next_record=?,consumed_at=case when ?='consumed' then ? else consumed_at end where restore_batch_id=? and file_id=? and next_byte_offset=? and next_record=?`)
    .bind(done ? "consumed" : "materializing", nextByteOffset, nextRecord, done ? "consumed" : "materializing", input.now, input.batch.id, file.file_id, offset, file.next_record));
  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
  summary.materializedRows += parsedRows.length;
  const parentProgress = input.db.prepare(`update v2_restore_batches set summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
}

const SOFT_REFERENCE_COLUMNS = CANONICAL_SOFT_REFERENCES_V1;

const POLYMORPHIC_TARGET_TABLES: Readonly<Record<string, string>> = {
  type_assignment: "v2_object_type_assignments",
  property_value: "v2_property_values",
  entity: "v2_entity_records",
  event: "v2_event_records",
  relation: "v2_relation_edges",
  review_item: "v2_review_items",
  document: "v2_documents",
};

async function existingRowByColumns(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>, columns: readonly string[]) {
  if (columns.some((column) => row[column] === undefined)) throw new RestoreContractError("row_key_invalid", `${descriptor.table} has an incomplete restore identity.`);
  const where = columns.map((column) => `"${column}" is ?`).join(" and ");
  return db.prepare(`select * from ${descriptor.table} where ${where} limit 1`).bind(...columns.map((column) => row[column])).first<Record<string, unknown>>();
}

function comparableRows(descriptor: CanonicalTableDescriptor, row: Record<string, unknown>) {
  if (descriptor.table !== "v2_attachment_reservations") return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "object_key"));
}

function comparableExisting(descriptor: CanonicalTableDescriptor, existing: Record<string, unknown>, candidate: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(comparableRows(descriptor, candidate)).map((key) => [key, existing[key]]));
}

function mappingNeeds(descriptor: CanonicalTableDescriptor, row: Record<string, unknown>, includeSoft: boolean) {
  const references = { ...(descriptor.foreignKeys ?? {}), ...(includeSoft ? SOFT_REFERENCE_COLUMNS[descriptor.table] ?? {} : {}) };
  const needs: { table: string; sourceId: string; column: string }[] = [];
  for (const [column, table] of Object.entries(references)) {
    const value = row[column];
    if (typeof value === "string") needs.push({ table, sourceId: value, column });
  }
  if ((descriptor.table === "v2_evidence_refs" || descriptor.table === "v2_review_receipts") && typeof row.target_id === "string") {
    const table = POLYMORPHIC_TARGET_TABLES[String(row.target_kind)];
    if (table) needs.push({ table, sourceId: row.target_id, column: "target_id" });
  }
  return needs;
}

async function validateStagedLinkRow(db: D1DatabaseBinding, batchId: string, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>) {
  if (!descriptor.table.startsWith("v2_link_") && !(descriptor.table === "v2_processing_jobs" && (row.stage === "link_analyze" || row.input_link_snapshot_id != null)) && !(descriptor.table === "v2_documents" && (row.current_link_snapshot_id != null || row.published_link_run_id != null))) return;
  const references = new Map<string, Record<string, unknown>>();
  let fragmentEvidence: Record<string, unknown>[] = [];
  const load = async (table: string, id: unknown) => {
    if (typeof id !== "string") return;
    const key = `${table}\0${id}`;
    if (references.has(key)) return;
    const target = CANONICAL_TABLE_BY_NAME.get(table);
    if (!target || (target.primaryKey.length !== 1 && table !== "v2_document_source_links" && table !== "v2_source_attachment_links")) return;
    const stored = await db.prepare(`select source_row_json from v2_restore_rows where restore_batch_id=? and table_name=? and row_key=? limit 1`)
      .bind(batchId, table, target.primaryKey.length === 1 ? canonicalJson({ [target.primaryKey[0]]: id }) : id).first<{ source_row_json: string }>();
    if (stored) references.set(key, parseJson<Record<string, unknown>>(stored.source_row_json, {}));
  };
  for (const need of mappingNeeds(descriptor, row, true)) await load(need.table, need.sourceId);
  if (descriptor.table === "v2_link_snapshots") await load("v2_documents", row.document_object_id);
  if (descriptor.table === "v2_documents") await load("v2_objects", row.object_id);
  if (descriptor.table === "v2_link_snapshot_sources") {
    const snapshot = references.get(`v2_link_snapshots\0${row.snapshot_id}`);
    if (snapshot) await load("v2_document_source_links", canonicalJson({ document_object_id: snapshot.document_object_id, source_item_id: row.source_item_id }));
  }
  const runId = row.processing_run_id ?? row.published_link_run_id;
  if (typeof runId === "string") await load("v2_processing_jobs", references.get(`v2_processing_runs\0${runId}`)?.job_id);
  if (descriptor.table === "v2_link_curation_revisions") {
    const children = await db.prepare(`select table_name,source_row_json from v2_restore_rows where restore_batch_id=? and table_name in ('v2_link_curation_items','v2_link_curation_examples') and json_extract(source_row_json,'$.curation_revision_id')=? limit 129`)
      .bind(batchId, row.id).all<{ table_name: string; source_row_json: string }>();
    validateCurationChildCounts(row, children.results.filter((item) => item.table_name === "v2_link_curation_items").map((item) => JSON.parse(item.source_row_json)),
      children.results.filter((item) => item.table_name === "v2_link_curation_examples").map((item) => JSON.parse(item.source_row_json)));
  }
  if (descriptor.table === "v2_link_curation_items") {
    const fragment = references.get(`v2_link_fragments\0${row.fragment_id}`);
    await load("v2_link_snapshot_sources", fragment?.primary_member_id);
    await load("v2_source_items", references.get(`v2_link_snapshot_sources\0${fragment?.primary_member_id}`)?.source_item_id);
    const evidence = await db.prepare(`select source_row_json from v2_restore_rows where restore_batch_id=? and table_name='v2_link_fragment_evidence' and json_extract(source_row_json,'$.fragment_id')=? limit 2`)
      .bind(batchId, row.fragment_id).all<{ source_row_json: string }>();
    fragmentEvidence = evidence.results.map((item) => JSON.parse(item.source_row_json));
  }
  if (descriptor.table === "v2_link_curation_examples") {
    const member = references.get(`v2_link_snapshot_sources\0${row.member_id}`);
    await load("v2_source_attachment_links", canonicalJson({ source_item_id: member?.source_item_id, attachment_id: row.attachment_id }));
  }
  validateLinkRestoreRow(descriptor.table, row, (table, id) => references.get(`${table}\0${id}`), fragmentEvidence);
}

async function mappingsForNeeds(db: D1DatabaseBinding, batchId: string, needs: readonly { table: string; sourceId: string }[], userId?: string) {
  const unique = [...new Map(needs.map((need) => [`${need.table}\0${need.sourceId}`, need])).values()];
  if (!unique.length) return new Map<string, string>();
  const where = unique.map(() => `(table_name=? and source_id=?)`).join(" or ");
  const rows = await db.prepare(`select table_name,source_id,target_id from v2_restore_id_mappings where restore_batch_id=? and (${where})${userId === undefined ? "" : " and user_id=?"}`)
    .bind(batchId, ...unique.flatMap((need) => [need.table, need.sourceId]), ...(userId === undefined ? [] : [userId]))
    .all<{ table_name: string; source_id: string; target_id: string }>();
  return new Map(rows.results.map((mapping) => [`${mapping.table_name}\0${mapping.source_id}`, mapping.target_id]));
}

function rewriteReferences(descriptor: CanonicalTableDescriptor, row: Record<string, unknown>, mappings: ReadonlyMap<string, string>, includeSoft: boolean, sourceReferences = row) {
  const value = { ...row };
  for (const need of mappingNeeds(descriptor, sourceReferences, includeSoft)) {
    const mapped = mappings.get(`${need.table}\0${need.sourceId}`);
    if (mapped) value[need.column] = mapped;
  }
  return value;
}

/** A succeeded plan binds the source namespace to its current canonical target.
 * Its map alone cannot authorize reuse: check its receipt and current content,
 * including the normalized owner, before placing that target in a new plan. */
async function previousSucceededCandidate(input: {
  db: D1DatabaseBinding; batch: RestoreBatchRow; descriptor: CanonicalTableDescriptor;
  sourceEnvelope: Record<string, unknown>; source: Record<string, unknown>;
}) {
  // Synthetic materialized checkpoints and legacy helper batches have no
  // verified archive identity/receipts and keep the ordinary collision rules.
  if (!/^[a-f0-9]{64}$/.test(input.batch.archive_sha256) || !/^sha256:[a-f0-9]{64}$/.test(input.batch.manifest_root_hash)) return null;
  const previous = await input.db.prepare(`select id from v2_restore_batches
    where user_id=? and archive_sha256=? and manifest_root_hash=? and workflow_version=? and status='succeeded'
    order by rowid desc limit 1`).bind(input.batch.user_id, input.batch.archive_sha256, input.batch.manifest_root_hash, RESTORE_WORKFLOW_VERSION)
    .first<{ id: string }>();
  if (!previous) return null;
  const receipt = await input.db.prepare(`select source_row_hash,candidate_row_json,restored_row_key,restored_row_hash,apply_status
    from v2_restore_rows where restore_batch_id=? and table_name=? and row_key=? limit 1`)
    .bind(previous.id, input.descriptor.table, rowKey(input.descriptor, input.sourceEnvelope))
    .first<{ source_row_hash: string; candidate_row_json: string; restored_row_key: string; restored_row_hash: string; apply_status: string }>();
  const sourceHash = sha256Hex(canonicalJson(unwrapCanonicalRow(input.sourceEnvelope, input.descriptor.table)));
  if (!receipt || receipt.source_row_hash !== sourceHash || !["applied", "reused"].includes(receipt.apply_status)) {
    throw new RestoreContractError("restore_conflict", "The previous restore source receipt is missing or changed.");
  }
  const priorCandidate = parseJson<Record<string, unknown>>(receipt.candidate_row_json, {});
  if (!Object.keys(priorCandidate).length || sha256Hex(canonicalJson(priorCandidate)) !== receipt.restored_row_hash
    || rowKey(input.descriptor, priorCandidate) !== receipt.restored_row_key) {
    throw new RestoreContractError("restore_conflict", "The previous restore target receipt is damaged.");
  }
  const needs = mappingNeeds(input.descriptor, input.source, true);
  const primary = input.descriptor.primaryKey[0];
  const primaryNeed = input.descriptor.primaryKey.length === 1 && typeof input.source[primary] === "string"
    ? { table: input.descriptor.table, sourceId: String(input.source[primary]) } : null;
  const mappings = await mappingsForNeeds(input.db, previous.id, [...needs, ...(primaryNeed ? [primaryNeed] : [])], input.batch.user_id);
  for (const need of [...needs, ...(primaryNeed ? [primaryNeed] : [])]) {
    if (!mappings.get(`${need.table}\0${need.sourceId}`)) throw new RestoreContractError("restore_conflict", "The previous restore identity map is missing or changed.");
  }
  let candidate = rewriteReferences(input.descriptor, input.source, mappings, true);
  if (primaryNeed) candidate = { ...candidate, [primary]: mappings.get(`${primaryNeed.table}\0${primaryNeed.sourceId}`)! };
  candidate = sanitizeRestoredLinkJob(input.descriptor.table, candidate);
  if (canonicalJson(comparableRows(input.descriptor, candidate)) !== canonicalJson(comparableRows(input.descriptor, priorCandidate))) {
    throw new RestoreContractError("restore_conflict", "The previous restore identity map does not match its source receipt.");
  }
  const existing = await existingRowByColumns(input.db, input.descriptor, candidate, input.descriptor.primaryKey);
  if (!existing || canonicalJson(comparableExisting(input.descriptor, existing, candidate)) !== canonicalJson(comparableRows(input.descriptor, candidate))) {
    throw new RestoreContractError("restore_conflict", "The previous restore target changed owner/content or was removed.");
  }
  return { candidate, existing };
}

function recordPrimaryMappingStatement(input: { db: D1DatabaseBinding; batch: RestoreBatchRow; descriptor: CanonicalTableDescriptor; source: Record<string, unknown>; candidate: Record<string, unknown>; disposition: string; now: string }) {
  if (input.descriptor.primaryKey.length !== 1) return null;
  const primary = input.descriptor.primaryKey[0];
  if (typeof input.source[primary] !== "string" || typeof input.candidate[primary] !== "string") return null;
  return input.db.prepare(`insert into v2_restore_id_mappings (restore_batch_id,user_id,table_name,source_id,target_id,disposition,created_at) values (?,?,?,?,?,?,?) on conflict(restore_batch_id,table_name,source_id) do update set target_id=excluded.target_id,disposition=excluded.disposition`)
    .bind(input.batch.id, input.batch.user_id, input.descriptor.table, input.source[primary], input.candidate[primary], input.disposition, input.now);
}

async function attachmentOriginal(input: { db: D1DatabaseBinding; batch: RestoreBatchRow; source: Record<string, unknown>; candidate: Record<string, unknown> }) {
  if (input.candidate.status !== "committed") return null;
  const expectedHash = String(input.candidate.sha256 ?? "").replace(/^sha256:/, "");
  const expectedSize = Number(input.candidate.size_bytes ?? -1);
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new RestoreContractError("attachment_original_invalid", "Committed attachment metadata is invalid.");
  const sourceId = String(input.source.id ?? "");
  const sourcePathPrefix = `attachments/originals/${sourceId}/`;
  const file = input.batch.source_kind === "archive"
    ? await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and kind='original' and substr(path,1,length(?))=? and expected_sha256=? and byte_length=? limit 1`)
      .bind(input.batch.id, sourcePathPrefix, sourcePathPrefix, expectedHash, expectedSize).first<RestoreFileRow>()
    : await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and kind='original' and expected_sha256=? and byte_length=? limit 1`)
      .bind(input.batch.id, expectedHash, expectedSize).first<RestoreFileRow>();
  if (!file) throw new RestoreContractError("attachment_original_invalid", `Committed attachment original is unavailable: ${sourceId}`);
  return { file, expectedHash, expectedSize };
}

async function planNextRow(input: { db: D1DatabaseBinding; batch: ClaimedRestoreBatch; now: string }) {
  const pending = await input.db.prepare(`select table_name from v2_restore_rows where restore_batch_id=? and apply_status='pending' order by plan_position,row_key limit 1`)
    .bind(input.batch.id).first<{ table_name: string }>();
  if (!pending) {
    const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
    await updateProgress(input.db, input.batch, { status: "rewriting", cursor: {}, summary, now: input.now, extraSql: ",plan_chain_hash=?", extraBindings: [sha256Hex("restore-plan-v2")] });
    return;
  }
  const firstTable = pending.table_name;
  const descriptor = CANONICAL_TABLE_BY_NAME.get(firstTable);
  if (!descriptor) throw new RestoreContractError("row_schema_invalid", `Unknown staged table: ${firstTable}`);
  const selfReferenceColumns = Object.entries(descriptor.foreignKeys ?? {})
    .filter(([, target]) => target === descriptor.table)
    .map(([column]) => column);
  const selfReferenceSql = selfReferenceColumns.map(() => `(json_type(source_row_json, ?) is null or json_type(source_row_json, ?)='null' or exists (
    select 1 from v2_restore_id_mappings m where m.restore_batch_id=v2_restore_rows.restore_batch_id and m.table_name=? and m.source_id=cast(json_extract(source_row_json, ?) as text)
  ))`).join(" and ");
  const selfReferenceBindings = selfReferenceColumns.flatMap((column) => {
    const path = `$.${column}`;
    return [path, path, descriptor.table, path];
  });
  const stored = await input.db.prepare(`select * from v2_restore_rows where restore_batch_id=? and table_name=? and apply_status='pending'${selfReferenceSql ? ` and ${selfReferenceSql}` : ""} order by plan_position,row_key limit 1`)
    .bind(input.batch.id, firstTable, ...selfReferenceBindings).first<RestoreRow>();
  if (!stored) throw new RestoreContractError("reference_closure_invalid", `${firstTable} contains an unresolved self-reference cycle.`);
  const sourceEnvelope = parseJson<Record<string, unknown>>(stored.source_row_json ?? "{}", {});
  if (!Object.keys(sourceEnvelope).length) throw new RestoreContractError("row_schema_invalid", `Staged row is incomplete: ${stored.table_name}`);
  await validateStagedLinkRow(input.db, input.batch.id, descriptor, sourceEnvelope);
  const source = normalizeForUser(sourceEnvelope, input.batch.user_id, descriptor.table);
  const needs = mappingNeeds(descriptor, source, false);
  const mappings = await mappingsForNeeds(input.db, input.batch.id, needs);
  for (const need of needs) {
    if (!mappings.has(`${need.table}\0${need.sourceId}`)) {
      throw new RestoreContractError("reference_closure_invalid", `${descriptor.table}.${need.column} refers outside the staged restore graph.`);
    }
  }
  const previous = await previousSucceededCandidate({ db: input.db, batch: input.batch, descriptor, sourceEnvelope, source });
  const provisional = previous?.candidate ?? sanitizeRestoredLinkJob(descriptor.table, rewriteReferences(descriptor, source, mappings, false));

  const primaryExisting = previous?.existing ?? await existingRowByColumns(input.db, descriptor, provisional, descriptor.primaryKey);
  const alternateExisting = descriptor.alternateKey ? await existingRowByColumns(input.db, descriptor, provisional, descriptor.alternateKey) : null;
  const hasDeferredReference = mappingNeeds(descriptor, source, true).some((need) => !mappingNeeds(descriptor, source, false).some((hard) => hard.table === need.table && hard.column === need.column));
  const primaryIsForeignKey = descriptor.primaryKey.length === 1 && Object.hasOwn(descriptor.foreignKeys ?? {}, descriptor.primaryKey[0]);
  let disposition: "created" | "reused" | "forked" | "conflict";
  let candidate = provisional;
  // Joined identities cannot be forked separately from their parent. Exact
  // provisional equality is safe to reuse; final soft-reference rewriting and
  // apply-time target hashes still reject any later mapping or target drift.
  if (previous || primaryExisting && (!hasDeferredReference || primaryIsForeignKey) && canonicalJson(comparableExisting(descriptor, primaryExisting, provisional)) === canonicalJson(comparableRows(descriptor, provisional))) {
    disposition = "reused";
    candidate = { ...provisional, ...Object.fromEntries(descriptor.primaryKey.map((column) => [column, primaryExisting![column]])) };
  } else if (alternateExisting) {
    if (descriptor.alternateKeyResolution === "conflict") disposition = "conflict";
    else {
      disposition = "reused";
      candidate = { ...provisional, ...Object.fromEntries(descriptor.primaryKey.map((column) => [column, alternateExisting[column]])) };
      if (descriptor.alternateKeyResolution === "exact" && canonicalJson(comparableExisting(descriptor, alternateExisting, candidate)) !== canonicalJson(comparableRows(descriptor, candidate))) disposition = "conflict";
    }
  } else if (primaryExisting) {
    const primary = descriptor.primaryKey[0];
    if (descriptor.primaryKey.length !== 1 || primary === "user_id" || primaryIsForeignKey || typeof provisional[primary] !== "string") disposition = "conflict";
    else { disposition = "forked"; candidate = sanitizeRestoredLinkJob(descriptor.table, { ...provisional, [primary]: stableForkId(input.batch.id, descriptor.table, stored.row_key) }); }
  } else disposition = "created";

  const original = descriptor.table === "v2_attachment_reservations" && disposition !== "conflict"
    ? await attachmentOriginal({ db: input.db, batch: input.batch, source, candidate })
    : null;
  if (original && disposition !== "reused") {
    const restoredId = String(candidate.id);
    candidate = { ...candidate, object_key: `users/${ownerHash(input.batch.user_id)}/restored-originals/${restoredId}/restore-generations/${input.batch.id}/${original.expectedHash}` };
  }
  if (original && disposition === "reused" && primaryExisting) candidate = { ...candidate, object_key: primaryExisting.object_key };

  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
  const countKey = disposition === "created" ? "create" : disposition === "reused" ? "reuse" : disposition === "forked" ? "fork" : "conflict";
  summary.counts[countKey] += 1;
  const table = summary.tables.find((item) => item.table === descriptor.table)!;
  table.rows += 1;
  table[countKey] += 1;
  const statements: D1PreparedStatementBinding[] = [];
  const mapping = disposition === "conflict" ? null : recordPrimaryMappingStatement({ db: input.db, batch: input.batch, descriptor, source, candidate, disposition, now: input.now });
  if (mapping) statements.push(mapping);
  statements.push(input.db.prepare(`update v2_restore_rows set disposition=?,restored_row_key=?,candidate_row_json=?,apply_status=?,r2_object_key=?,r2_sha256=?,r2_size_bytes=?,r2_status=?,updated_at=? where restore_batch_id=? and table_name=? and row_key=? and apply_status='pending'`)
    .bind(disposition, rowKey(descriptor, candidate), canonicalJson(candidate), disposition === "conflict" ? "conflict" : "provisional", original ? String(candidate.object_key) : null, original?.expectedHash ?? null, original?.expectedSize ?? null, original ? (disposition === "reused" ? "reused" : "upload_pending") : "not_applicable", input.now, input.batch.id, descriptor.table, stored.row_key));
  const parentProgress = input.db.prepare(`update v2_restore_batches set planned_row_count=planned_row_count+1,summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
}

async function rewriteNextPlannedRow(input: { db: D1DatabaseBinding; batch: ClaimedRestoreBatch; now: string }) {
  const stored = await input.db.prepare(`select * from v2_restore_rows where restore_batch_id=? and apply_status='provisional' order by plan_position,row_key limit 1`).bind(input.batch.id).first<RestoreRow>();
  if (!stored) {
    const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
    summary.warnings = [
      ...(summary.manifest?.scope.privacyLevels.includes("restricted") ? ["restricted_records_require_reauthentication"] : []),
      ...(summary.counts.fork ? ["id_collisions_will_be_forked"] : []),
      ...(summary.counts.conflict ? ["composite_or_settings_conflicts_require_resolution"] : []),
    ];
    const basis = { archiveSha256: input.batch.archive_sha256, manifestRootHash: input.batch.manifest_root_hash, counts: summary.counts, tables: summary.tables, warnings: summary.warnings };
    await updateProgress(input.db, input.batch, {
      status: "awaiting_approval",
      cursor: {},
      summary,
      now: input.now,
      extraSql: ",dry_run_hash=?",
      extraBindings: [sha256Hex(canonicalJson(basis))],
    });
    return;
  }
  const descriptor = CANONICAL_TABLE_BY_NAME.get(stored.table_name);
  if (!descriptor) throw new RestoreContractError("row_schema_invalid", `Unknown staged table: ${stored.table_name}`);
  const source = normalizeForUser(parseJson<Record<string, unknown>>(stored.source_row_json ?? "{}", {}), input.batch.user_id, descriptor.table);
  const provisional = parseJson<Record<string, unknown>>(stored.candidate_row_json ?? "{}", {});
  if (!Object.keys(source).length || !Object.keys(provisional).length) throw new RestoreContractError("row_schema_invalid", "Planned restore row is incomplete.");
  const needs = mappingNeeds(descriptor, source, true);
  const mappings = await mappingsForNeeds(input.db, input.batch.id, needs);
  for (const need of needs) if (!mappings.has(`${need.table}\0${need.sourceId}`)) throw new RestoreContractError("reference_closure_invalid", `${descriptor.table}.${need.column} has no final restore mapping.`);
  // Provisional hard FKs already use target IDs, which may also be keys in
  // the source namespace. Resolve final hard/soft references from the original
  // source once, preserving the planned primary ID and sanitized job state.
  let candidate = rewriteReferences(descriptor, provisional, mappings, true, source);
  if (stored.r2_object_key) candidate = { ...candidate, object_key: stored.r2_object_key };
  const restoredKey = rowKey(descriptor, candidate);
  const restoredHash = sha256Hex(canonicalJson(candidate));
  let targetHash = restoredHash;
  if (stored.disposition === "reused") {
    const existing = await existingRowByColumns(input.db, descriptor, candidate, descriptor.primaryKey);
    if (!existing || canonicalJson(comparableExisting(descriptor, existing, candidate)) !== canonicalJson(comparableRows(descriptor, candidate))) {
      throw new RestoreContractError("restore_conflict", `${descriptor.table} changed while the restore plan was finalized.`);
    }
    targetHash = sha256Hex(canonicalJson(Object.fromEntries(Object.keys(candidate).map((key) => [key, existing[key]]))));
  }
  const previousChain = input.batch.plan_chain_hash && /^[a-f0-9]{64}$/.test(input.batch.plan_chain_hash) ? input.batch.plan_chain_hash : sha256Hex("restore-plan-v2");
  const chain = sha256Hex(`${previousChain}\0${canonicalJson({ table: descriptor.table, rowKey: stored.row_key, disposition: stored.disposition, candidate })}`);
  const statements = [
    input.db.prepare(`update v2_restore_rows set candidate_row_json=?,restored_row_key=?,restored_row_hash=?,target_row_hash=?,apply_status='planned',updated_at=? where restore_batch_id=? and table_name=? and row_key=? and apply_status='provisional'`)
      .bind(canonicalJson(candidate), restoredKey, restoredHash, targetHash, input.now, input.batch.id, descriptor.table, stored.row_key),
  ];
  const parentProgress = input.db.prepare(`update v2_restore_batches set plan_chain_hash=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(chain, input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
}

export async function approveRestoreWorkflow(input: {
  db: D1DatabaseBinding;
  userId: string;
  batchId: string;
  expectedDryRunHash: string;
  expectedRevision?: number;
  now?: string;
}) {
  const batch = await getBatch(input.db, input.userId, input.batchId);
  if (!batch) throw new RestoreContractError("restore_not_found", "Restore batch was not found.");
  if (batch.status === "succeeded") return workflowView(batch);
  if (batch.status !== "awaiting_approval") throw new RestoreContractError("restore_state_conflict", "Restore is not awaiting approval.");
  if (batch.dry_run_hash !== input.expectedDryRunHash) throw new RestoreContractError("dry_run_changed", "The approved dry-run no longer matches the persisted restore plan.");
  if (input.expectedRevision !== undefined && batch.state_revision !== input.expectedRevision) throw new RestoreContractError("restore_state_conflict", "Restore progress changed; refresh before approving.");
  const summary = parseJson<WorkflowSummary>(batch.summary_json, emptySummary(batch.source_kind === "backup" ? "backup" : "archive"));
  if (summary.counts.conflict || summary.counts.invalid) throw new RestoreContractError("restore_conflict", "Dry-run has unresolved conflicts.");
  const approvedAt = nowIso(input.now);
  const expectedRevision = input.expectedRevision ?? batch.state_revision;
  try {
    await runRestoreTransitionFencedBatch({
      db: input.db, restoreId: batch.id, userId: batch.user_id, expectedRevision, expectedStatus: "awaiting_approval", nextStatus: "applying", requireUnleased: true, now: approvedAt,
      parentTransition: input.db.prepare(`update v2_restore_batches set status='applying',approved_at=?,started_at=coalesce(started_at,?),state_revision=state_revision+1,last_progress_at=?,failure_code=null where id=? and user_id=? and status='awaiting_approval' and dry_run_hash=? and state_revision=? and lease_token is null`)
        .bind(approvedAt, approvedAt, approvedAt, batch.id, batch.user_id, input.expectedDryRunHash, expectedRevision),
      statements: [input.db.prepare(`update v2_restore_rows set apply_status='ready',updated_at=? where restore_batch_id=? and apply_status='planned'`).bind(approvedAt, batch.id)],
    });
  } catch (error) {
    if (error instanceof WorkflowLeaseLostError) throw new RestoreContractError("restore_state_conflict", "Restore progress changed; refresh before approving.");
    throw error;
  }
  return getRestoreWorkflow(input.db, input.userId, input.batchId);
}

async function tableColumns(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor) {
  const result = await db.prepare(`pragma table_info(${descriptor.table})`).all<{ name: string }>();
  return new Set(result.results.map((column) => column.name));
}

function insertStatement(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>, allowedColumns: Set<string>) {
  const columns = Object.keys(row);
  if (!columns.length || columns.some((column) => !allowedColumns.has(column))) throw new RestoreContractError("row_schema_invalid", `${descriptor.table} contains an unknown column.`);
  const quoted = columns.map((column) => `"${column}"`).join(",");
  return db.prepare(`insert into ${descriptor.table} (${quoted}) values (${columns.map(() => "?").join(",")})`).bind(...columns.map((column) => row[column]));
}

async function uploadPlannedAttachment(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; row: RestoreRow; candidate: Record<string, unknown> }) {
  if (input.row.r2_status !== "upload_pending" || !input.row.r2_object_key || !input.row.r2_sha256 || input.row.r2_size_bytes === null) return;
  const file = input.batch.source_kind === "archive"
    ? await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and kind='original' and expected_sha256=? and byte_length=? limit 1`).bind(input.batch.id, input.row.r2_sha256, input.row.r2_size_bytes).first<RestoreFileRow>()
    : await input.db.prepare(`select * from v2_restore_files where restore_batch_id=? and kind='original' and expected_sha256=? and byte_length=? limit 1`).bind(input.batch.id, input.row.r2_sha256, input.row.r2_size_bytes).first<RestoreFileRow>();
  if (!file) throw new RestoreContractError("attachment_original_invalid", "Planned attachment source is missing.");
  let source: R2ObjectBodyBinding | null;
  if (input.batch.source_kind === "archive") source = await input.bucket.get(file.source_object_key, { range: { offset: file.data_offset, length: file.byte_length } });
  else source = await input.bucket.get(file.source_object_key);
  if (!source) throw new RestoreContractError("attachment_original_invalid", "Planned attachment source object is missing.");
  await putVerifiedFixedLengthStream({
    bucket: input.bucket,
    key: input.row.r2_object_key,
    body: source.body,
    size: input.row.r2_size_bytes,
    sha256: input.row.r2_sha256,
    mediaType: String(input.candidate.mime_type ?? "application/octet-stream"),
    customMetadata: { userId: input.batch.user_id, reservationId: String(input.candidate.id), restoreBatchId: input.batch.id, sha256: input.row.r2_sha256 },
  });
  const stored = await input.bucket.head(input.row.r2_object_key);
  if (!stored || stored.size !== input.row.r2_size_bytes || stored.customMetadata?.restoreBatchId !== input.batch.id || (bytesToHex(stored.checksums.sha256) && bytesToHex(stored.checksums.sha256) !== input.row.r2_sha256)) {
    throw new RestoreContractError("attachment_original_invalid", "Restored attachment failed target verification.");
  }
}

async function applyNextRow(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const next = await input.db.prepare(`select table_name from v2_restore_rows where restore_batch_id=? and apply_status='ready' order by plan_position,row_key limit 1`).bind(input.batch.id).first<{ table_name: string }>();
  if (!next) {
    await updateProgress(input.db, input.batch, { status: "validating", cursor: {}, now: input.now });
    return;
  }
  const descriptor = CANONICAL_TABLE_BY_NAME.get(next.table_name);
  if (!descriptor) throw new RestoreContractError("row_schema_invalid", `Unknown staged table: ${next.table_name}`);
  const selfColumns = Object.entries(descriptor.foreignKeys ?? {}).filter(([, target]) => target === descriptor.table).map(([column]) => column);
  const parentReady = selfColumns.map(() => `(json_extract(candidate_row_json,?) is null or exists (
    select 1 from ${descriptor.table} restore_parent where restore_parent.${descriptor.primaryKey[0]}=json_extract(candidate_row_json,?)
  ))`).join(" and ");
  const row = await input.db.prepare(`select * from v2_restore_rows where restore_batch_id=? and table_name=? and apply_status='ready'${parentReady ? ` and ${parentReady}` : ""} order by plan_position,row_key limit 1`)
    .bind(input.batch.id, descriptor.table, ...selfColumns.flatMap((column) => [`$.${column}`, `$.${column}`])).first<RestoreRow>();
  if (!row) throw new RestoreContractError("reference_closure_invalid", `${descriptor.table} has no applicable self-reference parent.`);
  let candidate = parseJson<Record<string, unknown>>(row.candidate_row_json ?? "{}", {});
  let uploadAttemptKey: string | null = null;
  if (row.r2_status === "upload_pending" && row.r2_object_key) {
    // A lease attempt never writes another attempt's key. The winning attempt
    // publishes its immutable generation key atomically with the canonical row.
    uploadAttemptKey = `${row.r2_object_key}/attempts/${encodeURIComponent(input.batch.lease_token)}`;
    candidate = { ...candidate, object_key: uploadAttemptKey };
  }
  if (!descriptor || !Object.keys(candidate).length || !row.restored_row_hash || !row.target_row_hash) throw new RestoreContractError("restore_plan_invalid", "Restore plan row is incomplete.");
  const existing = await existingRowByColumns(input.db, descriptor, candidate, descriptor.primaryKey);
  const statements: D1PreparedStatementBinding[] = [];
  let plannedUpload: { row: RestoreRow; candidate: Record<string, unknown> } | null = null;
  let finalStatus: "applied" | "reused";
  if (row.disposition === "reused") {
    if (!existing || canonicalJson(comparableExisting(descriptor, existing, candidate)) !== canonicalJson(comparableRows(descriptor, candidate))) {
      throw new RestoreContractError("restore_conflict", `${descriptor.table} changed after approval.`);
    }
    const targetHash = sha256Hex(canonicalJson(Object.fromEntries(Object.keys(candidate).map((key) => [key, existing[key]]))));
    if (targetHash !== row.target_row_hash) throw new RestoreContractError("restore_conflict", `${descriptor.table} target hash changed after approval.`);
    finalStatus = "reused";
  } else {
    if (existing) throw new RestoreContractError("restore_conflict", `${descriptor.table} target identity was created after approval.`);
    if (row.r2_status === "upload_pending") plannedUpload = {
      row: uploadAttemptKey ? { ...row, r2_object_key: uploadAttemptKey } : row,
      candidate,
    };
    const insert = insertStatement(input.db, descriptor, candidate, await tableColumns(input.db, descriptor));
    if (descriptor.table === "v2_source_attachment_links") {
      const attachmentId = candidate.attachment_id;
      if (typeof attachmentId !== "string") throw new RestoreContractError("attachment_original_invalid", "Attachment link has no valid reservation identity.");
      const reservation = await input.db.prepare(`select status,committed_at from v2_attachment_reservations where id=? and user_id=? limit 1`)
        .bind(attachmentId, input.batch.user_id).first<{ status: string; committed_at: string | null }>();
      if (!reservation || reservation.status !== "committed" || !reservation.committed_at) {
        throw new RestoreContractError("attachment_original_invalid", "Attachment link target is not a committed reservation.");
      }
      statements.push(
        input.db.prepare(`update v2_attachment_reservations set status='verified',committed_at=null where id=? and user_id=? and status='committed'`).bind(attachmentId, input.batch.user_id),
        insert,
        input.db.prepare(`update v2_attachment_reservations set status='committed',committed_at=? where id=? and user_id=? and status='verified'`).bind(reservation.committed_at, attachmentId, input.batch.user_id),
      );
    } else {
      statements.push(insert);
    }
    finalStatus = "applied";
  }
  const sequence = input.batch.applied_row_count + 1;
  const adoptedCandidateJson = uploadAttemptKey ? canonicalJson(candidate) : null;
  const adoptedCandidateHash = adoptedCandidateJson ? sha256Hex(adoptedCandidateJson) : null;
  statements.push(input.db.prepare(`update v2_restore_rows set apply_status=?,apply_sequence=?,r2_status=case when r2_status='upload_pending' then 'committed' else r2_status end,r2_object_key=coalesce(?,r2_object_key),candidate_row_json=case when ? is null then candidate_row_json else ? end,restored_row_hash=coalesce(?,restored_row_hash),target_row_hash=coalesce(?,target_row_hash),updated_at=? where restore_batch_id=? and table_name=? and row_key=? and apply_status='ready'`)
    .bind(finalStatus, sequence, uploadAttemptKey, uploadAttemptKey, adoptedCandidateJson, adoptedCandidateHash, adoptedCandidateHash, input.now, input.batch.id, row.table_name, row.row_key));
  if (plannedUpload?.row.r2_object_key) {
    statements.push(input.db.prepare(`delete from v2_restore_generation_cleanup_receipts where restore_id=? and object_key=? and armed_at is null`)
      .bind(input.batch.id, plannedUpload.row.r2_object_key));
    if (row.r2_object_key !== plannedUpload.row.r2_object_key) {
      statements.push(input.db.prepare(`delete from v2_restore_generation_cleanup_receipts where restore_id=? and object_key=? and armed_at is null`)
        .bind(input.batch.id, row.r2_object_key));
    }
  }
  const parentProgress = input.db.prepare(`update v2_restore_batches set applied_row_count=applied_row_count+1,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and applied_row_count=? and status=? and lease_token=? and state_revision=?`)
    .bind(input.now, input.batch.id, input.batch.user_id, input.batch.applied_row_count, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  try {
    if (plannedUpload) {
      await input.db.prepare(`insert into v2_restore_generation_cleanup_receipts (restore_id,user_id,object_key,created_at) values (?,?,?,?) on conflict(restore_id,object_key) do nothing`)
        .bind(input.batch.id, input.batch.user_id, plannedUpload.row.r2_object_key, input.now).run();
      await uploadPlannedAttachment({ ...input, ...plannedUpload });
    }
    await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
  } catch (error) {
    const key = plannedUpload?.row.r2_object_key;
    if (key && key.includes(`/restore-generations/${input.batch.id}/`)) {
      // The D1 batch may have committed even when its response was lost. Never
      // delete the generation directly from this ambiguous catch path: a
      // committed attachment may already reference it. If the receipt still
      // exists, arm it and let the sweeper re-check canonical adoption first.
      const notBefore = new Date(new Date(input.now).getTime() + LEASE_MILLISECONDS * 5).toISOString();
      await input.db.prepare(`update v2_restore_generation_cleanup_receipts set armed_at=?,not_before=? where restore_id=? and object_key=? and armed_at is null`)
        .bind(input.now, notBefore, input.batch.id, key).run().catch(() => undefined);
    }
    throw error;
  }
}

async function validateLegacyBatch(db: D1DatabaseBinding, userId: string, batchId: string) {
  const stored = await db.prepare(`select reconciliation_json from v2_legacy_migration_batches where id=? and user_id=? and status='succeeded' limit 1`).bind(batchId, userId).first<{ reconciliation_json: string | null }>();
  if (!stored?.reconciliation_json) throw new RestoreContractError("legacy_batch_semantic_invalid", `Restored legacy batch ${batchId} has no reconciliation receipt.`);
  const receipt = parseJson<Record<string, unknown>>(stored.reconciliation_json, {});
  const reconciliation = await new D1LegacyMigrationRepository(db, userId).reconcileBatch(batchId).catch(() => null);
  const valid = reconciliation
    && receipt.batch_status === "succeeded"
    && receipt.complete === true
    && receipt.structurally_valid === true
    && receipt.input_rows === reconciliation.input_rows
    && receipt.next_offset === reconciliation.next_offset
    && receipt.expected_mapping_count === reconciliation.expected_mapping_count
    && receipt.envelope_count === reconciliation.envelope_count
    && receipt.distinct_envelope_count === reconciliation.distinct_envelope_count
    && receipt.mapping_count === reconciliation.mapping_count
    && receipt.expected_processed_mapping_count === reconciliation.expected_processed_mapping_count
    && receipt.processed_item_count === reconciliation.processed_item_count
    && receipt.pending_item_count === 0
    && receipt.knowledge_pending_count === 0
    && receipt.missing_mapping_count === 0
    && receipt.unexpected_mapping_count === 0
    && receipt.invalid_dependency_count === 0;
  if (!valid || !reconciliation?.complete) throw new RestoreContractError("legacy_batch_semantic_invalid", `Restored legacy batch ${batchId} failed semantic reconciliation.`);
}

async function validateAppliedRestore(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const cursor = parseJson<WorkflowCursor>(input.batch.cursor_json, {});
  let ids = cursor.semanticBatchIds;
  if (!ids) {
    const rows = await input.db.prepare(`select candidate_row_json from v2_restore_rows where restore_batch_id=? and table_name='v2_legacy_migration_batches' and apply_status in ('applied','reused')`).bind(input.batch.id).all<{ candidate_row_json: string }>();
    ids = rows.results.map((row) => parseJson<Record<string, unknown>>(row.candidate_row_json, {})).filter((row) => row.status === "succeeded" && typeof row.id === "string").map((row) => String(row.id));
  }
  const index = cursor.semanticIndex ?? 0;
  if (index < ids.length) {
    await validateLegacyBatch(input.db, input.batch.user_id, ids[index]);
    await updateProgress(input.db, input.batch, { cursor: { semanticBatchIds: ids, semanticIndex: index + 1 }, now: input.now });
    return;
  }
  if (input.batch.source_kind === "archive" && input.batch.source_object_key) {
    await updateProgress(input.db, input.batch, { status: "cleaning", cursor: { cleanupTerminalStatus: "succeeded" }, now: input.now });
    return;
  }
  const parentProgress = input.db.prepare(`update v2_restore_batches set status='succeeded',finished_at=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(input.now, input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: "succeeded", parentProgress });
}

async function cleanupArchiveRestore(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  if (!input.batch.source_object_key) throw new RestoreContractError("restore_source_missing", "Archive cleanup source metadata is missing.");
  if (input.batch.source_kind !== "archive" || (input.batch.status !== "cleaning" && input.batch.status !== "failure_cleaning")) {
    throw new RestoreContractError("restore_state_conflict", "Only staged archive restores can clean temporary objects.");
  }
  const cleanupStatus = input.batch.status;
  const cursor = parseJson<WorkflowCursor>(input.batch.cursor_json, {});
  const terminalStatus = cleanupStatus === "failure_cleaning" ? "failed" : cursor.cleanupTerminalStatus ?? "succeeded";
  if (!["succeeded", "failed", "rolled_back", "rollback_conflicted"].includes(terminalStatus)) {
    throw new RestoreContractError("restore_state_conflict", "Archive cleanup terminal state is invalid.");
  }
  const staged = await input.db.prepare(`select distinct source_object_key from v2_restore_files where restore_batch_id=? and kind='original' and source_object_key<>'' and source_object_key<>? limit ?`)
    .bind(input.batch.id, input.batch.source_object_key, CLEANUP_OBJECTS_PER_ADVANCE).all<{ source_object_key: string }>();
  const keys = staged.results.map((row) => row.source_object_key);
  if (keys.length) {
    await input.bucket.delete(keys);
    const statements = [
      input.db.prepare(`update v2_restore_files set source_object_key='' where restore_batch_id=? and source_object_key in (${keys.map(() => "?").join(",")})`).bind(input.batch.id, ...keys),
    ];
    const parentProgress = input.db.prepare(`update v2_restore_batches set state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`).bind(input.now, input.batch.id, input.batch.user_id, cleanupStatus, input.batch.lease_token, input.batch.state_revision);
    await runRestoreFencedBatch({ ...input, nextStatus: cleanupStatus, statements, parentProgress });
    return;
  }
  await input.bucket.delete(input.batch.source_object_key);
  const clearFailure = terminalStatus === "succeeded" || terminalStatus === "rolled_back";
  const rolledBackAt = terminalStatus === "rolled_back" || terminalStatus === "rollback_conflicted" || (terminalStatus === "failed" && input.batch.rolled_back_at)
    ? input.batch.rolled_back_at ?? input.now
    : null;
  const parentProgress = input.db.prepare(`update v2_restore_batches set status=?,source_object_key=null,cursor_json='{}',failure_code=case when ? then null else failure_code end,rolled_back_at=coalesce(?,rolled_back_at),finished_at=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(terminalStatus, clearFailure ? 1 : 0, rolledBackAt, input.now, input.now, input.batch.id, input.batch.user_id, cleanupStatus, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: terminalStatus, parentProgress });
}

export async function requestRestoreRollback(input: { db: D1DatabaseBinding; userId: string; batchId: string; expectedRevision: number; now?: string }) {
  const batch = await getBatch(input.db, input.userId, input.batchId);
  if (!batch) throw new RestoreContractError("restore_not_found", "Restore batch was not found.");
  if (batch.status === "rolled_back" || batch.status === "rollback_requested" || batch.status === "rolling_back") return workflowView(batch);
  if (!["succeeded", "applying", "validating", "rollback_conflicted"].includes(batch.status)) throw new RestoreContractError("restore_state_conflict", "This restore cannot be rolled back from its current state.");
  const now = nowIso(input.now);
  const expectedRevision = input.expectedRevision;
  const generationNotBefore = new Date(new Date(now).getTime() + LEASE_MILLISECONDS * 5).toISOString();
  try {
    await runRestoreTransitionFencedBatch({
      db: input.db, restoreId: batch.id, userId: batch.user_id, expectedRevision, expectedStatus: batch.status, nextStatus: "rollback_requested", requireUnleased: false, now,
      parentTransition: input.db.prepare(`update v2_restore_batches set status='rollback_requested',rollback_conflict_count=0,failure_code=null,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and state_revision=? and status=?`)
        .bind(now, batch.id, batch.user_id, expectedRevision, batch.status),
      statements: [
        input.db.prepare(`update v2_restore_rows set rollback_status='pending',updated_at=? where restore_batch_id=? and disposition in ('created','forked') and apply_status='applied' and rollback_status<>'rolled_back'`).bind(now, batch.id),
        input.db.prepare(`update v2_restore_generation_cleanup_receipts set armed_at=coalesce(armed_at,?),not_before=coalesce(not_before,?) where restore_id=? and armed_at is null`).bind(now, generationNotBefore, batch.id),
      ],
    });
  } catch (error) {
    if (error instanceof WorkflowLeaseLostError) throw new RestoreContractError("restore_state_conflict", "Restore progress changed; refresh before rolling back.");
    throw error;
  }
  return getRestoreWorkflow(input.db, input.userId, input.batchId);
}

function inboundReferences(descriptor: CanonicalTableDescriptor) {
  const references: { table: string; column: string; targetKind?: string }[] = [];
  for (const candidate of CANONICAL_TABLES_V1) {
    for (const [column, target] of Object.entries({ ...(candidate.foreignKeys ?? {}), ...(SOFT_REFERENCE_COLUMNS[candidate.table] ?? {}) })) {
      if (target === descriptor.table) references.push({ table: candidate.table, column });
    }
  }
  for (const [targetKind, table] of Object.entries(POLYMORPHIC_TARGET_TABLES)) {
    if (table === descriptor.table) {
      references.push({ table: "v2_evidence_refs", column: "target_id", targetKind });
      references.push({ table: "v2_review_receipts", column: "target_id", targetKind });
    }
  }
  return references;
}

function inboundChecks(descriptor: CanonicalTableDescriptor, candidate: Record<string, unknown>) {
  if (descriptor.primaryKey.length !== 1) return [] as { sql: string; bindings: unknown[] }[];
  const primary = descriptor.primaryKey[0];
  const target = candidate[primary];
  const checks: { sql: string; bindings: unknown[] }[] = [];
  for (const reference of inboundReferences(descriptor)) {
    let exclusion = "";
    const bindings: unknown[] = [target];
    if (reference.targetKind) bindings.push(reference.targetKind);
    if (reference.table === descriptor.table) {
      exclusion = ` and not (${descriptor.primaryKey.map((column) => `"${column}" is ?`).join(" and ")})`;
      bindings.push(...descriptor.primaryKey.map((column) => candidate[column]));
    }
    checks.push({ sql: `exists (select 1 from ${reference.table} where "${reference.column}" is ?${reference.targetKind ? " and target_kind=?" : ""}${exclusion})`, bindings });
  }
  return checks;
}

function inboundPredicate(descriptor: CanonicalTableDescriptor, candidate: Record<string, unknown>) {
  const checks = inboundChecks(descriptor, candidate);
  return { sql: checks.length ? ` and ${checks.map((check) => `not ${check.sql}`).join(" and ")}` : "", bindings: checks.flatMap((check) => check.bindings), count: checks.length };
}

async function hasInboundReference(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, candidate: Record<string, unknown>) {
  const checks = inboundChecks(descriptor, candidate);
  if (!checks.length) return false;
  const row = await db.prepare(`select case when ${checks.map((check) => check.sql).join(" or ")} then 1 else 0 end as value`).bind(...checks.flatMap((check) => check.bindings)).first<{ value: number }>();
  return Number(row?.value ?? 0) === 1;
}

function resultChanges(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const result = value as { changes?: number; meta?: { changes?: number } };
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

async function preserveRollbackRow(input: { db: D1DatabaseBinding; batch: ClaimedRestoreBatch; row: RestoreRow; reason: string; observedHash?: string; now: string }) {
  const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
  summary.rollbackPreserved += 1;
  const statements = [
    input.db.prepare(`update v2_restore_rows set rollback_status=?,observed_row_hash=?,updated_at=? where restore_batch_id=? and table_name=? and row_key=? and rollback_status='pending'`)
      .bind(input.reason, input.observedHash ?? null, input.now, input.batch.id, input.row.table_name, input.row.row_key),
  ];
  const parentProgress = input.db.prepare(`update v2_restore_batches set rollback_conflict_count=rollback_conflict_count+1,summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
}

async function rollbackNextRow(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; batch: ClaimedRestoreBatch; now: string }) {
  const row = await input.db.prepare(`select * from v2_restore_rows where restore_batch_id=? and rollback_status='pending' order by apply_sequence desc,plan_position desc limit 1`).bind(input.batch.id).first<RestoreRow>();
  if (row) {
    const descriptor = CANONICAL_TABLE_BY_NAME.get(row.table_name);
    const candidate = parseJson<Record<string, unknown>>(row.candidate_row_json ?? "{}", {});
    if (!descriptor || !Object.keys(candidate).length || !row.restored_row_hash) throw new RestoreContractError("restore_plan_invalid", "Rollback journal row is incomplete.");
    const current = await existingRowByColumns(input.db, descriptor, candidate, descriptor.primaryKey);
    if (current) {
      const observed = Object.fromEntries(Object.keys(candidate).map((key) => [key, current[key]]));
      const observedHash = sha256Hex(canonicalJson(observed));
      if (observedHash !== row.restored_row_hash) {
        await preserveRollbackRow({ db: input.db, batch: input.batch, row, reason: "preserved_modified", observedHash, now: input.now });
        return;
      }
      if (await hasInboundReference(input.db, descriptor, candidate)) {
        await preserveRollbackRow({ db: input.db, batch: input.batch, row, reason: "preserved_dependency", observedHash, now: input.now });
        return;
      }
      const columns = Object.keys(candidate);
      const inbound = inboundPredicate(descriptor, candidate);
      if (columns.length + inbound.bindings.length > 90) {
        await preserveRollbackRow({ db: input.db, batch: input.batch, row, reason: "preserved_bind_limit", observedHash, now: input.now });
        return;
      }
      const where = columns.map((column) => `"${column}" is ?`).join(" and ");
      // The canonical delete is included in the fenced journal batch below so
      // losing the lease rolls back both mutations atomically.
      (row as RestoreRow & { canonicalDelete?: D1PreparedStatementBinding }).canonicalDelete = input.db.prepare(`delete from ${descriptor.table} where ${where}${inbound.sql}`).bind(...columns.map((column) => candidate[column]), ...inbound.bindings);
    }
    const key = parseJson<Record<string, unknown>>(row.restored_row_key, {});
    const aggregateId = descriptor.primaryKey.length === 1 ? String(key[descriptor.primaryKey[0]]) : rowKey(descriptor, key);
    const statements = [
      ...((row as RestoreRow & { canonicalDelete?: D1PreparedStatementBinding }).canonicalDelete ? [(row as RestoreRow & { canonicalDelete?: D1PreparedStatementBinding }).canonicalDelete!] : []),
      input.db.prepare(`insert into v2_change_events (user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at)
        select ?,?,?,?,'tombstone',null,? where not exists (select 1 from v2_change_events where user_id=? and aggregate_kind=? and aggregate_id=? and revision_or_version=? and operation='tombstone')`)
        .bind(input.batch.user_id, rollbackTombstoneAggregateKind(descriptor.table), aggregateId, `restore_rollback:${input.batch.id}`, input.now, input.batch.user_id, rollbackTombstoneAggregateKind(descriptor.table), aggregateId, `restore_rollback:${input.batch.id}`),
      input.db.prepare(`update v2_restore_rows set rollback_status='rolled_back',r2_status=case when r2_status in ('committed','upload_pending') then 'delete_pending' else r2_status end,updated_at=? where restore_batch_id=? and table_name=? and row_key=? and rollback_status='pending'`)
        .bind(input.now, input.batch.id, row.table_name, row.row_key),
    ];
    const parentProgress = input.db.prepare(`update v2_restore_batches set state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
      .bind(input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
    await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
    return;
  }

  const cleanup = await input.db.prepare(`select * from v2_restore_rows where restore_batch_id=? and r2_status in ('delete_pending','upload_pending') and r2_object_key is not null order by plan_position limit 1`).bind(input.batch.id).first<RestoreRow>();
  if (cleanup?.r2_object_key) {
    const ownedGeneration = cleanup.r2_object_key.includes(`/restore-generations/${input.batch.id}/`);
    const head = await input.bucket.head(cleanup.r2_object_key);
    const referenced = await input.db.prepare(`select 1 as value from v2_attachment_reservations where object_key=? limit 1`).bind(cleanup.r2_object_key).first<{ value: number }>();
    const owned = !head || (
      head.customMetadata?.restoreBatchId === input.batch.id
      && head.customMetadata?.userId === input.batch.user_id
      && head.size === cleanup.r2_size_bytes
      && (!cleanup.r2_sha256 || !bytesToHex(head.checksums.sha256) || bytesToHex(head.checksums.sha256) === cleanup.r2_sha256)
    );
    if (ownedGeneration && !referenced && owned) {
      await input.bucket.delete(cleanup.r2_object_key);
      const notBefore = new Date(new Date(input.now).getTime() + LEASE_MILLISECONDS * 5).toISOString();
      const statements = [
        input.db.prepare(`update v2_restore_rows set r2_status='not_applicable',updated_at=? where restore_batch_id=? and table_name=? and row_key=?`).bind(input.now, input.batch.id, cleanup.table_name, cleanup.row_key),
        input.db.prepare(`update v2_restore_generation_cleanup_receipts set armed_at=coalesce(armed_at,?),not_before=coalesce(not_before,?) where restore_id=? and object_key=?`).bind(input.now, notBefore, input.batch.id, cleanup.r2_object_key),
      ];
      const parentProgress = input.db.prepare(`update v2_restore_batches set state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`).bind(input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
      await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
    } else {
      const summary = parseJson<WorkflowSummary>(input.batch.summary_json, emptySummary(input.batch.source_kind === "backup" ? "backup" : "archive"));
      summary.rollbackPreserved += 1;
      const statements = [
        input.db.prepare(`update v2_restore_rows set r2_status='reused',updated_at=? where restore_batch_id=? and table_name=? and row_key=?`).bind(input.now, input.batch.id, cleanup.table_name, cleanup.row_key),
      ];
      const parentProgress = input.db.prepare(`update v2_restore_batches set rollback_conflict_count=rollback_conflict_count+1,summary_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`).bind(canonicalJson(summary), input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
      await runRestoreFencedBatch({ ...input, nextStatus: input.batch.status, statements, parentProgress });
    }
    return;
  }
  const status: "failed" | "rolled_back" | "rollback_conflicted" = input.batch.rollback_conflict_count > 0
    ? "rollback_conflicted"
    : input.batch.failure_code
      ? "failed"
      : "rolled_back";
  if (input.batch.source_kind === "archive" && input.batch.source_object_key) {
    const parentProgress = input.db.prepare(`update v2_restore_batches set status='cleaning',cursor_json=?,rolled_back_at=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
      .bind(canonicalJson({ cleanupTerminalStatus: status }), input.now, input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
    await runRestoreFencedBatch({ ...input, nextStatus: "cleaning", parentProgress });
    return;
  }
  const parentProgress = input.db.prepare(`update v2_restore_batches set status=?,rolled_back_at=?,finished_at=coalesce(finished_at,?),state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(status, input.now, input.now, input.now, input.batch.id, input.batch.user_id, input.batch.status, input.batch.lease_token, input.batch.state_revision);
  await runRestoreFencedBatch({ ...input, nextStatus: status, parentProgress });
}

async function acquireLease(db: D1DatabaseBinding, batch: RestoreBatchRow, now: string) {
  const token = ulid();
  const expiresAt = new Date(new Date(now).getTime() + LEASE_MILLISECONDS).toISOString();
  const claim = await db.prepare(`update v2_restore_batches set lease_token=?,lease_expires_at=?,state_revision=state_revision+1 where id=? and user_id=? and status=? and state_revision=? and (lease_token is null or lease_expires_at<=?)`)
    .bind(token, expiresAt, batch.id, batch.user_id, batch.status, batch.state_revision, now).run();
  if (d1ResultChanges(claim) !== 1) throw new RestoreContractError("restore_busy_conflict", "Another request is advancing this restore.");
  const leased = await getBatch(db, batch.user_id, batch.id);
  if (!leased || leased.lease_token !== token || leased.state_revision !== batch.state_revision + 1) throw new RestoreContractError("restore_busy_conflict", "Another request is advancing this restore.");
  return leased as ClaimedRestoreBatch;
}

const TERMINAL_STATUSES = new Set<RestoreStatus>(["succeeded", "failed", "rolled_back", "rollback_conflicted"]);

export async function advanceRestoreWorkflow(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; batchId: string; now?: string }) {
  const now = nowIso(input.now);
  const initial = await getBatch(input.db, input.userId, input.batchId);
  if (!initial) throw new RestoreContractError("restore_not_found", "Restore batch was not found.");
  if (TERMINAL_STATUSES.has(initial.status) || initial.status === "awaiting_approval") return workflowView(initial);
  const batch = await acquireLease(input.db, initial, now);
  try {
    switch (batch.status) {
      case "backup_indexing": await indexBackupFiles({ ...input, batch, now }); break;
      case "indexing": await indexArchiveFiles({ ...input, batch, now }); break;
      case "manifesting": await manifestArchiveFiles({ ...input, batch, now }); break;
      case "verifying": await verifyNextFile({ ...input, batch, now }); break;
      case "materializing": await materializeNextRows({ ...input, batch, now }); break;
      case "planning": await planNextRow({ db: input.db, batch, now }); break;
      case "rewriting": await rewriteNextPlannedRow({ db: input.db, batch, now }); break;
      case "applying": await applyNextRow({ ...input, batch, now }); break;
      case "validating": await validateAppliedRestore({ ...input, batch, now }); break;
      case "cleaning": await cleanupArchiveRestore({ ...input, batch, now }); break;
      case "failure_cleaning": await cleanupArchiveRestore({ ...input, batch, now }); break;
      case "rollback_requested": await updateProgress(input.db, batch, { status: "rolling_back", cursor: {}, now }); break;
      case "rolling_back": await rollbackNextRow({ ...input, batch, now }); break;
      default: {
        const parentProgress = input.db.prepare(`update v2_restore_batches set state_revision=state_revision+1,lease_token=null,lease_expires_at=null,last_progress_at=? where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
          .bind(now, batch.id, batch.user_id, batch.status, batch.lease_token, batch.state_revision);
        await runRestoreFencedBatch({ db: input.db, batch, nextStatus: batch.status, parentProgress, now });
      }
    }
  } catch (error) {
    if (error instanceof WorkflowLeaseLostError) throw error;
    const deterministic = error instanceof RestoreContractError || (error instanceof Error && /^(backup_|restore_|archive_|jsonl_|row_|reference_|checksum_|manifest_|bundle_)/.test(error.message));
    const requiresRollback = batch.applied_row_count > 0 || batch.status === "applying" || batch.status === "validating";
    const deterministicFailureStatus: RestoreStatus = requiresRollback
      ? "rollback_requested"
      : batch.source_kind === "archive" && Boolean(batch.source_object_key)
        ? "failure_cleaning"
        : "failed";
    const nextStatus = batch.status === "failure_cleaning" ? "failure_cleaning" : deterministic ? deterministicFailureStatus : batch.status;
    const detectedFailureCode = error instanceof RestoreContractError ? error.code : deterministic && error instanceof Error ? error.message.split(":")[0] : "restore_transient_failure";
    const failureCode = (batch.status === "cleaning" || batch.status === "failure_cleaning") && batch.failure_code
      ? batch.failure_code
      : detectedFailureCode;
    const failureStatements: D1PreparedStatementBinding[] = [];
    if (nextStatus === "rollback_requested") {
      failureStatements.push(input.db.prepare(`update v2_restore_rows set rollback_status='pending',updated_at=? where restore_batch_id=? and disposition in ('created','forked') and apply_status='applied' and rollback_status<>'rolled_back'`)
        .bind(now, batch.id));
    }
    const parentProgress = input.db.prepare(`update v2_restore_batches set status=?,failure_code=?,lease_token=null,lease_expires_at=null,state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
      .bind(nextStatus, failureCode, now, batch.id, batch.user_id, batch.status, batch.lease_token, batch.state_revision);
    await runRestoreFencedBatch({ db: input.db, batch, nextStatus, statements: failureStatements, parentProgress, now }).catch((fenceError) => {
      if (!(fenceError instanceof WorkflowLeaseLostError)) throw fenceError;
    });
    throw error;
  }
  return getRestoreWorkflow(input.db, input.userId, input.batchId);
}
