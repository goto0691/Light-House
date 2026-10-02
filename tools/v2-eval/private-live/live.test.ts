import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { stringify } from "yaml";

import { GeminiProviderError } from "@/lib/v2/ai/gemini-role-gateways";
import type { V2StructuredModelGateway, V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { getV2ModelRoutes } from "@/lib/v2/ai/model-routing";
import { digest, type Expected } from "../contracts";
import { AUTHORIZATION_CONTRACT, assertAuthorization, byteHash, describeLiveTarget, gitProcessEnvironment, PrivateLiveError } from "./boundary";
import { createLiveGateway, OnePassBudgetGateway } from "./budget";
import { runPrivateLive } from "./pipeline";
import { prepareLiveApproval } from "./prepare";
import { parseLiveArguments } from "./run";

const SECRET = "SYNTHETIC_PRIVATE_LIVE_DO_NOT_PRINT";
const suiteFetch = globalThis.fetch;
let forbiddenFetches = 0;
before(() => { globalThis.fetch = async () => { forbiddenFetches += 1; throw new Error("PRIVATE_LIVE_TEST_NETWORK_FORBIDDEN"); }; });
after(() => { globalThis.fetch = suiteFetch; assert.equal(forbiddenFetches, 0); });
async function temporary<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "lighthouse-private-live-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function fixture(root: string) {
  for (const path of ["sources", "expected", "model-runs"]) await mkdir(join(root, path));
  const expected: Expected[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const case_id = `GC-${String(index).padStart(2, "0")}`, title = `Uniquelive${String(index).padStart(2, "0")}`, text = `${index === 1 ? "\uFEFF" : ""}# ${title}\r\n\r\n${SECRET}\r\nCounter: ${index}\n  preserve trailing space   \n`;
    const entry: Expected = { version: 1, case_id, authoring_status: "human_approved", source_hashes: [byteHash(text)], must_create: {}, must_preserve: [], must_not_assert: [], acceptable_variants: { primary_type: ["reference_note"] }, required_evidence: [], recall_queries: [{ id: `${case_id}-title`, query: title, required_ids: [case_id], top_k: 10 }], severity_overrides: {} };
    expected.push(entry); await writeFile(join(root, `sources/${case_id}.md`), text); await writeFile(join(root, `expected/${case_id}.yaml`), stringify(entry));
  }
  const manifest = join(root, "manifest.yaml"), outputDirectory = join(root, "model-runs/fresh-live"), authorization = join(root, "model-runs/authorization.json");
  await writeFile(manifest, stringify({ version: 1, corpus_id: "synthetic-private-live", privacy: "private_local_only", cases: expected.map((item) => ({ case_id: item.case_id, slot_kind: "synthetic", status: "ready", source_paths: [`sources/${item.case_id}.md`], expected_path: `expected/${item.case_id}.yaml` })) }));
  const prepared = await describeLiveTarget(manifest, outputDirectory);
  const approval = { contract: AUTHORIZATION_CONTRACT, target: prepared.target, authorized: true, approval: { kind: "user_explicit_private_transmission", user_request_sha256: byteHash("synthetic fixture permission only"), recorded_at: new Date().toISOString() } };
  await writeFile(authorization, JSON.stringify(approval));
  return { live: true, manifest, outputDirectory, authorization, approval, expected };
}
function failure(code: string) { return (error: unknown) => error instanceof PrivateLiveError && error.code === code; }
function successfulGateway(onCall: (request: V2StructuredModelRequest) => void | Promise<void> = () => {}) {
  const gateway: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) {
    await onCall(request);
    const input = JSON.parse((request.parts![0] as { text: string }).text) as { target: { capture_id: string; revision_id: string }; sources: { source_item_id: string; raw_text: string }[] };
    const source = input.sources[0], start = source.raw_text.indexOf(SECRET);
    const evidence = { source_item_id: source.source_item_id, start, end: start + SECRET.length, quote: SECRET };
    const data = { contract_version: "analysis-v1", capture_id: input.target.capture_id, analyzed_revision_id: input.target.revision_id, language: "en", bundle_summary: SECRET,
      document_proposals: [{ temp_id: "document", source_item_ids: [source.source_item_id], suggested_title: null, type_assignments: [{ type_key: "reference_note", label: "Synthetic reference", registry_action: "propose_new", evidence_refs: [evidence] }] }],
      entity_proposals: [], event_proposals: [], field_proposals: [{ temp_id: "field", field_key: "synthetic_excerpt", value: SECRET, value_type: "text", claim_risk: "low", disposition: "accepted", evidence_refs: [evidence] }], enrichment_requests: [], review_items: [], warnings: [] };
    return { data: data as T, role: request.role, modelId: getV2ModelRoutes().main_analyzer, inputHash: request.inputHash, outputHash: digest(data), tokenUsage: { input: 50, output: 20 }, latencyMs: 1 };
  } };
  return gateway;
}
const synthetic = (gateway: V2StructuredModelGateway) => ({ gatewayFactory: () => gateway, providerMode: "synthetic-no-network" as const });

test("explicit live flag rejects before reading paths or constructing a provider", async () => {
  let factories = 0;
  await assert.rejects(runPrivateLive({ live: false, manifest: SECRET, authorization: SECRET, outputDirectory: SECRET }, { gatewayFactory: () => { factories += 1; return successfulGateway(); }, providerMode: "synthetic-no-network" }), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
  assert.equal(factories, 0); assert.throws(() => parseLiveArguments(["--manifest", SECRET]), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
  await assert.rejects(runPrivateLive({ live: true, manifest: SECRET, authorization: SECRET, outputDirectory: SECRET }, { providerMode: "synthetic-no-network" }), failure("PRIVATE_LIVE_ARGUMENTS_INVALID"));
  await assert.rejects(runPrivateLive({ live: true, manifest: SECRET, authorization: SECRET, outputDirectory: SECRET }, { gatewayFactory: () => successfulGateway() }), failure("PRIVATE_LIVE_ARGUMENTS_INVALID"));
  for (const args of [["--live", "--live"], ["--live", "--manifest", "a", "--authorization", "b", "--output-directory", "c", "--max-provider-calls", "21"], ["--live", "--manifest", "a", "--manifest", "a", "--authorization", "b", "--output-directory", "c"]]) assert.throws(() => parseLiveArguments(args), (error: unknown) => error instanceof PrivateLiveError);
});

test("prepare cannot authorize transmission; exact corpus/model/build/output/cap and calendar date are bound", async () => temporary(async (root) => {
  const data = await fixture(root), request = join(root, "model-runs/request.json");
  const prepared = await prepareLiveApproval(data.manifest, data.outputDirectory, request), raw = JSON.parse(await readFile(request, "utf8")) as Record<string, unknown>;
  assert.equal(raw.authorized, false); assert.equal(prepared.target.max_provider_calls, 20); assert.equal(prepared.target.automatic_retry, false);
  assert.throws(() => assertAuthorization(raw, prepared.target), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
  for (const field of ["corpus_sha256", "identity", "output_directory", "configured_model_id", "max_provider_calls", "transmits", "runtime_source_clean"]) {
    const forged = structuredClone(data.approval) as unknown as { target: Record<string, unknown> };
    forged.target[field] = "forged";
    assert.throws(() => assertAuthorization(forged, prepared.target), failure("PRIVATE_LIVE_AUTHORIZATION_MISMATCH"));
  }
  for (const recorded_at of ["2026-02-30T12:00:00.000Z", "2099-01-01T00:00:00.000Z", "2026-01-01T00:00:00Z", "invalid"]) assert.throws(() => assertAuthorization({ ...data.approval, approval: { ...data.approval.approval, recorded_at } }, prepared.target), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
  let factories = 0; await writeFile(data.authorization, JSON.stringify(raw));
  await assert.rejects(runPrivateLive(data, { gatewayFactory: () => { factories += 1; return successfulGateway(); }, providerMode: "synthetic-no-network" }), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
  assert.equal(factories, 0);
}));

test("key-present live/authorization/source-clean rejection never reads or passes credentials to Git or constructs a gateway", async (context) => temporary(async (root) => {
  const dirtyPath = fileURLToPath(new URL(`source-gate-${crypto.randomUUID()}.txt`, import.meta.url));
  const originalEnv = process.env;
  const previousKey = originalEnv.GEMINI_API_KEY;
  try {
    await writeFile(dirtyPath, "synthetic source-clean boundary", { flag: "wx" });
    const data = await fixture(root); assert.equal(data.approval.target.runtime_source_clean, false);
    originalEnv.GEMINI_API_KEY = "SYNTHETIC_INDEPENDENT_TEST_ONLY";
    assert.equal(Object.hasOwn(originalEnv, "GEMINI_API_KEY"), true);
    let keyReads = 0, factories = 0;
    let gitChildren = 0;
    const originalExec = childProcess.execFileSync;
    const auditedExec = (...args: Parameters<typeof originalExec>) => {
      if (args[0] === "git") {
        const env = args[2]?.env;
        assert.ok(env); assert.equal(Object.hasOwn(env, "GEMINI_API_KEY"), false);
        assert.ok(Object.keys(env).every((name) => ["GIT_OPTIONAL_LOCKS", "GIT_TERMINAL_PROMPT", "PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "SystemDrive", "WINDIR"].includes(name)));
        gitChildren += 1;
      }
      return originalExec(...args);
    };
    context.mock.method(childProcess, "execFileSync", auditedExec as typeof originalExec); syncBuiltinESMExports();
    const dependencies = { providerMode: "synthetic-no-network" as const, gatewayFactory: () => { factories += 1; return successfulGateway(); } };
    process.env = new Proxy(originalEnv, { get(target, name) { if (name === "GEMINI_API_KEY") { keyReads += 1; throw new Error("Credential access before source-clean gate"); } return Reflect.get(target, name); } });
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(Object.hasOwn(process.env,'GEMINI_API_KEY')))"], { env: gitProcessEnvironment(), encoding: "utf8" });
    assert.equal(child.status, 0); assert.equal(child.stdout, "false"); assert.equal(keyReads, 0);
    await assert.rejects(runPrivateLive({ ...data, live: false }, dependencies), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
    assert.throws(() => parseLiveArguments(["--manifest", SECRET]), failure("PRIVATE_LIVE_APPROVAL_REQUIRED"));
    await assert.rejects(runPrivateLive(data), failure("PRIVATE_LIVE_SOURCE_NOT_CLEAN")); assert.equal(keyReads, 0);
    await writeFile(data.authorization, JSON.stringify({ ...data.approval, authorized: false }));
    await assert.rejects(runPrivateLive(data, dependencies), failure("PRIVATE_LIVE_APPROVAL_REQUIRED")); assert.equal(keyReads, 0); assert.equal(factories, 0);
    assert.equal(gitChildren, 6);
    await assert.rejects(readFile(join(data.outputDirectory, "run-start.json")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally { context.mock.restoreAll(); syncBuiltinESMExports(); process.env = originalEnv; if (previousKey === undefined) delete originalEnv.GEMINI_API_KEY; else originalEnv.GEMINI_API_KEY = previousKey; await rm(dirtyPath, { force: true }); }
}));

test("actual S1 processing/capture/search/export/collector preserves twenty synthetic sources and stays blocked", async () => temporary(async (root) => {
  const data = await fixture(root), before = await readFile(join(root, "sources/GC-01.md")); let calls = 0;
  const result = await runPrivateLive(data, synthetic(successfulGateway(() => { calls += 1; })));
  assert.equal(calls, 20); assert.equal(result.receipt.provider_calls, 20); assert.equal(result.receipt.analysis_succeeded, 20); assert.equal(result.receipt.all_model_analyses_succeeded, true);
  assert.equal(result.receipt.observed_input_tokens, 1000); assert.equal(result.receipt.observed_output_tokens, 400); assert.equal(result.receipt.live_provider_verified, false);
  assert.equal(result.receipt.semantic_rubric, "unknown-review-required"); assert.equal(result.receipt.decision, "blocked"); assert.equal(result.receipt.promotion_eligible, false);
  assert.equal(result.report.aggregate.metrics.source_hash_equality.rate, 1); assert.equal(result.report.aggregate.metrics.ranked_id_top10.rate, 1);
  assert.equal(result.report.aggregate.metrics.type_alias_recall.unknown, 20); assert.equal(result.report.promotion.decision, "blocked");
  for (const item of result.observations.cases) { assert.equal(item.typed_values, undefined); assert.equal(item.primary_types, undefined); assert.deepEqual(item.source_hashes, data.expected.find((entry) => entry.case_id === item.case_id)!.source_hashes); }
  assert.ok(result.receipt.cases.every((item) => item.accepted_property_count === 1 && item.type_assignment_count === 1 && item.proposal_status === "validated"));
  assert.deepEqual(await readFile(join(root, "sources/GC-01.md")), before);
  assert.match(await readFile(join(data.outputDirectory, "model-results/01.json"), "utf8"), new RegExp(SECRET));
  let factories = 0; await assert.rejects(runPrivateLive(data, { gatewayFactory: () => { factories += 1; return successfulGateway(); }, providerMode: "synthetic-no-network" }), failure("PRIVATE_LIVE_OUTPUT_INVALID")); assert.equal(factories, 0);
}));

for (const status of [503, 429]) test(`provider ${status} stops after one invocation and exports all twenty preserved sources as unknown/blocked`, async () => temporary(async (root) => {
  const data = await fixture(root); let calls = 0;
  const gateway: V2StructuredModelGateway = { async generate() { calls += 1; throw new GeminiProviderError({ status, category: status === 503 ? "provider_server" : "quota_or_rate_limit", code: status === 503 ? "provider_unavailable" : "quota_exhausted", retryable: true, quotaWindow: status === 429 ? "daily" : null, retryAfterMs: 86_400_000 }); } };
  const result = await runPrivateLive(data, synthetic(gateway));
  assert.equal(calls, 1); assert.equal(result.receipt.provider_calls, 1); assert.equal(result.receipt.analysis_succeeded, 0); assert.equal(result.receipt.analysis_not_attempted, 19);
  assert.equal(result.receipt.all_model_analyses_succeeded, false); assert.equal(result.receipt.calls[0].failure?.status, status); assert.equal(result.receipt.calls[0].input_tokens, null);
  assert.equal(result.receipt.decision, "blocked"); assert.equal(result.report.aggregate.metrics.source_hash_equality.rate, 1); assert.equal(result.report.aggregate.metrics.type_alias_recall.unknown, 20);
  assert.equal(result.receipt.cases.filter((item) => item.analysis === "retry_wait").length, 1);
}));

test("an invalid model analysis is not counted as successful and ends further requests", async () => temporary(async (root) => {
  const data = await fixture(root); let calls = 0;
  const gateway: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) { calls += 1; return { data: { invalid: SECRET } as T, role: request.role, modelId: getV2ModelRoutes().main_analyzer, inputHash: request.inputHash, outputHash: digest("invalid"), latencyMs: 1 }; } };
  const result = await runPrivateLive(data, synthetic(gateway));
  assert.equal(calls, 1); assert.equal(result.receipt.provider_calls, 1); assert.equal(result.receipt.analysis_succeeded, 0); assert.equal(result.receipt.analysis_not_attempted, 19);
  assert.equal(result.receipt.cases.filter((item) => item.analysis === "needs_review").length, 1);
  assert.equal(result.receipt.token_usage_complete, false); assert.equal(result.receipt.decision, "blocked"); assert.equal(result.report.aggregate.metrics.source_hash_equality.rate, 1);
}));

test("budget counts failures, forbids duplicate inputs and caps all requests at twenty", async () => {
  const request = (index: number): V2StructuredModelRequest => ({ role: "main_analyzer", schemaId: "synthetic", promptVersion: "synthetic", inputHash: String(index), deadlineMs: 90_000 });
  const delegate: V2StructuredModelGateway = { async generate<T>(input: V2StructuredModelRequest) { return { data: null as T, role: input.role, modelId: "synthetic-model", inputHash: input.inputHash, outputHash: "synthetic", latencyMs: 1 }; } };
  let calls = 0;
  const counted: V2StructuredModelGateway = { async generate<T>(input: V2StructuredModelRequest) { calls += 1; return delegate.generate<T>(input); } };
  const make = () => new OnePassBudgetGateway(counted, "synthetic-model", async () => {}, async () => {}, async () => {});
  const limited = make(); for (let index = 0; index < 20; index += 1) await limited.generate(request(index));
  await assert.rejects(limited.generate(request(20)), failure("PRIVATE_LIVE_BUDGET_EXHAUSTED")); assert.equal(calls, 20);
  const duplicate = make(); await duplicate.generate(request(0)); await assert.rejects(duplicate.generate(request(0)), failure("PRIVATE_LIVE_BUDGET_EXHAUSTED")); assert.equal(duplicate.calls.length, 1);
  const failed = new OnePassBudgetGateway({ async generate() { throw new Error(`untrusted provider payload ${SECRET}`); } }, "synthetic-model", async () => {}, async () => {}, async () => {});
  await assert.rejects(failed.generate(request(0)), (error: unknown) => error instanceof Error && !error.message.includes(SECRET));
  await assert.rejects(failed.generate(request(1)), failure("PRIVATE_LIVE_BUDGET_EXHAUSTED")); assert.equal(failed.calls.length, 1); assert.ok(!JSON.stringify(failed.calls).includes(SECRET));
});

test("installed real SDK uses one fake HTTP request and production gateway retains 503/429 classes without payload leaks", async () => {
  const originalFetch = globalThis.fetch, previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "SYNTHETIC_FAKE_KEY_NEVER_NETWORKED";
  try {
    for (const status of [503, 429]) {
      let requests = 0;
      globalThis.fetch = async (input, init) => {
        requests += 1; assert.equal(new URL(String(input)).origin, "https://generativelanguage.googleapis.com"); assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ error: { code: status, message: SECRET, status: status === 503 ? "UNAVAILABLE" : "RESOURCE_EXHAUSTED" } }), { status, headers: { "content-type": "application/json" } });
      };
      const gateway = createLiveGateway(getV2ModelRoutes());
      await assert.rejects(gateway.generate({ role: "main_analyzer", schemaId: "synthetic", promptVersion: "synthetic", inputHash: "synthetic", deadlineMs: 90_000, parts: [{ text: "synthetic non-private transport test" }], systemInstruction: "return JSON", responseJsonSchema: { type: "object" } }), (error: unknown) => error instanceof GeminiProviderError && error.status === status && !error.message.includes(SECRET));
      assert.equal(requests, 1);
    }
    let requests = 0;
    globalThis.fetch = async () => { requests += 1; return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "{}" }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } }); };
    const result = await createLiveGateway(getV2ModelRoutes()).generate({ role: "main_analyzer", schemaId: "synthetic", promptVersion: "synthetic", inputHash: "synthetic", deadlineMs: 90_000, parts: [{ text: "synthetic transport only" }], systemInstruction: "return JSON", responseJsonSchema: { type: "object" } });
    assert.equal(requests, 1); assert.equal(result.tokenUsage, undefined);
  } finally { globalThis.fetch = originalFetch; if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; }
});

test("concurrent rechecks cannot spend twenty-first call, duplicate an input, or invoke after another failure", async () => {
  const request = (index: number): V2StructuredModelRequest => ({ role: "main_analyzer", schemaId: "synthetic", promptVersion: "synthetic", inputHash: String(index), deadlineMs: 90_000 });
  let delegates = 0;
  const delegate: V2StructuredModelGateway = { async generate<T>(input: V2StructuredModelRequest) { delegates += 1; return { data: null as T, role: input.role, modelId: "synthetic-model", inputHash: input.inputHash, outputHash: "synthetic", latencyMs: 1 }; } };
  const releases: (() => void)[] = [];
  const barrier = async () => new Promise<void>((resolve) => releases.push(resolve));
  // Reserve 19 successful requests before opening the shared recheck barrier.
  let wait = false;
  const reservations: number[] = [];
  const raced = new OnePassBudgetGateway(delegate, "synthetic-model", async () => { if (wait) await barrier(); }, async () => {}, async (_result, index) => { reservations.push(index); });
  delegates = 0;
  for (let index = 0; index < 19; index += 1) await raced.generate(request(index));
  wait = true;
  const final = [raced.generate(request(19)), raced.generate(request(20))];
  await Promise.resolve(); assert.equal(releases.length, 2); for (const release of releases.splice(0)) release();
  const spent = await Promise.allSettled(final);
  assert.equal(spent.filter((item) => item.status === "fulfilled").length, 1); assert.equal(delegates, 20); assert.equal(raced.calls.length, 20); assert.equal(new Set(reservations).size, 20);
  const duplicate = new OnePassBudgetGateway(delegate, "synthetic-model", barrier, async () => {}, async () => {});
  delegates = 0;
  const same = [duplicate.generate(request(0)), duplicate.generate(request(0))];
  await Promise.resolve(); for (const release of releases.splice(0)) release();
  const deduplicated = await Promise.allSettled(same); assert.equal(deduplicated.filter((item) => item.status === "fulfilled").length, 1); assert.equal(delegates, 1); assert.equal(duplicate.calls.length, 1);
  const failed = new OnePassBudgetGateway({ async generate() { delegates += 1; throw new Error(SECRET); } }, "synthetic-model", barrier, async () => {}, async () => {});
  delegates = 0;
  const failing = failed.generate(request(0)), pending = failed.generate(request(1));
  // Attach rejection handlers before releasing either reservation.
  const settledFailure = failing.catch((error: unknown) => error), settledPending = pending.catch((error: unknown) => error);
  await Promise.resolve(); const first = releases.shift()!, second = releases.shift()!; first(); await settledFailure; second();
  assert.ok(await settledPending instanceof PrivateLiveError); assert.equal(delegates, 1); assert.equal(failed.calls.length, 1);
});

test("approval mutation after the first result blocks any second invocation and leaves a safe private failure receipt", async () => temporary(async (root) => {
  const data = await fixture(root); let calls = 0;
  const gateway = successfulGateway(async () => { calls += 1; await writeFile(data.authorization, JSON.stringify({ ...data.approval, authorized: false })); });
  await assert.rejects(runPrivateLive(data, synthetic(gateway)), failure("PRIVATE_LIVE_AUTHORIZATION_MISMATCH")); assert.equal(calls, 1);
  const receipt = JSON.parse(await readFile(join(data.outputDirectory, "run-failure.json"), "utf8")) as { provider_calls: number; decision: string };
  assert.equal(receipt.provider_calls, 1); assert.equal(receipt.decision, "blocked"); assert.ok(!JSON.stringify(receipt).includes(SECRET));
}));

test("CLI emits fixed safe errors and no private paths/payloads without live authorization", async () => temporary(async (root) => {
  const data = await fixture(root); await writeFile(data.authorization, `malformed ${SECRET}`);
  const run = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tools/v2-eval/private-live/tsconfig.json", "tools/v2-eval/private-live/run.ts", "--live", "--manifest", data.manifest, "--authorization", data.authorization, "--output-directory", data.outputDirectory], { encoding: "utf8" });
  assert.equal(run.status, 1); assert.match(run.stdout, /PRIVATE_LIVE_APPROVAL_REQUIRED/); assert.ok(!`${run.stdout}${run.stderr}`.includes(SECRET)); assert.ok(!run.stdout.includes(root));
}));
