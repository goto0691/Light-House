import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import { type Expected, type Identity } from "../contracts";
import { PrivateReplayError, replayPrivateProduct } from "./replay";
import { PrivateReplaySqlite } from "./sqlite";

const hash = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const secret = "SYNTHETIC_PRIVATE_REPLAY_CONTENT";
async function temporary<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "lighthouse-private-product-replay-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function fixture(root: string) {
  await mkdir(join(root, "sources")); await mkdir(join(root, "expected")); await mkdir(join(root, "model-runs"));
  const expected: Expected[] = [], texts: string[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const caseId = `GC-${String(index).padStart(2, "0")}`, title = `Uniquetitle${String(index).padStart(2, "0")}`, text = `${index === 1 ? "\uFEFF" : ""}# ${title}\r\n\r\n${secret}\r\n\n  whitespace   ${index} \n`;
    texts.push(text);
    const entry: Expected = { version: 1, case_id: caseId, authoring_status: "human_approved", source_hashes: [hash(text)], must_create: {}, must_preserve: [], must_not_assert: [], acceptable_variants: { primary_type: ["reference_note"] }, required_evidence: [], recall_queries: [{ id: `${caseId}-title`, query: title, required_ids: [caseId], top_k: 10 }], severity_overrides: {} };
    expected.push(entry);
    await writeFile(join(root, `sources/${caseId}.md`), text); await writeFile(join(root, `expected/${caseId}.yaml`), stringify(entry));
  }
  const manifest = join(root, "manifest.yaml");
  await writeFile(manifest, stringify({ version: 1, corpus_id: "synthetic-private-product-replay", privacy: "private_local_only", cases: expected.map((entry) => ({ case_id: entry.case_id, slot_kind: "synthetic", status: "ready", source_paths: [`sources/${entry.case_id}.md`], expected_path: `expected/${entry.case_id}.yaml` })) }));
  const identity: Identity = { build_sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), schema_sha256: hash("synthetic-schema-identity"), model_config_sha256: hash("not-invoked"), prompt_sha256: hash("not-invoked"), registry_sha256: hash("not-seeded") };
  const identityPath = join(root, "model-runs/identity.json"); await writeFile(identityPath, JSON.stringify(identity));
  return { manifest, identity: identityPath, outputDirectory: join(root, "model-runs/new-replay"), expected, texts };
}
function failure(code: string) { return (error: unknown) => error instanceof PrivateReplayError && error.code === code; }

test("actual production capture/retrieval/resumable export feeds collector while analysis stays unknown", async () => temporary(async (root) => {
  const data = await fixture(root), before = await readFile(join(root, "sources/GC-01.md"));
  const result = await replayPrivateProduct(data);
  assert.equal(result.observations.cases.length, 20); assert.equal(result.receipt.records.length, 20);
  for (const item of result.observations.cases) {
    assert.deepEqual(item.source_hashes, data.expected.find((entry) => entry.case_id === item.case_id)!.source_hashes);
    assert.equal(item.typed_values, undefined); assert.equal(item.primary_types, undefined); assert.deepEqual(item.fatal_failures, []);
    assert.equal(item.recall_results?.[0].ranked_ids[0], item.case_id);
  }
  assert.equal(result.report.aggregate.metrics.source_hash_equality.rate, 1);
  assert.equal(result.report.aggregate.metrics.ranked_id_top1.rate, 1); assert.equal(result.report.aggregate.metrics.ranked_id_top10.rate, 1);
  assert.equal(result.report.aggregate.metrics.type_alias_recall.rate, null); assert.equal(result.report.aggregate.metrics.type_alias_recall.unknown, 20);
  assert.equal(result.report.promotion.eligible, false); assert.equal(result.report.promotion.decision, "blocked");
  assert.equal(result.receipt.model_analysis_executed, false); assert.equal(result.receipt.remote_services_called, false); assert.equal(result.receipt.worker_runtime_verified, false);
  assert.equal(result.receipt.local_export_coordinator_executed, true); assert.ok(result.receipt.export_advances > 1);
  assert.ok(result.receipt.records.every((entry) => entry.replayed_without_duplicate));
  const sourceRows = (await readFile(join(data.outputDirectory, "product-export/sources/source-items.jsonl"), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as { raw_text: string });
  assert.ok(sourceRows.some((entry) => entry.raw_text === data.texts[0]));
  assert.deepEqual(await readFile(join(root, "sources/GC-01.md")), before);
  assert.doesNotMatch(JSON.stringify(result.receipt), new RegExp(secret));
}));
test("isolated SQLite applies actual schema with foreign keys and real transaction rollback", async () => {
  const db = new PrivateReplaySqlite("synthetic-owner");
  try {
    const foreignKeys = db.sql.prepare("pragma foreign_keys").get() as { foreign_keys: number }; assert.equal(foreignKeys.foreign_keys, 1);
    await assert.rejects(db.batch([db.prepare("insert into users(id) values ('batch-rollback')"), db.prepare("insert into users(id) values ('synthetic-owner')")]));
    assert.equal(db.sql.prepare("select count(*) as value from users where id='batch-rollback'").get()!.value, 0);
  } finally { db.close(); }
});
test("identity checkout mismatch and an existing output directory fail without overwriting", async () => temporary(async (root) => {
  const data = await fixture(root), original = await readFile(data.identity, "utf8");
  const modified = JSON.parse(original) as Identity; modified.build_sha = "f".repeat(40); await writeFile(data.identity, JSON.stringify(modified));
  await assert.rejects(replayPrivateProduct(data), failure("PRIVATE_REPLAY_IDENTITY_MISMATCH"));
  await writeFile(data.identity, original); await mkdir(data.outputDirectory); await writeFile(join(data.outputDirectory, "sentinel"), secret);
  await assert.rejects(replayPrivateProduct(data), failure("PRIVATE_REPLAY_OUTPUT_INVALID"));
  assert.equal(await readFile(join(data.outputDirectory, "sentinel"), "utf8"), secret);
}));
test("outside-root identity/output and invalid UTF-8 source are rejected", async () => temporary(async (root) => {
  const data = await fixture(root);
  await assert.rejects(replayPrivateProduct({ ...data, identity: join(tmpdir(), "outside-replay-identity.json") }), failure("PRIVATE_REPLAY_PATH_INVALID"));
  await assert.rejects(replayPrivateProduct({ ...data, outputDirectory: join(tmpdir(), "outside-private-replay") }), failure("PRIVATE_REPLAY_PATH_INVALID"));
  const bytes = Buffer.from([0xff, 0xfe, 0x23, 0x20]);
  await writeFile(join(root, "sources/GC-01.md"), bytes); data.expected[0].source_hashes = [hash(bytes)]; await writeFile(join(root, "expected/GC-01.yaml"), stringify(data.expected[0]));
  await assert.rejects(replayPrivateProduct(data), failure("PRIVATE_REPLAY_INPUT_INVALID"));
}));
test("CLI failure exposes only fixed codes even when private paths/JSON are invalid", async () => temporary(async (root) => {
  const data = await fixture(root); await writeFile(data.identity, `invalid-json ${secret}`);
  const result = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tools/v2-eval/private-replay/tsconfig.json", "tools/v2-eval/private-replay/run.ts", "--manifest", data.manifest, "--identity", data.identity, "--output-directory", data.outputDirectory], { encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stdout, /PRIVATE_REPLAY_INPUT_INVALID/); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
}));
