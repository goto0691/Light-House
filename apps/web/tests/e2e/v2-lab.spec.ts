import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("V2 runtime exposes the local D1 Workers binding without the REST helper", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the runtime binding probe once.");
  const response = await request.get("/api/v2/spikes/d1-binding");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    binding: "DB",
    ready: true,
    transport: "workers_binding",
  });
});

test("V2 runtime keeps the archive R2 binding private and separate from static assets", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the runtime binding probe once.");
  const response = await request.get("/api/v2/spikes/r2-binding");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    binding: "ARCHIVE_ASSETS",
    ready: true,
    transport: "workers_binding",
  });
});

test("Library fixture supports keyboard preview and record opening", async ({ page }) => {
  await page.goto("/v2-lab");

  await expect(page.getByRole("heading", { name: "모든 기록" })).toBeVisible();
  const firstRecord = page.getByRole("option", { name: /모모식당 연남점/ });
  await firstRecord.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: /늦게 피는 이야기/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "늦게 피는 이야기" })).toBeVisible();
});

test("Capture fixture separates source commit from AI processing", async ({ page }) => {
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "모바일 Capture" }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "기록을 저장했습니다." })).toBeVisible();
  await expect(page.getByText("원본 저장 완료 · AI 정리 중")).toBeVisible();
});

test("Product Capture accepts a pasted screenshot and never checkpoints restricted payload", async ({ context, page }) => {
  await page.goto("/v2/capture");
  await expect(page.getByRole("heading", { name: "먼저 남겨두세요." })).toBeVisible();
  // Exercise the real local checkpoint with an explicit browser network state.
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  const body = page.getByRole("textbox", { name: "기록 본문" });
  await body.fill("논쟁 화면을 원문과 함께 보관한다.");
  await page.evaluate(() => {
    const target = document.querySelector("textarea");
    if (!target) throw new Error("Capture textarea was not rendered.");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "논쟁-캡처.png", { type: "image/png" }));
    target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  });
  await expect(page.getByText("논쟁-캡처.png")).toBeVisible();
  await expect(page.locator("[data-state='saved']")).toContainText("이 기기에 임시 저장됨");

  await page.getByLabel("공개 범위").selectOption("restricted");
  await expect(page.locator("[data-state='blocked']")).toContainText("기기에 저장하지 않음");
  const draftId = new URL(page.url()).searchParams.get("draftId");
  expect(draftId).toBeTruthy();
  expect(await page.evaluate(async (id) => {
    const request = indexedDB.open("lighthouse_capture_v1", 2);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["drafts", "sensitive_drafts", "outbox"], "readonly");
    const get = (store: string) => new Promise((resolve, reject) => {
      const result = transaction.objectStore(store).get(id ?? "");
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
    const values = await Promise.all([get("drafts"), get("sensitive_drafts")]);
    const outbox = await new Promise((resolve, reject) => {
      const result = transaction.objectStore("outbox").index("by-draftId").getAll(id ?? "");
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
    database.close();
    return { values, outbox };
  }, draftId)).toEqual({ values: [undefined, undefined], outbox: [] });
});

test("Product editor autosaves an immutable revision and exposes an explicit conflict fork", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the full revision editor contract once.");
  let responseMode: "saved" | "conflict" = "saved";
  let requestCount = 0;
  await page.route("**/api/v2/records/authoring-browser-fixture/revisions", async (route) => {
    requestCount += 1;
    const request = route.request();
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    const payload = request.postDataJSON() as { expectedVersion: number; expectedRevisionId: string; title: string };
    expect(payload.title).toContain("실제 revision 편집기");
    if (responseMode === "saved") {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({ outcome: "saved", revisionId: "revision-browser-fixture-2", version: 2, savedAt: new Date().toISOString() }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      status: 409,
      body: JSON.stringify({ outcome: "conflict", forkRevisionId: "revision-browser-fork", currentRevisionId: "revision-server-3", currentVersion: 3, savedAt: new Date().toISOString() }),
    });
  });

  await page.goto("/v2-lab?surface=authoring");
  const title = page.getByRole("textbox", { name: "문서 제목" });
  await title.fill("실제 revision 편집기 · 저장됨");
  await expect(page.getByText("서버에 저장됨")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("revision 2", { exact: true }).first()).toBeVisible();
  expect(requestCount).toBe(1);

  responseMode = "conflict";
  await title.fill("실제 revision 편집기 · 충돌 보존");
  await expect(page.locator(".v2-editor-conflict")).toContainText("fork revision으로 보존", { timeout: 8_000 });
  await expect(page.getByRole("button", { name: "서버 최신본 열기" })).toBeVisible();
  expect(requestCount).toBe(2);
  await title.fill("충돌 뒤 로컬에서 더 적어도 자동 덮어쓰기 금지");
  await page.waitForTimeout(1_500);
  expect(requestCount).toBe(2);
  await expect(page.getByRole("button", { name: "지금 저장" })).toBeDisabled();
});

test("Offline capture restores its IndexedDB checkpoint after a page restart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the durable local checkpoint once.");
  await page.goto("/v2/capture");
  const body = page.getByRole("textbox", { name: "기록 본문" });
  await body.fill("Playwright 재시작 복구용 합성 기록");
  await expect(page.locator("[data-state='saved']"), "800ms checkpoint should complete").toContainText("이 기기에 임시 저장됨");
  expect(new URL(page.url()).searchParams.get("draftId")).toBeTruthy();
  await page.getByRole("button", { name: /이 기기의 전송 대기 1개 보기/ }).click();
  await expect(page.getByRole("dialog", { name: "전송 대기 1개" })).toContainText("현재 작성 중");
  await expect(page.getByRole("button", { name: "재전송" })).toBeDisabled();
  await page.getByRole("button", { name: "전송 대기 닫기" }).click();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "기록 본문" })).toHaveValue("Playwright 재시작 복구용 합성 기록");
  await expect(page.locator("[data-state='saved']")).toContainText("이 기기에 임시 저장됨");
});

test("Installed PWA shell receives a synthetic share and remains useful when navigation is offline", async (
  { context, page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run service worker and share-target behavior once.");
  test.setTimeout(45_000);
  await page.goto("/v2/capture");
  await expect(page.locator("[data-pwa-registration]")).toHaveAttribute("data-pwa-registration", "ready");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const shared = await page.evaluate(async () => {
    const formData = new FormData();
    formData.set("title", "공유한 제목");
    formData.set("text", "공유한 본문");
    formData.set("url", "https://example.com/shared");
    formData.append("files", new File(["synthetic"], "공유-이미지.png", { type: "image/png" }));
    const response = await fetch("/share-target", { method: "POST", body: formData });
    return response.url;
  });
  expect(shared).toContain("/v2/capture");
  expect(shared).toContain("from=share");
  await page.goto(shared);
  await expect(page.getByRole("textbox", { name: "기록 본문" })).toHaveValue(
    "# 공유한 제목\n\n공유한 본문\n\n<https://example.com/shared>",
  );
  await expect(page.getByText("공유-이미지.png")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.goto("/v2/capture");
    await expect(page.getByRole("heading", { name: "오프라인 기록" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("Mobile record keeps evidence and information reachable in a sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile projection.");
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "기록 + 근거" }).click();
  await page.getByRole("button", { name: "근거와 정보 열기" }).click();
  await expect(page.getByRole("dialog", { name: "근거와 정보" })).toBeVisible();
  await expect(page.getByRole("button", { name: /평점 4.5/ })).toHaveAttribute("aria-pressed", "true");
});

test("Adaptive record keeps the body primary while exposing evidence, one safe module, and explicit review controls", async ({ page }) => {
  await page.goto("/v2-lab?surface=adaptive");
  await expect(page.getByRole("heading", { name: "서울숲 아침 달리기" })).toBeVisible();
  await expect(page.getByText("달리기 기록").first()).toBeVisible();
  await expect(page.locator("[data-module-key='workout.metrics.v1']")).toHaveCount(1);
  await expect(page.locator("[data-module-key]")).toHaveCount(1);

  const order = await page.evaluate(() => {
    const highlights = document.querySelector(".v2-highlight-strip");
    const body = document.querySelector("[data-testid='adaptive-record-body']");
    const contextModule = document.querySelector("[data-module-key]");
    if (!highlights || !body || !contextModule) throw new Error("Adaptive record fixture is incomplete.");
    return {
      highlightsBeforeBody: Boolean(highlights.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING),
      bodyBeforeModule: Boolean(body.compareDocumentPosition(contextModule) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order).toEqual({ highlightsBeforeBody: true, bodyBeforeModule: true });

  const field = page.locator(".v2-knowledge-section .v2-presented-field").filter({ hasText: "거리" }).first();
  await field.getByText(/근거 1개/).click();
  await expect(field.getByText("오늘 아침 5km를 31분 12초에 달렸다.")).toBeVisible();
  await field.getByRole("link", { name: "원본 위치로" }).click();
  await expect(page).toHaveURL(/#source-source-running-1$/);
  await page.getByRole("link", { name: "관련 필드로" }).click();
  await expect(page).toHaveURL(/#field-property-distance$/);
  await expect(field).toBeFocused();

  const risky = page.locator(".v2-review-card").filter({ hasText: "사람과 관계에 대한 해석" });
  const accept = risky.getByRole("button", { name: /내 기록으로 확인/ });
  await expect(accept).toBeDisabled();
  await risky.getByRole("checkbox").check();
  await expect(accept).toBeEnabled();
  await risky.getByRole("button", { name: "표현 수정" }).click();
  await expect(risky.getByLabel("내 값으로 정정")).toBeVisible();
  await risky.getByLabel("내 값으로 정정").fill("함께 뛰고 싶다고 직접 말했다");
  await expect(risky.getByRole("button", { name: "정정값 저장" })).toBeEnabled();
});

test("Adaptive record remains horizontally contained on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile adaptive projection.");
  await page.goto("/v2-lab?surface=adaptive");
  await expect(page.getByRole("heading", { name: "활동 수치" })).toBeVisible();
  expect(await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))).toEqual(
    expect.objectContaining({ scrollWidth: expect.any(Number), clientWidth: expect.any(Number) }),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: /확인할 내용 2개/ })).toBeVisible();
});

test("Search explains inclusion, hides sensitive snippets, and keeps saved views opt-in", async ({ page }) => {
  await page.goto("/v2-lab?surface=search");
  await expect(page.getByRole("heading", { name: "기록 검색" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "서울숲 아침 달리기" })).toContainText("제목에 ‘서울숲’ 포함");
  const sensitive = page.getByRole("article").filter({ hasText: "서울숲에서 나눈 대화" });
  await expect(sensitive).toContainText("민감 기록 · 검색 문맥 숨김");
  await expect(sensitive).not.toContainText("대화 내용");
  await page.getByRole("button", { name: /현재 조건을 내 목록으로 저장/ }).click();
  const dialog = page.getByRole("dialog", { name: "내 목록으로 저장" });
  await expect(dialog).toContainText("자동 고정되지 않습니다");
  await expect(dialog.getByRole("textbox", { name: "목록 이름" })).toBeFocused();
});

test("Search result cards remain horizontally contained on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile search projection.");
  await page.goto("/v2-lab?surface=search");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("Template Capture keeps blank writing first and opens optional neutral recall cues", async ({ page }) => {
  await page.goto("/v2-lab?surface=template");
  const body = page.getByRole("textbox", { name: "기록 본문" });
  await expect(body).toBeFocused();
  await expect(page.getByText("어떤 작품이나 경험이었나요?")).toHaveCount(0);
  await page.getByRole("button", { name: "도움받아 쓰기" }).click();
  await expect(page.getByRole("heading", { name: "도움받아 쓰기" })).toBeVisible();
  await page.getByRole("button", { name: /리뷰 기록/ }).click();
  await expect(page.getByText("어떤 작품이나 경험이었나요?", { exact: true })).toBeVisible();
  await expect(page.getByText("필수")).toHaveCount(0);
  await page.getByLabel("지금 남아 있는 평점은 몇 점인가요?", { exact: true }).selectOption("4.5");
  await page.getByRole("button", { name: "가장 기억에 남은 장면·문장·맛은 무엇인가요?" }).click();
  await page.getByRole("textbox", { name: "떠오른 내용" }).fill("마지막 장면의 긴 침묵이 오래 남았다.");
  await page.getByRole("button", { name: "본문에 덧붙이기" }).click();
  await expect(body).toHaveValue("마지막 장면의 긴 침묵이 오래 남았다.");
});

test("Template assistance stays horizontally contained as a mobile bottom sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile template projection.");
  await page.goto("/v2-lab?surface=template");
  await page.getByRole("button", { name: "도움받아 쓰기" }).click();
  await page.getByRole("button", { name: /운동 기록/ }).click();
  await expect(page.getByText("운동 수치")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("Explore keeps rediscovery off until explicit consent and separates sensitive consent", async ({ page }) => {
  await page.goto("/v2-lab?surface=explore");
  await expect(page.getByRole("heading", { name: "기록 탐색" })).toBeVisible();
  await expect(page.getByText("비 오는 날의 오래된 골목")).toHaveCount(0);
  await page.getByRole("button", { name: /일반 기록 다시 보기 켜기/ }).click();
  await expect(page.getByText("비 오는 날의 오래된 골목")).toBeVisible();
  await expect(page.getByText(/민감 기록 · 예상치 못한/)).toHaveCount(0);
  await page.getByRole("checkbox", { name: /민감 기록도 후보에 포함/ }).check();
  await expect(page.getByText(/민감 기록 · 예상치 못한/)).toBeVisible();
  await expect(page.getByText("잠긴 게임 메모")).toHaveCount(0);
});

test("Explore facets and rediscovery remain horizontally contained on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile Explore projection.");
  await page.goto("/v2-lab?surface=explore");
  await page.getByRole("button", { name: /일반 기록 다시 보기 켜기/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: "분류로 보기" })).toBeVisible();
});

test("Portability keeps encrypted-storage warning, dry-run, and explicit restore approval in sequence", async ({ page }) => {
  const dryRun = { archiveSha256: "a".repeat(64), manifestRootHash: `sha256:${"b".repeat(64)}`, dryRunHash: "c".repeat(64), counts: { create: 3, reuse: 0, fork: 0, conflict: 0, invalid: 0 }, warnings: [], tables: [{ table: "v2_documents", rows: 1, create: 1, reuse: 0, fork: 0, conflict: 0 }] };
  const manifest = { profile: "migration", scope: { privacyLevels: ["normal"] }, counts: { documents: 1 } };
  await page.route("**/api/v2/auth/restricted-grants", async (route) => route.fulfill({ contentType: "application/json", status: 201, body: JSON.stringify({ grant: { expiresAt: "2026-08-28T23:59:59.000Z" } }) }));
  await page.route("**/api/v2/restores/verify", async (route) => {
    const headers = route.request().headers();
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers["idempotency-key"]).toBeTruthy();
    expect(headers["x-lighthouse-archive-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    await route.fulfill({ contentType: "application/json", status: 202, body: JSON.stringify({ restore: { batchId: "restore-browser-fixture", status: "awaiting_approval", stateRevision: 10, progress: { filesComplete: 2, filesTotal: 2, rowsMaterialized: 3, rowsPlanned: 3, rowsApplied: 0, rollbackConflicts: 0 }, manifest, dryRun } }) });
  });
  await page.route("**/api/v2/restores/import", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ restoreId: "restore-browser-fixture", approved: true, dryRunHash: dryRun.dryRunHash, expectedRevision: 10 });
    await route.fulfill({ contentType: "application/json", status: 202, body: JSON.stringify({ restore: { batchId: "restore-browser-fixture", status: "applying", stateRevision: 11, progress: { filesComplete: 2, filesTotal: 2, rowsMaterialized: 3, rowsPlanned: 3, rowsApplied: 0, rollbackConflicts: 0 }, manifest, dryRun } }) });
  });
  await page.route("**/api/v2/restores/restore-browser-fixture/advance", async (route) => route.fulfill({ contentType: "application/json", status: 202, body: JSON.stringify({ restore: { batchId: "restore-browser-fixture", status: "succeeded", stateRevision: 12, progress: { filesComplete: 2, filesTotal: 2, rowsMaterialized: 3, rowsPlanned: 3, rowsApplied: 3, rollbackConflicts: 0 }, manifest, dryRun } }) }));
  await page.goto("/v2-lab?surface=portability");
  await expect(page.getByRole("heading", { name: "내보내기와 복원" })).toBeVisible();
  await expect(page.getByText("ZIP은 암호화되지 않습니다.")).toBeVisible();
  await page.locator(".v2-portability-file input").setInputFiles({ name: "lighthouse-migration.zip", mimeType: "application/zip", buffer: Buffer.from("fixture") });
  await page.getByLabel("복원 작업 비밀번호").fill("fixture-password");
  await page.getByRole("button", { name: "변경 없이 검사" }).click();
  await expect(page.getByText("검증된 dry-run")).toBeVisible();
  const importButton = page.getByRole("button", { name: "명시한 결과로 가져오기" });
  await expect(importButton).toBeDisabled();
  await page.getByRole("checkbox", { name: /이 checksum과 변경 수/ }).check();
  await importButton.click();
  await expect(page.getByText("복원과 검증을 마쳤습니다")).toBeVisible();
});

test("Portability cards remain horizontally contained on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile portability projection.");
  await page.goto("/v2-lab?surface=portability");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: "검사하고 복원하기" })).toBeVisible();
});

test("A+ lab shell has no automatically detectable critical accessibility violations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the axe baseline once on desktop.");
  await page.goto("/v2-lab");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);

  await page.getByRole("button", { name: "집필 편집기" }).click();
  await expect(page.getByRole("textbox", { name: "시각 문서 편집기" })).toBeVisible();
  const editorResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(editorResults.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

test("Milkdown and CodeMirror share one Markdown body across visual, source, and read modes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the full editor round-trip once on desktop.");
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "집필 편집기" }).click();

  const visualEditor = page.getByRole("textbox", { name: "시각 문서 편집기" });
  await expect(visualEditor).toBeVisible();
  const firstParagraph = page.getByText(/어제 저녁, 오래전에 좋아했던 영화를/);
  await firstParagraph.evaluate((element) => {
    (element.parentElement as HTMLElement | null)?.focus();
    const textNode = element.firstChild;
    if (!textNode?.textContent) throw new Error("Could not find the first paragraph text.");
    const start = textNode.textContent.indexOf("침묵");
    if (start < 0) throw new Error("Could not find the selected word.");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 2);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByRole("toolbar", { name: "선택 영역 서식" })).toBeVisible();
  await page.getByRole("button", { name: "굵게" }).click();

  await page.getByRole("button", { name: "Markdown 소스" }).click();
  const sourceEditor = page.getByRole("textbox", { name: "Markdown 소스 편집기" });
  await expect(sourceEditor).toContainText("인물 사이의 **침묵**이 더 오래 남았다");
  await expect(sourceEditor).toContainText("lighthouse://entity/01EDITORFIXTURE");
  const canonicalLines = await sourceEditor.locator(".cm-line").allTextContents();
  expect(canonicalLines).toContain("* [x] 다시 보고 싶은 장면 표시");
  expect(canonicalLines.some((line) => line.includes("평점") && line.includes("4.5 / 5"))).toBe(true);
  expect(canonicalLines).toContain("첫 번째 행\\");
  await sourceEditor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n소스 모드에서 남긴 문장");

  await page.getByRole("button", { name: "읽기", exact: true }).click();
  await expect(page.getByRole("document", { name: "읽기 모드 본문" })).toContainText("인물 사이의 침묵이 더 오래 남았다");
  await expect(page.getByRole("document", { name: "읽기 모드 본문" })).toContainText("소스 모드에서 남긴 문장");

  await page.getByRole("button", { name: "Markdown 소스" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown 소스 편집기" })).toContainText("소스 모드에서 남긴 문장");
});

test("Editor ignores the manual-save shortcut during Korean IME composition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "IME shortcut contract is browser-independent.");
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "집필 편집기" }).click();
  await page.getByRole("button", { name: "Markdown 소스" }).click();
  const sourceEditor = page.getByRole("textbox", { name: "Markdown 소스 편집기" });
  const checkpoint = page.getByTestId("save-checkpoint-count");
  await expect(sourceEditor).toBeVisible();
  await page.waitForTimeout(450);
  const beforeComposition = await checkpoint.textContent();

  await sourceEditor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "한" }));
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      isComposing: true,
      key: "Enter",
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
  });
  await expect(checkpoint).toHaveText(beforeComposition ?? "체크포인트 0");

  await sourceEditor.click();
  await page.keyboard.press("Control+Enter");
  await expect(checkpoint).not.toHaveText(beforeComposition ?? "체크포인트 0");
});

test("Source mode restores its selection after a mode round-trip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Selection restoration is measured on the desktop editor.");
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "집필 편집기" }).click();
  await page.getByRole("button", { name: "Markdown 소스" }).click();
  const sourceHost = page.getByTestId("source-editor");
  const sourceEditor = page.getByRole("textbox", { name: "Markdown 소스 편집기" });
  await sourceEditor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await expect(sourceHost).toHaveAttribute("data-selection-anchor", /\d+/);
  const before = await sourceHost.evaluate((element) => ({
    anchor: element.getAttribute("data-selection-anchor"),
    head: element.getAttribute("data-selection-head"),
  }));

  await page.getByRole("button", { name: "읽기", exact: true }).click();
  await page.getByRole("button", { name: "Markdown 소스" }).click();
  await expect(page.getByTestId("source-editor")).toHaveAttribute("data-selection-anchor", before.anchor ?? "0");
  await expect(page.getByTestId("source-editor")).toHaveAttribute("data-selection-head", before.head ?? "0");
});

test("50k Markdown fixture remains editable through the visual round-trip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run the large-document probe once on desktop.");
  test.setTimeout(45_000);
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "집필 편집기" }).click();
  await page.getByRole("button", { name: "5만 자 fixture 불러오기" }).click();
  await expect(page.getByTestId("markdown-character-count")).toContainText(/5\d,\d{3}/);

  await page.getByRole("button", { name: "Markdown 소스" }).click();
  await expect(page.getByRole("textbox", { name: "Markdown 소스 편집기" })).toContainText("긴 글 편집 성능 fixture");
  const visualStartedAt = Date.now();
  await page.getByRole("button", { name: "시각 문서" }).click();
  await expect(page.getByRole("textbox", { name: "시각 문서 편집기" })).toContainText("반복해서 떠오른 장면");
  expect(Date.now() - visualStartedAt).toBeLessThan(12_000);

  await page.getByRole("button", { name: "Markdown 소스" }).click();
  await expect(page.getByTestId("markdown-character-count")).toContainText(/5\d,\d{3}/);
});

test("Mobile editor keeps all three modes and save state reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This checks the mobile editor projection.");
  await page.goto("/v2-lab");
  await page.getByRole("button", { name: "집필 편집기" }).click();
  await expect(page.getByRole("button", { name: "시각 문서" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Markdown 소스" })).toBeVisible();
  await expect(page.getByRole("button", { name: "읽기", exact: true })).toBeVisible();
  await expect(page.getByText("로컬에 저장됨")).toBeVisible();
});
