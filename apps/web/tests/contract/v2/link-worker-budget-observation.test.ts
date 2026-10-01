import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), bindings: vi.fn(), gateways: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: harness.session }));
vi.mock("@/lib/v2/auth/restricted-grant", () => ({ getActiveRestrictedGrant: harness.grant }));
vi.mock("@/lib/v2/infrastructure/cloudflare/runtime-bindings", () => ({ getV2CloudflareBindings: harness.bindings, getV2ArchiveAssetsBucket: () => undefined }));
vi.mock("@/lib/v2/ai/gemini-role-gateways", () => ({ createGeminiRoleGateways: harness.gateways }));

import { POST as analyze } from "@/app/api/v2/records/[recordId]/links/analyze/route";
import { POST as processJobs } from "@/app/api/v2/processing/run/route";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { LinkSqlite, seedLinkRecord, exactLinkGateway } from "../../support/link-sqlite";

/** Count calls at the D1 binding boundary, not each SQL statement as an RPC.
 * SQLite execution, mocked auth and a synthetic provider are not a deployed
 * Worker qualification or a measurement of CPU/network/subrequest accounting.
 */
class CountedD1 implements D1DatabaseBinding {
  counts = { first: 0, all: 0, run: 0, batch: 0, batchStatements: 0 };
  private readonly originals = new WeakMap<D1PreparedStatementBinding, D1PreparedStatementBinding>();
  constructor(private readonly inner: D1DatabaseBinding) {}
  prepare(query: string) {
    let actual = this.inner.prepare(query);
    const wrapped: D1PreparedStatementBinding = {
      bind: (...values) => { actual = actual.bind(...values); this.originals.set(wrapped, actual); return wrapped; },
      first: async <T>() => { this.counts.first += 1; return actual.first<T>(); },
      all: async <T>() => { this.counts.all += 1; return actual.all<T>(); },
      run: async () => { this.counts.run += 1; return actual.run(); },
    };
    this.originals.set(wrapped, actual);
    return wrapped;
  }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.counts.batch += 1;
    this.counts.batchStatements += statements.length;
    return this.inner.batch<T>(statements.map((statement) => this.originals.get(statement) ?? statement));
  }
  reset() { this.counts = { first: 0, all: 0, run: 0, batch: 0, batchStatements: 0 }; }
  report() {
    const { first, all, run, batch, batchStatements } = this.counts;
    return { ...this.counts, bindingCalls: first + all + run + batch, sqlStatements: first + all + run + batchStatements };
  }
}

let db: LinkSqlite;
let counted: CountedD1;
let provider: ReturnType<typeof exactLinkGateway>;
beforeEach(() => {
  db = new LinkSqlite(); counted = new CountedD1(db); provider = exactLinkGateway();
  vi.stubEnv("FLAG_V2_ROUTES", "1"); vi.stubEnv("FLAG_V2_WRITE", "1"); vi.stubEnv("FLAG_V2_AI", "1");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-not-a-key"); vi.stubEnv("CRON_SECRET", "synthetic-budget-secret");
  harness.session.mockResolvedValue({ sessionId: "budget-session", userId: "link-owner", email: "owner@example.test", expiresAt: Date.now() + 60_000 });
  harness.grant.mockResolvedValue(null); harness.bindings.mockReturnValue({ db: counted });
  harness.gateways.mockReturnValue({ mainAnalyzer: provider, groundedResearch: provider });
});
afterEach(() => { db.sql.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function enqueue(fixture: Awaited<ReturnType<typeof seedLinkRecord>>, key: string) {
  return analyze(new Request(`https://lighthouse.test/api/v2/records/${fixture.capture.objectId}/links/analyze`, {
    method: "POST", headers: { Origin: "https://lighthouse.test", "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevisionId: fixture.capture.revisionId, expectedSnapshotId: fixture.projection!.snapshot.id,
      expectedManifestHash: fixture.projection!.snapshot.manifestHash, idempotencyKey: key }),
  }), { params: Promise.resolve({ recordId: fixture.capture.objectId }) });
}

test("observes enqueue/replay and one queued link invocation with the other stages idle", async () => {
  const fixture = await seedLinkRecord(db);
  expect((await enqueue(fixture, "budget-one")).status).toBe(202);
  const enqueueCounts = counted.report(); counted.reset();
  expect((await enqueue(fixture, "budget-one")).status).toBe(202);
  const replayCounts = counted.report(); counted.reset();
  const response = await processJobs(new Request("https://lighthouse.test/api/v2/processing/run", { method: "POST", headers: { authorization: "Bearer synthetic-budget-secret" } }));
  expect(response.status).toBe(200); expect(provider.calls).toHaveLength(1);
  const runnerCounts = counted.report();
  console.info("LINK_BINDING_OBSERVATION", JSON.stringify({ fixture: "one-text-source-one-link-job", excludes: ["real auth/grant", "provider transport", "Worker CPU/network limits"], enqueue: enqueueCounts, replay: replayCounts, runner: runnerCounts }));
  expect(enqueueCounts.batch).toBe(1); expect(replayCounts.batch).toBe(0);
  expect(runnerCounts.bindingCalls).toBeGreaterThan(0);
});

test("observes the shared three-job invocation budget without treating batched SQL as separate RPCs", async () => {
  for (let index = 0; index < 3; index += 1) expect((await enqueue(await seedLinkRecord(db), `budget-three-${index}`)).status).toBe(202);
  counted.reset();
  const response = await processJobs(new Request("https://lighthouse.test/api/v2/processing/run", { method: "POST", headers: { authorization: "Bearer synthetic-budget-secret" } }));
  expect(response.status).toBe(200); expect(provider.calls).toHaveLength(3);
  console.info("LINK_BINDING_OBSERVATION", JSON.stringify({ fixture: "three-text-source-link-jobs", excludes: ["real auth/grant", "provider transport", "Worker CPU/network limits"], runner: counted.report() }));
  expect(counted.report().sqlStatements).toBeGreaterThan(counted.report().bindingCalls);
});

test("separates an isolated link job from HTTP idle-stage probing", async () => {
  const fixture = await seedLinkRecord(db);
  expect((await enqueue(fixture, "isolated-runner")).status).toBe(202); counted.reset();
  const outcome = await runNextLinkAnalysisJob({ queue: new D1ProcessingQueueRepository(counted), links: new D1LinkAnalysisRepository(counted),
    governor: new D1AiRuntimeGovernor(counted), gateway: provider, workerId: "isolated-observation" });
  expect(outcome.outcome).toBe("succeeded"); expect(provider.calls).toHaveLength(1);
  console.info("LINK_BINDING_OBSERVATION", JSON.stringify({ fixture: "direct-one-link-job", runner: counted.report() }));
});

test("observes an entirely idle HTTP runner without any provider invocation", async () => {
  const response = await processJobs(new Request("https://lighthouse.test/api/v2/processing/run", { method: "POST", headers: { authorization: "Bearer synthetic-budget-secret" } }));
  expect(response.status).toBe(200); expect(provider.calls).toHaveLength(0);
  console.info("LINK_BINDING_OBSERVATION", JSON.stringify({ fixture: "idle-http-runner", runner: counted.report() }));
});
