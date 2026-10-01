import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1ProcessingStatusRepository } from "@/lib/v2/infrastructure/d1/processing-status-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type LocalD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: LocalD1 }>>> | undefined;
let db: LocalD1;
const owner = "status-owner", now = "2026-09-22T14:00:00.000Z", runtime = { enabled: true, configured: true };
beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: LocalD1 }>({ configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)), persist: false, remoteBindings: false, envFiles: [] });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('status-owner'),('status-other');");
  const directory = new URL("../../../../../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const statement of (await readFile(new URL(name, directory), "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}, 120_000);
afterAll(async () => { await platform?.dispose(); });
async function seed(privacy: "normal" | "sensitive" | "restricted" = "normal", aiEnabled = false) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: `SECRET-${privacy}`, bodyMarkdown: "SOURCE MUST NOT ENTER STATUS DTO",
    aiEnabled, clientTimezone: "Asia/Seoul", privacyLevel: privacy, capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  return capture;
}
function list(filter = "all", cursor?: string) { return new D1ProcessingStatusRepository(db, owner).list({ filter, cursor, runtime, now: new Date(now) }); }
async function processingSnapshot() {
  return db.prepare(`select
    (select json_group_array(json_object('id',id,'status',status,'dispatched',dispatched_at)) from v2_processing_outbox) as outbox,
    (select json_group_array(json_object('id',id,'status',status,'attempt',attempt,'lease',lease_owner)) from v2_processing_jobs) as jobs,
    (select json_group_array(json_object('id',id,'status',status)) from v2_processing_runs) as runs,
    (select json_group_array(json_object('role',model_role,'state',state,'probe',probe_owner,'updated',updated_at)) from v2_ai_runtime_state) as runtime,
    (select count(*) from v2_audit_events) as audit,
    (select json_group_array(json_object('id',id,'state',processing_status)) from v2_capture_bundles) as captures`).first();
}

test("actual workerd SQL returns saved, queued and private records without content or writes", async () => {
  const normal = await seed(), queued = await seed("normal", true), sensitive = await seed("sensitive"), restricted = await seed("restricted");
  // D1's own accounting changes SQLite total_changes() even for SELECT. Compare
  // the application's durable processing state, not the engine-global counter.
  const before = await processingSnapshot();
  const page = await list();
  expect(page.counts).toEqual({ all: 4, waiting: 1, attention: 0, completed: 0, unprocessed: 3 });
  expect(page.items.find((row) => row.recordId === normal.objectId)?.status).toBe("unprocessed");
  expect(page.items.find((row) => row.recordId === queued.objectId)?.status).toBe("queued");
  expect(page.items.find((row) => row.recordId === sensitive.objectId)?.title).toBe("민감 기록");
  expect(page.items.find((row) => row.recordId === restricted.objectId)).toMatchObject({ title: "잠긴 기록", stages: [], partial: false, reviewPending: false });
  expect(JSON.stringify(page)).not.toContain("SOURCE MUST");
  expect(await processingSnapshot()).toEqual(before);
  expect((await new D1ProcessingStatusRepository(db, "status-other").list({ runtime })).counts.all).toBe(0);
}, 60_000);

test("actual workerd SQL aggregates grounding siblings instead of hiding unfinished work", async () => {
  const capture = await seed();
  for (const [index, stage, status] of [[0, "analyze", "succeeded"], [1, "grounded_enrich", "succeeded"], [2, "grounded_enrich", "retry_wait"]] as const) {
    const id = `status-${capture.objectId}-${index}`;
    await db.prepare(`insert into v2_processing_jobs(id,user_id,capture_id,object_id,stage,status,idempotency_key,max_attempts,next_attempt_at,input_revision_id,input_hash,created_at)
      values (?1,?2,?3,?4,?5,?6,?1,4,?7,?8,?9,?7)`)
      .bind(id, owner, capture.captureId, capture.objectId, stage, status, now, capture.revisionId, `input-${index}`).run();
    if (status === "succeeded") await db.prepare(`insert into v2_processing_runs(id,job_id,user_id,model_role,model_id,prompt_version,schema_version,registry_version,model_config_version,input_hash,status,created_at,finished_at)
      values (?1,?2,?3,'main_analyzer','fixture','p','s','r','m',?4,'succeeded',?5,?5)`)
      .bind(`run-${id}`, id, owner, `input-${index}`, now).run();
  }
  const row = (await list()).items.find((item) => item.recordId === capture.objectId)!;
  expect(row.status).toBe("retry_wait");
  expect(row.stages).toHaveLength(3);
  expect(row.stages).toContainEqual({ stage: "grounded_enrich", status: "retry_wait", count: 1, nextAttemptAt: now });
}, 60_000);

test("actual workerd paging uses equal-date tie breakers and runtime redaction", async () => {
  for (let index = 0; index < 21; index += 1) await seed();
  await db.prepare(`insert into v2_ai_runtime_state(model_role,state,consecutive_failures,retry_after,probe_owner,last_error_code,updated_at)
    values ('main_analyzer','quota_exhausted',5,?,'PRIVATE-PROBE','PRIVATE-ERROR',?)`).bind(now, now).run();
  const first = await list(), second = await list("all", first.nextCursor!);
  expect(first.items).toHaveLength(20); expect(first.counts.all).toBe(26);
  expect(second.items).toHaveLength(6); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((item) => item.recordId)).size).toBe(26);
  expect(first.runtime.roles[0]).toEqual({ role: "main_analyzer", state: "quota_exhausted", retryAt: now });
  expect(JSON.stringify(first)).not.toContain("PRIVATE-");
}, 60_000);
