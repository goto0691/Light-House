import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { readFacetPage } from "@/lib/v2/infrastructure/d1/facet-page-repository";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";

type LocalD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: LocalD1 }>>> | undefined;
let db: LocalD1, documentId: string;
const owner = "catalog-owner", now = "2026-09-22T11:00:00.000Z";
beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: LocalD1 }>({ configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)), persist: false, remoteBindings: false, envFiles: [] });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('catalog-owner'),('other-owner');");
  const directory = new URL("../../../../../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 32).sort()) {
    for (const statement of (await readFile(new URL(name, directory), "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Catalog workerd proof", bodyMarkdown: "Original unchanged", aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture); documentId = capture.objectId;
  await db.prepare(`with recursive n(i) as (values(0) union all select i+1 from n where i<60)
    insert into v2_type_definitions (id,user_id,key,label,applies_to_kind,status,origin,definition,created_at,updated_at)
    select 'type-'||i,?1,printf('type_%03d',i),printf('분류 %03d',i),'document','active','user_created','catalog',?2,?2 from n`).bind(owner, now).run();
  await db.prepare(`insert into v2_object_type_assignments (id,user_id,object_id,type_definition_id,role,source_class,review_status,created_at,updated_at)
    select 'a-'||id,?1,?2,id,'secondary','user',case when key='type_060' then 'proposed' else 'accepted' end,?3,?3 from v2_type_definitions where user_id=?1`).bind(owner, documentId, now).run();
  await db.prepare(`with recursive n(i) as (values(0) union all select i+1 from n where i<64)
    insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) select printf('entity-%03d',i),?1,'entity','active',?2,?2 from n`).bind(owner, now).run();
  await db.prepare(`insert into v2_entity_records (object_id,entity_kind,canonical_name,resolution_status,created_at)
    select id,'place',replace(id,'entity-','장소 '),'resolved',?2 from v2_objects where user_id=?1 and object_kind='entity'`).bind(owner, now).run();
  await db.prepare(`insert into v2_predicate_definitions (id,user_id,key,label,definition,status,origin,created_at,updated_at)
    values ('visited',?1,'visited','방문','Visited','active','user_created',?2,?2)`).bind(owner, now).run();
  await db.prepare(`insert into v2_relation_edges (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,created_at)
    select 'edge-'||id,?1,?2,'visited',id,'user_explicit','low','accepted',?3 from v2_objects where user_id=?1 and object_kind='entity'`).bind(owner, documentId, now).run();
}, 120_000);
afterAll(async () => { await platform?.dispose(); });

test("actual D1 discovers types after 50 and entities after 60, with exact selection independent of query", async () => {
  const selected = { kind: "type", query: "", page: Number.MAX_SAFE_INTEGER, selectedKey: "type_060" } as const;
  const types = await readFacetPage(db, owner, selected);
  expect(types).toMatchObject({ totalCount: 61, page: 4, totalPages: 4, pageSize: 20, selected: { key: "type_060", count: 1 } });
  expect(types.items).toHaveLength(1); expect(types.items[0].key).toBe("type_060");
  const filtered = await readFacetPage(db, owner, { ...selected, query: "분류 000" });
  expect(filtered).toMatchObject({ totalCount: 1, page: 1, selected: { key: "type_060" } });
  expect(filtered.items[0].key).toBe("type_000");
  const entities = await readFacetPage(db, owner, { kind: "entity", query: "place", page: 4, selectedKey: null });
  expect(entities).toMatchObject({ totalCount: 65, page: 4, totalPages: 4 }); expect(entities.items).toHaveLength(5);
  expect(entities.items.at(-1)?.key).toBe("entity-064");
  expect((await readFacetPage(db, owner, { ...selected, query: "%_" })).items).toEqual([]);
  expect(await readFacetPage(db, "other-owner", selected)).toMatchObject({ totalCount: 0, page: 1, items: [], selected: null });
}, 120_000);

test("actual D1 count, last page and selected metadata close together when privacy changes after schema lookup", async () => {
  let changed = false;
  const observed: D1DatabaseBinding = { prepare(sql) {
    let actual = db.prepare(sql);
    const statement: D1PreparedStatementBinding = { bind(...args) { actual = actual.bind(...args); return statement; },
      async first<T>() {
        const row = await actual.first<T>();
        if (!changed && sql.includes("sqlite_master")) { changed = true; await db.prepare("update v2_documents set privacy_level='restricted' where object_id=?").bind(documentId).run(); }
        return row;
      }, all<T>() { return actual.all<T>(); }, run() { return actual.run(); } };
    return statement;
  }, batch: (statements) => db.batch(statements) };
  const page = await readFacetPage(observed, owner, { kind: "type", query: "", page: 4, selectedKey: "type_060" });
  expect(changed).toBe(true); expect(page).toMatchObject({ totalCount: 0, page: 1, items: [], selected: null });
  expect(await readFacetPage(db, owner, { kind: "entity", query: "", page: 1, selectedKey: null })).toMatchObject({ totalCount: 0 });
  await db.prepare("update v2_documents set privacy_level='normal' where object_id=?").bind(documentId).run();
}, 120_000);

test("actual D1 exposes every valid stored month beyond 36 without giant page offset or UTC regrouping", async () => {
  await db.prepare(`with recursive n(i) as (values(0) union all select i+1 from n where i<47)
    insert into v2_capture_bundles (id,user_id,draft_id,capture_channel,ai_enabled,client_timezone,content_hash,captured_at,committed_at,created_at)
    select 'month-capture-'||i,?1,'month-draft-'||i,'web',0,'Asia/Seoul','fixture-hash',strftime('%Y-%m-%dT00:00:00+09:00','2022-01-01','+'||i||' months'),?2,?2 from n`).bind(owner, now).run();
  await db.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at)
    select 'month-object-'||id,?1,'document','active',?2,?2 from v2_capture_bundles where user_id=?1 and id like 'month-capture-%'`).bind(owner, now).run();
  await db.prepare(`insert into v2_documents (object_id,capture_id,title,title_source,body_markdown,current_revision_id,privacy_level)
    select 'month-object-'||id,id,'Month fixture','user','unchanged','fixture-revision','normal' from v2_capture_bundles where user_id=?1 and id like 'month-capture-%'`).bind(owner).run();
  const page = await readFacetPage(db, owner, { kind: "month", query: "", page: Number.MAX_SAFE_INTEGER, selectedKey: null });
  expect(page).toMatchObject({ totalCount: 49, page: 3, totalPages: 3 }); expect(page.items).toHaveLength(9); expect(page.items.at(-1)?.key).toBe("2022-01");
  const year = await readFacetPage(db, owner, { kind: "month", query: "2022", page: 1, selectedKey: null });
  expect(year.totalCount).toBe(12); expect(year.items.at(-1)?.key).toBe("2022-01");
  await db.prepare("update v2_capture_bundles set captured_at='2022-99-invalid' where id='month-capture-0'").run();
  expect((await readFacetPage(db, owner, { kind: "month", query: "", page: 1, selectedKey: null })).totalCount).toBe(48);
  expect((await db.prepare("select count(*) as count from v2_documents").first<{ count: number }>())?.count).toBe(49);
}, 120_000);

test("actual D1 saved-view summaries page beyond 20 without decoding broken or huge private query JSON", async () => {
  const repository = new D1SavedViewRepository(db, owner);
  const created = (await repository.create({ name: "내 목록 000", description: "fixture", iconKey: "type.collection", queryPlan: defaultV2QueryPlan(),
    display: { layout: "list", density: "comfortable", groupBy: null, visibleFields: [] } }, now))!;
  await db.prepare(`with recursive n(i) as (values(1) union all select i+1 from n where i<42)
    insert into v2_saved_views (id,user_id,view_key,name,description,icon_key,query_plan_json,display_json,source,pinned,created_at,updated_at)
    select printf('catalog-view-%03d',i),user_id,printf('catalog_view_%03d',i),printf('내 목록 %03d',i),description,icon_key,'broken json',display_json,source,0,created_at,updated_at
    from v2_saved_views,n where id=?1`).bind(created.id).run();
  const page = await repository.listPage({ query: "", page: Number.MAX_SAFE_INTEGER, pinnedOnly: false });
  expect(page).toMatchObject({ totalCount: 43, page: 3, totalPages: 3, pageSize: 20 }); expect(page.views).toHaveLength(3);
  expect(JSON.stringify(page)).not.toContain("queryPlan"); expect(JSON.stringify(page)).not.toContain("broken json");
  expect((await repository.listPage({ query: "내 목록 042", page: 1, pinnedOnly: false })).views[0].name).toBe("내 목록 042");
  await repository.setPinned(created.id, true);
  expect(await repository.listPage({ query: "", page: 1, pinnedOnly: true })).toMatchObject({ totalCount: 1, views: [{ id: created.id, pinned: true }] });
  expect((await new D1SavedViewRepository(db, "other-owner").listPage({ query: "", page: 1, pinnedOnly: false })).totalCount).toBe(0);
}, 120_000);
