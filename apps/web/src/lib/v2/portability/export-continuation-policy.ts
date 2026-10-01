export const EXPORT_ADVANCE_CALLS_PER_BATCH = 50;
export const EXPORT_MAX_BATCHES_PER_USER_ACTION = 12;
export const EXPORT_ADVANCE_CALLS_PER_USER_ACTION = EXPORT_ADVANCE_CALLS_PER_BATCH * EXPORT_MAX_BATCHES_PER_USER_ACTION;

export type ExportContinuationState = Readonly<{ status: string; stateRevision?: number }>;

export function exportContinuationMadeProgress(previous: ExportContinuationState, current: ExportContinuationState) {
  if (current.status !== "queued" && current.status !== "running") return false;
  if (!Number.isSafeInteger(previous.stateRevision) || !Number.isSafeInteger(current.stateRevision)) return false;
  return current.stateRevision! > previous.stateRevision!;
}

export function exportUserActionsForAdvances(advances: number) {
  if (!Number.isSafeInteger(advances) || advances < 0) throw new Error("export_advance_estimate_invalid");
  return Math.ceil(advances / EXPORT_ADVANCE_CALLS_PER_USER_ACTION);
}
