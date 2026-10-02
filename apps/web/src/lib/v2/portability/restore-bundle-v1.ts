import { ulid } from "ulidx";

import { readManualLinkSource } from "@/lib/v2/domain/manual-link-source";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding } from "@/lib/v2/infrastructure/r2/attachment-object-repository";
import { D1LegacyMigrationRepository } from "@/lib/v2/migration/legacy-migration-repository";
import { normalizeLegacyRestoreRow } from "@/lib/v2/portability/legacy-restore-compatibility";
import { rollbackTombstoneAggregateKind, uploadVerifiedStream } from "@/lib/v2/portability/backup-snapshot-v1";
import { CANONICAL_TABLES_V1, CANONICAL_SOFT_REFERENCES_V1, RESTORE_TABLE_ORDER_V2, canonicalTablesForSchemaVersion, type CanonicalTableDescriptor } from "@/lib/v2/portability/canonical-table-registry-v1";
import { canonicalJson, sha256Hex, unwrapCanonicalRow, validateExportManifest, type ExportManifestV1, type LighthouseSchemaVersion } from "@/lib/v2/portability/portability-contract-v1";
import { parseStoredZip, type ParsedZipEntry } from "@/lib/v2/portability/zip-stream-v1";

const decoder = new TextDecoder("utf-8", { fatal: true });
const IMPORT_BATCH_STATEMENT_LIMIT = 80;
const POLYMORPHIC_TARGET_TABLES: Readonly<Record<string, string>> = {
  type_assignment: "v2_object_type_assignments",
  property_value: "v2_property_values",
  entity: "v2_entity_records",
  event: "v2_event_records",
  relation: "v2_relation_edges",
  review_item: "v2_review_items",
  document: "v2_documents",
};

export class RestoreContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "RestoreContractError"; }
}

export type VerifiedExportBundle = Readonly<{
  archiveSha256: string;
  manifest: ExportManifestV1;
  entries: ReadonlyMap<string, ParsedZipEntry>;
  rowsByTable: ReadonlyMap<string, readonly Record<string, unknown>[]>;
  backupOriginals?: ReadonlyMap<string, Readonly<{ objectKey: string; sha256: string; bytes: number; mediaType: string }>>;
  backupSourceBucket?: R2BucketBinding;
}>;

export type RestoreDryRun = Readonly<{
  archiveSha256: string;
  manifestRootHash: string;
  dryRunHash: string;
  counts: Readonly<{ create: number; reuse: number; fork: number; conflict: number; invalid: number }>;
  tables: readonly Readonly<{ table: string; rows: number; create: number; reuse: number; fork: number; conflict: number }>[];
  warnings: readonly string[];
}>;

function parseJsonl(entry: ParsedZipEntry, exportId: string, schemaVersion: LighthouseSchemaVersion) {
  const text = decoder.decode(entry.bytes);
  if (!text) return [];
  if (!text.endsWith("\n")) throw new RestoreContractError("jsonl_invalid", `${entry.path} must end with LF.`);
  return text.slice(0, -1).split("\n").map((line, index) => {
    let row: unknown;
    try { row = JSON.parse(line); } catch { throw new RestoreContractError("jsonl_invalid", `${entry.path}:${index + 1} is not JSON.`); }
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new RestoreContractError("jsonl_invalid", `${entry.path}:${index + 1} must be an object.`);
    const object = row as Record<string, unknown>;
    if (object.user_scope_export_id !== exportId || object.schema_version !== schemaVersion) throw new RestoreContractError("jsonl_invalid", `${entry.path}:${index + 1} has the wrong export scope or schema.`);
    return object;
  });
}

function parseChecksums(entry: ParsedZipEntry) {
  const checksums = new Map<string, string>();
  for (const [index, line] of decoder.decode(entry.bytes).split("\n").entries()) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new RestoreContractError("checksums_invalid", `checksums.sha256:${index + 1} is invalid.`);
    if (checksums.has(match[2])) throw new RestoreContractError("checksums_invalid", "Checksum file contains a duplicate path.");
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function rowKey(descriptor: CanonicalTableDescriptor, row: Record<string, unknown>) {
  const key = Object.fromEntries(descriptor.primaryKey.map((column) => [column, row[column]]));
  if (Object.values(key).some((value) => typeof value !== "string" && typeof value !== "number")) throw new RestoreContractError("row_key_invalid", `${descriptor.table} has an invalid primary key.`);
  return canonicalJson(key);
}

export function validateReferenceClosure(rowsByTable: ReadonlyMap<string, readonly Record<string, unknown>[]>) {
  const softReferences = CANONICAL_SOFT_REFERENCES_V1;
  const keySets = new Map<string, Set<string>>();
  for (const descriptor of CANONICAL_TABLES_V1) {
    if (descriptor.primaryKey.length !== 1) continue;
    keySets.set(descriptor.table, new Set((rowsByTable.get(descriptor.table) ?? []).map((row) => String(row[descriptor.primaryKey[0]]))));
  }
  for (const descriptor of CANONICAL_TABLES_V1) {
    for (const row of rowsByTable.get(descriptor.table) ?? []) {
      for (const [column, targetTable] of Object.entries({ ...(descriptor.foreignKeys ?? {}), ...(softReferences[descriptor.table] ?? {}) })) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        const targets = keySets.get(targetTable);
        if (targets && !targets.has(String(value))) throw new RestoreContractError("reference_closure_invalid", `${descriptor.table}.${column} refers outside the bundle.`);
      }
      if ((descriptor.table === "v2_evidence_refs" || descriptor.table === "v2_review_receipts") && typeof row.target_id === "string") {
        const targetTable = POLYMORPHIC_TARGET_TABLES[String(row.target_kind)];
        if (!targetTable) throw new RestoreContractError("reference_closure_invalid", `${descriptor.table}.target_kind is not restorable.`);
        if (!keySets.get(targetTable)?.has(row.target_id)) throw new RestoreContractError("reference_closure_invalid", `${descriptor.table}.target_id refers outside the bundle.`);
      }
    }
  }
  const indexed = new Map<string, Record<string, unknown>>();
  for (const descriptor of CANONICAL_TABLES_V1) {
    if (descriptor.primaryKey.length !== 1) continue;
    for (const row of rowsByTable.get(descriptor.table) ?? []) indexed.set(`${descriptor.table}\0${row[descriptor.primaryKey[0]]}`, row);
  }
  for (const row of rowsByTable.get("v2_document_source_links") ?? []) indexed.set(`v2_document_source_links\0${canonicalJson({ document_object_id: row.document_object_id, source_item_id: row.source_item_id })}`, row);
  for (const row of rowsByTable.get("v2_source_attachment_links") ?? []) indexed.set(`v2_source_attachment_links\0${canonicalJson({ source_item_id: row.source_item_id, attachment_id: row.attachment_id })}`, row);
  for (const [table, rows] of rowsByTable) for (const row of rows) {
    validateLinkRestoreRow(table, row, (target, id) => indexed.get(`${target}\0${id}`), table === "v2_link_curation_items"
      ? (rowsByTable.get("v2_link_fragment_evidence") ?? []).filter((evidence) => evidence.fragment_id === row.fragment_id) : []);
  }
  for (const revision of rowsByTable.get("v2_link_curation_revisions") ?? []) validateCurationChildCounts(revision,
    (rowsByTable.get("v2_link_curation_items") ?? []).filter((row) => row.curation_revision_id === revision.id),
    (rowsByTable.get("v2_link_curation_examples") ?? []).filter((row) => row.curation_revision_id === revision.id));
}

type CanonicalRow = Record<string, unknown>;
type LinkRowLookup = (table: string, id: string) => CanonicalRow | undefined;
const curationCompleteness = ["complete", "partial", "truncated", "ocr_unverified", "selection_unverified", "unknown"];

function curationParts(value: unknown) {
  const object = (input: unknown, keys: readonly string[]): input is CanonicalRow => Boolean(input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).length === keys.length && Object.keys(input).every((key) => keys.includes(key)));
  if (!object(value, ["number", "total"])) return false;
  for (const claim of [value.number, value.total]) {
    if (!object(claim, ["value", "origin"]) || !["unknown", "user_declared", "source_explicit"].includes(String(claim.origin))) return false;
    if (claim.origin === "unknown" ? claim.value !== null : !Number.isSafeInteger(claim.value) || Number(claim.value) < 1 || Number(claim.value) > 100) return false;
  }
  const number = (value.number as CanonicalRow).value, total = (value.total as CanonicalRow).value;
  return number === null || total === null || Number(number) <= Number(total);
}

function curationManifest(row: CanonicalRow) {
  let manifest: CanonicalRow;
  try { manifest = JSON.parse(String(row.manifest_json)) as CanonicalRow; } catch { throw new RestoreContractError("prompt_curation_manifest_invalid", "Curation manifest is not JSON."); }
  const invalid = !manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || canonicalJson(manifest) !== row.manifest_json || sha256Hex(String(row.manifest_json)) !== row.manifest_hash
    || manifest.manifestVersion !== "prompt-curation-manifest.v1" || manifest.renderVersion !== "prompt-curation-render.v1"
    || manifest.manifestVersion !== row.manifest_version || manifest.renderVersion !== row.render_version
    || manifest.title !== row.title || manifest.relationKind !== row.relation_kind
    || manifest.relationshipConfirmation !== row.relationship_confirmation || manifest.orderConfirmation !== row.order_confirmation
    || manifest.separator !== "\n" || row.separator !== "\n"
    || !Array.isArray(manifest.items) || manifest.items.length < 1 || manifest.items.length > 64
    || !Array.isArray(manifest.examples) || manifest.examples.length > 64
    || Object.keys(manifest).some((key) => !["manifestVersion", "renderVersion", "snapshotManifestHash", "title", "relationKind", "relationshipConfirmation", "orderConfirmation", "separator", "items", "examples"].includes(key));
  if (invalid) throw new RestoreContractError("prompt_curation_manifest_invalid", "Curation manifest or immutable metadata differs from its hash/contract.");
  const items = manifest.items as CanonicalRow[], examples = manifest.examples as CanonicalRow[];
  const positions = new Map<string, number>();
  const keys = new Set<unknown>();
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.itemKey !== "string" || keys.has(item.itemKey)
      || Object.keys(item).some((key) => !["itemKey", "role", "position", "memberKey", "sourceFingerprint", "sourceContentHash", "sourceCompleteness", "parts", "textStart", "textEnd", "rawTextHash", "completeness", "selectionOrigin"].includes(key))
      || !["prompt", "negative_prompt", "parameters"].includes(String(item.role)) || item.position !== (positions.get(String(item.role)) ?? 0)
      || !curationCompleteness.includes(String(item.sourceCompleteness)) || !curationCompleteness.includes(String(item.completeness))
      || !["user_selected", "ai_selected"].includes(String(item.selectionOrigin)) || !curationParts(item.parts)) {
      throw new RestoreContractError("prompt_curation_manifest_invalid", "Curation item keys and per-role positions must be unique and contiguous.");
    }
    keys.add(item.itemKey); positions.set(String(item.role), Number(item.position) + 1);
  }
  const exampleKeys = new Set<unknown>();
  for (const [index, example] of examples.entries()) {
    if (!example || typeof example !== "object" || typeof example.exampleKey !== "string" || exampleKeys.has(example.exampleKey)
      || Object.keys(example).some((key) => !["exampleKey", "itemKey", "memberKey", "sourceFingerprint", "sha256", "mimeType", "sizeBytes", "position", "evidenceMethod"].includes(key))
      || example.position !== index || example.itemKey !== null && !keys.has(example.itemKey)
      || row.relation_kind === "alternatives" && example.itemKey === null) throw new RestoreContractError("prompt_curation_manifest_invalid", "Curation examples have invalid targets or positions.");
    exampleKeys.add(example.exampleKey);
  }
  return { manifest, items, examples };
}

export function validateCurationChildCounts(revision: CanonicalRow, items: readonly CanonicalRow[], examples: readonly CanonicalRow[]) {
  const expected = curationManifest(revision);
  if (items.length !== expected.items.length || examples.length !== expected.examples.length
    || new Set(items.map((row) => row.item_key)).size !== items.length || new Set(examples.map((row) => row.example_key)).size !== examples.length) {
    throw new RestoreContractError("prompt_curation_manifest_invalid", "Curation manifest children are missing or duplicated.");
  }
}

/** Cross-column identities are checked before user IDs are rewritten. An ID
 * being present in the archive is not enough to establish source ownership. */
export function validateLinkRestoreRow(table: string, row: CanonicalRow, lookup: LinkRowLookup, fragmentEvidence: readonly CanonicalRow[] = []) {
  if (!table.startsWith("v2_link_") && table !== "v2_documents" && table !== "v2_processing_jobs") return;
  const required = (target: string, value: unknown) => {
    const found = typeof value === "string" ? lookup(target, value) : undefined;
    if (!found) throw new RestoreContractError("reference_closure_invalid", `${table} is missing a required ${target} reference.`);
    return found;
  };
  const same = (valid: boolean) => { if (!valid) throw new RestoreContractError("link_reference_invalid", `${table} has inconsistent owner, document, capture, snapshot, or manifest identity.`); };
  if (table === "v2_link_curation_revisions") {
    const snapshot = required("v2_link_snapshots", row.snapshot_id);
    const { manifest } = curationManifest(row);
    same(snapshot.user_id === row.user_id && snapshot.document_object_id === row.document_object_id && manifest.snapshotManifestHash === snapshot.manifest_hash);
    if (row.parent_revision_id == null) same(row.revision_number === 1);
    else {
      const parent = required("v2_link_curation_revisions", row.parent_revision_id);
      same(parent.user_id === row.user_id && parent.document_object_id === row.document_object_id && parent.snapshot_id === row.snapshot_id
        && parent.group_key === row.group_key && Number(parent.revision_number) + 1 === row.revision_number && parent.id !== row.id);
    }
    if (row.based_on_revision_id != null) {
      const basis = required("v2_link_curation_revisions", row.based_on_revision_id);
      same(basis.user_id === row.user_id && basis.document_object_id === row.document_object_id && basis.id !== row.id);
    }
  } else if (table === "v2_link_curation_items") {
    const revision = required("v2_link_curation_revisions", row.curation_revision_id), fragment = required("v2_link_fragments", row.fragment_id);
    const member = required("v2_link_snapshot_sources", fragment.primary_member_id), source = required("v2_source_items", member.source_item_id);
    const item = curationManifest(revision).items.find((item) => item.itemKey === row.item_key);
    let sourceMetadata: unknown, fragmentDetails: CanonicalRow;
    try { sourceMetadata = JSON.parse(String(source.source_metadata)); fragmentDetails = JSON.parse(String(fragment.details_json)) as CanonicalRow; }
    catch { throw new RestoreContractError("prompt_curation_provenance_invalid", "Curation source or selection provenance is not valid JSON."); }
    const manual = readManualLinkSource(sourceMetadata);
    const claim = (value: number | null) => ({ value, origin: value === null ? "unknown" : "user_declared" });
    // v1's only persisted text catalog is explicitly supplied manual link data.
    // Future source-explicit adapters must provide a versioned proof, not relabel
    // the user's declaration or infer authority from a rehashed manifest alone.
    same(source.item_kind === "url" && manual !== null && item?.sourceCompleteness === manual.completeness
      && canonicalJson(item?.parts) === canonicalJson({ number: claim(manual?.partNumber ?? null), total: claim(manual?.totalParts ?? null) }));
    const manualSelection = fragment.processing_run_id == null;
    same(Boolean(fragmentDetails) && typeof fragmentDetails === "object" && !Array.isArray(fragmentDetails)
      && (manualSelection ? fragmentDetails.contract === "manual-link-fragment.v1" && fragmentDetails.selectionOrigin === "user_selected"
        && fragment.locked_by_user === 1 && item?.selectionOrigin === "user_selected"
        : fragmentDetails.contract === "link-analysis.v1" && item?.selectionOrigin === "ai_selected"));
    const evidence = fragmentEvidence[0];
    same(fragmentEvidence.length === 1 && evidence.user_id === row.user_id && evidence.fragment_id === fragment.id
      && evidence.member_id === member.id && evidence.relation_kind === "supports"
      && evidence.text_start === fragment.text_start && evidence.text_end === fragment.text_end && evidence.display_order === 0
      && evidence.image_region_json == null && evidence.start_seconds == null && evidence.end_seconds == null
      && (manualSelection ? evidence.evidence_method === "user_confirmed" && evidence.locked_by_user === 1 && evidence.state_version === 1
        : ["ai_proposed", "user_confirmed"].includes(String(evidence.evidence_method))));
    same(revision.user_id === row.user_id && fragment.user_id === row.user_id && member.user_id === row.user_id && source.user_id === row.user_id
      && revision.document_object_id === fragment.document_object_id && revision.snapshot_id === fragment.snapshot_id && member.snapshot_id === revision.snapshot_id
      && fragment.source_class === "source_extract" && fragment.role === row.copy_role
      && Number.isSafeInteger(row.fragment_state_version) && Number(row.fragment_state_version) >= 1 && Number(row.fragment_state_version) <= Number(fragment.state_version)
      && Boolean(item) && item!.role === row.copy_role && item!.position === row.position && item!.memberKey === member.member_key
      && item!.sourceFingerprint === member.source_fingerprint && item!.sourceContentHash === String(source.content_hash).replace(/^sha256:/, "")
      && item!.textStart === fragment.text_start && item!.textEnd === fragment.text_end && item!.rawTextHash === fragment.raw_text_hash && item!.completeness === fragment.completeness
      && typeof source.raw_text === "string" && typeof fragment.raw_text === "string"
      && source.raw_text.slice(Number(fragment.text_start), Number(fragment.text_end)) === fragment.raw_text && sha256Hex(fragment.raw_text) === fragment.raw_text_hash);
  } else if (table === "v2_link_curation_examples") {
    const revision = required("v2_link_curation_revisions", row.curation_revision_id), member = required("v2_link_snapshot_sources", row.member_id);
    const attachment = required("v2_attachment_reservations", row.attachment_id);
    const link = required("v2_source_attachment_links", canonicalJson({ source_item_id: member.source_item_id, attachment_id: row.attachment_id }));
    const item = row.item_id == null ? null : required("v2_link_curation_items", row.item_id);
    const example = curationManifest(revision).examples.find((example) => example.exampleKey === row.example_key);
    same(revision.user_id === row.user_id && member.user_id === row.user_id && attachment.user_id === row.user_id && link.user_id === row.user_id
      && member.snapshot_id === revision.snapshot_id && attachment.status === "committed" && Boolean(attachment.committed_at) && /^image\/[a-z0-9.+-]+$/.test(String(attachment.mime_type))
      && (!item || item.curation_revision_id === revision.id && item.user_id === row.user_id) && (revision.relation_kind !== "alternatives" || item !== null)
      && Boolean(example) && example!.itemKey === (item?.item_key ?? null) && example!.memberKey === member.member_key && example!.sourceFingerprint === member.source_fingerprint
      && example!.sha256 === String(attachment.sha256).replace(/^sha256:/, "") && example!.mimeType === attachment.mime_type && example!.sizeBytes === attachment.size_bytes
      && example!.position === row.position && example!.evidenceMethod === row.evidence_method);
  } else if (table === "v2_link_snapshots") {
    const document = required("v2_documents", row.document_object_id);
    const owner = required("v2_objects", row.document_object_id);
    const capture = required("v2_capture_bundles", row.capture_id);
    same(owner.user_id === row.user_id && capture.user_id === row.user_id && document.capture_id === row.capture_id);
    if (row.parent_snapshot_id == null) same(row.snapshot_version === 1);
    else {
      const parent = required("v2_link_snapshots", row.parent_snapshot_id);
      same(parent.user_id === row.user_id && parent.document_object_id === row.document_object_id && parent.capture_id === row.capture_id && Number(parent.snapshot_version) + 1 === row.snapshot_version);
    }
  } else if (table === "v2_link_snapshot_sources") {
    const snapshot = required("v2_link_snapshots", row.snapshot_id);
    const source = required("v2_source_items", row.source_item_id);
    required("v2_document_source_links", canonicalJson({ document_object_id: snapshot.document_object_id, source_item_id: row.source_item_id }));
    same(snapshot.user_id === row.user_id && source.user_id === row.user_id && source.capture_id === snapshot.capture_id);
  } else if (table === "v2_link_fragments") {
    const snapshot = required("v2_link_snapshots", row.snapshot_id);
    const member = required("v2_link_snapshot_sources", row.primary_member_id);
    same(snapshot.user_id === row.user_id && snapshot.document_object_id === row.document_object_id && member.user_id === row.user_id && member.snapshot_id === row.snapshot_id);
    if (row.processing_run_id != null) {
      const run = required("v2_processing_runs", row.processing_run_id);
      const job = required("v2_processing_jobs", run.job_id);
      same(run.user_id === row.user_id && job.user_id === row.user_id && job.object_id === row.document_object_id && job.input_link_snapshot_id === row.snapshot_id);
    }
  } else if (table === "v2_link_fragment_evidence") {
    const fragment = required("v2_link_fragments", row.fragment_id);
    const member = required("v2_link_snapshot_sources", row.member_id);
    same(fragment.user_id === row.user_id && member.user_id === row.user_id && member.snapshot_id === fragment.snapshot_id);
  } else if (table === "v2_processing_jobs" && (row.input_link_snapshot_id != null || row.stage === "link_analyze")) {
    const snapshot = required("v2_link_snapshots", row.input_link_snapshot_id);
    same(snapshot.user_id === row.user_id && snapshot.document_object_id === row.object_id && snapshot.capture_id === row.capture_id && snapshot.manifest_hash === row.input_source_manifest_hash && snapshot.manifest_version === row.input_source_manifest_version);
  } else if (table === "v2_documents" && (row.current_link_snapshot_id != null || row.published_link_run_id != null)) {
    const snapshot = required("v2_link_snapshots", row.current_link_snapshot_id);
    const owner = required("v2_objects", row.object_id);
    same(snapshot.user_id === owner.user_id && snapshot.document_object_id === row.object_id && snapshot.capture_id === row.capture_id && snapshot.snapshot_version === row.link_snapshot_version);
    if (row.published_link_run_id != null) {
      const run = required("v2_processing_runs", row.published_link_run_id);
      const job = required("v2_processing_jobs", run.job_id);
      same(run.user_id === owner.user_id && job.user_id === owner.user_id && job.object_id === row.object_id && job.input_link_snapshot_id === snapshot.id);
    }
  }
}

/** Restored provider work is history, not authorization to invoke a provider.
 * The new identity namespace also prevents a source retry key from reviving
 * a job whose database IDs were forked during import. */
export function sanitizeRestoredLinkJob(table: string, row: CanonicalRow): CanonicalRow {
  if (table !== "v2_processing_jobs" || (row.stage !== "link_analyze" && row.input_link_snapshot_id == null)) return row;
  const terminal = ["succeeded", "dead_letter", "superseded"].includes(String(row.status));
  return {
    ...row,
    idempotency_key: `restored-link:${sha256Hex(`${row.user_id}\0${row.id}`)}`,
    lease_owner: null, lease_expires_at: null,
    ...(!terminal ? { status: "superseded", last_error_class: "superseded", last_error_code: "restore_audit_only", finished_at: row.finished_at ?? row.created_at } : {}),
  };
}

export function validateCanonicalArchiveFiles(manifest: ExportManifestV1) {
  if (manifest.profile !== "migration") return;
  const required = new Set(canonicalTablesForSchemaVersion(manifest.schemaVersion).map((descriptor) => descriptor.path));
  const included = new Set(manifest.files.map((file) => file.path));
  for (const path of required) if (!included.has(path)) throw new RestoreContractError("bundle_incomplete", `Migration bundle is missing ${path}.`);
  for (const descriptor of CANONICAL_TABLES_V1) {
    if (included.has(descriptor.path) && !required.has(descriptor.path)) throw new RestoreContractError("row_schema_invalid", `${descriptor.path} requires a newer archive schema version.`);
  }
}

export function verifyExportBundle(bytes: Uint8Array): VerifiedExportBundle {
  const entries = parseStoredZip(bytes);
  const manifestEntry = entries.get("manifest.json");
  const checksumEntry = entries.get("checksums.sha256");
  const readmeEntry = entries.get("README.md");
  if (!manifestEntry || !checksumEntry || !readmeEntry) throw new RestoreContractError("bundle_incomplete", "Bundle requires README, manifest, and checksums.");
  let rawManifest: unknown;
  try { rawManifest = JSON.parse(decoder.decode(manifestEntry.bytes)); } catch { throw new RestoreContractError("manifest_invalid", "manifest.json is not JSON."); }
  const manifest = validateExportManifest(rawManifest);
  validateCanonicalArchiveFiles(manifest);
  const checksums = parseChecksums(checksumEntry);
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  for (const file of manifest.files) {
    const entry = entries.get(file.path);
    if (!entry || entry.bytes.byteLength !== file.bytes || sha256Hex(entry.bytes) !== file.sha256 || checksums.get(file.path) !== file.sha256) {
      throw new RestoreContractError("checksum_mismatch", `Payload checksum failed: ${file.path}`);
    }
  }
  if (checksums.size !== manifest.files.length || [...checksums.keys()].some((path) => !manifestPaths.has(path))) throw new RestoreContractError("checksums_invalid", "Checksum coverage must exactly match manifest payload files.");
  if ([...entries.keys()].some((path) => path !== "manifest.json" && path !== "checksums.sha256" && !manifestPaths.has(path))) throw new RestoreContractError("bundle_unmanifested_file", "Bundle contains an unmanifested payload.");
  const rowsByTable = new Map<string, readonly Record<string, unknown>[]>();
  if (manifest.profile === "migration") {
    for (const descriptor of canonicalTablesForSchemaVersion(manifest.schemaVersion)) {
      const entry = entries.get(descriptor.path);
      if (!entry) throw new RestoreContractError("bundle_incomplete", `Migration bundle is missing ${descriptor.path}.`);
      const rows = parseJsonl(entry, manifest.exportId, manifest.schemaVersion);
      for (const row of rows) unwrapCanonicalRow(row, descriptor.table);
      if (manifest.counts[descriptor.table] !== rows.length) throw new RestoreContractError("count_mismatch", `${descriptor.table} count does not match manifest.`);
      rowsByTable.set(descriptor.table, rows);
    }
    validateReferenceClosure(rowsByTable);
  }
  return { archiveSha256: sha256Hex(bytes), manifest, entries, rowsByTable };
}

async function existingRowByColumns(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>, columns: readonly string[]) {
  if (columns.some((column) => row[column] === undefined)) throw new RestoreContractError("row_key_invalid", `${descriptor.table} has an incomplete restore identity.`);
  const where = columns.map((column) => `"${column}" is ?`).join(" and ");
  return db.prepare(`select * from ${descriptor.table} where ${where} limit 1`).bind(...columns.map((column) => row[column])).first<Record<string, unknown>>();
}

async function existingRow(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>) {
  return existingRowByColumns(db, descriptor, row, descriptor.primaryKey);
}

async function existingAlternateRow(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>) {
  return descriptor.alternateKey ? existingRowByColumns(db, descriptor, row, descriptor.alternateKey) : null;
}

function comparableExisting(descriptor: CanonicalTableDescriptor, existing: Record<string, unknown>, candidate: Record<string, unknown>) {
  // A restored original is deliberately written under a target-owned R2 key. The
  // immutable reservation ID plus its verified content metadata are the portable
  // identity; the source account's physical object key is not.
  const ignored = descriptor.table === "v2_attachment_reservations" ? new Set(["object_key"]) : new Set<string>();
  return Object.fromEntries(Object.keys(candidate).filter((key) => !ignored.has(key)).map((key) => [key, existing[key]]));
}

function comparableCandidate(descriptor: CanonicalTableDescriptor, candidate: Record<string, unknown>) {
  if (descriptor.table !== "v2_attachment_reservations") return candidate;
  return Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "object_key"));
}

function normalizeForUser(row: Record<string, unknown>, userId: string, table: string) {
  const value = { ...unwrapCanonicalRow(row, table) };
  if ("user_id" in value) value.user_id = userId;
  return normalizeLegacyRestoreRow(table, value);
}

type RestoreDisposition = "created" | "reused" | "forked" | "conflict";

function recordPrimaryMapping(descriptor: CanonicalTableDescriptor, source: Record<string, unknown>, candidate: Record<string, unknown>, mappings: Map<string, string>) {
  if (descriptor.primaryKey.length !== 1) return;
  const primary = descriptor.primaryKey[0];
  if (typeof source[primary] === "string" && typeof candidate[primary] === "string") mappings.set(`${descriptor.table}\0${String(source[primary])}`, String(candidate[primary]));
}

function candidateWithExistingPrimary(descriptor: CanonicalTableDescriptor, candidate: Record<string, unknown>, existing: Record<string, unknown>) {
  return { ...candidate, ...Object.fromEntries(descriptor.primaryKey.map((column) => [column, existing[column]])) };
}

async function resolveRestoreCandidate(input: {
  db: D1DatabaseBinding;
  descriptor: CanonicalTableDescriptor;
  source: Record<string, unknown>;
  mappings: Map<string, string>;
  previousMappings?: ReadonlyMap<string, string>;
  forkId: () => string;
}) {
  let candidate = sanitizeRestoredLinkJob(input.descriptor.table, rewriteForeignKeys(input.source, input.descriptor, input.mappings));
  const primary = input.descriptor.primaryKey[0];
  const priorTarget = input.descriptor.primaryKey.length === 1 && typeof input.source[primary] === "string"
    ? input.previousMappings?.get(`${input.descriptor.table}\0${input.source[primary]}`) : undefined;
  if (priorTarget !== undefined) {
    candidate = sanitizeRestoredLinkJob(input.descriptor.table, { ...candidate, [primary]: priorTarget });
    const priorExisting = await existingRow(input.db, input.descriptor, candidate);
    // A durable collision map is a hint, never permission to overwrite or to
    // reuse a target that has since changed owner/content or been deleted.
    if (!priorExisting || canonicalJson(comparableExisting(input.descriptor, priorExisting, candidate)) !== canonicalJson(comparableCandidate(input.descriptor, candidate))) {
      return { candidate, disposition: "conflict" as const };
    }
    recordPrimaryMapping(input.descriptor, input.source, candidate, input.mappings);
    return { candidate, disposition: "reused" as const };
  }
  const primaryExisting = await existingRow(input.db, input.descriptor, candidate);
  if (primaryExisting && canonicalJson(comparableExisting(input.descriptor, primaryExisting, candidate)) === canonicalJson(comparableCandidate(input.descriptor, candidate))) {
    recordPrimaryMapping(input.descriptor, input.source, candidate, input.mappings);
    return { candidate, disposition: "reused" as const };
  }

  const alternateExisting = await existingAlternateRow(input.db, input.descriptor, candidate);
  if (alternateExisting) {
    if (input.descriptor.alternateKeyResolution === "conflict") return { candidate, disposition: "conflict" as const };
    const reused = candidateWithExistingPrimary(input.descriptor, candidate, alternateExisting);
    if (input.descriptor.alternateKeyResolution === "exact" && canonicalJson(comparableExisting(input.descriptor, alternateExisting, reused)) !== canonicalJson(comparableCandidate(input.descriptor, reused))) return { candidate, disposition: "conflict" as const };
    recordPrimaryMapping(input.descriptor, input.source, reused, input.mappings);
    return { candidate: reused, disposition: "reused" as const };
  }

  if (primaryExisting) {
    const primary = input.descriptor.primaryKey[0];
    // A joined row (for example documents.object_id) cannot fork its primary
    // identity independently of the parent object graph.
    if (input.descriptor.primaryKey.length !== 1 || primary === "user_id" || Object.hasOwn(input.descriptor.foreignKeys ?? {}, primary) || typeof candidate[primary] !== "string") return { candidate, disposition: "conflict" as const };
    const forked = sanitizeRestoredLinkJob(input.descriptor.table, { ...candidate, [primary]: input.forkId() });
    recordPrimaryMapping(input.descriptor, input.source, forked, input.mappings);
    return { candidate: forked, disposition: "forked" as const };
  }

  recordPrimaryMapping(input.descriptor, input.source, candidate, input.mappings);
  return { candidate, disposition: "created" as const };
}

async function previousSucceededMappings(db: D1DatabaseBinding, userId: string, bundle: VerifiedExportBundle) {
  const previous = await db.prepare(`select collision_map_json from v2_restore_batches
    where user_id=? and archive_sha256=? and manifest_root_hash=? and status='succeeded' order by rowid desc limit 1`)
    .bind(userId, bundle.archiveSha256, bundle.manifest.rootHash).first<{ collision_map_json: string }>();
  if (!previous) return undefined;
  let value: unknown;
  try { value = JSON.parse(previous.collision_map_json); } catch { throw new RestoreContractError("restore_conflict", "The previous restore identity map is damaged."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((id) => typeof id !== "string" || !id)) {
    throw new RestoreContractError("restore_conflict", "The previous restore identity map is damaged.");
  }
  const mappings = new Map<string, string>();
  for (const descriptor of RESTORE_TABLE_ORDER_V2) {
    if (descriptor.primaryKey.length !== 1) continue;
    for (const exported of bundle.rowsByTable.get(descriptor.table) ?? []) {
      const source = normalizeForUser(exported, userId, descriptor.table), sourceId = source[descriptor.primaryKey[0]];
      if (typeof sourceId !== "string") continue;
      const key = `${descriptor.table}\0${sourceId}`, target = (value as Record<string, unknown>)[key];
      if (typeof target !== "string" || !target) throw new RestoreContractError("restore_conflict", "The previous restore identity map is incomplete.");
      mappings.set(key, target);
    }
  }
  return mappings;
}

export async function createRestoreDryRun(db: D1DatabaseBinding, userId: string, bundle: VerifiedExportBundle): Promise<RestoreDryRun> {
  if (bundle.manifest.profile !== "migration") throw new RestoreContractError("restore_profile_invalid", "Only migration bundles can be restored.");
  const totals = { create: 0, reuse: 0, fork: 0, conflict: 0, invalid: 0 };
  const tables: { table: string; rows: number; create: number; reuse: number; fork: number; conflict: number }[] = [];
  const previousMappings = await previousSucceededMappings(db, userId, bundle);
  const mappings = new Map(previousMappings);
  for (const descriptor of RESTORE_TABLE_ORDER_V2) {
    const summary = { table: descriptor.table, rows: 0, create: 0, reuse: 0, fork: 0, conflict: 0 };
    for (const exported of orderSourceSelfReferences(bundle.rowsByTable.get(descriptor.table) ?? [], descriptor)) {
      summary.rows += 1;
      const source = normalizeForUser(exported, userId, descriptor.table);
      const sourceKey = rowKey(descriptor, exported);
      const resolved = await resolveRestoreCandidate({ db, descriptor, source, mappings, previousMappings, forkId: () => `dry-run-fork:${sha256Hex(`${descriptor.table}\0${sourceKey}`).slice(0, 32)}` });
      const countKey: "create" | "reuse" | "fork" | "conflict" = resolved.disposition === "created" ? "create" : resolved.disposition === "reused" ? "reuse" : resolved.disposition === "forked" ? "fork" : "conflict";
      summary[countKey] += 1;
      totals[countKey] += 1;
    }
    tables.push(summary);
  }
  const warnings = [
    ...(bundle.manifest.scope.privacyLevels.includes("restricted") ? ["restricted_records_require_reauthentication"] : []),
    ...(totals.fork ? ["id_collisions_will_be_forked"] : []),
    ...(totals.conflict ? ["composite_or_settings_conflicts_require_resolution"] : []),
  ];
  const basis = { archiveSha256: bundle.archiveSha256, manifestRootHash: bundle.manifest.rootHash, counts: totals, tables, warnings };
  return { ...basis, dryRunHash: sha256Hex(canonicalJson(basis)) };
}

function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
}

function rewriteForeignKeys(row: Record<string, unknown>, descriptor: CanonicalTableDescriptor, mappings: Map<string, string>, sourceReferences = row) {
  const value = { ...row };
  for (const [column, targetTable] of Object.entries({ ...(descriptor.foreignKeys ?? {}), ...(CANONICAL_SOFT_REFERENCES_V1[descriptor.table] ?? {}) })) {
    const current = sourceReferences[column];
    if (typeof current === "string") value[column] = mappings.get(`${targetTable}\0${current}`) ?? current;
  }
  if ((descriptor.table === "v2_evidence_refs" || descriptor.table === "v2_review_receipts") && typeof sourceReferences.target_id === "string") {
    const targetTable = POLYMORPHIC_TARGET_TABLES[String(sourceReferences.target_kind)];
    if (targetTable) value.target_id = mappings.get(`${targetTable}\0${sourceReferences.target_id}`) ?? sourceReferences.target_id;
  }
  return value;
}

async function tableColumns(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor) {
  const result = await db.prepare(`pragma table_info(${descriptor.table})`).all<{ name: string }>();
  return new Set(result.results.map((column) => column.name));
}

function insertStatement(db: D1DatabaseBinding, descriptor: CanonicalTableDescriptor, row: Record<string, unknown>, allowedColumns: Set<string>) {
  const columns = Object.keys(row);
  if (!columns.length || columns.some((column) => !allowedColumns.has(column))) throw new RestoreContractError("row_schema_invalid", `${descriptor.table} contains an unknown column.`);
  const quoted = columns.map((column) => `"${column}"`).join(",");
  return db.prepare(`insert into ${descriptor.table} (${quoted}) values (${columns.map(() => "?").join(",")})`).bind(...columns.map((column) => row[column]));
}

async function runBatches(db: D1DatabaseBinding, statements: D1PreparedStatementBinding[]) {
  for (let offset = 0; offset < statements.length; offset += IMPORT_BATCH_STATEMENT_LIMIT) await db.batch(statements.slice(offset, offset + IMPORT_BATCH_STATEMENT_LIMIT));
}

type PlannedRow = { descriptor: CanonicalTableDescriptor; exported: Record<string, unknown>; candidate: Record<string, unknown>; sourceKey: string; sourceHash: string; disposition: Exclude<RestoreDisposition, "conflict"> };

function orderSourceSelfReferences(rows: readonly CanonicalRow[], descriptor: CanonicalTableDescriptor): CanonicalRow[] {
  if (!descriptor.table.startsWith("v2_link_curation_")) return [...rows];
  return orderSelfReferences(rows.map((row) => ({ descriptor, exported: row, candidate: row, sourceKey: "", sourceHash: "", disposition: "created" })), descriptor).map((row) => row.exported);
}

function orderSelfReferences(rows: PlannedRow[], descriptor: CanonicalTableDescriptor) {
  const selfColumns = Object.entries(descriptor.foreignKeys ?? {}).filter(([, target]) => target === descriptor.table).map(([column]) => column);
  if (!selfColumns.length || descriptor.primaryKey.length !== 1) return rows;
  const primary = descriptor.primaryKey[0];
  const pending = new Map(rows.map((row) => [String(row.candidate[primary]), row]));
  const ordered: PlannedRow[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((row) => selfColumns.every((column) => row.candidate[column] === null || row.candidate[column] === undefined || !pending.has(String(row.candidate[column]))));
    if (!ready.length) throw new RestoreContractError("reference_closure_invalid", `${descriptor.table} contains a self-reference cycle.`);
    ready.sort((left, right) => String(left.candidate[primary]).localeCompare(String(right.candidate[primary])));
    for (const row of ready) { pending.delete(String(row.candidate[primary])); ordered.push(row); }
  }
  return ordered;
}

async function planImport(db: D1DatabaseBinding, userId: string, bundle: VerifiedExportBundle) {
  const previousMappings = await previousSucceededMappings(db, userId, bundle);
  const mappings = new Map(previousMappings);
  const planned: PlannedRow[] = [];
  for (const descriptor of RESTORE_TABLE_ORDER_V2) {
    for (const exported of orderSourceSelfReferences(bundle.rowsByTable.get(descriptor.table) ?? [], descriptor)) {
      const source = normalizeForUser(exported, userId, descriptor.table);
      const sourceKey = rowKey(descriptor, exported);
      const sourceHash = sha256Hex(canonicalJson(unwrapCanonicalRow(exported, descriptor.table)));
      const resolved = await resolveRestoreCandidate({ db, descriptor, source, mappings, previousMappings, forkId: ulid });
      if (resolved.disposition === "conflict") throw new RestoreContractError("restore_conflict", `${descriptor.table} has an alternate or non-forkable collision.`);
      planned.push({ descriptor, exported, candidate: resolved.candidate, sourceKey, sourceHash, disposition: resolved.disposition });
    }
  }
  return { mappings, planned };
}

function restoredSucceededLegacyBatchIds(planned: readonly PlannedRow[]) {
  return planned
    .filter((row) => row.descriptor.table === "v2_legacy_migration_batches" && row.candidate.status === "succeeded")
    .map((row) => String(row.candidate.id));
}

async function validateRestoredSucceededLegacyBatches(db: D1DatabaseBinding, userId: string, batchIds: readonly string[]) {
  const repository = new D1LegacyMigrationRepository(db, userId);
  for (const batchId of new Set(batchIds)) {
    const stored = await db.prepare(`select reconciliation_json from v2_legacy_migration_batches where id=? and user_id=? and status='succeeded' limit 1`).bind(batchId, userId).first<{ reconciliation_json: string | null }>();
    if (!stored?.reconciliation_json) throw new RestoreContractError("legacy_batch_semantic_invalid", `Restored legacy batch ${batchId} has no reconciliation receipt.`);
    let receipt: Record<string, unknown>;
    try {
      const parsed = JSON.parse(stored.reconciliation_json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid receipt");
      receipt = parsed as Record<string, unknown>;
    } catch {
      throw new RestoreContractError("legacy_batch_semantic_invalid", `Restored legacy batch ${batchId} has an invalid reconciliation receipt.`);
    }
    const reconciliation = await repository.reconcileBatch(batchId).catch(() => null);
    const immutableCountsMatch = reconciliation
      && receipt.batch_status === "succeeded"
      && receipt.complete === true
      && receipt.structurally_valid === true
      && receipt.input_rows === reconciliation.input_rows
      && receipt.next_offset === reconciliation.next_offset
      && receipt.expected_mapping_count === reconciliation.expected_mapping_count
      && receipt.envelope_count === reconciliation.envelope_count
      && receipt.distinct_envelope_count === reconciliation.distinct_envelope_count
      && receipt.mapping_count === reconciliation.mapping_count
      && receipt.expected_processed_mapping_count === reconciliation.expected_processed_mapping_count
      && receipt.processed_item_count === reconciliation.processed_item_count
      && receipt.pending_item_count === 0
      && receipt.missing_mapping_count === 0
      && receipt.unexpected_mapping_count === 0
      && receipt.invalid_dependency_count === 0;
    if (!immutableCountsMatch || !reconciliation?.complete) throw new RestoreContractError("legacy_batch_semantic_invalid", `Restored legacy batch ${batchId} failed manifest, item, mapping, dependency, or receipt reconciliation.`);
  }
}

export async function importVerifiedBundle(input: {
  db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; bundle: VerifiedExportBundle; expectedDryRunHash: string; idempotencyKey: string; now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const existingBatch = await input.db.prepare(`select id,status,archive_sha256,manifest_root_hash,dry_run_hash,summary_json from v2_restore_batches where user_id=? and idempotency_key=? limit 1`)
    .bind(input.userId, input.idempotencyKey).first<{ id: string; status: string; archive_sha256: string; manifest_root_hash: string; dry_run_hash: string; summary_json: string }>();
  if (existingBatch) {
    if (existingBatch.archive_sha256 !== input.bundle.archiveSha256 || existingBatch.manifest_root_hash !== input.bundle.manifest.rootHash || existingBatch.dry_run_hash !== input.expectedDryRunHash) {
      throw new RestoreContractError("idempotency_conflict", "Restore idempotency key was used for another archive or approved dry-run.");
    }
    let originalDryRun: RestoreDryRun;
    try { originalDryRun = JSON.parse(existingBatch.summary_json) as RestoreDryRun; } catch { throw new RestoreContractError("restore_conflict", "The original restore result is damaged."); }
    if (!originalDryRun || originalDryRun.dryRunHash !== existingBatch.dry_run_hash || originalDryRun.archiveSha256 !== existingBatch.archive_sha256 || originalDryRun.manifestRootHash !== existingBatch.manifest_root_hash) {
      throw new RestoreContractError("restore_conflict", "The original restore result does not match its request.");
    }
    return { batchId: existingBatch.id, status: existingBatch.status, replayed: true, dryRun: originalDryRun };
  }
  const dryRun = await createRestoreDryRun(input.db, input.userId, input.bundle);
  if (dryRun.dryRunHash !== input.expectedDryRunHash) throw new RestoreContractError("dry_run_changed", "The archive or target state changed after dry-run.");
  if (dryRun.counts.conflict || dryRun.counts.invalid) throw new RestoreContractError("restore_conflict", "Dry-run has unresolved conflicts.");
  const batchId = ulid();
  await input.db.prepare(`insert into v2_restore_batches (id,user_id,idempotency_key,archive_sha256,manifest_root_hash,dry_run_hash,status,summary_json,collision_map_json,created_at,approved_at,started_at) values (?,?,?,?,?,?,'importing',?,'{}',?,?,?)`).bind(batchId, input.userId, input.idempotencyKey, input.bundle.archiveSha256, input.bundle.manifest.rootHash, dryRun.dryRunHash, canonicalJson(dryRun), now, now, now).run();
  const uploadedKeys: string[] = [];
  try {
    const { mappings, planned } = await planImport(input.db, input.userId, input.bundle);
    const committedAttachments: { id: string; committedAt: unknown }[] = [];
    for (const item of planned.filter((row) => row.descriptor.table === "v2_attachment_reservations" && row.disposition !== "reused" && row.candidate.status === "committed")) {
      committedAttachments.push({ id: String(item.candidate.id), committedAt: item.candidate.committed_at });
      item.candidate.status = "verified";
      item.candidate.committed_at = null;
    }
    const ownerHash = sha256Hex(input.userId).slice(0, 24);
    for (const plannedRow of planned.filter((item) => item.descriptor.table === "v2_attachment_reservations" && item.disposition !== "reused")) {
      const originalId = String(unwrapCanonicalRow(plannedRow.exported, plannedRow.descriptor.table).id);
      const source = [...input.bundle.entries.values()].find((entry) => entry.path.startsWith(`attachments/originals/${originalId}/`));
      const backupSource = input.bundle.backupOriginals?.get(originalId);
      const expectedHash = String(plannedRow.candidate.sha256 ?? "");
      const expectedSize = Number(plannedRow.candidate.size_bytes ?? -1);
      const backupMatches = backupSource && backupSource.sha256 === expectedHash && backupSource.bytes === expectedSize;
      if (input.bundle.manifest.scope.includeOriginals && (!source && !backupMatches || source && (sha256Hex(source.bytes) !== expectedHash || source.bytes.byteLength !== expectedSize))) throw new RestoreContractError("attachment_original_invalid", `Attachment original is missing or damaged: ${originalId}`);
      if (source || backupMatches) {
        const restoredId = String(plannedRow.candidate.id);
        const objectKey = `users/${ownerHash}/restored-originals/${restoredId}/${expectedHash}`;
        if (source) await input.bucket.put(objectKey, source.bytes, { httpMetadata: { contentType: String(plannedRow.candidate.mime_type) }, customMetadata: { userId: input.userId, reservationId: restoredId, restoreBatchId: batchId }, sha256: hexToBytes(expectedHash) });
        else {
          const original = await (input.bundle.backupSourceBucket ?? input.bucket).get(backupSource!.objectKey);
          if (!original) throw new RestoreContractError("attachment_original_invalid", `Backup blob is missing: ${originalId}`);
          await uploadVerifiedStream({ bucket: input.bucket, key: objectKey, body: original.body, mediaType: backupSource!.mediaType, expectedHash, expectedBytes: expectedSize, customMetadata: { userId: input.userId, reservationId: restoredId, restoreBatchId: batchId } });
        }
        plannedRow.candidate.object_key = objectKey;
        uploadedKeys.push(objectKey);
      }
    }
    const columns = new Map<string, Set<string>>();
    for (const descriptor of CANONICAL_TABLES_V1) columns.set(descriptor.table, await tableColumns(input.db, descriptor));
    const restoreTable = async (descriptor: CanonicalTableDescriptor) => {
      const statements: D1PreparedStatementBinding[] = [];
      // Mapping keys belong to the source namespace. A resolved target ID may
      // itself be another source ID; never feed it through the map again.
      // Keep planned primary IDs, job sanitization and uploaded object keys.
      const finalRows = planned.filter((row) => row.descriptor.table === descriptor.table).map((row) => ({ ...row,
        candidate: rewriteForeignKeys(row.candidate, descriptor, mappings, unwrapCanonicalRow(row.exported, descriptor.table)) }));
      for (const item of orderSelfReferences(finalRows, descriptor)) {
        const candidate = item.candidate;
        const restoredKey = rowKey(descriptor, candidate);
        if (item.disposition !== "reused") statements.push(insertStatement(input.db, descriptor, candidate, columns.get(descriptor.table) ?? new Set()));
        statements.push(input.db.prepare(`insert into v2_restore_rows (restore_batch_id,table_name,row_key,source_row_hash,disposition,restored_row_key,created_at) values (?,?,?,?,?,?,?)`).bind(batchId, descriptor.table, item.sourceKey, item.sourceHash, item.disposition, restoredKey, now));
      }
      await runBatches(input.db, statements);
    };
    // Keep originals private/verified through the existing legacy validation
    // boundary. Only curation examples require later committed-image insertion.
    for (const descriptor of RESTORE_TABLE_ORDER_V2) if (descriptor.table !== "v2_link_curation_examples") await restoreTable(descriptor);
    await validateRestoredSucceededLegacyBatches(input.db, input.userId, restoredSucceededLegacyBatchIds(planned));
    await runBatches(input.db, committedAttachments.map((attachment) => input.db.prepare(`update v2_attachment_reservations set status='committed',committed_at=? where id=? and user_id=? and status='verified'`).bind(attachment.committedAt, attachment.id, input.userId)));
    for (const descriptor of RESTORE_TABLE_ORDER_V2) if (descriptor.table === "v2_link_curation_examples") await restoreTable(descriptor);
    await input.db.prepare(`update v2_restore_batches set status='succeeded',collision_map_json=?,finished_at=? where id=? and user_id=?`).bind(canonicalJson(Object.fromEntries(mappings)), now, batchId, input.userId).run();
    return { batchId, status: "succeeded", replayed: false, dryRun };
  } catch (error) {
    for (const key of uploadedKeys) await input.bucket.delete(key).catch(() => undefined);
    await rollbackRestoreBatch({ db: input.db, bucket: input.bucket, userId: input.userId, batchId, now, failureCode: error instanceof RestoreContractError ? error.code : "restore_failed" }).catch(() => undefined);
    throw error;
  }
}

export async function rollbackRestoreBatch(input: { db: D1DatabaseBinding; bucket: R2BucketBinding; userId: string; batchId: string; now?: string; failureCode?: string }) {
  const now = input.now ?? new Date().toISOString();
  const batch = await input.db.prepare(`select status from v2_restore_batches where id=? and user_id=? limit 1`).bind(input.batchId, input.userId).first<{ status: string }>();
  if (!batch) throw new RestoreContractError("restore_not_found", "Restore batch was not found.");
  if (batch.status === "rolled_back") return { batchId: input.batchId, status: "rolled_back", replayed: true };
  const attachmentKeys: string[] = [];
  for (const descriptor of [...RESTORE_TABLE_ORDER_V2].reverse()) {
    const rows = await input.db.prepare(`select restored_row_key from v2_restore_rows where restore_batch_id=? and table_name=? and disposition in ('created','forked') order by rowid desc`).bind(input.batchId, descriptor.table).all<{ restored_row_key: string }>();
    const statements: D1PreparedStatementBinding[] = [];
    for (const restored of rows.results) {
      const key = JSON.parse(restored.restored_row_key) as Record<string, unknown>;
      if (descriptor.table === "v2_attachment_reservations") {
        const object = await existingRow(input.db, descriptor, key);
        if (typeof object?.object_key === "string") attachmentKeys.push(object.object_key);
      }
      const where = descriptor.primaryKey.map((column) => `"${column}"=?`).join(" and ");
      statements.push(input.db.prepare(`delete from ${descriptor.table} where ${where}`).bind(...descriptor.primaryKey.map((column) => key[column])));
      const aggregateId = descriptor.primaryKey.length === 1 ? String(key[descriptor.primaryKey[0]]) : rowKey(descriptor, key);
      statements.push(
        input.db.prepare(
          `insert into v2_change_events (user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) values (?,?,?,?,'tombstone',null,?)`,
        ).bind(input.userId, rollbackTombstoneAggregateKind(descriptor.table), aggregateId, `restore_rollback:${input.batchId}`, now),
      );
    }
    await runBatches(input.db, statements);
  }
  for (const key of attachmentKeys) await input.bucket.delete(key);
  await input.db.prepare(`update v2_restore_batches set status='rolled_back',rolled_back_at=?,finished_at=coalesce(finished_at,?),failure_code=coalesce(?,failure_code) where id=? and user_id=?`).bind(now, now, input.failureCode ?? null, input.batchId, input.userId).run();
  return { batchId: input.batchId, status: "rolled_back", replayed: false };
}
