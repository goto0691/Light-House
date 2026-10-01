const LEGACY_BATCH_V2_027_NULLABLE_COLUMNS = [
  "quarantine_idempotency_key",
  "quarantine_reason",
  "quarantine_pre_status",
  "quarantine_pre_control_status",
  "quarantine_receipt_json",
  "quarantined_at",
] as const;

function hasOwn(row: Record<string, unknown>, column: string) {
  return Object.prototype.hasOwnProperty.call(row, column);
}

/**
 * Projects pre-0027 portable rows onto the current legacy-migration schema.
 *
 * Portable archives deliberately contain only the columns that existed when
 * they were created. SQLite defaults alone are not enough here: 0027 backfills
 * already-succeeded batches to `complete`, while a freshly inserted old row
 * would otherwise receive the `paused` default. The supersession basis was
 * likewise implicit before 0027: source-only mappings have no activation batch,
 * whereas mappings activated by a knowledge batch were projected.
 *
 * Explicit values are never repaired. A current-schema archive that contains
 * an invalid value must continue into normal validation and fail closed.
 */
export function normalizeLegacyRestoreRow(table: string, row: Record<string, unknown>) {
  const normalized = { ...row };

  if (table === "v2_legacy_migration_batches") {
    if (!hasOwn(normalized, "state_revision")) normalized.state_revision = 0;
    if (!hasOwn(normalized, "control_status")) {
      normalized.control_status = normalized.status === "succeeded" ? "complete" : "paused";
    }
    for (const column of LEGACY_BATCH_V2_027_NULLABLE_COLUMNS) {
      if (!hasOwn(normalized, column)) normalized[column] = null;
    }
  }

  if (table === "v2_legacy_source_mappings" && !hasOwn(normalized, "superseded_from_status")) {
    normalized.superseded_from_status = normalized.status === "superseded"
      ? normalized.activation_batch_id === null || normalized.activation_batch_id === undefined
        ? "source_only"
        : "projected"
      : null;
  }

  return normalized;
}
