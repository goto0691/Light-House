import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkSnapshotRepository, type LinkSnapshotProjection } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private owner: LinkMemoryD1, private query: string, private sql: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { const result = (this.sql.get(...this.values) ?? null) as T | null; this.owner.afterRead?.(this.query); return result; }
  async all<T>() { const results = this.sql.all(...this.values) as T[]; this.owner.afterRead?.(this.query); return { results }; }
  async run() { return this.sql.run(...this.values); }
}
export class LinkMemoryD1 implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  afterRead: ((query: string) => void) | null = null;
  constructor(version = 31) {
    this.sql.exec("pragma foreign_keys=on;create table users(id text primary key not null);insert into users values ('link-owner'),('link-other');");
    const directory = fileURLToPath(new URL("../../../../../migrations/", import.meta.url));
    for (const name of readdirSync(directory).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= version).sort()) this.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
  }
  prepare(query: string) { return new Statement(this, query, this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.beforeBatch?.(); this.sql.exec("begin immediate");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sql.exec("commit"); return result as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}
export const exactLinkText = "  synthetic portrait 👀\r\nkeep  double spaces\r\n--ar 3:2  ";
export const linkNow = "2026-09-08T00:00:00.000Z";
export async function linkFixture(db: LinkMemoryD1, options: { privacy?: "normal" | "restricted"; snapshot?: boolean; rawText?: string } = {}) {
  const rawText = options.rawText ?? exactLinkText;
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", bodyMarkdown: "PERSONAL MEMO MUST NEVER BE EXTERNAL",
    aiEnabled: false, privacyLevel: options.privacy ?? "normal", clientTimezone: "Asia/Seoul", capturedAt: linkNow,
    sources: [{ kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`,
      metadata: { ...makeManualLinkMetadata({ url: "https://threads.com/@synthetic/post/one", purpose: "prompt", completeness: "partial" }), secretInternalMetadata: "DO NOT PROJECT" } }],
  }, crypto.randomUUID(), linkNow);
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner");
  const projection = options.snapshot === false ? null : await snapshots.bootstrapManualSources({ documentId: capture.objectId,
    expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID(), restrictedUnlocked: options.privacy === "restricted" });
  return { capture, snapshots, projection };
}
export async function seedLinkRun(db: LinkMemoryD1, fixture: Awaited<ReturnType<typeof linkFixture>>, options: { id?: string; projection?: LinkSnapshotProjection; publish?: boolean; createdAt?: string } = {}) {
  const projection = options.projection ?? fixture.projection!, id = options.id ?? crypto.randomUUID(), jobId = `job-${id}`, createdAt = options.createdAt ?? linkNow;
  db.sql.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version,created_at)
    values (?,'link-owner',?,?,'link_analyze','succeeded',?,3,?,?,'synthetic',?,?,?,?)`).run(jobId, fixture.capture.captureId, fixture.capture.objectId, jobId, createdAt,
      fixture.capture.revisionId, projection.snapshot.id, projection.snapshot.manifestHash, projection.snapshot.manifestVersion, createdAt);
  db.sql.prepare(`insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at,finished_at)
    values (?,?,'link-owner','structured','fake','p','s','r','m','synthetic','succeeded',?,?)`).run(id, jobId, createdAt, createdAt);
  const member = projection.members[0], rawText = member.rawText!;
  for (const [suffix, sourceClass] of [["extract", "source_extract"], ["insight", "ai_interpretation"]] as const) {
    db.sql.prepare(`insert into v2_link_fragments(id,user_id,document_object_id,snapshot_id,primary_member_id,processing_run_id,fragment_key,role,source_class,text_start,text_end,raw_text,raw_text_hash,derived_text,completeness,display_order,review_status,created_at)
      values (?,'link-owner',?,?,?,?,?,?,?, ?,?,?,?,?, 'partial',?,'proposed',?)`).run(`${id}-${suffix}`, fixture.capture.objectId, projection.snapshot.id, member.id, id, suffix,
        suffix === "extract" ? "prompt" : "insight", sourceClass, suffix === "extract" ? 0 : null, suffix === "extract" ? rawText.length : null,
        suffix === "extract" ? rawText : null, suffix === "extract" ? await linkSha256Hex(rawText) : null, suffix === "insight" ? "Synthetic interpretation, not the user's opinion." : null, suffix === "extract" ? 0 : 1, createdAt);
    db.sql.prepare(`insert into v2_link_fragment_evidence(id,user_id,fragment_id,member_id,relation_kind,evidence_method,text_start,text_end,display_order,created_at)
      values (?,'link-owner',?,?,'supports','ai_proposed',0,?,0,?)`).run(`${id}-${suffix}-evidence`, `${id}-${suffix}`, member.id, rawText.length, createdAt);
  }
  if (options.publish !== false) db.sql.prepare("update v2_documents set published_link_run_id=? where object_id=?").run(id, fixture.capture.objectId);
  return { id, jobId, extractId: `${id}-extract`, insightId: `${id}-insight` };
}
