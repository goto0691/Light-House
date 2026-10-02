import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import { envelopeCanonicalRow, exportRootHash, type ExportFileManifestV1 } from "../../apps/web/src/lib/v2/portability/portability-contract-v1";
import { defaultV2QueryPlan } from "../../apps/web/src/lib/v2/retrieval/query-plan-v1";
import { digest, type Expected, type Identity } from "./contracts";
import { evaluateRecorded } from "./evaluator";
import { loadPrivateCorpus } from "./recorded-input";
import { PRODUCT_MAPPING_CONTRACT, ProductCollectionError, collectProductObservations, productMapping, writeProductCollection, type ProductCollectionOptions, type ProductMapping } from "./product-observations";

const secret = "SYNTHETIC_PRIVATE_VALUE_QUERY_NAME";
const hash = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const runIdentity: Identity = { build_sha: "a".repeat(40), schema_sha256: hash("schema"), model_config_sha256: hash("synthetic-no-provider"), prompt_sha256: hash("prompt"), registry_sha256: hash("registry") };
type Rows = Record<string, Record<string, unknown>[]>;
const paths = { captures: "sources/captures.jsonl", objects: "objects/objects.jsonl", documents: "objects/documents.jsonl", revisions: "objects/document-revisions.jsonl", sources: "sources/source-items.jsonl", documentSources: "objects/document-source-links.jsonl", sourceAttachments: "sources/source-attachment-links.jsonl", attachments: "attachments/metadata.jsonl", fields: "registries/fields.jsonl", properties: "objects/property-values.jsonl", types: "registries/types.jsonl", assignments: "objects/type-assignments.jsonl" };
async function temporary<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "lighthouse-product-observations-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`); }
async function pack(exportRoot: string, rows: Rows, extras: Record<string, Buffer> = {}) {
  const files: ExportFileManifestV1[] = [];
  for (const [table, path] of Object.entries(paths)) {
    const values = rows[table] ?? [];
    const contents = values.length ? values.map((row) => JSON.stringify(envelopeCanonicalRow(row, "export-synthetic"))).join("\n") + "\n" : "";
    const filename = join(exportRoot, path); await mkdir(dirname(filename), { recursive: true }); await writeFile(filename, contents);
    files.push({ path, bytes: Buffer.byteLength(contents), mediaType: "application/x-ndjson", sha256: hash(contents).slice(7), records: values.length });
  }
  for (const [path, bytes] of Object.entries(extras)) {
    const filename = join(exportRoot, path); await mkdir(dirname(filename), { recursive: true }); await writeFile(filename, bytes);
    files.push({ path, bytes: bytes.length, mediaType: "application/octet-stream", sha256: hash(bytes).slice(7), records: 1 });
  }
  await writeJson(join(exportRoot, "manifest.json"), { format: "lighthouse-export", version: 1, profile: "migration", exportId: "export-synthetic", createdAt: "2026-10-03T00:00:00Z", sourceAppVersion: "synthetic", schemaVersion: "v2-032", userTimezone: "Asia/Seoul", scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true }, counts: {}, files, rootHash: exportRootHash(files), baseSequence: 0, endSequence: 1, warnings: [] });
}
async function fixture(root: string) {
  const exportRoot = join(root, "model-runs/export");
  const entries: Expected[] = [];
  const rows: Rows = Object.fromEntries(Object.keys(paths).map((table) => [table, []]));
  rows.fields.push({ id: "rating", user_id: "owner", data_type: "rating", schema_version: 1 }, { id: "scale", user_id: "owner", data_type: "number", schema_version: 1 });
  rows.types.push({ id: "type", user_id: "owner", key: "dining_note", schema_version: 1 });
  const mapping: ProductMapping = { contract: PRODUCT_MAPPING_CONTRACT, export_id: "export-synthetic", owner_id: "owner", identity: runIdentity, corpus_sha256: hash("pending"), allowed_privacy: ["normal"], record_ids: [], cases: [] };
  await mkdir(join(root, "sources")); await mkdir(join(root, "expected"));
  for (let index = 1; index <= 21; index += 1) {
    const doc = `document-${index}`, capture = `capture-${index}`, source = `source-${index}`, revision = `revision-${index}`;
    const text = `${secret} ${index}\r\n\n완성되지 않은 메모\n`;
    rows.captures.push({ id: capture, user_id: "owner" });
    rows.objects.push({ id: doc, user_id: "owner", object_kind: "document", lifecycle_status: "active" });
    rows.documents.push({ object_id: doc, capture_id: capture, privacy_level: "normal", current_revision_id: revision });
    rows.revisions.push({ id: revision, document_object_id: doc });
    rows.sources.push({ id: source, user_id: "owner", capture_id: capture, raw_text: text, content_hash: hash(text) });
    rows.documentSources.push({ document_object_id: doc, source_item_id: source });
    rows.assignments.push({ id: `assignment-${index}`, user_id: "owner", object_id: doc, type_definition_id: "type", role: "primary", review_status: "accepted" });
    for (const [field, value] of [["rating", 4.5], ["scale", 5]] as const) {
      rows.properties.push({ id: `property-${field}-${index}`, user_id: "owner", owner_object_id: doc, field_definition_id: field, value_kind: field === "rating" ? "rating" : "number", value_number: value, value_json: JSON.stringify(value), unit_key: null, source_class: "user_explicit", review_status: "accepted", superseded_at: null });
    }
    if (index > 20) continue;
    const caseId = `GC-${String(index).padStart(2, "0")}`, logicalId = `LOGICAL-DOCUMENT-${index}`, queryId = `RECALL-${index}`;
    const entry: Expected = { version: 1, case_id: caseId, authoring_status: "human_approved", source_hashes: [hash(text)], must_create: {}, must_preserve: [{ exact_typed_value: { id: `RATING-${index}`, value_type: "rating", value: 4.5, scale_max: 5 } }], must_not_assert: [], acceptable_variants: { primary_type: ["dining_note"] }, required_evidence: [], recall_queries: [{ id: queryId, query: secret, required_ids: [logicalId], top_k: 10 }], severity_overrides: {} };
    entries.push(entry);
    await writeFile(join(root, `sources/${caseId}.source`), text);
    await writeFile(join(root, `expected/${caseId}.yaml`), stringify(entry));
    const plan = defaultV2QueryPlan({ fullText: secret, limit: 20 });
    const response = { contractVersion: "retrieval-results-v1", plan, results: [{ recordId: "document-21", privacyLevel: "normal", title: secret, snippet: secret }, { recordId: doc, privacyLevel: "normal", title: secret, snippet: secret }], totalCount: 2, page: 1, pageSize: 20, totalPages: 1 };
    const responsePath = `model-runs/response-${index}.json`; await writeJson(join(root, responsePath), response);
    mapping.record_ids.push({ record_id: doc, observation_id: logicalId });
    mapping.cases.push({ case_id: caseId, document_ids: [doc], source_item_ids: [source], typed_values: [{ id: `RATING-${index}`, document_id: doc, field_definition_id: "rating", scale_field_definition_id: "scale" }], primary_type_document_ids: [doc], recall_queries: [{ id: queryId, response_path: responsePath, response_sha256: hash(await readFile(join(root, responsePath))), plan_sha256: digest(plan) }] });
  }
  const manifest = join(root, "manifest.yaml");
  await writeFile(manifest, stringify({ version: 1, corpus_id: "synthetic-product-collector", privacy: "private_local_only", cases: entries.map((entry) => ({ case_id: entry.case_id, slot_kind: "synthetic", status: "ready", source_paths: [`sources/${entry.case_id}.source`], expected_path: `expected/${entry.case_id}.yaml` })) }));
  mapping.corpus_sha256 = (await loadPrivateCorpus(manifest)).corpus_sha256;
  const identityPath = join(root, "model-runs/identity.json"), mappingPath = join(root, "model-runs/mapping.json");
  await writeJson(identityPath, runIdentity); await writeJson(mappingPath, mapping); await pack(exportRoot, rows);
  const options: ProductCollectionOptions = { manifest, identity: identityPath, mapping: mappingPath, exportRoot };
  return { options, rows, entries, mapping, root, exportRoot, mappingPath };
}
async function mappingWrite(data: Awaited<ReturnType<typeof fixture>>) { await writeJson(data.mappingPath, data.mapping); }
function errorCode(code: string) { return (error: unknown) => error instanceof ProductCollectionError && error.code === code; }

test("collects real product-format bytes/current explicit typed/type/ranked subset without model or promotion claims", async () => temporary(async (root) => {
  const data = await fixture(root), before = await readFile(join(data.exportRoot, "objects/property-values.jsonl"));
  const collected = await collectProductObservations(data.options);
  assert.equal(collected.observations.cases.length, 20);
  assert.deepEqual(collected.observations.cases[0].source_hashes, data.entries[0].source_hashes);
  assert.deepEqual(collected.observations.cases[0].typed_values, [{ id: "RATING-1", value_type: "rating", value: 4.5, scale_max: 5 }]);
  assert.deepEqual(collected.observations.cases[0].primary_types, ["dining_note"]);
  assert.deepEqual(collected.observations.cases[0].recall_results, [{ id: "RECALL-1", ranked_ids: ["document-21", "LOGICAL-DOCUMENT-1"] }]);
  assert.equal(collected.receipt.cases[0].unmapped_ranked_ids, 1);
  assert.equal(collected.receipt.live_provider_verified, false); assert.equal(collected.receipt.live_search_executed, false); assert.equal(collected.receipt.promotion_eligible, false);
  assert.doesNotMatch(JSON.stringify(collected.receipt), new RegExp(secret));
  assert.deepEqual(await readFile(join(data.exportRoot, "objects/property-values.jsonl")), before);
  const corpus = await loadPrivateCorpus(data.options.manifest);
  const report = evaluateRecorded({ mode: "private-recorded", identity: runIdentity, ...corpus, observations: collected.observations, readiness: { current_hashes_verified: true, ready_cases: 20, human_approved_cases: 20 } });
  assert.equal(report.aggregate.metrics.ranked_id_top1.rate, 0); assert.equal(report.aggregate.metrics.ranked_id_top5.rate, 1);
  assert.equal(report.promotion.decision, "review_required"); assert.equal(report.rubric.average_points, null);
}));
test("unknown collections and unstored rating scale stay unknown rather than invented values", async () => temporary(async (root) => {
  const data = await fixture(root);
  delete data.mapping.cases[0].typed_values![0].scale_field_definition_id;
  delete data.mapping.cases[1].typed_values; delete data.mapping.cases[1].primary_type_document_ids; delete data.mapping.cases[1].recall_queries;
  await mappingWrite(data);
  const collected = await collectProductObservations(data.options);
  assert.equal(collected.observations.cases[0].typed_values, undefined); assert.equal(collected.receipt.cases[0].typed_unknown_reason, "SCALE_NOT_STORED");
  assert.equal(collected.observations.cases[1].typed_values, undefined); assert.equal(collected.observations.cases[1].primary_types, undefined); assert.equal(collected.observations.cases[1].recall_results, undefined);
}));
test("superseded, proposed and external values cannot substitute for an accepted current explicit value", async () => temporary(async (root) => {
  const data = await fixture(root);
  data.rows.properties[0].review_status = "proposed";
  data.rows.properties[2].superseded_at = "2026-10-03T00:00:00Z";
  data.rows.properties[4].source_class = "external_grounded";
  await pack(data.exportRoot, data.rows);
  const collected = await collectProductObservations(data.options);
  for (const item of collected.observations.cases.slice(0, 3)) assert.deepEqual(item.typed_values, []);
}));
test("null explicit value is unrepresentable instead of becoming zero", async () => temporary(async (root) => {
  const data = await fixture(root); data.rows.properties[0].value_json = "null"; data.rows.properties[0].value_number = null;
  await pack(data.exportRoot, data.rows);
  const collected = await collectProductObservations(data.options);
  assert.equal(collected.observations.cases[0].typed_values, undefined); assert.equal(collected.receipt.cases[0].typed_unknown_reason, "VALUE_NOT_REPRESENTABLE");
}));
test("primitive typed values preserve false/zero/whitespace/date strings and reject boolean coercion", async () => temporary(async (root) => {
  const data = await fixture(root), selector = data.mapping.cases[0].typed_values![0];
  delete selector.scale_field_definition_id;
  for (const item of data.mapping.cases.slice(1)) delete item.typed_values;
  await mappingWrite(data);
  for (const [kind, value, column, stored] of [
    ["text", "  메모\r\n", "value_text", "  메모\r\n"], ["date", "2026-10", "value_date", "2026-10"],
    ["boolean", false, "value_boolean", 0], ["number", 0, "value_number", 0],
  ] as const) {
    data.rows.fields[0].data_type = kind; Object.assign(data.rows.properties[0], { value_kind: kind, value_json: JSON.stringify(value), [column]: stored });
    await pack(data.exportRoot, data.rows);
    const collected = await collectProductObservations(data.options);
    assert.deepEqual(collected.observations.cases[0].typed_values, [{ id: "RATING-1", value_type: kind, value }]);
  }
  data.rows.fields[0].data_type = "boolean"; Object.assign(data.rows.properties[0], { value_kind: "boolean", value_json: "true", value_boolean: 2 }); await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_VALUE_INVALID"));
}));
test("attachment source hashes are collected from actual original bytes and linked owner metadata", async () => temporary(async (root) => {
  const data = await fixture(root), bytes = Buffer.from([0, 255, 10, 13, 128, 1]);
  data.rows.sources[0].raw_text = null; data.rows.sources[0].content_hash = hash(bytes);
  data.rows.sourceAttachments.push({ user_id: "owner", source_item_id: "source-1", attachment_id: "attachment-1" });
  data.rows.attachments.push({ id: "attachment-1", user_id: "owner", status: "committed", sha256: hash(bytes).slice(7), size_bytes: bytes.length });
  data.entries[0].source_hashes = [hash(bytes)];
  await writeFile(join(root, "sources/GC-01.source"), bytes); await writeFile(join(root, "expected/GC-01.yaml"), stringify(data.entries[0]));
  data.mapping.corpus_sha256 = (await loadPrivateCorpus(data.options.manifest)).corpus_sha256; await mappingWrite(data);
  await pack(data.exportRoot, data.rows, { "attachments/originals/attachment-1/photo.bin": bytes });
  const collected = await collectProductObservations(data.options);
  assert.deepEqual(collected.observations.cases[0].source_hashes, [hash(bytes)]); assert.deepEqual(collected.observations.cases[0].fatal_failures, []);
}));
test("raw source corruption is observed and fatal instead of trusting the stored hash", async () => temporary(async (root) => {
  const data = await fixture(root); data.rows.sources[0].raw_text = "changed bytes"; await pack(data.exportRoot, data.rows);
  const collected = await collectProductObservations(data.options);
  assert.deepEqual(collected.observations.cases[0].source_hashes, [hash("changed bytes")]); assert.deepEqual(collected.observations.cases[0].fatal_failures, ["SOURCE_MUTATION"]);
}));
test("duplicate accepted properties and JSON/typed-column disagreement fail closed", async () => temporary(async (root) => {
  const data = await fixture(root); data.rows.properties.push({ ...data.rows.properties[0], id: "duplicate-current" }); await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_VALUE_INVALID"));
  data.rows.properties.pop(); data.rows.properties[0].value_json = "4.0"; await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_VALUE_INVALID"));
}));
test("foreign owner, source capture mismatch and current revision mismatch fail closed", async () => temporary(async (root) => {
  const data = await fixture(root);
  data.rows.objects[0].user_id = "other-owner"; await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_OWNER_MISMATCH"));
  data.rows.objects[0].user_id = "owner"; data.rows.sources[0].capture_id = "capture-2"; await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_MAPPING_INVALID"));
  data.rows.sources[0].capture_id = "capture-1"; data.rows.documents[0].current_revision_id = "revision-2"; await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_MAPPING_INVALID"));
}));
test("mapping identity/corpus and exact case set are mandatory", async () => temporary(async (root) => {
  const data = await fixture(root); data.mapping.identity = { ...runIdentity, build_sha: "b".repeat(40) }; await mappingWrite(data);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_IDENTITY_MISMATCH"));
  data.mapping.identity = runIdentity; data.mapping.corpus_sha256 = hash("wrong-corpus"); await mappingWrite(data);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_IDENTITY_MISMATCH"));
  assert.throws(() => productMapping({ ...data.mapping, cases: data.mapping.cases.slice(0, 19) }), errorCode("COLLECTION_MAPPING_INVALID"));
  assert.throws(() => productMapping({ ...data.mapping, response: secret }), errorCode("COLLECTION_MAPPING_INVALID"));
}));
test("export checksum mismatch cannot be used as product observation", async () => temporary(async (root) => {
  const data = await fixture(root); await writeFile(join(data.exportRoot, "sources/source-items.jsonl"), secret);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_EXPORT_INVALID"));
}));
test("restricted documents remain outside an explicitly normal-only mapping", async () => temporary(async (root) => {
  const data = await fixture(root); data.rows.documents[0].privacy_level = "restricted"; await pack(data.exportRoot, data.rows);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_MAPPING_INVALID"));
}));
test("response bytes/plan/page/completeness/duplicate ranked IDs are checked", async () => temporary(async (root) => {
  const data = await fixture(root), selector = data.mapping.cases[0].recall_queries![0], path = join(root, selector.response_path);
  const original = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  for (const change of [{ page: 2 }, { totalCount: 15 }, { results: [{ recordId: "document-1", privacyLevel: "normal" }, { recordId: "document-1", privacyLevel: "normal" }] }, { plan: { invalid: secret } }]) {
    await writeJson(path, { ...original, ...change }); selector.response_sha256 = hash(await readFile(path)); await mappingWrite(data);
    await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_RECALL_INVALID"));
  }
  await writeJson(path, original); await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_RECALL_INVALID"));
}));
test("rehashed response cannot replace the approved literal query or add unapproved filters", async () => temporary(async (root) => {
  const data = await fixture(root), selector = data.mapping.cases[0].recall_queries![0], path = join(root, selector.response_path);
  const original = JSON.parse(await readFile(path, "utf8")) as { plan: Record<string, unknown> };
  for (const change of [{ fullText: "different unapproved query" }, { typeKeys: ["unapproved_type"] }, { sort: { field: "title", direction: "asc" } }]) {
    const response = { ...original, plan: { ...original.plan, ...change } };
    await writeJson(path, response);
    selector.response_sha256 = hash(await readFile(path)); selector.plan_sha256 = digest(response.plan); await mappingWrite(data);
    await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_RECALL_INVALID"));
  }
}));
test("unmapped runtime ID cannot collide with a required logical ID", async () => temporary(async (root) => {
  const data = await fixture(root); data.mapping.record_ids[0].observation_id = "document-21"; await mappingWrite(data);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_RECALL_INVALID"));
}));
test("traversal and outside-root inputs cannot be collected", async () => temporary(async (root) => {
  const data = await fixture(root); data.mapping.cases[0].recall_queries![0].response_path = "../outside.json"; await mappingWrite(data);
  await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_PATH_INVALID"));
  await assert.rejects(collectProductObservations({ ...data.options, identity: join(tmpdir(), "outside-identity.json") }), errorCode("COLLECTION_PATH_INVALID"));
}));
test("canonical directory symlink/junction escapes are rejected when the host permits links", async (context) => temporary(async (root) => {
  const data = await fixture(root), outside = await mkdtemp(join(tmpdir(), "lighthouse-product-outside-"));
  try {
    const target = join(outside, "response.json"); await writeJson(target, { secret });
    const link = join(root, "model-runs/outside");
    try { await symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); } catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip("Host does not permit directory link creation"); return; } throw error; }
    data.mapping.cases[0].recall_queries![0].response_path = "model-runs/outside/response.json"; await mappingWrite(data);
    await assert.rejects(collectProductObservations(data.options), errorCode("COLLECTION_PATH_INVALID"));
  } finally { await rm(outside, { recursive: true, force: true }); }
}));
test("private outputs are exclusive new files and keep source contents out of the receipt", async () => temporary(async (root) => {
  const data = await fixture(root), collection = await collectProductObservations(data.options), output = join(root, "model-runs/observations.json"), receiptPath = join(root, "model-runs/receipt.json");
  await writeProductCollection(data.options.manifest, output, receiptPath, collection);
  assert.equal(hash(await readFile(output)), collection.receipt.observations_sha256);
  assert.doesNotMatch(await readFile(receiptPath, "utf8"), new RegExp(secret));
  await assert.rejects(writeProductCollection(data.options.manifest, output, receiptPath, collection), errorCode("COLLECTION_OUTPUT_INVALID"));
  assert.equal(hash(await readFile(output)), collection.receipt.observations_sha256);
  await assert.rejects(writeProductCollection(data.options.manifest, join(tmpdir(), "outside-output.json"), join(root, "model-runs/new-receipt.json"), collection), errorCode("COLLECTION_OUTPUT_INVALID"));
}));
test("CLI reports only safe collection code/counts on success and malformed private inputs", async () => temporary(async (root) => {
  const data = await fixture(root), command = resolve("tools/v2-eval/collect-product.ts");
  const args = ["--manifest", data.options.manifest, "--identity", data.options.identity, "--mapping", data.options.mapping, "--export-root", data.options.exportRoot, "--output", join(root, "model-runs/cli-observations.json"), "--receipt", join(root, "model-runs/cli-receipt.json")];
  const success = spawnSync(process.execPath, ["--import", "tsx", command, ...args], { encoding: "utf8" });
  assert.equal(success.status, 0); assert.match(success.stdout, /COLLECTION_CREATED/); assert.doesNotMatch(success.stdout + success.stderr, new RegExp(`${secret}|${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await writeFile(data.mappingPath, `not-json ${secret}`);
  const invalid = spawnSync(process.execPath, ["--import", "tsx", command, ...args], { encoding: "utf8" });
  assert.equal(invalid.status, 1); assert.match(invalid.stdout, /COLLECTION_INPUT_INVALID/); assert.doesNotMatch(invalid.stdout + invalid.stderr, new RegExp(secret));
}));
