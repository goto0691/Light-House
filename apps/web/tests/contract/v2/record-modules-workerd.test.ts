import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { prepareCaptureCommit, type CapturePrivacyLevel } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type LocalD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: LocalD1 }>>> | undefined;
let db: LocalD1;
const owner = "module-owner", now = "2026-09-22T12:50:00.000Z";
beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: LocalD1 }>({ configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)), persist: false, remoteBindings: false, envFiles: [] });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('module-owner'),('other-owner');");
  const directory = new URL("../../../../../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const statement of (await readFile(new URL(name, directory), "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}, 120_000);
afterAll(async () => { await platform?.dispose(); });

async function seed(privacyLevel: CapturePrivacyLevel = "normal", metrics = true) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Synthetic workout", bodyMarkdown: "ORIGINAL WORKOUT BODY", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  if (!metrics) return capture;
  const typeId = crypto.randomUUID();
  await db.prepare(`insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
    values (?1,?2,?3,'운동','document','active','user_created','audit',?4,?4)`).bind(typeId, owner, `workout_${typeId}`, now).run();
  await db.prepare(`insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,created_at,updated_at)
    values (?1,?2,?3,?4,'primary','user','accepted',?5,?5)`).bind(crypto.randomUUID(), owner, capture.objectId, typeId, now).run();
  for (const [key, value] of [["distance", 5.4], ["duration", 31]] as const) {
    const fieldId = `module-${key}`, propertyId = crypto.randomUUID();
    await db.prepare(`insert or ignore into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
      values (?1,?2,?3,?3,'audit','decimal','active','user_created',?4,?4)`).bind(fieldId, owner, key, now).run();
    await db.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,source_class,claim_risk,review_status,created_at)
      values (?1,?2,?3,?4,'number',?5,'null','user_explicit','low','accepted',?6)`).bind(propertyId, owner, capture.objectId, fieldId, value, now).run();
    await db.prepare(`insert into v2_evidence_refs(id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
      values (?1,?2,'property_value',?3,?4,'text_span','{"start":0,"end":8}',?5)`).bind(crypto.randomUUID(), owner, propertyId, capture.sources[0].id, now).run();
  }
  return capture;
}
async function connect(source: string, target: string) {
  await db.prepare(`insert or ignore into v2_predicate_definitions(id,user_id,key,label,definition,status,origin,created_at,updated_at)
    values ('module-related',?1,'related_to','관련','audit','active','user_created',?2,?2)`).bind(owner, now).run();
  const id = crypto.randomUUID();
  await db.prepare(`insert into v2_relation_edges(id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,created_at)
    values (?1,?2,?3,'module-related',?4,'user_explicit','low','accepted',?5)`).bind(id, owner, source, target, now).run();
  return id;
}
function afterRead(match: string, mutate: () => Promise<unknown>) {
  let changed = false;
  async function hook(sql: string) { if (!changed && sql.includes(match)) { changed = true; await mutate(); } }
  const observed: D1DatabaseBinding = { prepare(sql) {
    let actual = db.prepare(sql);
    const statement: D1PreparedStatementBinding = { bind(...args) { actual = actual.bind(...args); return statement; },
      async first<T>() { const row = await actual.first<T>(); await hook(sql); return row; },
      async all<T>() { const rows = await actual.all<T>(); await hook(sql); return rows; }, run() { return actual.run(); } };
    return statement;
  }, batch: (statements) => db.batch(statements) };
  return { db: observed, fired: () => changed };
}

test("actual workerd D1 preserves normal module values, evidence and authored source", async () => {
  const capture = await seed(), result = await new D1PresentationRepository(db, owner).project(capture.objectId);
  expect(result.modules).toEqual([expect.objectContaining({ previewPolicy: "full", fields: expect.arrayContaining([
    expect.objectContaining({ fieldKey: "distance", value: 5.4, evidence: [expect.objectContaining({ quote: "ORIGINAL" })] }),
  ]) })]);
  expect((await db.prepare("select body_markdown from v2_documents where object_id=?").bind(capture.objectId).first<{ body_markdown: string }>())?.body_markdown).toBe("ORIGINAL WORKOUT BODY");
}, 60_000);

test("actual workerd D1 redacts sensitive modules and requires a trusted restricted read", async () => {
  const capture = await seed("sensitive"), repository = new D1PresentationRepository(db, owner);
  const sensitive = await repository.project(capture.objectId);
  expect(sensitive.modules).toMatchObject([{ previewPolicy: "redacted", fields: [], sourceLabels: [] }]);
  expect(sensitive.sections.flatMap((section) => section.fields)).toHaveLength(2);
  await db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(capture.objectId).run();
  expect(await repository.project(capture.objectId)).toMatchObject({ sections: [], modules: [] });
  const unlocked = await repository.project(capture.objectId, false, { restrictedUnlocked: true });
  expect(unlocked.modules).toEqual([]); expect(unlocked.sections.flatMap((section) => section.fields)).toHaveLength(2);
  expect(await new D1PresentationRepository(db, "other-owner").project(capture.objectId, false, { restrictedUnlocked: true })).toMatchObject({ sections: [], modules: [] });
}, 60_000);

test("actual workerd SQL final snapshot fences target privacy and retargeted relation identities", async () => {
  const source = await seed(), target = await seed("normal", false), replacement = await seed("normal", false);
  const id = await connect(source.objectId, target.objectId), repository = new D1PresentationRepository(db, owner);
  expect((await repository.project(source.objectId)).connections).toHaveLength(1);
  const observed = afterRead("from v2_relation_edges r join", () => db.batch([
    db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(target.objectId),
    db.prepare("update v2_relation_edges set object_object_id=? where id=?").bind(replacement.objectId, id),
  ]));
  expect((await new D1PresentationRepository(observed.db, owner).project(source.objectId)).connections).toEqual([]);
  expect(observed.fired()).toBe(true);
  await db.prepare("update v2_relation_edges set object_object_id=? where id=?").bind(target.objectId, id).run();
  expect((await repository.project(source.objectId, false, { restrictedUnlocked: true })).connections).toEqual([]);
}, 60_000);

test("actual workerd D1 suppresses gathered values after the document version changes", async () => {
  const capture = await seed();
  const observed = afterRead("from v2_review_items", () => db.prepare("update v2_documents set current_version=current_version+1 where object_id=?").bind(capture.objectId).run());
  expect(await new D1PresentationRepository(observed.db, owner).project(capture.objectId)).toMatchObject({ highlights: [], sections: [], modules: [], connections: [] });
  expect(observed.fired()).toBe(true);
}, 60_000);

test("actual workerd D1 removes property and relation evidence when a third source becomes restricted", async () => {
  const source = await seed(), target = await seed("normal", false), third = await seed("normal", false);
  const relationId = await connect(source.objectId, target.objectId);
  const property = (await db.prepare("select id from v2_property_values where owner_object_id=? order by id limit 1").bind(source.objectId).first<{ id: string }>())!;
  for (const [kind, id] of [["property_value", property.id], ["relation", relationId]] as const) {
    await db.prepare(`insert into v2_evidence_refs(id,user_id,target_kind,target_id,source_item_id,locator_kind,locator_json,created_at)
      values (?1,?2,?3,?4,?5,'text_span','{"start":0,"end":8}',?6)`).bind(crypto.randomUUID(), owner, kind, id, third.sources[0].id, now).run();
  }
  const observed = afterRead("left join v2_source_items s", () => db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(third.objectId).run());
  const result = await new D1PresentationRepository(observed.db, owner).project(source.objectId);
  expect(observed.fired()).toBe(true); expect(result.connections).toHaveLength(1); expect(result.modules).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain(third.sources[0].id);
  expect(result.connections[0].evidence).toEqual([]);
  expect(result.sections.flatMap((section) => section.fields).flatMap((field) => field.evidence)).toHaveLength(2);
}, 60_000);
