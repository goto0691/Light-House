import { ulid } from "ulidx";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import {
  digestPersistedSha256,
  initialPersistedSha256State,
  updatePersistedSha256,
  type PersistedSha256StateV1,
} from "@/lib/v2/portability/persisted-sha256-v1";
import { canonicalJson, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";
import { RestoreContractError } from "@/lib/v2/portability/restore-bundle-v1";
import {
  putVerifiedFixedLengthStream,
  stageArchiveRestoreFromObject,
} from "@/lib/v2/portability/resumable-restore-v2";

export const RESTORE_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const MAX_RESUMABLE_ARCHIVE_BYTES = 0xffff_ffff;
const HASH_BYTES_PER_ADVANCE = 1024 * 1024;
const CLEANUP_PARTS_PER_ADVANCE = 50;
const LEASE_MILLISECONDS = 2 * 60 * 1000;
const UPLOAD_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type RestoreUploadStatus = "uploading" | "verifying" | "assembling" | "cleaning" | "staged" | "aborting" | "aborted" | "expired" | "failed";
type RestoreUploadPhase = "receiving" | "hashing" | "creating_multipart" | "uploading_parts" | "completing" | "staging" | "cleanup" | "aborting" | "complete";
type CleanupTerminalStatus = "aborted" | "expired" | "failed";

type RestoreUploadCursor = {
  hashPartNumber?: number;
  hashPartOffset?: number;
  sha256State?: PersistedSha256StateV1;
  cleanupTerminalStatus?: CleanupTerminalStatus;
  staleMultipartUploadId?: string;
};

type RestoreUploadRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  file_name: string;
  expected_size_bytes: number;
  expected_archive_sha256: string;
  part_size_bytes: number;
  expected_part_count: number;
  status: RestoreUploadStatus;
  phase: RestoreUploadPhase;
  cursor_json: string;
  uploaded_bytes: number;
  hash_verified_bytes: number;
  final_object_key: string;
  multipart_upload_id: string | null;
  restore_batch_id: string | null;
  state_revision: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  failure_code: string | null;
  created_at: string;
  last_progress_at: string;
  expires_at: string;
  finished_at: string | null;
};

type RestoreUploadPartRow = {
  upload_id: string;
  user_id: string;
  part_number: number;
  size_bytes: number;
  sha256: string;
  temp_object_key: string;
  multipart_etag: string | null;
  created_at: string;
  temp_deleted_at: string | null;
};

export class RestoreUploadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RestoreUploadError";
  }
}

function nowIso(value?: string) {
  return value ?? new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function ownerHash(userId: string) {
  return sha256Hex(userId).slice(0, 24);
}

function bytesToHex(value?: ArrayBuffer) {
  return value ? Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
}

function expectedPartSize(row: Pick<RestoreUploadRow, "expected_part_count" | "expected_size_bytes" | "part_size_bytes">, partNumber: number) {
  return partNumber < row.expected_part_count
    ? row.part_size_bytes
    : row.expected_size_bytes - (row.expected_part_count - 1) * row.part_size_bytes;
}

function validateFileName(value: string) {
  const name = value.trim();
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new RestoreUploadError("restore_upload_name_invalid", "Archive filename is invalid.");
  }
  return name;
}

async function getUploadRow(db: D1DatabaseBinding, userId: string, uploadId: string) {
  return db.prepare(`select * from v2_restore_uploads where id=? and user_id=? limit 1`).bind(uploadId, userId).first<RestoreUploadRow>();
}

async function requireUploadRow(db: D1DatabaseBinding, userId: string, uploadId: string) {
  const row = await getUploadRow(db, userId, uploadId);
  if (!row) throw new RestoreUploadError("restore_upload_not_found", "Restore upload was not found.");
  return row;
}

async function uploadParts(db: D1DatabaseBinding, uploadId: string) {
  return (await db.prepare(`select * from v2_restore_upload_parts where upload_id=? order by part_number`).bind(uploadId).all<RestoreUploadPartRow>()).results;
}

function uploadView(row: RestoreUploadRow, parts: readonly RestoreUploadPartRow[]) {
  const received = new Set(parts.map((part) => part.part_number));
  let nextMissingPart: number | null = null;
  for (let part = 1; part <= row.expected_part_count; part += 1) {
    if (!received.has(part)) { nextMissingPart = part; break; }
  }
  return {
    uploadId: row.id,
    status: row.status,
    phase: row.phase,
    stateRevision: row.state_revision,
    fileName: row.file_name,
    sizeBytes: row.expected_size_bytes,
    archiveSha256: row.expected_archive_sha256,
    partSizeBytes: row.part_size_bytes,
    expectedParts: row.expected_part_count,
    receivedParts: parts.length,
    uploadedBytes: row.uploaded_bytes,
    hashVerifiedBytes: row.hash_verified_bytes,
    nextMissingPart,
    restoreId: row.restore_batch_id,
    failureCode: row.failure_code,
    expiresAt: row.expires_at,
  };
}

export async function getRestoreUpload(db: D1DatabaseBinding, userId: string, uploadId: string) {
  const row = await requireUploadRow(db, userId, uploadId);
  return uploadView(row, await uploadParts(db, row.id));
}

async function acquireLease(db: D1DatabaseBinding, row: RestoreUploadRow, now: string, expectedRevision?: number) {
  if (expectedRevision !== undefined && row.state_revision !== expectedRevision) {
    throw new RestoreUploadError("restore_upload_revision_conflict", "Restore upload state changed; reload it before continuing.");
  }
  const token = ulid();
  const reclaimed = row.lease_token !== null && row.lease_expires_at !== null && row.lease_expires_at <= now;
  const expiresAt = new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString();
  await db.prepare(`update v2_restore_uploads set lease_token=?,lease_expires_at=? where id=? and user_id=? and state_revision=? and (lease_token is null or lease_expires_at<=?)`)
    .bind(token, expiresAt, row.id, row.user_id, row.state_revision, now).run();
  const leased = await requireUploadRow(db, row.user_id, row.id);
  if (leased.lease_token !== token) throw new RestoreUploadError("restore_upload_busy_conflict", "Another request is advancing this upload.");
  return { row: leased, reclaimed };
}

async function releaseLease(db: D1DatabaseBinding, row: RestoreUploadRow) {
  await db.prepare(`update v2_restore_uploads set lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
    .bind(row.id, row.user_id, row.lease_token).run();
}

export async function createRestoreUpload(input: {
  db: D1DatabaseBinding;
  userId: string;
  idempotencyKey: string;
  fileName: string;
  sizeBytes: number;
  archiveSha256: string;
  now?: string;
}) {
  const fileName = validateFileName(input.fileName);
  const archiveSha256 = input.archiveSha256.toLowerCase();
  if (!SHA256_PATTERN.test(archiveSha256)) throw new RestoreUploadError("restore_upload_hash_invalid", "Archive SHA-256 is invalid.");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_RESUMABLE_ARCHIVE_BYTES) {
    throw new RestoreUploadError("restore_upload_size_limit", "Resumable restore accepts ZIP archives smaller than 4 GiB.");
  }
  const existing = await input.db.prepare(`select * from v2_restore_uploads where user_id=? and idempotency_key=? limit 1`)
    .bind(input.userId, input.idempotencyKey).first<RestoreUploadRow>();
  if (existing) {
    if (existing.file_name !== fileName || existing.expected_size_bytes !== input.sizeBytes || existing.expected_archive_sha256 !== archiveSha256) {
      throw new RestoreUploadError("idempotency_conflict", "Restore upload idempotency key was used for another archive.");
    }
    return uploadView(existing, await uploadParts(input.db, existing.id));
  }
  const createdAt = nowIso(input.now);
  const uploadId = ulid();
  const expectedParts = Math.ceil(input.sizeBytes / RESTORE_UPLOAD_PART_BYTES);
  const finalObjectKey = `users/${ownerHash(input.userId)}/restore-staging/uploads/${uploadId}/${archiveSha256}.zip`;
  const expiresAt = new Date(Date.parse(createdAt) + UPLOAD_TTL_MILLISECONDS).toISOString();
  try {
    await input.db.prepare(`insert into v2_restore_uploads
      (id,user_id,idempotency_key,file_name,expected_size_bytes,expected_archive_sha256,part_size_bytes,expected_part_count,status,phase,cursor_json,uploaded_bytes,hash_verified_bytes,final_object_key,state_revision,created_at,last_progress_at,expires_at)
      values (?,?,?,?,?,?,?,?,'uploading','receiving','{}',0,0,?,0,?,?,?)`)
      .bind(uploadId, input.userId, input.idempotencyKey, fileName, input.sizeBytes, archiveSha256, RESTORE_UPLOAD_PART_BYTES, expectedParts, finalObjectKey, createdAt, createdAt, expiresAt).run();
  } catch (error) {
    const raced = await input.db.prepare(`select * from v2_restore_uploads where user_id=? and idempotency_key=? limit 1`)
      .bind(input.userId, input.idempotencyKey).first<RestoreUploadRow>();
    if (!raced || raced.file_name !== fileName || raced.expected_size_bytes !== input.sizeBytes || raced.expected_archive_sha256 !== archiveSha256) throw error;
    return uploadView(raced, await uploadParts(input.db, raced.id));
  }
  return getRestoreUpload(input.db, input.userId, uploadId);
}

export async function uploadRestorePart(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  userId: string;
  uploadId: string;
  partNumber: number;
  sizeBytes: number;
  sha256: string;
  body: ReadableStream<Uint8Array>;
  expectedRevision?: number;
  now?: string;
}) {
  const now = nowIso(input.now);
  let row = await requireUploadRow(input.db, input.userId, input.uploadId);
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > row.expected_part_count) {
    throw new RestoreUploadError("restore_upload_part_number_invalid", "Upload part number is outside the archive range.");
  }
  const sha256 = input.sha256.toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) throw new RestoreUploadError("restore_upload_part_hash_invalid", "Upload part SHA-256 is invalid.");
  const requiredSize = expectedPartSize(row, input.partNumber);
  if (input.sizeBytes !== requiredSize) throw new RestoreUploadError("restore_upload_part_size_invalid", "Upload part size does not match the fixed 8 MiB layout.");
  const existing = await input.db.prepare(`select * from v2_restore_upload_parts where upload_id=? and part_number=? limit 1`)
    .bind(row.id, input.partNumber).first<RestoreUploadPartRow>();
  if (existing) {
    if (existing.size_bytes !== input.sizeBytes || existing.sha256 !== sha256) throw new RestoreUploadError("restore_upload_part_conflict", "This upload part number already has a different receipt.");
    return getRestoreUpload(input.db, input.userId, row.id);
  }
  if (row.status !== "uploading" || row.phase !== "receiving") throw new RestoreUploadError("restore_upload_state_conflict", "Upload parts are no longer accepted for this session.");
  if (Date.parse(row.expires_at) <= Date.parse(now)) throw new RestoreUploadError("restore_upload_expired_conflict", "Restore upload expired before this part was received.");
  row = (await acquireLease(input.db, row, now, input.expectedRevision)).row;
  const tempObjectKey = `users/${ownerHash(input.userId)}/restore-staging/uploads/${row.id}/parts/${String(input.partNumber).padStart(4, "0")}-${row.lease_token}`;
  try {
    await putVerifiedFixedLengthStream({
      bucket: input.bucket,
      key: tempObjectKey,
      body: input.body,
      size: input.sizeBytes,
      sha256,
      mediaType: "application/octet-stream",
      customMetadata: { userId: input.userId, restoreUploadId: row.id, partNumber: String(input.partNumber), sha256 },
    });
    const stored = await input.bucket.head(tempObjectKey);
    const storedSha = bytesToHex(stored?.checksums.sha256);
    if (!stored || stored.size !== input.sizeBytes || stored.customMetadata?.restoreUploadId !== row.id || (storedSha && storedSha !== sha256)) {
      await input.bucket.delete(tempObjectKey).catch(() => undefined);
      throw new RestoreUploadError("restore_upload_part_invalid", "R2 rejected the upload part receipt.");
    }
    const statements: D1PreparedStatementBinding[] = [
      input.db.prepare(`insert into v2_restore_upload_parts (upload_id,user_id,part_number,size_bytes,sha256,temp_object_key,created_at)
        select ?,?,?,?,?,?,? where exists (select 1 from v2_restore_uploads where id=? and user_id=? and lease_token=?)`)
        .bind(row.id, row.user_id, input.partNumber, input.sizeBytes, sha256, tempObjectKey, now, row.id, row.user_id, row.lease_token),
      input.db.prepare(`update v2_restore_uploads set uploaded_bytes=uploaded_bytes+?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
        .bind(input.sizeBytes, now, row.id, row.user_id, row.lease_token),
    ];
    await input.db.batch(statements);
    const receipt = await input.db.prepare(`select * from v2_restore_upload_parts where upload_id=? and part_number=? limit 1`)
      .bind(row.id, input.partNumber).first<RestoreUploadPartRow>();
    if (!receipt || receipt.sha256 !== sha256 || receipt.size_bytes !== input.sizeBytes) {
      await input.bucket.delete(tempObjectKey).catch(() => undefined);
      throw new RestoreUploadError("restore_upload_revision_conflict", "Upload lease changed before the part receipt was committed.");
    }
    if (receipt.temp_object_key !== tempObjectKey) await input.bucket.delete(tempObjectKey).catch(() => undefined);
  } catch (error) {
    await releaseLease(input.db, row).catch(() => undefined);
    const raced = await input.db.prepare(`select * from v2_restore_upload_parts where upload_id=? and part_number=? limit 1`)
      .bind(row.id, input.partNumber).first<RestoreUploadPartRow>();
    if (raced && raced.sha256 === sha256 && raced.size_bytes === input.sizeBytes) {
      if (raced.temp_object_key !== tempObjectKey) await input.bucket.delete(tempObjectKey).catch(() => undefined);
      return getRestoreUpload(input.db, input.userId, row.id);
    }
    // The R2 write can succeed even when its response or the following D1 batch
    // fails. This attempt key contains the lease token, so it is safe to remove
    // unless a committed receipt above owns it.
    await input.bucket.delete(tempObjectKey).catch(() => undefined);
    throw error;
  }
  return getRestoreUpload(input.db, input.userId, row.id);
}

function validateCompleteParts(row: RestoreUploadRow, parts: readonly RestoreUploadPartRow[]) {
  if (parts.length !== row.expected_part_count) throw new RestoreUploadError("restore_upload_incomplete", "Every contiguous archive part is required before completion.");
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const partNumber = index + 1;
    const part = parts[index];
    if (part.part_number !== partNumber || part.size_bytes !== expectedPartSize(row, partNumber) || !SHA256_PATTERN.test(part.sha256)) {
      throw new RestoreUploadError("restore_upload_parts_invalid", "Archive part receipts are not contiguous or size-valid.");
    }
    total += part.size_bytes;
  }
  if (total !== row.expected_size_bytes || row.uploaded_bytes !== total) throw new RestoreUploadError("restore_upload_size_mismatch", "Archive part receipts do not match the declared total size.");
}

export async function completeRestoreUpload(input: {
  db: D1DatabaseBinding;
  userId: string;
  uploadId: string;
  expectedRevision?: number;
  now?: string;
}) {
  const now = nowIso(input.now);
  let row = await requireUploadRow(input.db, input.userId, input.uploadId);
  if (row.status !== "uploading") return getRestoreUpload(input.db, input.userId, row.id);
  if (Date.parse(row.expires_at) <= Date.parse(now)) throw new RestoreUploadError("restore_upload_expired_conflict", "Restore upload expired before completion.");
  row = (await acquireLease(input.db, row, now, input.expectedRevision)).row;
  try {
    const parts = await uploadParts(input.db, row.id);
    validateCompleteParts(row, parts);
    const cursor: RestoreUploadCursor = { hashPartNumber: 1, hashPartOffset: 0, sha256State: initialPersistedSha256State() };
    await input.db.prepare(`update v2_restore_uploads set status='verifying',phase='hashing',cursor_json=?,hash_verified_bytes=0,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(canonicalJson(cursor), now, row.id, row.user_id, row.lease_token).run();
  } catch (error) {
    await releaseLease(input.db, row).catch(() => undefined);
    throw error;
  }
  return getRestoreUpload(input.db, input.userId, row.id);
}

async function advanceHash(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: RestoreUploadRow; now: string }) {
  const cursor = parseJson<RestoreUploadCursor>(input.row.cursor_json, {});
  const partNumber = cursor.hashPartNumber ?? 1;
  const partOffset = cursor.hashPartOffset ?? 0;
  const state = cursor.sha256State ?? initialPersistedSha256State();
  const part = await input.db.prepare(`select * from v2_restore_upload_parts where upload_id=? and part_number=? limit 1`)
    .bind(input.row.id, partNumber).first<RestoreUploadPartRow>();
  if (!part) throw new RestoreUploadError("restore_upload_part_missing", "A receipted archive part is missing during hash verification.");
  const length = Math.min(HASH_BYTES_PER_ADVANCE, part.size_bytes - partOffset);
  if (length <= 0) throw new RestoreUploadError("restore_upload_hash_state_invalid", "Archive hash cursor is invalid.");
  const object = await input.bucket.get(part.temp_object_key, { range: { offset: partOffset, length } });
  if (!object) throw new RestoreUploadError("restore_upload_part_missing", "A staged archive part is missing from R2.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== length) throw new RestoreUploadError("restore_upload_part_invalid", "R2 returned an incomplete archive part range.");
  const nextState = updatePersistedSha256(state, bytes);
  const partComplete = partOffset + length === part.size_bytes;
  const allComplete = partComplete && partNumber === input.row.expected_part_count;
  let status: RestoreUploadStatus = "verifying";
  let phase: RestoreUploadPhase = "hashing";
  let failureCode: string | null = input.row.failure_code;
  let nextCursor: RestoreUploadCursor = {
    hashPartNumber: partComplete ? partNumber + 1 : partNumber,
    hashPartOffset: partComplete ? 0 : partOffset + length,
    sha256State: nextState,
  };
  if (allComplete) {
    const actual = digestPersistedSha256(nextState);
    if (actual !== input.row.expected_archive_sha256) {
      status = "aborting";
      phase = "aborting";
      failureCode = "archive_sha256_mismatch";
      nextCursor = { cleanupTerminalStatus: "failed" };
    } else {
      status = "assembling";
      phase = "creating_multipart";
      nextCursor = {};
    }
  }
  await input.db.prepare(`update v2_restore_uploads set status=?,phase=?,cursor_json=?,hash_verified_bytes=hash_verified_bytes+?,failure_code=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
    .bind(status, phase, canonicalJson(nextCursor), length, failureCode, input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
}

function requireMultipart(bucket: R2BucketBinding) {
  if (!bucket.createMultipartUpload || !bucket.resumeMultipartUpload) {
    throw new RestoreUploadError("restore_upload_multipart_disabled", "R2 multipart upload is unavailable in this runtime.");
  }
  return {
    create: bucket.createMultipartUpload.bind(bucket),
    resume: bucket.resumeMultipartUpload.bind(bucket),
  };
}

async function createMultipart(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: RestoreUploadRow; now: string }) {
  const multipartApi = requireMultipart(input.bucket);
  const cursor = parseJson<RestoreUploadCursor>(input.row.cursor_json, {});
  if (cursor.staleMultipartUploadId) {
    try {
      await multipartApi.resume(input.row.final_object_key, cursor.staleMultipartUploadId).abort();
    } catch {
      throw new RestoreUploadError("restore_upload_multipart_abort_retry", "The superseded multipart upload could not be cleaned up yet.");
    }
  }
  const multipart = await multipartApi.create(input.row.final_object_key, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { userId: input.row.user_id, restoreUploadId: input.row.id, sha256: input.row.expected_archive_sha256 },
  });
  try {
    await input.db.prepare(`update v2_restore_uploads set phase='uploading_parts',cursor_json='{}',multipart_upload_id=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(multipart.uploadId, input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
    const persisted = await requireUploadRow(input.db, input.row.user_id, input.row.id);
    if (persisted.multipart_upload_id !== multipart.uploadId) throw new RestoreUploadError("restore_upload_revision_conflict", "Multipart upload was not claimed by this session.");
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    throw error;
  }
}

async function rotateReclaimedMultipart(input: { db: D1DatabaseBinding; row: RestoreUploadRow; now: string }) {
  if (!input.row.multipart_upload_id) throw new RestoreUploadError("restore_upload_multipart_invalid", "Multipart upload identity is missing during lease recovery.");
  const cursor: RestoreUploadCursor = { staleMultipartUploadId: input.row.multipart_upload_id };
  await input.db.batch([
    input.db.prepare(`update v2_restore_upload_parts set multipart_etag=null where upload_id=? and exists (select 1 from v2_restore_uploads u where u.id=? and u.user_id=? and u.lease_token=?)`)
      .bind(input.row.id, input.row.id, input.row.user_id, input.row.lease_token),
    input.db.prepare(`update v2_restore_uploads set phase='creating_multipart',cursor_json=?,multipart_upload_id=null,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(canonicalJson(cursor), input.now, input.row.id, input.row.user_id, input.row.lease_token),
  ]);
  const persisted = await requireUploadRow(input.db, input.row.user_id, input.row.id);
  if (persisted.phase !== "creating_multipart" || persisted.multipart_upload_id !== null) {
    throw new RestoreUploadError("restore_upload_revision_conflict", "Multipart assembly was already recovered by another request.");
  }
}

async function uploadMultipartPart(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: RestoreUploadRow; now: string }) {
  if (!input.row.multipart_upload_id) throw new RestoreUploadError("restore_upload_multipart_invalid", "Multipart upload identity is missing.");
  const part = await input.db.prepare(`select * from v2_restore_upload_parts where upload_id=? and multipart_etag is null order by part_number limit 1`)
    .bind(input.row.id).first<RestoreUploadPartRow>();
  if (!part) {
    await input.db.prepare(`update v2_restore_uploads set phase='completing',state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
    return;
  }
  const source = await input.bucket.get(part.temp_object_key);
  const sourceSha = bytesToHex(source?.checksums.sha256);
  if (
    !source
    || source.size !== part.size_bytes
    || source.customMetadata?.userId !== input.row.user_id
    || source.customMetadata?.restoreUploadId !== input.row.id
    || source.customMetadata?.partNumber !== String(part.part_number)
    || source.customMetadata?.sha256 !== part.sha256
    || (sourceSha && sourceSha !== part.sha256)
  ) throw new RestoreUploadError("restore_upload_part_missing", "A staged archive part failed its owner, size, or SHA receipt before multipart assembly.");
  const uploaded = await requireMultipart(input.bucket).resume(input.row.final_object_key, input.row.multipart_upload_id).uploadPart(part.part_number, source.body);
  await input.db.batch([
    input.db.prepare(`update v2_restore_upload_parts set multipart_etag=? where upload_id=? and part_number=? and multipart_etag is null and exists (select 1 from v2_restore_uploads u where u.id=? and u.user_id=? and u.lease_token=?)`)
      .bind(uploaded.etag, input.row.id, part.part_number, input.row.id, input.row.user_id, input.row.lease_token),
    input.db.prepare(`update v2_restore_uploads set state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(input.now, input.row.id, input.row.user_id, input.row.lease_token),
  ]);
  const persisted = await input.db.prepare(`select multipart_etag from v2_restore_upload_parts where upload_id=? and part_number=? limit 1`)
    .bind(input.row.id, part.part_number).first<{ multipart_etag: string | null }>();
  if (persisted?.multipart_etag !== uploaded.etag) {
    throw new RestoreUploadError("restore_upload_revision_conflict", "Multipart part was superseded by another lease; reload the upload before continuing.");
  }
}

async function completeMultipart(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: RestoreUploadRow; now: string }) {
  let stored = await input.bucket.head(input.row.final_object_key);
  if (!stored) {
    if (!input.row.multipart_upload_id) throw new RestoreUploadError("restore_upload_multipart_invalid", "Multipart upload identity is missing.");
    const parts = await uploadParts(input.db, input.row.id);
    validateCompleteParts(input.row, parts);
    if (parts.some((part) => !part.multipart_etag)) throw new RestoreUploadError("restore_upload_multipart_incomplete", "Multipart assembly receipts are incomplete.");
    try {
      await requireMultipart(input.bucket).resume(input.row.final_object_key, input.row.multipart_upload_id)
        .complete(parts.map((part) => ({ partNumber: part.part_number, etag: part.multipart_etag! })));
    } catch (error) {
      stored = await input.bucket.head(input.row.final_object_key);
      if (
        !stored
        || stored.size !== input.row.expected_size_bytes
        || stored.customMetadata?.userId !== input.row.user_id
        || stored.customMetadata?.restoreUploadId !== input.row.id
        || stored.customMetadata?.sha256 !== input.row.expected_archive_sha256
      ) throw error;
    }
    stored = await input.bucket.head(input.row.final_object_key);
  }
  if (
    !stored
    || stored.size !== input.row.expected_size_bytes
    || stored.customMetadata?.userId !== input.row.user_id
    || stored.customMetadata?.restoreUploadId !== input.row.id
    || stored.customMetadata?.sha256 !== input.row.expected_archive_sha256
  ) throw new RestoreUploadError("restore_upload_object_invalid", "Completed multipart object failed owner, size, or hash metadata verification.");
  await input.db.prepare(`update v2_restore_uploads set phase='staging',state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
    .bind(input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
}

async function stageMultipartRestore(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: RestoreUploadRow; now: string }) {
  if (!input.row.lease_token) throw new RestoreUploadError("restore_upload_revision_conflict", "Restore upload handoff requires the active lease.");
  const restore = await stageArchiveRestoreFromObject({
    db: input.db,
    bucket: input.bucket,
    userId: input.row.user_id,
    idempotencyKey: input.row.idempotency_key,
    archiveSha256: input.row.expected_archive_sha256,
    fileName: input.row.file_name,
    objectKey: input.row.final_object_key,
    sizeBytes: input.row.expected_size_bytes,
    restoreUploadId: input.row.id,
    restoreUploadLeaseToken: input.row.lease_token,
    now: input.now,
  });
  const batch = await input.db.prepare(`select source_object_key from v2_restore_batches where id=? and user_id=? limit 1`)
    .bind(restore.batchId, input.row.user_id).first<{ source_object_key: string | null }>();
  if (!batch?.source_object_key) throw new RestoreUploadError("restore_upload_stage_invalid", "Restore batch did not retain its verified staging object.");
  if (batch.source_object_key !== input.row.final_object_key) await input.bucket.delete(input.row.final_object_key).catch(() => undefined);
  await input.db.prepare(`update v2_restore_uploads set status='cleaning',phase='cleanup',restore_batch_id=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
    .bind(restore.batchId, input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
}

async function cleanupTemporaryParts(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: RestoreUploadRow; now: string; aborting: boolean }) {
  if (input.aborting) {
    const handedOff = await input.db.prepare(`select id from v2_restore_batches where user_id=? and idempotency_key=? and source_kind='archive' and source_object_key=? limit 1`)
      .bind(input.row.user_id, input.row.idempotency_key, input.row.final_object_key).first<{ id: string }>();
    if (handedOff) {
      await input.db.prepare(`update v2_restore_uploads set status='cleaning',phase='cleanup',cursor_json='{}',restore_batch_id=?,failure_code=null,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
        .bind(handedOff.id, input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
      return;
    }
  }
  const abortCursor = parseJson<RestoreUploadCursor>(input.row.cursor_json, {});
  const multipartIds = [...new Set([input.row.multipart_upload_id, abortCursor.staleMultipartUploadId].filter((value): value is string => Boolean(value)))];
  if (input.aborting && multipartIds.length) {
    const final = await input.bucket.head(input.row.final_object_key);
    if (final) await input.bucket.delete(input.row.final_object_key);
    else {
      const multipartApi = requireMultipart(input.bucket);
      for (const uploadId of multipartIds) await multipartApi.resume(input.row.final_object_key, uploadId).abort();
    }
    const cursor: RestoreUploadCursor = { cleanupTerminalStatus: abortCursor.cleanupTerminalStatus };
    await input.db.prepare(`update v2_restore_uploads set multipart_upload_id=null,cursor_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(canonicalJson(cursor), input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
    return;
  }
  const parts = await input.db.prepare(`select * from v2_restore_upload_parts where upload_id=? and temp_deleted_at is null order by part_number limit ?`)
    .bind(input.row.id, CLEANUP_PARTS_PER_ADVANCE).all<RestoreUploadPartRow>();
  if (parts.results.length) {
    await input.bucket.delete(parts.results.map((part) => part.temp_object_key));
    const statements = parts.results.map((part) => input.db.prepare(`update v2_restore_upload_parts set temp_deleted_at=? where upload_id=? and part_number=? and temp_deleted_at is null`)
      .bind(input.now, input.row.id, part.part_number));
    statements.push(input.db.prepare(`update v2_restore_uploads set state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(input.now, input.row.id, input.row.user_id, input.row.lease_token));
    await input.db.batch(statements);
    return;
  }
  const cursor = parseJson<RestoreUploadCursor>(input.row.cursor_json, {});
  const terminal: RestoreUploadStatus = input.aborting ? cursor.cleanupTerminalStatus ?? "aborted" : "staged";
  await input.db.prepare(`update v2_restore_uploads set status=?,phase='complete',cursor_json='{}',finished_at=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
    .bind(terminal, input.now, input.now, input.row.id, input.row.user_id, input.row.lease_token).run();
}

const TERMINAL_UPLOAD_STATUSES = new Set<RestoreUploadStatus>(["staged", "aborted", "expired", "failed"]);
const NON_FATAL_CODES = new Set(["restore_upload_busy_conflict", "restore_upload_revision_conflict", "restore_upload_state_conflict", "restore_upload_multipart_abort_retry"]);

export async function advanceRestoreUpload(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  userId: string;
  uploadId: string;
  expectedRevision?: number;
  now?: string;
}) {
  const now = nowIso(input.now);
  let row = await requireUploadRow(input.db, input.userId, input.uploadId);
  if (TERMINAL_UPLOAD_STATUSES.has(row.status)) return getRestoreUpload(input.db, input.userId, row.id);
  if (row.status === "uploading") throw new RestoreUploadError("restore_upload_incomplete", "Complete the upload receipts before advancing assembly.");
  const lease = await acquireLease(input.db, row, now, input.expectedRevision);
  row = lease.row;
  try {
    if (lease.reclaimed && row.status === "assembling" && row.phase === "uploading_parts") await rotateReclaimedMultipart({ db: input.db, row, now });
    else if (row.status === "verifying" && row.phase === "hashing") await advanceHash({ ...input, row, now });
    else if (row.status === "assembling" && row.phase === "creating_multipart") await createMultipart({ ...input, row, now });
    else if (row.status === "assembling" && row.phase === "uploading_parts") await uploadMultipartPart({ ...input, row, now });
    else if (row.status === "assembling" && row.phase === "completing") await completeMultipart({ ...input, row, now });
    else if (row.status === "assembling" && row.phase === "staging") await stageMultipartRestore({ ...input, row, now });
    else if (row.status === "cleaning" && row.phase === "cleanup") await cleanupTemporaryParts({ ...input, row, now, aborting: false });
    else if (row.status === "aborting" && row.phase === "aborting") await cleanupTemporaryParts({ ...input, row, now, aborting: true });
    else throw new RestoreUploadError("restore_upload_state_conflict", "Restore upload phase cannot be advanced.");
  } catch (error) {
    const code = error instanceof RestoreUploadError || error instanceof RestoreContractError ? error.code : "restore_upload_internal_error";
    if (NON_FATAL_CODES.has(code) || row.status === "aborting" || row.status === "cleaning") await releaseLease(input.db, row).catch(() => undefined);
    else await input.db.prepare(`update v2_restore_uploads set status='aborting',phase='aborting',cursor_json=?,failure_code=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
      .bind(canonicalJson({ cleanupTerminalStatus: "failed" }), code, now, row.id, row.user_id, row.lease_token).run().catch(() => undefined);
    throw error;
  }
  return getRestoreUpload(input.db, input.userId, row.id);
}

export async function requestRestoreUploadAbort(input: {
  db: D1DatabaseBinding;
  userId: string;
  uploadId: string;
  expectedRevision?: number;
  now?: string;
}) {
  const now = nowIso(input.now);
  let row = await requireUploadRow(input.db, input.userId, input.uploadId);
  if (row.status === "aborted" || row.status === "expired" || row.status === "failed") return getRestoreUpload(input.db, input.userId, row.id);
  if (row.status === "staged" || row.status === "cleaning") throw new RestoreUploadError("restore_upload_state_conflict", "A staged restore must be managed through its restore batch.");
  row = (await acquireLease(input.db, row, now, input.expectedRevision)).row;
  await input.db.prepare(`update v2_restore_uploads set status='aborting',phase='aborting',cursor_json=?,state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`)
    .bind(canonicalJson({ cleanupTerminalStatus: "aborted" }), now, row.id, row.user_id, row.lease_token).run();
  return getRestoreUpload(input.db, input.userId, row.id);
}

export async function advanceExpiredRestoreUpload(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; now?: string }) {
  const now = nowIso(input.now);
  const expired = await input.db.prepare(`select * from v2_restore_uploads where expires_at<=? and status in ('uploading','verifying','assembling','aborting') and (lease_token is null or lease_expires_at<=?) order by expires_at,id limit 1`)
    .bind(now, now).first<RestoreUploadRow>();
  if (!expired) return { processed: false, upload: null };
  if (expired.status !== "aborting") {
    await input.db.prepare(`update v2_restore_uploads set status='aborting',phase='aborting',cursor_json=?,failure_code='restore_upload_expired',state_revision=state_revision+1,last_progress_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and state_revision=? and (lease_token is null or lease_expires_at<=?)`)
      .bind(canonicalJson({ cleanupTerminalStatus: "expired" }), now, expired.id, expired.user_id, expired.state_revision, now).run();
  }
  const upload = await advanceRestoreUpload({ db: input.db, bucket: input.bucket, userId: expired.user_id, uploadId: expired.id, now });
  return { processed: true, upload };
}
