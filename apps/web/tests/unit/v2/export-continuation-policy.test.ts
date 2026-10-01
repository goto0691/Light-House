import { describe, expect, test } from "vitest";

import {
  EXPORT_ADVANCE_CALLS_PER_BATCH,
  EXPORT_ADVANCE_CALLS_PER_USER_ACTION,
  EXPORT_MAX_BATCHES_PER_USER_ACTION,
  exportContinuationMadeProgress,
  exportUserActionsForAdvances,
} from "@/lib/v2/portability/export-continuation-policy";

describe("export continuation UI policy", () => {
  test("bounds one user action to twelve yielded batches", () => {
    expect(EXPORT_ADVANCE_CALLS_PER_BATCH).toBe(50);
    expect(EXPORT_MAX_BATCHES_PER_USER_ACTION).toBe(12);
    expect(EXPORT_ADVANCE_CALLS_PER_USER_ACTION).toBe(600);
    expect(exportUserActionsForAdvances(0)).toBe(0);
    expect(exportUserActionsForAdvances(600)).toBe(1);
    expect(exportUserActionsForAdvances(601)).toBe(2);
  });

  test("continues only while an active workflow revision advances", () => {
    expect(exportContinuationMadeProgress({ status: "running", stateRevision: 8 }, { status: "running", stateRevision: 9 })).toBe(true);
    expect(exportContinuationMadeProgress({ status: "queued", stateRevision: 8 }, { status: "running", stateRevision: 9 })).toBe(true);
    expect(exportContinuationMadeProgress({ status: "running", stateRevision: 9 }, { status: "running", stateRevision: 9 })).toBe(false);
    expect(exportContinuationMadeProgress({ status: "running", stateRevision: 9 }, { status: "running", stateRevision: 8 })).toBe(false);
    expect(exportContinuationMadeProgress({ status: "running", stateRevision: 9 }, { status: "succeeded", stateRevision: 10 })).toBe(false);
    expect(exportContinuationMadeProgress({ status: "running" }, { status: "running", stateRevision: 10 })).toBe(false);
  });

  test("rejects invalid estimates", () => {
    expect(() => exportUserActionsForAdvances(-1)).toThrow("export_advance_estimate_invalid");
    expect(() => exportUserActionsForAdvances(1.5)).toThrow("export_advance_estimate_invalid");
  });
});
