import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { canonicalTablesForSchemaVersion, fullFidelityCanonicalScope, assertPromptCurationExportScope, type CanonicalTableDescriptor } from "@/lib/v2/portability/canonical-table-registry-v1";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import {
  canonicalJson,
  envelopeCanonicalRow,
  exportRootHash,
  LIGHTHOUSE_EXPORT_FORMAT,
  LIGHTHOUSE_EXPORT_VERSION,
  LIGHTHOUSE_SCHEMA_VERSION,
  sha256Hex,
  type ExportFileManifestV1,
  type ExportManifestV1,
  type ExportProfile,
  type ExportScopeV1,
} from "@/lib/v2/portability/portability-contract-v1";
import { assertSafeZipPath } from "@/lib/v2/portability/zip-stream-v1";

export const EXPORT_WORKFLOW_VERSION = 2 as const;
export const EXPORT_ZIP32_MAX_BYTES = 0xffff_ffff;
export const EXPORT_ZIP32_MAX_ENTRIES = 0xffff;
export const EXPORT_MULTIPART_MAX_PARTS = 10_000;
export const EXPORT_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
// R2 operations must configure a short-lived lifecycle rule or periodic list
// sweep for this dedicated prefix. D1 receipts remain the primary cleanup path.
export const EXPORT_PENDING_OBJECT_PREFIX = "export-pending/";

const EXPORT_LEASE_MS = 120_000;
const ORIGINAL_CHUNK_BYTES = 1024 * 1024;
export const EXPORT_VERIFY_CHUNK_BYTES = 1024 * 1024;
export const EXPORT_CENTRAL_RECEIPTS_PER_ADVANCE = 128;
// Eight documents produce sixteen ZIP entries and at most 17 content queries
// (one page plus type/relation lookups), leaving room below D1 Free's 50-query
// invocation ceiling for lease, receipt, and CAS statements. Canonical JSONL has
// one query, so it can use the full 32-unit page. The byte budget wins over both.
export const EXPORT_MAX_UNITS_PER_ADVANCE = 32;
export const EXPORT_MAX_DOCUMENTS_PER_ADVANCE = 8;
export const EXPORT_MAX_ORIGINALS_PER_ADVANCE = 16;
export const EXPORT_APPEND_BYTE_BUDGET = 512 * 1024;
// Restore accepts at most 10,000 ZIP entries. checksums.sha256 and
// manifest.json are the two control entries that are not listed in manifest.files.
const MANIFEST_MAX_FILES = 9_998;
const MANIFEST_MAX_BYTES = 1_800_000;
const encoder = new TextEncoder();

export type ExportBuildPhase = "staging" | "packaging" | "central_directory" | "finalizing" | "verifying" | "failure_cleanup" | "complete";

export type SerializableSha256State = Readonly<{
  words: readonly [number, number, number, number, number, number, number, number];
  bufferHex: string;
  totalBytes: number;
}>;

export const INITIAL_EXPORT_SHA256_STATE: SerializableSha256State = {
  words: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
  bufferHex: "",
  totalBytes: 0,
};

type ExportWorkflowRow = {
  id: string;
  user_id: string;
  profile: ExportProfile;
  scope_json: string;
  status: "queued" | "running" | "succeeded" | "failed";
  base_sequence: number;
  end_sequence: number;
  bundle_object_key: string | null;
  bundle_sha256: string | null;
  bundle_size_bytes: number | null;
  manifest_json: string | null;
  failure_code: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  workflow_version: number;
  build_phase: string;
  cursor_json: string;
  state_revision: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_progress_at: string | null;
  upload_id: string | null;
  next_part_number: number;
  pending_object_key: string | null;
  pending_size_bytes: number;
  pending_sha256: string | null;
  zip_size_bytes: number;
  zip_sha256_state_json: string | null;
  entry_count: number;
};

type ExportFileReceiptRow = {
  ordinal: number;
  entry_kind: string;
  table_name: string | null;
  source_ref: string | null;
  path: string;
  media_type: string;
  include_in_manifest: number;
  local_offset: number;
  size_bytes: number;
  crc32: number;
  sha256: string;
  record_count: number;
};

type ExportPartReceiptRow = {
  part_number: number;
  etag: string;
  size_bytes: number;
  sha256: string;
};

type OpenEntry = {
  path: string;
  mediaType: string;
  entryKind: string;
  tableName?: string;
  sourceRef?: string;
  includeInManifest: boolean;
  localOffset: number;
  sizeBytes: number;
  crcState: number;
  shaState: SerializableSha256State;
  recordCount: number;
  original?: {
    objectKey: string;
    expectedBytes: number;
    expectedSha256: string;
    offset: number;
  };
};

type PackagingCursor =
  | { phase: "readme" }
  | { phase: "documents"; offset: number; subphase: "markdown" | "metadata" }
  | { phase: "canonical"; tableIndex: number; rowOffset: number; open?: OpenEntry }
  | { phase: "originals"; offset: number; open?: OpenEntry }
  | { phase: "checksums"; offset: number; open?: OpenEntry }
  | { phase: "manifest" }
  | { phase: "central_directory"; ordinal: number; centralOffset: number; centralBytes: number }
  | { phase: "finalizing"; step: "upload_last_part" | "complete_multipart" }
  | { phase: "verifying"; offset: number; shaState: SerializableSha256State }
  | { phase: "failure_cleanup"; code: string }
  | { phase: "complete" };

export type ResumableExportWorkflow = Readonly<{
  id: string;
  profile: ExportProfile;
  scope: ExportScopeV1;
  status: ExportWorkflowRow["status"];
  workflowVersion: number;
  buildPhase: ExportBuildPhase | "legacy";
  stateRevision: number;
  baseSequence: number;
  endSequence: number;
  bundleObjectKey: string | null;
  bundleSha256: string | null;
  bundleSizeBytes: number | null;
  manifest: ExportManifestV1 | null;
  progress: Readonly<{
    entriesComplete: number;
    partsUploaded: number;
    bytesPacked: number;
    pendingBytes: number;
  }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  lastProgressAt: string | null;
  failureCode: string | null;
}>;

export class ResumableExportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResumableExportError";
  }
}

class FatalExportError extends ResumableExportError {}

function parseJsonObject(value: string, code: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
    return parsed as Record<string, unknown>;
  } catch {
    throw new FatalExportError(code, "Stored export workflow JSON is invalid.");
  }
}

function parseScope(value: string) {
  return parseJsonObject(value, "export_scope_invalid") as ExportScopeV1;
}

function parseManifest(value: string | null) {
  return value ? parseJsonObject(value, "export_manifest_invalid") as ExportManifestV1 : null;
}

function parseCursor(value: string) {
  const cursor = parseJsonObject(value, "export_cursor_invalid") as PackagingCursor;
  if (typeof cursor.phase !== "string") throw new FatalExportError("export_cursor_invalid", "Stored export cursor is invalid.");
  return cursor;
}

function parseShaState(value: string | null, code = "export_hash_state_invalid") {
  if (!value) throw new FatalExportError(code, "Stored export hash state is missing.");
  const candidate = parseJsonObject(value, code);
  const words = candidate.words;
  if (!Array.isArray(words) || words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff_ffff)) {
    throw new FatalExportError(code, "Stored export hash words are invalid.");
  }
  if (typeof candidate.bufferHex !== "string" || !/^(?:[0-9a-f]{2}){0,63}$/.test(candidate.bufferHex)) {
    throw new FatalExportError(code, "Stored export hash buffer is invalid.");
  }
  if (!Number.isSafeInteger(candidate.totalBytes) || Number(candidate.totalBytes) < 0 || Number(candidate.totalBytes) > EXPORT_ZIP32_MAX_BYTES) {
    throw new FatalExportError(code, "Stored export hash length is invalid.");
  }
  const normalizedWords: SerializableSha256State["words"] = [
    Number(words[0]), Number(words[1]), Number(words[2]), Number(words[3]),
    Number(words[4]), Number(words[5]), Number(words[6]), Number(words[7]),
  ];
  return { words: normalizedWords, bufferHex: candidate.bufferHex, totalBytes: Number(candidate.totalBytes) };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function concatBytes(...chunks: readonly Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function sha256Bytes(bytes: Uint8Array) {
  const input = Uint8Array.from(bytes).buffer;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

function compressSha256(wordsInput: readonly number[], bytes: Uint8Array, offset: number) {
  const schedule = new Uint32Array(64);
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 64);
  for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(index * 4, false);
  for (let index = 16; index < 64; index += 1) {
    const left = schedule[index - 15];
    const right = schedule[index - 2];
    const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
    const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
    schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = wordsInput;
  for (let index = 0; index < 64; index += 1) {
    const upper = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const first = (h + upper + choice + SHA256_CONSTANTS[index] + schedule[index]) >>> 0;
    const lower = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const second = (lower + majority) >>> 0;
    h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
  }
  return [
    (wordsInput[0] + a) >>> 0, (wordsInput[1] + b) >>> 0, (wordsInput[2] + c) >>> 0, (wordsInput[3] + d) >>> 0,
    (wordsInput[4] + e) >>> 0, (wordsInput[5] + f) >>> 0, (wordsInput[6] + g) >>> 0, (wordsInput[7] + h) >>> 0,
  ] as SerializableSha256State["words"];
}

export function updateSerializableSha256(state: SerializableSha256State, chunk: Uint8Array): SerializableSha256State {
  if (state.totalBytes + chunk.byteLength > EXPORT_ZIP32_MAX_BYTES) throw new FatalExportError("export_zip32_size_exceeded", "ZIP32 byte limit was exceeded.");
  const combined = concatBytes(hexToBytes(state.bufferHex), chunk);
  let words = state.words;
  let offset = 0;
  while (offset + 64 <= combined.byteLength) {
    words = compressSha256(words, combined, offset);
    offset += 64;
  }
  return { words, bufferHex: bytesToHex(combined.subarray(offset)), totalBytes: state.totalBytes + chunk.byteLength };
}

export function digestSerializableSha256(state: SerializableSha256State) {
  const buffered = hexToBytes(state.bufferHex);
  const zeroBytes = (64 + 56 - ((buffered.byteLength + 1) % 64)) % 64;
  const tail = new Uint8Array(buffered.byteLength + 1 + zeroBytes + 8);
  tail.set(buffered);
  tail[buffered.byteLength] = 0x80;
  const bitLength = state.totalBytes * 8;
  const view = new DataView(tail.buffer);
  view.setUint32(tail.byteLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(tail.byteLength - 4, bitLength >>> 0, false);
  let words = state.words;
  for (let offset = 0; offset < tail.byteLength; offset += 64) words = compressSha256(words, tail, offset);
  return words.map((word) => word.toString(16).padStart(8, "0")).join("");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function updateCrcState(crc: number, chunk: Uint8Array) {
  let value = crc;
  for (const byte of chunk) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function fixedBytes(length: number, writer: (view: DataView) => void) {
  const bytes = new Uint8Array(length);
  writer(new DataView(bytes.buffer));
  return bytes;
}

function localHeader(pathBytes: Uint8Array) {
  return fixedBytes(30, (view) => {
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0808, true);
    view.setUint16(8, 0, true);
    view.setUint16(26, pathBytes.byteLength, true);
  });
}

function dataDescriptor(crc32: number, sizeBytes: number) {
  return fixedBytes(16, (view) => {
    view.setUint32(0, 0x08074b50, true);
    view.setUint32(4, crc32, true);
    view.setUint32(8, sizeBytes, true);
    view.setUint32(12, sizeBytes, true);
  });
}

function centralHeader(receipt: ExportFileReceiptRow, pathBytes: Uint8Array) {
  return fixedBytes(46, (view) => {
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0808, true);
    view.setUint16(10, 0, true);
    view.setUint32(16, receipt.crc32, true);
    view.setUint32(20, receipt.size_bytes, true);
    view.setUint32(24, receipt.size_bytes, true);
    view.setUint16(28, pathBytes.byteLength, true);
    view.setUint32(42, receipt.local_offset, true);
  });
}

function endOfCentralDirectory(entries: number, centralBytes: number, centralOffset: number) {
  return fixedBytes(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entries, true);
    view.setUint16(10, entries, true);
    view.setUint32(12, centralBytes, true);
    view.setUint32(16, centralOffset, true);
  });
}

function safeFilename(value: string) {
  const cleaned = value.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "original").slice(0, 180);
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function userNamespace(userId: string) {
  return sha256Hex(userId).slice(0, 24);
}

function bundleObjectKey(userId: string, exportId: string) {
  return `users/${userNamespace(userId)}/exports/${exportId}/lighthouse-export.zip`;
}

function pendingObjectKey(userId: string, exportId: string, leaseToken: string) {
  return `${EXPORT_PENDING_OBJECT_PREFIX}users/${userNamespace(userId)}/exports/${exportId}/${sha256Hex(leaseToken).slice(0, 32)}.bin`;
}

function phaseForCursor(cursor: PackagingCursor): ExportBuildPhase {
  if (cursor.phase === "central_directory") return "central_directory";
  if (cursor.phase === "finalizing") return "finalizing";
  if (cursor.phase === "verifying") return "verifying";
  if (cursor.phase === "failure_cleanup") return "failure_cleanup";
  if (cursor.phase === "complete") return "complete";
  return "packaging";
}

function readmeText(row: ExportWorkflowRow, scope: ExportScopeV1) {
  return `# Lighthouse Export Bundle v1\n\nThis archive is readable without Light House.\n\n- Profile: ${row.profile}\n- Created: ${row.created_at}\n- Privacy levels: ${scope.privacyLevels.join(", ")}\n- The ZIP itself is not password-encrypted. Store it in an encrypted device or volume.\n- Verify every payload file with checksums.sha256 before restore.\n`;
}

async function loadExport(db: D1DatabaseBinding, userId: string, exportId: string) {
  return db.prepare("select * from v2_export_jobs where id=? and user_id=? limit 1").bind(exportId, userId).first<ExportWorkflowRow>();
}

async function projectExport(db: D1DatabaseBinding, row: ExportWorkflowRow): Promise<ResumableExportWorkflow> {
  const receipts = row.workflow_version >= EXPORT_WORKFLOW_VERSION
    ? await db.prepare("select (select count(*) from v2_export_files where export_id=?) as files,(select count(*) from v2_export_multipart_parts where export_id=?) as parts").bind(row.id, row.id).first<{ files: number; parts: number }>()
    : null;
  if (row.workflow_version >= EXPORT_WORKFLOW_VERSION) parseJsonObject(row.cursor_json, "export_cursor_invalid");
  return {
    id: row.id,
    profile: row.profile,
    scope: parseScope(row.scope_json),
    status: row.status,
    workflowVersion: row.workflow_version,
    buildPhase: row.build_phase as ResumableExportWorkflow["buildPhase"],
    stateRevision: row.state_revision,
    baseSequence: row.base_sequence,
    endSequence: row.end_sequence,
    bundleObjectKey: row.bundle_object_key,
    bundleSha256: row.bundle_sha256,
    bundleSizeBytes: row.bundle_size_bytes,
    manifest: parseManifest(row.manifest_json),
    progress: {
      entriesComplete: Number(receipts?.files ?? 0),
      partsUploaded: Number(receipts?.parts ?? 0),
      bytesPacked: row.zip_size_bytes,
      pendingBytes: row.pending_size_bytes,
    },
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expiresAt: row.expires_at,
    lastProgressAt: row.last_progress_at,
    failureCode: row.failure_code,
  };
}

async function ensureStaged(db: D1DatabaseBinding, userId: string, exportId: string, now: string) {
  let row = await loadExport(db, userId, exportId);
  if (!row) throw new ResumableExportError("export_not_found", "Export job was not found.");
  if (row.workflow_version < EXPORT_WORKFLOW_VERSION) {
    if (row.status !== "queued") return row;
    await db.prepare("update v2_export_jobs set workflow_version=2,build_phase='staging',cursor_json=?,state_revision=state_revision+1,last_progress_at=? where id=? and user_id=? and status='queued' and workflow_version=1 and state_revision=?")
      .bind(canonicalJson({ phase: "staging" }), now, row.id, userId, row.state_revision).run();
    row = await loadExport(db, userId, exportId);
    if (!row || row.workflow_version !== EXPORT_WORKFLOW_VERSION || row.build_phase !== "staging") {
      throw new ResumableExportError("export_stage_conflict", "Export staging changed concurrently.");
    }
  }
  return row;
}

async function claimLease(db: D1DatabaseBinding, row: ExportWorkflowRow, now: string) {
  const token = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.parse(now) + EXPORT_LEASE_MS).toISOString();
  await db.prepare("update v2_export_jobs set lease_token=?,lease_expires_at=?,state_revision=state_revision+1 where id=? and user_id=? and workflow_version=2 and status in ('queued','running') and state_revision=? and (lease_token is null or lease_expires_at<=?)")
    .bind(token, leaseExpiresAt, row.id, row.user_id, row.state_revision, now).run();
  const claimed = await loadExport(db, row.user_id, row.id);
  return claimed?.lease_token === token ? claimed : null;
}

async function assertSourceStable(db: D1DatabaseBinding, row: ExportWorkflowRow) {
  try {
    const scope = parseScope(row.scope_json);
    await assertPromptCurationExportScope(db, row.user_id, row.profile === "migration" ? fullFidelityCanonicalScope(scope) : scope);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "export_curation_scope_conflict") throw new FatalExportError(error.code, "Include history to preserve curation parents and source fragments.");
    throw error;
  }
  const result = await db.prepare("select coalesce(max(sequence),0) as value from v2_change_events where user_id=?").bind(row.user_id).first<{ value: number }>();
  if (Number(result?.value ?? 0) !== row.end_sequence) {
    throw new FatalExportError("export_source_changed_retry", "The source changed while the export was being built.");
  }
}

async function releaseLease(db: D1DatabaseBinding, row: ExportWorkflowRow, now: string) {
  await db.prepare("update v2_export_jobs set lease_token=null,lease_expires_at=null,last_progress_at=?,state_revision=state_revision+1 where id=? and user_id=? and state_revision=? and lease_token=?")
    .bind(now, row.id, row.user_id, row.state_revision, row.lease_token).run();
}

async function markFailureCleanup(db: D1DatabaseBinding, row: ExportWorkflowRow, error: FatalExportError, now: string) {
  const cursor: PackagingCursor = { phase: "failure_cleanup", code: error.code.slice(0, 100) };
  await db.prepare("update v2_export_jobs set status='running',build_phase='failure_cleanup',cursor_json=?,failure_code=?,lease_token=null,lease_expires_at=null,last_progress_at=?,state_revision=state_revision+1 where id=? and user_id=? and state_revision=? and lease_token=?")
    .bind(canonicalJson(cursor), error.code.slice(0, 100), now, row.id, row.user_id, row.state_revision, row.lease_token).run();
}

function assertObjectMetadata(object: { size: number; customMetadata?: Record<string, string> }, row: ExportWorkflowRow, expectedSize: number, purpose?: string) {
  const ownerHash = userNamespace(row.user_id);
  if (
    object.size !== expectedSize ||
    object.customMetadata?.ownerHash !== ownerHash ||
    object.customMetadata?.exportId !== row.id ||
    (purpose && object.customMetadata?.purpose !== purpose)
  ) {
    throw new FatalExportError("export_object_receipt_mismatch", "Stored export object metadata does not match its receipt.");
  }
}

async function loadVerifiedPending(bucket: R2BucketBinding, row: ExportWorkflowRow) {
  if (!row.pending_object_key) {
    if (row.pending_size_bytes !== 0 || row.pending_sha256) throw new FatalExportError("export_pending_corrupt", "Pending export receipt is inconsistent.");
    return new Uint8Array();
  }
  const head = await bucket.head(row.pending_object_key);
  if (!head) throw new FatalExportError("export_pending_corrupt", "Pending export segment is missing.");
  if (
    head.size !== row.pending_size_bytes ||
    head.customMetadata?.ownerHash !== userNamespace(row.user_id) ||
    head.customMetadata?.exportId !== row.id ||
    head.customMetadata?.purpose !== "resumable-export-pack" ||
    head.customMetadata?.sha256 !== row.pending_sha256
  ) throw new FatalExportError("export_pending_corrupt", "Pending export metadata changed.");
  const object = await bucket.get(row.pending_object_key);
  if (!object) throw new FatalExportError("export_pending_corrupt", "Pending export segment disappeared.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== row.pending_size_bytes || await sha256Bytes(bytes) !== row.pending_sha256) {
    throw new FatalExportError("export_pending_corrupt", "Pending export segment bytes do not match their receipt.");
  }
  return bytes;
}

async function removePendingSegment(db: D1DatabaseBinding, bucket: R2BucketBinding, exportId: string, objectKey: string) {
  await bucket.delete(objectKey);
  await db.prepare("delete from v2_export_pending_segments where export_id=? and object_key=?").bind(exportId, objectKey).run();
}

async function removeVisiblePendingSegment(db: D1DatabaseBinding, bucket: R2BucketBinding, exportId: string, objectKey: string) {
  // Registration precedes the R2 PUT. A missing object can therefore still belong
  // to an in-flight stale request; retaining its receipt makes a later PUT
  // discoverable by the next bounded maintenance pass.
  if (!await bucket.head(objectKey)) return false;
  await removePendingSegment(db, bucket, exportId, objectKey);
  return true;
}

async function cleanupOneOrphanPendingSegment(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow) {
  const stale = await db.prepare(`select object_key from v2_export_pending_segments
    where export_id=? and object_key<>coalesce(?, '') and lease_token<>coalesce(?, '')
    order by created_at,object_key limit 1`)
    .bind(row.id, row.pending_object_key, row.lease_token).first<{ object_key: string }>();
  if (!stale) return "none" as const;
  return await removeVisiblePendingSegment(db, bucket, row.id, stale.object_key) ? "removed" as const : "waiting" as const;
}

async function registerPendingSegment(db: D1DatabaseBinding, row: ExportWorkflowRow, key: string, bytes: Uint8Array, sha256: string, now: string) {
  if (!row.lease_token) throw new FatalExportError("export_workflow_invalid", "Pending segment lease is missing.");
  await db.prepare(`insert into v2_export_pending_segments (export_id,user_id,object_key,lease_token,size_bytes,sha256,created_at)
    select ?,?,?,?,?,?,? where exists (
      select 1 from v2_export_jobs j where j.id=? and j.user_id=? and j.status='running' and j.state_revision=? and j.lease_token=?
    )`)
    .bind(row.id, row.user_id, key, row.lease_token, bytes.byteLength, sha256, now, row.id, row.user_id, row.state_revision, row.lease_token).run();
  const receipt = await db.prepare("select size_bytes,sha256,lease_token from v2_export_pending_segments where export_id=? and object_key=? limit 1")
    .bind(row.id, key).first<{ size_bytes: number; sha256: string; lease_token: string }>();
  if (!receipt || receipt.size_bytes !== bytes.byteLength || receipt.sha256 !== sha256 || receipt.lease_token !== row.lease_token) {
    throw new ResumableExportError("export_advance_conflict", "Pending segment registration lost its lease.");
  }
}

async function putPending(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, key: string, bytes: Uint8Array, sha256: string, now: string) {
  await registerPendingSegment(db, row, key, bytes, sha256, now);
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        ownerHash: userNamespace(row.user_id),
        exportId: row.id,
        purpose: "resumable-export-pack",
        sha256,
        size: String(bytes.byteLength),
      },
      sha256,
    });
  } catch (error) {
    await removePendingSegment(db, bucket, row.id, key).catch(() => undefined);
    throw error;
  }
  const head = await bucket.head(key);
  if (!head) throw new FatalExportError("export_pending_corrupt", "Pending export segment was not persisted.");
  assertObjectMetadata(head, row, bytes.byteLength, "resumable-export-pack");
  if (head.customMetadata?.sha256 !== sha256 || head.customMetadata?.size !== String(bytes.byteLength)) {
    throw new FatalExportError("export_pending_corrupt", "Pending export segment metadata was not persisted.");
  }
}

type NewFileReceipt = Omit<ExportFileReceiptRow, "ordinal">;
type CompleteEntryInput = {
  path: string;
  mediaType: string;
  entryKind: string;
  data: Uint8Array;
  tableName?: string;
  sourceRef?: string;
  includeInManifest?: boolean;
  recordCount?: number;
};

async function buildCompleteEntry(input: CompleteEntryInput, localOffset: number) {
  assertSafeZipPath(input.path);
  const pathBytes = encoder.encode(input.path);
  const crc32 = (updateCrcState(0xffff_ffff, input.data) ^ 0xffff_ffff) >>> 0;
  return {
    bytes: concatBytes(localHeader(pathBytes), pathBytes, input.data, dataDescriptor(crc32, input.data.byteLength)),
    receipt: {
      entry_kind: input.entryKind,
      table_name: input.tableName ?? null,
      source_ref: input.sourceRef ?? null,
      path: input.path,
      media_type: input.mediaType,
      include_in_manifest: input.includeInManifest === false ? 0 : 1,
      local_offset: localOffset,
      size_bytes: input.data.byteLength,
      crc32,
      sha256: await sha256Bytes(input.data),
      record_count: input.recordCount ?? 0,
    } satisfies NewFileReceipt,
  };
}

async function appendZipBytes(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  row: ExportWorkflowRow;
  cursor: PackagingCursor;
  bytes: Uint8Array;
  now: string;
  receipt?: NewFileReceipt;
  receipts?: readonly NewFileReceipt[];
  manifestJson?: string | null;
}) {
  const { db, bucket, row, cursor, bytes, now } = input;
  const newReceipts = input.receipts ?? (input.receipt ? [input.receipt] : []);
  if (!row.lease_token || !row.upload_id) throw new FatalExportError("export_workflow_invalid", "Export packaging is missing its lease or multipart upload.");
  if (newReceipts.length > EXPORT_MAX_UNITS_PER_ADVANCE || row.entry_count + newReceipts.length > EXPORT_ZIP32_MAX_ENTRIES) throw new FatalExportError("export_zip32_entry_limit", "ZIP32 entry count was exceeded.");
  if (row.zip_size_bytes + bytes.byteLength > EXPORT_ZIP32_MAX_BYTES) throw new FatalExportError("export_zip32_size_exceeded", "ZIP32 byte limit was exceeded.");
  const hashState = parseShaState(row.zip_sha256_state_json);
  if (hashState.totalBytes !== row.zip_size_bytes) throw new FatalExportError("export_hash_state_invalid", "Export hash length does not match its ZIP offset.");
  const priorPending = await loadVerifiedPending(bucket, row);
  const combined = concatBytes(priorPending, bytes);
  if (combined.byteLength >= EXPORT_MULTIPART_PART_BYTES * 2) {
    throw new FatalExportError("export_step_too_large", "One export step exceeded the bounded multipart buffer.");
  }

  let uploadedPart: ExportPartReceiptRow | null = null;
  let remainder = combined;
  if (combined.byteLength >= EXPORT_MULTIPART_PART_BYTES) {
    if (row.next_part_number > EXPORT_MULTIPART_MAX_PARTS) throw new FatalExportError("export_multipart_part_limit", "R2 multipart part count was exceeded.");
    const partBytes = combined.subarray(0, EXPORT_MULTIPART_PART_BYTES);
    const partSha256 = await sha256Bytes(partBytes);
    const existing = await db.prepare("select part_number,etag,size_bytes,sha256 from v2_export_multipart_parts where export_id=? and part_number=? limit 1")
      .bind(row.id, row.next_part_number).first<ExportPartReceiptRow>();
    if (existing && (existing.size_bytes !== partBytes.byteLength || existing.sha256 !== partSha256)) {
      throw new FatalExportError("export_part_receipt_mismatch", "Multipart retry bytes do not match the stored receipt.");
    }
    if (existing) {
      uploadedPart = existing;
    } else {
      if (!bucket.resumeMultipartUpload) throw new FatalExportError("export_multipart_unavailable", "R2 multipart resume is unavailable.");
      const result = await bucket.resumeMultipartUpload(bundleObjectKey(row.user_id, row.id), row.upload_id).uploadPart(row.next_part_number, partBytes);
      if (result.partNumber !== row.next_part_number || !result.etag) throw new FatalExportError("export_part_receipt_invalid", "R2 returned an invalid multipart receipt.");
      uploadedPart = { part_number: result.partNumber, etag: result.etag, size_bytes: partBytes.byteLength, sha256: partSha256 };
    }
    remainder = combined.subarray(EXPORT_MULTIPART_PART_BYTES);
  }

  const nextPendingKey = remainder.byteLength ? pendingObjectKey(row.user_id, row.id, row.lease_token) : null;
  const nextPendingSha = remainder.byteLength ? await sha256Bytes(remainder) : null;
  if (nextPendingKey && nextPendingSha) await putPending(db, bucket, row, nextPendingKey, remainder, nextPendingSha, now);
  const nextHashState = updateSerializableSha256(hashState, bytes);
  const statements: D1PreparedStatementBinding[] = [];
  if (uploadedPart && !await db.prepare("select 1 as value from v2_export_multipart_parts where export_id=? and part_number=? limit 1").bind(row.id, uploadedPart.part_number).first<{ value: number }>()) {
    statements.push(db.prepare(`insert into v2_export_multipart_parts (export_id,user_id,part_number,etag,size_bytes,sha256,created_at)
      select ?,?,?,?,?,?,? where exists (
        select 1 from v2_export_jobs j where j.id=? and j.user_id=? and j.status='running' and j.state_revision=? and j.lease_token=?
      )`)
      .bind(row.id, row.user_id, uploadedPart.part_number, uploadedPart.etag, uploadedPart.size_bytes, uploadedPart.sha256, now, row.id, row.user_id, row.state_revision, row.lease_token));
  }
  for (let index = 0; index < newReceipts.length; index += 1) {
    const receipt = newReceipts[index];
    statements.push(db.prepare(`insert into v2_export_files (export_id,user_id,ordinal,entry_kind,table_name,source_ref,path,media_type,include_in_manifest,local_offset,size_bytes,crc32,sha256,record_count,created_at,completed_at)
      select ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? where exists (
        select 1 from v2_export_jobs j where j.id=? and j.user_id=? and j.status='running' and j.state_revision=? and j.lease_token=?
      )`)
      .bind(row.id, row.user_id, row.entry_count + index, receipt.entry_kind, receipt.table_name, receipt.source_ref, receipt.path, receipt.media_type, receipt.include_in_manifest, receipt.local_offset, receipt.size_bytes, receipt.crc32, receipt.sha256, receipt.record_count, now, now, row.id, row.user_id, row.state_revision, row.lease_token));
  }
  statements.push(db.prepare("update v2_export_jobs set build_phase=?,cursor_json=?,state_revision=state_revision+1,lease_token=null,lease_expires_at=null,last_progress_at=?,pending_object_key=?,pending_size_bytes=?,pending_sha256=?,zip_size_bytes=zip_size_bytes+?,zip_sha256_state_json=?,entry_count=entry_count+?,next_part_number=next_part_number+?,manifest_json=? where id=? and user_id=? and status='running' and state_revision=? and lease_token=?")
    .bind(
      phaseForCursor(cursor), canonicalJson(cursor), now, nextPendingKey, remainder.byteLength, nextPendingSha, bytes.byteLength,
      canonicalJson(nextHashState), newReceipts.length, uploadedPart ? 1 : 0, input.manifestJson === undefined ? row.manifest_json : input.manifestJson,
      row.id, row.user_id, row.state_revision, row.lease_token,
    ));
  await db.batch(statements);
  const saved = await loadExport(db, row.user_id, row.id);
  const expectedZipSize = row.zip_size_bytes + bytes.byteLength;
  const expectedEntries = row.entry_count + newReceipts.length;
  const progressObserved = Boolean(saved && saved.zip_size_bytes >= expectedZipSize && saved.entry_count >= expectedEntries);
  if (!progressObserved) {
    if (nextPendingKey && saved?.pending_object_key !== nextPendingKey) await removePendingSegment(db, bucket, row.id, nextPendingKey).catch(() => undefined);
    throw new ResumableExportError("export_advance_conflict", "Export progress changed concurrently.");
  }
  if (nextPendingKey && saved!.pending_object_key !== nextPendingKey) await removePendingSegment(db, bucket, row.id, nextPendingKey).catch(() => undefined);
  if (row.pending_object_key && saved!.pending_object_key !== row.pending_object_key) await removePendingSegment(db, bucket, row.id, row.pending_object_key);
  return saved!;
}

async function completeSmallEntry(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  row: ExportWorkflowRow;
  cursor: PackagingCursor;
  path: string;
  mediaType: string;
  entryKind: string;
  data: Uint8Array;
  now: string;
  tableName?: string;
  sourceRef?: string;
  includeInManifest?: boolean;
  recordCount?: number;
  manifestJson?: string;
}) {
  const built = await buildCompleteEntry(input, input.row.zip_size_bytes);
  return appendZipBytes({
    db: input.db,
    bucket: input.bucket,
    row: input.row,
    cursor: input.cursor,
    bytes: built.bytes,
    now: input.now,
    manifestJson: input.manifestJson,
    receipt: built.receipt,
  });
}

async function completeSmallEntries(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  row: ExportWorkflowRow;
  cursor: PackagingCursor;
  entries: readonly CompleteEntryInput[];
  now: string;
}) {
  if (!input.entries.length || input.entries.length > EXPORT_MAX_UNITS_PER_ADVANCE) throw new FatalExportError("export_step_too_large", "Export entry batch is invalid.");
  const chunks: Uint8Array[] = [];
  const receipts: NewFileReceipt[] = [];
  let localOffset = input.row.zip_size_bytes;
  for (const entry of input.entries) {
    const built = await buildCompleteEntry(entry, localOffset);
    chunks.push(built.bytes);
    receipts.push(built.receipt);
    localOffset += built.bytes.byteLength;
  }
  return appendZipBytes({ db: input.db, bucket: input.bucket, row: input.row, cursor: input.cursor, bytes: concatBytes(...chunks), receipts, now: input.now });
}

async function beginOpenEntry(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  row: ExportWorkflowRow;
  cursor: PackagingCursor;
  path: string;
  mediaType: string;
  entryKind: string;
  now: string;
  tableName?: string;
  sourceRef?: string;
  includeInManifest?: boolean;
  original?: OpenEntry["original"];
  recordCount?: number;
  initialData?: Uint8Array;
}) {
  assertSafeZipPath(input.path);
  const pathBytes = encoder.encode(input.path);
  const initialData = input.initialData ?? new Uint8Array();
  const open: OpenEntry = {
    path: input.path,
    mediaType: input.mediaType,
    entryKind: input.entryKind,
    tableName: input.tableName,
    sourceRef: input.sourceRef,
    includeInManifest: input.includeInManifest !== false,
    localOffset: input.row.zip_size_bytes,
    sizeBytes: initialData.byteLength,
    crcState: updateCrcState(0xffff_ffff, initialData),
    shaState: updateSerializableSha256(INITIAL_EXPORT_SHA256_STATE, initialData),
    recordCount: input.recordCount ?? 0,
    original: input.original,
  };
  const cursor = { ...input.cursor, open } as PackagingCursor;
  return appendZipBytes({ db: input.db, bucket: input.bucket, row: input.row, cursor, bytes: concatBytes(localHeader(pathBytes), pathBytes, initialData), now: input.now });
}

async function appendOpenData(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  row: ExportWorkflowRow;
  cursor: PackagingCursor & { open?: OpenEntry };
  data: Uint8Array;
  now: string;
  records?: number;
  originalOffset?: number;
}) {
  const current = input.cursor.open;
  if (!current) throw new FatalExportError("export_cursor_invalid", "Open ZIP entry state is missing.");
  if (current.sizeBytes + input.data.byteLength > EXPORT_ZIP32_MAX_BYTES) throw new FatalExportError("export_zip32_size_exceeded", "ZIP entry exceeds ZIP32.");
  const open: OpenEntry = {
    ...current,
    sizeBytes: current.sizeBytes + input.data.byteLength,
    crcState: updateCrcState(current.crcState, input.data),
    shaState: updateSerializableSha256(current.shaState, input.data),
    recordCount: current.recordCount + (input.records ?? 0),
    original: current.original && input.originalOffset !== undefined ? { ...current.original, offset: input.originalOffset } : current.original,
  };
  const cursor = { ...input.cursor, open } as PackagingCursor;
  return appendZipBytes({ db: input.db, bucket: input.bucket, row: input.row, cursor, bytes: input.data, now: input.now });
}

async function finishOpenEntry(input: {
  db: D1DatabaseBinding;
  bucket: R2BucketBinding;
  row: ExportWorkflowRow;
  cursor: PackagingCursor & { open?: OpenEntry };
  nextCursor: PackagingCursor;
  now: string;
}) {
  const open = input.cursor.open;
  if (!open) throw new FatalExportError("export_cursor_invalid", "Open ZIP entry state is missing.");
  const crc32 = (open.crcState ^ 0xffff_ffff) >>> 0;
  return appendZipBytes({
    db: input.db,
    bucket: input.bucket,
    row: input.row,
    cursor: input.nextCursor,
    bytes: dataDescriptor(crc32, open.sizeBytes),
    now: input.now,
    receipt: {
      entry_kind: open.entryKind,
      table_name: open.tableName ?? null,
      source_ref: open.sourceRef ?? null,
      path: open.path,
      media_type: open.mediaType,
      include_in_manifest: open.includeInManifest ? 1 : 0,
      local_offset: open.localOffset,
      size_bytes: open.sizeBytes,
      crc32,
      sha256: digestSerializableSha256(open.shaState),
      record_count: open.recordCount,
    },
  });
}

async function persistCursorOnly(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; row: ExportWorkflowRow; cursor: PackagingCursor; now: string }) {
  if (!input.row.lease_token) throw new FatalExportError("export_workflow_invalid", "Export lease is missing.");
  await loadVerifiedPending(input.bucket, input.row);
  await input.db.prepare("update v2_export_jobs set build_phase=?,cursor_json=?,lease_token=null,lease_expires_at=null,last_progress_at=?,state_revision=state_revision+1 where id=? and user_id=? and status='running' and state_revision=? and lease_token=?")
    .bind(phaseForCursor(input.cursor), canonicalJson(input.cursor), input.now, input.row.id, input.row.user_id, input.row.state_revision, input.row.lease_token).run();
  const saved = await loadExport(input.db, input.row.user_id, input.row.id);
  if (!saved || saved.state_revision !== input.row.state_revision + 1 || saved.lease_token) throw new ResumableExportError("export_advance_conflict", "Export progress changed concurrently.");
  return saved;
}

type PortableDocumentRow = {
  object_id: string;
  capture_id: string;
  title: string;
  body_markdown: string;
  written_at: string | null;
  privacy_level: string;
  current_revision_id: string;
  current_version: number;
  captured_at: string;
  [key: string]: unknown;
};

async function loadDocuments(db: D1DatabaseBinding, row: ExportWorkflowRow, offset: number) {
  const descriptor = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION).find((item) => item.table === "v2_documents");
  if (!descriptor) throw new FatalExportError("export_descriptor_missing", "Document export descriptor is missing.");
  const parsedScope = parseScope(row.scope_json);
  const queryScope = row.profile === "migration" ? fullFidelityCanonicalScope(parsedScope) : parsedScope;
  const scoped = descriptor.query(row.user_id, queryScope);
  return db.prepare(`select d.*,c.captured_at from (${scoped.sql}) d join v2_capture_bundles c on c.id=d.capture_id and c.user_id=? order by d.object_id limit ? offset ?`)
    .bind(...scoped.bindings, row.user_id, EXPORT_MAX_DOCUMENTS_PER_ADVANCE, offset).all<PortableDocumentRow>();
}

async function documentPayloads(db: D1DatabaseBinding, row: ExportWorkflowRow, document: PortableDocumentRow) {
  const typeRows = await db.prepare("select t.key,t.label from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id and t.user_id=a.user_id where a.object_id=? and a.user_id=? and a.review_status='accepted' order by a.role,t.key")
    .bind(document.object_id, row.user_id).all<{ key: string; label: string }>();
  const relatedVisibility = row.profile === "migration" ? "1=1" : await legacyProjectionVisibilityPredicate(db, "eo");
  const relatedRows = await db.prepare(`select e.object_id,e.entity_kind,e.canonical_name from v2_relation_edges r join v2_entity_records e on e.object_id=case when r.subject_object_id=? then r.object_object_id else r.subject_object_id end join v2_objects eo on eo.id=e.object_id and eo.user_id=r.user_id where r.user_id=? and (r.subject_object_id=? or r.object_object_id=?) and r.review_status='accepted' and ${relatedVisibility} order by e.canonical_name`)
    .bind(document.object_id, row.user_id, document.object_id, document.object_id).all<{ object_id: string; entity_kind: string; canonical_name: string }>();
  const frontmatter = [
    "---",
    `lighthouse_id: ${yamlString(document.object_id)}`,
    `title: ${yamlString(document.title)}`,
    `written_at: ${yamlString(document.written_at ?? document.captured_at)}`,
    `privacy_level: ${yamlString(document.privacy_level)}`,
    "types:",
    ...(typeRows.results.length ? typeRows.results.map((type) => `  - ${yamlString(type.key)}`) : ["  []"]),
    "related_objects:",
    ...(relatedRows.results.length ? relatedRows.results.flatMap((related) => [`  - id: ${yamlString(related.object_id)}`, `    kind: ${yamlString(related.entity_kind)}`, `    label: ${yamlString(related.canonical_name)}`]) : ["  []"]),
    "---",
    "",
  ].join("\n");
  const markdown = `${frontmatter}${document.body_markdown}${document.body_markdown.endsWith("\n") ? "" : "\n"}`;
  const metadata = canonicalJson({ schema_version: LIGHTHOUSE_SCHEMA_VERSION, user_scope_export_id: row.id, ...document, types: typeRows.results, related_objects: relatedRows.results }) + "\n";
  return [
    {
      path: `documents/${document.object_id}/index.md`,
      mediaType: "text/markdown; charset=utf-8",
      entryKind: "document_markdown",
      data: encoder.encode(markdown),
      sourceRef: document.object_id,
      recordCount: 1,
    },
    {
      path: `documents/${document.object_id}/metadata.json`,
      mediaType: "application/json",
      entryKind: "document_metadata",
      data: encoder.encode(metadata),
      sourceRef: document.object_id,
      recordCount: 1,
    },
  ] satisfies CompleteEntryInput[];
}

async function advanceReadme(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, now: string) {
  return completeSmallEntry({
    db,
    bucket,
    row,
    cursor: { phase: "documents", offset: 0, subphase: "markdown" },
    path: "README.md",
    mediaType: "text/markdown; charset=utf-8",
    entryKind: "readme",
    data: encoder.encode(readmeText(row, parseScope(row.scope_json))),
    now,
  });
}

async function advanceDocuments(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "documents" }>, now: string) {
  const page = await loadDocuments(db, row, cursor.offset);
  if (!page.results.length) return persistCursorOnly({ db, bucket, row, cursor: { phase: "canonical", tableIndex: 0, rowOffset: 0 }, now });
  const entries: CompleteEntryInput[] = [];
  let payloadBytes = 0;
  let documents = 0;
  for (const document of page.results) {
    const pair = await documentPayloads(db, row, document);
    const pairBytes = pair.reduce((total, entry) => total + entry.data.byteLength + encoder.encode(entry.path).byteLength + 46, 0);
    if (documents > 0 && payloadBytes + pairBytes > EXPORT_APPEND_BYTE_BUDGET) break;
    entries.push(...pair);
    payloadBytes += pairBytes;
    documents += 1;
  }
  return completeSmallEntries({
    db,
    bucket,
    row,
    cursor: { phase: "documents", offset: cursor.offset + documents, subphase: "markdown" },
    entries,
    now,
  });
}

function descriptorsForJob(row: ExportWorkflowRow) {
  const descriptors = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION);
  if (row.profile === "migration") return descriptors;
  const attachment = descriptors.find((descriptor) => descriptor.table === "v2_attachment_reservations");
  if (!attachment) throw new FatalExportError("export_descriptor_missing", "Attachment export descriptor is missing.");
  return [attachment] as readonly CanonicalTableDescriptor[];
}

async function canonicalRows(db: D1DatabaseBinding, row: ExportWorkflowRow, descriptor: CanonicalTableDescriptor, offset: number) {
  const parsedScope = parseScope(row.scope_json);
  const queryScope = row.profile === "migration" ? fullFidelityCanonicalScope(parsedScope) : parsedScope;
  const scoped = descriptor.query(row.user_id, queryScope);
  const order = descriptor.primaryKey.map((key) => `"${key}"`).join(",");
  return db.prepare(`select * from (${scoped.sql}) as scoped_rows order by ${order} limit ? offset ?`)
    .bind(...scoped.bindings, EXPORT_MAX_UNITS_PER_ADVANCE, offset).all<Record<string, unknown>>();
}

async function advanceCanonical(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "canonical" }>, now: string) {
  const descriptors = descriptorsForJob(row);
  if (cursor.tableIndex >= descriptors.length) {
    const next: PackagingCursor = parseScope(row.scope_json).includeOriginals
      ? { phase: "originals", offset: 0 }
      : { phase: "checksums", offset: 0 };
    return persistCursorOnly({ db, bucket, row, cursor: next, now });
  }
  const descriptor = descriptors[cursor.tableIndex];
  const page = await canonicalRows(db, row, descriptor, cursor.rowOffset);
  const chunks: Uint8Array[] = [];
  let payloadBytes = 0;
  for (const value of page.results) {
    const data = encoder.encode(canonicalJson(envelopeCanonicalRow(value, row.id)) + "\n");
    if (chunks.length > 0 && payloadBytes + data.byteLength > EXPORT_APPEND_BYTE_BUDGET) break;
    chunks.push(data);
    payloadBytes += data.byteLength;
  }
  const data = concatBytes(...chunks);

  if (!cursor.open && !page.results.length) {
    return completeSmallEntry({
      db,
      bucket,
      row,
      cursor: { phase: "canonical", tableIndex: cursor.tableIndex + 1, rowOffset: 0 },
      path: descriptor.path,
      mediaType: "application/x-ndjson; charset=utf-8",
      entryKind: "canonical_jsonl",
      tableName: descriptor.table,
      data,
      recordCount: 0,
      now,
    });
  }
  if (!cursor.open) {
    return beginOpenEntry({
      db,
      bucket,
      row,
      cursor: { ...cursor, rowOffset: cursor.rowOffset + chunks.length },
      path: descriptor.path,
      mediaType: "application/x-ndjson; charset=utf-8",
      entryKind: "canonical_jsonl",
      tableName: descriptor.table,
      initialData: data,
      recordCount: chunks.length,
      now,
    });
  }
  if (page.results.length) {
    const nextCursor = { ...cursor, rowOffset: cursor.rowOffset + chunks.length } as typeof cursor;
    return appendOpenData({ db, bucket, row, cursor: { ...nextCursor, open: cursor.open }, data, records: chunks.length, now });
  }
  return finishOpenEntry({
    db,
    bucket,
    row,
    cursor,
    nextCursor: { phase: "canonical", tableIndex: cursor.tableIndex + 1, rowOffset: 0 },
    now,
  });
}

type OriginalRow = { id: string; object_key: string; filename: string; status: string; sha256: string; size_bytes: number };

function normalizeExpectedSha(value: string) {
  const normalized = value.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new FatalExportError("attachment_original_checksum_invalid", "Attachment checksum is invalid.");
  return normalized;
}

async function loadOriginals(db: D1DatabaseBinding, row: ExportWorkflowRow, offset: number) {
  const descriptor = canonicalTablesForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION).find((item) => item.table === "v2_attachment_reservations");
  if (!descriptor) throw new FatalExportError("export_descriptor_missing", "Attachment export descriptor is missing.");
  const parsedScope = parseScope(row.scope_json);
  const queryScope = row.profile === "migration" ? fullFidelityCanonicalScope(parsedScope) : parsedScope;
  const scoped = descriptor.query(row.user_id, queryScope);
  return db.prepare(`select * from (${scoped.sql}) a where status='committed' order by id limit ? offset ?`)
    .bind(...scoped.bindings, EXPORT_MAX_ORIGINALS_PER_ADVANCE, offset).all<OriginalRow>();
}

async function advanceOriginals(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "originals" }>, now: string) {
  if (!cursor.open) {
    const page = await loadOriginals(db, row, cursor.offset);
    if (!page.results.length) return persistCursorOnly({ db, bucket, row, cursor: { phase: "checksums", offset: 0 }, now });
    const entries: CompleteEntryInput[] = [];
    let payloadBytes = 0;
    let firstLarge: { attachment: OriginalRow; mediaType: string } | null = null;
    for (const attachment of page.results) {
      const object = await bucket.head(attachment.object_key);
      if (!object || object.size !== attachment.size_bytes) throw new FatalExportError("attachment_original_missing", `Attachment original is missing or changed: ${attachment.id}`);
      if (attachment.size_bytes > ORIGINAL_CHUNK_BYTES) {
        if (!entries.length) firstLarge = { attachment, mediaType: object.httpMetadata?.contentType ?? "application/octet-stream" };
        break;
      }
      if (entries.length && payloadBytes + attachment.size_bytes > EXPORT_APPEND_BYTE_BUDGET) break;
      const stored = await bucket.get(attachment.object_key, attachment.size_bytes ? { range: { offset: 0, length: attachment.size_bytes } } : undefined);
      if (!stored) throw new FatalExportError("attachment_original_missing", `Attachment original disappeared: ${attachment.id}`);
      const data = new Uint8Array(await stored.arrayBuffer());
      const expectedSha256 = normalizeExpectedSha(attachment.sha256);
      if (data.byteLength !== attachment.size_bytes || await sha256Bytes(data) !== expectedSha256) {
        throw new FatalExportError("attachment_original_checksum_mismatch", `Attachment original checksum changed: ${attachment.id}`);
      }
      entries.push({
        path: `attachments/originals/${attachment.id}/${safeFilename(attachment.filename)}`,
        mediaType: object.httpMetadata?.contentType ?? "application/octet-stream",
        entryKind: "attachment_original",
        sourceRef: attachment.id,
        data,
        recordCount: 1,
      });
      payloadBytes += data.byteLength;
    }
    if (entries.length) {
      return completeSmallEntries({ db, bucket, row, cursor: { phase: "originals", offset: cursor.offset + entries.length }, entries, now });
    }
    const attachment = firstLarge?.attachment ?? page.results[0];
    const mediaType = firstLarge?.mediaType ?? "application/octet-stream";
    const path = `attachments/originals/${attachment.id}/${safeFilename(attachment.filename)}`;
    return beginOpenEntry({
      db,
      bucket,
      row,
      cursor,
      path,
      mediaType,
      entryKind: "attachment_original",
      sourceRef: attachment.id,
      original: {
        objectKey: attachment.object_key,
        expectedBytes: attachment.size_bytes,
        expectedSha256: normalizeExpectedSha(attachment.sha256),
        offset: 0,
      },
      recordCount: 1,
      now,
    });
  }
  const source = cursor.open.original;
  if (!source) throw new FatalExportError("export_cursor_invalid", "Attachment original cursor is missing.");
  if (source.offset < source.expectedBytes) {
    const length = Math.min(ORIGINAL_CHUNK_BYTES, source.expectedBytes - source.offset);
    const object = await bucket.get(source.objectKey, { range: { offset: source.offset, length } });
    if (!object) throw new FatalExportError("attachment_original_missing", `Attachment original disappeared: ${cursor.open.sourceRef ?? "unknown"}`);
    const data = new Uint8Array(await object.arrayBuffer());
    if (data.byteLength !== length) throw new FatalExportError("attachment_original_truncated", "Attachment original range is truncated.");
    return appendOpenData({ db, bucket, row, cursor, data, originalOffset: source.offset + data.byteLength, now });
  }
  if (cursor.open.sizeBytes !== source.expectedBytes || digestSerializableSha256(cursor.open.shaState) !== source.expectedSha256) {
    throw new FatalExportError("attachment_original_checksum_mismatch", `Attachment original checksum changed: ${cursor.open.sourceRef ?? "unknown"}`);
  }
  return finishOpenEntry({ db, bucket, row, cursor, nextCursor: { phase: "originals", offset: cursor.offset + 1 }, now });
}

async function advanceChecksums(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "checksums" }>, now: string) {
  void cursor;
  const files = await db.prepare("select path,sha256 from v2_export_files where export_id=? and include_in_manifest=1 limit ?")
    .bind(row.id, MANIFEST_MAX_FILES + 1).all<{ path: string; sha256: string }>();
  if (files.results.length > MANIFEST_MAX_FILES) throw new FatalExportError("export_manifest_file_limit", "Checksum file count exceeds the archive budget.");
  const text = files.results.slice().sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n";
  return completeSmallEntry({
    db,
    bucket,
    row,
    cursor: { phase: "manifest" },
    path: "checksums.sha256",
    mediaType: "text/plain; charset=utf-8",
    entryKind: "checksums",
    data: encoder.encode(text),
    includeInManifest: false,
    now,
  });
}

async function buildManifest(db: D1DatabaseBinding, row: ExportWorkflowRow) {
  const receiptRows = await db.prepare("select ordinal,entry_kind,table_name,source_ref,path,media_type,include_in_manifest,local_offset,size_bytes,crc32,sha256,record_count from v2_export_files where export_id=? and include_in_manifest=1 order by ordinal limit ?")
    .bind(row.id, MANIFEST_MAX_FILES + 1).all<ExportFileReceiptRow>();
  if (receiptRows.results.length > MANIFEST_MAX_FILES) throw new FatalExportError("export_manifest_file_limit", "Manifest file count exceeds its D1-safe budget.");
  const files: ExportFileManifestV1[] = receiptRows.results.map((file) => ({
    path: file.path,
    bytes: file.size_bytes,
    mediaType: file.media_type,
    sha256: file.sha256,
    records: file.record_count,
  }));
  const counts: Record<string, number> = {};
  const documents = receiptRows.results.filter((file) => file.entry_kind === "document_markdown").length;
  if (documents) counts.documents = documents;
  const descriptors = descriptorsForJob(row);
  for (const descriptor of descriptors) {
    const receipt = receiptRows.results.find((file) => file.entry_kind === "canonical_jsonl" && file.table_name === descriptor.table);
    if (!receipt) throw new FatalExportError("export_manifest_receipt_missing", `Canonical receipt is missing: ${descriptor.table}`);
    if (row.profile === "migration") counts[descriptor.table] = receipt.record_count;
    else counts.attachments = receipt.record_count;
  }
  const originals = receiptRows.results.filter((file) => file.entry_kind === "attachment_original").length;
  if (originals) counts.attachment_originals = originals;
  const scope = parseScope(row.scope_json);
  const warnings: string[] = [];
  if (scope.privacyLevels.includes("restricted")) warnings.push("restricted_records_included_after_reauthentication");
  if (!scope.includeOriginals) warnings.push("attachment_originals_excluded_by_scope");
  const manifest: ExportManifestV1 = {
    format: LIGHTHOUSE_EXPORT_FORMAT,
    version: LIGHTHOUSE_EXPORT_VERSION,
    profile: row.profile,
    exportId: row.id,
    createdAt: row.created_at,
    sourceAppVersion: "0.1.0",
    schemaVersion: LIGHTHOUSE_SCHEMA_VERSION,
    userTimezone: "Asia/Seoul",
    scope,
    counts,
    files,
    rootHash: exportRootHash(files),
    baseSequence: row.base_sequence,
    endSequence: row.end_sequence,
    warnings,
  };
  const json = canonicalJson(manifest);
  if (encoder.encode(json).byteLength > MANIFEST_MAX_BYTES) throw new FatalExportError("export_manifest_size_limit", "Manifest exceeds its D1-safe byte budget.");
  return { manifest, json };
}

async function advanceManifest(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, now: string) {
  const { json } = await buildManifest(db, row);
  const data = encoder.encode(`${json}\n`);
  const path = "manifest.json";
  const finalZipOffset = row.zip_size_bytes + 30 + encoder.encode(path).byteLength + data.byteLength + 16;
  if (finalZipOffset > EXPORT_ZIP32_MAX_BYTES) throw new FatalExportError("export_zip32_size_exceeded", "ZIP32 byte limit was exceeded.");
  return completeSmallEntry({
    db,
    bucket,
    row,
    cursor: { phase: "central_directory", ordinal: 0, centralOffset: finalZipOffset, centralBytes: 0 },
    path,
    mediaType: "application/json",
    entryKind: "manifest",
    data,
    includeInManifest: false,
    manifestJson: json,
    now,
  });
}

async function advanceCentralDirectory(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "central_directory" }>, now: string) {
  if (cursor.centralOffset < 0 || cursor.centralOffset > row.zip_size_bytes || cursor.ordinal < 0 || cursor.ordinal > row.entry_count) {
    throw new FatalExportError("export_cursor_invalid", "Central directory cursor is invalid.");
  }
  const page = await db.prepare("select ordinal,entry_kind,table_name,source_ref,path,media_type,include_in_manifest,local_offset,size_bytes,crc32,sha256,record_count from v2_export_files where export_id=? order by ordinal limit ? offset ?")
    .bind(row.id, EXPORT_CENTRAL_RECEIPTS_PER_ADVANCE, cursor.ordinal).all<ExportFileReceiptRow>();
  if (page.results.length) {
    const chunks = page.results.map((receipt, index) => {
      if (receipt.ordinal !== cursor.ordinal + index) throw new FatalExportError("export_file_receipt_gap", "ZIP entry ordinals are not contiguous.");
      const pathBytes = encoder.encode(receipt.path);
      return concatBytes(centralHeader(receipt, pathBytes), pathBytes);
    });
    const bytes = concatBytes(...chunks);
    return appendZipBytes({
      db,
      bucket,
      row,
      cursor: { phase: "central_directory", ordinal: cursor.ordinal + page.results.length, centralOffset: cursor.centralOffset, centralBytes: cursor.centralBytes + bytes.byteLength },
      bytes,
      now,
    });
  }
  if (cursor.ordinal !== row.entry_count || row.entry_count > EXPORT_ZIP32_MAX_ENTRIES || cursor.centralOffset + cursor.centralBytes !== row.zip_size_bytes) {
    throw new FatalExportError("export_central_directory_invalid", "Central directory receipts are incomplete.");
  }
  return appendZipBytes({
    db,
    bucket,
    row,
    cursor: { phase: "finalizing", step: "upload_last_part" },
    bytes: endOfCentralDirectory(row.entry_count, cursor.centralBytes, cursor.centralOffset),
    now,
  });
}

async function initializeMultipart(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, now: string) {
  if (!row.lease_token || row.status !== "queued" || row.build_phase !== "staging") throw new FatalExportError("export_workflow_invalid", "Export staging state is invalid.");
  await assertSourceStable(db, row);
  if (!bucket.createMultipartUpload) throw new FatalExportError("export_multipart_unavailable", "R2 multipart upload is unavailable.");
  const key = bundleObjectKey(row.user_id, row.id);
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { ownerHash: userNamespace(row.user_id), exportId: row.id, profile: row.profile },
  });
  if (!upload.uploadId) {
    await upload.abort().catch(() => undefined);
    throw new FatalExportError("export_multipart_receipt_invalid", "R2 did not return a multipart upload id.");
  }
  await db.prepare("update v2_export_jobs set status='running',build_phase='packaging',cursor_json=?,upload_id=?,zip_sha256_state_json=?,started_at=coalesce(started_at,?),last_progress_at=?,failure_code=null,lease_token=null,lease_expires_at=null,state_revision=state_revision+1 where id=? and user_id=? and status='queued' and build_phase='staging' and state_revision=? and lease_token=?")
    .bind(canonicalJson({ phase: "readme" }), upload.uploadId, canonicalJson(INITIAL_EXPORT_SHA256_STATE), now, now, row.id, row.user_id, row.state_revision, row.lease_token).run();
  const saved = await loadExport(db, row.user_id, row.id);
  if (!saved || saved.state_revision !== row.state_revision + 1 || saved.status !== "running" || saved.upload_id !== upload.uploadId) {
    await upload.abort().catch(() => undefined);
    throw new ResumableExportError("export_advance_conflict", "Export initialization changed concurrently.");
  }
  return saved;
}

async function uploadLastPart(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, now: string) {
  if (!row.lease_token || !row.upload_id) throw new FatalExportError("export_workflow_invalid", "Export finalization state is invalid.");
  const pending = await loadVerifiedPending(bucket, row);
  if (!pending.byteLength) {
    const count = await db.prepare("select count(*) as value from v2_export_multipart_parts where export_id=?").bind(row.id).first<{ value: number }>();
    if (!count?.value) throw new FatalExportError("export_multipart_receipt_incomplete", "Export has no multipart payload.");
    return persistCursorOnly({ db, bucket, row, cursor: { phase: "finalizing", step: "complete_multipart" }, now });
  }
  if (row.next_part_number > EXPORT_MULTIPART_MAX_PARTS) throw new FatalExportError("export_multipart_part_limit", "R2 multipart part count was exceeded.");
  const sha256 = await sha256Bytes(pending);
  if (sha256 !== row.pending_sha256) throw new FatalExportError("export_pending_corrupt", "Final pending part does not match its receipt.");
  const existing = await db.prepare("select part_number,etag,size_bytes,sha256 from v2_export_multipart_parts where export_id=? and part_number=? limit 1")
    .bind(row.id, row.next_part_number).first<ExportPartReceiptRow>();
  let receipt = existing;
  if (existing && (existing.size_bytes !== pending.byteLength || existing.sha256 !== sha256)) {
    throw new FatalExportError("export_part_receipt_mismatch", "Final multipart retry does not match its receipt.");
  }
  if (!receipt) {
    if (!bucket.resumeMultipartUpload) throw new FatalExportError("export_multipart_unavailable", "R2 multipart resume is unavailable.");
    const uploaded = await bucket.resumeMultipartUpload(bundleObjectKey(row.user_id, row.id), row.upload_id).uploadPart(row.next_part_number, pending);
    if (uploaded.partNumber !== row.next_part_number || !uploaded.etag) throw new FatalExportError("export_part_receipt_invalid", "R2 returned an invalid final part receipt.");
    receipt = { part_number: uploaded.partNumber, etag: uploaded.etag, size_bytes: pending.byteLength, sha256 };
  }
  const statements: D1PreparedStatementBinding[] = [];
  if (!existing) {
    statements.push(db.prepare(`insert into v2_export_multipart_parts (export_id,user_id,part_number,etag,size_bytes,sha256,created_at)
      select ?,?,?,?,?,?,? where exists (
        select 1 from v2_export_jobs j where j.id=? and j.user_id=? and j.status='running' and j.state_revision=? and j.lease_token=?
      )`)
      .bind(row.id, row.user_id, receipt.part_number, receipt.etag, receipt.size_bytes, receipt.sha256, now, row.id, row.user_id, row.state_revision, row.lease_token));
  }
  statements.push(db.prepare("update v2_export_jobs set build_phase='finalizing',cursor_json=?,pending_object_key=null,pending_size_bytes=0,pending_sha256=null,next_part_number=next_part_number+1,lease_token=null,lease_expires_at=null,last_progress_at=?,state_revision=state_revision+1 where id=? and user_id=? and status='running' and state_revision=? and lease_token=?")
    .bind(canonicalJson({ phase: "finalizing", step: "complete_multipart" }), now, row.id, row.user_id, row.state_revision, row.lease_token));
  await db.batch(statements);
  const saved = await loadExport(db, row.user_id, row.id);
  if (!saved || saved.next_part_number < row.next_part_number + 1 || saved.pending_size_bytes !== 0) throw new ResumableExportError("export_advance_conflict", "Final multipart receipt changed concurrently.");
  if (row.pending_object_key && saved.pending_object_key !== row.pending_object_key) await removePendingSegment(db, bucket, row.id, row.pending_object_key);
  return saved;
}

function validateParts(parts: readonly ExportPartReceiptRow[], row: ExportWorkflowRow) {
  if (!parts.length || parts.length > EXPORT_MULTIPART_MAX_PARTS || parts.length !== row.next_part_number - 1) {
    throw new FatalExportError("export_multipart_receipt_incomplete", "Multipart receipt count is invalid.");
  }
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.part_number !== index + 1 || !part.etag || part.size_bytes <= 0 || !/^[0-9a-f]{64}$/.test(part.sha256)) {
      throw new FatalExportError("export_multipart_receipt_incomplete", "Multipart receipts are not contiguous.");
    }
    if (index < parts.length - 1 && part.size_bytes !== EXPORT_MULTIPART_PART_BYTES) {
      throw new FatalExportError("export_multipart_receipt_incomplete", "A non-final multipart part is not exactly 8 MiB.");
    }
    total += part.size_bytes;
  }
  if (total !== row.zip_size_bytes) throw new FatalExportError("export_multipart_receipt_incomplete", "Multipart byte total does not match the ZIP receipt.");
}

async function completeMultipart(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, now: string) {
  if (!row.lease_token || !row.upload_id || row.pending_size_bytes !== 0) throw new FatalExportError("export_workflow_invalid", "Export multipart completion state is invalid.");
  const partsResult = await db.prepare("select part_number,etag,size_bytes,sha256 from v2_export_multipart_parts where export_id=? order by part_number limit 10001")
    .bind(row.id).all<ExportPartReceiptRow>();
  validateParts(partsResult.results, row);
  const key = bundleObjectKey(row.user_id, row.id);
  let object: { size: number; customMetadata?: Record<string, string> } | null = null;
  try {
    if (!bucket.resumeMultipartUpload) throw new FatalExportError("export_multipart_unavailable", "R2 multipart resume is unavailable.");
    object = await bucket.resumeMultipartUpload(key, row.upload_id).complete(partsResult.results.map((part) => ({ partNumber: part.part_number, etag: part.etag })));
  } catch (error) {
    const completed = await bucket.head(key);
    if (!completed) throw error;
    object = completed;
  }
  assertObjectMetadata(object, row, row.zip_size_bytes);
  if (object.customMetadata?.profile !== row.profile) throw new FatalExportError("export_object_receipt_mismatch", "Completed export profile metadata is invalid.");
  return persistCursorOnly({ db, bucket, row, cursor: { phase: "verifying", offset: 0, shaState: INITIAL_EXPORT_SHA256_STATE }, now });
}

function checksumHex(checksum: ArrayBuffer | undefined) {
  return checksum ? bytesToHex(new Uint8Array(checksum)) : null;
}

async function advanceVerification(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "verifying" }>, now: string) {
  if (!row.lease_token || !row.manifest_json) throw new FatalExportError("export_workflow_invalid", "Export verification state is invalid.");
  if (cursor.offset < 0 || cursor.offset > row.zip_size_bytes || cursor.shaState.totalBytes !== cursor.offset) {
    throw new FatalExportError("export_verification_cursor_invalid", "Export verification cursor is invalid.");
  }
  const key = bundleObjectKey(row.user_id, row.id);
  const head = await bucket.head(key);
  if (!head) throw new FatalExportError("export_completed_object_missing", "Completed export object is missing.");
  assertObjectMetadata(head, row, row.zip_size_bytes);
  if (head.customMetadata?.profile !== row.profile) throw new FatalExportError("export_object_receipt_mismatch", "Completed export profile metadata is invalid.");
  const expectedSha256 = digestSerializableSha256(parseShaState(row.zip_sha256_state_json));
  const storedChecksum = checksumHex(head.checksums?.sha256);
  if (storedChecksum && storedChecksum !== expectedSha256) throw new FatalExportError("export_completed_checksum_mismatch", "R2 full-object checksum does not match the ZIP receipt.");
  const length = Math.min(EXPORT_VERIFY_CHUNK_BYTES, row.zip_size_bytes - cursor.offset);
  let nextState = cursor.shaState;
  let nextOffset = cursor.offset;
  if (length) {
    const object = await bucket.get(key, { range: { offset: cursor.offset, length } });
    if (!object) throw new FatalExportError("export_completed_object_missing", "Completed export object disappeared during verification.");
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== length) throw new FatalExportError("export_completed_object_truncated", "Completed export range is truncated.");
    nextState = updateSerializableSha256(cursor.shaState, bytes);
    nextOffset += bytes.byteLength;
  }
  if (nextOffset < row.zip_size_bytes) {
    return persistCursorOnly({ db, bucket, row, cursor: { phase: "verifying", offset: nextOffset, shaState: nextState }, now });
  }
  const actualSha256 = digestSerializableSha256(nextState);
  if (actualSha256 !== expectedSha256) throw new FatalExportError("export_completed_checksum_mismatch", "Completed export bytes do not match the incremental ZIP receipt.");
  const finalHead = await bucket.head(key);
  if (!finalHead) throw new FatalExportError("export_completed_object_missing", "Completed export object disappeared before commit.");
  assertObjectMetadata(finalHead, row, row.zip_size_bytes);
  await assertSourceStable(db, row);
  const expiresAt = new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString();
  await db.prepare("update v2_export_jobs set status='succeeded',build_phase='complete',cursor_json=?,bundle_object_key=?,bundle_sha256=?,bundle_size_bytes=zip_size_bytes,finished_at=?,expires_at=?,failure_code=null,lease_token=null,lease_expires_at=null,last_progress_at=?,state_revision=state_revision+1 where id=? and user_id=? and status='running' and state_revision=? and lease_token=?")
    .bind(canonicalJson({ phase: "complete" }), key, actualSha256, now, expiresAt, now, row.id, row.user_id, row.state_revision, row.lease_token).run();
  const saved = await loadExport(db, row.user_id, row.id);
  if (!saved || saved.status !== "succeeded" || saved.state_revision !== row.state_revision + 1) throw new ResumableExportError("export_advance_conflict", "Verified export completion changed concurrently.");
  return saved;
}

async function cleanupFailedExport(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, cursor: Extract<PackagingCursor, { phase: "failure_cleanup" }>, now: string) {
  if (!row.lease_token) throw new FatalExportError("export_workflow_invalid", "Export cleanup lease is missing.");
  const key = bundleObjectKey(row.user_id, row.id);
  if (row.upload_id && bucket.resumeMultipartUpload) {
    await bucket.resumeMultipartUpload(key, row.upload_id).abort().catch(() => undefined);
  }
  const pendingAttempt = await db.prepare("select object_key from v2_export_pending_segments where export_id=? order by created_at,object_key limit 1")
    .bind(row.id).first<{ object_key: string }>();
  if (pendingAttempt) {
    let removed: boolean;
    if (pendingAttempt.object_key === row.pending_object_key) {
      await removePendingSegment(db, bucket, row.id, pendingAttempt.object_key);
      removed = true;
    } else {
      removed = await removeVisiblePendingSegment(db, bucket, row.id, pendingAttempt.object_key);
    }
    if (!removed) {
      await releaseLease(db, row, now);
      const waiting = await loadExport(db, row.user_id, row.id);
      if (!waiting) throw new ResumableExportError("export_cleanup_conflict", "Export cleanup changed concurrently.");
      return waiting;
    }
    const remaining = await db.prepare("select 1 as value from v2_export_pending_segments where export_id=? limit 1").bind(row.id).first<{ value: number }>();
    if (remaining) {
      await db.prepare("update v2_export_jobs set lease_token=null,lease_expires_at=null,last_progress_at=?,state_revision=state_revision+1 where id=? and user_id=? and status='running' and state_revision=? and lease_token=?")
        .bind(now, row.id, row.user_id, row.state_revision, row.lease_token).run();
      const continued = await loadExport(db, row.user_id, row.id);
      if (!continued) throw new ResumableExportError("export_cleanup_conflict", "Export cleanup changed concurrently.");
      return continued;
    }
  }
  await bucket.delete([...new Set([key, ...(row.pending_object_key ? [row.pending_object_key] : [])])]);
  await db.batch([
    db.prepare("delete from v2_export_multipart_parts where export_id=? and user_id=?").bind(row.id, row.user_id),
    db.prepare("delete from v2_export_files where export_id=? and user_id=?").bind(row.id, row.user_id),
    db.prepare("delete from v2_export_pending_segments where export_id=? and user_id=?").bind(row.id, row.user_id),
    db.prepare("update v2_export_jobs set status='failed',build_phase='complete',cursor_json=?,failure_code=?,finished_at=?,lease_token=null,lease_expires_at=null,last_progress_at=?,upload_id=null,next_part_number=1,pending_object_key=null,pending_size_bytes=0,pending_sha256=null,zip_size_bytes=0,zip_sha256_state_json=null,entry_count=0,bundle_object_key=null,bundle_sha256=null,bundle_size_bytes=null,manifest_json=null,state_revision=state_revision+1 where id=? and user_id=? and status='running' and state_revision=? and lease_token=?")
      .bind(canonicalJson({ phase: "complete" }), cursor.code.slice(0, 100), now, now, row.id, row.user_id, row.state_revision, row.lease_token),
  ]);
  const saved = await loadExport(db, row.user_id, row.id);
  if (!saved || saved.status !== "failed" || saved.state_revision !== row.state_revision + 1) throw new ResumableExportError("export_cleanup_conflict", "Export cleanup changed concurrently.");
  return saved;
}

async function advanceClaimed(db: D1DatabaseBinding, bucket: R2BucketBinding, row: ExportWorkflowRow, now: string) {
  if (row.status === "queued") return initializeMultipart(db, bucket, row, now);
  if (row.status !== "running") throw new FatalExportError("export_workflow_invalid", "Export is not runnable.");
  const cursor = parseCursor(row.cursor_json);
  if (cursor.phase === "failure_cleanup") return cleanupFailedExport(db, bucket, row, cursor, now);
  await assertSourceStable(db, row);
  if (phaseForCursor(cursor) !== row.build_phase) throw new FatalExportError("export_cursor_phase_mismatch", "Export cursor and build phase do not match.");
  switch (cursor.phase) {
    case "readme": return advanceReadme(db, bucket, row, now);
    case "documents": return advanceDocuments(db, bucket, row, cursor, now);
    case "canonical": return advanceCanonical(db, bucket, row, cursor, now);
    case "originals": return advanceOriginals(db, bucket, row, cursor, now);
    case "checksums": return advanceChecksums(db, bucket, row, cursor, now);
    case "manifest": return advanceManifest(db, bucket, row, now);
    case "central_directory": return advanceCentralDirectory(db, bucket, row, cursor, now);
    case "finalizing": return cursor.step === "upload_last_part" ? uploadLastPart(db, bucket, row, now) : completeMultipart(db, bucket, row, now);
    case "verifying": return advanceVerification(db, bucket, row, cursor, now);
    case "complete": throw new FatalExportError("export_workflow_invalid", "Running export has a terminal cursor.");
  }
}

export async function getResumableExportWorkflow(db: D1DatabaseBinding, userId: string, exportId: string) {
  const row = await loadExport(db, userId, exportId);
  if (!row) throw new ResumableExportError("export_not_found", "Export job was not found.");
  return projectExport(db, row);
}

export async function stageResumableExportWorkflow(input: { db: D1DatabaseBinding; userId: string; exportId: string; now?: string }) {
  const now = input.now ?? new Date().toISOString();
  const row = await ensureStaged(input.db, input.userId, input.exportId, now);
  return projectExport(input.db, row);
}

export async function advanceResumableExportWorkflow(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; exportId: string; now?: string }) {
  const now = input.now ?? new Date().toISOString();
  let row = await ensureStaged(input.db, input.userId, input.exportId, now);
  if (row.status === "succeeded" || row.status === "failed") return projectExport(input.db, row);
  if (row.workflow_version !== EXPORT_WORKFLOW_VERSION) throw new ResumableExportError("export_workflow_invalid", "Export workflow version is invalid.");
  const claimed = await claimLease(input.db, row, now);
  if (!claimed) {
    row = await loadExport(input.db, input.userId, input.exportId) ?? row;
    return projectExport(input.db, row);
  }
  try {
    const cleanup = await cleanupOneOrphanPendingSegment(input.db, input.bucket, claimed);
    if (cleanup === "waiting") {
      await releaseLease(input.db, claimed, now);
      const waiting = await loadExport(input.db, input.userId, input.exportId);
      if (!waiting) throw new ResumableExportError("export_cleanup_conflict", "Export pending maintenance changed concurrently.");
      return projectExport(input.db, waiting);
    }
    const advanced = await advanceClaimed(input.db, input.bucket, claimed, now);
    return projectExport(input.db, advanced);
  } catch (error) {
    if (error instanceof FatalExportError) {
      await markFailureCleanup(input.db, claimed, error, now);
      const failed = await loadExport(input.db, input.userId, input.exportId);
      if (!failed) throw error;
      return projectExport(input.db, failed);
    }
    await releaseLease(input.db, claimed, now).catch(() => undefined);
    if (error instanceof ResumableExportError) throw error;
    throw new ResumableExportError("export_retryable_storage_error", "Export storage operation should be retried.");
  }
}
