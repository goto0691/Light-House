import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { advanceResumableExportWorkflow, stageResumableExportWorkflow } from "@/lib/v2/portability/resumable-export-v2";
import { parseStoredZip } from "@/lib/v2/portability/zip-stream-v1";
import { PrivateReplayMemoryR2 } from "../private-replay/memory-r2";
import { byteHash, fail, inside, MAX_INPUT_BYTES } from "./boundary";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
/** Production migration export, including actual processing proposals and original bytes. */
export async function exportLiveProduct(db: D1DatabaseBinding, ownerId: string, output: string) {
  const bucket = new PrivateReplayMemoryR2(), portability = new D1PortabilityRepository(db, ownerId);
  const job = await portability.createExport({ profile: "migration", scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true }, idempotencyKey: "private-live-evaluation:export" });
  let workflow = await stageResumableExportWorkflow({ db, userId: ownerId, exportId: job.id }), advances = 0;
  while (workflow.status !== "succeeded" && workflow.status !== "failed" && advances < 2000) {
    workflow = await advanceResumableExportWorkflow({ db, bucket, userId: ownerId, exportId: job.id }); advances += 1;
  }
  if (workflow.status !== "succeeded" || !workflow.bundleObjectKey || !workflow.bundleSha256 || !workflow.manifest) fail("PRIVATE_LIVE_EXPORT_INVALID");
  const archive = await bucket.get(workflow.bundleObjectKey); if (!archive || archive.size > MAX_ARCHIVE_BYTES) fail("PRIVATE_LIVE_EXPORT_INVALID");
  const bytes = new Uint8Array(await archive.arrayBuffer());
  if (byteHash(bytes) !== `sha256:${workflow.bundleSha256}` || bytes.length !== workflow.bundleSizeBytes) fail("PRIVATE_LIVE_EXPORT_INVALID");
  const entries = parseStoredZip(bytes, { maxFiles: 10_000, maxEntryBytes: MAX_INPUT_BYTES, maxTotalBytes: MAX_ARCHIVE_BYTES });
  const exportRoot = resolve(output, "product-export"); await mkdir(exportRoot, { mode: 0o700 });
  await writeFile(resolve(output, "product-export.zip"), bytes, { flag: "wx", mode: 0o600 });
  for (const entry of entries.values()) {
    const path = resolve(exportRoot, entry.path); if (!inside(exportRoot, path)) fail("PRIVATE_LIVE_PATH_INVALID");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, entry.bytes, { flag: "wx", mode: 0o600 });
  }
  return { exportRoot, exportId: workflow.id, advances, zipSha256: byteHash(bytes), zipBytes: bytes.length };
}
