import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const sourceUrl = "https://www.threads.com/@example/post/manual-fixture?xmt=preserved-source";
const original = "  부드러운 역광\nsoft rim light, 🖼️\n\n--ar 3:2  ";

function receipt(draftId: string) {
  return {
    captureId: `capture-${draftId}`, recordId: `record-${draftId}`, revisionId: `revision-${draftId}`,
    attachmentCount: 0, committedAt: "2026-09-08T01:01:00.000Z", aiProcessing: "disabled", processingStatusUrl: "/unused",
  };
}

async function fillManualLink(page: Page) {
  await page.getByRole("button", { name: "링크 자료 추가", exact: true }).click();
  await page.getByLabel("출처 URL 1", { exact: true }).fill(sourceUrl);
  await page.getByLabel(/^출처 원문 1/).fill(original);
  await page.getByRole("combobox", { name: "보관 목적 1", exact: true }).selectOption("prompt");
  await page.getByRole("combobox", { name: "붙여넣은 글의 역할 1", exact: true }).selectOption("prompt");
  await page.getByRole("combobox", { name: "원문 확보 상태 1", exact: true }).selectOption("partial");
}

async function localDraft(page: Page, requestedDraftId?: string) {
  const draftId = requestedDraftId ?? new URL(page.url()).searchParams.get("draftId");
  if (!draftId) return null;
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lighthouse_capture_v1", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction("drafts", "readonly");
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const request = transaction.objectStore("drafts").get(id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }, draftId);
}

async function expectResponsiveAccessibleRegion(page: Page, selector: string) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  const accessibility = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.FLAG_V2_WRITE !== "1", "Requires the explicitly writable local capture harness.");
  // All material and receipts are synthetic. Do not contact source providers from this harness.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? route.continue() : route.abort();
  });
});

test("real Capture preserves manual originals and metadata after reload, then submits with AI disabled", async ({ page }, testInfo) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v2/captures/commit", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(receipt(body.draftId)) });
  });
  await page.goto("/v2/capture");
  await fillManualLink(page);
  await page.getByText("작성자 · 조각 번호 · 시간 범위", { exact: false }).click();
  await page.getByLabel("명시된 작성자 1", { exact: true }).fill("@example");
  await page.getByLabel("조각 번호 1", { exact: true }).fill("2");
  await page.getByLabel("명시된 전체 조각 수 1", { exact: true }).fill("3");
  await expect(page.getByRole("checkbox", { name: /^저장 후 AI 정리/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^저장 후 AI 정리/ })).not.toBeChecked();
  await expect.poll(() => localDraft(page)).toMatchObject({ aiEnabled: false, sourceItems: [{ value: original, metadata: { manualLinkV1: { publisher: "@example", partNumber: 2, totalParts: 3, role: "prompt" } } }] });
  await page.reload();
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveValue(sourceUrl);
  await expect(page.getByLabel(/^출처 원문 1/)).toHaveValue(original);
  await expect(page.getByRole("combobox", { name: "보관 목적 1", exact: true })).toHaveValue("prompt");
  await expect(page.getByRole("combobox", { name: "원문 확보 상태 1", exact: true })).toHaveValue("partial");
  await expectResponsiveAccessibleRegion(page, ".v2-link-capture");
  await page.screenshot({ path: testInfo.outputPath("manual-capture.png"), fullPage: true });
  await page.getByRole("button", { name: "원본 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "원본 저장 완료", exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ bodyMarkdown: "", aiEnabled: false, sources: [{
    kind: "url", rawText: original, contentHash: createHash("sha256").update(original).digest("hex"),
    metadata: { manualLinkV1: { url: sourceUrl, publisher: "@example", partNumber: 2, totalParts: 3, purpose: "prompt", role: "prompt", completeness: "partial" } },
  }] });
  await expect.poll(() => localDraft(page)).toBeNull();
});

for (const privacy of ["restricted", "sensitive"] as const) {
  test(`real ${privacy} volatile Capture sends the manual link and original without a persistent draft`, async ({ page }) => {
    const requests: Record<string, unknown>[] = [];
    await page.route("**/api/v2/captures/commit", async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(receipt(body.draftId)) });
    });
    await page.goto("/v2/capture");
    await fillManualLink(page);
    await expect.poll(() => localDraft(page)).toMatchObject({ sourceItems: [{ value: original }] });
    await page.getByRole("combobox", { name: "공개 범위", exact: true }).selectOption(privacy);
    if (privacy === "sensitive") await expect(page.getByRole("checkbox", { name: /이 기기에 암호화해 임시 저장/ })).not.toBeChecked();
    await page.getByRole("button", { name: "원본 저장", exact: true }).click();
    await expect(page.getByRole("heading", { name: "원본 저장 완료", exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ privacyLevel: privacy, aiEnabled: false, sources: [{ kind: "url", rawText: original, metadata: { manualLinkV1: { url: sourceUrl, purpose: "prompt", role: "prompt" } } }] });
    await expect.poll(() => localDraft(page)).toBeNull();
  });
}

test("real Capture retains editable original and metadata after server validation rejection", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/v2/captures/commit", async (route) => {
    attempts += 1;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "capture_source_invalid", message: "합성 검사: 조각 범위를 확인해 주세요." } }) });
  });
  await page.goto("/v2/capture");
  await fillManualLink(page);
  await page.getByRole("button", { name: "원본 저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("합성 검사: 조각 범위를 확인해 주세요.");
  await expect(page.getByLabel(/^출처 원문 1/)).toBeEnabled();
  await expect(page.getByLabel(/^출처 원문 1/)).toHaveValue(original);
  await expect.poll(() => localDraft(page)).toMatchObject({ sourceItems: [{ value: original, metadata: { manualLinkV1: { url: sourceUrl, role: "prompt" } } }] });
  await page.reload();
  await expect(page.getByLabel(/^출처 원문 1/)).toHaveValue(original);
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveValue(sourceUrl);
  expect(attempts).toBe(1);
});

test("pasting multiple source URLs creates independent materials without combining originals", async ({ page }) => {
  await page.goto("/v2/capture");
  await page.getByRole("button", { name: "링크 자료 추가", exact: true }).click();
  await page.getByLabel("출처 URL 1", { exact: true }).evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://www.threads.com/@example/post/part-one\nhttps://www.threads.com/@example/post/part-two");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveValue("https://www.threads.com/@example/post/part-one");
  await expect(page.getByLabel("출처 URL 2", { exact: true })).toHaveValue("https://www.threads.com/@example/post/part-two");
  await page.getByLabel(/^출처 원문 1/).fill("첫 번째 게시물만 확보");
  await expect(page.getByLabel(/^출처 원문 2/)).toHaveValue("");
  await expect.poll(() => localDraft(page)).toMatchObject({ sourceItems: [{ value: "첫 번째 게시물만 확보" }, { value: "" }] });
});

test("removing the sole saved manual source clears its local payload and does not resurrect it after reload", async ({ page }) => {
  await page.goto("/v2/capture");
  await page.getByRole("button", { name: "링크 자료 추가", exact: true }).click();
  await page.getByLabel("출처 URL 1", { exact: true }).fill(sourceUrl);
  await expect.poll(() => localDraft(page)).toMatchObject({ sourceItems: [{ metadata: { manualLinkV1: { url: sourceUrl } } }] });
  const draftId = new URL(page.url()).searchParams.get("draftId")!;
  await page.getByRole("button", { name: "자료 1 제거", exact: true }).click();
  await expect.poll(() => localDraft(page, draftId)).toBeNull();
  await expect(page).not.toHaveURL(/draftId=/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "먼저 남겨두세요.", exact: true })).toBeVisible();
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "원본 저장", exact: true })).toBeDisabled();
});

test("real RecordSourceMaterials copies only exact original text and labels OCR and video limits", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
      (window as unknown as { copiedOriginal: string }).copiedOriginal = value;
    } } });
  });
  await page.route("**/api/v2/attachments/manual-synthetic-image", (route) => route.fulfill({ status: 404, body: "Synthetic preview failure" }));
  await page.goto("/v2-lab?surface=manual-links");
  const prompt = page.locator("#source-manual-prompt");
  await prompt.getByRole("button", { name: "원문 복사", exact: true }).click();
  await expect(prompt.getByRole("status")).toHaveText("원문만 복사했습니다.");
  expect(await page.evaluate(() => (window as unknown as { copiedOriginal: string }).copiedOriginal)).toBe("  synthetic prompt: window light\r\nkeep  double spaces\r\n  ");
  await expect(page.locator("#source-manual-ocr")).toContainText("OCR 미확인");
  await expect(page.locator("#source-manual-transcript")).toContainText("02:00–05:00 · 영상 분석 범위 아님");
  await expect(page.locator("#source-manual-link-only")).toContainText("링크만 보관 · 원문 미확보");
  await expect(page.locator("#source-manual-link-only").getByRole("button", { name: "원문 복사", exact: true })).toHaveCount(0);
  await page.locator("#source-manual-image").scrollIntoViewIfNeeded();
  await expect(page.locator("#source-manual-image")).toContainText("이미지 미리보기를 불러오지 못했습니다.");
  await expectResponsiveAccessibleRegion(page, ".v2-record-materials");
  await page.screenshot({ path: testInfo.outputPath("manual-record.png"), fullPage: true });
});

test("real RecordSourceMaterials offers selection when browser clipboard access fails", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Synthetic clipboard denied"); } } });
  });
  await page.route("**/api/v2/attachments/manual-synthetic-image", (route) => route.fulfill({ status: 404, body: "Synthetic preview failure" }));
  await page.goto("/v2-lab?surface=manual-links");
  const prompt = page.locator("#source-manual-prompt");
  await prompt.getByRole("button", { name: "원문 복사", exact: true }).click();
  await expect(prompt.getByRole("status")).toContainText("자동 복사를 사용할 수 없습니다.");
  await prompt.getByRole("button", { name: "원문 선택", exact: true }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("synthetic prompt: window light");
});
