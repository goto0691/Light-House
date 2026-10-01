import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const selector = (page: Page) => page.locator(".v2-type-selector");
const selection = (page: Page) => page.getByRole("region", { name: "분류 선택", exact: true });
const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const fields = Array.from({ length: 75 }, (_, index) => ({ key: `type_${String(index).padStart(3, "0")}`, label: `분류 ${String(index).padStart(3, "0")}`, count: 100 - index, entityKind: null }));
function facetResponse(url: URL) {
  const query = (url.searchParams.get("q") ?? "").trim(), selectedKey = url.searchParams.get("selected"), filtered = fields.filter((item) => item.label.includes(query) || item.key.includes(query));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20)), page = Math.min(Number(url.searchParams.get("page") ?? "1"), totalPages);
  return { contract: "facet-page.v1", kind: "type", query, page, pageSize: 20, totalCount: filtered.length, totalPages, items: filtered.slice((page - 1) * 20, page * 20), selected: fields.find((item) => item.key === selectedKey) ?? null };
}
async function setup(page: Page, query = "") {
  const reads: URL[] = [], mutations: string[] = [];
  let handler: ((route: Route, url: URL) => Promise<void>) | null = null;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") mutations.push(route.request().method());
    if (url.pathname === "/api/v2/explore-facets") { reads.push(url); return handler ? handler(route, url) : route.fulfill({ json: facetResponse(url) }); }
    return route.fulfill({ status: 404, json: { error: { code: "unexpected" } } });
  });
  await page.goto(`/v2-lab?surface=catalog-discovery${query ? `&${query}` : ""}`); await expect(page.getByRole("heading", { name: "전체 탐색 검증", exact: true })).toBeVisible();
  return { reads, mutations, respond(next: typeof handler) { handler = next; } };
}
async function open(page: Page) { await selector(page).getByRole("button", { name: /분류 070|unknown_type/ }).click(); await expect(selection(page)).toBeVisible(); }

type HeldNavigationTimers = { snapshot: () => { held: number; cancelled: number }; release: () => { ran: number; cancelled: number } };
async function holdMoreDestinationTimer(page: Page) {
  await page.evaluate(() => {
    const nativeSetTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
    const held = new Map<number, { run: () => void; cancelled: boolean }>();
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      // Isolate the component's named task; do not hold Next or native-history-related timers.
      if (delay === 0 && typeof handler === "function" && handler.name === "completeMoreNavigation") {
        const id = nativeSetTimeout(() => undefined, 60_000);
        held.set(id, { run: () => { handler(...args); }, cancelled: false }); return id;
      }
      return nativeSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      const timer = id === undefined ? undefined : held.get(id); if (timer) timer.cancelled = true;
      nativeClearTimeout(id);
    }) as typeof window.clearTimeout;
    const target = window as typeof window & { __heldNavigationTimers?: HeldNavigationTimers };
    target.__heldNavigationTimers = {
      snapshot: () => ({ held: held.size, cancelled: [...held.values()].filter((timer) => timer.cancelled).length }),
      release: () => {
        window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout;
        let ran = 0, cancelled = 0;
        for (const [id, timer] of held) { nativeClearTimeout(id); if (timer.cancelled) cancelled += 1; else { ran += 1; timer.run(); } }
        held.clear(); return { ran, cancelled };
      },
    };
  });
}

test("selected type outside initial 20 retains exact metadata and choosing never submits the record form", async ({ page }) => {
  const context = await setup(page); await expect(selector(page).getByRole("button", { name: /분류 070/ })).toBeVisible(); expect(context.reads).toEqual([]);
  await open(page); await expect(selection(page).getByRole("status")).toHaveText("75개 분류 · 1/4페이지 · 20개 표시");
  for (let index = 0; index < 3; index++) { await selection(page).getByRole("button", { name: "다음 분류", exact: true }).click(); await expect(selection(page).getByRole("status")).toContainText(`${index + 2}/4페이지`); }
  await selection(page).getByRole("button", { name: "분류 074 26개 기록", exact: true }).click();
  await expect(page.getByTestId("facet-submitted")).toHaveText("아직 제출 안 함"); await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_074");
  await page.getByRole("button", { name: "기록 검색 실행", exact: true }).click(); await expect(page.getByTestId("facet-submitted")).toHaveText("q=archive&type=type_074");
  expect(context.reads.map((url) => url.searchParams.get("page"))).toEqual(["2", "3", "4"]); expect(context.mutations).toEqual([]);
});

test("catalog query and empty results preserve selected identity independently of the current page", async ({ page }) => {
  const context = await setup(page); await open(page);
  await selection(page).getByLabel("분류 이름 검색", { exact: true }).fill("type_001"); await selection(page).getByRole("button", { name: "분류 목록 검색", exact: true }).click();
  await expect(selection(page).getByRole("status")).toHaveText("1개 분류 · 1/1페이지 · 1개 표시"); await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_070");
  await selection(page).getByLabel("분류 이름 검색", { exact: true }).fill("not-found"); await selection(page).getByLabel("분류 이름 검색", { exact: true }).press("Enter");
  await expect(selection(page).getByRole("status")).toHaveText("0개 분류 · 1/1페이지 · 0개 표시"); await expect(selector(page).getByRole("button", { name: /분류 070/ })).toBeVisible();
  expect(context.reads.every((url) => url.searchParams.get("selected") === "type_070")).toBe(true); await expect(page.getByTestId("facet-submitted")).toHaveText("아직 제출 안 함");
});

test("unknown selected key remains explicit and removable without a invented label", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "분류 선택 대상 교체", exact: true }).click();
  await expect(selector(page).getByRole("button", { name: /unknown_type · 현재 이름 확인 불가/ })).toBeVisible(); await open(page);
  await selection(page).getByRole("button", { name: "분류 목록 검색", exact: true }).click(); await expect(selection(page).getByRole("status")).toContainText("75개 분류");
  await expect(selector(page).locator('input[name="type"]')).toHaveValue("unknown_type");
  await selection(page).getByRole("button", { name: "모든 분류 선택", exact: true }).click(); await expect(selector(page).locator('input[name="type"]')).toHaveValue("");
  await expect(page.getByTestId("facet-submitted")).toHaveText("아직 제출 안 함");
});

test("keyboard type selection and Escape return focus without submitting the record form", async ({ page }) => {
  await setup(page); await open(page);
  const item = selection(page).getByRole("button", { name: "분류 000 100개 기록", exact: true });
  await item.focus(); await page.keyboard.press("Enter");
  const trigger = selector(page).getByRole("button", { name: /분류 000/ });
  await expect(selection(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_000");
  await page.keyboard.press("Enter"); await selection(page).getByLabel("분류 이름 검색", { exact: true }).focus();
  await page.keyboard.press("Escape"); await expect(selection(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_000"); await expect(page.getByTestId("facet-submitted")).toHaveText("아직 제출 안 함");
});

test("composing Enter neither loads a facet page nor implicitly submits the outer search form", async ({ page }) => {
  const context = await setup(page); await open(page);
  const input = selection(page).getByLabel("분류 이름 검색", { exact: true }); await input.fill("분류");
  const prevented = await input.evaluate((element) => {
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(prevented).toBe(true); expect(context.reads).toEqual([]); await expect(page.getByTestId("facet-submitted")).toHaveText("아직 제출 안 함");
  await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_070");
});

for (const defect of ["kind", "query", "selected", "short-page"] as const) {
  test(`mismatched ${defect} response preserves selection and allows explicit retry`, async ({ page }) => {
    const context = await setup(page); await open(page);
    context.respond((route, url) => { const body = facetResponse(url); return route.fulfill({ json: { ...body, ...(defect === "kind" ? { kind: "entity" } : defect === "query" ? { query: "wrong" } : defect === "selected" ? { selected: { ...fields[1], label: "DO NOT APPLY" } } : { items: body.items.slice(1) }) } }); });
    await selection(page).getByRole("button", { name: "다음 분류", exact: true }).click(); await expect(selection(page).getByRole("alert")).toContainText("선택은 유지");
    await expect(selector(page)).not.toContainText("DO NOT APPLY"); await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_070");
    context.respond(null); await selection(page).getByRole("button", { name: "다음 분류", exact: true }).click(); await expect(selection(page).getByRole("status")).toContainText("2/4페이지");
  });
}

for (const status of [401, 403, 404, 423]) {
  test(`${status} response closes metadata immediately even without valid JSON`, async ({ page }) => {
    const context = await setup(page); await open(page); context.respond((route) => route.fulfill({ status, body: "not JSON" }));
    await selection(page).getByRole("button", { name: "다음 분류", exact: true }).click(); await expect(selection(page)).toHaveCount(0);
    await expect(selector(page).getByRole("alert")).toContainText("권한을 다시 확인"); await expect(selector(page)).not.toContainText("분류 070");
    await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_070"); expect(context.reads).toHaveLength(1);
  });
}

test("network failure retains selection and a late abandoned request cannot replace a chosen type", async ({ page }) => {
  const context = await setup(page); await open(page); context.respond((route) => route.fulfill({ status: 500, json: { error: { message: "fixture failure" } } }));
  await selection(page).getByRole("button", { name: "다음 분류", exact: true }).click(); await expect(selection(page).getByRole("alert")).toBeVisible();
  let held: Route | undefined, heldUrl: URL | undefined;
  context.respond(async (route, url) => { held = route; heldUrl = url; });
  await selection(page).getByRole("button", { name: "다음 분류", exact: true }).click(); await expect.poll(() => !!held).toBe(true);
  await selection(page).getByRole("button", { name: "분류 000 100개 기록", exact: true }).click();
  await held!.fulfill({ json: facetResponse(heldUrl!) }).catch(() => undefined);
  await expect(selector(page).locator('input[name="type"]')).toHaveValue("type_000"); await expect(selector(page).getByRole("button", { name: /분류 000/ })).toBeVisible();
});

test("explore panels traverse beyond old caps and retain the other panels' URL filters through back", async ({ page }) => {
  await setup(page, "type_page=3&entity_page=4&month_page=2");
  const type = panel(page, "분류로 보기"), entity = panel(page, "대상과 사람으로 보기"), month = panel(page, "시간으로 보기");
  await expect(type).toContainText("3/4페이지"); await expect(entity).toContainText("4/5페이지"); await expect(month).toContainText("2/3페이지");
  await type.getByRole("navigation", { name: "분류로 보기 페이지" }).getByRole("link", { name: "다음", exact: true }).click();
  await expect(type).toContainText("4/4페이지"); await expect(type).toContainText("분류 074");
  let url = new URL(page.url()); expect(url.searchParams.get("entity_page")).toBe("4"); expect(url.searchParams.get("month_page")).toBe("2");
  await entity.getByRole("navigation", { name: "대상과 사람으로 보기 페이지" }).getByRole("link", { name: "다음", exact: true }).click(); await expect(entity).toContainText("대상 081");
  await month.getByRole("navigation", { name: "시간으로 보기 페이지" }).getByRole("link", { name: "다음", exact: true }).click(); await expect(month).toContainText("0000-02");
  const href = await month.getByRole("link", { name: "0000-02 1개 기록", exact: true }).getAttribute("href"); expect(new URL(href!, "http://localhost").searchParams.get("to")).toBe("0000-02-29");
  await page.goBack(); await expect(month).toContainText("2/3페이지"); await expect(entity).toContainText("5/5페이지");
  await type.getByLabel("분류로 보기 검색", { exact: true }).fill("type_070"); await type.getByRole("button", { name: "분류로 보기 찾기", exact: true }).click();
  await expect(type).toContainText("전체 1개"); url = new URL(page.url()); expect(url.searchParams.get("type_page")).toBe("1"); expect(url.searchParams.get("entity_page")).toBe("5"); expect(url.searchParams.get("month_page")).toBe("2");
});

test("mobile More exposes real destinations, retains five primary items and restores focus on Escape/back", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 740 });
  const nav = page.getByRole("navigation", { name: "모바일 탐색", exact: true }), trigger = nav.getByRole("button", { name: "더보기", exact: true });
  await expect(nav.locator(":scope > a,:scope > button")).toHaveCount(5); await expect(nav.getByRole("link", { name: "탐색", exact: true })).toHaveAttribute("aria-current", "page");
  const url = page.url(); await trigger.click(); const dialog = page.getByRole("dialog", { name: "더보기", exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "더보기 닫기", exact: true })).toBeFocused();
  for (const [name, href] of [["확인할 내용", "/v2/review"], ["내 목록", "/v2/library/views"], ["템플릿", "/v2/library/templates"], ["설정", "/settings"]]) await expect(dialog.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  await expect(dialog.getByRole("link", { name: "처리 상태", exact: true })).toHaveAttribute("href", "/v2/processing");
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("link", { name: "설정", exact: true })).toBeFocused(); await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "더보기 닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); expect(page.url()).toBe(url);
  await trigger.click(); await expect(dialog).toBeVisible(); await page.goBack(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); expect(page.url()).toBe(url);
});

test("native Forward reopens the live More sheet without another history entry and restores body lock", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 740 });
  const trigger = page.getByRole("navigation", { name: "모바일 탐색", exact: true }).getByRole("button", { name: "더보기", exact: true });
  const dialog = page.getByRole("dialog", { name: "더보기", exact: true }), url = page.url();
  await trigger.click(); await expect(dialog).toBeVisible(); const depth = await page.evaluate(() => history.length);
  await page.goBack(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.goForward(); await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "더보기 닫기", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden"); expect(await page.evaluate(() => history.length)).toBe(depth); expect(page.url()).toBe(url);
  await dialog.getByRole("button", { name: "더보기 닫기", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => history.state?.lightHouseMore)).toBeUndefined(); expect(await page.evaluate(() => history.length)).toBe(depth); expect(page.url()).toBe(url);
});

test("reload removes orphan More markers without losing other history state or adding entries", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 740 });
  const trigger = page.getByRole("navigation", { name: "모바일 탐색", exact: true }).getByRole("button", { name: "더보기", exact: true });
  const dialog = page.getByRole("dialog", { name: "더보기", exact: true });
  await page.evaluate(() => history.replaceState({ ...history.state, lightHouseFixture: "preserve" }, "", location.href));
  await trigger.click(); await expect(dialog).toBeVisible(); const depth = await page.evaluate(() => history.length), url = page.url();
  await page.reload(); await expect(page.getByRole("heading", { name: "전체 탐색 검증", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.lightHouseMore)).toBeUndefined(); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => history.state?.lightHouseFixture)).toBe("preserve"); expect(await page.evaluate(() => history.length)).toBe(depth);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden"); expect(page.url()).toBe(url);
  // A reload on the base entry also invalidates the former component's Forward entry.
  await trigger.click(); await expect(dialog).toBeVisible(); await page.goBack(); await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(page.getByRole("heading", { name: "전체 탐색 검증", exact: true })).toBeVisible();
  const remountDepth = await page.evaluate(() => history.length); await page.goForward();
  await expect.poll(() => page.evaluate(() => history.state?.lightHouseMore)).toBeUndefined(); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(remountDepth); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden"); expect(page.url()).toBe(url);
});

for (const nextIntent of ["unmount", "native Forward", "new More opening"] as const) {
  test(`delayed More destination is cancelled after ${nextIntent}`, async ({ page }) => {
    await setup(page, "timer_navigation=1"); await page.setViewportSize({ width: 390, height: 740 });
    const nav = page.getByRole("navigation", { name: "모바일 탐색", exact: true }), trigger = nav.getByRole("button", { name: "더보기", exact: true });
    const dialog = page.getByRole("dialog", { name: "더보기", exact: true }), url = page.url();
    await trigger.click(); await expect(dialog).toBeVisible(); await holdMoreDestinationTimer(page);
    await dialog.getByRole("link", { name: "템플릿", exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __heldNavigationTimers: HeldNavigationTimers }).__heldNavigationTimers.snapshot().held)).toBe(1);
    if (nextIntent === "unmount") { await page.getByRole("button", { name: "모바일 탐색 제거", exact: true }).click(); await expect(nav).toHaveCount(0); }
    else if (nextIntent === "native Forward") { await page.goForward(); await expect(dialog).toBeVisible(); }
    else { await trigger.click(); await expect(dialog).toBeVisible(); }
    const released = await page.evaluate(() => (window as typeof window & { __heldNavigationTimers: HeldNavigationTimers }).__heldNavigationTimers.release());
    expect(released).toEqual({ ran: 0, cancelled: 1 }); expect(page.url()).toBe(url);
    await expect(page.getByRole("heading", { name: "전체 탐색 검증", exact: true })).toBeVisible();
    if (nextIntent !== "unmount") await expect(dialog).toBeVisible();
  });
}

test("320px More sheet and selector remain scrollable, nonoverlapping and accessible", async ({ page }, testInfo) => {
  await setup(page); await page.setViewportSize({ width: 320, height: 430 }); await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".v2-type-selector").analyze()).violations).toEqual([]);
  await page.getByRole("navigation", { name: "모바일 탐색", exact: true }).getByRole("button", { name: "더보기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "더보기", exact: true }); await expect(dialog).toBeVisible();
  const bounds = await dialog.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.clientHeight, scroll: element.scrollHeight, body: document.body.style.overflow }));
  expect(bounds.width).toBeLessThanOrEqual(320); expect(bounds.height).toBeLessThanOrEqual(430); expect(bounds.scroll).toBeGreaterThanOrEqual(bounds.height); expect(bounds.body).toBe("hidden");
  const settings = dialog.getByRole("link", { name: "설정", exact: true }); await settings.focus(); await expect(settings).toBeFocused(); await expect(settings).toBeInViewport();
  expect((await new AxeBuilder({ page }).include(".v2-mobile-more").analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("catalog-more-320.png"), fullPage: true }); await dialog.getByRole("button", { name: "더보기 닫기", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});
