import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { readConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1ImportedKnowledgeRepository, ImportedKnowledgeError } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const now = "2026-10-17T00:00:00.000Z";
const contentLog = { key: "notion.content_log", label: "컨텐츠 로그" };
const network = { key: "notion.network", label: "3. 네트워크" };
let db: LinkSqlite;
let imported: D1ImportedKnowledgeRepository;
beforeEach(() => { db = new LinkSqlite(33); imported = new D1ImportedKnowledgeRepository(db, owner); });
afterEach(() => db.sql.close());

async function record(title: string, day: string, privacyLevel: "normal" | "sensitive" | "restricted" = "normal", userId = owner) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "import", title, bodyMarkdown: `${title} 본문`, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel, capturedAt: `${day}T12:00:00.000Z` }, crypto.randomUUID(), `${day}T12:00:01.000Z`);
  await new D1SourceFoundationRepository(db, userId).commitCapture(capture);
  return capture;
}

async function linkedHub() {
  const hub = await record("작품 A", "2026-01-01");
  await imported.assignType(hub.objectId, { key: "notion.content_log", label: "컨텐츠 로그" }, now);
  const videos = [];
  for (const day of ["2026-03-01", "2026-05-01", "2026-04-01"]) {
    const video = await record(`감상 ${day}`, day);
    await imported.assignType(video.objectId, { key: "notion.video_log", label: "영상 로그" }, now);
    await imported.addRelation({ subjectObjectId: video.objectId, objectObjectId: hub.objectId, predicate: contentLog, provenance: { sourceItemId: video.sources[0]!.id, property: "컨텐츠 로그" }, now });
    videos.push(video);
  }
  const game = await record("플레이", "2026-02-01");
  await imported.assignType(game.objectId, { key: "notion.game_log", label: "게임 로그" }, now);
  await imported.addRelation({ subjectObjectId: game.objectId, objectObjectId: hub.objectId, predicate: contentLog, now });
  const diary = await record("민감 일기", "2026-06-01", "sensitive");
  await imported.assignType(diary.objectId, { key: "notion.diary", label: "일기" }, now);
  await imported.addRelation({ subjectObjectId: diary.objectId, objectObjectId: hub.objectId, predicate: contentLog, now });
  const restricted = await record("잠긴 메모", "2026-07-01", "restricted");
  await imported.assignType(restricted.objectId, { key: "notion.secret", label: "비밀 분류" }, now);
  await imported.addRelation({ subjectObjectId: restricted.objectId, objectObjectId: hub.objectId, predicate: contentLog, now });
  const loose = await record("분류 없는 메모", "2026-08-01");
  await imported.addRelation({ subjectObjectId: hub.objectId, objectObjectId: loose.objectId, predicate: { key: "notion.related", label: "관련 기록" }, now });
  return { hub, videos, game, diary, restricted, loose };
}

describe("imported owner structure and grouped connections", () => {
  test("groups a record's connections by the other side's imported category, in both directions", async () => {
    const { hub, videos, loose } = await linkedHub();
    const groups = (await readConnectionGroups(db, owner, hub.objectId))!;
    expect(groups.summary).toEqual([
      { groupKey: "type:notion.video_log", label: "영상 로그", count: 3 },
      { groupKey: "type:notion.game_log", label: "게임 로그", count: 1 },
      { groupKey: "type:unclassified", label: "분류 전", count: 1 },
      { groupKey: "type:notion.diary", label: "일기", count: 1 },
    ]);
    expect(groups.total).toBe(6);
    const video = groups.groups.find((group) => group.groupKey === "type:notion.video_log")!;
    // Newest first, with the source property kept as the relation label.
    expect(video.items.map((item) => item.objectId)).toEqual([videos[1]!.objectId, videos[2]!.objectId, videos[0]!.objectId]);
    expect(video.items[0]).toMatchObject({ relationLabels: ["컨텐츠 로그"], directions: ["incoming"], origins: ["imported"], date: "2026-05-01T12:00:00.000Z" });
    expect(groups.groups.find((group) => group.groupKey === "type:unclassified")!.items[0]).toMatchObject({ objectId: loose.objectId, directions: ["outgoing"] });
  });

  test("never names or counts restricted records and keeps sensitive ones closed", async () => {
    const { hub } = await linkedHub();
    const groups = (await readConnectionGroups(db, owner, hub.objectId))!;
    const serialized = JSON.stringify(groups);
    expect(serialized).not.toContain("잠긴 메모");
    expect(serialized).not.toContain("비밀 분류");
    expect(serialized).not.toContain("민감 일기");
    expect(groups.groups.find((group) => group.groupKey === "type:notion.diary")).toMatchObject({ count: 1, closedSensitiveCount: 1, items: [] });
    const restricted = await record("잠긴 대상", "2026-09-01", "restricted");
    await expect(readConnectionGroups(db, owner, restricted.objectId)).resolves.toBeNull();
    await expect(readConnectionGroups(db, "other-owner", hub.objectId)).resolves.toBeNull();
  });

  test("an entity sees every record linked to it, grouped by category, and AI proposals stay pending", async () => {
    const { hub, videos } = await linkedHub();
    const person = await imported.ensureEntity("person", "사람 A", now);
    await expect(imported.ensureEntity("person", "사람 A", now)).resolves.toBe(person);
    for (const video of videos.slice(0, 2)) await imported.addRelation({ subjectObjectId: video.objectId, objectObjectId: person, predicate: network, now });
    const groups = (await readConnectionGroups(db, owner, person))!;
    expect(groups.summary).toEqual([{ groupKey: "type:notion.video_log", label: "영상 로그", count: 2 }]);
    expect(groups.groups[0]).toMatchObject({ relationLabels: ["3. 네트워크"], items: [expect.objectContaining({ directions: ["incoming"] }), expect.anything()] });

    const guess = await imported.ensureEntity("work", "AI가 본 작품", now);
    db.sql.prepare(`insert into v2_predicate_definitions (id,user_id,key,label,definition,inverse_key,status,origin,schema_version,created_at,updated_at)
      values ('mentions','link-owner','mentions_entity','언급한 대상','AI mention',null,'active','system_seed',1,?,?)`).run(now, now);
    db.sql.prepare(`insert into v2_relation_edges (id,user_id,subject_object_id,predicate_definition_id,object_object_id,source_class,claim_risk,review_status,processing_run_id,locked_by_user,created_at)
      values ('ai-guess','link-owner',?,'mentions',?,'ai_inferred','low','proposed',null,0,?)`).run(hub.objectId, guess, now);
    const hubGroups = (await readConnectionGroups(db, owner, hub.objectId))!;
    expect(hubGroups.pendingCount).toBe(1);
    expect(hubGroups.summary.some((group) => group.groupKey === "entity:work")).toBe(false);
  });

  test("imported writes are idempotent, keep the source property, and never undo a user rejection", async () => {
    const { hub, videos } = await linkedHub();
    await imported.assignType(videos[0]!.objectId, { key: "notion.video_log", label: "영상 로그" }, now);
    await expect(imported.addRelation({ subjectObjectId: videos[0]!.objectId, objectObjectId: hub.objectId, predicate: contentLog, now })).resolves.toBe("exists");
    expect(db.sql.prepare("select count(*) as n from v2_object_type_assignments where object_id=?").get(videos[0]!.objectId)).toEqual({ n: 1 });
    expect(db.sql.prepare("select status,origin,usage_count from v2_type_definitions where user_id=? and key='notion.video_log'").get(owner)).toEqual({ status: "active", origin: "imported", usage_count: 3 });
    expect(db.sql.prepare(`select e.locator_kind,e.locator_json from v2_evidence_refs e join v2_relation_edges r on r.id=e.target_id
      where e.target_kind='relation' and r.subject_object_id=?`).get(videos[0]!.objectId)).toEqual({ locator_kind: "form_field", locator_json: '{"property":"컨텐츠 로그"}' });

    db.sql.prepare("update v2_object_type_assignments set review_status='rejected' where object_id=?").run(videos[0]!.objectId);
    await imported.assignType(videos[0]!.objectId, { key: "notion.video_log", label: "영상 로그" }, now);
    expect(db.sql.prepare("select review_status from v2_object_type_assignments where object_id=?").get(videos[0]!.objectId)).toEqual({ review_status: "rejected" });
    const groups = (await readConnectionGroups(db, owner, hub.objectId))!;
    expect(groups.summary.find((group) => group.groupKey === "type:notion.video_log")!.count).toBe(2);
  });

  test("rejects malformed keys and objects that are not the owner's", async () => {
    const mine = await record("내 기록", "2026-01-02");
    const foreign = await record("남의 기록", "2026-01-03", "normal", "other-owner");
    await expect(imported.assignType(mine.objectId, { key: "영상 로그", label: "영상 로그" }, now)).rejects.toBeInstanceOf(ImportedKnowledgeError);
    await expect(imported.assignType(foreign.objectId, { key: "notion.video_log", label: "영상 로그" }, now)).rejects.toMatchObject({ code: "imported_object_missing" });
    await expect(imported.addRelation({ subjectObjectId: mine.objectId, objectObjectId: foreign.objectId, predicate: contentLog, now })).rejects.toMatchObject({ code: "imported_object_missing" });
  });
});
