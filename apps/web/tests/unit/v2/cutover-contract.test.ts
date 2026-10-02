import { describe, expect, it } from "vitest";

import { CUTOVER_EVIDENCE_MAX_AGE_MS, evaluateCutover, isCutoverTimestamp, type CutoverEvidenceV1 } from "@/lib/v2/cutover/cutover-contract-v1";

const NOW = "2026-08-12T00:00:00.000Z";

function completeEvidence(overrides: Partial<CutoverEvidenceV1> = {}): CutoverEvidenceV1 {
  return {
    version: 1,
    measuredAt: NOW,
    ownerCaptureStartedAt: "2026-07-20T00:00:00.000Z",
    captureDefaultAt: "2026-08-01T00:00:00.000Z",
    privateCorpus: { totalCount: 20, readyCount: 20, approvedExpectedCount: 20, fatalFailureCount: 0, evaluationPassed: true },
    runtime: { liveGeminiRolesPassed: true, workerDeploymentPassed: true, sourceCommitHealthy: true },
    devices: { windowsImePassed: true, androidSharePassed: true, iosFallbackPassed: true, screenReaderPassed: true },
    migration: { liveInventoryCompleted: true, r2InventoryCompleted: true, adapterCoveragePercent: 100, structuralReconciliationPassed: true, substantiveSamplePassed: true, finalDeltaReconciled: true, verifiedSnapshotAt: "2026-08-11T00:00:00.000Z" },
    experience: { usabilityPassed: true, recallTop10Rate: 0.95 },
    operations: { legacyReadonlyGuardPassed: true, rollbackDrillPassed: true },
    ...overrides,
  };
}

function withSnapshot(evidence: CutoverEvidenceV1, verifiedSnapshotAt: string) {
  return { ...evidence, migration: { ...evidence.migration, verifiedSnapshotAt } };
}

describe("private cutover contract", () => {
  it("fails closed and names every missing release gate", () => {
    const evidence = completeEvidence({
      ownerCaptureStartedAt: null,
      privateCorpus: { totalCount: 20, readyCount: 0, approvedExpectedCount: 0, fatalFailureCount: 0, evaluationPassed: false },
      runtime: { liveGeminiRolesPassed: false, workerDeploymentPassed: false, sourceCommitHealthy: true },
    });
    const result = evaluateCutover("capture_default", evidence, NOW);

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((item) => item.key)).toEqual(expect.arrayContaining([
      "owner_capture_observation",
      "private_corpus_ready",
      "private_corpus_expected",
      "private_corpus_evaluation",
      "live_gemini",
      "worker_deployment",
    ]));
  });

  it("keeps Library legacy while promoting V2 Capture", () => {
    const result = evaluateCutover("capture_default", completeEvidence(), NOW);

    expect(result.eligible).toBe(true);
    expect(result.recommendedFlags).toMatchObject({ routes: true, write: true, defaultLibrary: false, legacyReadonly: true });
  });

  it("requires seven observed days and 90 percent recall before Library default", () => {
    const evidence = withSnapshot(completeEvidence({
      captureDefaultAt: "2026-08-10T00:00:00.000Z",
      experience: { usabilityPassed: true, recallTop10Rate: 0.89 },
    }), "2026-08-09T00:00:00.000Z");
    const result = evaluateCutover("library_default", evidence, NOW);

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((item) => item.key)).toEqual(["capture_default_observation", "recall_top10"]);
  });

  it("requires a rollback drill only for cutover closure", () => {
    const evidence = withSnapshot(completeEvidence({
      captureDefaultAt: "2026-07-01T00:00:00.000Z",
      operations: { legacyReadonlyGuardPassed: true, rollbackDrillPassed: false },
    }), "2026-06-30T00:00:00.000Z");

    expect(evaluateCutover("library_default", evidence, NOW).eligible).toBe(true);
    expect(evaluateCutover("closure", evidence, NOW).blockers.map((item) => item.key)).toEqual(["rollback_drill"]);
  });

  it.each(["2026-08-12", "08/12/2026", "2026-02-30T00:00:00.000Z", "2026-08-12T00:00:00+00:00", "2026-08-12T24:00:00.000Z"])("rejects noncanonical or impossible timestamp %s", (timestamp) => {
    expect(isCutoverTimestamp(timestamp)).toBe(false);
    const result = evaluateCutover("capture_default", completeEvidence({ measuredAt: timestamp }), NOW);
    expect(result.blockers.map((item) => item.key)).toContain("measured_at");
  });

  it("accepts exact UTC seconds with optional three millisecond digits", () => {
    expect(isCutoverTimestamp("2026-08-12T00:00:00Z")).toBe(true);
    expect(isCutoverTimestamp(NOW)).toBe(true);
    expect(isCutoverTimestamp(null)).toBe(false);
  });

  it("checks freshness against the supplied clock, including the exact 24-hour boundary", () => {
    const evidence = completeEvidence();
    expect(evaluateCutover("capture_default", evidence, "2026-08-13T00:00:00.000Z").eligible).toBe(true);
    for (const now of ["2026-08-11T23:59:59.999Z", "2026-08-13T00:00:00.001Z", "2030-01-01T00:00:00.000Z"]) {
      expect(evaluateCutover("capture_default", evidence, now).blockers.map((item) => item.key)).toContain("evidence_freshness");
    }
    expect(CUTOVER_EVIDENCE_MAX_AGE_MS).toBe(86_400_000);
  });

  it("rejects invalid evaluation clocks and future measured evidence", () => {
    expect(evaluateCutover("capture_default", completeEvidence(), "invalid").blockers.map((item) => item.key)).toContain("evaluation_clock");
    expect(evaluateCutover("capture_default", completeEvidence({ measuredAt: "2030-01-01T00:00:00.000Z" }), NOW).blockers.map((item) => item.key)).toContain("evidence_freshness");
  });

  it.each(["2025-01-01T00:00:00.000Z", "2026-08-10T23:59:59.999Z", "2026-08-12T00:00:00.001Z"])("rejects a stale or future pre-Capture snapshot %s", (verifiedSnapshotAt) => {
    const evidence = withSnapshot(completeEvidence(), verifiedSnapshotAt);
    expect(evaluateCutover("capture_default", evidence, NOW).blockers.map((item) => item.key)).toContain("verified_snapshot");
  });

  it("keeps the actual pre-cutover snapshot valid for later Library and closure evaluations", () => {
    const evidence = withSnapshot(completeEvidence({ captureDefaultAt: "2026-07-01T00:00:00.000Z" }), "2026-06-30T00:00:00.000Z");
    expect(evaluateCutover("library_default", evidence, NOW).eligible).toBe(true);
    expect(evaluateCutover("closure", evidence, NOW).eligible).toBe(true);
    expect(evaluateCutover("library_default", withSnapshot(evidence, NOW), NOW).blockers.map((item) => item.key)).toContain("verified_snapshot");
  });

  it("requires thirty complete days before closure even when rollback and seven-day gates pass", () => {
    const evidence = withSnapshot(completeEvidence({ captureDefaultAt: "2026-08-01T00:00:00.000Z" }), "2026-07-31T00:00:00.000Z");
    expect(evaluateCutover("library_default", evidence, NOW).eligible).toBe(true);
    expect(evaluateCutover("closure", evidence, NOW).blockers.map((item) => item.key)).toEqual(["closure_observation"]);
    const thirtyDays = { ...evidence, measuredAt: "2026-08-31T00:00:00.000Z" };
    expect(evaluateCutover("closure", thirtyDays, thirtyDays.measuredAt).eligible).toBe(true);
    const early = { ...thirtyDays, measuredAt: "2026-08-30T23:59:59.999Z" };
    expect(evaluateCutover("closure", early, early.measuredAt).blockers.map((item) => item.key)).toContain("closure_observation");
  });
});
