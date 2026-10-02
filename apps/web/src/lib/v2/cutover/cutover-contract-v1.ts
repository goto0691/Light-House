import type { V2ServerFeatureFlags } from "@/lib/v2/config/feature-flags";

export const CUTOVER_EVIDENCE_VERSION = 1 as const;

export type CutoverTarget = "capture_default" | "library_default" | "closure";

export type CutoverEvidenceV1 = Readonly<{
  version: typeof CUTOVER_EVIDENCE_VERSION;
  measuredAt: string;
  ownerCaptureStartedAt: string | null;
  captureDefaultAt: string | null;
  privateCorpus: Readonly<{
    totalCount: number;
    readyCount: number;
    approvedExpectedCount: number;
    fatalFailureCount: number;
    evaluationPassed: boolean;
  }>;
  runtime: Readonly<{
    liveGeminiRolesPassed: boolean;
    workerDeploymentPassed: boolean;
    sourceCommitHealthy: boolean;
  }>;
  devices: Readonly<{
    windowsImePassed: boolean;
    androidSharePassed: boolean;
    iosFallbackPassed: boolean;
    screenReaderPassed: boolean;
  }>;
  migration: Readonly<{
    liveInventoryCompleted: boolean;
    r2InventoryCompleted: boolean;
    adapterCoveragePercent: number;
    structuralReconciliationPassed: boolean;
    substantiveSamplePassed: boolean;
    finalDeltaReconciled: boolean;
    verifiedSnapshotAt: string | null;
  }>;
  experience: Readonly<{
    usabilityPassed: boolean;
    recallTop10Rate: number | null;
  }>;
  operations: Readonly<{
    legacyReadonlyGuardPassed: boolean;
    rollbackDrillPassed: boolean;
  }>;
}>;

export type CutoverGate = Readonly<{
  key: string;
  label: string;
  passed: boolean;
  actual: string;
  required: string;
}>;

export type CutoverEvaluation = Readonly<{
  target: CutoverTarget;
  eligible: boolean;
  recommendedFlags: V2ServerFeatureFlags;
  gates: readonly CutoverGate[];
  blockers: readonly CutoverGate[];
}>;

const DAY_MS = 86_400_000;
const REQUIRED_CAPTURE_DAYS = 14;
const REQUIRED_LIBRARY_OBSERVATION_DAYS = 7;
const REQUIRED_CLOSURE_DAYS = 30;
export const CUTOVER_EVIDENCE_MAX_AGE_MS = DAY_MS;
export const CUTOVER_SNAPSHOT_MAX_AGE_MS = DAY_MS;

export function isCutoverTimestamp(value: string | null) {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

function elapsedDays(start: string | null, end: string) {
  if (!isCutoverTimestamp(start) || !isCutoverTimestamp(end)) return -1;
  return Math.floor((Date.parse(end) - Date.parse(start!)) / DAY_MS);
}

function gate(key: string, label: string, passed: boolean, actual: string | number | boolean | null, required: string): CutoverGate {
  return { key, label, passed, actual: actual === null ? "missing" : String(actual), required };
}

function baseFlags(defaultLibrary: boolean): V2ServerFeatureFlags {
  return {
    routes: true,
    write: true,
    ai: true,
    offline: true,
    defaultLibrary,
    legacyReadonly: true,
  };
}

// The CLI supplies its current clock. Pure callers supply a fixed clock so old
// observations cannot acquire freshness merely by being evaluated again.
export function evaluateCutover(target: CutoverTarget, evidence: CutoverEvidenceV1, now = new Date().toISOString()): CutoverEvaluation {
  const captureDays = elapsedDays(evidence.ownerCaptureStartedAt, evidence.measuredAt);
  const libraryObservationDays = elapsedDays(evidence.captureDefaultAt, evidence.measuredAt);
  const measurementValid = isCutoverTimestamp(evidence.measuredAt);
  const nowValid = isCutoverTimestamp(now);
  const evidenceAge = measurementValid && nowValid ? Date.parse(now) - Date.parse(evidence.measuredAt) : -1;
  // Later promotions verify the snapshot taken immediately before Capture
  // cutover, rather than requiring that same historical snapshot to be new.
  const snapshotAnchor = target === "capture_default" ? evidence.measuredAt : evidence.captureDefaultAt;
  const snapshotAge = isCutoverTimestamp(snapshotAnchor) && isCutoverTimestamp(evidence.migration.verifiedSnapshotAt)
    ? Date.parse(snapshotAnchor!) - Date.parse(evidence.migration.verifiedSnapshotAt!) : -1;
  const snapshotValid = snapshotAge >= 0 && snapshotAge <= CUTOVER_SNAPSHOT_MAX_AGE_MS;

  const gates: CutoverGate[] = [
    gate("evidence_version", "전환 증거 형식", evidence.version === CUTOVER_EVIDENCE_VERSION, evidence.version, "1"),
    gate("measured_at", "측정 시각", measurementValid, evidence.measuredAt, "strict UTC ISO timestamp"),
    gate("evaluation_clock", "사전검증 기준 시각", nowValid, now, "strict UTC ISO timestamp"),
    gate("evidence_freshness", "측정 증거 신선도", evidenceAge >= 0 && evidenceAge <= CUTOVER_EVIDENCE_MAX_AGE_MS, evidenceAge, "not future and <= 24 hours old"),
    gate("owner_capture_observation", "소유자 V2 신규 기록 관찰", captureDays >= REQUIRED_CAPTURE_DAYS, captureDays, `>= ${REQUIRED_CAPTURE_DAYS} days`),
    gate("private_corpus_total", "private corpus 슬롯", evidence.privateCorpus.totalCount === 20, evidence.privateCorpus.totalCount, "20"),
    gate("private_corpus_ready", "private corpus source 준비", evidence.privateCorpus.readyCount === 20, evidence.privateCorpus.readyCount, "20"),
    gate("private_corpus_expected", "승인된 expected(사람/사용자 위임)", evidence.privateCorpus.approvedExpectedCount === 20, evidence.privateCorpus.approvedExpectedCount, "20"),
    gate("private_corpus_fatal", "private corpus fatal failure", evidence.privateCorpus.fatalFailureCount === 0, evidence.privateCorpus.fatalFailureCount, "0"),
    gate("private_corpus_evaluation", "private corpus 평가", evidence.privateCorpus.evaluationPassed, evidence.privateCorpus.evaluationPassed, "true"),
    gate("live_gemini", "Gemini 역할별 live probe", evidence.runtime.liveGeminiRolesPassed, evidence.runtime.liveGeminiRolesPassed, "true"),
    gate("worker_deployment", "Cloudflare Worker 배포 검증", evidence.runtime.workerDeploymentPassed, evidence.runtime.workerDeploymentPassed, "true"),
    gate("source_commit_health", "V2 source commit 건강성", evidence.runtime.sourceCommitHealthy, evidence.runtime.sourceCommitHealthy, "true"),
    gate("windows_ime", "Windows IME 편집", evidence.devices.windowsImePassed, evidence.devices.windowsImePassed, "true"),
    gate("android_share", "Android Share Target", evidence.devices.androidSharePassed, evidence.devices.androidSharePassed, "true"),
    gate("ios_fallback", "iOS 공유 fallback", evidence.devices.iosFallbackPassed, evidence.devices.iosFallbackPassed, "true"),
    gate("screen_reader", "screen reader 핵심 흐름", evidence.devices.screenReaderPassed, evidence.devices.screenReaderPassed, "true"),
    gate("live_d1_inventory", "live D1 inventory", evidence.migration.liveInventoryCompleted, evidence.migration.liveInventoryCompleted, "true"),
    gate("live_r2_inventory", "live R2 inventory", evidence.migration.r2InventoryCompleted, evidence.migration.r2InventoryCompleted, "true"),
    gate("adapter_coverage", "legacy adapter column coverage", evidence.migration.adapterCoveragePercent === 100, evidence.migration.adapterCoveragePercent, "100"),
    gate("structural_reconciliation", "source-only 구조 reconciliation", evidence.migration.structuralReconciliationPassed, evidence.migration.structuralReconciliationPassed, "true"),
    gate("substantive_sample", "legacy 실질 표본 검토", evidence.migration.substantiveSamplePassed, evidence.migration.substantiveSamplePassed, "true"),
    gate("final_delta", "최종 legacy delta reconciliation", evidence.migration.finalDeltaReconciled, evidence.migration.finalDeltaReconciled, "true"),
    gate("verified_snapshot", "전환 직전 검증 snapshot", snapshotValid, evidence.migration.verifiedSnapshotAt, "verified within 24 hours before Capture cutover"),
    gate("usability", "핵심 사용성 검증", evidence.experience.usabilityPassed, evidence.experience.usabilityPassed, "true"),
    gate("legacy_readonly_guard", "V1 mutation read-only guard", evidence.operations.legacyReadonlyGuardPassed, evidence.operations.legacyReadonlyGuardPassed, "true"),
  ];

  if (target === "library_default" || target === "closure") {
    gates.push(
      gate("capture_default_observation", "V2 Capture 기본 전환 관찰", libraryObservationDays >= REQUIRED_LIBRARY_OBSERVATION_DAYS, libraryObservationDays, `>= ${REQUIRED_LIBRARY_OBSERVATION_DAYS} days`),
      gate("recall_top10", "private recall top-10", evidence.experience.recallTop10Rate !== null && evidence.experience.recallTop10Rate >= 0.9, evidence.experience.recallTop10Rate, ">= 0.9"),
    );
  }

  if (target === "closure") {
    gates.push(
      gate("closure_observation", "V2 Capture 전환 종료 관찰", libraryObservationDays >= REQUIRED_CLOSURE_DAYS, libraryObservationDays, `>= ${REQUIRED_CLOSURE_DAYS} days`),
      gate("rollback_drill", "rollback drill", evidence.operations.rollbackDrillPassed, evidence.operations.rollbackDrillPassed, "true"),
    );
  }

  const blockers = gates.filter((item) => !item.passed);
  return {
    target,
    eligible: blockers.length === 0,
    recommendedFlags: baseFlags(target !== "capture_default"),
    gates,
    blockers,
  };
}
