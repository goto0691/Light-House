import { ulid } from "ulidx";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import {
  d1ResultChanges,
  runWorkflowLeaseFencedBatch,
  WorkflowLeaseLostError,
} from "@/lib/v2/infrastructure/d1/workflow-lease-fence-v1";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { CANONICAL_TABLES_V1, fullFidelityCanonicalScope, type CanonicalTableDescriptor } from "@/lib/v2/portability/canonical-table-registry-v1";
import {
  BACKUP_DELTA_OPERATION_FIELD,
  BACKUP_DELTA_TOMBSTONE,
  backupFragmentPath,
  backupRootHash,
  readAndValidateBackupMetadata,
  validateBackupManifest,
  type BackupManifestV1,
  type BackupRetentionClass,
} from "@/lib/v2/portability/backup-snapshot-v1";
import {
  canonicalJson,
  envelopeCanonicalRow,
  LIGHTHOUSE_SCHEMA_VERSION,
  sha256Hex,
  type ExportFileManifestV1,
  type ExportScopeV1,
} from "@/lib/v2/portability/portability-contract-v1";
import {
  digestPersistedSha256,
  initialPersistedSha256State,
  updatePersistedSha256,
  type PersistedSha256StateV1,
} from "@/lib/v2/portability/persisted-sha256-v1";

const encoder = new TextEncoder();
const BACKUP_SCOPE: ExportScopeV1 = { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true };
const METADATA_ROWS_PER_ADVANCE = 16;
const MAX_METADATA_FRAGMENT_BYTES = 512 * 1024;
const BLOB_PART_BYTES = 8 * 1024 * 1024;
const MAX_BLOB_PARTS = 10_000;
const MAX_BLOB_BYTES = BLOB_PART_BYTES * MAX_BLOB_PARTS;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_FILES = 8_000;
const MAX_MANIFEST_BLOBS = 8_000;
const MAX_MANIFEST_MEMBERS = 20_000;
const LEASE_MILLISECONDS = 2 * 60 * 1_000;

export const RESUMABLE_BACKUP_CAPACITY = Object.freeze({
  manifestBytes: MAX_MANIFEST_BYTES,
  metadataFiles: MAX_MANIFEST_FILES,
  rowsPerMetadataFile: METADATA_ROWS_PER_ADVANCE,
  blobs: MAX_MANIFEST_BLOBS,
  attachmentMemberships: MAX_MANIFEST_MEMBERS,
  blobBytes: MAX_BLOB_BYTES,
});

type BackupBuildPhase = "metadata" | "metadata_publishing" | "metadata_verifying" | "blob_scanning" | "blob_copying" | "manifesting" | "manifest_publishing" | "manifest_verifying" | "failure_cleaning" | "complete";
type BackupPositionCursor = Readonly<{
  descriptorIndex?: number;
  partNumber?: number;
  primaryKey?: readonly unknown[];
  attachmentId?: string;
}>;
type BackupCursor = Readonly<{
  descriptorIndex?: number;
  partNumber?: number;
  primaryKey?: readonly unknown[];
  attachmentId?: string;
  metadataPublication?: Readonly<{
    path: string;
    attemptObjectKey: string;
    stableObjectKey: string;
    nextCursor: BackupPositionCursor;
  }>;
  manifestPublication?: Readonly<{
    attemptObjectKey: string;
    contentSha256: string;
  }>;
}>;

type BackupSnapshotRow = {
  id: string;
  user_id: string;
  snapshot_kind: "full" | "incremental";
  status: string;
  base_snapshot_id: string | null;
  base_sequence: number;
  end_sequence: number;
  retention_class: BackupRetentionClass;
  created_at: string;
  workflow_version: number;
  idempotency_key: string | null;
  build_phase: BackupBuildPhase | "legacy";
  cursor_json: string;
  state_revision: number;
  manifest_object_key: string | null;
  manifest_root_hash: string | null;
  failure_code: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
};

type MetadataReceipt = {
  table_name: string;
  base_path: string;
  path: string;
  object_key: string;
  metadata_mode: "full" | "delta";
  size_bytes: number;
  sha256: string;
  record_count: number;
  status: string;
};

type BlobWork = {
  sha256: string;
  source_object_key: string;
  object_key: string;
  size_bytes: number;
  media_type: string;
  status: "pending" | "uploading" | "verified";
  upload_id: string | null;
  next_offset: number;
  next_part_number: number;
  parts_json: string;
};

const CHANGE_KIND_BY_TABLE = new Map<string, readonly string[]>([
  ["v2_objects", ["object", "document", "entity", "event"]],
  ["v2_capture_bundles", ["capture_bundle"]],
  ["v2_source_items", ["source_item"]],
  ["v2_document_revisions", ["document_revision"]],
  ["v2_documents", ["document"]],
  ["v2_property_values", ["property_value"]],
  ["v2_relation_edges", ["relation"]],
  ["v2_capture_templates", ["capture_template"]],
  ["v2_saved_views", ["saved_view"]],
  ["v2_link_snapshots", ["link_snapshot"]],
  ["v2_link_snapshot_sources", ["link_snapshot_source"]],
  ["v2_link_fragments", ["link_fragment"]],
  ["v2_link_fragment_evidence", ["link_fragment_evidence"]],
  ["v2_link_curation_revisions", ["link_curation_revision"]],
  ["v2_link_curation_items", ["link_curation_item"]],
  ["v2_link_curation_examples", ["link_curation_example"]],
]);

const DETERMINISTIC_FAILURE_CODES = new Set([
  "backup_attachment_descriptor_missing", "backup_attachment_metadata_invalid", "backup_attachment_source_invalid",
  "backup_attachment_source_missing", "backup_attachment_range_invalid", "backup_blob_capacity_exceeded", "backup_blob_collision", "backup_blob_validation_failed",
  "backup_manifest_capacity_exceeded", "backup_manifest_checkpoint_missing", "backup_manifest_validation_failed",
  "backup_manifest_publish_invalid", "backup_metadata_checkpoint_missing", "backup_metadata_publish_invalid", "backup_metadata_row_too_large",
  "backup_multipart_receipt_invalid", "backup_multipart_unavailable",
  "backup_receipts_incomplete", "backup_source_changed_retry",
]);

function errorCode(error: unknown) {
  return error instanceof Error ? error.message.split(":")[0] : "backup_failed";
}

function parseCursor(value: string): BackupCursor {
  try {
    const parsed = JSON.parse(value) as BackupCursor;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function ownerHash(userId: string) {
  return sha256Hex(userId).slice(0, 24);
}

function checksumHex(value: ArrayBuffer | undefined) {
  return value ? Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
}

function hexToBytes(value: string) {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function assertIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("backup_idempotency_key_invalid");
  return normalized;
}

async function snapshotRow(db: D1DatabaseBinding, userId: string, snapshotId: string) {
  return db.prepare(`select id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,created_at,workflow_version,idempotency_key,build_phase,cursor_json,state_revision,manifest_object_key,manifest_root_hash,failure_code,lease_token,lease_expires_at from v2_backup_snapshots where id=? and user_id=? limit 1`)
    .bind(snapshotId, userId).first<BackupSnapshotRow>();
}

function requireLease(snapshot: BackupSnapshotRow) {
  if (!snapshot.lease_token || !snapshot.lease_expires_at) throw new WorkflowLeaseLostError("backup");
  return {
    kind: "backup" as const,
    workflowId: snapshot.id,
    userId: snapshot.user_id,
    leaseToken: snapshot.lease_token,
    stateRevision: snapshot.state_revision,
    expectedStatus: snapshot.status,
  };
}

async function commitBackupStep(input: {
  db: D1DatabaseBinding;
  snapshot: BackupSnapshotRow;
  now: string;
  setSql: string;
  setBindings?: readonly unknown[];
  statements?: readonly D1PreparedStatementBinding[];
  nextStatus?: "building" | "succeeded" | "failed";
}) {
  const fence = requireLease(input.snapshot);
  const nextStatus = input.nextStatus ?? "building";
  const parentProgress = input.db.prepare(`update v2_backup_snapshots set ${input.setSql},state_revision=state_revision+1,lease_token=null,lease_expires_at=null where id=? and user_id=? and status=? and lease_token=? and state_revision=?`)
    .bind(
      ...(input.setBindings ?? []),
      input.snapshot.id,
      input.snapshot.user_id,
      input.snapshot.status,
      fence.leaseToken,
      fence.stateRevision,
    );
  await runWorkflowLeaseFencedBatch({
    db: input.db,
    fence,
    nextStatus,
    statements: input.statements,
    parentProgress,
    now: input.now,
  });
}

function backupPrefix(snapshot: BackupSnapshotRow) {
  return `users/${ownerHash(snapshot.user_id)}/backups/snapshots/${snapshot.id}`;
}

function metadataStableObjectKey(snapshot: BackupSnapshotRow, path: string) {
  return `${backupPrefix(snapshot)}/metadata/${path}`;
}

function metadataAttemptObjectKey(snapshot: BackupSnapshotRow, path: string, hash: string) {
  const lease = requireLease(snapshot).leaseToken;
  return `${backupPrefix(snapshot)}/metadata-attempts/${lease}/${hash}/${path}`;
}

function manifestStableObjectKey(snapshot: BackupSnapshotRow) {
  return `${backupPrefix(snapshot)}/manifest.json`;
}

function manifestAttemptObjectKey(snapshot: BackupSnapshotRow, rootHash: string) {
  const lease = requireLease(snapshot).leaseToken;
  return `${backupPrefix(snapshot)}/manifest-attempts/${lease}/${rootHash}/manifest.json`;
}

function blobGenerationObjectKey(snapshot: BackupSnapshotRow, sha256: string) {
  const lease = requireLease(snapshot).leaseToken;
  return `users/${ownerHash(snapshot.user_id)}/backups/blob-generations/${snapshot.id}/${lease}/${sha256}`;
}

async function deleteMetadataAttemptUnlessAdopted(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  snapshotId: string;
  path: string;
  attemptObjectKey: string;
}) {
  let adopted: { object_key: string } | null;
  try {
    adopted = await input.db.prepare(`select object_key from v2_backup_metadata_files where snapshot_id=? and path=? limit 1`)
      .bind(input.snapshotId, input.path).first<{ object_key: string }>();
  } catch {
    return;
  }
  if (adopted?.object_key === input.attemptObjectKey) return;
  try { await input.bucket.delete(input.attemptObjectKey); } catch { /* safe orphan retry */ }
}

async function deletePublishedMetadataUnlessLive(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  snapshotId: string;
  path: string;
  stableObjectKey: string;
}) {
  let live: { snapshot_status: string; build_phase: string; object_key: string | null } | null;
  try {
    live = await input.db.prepare(`select s.status as snapshot_status,s.build_phase,f.object_key from v2_backup_snapshots s left join v2_backup_metadata_files f on f.snapshot_id=s.id and f.path=? where s.id=? limit 1`)
      .bind(input.path, input.snapshotId).first<{ snapshot_status: string; build_phase: string; object_key: string | null }>();
  } catch {
    return;
  }
  if ((live?.snapshot_status === "succeeded" && live.object_key === input.stableObjectKey) || (live?.snapshot_status === "building" && live.build_phase !== "failure_cleaning")) return;
  try { await input.bucket.delete(input.stableObjectKey); } catch { /* retention or failure cleanup retries */ }
}

async function deleteManifestAttemptUnlessAdopted(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  snapshotId: string;
  userId: string;
  attemptObjectKey: string;
}) {
  let adopted: BackupSnapshotRow | null;
  try {
    adopted = await snapshotRow(input.db, input.userId, input.snapshotId);
  } catch {
    return;
  }
  if (adopted && parseCursor(adopted.cursor_json).manifestPublication?.attemptObjectKey === input.attemptObjectKey) return;
  try { await input.bucket.delete(input.attemptObjectKey); } catch { /* safe orphan retry */ }
}

async function deletePublishedManifestUnlessLive(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  snapshotId: string;
  userId: string;
  stableObjectKey: string;
}) {
  let live: BackupSnapshotRow | null;
  try {
    live = await snapshotRow(input.db, input.userId, input.snapshotId);
  } catch {
    return;
  }
  if ((live?.status === "succeeded" && live.manifest_object_key === input.stableObjectKey) || (live?.status === "building" && live.build_phase !== "failure_cleaning")) return;
  try { await input.bucket.delete(input.stableObjectKey); } catch { /* retention or failure cleanup retries */ }
}

async function deleteBlobGenerationUnlessAdopted(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  snapshotId: string;
  sha256: string;
  objectKey: string;
}) {
  let adopted: { object_key: string } | null;
  try {
    adopted = await input.db.prepare(`select object_key from v2_backup_blob_work_items where snapshot_id=? and sha256=? limit 1`)
      .bind(input.snapshotId, input.sha256).first<{ object_key: string }>();
  } catch {
    return;
  }
  if (adopted?.object_key === input.objectKey) return;
  try { await input.bucket.delete(input.objectKey); } catch { /* safe orphan retry */ }
}

async function deleteBlobKeyIfUnreferenced(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  objectKey: string;
}) {
  let references: { value: number } | null;
  try {
    references = await input.db.prepare(`select count(*) as value from v2_backup_blob_refs where object_key=?`)
      .bind(input.objectKey).first<{ value: number }>();
  } catch {
    return;
  }
  if (Number(references?.value ?? 0) !== 0) return;
  try { await input.bucket.delete(input.objectKey); } catch { /* GC may reclaim the unreferenced generation later */ }
}

async function abortMultipartUnlessAdopted(input: {
  db: D1DatabaseBinding;
  snapshotId: string;
  sha256: string;
  objectKey: string;
  uploadId: string;
  upload: { abort(): Promise<void> };
}) {
  let adopted: { object_key: string; upload_id: string | null } | null;
  try {
    adopted = await input.db.prepare(`select object_key,upload_id from v2_backup_blob_work_items where snapshot_id=? and sha256=? limit 1`)
      .bind(input.snapshotId, input.sha256).first<{ object_key: string; upload_id: string | null }>();
  } catch {
    return;
  }
  if (adopted?.object_key === input.objectKey && adopted.upload_id === input.uploadId) return;
  try { await input.upload.abort(); } catch { /* only this unadopted generation is affected */ }
}

export async function getBackupWorkflow(db: D1DatabaseBinding, userId: string, snapshotId: string) {
  const snapshot = await snapshotRow(db, userId, snapshotId);
  if (!snapshot) throw new Error("backup_snapshot_not_found");
  const metadata = await db.prepare(`select count(*) as total,sum(case when status='verified' then 1 else 0 end) as verified,count(distinct case when status='verified' then base_path end) as tables,coalesce(sum(record_count),0) as records from v2_backup_metadata_files where snapshot_id=?`).bind(snapshotId).first<{ total: number; verified: number; tables: number; records: number }>();
  const blobs = await db.prepare(`select count(*) as total,sum(case when status='verified' then 1 else 0 end) as verified,coalesce(sum(next_offset),0) as copied,coalesce(sum(size_bytes),0) as bytes from v2_backup_blob_work_items where snapshot_id=?`).bind(snapshotId).first<{ total: number; verified: number; copied: number; bytes: number }>();
  return {
    snapshotId: snapshot.id,
    snapshotKind: snapshot.snapshot_kind,
    status: snapshot.status,
    phase: snapshot.status === "succeeded" ? "complete" : snapshot.build_phase,
    stateRevision: snapshot.state_revision,
    endSequence: snapshot.end_sequence,
    manifestRootHash: snapshot.manifest_root_hash,
    failureCode: snapshot.failure_code,
    progress: {
      tablesComplete: Math.min(Math.max(Number(parseCursor(snapshot.cursor_json).descriptorIndex ?? 0), Number(metadata?.tables ?? 0)), CANONICAL_TABLES_V1.length),
      tablesTotal: CANONICAL_TABLES_V1.length,
      metadataFilesVerified: Number(metadata?.verified ?? 0),
      metadataFilesTotal: Number(metadata?.total ?? 0),
      metadataRecords: Number(metadata?.records ?? 0),
      blobsComplete: Number(blobs?.verified ?? 0),
      blobsTotal: Number(blobs?.total ?? 0),
      blobBytesCopied: Number(blobs?.copied ?? 0),
      blobBytesTotal: Number(blobs?.bytes ?? 0),
    },
  };
}

export async function stageBackupWorkflow(input: { db: D1DatabaseBinding; userId: string; kind: "full" | "incremental"; retentionClass?: BackupRetentionClass; idempotencyKey: string; now?: string }) {
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const existing = await input.db.prepare(`select id,snapshot_kind,retention_class from v2_backup_snapshots where user_id=? and idempotency_key=? limit 1`).bind(input.userId, idempotencyKey).first<{ id: string; snapshot_kind: string; retention_class: string }>();
  const retentionClass = input.retentionClass ?? "manual";
  if (existing) {
    if (existing.snapshot_kind !== input.kind || existing.retention_class !== retentionClass) throw new Error("backup_idempotency_conflict");
    return getBackupWorkflow(input.db, input.userId, existing.id);
  }
  const previous = await input.db.prepare(`select id,end_sequence from v2_backup_snapshots where user_id=? and status='succeeded' order by end_sequence desc limit 1`).bind(input.userId).first<{ id: string; end_sequence: number }>();
  if (input.kind === "incremental" && !previous) throw new Error("backup_incremental_base_missing");
  const sequence = await input.db.prepare(`select coalesce(max(sequence),0) as value from v2_change_events where user_id=?`).bind(input.userId).first<{ value: number }>();
  const now = input.now ?? new Date().toISOString();
  const snapshotId = ulid();
  await input.db.prepare(`insert into v2_backup_snapshots
    (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,created_at,workflow_version,idempotency_key,build_phase,cursor_json,state_revision,last_progress_at)
    values (?,?,?,'building',?,?,?,?,?,2,?,'metadata',?,0,?)`)
    .bind(snapshotId, input.userId, input.kind, input.kind === "incremental" ? previous?.id ?? null : null, input.kind === "incremental" ? previous?.end_sequence ?? 0 : 0, sequence?.value ?? 0, retentionClass, now, idempotencyKey, canonicalJson({ descriptorIndex: 0, partNumber: 0 }), now).run();
  return getBackupWorkflow(input.db, input.userId, snapshotId);
}

async function queryMetadataPage(db: D1DatabaseBinding, snapshot: BackupSnapshotRow, descriptor: CanonicalTableDescriptor, cursor: BackupCursor) {
  const scoped = descriptor.query(snapshot.user_id, fullFidelityCanonicalScope(BACKUP_SCOPE));
  const changeKinds = descriptor.primaryKey.length === 1 ? CHANGE_KIND_BY_TABLE.get(descriptor.table) : undefined;
  if (snapshot.snapshot_kind === "incremental" && changeKinds) {
    const primary = descriptor.primaryKey[0];
    const after = typeof cursor.primaryKey?.[0] === "string" ? cursor.primaryKey[0] : "";
    const kinds = changeKinds.map(() => "?").join(",");
    const result = await db.prepare(`with scoped as (${scoped.sql}), changed as (
      select aggregate_id from v2_change_events where user_id=? and sequence>? and sequence<=? and aggregate_kind in (${kinds}) and aggregate_id>? group by aggregate_id order by aggregate_id limit ?
    ) select changed.aggregate_id as __backup_change_id,scoped.* from changed left join scoped on scoped.${quoteIdentifier(primary)}=changed.aggregate_id order by changed.aggregate_id`)
      .bind(...scoped.bindings, snapshot.user_id, snapshot.base_sequence, snapshot.end_sequence, ...changeKinds, after, METADATA_ROWS_PER_ADVANCE)
      .all<Record<string, unknown>>();
    const rows = result.results.map((value) => {
      const changedId = String(value.__backup_change_id);
      const { __backup_change_id: _ignored, ...row } = value;
      if (row[primary] === null || row[primary] === undefined) return { [primary]: changedId, [BACKUP_DELTA_OPERATION_FIELD]: BACKUP_DELTA_TOMBSTONE };
      return row;
    });
    return { rows, primaryKeys: result.results.map((row) => [String(row.__backup_change_id)]), delta: true };
  }
  const keys = descriptor.primaryKey.map(quoteIdentifier);
  const afterValues = cursor.primaryKey?.length === keys.length ? cursor.primaryKey : null;
  const afterSql = afterValues ? (keys.length === 1 ? `where ${keys[0]} > ?` : `where (${keys.join(",")}) > (${keys.map(() => "?").join(",")})`) : "";
  const result = await db.prepare(`select * from (${scoped.sql}) scoped ${afterSql} order by ${keys.join(",")} limit ?`)
    .bind(...scoped.bindings, ...(afterValues ?? []), METADATA_ROWS_PER_ADVANCE)
    .all<Record<string, unknown>>();
  return { rows: result.results, primaryKeys: result.results.map((row) => descriptor.primaryKey.map((key) => row[key])), delta: false };
}

async function advanceMetadata(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const cursor = parseCursor(input.snapshot.cursor_json);
  const descriptorIndex = Number(cursor.descriptorIndex ?? 0);
  if (descriptorIndex >= CANONICAL_TABLES_V1.length) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='metadata_verifying',cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  const descriptor = CANONICAL_TABLES_V1[descriptorIndex];
  const partNumber = Number(cursor.partNumber ?? 0);
  const page = await queryMetadataPage(input.db, input.snapshot, descriptor, cursor);
  if (!page.rows.length && partNumber > 0) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `cursor_json=?,last_progress_at=?`,
      setBindings: [canonicalJson({ descriptorIndex: descriptorIndex + 1, partNumber: 0 }), input.now],
    });
    return;
  }
  const enveloped = page.rows.map((row) => envelopeCanonicalRow(row, input.snapshot.id));
  const lines = enveloped.map((row) => `${canonicalJson(row)}\n`);
  let selectedRows = 0;
  let selectedBytes = 0;
  for (const line of lines) {
    const lineBytes = encoder.encode(line).byteLength;
    if (selectedRows === 0 && lineBytes > MAX_METADATA_FRAGMENT_BYTES) throw new Error("backup_metadata_row_too_large");
    if (selectedBytes + lineBytes > MAX_METADATA_FRAGMENT_BYTES) break;
    selectedRows += 1;
    selectedBytes += lineBytes;
  }
  const payload = lines.slice(0, selectedRows).join("");
  const bytes = encoder.encode(payload);
  const path = backupFragmentPath(descriptor.path, partNumber);
  const hash = sha256Hex(bytes);
  const stableObjectKey = metadataStableObjectKey(input.snapshot, path);
  const attemptObjectKey = metadataAttemptObjectKey(input.snapshot, path, hash);
  const baseMode = input.snapshot.snapshot_kind === "incremental" && page.delta ? "delta" : "full";
  const metadataMode = partNumber === 0 ? baseMode : "delta";
  const finished = selectedRows === page.rows.length && page.rows.length < METADATA_ROWS_PER_ADVANCE;
  const nextCursor = finished
    ? { descriptorIndex: descriptorIndex + 1, partNumber: 0 }
    : { descriptorIndex, partNumber: partNumber + 1, primaryKey: page.primaryKeys[selectedRows - 1] };
  try {
    const stored = await input.bucket.put(attemptObjectKey, bytes, {
      httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
      customMetadata: { snapshotId: input.snapshot.id, table: descriptor.table, sha256: hash, generation: requireLease(input.snapshot).leaseToken },
      sha256: hexToBytes(hash),
    });
    if (stored.size !== bytes.byteLength || stored.customMetadata?.sha256 !== hash) throw new Error("backup_metadata_publish_invalid");
  } catch (error) {
    try { await input.bucket.delete(attemptObjectKey); } catch { /* unique attempt may be retried safely */ }
    throw error;
  }
  try {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='metadata_publishing',cursor_json=?,last_progress_at=?`,
      setBindings: [canonicalJson({ metadataPublication: { path, attemptObjectKey, stableObjectKey, nextCursor } }), input.now],
      statements: [
        input.db.prepare(`insert into v2_backup_metadata_files (snapshot_id,user_id,table_name,base_path,part_number,path,object_key,metadata_mode,size_bytes,sha256,record_count,status,created_at) values (?,?,?,?,?,?,?,?,?,?,?,'publishing',?) on conflict(snapshot_id,path) do update set object_key=excluded.object_key,metadata_mode=excluded.metadata_mode,size_bytes=excluded.size_bytes,sha256=excluded.sha256,record_count=excluded.record_count,status='publishing',verified_at=null`).bind(input.snapshot.id, input.snapshot.user_id, descriptor.table, descriptor.path, partNumber, path, attemptObjectKey, metadataMode, bytes.byteLength, hash, selectedRows, input.now),
      ],
    });
  } catch (error) {
    await deleteMetadataAttemptUnlessAdopted({ ...input, snapshotId: input.snapshot.id, path, attemptObjectKey });
    throw error;
  }
}

async function publishMetadata(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const publication = parseCursor(input.snapshot.cursor_json).metadataPublication;
  if (!publication) throw new Error("backup_metadata_checkpoint_missing");
  const receipt = await input.db.prepare(`select table_name,base_path,path,object_key,metadata_mode,size_bytes,sha256,record_count,status from v2_backup_metadata_files where snapshot_id=? and path=? limit 1`)
    .bind(input.snapshot.id, publication.path).first<MetadataReceipt>();
  if (!receipt || receipt.status !== "publishing" || receipt.object_key !== publication.attemptObjectKey) throw new Error("backup_metadata_checkpoint_missing");
  const attempt = await input.bucket.get(publication.attemptObjectKey);
  if (!attempt || attempt.size !== receipt.size_bytes || attempt.size > MAX_METADATA_FRAGMENT_BYTES || attempt.customMetadata?.sha256 !== receipt.sha256) throw new Error("backup_metadata_publish_invalid");
  const bytes = new Uint8Array(await attempt.arrayBuffer());
  if (bytes.byteLength !== receipt.size_bytes || sha256Hex(bytes) !== receipt.sha256) throw new Error("backup_metadata_publish_invalid");
  const stored = await input.bucket.put(publication.stableObjectKey, bytes, {
    httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
    customMetadata: { snapshotId: input.snapshot.id, table: receipt.table_name, sha256: receipt.sha256 },
    sha256: hexToBytes(receipt.sha256),
  });
  if (stored.size !== receipt.size_bytes || stored.customMetadata?.sha256 !== receipt.sha256) throw new Error("backup_metadata_publish_invalid");
  try {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='metadata',cursor_json=?,last_progress_at=?`,
      setBindings: [canonicalJson(publication.nextCursor), input.now],
      statements: [
        input.db.prepare(`update v2_backup_metadata_files set object_key=?,status='uploaded',verified_at=null where snapshot_id=? and path=? and status='publishing' and object_key=?`).bind(publication.stableObjectKey, input.snapshot.id, publication.path, publication.attemptObjectKey),
      ],
    });
  } catch (error) {
    await deletePublishedMetadataUnlessLive({ db: input.db, bucket: input.bucket, snapshotId: input.snapshot.id, path: publication.path, stableObjectKey: publication.stableObjectKey });
    throw error;
  }
  try { await input.bucket.delete(publication.attemptObjectKey); } catch { /* adopted stable copy is authoritative */ }
}

async function verifyNextMetadata(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const receipt = await input.db.prepare(`select table_name,base_path,path,object_key,metadata_mode,size_bytes,sha256,record_count,status from v2_backup_metadata_files where snapshot_id=? and status='uploaded' order by base_path,part_number limit 1`).bind(input.snapshot.id).first<MetadataReceipt>();
  if (!receipt) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='blob_scanning',cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  const file: ExportFileManifestV1 = { path: receipt.path, bytes: receipt.size_bytes, mediaType: "application/x-ndjson; charset=utf-8", sha256: receipt.sha256, records: receipt.record_count };
  await readAndValidateBackupMetadata(input.bucket, receipt.object_key, file, input.snapshot.id, LIGHTHOUSE_SCHEMA_VERSION);
  await commitBackupStep({
    db: input.db,
    snapshot: input.snapshot,
    now: input.now,
    setSql: `last_progress_at=?`,
    setBindings: [input.now],
    statements: [
      input.db.prepare(`update v2_backup_metadata_files set status='verified',verified_at=? where snapshot_id=? and path=? and status='uploaded'`).bind(input.now, input.snapshot.id, receipt.path),
    ],
  });
}

async function scanNextBlob(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const cursor = parseCursor(input.snapshot.cursor_json);
  const descriptor = CANONICAL_TABLES_V1.find((item) => item.table === "v2_attachment_reservations");
  if (!descriptor) throw new Error("backup_attachment_descriptor_missing");
  const scoped = descriptor.query(input.snapshot.user_id, fullFidelityCanonicalScope(BACKUP_SCOPE));
  const attachment = await input.db.prepare(`select * from (${scoped.sql}) scoped where status='committed' and id>? order by id limit 1`).bind(...scoped.bindings, cursor.attachmentId ?? "").first<Record<string, unknown>>();
  if (!attachment) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='blob_copying',cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  const attachmentId = String(attachment.id ?? "");
  const sha256 = String(attachment.sha256 ?? "").replace(/^sha256:/, "");
  const sizeBytes = Number(attachment.size_bytes ?? -1);
  const mediaType = String(attachment.mime_type ?? "application/octet-stream");
  const sourceObjectKey = String(attachment.object_key ?? "");
  if (!attachmentId || !sourceObjectKey || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error("backup_attachment_metadata_invalid");
  if (sizeBytes > MAX_BLOB_BYTES) throw new Error("backup_blob_capacity_exceeded");
  const source = await input.bucket.head(sourceObjectKey);
  if (!source || source.size !== sizeBytes || checksumHex(source.checksums.sha256) !== sha256) throw new Error(`backup_attachment_source_invalid:${attachmentId}`);
  const objectKey = `users/${ownerHash(input.snapshot.user_id)}/backups/blobs/sha256/${sha256}`;
  await commitBackupStep({
    db: input.db,
    snapshot: input.snapshot,
    now: input.now,
    setSql: `cursor_json=?,last_progress_at=?`,
    setBindings: [canonicalJson({ attachmentId }), input.now],
    statements: [
      input.db.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values (?,?,?,?,?,?,?) on conflict(snapshot_id,sha256) do nothing`).bind(input.snapshot.id, input.snapshot.user_id, sha256, objectKey, sizeBytes, mediaType, input.now),
      input.db.prepare(`insert into v2_backup_blob_work_items (snapshot_id,user_id,sha256,source_object_key,object_key,size_bytes,media_type,status,created_at) values (?,?,?,?,?,?,?,'pending',?) on conflict(snapshot_id,sha256) do nothing`).bind(input.snapshot.id, input.snapshot.user_id, sha256, sourceObjectKey, objectKey, sizeBytes, mediaType, input.now),
      input.db.prepare(`insert into v2_backup_blob_members (snapshot_id,user_id,sha256,attachment_id) values (?,?,?,?) on conflict(snapshot_id,sha256,attachment_id) do nothing`).bind(input.snapshot.id, input.snapshot.user_id, sha256, attachmentId),
    ],
  });
}

type MultipartCheckpoint = Readonly<{
  version: 1;
  parts: readonly { partNumber: number; etag: string }[];
  sha256State: PersistedSha256StateV1;
}>;

function parseMultipartCheckpoint(value: string, nextOffset: number): MultipartCheckpoint {
  const parsed = JSON.parse(value) as MultipartCheckpoint | { partNumber: number; etag: string }[];
  if (Array.isArray(parsed)) {
    if (nextOffset !== 0 || parsed.length !== 0) throw new Error("backup_multipart_receipt_invalid");
    return { version: 1, parts: [], sha256State: initialPersistedSha256State() };
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.parts) || parsed.parts.some((part) => !Number.isSafeInteger(part.partNumber) || part.partNumber < 1 || typeof part.etag !== "string")) {
    throw new Error("backup_multipart_receipt_invalid");
  }
  try {
    if (updatePersistedSha256(parsed.sha256State, new Uint8Array()).length !== nextOffset) throw new Error("backup_multipart_receipt_invalid");
  } catch {
    throw new Error("backup_multipart_receipt_invalid");
  }
  return parsed;
}

function hasLegacyMultipartProgress(value: string, nextOffset: number) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && (nextOffset !== 0 || parsed.length !== 0);
  } catch {
    return false;
  }
}

async function copyNextBlob(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string; recoveredExpiredLease: boolean }) {
  const work = await input.db.prepare(`select sha256,source_object_key,object_key,size_bytes,media_type,status,upload_id,next_offset,next_part_number,parts_json from v2_backup_blob_work_items where snapshot_id=? and status in ('pending','uploading') order by sha256 limit 1`).bind(input.snapshot.id).first<BlobWork>();
  if (!work) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='manifesting',cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  if (work.status === "uploading" && (input.recoveredExpiredLease || hasLegacyMultipartProgress(work.parts_json, work.next_offset))) {
    if (!work.upload_id || !input.bucket.createMultipartUpload || !input.bucket.resumeMultipartUpload) throw new Error("backup_multipart_unavailable");
    try { await input.bucket.resumeMultipartUpload(work.object_key, work.upload_id).abort(); } catch { /* the expired generation is abandoned below */ }
    const objectKey = blobGenerationObjectKey(input.snapshot, work.sha256);
    const upload = await input.bucket.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: work.media_type },
      customMetadata: { sha256: work.sha256, generation: requireLease(input.snapshot).leaseToken },
    });
    try {
      await commitBackupStep({
        db: input.db,
        snapshot: input.snapshot,
        now: input.now,
        setSql: `last_progress_at=?`,
        setBindings: [input.now],
        statements: [
          input.db.prepare(`update v2_backup_blob_work_items set object_key=?,status='uploading',upload_id=?,next_offset=0,next_part_number=1,parts_json='[]',verified_at=null where snapshot_id=? and sha256=? and status='uploading' and upload_id=?`).bind(objectKey, upload.uploadId, input.snapshot.id, work.sha256, work.upload_id),
          input.db.prepare(`update v2_backup_blob_refs set object_key=? where snapshot_id=? and user_id=? and sha256=?`).bind(objectKey, input.snapshot.id, input.snapshot.user_id, work.sha256),
        ],
      });
    } catch (error) {
      await abortMultipartUnlessAdopted({ db: input.db, snapshotId: input.snapshot.id, sha256: work.sha256, objectKey, uploadId: upload.uploadId, upload });
      throw error;
    }
    if (work.object_key !== objectKey) await deleteBlobKeyIfUnreferenced({ db: input.db, bucket: input.bucket, objectKey: work.object_key });
    return;
  }
  if (work.status === "pending") {
    const existing = await input.bucket.head(work.object_key);
    if (existing) {
      if (existing.size !== work.size_bytes || existing.customMetadata?.sha256 !== work.sha256 || checksumHex(existing.checksums.sha256) !== work.sha256) throw new Error(`backup_blob_collision:${work.sha256}`);
      await commitBackupStep({
        db: input.db,
        snapshot: input.snapshot,
        now: input.now,
        setSql: `last_progress_at=?`,
        setBindings: [input.now],
        statements: [
          input.db.prepare(`update v2_backup_blob_work_items set status='verified',next_offset=size_bytes,verified_at=? where snapshot_id=? and sha256=? and status='pending'`).bind(input.now, input.snapshot.id, work.sha256),
        ],
      });
      return;
    }
    if (work.size_bytes === 0) {
      const objectKey = blobGenerationObjectKey(input.snapshot, work.sha256);
      const stored = await input.bucket.put(objectKey, new Uint8Array(), {
        httpMetadata: { contentType: work.media_type },
        customMetadata: { sha256: work.sha256, generation: requireLease(input.snapshot).leaseToken },
        sha256: hexToBytes(work.sha256),
      });
      if (stored.size !== 0 || stored.customMetadata?.sha256 !== work.sha256) throw new Error(`backup_blob_validation_failed:${work.sha256}`);
      try {
        await commitBackupStep({
          db: input.db,
          snapshot: input.snapshot,
          now: input.now,
          setSql: `last_progress_at=?`,
          setBindings: [input.now],
          statements: [
            input.db.prepare(`update v2_backup_blob_work_items set object_key=?,status='verified',next_offset=size_bytes,verified_at=? where snapshot_id=? and sha256=? and status='pending'`).bind(objectKey, input.now, input.snapshot.id, work.sha256),
            input.db.prepare(`update v2_backup_blob_refs set object_key=? where snapshot_id=? and user_id=? and sha256=?`).bind(objectKey, input.snapshot.id, input.snapshot.user_id, work.sha256),
          ],
        });
      } catch (error) {
        await deleteBlobGenerationUnlessAdopted({ ...input, snapshotId: input.snapshot.id, sha256: work.sha256, objectKey });
        throw error;
      }
      return;
    }
    if (!input.bucket.createMultipartUpload || !input.bucket.resumeMultipartUpload) throw new Error("backup_multipart_unavailable");
    const objectKey = blobGenerationObjectKey(input.snapshot, work.sha256);
    const upload = await input.bucket.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: work.media_type },
      customMetadata: { sha256: work.sha256, generation: requireLease(input.snapshot).leaseToken },
    });
    try {
      await commitBackupStep({
        db: input.db,
        snapshot: input.snapshot,
        now: input.now,
        setSql: `last_progress_at=?`,
        setBindings: [input.now],
        statements: [
          input.db.prepare(`update v2_backup_blob_work_items set object_key=?,status='uploading',upload_id=? where snapshot_id=? and sha256=? and status='pending'`).bind(objectKey, upload.uploadId, input.snapshot.id, work.sha256),
          input.db.prepare(`update v2_backup_blob_refs set object_key=? where snapshot_id=? and user_id=? and sha256=?`).bind(objectKey, input.snapshot.id, input.snapshot.user_id, work.sha256),
        ],
      });
    } catch (error) {
      await abortMultipartUnlessAdopted({ db: input.db, snapshotId: input.snapshot.id, sha256: work.sha256, objectKey, uploadId: upload.uploadId, upload });
      throw error;
    }
    return;
  }
  if (!work.upload_id || !input.bucket.resumeMultipartUpload) throw new Error("backup_multipart_receipt_invalid");
  const length = Math.min(BLOB_PART_BYTES, work.size_bytes - work.next_offset);
  if (length <= 0) throw new Error("backup_multipart_receipt_invalid");
  const source = await input.bucket.get(work.source_object_key, { range: { offset: work.next_offset, length } });
  if (!source) throw new Error(`backup_attachment_source_missing:${work.sha256}`);
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.byteLength !== length) throw new Error(`backup_attachment_range_invalid:${work.sha256}`);
  const checkpoint = parseMultipartCheckpoint(work.parts_json, work.next_offset);
  const nextSha256State = updatePersistedSha256(checkpoint.sha256State, bytes);
  const nextOffset = work.next_offset + length;
  const upload = input.bucket.resumeMultipartUpload(work.object_key, work.upload_id);
  if (nextOffset === work.size_bytes && digestPersistedSha256(nextSha256State) !== work.sha256) {
    try { await upload.abort(); } catch { /* failure cleanup retries this adopted generation */ }
    throw new Error(`backup_source_changed_retry:${work.sha256}`);
  }
  const part = await upload.uploadPart(work.next_part_number, bytes);
  const parts = [...checkpoint.parts, part];
  const nextCheckpoint = canonicalJson({ version: 1, parts, sha256State: nextSha256State });
  if (nextOffset === work.size_bytes) {
    const completed = await upload.complete(parts);
    if (completed.size !== work.size_bytes || completed.customMetadata?.sha256 !== work.sha256) throw new Error(`backup_blob_validation_failed:${work.sha256}`);
    try {
      await commitBackupStep({
        db: input.db,
        snapshot: input.snapshot,
        now: input.now,
        setSql: `last_progress_at=?`,
        setBindings: [input.now],
        statements: [
          input.db.prepare(`update v2_backup_blob_work_items set status='verified',next_offset=?,next_part_number=?,parts_json=?,verified_at=? where snapshot_id=? and sha256=? and status='uploading' and upload_id=? and next_offset=?`).bind(nextOffset, work.next_part_number + 1, nextCheckpoint, input.now, input.snapshot.id, work.sha256, work.upload_id, work.next_offset),
        ],
      });
    } catch (error) {
      await deleteBlobGenerationUnlessAdopted({ ...input, snapshotId: input.snapshot.id, sha256: work.sha256, objectKey: work.object_key });
      throw error;
    }
    return;
  }
  await commitBackupStep({
    db: input.db,
    snapshot: input.snapshot,
    now: input.now,
    setSql: `last_progress_at=?`,
    setBindings: [input.now],
    statements: [
      input.db.prepare(`update v2_backup_blob_work_items set next_offset=?,next_part_number=?,parts_json=? where snapshot_id=? and sha256=? and status='uploading' and upload_id=? and next_offset=?`).bind(nextOffset, work.next_part_number + 1, nextCheckpoint, input.snapshot.id, work.sha256, work.upload_id, work.next_offset),
    ],
  });
}

async function writeManifest(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const counts = await input.db.prepare(`select
    (select count(*) from v2_backup_metadata_files where snapshot_id=?) as files,
    (select count(*) from v2_backup_blob_work_items where snapshot_id=?) as blobs,
    (select count(*) from v2_backup_blob_members where snapshot_id=?) as members,
    (select count(*) from v2_backup_metadata_files where snapshot_id=? and status<>'verified')+(select count(*) from v2_backup_blob_work_items where snapshot_id=? and status<>'verified') as incomplete`)
    .bind(input.snapshot.id, input.snapshot.id, input.snapshot.id, input.snapshot.id, input.snapshot.id).first<{ files: number; blobs: number; members: number; incomplete: number }>();
  if (!counts || counts.incomplete !== 0) throw new Error("backup_receipts_incomplete");
  if (counts.files > MAX_MANIFEST_FILES || counts.blobs > MAX_MANIFEST_BLOBS || counts.members > MAX_MANIFEST_MEMBERS) throw new Error("backup_manifest_capacity_exceeded");
  const metadata = await input.db.prepare(`select table_name,base_path,path,object_key,metadata_mode,size_bytes,sha256,record_count,status from v2_backup_metadata_files where snapshot_id=? order by base_path,part_number`).bind(input.snapshot.id).all<MetadataReceipt>();
  const blobRows = await input.db.prepare(`select sha256,object_key,size_bytes,media_type from v2_backup_blob_work_items where snapshot_id=? order by sha256`).bind(input.snapshot.id).all<{ sha256: string; object_key: string; size_bytes: number; media_type: string }>();
  const memberRows = await input.db.prepare(`select sha256,attachment_id from v2_backup_blob_members where snapshot_id=? order by sha256,attachment_id`).bind(input.snapshot.id).all<{ sha256: string; attachment_id: string }>();
  const members = new Map<string, string[]>();
  memberRows.results.forEach((row) => members.set(row.sha256, [...(members.get(row.sha256) ?? []), row.attachment_id]));
  const metadataFiles: ExportFileManifestV1[] = metadata.results.map((row) => ({ path: row.path, bytes: row.size_bytes, mediaType: "application/x-ndjson; charset=utf-8", sha256: row.sha256, records: row.record_count }));
  const metadataModes = Object.fromEntries(metadata.results.map((row) => [row.path, row.metadata_mode]));
  const blobs = blobRows.results.map((row) => ({ sha256: row.sha256, bytes: row.size_bytes, mediaType: row.media_type, attachmentIds: members.get(row.sha256) ?? [], objectKey: row.object_key }));
  const validator = { valid: true, metadataFiles: metadataFiles.length, metadataRecords: metadataFiles.reduce((sum, file) => sum + file.records, 0), blobCount: blobs.length, blobBytes: blobs.reduce((sum, blob) => sum + blob.bytes, 0) };
  const base = { format: "lighthouse-backup" as const, version: 2 as const, schemaVersion: LIGHTHOUSE_SCHEMA_VERSION, snapshotId: input.snapshot.id, snapshotKind: input.snapshot.snapshot_kind, createdAt: input.snapshot.created_at, baseSnapshotId: input.snapshot.base_snapshot_id, baseSequence: input.snapshot.base_sequence, endSequence: input.snapshot.end_sequence, retentionClass: input.snapshot.retention_class, metadataModes, metadataFiles, blobs, validator };
  const manifest: BackupManifestV1 = { ...base, rootHash: backupRootHash(base) };
  const body = `${canonicalJson(manifest)}\n`;
  const bytes = encoder.encode(body);
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("backup_manifest_capacity_exceeded");
  const contentSha256 = sha256Hex(bytes);
  const objectKey = manifestStableObjectKey(input.snapshot);
  const attemptObjectKey = manifestAttemptObjectKey(input.snapshot, manifest.rootHash);
  try {
    const stored = await input.bucket.put(attemptObjectKey, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { snapshotId: input.snapshot.id, rootHash: manifest.rootHash, contentSha256, generation: requireLease(input.snapshot).leaseToken },
      sha256: hexToBytes(contentSha256),
    });
    if (stored.size !== bytes.byteLength || stored.customMetadata?.contentSha256 !== contentSha256) throw new Error("backup_manifest_publish_invalid");
  } catch (error) {
    try { await input.bucket.delete(attemptObjectKey); } catch { /* unique attempt may be retried safely */ }
    throw error;
  }
  try {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='manifest_publishing',cursor_json=?,manifest_object_key=?,manifest_root_hash=?,validator_json=?,referenced_blob_count=?,referenced_blob_bytes=?,last_progress_at=?`,
      setBindings: [canonicalJson({ manifestPublication: { attemptObjectKey, contentSha256 } }), objectKey, manifest.rootHash, canonicalJson(validator), blobs.length, validator.blobBytes, input.now],
    });
  } catch (error) {
    await deleteManifestAttemptUnlessAdopted({ ...input, snapshotId: input.snapshot.id, userId: input.snapshot.user_id, attemptObjectKey });
    throw error;
  }
}

async function publishManifest(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const publication = parseCursor(input.snapshot.cursor_json).manifestPublication;
  if (!publication || !input.snapshot.manifest_object_key || !input.snapshot.manifest_root_hash) throw new Error("backup_manifest_checkpoint_missing");
  const attempt = await input.bucket.get(publication.attemptObjectKey);
  if (!attempt || attempt.size <= 0 || attempt.size > MAX_MANIFEST_BYTES || attempt.customMetadata?.rootHash !== input.snapshot.manifest_root_hash || attempt.customMetadata?.contentSha256 !== publication.contentSha256) throw new Error("backup_manifest_publish_invalid");
  const bytes = new Uint8Array(await attempt.arrayBuffer());
  if (bytes.byteLength !== attempt.size || sha256Hex(bytes) !== publication.contentSha256) throw new Error("backup_manifest_publish_invalid");
  const stored = await input.bucket.put(input.snapshot.manifest_object_key, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { snapshotId: input.snapshot.id, rootHash: input.snapshot.manifest_root_hash, contentSha256: publication.contentSha256 },
    sha256: hexToBytes(publication.contentSha256),
  });
  if (stored.size !== bytes.byteLength || stored.customMetadata?.contentSha256 !== publication.contentSha256) throw new Error("backup_manifest_publish_invalid");
  try {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='manifest_verifying',cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
  } catch (error) {
    await deletePublishedManifestUnlessLive({ db: input.db, bucket: input.bucket, snapshotId: input.snapshot.id, userId: input.snapshot.user_id, stableObjectKey: input.snapshot.manifest_object_key });
    throw error;
  }
  try { await input.bucket.delete(publication.attemptObjectKey); } catch { /* stable manifest is already authoritative */ }
}

async function verifyManifest(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  if (!input.snapshot.manifest_object_key || !input.snapshot.manifest_root_hash) throw new Error("backup_manifest_checkpoint_missing");
  const object = await input.bucket.get(input.snapshot.manifest_object_key);
  if (!object || object.size <= 0 || object.size > MAX_MANIFEST_BYTES || object.customMetadata?.rootHash !== input.snapshot.manifest_root_hash) throw new Error("backup_manifest_validation_failed");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const manifest = validateBackupManifest(JSON.parse(text));
  if (manifest.version !== 2 || manifest.snapshotId !== input.snapshot.id || manifest.rootHash !== input.snapshot.manifest_root_hash || sha256Hex(bytes) !== sha256Hex(`${canonicalJson(manifest)}\n`)) throw new Error("backup_manifest_validation_failed");
  const finalSequence = await input.db.prepare(`select coalesce(max(sequence),0) as value from v2_change_events where user_id=?`).bind(input.snapshot.user_id).first<{ value: number }>();
  if ((finalSequence?.value ?? 0) !== input.snapshot.end_sequence) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `build_phase='failure_cleaning',failure_code='backup_source_changed_retry',cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  await commitBackupStep({
    db: input.db,
    snapshot: input.snapshot,
    now: input.now,
    setSql: `status='succeeded',build_phase='complete',verified_at=?,failure_code=null,last_progress_at=?`,
    setBindings: [input.now, input.now],
    nextStatus: "succeeded",
  });
}

async function cleanFailedBackup(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; snapshot: BackupSnapshotRow; now: string }) {
  const cursor = parseCursor(input.snapshot.cursor_json);
  const metadataPublication = cursor.metadataPublication;
  if (metadataPublication) {
    await input.bucket.delete([metadataPublication.attemptObjectKey, metadataPublication.stableObjectKey]);
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  const manifestPublication = cursor.manifestPublication;
  if (manifestPublication) {
    await input.bucket.delete(manifestPublication.attemptObjectKey);
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `cursor_json='{}',last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  const multipart = await input.db.prepare(`select sha256,object_key,upload_id from v2_backup_blob_work_items where snapshot_id=? and upload_id is not null and status<>'verified' order by sha256 limit 1`).bind(input.snapshot.id).first<{ sha256: string; object_key: string; upload_id: string }>();
  if (multipart) {
    if (!input.bucket.resumeMultipartUpload) throw new Error("backup_multipart_unavailable");
    try { await input.bucket.resumeMultipartUpload(multipart.object_key, multipart.upload_id).abort(); } catch { /* cleanup is monotonic and remains resumable */ }
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `last_progress_at=?`,
      setBindings: [input.now],
      statements: [
        input.db.prepare(`update v2_backup_blob_work_items set status='aborted',upload_id=null where snapshot_id=? and sha256=? and upload_id=?`).bind(input.snapshot.id, multipart.sha256, multipart.upload_id),
      ],
    });
    return;
  }
  const metadata = await input.db.prepare(`select path,object_key from v2_backup_metadata_files where snapshot_id=? order by base_path,part_number limit 1`).bind(input.snapshot.id).first<{ path: string; object_key: string }>();
  if (metadata) {
    await input.bucket.delete(metadata.object_key);
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `last_progress_at=?`,
      setBindings: [input.now],
      statements: [
        input.db.prepare(`delete from v2_backup_metadata_files where snapshot_id=? and path=?`).bind(input.snapshot.id, metadata.path),
      ],
    });
    return;
  }
  if (input.snapshot.manifest_object_key) {
    await input.bucket.delete(input.snapshot.manifest_object_key);
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `manifest_object_key=null,manifest_root_hash=null,last_progress_at=?`,
      setBindings: [input.now],
    });
    return;
  }
  const blob = await input.db.prepare(`select sha256,object_key from v2_backup_blob_refs where snapshot_id=? and user_id=? order by sha256 limit 1`).bind(input.snapshot.id, input.snapshot.user_id).first<{ sha256: string; object_key: string }>();
  if (blob) {
    await commitBackupStep({
      db: input.db,
      snapshot: input.snapshot,
      now: input.now,
      setSql: `last_progress_at=?`,
      setBindings: [input.now],
      statements: [
        input.db.prepare(`insert into v2_backup_blob_gc_marks (user_id,sha256,object_key,unreferenced_since,last_checked_at,deleted_at) values (?,?,?,?,?,null) on conflict(user_id,sha256) do update set object_key=excluded.object_key,last_checked_at=excluded.last_checked_at`).bind(input.snapshot.user_id, blob.sha256, blob.object_key, input.now, input.now),
        input.db.prepare(`delete from v2_backup_blob_members where snapshot_id=? and sha256=?`).bind(input.snapshot.id, blob.sha256),
        input.db.prepare(`delete from v2_backup_blob_work_items where snapshot_id=? and sha256=?`).bind(input.snapshot.id, blob.sha256),
        input.db.prepare(`delete from v2_backup_blob_refs where snapshot_id=? and user_id=? and sha256=?`).bind(input.snapshot.id, input.snapshot.user_id, blob.sha256),
      ],
    });
    return;
  }
  await commitBackupStep({
    db: input.db,
    snapshot: input.snapshot,
    now: input.now,
    setSql: `status='failed',build_phase='complete',cursor_json='{}',validator_json=null,referenced_blob_count=0,referenced_blob_bytes=0,verified_at=null,last_progress_at=?`,
    setBindings: [input.now],
    statements: [
      input.db.prepare(`delete from v2_backup_blob_members where snapshot_id=?`).bind(input.snapshot.id),
      input.db.prepare(`delete from v2_backup_blob_work_items where snapshot_id=?`).bind(input.snapshot.id),
    ],
    nextStatus: "failed",
  });
}

export async function advanceBackupWorkflow(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; snapshotId: string; now?: string }) {
  const initial = await snapshotRow(input.db, input.userId, input.snapshotId);
  if (!initial) throw new Error("backup_snapshot_not_found");
  if (initial.workflow_version !== 2) throw new Error("backup_legacy_workflow_not_resumable");
  if (initial.status === "succeeded" || initial.status === "failed") return getBackupWorkflow(input.db, input.userId, input.snapshotId);
  if (initial.status !== "building") throw new Error("backup_workflow_state_invalid");
  const now = input.now ?? new Date().toISOString();
  const leaseToken = ulid();
  const leaseExpiresAt = new Date(new Date(now).getTime() + LEASE_MILLISECONDS).toISOString();
  const claim = await input.db.prepare(`update v2_backup_snapshots set lease_token=?,lease_expires_at=?,state_revision=state_revision+1 where id=? and user_id=? and status='building' and state_revision=? and (lease_token is null or lease_expires_at is null or lease_expires_at<=?)`)
    .bind(leaseToken, leaseExpiresAt, input.snapshotId, input.userId, initial.state_revision, now).run();
  if (d1ResultChanges(claim) !== 1) throw new Error("backup_workflow_busy");
  const snapshot = await snapshotRow(input.db, input.userId, input.snapshotId);
  if (!snapshot || snapshot.lease_token !== leaseToken || snapshot.state_revision !== initial.state_revision + 1) throw new Error("backup_workflow_busy");
  const recoveredExpiredLease = initial.lease_token !== null;
  let transientError: unknown;
  try {
    if (snapshot.build_phase === "metadata") await advanceMetadata({ ...input, snapshot, now });
    else if (snapshot.build_phase === "metadata_publishing") await publishMetadata({ ...input, snapshot, now });
    else if (snapshot.build_phase === "metadata_verifying") await verifyNextMetadata({ ...input, snapshot, now });
    else if (snapshot.build_phase === "blob_scanning") await scanNextBlob({ ...input, snapshot, now });
    else if (snapshot.build_phase === "blob_copying") await copyNextBlob({ ...input, snapshot, now, recoveredExpiredLease });
    else if (snapshot.build_phase === "manifesting") await writeManifest({ ...input, snapshot, now });
    else if (snapshot.build_phase === "manifest_publishing") await publishManifest({ ...input, snapshot, now });
    else if (snapshot.build_phase === "manifest_verifying") await verifyManifest({ ...input, snapshot, now });
    else if (snapshot.build_phase === "failure_cleaning") await cleanFailedBackup({ ...input, snapshot, now });
    else throw new Error("backup_workflow_state_invalid");
  } catch (error) {
    const code = errorCode(error);
    if (DETERMINISTIC_FAILURE_CODES.has(code)) {
      await commitBackupStep({
        db: input.db,
        snapshot,
        now,
        setSql: `build_phase='failure_cleaning',failure_code=?,last_progress_at=?`,
        setBindings: [code, now],
      });
    } else transientError = error;
  } finally {
    await input.db.prepare(`update v2_backup_snapshots set lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=? and state_revision=?`)
      .bind(input.snapshotId, input.userId, leaseToken, snapshot.state_revision).run();
  }
  if (transientError) throw transientError;
  return getBackupWorkflow(input.db, input.userId, input.snapshotId);
}
