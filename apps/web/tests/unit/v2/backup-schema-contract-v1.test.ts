import { describe, expect, test } from "vitest";

import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import {
  backupDescriptorsForSchemaVersion,
  backupRootHash,
  loadVerifiedBackupChain,
  readAndValidateBackupMetadata,
  validateBackupManifest,
  type BackupManifestV1,
} from "@/lib/v2/portability/backup-snapshot-v1";
import { materializeVerifiedBackup } from "@/lib/v2/portability/backup-restore-v1";
import { canonicalJson, LIGHTHOUSE_SCHEMA_VERSION, sha256Hex, type LighthouseSchemaVersion } from "@/lib/v2/portability/portability-contract-v1";
import { RESUMABLE_BACKUP_CAPACITY } from "@/lib/v2/portability/resumable-backup-v2";

const encoder = new TextEncoder();

type StoredObject = { bytes: Uint8Array; customMetadata?: Record<string, string> };

function manifest(input: {
  schemaVersion: LighthouseSchemaVersion;
  snapshotId: string;
  snapshotKind: "full" | "incremental";
  baseSnapshotId: string | null;
  baseSequence: number;
  endSequence: number;
  omitSchemaVersion?: boolean;
}) {
  const descriptors = backupDescriptorsForSchemaVersion(input.schemaVersion);
  const emptyHash = sha256Hex(new Uint8Array());
  const metadataFiles = descriptors.map((descriptor) => ({
    path: descriptor.path,
    bytes: 0,
    mediaType: "application/x-ndjson; charset=utf-8",
    sha256: emptyHash,
    records: 0,
  }));
  const metadataModes = Object.fromEntries(metadataFiles.map((file) => [file.path, "full" as const]));
  const base = {
    format: "lighthouse-backup" as const,
    version: 1 as const,
    schemaVersion: input.schemaVersion,
    snapshotId: input.snapshotId,
    snapshotKind: input.snapshotKind,
    createdAt: "2026-08-28T00:00:00.000Z",
    baseSnapshotId: input.baseSnapshotId,
    baseSequence: input.baseSequence,
    endSequence: input.endSequence,
    retentionClass: "manual" as const,
    metadataModes,
    metadataFiles,
    blobs: [],
    validator: { valid: true, metadataFiles: metadataFiles.length, metadataRecords: 0, blobCount: 0, blobBytes: 0 },
  };
  const value: Record<string, unknown> = { ...base, rootHash: backupRootHash(base) };
  if (input.omitSchemaVersion) delete value.schemaVersion;
  return value;
}

function fixtures(rawManifests: readonly Record<string, unknown>[], userId = "user-a") {
  const stored = new Map<string, StoredObject>();
  const snapshots = new Map<string, Record<string, unknown>>();
  const owner = sha256Hex(userId).slice(0, 24);
  for (const raw of rawManifests) {
    const normalized = validateBackupManifest(raw);
    const manifestKey = `manifests/${normalized.snapshotId}.json`;
    stored.set(manifestKey, { bytes: encoder.encode(`${canonicalJson(raw)}\n`), customMetadata: { rootHash: normalized.rootHash } });
    snapshots.set(normalized.snapshotId, {
      id: normalized.snapshotId,
      status: "succeeded",
      manifest_object_key: manifestKey,
      manifest_root_hash: normalized.rootHash,
      base_snapshot_id: normalized.baseSnapshotId,
    });
    for (const file of normalized.metadataFiles) {
      stored.set(`users/${owner}/backups/snapshots/${normalized.snapshotId}/metadata/${file.path}`, {
        bytes: new Uint8Array(),
        customMetadata: { sha256: file.sha256 },
      });
    }
  }

  const db = {
    prepare() {
      let values: unknown[] = [];
      const statement: D1PreparedStatementBinding = {
        bind(...next) { values = next; return statement; },
        async first<T>() { return (snapshots.get(String(values[0])) ?? null) as T | null; },
        async all<T>() { return { results: [] as T[] }; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch<T>() { return [] as T[]; },
  } satisfies D1DatabaseBinding;

  const bucket = {
    async get(key: string) {
      const value = stored.get(key);
      if (!value) return null;
      const bytes = value.bytes.slice();
      return {
        key,
        size: bytes.byteLength,
        checksums: {},
        customMetadata: value.customMetadata,
        body: new Blob([bytes]).stream() as ReadableStream<Uint8Array>,
        async arrayBuffer() { return bytes.slice().buffer; },
      };
    },
    async head(key: string) {
      const value = stored.get(key);
      return value ? { key, size: value.bytes.byteLength, checksums: {}, customMetadata: value.customMetadata } : null;
    },
    async put() { throw new Error("not used"); },
    async delete() { throw new Error("not used"); },
  } satisfies R2BucketBinding;

  return { db, bucket };
}

describe("backup schema-version contract", () => {
  test("keeps a measured v2 fragment manifest above 16k rows inside the explicit 8 MiB capacity", () => {
    const descriptors = backupDescriptorsForSchemaVersion(LIGHTHOUSE_SCHEMA_VERSION);
    const emptyHash = sha256Hex(new Uint8Array());
    const metadataFiles = descriptors.map((descriptor) => ({ path: `${descriptor.path}.parts/00000000.jsonl`, bytes: 0, mediaType: "application/x-ndjson; charset=utf-8", sha256: emptyHash, records: RESUMABLE_BACKUP_CAPACITY.rowsPerMetadataFile }));
    for (let part = 1; metadataFiles.length < RESUMABLE_BACKUP_CAPACITY.metadataFiles; part += 1) metadataFiles.push({ path: `${descriptors[0].path}.parts/${String(part).padStart(8, "0")}.jsonl`, bytes: 0, mediaType: "application/x-ndjson; charset=utf-8", sha256: emptyHash, records: RESUMABLE_BACKUP_CAPACITY.rowsPerMetadataFile });
    const metadataModes = Object.fromEntries(metadataFiles.map((file) => [file.path, file.path.endsWith("00000000.jsonl") ? "full" as const : "delta" as const]));
    const base = { format: "lighthouse-backup" as const, version: 2 as const, schemaVersion: LIGHTHOUSE_SCHEMA_VERSION, snapshotId: "capacity", snapshotKind: "full" as const, createdAt: "2026-08-28T00:00:00.000Z", baseSnapshotId: null, baseSequence: 0, endSequence: 0, retentionClass: "manual" as const, metadataModes, metadataFiles, blobs: [], validator: { valid: true, metadataFiles: metadataFiles.length, metadataRecords: metadataFiles.length * RESUMABLE_BACKUP_CAPACITY.rowsPerMetadataFile, blobCount: 0, blobBytes: 0 } };
    const value = { ...base, rootHash: backupRootHash(base) };
    expect(value.validator.metadataRecords).toBeGreaterThan(16_000);
    expect(metadataFiles.length).toBeLessThanOrEqual(RESUMABLE_BACKUP_CAPACITY.metadataFiles);
    expect(encoder.encode(`${canonicalJson(value)}\n`).byteLength).toBeLessThanOrEqual(RESUMABLE_BACKUP_CAPACITY.manifestBytes);
    expect(validateBackupManifest(value).version).toBe(2);
  });

  test("requires every v2-018 metadata path and binds the schema version into the root hash", () => {
    const current = manifest({ schemaVersion: "v2-018", snapshotId: "current", snapshotKind: "full", baseSnapshotId: null, baseSequence: 0, endSequence: 0 });
    expect(validateBackupManifest(current).schemaVersion).toBe("v2-018");

    const files = (current.metadataFiles as BackupManifestV1["metadataFiles"]).filter((file) => file.path !== "migration/legacy-migration-batches.jsonl");
    const modes = { ...(current.metadataModes as BackupManifestV1["metadataModes"]) };
    delete modes["migration/legacy-migration-batches.jsonl"];
    expect(() => validateBackupManifest({ ...current, metadataFiles: files, metadataModes: modes })).toThrow("backup_chain_metadata_contract_invalid");

    expect(current.rootHash).not.toBe(backupRootHash({
      ...(current as unknown as BackupManifestV1),
      schemaVersion: "v2-017",
    }));
  });

  test("normalizes a missing legacy version to v2-017 and accepts a v2-017 to v2-018 chain", async () => {
    const legacy = manifest({ schemaVersion: "v2-017", snapshotId: "legacy", snapshotKind: "full", baseSnapshotId: null, baseSequence: 0, endSequence: 4, omitSchemaVersion: true });
    const current = manifest({ schemaVersion: "v2-018", snapshotId: "current", snapshotKind: "incremental", baseSnapshotId: "legacy", baseSequence: 4, endSequence: 7 });
    expect(validateBackupManifest(legacy).schemaVersion).toBe("v2-017");

    const { db, bucket } = fixtures([legacy, current]);
    await expect(loadVerifiedBackupChain({ db, bucket, userId: "user-a", snapshotId: "current" })).resolves.toMatchObject([
      { snapshotId: "legacy", schemaVersion: "v2-017" },
      { snapshotId: "current", schemaVersion: "v2-018" },
    ]);
    await expect(materializeVerifiedBackup({ db, bucket, userId: "user-a", snapshotId: "current" })).resolves.toMatchObject({
      manifest: { schemaVersion: LIGHTHOUSE_SCHEMA_VERSION, baseSequence: 0, endSequence: 7 },
    });
  });

  test("rejects metadata rows whose schema does not match their manifest", async () => {
    const bytes = encoder.encode(`${canonicalJson({ id: "row", schema_version: "v2-017", user_scope_export_id: "snapshot" })}\n`);
    const bucket = {
      async get(key: string) {
        return { key, size: bytes.byteLength, checksums: {}, customMetadata: { sha256: sha256Hex(bytes) }, body: new Blob([bytes]).stream() as ReadableStream<Uint8Array>, async arrayBuffer() { return bytes.slice().buffer; } };
      },
      async head() { return null; },
      async put() { throw new Error("not used"); },
      async delete() { throw new Error("not used"); },
    } satisfies R2BucketBinding;
    await expect(readAndValidateBackupMetadata(bucket, "metadata.jsonl", {
      path: "metadata.jsonl", bytes: bytes.byteLength, mediaType: "application/x-ndjson", sha256: sha256Hex(bytes), records: 1,
    }, "snapshot", "v2-018")).rejects.toThrow("backup_metadata_schema_invalid");
  });
});
