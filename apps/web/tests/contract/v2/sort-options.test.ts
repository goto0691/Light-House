import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { readConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1DocumentAuthoringRepository, type V2LibraryDirection, type V2LibrarySort } from "@/lib/v2/infrastructure/d1/document-authoring-repository";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { describeV2QueryPlan, hasV2QueryConditions, searchParamsForPlan } from "@/lib/v2/retrieval/plan-presentation";
import { defaultV2QueryPlan, validateV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { queryPlanFromSearchParams } from "@/lib/v2/retrieval/search-params";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const now = "2026-10-18T05:00:00.000Z";
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => { db.sql.close(); });

async function record(title: string | null, capturedAt: string, options: { imported?: boolean; privacyLevel?: "normal" | "restricted"; committedAt?: string } = {}) {
  const committedAt = options.committedAt ?? now;
  const draftId = options.imported ? `notion:${crypto.randomUUID()}` : crypto.randomUUID();
  const capture = await prepareCaptureCommit({ draftId, channel: options.imported ? "import" : "web", title, bodyMarkdown: `${title ?? "제목 없음"} 본문`, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: options.privacyLevel ?? "normal", capturedAt }, draftId, committedAt);
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  return capture.objectId;
}

/** Library rows for one order, read both at once and one page at a time; both walks must agree. */
async function libraryOrder(sort: V2LibrarySort, direction: V2LibraryDirection) {
  const library = new D1DocumentAuthoringRepository(db, owner);
  const whole = (await library.listRecordsPage({ sort, direction })).records.map((row) => row.recordId);
  const paged: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await library.listRecordsPage({ sort, direction, limit: 1, cursor });
    paged.push(...page.records.map((row) => row.recordId));
    cursor = page.nextCursor ?? undefined;
  } while (cursor && paged.length < 20);
  expect(paged).toEqual(whole);
  return whole;
}

describe("choosing how records are ordered", () => {
  test("the library orders by last change, own date or title, either way, and keeps records without that value last", async () => {
    const older = await record("가을 산책", "2024-03-01T12:00:00.000Z", { committedAt: "2026-10-18T01:00:00.000Z" });
    const newer = await record("나무 그늘", "2025-05-01T12:00:00.000Z", { committedAt: "2026-10-18T02:00:00.000Z" });
    const untitled = await record(null, "2023-01-01T12:00:00.000Z", { committedAt: "2026-10-18T03:00:00.000Z" });
    const locked = await record("아침 비밀", "2022-01-01T12:00:00.000Z", { privacyLevel: "restricted", committedAt: "2026-10-18T04:00:00.000Z" });
    const undated = await record("다른 곳에서 온 메모", now, { imported: true, committedAt: now });
    // A record saved without a title gets one from its first sentence; this one has none at all.
    db.sql.prepare("update v2_documents set title='' where object_id=?").run(untitled);

    expect(await libraryOrder("updated", "desc")).toEqual([locked, untitled, newer, older, undated]);
    expect(await libraryOrder("updated", "asc")).toEqual([older, newer, untitled, locked, undated]);
    expect(await libraryOrder("date", "desc")).toEqual([newer, older, untitled, locked, undated]);
    expect(await libraryOrder("date", "asc")).toEqual([locked, untitled, older, newer, undated]);
    // A locked record's title never decides its place: it sits with untitled records.
    expect((await libraryOrder("title", "asc")).slice(0, 3)).toEqual([older, newer, undated]);
    expect((await libraryOrder("title", "desc")).slice(0, 3)).toEqual([undated, newer, older]);
  });

  test("a cursor only continues the order it came from, and an older default cursor still works", async () => {
    await record("하나", "2024-01-01T12:00:00.000Z", { committedAt: "2026-10-18T01:00:00.000Z" });
    const second = await record("둘", "2024-01-02T12:00:00.000Z", { committedAt: "2026-10-18T00:00:00.000Z" });
    const library = new D1DocumentAuthoringRepository(db, owner);
    const first = await library.listRecordsPage({ sort: "title", direction: "asc", limit: 1 });
    await expect(library.listRecordsPage({ sort: "date", direction: "asc", cursor: first.nextCursor! })).rejects.toThrow();
    const top = (await library.listRecordsPage({ limit: 1 })).records[0]!;
    const legacy = Buffer.from(JSON.stringify({ version: 1, updatedAt: top.updatedAt, recordId: top.recordId, includeDeleted: false })).toString("base64url");
    expect((await library.listRecordsPage({ cursor: legacy })).records.map((row) => row.recordId)).toEqual([second]);
    await expect(library.listRecordsPage({ sort: "title", direction: "asc", cursor: legacy })).rejects.toThrow();
  });

  test("search orders by one of the owner's fields, either way, with records lacking it last", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    const long = await record("긴 게임", "2024-01-01T12:00:00.000Z"), short = await record("짧은 게임", "2024-01-02T12:00:00.000Z"), none = await record("모르는 게임", "2024-01-03T12:00:00.000Z");
    const playTime = { key: "play_time", label: "플레이 타임", dataType: "decimal" } as const;
    await knowledge.setValue(long, playTime, { kind: "number", number: 205 }, null, now);
    await knowledge.setValue(short, playTime, { kind: "number", number: 9 }, null, now);
    const ids = async (direction: "asc" | "desc") => (await new D1RetrievalRepository(db, owner)
      .searchPage(defaultV2QueryPlan({ fullText: "게임", sort: { field: "property", fieldKey: "play_time", direction } }))).results.map((result) => result.recordId);
    expect(await ids("desc")).toEqual([long, short, none]);
    expect(await ids("asc")).toEqual([short, long, none]);
    // Browsing every record that has the field, without any other condition.
    const browse = defaultV2QueryPlan({ sort: { field: "property", fieldKey: "play_time", direction: "desc" } });
    expect(hasV2QueryConditions(browse)).toBe(true);
    expect((await new D1RetrievalRepository(db, owner).searchPage(browse)).results.slice(0, 2).map((result) => result.recordId)).toEqual([long, short]);
  });

  test("date orders in search put records without a date of their own last", async () => {
    const dated = await record("날짜 있는 메모", "2020-01-01T12:00:00.000Z");
    const undated = await record("날짜 없는 메모", now, { imported: true });
    for (const field of ["captured_at", "written_at", "updated_at"] as const) for (const direction of ["asc", "desc"] as const) {
      const results = (await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan({ fullText: "메모", sort: { field, direction } }))).results;
      expect(results.map((result) => result.recordId)).toEqual([dated, undated]);
    }
  });

  test("a field order travels through the address, the plan contract and the shown conditions", () => {
    const plan = queryPlanFromSearchParams(new URLSearchParams({ type: "game_log", sort: "property", sort_key: "play_time", direction: "asc" }));
    expect(plan.sort).toEqual({ field: "property", fieldKey: "play_time", direction: "asc" });
    expect(queryPlanFromSearchParams(searchParamsForPlan(plan))).toEqual(plan);
    expect(queryPlanFromSearchParams(new URLSearchParams({ q: "x", sort: "property", sort_key: "Not A Key" })).sort).toEqual({ field: "relevance", direction: "desc" });
    expect(describeV2QueryPlan(plan, { fields: new Map([["play_time", "플레이 타임"]]) }).find((chip) => chip.kind === "sort")?.value).toBe("플레이 타임 작은 값·오래된 것부터");
    expect(() => validateV2QueryPlan({ ...plan, sort: { field: "property", direction: "asc" } })).toThrow();
    expect(() => validateV2QueryPlan({ ...plan, sort: { field: "title", direction: "asc", fieldKey: "play_time" } })).toThrow();
  });

  test("connections inside a group can be newest first, oldest first or by name, undated ones last", async () => {
    const knowledge = new D1ImportedKnowledgeRepository(db, owner);
    const studio = await knowledge.ensureEntity("organization", "스튜디오", now);
    const records = [await record("나 작품", "2024-05-01T12:00:00.000Z"), await record("가 작품", "2023-05-01T12:00:00.000Z"), await record("다 작품", now, { imported: true })];
    for (const id of records) await knowledge.addRelation({ subjectObjectId: id, objectObjectId: studio, predicate: { key: "mentions.production_company", label: "제작사" }, now });
    const labels = async (order: "recent" | "oldest" | "name") => (await readConnectionGroups(db, owner, studio, { order }))!.groups[0]!.items.map((item) => item.label);
    expect(await labels("recent")).toEqual(["나 작품", "가 작품", "다 작품"]);
    expect(await labels("oldest")).toEqual(["가 작품", "나 작품", "다 작품"]);
    expect(await labels("name")).toEqual(["가 작품", "나 작품", "다 작품"]);
  });
});
