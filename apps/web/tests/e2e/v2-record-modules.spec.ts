import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/v2-lab?surface=record-modules");
  await expect(page.getByRole("heading", { name: "기록 맞춤 보기 검증", exact: true })).toBeVisible();
}
async function choose(page: Page, mode: string) { await page.getByRole("combobox", { name: "보기 시험 조건", exact: true }).selectOption(mode); }
function moduleView(page: Page) { return page.locator('[data-module-state="full"]'); }
async function expectCanonical(page: Page) {
  await expect(page.getByRole("article", { name: "원문", exact: true })).toContainText("이 원문은 맞춤 보기가 실패해도 유지된다.");
  await expect(page.getByTestId("module-knowledge").getByRole("heading", { name: "내 기록", exact: true })).toBeVisible();
  await expect(page.getByText("내가 쓴 감상은 이곳에 남는다.", { exact: true })).toBeVisible();
}

test("real module retains original-first layout, typed metrics, provenance and keyboard evidence", async ({ page }) => {
  await setup(page); await expectCanonical(page);
  const view = moduleView(page); await expect(view).toHaveCount(1);
  await expect(view).toContainText("5.4"); await expect(view).toContainText("31"); await expect(view).toContainText("148");
  for (const source of ["원문에서 명시함", "사용자가 고정함", "이미지에서 읽음"]) await expect(view.locator(".v2-origin").filter({ hasText: source })).toBeVisible();
  const before = await page.getByRole("article", { name: "원문", exact: true }).evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('[data-module-state="full"]')!) & Node.DOCUMENT_POSITION_FOLLOWING));
  expect(before).toBe(true);
  const summary = view.locator("summary"); await summary.focus(); await page.keyboard.press("Enter");
  await expect(view.getByText("5.4km를 달렸다.", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab"); await expect(view.getByRole("link", { name: "원본 위치로", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page).toHaveURL(/#source-module-audit$/); await expectCanonical(page);
});

for (const mode of ["unknown", "missing", "locked"] as const) {
  test(`${mode} module is omitted without hiding the original or generic fields`, async ({ page }) => {
    await setup(page); await choose(page, mode); await expect(moduleView(page)).toHaveCount(0);
    await expect(page.locator("[data-module-state]")).toHaveCount(0); await expectCanonical(page);
    await expect(page.getByTestId("module-knowledge")).not.toContainText("DO NOT RENDER");
  });
}

for (const mode of ["version", "malformed", "labels", "list", "oversized"] as const) {
  test(`${mode} fallback isolates the optional view and never displays the malformed payload`, async ({ page }) => {
    await setup(page); await page.getByRole("textbox", { name: "보존할 입력 초안", exact: true }).fill("이 입력은 유지한다.");
    await choose(page, mode); await expect(moduleView(page)).toHaveCount(0);
    const notice = page.getByRole("region", { name: "맞춤 보기 안내", exact: true }); await expect(notice).toBeVisible();
    await expect(notice).toContainText("본문과 기본 정보는 계속 읽을 수 있습니다.");
    if (mode === "version") await expect(notice).toContainText("현재 앱과 보기 형식이 맞지 않습니다.");
    await expect(page.getByTestId("module-knowledge")).not.toContainText("DO NOT RENDER"); await expectCanonical(page);
    await expect(page.getByRole("textbox", { name: "보존할 입력 초안", exact: true })).toHaveValue("이 입력은 유지한다.");
    await choose(page, "normal"); await expect(moduleView(page)).toHaveCount(1); await expect(notice).toHaveCount(0);
  });
}

for (const mode of ["sensitive", "redacted-payload"] as const) {
  test(`${mode} displays only the fixed privacy notice, not metric values or source labels`, async ({ page }) => {
    await setup(page); await choose(page, mode); await expect(moduleView(page)).toHaveCount(0);
    const notice = page.getByRole("region", { name: "민감한 기록의 맞춤 보기", exact: true }); await expect(notice).toBeVisible();
    await expect(notice).not.toContainText("31"); await expect(notice).not.toContainText("148");
    await expect(notice).not.toContainText("사용자가 고정함"); await expect(notice).not.toContainText("DO NOT RENDER");
    await expect(notice.locator(".v2-presented-field")).toHaveCount(0); await expectCanonical(page);
    await choose(page, "normal"); await expect(moduleView(page)).toHaveCount(1);
  });
}

test("a code-owned renderer failure is caught by the actual module boundary without resetting adjacent input", async ({ page }) => {
  await setup(page); await page.getByRole("textbox", { name: "보존할 입력 초안", exact: true }).fill("렌더 오류가 나도 남겨둔 초안");
  await choose(page, "render"); await expect(moduleView(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "맞춤 보기 안내", exact: true })).toBeVisible(); await expectCanonical(page);
  await expect(page.getByRole("textbox", { name: "보존할 입력 초안", exact: true })).toHaveValue("렌더 오류가 나도 남겨둔 초안");
  await expect(page.getByTestId("module-knowledge")).not.toContainText("Synthetic context renderer failure");
  await choose(page, "normal"); await expect(moduleView(page)).toHaveCount(1); await expectCanonical(page);
});

test("the same known module key is rendered only once", async ({ page }) => {
  await setup(page); await choose(page, "duplicate"); await expect(moduleView(page)).toHaveCount(1); await expectCanonical(page);
  await choose(page, "boundary"); await expect(moduleView(page)).toHaveCount(1); await expectCanonical(page);
});

test("actual server JSON transport preserves own special keys in generic fields, module values and evidence metadata", async ({ page }) => {
  await setup(page); await page.getByRole("textbox", { name: "보존할 입력 초안", exact: true }).fill("서버 전송 확인 중에도 이 입력 유지");
  await choose(page, "server-json"); await expectCanonical(page);
  const view = moduleView(page); await expect(view).toHaveCount(1);
  const generic = page.locator(".v2-knowledge-section .v2-presented-field").filter({ has: page.getByText("JSON 보존 기본 정보", { exact: true }) });
  const activity = view.locator(".v2-presented-field").filter({ has: page.getByText("JSON 보존 활동 값", { exact: true }) });
  const unanswered = page.locator(".v2-knowledge-section .v2-presented-field").filter({ has: page.getByText("아직 정하지 않은 여부", { exact: true }) });
  await expect(unanswered.locator(":scope > strong")).toHaveText("값 없음"); await expect(unanswered).not.toContainText("아니요");
  const expectedGeneric = '{"__proto__":{"sentinel":"generic-proto"},"constructor":{"prototype":{"sentinel":"generic-constructor"}},"sentinel":"generic-value","nested":[{"__proto__":"generic-nested"}]}';
  const expectedActivity = '{"__proto__":{"sentinel":"module-proto"},"constructor":{"prototype":{"sentinel":"module-constructor"}},"sentinel":"module-value","nested":[{"__proto__":"module-nested"}]}';
  await expect(generic.locator(":scope > strong")).toHaveText(expectedGeneric); await expect(activity.locator(":scope > strong")).toHaveText(expectedActivity);
  for (const origin of [generic.locator(".v2-origin"), unanswered.locator(".v2-origin"), activity.locator(".v2-origin")]) {
    expect((await origin.boundingBox())!.height).toBeLessThanOrEqual(32);
  }
  await activity.locator("summary").click(); await expect(activity.getByText("서버에서 보낸 근거 문장도 유지된다.", { exact: true })).toBeVisible();
  await expect(activity.getByRole("link", { name: "외부 출처 열기", exact: true })).toHaveAttribute("href", "https://example.com/record-module-evidence?fixture=transport");
  const inspection = page.getByTestId("transport-locator-inspection"); await inspection.locator("summary").click();
  await expect(inspection.locator("pre")).toHaveText('{"url":"https://example.com/record-module-evidence?fixture=transport","__proto__":{"sentinel":"locator-proto"},"constructor":{"sentinel":"locator-constructor"},"sentinel":"locator-value"}');
  await expect(page.getByRole("textbox", { name: "보존할 입력 초안", exact: true })).toHaveValue("서버 전송 확인 중에도 이 입력 유지");
  expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(Object.prototype, "sentinel"))).toBe(false);
  await choose(page, "normal"); await expectCanonical(page); await choose(page, "server-json");
  await expect(activity.locator(":scope > strong")).toHaveText(expectedActivity); await expect(generic.locator(":scope > strong")).toHaveText(expectedGeneric);
  await expect(page.getByRole("textbox", { name: "보존할 입력 초안", exact: true })).toHaveValue("서버 전송 확인 중에도 이 입력 유지");
});

test("long labels, values, source notes and evidence remain readable at 320px without horizontal overflow", async ({ page }, testInfo) => {
  await setup(page); await page.setViewportSize({ width: 320, height: 740 }); await choose(page, "long");
  const view = moduleView(page); await expect(view).toHaveCount(1); await expect(view).toContainText("긴값시작"); await expect(view).toContainText("긴값끝");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await view.locator("summary").click(); await expect(view.getByRole("link", { name: "원본 위치로", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await view.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("record-module-long-320.png"), fullPage: true });
});

for (const mode of ["normal", "version", "sensitive"] as const) {
  test(`${mode} module surface has no scoped accessibility violations`, async ({ page }) => {
    await setup(page); await choose(page, mode);
    expect((await new AxeBuilder({ page }).include("[data-module-state]").analyze()).violations).toEqual([]);
  });
}
