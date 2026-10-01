"use client";

import { SHA256 } from "@noble/hashes/sha2";
import { CheckCircle2, Download, FileArchive, LockKeyhole, RotateCcw, ShieldAlert, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

import { LegacyMigrationPanel } from "@/components/v2/legacy-migration-panel";
import {
  EXPORT_ADVANCE_CALLS_PER_BATCH,
  EXPORT_MAX_BATCHES_PER_USER_ACTION,
  exportContinuationMadeProgress,
} from "@/lib/v2/portability/export-continuation-policy";

type ExportJob = { id: string; profile: "portable" | "migration"; scope?: { privacyLevels: readonly string[] }; status: string; createdAt: string; bundleSizeBytes: number | null; failureCode: string | null; stateRevision?: number; buildPhase?: string; progress?: { entriesComplete: number; partsUploaded: number; bytesPacked: number; pendingBytes: number } };
type BackupSnapshot = { id: string; snapshot_kind: "full" | "incremental"; status: string; end_sequence: number; referenced_blob_count: number; referenced_blob_bytes: number; retention_class: "manual" | "daily" | "weekly" | "monthly"; pinned: number | boolean; created_at: string; verified_at: string | null; build_phase?: string; state_revision?: number; failure_code?: string | null };
type BackupBuildWorkflow = { snapshotId: string; snapshotKind: "full" | "incremental"; status: string; phase: string; stateRevision: number; endSequence: number; failureCode: string | null; progress: { tablesComplete: number; tablesTotal: number; metadataFilesVerified: number; metadataFilesTotal: number; metadataRecords: number; blobsComplete: number; blobsTotal: number; blobBytesCopied: number; blobBytesTotal: number } };
type DryRun = { archiveSha256: string; manifestRootHash: string; dryRunHash: string; counts: { create: number; reuse: number; fork: number; conflict: number; invalid: number }; warnings: string[]; tables: { table: string; rows: number; create: number; reuse: number; fork: number; conflict: number }[] };
type RestoreManifest = { profile: string; scope: { privacyLevels: string[] }; counts: Record<string, number> };
type RestoreWorkflow = {
  batchId: string;
  status: string;
  stateRevision: number;
  progress: {
    filesComplete: number;
    filesTotal: number;
    rowsMaterialized: number;
    rowsPlanned: number;
    rowsApplied: number;
    rollbackConflicts: number;
  };
  dryRun?: DryRun | null;
  manifest?: RestoreManifest | null;
};
type RestoreUploadWorkflow = {
  uploadId: string;
  status: string;
  phase: string;
  stateRevision: number;
  fileName: string;
  sizeBytes: number;
  archiveSha256: string;
  partSizeBytes: number;
  expectedParts: number;
  receivedParts: number;
  uploadedBytes: number;
  hashVerifiedBytes: number;
  nextMissingPart: number | null;
  restoreId: string | null;
  failureCode: string | null;
  expiresAt: string;
};
const MAX_RESTORE_ADVANCE_CALLS = 10;
const MAX_BACKUP_ADVANCE_CALLS = 10;
const MAX_EXPORT_ADVANCE_CALLS = EXPORT_ADVANCE_CALLS_PER_BATCH;
const MAX_UPLOAD_PARTS_PER_ACTION = 12;
const MAX_UPLOAD_ADVANCE_CALLS = 20;
const MAX_DIRECT_ARCHIVE_BYTES = 90 * 1024 * 1024;
const MAX_RESUMABLE_ARCHIVE_BYTES = 0xffff_ffff;
const ARCHIVE_HASH_WINDOW_BYTES = 8 * 1024 * 1024;
const ACTIVE_RESTORE_STORAGE_KEY = "light-house:v2:active-restore";
const ACTIVE_RESTORE_UPLOAD_STORAGE_KEY = "light-house:v2:active-restore-upload";
const RESTORE_PROGRESS_STATES = new Set([
  "backup_indexing", "indexing", "manifesting", "verifying", "materializing", "planning", "rewriting",
  "applying", "validating", "cleaning", "rollback_requested", "rolling_back", "failure_cleaning",
]);
const RESTORE_TERMINAL_STATES = new Set(["succeeded", "failed", "rolled_back", "rollback_conflicted"]);

function exportJobRequiresRestrictedGrant(job: ExportJob) {
  return job.profile === "migration" || Boolean(job.scope?.privacyLevels.includes("restricted"));
}

function restoreStatusLabel(status: string) {
  return ({
    backup_indexing: "백업 체인을 읽는 중",
    indexing: "ZIP 구조를 읽는 중",
    manifesting: "manifest를 확인하는 중",
    verifying: "checksum을 검증하는 중",
    materializing: "복원 원본을 준비하는 중",
    planning: "변경 계획을 계산하는 중",
    rewriting: "충돌 없는 ID 계획을 만드는 중",
    awaiting_approval: "승인 대기",
    applying: "기록을 복원하는 중",
    validating: "복원 결과를 검증하는 중",
    cleaning: "임시 복원 파일을 정리하는 중",
    succeeded: "복원 완료",
    failed: "복원 중단",
    rollback_requested: "되돌리기 준비 중",
    rolling_back: "안전하게 되돌리는 중",
    failure_cleaning: "중단된 복원의 임시 파일을 정리하는 중",
    rolled_back: "되돌리기 완료",
    rollback_conflicted: "되돌리기 충돌",
  } as Record<string, string>)[status] ?? status;
}

function backupBuildStatusLabel(phase: string) {
  return ({ metadata: "메타데이터를 나누어 저장하는 중", metadata_publishing: "검증된 메타데이터를 확정하는 중", metadata_verifying: "메타데이터 해시를 확인하는 중", blob_scanning: "원본 파일 목록을 확인하는 중", blob_copying: "원본 파일을 나누어 복사하는 중", manifesting: "백업 manifest를 만드는 중", manifest_publishing: "검증된 manifest를 확정하는 중", manifest_verifying: "최종 manifest를 검증하는 중", failure_cleaning: "중단된 백업의 임시 파일을 정리하는 중", complete: "백업 완료" } as Record<string, string>)[phase] ?? phase;
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(file: File, onProgress?: (bytes: number) => void) {
  const hash = new SHA256();
  for (let offset = 0; offset < file.size; offset += ARCHIVE_HASH_WINDOW_BYTES) {
    const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + ARCHIVE_HASH_WINDOW_BYTES)).arrayBuffer());
    hash.update(bytes);
    onProgress?.(Math.min(file.size, offset + bytes.byteLength));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return bytesToHex(hash.digest());
}

async function blobSha256Hex(blob: Blob) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())));
}

function restoreUploadStatusLabel(upload: RestoreUploadWorkflow) {
  if (upload.status === "uploading") return "ZIP 부품을 안전하게 올리는 중";
  if (upload.phase === "hashing") return "전체 ZIP checksum을 검증하는 중";
  if (upload.phase === "creating_multipart") return "R2 조립 공간을 준비하는 중";
  if (upload.phase === "uploading_parts") return "검증된 부품을 ZIP으로 조립하는 중";
  if (upload.phase === "completing") return "R2 multipart를 확정하는 중";
  if (upload.phase === "staging") return "복원 작업에 안전하게 넘기는 중";
  if (upload.status === "cleaning") return "임시 업로드 부품을 정리하는 중";
  if (upload.status === "aborting") return "중단된 업로드를 정리하는 중";
  if (upload.status === "staged") return "대용량 ZIP 업로드 완료";
  if (upload.status === "expired") return "업로드 기한 만료";
  if (upload.status === "aborted") return "업로드 취소 완료";
  if (upload.status === "failed") return "업로드 검증 실패";
  return upload.status;
}

async function json(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string }; [key: string]: unknown };
  if (!response.ok) throw new Error(body.error?.message || "요청을 완료하지 못했습니다.");
  return body;
}

export function DataPortabilityClient({ initialJobs, initialSnapshots }: { initialJobs: ExportJob[]; initialSnapshots: BackupSnapshot[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [profile, setProfile] = useState<"portable" | "migration">("portable");
  const [sensitive, setSensitive] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [password, setPassword] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [manifest, setManifest] = useState<RestoreManifest | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [approved, setApproved] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ batchId: string; status: string; stateRevision: number } | null>(null);
  const [restoreWorkflow, setRestoreWorkflow] = useState<RestoreWorkflow | null>(null);
  const [restoreIdempotencyKey, setRestoreIdempotencyKey] = useState("");
  const [restoreUpload, setRestoreUpload] = useState<RestoreUploadWorkflow | null>(null);
  const [restoreUploadHashBytes, setRestoreUploadHashBytes] = useState(0);
  const [restoreUploadIdempotencyKey, setRestoreUploadIdempotencyKey] = useState("");
  const [activeRestoreKind, setActiveRestoreKind] = useState<"archive" | "backup" | null>(null);
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [backupDryRun, setBackupDryRun] = useState<{ snapshotId: string; restoreId: string; stateRevision: number; value: DryRun } | null>(null);
  const [backupRestoreKey, setBackupRestoreKey] = useState<{ snapshotId: string; value: string } | null>(null);
  const [backupApproved, setBackupApproved] = useState(false);

  function applyRestoreView(view: RestoreWorkflow, kind: "archive" | "backup", snapshotId?: string, idempotencyKey?: string) {
    setRestoreWorkflow(view);
    setActiveRestoreKind(kind);
    if (view.dryRun) {
      if (kind === "backup" && snapshotId) setBackupDryRun({ snapshotId, restoreId: view.batchId, stateRevision: view.stateRevision, value: view.dryRun });
      else setDryRun(view.dryRun);
    }
    if (view.manifest) setManifest(view.manifest);
    if (view.status === "succeeded" || view.status === "rolled_back") setRestoreResult({ batchId: view.batchId, status: view.status, stateRevision: view.stateRevision });
    if (view.status === "failed") {
      const message = "복원 작업이 안전하게 중단되었습니다. 같은 작업 ID로 상태를 확인할 수 있습니다.";
      if (kind === "backup") setBackupError(message); else setRestoreError(message);
    }
    if (view.status === "rollback_conflicted") {
      setRestoreError("복원 이후 변경된 기록이 있어 자동 되돌리기를 중단했습니다. 충돌한 기록은 보존되어 있습니다.");
    }
    localStorage.setItem(ACTIVE_RESTORE_STORAGE_KEY, JSON.stringify({
      batchId: view.batchId,
      kind,
      snapshotId: snapshotId ?? null,
      idempotencyKey: idempotencyKey ?? (kind === "archive" ? restoreIdempotencyKey : backupRestoreKey?.value) ?? null,
    }));
  }

  async function advanceInBoundedBatch(initial: RestoreWorkflow, maxCalls = MAX_RESTORE_ADVANCE_CALLS) {
    let current = initial;
    for (let call = 0; call < maxCalls && RESTORE_PROGRESS_STATES.has(current.status); call += 1) {
      const previousStatus = current.status;
      const previousRevision = current.stateRevision;
      const body = await json(await fetch(`/api/v2/restores/${current.batchId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })) as { restore: RestoreWorkflow };
      current = body.restore;
      if (current.status === "awaiting_approval" || RESTORE_TERMINAL_STATES.has(current.status)) break;
      if (current.status === previousStatus && current.stateRevision === previousRevision) break;
    }
    return current;
  }

  function rememberRestoreUpload(upload: RestoreUploadWorkflow, idempotencyKey = restoreUploadIdempotencyKey) {
    setRestoreUpload(upload);
    if (idempotencyKey) setRestoreUploadIdempotencyKey(idempotencyKey);
    localStorage.setItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY, JSON.stringify({
      uploadId: upload.uploadId,
      idempotencyKey,
      fileName: upload.fileName,
      sizeBytes: upload.sizeBytes,
      archiveSha256: upload.archiveSha256,
    }));
  }

  async function advanceUploadInBoundedBatch(initial: RestoreUploadWorkflow, maxCalls = MAX_UPLOAD_ADVANCE_CALLS) {
    let current = initial;
    const active = new Set(["verifying", "assembling", "cleaning", "aborting"]);
    for (let call = 0; call < maxCalls && active.has(current.status); call += 1) {
      const previousRevision = current.stateRevision;
      const body = await json(await fetch(`/api/v2/restores/uploads/${current.uploadId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.stateRevision }),
      })) as { upload: RestoreUploadWorkflow };
      current = body.upload;
      rememberRestoreUpload(current);
      if (!active.has(current.status) || current.stateRevision === previousRevision) break;
    }
    return current;
  }

  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_RESTORE_STORAGE_KEY);
    if (!saved) return;
    let parsed: { batchId?: unknown; kind?: unknown; snapshotId?: unknown; idempotencyKey?: unknown };
    try {
      parsed = JSON.parse(saved) as typeof parsed;
    } catch {
      localStorage.removeItem(ACTIVE_RESTORE_STORAGE_KEY);
      return;
    }
    if (typeof parsed.batchId !== "string" || (parsed.kind !== "archive" && parsed.kind !== "backup")) {
      localStorage.removeItem(ACTIVE_RESTORE_STORAGE_KEY);
      return;
    }
    const savedBatchId = parsed.batchId;
    const savedKind = parsed.kind;
    const savedSnapshotId = typeof parsed.snapshotId === "string" ? parsed.snapshotId : undefined;
    const savedIdempotencyKey = typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined;
    let active = true;
    void (async () => {
      try {
        const body = await json(await fetch(`/api/v2/restores/${savedBatchId}`, { headers: { "Cache-Control": "no-store" } })) as { restore: RestoreWorkflow };
        if (!active) return;
        setRestoreWorkflow(body.restore);
        setActiveRestoreKind(savedKind);
        if (savedIdempotencyKey) {
          if (savedKind === "archive") setRestoreIdempotencyKey(savedIdempotencyKey);
          else if (savedSnapshotId) setBackupRestoreKey({ snapshotId: savedSnapshotId, value: savedIdempotencyKey });
        }
        if (body.restore.dryRun) {
          if (savedKind === "backup" && savedSnapshotId) setBackupDryRun({ snapshotId: savedSnapshotId, restoreId: body.restore.batchId, stateRevision: body.restore.stateRevision, value: body.restore.dryRun });
          else setDryRun(body.restore.dryRun);
        }
        if (body.restore.manifest) setManifest(body.restore.manifest);
        if (body.restore.status === "succeeded" || body.restore.status === "rolled_back") setRestoreResult({ batchId: body.restore.batchId, status: body.restore.status, stateRevision: body.restore.stateRevision });
      } catch { /* Keep the persisted restore id for a later retry after transient failures. */ }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY);
    if (!saved) return;
    let parsed: { uploadId?: unknown; idempotencyKey?: unknown };
    try { parsed = JSON.parse(saved) as typeof parsed; }
    catch { localStorage.removeItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY); return; }
    if (typeof parsed.uploadId !== "string") { localStorage.removeItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY); return; }
    const uploadId = parsed.uploadId;
    const idempotencyKey = typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : "";
    let active = true;
    void (async () => {
      try {
        const body = await json(await fetch(`/api/v2/restores/uploads/${uploadId}`, { headers: { "Cache-Control": "no-store" } })) as { upload: RestoreUploadWorkflow };
        if (!active) return;
        setRestoreUpload(body.upload);
        setRestoreUploadIdempotencyKey(idempotencyKey);
      } catch { /* A recent reauthentication or the same selected file can resume this later. */ }
    })();
    return () => { active = false; };
  }, []);

  async function unlockRestricted() {
    if (!password) throw new Error("현재 계정의 비밀번호를 입력해주세요.");
    await json(await fetch("/api/v2/auth/restricted-grants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }));
  }

  async function startExport() {
    setExportBusy(true); setExportError("");
    try {
      if (profile === "migration" || restricted) await unlockRestricted();
      const privacyLevels = profile === "migration"
        ? ["normal", "sensitive", "restricted"]
        : ["normal", ...(sensitive ? ["sensitive"] : []), ...(restricted ? ["restricted"] : [])];
      const created = await json(await fetch("/api/v2/exports", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ profile, scope: { objects: "all", privacyLevels, includeTrash: profile === "migration", includeHistory: profile === "migration", includeOriginals: true } }),
      })) as { job: ExportJob };
      setJobs((current) => [created.job, ...current.filter((job) => job.id !== created.job.id)]);
      await advanceExportForUserAction(created.job);
    } catch (error) { setExportError(error instanceof Error ? error.message : "내보내지 못했습니다."); }
    finally { setExportBusy(false); }
  }

  async function advanceExportInBoundedBatch(initial: ExportJob, maxCalls = MAX_EXPORT_ADVANCE_CALLS) {
    let current = initial;
    let calls = 0;
    let stalled = false;
    for (let call = 0; call < maxCalls && (current.status === "queued" || current.status === "running"); call += 1) {
      const previous = current;
      const body = await json(await fetch(`/api/v2/exports/${current.id}/advance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })) as { job: ExportJob };
      const next = body.job;
      calls += 1;
      setJobs((jobs) => [next, ...jobs.filter((job) => job.id !== next.id)]);
      current = next;
      if (current.status !== "queued" && current.status !== "running") break;
      if (!exportContinuationMadeProgress(previous, current)) { stalled = true; break; }
    }
    return { current, calls, stalled };
  }

  async function advanceExportForUserAction(initial: ExportJob) {
    let current = initial;
    for (let batch = 0; batch < EXPORT_MAX_BATCHES_PER_USER_ACTION && (current.status === "queued" || current.status === "running"); batch += 1) {
      const result = await advanceExportInBoundedBatch(current);
      current = result.current;
      if (result.stalled || result.calls < MAX_EXPORT_ADVANCE_CALLS || (current.status !== "queued" && current.status !== "running")) break;
      if (batch + 1 < EXPORT_MAX_BATCHES_PER_USER_ACTION) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return current;
  }

  async function continueExport(exportId: string) {
    setExportBusy(true); setExportError("");
    try {
      const known = jobs.find((job) => job.id === exportId);
      if (known && exportJobRequiresRestrictedGrant(known)) await unlockRestricted();
      const loaded = await json(await fetch(`/api/v2/exports/${exportId}`, { headers: { "Cache-Control": "no-store" } })) as { job: ExportJob };
      await advanceExportForUserAction(loaded.job);
    } catch (error) { setExportError(error instanceof Error ? error.message : "내보내기를 계속하지 못했습니다."); }
    finally { setExportBusy(false); }
  }

  async function downloadExport(job: ExportJob) {
    setExportBusy(true); setExportError("");
    try {
      if (exportJobRequiresRestrictedGrant(job)) await unlockRestricted();
      const response = await fetch(`/api/v2/exports/${job.id}/download`);
      if (!response.ok) await json(response);
      const archive = await response.blob();
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lighthouse-${job.profile}-${job.id}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { setExportError(error instanceof Error ? error.message : "내보내기를 다운로드하지 못했습니다."); }
    finally { setExportBusy(false); }
  }

  async function handoffStagedUpload(upload: RestoreUploadWorkflow, idempotencyKey: string) {
    if (upload.status !== "staged" || !upload.restoreId) return false;
    const loaded = await json(await fetch(`/api/v2/restores/${upload.restoreId}`, { headers: { "Cache-Control": "no-store" } })) as { restore: RestoreWorkflow };
    const current = await advanceInBoundedBatch(loaded.restore);
    localStorage.removeItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY);
    setRestoreUpload(upload);
    applyRestoreView(current, "archive", undefined, idempotencyKey);
    return true;
  }

  async function resumeLargeArchiveUpload(file: File) {
    let current = restoreUpload;
    let idempotencyKey = restoreUploadIdempotencyKey;
    let archiveSha256 = current && current.fileName === file.name && current.sizeBytes === file.size
      ? current.archiveSha256
      : "";
    if (!archiveSha256) {
      setRestoreUploadHashBytes(0);
      archiveSha256 = await sha256Hex(file, setRestoreUploadHashBytes);
      setRestoreUploadHashBytes(file.size);
    }
    if (!current || current.fileName !== file.name || current.sizeBytes !== file.size || current.archiveSha256 !== archiveSha256 || ["aborted", "expired", "failed"].includes(current.status)) {
      idempotencyKey = crypto.randomUUID();
      setRestoreUploadIdempotencyKey(idempotencyKey);
      const created = await json(await fetch("/api/v2/restores/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, archiveSha256 }),
      })) as { upload: RestoreUploadWorkflow };
      current = created.upload;
      rememberRestoreUpload(current, idempotencyKey);
    }
    if (await handoffStagedUpload(current, idempotencyKey)) return;
    let partsSent = 0;
    while (current.status === "uploading" && current.nextMissingPart !== null && partsSent < MAX_UPLOAD_PARTS_PER_ACTION) {
      const partNumber = current.nextMissingPart;
      const offset = (partNumber - 1) * current.partSizeBytes;
      const part = file.slice(offset, Math.min(file.size, offset + current.partSizeBytes));
      const partSha256 = await blobSha256Hex(part);
      const body = await json(await fetch(`/api/v2/restores/uploads/${current.uploadId}/parts/${partNumber}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Lighthouse-Part-Sha256": partSha256,
          "X-Lighthouse-Upload-Revision": String(current.stateRevision),
        },
        body: part,
      })) as { upload: RestoreUploadWorkflow };
      current = body.upload;
      rememberRestoreUpload(current, idempotencyKey);
      partsSent += 1;
    }
    if (current.status === "uploading" && current.nextMissingPart === null) {
      const completed = await json(await fetch(`/api/v2/restores/uploads/${current.uploadId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.stateRevision }),
      })) as { upload: RestoreUploadWorkflow };
      current = completed.upload;
      rememberRestoreUpload(current, idempotencyKey);
    }
    if (["verifying", "assembling", "cleaning", "aborting"].includes(current.status)) {
      current = await advanceUploadInBoundedBatch(current);
    }
    if (await handoffStagedUpload(current, idempotencyKey)) return;
    if (current.status === "failed") throw new Error(`대용량 ZIP 검증을 중단했습니다${current.failureCode ? ` (${current.failureCode})` : ""}.`);
  }

  async function verify() {
    if (!archive) return;
    setRestoreBusy(true); setRestoreError(""); setDryRun(null); setApproved(false); setRestoreResult(null); setActiveRestoreKind("archive");
    try {
      if (archive.size <= 0 || archive.size > MAX_RESUMABLE_ARCHIVE_BYTES) throw new Error("ZIP은 4 GiB 미만이어야 합니다. 현재 복원기는 ZIP64를 지원하지 않습니다.");
      await unlockRestricted();
      if (archive.size > MAX_DIRECT_ARCHIVE_BYTES) {
        await resumeLargeArchiveUpload(archive);
        return;
      }
      const idempotencyKey = restoreIdempotencyKey || crypto.randomUUID();
      setRestoreIdempotencyKey(idempotencyKey);
      const archiveSha256 = await sha256Hex(archive);
      const staged = await json(await fetch("/api/v2/restores/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "Idempotency-Key": idempotencyKey,
          "X-Lighthouse-Archive-Sha256": archiveSha256,
          "X-Lighthouse-Archive-Name": encodeURIComponent(archive.name),
        },
        body: archive,
      })) as { restore: RestoreWorkflow };
      const current = await advanceInBoundedBatch(staged.restore, MAX_RESTORE_ADVANCE_CALLS - 1);
      applyRestoreView(current, "archive", undefined, idempotencyKey);
    } catch (error) { setRestoreError(error instanceof Error ? error.message : "검증하지 못했습니다."); }
    finally { setRestoreBusy(false); }
  }

  async function abortLargeUpload() {
    if (!restoreUpload || ["staged", "aborted", "expired", "failed"].includes(restoreUpload.status)) return;
    setRestoreBusy(true); setRestoreError("");
    try {
      await unlockRestricted();
      const body = await json(await fetch(`/api/v2/restores/uploads/${restoreUpload.uploadId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: restoreUpload.stateRevision }),
      })) as { upload: RestoreUploadWorkflow };
      const current = await advanceUploadInBoundedBatch(body.upload);
      rememberRestoreUpload(current);
      if (["aborted", "expired", "failed"].includes(current.status)) localStorage.removeItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY);
    } catch (error) { setRestoreError(error instanceof Error ? error.message : "대용량 업로드를 중단하지 못했습니다."); }
    finally { setRestoreBusy(false); }
  }

  async function restore() {
    if (!restoreWorkflow || !dryRun || !approved) return;
    setRestoreBusy(true); setRestoreError("");
    try {
      await unlockRestricted();
      const approvedView = await json(await fetch("/api/v2/restores/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreId: restoreWorkflow.batchId, approved: true, dryRunHash: dryRun.dryRunHash, expectedRevision: restoreWorkflow.stateRevision }),
      })) as { restore: RestoreWorkflow };
      const current = await advanceInBoundedBatch(approvedView.restore, MAX_RESTORE_ADVANCE_CALLS - 1);
      applyRestoreView(current, "archive", undefined, restoreIdempotencyKey);
    } catch (error) { setRestoreError(error instanceof Error ? error.message : "가져오지 못했습니다."); }
    finally { setRestoreBusy(false); }
  }

  async function continueRestore(kind: "archive" | "backup") {
    if (!restoreWorkflow) return;
    if (kind === "archive") { setRestoreBusy(true); setRestoreError(""); }
    else { setBackupBusy(true); setBackupError(""); }
    try {
      await unlockRestricted();
      const current = await advanceInBoundedBatch(restoreWorkflow);
      applyRestoreView(current, kind, kind === "backup" ? backupDryRun?.snapshotId ?? backupRestoreKey?.snapshotId : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "복원 작업을 계속하지 못했습니다.";
      if (kind === "archive") setRestoreError(message); else setBackupError(message);
    } finally {
      if (kind === "archive") setRestoreBusy(false); else setBackupBusy(false);
    }
  }

  async function rollback() {
    if (!restoreResult) return;
    setRestoreBusy(true); setRestoreError("");
    try {
      await unlockRestricted();
      const body = await json(await fetch(`/api/v2/restores/${restoreResult.batchId}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: restoreResult.stateRevision }) })) as { restore: RestoreWorkflow };
      const current = await advanceInBoundedBatch(body.restore, MAX_RESTORE_ADVANCE_CALLS - 1);
      applyRestoreView(current, activeRestoreKind ?? "archive", activeRestoreKind === "backup" ? backupDryRun?.snapshotId ?? backupRestoreKey?.snapshotId : undefined);
    } catch (error) { setRestoreError(error instanceof Error ? error.message : "되돌리지 못했습니다."); }
    finally { setRestoreBusy(false); }
  }

  async function backup(kind: "full" | "incremental") {
    setBackupBusy(true); setBackupError("");
    try {
      await unlockRestricted();
      const body = await json(await fetch("/api/v2/backups", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ kind }) })) as { snapshot: BackupBuildWorkflow };
      await advanceBackupBuild(body.snapshot, MAX_BACKUP_ADVANCE_CALLS - 1);
      await refreshSnapshots();
    } catch (error) { setBackupError(error instanceof Error ? error.message : "백업하지 못했습니다."); }
    finally { setBackupBusy(false); }
  }

  async function refreshSnapshots() {
    const body = await json(await fetch("/api/v2/backups", { headers: { "Cache-Control": "no-store" } })) as { snapshots: BackupSnapshot[] };
    setSnapshots(body.snapshots);
  }

  async function advanceBackupBuild(initial: BackupBuildWorkflow, maxCalls = MAX_BACKUP_ADVANCE_CALLS) {
    let current = initial;
    for (let call = 0; call < maxCalls && current.status === "building"; call += 1) {
      const previousRevision = current.stateRevision;
      const body = await json(await fetch(`/api/v2/backups/${current.snapshotId}/advance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })) as { snapshot: BackupBuildWorkflow };
      current = body.snapshot;
      if (current.status !== "building" || current.stateRevision === previousRevision) break;
    }
    return current;
  }

  async function continueBackupBuild(snapshotId: string) {
    setBackupBusy(true); setBackupError("");
    try {
      await unlockRestricted();
      const loaded = await json(await fetch(`/api/v2/backups/${snapshotId}`, { headers: { "Cache-Control": "no-store" } })) as { snapshot: BackupBuildWorkflow };
      await advanceBackupBuild(loaded.snapshot);
      await refreshSnapshots();
    } catch (error) { setBackupError(error instanceof Error ? error.message : "백업을 계속하지 못했습니다."); }
    finally { setBackupBusy(false); }
  }

  async function inspectBackup(snapshotId: string) {
    setBackupBusy(true); setBackupError(""); setBackupApproved(false); setBackupDryRun(null); setActiveRestoreKind("backup"); setRestoreResult(null);
    try {
      await unlockRestricted();
      const idempotencyKey = backupRestoreKey?.snapshotId === snapshotId ? backupRestoreKey.value : crypto.randomUUID();
      setBackupRestoreKey({ snapshotId, value: idempotencyKey });
      const staged = await json(await fetch(`/api/v2/backups/${snapshotId}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: "{}",
      })) as { restore: RestoreWorkflow };
      const current = await advanceInBoundedBatch(staged.restore, MAX_RESTORE_ADVANCE_CALLS - 1);
      applyRestoreView(current, "backup", snapshotId, idempotencyKey);
    } catch (error) { setBackupError(error instanceof Error ? error.message : "백업을 검사하지 못했습니다."); }
    finally { setBackupBusy(false); }
  }

  async function restoreBackup() {
    if (!backupDryRun || !backupApproved) return;
    setBackupBusy(true); setBackupError("");
    try {
      await unlockRestricted();
      const body = await json(await fetch(`/api/v2/backups/${backupDryRun.snapshotId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreId: backupDryRun.restoreId, approved: true, dryRunHash: backupDryRun.value.dryRunHash, expectedRevision: backupDryRun.stateRevision }),
      })) as { restore: RestoreWorkflow };
      const current = await advanceInBoundedBatch(body.restore, MAX_RESTORE_ADVANCE_CALLS - 1);
      applyRestoreView(current, "backup", backupDryRun.snapshotId, backupRestoreKey?.value);
      setBackupApproved(false);
    } catch (error) { setBackupError(error instanceof Error ? error.message : "백업을 복원하지 못했습니다."); }
    finally { setBackupBusy(false); }
  }

  async function toggleBackupPin(snapshot: BackupSnapshot) {
    setBackupBusy(true); setBackupError("");
    try {
      await unlockRestricted();
      const pinned = !Boolean(snapshot.pinned);
      await json(await fetch(`/api/v2/backups/${snapshot.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned }) }));
      setSnapshots((current) => current.map((item) => item.id === snapshot.id ? { ...item, pinned } : item));
    } catch (error) { setBackupError(error instanceof Error ? error.message : "백업 고정을 바꾸지 못했습니다."); }
    finally { setBackupBusy(false); }
  }

  const restoreProgressText = restoreWorkflow && RESTORE_PROGRESS_STATES.has(restoreWorkflow.status)
    ? `${restoreStatusLabel(restoreWorkflow.status)} · 파일 ${restoreWorkflow.progress.filesComplete}/${restoreWorkflow.progress.filesTotal} · 행 ${restoreWorkflow.progress.rowsApplied}/${restoreWorkflow.progress.rowsPlanned}`
    : null;
  const restoreUploadProgressText = restoreUpload
    ? `${restoreUploadStatusLabel(restoreUpload)} · 부품 ${restoreUpload.receivedParts}/${restoreUpload.expectedParts} · 업로드 ${Math.floor(restoreUpload.uploadedBytes / (1024 * 1024))}/${Math.ceil(restoreUpload.sizeBytes / (1024 * 1024))} MiB · 전체 검증 ${Math.floor(restoreUpload.hashVerifiedBytes / (1024 * 1024))}/${Math.ceil(restoreUpload.sizeBytes / (1024 * 1024))} MiB`
    : null;
  const archiveHashPercent = archive?.size ? Math.min(100, Math.floor(restoreUploadHashBytes / archive.size * 100)) : 0;
  const restoreAwaitingApproval = restoreWorkflow?.status === "awaiting_approval";
  const protectedExportPresent = jobs.some(exportJobRequiresRestrictedGrant);

  return <div className="v2-portability-grid">
    <section className="v2-portability-panel">
      <header><Download aria-hidden="true" size={21} /><div><h2>내보내기</h2><p>앱 없이 읽거나 다른 Light House로 옮길 수 있습니다.</p></div></header>
      <fieldset className="v2-portability-choice"><legend>용도</legend><label><input checked={profile === "portable"} onChange={() => setProfile("portable")} type="radio" /><span><strong>읽기용</strong><small>Markdown, metadata, 원본 파일</small></span></label><label><input checked={profile === "migration"} onChange={() => setProfile("migration")} type="radio" /><span><strong>이전·복원용</strong><small>revision, registry, evidence까지 보존</small></span></label></fieldset>
      <fieldset className="v2-portability-choice"><legend>포함 범위</legend><label><input checked={profile === "migration" || sensitive} disabled={profile === "migration"} onChange={(event) => setSensitive(event.target.checked)} type="checkbox" /><span><strong>민감 기록 포함</strong><small>{profile === "migration" ? "무손실 이전본에는 항상 포함됩니다." : "본문과 원본이 archive에 들어갑니다."}</small></span></label><label><input checked={profile === "migration" || restricted} disabled={profile === "migration"} onChange={(event) => setRestricted(event.target.checked)} type="checkbox" /><span><strong>잠금 기록 포함</strong><small>{profile === "migration" ? "무손실 이전본에는 항상 포함됩니다." : "비밀번호 재확인이 필요합니다."}</small></span></label></fieldset>
      {profile === "migration" ? <div className="v2-portability-warning"><ShieldAlert aria-hidden="true" size={17} /><p><strong>이전·복원용은 계정 전체를 보존합니다.</strong><span>일반·민감·잠금 기록, 삭제 이력, 원본과 분류 전 legacy 원문까지 포함하며 현재 비밀번호를 다시 확인합니다.</span></p></div> : null}
      {profile === "migration" || restricted || protectedExportPresent ? <label className="v2-portability-password"><span>현재 비밀번호</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label> : null}
      <div className="v2-portability-warning"><ShieldAlert aria-hidden="true" size={17} /><p><strong>ZIP은 암호화되지 않습니다.</strong><span>암호화된 디스크나 개인 보관소에 저장하고 공유 링크에 올리지 마세요.</span></p></div>
      <button className="v2-portability-primary" disabled={exportBusy} onClick={startExport} type="button"><FileArchive aria-hidden="true" size={17} /> {exportBusy ? "안전하게 묶는 중…" : "내보내기 만들기"}</button>
      {exportError ? <p className="v2-portability-error" role="alert">{exportError}</p> : null}
      {jobs.length ? <div className="v2-portability-jobs"><h3>최근 내보내기</h3>{jobs.slice(0, 5).map((job) => <article key={job.id}><div><strong>{job.profile === "portable" ? "읽기용" : "이전·복원용"}</strong><small>{new Date(job.createdAt).toLocaleString("ko-KR")} · {job.status}{job.progress ? ` · 파일 ${job.progress.entriesComplete} · ${Math.floor(job.progress.bytesPacked / (1024 * 1024))} MiB` : ""}</small></div>{job.status === "succeeded" ? <button disabled={exportBusy} onClick={() => downloadExport(job)} type="button"><Download aria-hidden="true" size={14} /> 다운로드</button> : job.status === "queued" || job.status === "running" ? <button disabled={exportBusy} onClick={() => continueExport(job.id)} type="button">계속 진행</button> : null}</article>)}</div> : null}
    </section>

    <section className="v2-portability-panel">
      <header><UploadCloud aria-hidden="true" size={21} /><div><h2>검사하고 복원하기</h2><p>검사와 dry-run 동안에는 현재 기록을 바꾸지 않습니다.</p></div></header>
      <label className="v2-portability-file"><input accept=".zip,application/zip" onChange={(event) => { const selected = event.target.files?.[0] ?? null; setArchive(selected); setDryRun(null); setManifest(null); setApproved(false); setRestoreWorkflow(null); setRestoreResult(null); setRestoreIdempotencyKey(""); setRestoreUploadHashBytes(0); setActiveRestoreKind("archive"); localStorage.removeItem(ACTIVE_RESTORE_STORAGE_KEY); if (!selected || !restoreUpload || restoreUpload.fileName !== selected.name || restoreUpload.sizeBytes !== selected.size) { setRestoreUpload(null); setRestoreUploadIdempotencyKey(""); localStorage.removeItem(ACTIVE_RESTORE_UPLOAD_STORAGE_KEY); } }} type="file" /><span>{archive ? archive.name : "Lighthouse ZIP 선택"}</span></label>
      <p className="v2-portability-backup-note">90 MiB 이하는 한 번에 올리고, 더 큰 ZIP은 8 MiB 부품으로 나누어 중단 지점부터 재개합니다. 현재 ZIP32 한도인 4 GiB 미만까지 지원합니다.</p>
      <button className="v2-portability-secondary" disabled={!archive || restoreBusy} onClick={verify} type="button">{restoreBusy && !dryRun ? restoreUploadHashBytes > 0 && archiveHashPercent < 100 ? `checksum 계산 ${archiveHashPercent}%` : archive && archive.size > MAX_DIRECT_ARCHIVE_BYTES ? "대용량 업로드 진행 중…" : "checksum 검사 중…" : restoreUpload && restoreUpload.status !== "staged" ? "대용량 업로드 계속" : "변경 없이 검사"}</button>
      {restoreUpload && restoreUploadProgressText && restoreUpload.status !== "staged" ? <div className="v2-portability-result"><UploadCloud aria-hidden="true" size={19} /><div><strong>{restoreUploadProgressText}</strong><small>upload {restoreUpload.uploadId} · 한 번에 부품 {MAX_UPLOAD_PARTS_PER_ACTION}개 / 조립 {MAX_UPLOAD_ADVANCE_CALLS}단계 · {new Date(restoreUpload.expiresAt).toLocaleString("ko-KR")}까지 재개</small></div><button disabled={!archive || restoreBusy} onClick={verify} type="button">계속</button><button disabled={restoreBusy} onClick={abortLargeUpload} type="button">취소</button></div> : null}
      {activeRestoreKind === "archive" && restoreProgressText ? <div className="v2-portability-result"><FileArchive aria-hidden="true" size={19} /><div><strong>{restoreProgressText}</strong><small>batch {restoreWorkflow?.batchId} · 한 번에 최대 {MAX_RESTORE_ADVANCE_CALLS}단계</small></div><button disabled={restoreBusy} onClick={() => continueRestore("archive")} type="button">계속 진행</button></div> : null}
      {dryRun ? <div className="v2-portability-dry-run"><header><CheckCircle2 aria-hidden="true" size={18} /><div><strong>검증된 dry-run</strong><small>{manifest?.profile} · root {dryRun.manifestRootHash.slice(0, 20)}…</small></div></header><dl><div><dt>새로 만들기</dt><dd>{dryRun.counts.create}</dd></div><div><dt>그대로 재사용</dt><dd>{dryRun.counts.reuse}</dd></div><div><dt>ID 분기</dt><dd>{dryRun.counts.fork}</dd></div><div><dt>미해결 충돌</dt><dd>{dryRun.counts.conflict}</dd></div></dl>{dryRun.counts.conflict ? <p>충돌을 먼저 해결해야 가져올 수 있습니다. AI가 자동 병합하지 않습니다.</p> : restoreAwaitingApproval ? <label><input checked={approved} onChange={(event) => setApproved(event.target.checked)} type="checkbox" /><span>이 checksum과 변경 수를 확인했습니다.</span></label> : <p>이 dry-run은 이미 승인되었거나 처리가 끝났습니다.</p>}<button className="v2-portability-primary" disabled={!restoreAwaitingApproval || !approved || restoreBusy || dryRun.counts.conflict > 0} onClick={restore} type="button">명시한 결과로 가져오기</button></div> : null}
      {restoreResult ? <div className="v2-portability-result"><CheckCircle2 aria-hidden="true" size={19} /><div><strong>{restoreResult.status === "rolled_back" ? "복원을 되돌렸습니다" : "복원과 검증을 마쳤습니다"}</strong><small>batch {restoreResult.batchId}</small></div>{restoreResult.status !== "rolled_back" ? <button disabled={restoreBusy} onClick={rollback} type="button"><RotateCcw aria-hidden="true" size={14} /> 이 batch 되돌리기</button> : null}</div> : null}
      <label className="v2-portability-password"><span><LockKeyhole aria-hidden="true" size={13} /> 복원 작업 비밀번호</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
      {restoreError ? <p className="v2-portability-error" role="alert">{restoreError}</p> : null}
    </section>
    <section className="v2-portability-panel v2-portability-backup">
      <header><LockKeyhole aria-hidden="true" size={21} /><div><h2>검증된 비공개 백업</h2><p>원본은 SHA-256 content address로 중복 없이 보관합니다.</p></div></header>
      <label className="v2-portability-password"><span>현재 비밀번호</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
      <div className="v2-portability-backup-actions"><button className="v2-portability-primary" disabled={backupBusy} onClick={() => backup("full")} type="button">전체 백업</button><button className="v2-portability-secondary" disabled={backupBusy} onClick={() => backup("incremental")} type="button">변경분 백업</button></div>
      <p className="v2-portability-backup-note">본문을 로그에 남기지 않습니다. manifest·metadata·모든 원본 hash 검증이 끝나야 성공으로 표시합니다. 현재 한 백업은 canonical metadata 약 12.7만 행(단일 행 512 KiB)·원본 8천 개·manifest 8 MiB까지 명시적으로 지원하며, 한도를 넘으면 불완전 백업을 만들지 않고 중단합니다.</p>
      {backupError ? <p className="v2-portability-error" role="alert">{backupError}</p> : null}
      {activeRestoreKind === "backup" && restoreProgressText ? <div className="v2-portability-result"><FileArchive aria-hidden="true" size={19} /><div><strong>{restoreProgressText}</strong><small>batch {restoreWorkflow?.batchId} · 업로드 없이 이어집니다</small></div><button disabled={backupBusy} onClick={() => continueRestore("backup")} type="button">계속 진행</button></div> : null}
      {snapshots.length ? <div className="v2-portability-jobs"><h3>최근 백업</h3>{snapshots.slice(0, 8).map((snapshot) => <article key={snapshot.id}><div><strong>{snapshot.snapshot_kind === "full" ? "전체" : "변경분"} · {snapshot.status}{snapshot.pinned ? " · 고정됨" : ""}</strong><small>{snapshot.status === "building" ? `${backupBuildStatusLabel(snapshot.build_phase ?? "metadata")} · 단계 ${snapshot.state_revision ?? 0}` : `${new Date(snapshot.created_at).toLocaleString("ko-KR")} · ${snapshot.retention_class} · sequence ${snapshot.end_sequence} · 원본 ${snapshot.referenced_blob_count}개`}</small></div><span className="v2-portability-job-actions">{snapshot.verified_at ? <CheckCircle2 aria-label="검증됨" size={15} /> : null}{snapshot.status === "building" ? <button disabled={backupBusy} onClick={() => continueBackupBuild(snapshot.id)} type="button">계속 진행</button> : null}{snapshot.status === "succeeded" ? <><button disabled={backupBusy} onClick={() => inspectBackup(snapshot.id)} type="button">검사</button><button disabled={backupBusy} onClick={() => toggleBackupPin(snapshot)} type="button">{snapshot.pinned ? "고정 해제" : "고정"}</button></> : null}</span></article>)}</div> : <p className="v2-portability-backup-note">아직 검증된 백업이 없습니다.</p>}
      {backupDryRun ? <div className="v2-portability-dry-run"><header><CheckCircle2 aria-hidden="true" size={18} /><div><strong>선택한 백업의 검증된 변경 미리보기</strong><small>snapshot {backupDryRun.snapshotId}</small></div></header><dl><div><dt>새로 만들기</dt><dd>{backupDryRun.value.counts.create}</dd></div><div><dt>그대로 재사용</dt><dd>{backupDryRun.value.counts.reuse}</dd></div><div><dt>ID 분기</dt><dd>{backupDryRun.value.counts.fork}</dd></div><div><dt>미해결 충돌</dt><dd>{backupDryRun.value.counts.conflict}</dd></div></dl>{backupDryRun.value.counts.conflict ? <p>충돌을 먼저 해결해야 합니다. 기존 기록을 자동 덮어쓰지 않습니다.</p> : restoreAwaitingApproval ? <label><input checked={backupApproved} onChange={(event) => setBackupApproved(event.target.checked)} type="checkbox" /><span>이 백업 체인과 변경 수를 확인했습니다.</span></label> : <p>이 백업 dry-run은 이미 승인되었거나 처리가 끝났습니다.</p>}<button className="v2-portability-primary" disabled={!restoreAwaitingApproval || !backupApproved || backupBusy || backupDryRun.value.counts.conflict > 0} onClick={restoreBackup} type="button">선택한 백업 복원</button></div> : null}
    </section>
    <LegacyMigrationPanel ensureRestricted={unlockRestricted} />
  </div>;
}
