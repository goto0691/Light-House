import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";

import { createGeminiRoleGateways, GeminiProviderError } from "../src/lib/v2/ai/gemini-role-gateways";
import { analyzeYouTubeVideo } from "../src/lib/v2/collect/youtube-video-analysis";
import { prepareCaptureCommit } from "../src/lib/v2/domain/capture-source";
import { linkSha256Hex } from "../src/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "../src/lib/v2/domain/manual-link-source";
import { D1AiRuntimeGovernor } from "../src/lib/v2/infrastructure/d1/ai-runtime-governor";
import { D1LinkPresentationRepository } from "../src/lib/v2/infrastructure/d1/link-presentation-repository";
import { D1LinkSnapshotRepository } from "../src/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1RetrievalRepository } from "../src/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "../src/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "../src/lib/v2/infrastructure/d1/source-commit-repository";
import { queryPlanFromSearchParams } from "../src/lib/v2/retrieval/search-params";

// Explicit invocation only. One provider call: the first public YouTube video
// ("Me at the zoo", 19 seconds). No personal data, memo or credentials are sent.
if (process.argv.slice(2).join(" ") !== "--live") {
  console.error("Use --live. No provider request was sent.");
  process.exit(2);
}
const USER_ID = "s4-synthetic-owner";
const VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const MEMO = "PRIVATE SYNTHETIC MEMO: never sent to the provider";

class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly sql: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { return (this.sql.get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.sql.all(...this.values) as T[] }; }
  async run() { return this.sql.run(...this.values); }
}
class MemoryD1 implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  prepare(query: string) { return new Statement(this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.sql.exec("begin immediate");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sql.exec("commit");
      return result as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}

async function main() {
  loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), true);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("gemini_key_missing");
  const db = new MemoryD1();
  db.sql.exec(`pragma foreign_keys=on; create table users(id text primary key); insert into users values ('${USER_ID}');`);
  const directory = fileURLToPath(new URL("../../../migrations/", import.meta.url));
  for (const name of readdirSync(directory).filter((item) => /^\d{4}_.*\.sql$/.test(item) && Number(item.slice(0, 4)) >= 6).sort()) db.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));

  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "합성 영상 검증", bodyMarkdown: MEMO,
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(),
    sources: [{ kind: "url", rawText: "", contentHash: `sha256:${await linkSha256Hex("")}`, metadata: makeManualLinkMetadata({ url: VIDEO_URL, purpose: "video_note" }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, USER_ID).commitCapture(capture);
  const source = db.sql.prepare("select id from v2_source_items where capture_id=? and item_kind='url'").get(capture.captureId) as { id: string };
  const snapshots = new D1LinkSnapshotRepository(db, USER_ID);
  const request = { documentId: capture.objectId, sourceItemId: source.id, expectedRevisionId: capture.revisionId, expectedSnapshotId: null,
    expectedSnapshotVersion: 0, startSeconds: 0, endSeconds: 30, idempotencyKey: "s4-live" };
  const candidate = await snapshots.videoAnalysisCandidate(request);

  let calls = 0, providerFailure: { status: number | null; category: string } | null = null;
  const real = createGeminiRoleGateways(apiKey).mainAnalyzer;
  const outcome = await analyzeYouTubeVideo({
    governor: new D1AiRuntimeGovernor(db), workerId: "s4-live",
    video: { videoId: candidate.videoId, videoUrl: candidate.videoUrl, range: candidate.range, purpose: candidate.purpose },
    gateway: { async generate(input) {
      if (calls >= 1) throw new Error("Synthetic provider call budget exhausted.");
      calls += 1;
      if (JSON.stringify(input).includes("PRIVATE SYNTHETIC MEMO")) throw new Error("memo_would_leak");
      try { return await real.generate(input); }
      catch (error) { if (error instanceof GeminiProviderError) providerFailure = { status: error.status, category: error.category }; throw error; }
    } },
  });
  const summary: Record<string, unknown> = { scope: "isolated-node-sqlite; production video adapter and snapshot repository; actual Gemini main role",
    model: process.env.GEMINI_MAIN_MODEL ?? "default", providerCalls: calls, outcome: outcome.status, rejection: outcome.status === "rejected" ? outcome.code : null, providerFailure };
  if (outcome.status === "analyzed") {
    const receipt = await snapshots.createVideoAnalysisSnapshot(request, { result: outcome.result, modelId: outcome.modelId });
    const links = await new D1LinkPresentationRepository(db, USER_ID).project(capture.objectId, { writeEnabled: true, aiEnabled: true });
    const note = links?.members.find((member) => member.videoAnalysis)?.videoAnalysis ?? null;
    const record = await new D1SourceFoundationRepository(db, USER_ID).getRecord(capture.objectId);
    const word = note?.segments[0]?.title.split(/\s+/).find((token) => token.length >= 2) ?? null;
    const search = word ? await new D1RetrievalRepository(db, USER_ID).searchPage(queryPlanFromSearchParams(new URLSearchParams({ q: word }))) : null;
    Object.assign(summary, {
      snapshot: { acquisitionMethod: receipt.snapshot.acquisitionMethod, captureState: receipt.snapshot.captureState },
      latencyMs: outcome.latencyMs, timecodeBasis: note?.timecodeBasis ?? null, observedEndSeconds: note?.observedEndSeconds ?? null,
      counts: { segments: note?.segments.length ?? 0, speech: note?.speech.length ?? 0, screenText: note?.screenText.length ?? 0, limitations: note?.limitations.length ?? 0 },
      allTimesInRange: note ? [...note.segments, ...note.speech, ...note.screenText].every((item) => item.startSeconds >= 0 && item.endSeconds <= 30) : false,
      recordShowsNote: Boolean(record?.sources.some((item) => item.videoAnalysis)), memoPreserved: record?.bodyMarkdown === MEMO,
      searchByNoteWordFound: search ? search.results.some((result) => result.recordId === capture.objectId) : null,
      // Printed for human quality review: the model's own words about a public video, no personal data.
      note: note ? { summary: note.summary, segments: note.segments, speech: note.speech.slice(0, 5), limitations: note.limitations } : null,
    });
  }
  console.log(JSON.stringify(summary, null, 2));
  if (outcome.status !== "analyzed" || !summary.allTimesInRange || !summary.recordShowsNote || !summary.memoPreserved) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ scope: "s4-live-youtube", errorClass: error instanceof Error ? error.name : "unknown", message: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : null, failed: true }));
  process.exitCode = 1;
});
