import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const sharedText = "  shared source or personal note\r\nkeep  spaces and 🖼️\r\n  ";
const sharedUrl = " https://www.threads.com/@synthetic/post/shared-fixture?xmt=retained ";
const sharedBody = `# Share title is not an author\n\n${sharedText}\n\n<${sharedUrl}>`;

async function draftFromDb(page: Page, draftId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("lighthouse_capture_v1", 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => { const request = db.transaction("drafts", "readonly").objectStore("drafts").get(id); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error); });
    } finally { db.close(); }
  }, draftId);
}

async function openSharedDraft(page: Page, options: { url?: string; withText?: boolean } = {}) {
  await page.goto("/v2/capture");
  await expect(page.getByRole("heading", { name: "먼저 남겨두세요.", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some((database) => database.name === "lighthouse_capture_v1"))).toBe(true);
  const draftId = `manual-share-fixture-${crypto.randomUUID()}`;
  const input = {
    draftId, title: null, bodyMarkdown: sharedBody, aiEnabled: true, captureChannel: "mobile_share", privacyLevel: "normal",
    templateVersionId: null, templateValues: [], attachmentIds: [],
    sourceItems: [
      { sourceId: `${draftId}:title`, order: 0, kind: "title", value: "Share title is not an author" },
      ...(options.withText === false ? [] : [{ sourceId: `${draftId}:text`, order: 1, kind: "text", value: sharedText }]),
      { sourceId: `${draftId}:url`, order: 2, kind: "url", value: options.url ?? sharedUrl },
    ],
    createdAt: "2026-09-08T01:00:00.000Z", capturedAt: "2026-09-08T01:00:00.000Z", updatedAt: "2026-09-08T01:00:00.000Z", clientTimezone: "Asia/Seoul", localVersion: 1, state: "local_saved",
  };
  await page.evaluate(async (draft) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("lighthouse_capture_v1", 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise<void>((resolve, reject) => { const transaction = db.transaction("drafts", "readwrite"); transaction.objectStore("drafts").put(draft); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    } finally { db.close(); }
  }, input);
  await page.goto(`/v2/capture?draftId=${encodeURIComponent(draftId)}`);
  await expect(page.getByRole("heading", { name: "받아 둔 링크를 수동 자료로 정리", exact: true })).toBeVisible();
  return { draftId, input };
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.FLAG_V2_WRITE !== "1", "Requires explicitly writable local synthetic capture harness.");
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

test("legacy mobile share defaults to keeping text as memo and converts only after explicit confirmation", async ({ page }, testInfo) => {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/v2/captures/commit", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ captureId: "shared-capture", recordId: "shared-record", revisionId: "shared-revision", attachmentCount: 0, committedAt: "2026-09-08T01:01:00.000Z", aiProcessing: "disabled", processingStatusUrl: "/unused" }) });
  });
  const { draftId, input } = await openSharedDraft(page);
  await expect(page.getByRole("radio", { name: "공유 텍스트는 내 메모로 유지 1", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^저장 후 AI 정리/ })).toBeEnabled();
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  const accessibility = await new AxeBuilder({ page }).include(".v2-link-capture").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("explicit-share-choice.png"), fullPage: true });
  await page.getByRole("button", { name: "수동 자료로 전환 1", exact: true }).click();
  await expect(page.getByLabel(/^출처 원문 1/)).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: /^저장 후 AI 정리/ })).toBeDisabled();
  await expect.poll(() => draftFromDb(page, draftId)).toMatchObject({ bodyMarkdown: sharedBody, aiEnabled: false, sourceItems: [...input.sourceItems, { value: "", order: 3, metadata: { manualLinkV1: { publisher: null, completeness: "unknown" } } }] });
  await page.getByRole("button", { name: "원본 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "원본 저장 완료", exact: true })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ bodyMarkdown: sharedBody, aiEnabled: false, sources: [{ rawText: sharedUrl }, { rawText: "", metadata: { manualLinkV1: { url: sharedUrl.trim(), publisher: null } } }] });
});

test("explicit copy preserves exact shared text after reload and undo leaves original rows and later memo edits intact", async ({ page }) => {
  const { draftId, input } = await openSharedDraft(page);
  await page.getByRole("radio", { name: "공유 텍스트를 출처 원문으로 복사 1", exact: true }).check();
  await expect(page.getByLabel("출처 원문으로 복사할 공유 텍스트 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "수동 자료로 전환 1", exact: true }).click();
  await expect.poll(() => draftFromDb(page, draftId)).toMatchObject({ sourceItems: [...input.sourceItems, { value: sharedText, metadata: { shareConversionV1: { choice: "copy_source_text" } } }] });
  await page.reload();
  await expect(page.getByRole("button", { name: "수동 자료로 전환 1", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "전환 되돌리기 1", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "기록 본문", exact: true }).fill("변경한 내 메모는 되돌리기로 지우지 않는다.");
  await page.getByRole("button", { name: "전환 되돌리기 1", exact: true }).click();
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveCount(0);
  await expect.poll(() => draftFromDb(page, draftId)).toMatchObject({ bodyMarkdown: "변경한 내 메모는 되돌리기로 지우지 않는다.", sourceItems: input.sourceItems });
});

test("editing a converted original disables destructive undo and preserves the edited material on reload", async ({ page }) => {
  const { draftId } = await openSharedDraft(page);
  await page.getByRole("button", { name: "수동 자료로 전환 1", exact: true }).click();
  await page.getByLabel(/^출처 원문 1/).fill("전환 뒤 작성한 원문을 보존합니다.");
  await expect(page.getByRole("button", { name: "전환 되돌리기 1", exact: true })).toBeDisabled();
  await expect.poll(async () => (await draftFromDb(page, draftId))?.sourceItems).toEqual(expect.arrayContaining([expect.objectContaining({ value: "전환 뒤 작성한 원문을 보존합니다." })]));
  await page.reload();
  await expect(page.getByLabel(/^출처 원문 1/)).toHaveValue("전환 뒤 작성한 원문을 보존합니다.");
  await expect(page.getByRole("button", { name: "전환 되돌리기 1", exact: true })).toBeDisabled();
});

test("unsupported shared URLs are retained without conversion or inferred source authorship", async ({ page }) => {
  const { draftId, input } = await openSharedDraft(page, { url: "http://example.com/unverified", withText: false });
  await expect(page.getByRole("button", { name: "수동 자료로 전환 1", exact: true })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "공유 텍스트를 출처 원문으로 복사 1", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^저장 후 AI 정리/ })).toBeEnabled();
  await expect(page.getByLabel("출처 URL 1", { exact: true })).toHaveCount(0);
  await expect.poll(() => draftFromDb(page, draftId)).toMatchObject({ sourceItems: input.sourceItems });
});
