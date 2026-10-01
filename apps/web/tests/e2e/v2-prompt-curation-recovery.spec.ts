import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { PromptCurationRecoveryDraft } from "../../src/lib/v2/editor/prompt-curation-draft";
import { curationHarness } from "./support/prompt-curation-harness";

const workspace = (page: Page) => page.getByRole("region", { name: "내 프롬프트 정리본", exact: true });
const recovery = (page: Page) => workspace(page).getByRole("complementary", { name: "정리본 초안 기기 복구", exact: true });
const button = (page: Page, name: string) => workspace(page).getByRole("button", { name, exact: true });
const title = (page: Page) => workspace(page).getByRole("textbox", { name: "정리본 제목", exact: true });
async function open(page: Page) { await button(page, "정리본 열기").click(); await expect(button(page, "새 정리본 만들기")).toBeEnabled(); }
async function add(page: Page, id: string) { await workspace(page).getByRole("combobox", { name: "추가할 원문 조각", exact: true }).selectOption(id); await button(page, "조각 추가").click(); }
async function draft(page: Page, text = "보존할 정리본") { await button(page, "새 정리본 만들기").click(); await title(page).fill(text); await add(page, "manual-1"); }
async function persisted(page: Page) { await expect(recovery(page).getByTestId("link-draft-recovery-status")).toContainText("이 기기에 초안 저장됨"); }
async function restore(page: Page, index = 0) { await recovery(page).getByRole("button", { name: "이 초안 복구", exact: true }).nth(index).click(); await expect(workspace(page).getByRole("status")).toContainText("초안을 복구했습니다"); }
async function saved(page: Page) { await expect(button(page, "정리본 수정")).toBeEnabled(); await expect(title(page)).toHaveCount(0); }
async function rows(page: Page): Promise<{ id: string; generation: number; encrypted: boolean; value?: { kind: string; payload: PromptCurationRecoveryDraft } }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lighthouse_editor_working_copies_v1"); request.onerror = () => reject(new Error("Synthetic IDB read failed"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("links")) { db.close(); resolve([]); return; }
      const read = db.transaction("links").objectStore("links").getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => { reject(new Error("Synthetic rows failed")); db.close(); };
    };
  }));
}

test("reload preserves unfinished curation, exact originals, roles, duplicate order and image links without upload", async ({ page }, info) => {
  const h = await curationHarness(page); await open(page); await draft(page, " ");
  await add(page, "manual-2"); await add(page, "manual-3"); await add(page, "manual-4");
  await button(page, "프롬프트 조각 1 아래로").click(); await button(page, "프롬프트 조각 2 한 번 더 추가").click();
  await workspace(page).getByRole("combobox", { name: "연결할 보관 이미지", exact: true }).selectOption({ label: "synthetic-reference.png" });
  await button(page, "이미지 예시 추가").click();
  await workspace(page).getByRole("combobox", { name: "자료 관계", exact: true }).selectOption("alternatives");
  await persisted(page); const before = (await rows(page))[0].value!.payload;
  expect(before.draft?.content.items.map((item) => item.fragmentId)).toEqual(["manual-2", "manual-1", "manual-3", "manual-4", "manual-1"]);
  expect(before.draft?.originals).toHaveLength(4);
  await page.reload(); await open(page); await expect(title(page)).toHaveCount(0); expect(h.writes).toHaveLength(0);
  await restore(page); await expect(title(page)).toHaveValue(" ");
  expect(await workspace(page).getByLabel("프롬프트 조각 2 원문", { exact: true }).textContent()).toBe(h.manuals[0].fragment.rawText);
  await expect(button(page, "정리본 저장")).toBeDisabled(); await persisted(page);
  expect((await rows(page)).some((row) => JSON.stringify(row.value?.payload) === JSON.stringify(before))).toBe(true);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-prompt-curations").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await workspace(page).screenshot({ path: info.outputPath("curation-recovery-320.png"), scale: "css" });
  await title(page).fill("복구 뒤 정리"); await button(page, "예시 1 삭제").click();
  await button(page, "정리본 저장").click(); await saved(page); await expect.poll(async () => (await rows(page)).length).toBe(0);
  expect(h.writes).toHaveLength(1);
});

test("opening another group parks an independent draft and exact completion cleans only the restored draft", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "첫 번째 독립 초안"); await persisted(page);
  await draft(page, "두 번째 독립 초안"); await persisted(page); expect(await rows(page)).toHaveLength(2);
  await restore(page); await expect(title(page)).toHaveValue("첫 번째 독립 초안");
  await button(page, "정리본 저장").click(); await saved(page);
  await expect.poll(async () => (await rows(page)).map((row) => row.value?.payload.draft?.content.title)).toEqual(["두 번째 독립 초안"]);
  expect(h.writes).toHaveLength(1);
});

test("opt-out blocks an unsafe draft switch but permits explicit server save without durable storage", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "메모리에 남길 입력"); await persisted(page);
  await recovery(page).getByRole("checkbox").uncheck(); await expect.poll(async () => (await rows(page)).length).toBe(0);
  await button(page, "새 정리본 만들기").click(); await expect(workspace(page).getByRole("alert")).toContainText("보존하지 못했습니다");
  await expect(title(page)).toHaveValue("메모리에 남길 입력");
  await button(page, "정리본 저장").click(); await saved(page); expect(h.rows).toHaveLength(1); expect(await rows(page)).toHaveLength(0);
});

test("a lost create receipt survives reload and a newer document and replays the original key", async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  h.onWrite(async (route, request) => { if (h.writes.length !== 1) return false; await h.commit(request); await route.abort("failed"); return true; });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  const pending = (await rows(page))[0].value!.payload.pending;
  h.state = { ...h.state, currentRevisionId: "revision-after-lost" };
  await page.reload(); await page.getByRole("button", { name: "상태 새로고침", exact: true }).click(); await open(page); await restore(page);
  expect(h.writes).toHaveLength(1); await expect(title(page)).toBeDisabled();
  await button(page, "같은 요청 다시 시도").click(); await saved(page);
  expect(h.writes[1]).toEqual(pending?.request); expect(h.rows).toHaveLength(1); await expect.poll(async () => (await rows(page)).length).toBe(0);
});

for (const action of ["edit", "undo", "archive", "unarchive"] as const) test(`lost ${action} request restores the original head and exact operation without duplicate versions`, async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "원래 버전"); await button(page, "정리본 저장").click(); await saved(page);
  if (action === "undo") {
    await button(page, "정리본 수정").click(); await title(page).fill("다음 버전"); await button(page, "새 버전으로 저장").click(); await saved(page);
    await button(page, "정리본 버전 1 보기").click(); await expect(button(page, "이 버전으로 되돌리기")).toBeEnabled();
  } else if (action === "unarchive") { await button(page, "정리본 보관").click(); await expect(button(page, "정리본 보관 해제")).toBeEnabled(); }
  else if (action === "edit") { await button(page, "정리본 수정").click(); await title(page).fill("복구할 새 버전"); }
  const count = h.writes.length;
  h.onWrite(async (route, request) => {
    if (h.writes.length !== count + 1) return false;
    await h.commit(request, h.rows[0].stored.groupKey); await route.abort("failed"); return true;
  });
  await button(page, action === "edit" ? "새 버전으로 저장" : action === "undo" ? "이 버전으로 되돌리기" : action === "archive" ? "정리본 보관" : "정리본 보관 해제").click();
  await expect(workspace(page).getByRole("alert")).toBeVisible(); await persisted(page);
  const pending = (await rows(page))[0].value!.payload;
  expect(pending.draft === null).toBe(action !== "edit"); expect(pending.pending?.kind).toBe("revise");
  await page.reload(); await open(page); await restore(page); expect(h.writes).toHaveLength(count + 1);
  await button(page, "같은 요청 다시 시도").click(); await saved(page);
  expect(h.writes.at(-1)).toEqual(pending.pending?.request); expect(h.rows).toHaveLength(count + 1);
  await expect.poll(async () => (await rows(page)).length).toBe(0);
});

for (const status of [401, 403, 423]) test(`authorization ${status} hides cached input and requires explicit authenticated in-memory resume`, async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page, "숨길 민감한 제목"); await persisted(page);
  await recovery(page).getByRole("checkbox").uncheck();
  h.onRead(async (route) => { if (!new URL(route.request().url()).pathname.endsWith("/curations")) return false; await h.error(route, status, "record_access_denied"); return true; });
  await button(page, "정리본 목록 새로고침").click(); await expect(workspace(page).getByRole("alert")).toContainText("접근 권한"); await expect(title(page)).toHaveCount(0);
  h.onRead(null); await button(page, "권한 확인하고 정리본 불러오기").click();
  await expect(button(page, "이 화면의 숨긴 정리본 초안 다시 열기")).toBeEnabled(); await expect(title(page)).toHaveCount(0); await expect(button(page, "새 정리본 만들기")).toBeDisabled();
  await button(page, "이 화면의 숨긴 정리본 초안 다시 열기").click(); await expect(title(page)).toHaveValue("숨길 민감한 제목");
  expect(h.writes).toHaveLength(0); expect(await rows(page)).toHaveLength(0);
});

for (const privacy of ["sensitive", "restricted"] as const) test(`${privacy} recovery obeys fresh privacy policy and never persists plaintext`, async ({ page }) => {
  const h = await curationHarness(page); h.policy = { ...h.policy, currentVersion: 2, privacyLevel: privacy };
  await open(page); await draft(page, "정책에 따른 비밀 초안"); expect(await rows(page)).toHaveLength(0);
  if (privacy === "sensitive") {
    await recovery(page).getByRole("checkbox").check(); await persisted(page); const stored = await rows(page);
    expect(stored).toHaveLength(1); expect(stored[0].encrypted).toBe(true); expect(stored[0].value).toBeUndefined();
    await page.reload(); await open(page); await expect(recovery(page).getByRole("button", { name: "이 초안 복구", exact: true })).toHaveCount(0);
    await recovery(page).getByRole("checkbox").check(); await restore(page); await expect(title(page)).toHaveValue("정책에 따른 비밀 초안");
  } else { await expect(recovery(page).getByRole("checkbox")).toHaveCount(0); await expect(recovery(page)).toContainText("제한된 기록은 기기에 저장하지 않습니다"); }
  await button(page, "정리본 저장").click(); await saved(page); expect(await rows(page)).toHaveLength(0);
});

for (const damage of ["shape", "content", "prepared", "parent", "image"] as const) test(`a malformed or mismatched successful ${damage} receipt keeps the exact pending and recovery origin`, async ({ page }) => {
  const h = await curationHarness(page); await open(page); await draft(page);
  await workspace(page).getByRole("combobox", { name: "연결할 보관 이미지", exact: true }).selectOption({ label: "synthetic-reference.png" }); await button(page, "이미지 예시 추가").click();
  await persisted(page); await page.reload(); await open(page); await restore(page);
  h.onWrite(async (route, request) => {
    if (h.writes.length !== 1) return false;
    const original = await h.commit(request), item = { ...original,
      ...(damage === "content" ? { content: { ...original.content, title: "다른 제목" } } : {}),
      ...(damage === "prepared" ? { prepared: { ...original.prepared, manifestHash: "0".repeat(64) } } : {}),
      ...(damage === "parent" ? { parentRevisionId: "wrong-parent" } : {}),
      ...(damage === "image" ? { examples: original.examples.map((example) => ({ ...example, sha256: "0".repeat(64) })) } : {}),
    };
    await h.json(route, damage === "shape" ? { contract: "stored-prompt-curation.v1" } : { contract: "stored-prompt-curation.v1", item, replayed: false }, 201); return true;
  });
  await button(page, "정리본 저장").click(); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(title(page)).toHaveValue("보존할 정리본"); await persisted(page);
  expect(await rows(page)).toHaveLength(2); expect((await rows(page)).filter((row) => row.value?.payload.pending)).toHaveLength(1);
  await button(page, "같은 요청 다시 시도").click(); await saved(page); expect(h.rows).toHaveLength(1);
  await expect.poll(async () => (await rows(page)).length).toBe(0);
});
