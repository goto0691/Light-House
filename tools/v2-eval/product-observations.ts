import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateExportManifest, type ExportManifestV1 } from "../../apps/web/src/lib/v2/portability/portability-contract-v1";
import { defaultV2QueryPlan, validateV2QueryPlan } from "../../apps/web/src/lib/v2/retrieval/query-plan-v1";
import { CASE_ID, CONTRACT, HASH, canonical, digest, exactKeys, identity, observationSet, record, strings, typedValue, type Expected, type Identity, type Observation, type ObservationSet, type TypedValue } from "./contracts";
import { loadPrivateCorpus, writeNewReport } from "./recorded-input";

export const PRODUCT_MAPPING_CONTRACT = "product-observation-mapping-v1" as const;
export const PRODUCT_RECEIPT_CONTRACT = "product-observation-receipt-v1" as const;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 100_000;
const TABLE_PATHS = {
  captures: "sources/captures.jsonl", objects: "objects/objects.jsonl", documents: "objects/documents.jsonl", revisions: "objects/document-revisions.jsonl",
  sources: "sources/source-items.jsonl", documentSources: "objects/document-source-links.jsonl",
  sourceAttachments: "sources/source-attachment-links.jsonl", attachments: "attachments/metadata.jsonl",
  fields: "registries/fields.jsonl", properties: "objects/property-values.jsonl",
  types: "registries/types.jsonl", assignments: "objects/type-assignments.jsonl",
} as const;
type Table = keyof typeof TABLE_PATHS;
type Row = Record<string, unknown>;
type Privacy = "normal" | "sensitive" | "restricted";
type TypedMapping = { id: string; document_id: string; field_definition_id: string; scale_field_definition_id?: string };
type RecallMapping = { id: string; response_path: string; response_sha256: string; plan_sha256: string };
export type ProductCaseMapping = {
  case_id: string; document_ids: string[]; source_item_ids: string[];
  typed_values?: TypedMapping[]; primary_type_document_ids?: string[]; recall_queries?: RecallMapping[];
};
export type ProductMapping = {
  contract: typeof PRODUCT_MAPPING_CONTRACT; export_id: string; owner_id: string; identity: Identity;
  corpus_sha256: string; allowed_privacy: Privacy[];
  record_ids: { record_id: string; observation_id: string }[]; cases: ProductCaseMapping[];
};
export const COLLECTION_CODES = [
  "COLLECTION_ARGUMENTS_INVALID", "COLLECTION_INPUT_INVALID", "COLLECTION_READ_FAILED", "COLLECTION_PATH_INVALID",
  "COLLECTION_IDENTITY_MISMATCH", "COLLECTION_CASE_SET_MISMATCH", "COLLECTION_EXPORT_INVALID", "COLLECTION_EXPORT_CHANGED",
  "COLLECTION_OWNER_MISMATCH", "COLLECTION_MAPPING_INVALID", "COLLECTION_VALUE_INVALID", "COLLECTION_RECALL_INVALID",
  "COLLECTION_OUTPUT_INVALID", "COLLECTION_INTERNAL_ERROR",
] as const;
export type CollectionCode = (typeof COLLECTION_CODES)[number];
export class ProductCollectionError extends Error {
  constructor(readonly code: CollectionCode) { super(code); }
}
function fail(code: CollectionCode = "COLLECTION_INPUT_INVALID"): never { throw new ProductCollectionError(code); }
function id(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value); }
function uniqueIds(value: unknown): value is string[] { return strings(value) && value.every(id); }
function inside(root: string, path: string) {
  const relation = relative(root, path);
  return relation.length > 0 && !isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`);
}
/** Every input and output remains in the corpus directory, including canonical symlink targets. */
async function localPath(root: string, path: string, absolute = false) {
  if ((!absolute && isAbsolute(path)) || path.split(/[\\/]/).includes("..")) fail("COLLECTION_PATH_INVALID");
  const candidate = resolve(root, path);
  if (!inside(root, candidate)) fail("COLLECTION_PATH_INVALID");
  try {
    const canonicalPath = await realpath(candidate);
    if (!inside(root, canonicalPath)) fail("COLLECTION_PATH_INVALID");
    return canonicalPath;
  } catch (error) {
    if (error instanceof ProductCollectionError) throw error;
    return fail("COLLECTION_READ_FAILED");
  }
}
async function metadataBytes(path: string) {
  try {
    if (!(await stat(path)).isFile() || (await stat(path)).size > MAX_METADATA_BYTES) fail("COLLECTION_READ_FAILED");
    const bytes = await readFile(path);
    if (bytes.length > MAX_METADATA_BYTES) fail("COLLECTION_READ_FAILED");
    return bytes;
  } catch (error) {
    if (error instanceof ProductCollectionError) throw error;
    return fail("COLLECTION_READ_FAILED");
  }
}
function decode(bytes: Uint8Array) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail(); } }
function json(bytes: Uint8Array): unknown { try { return JSON.parse(decode(bytes)) as unknown; } catch { return fail(); } }
function byteHash(bytes: Uint8Array | string) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
async function fileHash(path: string) {
  try {
    const hash = createHash("sha256"); let bytes = 0;
    for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += (chunk as Buffer).byteLength; }
    return { hash: `sha256:${hash.digest("hex")}`, bytes };
  } catch { return fail("COLLECTION_READ_FAILED"); }
}
function typedMapping(value: unknown): value is TypedMapping {
  return record(value) && exactKeys(value, ["id", "document_id", "field_definition_id"], ["scale_field_definition_id"])
    && id(value.id) && id(value.document_id) && id(value.field_definition_id)
    && (value.scale_field_definition_id === undefined || id(value.scale_field_definition_id));
}
function recallMapping(value: unknown): value is RecallMapping {
  return record(value) && exactKeys(value, ["id", "response_path", "response_sha256", "plan_sha256"])
    && id(value.id) && id(value.response_path) && typeof value.response_sha256 === "string" && HASH.test(value.response_sha256)
    && typeof value.plan_sha256 === "string" && HASH.test(value.plan_sha256);
}
function caseMapping(value: unknown): value is ProductCaseMapping {
  if (!record(value) || !exactKeys(value, ["case_id", "document_ids", "source_item_ids"], ["typed_values", "primary_type_document_ids", "recall_queries"])
    || typeof value.case_id !== "string" || !CASE_ID.test(value.case_id) || !uniqueIds(value.document_ids) || !value.document_ids.length
    || !uniqueIds(value.source_item_ids) || !value.source_item_ids.length) return false;
  if (value.typed_values !== undefined && (!Array.isArray(value.typed_values) || value.typed_values.length > 10_000
    || !value.typed_values.every(typedMapping) || new Set(value.typed_values.map((item) => item.id)).size !== value.typed_values.length
    || !value.typed_values.every((item) => (value.document_ids as string[]).includes(item.document_id)))) return false;
  if (value.primary_type_document_ids !== undefined && (!uniqueIds(value.primary_type_document_ids)
    || !value.primary_type_document_ids.every((item) => (value.document_ids as string[]).includes(item)))) return false;
  if (value.recall_queries !== undefined && (!Array.isArray(value.recall_queries) || value.recall_queries.length > 10_000
    || !value.recall_queries.every(recallMapping) || new Set(value.recall_queries.map((item) => item.id)).size !== value.recall_queries.length)) return false;
  return true;
}
export function productMapping(value: unknown): ProductMapping {
  if (!record(value) || !exactKeys(value, ["contract", "export_id", "owner_id", "identity", "corpus_sha256", "allowed_privacy", "record_ids", "cases"])
    || value.contract !== PRODUCT_MAPPING_CONTRACT || !id(value.export_id) || !id(value.owner_id)
    || typeof value.corpus_sha256 !== "string" || !HASH.test(value.corpus_sha256)
    || !uniqueIds(value.allowed_privacy) || !value.allowed_privacy.length || !value.allowed_privacy.every((level) => ["normal", "sensitive", "restricted"].includes(level))
    || !Array.isArray(value.record_ids) || value.record_ids.length > 10_000
    || !value.record_ids.every((item) => record(item) && exactKeys(item, ["record_id", "observation_id"]) && id(item.record_id) && id(item.observation_id))
    || new Set(value.record_ids.map((item) => item.record_id)).size !== value.record_ids.length
    || new Set(value.record_ids.map((item) => item.observation_id)).size !== value.record_ids.length
    || !Array.isArray(value.cases) || value.cases.length !== 20 || !value.cases.every(caseMapping)
    || new Set(value.cases.map((item) => item.case_id)).size !== 20) fail("COLLECTION_MAPPING_INVALID");
  let parsedIdentity: Identity;
  try { parsedIdentity = identity(value.identity); } catch { return fail("COLLECTION_IDENTITY_MISMATCH"); }
  return { ...value, identity: parsedIdentity } as ProductMapping;
}
type Archive = { root: string; manifest: ExportManifestV1; manifestBytes: Buffer; tables: Record<Table, Row[]>; paths: Map<string, string> };
async function loadArchive(root: string): Promise<Archive> {
  const manifestBytes = await metadataBytes(await localPath(root, "manifest.json"));
  let manifest: ExportManifestV1;
  try { manifest = validateExportManifest(json(manifestBytes)); } catch { return fail("COLLECTION_EXPORT_INVALID"); }
  if (manifest.profile !== "migration" || manifest.schemaVersion !== "v2-032" || !id(manifest.exportId)
    || manifest.scope.objects !== "all" || manifest.scope.includeHistory !== true || manifest.scope.includeOriginals !== true
    || manifest.scope.includeTrash !== true || !uniqueIds(manifest.scope.privacyLevels)
    || !["normal", "sensitive", "restricted"].every((level) => manifest.scope.privacyLevels.includes(level as Privacy))
    || manifest.files.length > MAX_FILES || new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length) fail("COLLECTION_EXPORT_INVALID");
  const paths = new Map<string, string>();
  for (const file of manifest.files) {
    if (file.path.includes("\\") || !file.path || file.path === "manifest.json" || file.path === "checksums.sha256") fail("COLLECTION_EXPORT_INVALID");
    const path = await localPath(root, file.path);
    const actual = await fileHash(path);
    if (actual.hash !== `sha256:${file.sha256}` || actual.bytes !== file.bytes) fail("COLLECTION_EXPORT_INVALID");
    paths.set(file.path, path);
  }
  const tables = {} as Record<Table, Row[]>;
  for (const [table, path] of Object.entries(TABLE_PATHS) as [Table, string][]) {
    const descriptor = manifest.files.find((file) => file.path === path), filename = paths.get(path);
    if (!descriptor || !filename) fail("COLLECTION_EXPORT_INVALID");
    const bytes = await metadataBytes(filename);
    if (byteHash(bytes) !== `sha256:${descriptor.sha256}` || bytes.length !== descriptor.bytes) fail("COLLECTION_EXPORT_CHANGED");
    const text = decode(bytes);
    if (text && !text.endsWith("\n")) fail("COLLECTION_EXPORT_INVALID");
    const rows = text ? text.slice(0, -1).split("\n").map((line) => json(Buffer.from(line))) : [];
    if (rows.length !== descriptor.records || rows.some((row) => !record(row)
      || row.schema_version !== manifest.schemaVersion || row.user_scope_export_id !== manifest.exportId)) fail("COLLECTION_EXPORT_INVALID");
    if ((table === "fields" || table === "types") && rows.some((row) => !Number.isSafeInteger((row as Row).__lighthouse_row_schema_version))) fail("COLLECTION_EXPORT_INVALID");
    tables[table] = rows as Row[];
  }
  return { root, manifest, manifestBytes, tables, paths };
}
function index(rows: Row[], key = "id") {
  const result = new Map<string, Row>();
  for (const row of rows) {
    if (!id(row[key]) || result.has(row[key])) fail("COLLECTION_EXPORT_INVALID");
    result.set(row[key], row);
  }
  return result;
}
function required(rows: Map<string, Row>, key: string) { const value = rows.get(key); if (!value) fail("COLLECTION_MAPPING_INVALID"); return value; }
function uniqueLinks(rows: Row[], keys: string[]) {
  const values = rows.map((row) => {
    if (keys.some((key) => !id(row[key]))) fail("COLLECTION_EXPORT_INVALID");
    return canonical(keys.map((key) => row[key]));
  });
  if (new Set(values).size !== values.length) fail("COLLECTION_EXPORT_INVALID");
}
function owner(row: Row, ownerId: string) { if (row.user_id !== ownerId) fail("COLLECTION_OWNER_MISMATCH"); return row; }
function storedHash(value: unknown) { if (typeof value !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(value)) fail("COLLECTION_EXPORT_INVALID"); return value.startsWith("sha256:") ? value : `sha256:${value}`; }
type CollectionState = "collected" | "unknown";
export type ProductCaseReceipt = { case_id: string; source_observations: number; typed_values: CollectionState; primary_types: CollectionState; recall_results: CollectionState; typed_unknown_reason?: "SCALE_NOT_STORED" | "VALUE_NOT_REPRESENTABLE"; unmapped_ranked_ids: number };
export type ProductReceipt = {
  contract: typeof PRODUCT_RECEIPT_CONTRACT; collector_version: 1; observation_contract: typeof CONTRACT;
  source: "local-migration-export"; mode: "private-recorded"; identity: Identity; corpus_sha256: string;
  mapping_sha256: string; export_manifest_sha256: string; export_root_hash: string; observations_sha256: string;
  read_only: true; live_provider_verified: false; live_search_executed: false; promotion_eligible: false;
  cases: ProductCaseReceipt[];
};
type Indices = { [K in "captures" | "objects" | "documents" | "revisions" | "sources" | "attachments" | "fields" | "types"]: Map<string, Row> };
function document(indices: Indices, mapping: ProductMapping, documentId: string) {
  const object = owner(required(indices.objects, documentId), mapping.owner_id);
  const doc = required(indices.documents, documentId);
  if (object.object_kind !== "document" || !id(doc.capture_id) || !mapping.allowed_privacy.includes(doc.privacy_level as Privacy)
    || object.lifecycle_status === "merged" || object.lifecycle_status === "deleted") fail("COLLECTION_MAPPING_INVALID");
  owner(required(indices.captures, doc.capture_id), mapping.owner_id);
  if (!id(doc.current_revision_id) || required(indices.revisions, doc.current_revision_id).document_object_id !== documentId) fail("COLLECTION_MAPPING_INVALID");
  return doc;
}
function currentProperty(archive: Archive, indices: Indices, mapping: ProductMapping, documentId: string, fieldId: string) {
  document(indices, mapping, documentId);
  const field = owner(required(indices.fields, fieldId), mapping.owner_id);
  const rows = archive.tables.properties.filter((row) => row.owner_object_id === documentId && row.field_definition_id === fieldId);
  rows.forEach((row) => owner(row, mapping.owner_id));
  const current = rows.filter((row) => row.review_status === "accepted" && row.superseded_at === null);
  if (current.length > 1) fail("COLLECTION_VALUE_INVALID");
  // A complete current collection without the requested explicit field is a measured miss.
  if (!current.length || !["user_explicit", "user_locked"].includes(current[0].source_class as string)) return undefined;
  if (current[0].value_kind !== field.data_type) fail("COLLECTION_VALUE_INVALID");
  return current[0];
}
function materialize(row: Row, observationId: string): TypedValue | undefined {
  if (!["text", "date", "boolean", "number", "rating"].includes(row.value_kind as string) || row.value_json === "null") return undefined;
  if (typeof row.value_json !== "string") fail("COLLECTION_VALUE_INVALID");
  const value = json(Buffer.from(row.value_json));
  const column = { text: "value_text", date: "value_date", boolean: "value_boolean", number: "value_number", rating: "value_number" }[row.value_kind as string];
  const stored = row[column!];
  if (row.value_kind === "boolean" ? (stored !== 0 && stored !== 1) || value !== (stored === 1) : canonical(value) !== canonical(stored)) fail("COLLECTION_VALUE_INVALID");
  const result = { id: observationId, value_type: row.value_kind, value, ...(row.unit_key !== null ? { unit: row.unit_key } : {}) };
  // Rating scale is intentionally left unresolved until an explicit stored field is read.
  if (row.value_kind === "rating") return result as TypedValue;
  if (!typedValue(result)) fail("COLLECTION_VALUE_INVALID");
  return result;
}
async function sourceHashes(archive: Archive, indices: Indices, mapping: ProductMapping, item: ProductCaseMapping, observation: Observation) {
  const hashes: string[] = [];
  for (const sourceId of item.source_item_ids) {
    const source = owner(required(indices.sources, sourceId), mapping.owner_id);
    const linked = item.document_ids.some((documentId) => {
      const doc = document(indices, mapping, documentId);
      return doc.capture_id === source.capture_id && archive.tables.documentSources.some((row) => row.document_object_id === documentId && row.source_item_id === sourceId);
    });
    if (!linked) fail("COLLECTION_MAPPING_INVALID");
    const attachments = archive.tables.sourceAttachments.filter((row) => row.source_item_id === sourceId);
    if (attachments.length > 1) fail("COLLECTION_MAPPING_INVALID");
    let actual: string;
    if (attachments.length) {
      owner(attachments[0], mapping.owner_id);
      if (!id(attachments[0].attachment_id)) fail("COLLECTION_MAPPING_INVALID");
      const attachment = owner(required(indices.attachments, attachments[0].attachment_id), mapping.owner_id);
      if (attachment.status !== "committed") fail("COLLECTION_MAPPING_INVALID");
      const originalPaths = archive.manifest.files.filter((file) => file.path.startsWith(`attachments/originals/${attachment.id}/`));
      if (originalPaths.length !== 1) fail("COLLECTION_MAPPING_INVALID");
      const actualFile = await fileHash(archive.paths.get(originalPaths[0].path)!);
      actual = actualFile.hash;
      if (actualFile.bytes !== attachment.size_bytes || actual !== storedHash(attachment.sha256)) observation.fatal_failures.push("SOURCE_MUTATION");
    } else {
      if (typeof source.raw_text !== "string") fail("COLLECTION_MAPPING_INVALID");
      // Never normalize CRLF, Unicode, whitespace, Markdown, or a final newline.
      actual = byteHash(Buffer.from(source.raw_text, "utf8"));
    }
    if (actual !== storedHash(source.content_hash)) observation.fatal_failures.push("SOURCE_MUTATION");
    hashes.push(actual);
  }
  // The recorded envelope accepts a hash set; duplicate byte-identical sources do not prove multiplicity.
  observation.source_hashes = [...new Set(hashes)];
}
async function recallResults(root: string, archive: Archive, indices: Indices, mapping: ProductMapping, item: ProductCaseMapping, expected: Expected[]) {
  if (item.recall_queries === undefined) return undefined;
  const mapped = new Map(mapping.record_ids.map((entry) => [entry.record_id, entry.observation_id]));
  const expectedIds = new Set(expected.flatMap((entry) => entry.recall_queries.flatMap((query) => Array.isArray(query.required_ids) ? query.required_ids.filter((value): value is string => typeof value === "string") : [])));
  let unmapped = 0;
  const results: { id: string; ranked_ids: string[] }[] = [];
  const checked: { path: string; hash: string }[] = [];
  for (const query of item.recall_queries) {
    const approved = expected.find((entry) => entry.case_id === item.case_id)?.recall_queries.find((entry) => entry.id === query.id);
    if (!approved || !exactKeys(approved, ["id", "required_ids", "top_k", "query"])
      || !strings(approved.required_ids, false) || approved.top_k !== 10 || typeof approved.query !== "string" || !approved.query) fail("COLLECTION_RECALL_INVALID");
    const path = await localPath(root, query.response_path), bytes = await metadataBytes(path);
    if (byteHash(bytes) !== query.response_sha256) fail("COLLECTION_RECALL_INVALID");
    const response = json(bytes);
    if (!record(response) || response.contractVersion !== "retrieval-results-v1" || !record(response.plan) || digest(response.plan) !== query.plan_sha256
      || response.page !== 1 || !Number.isSafeInteger(response.pageSize) || Number(response.pageSize) < 10
      || Number(response.pageSize) > 100 || response.pageSize !== response.plan.limit
      || !Number.isSafeInteger(response.totalCount) || Number(response.totalCount) < 0 || !Array.isArray(response.results)
      || response.totalPages !== Math.max(1, Math.ceil(Number(response.totalCount) / Number(response.pageSize)))
      || response.results.length !== Math.min(Number(response.pageSize), Number(response.totalCount))) fail("COLLECTION_RECALL_INVALID");
    try {
      validateV2QueryPlan(response.plan);
      // Only the approved literal text with the product's default relevance plan is supported.
      // Re-hashing a substituted query or extra filters cannot certify an unrelated result ranking.
      if (response.plan.fullText !== approved.query || canonical(response.plan) !== canonical(defaultV2QueryPlan({ fullText: approved.query, limit: Number(response.pageSize) }))) fail("COLLECTION_RECALL_INVALID");
    } catch { return fail("COLLECTION_RECALL_INVALID"); }
    const rankedIds: string[] = [];
    for (const value of response.results) {
      if (!record(value) || !id(value.recordId)) fail("COLLECTION_RECALL_INVALID");
      const doc = document(indices, mapping, value.recordId);
      if (value.privacyLevel !== doc.privacy_level) fail("COLLECTION_RECALL_INVALID");
      const logical = mapped.get(value.recordId);
      // An unlabelled result occupies its original rank. It cannot accidentally become a required logical ID.
      if (!logical) {
        if (expectedIds.has(value.recordId) || [...mapped.values()].includes(value.recordId)) fail("COLLECTION_RECALL_INVALID");
        unmapped += 1;
      }
      rankedIds.push(logical ?? value.recordId);
    }
    if (new Set(rankedIds).size !== rankedIds.length) fail("COLLECTION_RECALL_INVALID");
    results.push({ id: query.id, ranked_ids: rankedIds });
    checked.push({ path, hash: query.response_sha256 });
  }
  return { results, unmapped, checked };
}
async function assertUnchanged(archive: Archive) {
  if (byteHash(await metadataBytes(await localPath(archive.root, "manifest.json"))) !== byteHash(archive.manifestBytes)) fail("COLLECTION_EXPORT_CHANGED");
  for (const descriptor of archive.manifest.files) {
    const actual = await fileHash(await localPath(archive.root, descriptor.path));
    if (actual.hash !== `sha256:${descriptor.sha256}` || actual.bytes !== descriptor.bytes) fail("COLLECTION_EXPORT_CHANGED");
  }
}
export type ProductCollectionOptions = { manifest: string; identity: string; mapping: string; exportRoot: string };
/** Offline artifact collection, not a model invocation, search execution, score, or promotion. */
export async function collectProductObservations(options: ProductCollectionOptions): Promise<{ observations: ObservationSet; receipt: ProductReceipt }> {
  const corpus = await loadPrivateCorpus(options.manifest);
  const root = await realpath(dirname(resolve(options.manifest)));
  const identityPath = await localPath(root, resolve(options.identity), true), mappingPath = await localPath(root, resolve(options.mapping), true);
  const identityBytes = await metadataBytes(identityPath), mappingBytes = await metadataBytes(mappingPath);
  let requiredIdentity: Identity;
  try { requiredIdentity = identity(json(identityBytes)); } catch { return fail("COLLECTION_IDENTITY_MISMATCH"); }
  const mapping = productMapping(json(mappingBytes));
  if (canonical(requiredIdentity) !== canonical(mapping.identity) || mapping.corpus_sha256 !== corpus.corpus_sha256) fail("COLLECTION_IDENTITY_MISMATCH");
  if (canonical(mapping.cases.map((item) => item.case_id).sort()) !== canonical(corpus.expected.map((item) => item.case_id).sort())) fail("COLLECTION_CASE_SET_MISMATCH");
  const archive = await loadArchive(await localPath(root, resolve(options.exportRoot), true));
  if (archive.manifest.exportId !== mapping.export_id) fail("COLLECTION_IDENTITY_MISMATCH");
  const indices: Indices = { captures: index(archive.tables.captures), objects: index(archive.tables.objects), documents: index(archive.tables.documents, "object_id"), revisions: index(archive.tables.revisions), sources: index(archive.tables.sources), attachments: index(archive.tables.attachments), fields: index(archive.tables.fields), types: index(archive.tables.types) };
  // No row owned by another account can be silently ignored in a supposedly owner-scoped export.
  for (const table of ["captures", "objects", "sources", "sourceAttachments", "attachments", "fields", "properties", "types", "assignments"] as Table[]) archive.tables[table].forEach((row) => owner(row, mapping.owner_id));
  index(archive.tables.properties); index(archive.tables.assignments);
  uniqueLinks(archive.tables.documentSources, ["document_object_id", "source_item_id"]);
  uniqueLinks(archive.tables.sourceAttachments, ["source_item_id", "attachment_id"]);
  uniqueLinks(archive.tables.sourceAttachments, ["attachment_id"]);
  for (const entry of mapping.record_ids) document(indices, mapping, entry.record_id);
  const cases: Observation[] = [], receipts: ProductCaseReceipt[] = [], checkedResponses: { path: string; hash: string }[] = [];
  for (const item of [...mapping.cases].sort((left, right) => left.case_id.localeCompare(right.case_id))) {
    item.document_ids.forEach((documentId) => document(indices, mapping, documentId));
    const observation: Observation = { case_id: item.case_id, fatal_failures: [] };
    const receipt: ProductCaseReceipt = { case_id: item.case_id, source_observations: item.source_item_ids.length, typed_values: "unknown", primary_types: "unknown", recall_results: "unknown", unmapped_ranked_ids: 0 };
    await sourceHashes(archive, indices, mapping, item, observation);
    observation.fatal_failures = [...new Set(observation.fatal_failures)];
    if (item.typed_values !== undefined) {
      const values: TypedValue[] = [];
      for (const selector of item.typed_values) {
        const row = currentProperty(archive, indices, mapping, selector.document_id, selector.field_definition_id);
        if (!row) continue;
        const value = materialize(row, selector.id);
        if (!value) { receipt.typed_unknown_reason = "VALUE_NOT_REPRESENTABLE"; continue; }
        if (value.value_type === "rating") {
          const scaleRow = selector.scale_field_definition_id ? currentProperty(archive, indices, mapping, selector.document_id, selector.scale_field_definition_id) : undefined;
          const scale = scaleRow ? materialize(scaleRow, "scale") : undefined;
          if (!scale || scale.value_type !== "number" || scale.unit !== undefined) { receipt.typed_unknown_reason = "SCALE_NOT_STORED"; continue; }
          value.scale_max = scale.value as number;
          if (!typedValue(value)) fail("COLLECTION_VALUE_INVALID");
        } else if (selector.scale_field_definition_id !== undefined) fail("COLLECTION_MAPPING_INVALID");
        values.push(value);
      }
      // The envelope has collection-level unknown, so an unrepresentable member keeps the whole metric unknown.
      if (!receipt.typed_unknown_reason) { observation.typed_values = values; receipt.typed_values = "collected"; }
    }
    if (item.primary_type_document_ids !== undefined) {
      const primary: string[] = [];
      for (const assignment of archive.tables.assignments) {
        if (!item.primary_type_document_ids.includes(assignment.object_id as string) || assignment.role !== "primary" || assignment.review_status !== "accepted") continue;
        if (!id(assignment.type_definition_id)) fail("COLLECTION_MAPPING_INVALID");
        const type = owner(required(indices.types, assignment.type_definition_id), mapping.owner_id);
        if (!id(type.key)) fail("COLLECTION_EXPORT_INVALID");
        primary.push(type.key);
      }
      observation.primary_types = [...new Set(primary)]; receipt.primary_types = "collected";
    }
    const recall = await recallResults(root, archive, indices, mapping, item, corpus.expected);
    if (recall) {
      observation.recall_results = recall.results; receipt.recall_results = "collected"; receipt.unmapped_ranked_ids = recall.unmapped;
      checkedResponses.push(...recall.checked);
    }
    cases.push(observation); receipts.push(receipt);
  }
  const observations = observationSet({ contract: CONTRACT, mode: "private-recorded", identity: requiredIdentity, corpus_sha256: corpus.corpus_sha256, cases });
  await assertUnchanged(archive);
  if (byteHash(await metadataBytes(identityPath)) !== byteHash(identityBytes) || byteHash(await metadataBytes(mappingPath)) !== byteHash(mappingBytes)) fail("COLLECTION_IDENTITY_MISMATCH");
  for (const checked of checkedResponses) if (byteHash(await metadataBytes(checked.path)) !== checked.hash) fail("COLLECTION_RECALL_INVALID");
  if ((await loadPrivateCorpus(options.manifest)).corpus_sha256 !== corpus.corpus_sha256) fail("COLLECTION_IDENTITY_MISMATCH");
  const output = `${JSON.stringify(observations, null, 2)}\n`;
  return { observations, receipt: { contract: PRODUCT_RECEIPT_CONTRACT, collector_version: 1, observation_contract: CONTRACT, source: "local-migration-export", mode: "private-recorded", identity: requiredIdentity, corpus_sha256: corpus.corpus_sha256, mapping_sha256: byteHash(mappingBytes), export_manifest_sha256: byteHash(archive.manifestBytes), export_root_hash: archive.manifest.rootHash, observations_sha256: byteHash(output), read_only: true, live_provider_verified: false, live_search_executed: false, promotion_eligible: false, cases: receipts } };
}
async function outputPath(root: string, path: string) {
  const absolute = resolve(path), parent = await realpath(dirname(absolute));
  if ((!inside(root, parent) && parent !== root) || !inside(root, absolute)) fail("COLLECTION_OUTPUT_INVALID");
  const canonical = resolve(parent, relative(dirname(absolute), absolute));
  try { await lstat(canonical); fail("COLLECTION_OUTPUT_INVALID"); } catch (error) {
    if (error instanceof ProductCollectionError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail("COLLECTION_OUTPUT_INVALID");
  }
  return canonical;
}
export async function writeProductCollection(manifestPath: string, output: string, receiptPath: string, collection: Awaited<ReturnType<typeof collectProductObservations>>) {
  const root = await realpath(dirname(resolve(manifestPath)));
  const observationPath = await outputPath(root, output), provenancePath = await outputPath(root, receiptPath);
  if (observationPath === provenancePath) fail("COLLECTION_OUTPUT_INVALID");
  const contents = `${JSON.stringify(collection.observations, null, 2)}\n`;
  if (byteHash(contents) !== collection.receipt.observations_sha256) fail("COLLECTION_OUTPUT_INVALID");
  // A concurrent receipt creation may leave the first new file behind, but never truncates an existing file.
  await writeNewReport(observationPath, contents);
  await writeNewReport(provenancePath, `${JSON.stringify(collection.receipt, null, 2)}\n`);
}
