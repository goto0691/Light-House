import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { LinkPresentationV1 } from "../../src/lib/v2/domain/link-presentation-v1";
import type { SnapshotRequest } from "../../src/lib/v2/editor/link-snapshot-draft";
import { snapshotReceiptFixture } from "./support/link-snapshot-receipt-fixture";

type Mutation = { method: string; url: string; body: Record<string, unknown> };
const original = "  window light, synthetic portrait\r\nkeep  double spaces\r\n  ";
async function harness(page: Page) {
  let state: LinkPresentationV1;
  const mutations: Mutation[] = [];
  const reads: string[] = [];
  let mutationHandler: ((route: Route, mutation: Mutation) => Promise<void>) | null = null;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/attachments/analysis-image-file", (route) => route.fulfill({ status: 404, body: "Synthetic missing image" }));
  await page.route("**/api/v2/records/link-analysis-fixture/recovery-policy", (route) => route.fulfill({ json: { recoveryPolicy: { ownerId: "link-owner", recordId: "link-analysis-fixture", currentVersion: 1, privacyLevel: "normal" }, contentReadable: true } }));
  await page.route("**/api/v2/records/link-analysis-fixture/links**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      const mutation = { method: request.method(), url: request.url(), body: request.postDataJSON() as Record<string, unknown> };
      mutations.push(mutation);
      if (mutationHandler) return mutationHandler(route, mutation);
      if (mutation.url.endsWith("/links/snapshots")) return route.fulfill({ status: 201, json: await snapshotReceiptFixture(mutation.body as SnapshotRequest, state.availableSources) });
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    reads.push(request.url());
    const query = new URL(request.url()).searchParams;
    let selected = structuredClone(state);
    if (query.get("snapshotId") === "snapshot-one" || query.get("runId") === "run-one") selected = {
      ...selected, isHistorical: true,
      selectedSnapshot: query.get("snapshotId") === "snapshot-one" ? selected.snapshotHistory.items.find((snapshot) => snapshot.id === "snapshot-one")! : selected.selectedSnapshot,
      selectedRun: selected.runHistory.items.find((run) => run.id === "run-one")!,
      capabilities: { canAnalyze: false, canCreateSnapshot: false, canReview: false, reason: "link_history_read_only" },
    };
    if (query.has("snapshotCursor")) selected = { ...selected, snapshotHistory: { items: [{ ...selected.snapshotHistory.items[0], id: "snapshot-older", snapshotVersion: 0 }], nextCursor: null } };
    if (query.has("runCursor")) selected = { ...selected, runHistory: { items: [{ ...selected.runHistory.items[0], id: "run-older", isPublished: false }], nextCursor: null } };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ links: selected }) });
  });
  await page.goto("/v2-lab?surface=link-analysis");
  state = JSON.parse((await page.getByTestId("link-analysis-fixture-data").textContent())!) as LinkPresentationV1;
  return { mutations, reads, get state() { return state; }, set state(value: LinkPresentationV1) { state = value; }, onMutation(handler: typeof mutationHandler) { mutationHandler = handler; } };
}

test("link panel is explicit, copies exact original separately from AI interpretation, and is accessible", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } }));
  const context = await harness(page);
  expect(context.mutations).toHaveLength(0);
  const panel = page.locator(".v2-record-link-analysis");
  await expect(panel).toContainText("일부 자료만 처리");
  await expect(panel).toContainText("미처리 자료 2개");
  const prompt = page.locator("#link-fragment-prompt-one");
  await prompt.getByRole("button", { name: "발췌 원문 복사", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(original);
  const insight = page.locator("#link-fragment-insight-one");
  await insight.getByRole("button", { name: "AI 해석만 복사", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(context.state.fragments[1].derivedText);
  await prompt.getByText("근거 1개", { exact: true }).click();
  await expect(prompt.getByRole("link", { name: "원본 위치로" })).toHaveAttribute("href", "#source-analysis-prompt");
  const version = page.getByRole("combobox", { name: "자료 버전", exact: true });
  await version.focus(); await expect(version).toBeFocused(); await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "분석 실행", exact: true })).toBeFocused();
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect((await new AxeBuilder({ page }).include(".v2-record-link-analysis").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("link-analysis-record.png"), fullPage: true });
  expect(context.mutations).toHaveLength(0);
});

test("explicit analyze is idempotent on network retry and creates no snapshot or generic AI request", async ({ page }) => {
  const context = await harness(page);
  context.onMutation(async (route) => {
    if (context.mutations.length === 1) return route.abort("failed");
    context.state = { ...context.state, latestAttempt: { ...context.state.latestAttempt!, id: "new-job", status: "running" } };
    return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: "new-job", status: "queued", replayed: true }) });
  });
  const analyze = page.getByRole("button", { name: "다시 AI로 정리", exact: true });
  await analyze.click(); await expect(page.locator(".v2-record-link-analysis").getByRole("alert")).toBeVisible();
  await analyze.click();
  await expect(page.locator(".v2-link-status")).toHaveText("텍스트 정리 중");
  expect(context.mutations).toHaveLength(2);
  expect(context.mutations[0].body).toEqual(context.mutations[1].body);
  expect(context.mutations[0]).toMatchObject({ method: "POST", body: { expectedRevisionId: "revision-one", expectedSnapshotId: "snapshot-two", expectedManifestHash: "a".repeat(64), idempotencyKey: expect.any(String) } });
  expect(context.mutations.every((mutation) => mutation.url.endsWith("/links/analyze"))).toBe(true);
  await expect(analyze).toBeDisabled();
  await expect.poll(() => context.reads.length).toBeGreaterThan(1);
  expect(context.mutations).toHaveLength(2);
});

test("snapshot conflict retains source selection and new raw text, then saves with fresh base identity", async ({ page }, testInfo) => {
  const context = await harness(page);
  context.onMutation(async (route) => {
    if (context.mutations.length === 1) {
      const newer = { ...context.state.selectedSnapshot!, id: "snapshot-newer", snapshotVersion: 3 };
      context.state = { ...context.state, currentSnapshotId: "snapshot-newer", currentSnapshotVersion: 3, selectedSnapshot: newer, snapshotHistory: { ...context.state.snapshotHistory, items: [newer, ...context.state.snapshotHistory.items] } };
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { message: "Synthetic conflict" } }) });
    }
    return route.fulfill({ status: 201, json: await snapshotReceiptFixture(context.mutations.at(-1)!.body as SnapshotRequest, context.state.availableSources) });
  });
  await page.getByRole("button", { name: "자료 추가·선택 변경", exact: true }).click();
  await page.getByRole("button", { name: "링크 자료 추가", exact: true }).click();
  await page.getByLabel("출처 URL 1", { exact: true }).fill("https://example.com/new-original");
  await page.getByLabel(/^출처 원문 1/).fill("  새 원문\n공백  보존  ");
  await page.getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(page.locator(".v2-link-snapshot-editor").getByRole("alert")).toContainText("입력 내용은 유지");
  await expect(page.getByLabel(/^출처 원문 1/)).toHaveValue("  새 원문\n공백  보존  ");
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.getByRole("button", { name: "새 자료 버전 저장", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "현재 자료 버전을 기준으로 편집 계속", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-link-snapshot-editor").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("link-snapshot-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(page.locator(".v2-link-message")).toContainText("새 자료 버전을 저장");
  expect(context.mutations).toHaveLength(2);
  expect(context.mutations[0].body.idempotencyKey).not.toBe(context.mutations[1].body.idempotencyKey);
  expect(context.mutations[1].body).toMatchObject({ expectedSnapshotId: "snapshot-newer", expectedSnapshotVersion: 3, sourceItemIds: ["analysis-prompt", "analysis-url", "analysis-image"], newManualSources: [{ rawText: "  새 원문\n공백  보존  ", link: { url: "https://example.com/new-original" } }] });
  expect(context.mutations.every((mutation) => mutation.url.endsWith("/links/snapshots"))).toBe(true);
});

test("confirm and reject use fragment version CAS without personal review writes", async ({ page }) => {
  const context = await harness(page);
  context.onMutation(async (route, mutation) => {
    const id = mutation.url.split("/").at(-1);
    context.state = { ...context.state, fragments: context.state.fragments.map((fragment) => fragment.id === id ? { ...fragment, reviewStatus: mutation.body.action === "confirm" ? "confirmed" : "rejected", stateVersion: fragment.stateVersion + 1, lockedByUser: true } : fragment) };
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.locator("#link-fragment-prompt-one").getByRole("button", { name: "발췌 확인", exact: true }).click();
  await expect(page.locator("#link-fragment-prompt-one")).toContainText("사용자 확인됨 · 사실 검증 아님");
  await page.locator("#link-fragment-insight-one").getByRole("button", { name: "제안 거절", exact: true }).click();
  await expect(page.locator("#link-fragment-insight-one")).toContainText("거절한 제안 · 원문 유지");
  expect(context.mutations[0]).toMatchObject({ method: "PATCH", body: { action: "confirm", expectedRevisionId: "revision-one", expectedSnapshotId: "snapshot-two", expectedRunId: "run-two", expectedStateVersion: 1, idempotencyKey: expect.any(String) } });
  expect(context.mutations[1].body.action).toBe("reject");
  expect(context.mutations.every((mutation) => mutation.url.includes("/links/fragments/"))).toBe(true);
});

test("past snapshots and past runs are read-only and current results remain selectable", async ({ page }) => {
  const context = await harness(page);
  await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption("snapshot-one");
  await expect(page.locator(".v2-link-warning")).toContainText("과거 자료·실행 결과");
  await expect(page.getByRole("button", { name: "다시 AI로 정리", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "발췌 확인", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "발췌 원문 복사", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "자료 버전", exact: true }).selectOption("snapshot-two");
  await expect(page.locator(".v2-link-warning")).toHaveCount(0);
  await page.getByRole("combobox", { name: "분석 실행", exact: true }).selectOption("run-one");
  await expect(page.locator(".v2-link-warning")).toBeVisible();
  await page.getByRole("combobox", { name: "분석 실행", exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "발췌 확인", exact: true })).toBeEnabled();
  expect(context.mutations).toHaveLength(0);
});

test("quota, empty results, missing schema and restricted capabilities remain distinct", async ({ page }) => {
  const context = await harness(page);
  context.state = { ...context.state, latestAttempt: { ...context.state.latestAttempt!, status: "retry_wait", lastErrorCode: "quota_exhausted" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.locator(".v2-link-status")).toContainText("AI 할당량 대기");
  context.state = { ...context.state, latestAttempt: { ...context.state.latestAttempt!, status: "succeeded", lastErrorCode: null }, fragments: [] };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.locator(".v2-link-empty")).toContainText("원문은 그대로");
  context.state = { ...context.state, schemaAvailable: false, capabilities: { canAnalyze: false, canReview: false, canCreateSnapshot: false, reason: "link_snapshot_schema_unavailable" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.locator(".v2-link-status")).toContainText("분석 기능 준비 전");
  context.state = { ...context.state, schemaAvailable: true, capabilities: { ...context.state.capabilities, reason: "restricted_ai_forbidden" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 AI로 정리", exact: true })).toBeDisabled();
  await expect(page.locator(".v2-record-link-analysis")).toContainText("제한된 기록은 잠금을 해제해도 외부 AI로 전송하지 않습니다.");
  expect(context.mutations).toHaveLength(0);
});

test("older-history pages merge without losing the selected snapshot and run", async ({ page }) => {
  const context = await harness(page);
  context.state = { ...context.state, snapshotHistory: { ...context.state.snapshotHistory, nextCursor: "snapshot-page-2" }, runHistory: { ...context.state.runHistory, nextCursor: "run-page-2" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await page.getByRole("button", { name: "이전 자료 버전 더 보기", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "자료 버전", exact: true })).toHaveValue("snapshot-two");
  await expect(page.getByRole("combobox", { name: "자료 버전", exact: true }).locator("option[value='snapshot-older']")).toHaveCount(1);
  await page.getByRole("button", { name: "이전 분석 실행 더 보기", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "분석 실행", exact: true }).locator("option[value='run-older']")).toHaveCount(1);
  expect(context.mutations).toHaveLength(0);
});

test("clipboard denial offers a labeled fallback without implying AI interpretation is an original", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Synthetic clipboard denied"); } } }));
  await harness(page);
  const interpretation = page.locator("#link-fragment-insight-one");
  await interpretation.getByRole("button", { name: "AI 해석만 복사", exact: true }).click();
  await expect(interpretation.getByRole("status")).toContainText("자동 복사를 사용할 수 없습니다");
  await interpretation.getByRole("button", { name: "해석 선택", exact: true }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("합성 AI 해석:");
});

test("review conflict does not mark a proposal confirmed and a refreshed retry uses current CAS", async ({ page }) => {
  const context = await harness(page);
  context.onMutation(async (route, mutation) => {
    if (context.mutations.length === 1) {
      context.state = { ...context.state, fragments: context.state.fragments.map((fragment) => fragment.id === "prompt-one" ? { ...fragment, stateVersion: 2 } : fragment) };
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { message: "Synthetic conflict" } }) });
    }
    context.state = { ...context.state, fragments: context.state.fragments.map((fragment) => fragment.id === "prompt-one" ? { ...fragment, stateVersion: 3, reviewStatus: "confirmed" } : fragment) };
    expect(mutation.body.expectedStateVersion).toBe(2);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const prompt = page.locator("#link-fragment-prompt-one");
  await prompt.getByRole("button", { name: "발췌 확인", exact: true }).click();
  await expect(page.locator(".v2-record-link-analysis").getByRole("alert")).toContainText("자료가 변경되었습니다");
  await expect(prompt).not.toContainText("사용자 확인됨");
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await prompt.getByRole("button", { name: "발췌 확인", exact: true }).click();
  await expect(prompt).toContainText("사용자 확인됨");
  expect(context.mutations[0].body.idempotencyKey).not.toBe(context.mutations[1].body.idempotencyKey);
});

test("first source-version save is explicit and does not request AI analysis", async ({ page }) => {
  const context = await harness(page);
  const ready = context.state;
  context.state = { ...ready, currentSnapshotId: null, currentSnapshotVersion: 0, selectedSnapshot: null, members: [], snapshotHistory: { items: [], nextCursor: null }, selectedRun: null, publishedRun: null, runHistory: { items: [], nextCursor: null }, latestAttempt: null, fragments: [], capabilities: { canCreateSnapshot: true, canAnalyze: false, canReview: false, reason: "link_snapshot_required" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI로 정리", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "자료 추가·선택 변경", exact: true }).click();
  expect(context.mutations).toHaveLength(0);
  context.onMutation(async (route) => { context.state = ready; return route.fulfill({ status: 201, json: await snapshotReceiptFixture(context.mutations.at(-1)!.body as SnapshotRequest, ready.availableSources) }); });
  await page.getByRole("button", { name: "새 자료 버전 저장", exact: true }).click();
  await expect(page.locator(".v2-link-message")).toContainText("새 자료 버전을 저장");
  expect(context.mutations).toHaveLength(1);
  expect(context.mutations[0].body).toMatchObject({ expectedSnapshotId: null, expectedSnapshotVersion: 0, sourceItemIds: ["analysis-prompt", "analysis-url", "analysis-image"] });
  expect(context.mutations[0].url).toMatch(/\/links\/snapshots$/);
});

test("integrity fallback withholds derived content while separately stored originals remain visible", async ({ page }) => {
  const context = await harness(page);
  context.state = { ...context.state, unavailableReason: "link_integrity_mismatch", currentRevisionId: null, currentSnapshotId: null, currentSnapshotVersion: 0, selectedSnapshot: null, members: [], availableSources: [], snapshotHistory: { items: [], nextCursor: null }, selectedRun: null, publishedRun: null, runHistory: { items: [], nextCursor: null }, latestAttempt: null, fragments: [], capabilities: { canCreateSnapshot: false, canAnalyze: false, canReview: false, reason: "link_integrity_mismatch" } };
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect(page.locator(".v2-link-status")).toContainText("링크 정리 상태 확인 필요");
  await expect(page.locator(".v2-link-fragment")).toHaveCount(0);
  await expect(page.locator("#source-analysis-prompt")).toContainText("window light, synthetic portrait");
  await expect(page.locator(".v2-record-link-analysis")).not.toContainText("link_integrity_mismatch");
  await expect(page.getByRole("button", { name: "AI로 정리", exact: true })).toBeDisabled();
  expect(context.mutations).toHaveLength(0);
});

test("collapsing unsaved source editing retains text and selections and keeps the unload warning", async ({ page }) => {
  const context = await harness(page);
  const toggle = page.getByRole("button", { name: "자료 추가·선택 변경", exact: true });
  await toggle.click();
  const editor = page.getByRole("region", { name: "자료 버전 편집", exact: true });
  await editor.locator("fieldset").getByRole("checkbox").first().uncheck();
  await editor.getByRole("button", { name: "링크 자료 추가", exact: true }).click();
  await editor.getByLabel("출처 URL 1", { exact: true }).fill("https://example.com/unsaved-source");
  await editor.getByLabel(/^출처 원문 1/).fill("  접어도 남아 있는 원문\n  ");
  await toggle.click();
  await expect(page.locator(".v2-link-snapshot-editor")).toBeHidden();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  await toggle.click();
  await expect(editor.locator("fieldset").getByRole("checkbox").first()).not.toBeChecked();
  await expect(editor.getByLabel("출처 URL 1", { exact: true })).toHaveValue("https://example.com/unsaved-source");
  await expect(editor.getByLabel(/^출처 원문 1/)).toHaveValue("  접어도 남아 있는 원문\n  ");
  await expect(editor).toContainText("복구해도 자동 업로드하지 않습니다");
  expect(context.mutations).toHaveLength(0);
});
