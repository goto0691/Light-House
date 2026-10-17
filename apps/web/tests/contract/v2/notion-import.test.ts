import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readNotionExport } from "@/lib/v2/import/notion-export";
import { importNotionExport } from "@/lib/v2/import/notion-import";
import { readConnectionGroups } from "@/lib/v2/infrastructure/d1/connection-groups-repository";
import { D1PresentationRepository } from "@/lib/v2/infrastructure/d1/presentation-repository";
import { D1TemplateRepository } from "@/lib/v2/infrastructure/d1/template-repository";
import { LinkSqlite } from "../../support/link-sqlite";

const owner = "link-owner";
const now = "2026-10-17T05:00:00.000Z";
const id = (seed: number) => seed.toString(16).padStart(32, "0");
const link = (title: string, seed: number) => `${title} (${encodeURIComponent(`${title} `)}${id(seed)}.md)`;
let db: LinkSqlite;
beforeEach(() => { db = new LinkSqlite(33); });
afterEach(() => db.sql.close());

async function syntheticExport() {
  const zip = new JSZip();
  const csv = (name: string, seed: number, columns: string[], titles: string[]) => zip.file(`${name} ${id(seed)}_all.csv`, `﻿${columns.join(",")}\n${titles.map((title) => `"${title}"${",".repeat(columns.length - 1)}`).join("\n")}\n`);
  zip.file(`작품 A ${id(100)}.md`, `# 작품 A\n\n감독: 감독 갑\n유형: 영화\n장르: 드라마,판타지\n제작사: 회사 을\n영상 로그: ${link("감상 A", 200)}\n`);
  zip.file(`감상 A ${id(200)}.md`, `# 감상 A\n\n3. 네트워크: ${link("친구 병", 900)}\n감독/크리에이터: 감독 갑\n날짜: 2025년 9월 8일\n다시 볼 가치: No\n시청상태: 완료\n장르: 드라마,판타지\n제작사: 회사 을\n컨텐츠 로그: ${link("작품 A", 100)}\n플랫폼: Netflix\n`);
  zip.file(`감상 B ${id(201)}.md`, `# 감상 B\n\n감독/크리에이터: 감독 갑\n날짜: 2025년 9월 21일\n플랫폼: Netflix\n\n짧은 감상 메모.\n`);
  zip.file(`친구 병 ${id(900)}.md`, "# 친구 병\n\n생일: 1월 1일\n주소: 비공개 주소\n");
  zip.file(`운동 ${id(300)}.md`, "# 운동\n\n날짜: 2026년 1월 8일\n운동 종류: 달리기\n");
  zip.file(`일기 ${id(400)}.md`, "# 일기\n\n감정: 기쁨\n날짜: 2026년 2월 1일\n\n비밀 일기.\n");
  csv("컨텐츠 로그", 1, ["이름", "감독", "영상 로그", "유형", "장르", "제작사", "평가", "플랫폼", "한줄평"], ["작품 A"]);
  csv("영상 로그", 2, ["이름", "3. 네트워크", "감독/크리에이터", "날짜", "다시 볼 가치", "리뷰", "시청상태", "유형", "장르", "제작사", "컨텐츠 로그", "평점", "플랫폼"], ["감상 A", "감상 B"]);
  csv("3 네트워크", 3, ["이름", "생일", "주소"], ["친구 병"]);
  csv("운동 로그", 4, ["이름", "날짜", "운동 종류"], ["운동"]);
  csv("일기", 5, ["제목", "감정", "날짜"], ["일기"]);
  return readNotionExport(await zip.generateAsync({ type: "nodebuffer" }));
}

const recordBy = (title: string) => db.sql.prepare(`select d.object_id,d.body_markdown,c.captured_at from v2_documents d join v2_capture_bundles c on c.id=d.capture_id where d.title=?`).get(title) as { object_id: string; body_markdown: string; captured_at: string } | undefined;
const typesOf = (objectId: string) => db.sql.prepare(`select t.key,t.label,a.role,a.review_status from v2_object_type_assignments a join v2_type_definitions t on t.id=a.type_definition_id where a.object_id=?`).all(objectId);

describe("Notion import brings the owner's records in as the owner's own", () => {
  test("imports only mapped databases, each record under its own database type, with typed fields and no AI work", async () => {
    const stats = await importNotionExport(db, owner, await syntheticExport(), { now });
    expect(stats).toMatchObject({ pages: 3, created: 3, byDatabase: { "영상 로그": 2, "컨텐츠 로그": 1 } });
    for (const excluded of ["운동", "일기", "친구 병"]) expect(recordBy(excluded)).toBeUndefined();
    expect(typesOf(recordBy("감상 A")!.object_id)).toEqual([{ key: "video_log", label: "영상 로그", role: "primary", review_status: "accepted" }]);
    expect(typesOf(recordBy("작품 A")!.object_id)).toEqual([{ key: "content_log", label: "컨텐츠 로그", role: "primary", review_status: "accepted" }]);
    expect(db.sql.prepare("select count(*) as n from v2_processing_outbox").get()).toEqual({ n: 0 });

    const record = recordBy("감상 A")!;
    expect(record.captured_at).toBe("2025-09-08T12:00:00.000Z");
    // The record reads as written on its own date, not on the import day; the capture keeps the real save time.
    expect(db.sql.prepare(`select o.created_at,o.updated_at,d.written_at,c.committed_at from v2_objects o join v2_documents d on d.object_id=o.id join v2_capture_bundles c on c.id=d.capture_id where o.id=?`).get(record.object_id))
      .toEqual({ created_at: "2025-09-08T12:00:00.000Z", updated_at: "2025-09-08T12:00:00.000Z", written_at: "2025-09-08T12:00:00.000Z", committed_at: now });
    expect(stats.dated).toBe(3);
    expect(record.body_markdown).toContain("감독/크리에이터: 감독 갑");
    for (const hidden of ["친구 병", "네트워크", "컨텐츠 로그", ".md"]) expect(record.body_markdown).not.toContain(hidden);
    expect(recordBy("감상 B")!.body_markdown).toContain("짧은 감상 메모.");

    const presentation = await new D1PresentationRepository(db, owner).project(record.object_id);
    const fields = presentation.sections.flatMap((section) => section.fields);
    expect(fields.map((field) => [field.label, field.value, field.sourceLabel])).toEqual(expect.arrayContaining([
      ["날짜", "2025-09-08", "원문에서 명시함"], ["다시 볼 가치", false, "원문에서 명시함"], ["장르", "드라마,판타지", "원문에서 명시함"], ["플랫폼", "Netflix", "원문에서 명시함"],
    ]));
    expect(JSON.stringify(presentation)).not.toMatch(/가져온|notion|노션/i);
  });

  test("connects records to people, companies, platforms and each other, grouped by category", async () => {
    const stats = await importNotionExport(db, owner, await syntheticExport(), { now });
    expect(stats).toMatchObject({ pageLinks: 1, mirroredLinks: 1, personLinks: 1, unresolvedLinks: 0 });
    const director = db.sql.prepare(`select object_id from v2_entity_records where entity_kind='person' and canonical_name='감독 갑'`).all() as { object_id: string }[];
    expect(director).toHaveLength(1);
    expect((await readConnectionGroups(db, owner, director[0]!.object_id))!.summary).toEqual([
      { groupKey: "type:video_log", label: "영상 로그", count: 2 }, { groupKey: "type:content_log", label: "컨텐츠 로그", count: 1 },
    ]);
    const work = (await readConnectionGroups(db, owner, recordBy("작품 A")!.object_id))!;
    expect(work.summary).toEqual(expect.arrayContaining([{ groupKey: "type:video_log", label: "영상 로그", count: 1 }, { groupKey: "entity:person", label: "사람", count: 1 }]));
    const friend = db.sql.prepare(`select object_id from v2_entity_records where entity_kind='person' and canonical_name='친구 병'`).get() as { object_id: string };
    expect((await readConnectionGroups(db, owner, friend.object_id))!.groups[0]).toMatchObject({ label: "영상 로그", relationLabels: ["3. 네트워크"], count: 1 });
    expect(JSON.stringify(db.sql.prepare(`select * from v2_entity_records`).all())).not.toContain("비공개 주소");
  });

  test("each category gets one draft input guide from the fields the owner filled most, in the owner's own words", async () => {
    const exported = await syntheticExport();
    expect((await importNotionExport(db, owner, exported, { now })).templates).toEqual(["content_log", "video_log"]);
    const templates = await new D1TemplateRepository(db, owner).list();
    const video = templates.find((template) => template.definition.expectedTypeIds.includes("video_log"))!;
    expect(video).toMatchObject({ name: "영상 로그", origin: "imported", status: "generated_draft", usageCount: 0 });
    expect(await new D1TemplateRepository(db, owner).list({ captureEligibleOnly: true })).toHaveLength(0);
    const items = video.definition.sections.flatMap((section) => section.items);
    expect(items.slice(0, 3).map((item) => item.prompt)).toEqual(expect.arrayContaining(["날짜를 남길까요?", "플랫폼을 남길까요?"]));
    expect(items.every((item) => item.binding?.fieldKey && !("defaultValue" in item))).toBe(true);
    expect(JSON.stringify(video.definition)).not.toMatch(/Netflix|감독 갑|감상 A|notion|노션|가져온/i);
    expect((await importNotionExport(db, owner, exported, { now })).templates).toEqual([]);
    expect(await new D1TemplateRepository(db, owner).list()).toHaveLength(templates.length);
  });

  test("an automatic creation time is the record's date, never an input guide question", async () => {
    const zip = new JSZip();
    zip.file(`1 지식 창고 ${id(7)}_all.csv`, "﻿이름,상태,생성 일시,카테고리\n\"메모 A\",,,\n");
    zip.file(`메모 A ${id(700)}.md`, "# 메모 A\n\n상태: 정리 중\n생성 일시: 2025년 1월 2일 오후 3:04\n카테고리: 개발\n\n본문.\n");
    const stats = await importNotionExport(db, owner, await readNotionExport(await zip.generateAsync({ type: "nodebuffer" })), { now });
    expect(stats.templates).toEqual(["knowledge_note"]);
    expect(recordBy("메모 A")!.captured_at).toBe("2025-01-02T06:04:00.000Z");
    const items = (await new D1TemplateRepository(db, owner).list())[0]!.definition.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.prompt).sort()).toEqual(["정리 상태를 남길까요?", "카테고리를 남길까요?"]);
  });

  test("re-running changes nothing and never overwrites a value the owner corrected", async () => {
    const exported = await syntheticExport();
    await importNotionExport(db, owner, exported, { now });
    const record = recordBy("감상 A")!;
    db.sql.prepare(`update v2_property_values set review_status='superseded',superseded_at=? where owner_object_id=? and field_definition_id=(select id from v2_field_definitions where key='viewing_status')`).run(now, record.object_id);
    db.sql.prepare(`insert into v2_property_values (id,user_id,owner_object_id,field_definition_id,value_kind,value_text,value_json,source_class,claim_risk,review_status,locked_by_user,created_at)
      select 'corrected',?,?,id,'text','다시 보는 중','"다시 보는 중"','user_locked','low','accepted',1,? from v2_field_definitions where key='viewing_status'`).run(owner, record.object_id, now);
    const counts = () => db.sql.prepare(`select (select count(*) from v2_documents) d,(select count(*) from v2_property_values where review_status='accepted') p,(select count(*) from v2_relation_edges) r,(select count(*) from v2_entity_records) e`).get();
    const before = counts();
    const again = await importNotionExport(db, owner, exported, { now });
    expect(again).toMatchObject({ created: 0, replayed: 3, values: 0, valuesKept: 1, pageLinks: 0, personLinks: 0, entityLinks: 0, dated: 0 });
    expect(counts()).toEqual(before);
    expect(db.sql.prepare(`select value_text from v2_property_values where id='corrected'`).get()).toEqual({ value_text: "다시 보는 중" });
  });
});
