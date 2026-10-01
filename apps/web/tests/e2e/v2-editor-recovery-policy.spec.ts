import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const address = "/v2-lab?surface=editor-policy";
async function setPrivacy(page: Page, value: "normal" | "sensitive" | "restricted", screenshotPath?: string) {
  const privacy = page.getByRole("combobox", { name: "공개 범위", exact: true });
  const title = page.getByRole("textbox", { name: "문서 제목", exact: true });
  const originalTitle = await title.inputValue();
  const narrow = !(await privacy.isVisible());
  if (narrow) {
    const toggle = page.getByRole("button", { name: "기록 정보 열기", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const bounds = await toggle.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await toggle.focus(); await page.keyboard.press("Enter");
    const close = page.getByRole("button", { name: "기록 정보 닫기", exact: true });
    await expect(close).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("complementary", { name: "문서 정보", exact: true })).toHaveAttribute("id", (await close.getAttribute("aria-controls"))!);
    await expect(privacy).toBeVisible();
    expect((await privacy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await privacy.selectOption(value);
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const accessibility = await new AxeBuilder({ page }).include(".v2-editor-header").include(".v2-editor-inspector").analyze();
    expect(accessibility.violations).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (narrow) {
    const close = page.getByRole("button", { name: "기록 정보 닫기", exact: true });
    await close.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "기록 정보 열기", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(title).toBeVisible(); await expect(title).toHaveValue(originalTitle);
  }
}
async function localSnapshot(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((database) => database.name === "lighthouse_editor_working_copies_v1")) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lighthouse_editor_working_copies_v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["copies", "policies"], "readonly");
      const request = <T,>(pending: IDBRequest<T>) => new Promise<T>((resolve, reject) => { pending.onsuccess = () => resolve(pending.result); pending.onerror = () => reject(pending.error); });
      const key = JSON.stringify(["policy-audit-owner", "policy-audit-record"]);
      const copies = await request(tx.objectStore("copies").index("by-owner-record").getAll(key));
      const policy = await request(tx.objectStore("policies").get(key));
      return { copies, policy };
    } finally { db.close(); }
  });
}

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.route("**/api/v2/records/policy-audit-record/revisions", (route) => route.abort("internetdisconnected"));
});

test("a locked policy page purges another editor tab and rejects its late normal save, then a newer normal page permits recovery", async ({ page, context }, testInfo) => {
  await page.goto(address);
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill("잠금 전 합성 복구 사본");
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [{ encrypted: false, value: { title: "잠금 전 합성 복구 사본" } }] });
  const locked = await context.newPage();
  await locked.goto(`${address}&policy=locked`);
  await expect(locked.getByRole("heading", { name: "합성 잠금 기록" })).toBeVisible();
  await expect.poll(() => localSnapshot(locked)).toMatchObject({ copies: [], policy: { serverVersion: 2, serverPrivacy: "restricted", localFloor: 2 } });
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill("정책 뒤 늦은 일반 평문");
  await expect(page.locator(".v2-editor-local-copy")).toContainText("기기 복구 사본 사용이 제한되었습니다");
  expect((await localSnapshot(page))?.copies).toEqual([]);
  await locked.screenshot({ path: testInfo.outputPath("locked-recovery-policy.png"), fullPage: true });

  const returned = await context.newPage();
  await returned.goto(`${address}&policy=returned`);
  await returned.getByRole("textbox", { name: "문서 제목", exact: true }).fill("새 일반 revision의 복구 사본");
  await expect.poll(() => localSnapshot(returned)).toMatchObject({ copies: [{ encrypted: false, value: { title: "새 일반 revision의 복구 사본", baseVersion: 3 } }], policy: { serverVersion: 3, localFloor: 0 } });
});

test("unsaved sensitive selection removes plaintext, consent encrypts, and a weaker tab cannot erase or recreate plaintext", async ({ page, context }, testInfo) => {
  await page.goto(address);
  const stale = await context.newPage(); await stale.goto(address);
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill("민감 전환 전 사본");
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [{ encrypted: false }] });
  await setPrivacy(page, "sensitive", testInfo.outputPath("editor-record-info.png"));
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [], policy: { serverVersion: 1, localFloor: 1 } });
  const consent = page.getByRole("checkbox", { name: "이 기기에 암호화해 편집 사본 저장", exact: true });
  await expect(consent).not.toBeChecked(); await consent.check();
  await page.getByRole("textbox", { name: "문서 제목", exact: true }).fill("암호화한 합성 민감 사본");
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [{ encrypted: true }] });
  const encrypted = (await localSnapshot(page))!.copies[0];
  expect(encrypted).not.toHaveProperty("value");
  await stale.getByRole("textbox", { name: "문서 제목", exact: true }).fill("늦은 탭의 평문 입력");
  await expect(stale.locator(".v2-editor-local-copy")).toContainText("기기 복구 사본 사용이 제한되었습니다");
  await expect.poll(() => localSnapshot(stale)).toMatchObject({ copies: [{ encrypted: true }] });
  await consent.uncheck();
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [] });
});

test("successful privacy revisions advance the policy without requiring a page reload", async ({ page }) => {
  let version = 1;
  await page.route("**/api/v2/records/policy-audit-record/revisions", (route) => {
    version += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ outcome: "saved", revisionId: `policy-revision-${version}`, version, savedAt: "2026-09-08T08:00:00.000Z" }) });
  });
  await page.goto(address);
  await setPrivacy(page, "restricted");
  await page.getByRole("button", { name: "지금 저장", exact: true }).click();
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [], policy: { serverVersion: 2, serverPrivacy: "restricted", localFloor: 2 } });
  await setPrivacy(page, "normal");
  await page.getByRole("button", { name: "지금 저장", exact: true }).click();
  await expect.poll(() => localSnapshot(page)).toMatchObject({ copies: [], policy: { serverVersion: 3, serverPrivacy: "normal", localFloor: 0 } });
});

test("an old-version tab blocking protection shows an error and closing it allows a retry", async ({ page, context }) => {
  await page.goto("/v2-lab?surface=manual-links");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lighthouse_editor_working_copies_v1", 1);
      request.onupgradeneeded = () => {
        const copies = request.result.createObjectStore("copies", { keyPath: "id" }); copies.createIndex("by-owner-record", "ownerRecord");
        request.result.createObjectStore("keys", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    (window as unknown as { oldEditorDatabase: IDBDatabase }).oldEditorDatabase = db;
  });
  const locked = await context.newPage();
  await locked.goto(`${address}&policy=locked`);
  await expect(locked.locator(".v2-product-error")).toContainText("다른 편집 창을 닫고");
  await page.evaluate(() => (window as unknown as { oldEditorDatabase: IDBDatabase }).oldEditorDatabase.close());
  await locked.reload();
  await expect.poll(() => localSnapshot(locked)).toMatchObject({ copies: [], policy: { serverVersion: 2, localFloor: 2 } });
  await expect(locked.locator(".v2-product-error")).toHaveCount(0);
});
