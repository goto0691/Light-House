import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

import { notionValueMatches, type AiFieldValue } from "./metrics";
import { analysisMarkdown, notionDateToIso, parsePage, readNotionExport } from "./notion-export";
import { APPROVED_SCOPE, assertScope, selectScope } from "./scope";

const id = (seed: number) => seed.toString(16).padStart(32, "0");
const link = (title: string, seed: number) => `${title} (${encodeURIComponent(`${title} `).replace(/%20$/, "%20")}${id(seed)}.md)`;
const field = (values: Partial<AiFieldValue>): AiFieldValue => ({ key: "k", kind: "text", text: null, number: null, boolean: null, date: null, json: "null", ...values });

test("parses a page's title, property block, decoded relation links and free body", () => {
  const page = parsePage(id(1), `# 작품 A\n\n감독: 감독 B\n3. 네트워크: ${link("친구 C", 7)}\n날짜: 2025년 9월 8일\n\n본문 [다른 글](Other%20${id(9)}.md) 이어짐`);
  assert.equal(page.title, "작품 A");
  assert.deepEqual(page.properties.map((property) => property.name), ["감독", "3. 네트워크", "날짜"]);
  assert.deepEqual(page.properties[1]!.links, [{ title: "친구 C", pageId: id(7) }]);
  assert.match(page.body, /^본문/);
});

test("relation properties and page links never reach the provider text", () => {
  const page = { ...parsePage(id(1), `# 작품 A\n\n감독: 감독 B\n3. 네트워크: ${link("친구 C", 7)}\n\n본문 [다른 글](Other%20${id(9)}.md)`), database: "영상 로그" };
  const text = analysisMarkdown(page);
  assert.ok(text.includes("감독: 감독 B"));
  assert.ok(!text.includes("친구 C") && !text.includes("네트워크") && !text.includes(".md"));
  assert.ok(text.includes("본문 다른 글"));
});

test("Notion dates become the record's local day", () => {
  assert.equal(notionDateToIso("2022년 12월 3일"), "2022-12-03T12:00:00.000Z");
  assert.equal(notionDateToIso("2026년 1월 8일 오후 11:52 (GMT+9)"), "2026-01-08T14:52:00.000Z");
  assert.equal(notionDateToIso("2025년 9월 21일 오전 9:05 (GMT+9) → 오후 1:00"), "2025-09-21T00:05:00.000Z");
  assert.equal(notionDateToIso("언젠가"), null);
});

test("field comparison accepts the same value in another shape and rejects unrelated values", () => {
  assert.ok(notionValueMatches("2022년 12월 3일", field({ kind: "date", date: "2022-12-03" })));
  assert.ok(notionValueMatches("No", field({ kind: "boolean", boolean: 0 })));
  assert.ok(!notionValueMatches("Yes", field({ kind: "boolean", boolean: 0 })));
  assert.ok(notionValueMatches("뮤지컬,애니메이션,판타지", field({ text: "판타지, 뮤지컬, 애니메이션" })));
  assert.ok(notionValueMatches("120", field({ kind: "number", number: 120 })));
  assert.ok(notionValueMatches("드림웍스 애니메이션", field({ text: "드림웍스 애니메이션" })));
  assert.ok(!notionValueMatches("Netflix", field({ text: "Disney+" })));
  assert.ok(!notionValueMatches("완료", field({ text: "미완료 상태" })));
});

async function syntheticExport() {
  const zip = new JSZip();
  const csv = (name: string, seed: number, columns: string[], titles: string[]) => zip.file(`${name} ${id(seed)}_all.csv`, `﻿${columns.join(",")}\n${titles.map((title) => `"${title}"${",".repeat(columns.length - 1)}`).join("\n")}\n`);
  let seed = 100;
  const contents: number[] = [];
  for (let index = 0; index < 20; index += 1) { contents.push(seed); zip.file(`콘텐츠${index} ${id(seed++)}.md`, `# 콘텐츠${index}\n\n유형: 영화\n장르: 드라마\n`); }
  for (let index = 0; index < 20; index += 1) zip.file(`영상${index} ${id(seed++)}.md`, `# 영상${index}\n\n날짜: 2025년 ${1 + (index % 12)}월 ${1 + index}일\n시청상태: 완료\n컨텐츠 로그: ${link(`콘텐츠${index}`, contents[index]!)}\n`);
  for (let index = 0; index < 15; index += 1) zip.file(`게임${index} ${id(seed++)}.md`, `# 게임${index}\n\n개발사: 회사\n플레이 타임: ${index}\n`);
  for (let index = 0; index < 15; index += 1) zip.file(`노트${index} ${id(seed++)}.md`, `# 노트${index}\n\n생성 일시: 2024년 5월 ${1 + index}일 오전 2:33\n\n${"글".repeat(10 + index * 50)}\n`);
  for (let index = 0; index < 8; index += 1) zip.file(`묵상${index} ${id(seed++)}.md`, `# 묵상${index}\n\n본문말씀: 구절\n날짜: 2026년 1월 ${1 + index}일\n\n묵상 글\n`);
  zip.file(`일기0 ${id(seed++)}.md`, "# 일기0\n\n감정: 기쁨\n날짜: 2026년 2월 1일\n\n일기 글\n");
  csv("컨텐츠 로그", 1, ["이름", "유형", "장르", "평가"], contents.map((_, index) => `콘텐츠${index}`));
  csv("영상 로그", 2, ["이름", "날짜", "시청상태", "컨텐츠 로그", "평점"], Array.from({ length: 20 }, (_, index) => `영상${index}`));
  csv("게임 로그", 3, ["이름", "개발사", "플레이 타임", "컨텐츠 로그"], Array.from({ length: 15 }, (_, index) => `게임${index}`));
  csv("1 지식 창고", 4, ["이름", "생성 일시", "유형"], Array.from({ length: 15 }, (_, index) => `노트${index}`));
  csv("묵상", 5, ["본문말씀", "날짜", "라이프 로그", "배경지식"], Array.from({ length: 8 }, () => "구절"));
  csv("도서 로그", 6, ["이름", "날짜", "리뷰"], []);
  csv("일기", 7, ["제목", "감정", "날짜"], ["일기0"]);
  return readNotionExport(await zip.generateAsync({ type: "nodebuffer" }));
}

test("database detection and the approved scope: counts, smoke subset, linked parents, no excluded databases", async () => {
  const exported = await syntheticExport();
  assert.equal([...exported.pages.values()].find((page) => page.title === "묵상0")!.database, "묵상");
  assert.equal([...exported.pages.values()].find((page) => page.title === "일기0")!.database, "일기");
  const scope = selectScope(exported);
  assertScope(scope, exported);
  const count = (set: "smoke" | "standard", database: string) => scope.sets[set].filter((entry) => entry.database === database).length;
  for (const [database, limit] of Object.entries(APPROVED_SCOPE.standard)) assert.equal(count("standard", database), limit, database);
  for (const [database, limit] of Object.entries(APPROVED_SCOPE.smoke)) assert.equal(count("smoke", database), limit, database);
  assert.ok(!scope.sets.standard.some((entry) => entry.database === "일기"));
  const videoDays = scope.sets.standard.filter((entry) => entry.database === "영상 로그").map((entry) => exported.pages.get(entry.pageId)!.properties[0]!.value);
  assert.equal(new Set(videoDays).size, videoDays.length);

  const diary = [...exported.pages.values()].find((page) => page.database === "일기")!;
  assert.throws(() => assertScope({ ...scope, sets: { ...scope.sets, standard: [...scope.sets.standard, { pageId: diary.pageId, database: "일기" }] } }, exported), /scope_entry_not_approved/);
  const extraVideo = [...exported.pages.values()].find((page) => page.database === "영상 로그" && !scope.sets.standard.some((entry) => entry.pageId === page.pageId))!;
  assert.throws(() => assertScope({ ...scope, sets: { ...scope.sets, standard: [...scope.sets.standard, { pageId: extraVideo.pageId, database: "영상 로그" }] } }, exported), /scope_count_exceeded/);
  assert.throws(() => assertScope({ ...scope, sourceSha256: "0".repeat(64) }, exported), /scope_source_mismatch/);
});
