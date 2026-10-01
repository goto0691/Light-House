import { expect, test } from "@playwright/test";

test("real Library component opens a record with one mobile tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/v2-lab?surface=product-library");
  await page.getByRole("option", { name: "모바일에서 열 기록 · normal" }).click();
  await expect(page).toHaveURL(/\/v2\/records\/audit-mobile-record/);
});

test("real review form preserves unchanged boolean and date values", async ({ page }) => {
  const submitted: unknown[] = [];
  await page.route("**/api/v2/review-items/*/resolve", async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.goto("/v2-lab?surface=product-fields");
  const booleanCard = page.locator(".v2-review-card").filter({ has: page.getByText("재방문 의향 값을 확인해주세요", { exact: true }) });
  await booleanCard.getByRole("button", { name: "표현 수정" }).click();
  await expect(booleanCard.getByLabel("내 값으로 정정")).toHaveValue("true");
  await booleanCard.getByRole("button", { name: "정정값 저장" }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({ action: "correct", correctedValue: true });
  const dateCard = page.locator(".v2-review-card").filter({ has: page.getByText("방문일 값을 확인해주세요", { exact: true }) });
  await dateCard.getByRole("button", { name: "표현 수정" }).click();
  await expect(dateCard.getByLabel("내 값으로 정정")).toHaveValue("2026-09-08");
  await dateCard.getByRole("button", { name: "정정값 저장" }).click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1]).toMatchObject({ action: "correct", correctedValue: "2026-09-08" });
});

test("real editor preserves an immediate exit and offers local recovery after server failure", async ({ page }) => {
  await page.route("**/api/v2/records/authoring-browser-fixture/revisions", (route) => route.abort("internetdisconnected"));
  await page.goto("/v2-lab?surface=authoring");
  await page.getByRole("textbox", { name: "문서 제목" }).fill("이탈 직전 변경도 복구");
  await page.getByRole("link", { name: "기록으로", exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/records\/authoring-browser-fixture/);
  await page.goto("/v2-lab?surface=authoring");
  await expect(page.getByText(/이 기기에 저장되지 않은 편집 사본/)).toBeVisible();
  await page.getByRole("button", { name: /사본 복구$/ }).first().click();
  await expect(page.getByRole("textbox", { name: "문서 제목" })).toHaveValue("이탈 직전 변경도 복구");
});

test("current queued Capture resumes on foreground reconnection without a second save click", async ({ page }) => {
  test.skip(process.env.FLAG_V2_WRITE !== "1", "Requires the explicitly writable local capture harness.");
  let attempts = 0;
  await page.route("**/api/v2/captures/commit", async (route) => {
    attempts += 1;
    if (attempts === 1) { await route.abort("internetdisconnected"); return; }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ captureId: "audit-capture", recordId: "audit-record", revisionId: "audit-revision", attachmentCount: 0, committedAt: new Date().toISOString(), aiProcessing: "disabled", processingStatusUrl: "/unused" }) });
  });
  await page.goto("/v2/capture");
  await page.getByRole("textbox", { name: "기록 본문" }).fill("재접속하면 전송할 합성 기록");
  await page.getByRole("button", { name: "원본 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "지금 다시 전송" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "원본 저장 완료" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("changing a checkpointed capture to restricted clears local payload before immediate submit", async ({ page }) => {
  test.skip(process.env.FLAG_V2_WRITE !== "1", "Requires the explicitly writable local capture harness.");
  await page.route("**/api/v2/captures/commit", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ privacyLevel: "restricted" });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ captureId: "restricted-audit", recordId: "restricted-record", revisionId: "restricted-revision", attachmentCount: 0, committedAt: new Date().toISOString(), aiProcessing: "disabled", processingStatusUrl: "/unused" }) });
  });
  await page.goto("/v2/capture");
  await page.getByRole("textbox", { name: "기록 본문" }).fill("잠금 전환 합성 본문");
  await expect(page.locator("[data-state='saved']")).toBeVisible();
  const draftId = new URL(page.url()).searchParams.get("draftId")!;
  await page.getByLabel("공개 범위").selectOption("restricted");
  await page.getByRole("button", { name: "원본 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "원본 저장 완료" })).toBeVisible();
  const retained = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("lighthouse_capture_v1", 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(["drafts", "sensitive_drafts", "outbox"], "readonly");
    const values = await Promise.all(["drafts", "sensitive_drafts"].map((name) => new Promise((resolve) => { const request = tx.objectStore(name).get(id); request.onsuccess = () => resolve(Boolean(request.result)); })));
    db.close(); return values;
  }, draftId);
  expect(retained).toEqual([false, false]);
});
