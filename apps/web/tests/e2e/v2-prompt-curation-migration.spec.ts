import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { canonicalLinkJson, linkSha256Hex } from "../../src/lib/v2/domain/link-snapshot-v1";
import { migrationHarness } from "./support/prompt-curation-migration-harness";

const panel = (page: Page) => page.getByRole("region", { name: "현재 자료로 가져오기 확인", exact: true });
const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const preview = (page: Page) => page.getByRole("button", { name: "현재 자료로 가져오기 미리보기", exact: true }).click();
const check = (page: Page) => panel(page).getByRole("checkbox").check();
const save = (page: Page) => panel(page).getByRole("button", { name: "확인한 내용으로 새 정리본 저장", exact: true }).click();

test("explicit migration previews exact roles, duplicates and images, then opens the saved snapshot", async ({ page }, testInfo) => {
  const m = await migrationHarness(page); await preview(page);
  await expect(panel(page)).toBeVisible(); expect(m.writes).toHaveLength(0);
  await expect(panel(page).getByRole("button", { name: "확인한 내용으로 새 정리본 저장", exact: true })).toBeDisabled();
  await expect(panel(page)).toContainText("AI가 선택했던 범위");
  await expect(panel(page).getByLabel("프롬프트 이관 원문 1", { exact: true })).toHaveText(m.source.items[0].fragment.rawText, { useInnerText: false });
  expect(await panel(page).getByLabel("프롬프트 이관 원문 2", { exact: true }).textContent()).toBe(m.source.items[1].fragment.rawText);
  await expect(panel(page).getByRole("region", { name: "이관할 예시 이미지", exact: true })).toContainText("이미지 전체 해시·형식·크기 일치");
  await panel(page).screenshot({ path: testInfo.outputPath("migration-preview.png"), scale: "css" });
  await check(page); await save(page);
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  const saved = m.h.rows[1].stored;
  expect(saved.basedOnRevisionId).toBe(m.source.id); expect(saved.parentRevisionId).toBeNull(); expect(saved.revisionNumber).toBe(1);
  expect(saved.content.items[0].fragmentId).toBe(saved.content.items[1].fragmentId);
  expect(saved.items.map((row) => row.fragment.rawText)).toEqual(m.source.items.map((row) => row.fragment.rawText));
  expect(saved.prepared.channels.prompt.warnings).toContain("partial_source");
  expect(m.h.rows[0].stored).toEqual(m.source);
  expect(Object.keys(m.writes[0]).sort()).toEqual(["expectedRevisionId", "expectedSnapshotId", "expectedManifestHash", "expectedPlanHash", "groupKey", "idempotencyKey"].sort());
  await panel(page).getByRole("button", { name: "저장된 자료 버전 열기", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "자료 버전", exact: true })).toHaveValue("snapshot-three");
  await page.getByRole("button", { name: `정리본 보기 · ${m.source.title}`, exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: "정리본 수정", exact: true })).toBeEnabled();
});

test("320px preview is keyboard operable, accessible, and has no horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const m = await migrationHarness(page); await preview(page);
  const confirmation = panel(page).getByRole("checkbox"); await confirmation.focus(); await page.keyboard.press("Space");
  await expect(confirmation).toBeChecked(); await page.keyboard.press("Tab");
  await expect(panel(page).getByRole("button", { name: "확인한 내용으로 새 정리본 저장", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-curation-migration").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await panel(page).screenshot({ path: testInfo.outputPath("migration-320.png"), scale: "css" }); expect(m.writes).toHaveLength(0);
});

for (const failure of ["missing", "range_changed", "ambiguous_image"] as const) test(`incomplete ${failure} plans show the issue and prohibit all writes`, async ({ page }) => {
  const m = await migrationHarness(page);
  m.h.state = { ...m.h.state, members: failure === "missing" ? m.h.state.members.filter((row) => row.memberKey !== "prompt")
    : m.h.state.members.map((row) => failure === "range_changed" && row.memberKey === "prompt" ? { ...row, rawText: `changed${row.rawText}` }
      : failure === "ambiguous_image" && row.memberKey === "image" ? { ...row, attachments: [...row.attachments, { ...row.attachments[0], id: "ambiguous-image" }] } : row) };
  await preview(page); await expect(panel(page).getByRole("status")).toContainText("일부만 저장하지 않습니다");
  await expect(panel(page).getByRole("checkbox")).toBeDisabled();
  await expect(panel(page).getByRole("button", { name: "확인한 내용으로 새 정리본 저장", exact: true })).toBeDisabled(); expect(m.writes).toHaveLength(0);
});

for (const status of [401, 403, 423, 404]) test(`a denied migration POST ${status} closes the preview and exact source`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await check(page);
  m.onWrite(async (route) => { await route.fulfill({ status, contentType: "text/html", body: "Denied" }); return true; });
  await save(page); await expect(workspace(page).getByRole("alert")).toContainText("접근 권한이나 잠금 상태");
  await expect(panel(page)).toHaveCount(0); await expect(workspace(page).getByRole("article", { name: "정리본 상세" })).toHaveCount(0);
  expect(m.h.rows).toHaveLength(1);
});

test("a lost committed response retries the identical request and creates only one new group", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await check(page);
  m.onWrite(async (route, body) => { await m.commit(body); await route.abort("failed"); m.onWrite(null); return true; });
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await panel(page).getByRole("button", { name: "같은 이관 요청 다시 시도", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes).toHaveLength(2); expect(m.writes[1]).toEqual(m.writes[0]); expect(m.h.rows).toHaveLength(2);
});

test("failed preview recheck and closing do not discard a lost-response request key", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await check(page);
  m.onWrite(async (route, body) => { await m.commit(body); await route.abort("failed"); m.onWrite(null); return true; });
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  m.onPreview(async (route) => { await m.h.error(route, 503, "synthetic_unavailable"); return true; });
  await panel(page).getByRole("button", { name: "이관 미리보기 다시 확인", exact: true }).click();
  await expect(workspace(page).getByRole("alert")).toContainText("아직 준비되지 않았습니다");
  await panel(page).getByRole("button", { name: "이관 확인 닫기 · 저장 목록에서 결과 확인", exact: true }).click();
  m.onPreview(null); await preview(page); await check(page);
  await panel(page).getByRole("button", { name: "같은 이관 요청 다시 시도", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes).toHaveLength(2); expect(m.writes[1]).toEqual(m.writes[0]); expect(m.h.rows).toHaveLength(2);
});

for (const status of [403, 423, 503]) test(`destination GET ${status} purges only access-denied data`, async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await check(page); await save(page);
  await expect(panel(page).getByRole("button", { name: "저장된 자료 버전 열기", exact: true })).toBeVisible();
  m.h.onRead(async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/links")) return false;
    await route.fulfill({ status, contentType: "text/html", body: "Unavailable" }); return true;
  });
  await panel(page).getByRole("button", { name: "저장된 자료 버전 열기", exact: true }).click();
  await expect(page.getByRole("region", { name: "링크 정리", exact: true }).getByRole("alert")).toBeVisible();
  if (status === 503) await expect(panel(page)).toBeVisible();
  else { await expect(panel(page)).toHaveCount(0); await expect(workspace(page)).toHaveCount(0); }
});

test("409 requires a new preview and unchecked confirmation, never automatic save", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await check(page);
  m.h.state = { ...m.h.state, currentRevisionId: "revision-after-preview" };
  await save(page); await expect(panel(page).getByRole("status")).toContainText("자동으로 재이관하지 않습니다");
  await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
  await panel(page).getByRole("button", { name: "이관 미리보기 다시 확인", exact: true }).click();
  await expect(panel(page).getByRole("checkbox")).toBeEnabled(); await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
  expect(m.writes).toHaveLength(1); await check(page); await save(page);
  await expect(panel(page).getByRole("status")).toContainText("새 정리본을 저장했습니다");
  expect(m.writes[1].expectedRevisionId).toBe("revision-after-preview");
});

for (const kind of ["plan_hash", "target", "selection_confirmation", "receipt_raw"] as const) test(`tampered ${kind} response is not trusted`, async ({ page }) => {
  const m = await migrationHarness(page);
  if (kind !== "receipt_raw") m.onPreview(async (route) => {
    const plan = await m.plan();
    if (kind === "plan_hash") plan.planHash = "0".repeat(64);
    else {
      if (kind === "target") plan.expectedSnapshotId = "wrong-target";
      else plan.selectionConfirmations = [];
      const { planHash: ignored, ...body } = plan; void ignored; plan.planHash = await linkSha256Hex(canonicalLinkJson(body));
    }
    await m.h.json(route, plan); return true;
  });
  await preview(page);
  if (kind === "receipt_raw") {
    await check(page); m.onWrite(async (route, body) => {
      const receipt = structuredClone(await m.commit(body));
      await m.h.json(route, { ...receipt, item: { ...receipt.item, items: receipt.item.items.map((row, index) => index ? row : { ...row, fragment: { ...row.fragment, rawText: "wrong text" } }) } }); return true;
    }); await save(page);
  }
  await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "저장된 자료 버전 열기", exact: true })).toHaveCount(0);
  if (kind !== "receipt_raw") { await expect(panel(page)).toHaveCount(0); expect(m.writes).toHaveLength(0); }
});

test("late migration response after selecting another snapshot cannot replace that view", async ({ page }) => {
  const m = await migrationHarness(page); await preview(page); await check(page);
  let release!: () => void, finished!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; }), delivered = new Promise<void>((resolve) => { finished = resolve; });
  m.onWrite(async (route, body) => { const receipt = await m.commit(body); await hold; await m.h.json(route, receipt).catch(() => {}); finished(); return true; });
  try {
    await save(page); await expect.poll(() => m.writes.length).toBe(1);
    await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption("snapshot-three");
    await expect(page.getByRole("combobox", { name: "자료 버전", exact: true })).toHaveValue("snapshot-three");
    release(); await delivered; await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(panel(page)).toHaveCount(0); await expect(workspace(page).getByRole("article", { name: "정리본 상세" })).toHaveCount(0);
  } finally { release(); }
});
