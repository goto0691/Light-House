import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { CreatePromptCurationRequest, RevisePromptCurationRequest } from "../../src/lib/v2/domain/prompt-curation-request";
import { copyPromptCuration } from "../../src/lib/v2/domain/prompt-curation-v1";
import { curationHarness } from "./support/prompt-curation-harness";

const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
async function open(page: Page) { await workspace(page).getByRole("button", { name: "정리본 열기", exact: true }).click(); await expect(workspace(page).getByRole("button", { name: "새 정리본 만들기", exact: true })).toBeEnabled(); }
async function add(page: Page, id: string) {
  await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption(id);
  await workspace(page).getByRole("button", { name: "조각 추가", exact: true }).click();
}
async function draft(page: Page, title = "다시 쓰고 싶은 창가 프롬프트") {
  await workspace(page).getByRole("button", { name: "새 정리본 만들기", exact: true }).click();
  await workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true }).fill(title);
  await add(page, "manual-1");
}
async function confirm(page: Page) {
  await workspace(page).getByRole("combobox", { name: "자료 관계", exact: true }).selectOption("continuation");
  await workspace(page).getByRole("checkbox", { name: "이어지는 관계를 확인했습니다", exact: true }).check();
  await workspace(page).getByRole("checkbox", { name: "조각 순서를 확인했습니다", exact: true }).check();
}
async function save(page: Page) { await workspace(page).getByRole("button", { name: "정리본 저장", exact: true }).click(); }
async function saved(page: Page) { await expect(workspace(page).getByRole("button", { name: "정리본 수정", exact: true })).toBeEnabled(); }

for (const rejected of [false, true]) test(`a selected manual fragment beyond page fifty is rechecked before conflict recovery: rejected=${rejected}`, async ({ page }) => {
  const h = await curationHarness(page);
  h.manuals = Array.from({ length: 55 }, (_, index) => ({ ...h.manuals[0], id: `manual-long-${index}`, fragmentKey: `long-${index}` }));
  await open(page); await workspace(page).getByRole("button", { name: "새 정리본 만들기", exact: true }).click();
  await workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true }).fill("긴 원문 목록의 선택");
  const more = workspace(page).getByRole("button", { name: "이전 원문 조각 더 보기", exact: true });
  await more.click(); await expect(more).toBeEnabled(); await more.click(); await add(page, "manual-long-54");
  h.manuals = h.manuals.map((row) => row.id === "manual-long-54" ? { ...row, stateVersion: 2, reviewStatus: rejected ? "rejected" : "confirmed" } : row);
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await workspace(page).getByRole("button", { name: "최신 상태 확인", exact: true }).click();
  const apply = workspace(page).getByRole("button", { name: "확인한 최신 버전에 입력 적용", exact: true }); await expect(apply).toBeEnabled();
  expect(h.reads.some((url) => url.includes("/fragments/manual-long-54?snapshotId="))).toBe(true);
  await apply.click();
  if (rejected) {
    await expect(workspace(page).getByRole("alert")).toContainText("동일 원문과 현재 상태");
    await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveValue("긴 원문 목록의 선택");
    expect(h.rows).toHaveLength(0);
  } else {
    await expect(workspace(page).getByRole("button", { name: "정리본 저장", exact: true })).toBeEnabled();
    await workspace(page).getByRole("button", { name: "프롬프트 조각 1 한 번 더 추가", exact: true }).click();
    await save(page); await saved(page);
    expect(h.rows[0].stored.content.items.map((row) => row.expectedFragmentStateVersion)).toEqual([2, 2]);
  }
});

test("the narrow 320px editor supports keyboard input and two-column touch reordering without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const h = await curationHarness(page); await open(page); await draft(page);
  const title = workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true }); await title.focus(); await page.keyboard.press("Tab");
  await expect(workspace(page).getByRole("combobox", { name: "자료 관계", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const relationship = workspace(page).getByRole("checkbox", { name: "이어지는 관계를 확인했습니다", exact: true }); await expect(relationship).toBeFocused();
  await page.keyboard.press("Space"); await expect(relationship).toBeChecked();
  const row = workspace(page).locator("[data-curation-item]").first();
  // Keyboard focus can still be smooth-scrolling the viewport. Compare both
  // controls in one synchronous layout read, not two different scroll frames.
  const [up, down] = await row.locator(".v2-curation-actions > button").evaluateAll((buttons) => buttons.slice(0, 2).map((button) => {
    const bounds = button.getBoundingClientRect(); return { label: button.getAttribute("aria-label"), height: bounds.height, x: bounds.x, right: bounds.right, y: bounds.y };
  }));
  expect(up.label).toBe("프롬프트 조각 1 위로"); expect(down.label).toBe("프롬프트 조각 1 아래로");
  expect(up.height).toBeGreaterThanOrEqual(44); expect(down.height).toBeGreaterThanOrEqual(44);
  expect(down.y).toBe(up.y); expect(down.x).toBeGreaterThanOrEqual(up.right);
  expect(await title.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-prompt-curations").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await workspace(page).screenshot({ path: testInfo.outputPath("curation-editor-320.png"), scale: "css" }); expect(h.writes).toHaveLength(0);
});

test("a late copy response after a parent revision change cannot reach clipboard or fallback", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page); await confirm(page); await save(page); await saved(page);
  let release!: () => void, finished!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; }), delivered = new Promise<void>((resolve) => { finished = resolve; });
  h.onRead(async (route) => {
    if (!route.request().url().includes("/copy?")) return false;
    const receipt = { contract: "stored-prompt-curation.v1", revisionId: h.rows[0].stored.id, ...await copyPromptCuration(h.rows[0].input, { role: "prompt", mode: "available_only" }) };
    await hold; await h.json(route, receipt).catch(() => {}); finished(); return true;
  });
  try {
    await workspace(page).getByRole("button", { name: "프롬프트 확보한 조각만 복사", exact: true }).click();
    await expect.poll(() => h.reads.filter((url) => url.includes("/copy?")).length).toBe(1);
    h.state = { ...h.state, currentRevisionId: "revision-after-copy" };
    const listReads = h.reads.filter((url) => new URL(url).pathname.endsWith("/curations")).length;
    await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
    // No unsaved edit exists, so a successful new-basis refresh is not a
    // conflict. Its new catalog request proves the old scope was cancelled.
    await expect.poll(() => h.reads.filter((url) => new URL(url).pathname.endsWith("/curations")).length).toBe(listReads + 1);
    release(); await delivered;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBeUndefined();
    await expect(workspace(page).getByRole("button", { name: "복사할 원문 직접 선택", exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("historical AI run on the current snapshot still permits manual curation, unlike a past snapshot", async ({ page }) => {
  const h = await curationHarness(page);
  h.state = { ...h.state, isHistorical: true, selectedRun: h.state.runHistory.items.find((row) => row.id === "run-one")!,
    capabilities: { ...h.state.capabilities, canCreateSnapshot: false, canCreateManualFragment: true, canAnalyze: false, canReview: false, reason: "link_history_read_only" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await open(page); await draft(page); await save(page); await saved(page);
  await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption("snapshot-one");
  await expect(workspace(page).getByRole("button", { name: "새 정리본 만들기", exact: true })).toBeDisabled();
  await expect(workspace(page).getByRole("button", { name: "정리본 수정", exact: true })).toHaveCount(0);
  expect(h.writes).toHaveLength(1);
});

for (const damaged of ["hash", "revision"] as const) test(`an incorrectly scoped or damaged copy receipt is never copied: ${damaged}`, async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page); await confirm(page); await save(page); await saved(page);
  h.onRead(async (route) => {
    if (!route.request().url().includes("/copy?")) return false;
    const receipt = { contract: "stored-prompt-curation.v1", revisionId: h.rows[0].stored.id, ...await copyPromptCuration(h.rows[0].input, { role: "prompt", mode: "available_only" }) };
    await h.json(route, { ...receipt, ...(damaged === "hash" ? { sha256: "0".repeat(64) } : { revisionId: "wrong-revision" }) }); return true;
  });
  await workspace(page).getByRole("button", { name: "프롬프트 확보한 조각만 복사", exact: true }).click();
  await expect(workspace(page).getByRole("alert")).toContainText("정확 문자열과 해시");
  expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBeUndefined();
  await expect(workspace(page).getByRole("button", { name: "복사할 원문 직접 선택", exact: true })).toHaveCount(0);
});

test("manual save during a curation request refreshes its catalog once the request finishes", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page); await confirm(page); await save(page); await saved(page);
  await page.getByRole("button", { name: "수동 발췌 열기", exact: true }).click();
  const input = page.getByRole("textbox", { name: "발췌 범위 선택", exact: true }); await input.click(); await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift"); for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  await expect(page.getByLabel("선택한 발췌 미리보기", { exact: true })).toBeVisible();
  let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
  h.onRead(async (route) => { if (!route.request().url().includes("/copy?")) return false; await hold; return false; });
  try {
    await workspace(page).getByRole("button", { name: "프롬프트 확보한 조각만 복사", exact: true }).click();
    await expect.poll(() => h.reads.filter((url) => url.includes("/copy?")).length).toBe(1);
    const reads = h.reads.filter((url) => url.includes("/fragments?")).length;
    await page.getByRole("button", { name: "선택 범위 발췌 저장", exact: true }).click();
    await expect(page.locator(".v2-manual-fragments").getByRole("status")).toContainText("저장했습니다");
    expect(h.manualWrites).toHaveLength(1); release();
    await expect.poll(() => h.reads.filter((url) => url.includes("/fragments?")).length).toBe(reads + 1);
    await workspace(page).getByRole("button", { name: "새 정리본 만들기", exact: true }).click();
    const picker = workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true });
    await expect(picker.locator('option[value="saved-manual-1"]')).toHaveCount(1);
    await add(page, "saved-manual-1");
    await expect(workspace(page).getByLabel("프롬프트 조각 1 원문", { exact: true })).toHaveText(h.manuals[0].fragment.rawText);
  } finally { release(); }
});

test("a prepared conflict recovery cannot reapply permissions after the parent changes again", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "오래된 확인을 적용하지 않기");
  h.state = { ...h.state, currentRevisionId: "revision-second" };
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await workspace(page).getByRole("button", { name: "최신 상태 확인", exact: true }).click();
  const apply = workspace(page).getByRole("button", { name: "확인한 최신 버전에 입력 적용", exact: true }); await expect(apply).toBeEnabled();
  h.state = { ...h.state, currentRevisionId: "revision-third", capabilities: { ...h.state.capabilities, canCreateSnapshot: false, canCreateManualFragment: false, reason: "v2_write_disabled" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(apply).toHaveCount(0);
  await expect(workspace(page).getByRole("button", { name: "정리본 저장", exact: true })).toBeDisabled();
  await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveValue("오래된 확인을 적용하지 않기");
  expect(h.writes).toHaveLength(1); expect(h.rows).toHaveLength(0);
});

test("edit, history selection, append-only undo and archive retain the original versions", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "첫 정리본"); await confirm(page); await save(page); await saved(page);
  const original = structuredClone(h.rows[0].stored);
  await workspace(page).getByRole("button", { name: "정리본 수정", exact: true }).click();
  await workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true }).fill("다듬은 정리본");
  await add(page, "manual-2");
  await expect(workspace(page).getByRole("checkbox", { name: "조각 순서를 확인했습니다", exact: true })).not.toBeChecked();
  await confirm(page);
  await workspace(page).getByRole("button", { name: "새 버전으로 저장", exact: true }).click(); await saved(page);
  await workspace(page).getByRole("button", { name: "정리본 버전 1 보기", exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: "이 버전으로 되돌리기", exact: true })).toBeEnabled();
  await workspace(page).getByRole("button", { name: "이 버전으로 되돌리기", exact: true }).click(); await saved(page);
  expect(h.rows).toHaveLength(3); expect(h.rows[2].stored.content).toEqual(original.content);
  expect(h.rows[2].stored).toMatchObject({ revisionNumber: 3, basedOnRevisionId: original.id, parentRevisionId: h.rows[1].stored.id, changeReason: "undo" });
  await workspace(page).getByRole("button", { name: "정리본 보관", exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: "정리본 보관 해제", exact: true })).toBeEnabled();
  await workspace(page).getByRole("button", { name: "정리본 보관 해제", exact: true }).click(); await saved(page);
  expect(h.rows.map((row) => row.stored.changeReason)).toEqual(["create", "edit", "undo", "archive", "unarchive"]);
  expect(h.rows[0].stored).toEqual(original); expect(h.rows.at(-1)?.stored.status).toBe("active");
});

test("a revision conflict preserves input until fresh state is explicitly applied and separately saved", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "충돌 뒤에도 남을 입력");
  h.state = { ...h.state, currentRevisionId: "revision-conflict" };
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveValue("충돌 뒤에도 남을 입력");
  expect(h.rows).toHaveLength(0);
  await workspace(page).getByRole("button", { name: "최신 상태 확인", exact: true }).click();
  const apply = workspace(page).getByRole("button", { name: "확인한 최신 버전에 입력 적용", exact: true }); await expect(apply).toBeEnabled();
  expect(h.writes).toHaveLength(1); await apply.click();
  await expect(workspace(page).getByRole("button", { name: "정리본 저장", exact: true })).toBeEnabled();
  expect(h.writes).toHaveLength(1);
  await save(page); await saved(page);
  expect(h.writes[1]).toMatchObject({ expectedRevisionId: "revision-conflict", content: { title: "충돌 뒤에도 남을 입력" } });
  expect(h.writes[1].idempotencyKey).not.toBe(h.writes[0].idempotencyKey);
});

test("curation and revision pagination reaches records older than fifty without losing the selected history", async ({ page }) => {
  const h = await curationHarness(page);
  const request: CreatePromptCurationRequest = { expectedRevisionId: h.state.currentRevisionId!, expectedSnapshotId: h.state.currentSnapshotId!,
    expectedManifestHash: h.state.selectedSnapshot!.manifestHash, idempotencyKey: "seed-create", groupKey: "seed-group",
    content: { title: "이력이 긴 정리본", relationKind: "continuation", relationshipConfirmation: "user_confirmed", orderConfirmation: "user_confirmed",
      items: [{ itemKey: "seed-item", fragmentId: "manual-1", expectedFragmentStateVersion: 1, copyRole: "prompt", position: 0 }], examples: [] } };
  await h.commit(request);
  for (let i = 1; i <= 50; i++) {
    const prior = h.rows.at(-1)!.stored;
    const edit: RevisePromptCurationRequest = { expectedRevisionId: request.expectedRevisionId, expectedSnapshotId: request.expectedSnapshotId,
      expectedManifestHash: request.expectedManifestHash, idempotencyKey: `seed-edit-${i}`, expectedCurationRevisionId: prior.id,
      expectedCurationRevisionNumber: prior.revisionNumber, action: "edit", content: request.content };
    await h.commit(edit, "seed-group");
  }
  for (let i = 1; i <= 50; i++) await h.commit({ ...request, groupKey: `group-${i}`, idempotencyKey: `create-${i}`, content: { ...request.content, title: `별도 정리본 ${i}` } });
  await open(page);
  const more = workspace(page).getByRole("button", { name: "이전 정리본 더 보기", exact: true });
  await more.click(); await expect(more).toBeEnabled(); await more.click();
  await workspace(page).getByRole("button", { name: "정리본 보기 · 이력이 긴 정리본", exact: true }).click();
  const older = workspace(page).getByRole("button", { name: "이전 정리본 버전 더 보기", exact: true });
  await older.click(); await expect(older).toBeEnabled(); await older.click();
  await workspace(page).getByRole("button", { name: "정리본 버전 1 보기", exact: true }).click();
  await expect(workspace(page).getByRole("button", { name: "정리본 버전 1 보기", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(workspace(page).getByRole("button", { name: "이 버전으로 되돌리기", exact: true })).toBeEnabled();
  expect(h.writes).toHaveLength(0);
});

test("curation roles, ordering, intentional duplicates, image links and exact server copy form one usable flow", async ({ page }, testInfo) => {
  const h = await curationHarness(page); expect(h.reads).toHaveLength(0); expect(h.writes).toHaveLength(0);
  await open(page); await draft(page); await add(page, "manual-2"); await add(page, "manual-3"); await add(page, "manual-4");
  await workspace(page).getByRole("button", { name: "프롬프트 조각 1 아래로", exact: true }).click();
  await workspace(page).getByRole("button", { name: "프롬프트 조각 2 한 번 더 추가", exact: true }).click();
  await confirm(page);
  await workspace(page).getByRole("combobox", { name: "연결할 보관 이미지", exact: true }).selectOption({ label: "synthetic-reference.png" });
  await workspace(page).getByRole("button", { name: "이미지 예시 추가", exact: true }).click();
  await save(page); await saved(page);
  expect(h.writes).toHaveLength(1);
  const request = h.writes[0] as CreatePromptCurationRequest;
  expect(request.content.items.filter((item) => item.copyRole === "prompt").map((item) => item.fragmentId)).toEqual(["manual-2", "manual-1", "manual-1"]);
  expect(request.content.items.filter((item) => item.copyRole === "negative_prompt")).toHaveLength(1);
  expect(request.content.items.filter((item) => item.copyRole === "parameters")).toHaveLength(1);
  expect(request.content.examples).toMatchObject([{ itemKey: null, memberId: "member-image", attachmentId: "analysis-image-file", evidenceMethod: "unresolved" }]);
  expect(JSON.stringify(request)).not.toContain("rawText");
  await expect(workspace(page).getByRole("button", { name: "프롬프트 이어 복사", exact: true })).toBeDisabled();
  await workspace(page).getByRole("button", { name: "프롬프트 확보한 조각만 복사", exact: true }).click();
  const exact = [h.manuals[1].fragment.rawText, h.manuals[0].fragment.rawText, h.manuals[0].fragment.rawText].join("\n");
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe(exact);
  expect(h.reads.at(-1)).toContain("/copy?channel=prompt");
  await workspace(page).getByRole("button", { name: "네거티브 프롬프트 확보한 조각만 복사", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe(h.manuals[2].fragment.rawText);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-prompt-curations").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await workspace(page).screenshot({ path: testInfo.outputPath("curation-saved.png"), scale: "css" });
});

test("collapse and reopening retain draft input, while AI interpretations are not selectable source fragments", async ({ page }, testInfo) => {
  const h = await curationHarness(page); await open(page); await draft(page, "보관하지 않은 초안");
  const picker = workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true });
  await expect(picker.locator('option[value="insight-one"]')).toHaveCount(0);
  await expect(picker.locator('option[value="prompt-one"]')).toHaveCount(1);
  await workspace(page).getByRole("button", { name: "정리본 편집 접기", exact: true }).click();
  await workspace(page).getByRole("button", { name: "정리본 편집 펼치기", exact: true }).click();
  await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveValue("보관하지 않은 초안");
  await expect(workspace(page).getByRole("button", { name: "프롬프트 조각 1 삭제", exact: true })).toBeEnabled();
  expect(h.writes).toHaveLength(0);
  await workspace(page).screenshot({ path: testInfo.outputPath("curation-editor.png"), scale: "css" });
});

test("a lost save response retries the identical request key and does not create a duplicate group", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page); await confirm(page);
  h.onWrite(async (route, request) => {
    if (h.writes.length !== 1) return false;
    await h.commit(request); await route.abort("failed"); return true;
  });
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveValue("다시 쓰고 싶은 창가 프롬프트");
  await expect(workspace(page).getByRole("button", { name: "정리본 저장", exact: true })).toBeDisabled();
  await workspace(page).getByRole("button", { name: "같은 요청 다시 시도", exact: true }).click(); await saved(page);
  expect(h.writes).toHaveLength(2); expect(h.writes[1]).toEqual(h.writes[0]); expect(h.rows).toHaveLength(1);
});

test("declared complete parts enable standard copy without asserting the complete external thread", async ({ page }) => {
  const h = await curationHarness(page);
  h.state = { ...h.state, members: h.state.members.map((member, index) => index === 0 ? { ...member, manualLink: {
    ...member.manualLink!, completeness: "complete", partNumber: 1, totalParts: 1,
  } } : member) };
  h.manuals = h.manuals.map((row) => ({ ...row, fragment: { ...row.fragment, completeness: "complete" } }));
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await open(page); await draft(page); await confirm(page); await save(page); await saved(page);
  await workspace(page).getByRole("button", { name: "프롬프트 이어 복사", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe(h.manuals[0].fragment.rawText);
  expect(h.rows[0].stored.prepared.channels.prompt.coverage).toMatchObject({ status: "declared_parts_present", externalScope: "unverified" });
});

test("alternative versions require per-item images and never enable joined prompt copy", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  await workspace(page).getByRole("combobox", { name: "자료 관계", exact: true }).selectOption("alternatives");
  await workspace(page).getByRole("combobox", { name: "연결할 보관 이미지", exact: true }).selectOption({ label: "synthetic-reference.png" });
  await expect(workspace(page).getByRole("button", { name: "이미지 예시 추가", exact: true })).toBeDisabled();
  await workspace(page).getByRole("combobox", { name: "예시 연결 대상", exact: true }).selectOption({ label: "프롬프트 조각 1" });
  await workspace(page).getByRole("button", { name: "이미지 예시 추가", exact: true }).click();
  await workspace(page).getByRole("checkbox", { name: "예시 1 이미지 대응을 확인했습니다", exact: true }).check();
  await save(page); await saved(page);
  expect(h.rows[0].stored.content.examples[0]).toMatchObject({ itemKey: h.rows[0].stored.content.items[0].itemKey, evidenceMethod: "user_confirmed" });
  await expect(workspace(page).getByRole("button", { name: "프롬프트 이어 복사", exact: true })).toBeDisabled();
  await expect(workspace(page).getByRole("button", { name: "프롬프트 확보한 조각만 복사", exact: true })).toBeDisabled();
});

for (const [status, code] of [[401, "unauthorized"], [403, "forbidden"], [423, "restricted_record_locked"], [404, "record_not_found"]] as const) {
  test(`access loss ${status} closes curation draft and sensitive source contents`, async ({ page }) => {
    const h = await curationHarness(page); await open(page); await draft(page, "잠금 후 남으면 안 되는 초안");
    h.onWrite(async (route) => { await h.error(route, status, code); return true; });
    await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
    await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveCount(0);
    await expect(workspace(page).getByText(h.manuals[0].fragment.rawText, { exact: true })).toHaveCount(0);
    expect(h.rows).toHaveLength(0);
  });
}

test("non-JSON authentication failure is handled privately rather than retaining the edit form", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  h.onWrite(async (route) => { await route.fulfill({ status: 401, contentType: "text/html", body: "login required" }); return true; });
  await save(page); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveCount(0);
});

test("clipboard fallback performs another authorized copy read and cannot expose contents after lock", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page); await confirm(page); await save(page); await saved(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await workspace(page).getByRole("button", { name: "프롬프트 확보한 조각만 복사", exact: true }).click();
  const fallback = workspace(page).getByRole("button", { name: "복사할 원문 직접 선택", exact: true }); await expect(fallback).toBeVisible();
  const copies = h.reads.filter((url) => url.includes("/copy?")).length;
  h.onRead(async (route) => { if (!route.request().url().includes("/copy?")) return false; await h.error(route, 423, "restricted_record_locked"); return true; });
  await fallback.click(); await expect(workspace(page).getByRole("alert")).toBeVisible();
  expect(h.reads.filter((url) => url.includes("/copy?")).length).toBe(copies + 1);
  await expect(fallback).toHaveCount(0); await expect(workspace(page).getByRole("button", { name: "정리본 수정", exact: true })).toHaveCount(0);
});

test("a late save response cannot announce success for a different current document revision", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  h.onWrite(async (route, request) => { const item = await h.commit(request); await pending; await h.json(route, { contract: "stored-prompt-curation.v1", item, replayed: false }, 201).catch(() => {}); return true; });
  try {
    await save(page); await expect.poll(() => h.writes.length).toBe(1);
    h.state = { ...h.state, currentRevisionId: "revision-newer" };
    await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
    release(); await expect(workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true })).toHaveValue("다시 쓰고 싶은 창가 프롬프트");
    await expect(workspace(page).getByRole("button", { name: "정리본 수정", exact: true })).toHaveCount(0);
  } finally { release(); }
});
