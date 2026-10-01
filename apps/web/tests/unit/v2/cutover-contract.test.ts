import { describe, expect, it } from "vitest";

import { evaluateCutover, type CutoverEvidenceV1 } from "@/lib/v2/cutover/cutover-contract-v1";

function completeEvidence(overrides: Partial<CutoverEvidenceV1> = {}): CutoverEvidenceV1 {
  return {
    version: 1,
    measuredAt: "2026-08-12T00:00:00.000Z",
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

describe("private cutover contract", () => {
  it("fails closed and names every missing release gate", () => {
    const evidence = completeEvidence({
      ownerCaptureStartedAt: null,
      privateCorpus: { totalCount: 20, readyCount: 0, approvedExpectedCount: 0, fatalFailureCount: 0, evaluationPassed: false },
      runtime: { liveGeminiRolesPassed: false, workerDeploymentPassed: false, sourceCommitHealthy: true },
    });
    const result = evaluateCutover("capture_default", evidence);

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
    const result = evaluateCutover("capture_default", completeEvidence());

    expect(result.eligible).toBe(true);
    expect(result.recommendedFlags).toMatchObject({ routes: true, write: true, defaultLibrary: false, legacyReadonly: true });
  });

  it("requires seven observed days and 90 percent recall before Library default", () => {
    const result = evaluateCutover("library_default", completeEvidence({
      captureDefaultAt: "2026-08-10T00:00:00.000Z",
      experience: { usabilityPassed: true, recallTop10Rate: 0.89 },
    }));

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((item) => item.key)).toEqual(["capture_default_observation", "recall_top10"]);
  });

  it("requires a rollback drill only for cutover closure", () => {
    const evidence = completeEvidence({ operations: { legacyReadonlyGuardPassed: true, rollbackDrillPassed: false } });

    expect(evaluateCutover("library_default", evidence).eligible).toBe(true);
    expect(evaluateCutover("closure", evidence).blockers.map((item) => item.key)).toEqual(["rollback_drill"]);
  });
});
