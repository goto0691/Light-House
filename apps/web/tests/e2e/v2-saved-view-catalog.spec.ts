import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const grid = (page: Page) => page.locator(".v2-saved-catalog-grid");
const catalog = (page: Page) => page.getByRole("region", { name: "내 목록", exact: true });
const query = (page: Page) => catalog(page).getByLabel("목록 이름", { exact: true });
const status = (page: Page) => catalog(page).getByRole("status");
function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
function reply(url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim(), pinnedOnly = url.searchParams.get("pinned") === "1", requestedPage = Number(url.searchParams.get("page") ?? 1);
  const views = Array.from({ length: 45 }, (_, index) => ({ id: `catalog-${String(index + 1).padStart(3, "0")}`, name: `합성 목록 ${String(index + 1).padStart(3, "0")}`, description: `합성 설명 ${index + 1}`, iconKey: "type.collection", pinned: index < 3, pinOrder: index < 3 ? index : null }))
    .filter((view) => (!pinnedOnly || view.pinned) && view.name.toLowerCase().includes(q.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(views.length / 20)), page = Math.min(requestedPage, totalPages);
  return { contract: "saved-view-catalog.v1", query: q, pinnedOnly, page, pageSize: 20, totalCount: views.length, totalPages, views: views.slice((page - 1) * 20, page * 20) };
}
async function setup(page: Page, suffix = "") {
  const reads: { request: Request; url: URL }[] = [], writes: string[] = [], handlers: Promise<void>[] = [];
  let handler: ((route: Route, url: URL) => Promise<void>) | null = null;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") { writes.push(route.request().method()); return route.fulfill({ status: 500, json: {} }); }
    if (url.pathname !== "/api/v2/saved-views") return route.fulfill({ status: 404, json: {} });
    reads.push({ request: route.request(), url });
    const pending = handler ? handler(route, url) : route.fulfill({ json: reply(url), headers: { "Cache-Control": "private, no-store" } });
    handlers.push(pending); return pending;
  });
  await page.goto(`/v2-lab?surface=saved-view-catalog${suffix}`);
  await expect(catalog(page).getByRole("heading", { name: "내 목록", exact: true })).toBeVisible();
  return { reads, writes, onRead(next: typeof handler) { handler = next; }, settle: () => Promise.all(handlers) };
}
async function search(page: Page, text: string) { await query(page).fill(text); await catalog(page).getByRole("button", { name: "찾기", exact: true }).click(); }

test("catalog visits all 45 summaries across bounded pages and keeps link identity without mutating saved views", async ({ page }) => {
  const context = await setup(page);
  const names: string[] = [];
  for (let p = 1; p <= 3; p++) {
    await expect(status(page)).toHaveText(`전체 45개 · ${p} / 3페이지`);
    await expect(grid(page).locator("li")).toHaveCount(p < 3 ? 20 : 5);
    names.push(...await grid(page).getByRole("heading").allTextContents());
    if (p < 3) await catalog(page).getByRole("button", { name: "다음", exact: true }).click();
  }
  expect(names).toEqual(Array.from({ length: 45 }, (_, i) => `합성 목록 ${String(i + 1).padStart(3, "0")}`));
  await expect(page).toHaveURL(/surface=saved-view-catalog&page=3$/);
  await expect(grid(page).getByRole("link").first()).toHaveAttribute("href", "/v2/library/views/catalog-041");
  await expect(catalog(page).getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await catalog(page).getByRole("button", { name: "이전", exact: true }).click(); await expect(status(page)).toContainText("2 / 3페이지");
  expect(context.reads.map((entry) => entry.url.searchParams.get("page"))).toEqual(["2", "3", "2"]); expect(context.writes).toEqual([]);
});

test("name entry and pinned selection require explicit search, with empty-state recovery and no saved-query writes", async ({ page }) => {
  const context = await setup(page); await query(page).fill("합성 목록 04");
  expect(context.reads).toHaveLength(0); await expect(grid(page).locator("li")).toHaveCount(20);
  await query(page).press("Enter"); await expect(status(page)).toHaveText("“합성 목록 04” 이름 검색 · 전체 6개 · 1 / 1페이지");
  await expect(grid(page).locator("li")).toHaveCount(6); await expect(query(page)).toHaveValue("합성 목록 04");
  await catalog(page).getByRole("checkbox", { name: "고정한 목록만", exact: true }).check(); expect(context.reads).toHaveLength(1);
  await catalog(page).getByRole("button", { name: "찾기", exact: true }).click();
  await expect(catalog(page).getByRole("heading", { name: "조건에 맞는 목록이 없습니다.", exact: true })).toBeVisible();
  await expect(status(page)).toContainText("전체 0개");
  await catalog(page).getByRole("button", { name: "전체 목록 보기", exact: true }).click();
  await expect(grid(page).locator("li")).toHaveCount(20); await expect(query(page)).toHaveValue(""); expect(context.writes).toEqual([]);
});

test("successful URL state survives Back, Forward and a server-rendered reload including clamped initial pages", async ({ page }) => {
  const context = await setup(page, "&page=999");
  await expect(status(page)).toHaveText("전체 45개 · 3 / 3페이지"); await expect(page).toHaveURL(/&page=3$/);
  await search(page, "합성 목록 04"); await expect(status(page)).toContainText("전체 6개");
  await page.goBack(); await expect(status(page)).toHaveText("전체 45개 · 3 / 3페이지"); await expect(query(page)).toHaveValue("");
  await page.goForward(); await expect(status(page)).toContainText("전체 6개"); await expect(query(page)).toHaveValue("합성 목록 04");
  await page.reload(); await expect(status(page)).toHaveText("“합성 목록 04” 이름 검색 · 전체 6개 · 1 / 1페이지"); await expect(grid(page).locator("li")).toHaveCount(6);
  expect(context.writes).toEqual([]);
});

test("a network error preserves submitted input and previous results with an explicit matching retry", async ({ page }) => {
  const context = await setup(page); context.onRead(async (route) => route.abort("failed"));
  await search(page, "합성 목록 04"); await expect(catalog(page).getByRole("alert")).toContainText("입력한 조건은 유지됩니다");
  await expect(query(page)).toHaveValue("합성 목록 04"); await expect(grid(page).locator("li")).toHaveCount(20); await expect(status(page)).toContainText("마지막으로 확인한");
  context.onRead(null); await catalog(page).getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(status(page)).toContainText("전체 6개"); expect(context.reads.map((entry) => entry.url.searchParams.get("q"))).toEqual(["합성 목록 04", "합성 목록 04"]);
});

test("typing while a response is pending preserves the newer draft and does not submit it automatically", async ({ page }) => {
  const context = await setup(page), delayed = latch();
  context.onRead(async (route, url) => { await delayed.promise; await route.fulfill({ json: reply(url) }); });
  await search(page, "합성 목록 04"); await expect.poll(() => context.reads.length).toBe(1);
  await query(page).fill("다음에 찾을 목록"); delayed.release(); await context.settle();
  await expect(status(page)).toContainText("전체 6개"); await expect(query(page)).toHaveValue("다음에 찾을 목록"); expect(context.reads).toHaveLength(1);
});

for (const mismatch of ["query", "count", "page", "private full DTO", "duplicate IDs"] as const) {
  test(`a ${mismatch} response is rejected without disclosing injected metadata and a valid retry recovers`, async ({ page }) => {
    const context = await setup(page);
    context.onRead(async (route, url) => {
      const value = reply(url); const body: Record<string, unknown> = { ...value, views: value.views.map((view) => ({ ...view, name: "DO NOT SHOW" })) };
      if (mismatch === "query") body.query = "other";
      if (mismatch === "count") body.totalCount = 42;
      if (mismatch === "page") body.page = 2;
      if (mismatch === "private full DTO") body.views = value.views.map((view) => ({ ...view, name: "DO NOT SHOW", queryPlan: { fullText: "PRIVATE" } }));
      if (mismatch === "duplicate IDs") body.views = value.views.map((view) => ({ ...view, id: value.views[0].id, name: "DO NOT SHOW" }));
      await route.fulfill({ json: body });
    });
    await search(page, "합성 목록 04"); await expect(catalog(page).getByRole("alert")).toContainText("입력한 조건은 유지됩니다");
    await expect(catalog(page)).not.toContainText("DO NOT SHOW"); await expect(catalog(page)).not.toContainText("PRIVATE");
    await expect(query(page)).toHaveValue("합성 목록 04"); await expect(grid(page).locator("li")).toHaveCount(20);
    context.onRead(null); await catalog(page).getByRole("button", { name: "다시 시도", exact: true }).click(); await expect(status(page)).toContainText("전체 6개");
  });
}

for (const denial of [401, 403, 404, 423]) {
  test(`${denial} closes metadata before reading an unfinished body and cannot be reopened by form controls`, async ({ page }) => {
    await page.addInitScript((status) => {
      const original = window.fetch.bind(window), state = { responses: 0, jsonReads: 0 };
      Object.assign(window, { catalogHeaderFixture: state });
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname !== "/api/v2/saved-views") return original(input, init);
        state.responses++;
        const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); } }), { status });
        const read = response.json.bind(response); response.json = () => { state.jsonReads++; return read(); }; return Promise.resolve(response);
      };
    }, denial);
    const context = await setup(page); await search(page, "합성 목록 04");
    await expect(catalog(page).getByRole("alert")).toContainText("목록 접근이 종료되었습니다"); await expect(grid(page)).toHaveCount(0); await expect(query(page)).toHaveCount(0);
    await expect(catalog(page)).not.toContainText("합성 목록 001"); await expect(catalog(page).getByRole("button")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { catalogHeaderFixture: { responses: number; jsonReads: number } }).catalogHeaderFixture)).toEqual({ responses: 1, jsonReads: 0 });
    expect(context.writes).toEqual([]);
  });
}

test("an unabortable old JSON body cannot repopulate names after a newer access denial", async ({ page }) => {
  const lateBody = reply(new URL("http://localhost/api/v2/saved-views?q=합성 목록 04"));
  await page.addInitScript((body) => {
    const original = window.fetch.bind(window), state = { started: false, delivered: false, aborted: false, release: () => {} };
    Object.assign(window, { catalogLateFixture: state });
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== "/api/v2/saved-views") return original(input, init);
      if (url.searchParams.get("q") === "합성 목록 04") {
        init?.signal?.addEventListener("abort", () => { state.aborted = true; });
        const response = new Response("{}", { status: 200 });
        response.json = () => new Promise((resolve) => { state.started = true; state.release = () => { state.delivered = true; resolve(body); }; });
        return Promise.resolve(response);
      }
      return Promise.resolve(new Response("{}", { status: 401 }));
    };
  }, lateBody);
  await setup(page); await search(page, "합성 목록 04");
  await expect.poll(() => page.evaluate(() => (window as unknown as { catalogLateFixture: { started: boolean } }).catalogLateFixture.started)).toBe(true);
  await search(page, "deny"); await expect(catalog(page).getByRole("alert")).toContainText("접근이 종료");
  const evidence = await page.evaluate(() => { const state = (window as unknown as { catalogLateFixture: { release(): void; delivered: boolean; aborted: boolean } }).catalogLateFixture; state.release(); return { delivered: state.delivered, aborted: state.aborted }; });
  expect(evidence).toEqual({ delivered: true, aborted: true });
  await expect(grid(page)).toHaveCount(0); await expect(catalog(page)).not.toContainText("합성 목록 040"); await expect(query(page)).toHaveCount(0);
});

test("a newer successful query aborts an old network response without applying its names or URL", async ({ page }) => {
  const context = await setup(page), slow = latch();
  context.onRead(async (route, url) => { if (url.searchParams.get("q") === "합성 목록 04") await slow.promise; await route.fulfill({ json: reply(url) }).catch(() => {}); });
  await search(page, "합성 목록 04"); await expect.poll(() => context.reads.length).toBe(1); const old = context.reads[0].request;
  await search(page, "합성 목록 03"); await expect(status(page)).toContainText("“합성 목록 03” 이름 검색 · 전체 10개");
  await expect.poll(() => old.failure()?.errorText).toBe("net::ERR_ABORTED"); slow.release(); await context.settle();
  await expect(query(page)).toHaveValue("합성 목록 03"); await expect(grid(page).getByRole("heading").first()).toHaveText("합성 목록 030");
  expect(new URL(page.url()).searchParams.get("q")).toBe("합성 목록 03");
});

test("mobile More open and close at an unchanged catalog URL do not refetch metadata", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const context = await setup(page);
  await search(page, "합성 목록 04"); await expect(status(page)).toContainText("전체 6개"); expect(context.reads).toHaveLength(1);
  await page.getByRole("button", { name: "더보기", exact: true }).click(); await expect(page.getByRole("dialog", { name: "더보기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "더보기 닫기", exact: true }).click(); await expect(page.getByRole("dialog", { name: "더보기", exact: true })).toHaveCount(0);
  await expect(status(page)).toContainText("전체 6개"); expect(context.reads).toHaveLength(1); expect(new URL(page.url()).searchParams.get("q")).toBe("합성 목록 04");
});

test("a catalog success while More is open preserves one-step close and commits the successful URL afterward", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const context = await setup(page), slow = latch();
  context.onRead(async (route, url) => { await slow.promise; await route.fulfill({ json: reply(url) }); });
  await search(page, "합성 목록 04"); await expect.poll(() => context.reads.length).toBe(1);
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  const more = page.getByRole("dialog", { name: "더보기", exact: true }); await expect(more).toBeVisible();
  slow.release(); await context.settle(); await expect(page.locator(".v2-saved-catalog-status")).toContainText("전체 6개");
  expect(new URL(page.url()).searchParams.get("q")).toBeNull(); await more.getByRole("button", { name: "더보기 닫기", exact: true }).click();
  await expect(more).toHaveCount(0); await expect(status(page)).toContainText("전체 6개"); expect(new URL(page.url()).searchParams.get("q")).toBe("합성 목록 04"); expect(context.reads).toHaveLength(1);
  await page.reload(); await expect(status(page)).toContainText("전체 6개");
});

test("baseline More navigation without pending catalog history reaches the same synthetic HTML destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const context = await setup(page);
  await page.route("**/v2/library/templates**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>템플릿</title></head><body><main><h1>선택한 템플릿 목적지</h1></main></body></html>' }));
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  await page.getByRole("dialog", { name: "더보기", exact: true }).getByRole("link", { name: "템플릿", exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/library\/templates$/); await expect(page.getByRole("heading", { name: "선택한 템플릿 목적지", exact: true })).toBeVisible();
  expect(context.reads).toHaveLength(0); expect(context.writes).toEqual([]);
});

test("a pending catalog history update does not replace the destination chosen inside More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const context = await setup(page), slow = latch();
  await page.route("**/v2/library/templates**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>템플릿</title></head><body><main><h1>선택한 템플릿 목적지</h1></main></body></html>' }));
  context.onRead(async (route, url) => { await slow.promise; await route.fulfill({ json: reply(url) }); });
  await search(page, "합성 목록 04"); await expect.poll(() => context.reads.length).toBe(1);
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  const more = page.getByRole("dialog", { name: "더보기", exact: true }); await expect(more).toBeVisible();
  slow.release(); await context.settle(); await expect(page.locator(".v2-saved-catalog-status")).toContainText("전체 6개");
  await more.getByRole("link", { name: "템플릿", exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/library\/templates$/); await expect(page.getByRole("heading", { name: "선택한 템플릿 목적지", exact: true })).toBeVisible();
  expect(context.reads).toHaveLength(1); expect(context.writes).toEqual([]);
});

test("catalog keeps keyboard access, narrow 320px layout and scoped accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await setup(page);
  await query(page).focus(); await query(page).fill("합성 목록 04"); await query(page).press("Enter"); await expect(status(page)).toContainText("전체 6개");
  await query(page).press("Tab"); await expect(catalog(page).getByRole("button", { name: "찾기", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await catalog(page).getByRole("heading", { name: "내 목록", exact: true }).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(27);
  const input = await query(page).boundingBox(), searchButton = await catalog(page).getByRole("button", { name: "찾기", exact: true }).boundingBox();
  expect(input?.width).toBeGreaterThan(100); expect(searchButton!.x + searchButton!.width).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).include(".v2-saved-catalog").analyze()).violations).toEqual([]);
});

for (const pending of [false, true]) {
  test(`actual RSC More navigation ${pending ? "with pending catalog history" : "without pending history"} reaches the chosen fixture destination`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); const context = await setup(page, "&catalogNav=lab"), slow = latch();
    if (pending) {
      context.onRead(async (route, url) => { await slow.promise; await route.fulfill({ json: reply(url) }); });
      await search(page, "합성 목록 04"); await expect.poll(() => context.reads.length).toBe(1);
    }
    await page.getByRole("button", { name: "더보기", exact: true }).click();
    const more = page.getByRole("dialog", { name: "더보기", exact: true }); await expect(more).toBeVisible();
    await expect(more.getByRole("link", { name: "템플릿", exact: true })).toHaveAttribute("href", "/v2-lab?surface=product-library");
    if (pending) { slow.release(); await context.settle(); await expect(page.locator(".v2-saved-catalog-status")).toContainText("전체 6개"); }
    await more.getByRole("link", { name: "템플릿", exact: true }).click();
    await expect(page).toHaveURL(/\/v2-lab\?surface=product-library$/);
    await expect(page.getByRole("heading", { name: "모든 기록", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "모바일에서 열 기록 · normal", exact: true })).toBeVisible();
    expect(context.reads).toHaveLength(pending ? 1 : 0); expect(context.writes).toEqual([]);
  });
}
