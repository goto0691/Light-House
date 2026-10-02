import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import type { V2StructuredModelGateway } from "@/lib/v2/ai/gateway";
import type { V2ModelRoutes } from "@/lib/v2/ai/model-routing";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { canonical, digest, exactKeys, strings } from "../contracts";
import { PRODUCT_MAPPING_CONTRACT, collectProductObservations, writeProductCollection, type ProductMapping } from "../product-observations";
import { loadPrivateCorpus, runPrivate, writeNewReport } from "../recorded-input";
import { serializeReport } from "../report";
import { PrivateReplaySqlite } from "../private-replay/sqlite";
import { AUTHORIZATION_CONTRACT, assertAuthorization, byteHash, describeLiveTarget, fail, LIVE_CONTRACT, MAX_INPUT_BYTES, privateFile, PrivateLiveError, writePrivateJson } from "./boundary";
import { createLiveGateway, OnePassBudgetGateway } from "./budget";
import { exportLiveProduct } from "./export";

const OWNER = "isolated-private-live-owner";
export type PrivateLiveOptions = { live: boolean; manifest: string; authorization: string; outputDirectory: string };
export type PrivateLiveDependencies = { gatewayFactory?: (routes: V2ModelRoutes) => V2StructuredModelGateway; providerMode?: "synthetic-no-network" };
type CaseState = { case_id: string; capture_id: string; record_id: string; source_item_id: string; source_sha256: string; analysis: string; run_status: string | null; proposal_status: string | null; accepted_property_count: number; proposed_property_count: number; type_assignment_count: number };
/** --live and a separate corpus/build/output/model-bound user authorization are both mandatory. */
export async function runPrivateLive(options: PrivateLiveOptions, dependencies: PrivateLiveDependencies = {}) {
  if (options.live !== true) fail("PRIVATE_LIVE_APPROVAL_REQUIRED");
  if (Boolean(dependencies.gatewayFactory) !== (dependencies.providerMode === "synthetic-no-network")
    || (dependencies.providerMode !== undefined && dependencies.providerMode !== "synthetic-no-network")) fail("PRIVATE_LIVE_ARGUMENTS_INVALID");
  const prepared = await describeLiveTarget(options.manifest, options.outputDirectory);
  const authorizationBytes = await privateFile(prepared.root, resolve(options.authorization), true);
  let authorization: unknown;
  try { authorization = JSON.parse(authorizationBytes.toString("utf8")) as unknown; } catch { return fail("PRIVATE_LIVE_APPROVAL_REQUIRED"); }
  assertAuthorization(authorization, prepared.target);
  if (!prepared.current.sourceClean && dependencies.providerMode !== "synthetic-no-network") fail("PRIVATE_LIVE_SOURCE_NOT_CLEAN");
  // Exclusive mkdir precedes gateway construction: an old run cannot be resumed or silently replaced.
  try { await mkdir(prepared.output, { mode: 0o700 }); } catch { return fail("PRIVATE_LIVE_OUTPUT_INVALID"); }
  const { root, output, sources, target, corpus, current } = prepared;
  await writePrivateJson(resolve(output, "identity.json"), current.identity);
  await writePrivateJson(resolve(output, "authorization.json"), authorization);
  await writePrivateJson(resolve(output, "run-start.json"), { contract: LIVE_CONTRACT, started_at: new Date().toISOString(), target,
    runtime_contains_uncommitted_changes: current.dirty, provider_mode: dependencies.providerMode ?? "live-google-gemini", independent_semantic_review: "required", promotion_eligible: false });
  const responseRoot = resolve(output, "retrieval-responses"), resultRoot = resolve(output, "model-results"), ledgerRoot = resolve(output, "invocation-reservations");
  for (const directory of [responseRoot, resultRoot, ledgerRoot]) await mkdir(directory, { mode: 0o700 });
  const states: CaseState[] = [], db = new PrivateReplaySqlite(OWNER);
  let budget: OnePassBudgetGateway | undefined;
  try {
    const captures = new D1SourceFoundationRepository(db, OWNER), retrieval = new D1RetrievalRepository(db, OWNER), queue = new D1ProcessingQueueRepository(db), governor = new D1AiRuntimeGovernor(db);
    const mapping: ProductMapping = { contract: PRODUCT_MAPPING_CONTRACT, export_id: "pending", owner_id: OWNER, identity: current.identity, corpus_sha256: corpus.corpus_sha256, allowed_privacy: ["normal"], record_ids: [], cases: [] };
    for (const source of sources) {
      const capture = await prepareCaptureCommit({ draftId: `private-live:${source.expected.case_id}`, channel: "import", title: source.title, bodyMarkdown: source.text, aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, `private-live:${source.expected.case_id}`);
      const receipt = await captures.commitCapture(capture), repeated = await captures.commitCapture(capture), document = await captures.getRecord(receipt.recordId);
      if (!document || document.bodyMarkdown !== source.text || document.sources.length !== 1 || document.sources[0].rawText !== source.text
        || byteHash(Buffer.from(document.sources[0].rawText, "utf8")) !== byteHash(source.bytes)
        || receipt.disposition !== "committed" || repeated.disposition !== "replayed" || repeated.recordId !== receipt.recordId) fail("PRIVATE_LIVE_CAPTURE_INVALID");
      states.push({ case_id: source.expected.case_id, capture_id: receipt.captureId, record_id: receipt.recordId, source_item_id: document.sources[0].id, source_sha256: byteHash(source.bytes), analysis: "not_attempted", run_status: null, proposal_status: null, accepted_property_count: 0, proposed_property_count: 0, type_assignment_count: 0 });
      mapping.record_ids.push({ record_id: receipt.recordId, observation_id: source.expected.case_id });
      // Existing collection contract requires explicit approved selectors. No AI proposal is made a reference answer.
      mapping.cases.push({ case_id: source.expected.case_id, document_ids: [receipt.recordId], source_item_ids: [document.sources[0].id] });
    }
    if (await queue.dispatchPending(20) !== 20) fail("PRIVATE_LIVE_CAPTURE_INVALID");
    async function recheck() {
      const latest = await describeLiveTarget(options.manifest, options.outputDirectory, false);
      if (canonical(latest.target) !== canonical(target)) fail("PRIVATE_LIVE_IDENTITY_CHANGED");
      if (!latest.current.sourceClean && dependencies.providerMode !== "synthetic-no-network") fail("PRIVATE_LIVE_SOURCE_NOT_CLEAN");
      if (byteHash(await privateFile(root, resolve(options.authorization), true)) !== byteHash(authorizationBytes)) fail("PRIVATE_LIVE_AUTHORIZATION_MISMATCH");
    }
    await recheck();
    budget = new OnePassBudgetGateway((dependencies.gatewayFactory ?? createLiveGateway)(current.routes), current.routes.main_analyzer, recheck,
      async (call, index) => writePrivateJson(resolve(ledgerRoot, `${String(index).padStart(2, "0")}.json`), { reserved_at: new Date().toISOString(), authorization_sha256: byteHash(authorizationBytes), ...call }),
      async (result, index) => { const contents = `${JSON.stringify(result, null, 2)}\n`; if (Buffer.byteLength(contents) > MAX_INPUT_BYTES) fail("PRIVATE_LIVE_INPUT_INVALID"); await writeFile(resolve(resultRoot, `${String(index).padStart(2, "0")}.json`), contents, { flag: "wx", mode: 0o600 }); });
    for (let index = 0; index < 20; index += 1) {
      const outcome = await runNextAnalysisJob({ queue, gateway: budget, workerId: "private-live-evaluation", governor });
      if ("jobId" in outcome) {
        const job = await db.prepare("select capture_id from v2_processing_jobs where id=? and user_id=?").bind(outcome.jobId, OWNER).first<{ capture_id: string }>();
        const state = states.find((item) => item.capture_id === job?.capture_id); if (!state || state.analysis !== "not_attempted") fail("PRIVATE_LIVE_CAPTURE_INVALID");
        state.analysis = outcome.outcome;
      }
      // A queued retry may remain in the exported product DB, but this invocation never dispatches it again.
      if (outcome.outcome !== "succeeded" || budget.stopped) { budget.stop(); break; }
    }
    for (const state of states) {
      const run = await db.prepare(`select r.status as run_status,p.status as proposal_status from v2_processing_jobs j left join v2_processing_runs r on r.job_id=j.id left join v2_analysis_proposals p on p.run_id=r.id where j.capture_id=? and j.user_id=? and j.stage='analyze' order by r.created_at desc limit 1`).bind(state.capture_id, OWNER).first<{ run_status: string | null; proposal_status: string | null }>();
      state.run_status = run?.run_status ?? null; state.proposal_status = run?.proposal_status ?? null;
      const properties = (await db.prepare("select review_status,count(*) as value from v2_property_values where owner_object_id=? and user_id=? group by review_status").bind(state.record_id, OWNER).all<{ review_status: string; value: number }>()).results;
      state.accepted_property_count = properties.find((item) => item.review_status === "accepted")?.value ?? 0;
      state.proposed_property_count = properties.filter((item) => item.review_status !== "accepted").reduce((total, item) => total + item.value, 0);
      state.type_assignment_count = (await db.prepare("select count(*) as value from v2_object_type_assignments where object_id=? and user_id=?").bind(state.record_id, OWNER).first<{ value: number }>())?.value ?? 0;
      const source = sources.find((item) => item.expected.case_id === state.case_id)!, document = await captures.getRecord(state.record_id);
      if (!document || document.bodyMarkdown !== source.text || document.sources[0]?.rawText !== source.text || byteHash(document.sources[0].rawText) !== state.source_sha256) fail("PRIVATE_LIVE_CAPTURE_INVALID");
    }
    for (const source of sources) {
      const entry = mapping.cases.find((item) => item.case_id === source.expected.case_id)!;
      const queries = source.expected.recall_queries.filter((query) => exactKeys(query, ["id", "query", "required_ids", "top_k"]) && typeof query.id === "string" && typeof query.query === "string" && Boolean(query.query) && strings(query.required_ids, false) && query.top_k === 10);
      if (!queries.length) continue;
      entry.recall_queries = [];
      for (const [index, query] of queries.entries()) {
        const plan = defaultV2QueryPlan({ fullText: query.query as string, limit: 20 }), page = await retrieval.searchPage(plan, false, 1), path = resolve(responseRoot, `${source.expected.case_id}-${index + 1}.json`);
        const contents = `${JSON.stringify({ contractVersion: "retrieval-results-v1", plan, ...page }, null, 2)}\n`; await writeFile(path, contents, { flag: "wx", mode: 0o600 });
        entry.recall_queries.push({ id: query.id as string, response_path: relative(root, path).split(sep).join("/"), response_sha256: byteHash(contents), plan_sha256: digest(plan) });
      }
    }
    const product = await exportLiveProduct(db, OWNER, output); mapping.export_id = product.exportId;
    const mappingPath = resolve(output, "product-mapping.json"), identityPath = resolve(output, "identity.json"), observationsPath = resolve(output, "product-observations.json");
    await writePrivateJson(mappingPath, mapping);
    const collected = await collectProductObservations({ manifest: options.manifest, identity: identityPath, mapping: mappingPath, exportRoot: product.exportRoot });
    await writeProductCollection(options.manifest, observationsPath, resolve(output, "product-collection-receipt.json"), collected);
    const report = await runPrivate(options.manifest, identityPath, observationsPath); await recheck();
    const finalCorpus = await loadPrivateCorpus(options.manifest); if (finalCorpus.corpus_sha256 !== corpus.corpus_sha256) fail("PRIVATE_LIVE_SOURCE_CHANGED");
    await writeNewReport(resolve(output, "recorded-report.json"), serializeReport(report));
    const allSucceeded = states.every((state) => state.analysis === "succeeded" && state.run_status === "succeeded" && state.proposal_status === "validated");
    const calls = budget.calls, tokenUsageKnown = calls.length > 0 && calls.every((call) => call.input_tokens !== null && call.output_tokens !== null);
    const pendingGrounding = (await db.prepare("select count(*) as value from v2_processing_jobs where stage='grounded_enrich' and user_id=?").bind(OWNER).first<{ value: number }>())?.value ?? 0;
    const receipt = { contract: LIVE_CONTRACT, executed_at: new Date().toISOString(), authorization_contract: AUTHORIZATION_CONTRACT, authorization_sha256: byteHash(authorizationBytes), target,
      identity: current.identity, runtime_contains_uncommitted_changes: current.dirty, build_identity_is_current_git_head: true,
      environment: "isolated-memory-sqlite-and-memory-r2-binding", foreign_keys_enabled: true, privacy_projection: "normal-in-isolated-new-account",
      provider_mode: dependencies.providerMode ?? "live-google-gemini", provider_calls: calls.length, max_provider_calls: 20, max_calls_per_input: 1, automatic_retry: false, model_fallback: false,
      live_provider_verified: !dependencies.providerMode && calls.some((call) => call.status === "succeeded"), all_model_analyses_succeeded: allSucceeded,
      actual_provider_model_revision: "unknown-not-exposed-by-production-gateway", independent_semantic_review: "required", semantic_rubric: "unknown-review-required",
      analysis_quality: allSucceeded ? "unknown-independent-review-required" : "unknown-incomplete-or-provider-blocked",
      primary_type_quality: "unknown-no-approved-primary-selector", typed_value_quality: "unknown-no-approved-typed-selectors",
      automatic_candidate_promotion: false, promotion_eligible: false, decision: "blocked", recorded_subset_decision: report.promotion.decision,
      api_authentication_executed: false, worker_runtime_verified: false, remote_database_called: false, external_enrichment_called: false, queued_grounding_not_invoked: pendingGrounding,
      token_usage_complete: tokenUsageKnown, observed_input_tokens: calls.reduce((total, call) => total + (call.input_tokens ?? 0), 0), observed_output_tokens: calls.reduce((total, call) => total + (call.output_tokens ?? 0), 0),
      monetary_cost: "unknown-no-price-or-billing-observation", provider_latency_ms: calls.reduce((total, call) => total + call.latency_ms, 0),
      export_advances: product.advances, zip_sha256: product.zipSha256, zip_bytes: product.zipBytes, observations_sha256: collected.receipt.observations_sha256,
      readiness: corpus.readiness, source_hash_equality: report.aggregate.metrics.source_hash_equality, ranked_id_top1: report.aggregate.metrics.ranked_id_top1, ranked_id_top10: report.aggregate.metrics.ranked_id_top10,
      analysis_succeeded: states.filter((state) => state.analysis === "succeeded").length, analysis_not_attempted: states.filter((state) => state.analysis === "not_attempted").length, calls, cases: states };
    await writePrivateJson(resolve(output, "live-receipt.json"), receipt);
    return { receipt, observations: collected.observations, report };
  } catch (error) {
    const code = error instanceof PrivateLiveError ? error.code : "PRIVATE_LIVE_INTERNAL_ERROR";
    await writePrivateJson(resolve(output, "run-failure.json"), { contract: LIVE_CONTRACT, code, provider_calls: budget?.calls.length ?? 0, calls: budget?.calls ?? [], decision: "blocked", promotion_eligible: false });
    throw error;
  } finally { db.close(); }
}
