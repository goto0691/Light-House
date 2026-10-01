import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { savedViewFieldCatalog, savedViewSelectedFieldLabels } from "@/lib/v2/infrastructure/d1/saved-view-field-catalog";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import type { V2SavedViewDisplay } from "@/lib/v2/retrieval/saved-view-contract";
import { readSavedFieldPage } from "@/lib/v2/infrastructure/d1/saved-field-value-repository";
import type { D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type LocalD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: LocalD1 }>>> | undefined;
let db: LocalD1;
const owner = "view-owner", now = "2026-09-12T11:00:00.000Z";
beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: LocalD1 }>({ configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)), persist: false, remoteBindings: false, envFiles: [] });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('view-owner'),('other-owner');");
  const directory = new URL("../../../../../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const statement of (await readFile(new URL(name, directory), "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}, 120_000);

test("actual D1 bounds the selected-field projection and reads the same complete value only on request", async () => {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Large field proof", bodyMarkdown: "note", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  const text = "a".repeat(4095) + "🌿" + '\r\n\0"한글' .repeat(8000) + "EXACT-END-OF-LARGE-VALUE", raw = JSON.stringify(text);
  await db.prepare(`insert into v2_field_definitions (id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
    values ('large-field',?,'long_note','긴 메모','Long text','long_text','active','user_created',?,?)`).bind(owner, now, now).run();
  await db.prepare(`insert into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
    values ('large-property',?,?,'large-field','text',?,'user_explicit','low','accepted',1,?)`).bind(owner, capture.objectId, raw, now).run();
  let projection = "";
  const observed: D1DatabaseBinding = { prepare(sql) {
    let actual = db.prepare(sql);
    const statement: D1PreparedStatementBinding = { bind(...args) { actual = actual.bind(...args); return statement; },
      async first<T>() { const row = await actual.first<T>(); if (sql.includes("as property_values_json")) projection = JSON.stringify(row); return row; },
      all<T>() { return actual.all<T>(); }, run() { return actual.run(); } };
    return statement;
  }, batch: (statements) => db.batch(statements) };
  const page = await new D1RetrievalRepository(observed, owner).searchPage(defaultV2QueryPlan({ fullText: "Large field proof" }), false, 1, ["long_note"]);
  expect(page.results[0].displayFields![0].values[0]).toMatchObject({ preview: { format: "stored_json", totalBytes: new TextEncoder().encode(raw).length } });
  expect(projection).not.toContain("EXACT-END-OF-LARGE-VALUE"); expect(projection.length).toBeLessThan(10_000);
  const first = await readSavedFieldPage(db, owner, capture.objectId, "large-property", { fieldKey: "long_note", offset: 0, revision: null, full: false });
  expect(first.text).toBe("a".repeat(4095)); expect(first.nextOffset).toBe(4095);
  const second = await readSavedFieldPage(db, owner, capture.objectId, "large-property", { fieldKey: "long_note", offset: first.nextOffset!, revision: first.revision, full: false });
  expect(second.text.startsWith("🌿")).toBe(true);
  const whole = await readSavedFieldPage(db, owner, capture.objectId, "large-property", { fieldKey: "long_note", offset: 0, revision: first.revision, full: true });
  expect(whole.text).toBe(text); expect(whole.nextOffset).toBeNull();
  expect((await db.prepare("select value_json from v2_property_values where id='large-property'").first<{ value_json: string }>())!.value_json).toBe(raw);
  for (const [kind, scalar, valid] of [["number", "4.5", true], ["boolean", "false", true], ["text", "null", true],
    ["number", "-9223372036854775808", true], ["rating", "-9223372036854775808", true],
    ["rating", "1e999", false], ["number", "-1e999", false], ["boolean", "0", false]] as const) {
    const padded = " ".repeat(2200) + scalar;
    await db.prepare("update v2_property_values set value_kind=?,value_json=? where id='large-property'").bind(kind, padded).run();
    const projection = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan({ fullText: "Large field proof" }), false, 1, ["long_note"]);
    expect(projection.results[0].displayFields![0].state).toBe(valid ? "value" : "conflict");
    if (valid) {
      expect(projection.results[0].displayFields![0].values[0].preview?.totalBytes).toBe(padded.length);
      const page = await readSavedFieldPage(db, owner, capture.objectId, "large-property", { fieldKey: "long_note", offset: 0, revision: null, full: false });
      expect(page.text).toBe(String(JSON.parse(scalar)));
    }
  }
  await db.prepare("update v2_property_values set value_kind='text',value_json=? where id='large-property'").bind(raw).run();
  await db.prepare("update v2_documents set privacy_level='sensitive' where object_id=?").bind(capture.objectId).run();
  await expect(readSavedFieldPage(db, owner, capture.objectId, "large-property", { fieldKey: "long_note", offset: 0, revision: first.revision, full: true }))
    .rejects.toMatchObject({ status: 404, code: "record_not_found" });
}, 120_000);
afterAll(async () => { await platform?.dispose(); });

test("actual D1 saves display with CAS, queries selected typed fields and paginates registry metadata", async () => {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Saved-view display proof", bodyMarkdown: "Original note unchanged", aiEnabled: false, clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now, sources: [] }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  const statements = Array.from({ length: 23 }, (_, index) => db.prepare(`insert into v2_field_definitions
    (id,user_id,key,label,definition,data_type,canonical_unit,status,origin,created_at,updated_at)
    values (?, ?, ?, ?, 'Synthetic field','measurement','km','active','user_created',?,?)`)
    .bind(`field-${index}`, owner, `exercise.distance_${String(index).padStart(2, "0")}`, `거리 ${index}`, now, now));
  await db.batch(statements);
  await db.prepare(`insert into v2_property_values
    (id,user_id,owner_object_id,field_definition_id,value_kind,value_number,value_json,unit_key,source_class,claim_risk,review_status,locked_by_user,created_at)
    values ('distance-value',?,?,'field-0','number',5.25,'5.25','km','user_locked','low','accepted',1,?)`).bind(owner, capture.objectId, now).run();
  const initial: V2SavedViewDisplay = { layout: "list", density: "comfortable", groupBy: null, visibleFields: [] };
  const wanted: V2SavedViewDisplay = { layout: "table", density: "compact", groupBy: "written_month", visibleFields: ["exercise.distance_00", "@record.written_at", "@record.captured_at", "future.unknown"] };
  const repository = new D1SavedViewRepository(db, owner), plan = defaultV2QueryPlan({ fullText: "display proof" });
  const created = (await repository.create({ name: "운동 기록", description: null, iconKey: "type.collection", queryPlan: plan, display: initial }, now))!;
  const saved = (await repository.setDisplay(created.id, wanted, created.displayRevision))!;
  expect(saved.display).toEqual(wanted); expect(saved.displayRevision).not.toBe(created.displayRevision);
  expect((await repository.setDisplay(created.id, wanted, created.displayRevision))!.updatedAt).toBe(saved.updatedAt);
  await expect(repository.setDisplay(created.id, { ...initial, layout: "cards" }, created.displayRevision)).rejects.toMatchObject({ code: "saved_view_display_conflict" });
  await repository.setPinned(created.id, true);
  const pinnedUpdate = await repository.setDisplay(created.id, { ...wanted, density: "comfortable" }, saved.displayRevision);
  expect(pinnedUpdate).toMatchObject({ pinned: true, display: { density: "comfortable" } });
  expect(await new D1SavedViewRepository(db, "other-owner").setDisplay(created.id, initial, saved.displayRevision)).toBeNull();
  const catalog = await savedViewFieldCatalog(db, owner, "exercise.distance_", 2);
  expect(catalog).toMatchObject({ page: 2, totalPages: 2, totalCount: 23, pageSize: 20 }); expect(catalog.fields).toHaveLength(3);
  expect((await savedViewFieldCatalog(db, "other-owner", "", 1)).fields).toEqual([]);
  expect(await savedViewSelectedFieldLabels(db, owner, ["exercise.distance_21", "unknown", "exercise.distance_00"]))
    .toEqual({ fields: [{ key: "exercise.distance_21", label: "거리 21" }, { key: "exercise.distance_00", label: "거리 0" }] });
  expect(await savedViewSelectedFieldLabels(db, "other-owner", ["exercise.distance_00"])).toEqual({ fields: [] });
  const retrieval = new D1RetrievalRepository(db, owner);
  const page = await retrieval.searchPage(plan, false, 1, wanted.visibleFields);
  expect(page).toMatchObject({ totalCount: 1 }); expect(page.results[0].recordId).toBe(capture.objectId);
  expect(page.results[0].displayFields).toEqual(expect.arrayContaining([
    expect.objectContaining({ fieldKey: "exercise.distance_00", state: "value", values: [expect.objectContaining({ value: 5.25, unit: "km", lockedByUser: true })] }),
    expect.objectContaining({ fieldKey: "@record.written_at", state: "missing", values: [] }),
    expect.objectContaining({ fieldKey: "future.unknown", state: "missing", values: [] }),
  ]));
  await db.prepare("update v2_documents set privacy_level='sensitive' where object_id=?").bind(capture.objectId).run();
  const sensitive = await retrieval.searchPage(plan, false, 1, wanted.visibleFields);
  expect(sensitive.results[0].displayFields).toHaveLength(4);
  expect(sensitive.results[0].displayFields!.every((field) => field.state === "private" && !field.values.length)).toBe(true);
  expect(JSON.stringify(sensitive.results[0])).not.toContain("5.25");
}, 120_000);
