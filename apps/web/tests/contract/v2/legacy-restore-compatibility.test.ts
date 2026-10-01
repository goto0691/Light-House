import { describe, expect, it } from "vitest";

import { normalizeLegacyRestoreRow } from "@/lib/v2/portability/legacy-restore-compatibility";

describe("pre-0027 legacy restore compatibility", () => {
  it("projects historical batch rows onto the same control state as the 0027 backfill", () => {
    expect(normalizeLegacyRestoreRow("v2_legacy_migration_batches", {
      id: "succeeded-batch",
      status: "succeeded",
    })).toMatchObject({
      state_revision: 0,
      control_status: "complete",
      quarantine_idempotency_key: null,
      quarantine_reason: null,
      quarantine_pre_status: null,
      quarantine_pre_control_status: null,
      quarantine_receipt_json: null,
      quarantined_at: null,
    });
    expect(normalizeLegacyRestoreRow("v2_legacy_migration_batches", {
      id: "unfinished-batch",
      status: "running",
    })).toMatchObject({ state_revision: 0, control_status: "paused" });
  });

  it("recovers the implicit historical supersession basis from activation ownership", () => {
    expect(normalizeLegacyRestoreRow("v2_legacy_source_mappings", {
      id: "source-only-before-supersede",
      status: "superseded",
      activation_batch_id: null,
    })).toMatchObject({ superseded_from_status: "source_only" });
    expect(normalizeLegacyRestoreRow("v2_legacy_source_mappings", {
      id: "projected-before-supersede",
      status: "superseded",
      activation_batch_id: "knowledge-batch",
    })).toMatchObject({ superseded_from_status: "projected" });
    expect(normalizeLegacyRestoreRow("v2_legacy_source_mappings", {
      id: "current",
      status: "projected",
      activation_batch_id: "knowledge-batch",
    })).toMatchObject({ superseded_from_status: null });
  });

  it("does not repair explicit current-schema values so validation can fail closed", () => {
    expect(normalizeLegacyRestoreRow("v2_legacy_migration_batches", {
      id: "invalid-current-batch",
      status: "succeeded",
      state_revision: -1,
      control_status: "invalid",
      quarantine_reason: "explicit",
    })).toMatchObject({
      state_revision: -1,
      control_status: "invalid",
      quarantine_reason: "explicit",
    });
    expect(normalizeLegacyRestoreRow("v2_legacy_source_mappings", {
      id: "invalid-current-mapping",
      status: "superseded",
      activation_batch_id: "knowledge-batch",
      superseded_from_status: null,
    })).toMatchObject({ superseded_from_status: null });
  });
});
