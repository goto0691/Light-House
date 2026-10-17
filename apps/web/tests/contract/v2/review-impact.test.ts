import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1ReviewRepository } from "@/lib/v2/infrastructure/d1/review-repository";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { reviewImpact, reviewImpactSql } from "@/lib/v2/review/review-impact";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => db.sql.close());

async function record(title: string) {
  const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title, bodyMarkdown: `${title} 본문`, aiEnabled: false,
    clientTimezone: "Asia/Seoul", privacyLevel: "normal", capturedAt: new Date().toISOString() }, crypto.randomUUID());
  await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
  return capture.objectId;
}

const CASES: readonly (readonly [kind: string, payload: string, expected: "high" | "low"])[] = [
  ["high_risk_claim", "{}", "high"],
  ["value_conflict", "{}", "high"],
  ["registry_conflict", '{"target":"field","key":"genre"}', "high"],
  ["registry_conflict", '{"target":"type","key":"movie","action":"reuse"}', "low"],
  ["registry_conflict", '{"target":"type","key":"movie","action":"alias_candidate"}', "high"],
  ["analysis_warning", '{"code":"processing_lease_exhausted"}', "high"],
  ["analysis_warning", '{"code":"attachment_analysis_unavailable"}', "high"],
  ["analysis_warning", '{"message":"unrequested_source_extraction_dropped:1"}', "low"],
  ["analysis_review", '{"code":"type_confirmation"}', "low"],
  ["analysis_review", '{"code":"field_confirmation"}', "low"],
  ["analysis_review", '{"code":"event_confirmation"}', "low"],
  ["analysis_review", '{"code":"entity_resolution","candidates":0}', "low"],
  ["analysis_review", '{"code":"entity_resolution","candidates":1}', "low"],
  ["analysis_review", '{"code":"entity_resolution","candidates":2}', "high"],
  ["analysis_review", '{"code":"entity_resolution","candidates":"2"}', "low"],
  ["analysis_review", '{"code":"entity_resolution"}', "low"],
  ["analysis_review", '{"code":"rating_scale_unclear","message":"척도가 불분명합니다"}', "high"],
  ["analysis_review", "{}", "high"],
  ["analysis_review", "not json", "high"],
];

const parse = (payload: string) => { try { return JSON.parse(payload) as Record<string, unknown>; } catch { return {}; } };
function insert(objectId: string, kind: string, payload: string) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_review_items (id,user_id,object_id,processing_run_id,kind,status,payload_json,created_at) values (?,?,?,null,?,'open',?,?)`)
    .run(id, owner, objectId, kind, payload, new Date().toISOString());
  return id;
}

describe("review impact keeps the inbox for judgment calls", () => {
  test("the TypeScript rule and its SQL form agree on every kind, code and malformed payload", async () => {
    const objectId = await record("검토 기록");
    for (const [kind, payload, expected] of CASES) {
      const id = insert(objectId, kind, payload);
      const sql = db.sql.prepare(`select ${reviewImpactSql("r")} as impact from v2_review_items r where r.id=?`).get(id) as { impact: string };
      expect([kind, payload, reviewImpact(kind, parse(payload)), sql.impact]).toEqual([kind, payload, expected, expected]);
    }
  });

  test("open records report high- and low-impact counts; a record with only routine proposals has no inbox items", async () => {
    const mixed = await record("판단 필요");
    for (const [kind, payload] of CASES) insert(mixed, kind, payload);
    const routine = await record("정리 제안만");
    insert(routine, "analysis_review", '{"code":"field_confirmation"}');
    insert(routine, "analysis_review", '{"code":"entity_resolution","candidates":1}');
    const rows = await new D1ReviewRepository(db, owner).listOpenRecords();
    const high = CASES.filter(([, , expected]) => expected === "high").length;
    expect(rows.find((row) => row.recordId === mixed)).toMatchObject({ openCount: CASES.length, highImpactCount: high, lowImpactCount: CASES.length - high });
    expect(rows.find((row) => row.recordId === routine)).toMatchObject({ openCount: 2, highImpactCount: 0, lowImpactCount: 2 });
  });
});
