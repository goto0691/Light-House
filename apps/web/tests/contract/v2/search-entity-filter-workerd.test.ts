import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { NATURAL_QUERY_LIMITS } from "@/lib/v2/retrieval/natural-query-v1";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";

// Actual workerd D1 caps expression depth at 100; the Node SQLite fixture does not, so an
// entity filter once passed every Node test and failed on every real search.
type LocalD1 = D1DatabaseBinding & { exec(sql: string): Promise<unknown> };
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: LocalD1 }>>> | undefined;
let db: LocalD1;
const owner = "search-owner", other = "other-owner", now = "2026-10-17T05:00:00.000Z";
beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: LocalD1 }>({ configPath: fileURLToPath(new URL("../../fixtures/v2/wrangler.d1-spike.toml", import.meta.url)), persist: false, remoteBindings: false, envFiles: [] });
  db = platform.env.DB;
  await db.exec("create table users(id text primary key not null); insert into users values ('search-owner'),('other-owner');");
  const directory = new URL("../../../../../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d{4}_v2_.*\.sql$/.test(name) && Number(name.slice(0, 4)) >= 6 && Number(name.slice(0, 4)) <= 33).sort()) {
    for (const statement of (await readFile(new URL(name, directory), "utf8")).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
}, 120_000);
afterAll(async () => { await platform?.dispose(); });

async function record(userId: string, title: string, privacyLevel: "normal" | "restricted" = "normal") {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: `${title} 감상`, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, userId).commitCapture(capture);
  return capture.objectId;
}

test("actual D1 finds records connected to an entity, alone and with a category, without leaking other owners or locked records", async () => {
  const knowledge = new D1ImportedKnowledgeRepository(db, owner);
  const platformEntity = await knowledge.ensureEntity("platform", "Netflix", now);
  const watched = await record(owner, "작품 하나"), second = await record(owner, "작품 둘"), unrelated = await record(owner, "작품 셋");
  const locked = await record(owner, "잠긴 작품", "restricted");
  for (const subject of [watched, second, locked]) await knowledge.addRelation({ subjectObjectId: subject, objectObjectId: platformEntity, predicate: { key: "mentions.platform", label: "플랫폼" }, now });
  await knowledge.assignType(watched, { key: "video_log", label: "영상 로그" }, now);
  const foreign = new D1ImportedKnowledgeRepository(db, other);
  const foreignEntity = await foreign.ensureEntity("platform", "Netflix", now);
  await foreign.addRelation({ subjectObjectId: await record(other, "남의 작품"), objectObjectId: foreignEntity, predicate: { key: "mentions.platform", label: "플랫폼" }, now });

  const search = new D1RetrievalRepository(db, owner);
  const ids = async (plan: Parameters<D1RetrievalRepository["searchPage"]>[0]) => (await search.searchPage(plan)).results.map((result) => result.recordId).sort();
  expect(await ids(defaultV2QueryPlan({ entityFilters: [{ targetObjectId: platformEntity }] }))).toEqual([watched, second].sort());
  expect(await ids(defaultV2QueryPlan({ typeKeys: ["video_log"], entityFilters: [{ targetObjectId: platformEntity }] }))).toEqual([watched]);
  expect(await ids(defaultV2QueryPlan({ fullText: "작품", entityFilters: [{ entityKind: "platform", canonicalName: "netflix" }] }))).toEqual([watched, second].sort());
  expect(await ids(defaultV2QueryPlan({ entityFilters: [{ targetObjectId: foreignEntity }] }))).toEqual([]);
  expect(await ids(defaultV2QueryPlan({ entityFilters: [{ targetObjectId: platformEntity }, { entityKind: "person" }] }))).toEqual([]);
  expect(await ids(defaultV2QueryPlan({ fullText: "작품" }))).toEqual([watched, second, unrelated].sort());
  expect((await search.searchPage(defaultV2QueryPlan({ entityFilters: [{ targetObjectId: platformEntity }] }), true)).results.map((result) => result.recordId)).toContain(locked);
  // A list item condition together with category, entity and text conditions stays within D1's limits.
  await knowledge.setValue(watched, { key: "genre", label: "장르", dataType: "ordered_list" }, { kind: "list", items: ["드라마", "판타지"] }, null, now);
  expect(await ids(defaultV2QueryPlan({ fullText: "작품", typeKeys: ["video_log"], entityFilters: [{ targetObjectId: platformEntity }],
    propertyFilters: [{ fieldKey: "genre", operator: "eq", value: "판타지" }, { fieldKey: "genre", operator: "contains", value: "드라" }] }))).toEqual([watched]);
  // The natural-language planner's limits at once: 20 categories, 20 field and 10 entity conditions, a date range and text.
  const fields = Array.from({ length: NATURAL_QUERY_LIMITS.propertyFilters }, (_, index) => ({ fieldKey: "genre", operator: index % 2 ? "contains" as const : "eq" as const, value: index % 2 ? "판" : "드라마" }));
  const entities = Array.from({ length: NATURAL_QUERY_LIMITS.entityFilters }, (_, index) => index % 2 ? { targetObjectId: platformEntity } : { entityKind: "platform", canonicalName: "net" });
  const types = ["video_log", ...Array.from({ length: NATURAL_QUERY_LIMITS.typeKeys - 1 }, (_, index) => `other_type_${index}`)];
  expect(await ids(defaultV2QueryPlan({ fullText: "작품 하나", typeKeys: types, propertyFilters: fields, entityFilters: entities,
    dateFilter: { axis: "captured_at", from: "2026-01-01", to: "2026-12-31" } }))).toEqual([watched]);
  // Ordering by a field on top of the same maximum still fits D1, and records without the field come last.
  expect(await ids(defaultV2QueryPlan({ fullText: "작품 하나", typeKeys: types, propertyFilters: fields, entityFilters: entities,
    dateFilter: { axis: "captured_at", from: "2026-01-01", to: "2026-12-31" }, sort: { field: "property", fieldKey: "genre", direction: "asc" } }))).toEqual([watched]);
  const byGenre = await search.searchPage(defaultV2QueryPlan({ fullText: "작품", sort: { field: "property", fieldKey: "genre", direction: "desc" } }));
  expect(byGenre.results[0]?.recordId).toBe(watched);
}, 120_000);
