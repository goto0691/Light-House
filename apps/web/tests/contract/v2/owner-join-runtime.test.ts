import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type TestD1 = D1DatabaseBinding & { exec(query: string): Promise<unknown>; prepare(query: string): D1PreparedStatementBinding };
type Platform = Awaited<ReturnType<typeof getPlatformProxy<{ DB: TestD1 }>>>;

const configPath = fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url));
const migrationNames = [
  "0006_v2_source_and_document_foundation.sql", "0007_v2_document_authoring.sql", "0008_v2_ai_processing.sql", "0009_v2_grounded_enrichment.sql",
  "0010_v2_ai_runtime_governor.sql", "0011_v2_adaptive_knowledge.sql", "0012_v2_review_actions.sql", "0013_v2_entities_relations_and_presentation.sql",
] as const;

let platform: Platform;
let db: TestD1;

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: TestD1 }>({ configPath, persist: false, remoteBindings: false });
  db = platform.env.DB;
  await db.exec(`create table users (id text primary key not null); insert into users (id) values ('user-a'),('user-b');`);
  for (const name of migrationNames) {
    const path = fileURLToPath(new URL(`../../../../../migrations/${name}`, import.meta.url));
    for (const statement of (await readFile(path, "utf8")).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}, 30_000);

afterAll(async () => platform.dispose());

async function capture(userId: string, draftId: string) {
  const prepared = await prepareCaptureCommit({
    draftId,
    channel: "web",
    title: draftId,
    bodyMarkdown: `${draftId} body`,
    aiEnabled: false,
    clientTimezone: "Asia/Seoul",
    privacyLevel: "normal",
    capturedAt: "2026-08-29T00:00:00.000Z",
  }, `idem-${draftId}`, "2026-08-29T00:00:01.000Z");
  await new D1SourceFoundationRepository(db, userId).commitCapture(prepared);
  return prepared;
}

describe("runtime owner join fences", () => {
  test("hides a review whose processing run belongs to another user and performs no mutation", async () => {
    const own = await capture("user-a", "owner-review-record");
    const foreign = await capture("user-b", "foreign-review-run");
    await db.prepare(
      `insert into v2_processing_jobs
       (id,user_id,capture_id,object_id,stage,status,priority,idempotency_key,attempt,max_attempts,next_attempt_at,input_hash,created_at)
       values ('foreign-review-job','user-b',?,?,'analyze','succeeded','interactive','foreign-review-job',1,3,'2026-08-29T00:00:00.000Z','hash','2026-08-29T00:00:00.000Z')`,
    ).bind(foreign.captureId, own.objectId).run();
    await db.prepare(
      `insert into v2_processing_runs
       (id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at)
       values ('foreign-review-run','foreign-review-job','user-b','analysis','model','prompt-v1','schema-v1','registry-v1','config-v1','hash','succeeded','2026-08-29T00:00:00.000Z')`,
    ).run();
    await db.prepare(
      `insert into v2_review_items (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at)
       values ('malformed-cross-owner-review','user-a',?,'foreign-review-run','analysis_review','open','{}','2026-08-29T00:01:00.000Z')`,
    ).bind(own.objectId).run();
    const auditBefore = await db.prepare(`select count(*) as value from v2_audit_events`).first<{ value: number }>();
    const repository = new D1ReviewRepository(db, "user-a");

    await expect(repository.listOpenRecords()).resolves.toEqual([]);
    await expect(repository.resolve("malformed-cross-owner-review", { action: "dismiss", now: "2026-08-29T00:02:00.000Z" }))
      .rejects.toMatchObject({ code: "review_not_found" });
    await expect(db.prepare(`select status from v2_review_items where id='malformed-cross-owner-review'`).first()).resolves.toEqual({ status: "open" });
    await expect(db.prepare(`select count(*) as value from v2_review_receipts`).first()).resolves.toEqual({ value: 0 });
    await expect(db.prepare(`select count(*) as value from v2_audit_events`).first()).resolves.toEqual(auditBefore);
  });
});
