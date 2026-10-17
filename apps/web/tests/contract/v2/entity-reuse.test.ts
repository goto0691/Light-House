import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AnalysisEnvelopeV1 } from "@/lib/v2/ai/analysis-envelope-v1";
import { FakeV2StructuredModelGateway } from "@/lib/v2/ai/fake-gateway";
import { runNextAnalysisJob } from "@/lib/v2/ai/processing-runner";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { readConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1ImportedKnowledgeRepository } from "@/lib/v2/infrastructure/d1/imported-knowledge-repository";
import { D1ProcessingQueueRepository } from "@/lib/v2/infrastructure/d1/processing-queue-repository";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => db.sql.close());

type Mention = { kind: string; name: string };
/** Commit a record whose text contains every mention, then analyze it with a fake provider that proposes them. */
async function analyze(mentions: readonly Mention[], userId = owner) {
  const text = `기록: ${mentions.map((mention) => mention.name).join(", ")} 이야기.`;
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "감상", bodyMarkdown: text, aiEnabled: true,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, userId).commitCapture(capture);
  const source = capture.sources[0]!;
  const envelope: AnalysisEnvelopeV1 = {
    contract_version: "analysis-v1", capture_id: capture.captureId, analyzed_revision_id: capture.revisionId, language: "ko", bundle_summary: "합성",
    document_proposals: [{ temp_id: "doc", source_item_ids: [source.id], suggested_title: null, type_assignments: [] }],
    entity_proposals: mentions.map((mention, index) => {
      const start = text.indexOf(mention.name);
      return { temp_id: `entity-${index}`, entity_kind: mention.kind, mention: mention.name, resolution_status: "local_candidate" as const,
        evidence_refs: [{ source_item_id: source.id, start, end: start + mention.name.length }] };
    }),
    event_proposals: [], field_proposals: [], enrichment_requests: [], review_items: [], warnings: [],
  };
  const queue = new D1ProcessingQueueRepository(db);
  await queue.dispatchPending(10);
  await expect(runNextAnalysisJob({ queue, gateway: new FakeV2StructuredModelGateway("success", envelope), workerId: crypto.randomUUID() })).resolves.toMatchObject({ outcome: "succeeded" });
  return capture;
}

const entities = (name: string) => db.sql.prepare(`select e.object_id,o.lifecycle_status,o.user_id from v2_entity_records e join v2_objects o on o.id=e.object_id where e.canonical_name=? order by e.created_at`).all(name) as { object_id: string; lifecycle_status: string; user_id: string }[];
const mentionsOf = (recordId: string) => db.sql.prepare(`select r.id,r.object_object_id,r.review_status from v2_relation_edges r where r.subject_object_id=? and r.source_class='ai_inferred'`).all(recordId) as { id: string; object_object_id: string; review_status: string }[];
const entityReviews = (recordId: string) => (db.sql.prepare(`select id,payload_json from v2_review_items where object_id=? and status='open'`).all(recordId) as { id: string; payload_json: string }[])
  .map((row) => ({ id: row.id, payload: JSON.parse(row.payload_json) as { code: string; entityObjectId: string; reusedExisting: boolean; relationId: string } }))
  .filter((row) => row.payload.code === "entity_resolution");

describe("AI mentions reuse the one existing entity of the same kind and name", () => {
  test("a later record links to the entity an earlier record created, and both records group under it", async () => {
    const first = await analyze([{ kind: "person", name: "미야자키 하야오" }]);
    const second = await analyze([{ kind: "person", name: "미야자키하야오" }]);
    const [director] = entities("미야자키 하야오");
    expect(entities("미야자키하야오")).toEqual([]);
    expect(mentionsOf(second.objectId)).toEqual([expect.objectContaining({ object_object_id: director!.object_id, review_status: "proposed" })]);
    expect(entityReviews(first.objectId)[0]!.payload).toMatchObject({ entityObjectId: director!.object_id, reusedExisting: false });
    expect(entityReviews(second.objectId)[0]!.payload).toMatchObject({ entityObjectId: director!.object_id, reusedExisting: true });
    expect(db.sql.prepare(`select count(*) as n from v2_evidence_refs where target_kind='entity' and target_id=?`).get(director!.object_id)).toEqual({ n: 2 });

    // Unconfirmed links stay pending; confirming each review groups both records under the person.
    expect((await readConnectionGroups(db, owner, director!.object_id))).toMatchObject({ total: 0, pendingCount: 2 });
    const reviews = new D1ReviewRepository(db, owner);
    for (const record of [first, second]) await reviews.resolve(entityReviews(record.objectId)[0]!.id, { action: "accept" });
    expect((await readConnectionGroups(db, owner, director!.object_id))!.summary).toEqual([{ groupKey: "type:unclassified", label: "분류 전", count: 2 }]);
  });

  test("repeated mentions inside one record become one link with every evidence span", async () => {
    const record = await analyze([{ kind: "platform", name: "Netflix" }, { kind: "platform", name: "netflix" }]);
    expect(entities("Netflix")).toHaveLength(1);
    expect(entities("netflix")).toEqual([]);
    expect(mentionsOf(record.objectId)).toHaveLength(1);
    expect(entityReviews(record.objectId)).toHaveLength(1);
    expect(db.sql.prepare(`select count(*) as n from v2_evidence_refs where target_kind='relation' and target_id=?`).get(mentionsOf(record.objectId)[0]!.id)).toEqual({ n: 2 });
  });

  test("imported people are reused, but other kinds, other owners, archived and ambiguous names are not", async () => {
    const imported = new D1ImportedKnowledgeRepository(db, owner);
    const friend = await imported.ensureEntity("person", "친구 A", new Date().toISOString());
    const withFriend = await analyze([{ kind: "person", name: "친구 A" }]);
    expect(mentionsOf(withFriend.objectId)[0]!.object_object_id).toBe(friend);

    await analyze([{ kind: "organization", name: "파라마운트" }]);
    await analyze([{ kind: "work", name: "파라마운트" }]);
    expect(entities("파라마운트")).toHaveLength(2);

    await analyze([{ kind: "person", name: "다른 사람" }], "other-owner");
    await analyze([{ kind: "person", name: "다른 사람" }]);
    expect(new Set(entities("다른 사람").map((entity) => entity.user_id))).toEqual(new Set(["other-owner", owner]));

    const twins = await analyze([{ kind: "person", name: "동명 B" }]);
    const original = mentionsOf(twins.objectId)[0]!.object_object_id;
    db.sql.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values ('twin-b','link-owner','entity','active','2026-01-01','2026-01-01')`).run();
    db.sql.prepare(`insert into v2_entity_records (object_id,proposal_temp_id,processing_run_id,entity_kind,canonical_name,resolution_status,created_at) values ('twin-b',null,null,'person','동명 B','local_candidate','2026-01-01')`).run();
    const ambiguous = await analyze([{ kind: "person", name: "동명 B" }]);
    const created = mentionsOf(ambiguous.objectId)[0]!.object_object_id;
    expect([original, "twin-b"]).not.toContain(created);

    db.sql.prepare(`update v2_objects set lifecycle_status='archived' where id=?`).run(friend);
    const afterArchive = await analyze([{ kind: "person", name: "친구 A" }]);
    expect(mentionsOf(afterArchive.objectId)[0]!.object_object_id).not.toBe(friend);
  });

  test("only an ambiguous mention (two or more same-name candidates) reaches the inbox", async () => {
    await analyze([{ kind: "person", name: "단일 후보" }]);
    const single = await analyze([{ kind: "person", name: "단일 후보" }]);
    expect(entityReviews(single.objectId)[0]!.payload).toMatchObject({ candidates: 1, reusedExisting: true });
    for (const id of ["twin-1", "twin-2"]) {
      db.sql.prepare(`insert into v2_objects (id,user_id,object_kind,lifecycle_status,created_at,updated_at) values (?,'link-owner','entity','active','2026-01-01','2026-01-01')`).run(id);
      db.sql.prepare(`insert into v2_entity_records (object_id,proposal_temp_id,processing_run_id,entity_kind,canonical_name,resolution_status,created_at) values (?,null,null,'person','동명 E','local_candidate','2026-01-01')`).run(id);
    }
    const ambiguous = await analyze([{ kind: "person", name: "동명 E" }]);
    expect(entityReviews(ambiguous.objectId)[0]!.payload).toMatchObject({ candidates: 2, reusedExisting: false });
    const rows = await new D1ReviewRepository(db, owner).listOpenRecords();
    expect(rows.find((row) => row.recordId === single.objectId)).toMatchObject({ highImpactCount: 0, lowImpactCount: 1 });
    expect(rows.find((row) => row.recordId === ambiguous.objectId)).toMatchObject({ highImpactCount: 1, lowImpactCount: 0 });
  });

  test("rejecting one mention never archives an entity another record still links to", async () => {
    const first = await analyze([{ kind: "work", name: "작품 C" }]);
    const second = await analyze([{ kind: "work", name: "작품 C" }]);
    const [work] = entities("작품 C");
    const reviews = new D1ReviewRepository(db, owner);
    await reviews.resolve(entityReviews(second.objectId)[0]!.id, { action: "reject" });
    expect(mentionsOf(second.objectId)[0]!.review_status).toBe("rejected");
    expect(entities("작품 C")[0]!.lifecycle_status).toBe("active");
    await reviews.resolve(entityReviews(first.objectId)[0]!.id, { action: "reject" });
    expect(mentionsOf(first.objectId)[0]!.review_status).toBe("rejected");
    // The creating record's mention was the last live link, so its own entity is archived as before.
    expect(entities("작품 C")[0]).toMatchObject({ object_id: work!.object_id, lifecycle_status: "archived" });

    const kept = await analyze([{ kind: "work", name: "작품 D" }]);
    const reuser = await analyze([{ kind: "work", name: "작품 D" }]);
    await reviews.resolve(entityReviews(kept.objectId)[0]!.id, { action: "reject" });
    expect(entities("작품 D")[0]!.lifecycle_status).toBe("active");
    expect(mentionsOf(reuser.objectId)[0]!.review_status).toBe("proposed");
  });
});
