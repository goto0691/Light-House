import { createHash } from "node:crypto";
import { ulid } from "ulidx";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { CANONICAL_TABLES_V1, canonicalTablesForSchemaVersion, fullFidelityCanonicalScope } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, envelopeCanonicalRow, exportRootHash, LIGHTHOUSE_SCHEMA_VERSION, sha256Hex, SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS, type ExportFileManifestV1, type ExportScopeV1, type LighthouseSchemaVersion } from "@/lib/v2/portability/portability-contract-v1";

const encoder = new TextEncoder();
const BACKUP_SCOPE: ExportScopeV1 = { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true };
const MULTIPART_BYTES = 8 * 1024 * 1024;
const D1_BATCH_LIMIT = 80;
export const BACKUP_DELTA_OPERATION_FIELD = "__lighthouse_backup_operation";
export const BACKUP_DELTA_TOMBSTONE = "tombstone";
export const LEGACY_BACKUP_SCHEMA_VERSION = "v2-017" as const;

function requireLegacySynchronousBackupHarness() {
  if (process.env.NODE_ENV !== "test") throw new Error("legacy_synchronous_backup_disabled");
}

export type BackupRetentionClass = "manual" | "daily" | "weekly" | "monthly";

export type BackupManifestV1 = Readonly<{
  format: "lighthouse-backup";
  version: 1 | 2;
  schemaVersion: LighthouseSchemaVersion;
  snapshotId: string;
  snapshotKind: "full" | "incremental";
  createdAt: string;
  baseSnapshotId: string | null;
  baseSequence: number;
  endSequence: number;
  retentionClass: BackupRetentionClass;
  metadataModes: Readonly<Record<string, "full" | "delta">>;
  metadataFiles: readonly ExportFileManifestV1[];
  blobs: readonly Readonly<{ sha256: string; bytes: number; mediaType: string; attachmentIds: readonly string[]; objectKey: string }>[];
  rootHash: string;
  validator: Readonly<{ valid: boolean; metadataFiles: number; metadataRecords: number; blobCount: number; blobBytes: number }>;
}>;

type StoredBackupManifestV1 = Omit<BackupManifestV1, "schemaVersion"> & Readonly<{
  schemaVersion?: LighthouseSchemaVersion;
}>;

const CHANGE_KIND_BY_TABLE = new Map<string, string>([
  ["v2_capture_bundles", "capture_bundle"], ["v2_source_items", "source_item"], ["v2_document_revisions", "document_revision"],
  ["v2_documents", "document"], ["v2_property_values", "property_value"], ["v2_relation_edges", "relation"],
  ["v2_capture_templates", "capture_template"], ["v2_saved_views", "saved_view"],
  ["v2_link_snapshots", "link_snapshot"], ["v2_link_snapshot_sources", "link_snapshot_source"],
  ["v2_link_fragments", "link_fragment"], ["v2_link_fragment_evidence", "link_fragment_evidence"],
  ["v2_link_curation_revisions", "link_curation_revision"], ["v2_link_curation_items", "link_curation_item"], ["v2_link_curation_examples", "link_curation_example"],
]);

function changeKindsForTable(table: string): readonly string[] {
  if (table === "v2_objects") return ["object", "document", "entity", "event"] as const;
  const kind = CHANGE_KIND_BY_TABLE.get(table);
  return kind ? [kind] : [];
}

export function rollbackTombstoneAggregateKind(table: string) {
  if (table === "v2_objects") return "object";
  return CHANGE_KIND_BY_TABLE.get(table) ?? `canonical_row:${table}`;
}

export function isBackupDeltaTombstone(row: Record<string, unknown>) {
  return row[BACKUP_DELTA_OPERATION_FIELD] === BACKUP_DELTA_TOMBSTONE;
}

function isDeltaMetadataTable(table: string) {
  return table === "v2_objects" || CHANGE_KIND_BY_TABLE.has(table);
}

export function backupDescriptorsForSchemaVersion(schemaVersion: LighthouseSchemaVersion) {
  if (!SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.includes(schemaVersion)) throw new Error("backup_schema_version_unsupported");
  return canonicalTablesForSchemaVersion(schemaVersion);
}

export function backupRootHash(value: Pick<BackupManifestV1, "metadataFiles" | "blobs" | "baseSequence" | "endSequence" | "metadataModes" | "retentionClass" | "schemaVersion">) {
  const legacyInput = `${exportRootHash(value.metadataFiles)}\0${canonicalJson(value.blobs)}\0${value.baseSequence}\0${value.endSequence}\0${canonicalJson(value.metadataModes)}\0${value.retentionClass}`;
  const schemaBinding = value.schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION ? "" : `\0${value.schemaVersion}`;
  return `sha256:${sha256Hex(`${legacyInput}${schemaBinding}`)}`;
}

export function validateBackupManifest(value: unknown): BackupManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("backup_chain_manifest_invalid");
  const candidate = value as Partial<StoredBackupManifestV1> & { schemaVersion?: unknown };
  const schemaVersion = candidate.schemaVersion === undefined
    ? LEGACY_BACKUP_SCHEMA_VERSION
    : candidate.schemaVersion;
  if (!SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.includes(schemaVersion as LighthouseSchemaVersion)) throw new Error("backup_schema_version_unsupported");
  if (
    candidate.format !== "lighthouse-backup"
    || (candidate.version !== 1 && candidate.version !== 2)
    || typeof candidate.snapshotId !== "string"
    || (candidate.snapshotKind !== "full" && candidate.snapshotKind !== "incremental")
    || typeof candidate.createdAt !== "string"
    || (candidate.baseSnapshotId !== null && typeof candidate.baseSnapshotId !== "string")
    || !Number.isSafeInteger(candidate.baseSequence)
    || Number(candidate.baseSequence) < 0
    || !Number.isSafeInteger(candidate.endSequence)
    || Number(candidate.endSequence) < Number(candidate.baseSequence)
    || !["manual", "daily", "weekly", "monthly"].includes(String(candidate.retentionClass))
    || !candidate.metadataModes
    || typeof candidate.metadataModes !== "object"
    || Array.isArray(candidate.metadataModes)
    || !Array.isArray(candidate.metadataFiles)
    || !Array.isArray(candidate.blobs)
    || typeof candidate.rootHash !== "string"
    || !candidate.validator
    || candidate.validator.valid !== true
  ) throw new Error("backup_chain_manifest_invalid");

  const metadataFiles = candidate.metadataFiles as readonly ExportFileManifestV1[];
  const actualPaths = metadataFiles.map((file) => file?.path);
  const requiredPaths = backupDescriptorsForSchemaVersion(schemaVersion as LighthouseSchemaVersion).map((descriptor) => descriptor.path);
  const basePaths = actualPaths.map((path) => typeof path === "string" ? backupBasePath(path) : null);
  const metadataModePaths = Object.keys(candidate.metadataModes);
  if (
    metadataFiles.some((file) =>
      !file
      || typeof file.path !== "string"
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 0
      || typeof file.mediaType !== "string"
      || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.records)
      || file.records < 0
    )
    || new Set(actualPaths).size !== actualPaths.length
    || (candidate.version === 1 && (actualPaths.length !== requiredPaths.length || requiredPaths.some((path) => !actualPaths.includes(path))))
    || (candidate.version === 2 && (basePaths.some((path) => path === null) || requiredPaths.some((path) => !basePaths.includes(path))))
    || (candidate.version === 1 && (metadataModePaths.length !== requiredPaths.length || requiredPaths.some((path) => candidate.metadataModes?.[path] !== "full" && candidate.metadataModes?.[path] !== "delta")))
    || (candidate.version === 2 && (metadataModePaths.length !== actualPaths.length || actualPaths.some((path) => candidate.metadataModes?.[path] !== "full" && candidate.metadataModes?.[path] !== "delta")))
  ) throw new Error("backup_chain_metadata_contract_invalid");
  if (candidate.version === 2) {
    for (const basePath of requiredPaths) {
      const fragments = actualPaths.filter((path) => backupBasePath(path) === basePath).sort();
      if (!fragments.length || fragments.slice(1).some((path) => candidate.metadataModes?.[path] !== "delta")) {
        throw new Error("backup_chain_metadata_contract_invalid");
      }
    }
  }

  const manifest = { ...candidate, schemaVersion } as BackupManifestV1;
  if (backupRootHash(manifest) !== manifest.rootHash) throw new Error("backup_chain_root_hash_invalid");
  return manifest;
}

export function backupFragmentPath(basePath: string, partNumber: number) {
  if (!Number.isSafeInteger(partNumber) || partNumber < 0) throw new Error("backup_fragment_part_invalid");
  return `${basePath}.parts/${String(partNumber).padStart(8, "0")}.jsonl`;
}

export function backupBasePath(path: string) {
  if (CANONICAL_TABLES_V1.some((descriptor) => descriptor.path === path)) return path;
  const match = /^(.*\.jsonl)\.parts\/\d{8}\.jsonl$/.exec(path);
  if (!match || !CANONICAL_TABLES_V1.some((descriptor) => descriptor.path === match[1])) return null;
  return match[1];
}

async function runBatches(db: D1DatabaseBinding, statements: D1PreparedStatementBinding[]) {
  for (let offset = 0; offset < statements.length; offset += D1_BATCH_LIMIT) await db.batch(statements.slice(offset, offset + D1_BATCH_LIMIT));
}

export async function readAndValidateBackupMetadata(bucket: R2BucketBinding, key: string, file: ExportFileManifestV1, snapshotId: string, schemaVersion: LighthouseSchemaVersion) {
  const object = await bucket.get(key);
  if (!object) throw new Error(`backup_metadata_validation_failed:${file.path}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== file.bytes || sha256Hex(bytes) !== file.sha256 || object.customMetadata?.sha256 !== file.sha256) throw new Error(`backup_metadata_validation_failed:${file.path}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text && !text.endsWith("\n")) throw new Error(`backup_metadata_schema_invalid:${file.path}`);
  const rows = text ? text.slice(0, -1).split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
  if (rows.length !== file.records || rows.some((row) =>
    row.schema_version !== schemaVersion
    || row.user_scope_export_id !== snapshotId
    || (BACKUP_DELTA_OPERATION_FIELD in row && !isBackupDeltaTombstone(row))
  )) throw new Error(`backup_metadata_schema_invalid:${file.path}`);
  return rows;
}

async function rows(db: D1DatabaseBinding, userId: string, descriptor: (typeof CANONICAL_TABLES_V1)[number]) {
  const query = descriptor.query(userId, fullFidelityCanonicalScope(BACKUP_SCOPE));
  return (await db.prepare(query.sql).bind(...query.bindings).all<Record<string, unknown>>()).results;
}

export async function uploadVerifiedStream(input: { bucket: R2BucketBinding; key: string; body: ReadableStream<Uint8Array>; mediaType: string; expectedHash: string; expectedBytes?: number; customMetadata?: Record<string, string> }) {
  const { bucket, key, body, mediaType, expectedHash } = input;
  if (!bucket.createMultipartUpload) throw new Error("backup_multipart_unavailable");
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: mediaType }, customMetadata: { sha256: expectedHash, ...input.customMetadata } });
  const parts: { partNumber: number; etag: string }[] = [];
  const hash = createHash("sha256");
  const reader = body.getReader();
  let pending = new Uint8Array(MULTIPART_BYTES); let pendingBytes = 0; let partNumber = 1; let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      hash.update(item.value); total += item.value.byteLength;
      let offset = 0;
      while (offset < item.value.byteLength) {
        const copied = Math.min(pending.byteLength - pendingBytes, item.value.byteLength - offset);
        pending.set(item.value.subarray(offset, offset + copied), pendingBytes); pendingBytes += copied; offset += copied;
        if (pendingBytes === pending.byteLength) { parts.push(await upload.uploadPart(partNumber, pending)); partNumber += 1; pending = new Uint8Array(MULTIPART_BYTES); pendingBytes = 0; }
      }
    }
    if (pendingBytes || !parts.length) parts.push(await upload.uploadPart(partNumber, pending.subarray(0, pendingBytes)));
    if (hash.digest("hex") !== expectedHash) throw new Error("backup_attachment_hash_mismatch");
    if (input.expectedBytes !== undefined && total !== input.expectedBytes) throw new Error("backup_attachment_size_mismatch");
    await upload.complete(parts);
    return total;
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

export async function createBackupSnapshot(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; kind: "full" | "incremental"; retentionClass?: BackupRetentionClass; now?: string }) {
  requireLegacySynchronousBackupHarness();
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  const owner = sha256Hex(input.userId).slice(0, 24);
  const previous = await input.db.prepare(`select id,end_sequence from v2_backup_snapshots where user_id=? and status='succeeded' order by end_sequence desc limit 1`).bind(input.userId).first<{ id: string; end_sequence: number }>();
  if (input.kind === "incremental" && !previous) throw new Error("backup_incremental_base_missing");
  const baseSnapshotId = input.kind === "incremental" ? previous?.id ?? null : null;
  const baseSequence = input.kind === "incremental" ? previous?.end_sequence ?? 0 : 0;
  const retentionClass = input.retentionClass ?? "manual";
  const sequence = await input.db.prepare(`select coalesce(max(sequence),0) as value from v2_change_events where user_id=?`).bind(input.userId).first<{ value: number }>();
  const endSequence = sequence?.value ?? 0;
  await input.db.prepare(`insert into v2_backup_snapshots (id,user_id,snapshot_kind,status,base_snapshot_id,base_sequence,end_sequence,retention_class,created_at) values (?,?,?,'building',?,?,?,?,?)`).bind(id, input.userId, input.kind, baseSnapshotId, baseSequence, endSequence, retentionClass, now).run();
  const metadataFiles: ExportFileManifestV1[] = [];
  const metadataModes: Record<string, "full" | "delta"> = {};
  const uploadedMetadata: string[] = [];
  const uploadedNewBlobs: { sha256: string; objectKey: string }[] = [];
  try {
    const changed = input.kind === "incremental" ? await input.db.prepare(`select distinct aggregate_kind,aggregate_id from v2_change_events where user_id=? and sequence>? and sequence<=?`).bind(input.userId, baseSequence, endSequence).all<{ aggregate_kind: string; aggregate_id: string }>() : null;
    for (const descriptor of CANONICAL_TABLES_V1) {
      let tableRows = await rows(input.db, input.userId, descriptor);
      const delta = input.kind === "incremental" && descriptor.primaryKey.length === 1 && isDeltaMetadataTable(descriptor.table);
      metadataModes[descriptor.path] = delta ? "delta" : "full";
      if (delta) {
        const primary = descriptor.primaryKey[0];
        const changeKinds = changeKindsForTable(descriptor.table);
        const changedPrimaryIds = new Set(
          changed?.results
            .filter((item) => changeKinds.includes(item.aggregate_kind))
            .map((item) => item.aggregate_id) ?? [],
        );
        tableRows = tableRows.filter((row) => changedPrimaryIds.has(String(row[primary])));
        const presentPrimaryIds = new Set(tableRows.map((row) => String(row[primary])));
        const tombstones = [...changedPrimaryIds]
          .filter((aggregateId) => !presentPrimaryIds.has(aggregateId))
          .sort()
          .map((aggregateId) => ({
            [primary]: aggregateId,
            [BACKUP_DELTA_OPERATION_FIELD]: BACKUP_DELTA_TOMBSTONE,
          }));
        tableRows = [...tableRows, ...tombstones];
      }
      const payload = tableRows.map((row) => canonicalJson(envelopeCanonicalRow(row, id))).join("\n") + (tableRows.length ? "\n" : "");
      const bytes = encoder.encode(payload);
      const file: ExportFileManifestV1 = { path: descriptor.path, bytes: bytes.byteLength, mediaType: "application/x-ndjson; charset=utf-8", sha256: sha256Hex(bytes), records: tableRows.length };
      const key = `users/${owner}/backups/snapshots/${id}/metadata/${descriptor.path}`;
      await input.bucket.put(key, bytes, { httpMetadata: { contentType: file.mediaType }, customMetadata: { snapshotId: id, table: descriptor.table, sha256: file.sha256 } });
      metadataFiles.push(file); uploadedMetadata.push(key);
    }
    for (const [index, file] of metadataFiles.entries()) {
      await readAndValidateBackupMetadata(input.bucket, uploadedMetadata[index], file, id, LIGHTHOUSE_SCHEMA_VERSION);
    }
    const attachmentRows = await rows(input.db, input.userId, CANONICAL_TABLES_V1.find((item) => item.table === "v2_attachment_reservations")!);
    const blobMap = new Map<string, { sha256: string; bytes: number; mediaType: string; attachmentIds: string[]; objectKey: string }>();
    for (const attachment of attachmentRows) {
      if (attachment.status !== "committed") continue;
      const hash = String(attachment.sha256).replace(/^sha256:/, "");
      const blobKey = `users/${owner}/backups/blobs/sha256/${hash}`;
      const existing = await input.bucket.head(blobKey);
      if (!existing) {
        const original = await input.bucket.get(String(attachment.object_key));
        if (!original) throw new Error(`backup_attachment_missing:${String(attachment.id)}`);
        const bytes = await uploadVerifiedStream({ bucket: input.bucket, key: blobKey, body: original.body, mediaType: String(attachment.mime_type), expectedHash: hash, expectedBytes: Number(attachment.size_bytes) });
        if (bytes !== Number(attachment.size_bytes)) { await input.bucket.delete(blobKey); throw new Error(`backup_attachment_size_mismatch:${String(attachment.id)}`); }
        uploadedNewBlobs.push({ sha256: hash, objectKey: blobKey });
      } else if (existing.size !== Number(attachment.size_bytes) || existing.customMetadata?.sha256 !== hash) {
        throw new Error(`backup_blob_collision:${hash}`);
      }
      const current = blobMap.get(hash) ?? { sha256: hash, bytes: Number(attachment.size_bytes), mediaType: String(attachment.mime_type), attachmentIds: [], objectKey: blobKey };
      current.attachmentIds.push(String(attachment.id)); blobMap.set(hash, current);
    }
    const blobs = [...blobMap.values()].map((blob) => ({ ...blob, attachmentIds: blob.attachmentIds.sort() }));
    for (const blob of blobs) {
      const head = await input.bucket.head(blob.objectKey);
      if (!head || head.size !== blob.bytes || head.customMetadata?.sha256 !== blob.sha256) throw new Error(`backup_blob_validation_failed:${blob.sha256}`);
    }
    const validator = { valid: true, metadataFiles: metadataFiles.length, metadataRecords: metadataFiles.reduce((sum, file) => sum + file.records, 0), blobCount: blobs.length, blobBytes: blobs.reduce((sum, blob) => sum + blob.bytes, 0) };
    const manifestBase = { format: "lighthouse-backup" as const, version: 1 as const, schemaVersion: LIGHTHOUSE_SCHEMA_VERSION, snapshotId: id, snapshotKind: input.kind, createdAt: now, baseSnapshotId, baseSequence, endSequence, retentionClass, metadataModes, metadataFiles, blobs, validator };
    const rootHash = backupRootHash(manifestBase);
    const manifest: BackupManifestV1 = { ...manifestBase, rootHash };
    const manifestKey = `users/${owner}/backups/snapshots/${id}/manifest.json`;
    await input.bucket.put(manifestKey, `${canonicalJson(manifest)}\n`, { httpMetadata: { contentType: "application/json" }, customMetadata: { snapshotId: id, rootHash } });
    const manifestObject = await input.bucket.get(manifestKey);
    if (!manifestObject || sha256Hex(new Uint8Array(await manifestObject.arrayBuffer())) !== sha256Hex(`${canonicalJson(manifest)}\n`) || manifestObject.customMetadata?.rootHash !== rootHash) throw new Error("backup_manifest_validation_failed");
    const finalSequence = await input.db.prepare(`select coalesce(max(sequence),0) as value from v2_change_events where user_id=?`).bind(input.userId).first<{ value: number }>();
    if ((finalSequence?.value ?? 0) !== endSequence) throw new Error("backup_source_changed_retry");
    await runBatches(input.db, blobs.map((blob) => input.db.prepare(`insert into v2_backup_blob_refs (snapshot_id,user_id,sha256,object_key,size_bytes,media_type,created_at) values (?,?,?,?,?,?,?)`).bind(id, input.userId, blob.sha256, blob.objectKey, blob.bytes, blob.mediaType, now)));
    await input.db.prepare(`update v2_backup_snapshots set status='succeeded',manifest_object_key=?,manifest_root_hash=?,referenced_blob_count=?,referenced_blob_bytes=?,validator_json=?,verified_at=? where id=? and user_id=? and status='building'`).bind(manifestKey, rootHash, blobs.length, validator.blobBytes, canonicalJson(validator), now, id, input.userId).run();
    return manifest;
  } catch (error) {
    if (uploadedMetadata.length) await input.bucket.delete(uploadedMetadata).catch(() => undefined);
    await input.bucket.delete(`users/${owner}/backups/snapshots/${id}/manifest.json`).catch(() => undefined);
    await input.db.prepare(`delete from v2_backup_blob_refs where snapshot_id=? and user_id=?`).bind(id, input.userId).run().catch(() => undefined);
    for (const blob of uploadedNewBlobs) await input.db.prepare(`insert into v2_backup_blob_gc_marks (user_id,sha256,object_key,unreferenced_since,last_checked_at,deleted_at) select ?,?,?,?,?,null where not exists (select 1 from v2_backup_blob_refs where user_id=? and sha256=?) on conflict(user_id,sha256) do update set object_key=excluded.object_key,last_checked_at=excluded.last_checked_at`).bind(input.userId, blob.sha256, blob.objectKey, now, now, input.userId, blob.sha256).run().catch(() => undefined);
    await input.db.prepare(`update v2_backup_snapshots set status='failed',validator_json=? where id=? and user_id=?`).bind(canonicalJson({ valid: false, error: error instanceof Error ? error.message.split(":")[0] : "backup_failed" }), id, input.userId).run();
    throw error;
  }
}

export async function loadVerifiedBackupChain(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; snapshotId: string }) {
  type SnapshotRow = { id: string; status: string; manifest_object_key: string | null; manifest_root_hash: string | null; base_snapshot_id: string | null };
  const chain: BackupManifestV1[] = [];
  const visited = new Set<string>();
  let currentId: string | null = input.snapshotId;
  while (currentId) {
    if (visited.has(currentId) || visited.size >= 100) throw new Error("backup_chain_cycle_or_limit");
    visited.add(currentId);
    const snapshot: SnapshotRow | null = await input.db.prepare(`select id,status,manifest_object_key,manifest_root_hash,base_snapshot_id from v2_backup_snapshots where id=? and user_id=? limit 1`).bind(currentId, input.userId).first<SnapshotRow>();
    if (!snapshot || snapshot.status !== "succeeded" || !snapshot.manifest_object_key || !snapshot.manifest_root_hash) throw new Error("backup_chain_snapshot_invalid");
    const object = await input.bucket.get(snapshot.manifest_object_key);
    if (!object) throw new Error("backup_chain_manifest_missing");
    const manifest = validateBackupManifest(JSON.parse(await new Response(object.body).text()));
    if (manifest.format !== "lighthouse-backup" || (manifest.version !== 1 && manifest.version !== 2) || manifest.snapshotId !== snapshot.id || manifest.rootHash !== snapshot.manifest_root_hash || manifest.baseSnapshotId !== snapshot.base_snapshot_id) throw new Error("backup_chain_manifest_invalid");
    const owner = sha256Hex(input.userId).slice(0, 24);
    for (const file of manifest.metadataFiles) {
      await readAndValidateBackupMetadata(input.bucket, `users/${owner}/backups/snapshots/${manifest.snapshotId}/metadata/${file.path}`, file, manifest.snapshotId, manifest.schemaVersion).catch(() => { throw new Error("backup_chain_metadata_invalid"); });
    }
    for (const blob of manifest.blobs) {
      const stored = await input.bucket.head(blob.objectKey);
      if (!stored || stored.size !== blob.bytes || stored.customMetadata?.sha256 !== blob.sha256) throw new Error("backup_chain_blob_invalid");
    }
    chain.push(manifest);
    currentId = manifest.snapshotKind === "incremental" ? manifest.baseSnapshotId : null;
  }
  const ordered = chain.reverse();
  if (!ordered.length || ordered[0].snapshotKind !== "full") throw new Error("backup_chain_base_full_missing");
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].baseSnapshotId !== ordered[index - 1].snapshotId || ordered[index].baseSequence !== ordered[index - 1].endSequence || ordered[index].endSequence < ordered[index].baseSequence) throw new Error("backup_chain_sequence_invalid");
    if (SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.indexOf(ordered[index].schemaVersion) < SUPPORTED_LIGHTHOUSE_SCHEMA_VERSIONS.indexOf(ordered[index - 1].schemaVersion)) throw new Error("backup_chain_schema_downgrade");
  }
  return ordered;
}

export async function verifyBackupChain(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; snapshotId: string }) {
  requireLegacySynchronousBackupHarness();
  const ordered = await loadVerifiedBackupChain(input);
  return { valid: true, snapshots: ordered.map((manifest) => ({ id: manifest.snapshotId, kind: manifest.snapshotKind, baseSequence: manifest.baseSequence, endSequence: manifest.endSequence })), endSequence: ordered.at(-1)?.endSequence ?? 0 };
}
