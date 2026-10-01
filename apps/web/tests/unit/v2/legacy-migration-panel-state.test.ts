import { describe, expect, it } from "vitest";

import {
  classifyLegacyBatch,
  dryRunMatchesBatch,
  legacyRunMaterializedBatch,
  parseStoredLegacyMigration,
  type LegacyDryRun,
  type LegacyMigrationBatch,
} from "@/components/v2/legacy-migration-state";

const dryRun: LegacyDryRun = {
  table: "reviews",
  adapterVersion: "legacy-v1",
  schemaSnapshot: "schema-hash",
  inputRows: 12,
  projectedDocuments: 10,
  archivedRows: 2,
  expectedMappingCount: 12,
  damageCodes: {},
  rowsRootHash: "rows-hash",
  projectionRootHash: "projection-hash",
  dryRunHash: "dry-run-hash",
};

function batch(overrides: Partial<LegacyMigrationBatch> = {}): LegacyMigrationBatch {
  return {
    id: "batch-1",
    table: "reviews",
    adapterVersion: "legacy-v1",
    mode: "source_only",
    dryRunHash: "dry-run-hash",
    inputRows: 12,
    expectedMappingCount: 12,
    nextOffset: 4,
    status: "running",
    controlStatus: "active",
    stateRevision: 3,
    reconciliationStatus: "pending",
    failureCode: null,
    createdAt: "2026-08-29T00:00:00.000Z",
    approvedAt: "2026-08-29T00:00:00.000Z",
    startedAt: "2026-08-29T00:01:00.000Z",
    finishedAt: null,
    reconciledAt: null,
    quarantine: null,
    ...overrides,
  };
}

describe("legacy migration panel state", () => {
  it("only resumes approved or running batches under active server control", () => {
    expect(classifyLegacyBatch(batch()).resumable).toBe(true);
    expect(classifyLegacyBatch(batch({ status: "approved" })).resumable).toBe(true);
    expect(classifyLegacyBatch(batch({ controlStatus: "paused" }))).toMatchObject({ kind: "paused", resumable: false });
  });

  it("distinguishes terminal, stale, and quarantined batches", () => {
    expect(classifyLegacyBatch(batch({ status: "succeeded", controlStatus: "complete" }))).toMatchObject({ kind: "complete", resumable: false });
    expect(classifyLegacyBatch(batch({ status: "stale", controlStatus: "paused" }))).toMatchObject({ kind: "stale", resumable: false });
    expect(classifyLegacyBatch(batch({ controlStatus: "quarantined", quarantine: { idempotencyKey: "key-1", reason: "잘못된 투영", preStatus: "succeeded", preControlStatus: "complete", quarantinedAt: "2026-08-29T00:02:00.000Z", receipt: {} } }))).toMatchObject({ kind: "quarantined", resumable: false, message: "격리 사유: 잘못된 투영" });
  });

  it("requires the regenerated dry-run hash and table to match the server batch", () => {
    expect(dryRunMatchesBatch(dryRun, batch())).toBe(true);
    expect(dryRunMatchesBatch({ ...dryRun, dryRunHash: "changed" }, batch())).toBe(false);
    expect(dryRunMatchesBatch({ ...dryRun, table: "games" }, batch())).toBe(false);
  });

  it("does not require a batch detail before a knowledge preservation gate creates the target batch", () => {
    const base = { processed: 0, processedProjections: 0, rowPending: false, nextOffset: 0, complete: false, reconciliation: null };
    expect(legacyRunMaterializedBatch({ ...base, gatePending: true })).toBe(false);
    expect(legacyRunMaterializedBatch({ ...base, batchPrepared: true })).toBe(true);
  });

  it("restores a complete local contract but rejects malformed or cross-table data", () => {
    const stored = {
      version: 1,
      batchId: "batch-1",
      table: "reviews",
      mode: "source_only",
      batchDryRunHash: "dry-run-hash",
      dryRunContract: dryRun,
      serverOffset: 4,
      stateRevision: 3,
    };
    expect(parseStoredLegacyMigration(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredLegacyMigration(JSON.stringify({ ...stored, table: "games" }))).toBeNull();
    expect(parseStoredLegacyMigration("not-json")).toBeNull();
  });
});
