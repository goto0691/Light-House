import { ulid } from "ulidx";

import { prepareLegacyCaptureCommit } from "@/lib/v2/domain/capture-source";
import { SourceCommitIdempotencyConflictError } from "@/lib/v2/domain/source-commit";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import {
  detectLegacyDamage,
  legacyIdentityValues,
  LEGACY_ADAPTER_BY_TABLE,
  validateAdapterCoverage,
  type LegacyAdapterV1,
  type LegacyProjectionDraft,
} from "@/lib/v2/migration/legacy-adapters-v1";
import { canonicalJson, sha256Hex } from "@/lib/v2/portability/portability-contract-v1";

type MigrationMode = "source_only" | "knowledge";
type MigrationControlStatus = "paused" | "active" | "quarantining" | "quarantined" | "complete";

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

type PreparedLegacyRow = Readonly<{
  legacyId: string;
  row: Record<string, unknown>;
  rowHash: string;
  damageCodes: readonly string[];
  projections: readonly LegacyProjectionDraft[];
  projectionHash: string;
}>;

type LegacyDryRun = Readonly<{
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

type DryRunSnapshot = Readonly<{
  adapter: LegacyAdapterV1;
  schemaSnapshot: string;
  rows: readonly PreparedLegacyRow[];
  dryRun: LegacyDryRun;
}>;

type ManifestEntry = Readonly<{
  legacyId: string;
  rowHash: string;
  projectionHash: string;
  projections: readonly Readonly<{ key: string; lifecycleStatus: "active" | "archived" }>[];
  expectedMappingCount: number;
}>;

type MigrationBatchRow = {
  id: string;
  user_id: string;
  legacy_table: string;
  adapter_version: string;
  mode: MigrationMode;
  dry_run_hash: string;
  schema_snapshot: string;
  manifest_json: string;
  input_rows: number;
  expected_mapping_count: number;
  next_offset: number;
  status: "approved" | "running" | "succeeded" | "stale" | "failed";
  reconciliation_status: "pending" | "passed" | "failed";
  reconciliation_json: string | null;
  summary_json: string;
  failure_code: string | null;
  created_at: string;
  approved_at: string;
  started_at: string | null;
  finished_at: string | null;
  reconciled_at: string | null;
  state_revision: number;
  control_status: MigrationControlStatus;
  quarantine_idempotency_key: string | null;
  quarantine_reason: string | null;
  quarantine_pre_status: string | null;
  quarantine_pre_control_status: string | null;
  quarantine_receipt_json: string | null;
  quarantined_at: string | null;
};

type MappingRow = {
  id: string;
  legacy_envelope_id: string;
  legacy_table: string;
  legacy_id: string;
  adapter_version: string;
  source_item_id: string | null;
  projected_object_id: string | null;
  projection_kind: string;
  status: string;
  superseded_from_status: string | null;
  target_lifecycle_status: string | null;
  activation_batch_id: string | null;
};

type QuarantineMappingRow = MappingRow & {
  superseded_at: string | null;
  superseded_by_mapping_id: string | null;
  source_exists: number;
  object_exists: number;
  object_lifecycle_status: string | null;
};

type RestoredMappingReceipt = Readonly<{
  mappingId: string;
  priorStatus: "source_only" | "projected";
  objectId: string;
  targetLifecycleStatus: string | null;
}>;

type LegacyQuarantineReceipt = Readonly<{
  version: 1;
  batchId: string;
  mode: MigrationMode;
  preStatus: MigrationBatchRow["status"];
  preControlStatus: Exclude<MigrationControlStatus, "quarantining" | "quarantined">;
  expectedRevision: number;
  idempotencyKey: string;
  reason: string;
  quarantinedAt: string;
  preservedItemCount: number;
  preservedEnvelopeCount: number;
  preservedMappingCount: number;
  preservedSourceCount: number;
  currentMappingsReverted: number;
  priorSourceOnlyRestored: number;
  priorProjectedRestored: number;
  archivedObjectCount: number;
  preservationGateTerminated: boolean;
  restoredMappings: readonly RestoredMappingReceipt[];
}>;

type ProjectionSnapshot = Readonly<{
  adapter: LegacyAdapterV1;
  prepared: PreparedLegacyRow;
  envelope: Readonly<{ id: string; rowHash: string; damageCodes: readonly string[]; replayed: boolean }>;
  now: string;
}>;

type AdapterSchemaSnapshot = Readonly<{
  adapter: LegacyAdapterV1;
  columns: readonly TableInfoRow[];
  coverage: ReturnType<typeof validateAdapterCoverage>;
  schemaSnapshot: string;
  rows: number;
}>;

type PreservationBasisEntry = Readonly<{
  table: string;
  adapterVersion: string;
  schemaSnapshot: string;
  dryRunHash: string;
  sourceBatchId: string;
  inputRows: number;
}>;

type PreservationGateRow = {
  id: string;
  user_id: string;
  target_batch_id: string;
  target_table: string;
  target_adapter_version: string;
  target_dry_run_hash: string;
  basis_hash: string;
  required_tables_json: string;
  next_table_position: number;
  next_row_offset: number;
  checked_rows: number;
  status: "checking" | "passed" | "failed";
  state_revision: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
  last_progress_at: string;
  finished_at: string | null;
};

type PreservationExpectedRow = {
  position: number;
  legacy_id: string;
  row_hash: string;
  projection_hash: string | null;
  projections_json: string | null;
  damage_codes_json: string;
  expected_mapping_count: number;
};

type KnowledgeMaterializationRow = Readonly<{
  row_kind: "assignment" | "property" | "evidence";
  id: string;
  user_id: string;
  owner_id: string | null;
  definition_id: string | null;
  role: string | null;
  source_class: string | null;
  review_status: string | null;
  locked_by_user: number | null;
  proposal_temp_id: string | null;
  value_kind: string | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: number | null;
  value_date: string | null;
  value_json: string | null;
  unit_key: string | null;
  claim_risk: string | null;
  confidence: number | null;
  confirmed_by_user_at: string | null;
  supersedes_value_id: string | null;
  processing_run_id: string | null;
  superseded_at: string | null;
  target_kind: string | null;
  target_id: string | null;
  source_item_id: string | null;
  locator_kind: string | null;
  locator_json: string | null;
}>;

const GLOBAL_METADATA_TABLES_PER_QUERY = 5;
const UNREGISTERED_TABLES_PER_QUERY = 50;
const PRESERVATION_ROWS_PER_ADVANCE = 16;
const PRESERVATION_TABLES_PER_ADVANCE = 4;
const PRESERVATION_LEASE_MILLISECONDS = 120_000;

// These tables are deliberately outside the legacy content archive. Keep the
// allowlist narrow: an unknown, non-empty table must stop knowledge promotion
// until an adapter (or an explicit exclusion here) is reviewed and shipped.
const LEGACY_AUTH_TABLE_EXCLUSIONS = new Set(["users", "sessions"]);
const LEGACY_SYSTEM_TABLE_EXCLUSIONS = new Set(["d1_migrations", "_cf_KV", "__drizzle_migrations"]);
const LEGACY_FTS_TABLE_ROOTS = ["zettels_fts", "tasks_fts", "people_fts", "media_fts", "daily_logs_fts"] as const;
const LEGACY_FTS_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"] as const;

function isSafelyExcludedLegacySourceTable(table: string) {
  return table.startsWith("sqlite_")
    || table.startsWith("v2_")
    || table.startsWith("_cf_")
    || table.startsWith("__drizzle_")
    || LEGACY_AUTH_TABLE_EXCLUSIONS.has(table)
    || LEGACY_SYSTEM_TABLE_EXCLUSIONS.has(table)
    || LEGACY_FTS_TABLE_ROOTS.some((root) => table === root || LEGACY_FTS_SHADOW_SUFFIXES.some((suffix) => table === `${root}${suffix}`));
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export class LegacyMigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LegacyMigrationError";
  }
}

function schemaSnapshotFor(adapter: LegacyAdapterV1, columns: readonly TableInfoRow[]) {
  return `legacy-schema:${sha256Hex(canonicalJson({ adapterVersion: adapter.version, columns }))}`;
}

function migrationMappingId(userId: string, envelopeId: string, adapterVersion: string, projectionKey: string) {
  return `legacy-map:${sha256Hex(`${userId}\0${envelopeId}\0${adapterVersion}\0${projectionKey}`).slice(0, 40)}`;
}

function preservationGateId(userId: string, targetBatchId: string) {
  return `legacy-gate:${sha256Hex(`${userId}\0${targetBatchId}`).slice(0, 40)}`;
}

function projectionTargets(row: PreparedLegacyRow) {
  return row.projections.length
    ? row.projections.map((projection) => ({ key: projection.key, lifecycleStatus: projection.lifecycleStatus }))
    : [{ key: "archived_only", lifecycleStatus: "archived" as const }];
}

function preservationBasisHash(entries: readonly PreservationBasisEntry[]) {
  return sha256Hex(canonicalJson(entries.map(({ sourceBatchId: _sourceBatchId, ...entry }) => entry)));
}

function parsePreservationBasis(value: string): readonly PreservationBasisEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LegacyMigrationError("legacy_preservation_gate_invalid", "Stored preservation gate tables are not valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.table !== "string"
      || typeof candidate.adapterVersion !== "string"
      || typeof candidate.schemaSnapshot !== "string"
      || typeof candidate.dryRunHash !== "string"
      || typeof candidate.sourceBatchId !== "string"
      || !Number.isInteger(candidate.inputRows)
      || Number(candidate.inputRows) < 0;
  })) {
    throw new LegacyMigrationError("legacy_preservation_gate_invalid", "Stored preservation gate tables have an invalid shape.");
  }
  const entries = parsed as PreservationBasisEntry[];
  if (new Set(entries.map((entry) => entry.table)).size !== entries.length) {
    throw new LegacyMigrationError("legacy_preservation_gate_invalid", "Stored preservation gate tables contain duplicates.");
  }
  return entries;
}

function parseManifest(value: string): readonly ManifestEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LegacyMigrationError("legacy_batch_manifest_invalid", "Stored migration manifest is not valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.legacyId !== "string"
      || typeof candidate.rowHash !== "string"
      || typeof candidate.projectionHash !== "string"
      || !Array.isArray(candidate.projections)
      || candidate.projections.length < 1
      || candidate.projections.some((projection) => !projection || typeof projection !== "object" || Array.isArray(projection) || typeof (projection as Record<string, unknown>).key !== "string" || !String((projection as Record<string, unknown>).key) || !["active", "archived"].includes(String((projection as Record<string, unknown>).lifecycleStatus)))
      || new Set(candidate.projections.map((projection) => String((projection as Record<string, unknown>).key))).size !== candidate.projections.length
      || !Number.isInteger(candidate.expectedMappingCount)
      || Number(candidate.expectedMappingCount) !== candidate.projections.length;
  })) {
    throw new LegacyMigrationError("legacy_batch_manifest_invalid", "Stored migration manifest has an invalid shape.");
  }
  return parsed as ManifestEntry[];
}

function parseDryRun(value: string): LegacyDryRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LegacyMigrationError("legacy_batch_manifest_invalid", "Stored dry-run summary is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { dryRunHash?: unknown }).dryRunHash !== "string") {
    throw new LegacyMigrationError("legacy_batch_manifest_invalid", "Stored dry-run summary has an invalid shape.");
  }
  return parsed as LegacyDryRun;
}

function parseQuarantineReceipt(value: string | null): LegacyQuarantineReceipt | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LegacyMigrationError("legacy_quarantine_receipt_invalid", "Stored quarantine receipt is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LegacyMigrationError("legacy_quarantine_receipt_invalid", "Stored quarantine receipt has an invalid shape.");
  }
  const candidate = parsed as Record<string, unknown>;
  const counts = ["expectedRevision", "preservedItemCount", "preservedEnvelopeCount", "preservedMappingCount", "preservedSourceCount", "currentMappingsReverted", "priorSourceOnlyRestored", "priorProjectedRestored", "archivedObjectCount"] as const;
  if (candidate.version !== 1
    || typeof candidate.batchId !== "string"
    || !["source_only", "knowledge"].includes(String(candidate.mode))
    || typeof candidate.preStatus !== "string"
    || !["paused", "active", "complete"].includes(String(candidate.preControlStatus))
    || typeof candidate.idempotencyKey !== "string"
    || typeof candidate.reason !== "string"
    || typeof candidate.quarantinedAt !== "string"
    || typeof candidate.preservationGateTerminated !== "boolean"
    || counts.some((key) => !Number.isInteger(candidate[key]) || Number(candidate[key]) < 0)
    || !Array.isArray(candidate.restoredMappings)
    || candidate.restoredMappings.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
      const restored = entry as Record<string, unknown>;
      return typeof restored.mappingId !== "string"
        || !["source_only", "projected"].includes(String(restored.priorStatus))
        || typeof restored.objectId !== "string"
        || !(restored.targetLifecycleStatus === null || typeof restored.targetLifecycleStatus === "string");
    })) {
    throw new LegacyMigrationError("legacy_quarantine_receipt_invalid", "Stored quarantine receipt has an invalid shape.");
  }
  return candidate as LegacyQuarantineReceipt;
}

export class D1LegacyMigrationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly userId: string, private readonly options: Readonly<{ legacyReadOnly?: boolean }> = {}) {
    if (!userId.trim()) throw new LegacyMigrationError("legacy_user_invalid", "A scoped migration repository requires a user ID.");
  }

  private adapter(table: string) {
    const adapter = LEGACY_ADAPTER_BY_TABLE.get(table);
    if (!adapter) throw new LegacyMigrationError("legacy_adapter_not_found", `No adapter exists for ${table}.`);
    return adapter;
  }

  private async adapterSchema(table: string) {
    const adapter = this.adapter(table);
    const columns = await this.db.prepare(`pragma table_info(${adapter.table})`).all<TableInfoRow>();
    const coverage = validateAdapterCoverage(adapter, columns.results.map((column) => column.name));
    return { adapter, columns: columns.results, coverage, schemaSnapshot: schemaSnapshotFor(adapter, columns.results) };
  }

  async adapterCoverage(table: string) {
    const schema = await this.adapterSchema(table);
    return { table, adapterVersion: schema.adapter.version, schemaSnapshot: schema.schemaSnapshot, ...schema.coverage };
  }

  private async presentAdapters() {
    const adapters = [...LEGACY_ADAPTER_BY_TABLE.values()];
    const rows = await this.db.prepare(`select name from sqlite_schema where type='table' order by name`).all<{ name: string }>();
    const present = new Set(rows.results.map((row) => row.name));
    const unknown = rows.results
      .map((row) => row.name)
      .filter((table) => !LEGACY_ADAPTER_BY_TABLE.has(table) && !isSafelyExcludedLegacySourceTable(table));
    for (let offset = 0; offset < unknown.length; offset += UNREGISTERED_TABLES_PER_QUERY) {
      const chunk = unknown.slice(offset, offset + UNREGISTERED_TABLES_PER_QUERY);
      const counts = await this.db.prepare(`select ${chunk.map((table, index) => `exists(select 1 from ${quoteIdentifier(table)} limit 1) as has_rows_${index}`).join(",")}`).first<Record<string, number>>();
      if (!counts) throw new LegacyMigrationError("legacy_inventory_invalid", "Unregistered legacy table counts could not be read.");
      const nonempty = chunk.filter((_, index) => Number(counts[`has_rows_${index}`] ?? 0) === 1);
      if (nonempty.length) {
        throw new LegacyMigrationError("legacy_unregistered_source_table", `Knowledge projection is locked because non-empty legacy tables have no registered adapter: ${nonempty.join(", ")}.`);
      }
    }
    return adapters.filter((adapter) => present.has(adapter.table));
  }

  private async rowCountsForAdapters(adapters: readonly LegacyAdapterV1[]) {
    if (!adapters.length) return new Map<string, number>();
    const selected = adapters.map((adapter, index) => `(select count(*) from ${adapter.scopeFrom ?? `${adapter.table} legacy`} where ${adapter.scopeUserColumn ?? "legacy.user_id"}=?) as count_${index}`).join(",");
    const row = await this.db.prepare(`select ${selected}`).bind(...adapters.map(() => this.userId)).first<Record<string, number>>();
    if (!row) throw new LegacyMigrationError("legacy_inventory_invalid", "Legacy row counts could not be read.");
    return new Map(adapters.map((adapter, index) => [adapter.table, Number(row[`count_${index}`] ?? 0)]));
  }

  private async columnsForAdapters(adapters: readonly LegacyAdapterV1[]) {
    const columnsByTable = new Map<string, TableInfoRow[]>();
    for (let offset = 0; offset < adapters.length; offset += GLOBAL_METADATA_TABLES_PER_QUERY) {
      const chunk = adapters.slice(offset, offset + GLOBAL_METADATA_TABLES_PER_QUERY);
      const query = chunk
        .map((adapter) => `select '${adapter.table}' as table_name,cid,name,type,[notnull] as not_null,dflt_value,pk from pragma_table_info('${adapter.table}')`)
        .join(" union all ");
      const loaded = await this.db.prepare(query).all<Omit<TableInfoRow, "notnull"> & { table_name: string; not_null: number }>();
      for (const column of loaded.results) {
        const existing = columnsByTable.get(column.table_name) ?? [];
        existing.push({ cid: column.cid, name: column.name, type: column.type, notnull: column.not_null, dflt_value: column.dflt_value, pk: column.pk });
        columnsByTable.set(column.table_name, existing);
      }
    }
    return columnsByTable;
  }

  private async inventorySnapshot(): Promise<readonly AdapterSchemaSnapshot[]> {
    const adapters = [...LEGACY_ADAPTER_BY_TABLE.values()];
    const columnsByTable = await this.columnsForAdapters(adapters);
    const present = adapters.filter((adapter) => (columnsByTable.get(adapter.table)?.length ?? 0) > 0);
    const counts = await this.rowCountsForAdapters(present);
    return adapters.map((adapter) => {
      const columns = columnsByTable.get(adapter.table) ?? [];
      return {
        adapter,
        columns,
        coverage: validateAdapterCoverage(adapter, columns.map((column) => column.name)),
        schemaSnapshot: schemaSnapshotFor(adapter, columns),
        rows: counts.get(adapter.table) ?? 0,
      };
    });
  }

  async inventory() {
    return (await this.inventorySnapshot()).map((item) => ({
      table: item.adapter.table,
      adapterVersion: item.adapter.version,
      schemaSnapshot: item.schemaSnapshot,
      ...item.coverage,
      rows: item.rows,
    }));
  }

  private legacyIdFromRow(adapter: LegacyAdapterV1, row: Readonly<Record<string, unknown>>, rowid: unknown) {
    const columns = adapter.identityColumns ?? ["id"];
    const values = columns.map((column) => column === "rowid" ? rowid : row[column]);
    if (values.some((value) => value === null || value === undefined || (typeof value !== "string" && typeof value !== "number"))) {
      throw new LegacyMigrationError("legacy_identity_invalid", `Legacy identity is invalid for ${adapter.table}.`);
    }
    return columns.length === 1 ? String(values[0]) : canonicalJson(values);
  }

  private prepareRow(adapter: LegacyAdapterV1, legacyId: string, row: Record<string, unknown>): PreparedLegacyRow {
    const rowHash = sha256Hex(canonicalJson(row));
    const projections = adapter.project(row);
    const projectionKeys = projections.map((projection) => projection.key);
    if (new Set(projectionKeys).size !== projectionKeys.length) throw new LegacyMigrationError("legacy_projection_duplicate", `Adapter ${adapter.version} produced duplicate projection keys for ${legacyId}.`);
    for (const projection of projections) {
      const propertyKeys = projection.properties.map((property) => property.key);
      if (new Set(propertyKeys).size !== propertyKeys.length) throw new LegacyMigrationError("legacy_property_duplicate", `Adapter ${adapter.version} produced duplicate property keys for ${legacyId}:${projection.key}.`);
    }
    return {
      legacyId,
      row,
      rowHash,
      damageCodes: detectLegacyDamage(adapter, row),
      projections,
      projectionHash: sha256Hex(canonicalJson(projections)),
    };
  }

  private dryRunSnapshotFromRows(adapter: LegacyAdapterV1, schemaSnapshot: string, loadedRows: readonly Record<string, unknown>[]): DryRunSnapshot {
    if (loadedRows.length > 5_000) throw new LegacyMigrationError("legacy_dry_run_limit", "A single table dry-run is limited to 5,000 rows.");
    const rows = loadedRows.map((raw) => {
      const row = { ...raw };
      const identityRowid = row.__legacy_identity_rowid;
      delete row.__legacy_identity_rowid;
      const legacyId = this.legacyIdFromRow(adapter, row, identityRowid);
      return this.prepareRow(adapter, legacyId, row);
    }).sort((left, right) => left.legacyId < right.legacyId ? -1 : left.legacyId > right.legacyId ? 1 : 0);
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.legacyId)) throw new LegacyMigrationError("legacy_identity_duplicate", `Adapter ${adapter.version} produced duplicate identity ${row.legacyId}.`);
      seen.add(row.legacyId);
    }
    const damageCodes: Record<string, number> = {};
    let projectedDocuments = 0;
    let archivedRows = 0;
    for (const row of rows) {
      projectedDocuments += row.projections.length;
      if (!row.projections.length) archivedRows += 1;
      for (const code of row.damageCodes) damageCodes[code] = (damageCodes[code] ?? 0) + 1;
    }
    const basis = {
      table: adapter.table,
      adapterVersion: adapter.version,
      schemaSnapshot,
      inputRows: rows.length,
      projectedDocuments,
      archivedRows,
      expectedMappingCount: projectedDocuments + archivedRows,
      damageCodes,
      rowsRootHash: sha256Hex(rows.map((row) => `${row.legacyId}\0${row.rowHash}`).join("\n")),
      projectionRootHash: sha256Hex(rows.map((row) => `${row.legacyId}\0${row.projectionHash}`).join("\n")),
    };
    const dryRun = { ...basis, dryRunHash: sha256Hex(canonicalJson(basis)) };
    return { adapter, schemaSnapshot, rows, dryRun };
  }

  private async buildDryRunSnapshot(table: string): Promise<DryRunSnapshot> {
    const schema = await this.adapterSchema(table);
    if (!schema.coverage.valid) throw new LegacyMigrationError("legacy_adapter_coverage_invalid", `Adapter ${schema.adapter.version} has uncovered columns.`);
    const identityColumns = schema.adapter.identityColumns ?? ["id"];
    const needsRowid = identityColumns.includes("rowid");
    const order = identityColumns.map((column) => `legacy.${column}`).join(",");
    const selected = `legacy.*${needsRowid ? ",legacy.rowid as __legacy_identity_rowid" : ""}`;
    const loaded = await this.db.prepare(`select ${selected} from ${schema.adapter.scopeFrom ?? `${schema.adapter.table} legacy`} where ${schema.adapter.scopeUserColumn ?? "legacy.user_id"}=? order by ${order} limit 5001`).bind(this.userId).all<Record<string, unknown>>();
    return this.dryRunSnapshotFromRows(schema.adapter, schema.schemaSnapshot, loaded.results);
  }

  async createDryRun(table: string) {
    return (await this.buildDryRunSnapshot(table)).dryRun;
  }

  private async readScopedRow(table: string, legacyId: string) {
    const schema = await this.adapterSchema(table);
    if (!schema.coverage.valid) throw new LegacyMigrationError("legacy_adapter_coverage_invalid", `Adapter ${schema.adapter.version} has uncovered columns.`);
    const identityColumns = schema.adapter.identityColumns ?? ["id"];
    let identityValues: readonly unknown[];
    try {
      identityValues = legacyIdentityValues(schema.adapter, legacyId);
    } catch {
      throw new LegacyMigrationError("legacy_identity_invalid", `Legacy identity is invalid for ${table}.`);
    }
    const identityWhere = identityColumns.map((column) => `legacy.${column}=?`).join(" and ");
    const needsRowid = identityColumns.includes("rowid");
    const selected = `legacy.*${needsRowid ? ",legacy.rowid as __legacy_identity_rowid" : ""}`;
    const rows = await this.db.prepare(`select ${selected} from ${schema.adapter.scopeFrom ?? `${schema.adapter.table} legacy`} where ${identityWhere} and ${schema.adapter.scopeUserColumn ?? "legacy.user_id"}=? limit 2`).bind(...identityValues, this.userId).all<Record<string, unknown>>();
    if (!rows.results.length) throw new LegacyMigrationError("legacy_row_not_found", "Legacy row was not found in this user scope.");
    if (rows.results.length > 1) throw new LegacyMigrationError("legacy_identity_duplicate", `Legacy identity ${legacyId} is not unique in ${table}.`);
    const row = { ...rows.results[0] };
    delete row.__legacy_identity_rowid;
    return { adapter: schema.adapter, schemaSnapshot: schema.schemaSnapshot, prepared: this.prepareRow(schema.adapter, legacyId, row) };
  }

  private async ensureEnvelope(input: { adapter: LegacyAdapterV1; prepared: PreparedLegacyRow; schemaSnapshot: string; importBatchId: string; now: string }) {
    const existing = await this.db.prepare(`select id from v2_legacy_source_envelopes where user_id=? and legacy_table=? and legacy_id=? and row_hash=? and schema_snapshot=? limit 1`).bind(this.userId, input.adapter.table, input.prepared.legacyId, input.prepared.rowHash, input.schemaSnapshot).first<{ id: string }>();
    if (existing) return { id: existing.id, rowHash: input.prepared.rowHash, damageCodes: input.prepared.damageCodes, replayed: true };
    const candidateId = ulid();
    await this.db.prepare(`insert or ignore into v2_legacy_source_envelopes (id,user_id,legacy_table,legacy_id,row_json,row_hash,captured_at,schema_snapshot,damage_codes_json,import_batch_id) values (?,?,?,?,?,?,?,?,?,?)`).bind(candidateId, this.userId, input.adapter.table, input.prepared.legacyId, canonicalJson(input.prepared.row), input.prepared.rowHash, input.now, input.schemaSnapshot, canonicalJson(input.prepared.damageCodes), input.importBatchId).run();
    const saved = await this.db.prepare(`select id from v2_legacy_source_envelopes where user_id=? and legacy_table=? and legacy_id=? and row_hash=? and schema_snapshot=? limit 1`).bind(this.userId, input.adapter.table, input.prepared.legacyId, input.prepared.rowHash, input.schemaSnapshot).first<{ id: string }>();
    if (!saved) throw new LegacyMigrationError("legacy_envelope_incomplete", "The immutable legacy envelope was not stored.");
    return { id: saved.id, rowHash: input.prepared.rowHash, damageCodes: input.prepared.damageCodes, replayed: saved.id !== candidateId };
  }

  private async loadBatch(importBatchId: string) {
    return this.db.prepare(`select * from v2_legacy_migration_batches where id=? and user_id=? limit 1`).bind(importBatchId, this.userId).first<MigrationBatchRow>();
  }

  private batchView(batch: MigrationBatchRow) {
    const receipt = parseQuarantineReceipt(batch.quarantine_receipt_json);
    if (batch.control_status === "quarantined" && (!receipt
      || receipt.batchId !== batch.id
      || receipt.idempotencyKey !== batch.quarantine_idempotency_key
      || receipt.reason !== batch.quarantine_reason
      || receipt.preStatus !== batch.quarantine_pre_status
      || receipt.preControlStatus !== batch.quarantine_pre_control_status
      || receipt.quarantinedAt !== batch.quarantined_at)) {
      throw new LegacyMigrationError("legacy_quarantine_receipt_invalid", "The quarantined batch is missing its authoritative receipt.");
    }
    return {
      id: batch.id,
      table: batch.legacy_table,
      adapterVersion: batch.adapter_version,
      mode: batch.mode,
      dryRunHash: batch.dry_run_hash,
      inputRows: batch.input_rows,
      expectedMappingCount: batch.expected_mapping_count,
      nextOffset: batch.next_offset,
      status: batch.status,
      controlStatus: batch.control_status,
      stateRevision: batch.state_revision,
      reconciliationStatus: batch.reconciliation_status,
      failureCode: batch.failure_code,
      createdAt: batch.created_at,
      approvedAt: batch.approved_at,
      startedAt: batch.started_at,
      finishedAt: batch.finished_at,
      reconciledAt: batch.reconciled_at,
      quarantine: receipt === null ? null : {
        idempotencyKey: batch.quarantine_idempotency_key,
        reason: batch.quarantine_reason,
        preStatus: batch.quarantine_pre_status,
        preControlStatus: batch.quarantine_pre_control_status,
        quarantinedAt: batch.quarantined_at,
        receipt,
      },
    };
  }

  async listBatches(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new LegacyMigrationError("legacy_batch_list_limit_invalid", "Migration batch list limit must be between 1 and 100.");
    }
    const rows = await this.db.prepare(`select * from v2_legacy_migration_batches where user_id=? order by created_at desc,id desc limit ?`).bind(this.userId, limit).all<MigrationBatchRow>();
    return rows.results.map((batch) => this.batchView(batch));
  }

  async getBatchView(importBatchId: string) {
    const batch = await this.loadBatch(importBatchId);
    if (!batch) throw new LegacyMigrationError("legacy_batch_not_found", "Migration batch was not found.");
    const gate = await this.loadPreservationGate(importBatchId);
    return {
      batch: this.batchView(batch),
      reconciliation: await this.reconcileBatch(importBatchId),
      preservationGate: gate ? this.preservationGateView(gate) : null,
    };
  }

  private validateBatchContract(batch: MigrationBatchRow, input: { table: string; mode: MigrationMode; expectedDryRunHash: string }) {
    if (batch.legacy_table !== input.table || batch.mode !== input.mode || batch.dry_run_hash !== input.expectedDryRunHash) {
      throw new LegacyMigrationError("legacy_batch_contract_conflict", "The migration batch is already bound to a different approved dry-run.");
    }
    const adapter = this.adapter(input.table);
    if (batch.adapter_version !== adapter.version) throw new LegacyMigrationError("legacy_batch_contract_conflict", "The migration adapter changed after this batch was approved.");
    if (batch.control_status === "quarantined") throw new LegacyMigrationError("legacy_batch_quarantined_conflict", "The migration batch is quarantined and cannot continue.");
    if (batch.status === "stale") throw new LegacyMigrationError("legacy_dry_run_changed", "The approved legacy source changed while the batch was running.");
    if (batch.status === "failed") throw new LegacyMigrationError("legacy_batch_conflict", "The migration batch is marked failed and cannot continue.");
    if (batch.status === "succeeded" && (batch.reconciliation_status !== "passed" || !batch.reconciliation_json || !batch.reconciled_at)) throw new LegacyMigrationError("legacy_batch_incomplete", "A succeeded migration batch is missing its verified reconciliation receipt.");
    if (batch.status === "succeeded" ? batch.control_status !== "complete" : batch.control_status !== "active") {
      throw new LegacyMigrationError("legacy_batch_control_inactive", "The migration batch control state does not permit execution.");
    }
  }

  private async loadPreservationGate(targetBatchId: string) {
    return this.db.prepare(`select * from v2_legacy_preservation_gates where user_id=? and target_batch_id=? limit 1`).bind(this.userId, targetBatchId).first<PreservationGateRow>();
  }

  private preservationGateView(gate: PreservationGateRow) {
    const required = parsePreservationBasis(gate.required_tables_json);
    const rowsTotal = required.reduce((sum, entry) => sum + entry.inputRows, 0);
    return {
      gateId: gate.id,
      status: gate.status,
      stateRevision: gate.state_revision,
      tablesChecked: Math.min(gate.next_table_position, required.length),
      tablesTotal: required.length,
      rowsChecked: gate.checked_rows,
      rowsTotal,
      currentTable: gate.status === "checking" ? required[gate.next_table_position]?.table ?? null : null,
      currentRowOffset: gate.status === "checking" ? gate.next_row_offset : 0,
      failureCode: gate.failure_code,
      failureDetail: gate.failure_detail,
      createdAt: gate.created_at,
      lastProgressAt: gate.last_progress_at,
      finishedAt: gate.finished_at,
    };
  }

  private validatePreservationGateContract(gate: PreservationGateRow, input: { table: string; importBatchId: string; expectedDryRunHash: string }) {
    const adapter = this.adapter(input.table);
    const required = parsePreservationBasis(gate.required_tables_json);
    if (gate.user_id !== this.userId
      || gate.target_batch_id !== input.importBatchId
      || gate.target_table !== input.table
      || gate.target_adapter_version !== adapter.version
      || gate.target_dry_run_hash !== input.expectedDryRunHash
      || gate.basis_hash !== preservationBasisHash(required)) {
      throw new LegacyMigrationError("legacy_preservation_gate_conflict", "The knowledge batch ID is already bound to another source-preservation gate.");
    }
    if (gate.status === "failed") {
      throw new LegacyMigrationError(gate.failure_code ?? "legacy_source_preservation_incomplete", gate.failure_detail ?? "The source-preservation gate failed.");
    }
    return required;
  }

  private async buildPreservationBasis(input: { table: string; expectedDryRunHash: string }) {
    const present = await this.presentAdapters();
    const counts = await this.rowCountsForAdapters(present);
    const targetAdapter = this.adapter(input.table);
    if (!present.some((adapter) => adapter.table === targetAdapter.table)) {
      throw new LegacyMigrationError("legacy_source_only_incomplete", "The approved legacy table is no longer present.");
    }
    const completed = await this.db.prepare(`select id,legacy_table,adapter_version,dry_run_hash,schema_snapshot,input_rows from v2_legacy_migration_batches where user_id=? and mode='source_only' and status='succeeded' and control_status='complete' and reconciliation_status='passed' and reconciliation_json is not null and reconciled_at is not null order by finished_at desc,id desc`).bind(this.userId).all<{
      id: string;
      legacy_table: string;
      adapter_version: string;
      dry_run_hash: string;
      schema_snapshot: string;
      input_rows: number;
    }>();
    const selected = new Map<string, (typeof completed.results)[number]>();
    for (const batch of completed.results) {
      const adapter = LEGACY_ADAPTER_BY_TABLE.get(batch.legacy_table);
      if (adapter?.version === batch.adapter_version && !selected.has(batch.legacy_table)) selected.set(batch.legacy_table, batch);
    }
    const selectedTarget = selected.get(targetAdapter.table);
    if (!selectedTarget || selectedTarget.dry_run_hash !== input.expectedDryRunHash) {
      throw new LegacyMigrationError("legacy_source_only_incomplete", "Knowledge projection requires a reconciled source-only batch for the current dry-run.");
    }
    const requiredAdapters = present.filter((adapter) => (counts.get(adapter.table) ?? 0) > 0);
    const checkedAdapters = requiredAdapters.some((adapter) => adapter.table === targetAdapter.table) ? requiredAdapters : [...requiredAdapters, targetAdapter];
    const missing = checkedAdapters.filter((adapter) => !selected.has(adapter.table));
    if (missing.length) {
      throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Knowledge projection is locked until every non-empty legacy table has a reconciled source-only batch: ${missing.map((adapter) => adapter.table).join(", ")}.`);
    }
    const columnsByTable = await this.columnsForAdapters(checkedAdapters);
    const entries = checkedAdapters.map((adapter): PreservationBasisEntry => {
      const batch = selected.get(adapter.table)!;
      const columns = columnsByTable.get(adapter.table) ?? [];
      const coverage = validateAdapterCoverage(adapter, columns.map((column) => column.name));
      const currentRows = counts.get(adapter.table) ?? 0;
      if (!coverage.valid || schemaSnapshotFor(adapter, columns) !== batch.schema_snapshot) {
        throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy schema changed after source preservation: ${adapter.table}.`);
      }
      if (currentRows !== batch.input_rows) {
        throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy row count changed after source preservation: ${adapter.table}.`);
      }
      return {
        table: adapter.table,
        adapterVersion: adapter.version,
        schemaSnapshot: batch.schema_snapshot,
        dryRunHash: batch.dry_run_hash,
        sourceBatchId: batch.id,
        inputRows: currentRows,
      };
    }).sort((left, right) => left.table.localeCompare(right.table));
    return entries;
  }

  private async initializePreservationGate(input: { table: string; importBatchId: string; expectedDryRunHash: string }, now: string) {
    const entries = await this.buildPreservationBasis(input);
    const adapter = this.adapter(input.table);
    const gateId = preservationGateId(this.userId, input.importBatchId);
    const basisHash = preservationBasisHash(entries);
    await this.db.prepare(`insert or ignore into v2_legacy_preservation_gates (id,user_id,target_batch_id,target_table,target_adapter_version,target_dry_run_hash,basis_hash,required_tables_json,next_table_position,next_row_offset,checked_rows,status,state_revision,created_at,last_progress_at) values (?,?,?,?,?,?,?, ?,0,0,0,'checking',0,?,?)`)
      .bind(gateId, this.userId, input.importBatchId, input.table, adapter.version, input.expectedDryRunHash, basisHash, canonicalJson(entries), now, now).run();
    const gate = await this.loadPreservationGate(input.importBatchId);
    if (!gate) throw new LegacyMigrationError("legacy_preservation_gate_incomplete", "The source-preservation gate could not be stored.");
    this.validatePreservationGateContract(gate, input);
    return gate;
  }

  private async claimPreservationGate(gate: PreservationGateRow, now: string) {
    const token = crypto.randomUUID();
    const parsedNow = Date.parse(now);
    const leaseBase = Number.isFinite(parsedNow) ? parsedNow : Date.now();
    const expiresAt = new Date(leaseBase + PRESERVATION_LEASE_MILLISECONDS).toISOString();
    await this.db.prepare(`update v2_legacy_preservation_gates set lease_token=?,lease_expires_at=? where id=? and user_id=? and status='checking' and state_revision=? and (lease_token is null or lease_expires_at<=?)`)
      .bind(token, expiresAt, gate.id, this.userId, gate.state_revision, now).run();
    const claimed = await this.loadPreservationGate(gate.target_batch_id);
    if (!claimed || claimed.lease_token !== token) throw new LegacyMigrationError("legacy_preservation_gate_busy", "Another request is advancing the source-preservation gate.");
    return { gate: claimed, token };
  }

  private async failPreservationGate(gate: PreservationGateRow, token: string, error: LegacyMigrationError, now: string) {
    await this.db.prepare(`update v2_legacy_preservation_gates set status='failed',failure_code=?,failure_detail=?,state_revision=state_revision+1,last_progress_at=?,finished_at=?,lease_token=null,lease_expires_at=null where id=? and user_id=? and status='checking' and lease_token=?`)
      .bind(error.code, error.message.slice(0, 500), now, now, gate.id, this.userId, token).run();
  }

  private async advancePreservationGate(gate: PreservationGateRow, input: { table: string; importBatchId: string; expectedDryRunHash: string }, now: string) {
    const required = this.validatePreservationGateContract(gate, input);
    if (gate.status === "passed") return gate;
    const claimed = await this.claimPreservationGate(gate, now);
    let tablePosition = claimed.gate.next_table_position;
    let rowOffset = claimed.gate.next_row_offset;
    let checkedRows = claimed.gate.checked_rows;
    let rowsRemaining = PRESERVATION_ROWS_PER_ADVANCE;
    let tablesRemaining = PRESERVATION_TABLES_PER_ADVANCE;
    try {
      const expectedCheckedRows = required.slice(0, tablePosition).reduce((sum, entry) => sum + entry.inputRows, 0) + rowOffset;
      if (tablePosition < 0
        || tablePosition > required.length
        || rowOffset < 0
        || tablePosition === required.length && rowOffset !== 0
        || tablePosition < required.length && rowOffset > required[tablePosition].inputRows
        || checkedRows !== expectedCheckedRows) {
        throw new LegacyMigrationError("legacy_preservation_gate_invalid", "Stored source-preservation progress is inconsistent.");
      }
      while (tablePosition < required.length && rowsRemaining > 0 && tablesRemaining > 0) {
        const entry = required[tablePosition];
        const schema = await this.adapterSchema(entry.table);
        if (!schema.coverage.valid || schema.adapter.version !== entry.adapterVersion || schema.schemaSnapshot !== entry.schemaSnapshot) {
          throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy schema changed while the preservation gate was running: ${entry.table}.`);
        }
        const take = Math.min(rowsRemaining, entry.inputRows - rowOffset);
        if (take > 0) {
          const identityColumns = schema.adapter.identityColumns ?? ["id"];
          const needsRowid = identityColumns.includes("rowid");
          const selected = `legacy.*${needsRowid ? ",legacy.rowid as __legacy_identity_rowid" : ""}`;
          const expected = await this.db.prepare(`select i.position,i.legacy_id,i.row_hash,i.projection_hash,i.projections_json,e.damage_codes_json,i.expected_mapping_count from v2_legacy_migration_batch_items i join v2_legacy_migration_batches b on b.id=i.batch_id and b.user_id=i.user_id join v2_legacy_source_envelopes e on e.id=i.legacy_envelope_id and e.user_id=i.user_id and e.legacy_table=b.legacy_table and e.legacy_id=i.legacy_id and e.row_hash=i.row_hash and e.schema_snapshot=b.schema_snapshot where i.batch_id=? and i.user_id=? and i.position>=? and i.position<? and i.status='succeeded' and b.mode='source_only' and b.status='succeeded' and b.control_status='complete' and b.reconciliation_status='passed' and b.adapter_version=? and b.dry_run_hash=? and b.schema_snapshot=? order by i.position`)
            .bind(entry.sourceBatchId, this.userId, rowOffset, rowOffset + take, entry.adapterVersion, entry.dryRunHash, entry.schemaSnapshot).all<PreservationExpectedRow>();
          if (expected.results.length !== take) {
            throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy rows no longer match the preserved source batch: ${entry.table}.`);
          }
          const identityBindings: unknown[] = [];
          const identityTerms = expected.results.map((source) => {
            let values: readonly unknown[];
            try {
              values = legacyIdentityValues(schema.adapter, source.legacy_id);
            } catch {
              throw new LegacyMigrationError("legacy_source_preservation_incomplete", `A preserved legacy identity is invalid: ${entry.table}.`);
            }
            identityBindings.push(...values);
            return `(${identityColumns.map((column) => `${column === "rowid" ? "legacy.rowid" : `legacy.${quoteIdentifier(column)}`}=?`).join(" and ")})`;
          });
          const current = await this.db.prepare(`select ${selected} from ${schema.adapter.scopeFrom ?? `${schema.adapter.table} legacy`} where ${schema.adapter.scopeUserColumn ?? "legacy.user_id"}=? and (${identityTerms.join(" or ")}) limit ?`)
            .bind(this.userId, ...identityBindings, take + 1).all<Record<string, unknown>>();
          if (current.results.length !== take) {
            throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy rows no longer match the preserved source batch: ${entry.table}.`);
          }
          const currentById = new Map<string, PreparedLegacyRow>();
          for (const loaded of current.results) {
            const raw = { ...loaded };
            const identityRowid = raw.__legacy_identity_rowid;
            delete raw.__legacy_identity_rowid;
            const legacyId = this.legacyIdFromRow(schema.adapter, raw, identityRowid);
            if (currentById.has(legacyId)) throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy identity is no longer unique: ${entry.table}:${legacyId}.`);
            currentById.set(legacyId, this.prepareRow(schema.adapter, legacyId, raw));
          }
          for (let index = 0; index < take; index += 1) {
            const source = expected.results[index];
            const prepared = currentById.get(source.legacy_id);
            let expectedTargets: unknown;
            try {
              expectedTargets = source.projections_json === null ? null : JSON.parse(source.projections_json);
            } catch {
              expectedTargets = null;
            }
            if (!prepared) throw new LegacyMigrationError("legacy_source_preservation_incomplete", `A preserved legacy row is missing: ${entry.table}:${source.legacy_id}.`);
            const targets = projectionTargets(prepared);
            if (source.position !== rowOffset + index
              || source.legacy_id !== prepared.legacyId
              || source.row_hash !== prepared.rowHash
              || source.projection_hash !== prepared.projectionHash
              || source.damage_codes_json !== canonicalJson(prepared.damageCodes)
              || source.expected_mapping_count !== targets.length
              || expectedTargets === null
              || canonicalJson(expectedTargets) !== canonicalJson(targets)) {
              throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy row or projection changed after source preservation: ${entry.table}:${prepared.legacyId}.`);
            }
          }
          rowOffset += take;
          checkedRows += take;
          rowsRemaining -= take;
        }
        if (rowOffset === entry.inputRows) {
          const currentCount = await this.rowCountsForAdapters([schema.adapter]);
          if ((currentCount.get(entry.table) ?? 0) !== entry.inputRows) {
            throw new LegacyMigrationError("legacy_source_preservation_incomplete", `Legacy row count changed while the preservation gate was running: ${entry.table}.`);
          }
          tablePosition += 1;
          rowOffset = 0;
          tablesRemaining -= 1;
        }
      }
      let status: PreservationGateRow["status"] = "checking";
      if (tablePosition === required.length) {
        const currentBasis = await this.buildPreservationBasis(input);
        if (preservationBasisHash(currentBasis) !== claimed.gate.basis_hash) {
          throw new LegacyMigrationError("legacy_source_preservation_incomplete", "Legacy inventory changed while the preservation gate was running.");
        }
        status = "passed";
      }
      await this.db.prepare(`update v2_legacy_preservation_gates set next_table_position=?,next_row_offset=?,checked_rows=?,status=?,state_revision=state_revision+1,last_progress_at=?,finished_at=case when ?='passed' then ? else finished_at end,failure_code=null,failure_detail=null,lease_token=null,lease_expires_at=null where id=? and user_id=? and status='checking' and state_revision=? and lease_token=?`)
        .bind(tablePosition, rowOffset, checkedRows, status, now, status, now, claimed.gate.id, this.userId, claimed.gate.state_revision, claimed.token).run();
      const progressed = await this.loadPreservationGate(input.importBatchId);
      if (!progressed || progressed.state_revision !== claimed.gate.state_revision + 1 || progressed.lease_token !== null) {
        throw new LegacyMigrationError("legacy_preservation_gate_conflict", "Source-preservation progress changed concurrently.");
      }
      this.validatePreservationGateContract(progressed, input);
      return progressed;
    } catch (error) {
      if (error instanceof LegacyMigrationError && error.code !== "legacy_preservation_gate_busy" && error.code !== "legacy_preservation_gate_conflict") {
        await this.failPreservationGate(claimed.gate, claimed.token, error, now);
      } else {
        await this.db.prepare(`update v2_legacy_preservation_gates set lease_token=null,lease_expires_at=null where id=? and user_id=? and lease_token=?`).bind(claimed.gate.id, this.userId, claimed.token).run();
      }
      throw error;
    }
  }

  private async requireSourcePreservationGate(input: { table: string; importBatchId: string; expectedDryRunHash: string }, now: string) {
    if (!this.options.legacyReadOnly) throw new LegacyMigrationError("legacy_source_not_locked", "Legacy writes must be disabled before source preservation or knowledge projection.");
    let gate = await this.loadPreservationGate(input.importBatchId);
    if (!gate) gate = await this.initializePreservationGate(input, now);
    gate = await this.advancePreservationGate(gate, input, now);
    if (gate.status !== "passed") return { complete: false as const, gate: this.preservationGateView(gate) };
    const target = await this.buildDryRunSnapshot(input.table);
    if (target.dryRun.dryRunHash !== input.expectedDryRunHash) {
      throw new LegacyMigrationError("legacy_source_only_incomplete", "Knowledge projection requires the current reconciled source-only snapshot.");
    }
    return { complete: true as const, gate: this.preservationGateView(gate), target };
  }

  private async approveBatch(input: { table: string; importBatchId: string; mode: MigrationMode; expectedDryRunHash: string }, snapshot: DryRunSnapshot, now: string) {
    if (!input.importBatchId.trim() || input.importBatchId.length > 128) throw new LegacyMigrationError("legacy_batch_id_invalid", "Migration batch ID must contain 1 to 128 characters.");
    const manifest: ManifestEntry[] = snapshot.rows.map((row) => {
      const projections = row.projections.length ? row.projections.map((projection) => ({ key: projection.key, lifecycleStatus: projection.lifecycleStatus })) : [{ key: "archived_only", lifecycleStatus: "archived" as const }];
      return { legacyId: row.legacyId, rowHash: row.rowHash, projectionHash: row.projectionHash, projections, expectedMappingCount: projections.length };
    });
    await this.db.prepare(`insert or ignore into v2_legacy_migration_batches (id,user_id,legacy_table,adapter_version,mode,dry_run_hash,schema_snapshot,manifest_json,input_rows,expected_mapping_count,next_offset,status,summary_json,created_at,approved_at,control_status,state_revision) values (?,?,?,?,?,?,?,?,?,?,0,'approved',?,?,?,'active',0)`).bind(input.importBatchId, this.userId, input.table, snapshot.adapter.version, input.mode, input.expectedDryRunHash, snapshot.schemaSnapshot, canonicalJson(manifest), snapshot.dryRun.inputRows, snapshot.dryRun.expectedMappingCount, canonicalJson(snapshot.dryRun), now, now).run();
    const batch = await this.loadBatch(input.importBatchId);
    if (!batch) throw new LegacyMigrationError("legacy_batch_contract_conflict", "Migration batch ID is unavailable.");
    this.validateBatchContract(batch, input);
    if (batch.schema_snapshot !== snapshot.schemaSnapshot || batch.manifest_json !== canonicalJson(manifest)) throw new LegacyMigrationError("legacy_batch_contract_conflict", "The stored migration manifest differs from the approved dry-run.");
    return batch;
  }

  private async markBatchStale(importBatchId: string, code: string) {
    await this.db.prepare(`update v2_legacy_migration_batches set status='stale',control_status='paused',state_revision=state_revision+1,failure_code=? where id=? and user_id=? and status<>'succeeded' and control_status='active'`).bind(code, importBatchId, this.userId).run();
  }

  private async ensureBatchItem(input: { batch: MigrationBatchRow; entry: ManifestEntry; position: number; envelopeId: string }) {
    const projectionsJson = canonicalJson(input.entry.projections);
    await this.db.prepare(`insert or ignore into v2_legacy_migration_batch_items (batch_id,user_id,position,legacy_envelope_id,legacy_id,row_hash,projection_hash,projections_json,expected_mapping_count,status,processed_at) select ?,?,?,?,?,?,?,?,?,'pending',null where exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.control_status='active' and b.status in ('approved','running'))`).bind(input.batch.id, this.userId, input.position, input.envelopeId, input.entry.legacyId, input.entry.rowHash, input.entry.projectionHash, projectionsJson, input.entry.expectedMappingCount, input.batch.id, this.userId).run();
    const item = await this.db.prepare(`select legacy_envelope_id,legacy_id,row_hash,projection_hash,projections_json,expected_mapping_count,status from v2_legacy_migration_batch_items where batch_id=? and user_id=? and position=? limit 1`).bind(input.batch.id, this.userId, input.position).first<{ legacy_envelope_id: string; legacy_id: string; row_hash: string; projection_hash: string | null; projections_json: string | null; expected_mapping_count: number; status: string }>();
    if (!item || item.legacy_envelope_id !== input.envelopeId || item.legacy_id !== input.entry.legacyId || item.row_hash !== input.entry.rowHash || item.projection_hash !== input.entry.projectionHash || item.projections_json !== projectionsJson || item.expected_mapping_count !== input.entry.expectedMappingCount) {
      throw new LegacyMigrationError("legacy_batch_item_conflict", "Stored migration batch item differs from the approved manifest.");
    }
  }

  private async ensureMapping(input: { snapshot: ProjectionSnapshot; batchId: string; projectionKey: string; archivedOnly: boolean; targetLifecycleStatus: "active" | "archived" | null }) {
    const candidateId = migrationMappingId(this.userId, input.snapshot.envelope.id, input.snapshot.adapter.version, input.projectionKey);
    await this.db.prepare(`insert or ignore into v2_legacy_source_mappings (id,user_id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,target_lifecycle_status,activation_batch_id,created_at) select ?,?,?,?,?,?,null,null,?,?,?,?,? where exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.control_status='active' and b.status in ('approved','running'))`).bind(candidateId, this.userId, input.snapshot.envelope.id, input.snapshot.adapter.table, input.snapshot.prepared.legacyId, input.snapshot.adapter.version, input.projectionKey, input.archivedOnly ? "archived" : "pending", input.targetLifecycleStatus, null, input.snapshot.now, input.batchId, this.userId).run();
    let mapping = await this.db.prepare(`select id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,superseded_from_status,target_lifecycle_status,activation_batch_id from v2_legacy_source_mappings where user_id=? and legacy_envelope_id=? and adapter_version=? and projection_kind=? limit 1`).bind(this.userId, input.snapshot.envelope.id, input.snapshot.adapter.version, input.projectionKey).first<MappingRow>();
    if (mapping && !input.archivedOnly && mapping.target_lifecycle_status === null) {
      await this.db.prepare(`update v2_legacy_source_mappings set target_lifecycle_status=? where id=? and user_id=? and target_lifecycle_status is null and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.control_status='active' and b.status in ('approved','running'))`).bind(input.targetLifecycleStatus, mapping.id, this.userId, input.batchId, this.userId).run();
      mapping = await this.db.prepare(`select id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,superseded_from_status,target_lifecycle_status,activation_batch_id from v2_legacy_source_mappings where id=? and user_id=? limit 1`).bind(mapping.id, this.userId).first<MappingRow>();
    }
    if (!mapping || mapping.legacy_envelope_id !== input.snapshot.envelope.id || mapping.legacy_table !== input.snapshot.adapter.table || mapping.legacy_id !== input.snapshot.prepared.legacyId || mapping.adapter_version !== input.snapshot.adapter.version || mapping.projection_kind !== input.projectionKey || mapping.target_lifecycle_status !== input.targetLifecycleStatus) {
      throw new LegacyMigrationError("legacy_mapping_conflict", "Stored legacy mapping differs from the expected immutable envelope projection.");
    }
    if (input.archivedOnly && (mapping.source_item_id !== null || mapping.projected_object_id !== null || mapping.status !== "archived")) throw new LegacyMigrationError("legacy_mapping_conflict", "Archived-only mapping contains an unexpected projection dependency.");
    return mapping;
  }

  private async mappingsForSnapshot(snapshot: ProjectionSnapshot) {
    const mappings = await this.db.prepare(`select id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,superseded_from_status,target_lifecycle_status,activation_batch_id from v2_legacy_source_mappings where user_id=? and legacy_envelope_id=? and adapter_version=?`).bind(this.userId, snapshot.envelope.id, snapshot.adapter.version).all<MappingRow>();
    return new Map(mappings.results.map((mapping) => [mapping.projection_kind, mapping]));
  }

  private sourceMappingComplete(snapshot: ProjectionSnapshot, projection: LegacyProjectionDraft, mapping: MappingRow | undefined) {
    return Boolean(mapping
      && mapping.legacy_envelope_id === snapshot.envelope.id
      && mapping.legacy_table === snapshot.adapter.table
      && mapping.legacy_id === snapshot.prepared.legacyId
      && mapping.adapter_version === snapshot.adapter.version
      && mapping.projection_kind === projection.key
      && mapping.target_lifecycle_status === projection.lifecycleStatus
      && mapping.source_item_id
      && mapping.projected_object_id
      && ["source_only", "knowledge_pending", "projected", "superseded"].includes(mapping.status));
  }

  private archivedMappingComplete(snapshot: ProjectionSnapshot, mapping: MappingRow | undefined) {
    return Boolean(mapping
      && mapping.legacy_envelope_id === snapshot.envelope.id
      && mapping.legacy_table === snapshot.adapter.table
      && mapping.legacy_id === snapshot.prepared.legacyId
      && mapping.adapter_version === snapshot.adapter.version
      && mapping.projection_kind === "archived_only"
      && mapping.target_lifecycle_status === null
      && mapping.source_item_id === null
      && mapping.projected_object_id === null
      && mapping.status === "archived");
  }

  private async projectSourceProjection(snapshot: ProjectionSnapshot, projection: LegacyProjectionDraft, batchId: string) {
      const mapping = await this.ensureMapping({ snapshot, batchId, projectionKey: projection.key, archivedOnly: false, targetLifecycleStatus: projection.lifecycleStatus });
      const idempotencyKey = `legacy:${snapshot.adapter.version}:${snapshot.prepared.legacyId}:${snapshot.envelope.rowHash}:${projection.key}`;
      let sourceItemId = mapping.source_item_id;
      let recordId = mapping.projected_object_id;
      let disposition: "committed" | "replayed" = "replayed";
      if (!sourceItemId || !recordId) {
        const request = {
          draftId: idempotencyKey,
          channel: "import" as const,
          title: projection.title,
          bodyMarkdown: projection.bodyMarkdown,
          aiEnabled: false,
          clientTimezone: "Asia/Seoul",
          privacyLevel: projection.privacyLevel,
          capturedAt: projection.writtenAt ?? snapshot.now,
        };
        const repository = new D1SourceFoundationRepository(this.db, this.userId);
        const prepared = await prepareLegacyCaptureCommit(request, idempotencyKey, snapshot.now);
        let receipt: Awaited<ReturnType<D1SourceFoundationRepository["commitCapture"]>>;
        try {
          receipt = await repository.commitLegacyCapture(prepared);
        } catch (error) {
          if (!(error instanceof SourceCommitIdempotencyConflictError)) throw error;
          const legacyPrepared = await prepareLegacyCaptureCommit(request, idempotencyKey, snapshot.now, { compatibilityLifecycleStatus: "active" });
          receipt = await repository.replayLegacyCapture(legacyPrepared);
        }
        sourceItemId = receipt.sourceItemIds[0] ?? null;
        recordId = receipt.recordId;
        disposition = receipt.disposition;
      }
      if (!sourceItemId || !recordId) throw new LegacyMigrationError("legacy_projection_dependency_missing", "Legacy projection did not produce a complete source dependency.");
      await this.db.batch([
        this.db.prepare(`update v2_legacy_source_mappings set source_item_id=?,projected_object_id=?,status=case when status in ('projected','superseded','knowledge_pending') then status else 'source_only' end where id=? and user_id=? and (source_item_id is null or source_item_id=?) and (projected_object_id is null or projected_object_id=?) and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.control_status='active' and b.status in ('approved','running'))`).bind(sourceItemId, recordId, mapping.id, this.userId, sourceItemId, recordId, batchId, this.userId),
        this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where id=? and user_id=? and not exists (select 1 from v2_legacy_source_mappings where id=? and user_id=? and status='projected') and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.control_status='active' and b.status in ('approved','running'))`).bind(snapshot.now, recordId, this.userId, mapping.id, this.userId, batchId, this.userId),
      ]);
      const stored = await this.db.prepare(`select id,legacy_envelope_id,legacy_table,legacy_id,adapter_version,source_item_id,projected_object_id,projection_kind,status,superseded_from_status,target_lifecycle_status,activation_batch_id from v2_legacy_source_mappings where id=? and user_id=? limit 1`).bind(mapping.id, this.userId).first<MappingRow>();
      if (!stored || stored.source_item_id !== sourceItemId || stored.projected_object_id !== recordId || stored.target_lifecycle_status !== projection.lifecycleStatus || !["source_only", "knowledge_pending", "projected", "superseded"].includes(stored.status)) throw new LegacyMigrationError("legacy_mapping_incomplete", "Legacy projection was committed without a complete source mapping.");
      return { mappingId: stored.id, projection, projectionKey: projection.key, recordId, sourceItemId, disposition, mapping: stored };
  }

  private async projectSourceOnlySnapshot(snapshot: ProjectionSnapshot, batchId: string) {
    const mappings = await this.mappingsForSnapshot(snapshot);
    if (!snapshot.prepared.projections.length) {
      const existing = mappings.get("archived_only");
      if (!this.archivedMappingComplete(snapshot, existing)) await this.ensureMapping({ snapshot, batchId, projectionKey: "archived_only", archivedOnly: true, targetLifecycleStatus: null });
      return { envelope: snapshot.envelope, projections: [], projectionProgressed: !this.archivedMappingComplete(snapshot, existing), rowComplete: true };
    }
    const completed = snapshot.prepared.projections.filter((projection) => this.sourceMappingComplete(snapshot, projection, mappings.get(projection.key))).length;
    const next = snapshot.prepared.projections.find((projection) => !this.sourceMappingComplete(snapshot, projection, mappings.get(projection.key)));
    if (!next) return { envelope: snapshot.envelope, projections: [], projectionProgressed: false, rowComplete: true };
    const result = await this.projectSourceProjection(snapshot, next, batchId);
    return { envelope: snapshot.envelope, projections: [result], projectionProgressed: true, rowComplete: completed + 1 === snapshot.prepared.projections.length };
  }

  private async attachKnowledge(projection: LegacyProjectionDraft, recordId: string, sourceItemId: string, now: string) {
    const candidateTypeId = `type:import:${this.userId}:${projection.typeKey}`;
    const typeDefinitions = await this.db.prepare(`select id,user_id,key,applies_to_kind,status from v2_type_definitions where id=? or (user_id=? and key=?)`).bind(candidateTypeId, this.userId, projection.typeKey).all<{ id: string; user_id: string; key: string; applies_to_kind: string; status: string }>();
    const typeDefinition = typeDefinitions.results[0];
    if (typeDefinitions.results.length > 1 || typeDefinition && (typeDefinition.user_id !== this.userId || typeDefinition.key !== projection.typeKey || typeDefinition.applies_to_kind !== "document" || typeDefinition.status !== "active")) {
      throw new LegacyMigrationError("legacy_definition_conflict", `Existing type definition ${projection.typeKey} is incompatible with this legacy projection.`);
    }
    const typeId = typeDefinition?.id ?? candidateTypeId;
    const fieldByKey = new Map<string, { id: string; data_type: string; status: string }>();
    if (projection.properties.length) {
      const candidateFieldIds = projection.properties.map((property) => `field:import:${this.userId}:${property.key}`);
      const fields = await this.db.prepare(`select id,user_id,key,data_type,status from v2_field_definitions where id in (${candidateFieldIds.map(() => "?").join(",")}) or (user_id=? and key in (${projection.properties.map(() => "?").join(",")}))`).bind(...candidateFieldIds, this.userId, ...projection.properties.map((property) => property.key)).all<{ id: string; user_id: string; key: string; data_type: string; status: string }>();
      for (const property of projection.properties) {
        const candidateId = `field:import:${this.userId}:${property.key}`;
        const matches = fields.results.filter((field) => field.id === candidateId || field.user_id === this.userId && field.key === property.key);
        const field = matches[0];
        if (matches.length > 1 || field && (field.user_id !== this.userId || field.key !== property.key || field.data_type !== property.dataType || field.status !== "active")) {
          throw new LegacyMigrationError("legacy_definition_conflict", `Existing field definition ${property.key} is incompatible with this legacy projection.`);
        }
        fieldByKey.set(property.key, field ?? { id: candidateId, data_type: property.dataType, status: "active" });
      }
    }
    const assignmentId = `assignment:import:${recordId}:${projection.typeKey}`;
    const propertyIds = projection.properties.map((property) => `property:import:${recordId}:${property.key}`);
    const expectedEvidence = [
      { id: `evidence:${assignmentId}`, targetKind: "type_assignment", targetId: assignmentId },
      ...propertyIds.map((propertyId) => ({ id: `evidence:${propertyId}`, targetKind: "property_value", targetId: propertyId })),
    ];
    const evidenceIds = expectedEvidence.map((evidence) => evidence.id);
    const materializationTerms = [
      `select 'assignment' as row_kind,id,user_id,object_id as owner_id,type_definition_id as definition_id,role,source_class,review_status,locked_by_user,null as proposal_temp_id,null as value_kind,null as value_text,null as value_number,null as value_boolean,null as value_date,null as value_json,null as unit_key,null as claim_risk,null as confidence,null as confirmed_by_user_at,null as supersedes_value_id,processing_run_id,null as superseded_at,null as target_kind,null as target_id,null as source_item_id,null as locator_kind,null as locator_json from v2_object_type_assignments where id=? or (object_id=? and type_definition_id=?)`,
      ...(propertyIds.length ? [`select 'property' as row_kind,id,user_id,owner_object_id as owner_id,field_definition_id as definition_id,null as role,source_class,review_status,locked_by_user,proposal_temp_id,value_kind,value_text,value_number,value_boolean,value_date,value_json,unit_key,claim_risk,confidence,confirmed_by_user_at,supersedes_value_id,processing_run_id,superseded_at,null as target_kind,null as target_id,null as source_item_id,null as locator_kind,null as locator_json from v2_property_values where id in (${propertyIds.map(() => "?").join(",")}) or (owner_object_id=? and field_definition_id in (${projection.properties.map(() => "?").join(",")}) and review_status='accepted' and superseded_at is null)`] : []),
      `select 'evidence' as row_kind,id,user_id,null as owner_id,null as definition_id,null as role,null as source_class,null as review_status,null as locked_by_user,null as proposal_temp_id,null as value_kind,null as value_text,null as value_number,null as value_boolean,null as value_date,null as value_json,null as unit_key,null as claim_risk,null as confidence,null as confirmed_by_user_at,null as supersedes_value_id,null as processing_run_id,null as superseded_at,target_kind,target_id,source_item_id,locator_kind,locator_json from v2_evidence_refs where id in (${evidenceIds.map(() => "?").join(",")}) or (source_item_id=? and locator_kind='text_span' and locator_json='{"start":0,"end":0}' and (target_kind='type_assignment' and target_id=?${propertyIds.length ? ` or target_kind='property_value' and target_id in (${propertyIds.map(() => "?").join(",")})` : ""}))`,
    ];
    const materializationBindings: unknown[] = [assignmentId, recordId, typeId];
    if (propertyIds.length) materializationBindings.push(...propertyIds, recordId, ...projection.properties.map((property) => fieldByKey.get(property.key)!.id));
    materializationBindings.push(...evidenceIds, sourceItemId, assignmentId, ...propertyIds);
    const loadMaterializations = () => this.db.prepare(materializationTerms.join(" union all ")).bind(...materializationBindings).all<KnowledgeMaterializationRow>();
    const assertMaterializations = (rows: readonly KnowledgeMaterializationRow[], requireAll: boolean) => {
      const seen = new Set<string>();
      for (const stored of rows) {
        if (seen.has(stored.id)) throw new LegacyMigrationError("legacy_projection_conflict", "Duplicate legacy knowledge materialization was found.");
        seen.add(stored.id);
        if (stored.row_kind === "assignment") {
          if (stored.id !== assignmentId
            || stored.user_id !== this.userId
            || stored.owner_id !== recordId
            || stored.definition_id !== typeId
            || stored.role !== "primary"
            || stored.source_class !== "import"
            || stored.review_status !== "accepted"
            || stored.locked_by_user !== 0
            || stored.processing_run_id !== null) {
            throw new LegacyMigrationError("legacy_projection_conflict", "Stored legacy type assignment differs from the deterministic projection.");
          }
          continue;
        }
        if (stored.row_kind === "property") {
          const index = propertyIds.indexOf(stored.id);
          const property = projection.properties[index];
          if (!property) throw new LegacyMigrationError("legacy_projection_conflict", "Stored legacy property conflicts with the deterministic projection.");
          const expectedText = typeof property.value === "string" && property.valueKind === "text" ? property.value : null;
          const expectedNumber = typeof property.value === "number" ? property.value : null;
          const expectedDate = property.valueKind === "date" ? String(property.value) : null;
          if (stored.user_id !== this.userId
            || stored.owner_id !== recordId
            || stored.definition_id !== fieldByKey.get(property.key)!.id
            || stored.value_kind !== property.valueKind
            || stored.value_text !== expectedText
            || stored.value_number !== expectedNumber
            || stored.value_boolean !== null
            || stored.value_date !== expectedDate
            || stored.value_json !== canonicalJson(property.value)
            || stored.proposal_temp_id !== null
            || stored.unit_key !== null
            || stored.source_class !== "imported"
            || stored.claim_risk !== "low"
            || stored.confidence !== null
            || stored.review_status !== "accepted"
            || stored.confirmed_by_user_at !== null
            || stored.locked_by_user !== 0
            || stored.supersedes_value_id !== null
            || stored.processing_run_id !== null
            || stored.superseded_at !== null) {
            throw new LegacyMigrationError("legacy_projection_conflict", `Stored legacy property ${property.key} differs from the deterministic projection.`);
          }
          continue;
        }
        const expected = expectedEvidence.find((evidence) => evidence.id === stored.id);
        if (!expected
          || stored.user_id !== this.userId
          || stored.target_kind !== expected.targetKind
          || stored.target_id !== expected.targetId
          || stored.source_item_id !== sourceItemId
          || stored.locator_kind !== "text_span"
          || stored.locator_json !== '{"start":0,"end":0}') {
          throw new LegacyMigrationError("legacy_projection_conflict", "Stored legacy evidence differs from the deterministic projection.");
        }
      }
      if (requireAll) {
        const expectedIds = [assignmentId, ...propertyIds, ...evidenceIds];
        if (seen.size !== expectedIds.length || expectedIds.some((id) => !seen.has(id))) throw new LegacyMigrationError("legacy_projection_conflict", "Legacy knowledge materialization is incomplete.");
      }
    };

    // Fail before any insert-or-ignore write. Otherwise one incompatible row
    // could be discovered only after its non-conflicting siblings were stored.
    assertMaterializations((await loadMaterializations()).results, false);

    const values: D1PreparedStatementBinding[] = [
      this.db.prepare(`insert or ignore into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,schema_version,usage_count,user_pinned,created_at,updated_at) values (?,?,?,?,'document','active','imported',?,1,0,0,?,?)`).bind(candidateTypeId, this.userId, projection.typeKey, projection.typeLabel, `Deterministic legacy adapter classification: ${projection.typeKey}`, now, now),
    ];
    if (projection.properties.length) {
      const fieldValues = projection.properties.map(() => `(?,?,?,?,?,?,'active','imported',1,1,1,1,0,?,?)`).join(",");
      values.push(this.db.prepare(`insert or ignore into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,filterable,sortable,facetable,schema_version,usage_count,created_at,updated_at) values ${fieldValues}`).bind(...projection.properties.flatMap((property) => [`field:import:${this.userId}:${property.key}`, this.userId, property.key, property.label, "Value preserved by a deterministic legacy adapter.", property.dataType, now, now])));
    }
    values.push(this.db.prepare(`insert or ignore into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at) values (?,?,?,?,'primary','import','accepted',0,?,?)`).bind(assignmentId, this.userId, recordId, typeId, now, now));
    const propertyRows: unknown[] = [];
    const evidenceRows: unknown[] = [`evidence:${assignmentId}`, this.userId, "type_assignment", assignmentId, sourceItemId, now];
    for (const property of projection.properties) {
      const fieldId = fieldByKey.get(property.key)!.id;
      const propertyId = `property:import:${recordId}:${property.key}`;
      propertyRows.push(propertyId, this.userId, recordId, fieldId, property.valueKind, typeof property.value === "string" && property.valueKind === "text" ? property.value : null, typeof property.value === "number" ? property.value : null, property.valueKind === "date" ? property.value : null, canonicalJson(property.value), now);
      evidenceRows.push(`evidence:${propertyId}`, this.userId, "property_value", propertyId, sourceItemId, now);
    }
    if (projection.properties.length) values.push(this.db.prepare(`insert or ignore into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_number,value_date,value_json,source_class,claim_risk,review_status,locked_by_user,created_at) values ${projection.properties.map(() => `(?,?,?,?,?,?,?,?,?,'imported','low','accepted',0,?)`).join(",")}`).bind(...propertyRows));
    values.push(this.db.prepare(`insert or ignore into v2_evidence_refs (id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at) values ${evidenceRows.length / 6 === 1 ? `(?,?,?,?,?,'text_span','{"start":0,"end":0}',?)` : Array.from({ length: evidenceRows.length / 6 }, () => `(?,?,?,?,?,'text_span','{"start":0,"end":0}',?)`).join(",")}`).bind(...evidenceRows));
    values.push(this.db.prepare(`update v2_type_definitions set usage_count=(select count(*) from v2_object_type_assignments where type_definition_id=? and review_status='accepted'),updated_at=? where id=?`).bind(typeId, now, typeId));
    await this.db.batch(values);
    assertMaterializations((await loadMaterializations()).results, true);
  }

  private async projectKnowledgeSnapshot(snapshot: ProjectionSnapshot, activationBatchId: string) {
    const mappings = await this.mappingsForSnapshot(snapshot);
    if (!snapshot.prepared.projections.length) {
      const existing = mappings.get("archived_only");
      if (!this.archivedMappingComplete(snapshot, existing)) await this.ensureMapping({ snapshot, batchId: activationBatchId, projectionKey: "archived_only", archivedOnly: true, targetLifecycleStatus: null });
      return { envelope: snapshot.envelope, projections: [], projectionProgressed: !this.archivedMappingComplete(snapshot, existing), rowComplete: true };
    }
    const missingSource = snapshot.prepared.projections.find((projection) => !this.sourceMappingComplete(snapshot, projection, mappings.get(projection.key)));
    if (missingSource) {
      const source = await this.projectSourceProjection(snapshot, missingSource, activationBatchId);
      return { envelope: snapshot.envelope, projections: [source], projectionProgressed: true, rowComplete: false };
    }
    for (const projection of snapshot.prepared.projections) {
      const mapping = mappings.get(projection.key)!;
      if (mapping.status === "knowledge_pending" && mapping.activation_batch_id !== activationBatchId) throw new LegacyMigrationError("legacy_mapping_activation_conflict", "A legacy projection is staged by another knowledge batch.");
      if (mapping.status === "superseded") throw new LegacyMigrationError("legacy_mapping_superseded", "A superseded legacy projection cannot be activated by this batch.");
    }
    const knowledgeComplete = snapshot.prepared.projections.filter((projection) => {
      const mapping = mappings.get(projection.key)!;
      return mapping.status === "projected" || mapping.status === "knowledge_pending" && mapping.activation_batch_id === activationBatchId;
    }).length;
    const next = snapshot.prepared.projections.find((projection) => {
      const mapping = mappings.get(projection.key)!;
      return mapping.status === "source_only";
    });
    if (!next) return { envelope: snapshot.envelope, projections: [], projectionProgressed: false, rowComplete: true };
    const mapping = mappings.get(next.key)!;
    await this.attachKnowledge(next, mapping.projected_object_id!, mapping.source_item_id!, snapshot.now);
    await this.db.prepare(`update v2_legacy_source_mappings set status='knowledge_pending',activation_batch_id=? where id=? and user_id=? and status='source_only' and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.mode='knowledge' and b.status in ('approved','running') and b.control_status='active')`).bind(activationBatchId, mapping.id, this.userId, activationBatchId, this.userId).run();
    return {
      envelope: snapshot.envelope,
      projections: [{ projectionKey: next.key, recordId: mapping.projected_object_id!, sourceItemId: mapping.source_item_id!, disposition: "replayed" as const }],
      projectionProgressed: true,
      rowComplete: knowledgeComplete + 1 === snapshot.prepared.projections.length,
    };
  }

  private async finalizeBatch(batch: MigrationBatchRow, now: string) {
    const reconciliation = await this.reconcileBatch(batch.id);
    const ready = reconciliation.structurally_valid
      && reconciliation.next_offset === batch.input_rows
      && reconciliation.processed_item_count === batch.input_rows
      && reconciliation.mapping_count === batch.expected_mapping_count;
    if (!ready) {
      await this.db.prepare(`update v2_legacy_migration_batches set status='failed',control_status='paused',state_revision=state_revision+1,reconciliation_status='failed',reconciliation_json=?,failure_code='legacy_reconciliation_failed',reconciled_at=? where id=? and user_id=? and next_offset=? and status in ('approved','running') and control_status='active' and state_revision=?`).bind(canonicalJson(reconciliation), now, batch.id, this.userId, batch.next_offset, batch.state_revision).run();
      throw new LegacyMigrationError("legacy_reconciliation_failed", "Migration batch failed structural reconciliation and was not finalized.");
    }
    const receipt = canonicalJson({
      ...reconciliation,
      batch_status: "succeeded",
      projected_count: batch.mode === "knowledge" ? reconciliation.projected_count + reconciliation.knowledge_pending_count : reconciliation.projected_count,
      source_only_count: batch.mode === "knowledge" ? 0 : reconciliation.source_only_count,
      knowledge_pending_count: batch.mode === "knowledge" ? 0 : reconciliation.knowledge_pending_count,
      complete: true,
      verified_at: now,
    });
    const statements: D1PreparedStatementBinding[] = [];
    if (batch.mode === "knowledge") {
      statements.push(
        this.db.prepare(`update v2_legacy_source_mappings as old set status='superseded',superseded_from_status=old.status,superseded_at=?,superseded_by_mapping_id=(select current.id from v2_legacy_source_mappings current where current.user_id=old.user_id and current.activation_batch_id=? and current.status='knowledge_pending' and current.legacy_table=old.legacy_table and current.legacy_id=old.legacy_id and current.projection_kind=old.projection_kind and current.id<>old.id limit 1) where old.user_id=? and old.status in ('source_only','projected') and exists (select 1 from v2_legacy_source_mappings current where current.user_id=old.user_id and current.activation_batch_id=? and current.status='knowledge_pending' and current.legacy_table=old.legacy_table and current.legacy_id=old.legacy_id and current.projection_kind=old.projection_kind and current.id<>old.id) and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.next_offset=? and b.status in ('approved','running') and b.control_status='active' and b.state_revision=?)`).bind(now, batch.id, this.userId, batch.id, batch.id, this.userId, batch.next_offset, batch.state_revision),
        this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where user_id=? and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.next_offset=? and b.status in ('approved','running') and b.control_status='active' and b.state_revision=?) and id in (select old.projected_object_id from v2_legacy_source_mappings old join v2_legacy_source_mappings current on current.id=old.superseded_by_mapping_id where current.activation_batch_id=? and current.status='knowledge_pending' and old.status='superseded' and old.projected_object_id is not null)`).bind(now, this.userId, batch.id, this.userId, batch.next_offset, batch.state_revision, batch.id),
        this.db.prepare(`update v2_objects set lifecycle_status=coalesce((select m.target_lifecycle_status from v2_legacy_source_mappings m where m.projected_object_id=v2_objects.id and m.user_id=v2_objects.user_id and m.activation_batch_id=? and m.status='knowledge_pending' limit 1),'archived'),updated_at=? where user_id=? and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.next_offset=? and b.status in ('approved','running') and b.control_status='active' and b.state_revision=?) and id in (select projected_object_id from v2_legacy_source_mappings where user_id=? and activation_batch_id=? and status='knowledge_pending' and projected_object_id is not null)`).bind(batch.id, now, this.userId, batch.id, this.userId, batch.next_offset, batch.state_revision, this.userId, batch.id),
        this.db.prepare(`update v2_legacy_source_mappings set status='projected',superseded_at=null,superseded_by_mapping_id=null where user_id=? and activation_batch_id=? and status='knowledge_pending' and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.next_offset=? and b.status in ('approved','running') and b.control_status='active' and b.state_revision=?)`).bind(this.userId, batch.id, batch.id, this.userId, batch.next_offset, batch.state_revision),
      );
    }
    statements.push(this.db.prepare(`update v2_legacy_migration_batches set status='succeeded',control_status='complete',state_revision=state_revision+1,reconciliation_status='passed',reconciliation_json=?,failure_code=null,finished_at=?,reconciled_at=? where id=? and user_id=? and next_offset=? and status in ('approved','running') and control_status='active' and state_revision=?`).bind(receipt, now, now, batch.id, this.userId, batch.next_offset, batch.state_revision));
    try {
      await this.db.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("legacy_provider_invocation_active")) {
        throw new LegacyMigrationError("legacy_provider_invocation_conflict", "A projected record is currently being sent to an AI provider; retry migration finalization after that invocation finishes.");
      }
      throw error;
    }
    const finalized = await this.loadBatch(batch.id);
    if (finalized?.status === "stale") throw new LegacyMigrationError("legacy_dry_run_changed", "The approved legacy source changed while the batch was being finalized.");
    if (!finalized || finalized.status !== "succeeded" || finalized.control_status !== "complete" || finalized.state_revision !== batch.state_revision + 1 || finalized.reconciliation_status !== "passed" || !finalized.reconciliation_json || !finalized.reconciled_at) throw new LegacyMigrationError("legacy_batch_incomplete", "Migration batch could not be finalized after reconciliation.");
    const verified = await this.reconcileBatch(batch.id);
    if (!verified.complete || batch.mode === "knowledge" && verified.knowledge_pending_count !== 0) throw new LegacyMigrationError("legacy_batch_incomplete", "Migration batch finalization did not produce a verified post-promotion state.");
    return finalized;
  }

  async runApprovedBatch(input: { table: string; importBatchId: string; mode: MigrationMode; expectedDryRunHash: string; offset?: number; limit?: number; now?: string }) {
    const now = input.now ?? new Date().toISOString();
    if (!this.options.legacyReadOnly) throw new LegacyMigrationError("legacy_source_not_locked", "Legacy writes must be disabled before a migration batch can run.");
    let batch = await this.loadBatch(input.importBatchId);
    let approvalSnapshot: DryRunSnapshot | null = null;
    if (!batch) {
      if (input.mode === "knowledge") {
        const preservation = await this.requireSourcePreservationGate(input, now);
        if (!preservation.complete) {
          return {
            processed: 0,
            processedProjections: 0,
            batchPrepared: false,
            gatePending: true,
            preservationGate: preservation.gate,
            rowPending: false,
            offset: input.offset ?? 0,
            nextOffset: input.offset ?? 0,
            complete: false,
            batchStatus: "preservation_checking" as const,
            requestedLimit: input.limit ?? 1,
            appliedLimit: 0,
            reconciliation: null,
          };
        }
        approvalSnapshot = preservation.target;
      } else {
        approvalSnapshot = await this.buildDryRunSnapshot(input.table);
      }
      if (approvalSnapshot.dryRun.dryRunHash !== input.expectedDryRunHash) throw new LegacyMigrationError("legacy_dry_run_changed", "Legacy source changed after dry-run.");
      batch = await this.approveBatch(input, approvalSnapshot, now);
      if (input.mode === "knowledge") {
        return {
          dryRun: approvalSnapshot.dryRun,
          processed: 0,
          processedProjections: 0,
          batchPrepared: true,
          rowPending: batch.input_rows > 0,
          offset: batch.next_offset,
          nextOffset: batch.next_offset,
          complete: false,
          batchStatus: batch.status,
          requestedLimit: input.limit ?? 1,
          appliedLimit: 0,
          reconciliation: await this.reconcileBatch(batch.id),
        };
      }
    } else {
      this.validateBatchContract(batch, input);
    }
    const dryRun = parseDryRun(batch.summary_json);
    const manifest = parseManifest(batch.manifest_json);
    if (manifest.length !== batch.input_rows || dryRun.dryRunHash !== batch.dry_run_hash) throw new LegacyMigrationError("legacy_batch_manifest_invalid", "Stored migration batch counts do not match its approved manifest.");
    if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > batch.next_offset)) throw new LegacyMigrationError("legacy_batch_offset_conflict", `Migration batch expects offset ${batch.next_offset}.`);
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) throw new LegacyMigrationError("legacy_batch_limit_invalid", "Migration batch limit must be a positive integer.");
    if (input.offset !== undefined && input.offset < batch.next_offset) {
      const reconciliation = await this.reconcileBatch(batch.id);
      if (batch.status === "succeeded" && !reconciliation.complete) throw new LegacyMigrationError("legacy_batch_incomplete", "A succeeded migration batch no longer passes reconciliation.");
      return { dryRun, processed: 0, processedProjections: 0, rowPending: false, offset: input.offset, nextOffset: batch.next_offset, complete: batch.status === "succeeded", batchStatus: batch.status, reconciliation };
    }
    if (batch.status === "succeeded") {
      const reconciliation = await this.reconcileBatch(batch.id);
      if (!reconciliation.complete) throw new LegacyMigrationError("legacy_batch_incomplete", "A succeeded migration batch no longer passes reconciliation.");
      return { dryRun, processed: 0, processedProjections: 0, rowPending: false, offset: batch.next_offset, nextOffset: batch.next_offset, complete: true, batchStatus: batch.status, reconciliation };
    }
    if (batch.next_offset >= manifest.length) {
      const finalSnapshot = approvalSnapshot ?? await this.buildDryRunSnapshot(input.table);
      if (finalSnapshot.dryRun.dryRunHash !== batch.dry_run_hash) {
        await this.markBatchStale(batch.id, "legacy_dry_run_changed");
        throw new LegacyMigrationError("legacy_dry_run_changed", "Legacy source changed before final reconciliation.");
      }
      const finalized = await this.finalizeBatch(batch, now);
      return { dryRun, processed: 0, processedProjections: 0, rowPending: false, offset: finalized.next_offset, nextOffset: finalized.next_offset, complete: true, batchStatus: finalized.status, reconciliation: await this.reconcileBatch(batch.id) };
    }
    const position = batch.next_offset;
    const entry = manifest[position];
    let current: { adapter: LegacyAdapterV1; schemaSnapshot: string; prepared: PreparedLegacyRow };
    try {
      if (approvalSnapshot) {
        const prepared = approvalSnapshot.rows[position];
        if (!prepared) throw new LegacyMigrationError("legacy_batch_manifest_invalid", "Approved row is missing from the dry-run snapshot.");
        current = { adapter: approvalSnapshot.adapter, schemaSnapshot: approvalSnapshot.schemaSnapshot, prepared };
      } else {
        current = await this.readScopedRow(input.table, entry.legacyId);
      }
    } catch (error) {
      await this.markBatchStale(batch.id, error instanceof LegacyMigrationError ? error.code : "legacy_row_read_failed");
      throw error instanceof LegacyMigrationError && error.code === "legacy_batch_manifest_invalid" ? error : new LegacyMigrationError("legacy_dry_run_changed", "An approved legacy row can no longer be read unchanged.");
    }
    const currentProjectionTargets = current.prepared.projections.length ? current.prepared.projections.map((projection) => ({ key: projection.key, lifecycleStatus: projection.lifecycleStatus })) : [{ key: "archived_only", lifecycleStatus: "archived" as const }];
    if (current.schemaSnapshot !== batch.schema_snapshot || current.prepared.rowHash !== entry.rowHash || current.prepared.projectionHash !== entry.projectionHash || canonicalJson(currentProjectionTargets) !== canonicalJson(entry.projections) || currentProjectionTargets.length !== entry.expectedMappingCount) {
      await this.markBatchStale(batch.id, "legacy_dry_run_changed");
      throw new LegacyMigrationError("legacy_dry_run_changed", "An approved legacy row changed before projection.");
    }
    const envelope = await this.ensureEnvelope({ adapter: current.adapter, prepared: current.prepared, schemaSnapshot: current.schemaSnapshot, importBatchId: batch.id, now });
    await this.ensureBatchItem({ batch, entry, position, envelopeId: envelope.id });
    const projectionSnapshot: ProjectionSnapshot = { adapter: current.adapter, prepared: current.prepared, envelope, now };
    const projected = input.mode === "knowledge" ? await this.projectKnowledgeSnapshot(projectionSnapshot, batch.id) : await this.projectSourceOnlySnapshot(projectionSnapshot, batch.id);
    if (!projected.rowComplete) {
      await this.db.prepare(`update v2_legacy_migration_batches set status='running',started_at=coalesce(started_at,?),failure_code=null where id=? and user_id=? and next_offset=? and status in ('approved','running') and control_status='active' and state_revision=?`).bind(now, batch.id, this.userId, position, batch.state_revision).run();
      const pending = await this.loadBatch(batch.id);
      if (!pending || pending.next_offset !== position || pending.status !== "running" || pending.control_status !== "active" || pending.state_revision !== batch.state_revision) throw new LegacyMigrationError("legacy_batch_incomplete", "Migration projection progress was not stored safely.");
      return {
        dryRun,
        processed: 0,
        processedProjections: projected.projectionProgressed ? 1 : 0,
        rowPending: true,
        offset: position,
        nextOffset: position,
        complete: false,
        batchStatus: pending.status,
        requestedLimit: input.limit ?? 1,
        appliedLimit: 1,
        reconciliation: await this.reconcileBatch(batch.id),
      };
    }
    const nextOffset = position + 1;
    await this.db.batch([
      this.db.prepare(`update v2_legacy_migration_batch_items set status='succeeded',processed_at=? where batch_id=? and user_id=? and position=? and legacy_envelope_id=? and exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.control_status='active' and b.state_revision=? and b.status in ('approved','running'))`).bind(now, batch.id, this.userId, position, envelope.id, batch.id, this.userId, batch.state_revision),
      this.db.prepare(`update v2_legacy_migration_batches set next_offset=?,status='running',started_at=coalesce(started_at,?),failure_code=null where id=? and user_id=? and next_offset=? and status in ('approved','running') and control_status='active' and state_revision=?`).bind(nextOffset, now, batch.id, this.userId, position, batch.state_revision),
    ]);
    const progressed = await this.loadBatch(batch.id);
    if (!progressed || progressed.next_offset < nextOffset || progressed.control_status !== "active" || progressed.state_revision !== batch.state_revision) throw new LegacyMigrationError("legacy_batch_incomplete", "Migration batch progress was not stored.");
    if (progressed.status === "stale") throw new LegacyMigrationError("legacy_dry_run_changed", "The approved legacy source changed while the batch was running.");
    batch = progressed;
    let complete = false;
    let batchStatus: MigrationBatchRow["status"] = "running";
    if (nextOffset >= manifest.length) {
      const finalSnapshot = await this.buildDryRunSnapshot(input.table);
      if (finalSnapshot.dryRun.dryRunHash !== batch.dry_run_hash) {
        await this.markBatchStale(batch.id, "legacy_dry_run_changed");
        throw new LegacyMigrationError("legacy_dry_run_changed", "Legacy source changed before final reconciliation.");
      }
      const finalized = await this.finalizeBatch(batch, now);
      complete = true;
      batchStatus = finalized.status;
    }
    return { dryRun, processed: 1, processedProjections: projected.projectionProgressed ? 1 : 0, rowPending: false, offset: position, nextOffset, complete, batchStatus, requestedLimit: input.limit ?? 1, appliedLimit: 1, reconciliation: await this.reconcileBatch(batch.id) };
  }

  async quarantineBatch(input: { importBatchId: string; expectedRevision: number; idempotencyKey: string; reason: string; now?: string }) {
    if (!this.options.legacyReadOnly) throw new LegacyMigrationError("legacy_source_not_locked", "Legacy writes must be disabled before a migration batch can be quarantined.");
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new LegacyMigrationError("legacy_quarantine_revision_invalid", "Expected migration revision must be a non-negative integer.");
    }
    if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 128) {
      throw new LegacyMigrationError("legacy_quarantine_idempotency_key_invalid", "Quarantine idempotency key must contain 1 to 128 characters.");
    }
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 1_000) {
      throw new LegacyMigrationError("legacy_quarantine_reason_invalid", "Quarantine reason must contain 1 to 1,000 characters.");
    }
    const now = input.now ?? new Date().toISOString();
    const batch = await this.loadBatch(input.importBatchId);
    if (!batch) throw new LegacyMigrationError("legacy_batch_not_found", "Migration batch was not found.");
    if (batch.control_status === "quarantined") {
      const storedReceipt = parseQuarantineReceipt(batch.quarantine_receipt_json);
      if (batch.quarantine_idempotency_key !== input.idempotencyKey
        || batch.quarantine_reason !== reason
        || storedReceipt?.expectedRevision !== input.expectedRevision) {
        throw new LegacyMigrationError("legacy_quarantine_idempotency_conflict", "The migration batch was quarantined with a different idempotency payload.");
      }
      return { disposition: "replayed" as const, ...await this.getBatchView(batch.id) };
    }
    if (batch.state_revision !== input.expectedRevision) {
      throw new LegacyMigrationError("legacy_quarantine_revision_conflict", "The migration batch revision changed before quarantine.");
    }
    if (!(["paused", "active", "complete"] as const).includes(batch.control_status as "paused" | "active" | "complete")) {
      throw new LegacyMigrationError("legacy_quarantine_control_conflict", "The migration batch control state cannot enter quarantine.");
    }
    const preControlStatus = batch.control_status as "paused" | "active" | "complete";
    const provenance = await this.db.prepare(`select count(*) as item_count,count(distinct e.id) as envelope_count from v2_legacy_migration_batch_items i left join v2_legacy_source_envelopes e on e.id=i.legacy_envelope_id and e.user_id=i.user_id where i.batch_id=? and i.user_id=?`).bind(batch.id, this.userId).first<{ item_count: number; envelope_count: number }>();
    const itemCount = Number(provenance?.item_count ?? 0);
    const envelopeCount = Number(provenance?.envelope_count ?? 0);
    if (itemCount !== envelopeCount) {
      throw new LegacyMigrationError("legacy_quarantine_source_provenance_conflict", "Quarantine cannot proceed because an immutable source envelope is missing.");
    }
    const directMappings = await this.db.prepare(`select m.id,m.legacy_envelope_id,m.legacy_table,m.legacy_id,m.adapter_version,m.source_item_id,m.projected_object_id,m.projection_kind,m.status,m.superseded_at,m.superseded_by_mapping_id,m.superseded_from_status,m.target_lifecycle_status,m.activation_batch_id,case when m.source_item_id is null then 0 when s.id is null then 0 else 1 end as source_exists,case when m.projected_object_id is null then 0 when o.id is null then 0 else 1 end as object_exists,o.lifecycle_status as object_lifecycle_status,owner.status as activation_batch_status,owner.control_status as activation_batch_control_status from v2_legacy_source_mappings m join v2_legacy_migration_batch_items i on i.legacy_envelope_id=m.legacy_envelope_id and i.user_id=m.user_id left join v2_source_items s on s.id=m.source_item_id and s.user_id=m.user_id left join v2_objects o on o.id=m.projected_object_id and o.user_id=m.user_id left join v2_legacy_migration_batches owner on owner.id=m.activation_batch_id and owner.user_id=m.user_id where i.batch_id=? and i.user_id=? and m.adapter_version=?`).bind(batch.id, this.userId, batch.adapter_version).all<QuarantineMappingRow & { activation_batch_status: string | null; activation_batch_control_status: string | null }>();
    for (const mapping of directMappings.results) {
      if (mapping.projection_kind === "archived_only") {
        if (mapping.status !== "archived" || mapping.source_item_id !== null || mapping.projected_object_id !== null) {
          throw new LegacyMigrationError("legacy_quarantine_mapping_conflict", "An archived-only mapping has unexpected dependencies.");
        }
        continue;
      }
      if (mapping.source_exists !== 1 || mapping.object_exists !== 1 || mapping.source_item_id === null || mapping.projected_object_id === null
        || mapping.superseded_at !== null || mapping.superseded_by_mapping_id !== null || mapping.superseded_from_status !== null) {
        throw new LegacyMigrationError("legacy_quarantine_mapping_conflict", "A migration mapping does not have reversible source provenance.");
      }
      if (batch.mode === "source_only") {
        if (mapping.status !== "source_only" || mapping.activation_batch_id !== null) {
          throw new LegacyMigrationError("legacy_quarantine_mapping_activation_conflict", "A later knowledge batch owns a source-only mapping; quarantine must proceed from the owning batch first.");
        }
        continue;
      }
      if (mapping.status === "source_only") {
        if (mapping.activation_batch_id !== null) throw new LegacyMigrationError("legacy_quarantine_mapping_conflict", "A source-only mapping has an activation owner.");
        continue;
      }
      if (mapping.status === "knowledge_pending") {
        if (mapping.activation_batch_id !== batch.id) throw new LegacyMigrationError("legacy_quarantine_mapping_activation_conflict", "Another knowledge batch owns a pending mapping.");
        continue;
      }
      if (mapping.status === "projected") {
        if (mapping.activation_batch_id === batch.id) continue;
        const establishedOwner = mapping.activation_batch_id === null
          || mapping.activation_batch_status === "succeeded" && mapping.activation_batch_control_status === "complete";
        if (!establishedOwner
          || !["active", "archived"].includes(mapping.target_lifecycle_status ?? "")
          || mapping.object_lifecycle_status !== mapping.target_lifecycle_status) {
          throw new LegacyMigrationError("legacy_quarantine_mapping_activation_conflict", "An unrelated projected mapping cannot be changed or safely preserved by this quarantine.");
        }
        continue;
      }
      throw new LegacyMigrationError("legacy_quarantine_mapping_conflict", "A migration mapping is not in a reversible state.");
    }
    const priorMappings = await this.db.prepare(`select old.id,old.legacy_envelope_id,old.legacy_table,old.legacy_id,old.adapter_version,old.source_item_id,old.projected_object_id,old.projection_kind,old.status,old.superseded_at,old.superseded_by_mapping_id,old.superseded_from_status,old.target_lifecycle_status,old.activation_batch_id,case when old.source_item_id is null then 0 when s.id is null then 0 else 1 end as source_exists,case when old.projected_object_id is null then 0 when o.id is null then 0 else 1 end as object_exists,o.lifecycle_status as object_lifecycle_status,owner.status as activation_batch_status,owner.control_status as activation_batch_control_status from v2_legacy_source_mappings old join v2_legacy_source_mappings current on current.id=old.superseded_by_mapping_id and current.user_id=old.user_id join v2_legacy_migration_batch_items i on i.legacy_envelope_id=current.legacy_envelope_id and i.user_id=current.user_id left join v2_source_items s on s.id=old.source_item_id and s.user_id=old.user_id left join v2_objects o on o.id=old.projected_object_id and o.user_id=old.user_id left join v2_legacy_migration_batches owner on owner.id=old.activation_batch_id and owner.user_id=old.user_id where i.batch_id=? and i.user_id=? and current.adapter_version=? and current.activation_batch_id=? and old.status='superseded'`).bind(batch.id, this.userId, batch.adapter_version, batch.id).all<QuarantineMappingRow & { activation_batch_status: string | null; activation_batch_control_status: string | null }>();
    if (batch.mode === "source_only" && priorMappings.results.length) {
      throw new LegacyMigrationError("legacy_quarantine_superseded_conflict", "A source-only batch cannot own superseded mapping history.");
    }
    const restoredMappings: RestoredMappingReceipt[] = [];
    const restoredObjectTargets = new Map<string, string>();
    for (const mapping of priorMappings.results) {
      const priorStatus = mapping.superseded_from_status;
      if ((priorStatus !== "source_only" && priorStatus !== "projected")
        || mapping.superseded_at === null
        || mapping.superseded_by_mapping_id === null
        || mapping.source_exists !== 1
        || mapping.object_exists !== 1
        || mapping.projected_object_id === null) {
        throw new LegacyMigrationError("legacy_quarantine_superseded_basis_conflict", "A superseded mapping is missing its recorded restoration basis.");
      }
      if (priorStatus === "source_only" && mapping.activation_batch_id !== null) {
        throw new LegacyMigrationError("legacy_quarantine_superseded_basis_conflict", "A prior source-only mapping has an unexpected activation owner.");
      }
      if (priorStatus === "projected") {
        const establishedOwner = mapping.activation_batch_id === null
          || mapping.activation_batch_status === "succeeded" && mapping.activation_batch_control_status === "complete";
        if (!establishedOwner || !["active", "archived"].includes(mapping.target_lifecycle_status ?? "")) {
          throw new LegacyMigrationError("legacy_quarantine_superseded_basis_conflict", "A prior projected mapping cannot be reactivated without an authoritative lifecycle basis.");
        }
      }
      const target = priorStatus === "projected" ? mapping.target_lifecycle_status! : "archived";
      const existingTarget = restoredObjectTargets.get(mapping.projected_object_id);
      if (existingTarget !== undefined && existingTarget !== target) {
        throw new LegacyMigrationError("legacy_quarantine_superseded_basis_conflict", "Superseded mappings disagree about the lifecycle of a shared object.");
      }
      restoredObjectTargets.set(mapping.projected_object_id, target);
      restoredMappings.push({ mappingId: mapping.id, priorStatus, objectId: mapping.projected_object_id, targetLifecycleStatus: mapping.target_lifecycle_status });
    }
    restoredMappings.sort((left, right) => left.mappingId.localeCompare(right.mappingId));
    const gate = await this.loadPreservationGate(batch.id);
    const ownedCurrentMappings = batch.mode === "knowledge"
      ? directMappings.results.filter((mapping) => mapping.activation_batch_id === batch.id && (mapping.status === "knowledge_pending" || mapping.status === "projected"))
      : [];
    const archivedObjectIds = new Set<string>();
    for (const mapping of directMappings.results) {
      if (mapping.projected_object_id && (batch.mode === "source_only" || mapping.status === "source_only" || mapping.activation_batch_id === batch.id)) archivedObjectIds.add(mapping.projected_object_id);
    }
    for (const mapping of priorMappings.results) if (mapping.superseded_from_status === "source_only" && mapping.projected_object_id) archivedObjectIds.add(mapping.projected_object_id);
    const sourceIds = new Set(directMappings.results.flatMap((mapping) => mapping.source_item_id ? [mapping.source_item_id] : []));
    const receipt: LegacyQuarantineReceipt = {
      version: 1,
      batchId: batch.id,
      mode: batch.mode,
      preStatus: batch.status,
      preControlStatus,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      reason,
      quarantinedAt: now,
      preservedItemCount: itemCount,
      preservedEnvelopeCount: envelopeCount,
      preservedMappingCount: directMappings.results.length,
      preservedSourceCount: sourceIds.size,
      currentMappingsReverted: ownedCurrentMappings.length,
      priorSourceOnlyRestored: restoredMappings.filter((mapping) => mapping.priorStatus === "source_only").length,
      priorProjectedRestored: restoredMappings.filter((mapping) => mapping.priorStatus === "projected").length,
      archivedObjectCount: archivedObjectIds.size,
      preservationGateTerminated: gate?.status === "checking",
      restoredMappings,
    };
    const receiptJson = canonicalJson(receipt);
    const assertionId = crypto.randomUUID();
    const fenceSql = `exists (select 1 from v2_legacy_migration_batches b where b.id=? and b.user_id=? and b.state_revision=? and b.control_status=? and b.quarantine_idempotency_key is null)`;
    const fenceBindings = [batch.id, this.userId, input.expectedRevision, preControlStatus] as const;
    const directObjectIds = `select m.projected_object_id from v2_legacy_source_mappings m join v2_legacy_migration_batch_items i on i.legacy_envelope_id=m.legacy_envelope_id and i.user_id=m.user_id where i.batch_id=? and i.user_id=? and m.adapter_version=? and m.projected_object_id is not null`;
    const ownedDirectObjectIds = `${directObjectIds} and (m.status='source_only' and m.activation_batch_id is null or m.activation_batch_id=? and m.status in ('knowledge_pending','projected'))`;
    const priorLinkedPredicate = `exists (select 1 from v2_legacy_source_mappings current join v2_legacy_migration_batch_items i on i.legacy_envelope_id=current.legacy_envelope_id and i.user_id=current.user_id where current.id=v2_legacy_source_mappings.superseded_by_mapping_id and current.user_id=v2_legacy_source_mappings.user_id and i.batch_id=? and i.user_id=? and current.adapter_version=? and current.activation_batch_id=?)`;
    const statements: D1PreparedStatementBinding[] = [
      this.db.prepare(`insert into v2_legacy_quarantine_assertions (assertion_id,batch_id,user_id,expected_revision,expected_control_status,idempotency_key,expected_item_count,expected_envelope_count,expected_mapping_count,expected_source_count,expected_prior_mapping_count,created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(assertionId, batch.id, this.userId, input.expectedRevision, preControlStatus, input.idempotencyKey, itemCount, envelopeCount, directMappings.results.length, sourceIds.size, priorMappings.results.length, now),
      this.db.prepare(`update v2_legacy_preservation_gates set status='failed',failure_code='legacy_batch_quarantined',failure_detail=?,state_revision=state_revision+1,last_progress_at=?,finished_at=?,lease_token=null,lease_expires_at=null where target_batch_id=? and user_id=? and status='checking' and ${fenceSql}`).bind(reason, now, now, batch.id, this.userId, ...fenceBindings),
    ];
    if (batch.mode === "source_only") {
      statements.push(this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where user_id=? and id in (${directObjectIds}) and ${fenceSql}`).bind(now, this.userId, batch.id, this.userId, batch.adapter_version, ...fenceBindings));
    } else {
      statements.push(this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where user_id=? and id in (${ownedDirectObjectIds}) and ${fenceSql}`).bind(now, this.userId, batch.id, this.userId, batch.adapter_version, batch.id, ...fenceBindings));
      statements.push(this.db.prepare(`update v2_objects set lifecycle_status=coalesce((select old.target_lifecycle_status from v2_legacy_source_mappings old join v2_legacy_source_mappings current on current.id=old.superseded_by_mapping_id and current.user_id=old.user_id join v2_legacy_migration_batch_items i on i.legacy_envelope_id=current.legacy_envelope_id and i.user_id=current.user_id where old.projected_object_id=v2_objects.id and old.user_id=v2_objects.user_id and old.status='superseded' and old.superseded_from_status='projected' and i.batch_id=? and i.user_id=? and current.adapter_version=? and current.activation_batch_id=? limit 1),'archived'),updated_at=? where user_id=? and id in (select old.projected_object_id from v2_legacy_source_mappings old join v2_legacy_source_mappings current on current.id=old.superseded_by_mapping_id and current.user_id=old.user_id join v2_legacy_migration_batch_items i on i.legacy_envelope_id=current.legacy_envelope_id and i.user_id=current.user_id where old.user_id=? and old.status='superseded' and old.superseded_from_status='projected' and i.batch_id=? and i.user_id=? and current.adapter_version=? and current.activation_batch_id=? and old.projected_object_id is not null) and ${fenceSql}`).bind(batch.id, this.userId, batch.adapter_version, batch.id, now, this.userId, this.userId, batch.id, this.userId, batch.adapter_version, batch.id, ...fenceBindings));
      statements.push(this.db.prepare(`update v2_objects set lifecycle_status='archived',updated_at=? where user_id=? and id in (select old.projected_object_id from v2_legacy_source_mappings old join v2_legacy_source_mappings current on current.id=old.superseded_by_mapping_id and current.user_id=old.user_id join v2_legacy_migration_batch_items i on i.legacy_envelope_id=current.legacy_envelope_id and i.user_id=current.user_id where old.user_id=? and old.status='superseded' and old.superseded_from_status='source_only' and i.batch_id=? and i.user_id=? and current.adapter_version=? and current.activation_batch_id=? and old.projected_object_id is not null) and ${fenceSql}`).bind(now, this.userId, this.userId, batch.id, this.userId, batch.adapter_version, batch.id, ...fenceBindings));
      statements.push(this.db.prepare(`update v2_legacy_source_mappings set status=superseded_from_status,superseded_at=null,superseded_by_mapping_id=null,superseded_from_status=null where user_id=? and status='superseded' and superseded_from_status in ('source_only','projected') and ${priorLinkedPredicate} and ${fenceSql}`).bind(this.userId, batch.id, this.userId, batch.adapter_version, batch.id, ...fenceBindings));
      statements.push(this.db.prepare(`update v2_legacy_source_mappings set status='source_only',activation_batch_id=null,superseded_at=null,superseded_by_mapping_id=null,superseded_from_status=null where user_id=? and activation_batch_id=? and status in ('knowledge_pending','projected') and id in (select m.id from v2_legacy_source_mappings m join v2_legacy_migration_batch_items i on i.legacy_envelope_id=m.legacy_envelope_id and i.user_id=m.user_id where i.batch_id=? and i.user_id=? and m.adapter_version=?) and ${fenceSql}`).bind(this.userId, batch.id, batch.id, this.userId, batch.adapter_version, ...fenceBindings));
    }
    statements.push(
      this.db.prepare(`update v2_legacy_migration_batches set control_status='quarantined',state_revision=state_revision+1,quarantine_idempotency_key=?,quarantine_reason=?,quarantine_pre_status=status,quarantine_pre_control_status=control_status,quarantine_receipt_json=?,quarantined_at=? where id=? and user_id=? and state_revision=? and control_status=? and quarantine_idempotency_key is null`).bind(input.idempotencyKey, reason, receiptJson, now, batch.id, this.userId, input.expectedRevision, preControlStatus),
      this.db.prepare(`delete from v2_legacy_quarantine_assertions where assertion_id=?`).bind(assertionId),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("legacy_provider_invocation_active")) {
        throw new LegacyMigrationError("legacy_quarantine_invocation_conflict", "A projected record is currently being sent to an AI provider; retry quarantine after that invocation finishes.");
      }
      if (message.includes("legacy_quarantine_transition_lost") || message.includes("legacy_quarantine_transition_not_committed")) {
        throw new LegacyMigrationError("legacy_quarantine_revision_conflict", "The migration batch changed before quarantine could commit.");
      }
      if (message.includes("legacy_quarantine_") || message.includes("legacy_superseded_basis_missing")) {
        throw new LegacyMigrationError("legacy_quarantine_state_conflict", "The migration batch could not be quarantined without violating its preservation fence.");
      }
      throw error;
    }
    const quarantined = await this.loadBatch(batch.id);
    if (!quarantined || quarantined.control_status !== "quarantined" || quarantined.state_revision !== input.expectedRevision + 1 || quarantined.quarantine_idempotency_key !== input.idempotencyKey) {
      throw new LegacyMigrationError("legacy_quarantine_revision_conflict", "The migration batch quarantine did not commit.");
    }
    return { disposition: "quarantined" as const, ...await this.getBatchView(batch.id) };
  }

  async reconcileBatch(importBatchId: string) {
    const batch = await this.loadBatch(importBatchId);
    if (!batch) throw new LegacyMigrationError("legacy_batch_not_found", "Migration batch was not found.");
    const manifest = parseManifest(batch.manifest_json);
    const items = await this.db.prepare(`select i.position,i.legacy_envelope_id,i.legacy_id,i.row_hash as item_row_hash,i.projection_hash,i.projections_json,i.expected_mapping_count,i.status as item_status,e.legacy_table,e.row_json,e.row_hash,e.schema_snapshot from v2_legacy_migration_batch_items i join v2_legacy_source_envelopes e on e.id=i.legacy_envelope_id and e.user_id=i.user_id where i.batch_id=? and i.user_id=? order by i.position`).bind(importBatchId, this.userId).all<{
      position: number; legacy_envelope_id: string; legacy_id: string; item_row_hash: string; projection_hash: string | null; projections_json: string | null; expected_mapping_count: number; item_status: string; legacy_table: string; row_json: string; row_hash: string; schema_snapshot: string;
    }>();
    const mappings = await this.db.prepare(`select m.id,m.legacy_envelope_id,m.legacy_table,m.legacy_id,m.adapter_version,m.source_item_id,m.projected_object_id,m.projection_kind,m.status,m.superseded_from_status,m.target_lifecycle_status,m.activation_batch_id,case when m.source_item_id is null then 0 when s.id is null then 0 else 1 end as source_exists,case when m.projected_object_id is null then 0 when o.id is null then 0 else 1 end as object_exists,o.lifecycle_status as object_lifecycle_status from v2_legacy_source_mappings m join v2_legacy_migration_batch_items i on i.legacy_envelope_id=m.legacy_envelope_id and i.user_id=m.user_id left join v2_source_items s on s.id=m.source_item_id and s.user_id=m.user_id left join v2_objects o on o.id=m.projected_object_id and o.user_id=m.user_id where i.batch_id=? and i.user_id=? and m.adapter_version=?`).bind(importBatchId, this.userId, batch.adapter_version).all<MappingRow & { source_exists: number; object_exists: number; object_lifecycle_status: string | null }>();
    const mappingsByKey = new Map<string, (MappingRow & { source_exists: number; object_exists: number; object_lifecycle_status: string | null })[]>();
    for (const mapping of mappings.results) {
      const key = `${mapping.legacy_envelope_id}\0${mapping.projection_kind}`;
      const existing = mappingsByKey.get(key) ?? [];
      existing.push(mapping);
      mappingsByKey.set(key, existing);
    }
    let invalidHashCount = 0;
    let rowHashMismatchCount = 0;
    let invalidRowJsonCount = 0;
    let manifestMismatchCount = 0;
    let projectionReceiptMismatchCount = 0;
    let deterministicProjectionMismatchCount = 0;
    let missingMappingCount = 0;
    let unexpectedMappingCount = 0;
    let invalidDependencyCount = 0;
    let invalidLifecycleCount = 0;
    let expectedProcessedMappings = 0;
    const expectedKeys = new Set<string>();
    const currentAdapter = LEGACY_ADAPTER_BY_TABLE.get(batch.legacy_table);
    const adapterVersionMismatchCount = currentAdapter?.version === batch.adapter_version ? 0 : 1;
    for (const item of items.results) {
      if (!/^[a-f0-9]{64}$/.test(item.row_hash)) invalidHashCount += 1;
      let row: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(item.row_json) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid row");
        row = parsed as Record<string, unknown>;
      } catch {
        invalidRowJsonCount += 1;
      }
      if (row && sha256Hex(canonicalJson(row)) !== item.row_hash) rowHashMismatchCount += 1;
      const entry = manifest[item.position];
      if (!entry || entry.legacyId !== item.legacy_id || entry.rowHash !== item.row_hash || entry.expectedMappingCount !== item.expected_mapping_count || item.item_row_hash !== item.row_hash || item.legacy_table !== batch.legacy_table || item.schema_snapshot !== batch.schema_snapshot) manifestMismatchCount += 1;
      let storedProjectionTargets: unknown = null;
      try {
        storedProjectionTargets = item.projections_json === null ? null : JSON.parse(item.projections_json);
      } catch {
        storedProjectionTargets = null;
      }
      const approvedTargets = entry?.projections;
      const projectionReceiptMismatch = !entry
        || item.projection_hash !== entry.projectionHash
        || !/^[a-f0-9]{64}$/.test(item.projection_hash ?? "")
        || storedProjectionTargets === null
        || canonicalJson(storedProjectionTargets) !== canonicalJson(approvedTargets);
      if (projectionReceiptMismatch) projectionReceiptMismatchCount += 1;
      if (row && currentAdapter?.version === batch.adapter_version) {
        try {
          const prepared = this.prepareRow(currentAdapter, item.legacy_id, row);
          const deterministicTargets = projectionTargets(prepared);
          if (!entry
            || prepared.rowHash !== item.row_hash
            || prepared.projectionHash !== entry.projectionHash
            || item.projection_hash !== prepared.projectionHash
            || canonicalJson(deterministicTargets) !== canonicalJson(entry.projections)
            || storedProjectionTargets === null
            || canonicalJson(storedProjectionTargets) !== canonicalJson(deterministicTargets)) {
            deterministicProjectionMismatchCount += 1;
          }
        } catch {
          deterministicProjectionMismatchCount += 1;
        }
      } else if (row) {
        deterministicProjectionMismatchCount += 1;
      }
      const keys = entry?.projections.map((projection) => projection.key) ?? [];
      expectedProcessedMappings += keys.length;
      for (const projectionKey of keys) {
        const key = `${item.legacy_envelope_id}\0${projectionKey}`;
        expectedKeys.add(key);
        const matches = mappingsByKey.get(key) ?? [];
        if (matches.length !== 1) {
          missingMappingCount += matches.length ? 0 : 1;
          unexpectedMappingCount += Math.max(0, matches.length - 1);
          continue;
        }
        const mapping = matches[0];
        const expectedProjection = entry?.projections.find((projection) => projection.key === projectionKey);
        if (mapping.legacy_table !== item.legacy_table || mapping.legacy_id !== item.legacy_id || mapping.adapter_version !== batch.adapter_version || mapping.target_lifecycle_status !== (projectionKey === "archived_only" ? null : expectedProjection?.lifecycleStatus)) manifestMismatchCount += 1;
        if (projectionKey === "archived_only") {
          if (mapping.status !== "archived" || mapping.source_item_id !== null || mapping.projected_object_id !== null) invalidDependencyCount += 1;
        } else {
          const allowedStatus = batch.control_status === "quarantined"
            ? mapping.status === "source_only" && mapping.activation_batch_id === null
              || batch.mode === "knowledge" && mapping.status === "projected" && mapping.activation_batch_id !== batch.id
            : batch.mode === "knowledge"
            ? batch.status === "succeeded"
              ? mapping.status === "projected" || mapping.status === "superseded"
              : mapping.status === "projected" || mapping.status === "knowledge_pending" && mapping.activation_batch_id === batch.id
            : ["source_only", "knowledge_pending", "projected", "superseded"].includes(mapping.status);
          const expectedLifecycle = mapping.status === "projected" ? mapping.target_lifecycle_status : "archived";
          const lifecycleInvalid = mapping.object_exists === 1
            && (expectedLifecycle === null || mapping.object_lifecycle_status !== expectedLifecycle);
          if (lifecycleInvalid) invalidLifecycleCount += 1;
          if (!allowedStatus || mapping.source_exists !== 1 || mapping.object_exists !== 1 || lifecycleInvalid) invalidDependencyCount += 1;
        }
      }
    }
    const linkedSupersededLifecycle = await this.db.prepare(`select count(*) as value from v2_legacy_source_mappings old join v2_legacy_source_mappings current on current.id=old.superseded_by_mapping_id and current.user_id=old.user_id left join v2_objects o on o.id=old.projected_object_id and o.user_id=old.user_id where current.activation_batch_id=? and current.user_id=? and old.status='superseded' and (old.projected_object_id is null or o.id is null or o.lifecycle_status<>'archived')`).bind(importBatchId, this.userId).first<{ value: number }>();
    const linkedSupersededLifecycleCount = Number(linkedSupersededLifecycle?.value ?? 0);
    invalidLifecycleCount += linkedSupersededLifecycleCount;
    invalidDependencyCount += linkedSupersededLifecycleCount;
    for (const [key, rows] of mappingsByKey) if (!expectedKeys.has(key)) unexpectedMappingCount += rows.length;
    const statusCount = (status: string) => mappings.results.filter((mapping) => mapping.status === status).length;
    const processedItemCount = items.results.filter((item) => item.item_status === "succeeded").length;
    const pendingItemCount = items.results.length - processedItemCount;
    const distinctEnvelopeCount = new Set(items.results.map((item) => item.legacy_envelope_id)).size;
    const structurallyValid = invalidHashCount === 0 && rowHashMismatchCount === 0 && invalidRowJsonCount === 0 && manifestMismatchCount === 0 && projectionReceiptMismatchCount === 0 && deterministicProjectionMismatchCount === 0 && adapterVersionMismatchCount === 0 && missingMappingCount === 0 && unexpectedMappingCount === 0 && invalidDependencyCount === 0 && invalidLifecycleCount === 0 && pendingItemCount === 0 && mappings.results.length === expectedProcessedMappings && distinctEnvelopeCount === items.results.length;
    const complete = structurallyValid && batch.status === "succeeded" && batch.control_status === "complete" && batch.reconciliation_status === "passed" && Boolean(batch.reconciliation_json) && Boolean(batch.reconciled_at) && batch.next_offset === batch.input_rows && processedItemCount === batch.input_rows && mappings.results.length === batch.expected_mapping_count;
    return {
      importBatchId,
      batch_status: batch.status,
      control_status: batch.control_status,
      state_revision: batch.state_revision,
      input_rows: batch.input_rows,
      next_offset: batch.next_offset,
      expected_mapping_count: batch.expected_mapping_count,
      envelope_count: items.results.length,
      distinct_envelope_count: distinctEnvelopeCount,
      invalid_hash_count: invalidHashCount,
      row_hash_mismatch_count: rowHashMismatchCount,
      invalid_row_json_count: invalidRowJsonCount,
      manifest_mismatch_count: manifestMismatchCount,
      projection_receipt_mismatch_count: projectionReceiptMismatchCount,
      deterministic_projection_mismatch_count: deterministicProjectionMismatchCount,
      adapter_version_mismatch_count: adapterVersionMismatchCount,
      mapping_count: mappings.results.length,
      expected_processed_mapping_count: expectedProcessedMappings,
      missing_mapping_count: missingMappingCount,
      unexpected_mapping_count: unexpectedMappingCount,
      invalid_dependency_count: invalidDependencyCount,
      invalid_lifecycle_count: invalidLifecycleCount,
      source_only_count: statusCount("source_only"),
      projected_count: statusCount("projected"),
      archived_count: statusCount("archived"),
      superseded_count: statusCount("superseded"),
      pending_mapping_count: statusCount("pending"),
      knowledge_pending_count: statusCount("knowledge_pending"),
      processed_item_count: processedItemCount,
      pending_item_count: pendingItemCount,
      structurally_valid: structurallyValid,
      complete,
    };
  }
}
