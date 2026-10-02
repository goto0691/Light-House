import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1PortabilityRepository } from "@/lib/v2/infrastructure/d1/portability-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { advanceResumableExportWorkflow, stageResumableExportWorkflow } from "@/lib/v2/portability/resumable-export-v2";
import { parseStoredZip } from "@/lib/v2/portability/zip-stream-v1";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { canonical, digest, exactKeys, identity, record, strings, type Expected } from "../contracts";
import { PRODUCT_MAPPING_CONTRACT, collectProductObservations, writeProductCollection, type ProductMapping } from "../product-observations";
import { loadPrivateCorpus, runPrivate, writeNewReport } from "../recorded-input";
import { serializeReport } from "../report";
import { PrivateReplayMemoryR2 } from "./memory-r2";
import { PrivateReplaySqlite } from "./sqlite";

export const PRIVATE_REPLAY_CONTRACT = "private-product-replay-v1" as const;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ADVANCES = 2000;
const OWNER = "isolated-private-replay-owner";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const REPLAY_CODES = ["PRIVATE_REPLAY_ARGUMENTS_INVALID", "PRIVATE_REPLAY_PATH_INVALID", "PRIVATE_REPLAY_INPUT_INVALID", "PRIVATE_REPLAY_READ_FAILED", "PRIVATE_REPLAY_SOURCE_CHANGED", "PRIVATE_REPLAY_IDENTITY_MISMATCH", "PRIVATE_REPLAY_CAPTURE_INVALID", "PRIVATE_REPLAY_EXPORT_INVALID", "PRIVATE_REPLAY_OUTPUT_INVALID", "PRIVATE_REPLAY_INTERNAL_ERROR"] as const;
export type ReplayCode = (typeof REPLAY_CODES)[number];
export class PrivateReplayError extends Error { constructor(readonly code: ReplayCode) { super(code); } }
function fail(code: ReplayCode): never { throw new PrivateReplayError(code); }
function inside(root: string, path: string) { const rel = relative(root, path); return Boolean(rel) && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); }
function byteHash(value: Uint8Array | string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
async function privateFile(root: string, path: string, absolute = false) {
  if ((!absolute && isAbsolute(path)) || path.split(/[\\/]/).includes("..")) fail("PRIVATE_REPLAY_PATH_INVALID");
  const candidate = resolve(root, path); if (!inside(root, candidate)) fail("PRIVATE_REPLAY_PATH_INVALID");
  const canonicalPath = await realpath(candidate); if (!inside(root, canonicalPath)) fail("PRIVATE_REPLAY_PATH_INVALID");
  const info = await stat(canonicalPath); if (!info.isFile() || info.size > MAX_INPUT_BYTES) fail("PRIVATE_REPLAY_READ_FAILED");
  const bytes = await readFile(canonicalPath); if (bytes.length > MAX_INPUT_BYTES) fail("PRIVATE_REPLAY_READ_FAILED");
  return bytes;
}
function decodeExact(bytes: Buffer) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail("PRIVATE_REPLAY_INPUT_INVALID"); }
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("PRIVATE_REPLAY_INPUT_INVALID");
  return text;
}
async function createOutput(root: string, path: string) {
  const candidate = resolve(path), parent = await realpath(dirname(candidate));
  if (!inside(root, candidate) || (parent !== root && !inside(root, parent))) fail("PRIVATE_REPLAY_PATH_INVALID");
  const canonical = resolve(parent, basename(candidate));
  try { await mkdir(canonical, { mode: 0o700 }); } catch { return fail("PRIVATE_REPLAY_OUTPUT_INVALID"); }
  return canonical;
}
async function writePrivateJson(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
function approvedLiteralQueries(expected: Expected) {
  return expected.recall_queries.filter((query) => exactKeys(query, ["id", "query", "required_ids", "top_k"])
    && typeof query.id === "string" && typeof query.query === "string" && Boolean(query.query) && strings(query.required_ids, false) && query.top_k === 10);
}
export type PrivateReplayOptions = { manifest: string; identity: string; outputDirectory: string };
/** Actual capture/retrieval/export services on an isolated SQLite database; analysis is never invoked. */
export async function replayPrivateProduct(options: PrivateReplayOptions) {
  const corpus = await loadPrivateCorpus(options.manifest);
  const root = await realpath(dirname(resolve(options.manifest)));
  const identityBytes = await privateFile(root, resolve(options.identity), true);
  let identityInput: unknown;
  try { identityInput = JSON.parse(identityBytes.toString("utf8")) as unknown; } catch { return fail("PRIVATE_REPLAY_INPUT_INVALID"); }
  const runIdentity = identity(identityInput);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  if (runIdentity.build_sha !== head) fail("PRIVATE_REPLAY_IDENTITY_MISMATCH");
  const manifest: unknown = parse((await privateFile(root, resolve(options.manifest), true)).toString("utf8"), { logLevel: "silent" });
  if (!record(manifest) || !Array.isArray(manifest.cases)) fail("PRIVATE_REPLAY_INPUT_INVALID");
  const sources: { expected: Expected; bytes: Buffer; text: string; title: string }[] = [];
  for (const expected of [...corpus.expected].sort((left, right) => left.case_id.localeCompare(right.case_id))) {
    const item = manifest.cases.find((value: unknown) => record(value) && value.case_id === expected.case_id);
    if (!record(item) || !Array.isArray(item.source_paths) || item.source_paths.length !== 1 || typeof item.source_paths[0] !== "string") fail("PRIVATE_REPLAY_INPUT_INVALID");
    const bytes = await privateFile(root, item.source_paths[0]), text = decodeExact(bytes);
    if (canonical(expected.source_hashes) !== canonical([byteHash(bytes)])) fail("PRIVATE_REPLAY_SOURCE_CHANGED");
    const heading = /^\uFEFF?# ([^\r\n]+)(?:\r?\n|$)/.exec(text);
    if (!heading || !heading[1].trim()) fail("PRIVATE_REPLAY_INPUT_INVALID");
    sources.push({ expected, bytes, text, title: heading[1] });
  }
  const output = await createOutput(root, options.outputDirectory);
  const exportRoot = resolve(output, "product-export"), responses = resolve(output, "retrieval-responses");
  await mkdir(exportRoot, { mode: 0o700 }); await mkdir(responses, { mode: 0o700 });
  const db = new PrivateReplaySqlite(OWNER), bucket = new PrivateReplayMemoryR2();
  try {
    const captures = new D1SourceFoundationRepository(db, OWNER), retrieval = new D1RetrievalRepository(db, OWNER);
    const mapping: ProductMapping = { contract: PRODUCT_MAPPING_CONTRACT, export_id: "pending", owner_id: OWNER, identity: runIdentity, corpus_sha256: corpus.corpus_sha256, allowed_privacy: ["normal"], record_ids: [], cases: [] };
    const stored: { case_id: string; record_id: string; source_item_id: string; source_sha256: string; replayed_without_duplicate: boolean }[] = [];
    for (const source of sources) {
      const prepared = await prepareCaptureCommit({ draftId: `private-evaluation:${source.expected.case_id}`, channel: "import", title: source.title, bodyMarkdown: source.text, aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, `private-evaluation:${source.expected.case_id}`);
      const receipt = await captures.commitCapture(prepared), repeated = await captures.commitCapture(prepared), record = await captures.getRecord(receipt.recordId);
      if (!record || record.bodyMarkdown !== source.text || record.sources.length !== 1 || record.sources[0].rawText !== source.text
        || byteHash(Buffer.from(record.sources[0].rawText, "utf8")) !== byteHash(source.bytes)
        || receipt.disposition !== "committed" || repeated.disposition !== "replayed" || repeated.recordId !== receipt.recordId) fail("PRIVATE_REPLAY_CAPTURE_INVALID");
      stored.push({ case_id: source.expected.case_id, record_id: receipt.recordId, source_item_id: record.sources[0].id, source_sha256: byteHash(Buffer.from(record.sources[0].rawText, "utf8")), replayed_without_duplicate: true });
      mapping.record_ids.push({ record_id: receipt.recordId, observation_id: source.expected.case_id });
      // No typed value or primary assignment is synthesized from expected aliases.
      mapping.cases.push({ case_id: source.expected.case_id, document_ids: [receipt.recordId], source_item_ids: [record.sources[0].id] });
    }
    for (const source of sources) {
      const item = mapping.cases.find((entry) => entry.case_id === source.expected.case_id)!;
      const queries = approvedLiteralQueries(source.expected);
      if (!queries.length) continue;
      item.recall_queries = [];
      for (const [index, query] of queries.entries()) {
        const plan = defaultV2QueryPlan({ fullText: query.query as string, limit: 20 }), page = await retrieval.searchPage(plan, false, 1);
        const response = { contractVersion: "retrieval-results-v1", plan, ...page };
        const path = resolve(responses, `${source.expected.case_id}-${index + 1}.json`), contents = `${JSON.stringify(response, null, 2)}\n`;
        await writeFile(path, contents, { flag: "wx", mode: 0o600 });
        item.recall_queries.push({ id: query.id as string, response_path: relative(root, path).split(sep).join("/"), response_sha256: byteHash(contents), plan_sha256: digest(plan) });
      }
    }
    for (const table of ["v2_processing_jobs", "v2_processing_runs", "v2_property_values", "v2_object_type_assignments"]) {
      const count = await db.prepare(`select count(*) as value from ${table}`).first<{ value: number }>();
      if (count?.value !== 0) fail("PRIVATE_REPLAY_CAPTURE_INVALID");
    }
    const portability = new D1PortabilityRepository(db, OWNER);
    const job = await portability.createExport({ profile: "migration", scope: { objects: "all", privacyLevels: ["normal", "sensitive", "restricted"], includeTrash: true, includeHistory: true, includeOriginals: true }, idempotencyKey: "private-evaluation:export" });
    let workflow = await stageResumableExportWorkflow({ db, userId: OWNER, exportId: job.id }), advances = 0;
    while (workflow.status !== "succeeded" && workflow.status !== "failed" && advances < MAX_ADVANCES) {
      workflow = await advanceResumableExportWorkflow({ db, bucket, userId: OWNER, exportId: job.id }); advances += 1;
    }
    if (workflow.status !== "succeeded" || !workflow.bundleObjectKey || !workflow.bundleSha256 || !workflow.manifest) fail("PRIVATE_REPLAY_EXPORT_INVALID");
    const archive = await bucket.get(workflow.bundleObjectKey); if (!archive || archive.size > MAX_ARCHIVE_BYTES) fail("PRIVATE_REPLAY_EXPORT_INVALID");
    const bytes = new Uint8Array(await archive.arrayBuffer());
    if (byteHash(bytes) !== `sha256:${workflow.bundleSha256}` || bytes.length !== workflow.bundleSizeBytes) fail("PRIVATE_REPLAY_EXPORT_INVALID");
    const entries = parseStoredZip(bytes, { maxFiles: 10_000, maxEntryBytes: MAX_INPUT_BYTES, maxTotalBytes: MAX_ARCHIVE_BYTES });
    await writeFile(resolve(output, "product-export.zip"), bytes, { flag: "wx", mode: 0o600 });
    for (const entry of entries.values()) {
      // Product parser checks entry paths, CRC, duplicates and byte budgets before any writes.
      const path = resolve(exportRoot, entry.path); if (!inside(exportRoot, path)) fail("PRIVATE_REPLAY_PATH_INVALID");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, entry.bytes, { flag: "wx", mode: 0o600 });
    }
    mapping.export_id = workflow.id;
    const mappingPath = resolve(output, "product-mapping.json"), identityPath = resolve(output, "identity.json"), observationsPath = resolve(output, "product-observations.json"), collectionReceiptPath = resolve(output, "product-collection-receipt.json");
    await writePrivateJson(mappingPath, mapping); await writePrivateJson(identityPath, runIdentity);
    const collected = await collectProductObservations({ manifest: options.manifest, identity: identityPath, mapping: mappingPath, exportRoot });
    await writeProductCollection(options.manifest, observationsPath, collectionReceiptPath, collected);
    const report = await runPrivate(options.manifest, identityPath, observationsPath);
    if (byteHash(await privateFile(root, resolve(options.identity), true)) !== byteHash(identityBytes)) fail("PRIVATE_REPLAY_IDENTITY_MISMATCH");
    await writeNewReport(resolve(output, "recorded-report.json"), serializeReport(report));
    const receipt = { contract: PRIVATE_REPLAY_CONTRACT, executed_at: new Date().toISOString(), mode: "private-recorded", corpus_sha256: corpus.corpus_sha256, identity: runIdentity,
      build_identity_is_git_head: true, runtime_contains_uncommitted_changes: dirty,
      environment: "isolated-memory-sqlite-and-memory-r2-binding", schema: "v2-032", foreign_keys_enabled: true,
      privacy_projection: "normal-in-isolated-new-account", production_services: ["prepareCaptureCommit", "D1SourceFoundationRepository", "D1RetrievalRepository", "D1PortabilityRepository", "resumable-export-v2"],
      local_source_capture_executed: true, local_search_executed: true, local_export_coordinator_executed: true,
      api_authentication_executed: false, worker_runtime_verified: false, live_provider_verified: false, model_analysis_executed: false, remote_services_called: false,
      promotion_eligible: false, primary_type_quality: "unknown-not-analyzed", typed_value_quality: "unknown-not-extracted", export_advances: advances, zip_sha256: byteHash(bytes), zip_bytes: bytes.length,
      observations_sha256: collected.receipt.observations_sha256, readiness: corpus.readiness, records: stored,
      evaluation_decision: report.promotion.decision, source_hash_equality: report.aggregate.metrics.source_hash_equality, ranked_id_top1: report.aggregate.metrics.ranked_id_top1, ranked_id_top10: report.aggregate.metrics.ranked_id_top10 };
    await writePrivateJson(resolve(output, "replay-receipt.json"), receipt);
    return { observations: collected.observations, collectionReceipt: collected.receipt, report, receipt };
  } finally { db.close(); }
}
