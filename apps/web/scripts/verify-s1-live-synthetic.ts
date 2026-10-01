import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import sharp from "sharp";

import { createGeminiRoleGateways, GeminiProviderError, type GeminiProviderFailureCategory, type GeminiProviderReason } from "../src/lib/v2/ai/gemini-role-gateways";
import { runNextAnalysisJob } from "../src/lib/v2/ai/processing-runner";
import type { V2StructuredModelGateway } from "../src/lib/v2/ai/gateway";
import { prepareCaptureCommit } from "../src/lib/v2/domain/capture-source";
import { D1PresentationRepository } from "../src/lib/v2/infrastructure/d1/presentation-repository";
import { D1ProcessingQueueRepository } from "../src/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1RetrievalRepository } from "../src/lib/v2/infrastructure/d1/retrieval-repository";
import { D1ReviewRepository } from "../src/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "../src/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "../src/lib/v2/infrastructure/d1/source-commit-repository";
import type { R2BucketBinding, R2ObjectBodyBinding } from "../src/lib/v2/infrastructure/r2/attachment-object-repository";
import { queryPlanFromSearchParams } from "../src/lib/v2/retrieval/search-params";

// Explicit invocation only; text-only mode respects a single remaining live call.
const args = process.argv.slice(2);
const textOnly = args.length === 2 && args[0] === "--live" && args[1] === "--text-only";
if (!(args.length === 1 && args[0] === "--live") && !textOnly) {
  console.error("Use --live or --live --text-only. No provider request was sent.");
  process.exit(2);
}
const maxProviderCalls = textOnly ? 1 : 2;

const USER_ID = "s1-synthetic-owner";
const TEXT = "합성 검증 글: 파란 종이비행기를 만들었다. 별점 4.5/5.";
const TEXT_QUERY = "종이비행기";
const IMAGE_QUERY = "ORBIT";

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
  close() { this.sql.close(); }
}

function createLocalDatabase() {
  const db = new MemoryD1();
  try {
    db.sql.exec(`pragma foreign_keys=on; create table users(id text primary key); insert into users values ('${USER_ID}');`);
    const directory = fileURLToPath(new URL("../../../migrations/", import.meta.url));
    const migrations = readdirSync(directory).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6).sort();
    for (const name of migrations) db.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
    return db;
  } catch (error) { db.close(); throw error; }
}

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

function localImageBucket(bytes: Buffer, reservationId: string, key: string): R2BucketBinding {
  const object = () => ({
    key, size: bytes.byteLength, httpMetadata: { contentType: "image/png" },
    customMetadata: { reservationId, userId: USER_ID }, checksums: {},
  });
  const body = (): R2ObjectBodyBinding => ({
    ...object(), body: new Blob([Uint8Array.from(bytes)]).stream(),
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  });
  return {
    async head(requested) { return requested === key ? object() : null; },
    async get(requested) { return requested === key ? body() : null; },
    async put() { throw new Error("Synthetic R2 fixture is read-only."); },
    async delete() { throw new Error("Synthetic R2 fixture is read-only."); },
  };
}

async function createSyntheticImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360"><rect width="1200" height="360" fill="white"/><text x="45" y="115" font-family="Arial" font-size="60" fill="black">SYNTHETIC IMAGE</text><text x="45" y="235" font-family="Arial" font-size="74" fill="black">ORBIT RATING 4.5 / 5</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

type Capture = Awaited<ReturnType<typeof prepareCaptureCommit>>;

async function seedText(db: MemoryD1): Promise<Capture> {
  const capture = await prepareCaptureCommit({
    draftId: crypto.randomUUID(), channel: "web", title: "합성 글 검증", bodyMarkdown: TEXT,
    aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString(),
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, USER_ID).commitCapture(capture);
  return capture;
}

async function seedImage(db: MemoryD1) {
  const bytes = await createSyntheticImage();
  const hash = sha256(bytes);
  const reservationId = `synthetic-${crypto.randomUUID()}`;
  const key = `users/${USER_ID}/originals/synthetic/${reservationId}`;
  const now = new Date();
  await db.prepare(`insert into v2_attachment_reservations
    (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at)
    values (?,?,'verified',?,?,?,?,?,?,?)`).bind(
    reservationId, USER_ID, key, "synthetic.png", "image/png", bytes.byteLength, hash,
    now.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString(),
  ).run();
  const capture = await prepareCaptureCommit({
    draftId: crypto.randomUUID(), channel: "web", title: "합성 이미지 검증", bodyMarkdown: "",
    aiEnabled: true, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now.toISOString(),
    sources: [{ kind: "image", contentHash: hash, attachmentId: reservationId }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, USER_ID).commitCapture(capture);
  return { capture, bucket: localImageBucket(bytes, reservationId, key), hash };
}

function budgetedGateway(delegate: V2StructuredModelGateway) {
  let total = 0;
  let providerFailure: { status: number | null; category: GeminiProviderFailureCategory; reason: GeminiProviderReason | null } | null = null;
  const byInput = new Map<string, number>();
  const gateway: V2StructuredModelGateway = {
    async generate<T>(request: Parameters<V2StructuredModelGateway["generate"]>[0]) {
      if (total >= maxProviderCalls || (byInput.get(request.inputHash) ?? 0) >= 1) throw new Error("Synthetic provider call budget exhausted.");
      total += 1;
      byInput.set(request.inputHash, 1);
      try { return await delegate.generate<T>(request); }
      catch (error) {
        if (error instanceof GeminiProviderError) providerFailure = { status: error.status, category: error.category, reason: error.providerReason };
        throw error;
      }
    },
  };
  return { gateway, count: () => total, failure: () => providerFailure };
}

async function summarize(db: MemoryD1, capture: Capture, label: "text" | "image", query: string, outcome: string, originalHash?: string) {
  const record = await new D1SourceFoundationRepository(db, USER_ID).getRecord(capture.objectId);
  const presentation = await new D1PresentationRepository(db, USER_ID).project(capture.objectId);
  const review = (await new D1ReviewRepository(db, USER_ID).listOpenRecords()).find((row) => row.recordId === capture.objectId);
  const search = await new D1RetrievalRepository(db, USER_ID).searchPage(queryPlanFromSearchParams(new URLSearchParams({ q: query })));
  const run = await db.prepare(`select r.status,r.validation_error_code,p.status as proposal_status
    from v2_processing_jobs j left join v2_processing_runs r on r.job_id=j.id
    left join v2_analysis_proposals p on p.job_id=j.id
    where j.capture_id=? and j.stage='analyze' order by r.created_at desc limit 1`).bind(capture.captureId)
    .first<{ status: string | null; validation_error_code: string | null; proposal_status: string | null }>();
  const storedFields = await db.prepare(`select count(*) as value from v2_property_values where owner_object_id=? and user_id=?`)
    .bind(capture.objectId, USER_ID).first<{ value: number }>();
  const evidence = await db.prepare(`select count(*) as value from v2_evidence_refs e join v2_property_values p on p.id=e.target_id
    where e.target_kind='property_value' and p.owner_object_id=? and p.user_id=?`).bind(capture.objectId, USER_ID).first<{ value: number }>();
  const processing = await db.prepare(`select processing_status from v2_capture_bundles where id=? and user_id=?`)
    .bind(capture.captureId, USER_ID).first<{ processing_status: string }>();
  const grounding = await db.prepare(`select count(*) as value from v2_processing_jobs where capture_id=? and stage='grounded_enrich'`)
    .bind(capture.captureId).first<{ value: number }>();
  const derived = record?.sources.filter((source) => source.analysisExtraction) ?? [];
  // Synthetic inputs only: show which text each stored evidence span covers.
  const spans = (await db.prepare(`select e.source_item_id,e.locator_json from v2_evidence_refs e join v2_property_values p on p.id=e.target_id
    where e.target_kind='property_value' and e.locator_kind='text_span' and p.owner_object_id=? and p.user_id=?`).bind(capture.objectId, USER_ID)
    .all<{ source_item_id: string; locator_json: string }>()).results;
  const evidenceText = spans.slice(0, 4).map((span) => {
    const text = record?.sources.find((source) => source.id === span.source_item_id)?.rawText ?? null;
    const locator = JSON.parse(span.locator_json) as { start?: number; end?: number };
    return text !== null && typeof locator.start === "number" && typeof locator.end === "number" ? text.slice(locator.start, locator.end) : null;
  });
  const imageSourcePreserved = label === "image" && record?.sources.some((source) =>
    source.kind === "image" && source.rawText === null && source.contentHash.replace(/^sha256:/, "") === originalHash);
  const originalPreserved = label === "text" ? record?.bodyMarkdown === TEXT : imageSourcePreserved;
  return {
    input: label, outcome, runStatus: run?.status ?? null, validationErrorCode: run?.validation_error_code ?? null,
    proposalStatus: run?.proposal_status ?? null, originalPreserved: Boolean(originalPreserved),
    recordReadable: Boolean(record && !record.locked), recordPresentationReady: presentation.contractVersion === "record-presentation-v1",
    storedFieldCount: storedFields?.value ?? 0, fieldEvidenceCount: evidence?.value ?? 0,
    processingStatus: processing?.processing_status ?? null, pendingGroundingCount: grounding?.value ?? 0,
    openReviewCount: review?.openCount ?? 0, recordReviewCount: presentation.reviewItems.length,
    derivedSourceCount: derived.length, imageOcrHasToken: label === "image"
      ? derived.some((source) => source.rawText?.toUpperCase().includes(IMAGE_QUERY)) : null,
    searchFoundRecord: search.results.some((result) => result.recordId === capture.objectId),
    evidenceText,
  };
}

async function main() {
  loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), true);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("gemini_key_missing");
  const db = createLocalDatabase();
  try {
    const budget = budgetedGateway(createGeminiRoleGateways(apiKey).mainAnalyzer);
    const queue = new D1ProcessingQueueRepository(db);
    const summaries = [];
    const textCapture = await seedText(db);
    if (await queue.dispatchPending(1) !== 1) throw new Error("text_job_not_dispatched");
    const textResult = await runNextAnalysisJob({ queue, gateway: budget.gateway, workerId: "s1-live-text" });
    summaries.push(await summarize(db, textCapture, "text", TEXT_QUERY, textResult.outcome));
    // A blocked or invalid first invocation is terminal for this check. Do not repeat it with the image.
    if (!textOnly && textResult.outcome === "succeeded") {
      const image = await seedImage(db);
      if (await queue.dispatchPending(1) !== 1) throw new Error("image_job_not_dispatched");
      const imageResult = await runNextAnalysisJob({ queue, gateway: budget.gateway, workerId: "s1-live-image", bucket: image.bucket });
      summaries.push(await summarize(db, image.capture, "image", IMAGE_QUERY, imageResult.outcome, image.hash));
    }
    console.log(JSON.stringify({
      scope: "isolated-node-sqlite-and-memory-r2; direct production analysis runner; actual Gemini main role",
      providerCalls: budget.count(), maxProviderCalls, providerFailure: budget.failure(),
      imageCheck: textOnly ? "not_selected" : textResult.outcome === "succeeded" ? "attempted" : "skipped_after_text_failure", results: summaries,
    }, null, 2));
    if (summaries.length !== maxProviderCalls || summaries.some((item) => item.outcome !== "succeeded" || item.proposalStatus !== "validated" || !item.originalPreserved || !item.recordReadable || !item.searchFoundRecord || item.storedFieldCount < 1 || item.fieldEvidenceCount < 1 || item.pendingGroundingCount > 0 || (item.input === "image" && !item.imageOcrHasToken))) process.exitCode = 1;
  } finally { db.close(); }
}

void main().catch((error: unknown) => {
  // Provider payloads and secrets must never appear in terminal output.
  console.error(JSON.stringify({ scope: "s1-live-synthetic", errorClass: error instanceof Error ? error.name : "unknown", failed: true }));
  process.exitCode = 1;
});
