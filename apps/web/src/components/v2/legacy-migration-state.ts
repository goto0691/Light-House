export type LegacyMigrationMode = "source_only" | "knowledge";

export type LegacyInventory = Readonly<{
  table: string;
  adapterVersion: string;
  valid: boolean;
  missing: string[];
  covered: number;
  total: number;
  rows: number;
}>;

export type LegacyDryRun = Readonly<{
  table: string;
  adapterVersion: string;
  schemaSnapshot: string;
  inputRows: number;
  projectedDocuments: number;
  archivedRows: number;
  expectedMappingCount: number;
  damageCodes: Readonly<Record<string, number>>;
  rowsRootHash: string;
  projectionRootHash: string;
  dryRunHash: string;
}>;

export type LegacyReconciliation = Readonly<{
  envelope_count?: number;
  projected_count?: number;
  archived_count?: number;
  structurally_valid?: boolean;
  complete?: boolean;
  batch_status?: string;
  control_status?: string;
  state_revision?: number;
  input_rows?: number;
  next_offset?: number;
  expected_mapping_count?: number;
}> & Readonly<Record<string, unknown>>;

export type LegacyPreservationGate = Readonly<{
  gateId: string;
  status: "checking" | "passed" | "failed";
  stateRevision: number;
  tablesChecked: number;
  tablesTotal: number;
  rowsChecked: number;
  rowsTotal: number;
  currentTable: string | null;
  currentRowOffset: number;
  failureCode: string | null;
}>;

export type LegacyMigrationBatch = Readonly<{
  id: string;
  table: string;
  adapterVersion: string;
  mode: LegacyMigrationMode;
  dryRunHash: string;
  inputRows: number;
  expectedMappingCount: number;
  nextOffset: number;
  status: string;
  controlStatus: string;
  stateRevision: number;
  reconciliationStatus: string;
  failureCode: string | null;
  createdAt: string;
  approvedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  reconciledAt: string | null;
  quarantine: Readonly<{
    idempotencyKey: string;
    reason: string;
    preStatus: string;
    preControlStatus: string;
    quarantinedAt: string;
    receipt: Readonly<Record<string, unknown>>;
  }> | null;
}>;

export type LegacyBatchDetail = Readonly<{
  batch: LegacyMigrationBatch;
  reconciliation: LegacyReconciliation | null;
  preservationGate: LegacyPreservationGate | null;
}>;

export type LegacyRunResult = Readonly<{
  processed: number;
  processedProjections: number;
  batchPrepared?: boolean;
  gatePending?: boolean;
  preservationGate?: LegacyPreservationGate;
  rowPending: boolean;
  nextOffset: number;
  complete: boolean;
  reconciliation: LegacyReconciliation | null;
}>;

export type StoredLegacyMigration = Readonly<{
  version: 1;
  batchId: string;
  table: string;
  mode: LegacyMigrationMode;
  batchDryRunHash: string;
  dryRunContract: LegacyDryRun;
  serverOffset: number;
  stateRevision: number | null;
}>;

export type LegacyBatchDisposition = Readonly<{
  kind: "active" | "complete" | "stale" | "paused" | "quarantined" | "failed" | "unavailable";
  label: string;
  resumable: boolean;
  message: string;
}>;

export const ACTIVE_LEGACY_MIGRATION_STORAGE_KEY = "light-house:v2:active-legacy-migration";
export const LEGACY_QUARANTINE_REQUESTS_STORAGE_KEY = "light-house:v2:legacy-quarantine-requests";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isLegacyDryRun(value: unknown): value is LegacyDryRun {
  if (!isRecord(value)) return false;
  return typeof value.table === "string"
    && typeof value.adapterVersion === "string"
    && typeof value.schemaSnapshot === "string"
    && isFiniteNonNegativeNumber(value.inputRows)
    && isFiniteNonNegativeNumber(value.projectedDocuments)
    && isFiniteNonNegativeNumber(value.archivedRows)
    && isFiniteNonNegativeNumber(value.expectedMappingCount)
    && isRecord(value.damageCodes)
    && typeof value.rowsRootHash === "string"
    && typeof value.projectionRootHash === "string"
    && typeof value.dryRunHash === "string";
}

export function parseStoredLegacyMigration(raw: string | null): StoredLegacyMigration | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)
      || value.version !== 1
      || typeof value.batchId !== "string"
      || typeof value.table !== "string"
      || value.mode !== "source_only" && value.mode !== "knowledge"
      || typeof value.batchDryRunHash !== "string"
      || !isLegacyDryRun(value.dryRunContract)
      || !isFiniteNonNegativeNumber(value.serverOffset)
      || value.stateRevision !== null && !isFiniteNonNegativeNumber(value.stateRevision)) return null;
    if (value.dryRunContract.table !== value.table) return null;
    return value as StoredLegacyMigration;
  } catch {
    return null;
  }
}

function quarantineReason(batch: LegacyMigrationBatch) {
  const reason = batch.quarantine?.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

export function classifyLegacyBatch(batch: LegacyMigrationBatch, reconciliation?: LegacyReconciliation | null): LegacyBatchDisposition {
  if (batch.controlStatus === "quarantined" || batch.controlStatus === "quarantining" || batch.quarantine) {
    const reason = quarantineReason(batch);
    return {
      kind: "quarantined",
      label: batch.controlStatus === "quarantining" ? "격리 처리 중" : "격리됨",
      resumable: false,
      message: reason ? `격리 사유: ${reason}` : "이 batch는 격리되어 다시 진행할 수 없습니다.",
    };
  }
  if (batch.status === "stale") {
    return { kind: "stale", label: "dry-run 만료", resumable: false, message: "현재 원본과 계약이 달라졌습니다. 새 dry-run과 새 batch가 필요합니다." };
  }
  if (batch.status === "succeeded" || batch.controlStatus === "complete" || reconciliation?.complete === true) {
    return { kind: "complete", label: "완료", resumable: false, message: "서버 대조까지 완료된 batch입니다." };
  }
  if (batch.status === "failed") {
    return { kind: "failed", label: "실패", resumable: false, message: batch.failureCode ? `실패 코드: ${batch.failureCode}` : "안전하게 중단된 batch입니다." };
  }
  if (batch.controlStatus === "paused") {
    return { kind: "paused", label: "일시 중지", resumable: false, message: batch.failureCode ? `중지 사유: ${batch.failureCode}` : "서버에서 일시 중지되어 다시 진행할 수 없습니다." };
  }
  if (batch.controlStatus === "active" && (batch.status === "approved" || batch.status === "running")) {
    return { kind: "active", label: batch.status === "running" ? "진행 중" : "승인됨", resumable: true, message: "서버 offset에서 계속할 수 있습니다." };
  }
  return { kind: "unavailable", label: batch.status, resumable: false, message: "서버 상태를 확인하기 전에는 이 batch를 진행할 수 없습니다." };
}

export function dryRunMatchesBatch(dryRun: LegacyDryRun | null, batch: LegacyMigrationBatch | null) {
  return Boolean(dryRun && batch && dryRun.table === batch.table && dryRun.dryRunHash === batch.dryRunHash);
}

export function legacyRunMaterializedBatch(result: LegacyRunResult) {
  return result.gatePending !== true;
}

export function legacyModeLabel(mode: LegacyMigrationMode) {
  return mode === "source_only" ? "1단계 원본 보존" : "2단계 결정 투영";
}
