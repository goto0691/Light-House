import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const filters = ["all", "waiting", "attention", "completed", "unprocessed"] as const;
type Filter = typeof filters[number];
const states = ["queued", "processing", "retry_wait", "needs_review", "completed", "outdated", "unprocessed", "restricted"] as const;
const records = Array.from({ length: 45 }, (_, index) => {
  const stageStatus = states[index % 8], status = index === 4 ? "needs_review" : stageStatus, restricted = status === "restricted", sensitive = index === 8;
  return { recordId: `processing-${String(index).padStart(3, "0")}`, title: restricted ? "잠긴 기록" : sensitive ? "민감 기록" : index === 0 ? `긴제목${"줄바꿈없이남긴기록제목".repeat(36)}끝` : `합성 처리 기록 ${String(index + 1).padStart(3, "0")}`, privacyLevel: restricted ? "restricted" : sensitive ? "sensitive" : "normal", savedAt: new Date(Date.UTC(2026, 8, 22, 9, 45 - index)).toISOString(), storage: "saved", status, partial: index === 4, reviewPending: index === 4,
    stages: restricted || status === "unprocessed" ? [] : [{ stage: "analyze", status: stageStatus, count: 1, nextAttemptAt: status === "retry_wait" ? "2026-09-22T10:00:00.000Z" : null }] };
});
function fits(status: string, filter: Filter) { return filter === "all" || filter === "waiting" && ["queued", "processing", "retry_wait"].includes(status) || filter === "attention" && ["needs_review", "outdated"].includes(status) || filter === "completed" && status === "completed" || filter === "unprocessed" && ["unprocessed", "restricted"].includes(status); }
function response(url: URL) {
  const filter = (url.searchParams.get("filter") || "all") as Filter, subset = records.filter((item) => fits(item.status, filter));
  const cursor = url.searchParams.get("cursor"), start = cursor ? subset.findIndex((item) => item.recordId === JSON.parse(cursor)[1]) + 1 : 0, items = subset.slice(start, start + 20), last = items.at(-1);
  return { contract: "processing-status.v1", filter, items, counts: Object.fromEntries(filters.map((key) => [key, records.filter((item) => fits(item.status, key)).length])), nextCursor: start + 20 < subset.length && last ? JSON.stringify([last.savedAt, last.recordId, filter]) : null, checkedAt: "2026-09-22T09:55:00.000Z",
    runtime: { enabled: true, configured: true, roles: [{ role: "main_analyzer", state: "unknown", retryAt: null }, { role: "grounded_enricher", state: "quota_exhausted", retryAt: "2026-09-23T00:00:00.000Z" }] } };
}
async function setup(page: Page) {
  const reads: URL[] = [], methods: string[] = [];
  let handler: ((route: Route, url: URL) => Promise<void>) | null = null;
  await page.route("**/api/v2/processing/status?**", async (route) => { const url = new URL(route.request().url()); reads.push(url); methods.push(route.request().method()); if (handler) await handler(route, url); else await route.fulfill({ json: response(url) }); });
  await page.goto("/v2-lab?surface=processing-status"); await expect(page.getByRole("heading", { name: "처리 상태", exact: true })).toBeVisible();
  return { reads, methods, respond(value: typeof handler) { handler = value; } };
}
function view(page: Page) { return page.locator(".v2-processing-view"); }
function items(page: Page) { return page.locator(".v2-processing-item"); }
function filterButton(page: Page, name: string) { return page.getByRole("group", { name: "처리 상태 필터", exact: true }).getByRole("button", { name: new RegExp(`^${name}`) }); }
type JsonHoldWindow = typeof window & { __processingJsonHeld?: boolean; __releaseProcessingJson?: () => void; __processingDeniedJsonRead?: boolean };
async function holdWaitingJson(page: Page) {
  await page.evaluate(() => {
    const scope = window as JsonHoldWindow, original = window.fetch.bind(window);
    scope.__processingJsonHeld = false;
    window.fetch = async (...args) => {
      const result = await original(...args), url = String(args[0]);
      if (url.includes("/api/v2/processing/status?") && new URL(url, location.href).searchParams.get("filter") === "waiting") {
        const originalJson = result.json.bind(result);
        Object.defineProperty(result, "json", { value: async () => { const value: unknown = await originalJson(); await new Promise<void>((resolve) => { scope.__releaseProcessingJson = resolve; scope.__processingJsonHeld = true; }); return value; } });
      }
      return result;
    };
  });
}

test("saved originals are distinct from analysis, proposals and partial runs; restricted metadata stays generic", async ({ page }) => {
  const context = await setup(page); await expect(items(page)).toHaveCount(20);
  await expect(view(page)).toContainText("원문 저장과 AI 분석은 별개"); await expect(page.getByRole("status")).toHaveText("전체 45개 · 1페이지 · 20개 표시");
  const partial = items(page).filter({ has: page.getByRole("link", { name: "합성 처리 기록 005", exact: true }) });
  await expect(partial).toContainText("원문 저장 완료"); await expect(partial.locator(".v2-processing-badge")).toHaveText("확인 필요"); await expect(partial).toContainText("일부 자료는 아직 분석하지 못했습니다"); await expect(partial).toContainText("AI 제안은 아직 확인하지 않았습니다");
  await expect(partial.getByRole("link", { name: "기록에서 확인하기", exact: true })).toHaveAttribute("href", "/v2/records/processing-004");
  const outdated = items(page).filter({ has: page.getByRole("link", { name: "합성 처리 기록 006", exact: true }) }); await expect(outdated).toContainText("현재 원문과 이전 분석 결과가 다릅니다");
  const locked = items(page).filter({ has: page.getByRole("link", { name: "잠긴 기록", exact: true }) }); await expect(locked).toHaveCount(2); await expect(locked.locator("details")).toHaveCount(0);
  await expect(items(page).filter({ has: page.getByRole("link", { name: "민감 기록", exact: true }) })).toHaveCount(1);
  await expect(view(page).getByRole("button", { name: /분석 실행|작업 재시도|지금 실행/ })).toHaveCount(0); expect(context.reads).toHaveLength(0);
});

test("explicit 20 item pages, filters, previous and refresh keep read-only requests scoped", async ({ page }) => {
  const context = await setup(page); await page.getByLabel("화면 밖 메모", { exact: true }).fill("페이지가 바뀌어도 유지");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click(); await expect(page.getByRole("status")).toContainText("2페이지 · 20개 표시"); await expect(items(page).first()).toContainText("합성 처리 기록 021");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click(); await expect(items(page)).toHaveCount(5); await expect(page.getByRole("button", { name: "다음 페이지", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click(); await expect(page.getByRole("status")).toContainText("2페이지");
  await filterButton(page, "분석 완료").click(); await expect(items(page)).toHaveCount(5); await expect(page.getByRole("status")).toHaveText("분석 완료 5개 · 1페이지 · 5개 표시");
  await page.getByRole("button", { name: "새로고침", exact: true }).click(); await expect(items(page)).toHaveCount(5); expect(context.reads.at(-1)?.searchParams.get("filter")).toBe("completed"); expect(context.reads.at(-1)?.searchParams.has("cursor")).toBe(false);
  expect(context.methods.every((method) => method === "GET")).toBe(true); await expect(page.getByLabel("화면 밖 메모", { exact: true })).toHaveValue("페이지가 바뀌어도 유지");
});

test("failed next page drops stale metadata, retries the same cursor and supports returning to the first page", async ({ page }) => {
  const context = await setup(page); context.respond((route) => route.fulfill({ status: 500, body: "provider raw should not appear" }));
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click(); await expect(view(page).getByRole("alert")).toContainText("원문 저장 여부가 바뀐 것은 아닙니다");
  await expect(items(page)).toHaveCount(0); await expect(page.getByRole("region", { name: "분석 실행 조건", exact: true })).toHaveCount(0); await expect(view(page)).not.toContainText("provider raw");
  const cursor = context.reads.at(-1)?.searchParams.get("cursor"); context.respond(null); await page.getByRole("button", { name: "상태 다시 확인", exact: true }).click(); await expect(items(page)).toHaveCount(20); expect(context.reads.at(-1)?.searchParams.get("cursor")).toBe(cursor);
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click(); await expect(page.getByRole("status")).toContainText("1페이지");
});

test("null initial page loads once explicitly and renders a genuine empty result", async ({ page }) => {
  const context = await setup(page); context.respond((route, url) => route.fulfill({ json: { ...response(url), items: [], counts: { all: 0, waiting: 0, attention: 0, completed: 0, unprocessed: 0 }, nextCursor: null } }));
  await page.getByRole("button", { name: "API부터 확인", exact: true }).click(); await expect(page.getByRole("heading", { name: "이 조건에 해당하는 기록이 없습니다", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("전체 0개 · 1페이지 · 0개 표시"); expect(context.reads.length).toBeGreaterThan(0);
});

for (const statusCode of [401, 403, 404, 423]) {
  test(`${statusCode} response closes titles, counts and runtime without waiting for response JSON`, async ({ page }) => {
    const context = await setup(page); context.respond((route) => route.fulfill({ status: statusCode, body: "PRIVATE ERROR DO NOT DISPLAY" }));
    await page.evaluate((code) => {
      const scope = window as JsonHoldWindow, original = window.fetch.bind(window); scope.__processingDeniedJsonRead = false;
      window.fetch = async (...args) => { const result = await original(...args); if (String(args[0]).includes("/api/v2/processing/status?") && result.status === code) Object.defineProperty(result, "json", { value: () => { scope.__processingDeniedJsonRead = true; return new Promise(() => {}); } }); return result; };
    }, statusCode);
    await page.getByRole("button", { name: "새로고침", exact: true }).click(); await expect(view(page).getByRole("alert")).toContainText("권한을 다시 확인");
    await expect(items(page)).toHaveCount(0); await expect(page.getByRole("region", { name: "분석 실행 조건", exact: true })).toHaveCount(0); await expect(view(page)).not.toContainText("45"); await expect(view(page)).not.toContainText("PRIVATE ERROR");
    expect(await page.evaluate(() => (window as JsonHoldWindow).__processingDeniedJsonRead)).toBe(false);
    context.respond(null); await page.getByRole("button", { name: "상태 다시 확인", exact: true }).click(); await expect(items(page)).toHaveCount(20);
  });
}

for (const defect of ["filter", "contract", "restricted", "sensitive", "cursor", "duplicate", "review-consistency"] as const) {
  test(`mis-scoped or malformed ${defect} response never becomes visible`, async ({ page }) => {
    const context = await setup(page); context.respond((route, url) => { const body = response(url); if (defect === "filter") body.filter = "waiting"; if (defect === "contract") body.contract = "wrong"; if (defect === "restricted") body.items[7] = { ...body.items[7], title: "PRIVATE RESTRICTED TITLE" }; if (defect === "sensitive") body.items[8] = { ...body.items[8], title: "PRIVATE SENSITIVE TITLE" }; if (defect === "cursor") body.nextCursor = JSON.stringify([body.items[0].savedAt, body.items[0].recordId, "all"]); if (defect === "duplicate") body.items[1] = { ...body.items[0] }; if (defect === "review-consistency") body.items[4] = { ...body.items[4], status: "completed" }; return route.fulfill({ json: body }); });
    await page.getByRole("button", { name: "새로고침", exact: true }).click(); await expect(view(page).getByRole("alert")).toBeVisible(); await expect(items(page)).toHaveCount(0); await expect(view(page)).not.toContainText("PRIVATE");
  });
}

test("filter changes discard a late response and loading never exposes previous titles", async ({ page }) => {
  const context = await setup(page); let held: Route | undefined, heldUrl: URL | undefined;
  context.respond(async (route, url) => { if (url.searchParams.get("filter") === "waiting") { held = route; heldUrl = url; } else await route.fulfill({ json: response(url) }); });
  await filterButton(page, "진행·대기").click(); await expect.poll(() => !!held).toBe(true); await expect(page.getByRole("status")).toHaveText("처리 상태 확인 중…"); await expect(items(page)).toHaveCount(0);
  await filterButton(page, "분석 완료").click(); await expect(page.getByRole("status")).toContainText("분석 완료 5개"); await held!.fulfill({ json: response(heldUrl!) }).catch(() => undefined);
  await expect(page.getByRole("status")).toContainText("분석 완료 5개"); await expect(items(page)).toHaveCount(5);
});

test("an unabortable old JSON body cannot overwrite a newer filter or reappear after closing the view", async ({ page }) => {
  await setup(page); await holdWaitingJson(page); await filterButton(page, "진행·대기").click();
  await expect.poll(() => page.evaluate(() => (window as JsonHoldWindow).__processingJsonHeld)).toBe(true);
  await filterButton(page, "분석 완료").click(); await expect(page.getByRole("status")).toContainText("분석 완료 5개");
  await page.evaluate(() => (window as JsonHoldWindow).__releaseProcessingJson?.()); await expect(items(page)).toHaveCount(5); await expect(page.getByRole("status")).toContainText("분석 완료 5개");
  await page.evaluate(() => { (window as JsonHoldWindow).__processingJsonHeld = false; }); await filterButton(page, "진행·대기").click();
  await expect.poll(() => page.evaluate(() => (window as JsonHoldWindow).__processingJsonHeld)).toBe(true); await page.getByRole("button", { name: "처리 화면 닫기", exact: true }).click();
  await page.evaluate(() => (window as JsonHoldWindow).__releaseProcessingJson?.()); await expect(view(page)).toHaveCount(0); await expect(page.getByText("처리 화면을 닫았습니다.", { exact: true })).toBeVisible();
});

test("separate completed and waiting job groups within the same stage remain visible", async ({ page }) => {
  const context = await setup(page); context.respond((route, url) => { const body = response(url); return route.fulfill({ json: { ...body, items: body.items.map((item, index) => index ? item : { ...item, stages: [{ stage: "analyze", status: "completed", count: 1, nextAttemptAt: null }, { stage: "grounded_enrich", status: "completed", count: 1, nextAttemptAt: null }, { stage: "grounded_enrich", status: "retry_wait", count: 2, nextAttemptAt: "2026-09-23T00:00:00.000Z" }] }) } }); });
  await page.getByRole("button", { name: "새로고침", exact: true }).click(); await expect(items(page)).toHaveCount(20);
  const first = items(page).first(); await first.getByText("단계별 작업 상태", { exact: true }).click(); await expect(first.getByText("외부 사실 검색", { exact: true })).toHaveCount(2); await expect(first).toContainText("자동 재시도 대기 · 작업 2개"); await expect(first).toContainText("실행 시각은 보장되지 않습니다");
});

test("runtime off, unconfigured, throttled and circuit-open are conditions, never job success promises", async ({ page }) => {
  const context = await setup(page); await expect(view(page)).toContainText("정상 확인을 뜻하지 않습니다"); await expect(view(page)).toContainText("사용량 한도로 대기"); await expect(view(page)).toContainText("실제 실행 시각은 보장되지 않습니다");
  context.respond((route, url) => route.fulfill({ json: { ...response(url), runtime: { enabled: false, configured: false, roles: [{ role: "main_analyzer", state: "throttled", retryAt: null }, { role: "grounded_enricher", state: "circuit_open", retryAt: null }] } } }));
  await page.getByRole("button", { name: "새로고침", exact: true }).click(); await expect(view(page)).toContainText("자동 분석이 꺼져 있습니다"); await expect(view(page)).toContainText("AI 연결 설정이 준비되지 않았습니다"); await expect(view(page)).toContainText("호출 간격 제한"); await expect(view(page)).toContainText("연속 오류로 호출을 잠시 멈췄습니다");
});

test("keyboard filters, stage details, 320px long titles and utility navigation remain usable and accessible", async ({ page }, testInfo) => {
  await setup(page); await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const summary = items(page).first().locator("summary"); await summary.focus(); await page.keyboard.press("Enter"); await expect(items(page).first().getByText("내 글 정리", { exact: true })).toBeVisible();
  const completed = filterButton(page, "분석 완료"); await completed.focus(); await page.keyboard.press("Enter"); await expect(completed).toHaveAttribute("aria-pressed", "true"); await expect(items(page)).toHaveCount(5);
  expect((await new AxeBuilder({ page }).include(".v2-processing-view").analyze()).violations).toEqual([]);
  await page.getByRole("navigation", { name: "모바일 탐색", exact: true }).getByRole("button", { name: "더보기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "더보기", exact: true }); await expect(dialog.getByRole("link", { name: "처리 상태", exact: true })).toHaveAttribute("href", "/v2/processing");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await page.screenshot({ path: testInfo.outputPath("processing-status-320.png"), fullPage: true });
  await page.goto("/v2-lab?surface=product-library"); await page.setViewportSize({ width: 1440, height: 1000 }); await expect(page.locator(".v2-library-product__sidebar").getByRole("link", { name: "처리 상태", exact: true })).toHaveAttribute("href", "/v2/processing");
});
