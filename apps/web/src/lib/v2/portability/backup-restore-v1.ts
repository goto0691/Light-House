import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { BACKUP_DELTA_OPERATION_FIELD, backupBasePath, backupDescriptorsForSchemaVersion, isBackupDeltaTombstone, loadVerifiedBackupChain, readAndValidateBackupMetadata } from "@/lib/v2/portability/backup-snapshot-v1";
import { CANONICAL_TABLES_V1 } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, exportRootHash, LIGHTHOUSE_SCHEMA_VERSION, sha256Hex, type ExportFileManifestV1, type ExportManifestV1 } from "@/lib/v2/portability/portability-contract-v1";
import { validateReferenceClosure, type VerifiedExportBundle } from "@/lib/v2/portability/restore-bundle-v1";

const encoder = new TextEncoder();

function rowKey(primaryKey: readonly string[], row: Record<string, unknown>) {
  return canonicalJson(Object.fromEntries(primaryKey.map((column) => [column, row[column]])));
}

export async function materializeVerifiedBackup(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; snapshotId: string }): Promise<VerifiedExportBundle> {
  const chain = await loadVerifiedBackupChain(input);
  const owner = sha256Hex(input.userId).slice(0, 24);
  const rowMaps = new Map<string, Map<string, Record<string, unknown>>>();
  for (const manifest of chain) {
    for (const descriptor of backupDescriptorsForSchemaVersion(manifest.schemaVersion)) {
      const files = manifest.metadataFiles.filter((item) => backupBasePath(item.path) === descriptor.path).sort((left, right) => left.path.localeCompare(right.path));
      if (!files.length) throw new Error(`backup_restore_metadata_missing:${descriptor.path}`);
      for (const file of files) {
        const key = `users/${owner}/backups/snapshots/${manifest.snapshotId}/metadata/${file.path}`;
        const rows = await readAndValidateBackupMetadata(input.bucket, key, file, manifest.snapshotId, manifest.schemaVersion);
        const mode = manifest.metadataModes[file.path] ?? manifest.metadataModes[descriptor.path];
        const current = mode === "full" ? new Map<string, Record<string, unknown>>() : (rowMaps.get(descriptor.table) ?? new Map<string, Record<string, unknown>>());
        for (const row of rows) {
          if (BACKUP_DELTA_OPERATION_FIELD in row) {
            if (mode !== "delta" || !isBackupDeltaTombstone(row) || descriptor.primaryKey.some((column) => typeof row[column] !== "string" && typeof row[column] !== "number")) {
              throw new Error(`backup_restore_delta_operation_invalid:${descriptor.path}`);
            }
            current.delete(rowKey(descriptor.primaryKey, row));
          } else {
            current.set(rowKey(descriptor.primaryKey, row), row);
          }
        }
        rowMaps.set(descriptor.table, current);
      }
    }
  }
  const rowsByTable = new Map<string, readonly Record<string, unknown>[]>([...CANONICAL_TABLES_V1].map((descriptor) => [descriptor.table, [...(rowMaps.get(descriptor.table)?.values() ?? [])]]));
  validateReferenceClosure(rowsByTable);
  const files: ExportFileManifestV1[] = CANONICAL_TABLES_V1.map((descriptor) => {
    const rows = rowsByTable.get(descriptor.table) ?? [];
    const bytes = encoder.encode(rows.map((row) => canonicalJson(row)).join("\n") + (rows.length ? "\n" : ""));
    return { path: descriptor.path, bytes: bytes.byteLength, mediaType: "application/x-ndjson; charset=utf-8", sha256: sha256Hex(bytes), records: rows.length };
  });
  const latest = chain.at(-1)!;
  const counts = Object.fromEntries(CANONICAL_TABLES_V1.map((descriptor) => [descriptor.table, rowsByTable.get(descriptor.table)?.length ?? 0]));
  const manifest: ExportManifestV1 = {
    format: "lighthouse-export", version: 1, profile: "migration", exportId: `backup:${latest.snapshotId}`, createdAt: latest.createdAt,
    sourceAppVersion: "v2-backup-restore-v1", schemaVersion: LIGHTHOUSE_SCHEMA_VERSION, userTimezone: "UTC",
    scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true },
    counts, files, rootHash: exportRootHash(files), baseSequence: chain[0].baseSequence, endSequence: latest.endSequence,
    warnings: ["restored_from_private_backup", "restricted_records_require_reauthentication"],
  };
  const backupOriginals = new Map<string, { objectKey: string; sha256: string; bytes: number; mediaType: string }>();
  for (const snapshot of chain) for (const blob of snapshot.blobs) for (const attachmentId of blob.attachmentIds) backupOriginals.set(attachmentId, { objectKey: blob.objectKey, sha256: blob.sha256, bytes: blob.bytes, mediaType: blob.mediaType });
  return { archiveSha256: sha256Hex(canonicalJson(chain.map((item) => item.rootHash))), manifest, entries: new Map(), rowsByTable, backupOriginals, backupSourceBucket: input.bucket };
}
