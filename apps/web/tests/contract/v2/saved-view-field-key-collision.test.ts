import { afterEach, describe, expect, test } from "vitest";
import { prepareCaptureCommit } from "@/lib/v2/domain/capture-source";
import { D1SourceFoundationRepository } from "@/lib/v2/infrastructure/d1/source-foundation-repository";
import { D1RetrievalRepository } from "@/lib/v2/infrastructure/d1/retrieval-repository";
import { D1SavedViewRepository } from "@/lib/v2/infrastructure/d1/saved-view-repository";
import { savedViewFieldCatalog } from "@/lib/v2/infrastructure/d1/saved-view-field-catalog";
import { defaultV2QueryPlan } from "@/lib/v2/retrieval/query-plan-v1";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner", now = "2026-09-12T10:00:00.000Z", databases: LinkSqlite[] = [];
const keys = ["captured_at", "written_at", "updated_at", "type"] as const;
const metadataLabels = { captured_at: "보관일", written_at: "작성일", updated_at: "수정일", type: "분류" };
afterEach(() => { for (const db of databases.splice(0)) db.sql.close(); });
function database() { const db = new LinkSqlite(32); databases.push(db); return db; }
function field(db: LinkSqlite, key: string) {
  const id = crypto.randomUUID(), label = `사용자 정의 ${key}`;
  db.sql.prepare(`insert into v2_field_definitions(id,user_id,key,label,definition,data_type,status,origin,created_at,updated_at)
    values(?,?,?,?,?,'short_text','active','user_created',?,?)`).run(id, owner, key, label, "Existing registry field, not record metadata", now, now);
  return { id, label };
}
async function record(db: LinkSqlite) {
  const prepared = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Classification fixture", bodyMarkdown: "No derived claim",
    aiEnabled: false, privacyLevel: "normal", clientTimezone: "Asia/Seoul", capturedAt: now }, crypto.randomUUID(), now);
  await new D1SourceFoundationRepository(db, owner).commitCapture(prepared); return prepared;
}
function classification(db: LinkSqlite, objectId: string, key: string, label: string, options: { role: string; source: string; locked: number; review: string; usage: number }) {
  const id = crypto.randomUUID();
  db.sql.prepare(`insert into v2_type_definitions(id,user_id,key,label,applies_to_kind,status,origin,definition,usage_count,created_at,updated_at)
    values(?,?,?,?,'document','active','user_created',?,?,?,?)`).run(id, owner, key, label, label, options.usage, now, now);
  db.sql.prepare(`insert into v2_object_type_assignments(id,user_id,object_id,type_definition_id,role,source_class,review_status,locked_by_user,created_at,updated_at)
    values(?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), owner, objectId, id, options.role, options.source, options.review, options.locked, now, now);
}

describe("existing bare field keys must not silently become newly introduced metadata fields", () => {
  test.each(keys)("preserves a real accepted user-locked %s property selected by an existing saved view", async (key) => {
    const db = database(), definition = field(db, key), value = `USER PROPERTY ${key} · not metadata`;
    const capture = await prepareCaptureCommit({ draftId: crypto.randomUUID(), channel: "web", title: "Collision fixture", bodyMarkdown: "Exact source stays intact",
      aiEnabled: false, privacyLevel: "normal", clientTimezone: "Asia/Seoul", capturedAt: now }, crypto.randomUUID(), now);
    await new D1SourceFoundationRepository(db, owner).commitCapture(capture);
    const propertyId = crypto.randomUUID();
    // This is valid current schema, not a damaged fixture: no trigger/index is removed.
    db.sql.prepare(`insert into v2_property_values(id,user_id,owner_object_id,field_definition_id,value_kind,value_json,value_text,
      source_class,claim_risk,review_status,locked_by_user,created_at)
      values(?,?,?,?,'text',?,?,'user_locked','low','accepted',1,?)`).run(propertyId, owner, capture.objectId, definition.id, JSON.stringify(value), value, now);
    const saved = await new D1SavedViewRepository(db, owner).create({
      name: `Existing ${key} view`, description: null, iconKey: "type.collection",
      queryPlan: defaultV2QueryPlan({ propertyFilters: [{ fieldKey: key, operator: "eq", value }] }),
      display: { layout: "table", density: "compact", groupBy: null, visibleFields: [key] },
    }, now);
    expect(saved).not.toBeNull();
    const before = db.sql.prepare("select total_changes() as n").get()!.n;
    const result = await new D1RetrievalRepository(db, owner).searchPage(saved!.queryPlan, false, 1, saved!.display.visibleFields);
    expect(result.totalCount).toBe(1); expect(result.results[0].recordId).toBe(capture.objectId);
    expect(db.sql.prepare("select total_changes() as n").get()!.n).toBe(before);
    // Membership already used this exact property, so the displayed value must
    // not switch to another domain solely because its key resembles metadata.
    expect(result.results[0].displayFields).toEqual([{ fieldKey: key, label: definition.label, state: "value", values: [{
      propertyId, value, renderer: "text", unit: null, sourceLabel: "사용자 잠금", lockedByUser: true,
    }] }]);
    const token = `@record.${key}`;
    const both = await new D1RetrievalRepository(db, owner).searchPage(saved!.queryPlan, false, 1, [key, token]);
    expect(both.totalCount).toBe(1); expect(both.results[0].displayFields?.[0]).toEqual(result.results[0].displayFields?.[0]);
    const present = key === "captured_at" || key === "updated_at";
    expect(both.results[0].displayFields?.[1]).toEqual({ fieldKey: token, label: metadataLabels[key], state: present ? "value" : "missing",
      values: present ? [{ propertyId: null, value: now, renderer: "date", unit: null, sourceLabel: "기록 메타데이터", lockedByUser: false }] : [] });
    expect(db.sql.prepare("select total_changes() as n").get()!.n).toBe(before);
  });

  test("keeps the four legitimate owner registry keys discoverable in the dynamic catalog", async () => {
    const db = database(); for (const key of keys) field(db, key);
    const result = await savedViewFieldCatalog(db, owner, "", 1);
    expect(result.totalCount).toBe(4);
    expect(result.fields).toEqual([...keys].sort().map((key) => ({ key, label: `사용자 정의 ${key}` })));
  });

  test("classification grouping follows the accepted locked secondary instead of a popular AI primary", async () => {
    const db = database(), captured = await record(db);
    classification(db, captured.objectId, "popular_ai", "Popular AI primary", { role: "primary", source: "ai", locked: 0, review: "accepted", usage: 100 });
    classification(db, captured.objectId, "locked_user", "Locked user secondary", { role: "secondary", source: "user", locked: 1, review: "accepted", usage: 1 });
    const page = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan({ typeKeys: ["popular_ai"] }), false, 1, ["@record.type"]);
    expect(page.totalCount).toBe(1);
    // SearchResults.groupLabel(type) uses this exact typeLabel for every layout.
    expect(page.results[0]).toMatchObject({ typeKey: "locked_user", typeLabel: "Locked user secondary" });
    expect(page.results[0].displayFields?.[0]).toMatchObject({ fieldKey: "@record.type", state: "value",
      values: [{ value: "Locked user secondary", sourceLabel: "사용자가 분류", lockedByUser: true }] });
  });

  test("classification grouping does not assert an unconfirmed proposed-only type as an established classification", async () => {
    const db = database(), captured = await record(db);
    classification(db, captured.objectId, "proposal_only", "Unconfirmed AI proposal", { role: "inferred", source: "ai", locked: 0, review: "proposed", usage: 100 });
    const page = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan({ typeKeys: ["proposal_only"] }), false, 1, ["@record.type"]);
    expect(page.totalCount).toBe(1); expect(page.results[0].typeKey).toBeNull(); expect(page.results[0].typeLabel).not.toBe("Unconfirmed AI proposal");
    expect(page.results[0].displayFields?.[0]).toMatchObject({ fieldKey: "@record.type", state: "missing", values: [] });
  });

  test("classification grouping exposes a tied locked classification conflict instead of selecting one arbitrary label", async () => {
    const db = database(), captured = await record(db);
    classification(db, captured.objectId, "locked_one", "First locked type", { role: "secondary", source: "user", locked: 1, review: "accepted", usage: 100 });
    classification(db, captured.objectId, "locked_two", "Second locked type", { role: "secondary", source: "user", locked: 1, review: "accepted", usage: 1 });
    const page = await new D1RetrievalRepository(db, owner).searchPage(defaultV2QueryPlan(), false, 1, ["@record.type"]);
    const item = page.results[0]; expect(page.totalCount).toBe(1); expect(item.typeKey).toBeNull();
    expect(item.typeLabel).toBe("분류 확인 필요"); expect(item.typeLabel).not.toBe("First locked type"); expect(item.typeLabel).not.toBe("Second locked type");
    expect(item.displayFields?.[0].state).toBe("conflict");
    expect(item.displayFields?.[0].values.map((value) => value.value).sort()).toEqual(["First locked type", "Second locked type"]);
  });
});
