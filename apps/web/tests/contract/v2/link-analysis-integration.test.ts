import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { type V2StructuredModelGateway, type V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { LINK_ANALYSIS_CONTRACT } from "@/lib/v2/ai/link-analysis-v1";
import { runNextLinkAnalysisJob } from "@/lib/v2/ai/link-processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { prepareDocumentRevision } from "@/lib/v2/domain/document-revision";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1AiRuntimeGovernor } from "@/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1DocumentAuthoringRepository } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1LinkAnalysisRepository } from "@/lib/v2/infrastructure/d1/link-analysis-repository";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

// Fast orchestration integration, not a substitute for the separate real local
// Wrangler/D1 migration, ownership and transaction tests.
class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { return (this.statement.get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.statement.all(...this.values) as T[] }; }
  async run() { return this.statement.run(...this.values); }
}
class MemoryD1 implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  constructor(version = 31) {
    this.sql.exec("pragma foreign_keys=on; create table users(id text primary key); insert into users values ('integration-owner');");
    const directory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
    for (const name of readdirSync(directory).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= version).sort()) this.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
  }
  prepare(query: string) { return new Statement(this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.sql.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sql.exec("commit");
      return results as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}
let db: MemoryD1;
beforeEach(() => { db = new MemoryD1(); });
afterEach(() => { db.sql.close(); });
const rawText = "Intro\r\n  exact prompt 👀\r\n--ar 3:2\n";

async function seed(withEmptySource = false) {
  const sources = await Promise.all((withEmptySource ? [rawText, ""] : [rawText]).map(async (text, i) => ({ kind: "url" as const, rawText: text, contentHash: `sha256:${await linkSha256Hex(text)}`, metadata: makeManualLinkMetadata({ url: `https://example.test/source/${i}`, purpose: "prompt" }) })));
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Link integration", bodyMarkdown: "PRIVATE MEMO MUST NOT REACH LINK MODEL", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(), sources }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "integration-owner").commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, "integration-owner");
  const projection = await snapshots.bootstrapManualSources({ documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID() });
  const links = new D1LinkAnalysisRepository(db);
  const enqueued = await links.enqueue("integration-owner", { documentId: capture.objectId, expectedRevisionId: capture.revisionId, expectedSnapshotId: projection.snapshot.id, expectedManifestHash: projection.snapshot.manifestHash });
  return { capture, snapshots, projection, links, enqueued, queue: new D1ProcessingQueueRepository(db), governor: new D1AiRuntimeGovernor(db) };
}
function gateway(beforeResponse?: () => Promise<void>, invalid = false) {
  const calls: V2StructuredModelRequest[] = [];
  const value: V2StructuredModelGateway = { async generate<T>(request: V2StructuredModelRequest) {
    calls.push(request);
    const payload = JSON.parse((request.parts?.[0] as { text: string }).text);
    await beforeResponse?.();
    return new FakeV2StructuredModelGateway("success", {
      contract_version: LINK_ANALYSIS_CONTRACT, snapshot_id: payload.snapshot_id, analyzed_revision_id: payload.analyzed_revision_id,
      manifest_hash: payload.manifest_hash, manifest_version: payload.manifest_version,
      fragments: [{ fragment_key: "p1", role: "prompt", selection: { member_key: payload.sources[0].member_key, first_block: 1, last_block: 2 }, ...(invalid ? { rawText: "fake rewritten prompt" } : {}) }],
      interpretations: [],
    }).generate<T>(request);
  } };
  return { ...value, calls };
}

describe("link runner with actual SQL repositories and runtime governor", () => {
  test("executes capture→snapshot→explicit queue→governor→exact proposed fragment without personal reconciliation", async () => {
    const fixture = await seed();
    const provider = gateway();
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: provider, workerId: "integration" })).toMatchObject({ outcome: "succeeded" });
    expect(provider.calls).toHaveLength(1);
    expect(JSON.stringify(provider.calls)).not.toContain("PRIVATE MEMO");
    expect(db.sql.prepare("select raw_text,source_class,review_status from v2_link_fragments").get()).toEqual({ raw_text: "  exact prompt 👀\r\n--ar 3:2\n", source_class: "source_extract", review_status: "proposed" });
    expect(db.sql.prepare("select count(*) n from v2_property_values").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select state,probe_owner from v2_ai_runtime_state").get()).toEqual({ state: "healthy", probe_owner: null });
    expect(db.sql.prepare("select count(*) n from v2_provider_invocation_leases").get()).toEqual({ n: 0 });
  });

  test("actual governor prevents a second provider call while quota is paused", async () => {
    const fixture = await seed();
    const provider = new FakeV2StructuredModelGateway("quota_exhausted");
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: provider, workerId: "quota" })).toMatchObject({ outcome: "retry_wait" });
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: provider, workerId: "paused" })).toMatchObject({ outcome: "paused", state: "quota_exhausted" });
    expect(provider.calls).toHaveLength(1);
    // A quota rejection waits for the quota window without consuming one of the job's attempts.
    expect(db.sql.prepare("select status,attempt from v2_processing_jobs where id=?").get(fixture.enqueued.jobId)).toEqual({ status: "retry_wait", attempt: 0 });
    expect(db.sql.prepare("select count(*) n from v2_link_fragments").get()).toEqual({ n: 0 });
    expect((await fixture.snapshots.getCurrent(fixture.capture.objectId))?.members[0].rawText).toBe(rawText);
  });

  test("real document edit during model call retains late output only as history", async () => {
    const fixture = await seed();
    const provider = gateway(async () => {
      const revision = await prepareDocumentRevision({ expectedVersion: 1, expectedRevisionId: fixture.capture.revisionId, title: "Edited memo", bodyMarkdown: "새로 쓴 내 메모", writtenAt: null, documentStatus: "draft", privacyLevel: "normal" }, crypto.randomUUID());
      expect(await new D1DocumentAuthoringRepository(db, "integration-owner").saveRevision(fixture.capture.objectId, revision)).toMatchObject({ outcome: "saved" });
    });
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: provider, workerId: "edit-race" })).toMatchObject({ outcome: "stale" });
    expect(db.sql.prepare("select body_markdown,published_link_run_id from v2_documents where object_id=?").get(fixture.capture.objectId)).toEqual({ body_markdown: "새로 쓴 내 메모", published_link_run_id: null });
    expect(db.sql.prepare("select review_status from v2_link_fragments").get()).toEqual({ review_status: "superseded" });
    expect(db.sql.prepare("select status from v2_processing_runs").get()).toEqual({ status: "stale" });
  });

  test("new source snapshot during model call is not replaced by the old result", async () => {
    const fixture = await seed();
    let newSnapshot = "";
    const provider = gateway(async () => {
      newSnapshot = (await fixture.snapshots.createSnapshot({ documentId: fixture.capture.objectId, expectedRevisionId: fixture.capture.revisionId, expectedSnapshotId: fixture.projection.snapshot.id, expectedSnapshotVersion: 1,
        sourceItemIds: fixture.projection.members.map((source) => source.sourceItemId), newManualSources: [{ rawText: "new source", metadata: makeManualLinkMetadata({ url: "https://example.test/new" }) }], idempotencyKey: crypto.randomUUID() })).snapshot.id;
    });
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: provider, workerId: "snapshot-race" })).toMatchObject({ outcome: "stale" });
    expect(db.sql.prepare("select current_link_snapshot_id,published_link_run_id from v2_documents").get()).toEqual({ current_link_snapshot_id: newSnapshot, published_link_run_id: null });
  });

  test("malformed rewritten output never creates derived or personal data", async () => {
    const fixture = await seed();
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: gateway(undefined, true), workerId: "invalid" })).toMatchObject({ outcome: "needs_review" });
    expect(db.sql.prepare("select count(*) n from v2_link_fragments").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select count(*) n from v2_property_values").get()).toEqual({ n: 0 });
    expect(db.sql.prepare("select status,validation_error_code from v2_processing_runs").get()).toEqual({ status: "failed", validation_error_code: "invalid_schema" });
  });

  test("URL-only member keeps run partial even when all available text was analyzed", async () => {
    const fixture = await seed(true);
    expect(await runNextLinkAnalysisJob({ ...fixture, gateway: gateway(), workerId: "partial" })).toMatchObject({ outcome: "succeeded" });
    expect(db.sql.prepare("select status from v2_processing_runs").get()).toEqual({ status: "partial" });
    expect(db.sql.prepare("select processing_status from v2_capture_bundles").get()).toEqual({ processing_status: "needs_review" });
  });

  test("pre-0031 schema remains idle without attempting a provider call", async () => {
    const previous = new MemoryD1(30);
    try {
      const provider = gateway();
      expect(await runNextLinkAnalysisJob({ queue: new D1ProcessingQueueRepository(previous), links: new D1LinkAnalysisRepository(previous), governor: new D1AiRuntimeGovernor(previous), gateway: provider, workerId: "old-schema" })).toEqual({ outcome: "idle" });
      expect(provider.calls).toHaveLength(0);
      expect(previous.sql.prepare("select probe_owner from v2_ai_runtime_state").get()).toEqual({ probe_owner: null });
    } finally { previous.sql.close(); }
  });
});
