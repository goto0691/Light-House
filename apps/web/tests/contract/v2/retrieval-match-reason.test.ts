import { afterEach, describe, expect, test } from "vitest";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { LinkSqlite, seedLinkRecord } from "../../support/link-sqlite";

const databases: LinkSqlite[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });

describe("FTS search inclusion reasons use the selected document/source columns", () => {
  test.each([
    ["Synthetic", "제목"],
    ["PRIVATE", "본문"],
    ["prompt", "원본·OCR·녹취"],
    ["Sy", "제목"],
    ["PR", "본문"],
    ["pt", "원본·OCR·녹취"],
  ])("labels a %s match as %s without mistaking the retained note copy for an external source", async (query, expectedOrigin) => {
    const db = new LinkSqlite(32); databases.push(db);
    const fixture = await seedLinkRecord(db);
    const result = await new D1RetrievalRepository(db, "link-owner").searchPage(defaultV2QueryPlan({ fullText: query }));
    expect(result.totalCount).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].recordId).toBe(fixture.capture.objectId);
    expect(result.results[0].inclusionReasons).toEqual([`${expectedOrigin}에 ‘${query}’ 포함`]);
    expect((await new D1RetrievalRepository(db, "other-owner").searchPage(defaultV2QueryPlan({ fullText: query }))).totalCount).toBe(0);
  });
});
