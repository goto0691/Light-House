import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { LINK_ANALYSIS_CONTRACT } from "@/lib/v2/ai/link-analysis-v1";
import type { V2StructuredModelGateway, V2StructuredModelRequest } from "@/lib/v2/ai/gateway";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { linkSha256Hex } from "@/lib/v2/domain/link-snapshot-v1";
import { makeManualLinkMetadata } from "@/lib/v2/domain/manual-link-source";
import { D1LinkSnapshotRepository } from "@/lib/v2/infrastructure/d1/link-snapshot-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

class Statement implements D1PreparedStatementBinding {
  private values: SQLInputValue[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async first<T>() { return (this.statement.get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.statement.all(...this.values) as T[] }; }
  async run() { return this.statement.run(...this.values); }
}

/** Real SQLite/foreign keys and repository SQL; not a Wrangler runtime claim. */
export class LinkSqlite implements D1DatabaseBinding {
  readonly sql = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  constructor(version = 31) {
    this.sql.exec("pragma foreign_keys=on; create table users(id text primary key not null); insert into users values ('link-owner'),('other-owner');");
    const directory = fileURLToPath(new URL("../../../../migrations/", import.meta.url));
    for (const name of readdirSync(directory).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= version).sort()) this.sql.exec(readFileSync(`${directory}/${name}`, "utf8"));
  }
  prepare(query: string) { return new Statement(this.sql.prepare(query)); }
  async batch<T = unknown>(statements: D1PreparedStatementBinding[]): Promise<T[]> {
    this.beforeBatch?.();
    this.sql.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sql.exec("commit");
      return results as T[];
    } catch (error) { this.sql.exec("rollback"); throw error; }
  }
}

export async function seedLinkRecord(db: LinkSqlite, { rawText = "  exact prompt 👀\r\n--ar 3:2\n", snapshot = true, privacyLevel = "normal" as "normal" | "restricted" } = {}) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Synthetic link", bodyMarkdown: "PRIVATE MEMO",
    aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: new Date().toISOString(),
    sources: [{ kind: "url", rawText, contentHash: `sha256:${await linkSha256Hex(rawText)}`, metadata: makeManualLinkMetadata({ url: "https://example.test/source", purpose: "prompt" }) }],
  }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, "link-owner").commitCapture(capture);
  const sources = await db.prepare("select id from v2_source_items where capture_id=? and item_kind='url'").bind(capture.captureId).all<{ id: string }>();
  const snapshots = new D1LinkSnapshotRepository(db, "link-owner");
  const projection = snapshot ? await snapshots.bootstrapManualSources({ documentId: capture.objectId, expectedRevisionId: capture.revisionId, idempotencyKey: crypto.randomUUID(), restrictedUnlocked: privacyLevel === "restricted" }) : null;
  return { capture, sources: sources.results, projection, snapshots, rawText };
}

export function exactLinkGateway(): V2StructuredModelGateway & { calls: V2StructuredModelRequest[] } {
  const calls: V2StructuredModelRequest[] = [];
  return { calls, async generate<T>(request: V2StructuredModelRequest) {
    calls.push(request);
    const input = JSON.parse((request.parts?.[0] as { text: string }).text);
    return new FakeV2StructuredModelGateway("success", {
      contract_version: LINK_ANALYSIS_CONTRACT, snapshot_id: input.snapshot_id, analyzed_revision_id: input.analyzed_revision_id,
      manifest_hash: input.manifest_hash, manifest_version: input.manifest_version,
      fragments: [{ fragment_key: "prompt", role: "prompt", selection: { member_key: input.sources[0].member_key, first_block: 0, last_block: 1 } }], interpretations: [],
    }).generate<T>(request);
  } };
}
