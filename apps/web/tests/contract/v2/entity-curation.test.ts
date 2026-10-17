import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { readConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1EntityCurationRepository } from "@/lib/v2/infrastructure/d1/entity-curation-repository";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner", other = "other-owner";
const now = "2026-10-18T02:00:00.000Z";
const studio = { key: "mentions.production_company", label: "제작사" };
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => { db.sql.close(); });

async function record(title: string, userId = owner) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: `${title} 감상`, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, userId).commitCapture(capture);
  return capture.objectId;
}

async function twoSpellings() {
  const knowledge = new D1ImportedKnowledgeRepository(db, owner);
  const english = await knowledge.ensureEntity("organization", "Warner Bros.", now);
  const korean = await knowledge.ensureEntity("organization", "워너 브라더스", now);
  const [first, second, both] = [await record("작품 하나"), await record("작품 둘"), await record("작품 셋")];
  await knowledge.addRelation({ subjectObjectId: first, objectObjectId: english, predicate: studio, now });
  await knowledge.addRelation({ subjectObjectId: second, objectObjectId: korean, predicate: studio, now });
  await knowledge.addRelation({ subjectObjectId: both, objectObjectId: english, predicate: studio, now });
  await knowledge.addRelation({ subjectObjectId: both, objectObjectId: korean, predicate: studio, now });
  return { knowledge, english, korean, first, second, both };
}

const items = async (entityId: string) => (await readConnectionGroups(db, owner, entityId))!.groups.flatMap((group) => group.items.map((item) => item.label)).sort();

describe("the owner corrects people, companies and platforms", () => {
  test("merging moves every link once, keeps the merged name as an alternate name, and redirects its old id", async () => {
    const { knowledge, english, korean } = await twoSpellings();
    const curation = new D1EntityCurationRepository(db, owner);
    expect(await curation.candidates(korean, "warner")).toEqual([expect.objectContaining({ entityId: english, name: "Warner Bros.", links: 2 })]);
    expect(await curation.merge(english, korean, now)).toMatchObject({ entityId: korean, mergedId: english, mergedName: "Warner Bros." });

    expect(await items(korean)).toEqual(["작품 둘", "작품 셋", "작품 하나"]);
    expect(db.sql.prepare("select count(*) as n from v2_relation_edges where object_object_id=? and superseded_at is null").get(korean)).toEqual({ n: 3 });
    expect(db.sql.prepare("select count(*) as n from v2_relation_edges where object_object_id=? and superseded_at is not null").get(english)).toEqual({ n: 1 });
    expect(await curation.alternateNames(korean)).toEqual(["Warner Bros."]);
    expect(await curation.resolve(english)).toBe(korean);
    expect(db.sql.prepare("select action,object_id from v2_audit_events where action='entity.merged'").all()).toEqual([{ action: "entity.merged", object_id: korean }]);
    // The old spelling, from a later import or an old search link, finds the survivor.
    expect(await knowledge.ensureEntity("organization", "warner bros.", now)).toBe(korean);
    const found = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan({ entityFilters: [{ targetObjectId: english }] }));
    expect(found.results.map((result) => result.title).sort()).toEqual(["작품 둘", "작품 셋", "작품 하나"]);
  });

  test("renaming keeps the old name as an alternate name that later records still reach", async () => {
    const { knowledge, english } = await twoSpellings();
    const curation = new D1EntityCurationRepository(db, owner);
    expect(await curation.rename(english, "워너 브라더스 픽처스", now)).toMatchObject({ changed: true });
    expect(db.sql.prepare("select canonical_name from v2_entity_records where object_id=?").get(english)).toEqual({ canonical_name: "워너 브라더스 픽처스" });
    expect(await curation.alternateNames(english)).toEqual(["Warner Bros."]);
    expect(await knowledge.ensureEntity("organization", "Warner Bros.", now)).toBe(english);
    expect(await curation.rename(english, "워너 브라더스 픽처스", now)).toMatchObject({ changed: false });
    await expect(curation.rename(english, " ", now)).rejects.toMatchObject({ code: "entity_name_invalid" });
  });

  test("a merge needs two active entities of the same owner and never touches another owner", async () => {
    const { english, korean } = await twoSpellings();
    const foreign = await new D1ImportedKnowledgeRepository(db, other).ensureEntity("organization", "Warner Bros.", now);
    const curation = new D1EntityCurationRepository(db, owner);
    await expect(curation.merge(english, english, now)).rejects.toMatchObject({ code: "entity_merge_invalid" });
    await expect(curation.merge(foreign, korean, now)).rejects.toMatchObject({ code: "entity_not_found" });
    await expect(curation.merge(english, foreign, now)).rejects.toMatchObject({ code: "entity_not_found" });
    expect(await curation.candidates(korean, "warner")).not.toContainEqual(expect.objectContaining({ entityId: foreign }));
    await curation.merge(english, korean, now);
    await expect(curation.merge(english, korean, now)).rejects.toMatchObject({ code: "entity_not_found" });
    expect(db.sql.prepare("select lifecycle_status from v2_objects where id=?").get(foreign)).toEqual({ lifecycle_status: "active" });
  });

  test("merging into an entity that is later merged again keeps every old name pointing at the final one", async () => {
    const { english, korean } = await twoSpellings();
    const third = await new D1ImportedKnowledgeRepository(db, owner).ensureEntity("organization", "워너브러더스 코리아", now);
    const curation = new D1EntityCurationRepository(db, owner);
    await curation.merge(english, korean, now);
    await curation.merge(korean, third, now);
    expect(await curation.alternateNames(third)).toEqual(["Warner Bros.", "워너 브라더스"]);
    expect(await curation.resolve(english)).toBe(third);
    expect(await items(third)).toEqual(["작품 둘", "작품 셋", "작품 하나"]);
  });
});
