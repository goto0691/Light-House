import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { describeV2QueryPlan, naturalSearchHref, NATURAL_QUERY_INTERPRETATION_CONTRACT } from "../../src/lib/v2/retrieval/plan-presentation";
import { defaultV2QueryPlan } from "../../src/lib/v2/retrieval/query-plan-v1";
import { queryPlanFromSearchParams } from "../../src/lib/v2/retrieval/search-params";

/** Browser/HTTP-fixture evidence only: the interpretation API is synthetic; no Gemini, D1 or session is exercised. */
const question = "작년에 별점 4점 이상 준 게임 리뷰";
const plan = defaultV2QueryPlan({
  typeKeys: ["game_review"], propertyFilters: [{ fieldKey: "user_rating", operator: "gte", value: 4 }],
  dateFilter: { axis: "captured_at", from: "2025-01-01", to: "2025-12-31" },
});
const labels = { types: new Map([["game_review", "게임 리뷰"]]), fields: new Map([["user_rating", "평점"]]) };
const interpretation = {
  contract: NATURAL_QUERY_INTERPRETATION_CONTRACT, today: "2026-09-28", plan, href: naturalSearchHref(plan), chips: describeV2QueryPlan(plan, labels),
  dropped: [{ code: "unmapped_phrase", message: "‘준’ 부분은 검색 조건으로 바꾸지 않았습니다." }],
};
type Handler = (route: Route) => Promise<void>;

async function setup(page: Page) {
  const requests: { method: string; body: unknown }[] = [], navigations: URL[] = [];
  let handler: Handler | null = null;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/search/interpret", async (route) => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    if (handler) return handler(route);
    return route.fulfill({ json: interpretation, headers: { "Cache-Control": "private, no-store" } });
  });
  // The real results page needs a session; record the navigation target instead.
  await page.route(/\/v2\/search(\?|$)/, (route) => {
    navigations.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>합성 검색 결과</title><main><h1>합성 검색 결과</h1></main></html>" });
  });
  await page.goto("/v2-lab?surface=natural-search");
  await expect(page.getByRole("heading", { name: "기록 검색", exact: true })).toBeVisible();
  return { requests, navigations, respond(next: Handler | null) { handler = next; } };
}
const searchbox = (page: Page) => page.getByRole("searchbox");
// Next dev adds its own route-announcer alert; scope to the search feature.
const searchAlert = (page: Page) => page.locator(".v2-natural-search").getByRole("alert");
const trigger = (page: Page) => page.getByRole("button", { name: /자연어로 해석|해석 중/ });
const panel = (page: Page) => page.getByRole("region", { name: "질문을 이렇게 이해했습니다", exact: true });

test("interprets only on the explicit action, shows AI conditions and applies them as a shareable search URL", async ({ page }) => {
  const context = await setup(page);
  await searchbox(page).fill(question);
  await page.waitForTimeout(300);
  expect(context.requests).toEqual([]);
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  expect(context.requests).toEqual([{ method: "POST", body: { question } }]);
  await expect(panel(page).getByRole("heading", { name: "질문을 이렇게 이해했습니다", exact: true })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("AI가 조건 3개를 찾았습니다.");
  await expect(panel(page)).toContainText("AI가 해석한 조건 · 제안");
  await expect(panel(page)).toContainText(`내가 입력한 질문${question}`);
  const chips = panel(page).getByRole("list", { name: "AI가 해석한 검색 조건", exact: true }).getByRole("listitem");
  await expect(chips).toHaveText(["분류 게임 리뷰", "평점 4 이상", "기록한 날 2025-01-01 ~ 2025-12-31", "정렬 최근 수정순"]);
  await expect(panel(page).getByRole("heading", { name: "반영하지 않은 부분", exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("‘준’ 부분은 검색 조건으로 바꾸지 않았습니다.");
  await expect(panel(page)).toContainText("감정·의도·성격·관계에 대한 해석은 조건으로 쓰지 않습니다.");
  const apply = panel(page).getByRole("link", { name: "이 조건으로 검색", exact: true });
  await expect(apply).toHaveAttribute("href", interpretation.href);
  expect(interpretation.href).toBe("/v2/search?type=game_review&rating=4&from=2025-01-01&to=2025-12-31&sort=updated_at&direction=desc&nl=1");
  await apply.click();
  await expect(page.getByRole("heading", { name: "합성 검색 결과", exact: true })).toBeVisible();
  const target = new URL(page.url());
  expect(`${target.pathname}${target.search}`).toBe(interpretation.href);
  expect(context.requests).toHaveLength(1);
});

test("keyboard use, Escape, duplicate presses and invalid responses keep keyword search available", async ({ page }) => {
  const context = await setup(page);
  await trigger(page).focus(); await page.keyboard.press("Enter");
  await expect(searchAlert(page)).toHaveText("해석할 질문을 검색창에 입력해 주세요.");
  await expect(searchbox(page)).toBeFocused();
  expect(context.requests).toHaveLength(0);

  let release: () => void = () => undefined;
  context.respond(async (route) => { await new Promise<void>((resolve) => { release = resolve; }); await route.fulfill({ json: interpretation }); });
  await searchbox(page).fill(question);
  await trigger(page).focus(); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await expect(trigger(page)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("status")).toHaveText("AI가 질문을 검색 조건으로 해석하고 있습니다…");
  await expect.poll(() => context.requests.length).toBe(1);
  release();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();

  context.respond((route) => route.fulfill({ json: { ...interpretation, href: "https://attacker.example/v2/search" } }));
  await trigger(page).click();
  await expect(searchAlert(page)).toContainText("AI 해석 결과를 확인하지 못했습니다");
  await expect(panel(page)).toHaveCount(0);

  await searchbox(page).press("Enter");
  await expect(page.getByRole("heading", { name: "합성 검색 결과", exact: true })).toBeVisible();
  expect(context.navigations.at(-1)?.searchParams.get("q")).toBe(question);
  expect(context.navigations.at(-1)?.searchParams.has("nl")).toBe(false);
});

test("quota, disabled AI and empty interpretations explain the fallback without applying anything", async ({ page }) => {
  const context = await setup(page);
  await searchbox(page).fill(question);
  const retryAt = new Date(Date.now() + 60 * 60_000).toISOString();
  context.respond((route) => route.fulfill({ status: 429, json: { error: { code: "search_quota_exhausted", message: "AI 사용량 한도를 회복하는 중입니다.", retryable: true, retryAt } } }));
  await trigger(page).click();
  await expect(searchAlert(page)).toContainText("AI 사용량 한도에 도달했습니다 · ");
  await expect(searchAlert(page)).toContainText("이후 다시 시도해 주세요. 키워드 검색은 그대로 사용할 수 있습니다.");
  await expect(panel(page)).toHaveCount(0);

  context.respond((route) => route.fulfill({ status: 503, json: { error: { code: "v2_ai_disabled", message: "AI 해석이 꺼져 있습니다. 키워드 검색은 그대로 사용할 수 있습니다.", retryable: false, retryAt: null } } }));
  await trigger(page).click();
  await expect(searchAlert(page)).toHaveText("AI 해석이 꺼져 있습니다. 키워드 검색은 그대로 사용할 수 있습니다.");

  const empty = defaultV2QueryPlan();
  context.respond((route) => route.fulfill({ json: { ...interpretation, plan: empty, href: naturalSearchHref(empty), chips: describeV2QueryPlan(empty), dropped: [] } }));
  await trigger(page).click();
  await expect(panel(page)).toContainText("검색 조건으로 바꿀 수 있는 표현을 찾지 못했습니다.");
  await expect(panel(page).getByRole("link", { name: "이 조건으로 검색", exact: true })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "입력한 문장 그대로 키워드 검색", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 검색 결과", exact: true })).toBeVisible();
  expect(context.navigations.at(-1)?.searchParams.get("q")).toBe(question);
  expect(context.requests).toHaveLength(3);
});

test("narrow 320px layout keeps the panel usable and accessible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const context = await setup(page);
  await searchbox(page).fill(`${question} ${"아주긴질문".repeat(20)}`.slice(0, 300));
  context.respond((route) => route.fulfill({ json: { ...interpretation, dropped: [{ code: "unmapped_phrase", message: `‘${"줄바꿈없는아주긴표현".repeat(4)}…’ 부분은 검색 조건으로 바꾸지 않았습니다.` }] } }));
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of [trigger(page), panel(page).getByRole("link", { name: "이 조건으로 검색", exact: true }), panel(page).getByRole("button", { name: "AI 해석 닫기", exact: true }),
    page.getByRole("combobox", { name: "정렬", exact: true }), page.getByRole("combobox", { name: "정렬 방향", exact: true })]) {
    const box = await control.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320 && box.height >= 44).toBe(true);
  }
  expect((await new AxeBuilder({ page }).include(".v2-search-main").analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("natural-search-320.png"), fullPage: true });
});

test("written-date ordering stays visible and survives keyword submission, back navigation and an explicit sort change", async ({ page }) => {
  const context = await setup(page);
  const field = page.getByRole("combobox", { name: "정렬", exact: true });
  const direction = page.getByRole("combobox", { name: "정렬 방향", exact: true });
  await expect(field).toHaveValue("written_at");
  await expect(field.locator("option:checked")).toHaveText("작성·경험일");
  await expect(direction).toHaveValue("asc");
  await searchbox(page).fill("작성 날짜 기록");
  await searchbox(page).press("Enter");
  await expect(page.getByRole("heading", { name: "합성 검색 결과", exact: true })).toBeVisible();
  expect(queryPlanFromSearchParams(new URL(page.url()).searchParams)).toMatchObject({
    fullText: "작성 날짜 기록", sort: { field: "written_at", direction: "asc" },
  });
  expect(context.requests).toEqual([]);

  await page.goBack();
  await expect(field).toHaveValue("written_at");
  await expect(direction).toHaveValue("asc");
  await field.selectOption("title");
  await direction.selectOption("desc");
  await searchbox(page).fill("새 검색어");
  await page.getByRole("button", { name: "검색", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "합성 검색 결과", exact: true })).toBeVisible();
  expect(queryPlanFromSearchParams(new URL(page.url()).searchParams)).toMatchObject({
    fullText: "새 검색어", sort: { field: "title", direction: "desc" },
  });
  expect(context.requests).toEqual([]);
});
