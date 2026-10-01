import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import type { V2SavedViewDisplay } from "../../src/lib/v2/retrieval/saved-view-contract";
import { recordLocationTextHash } from "../../src/lib/v2/retrieval/record-location-v1";

const editor = (page: Page) => page.getByRole("region", { name: "목록 표시 설정", exact: true });
const selected = (page: Page) => editor(page).getByRole("list", { name: "선택한 표시 필드", exact: true });
const fields = [{ key: "user_rating", label: "내 평점" }, { key: "new_field", label: "새 분야" }, { key: "other_field", label: "다른 분야" }];
function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function setup(page: Page) {
  const lookups: string[][] = [], searches: URL[] = [], writes: unknown[] = [];
  const lookupRequests: { keys: string[]; request: Request }[] = [], lookupResponses: string[][] = [];
  const searchRequests: Request[] = [], writeRequests: Request[] = [];
  const metadataHandlers: Promise<void>[] = [], writeHandlers: Promise<void>[] = [];
  page.on("response", (response) => {
    const attempt = lookupRequests.find((entry) => entry.request === response.request());
    if (attempt) lookupResponses.push(attempt.keys);
  });
  let lookup: ((route: Route, keys: string[]) => Promise<void>) | null = null;
  let search: ((route: Route, url: URL) => Promise<void>) | null = null;
  let write: ((route: Route) => Promise<void>) | null = null;
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v2/saved-view-fields") {
      if (url.searchParams.has("key")) {
        const keys = url.searchParams.getAll("key"); lookups.push(keys);
        lookupRequests.push({ keys, request: route.request() });
        const reply = lookup ? lookup(route, keys) : route.fulfill({ json: { fields: keys.flatMap((key) => fields.filter((field) => field.key === key)) } });
        metadataHandlers.push(reply); return reply;
      }
      searches.push(url); searchRequests.push(route.request());
      if (search) { const reply = search(route, url); metadataHandlers.push(reply); return reply; }
      const q = url.searchParams.get("q") ?? "", matched = fields.filter((field) => !q || field.key.includes(q));
      return route.fulfill({ json: { fields: matched, page: 1, pageSize: 20, totalPages: 1, totalCount: matched.length } });
    }
    if (["PATCH", "POST"].includes(route.request().method())) {
      const body = route.request().postDataJSON() as { display: V2SavedViewDisplay }; writes.push(body);
      writeRequests.push(route.request());
      if (write) { const reply = write(route); writeHandlers.push(reply); return reply; }
      return route.fulfill({ json: { view: { id: "display-view", display: body.display, displayRevision: recordLocationTextHash(JSON.stringify(body.display)) } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "test_unexpected_read" } } });
  });
  await page.goto("/v2-lab?surface=saved-view-display");
  return { lookups, lookupResponses, searches, searchRequests, writes, writeRequests,
    // React development StrictMode intentionally starts and aborts an initial effect request.
    // Keep raw attempts for evidence; only network-observed responses count as completed reads.
    liveLookups: () => lookupRequests.filter((attempt) => !attempt.request.failure()),
    settleMetadata: () => Promise.all(metadataHandlers), settleWrites: () => Promise.all(writeHandlers),
    onLookup(handler: typeof lookup) { lookup = handler; }, onSearch(handler: typeof search) { search = handler; }, onWrite(handler: typeof write) { write = handler; } };
}
async function open(page: Page) { await page.getByRole("button", { name: "표시 설정", exact: true }).click(); await expect(editor(page)).toBeVisible(); }
async function pendingLookup(context: Awaited<ReturnType<typeof setup>>, keys = ["user_rating", "legacy_custom"]) {
  await expect.poll(() => context.liveLookups().map((attempt) => attempt.keys)).toEqual([keys]);
  return context.liveLookups()[0].request;
}
async function cancelled(request: Request) { await expect.poll(() => request.failure()?.errorText).toBe("net::ERR_ABORTED"); }

test("reopening selected fields restores owner labels without searching and retains unknown keys/order", async ({ page }) => {
  const context = await setup(page); await open(page);
  await expect(selected(page).locator("li > span")).toHaveText(["내 평점", "보관일", "legacy_custom · 기존 필드"]);
  await expect.poll(() => context.lookupResponses).toEqual([["user_rating", "legacy_custom"]]);
  await page.getByRole("button", { name: "표시 설정 접기", exact: true }).click(); await open(page);
  await expect(selected(page).locator("li > span")).toHaveText(["내 평점", "보관일", "legacy_custom · 기존 필드"]);
  expect(context.lookupResponses).toEqual([["user_rating", "legacy_custom"], ["user_rating", "legacy_custom"]]);
  for (const keys of context.lookups) expect(keys).toEqual(["user_rating", "legacy_custom"]);
  expect(context.searches).toEqual([]); expect(context.writes).toEqual([]);
});

test("changing catalog query does not erase selected labels or order and removal remains available", async ({ page }) => {
  const context = await setup(page); await open(page);
  await expect(selected(page)).toContainText("내 평점");
  await editor(page).getByLabel("추가 필드 검색", { exact: true }).fill("new_field");
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  await editor(page).getByRole("checkbox", { name: "새 분야", exact: true }).check();
  await editor(page).getByLabel("추가 필드 검색", { exact: true }).fill("other_field");
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  await expect(editor(page).getByRole("checkbox", { name: "다른 분야", exact: true })).toBeVisible();
  await expect(selected(page).locator("li > span")).toHaveText(["내 평점", "보관일", "legacy_custom · 기존 필드", "새 분야"]);
  await selected(page).getByRole("button", { name: "새 분야 위로 이동", exact: true }).click();
  await expect(selected(page).locator("li > span")).toHaveText(["내 평점", "보관일", "새 분야", "legacy_custom · 기존 필드"]);
  await selected(page).getByRole("button", { name: "legacy_custom 표시에서 제거", exact: true }).click();
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "표시 설정을 저장했습니다." })).toBeVisible();
  expect(context.writes).toHaveLength(1); expect(context.writes[0]).toMatchObject({ display: { visibleFields: ["user_rating", "@record.captured_at", "new_field"] } });
});

test("a mismatched exact response keeps key fallback and explicit retry recovers the name without writes", async ({ page }) => {
  const context = await setup(page);
  context.onLookup(async (route) => route.fulfill({ json: { fields: [{ key: "foreign_field", label: "DO NOT SHOW" }] } }));
  await open(page);
  await expect(editor(page).getByRole("alert")).toContainText("키와 순서는 유지됩니다");
  await expect(selected(page)).not.toContainText("DO NOT SHOW");
  await expect(selected(page).locator("li > span")).toHaveText(["user_rating · 기존 필드", "보관일", "legacy_custom · 기존 필드"]);
  context.onLookup(null); await editor(page).getByRole("button", { name: "선택한 필드 이름 다시 불러오기", exact: true }).click();
  await expect(selected(page)).toContainText("내 평점"); await expect(editor(page).getByRole("alert")).toHaveCount(0);
  expect(context.lookupResponses).toEqual([["user_rating", "legacy_custom"], ["user_rating", "legacy_custom"]]); expect(context.writes).toEqual([]);
});

test("an unmounted lookup cannot replace the new editor metadata", async ({ page }) => {
  const context = await setup(page), hold = latch();
  context.onLookup(async (route) => { await hold.promise; await route.fulfill({ json: { fields: [{ key: "user_rating", label: "OLD LABEL" }] } }).catch(() => {}); });
  await open(page); const previous = await pendingLookup(context);
  await page.getByRole("button", { name: "표시 설정 접기", exact: true }).click(); await cancelled(previous); context.onLookup(null); await open(page);
  await expect(selected(page)).toContainText("내 평점"); hold.release(); await context.settleMetadata();
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  await expect(editor(page).getByRole("status")).toHaveText("필드 3개 중 3개 표시");
  await expect(selected(page)).not.toContainText("OLD LABEL"); expect(context.writes).toEqual([]);
});

test("removed selections are not resurrected by a late lookup", async ({ page }) => {
  const context = await setup(page), hold = latch();
  context.onLookup(async (route) => { await hold.promise; await route.fulfill({ json: { fields: [{ key: "user_rating", label: "LATE LABEL" }] } }).catch(() => {}); });
  await open(page); const previous = await pendingLookup(context);
  context.onLookup(null); await selected(page).getByRole("button", { name: "user_rating 표시에서 제거", exact: true }).click();
  await cancelled(previous); await expect.poll(() => context.lookupResponses).toEqual([["legacy_custom"]]);
  hold.release(); await context.settleMetadata();
  await expect(selected(page).locator("li > span")).toHaveText(["보관일", "legacy_custom · 기존 필드"]);
  expect(context.liveLookups().map((attempt) => attempt.keys)).toEqual([["legacy_custom"]]); expect(context.writes).toEqual([]);
});

for (const source of ["lookup", "search"] as const) {
  test(`${source} authorization denial closes parent and invalidates the other pending metadata response`, async ({ page }) => {
    const context = await setup(page), hold = latch(), denial = latch();
    if (source === "lookup") {
      context.onLookup(async (route) => { await denial.promise; await route.fulfill({ status: 403, body: "not JSON" }); });
      context.onSearch(async (route) => { await hold.promise; await route.fulfill({ json: { fields, page: 1, pageSize: 20, totalCount: 3, totalPages: 1 } }).catch(() => {}); });
    } else {
      context.onLookup(async (route) => { await hold.promise; await route.fulfill({ json: { fields: [{ key: "user_rating", label: "LATE OWNER LABEL" }] } }).catch(() => {}); });
      context.onSearch(async (route) => route.fulfill({ status: 423, body: "not JSON" }));
    }
    await open(page); const pending = await pendingLookup(context);
    await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
    await expect.poll(() => context.searches.length).toBe(1); if (source === "lookup") denial.release();
    await expect(editor(page)).toHaveCount(0); await cancelled(source === "lookup" ? context.searchRequests[0] : pending);
    hold.release(); await context.settleMetadata();
    await expect(page.locator(".v2-saved-view-management").getByRole("alert")).toContainText("권한을 다시 확인");
    await expect(page.getByRole("button", { name: "표시 설정 접기", exact: true })).toBeDisabled();
    expect(context.writes).toEqual([]);
  });
}

test("lookup denial fences an already pending display write response", async ({ page }) => {
  const context = await setup(page), deny = latch(), save = latch();
  context.onLookup(async (route) => { await deny.promise; await route.fulfill({ status: 401, body: "expired" }); });
  context.onWrite(async (route) => {
    const body = route.request().postDataJSON() as { display: V2SavedViewDisplay }; await save.promise;
    await route.fulfill({ json: { view: { id: "display-view", display: body.display, displayRevision: recordLocationTextHash(JSON.stringify(body.display)) } } }).catch(() => {});
  });
  await open(page); await pendingLookup(context);
  await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("cards");
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click(); await expect.poll(() => context.writes.length).toBe(1);
  deny.release(); await expect(editor(page)).toHaveCount(0); await cancelled(context.writeRequests[0]); save.release(); await context.settleWrites();
  await expect(page.getByTestId("saved-display-layout")).toContainText("list · comfortable");
  await expect(page.locator(".v2-saved-view-management").getByRole("status")).toHaveCount(0);
});

test("create modal reopens with selected field label and keeps entered name", async ({ page }) => {
  const context = await setup(page), trigger = page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true });
  await trigger.click(); const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
  await dialog.getByLabel("목록 이름", { exact: true }).fill("내 자료");
  await dialog.getByRole("button", { name: "필드 검색", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "새 분야", exact: true }).check();
  await expect(dialog.getByRole("list", { name: "선택한 표시 필드" })).toContainText("새 분야");
  await page.keyboard.press("Escape"); await trigger.click();
  await expect(dialog.getByLabel("목록 이름", { exact: true })).toHaveValue("내 자료");
  await expect(dialog.getByRole("list", { name: "선택한 표시 필드" })).toContainText("새 분야");
  expect(context.lookupResponses.at(-1)).toEqual(["new_field"]); expect(context.writes).toEqual([]);
});

test("create lookup denial fences pending creation and cannot navigate on its late success", async ({ page }) => {
  const context = await setup(page), deny = latch(), save = latch();
  context.onLookup(async (route) => { await deny.promise; await route.fulfill({ status: 403, body: "denied" }); });
  context.onWrite(async (route) => {
    const body = route.request().postDataJSON() as { display: V2SavedViewDisplay };
    await save.promise;
    await route.fulfill({ status: 201, json: { view: { ...body, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", displayRevision: recordLocationTextHash(JSON.stringify(body.display)) } } }).catch(() => {});
  });
  const trigger = page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true });
  await trigger.click(); const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
  await dialog.getByLabel("목록 이름", { exact: true }).fill("보존할 입력");
  await dialog.getByRole("button", { name: "필드 검색", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "새 분야", exact: true }).check();
  await pendingLookup(context, ["new_field"]);
  await dialog.getByRole("button", { name: "저장", exact: true }).click(); await expect.poll(() => context.writes.length).toBe(1);
  deny.release(); await expect(dialog).toHaveCount(0); await cancelled(context.writeRequests[0]); save.release(); await context.settleWrites();
  await expect(trigger).toBeDisabled(); await expect(page.getByRole("main").getByRole("alert")).toContainText("권한을 다시 확인");
  await expect(page).toHaveURL(/\/v2-lab\?surface=saved-view-display$/);
});

for (const mode of [{ method: "PATCH", status: 401 }, { method: "GET", status: 423 }] as const) {
  test(`response contract ${mode.method} ${mode.status} closes before an unfinished error body is read`, async ({ page }) => {
    await page.addInitScript(({ method, status }) => {
      const original = window.fetch.bind(window);
      const state = { headerResponses: 0, jsonReads: 0 };
      Object.assign(window, { savedViewHeaderFixture: state });
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
        const requestMethod = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (url.pathname === "/api/v2/saved-views/display-view" && requestMethod === method) {
          state.headerResponses += 1;
          // Actual Response/ReadableStream: headers exist, but the JSON body never completes.
          const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); } }), { status, headers: { "Content-Type": "application/json" } });
          const read = response.json.bind(response);
          response.json = () => { state.jsonReads += 1; return read(); };
          return Promise.resolve(response);
        }
        return original(input, init);
      };
    }, mode);
    const context = await setup(page); await open(page); await expect(selected(page)).toContainText("내 평점");
    await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("cards");
    if (mode.method === "GET") context.onWrite(async (route) => route.fulfill({ status: 409, json: { error: { code: "saved_view_display_conflict" } } }));
    await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
    if (mode.method === "GET") {
      await expect(page.locator(".v2-saved-view-management").getByRole("alert")).toContainText("입력은 유지됩니다");
      await editor(page).getByRole("button", { name: "최신 설정 다시 불러오기", exact: true }).click();
    }
    await expect(editor(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { savedViewHeaderFixture: { headerResponses: number; jsonReads: number } }).savedViewHeaderFixture)).toEqual({ headerResponses: 1, jsonReads: 0 });
    await expect(page.locator(".v2-saved-view-management").getByRole("alert")).toContainText("권한을 다시 확인");
    await expect(page.getByRole("button", { name: "표시 설정 접기", exact: true })).toBeDisabled();
    await expect(page.getByTestId("saved-display-layout")).toContainText("list · comfortable");
    expect(context.writes).toHaveLength(mode.method === "GET" ? 1 : 0);
  });
}

for (const mismatch of ["name", "description", "iconKey", "queryPlan", "display", "displayRevision", "missing definition", "invalid id"] as const) {
  test(`response contract creation rejects ${mismatch} success without moving or losing input`, async ({ page }) => {
    const context = await setup(page);
    context.onWrite(async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown> & { display: V2SavedViewDisplay; queryPlan: Record<string, unknown> };
      const view: Record<string, unknown> = { ...body, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", displayRevision: recordLocationTextHash(JSON.stringify(body.display)) };
      if (mismatch === "name") view.name = "다른 목록";
      if (mismatch === "description") view.description = "OTHER PRIVATE DESCRIPTION";
      if (mismatch === "iconKey") view.iconKey = "type.book";
      if (mismatch === "queryPlan") view.queryPlan = { ...body.queryPlan, fullText: "OTHER QUERY" };
      if (mismatch === "display") view.display = { ...body.display, density: "compact" };
      if (mismatch === "displayRevision") view.displayRevision = "0".repeat(64);
      if (mismatch === "missing definition") for (const key of ["name", "description", "iconKey", "queryPlan", "display", "displayRevision"]) delete view[key];
      if (mismatch === "invalid id") view.id = "not-a-server-ulid";
      await route.fulfill({ status: 201, json: { view } });
    });
    await page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
    await dialog.getByLabel("목록 이름", { exact: true }).fill("  보존할 이름  ");
    await dialog.getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("cards");
    await dialog.getByRole("checkbox", { name: "작성일", exact: true }).check();
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("입력은 유지됩니다");
    await expect(dialog.getByLabel("목록 이름", { exact: true })).toHaveValue("  보존할 이름  ");
    await expect(dialog.getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("cards");
    await expect(dialog.getByRole("checkbox", { name: "작성일", exact: true })).toBeChecked();
    await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/v2-lab\?surface=saved-view-display$/);
    expect(context.writes).toHaveLength(1);
  });
}

test("response contract creation accepts matching content and follows the newly issued server ID", async ({ page }) => {
  const context = await setup(page), id = "01ARZ3NDEKTSV4RRFFQ69G5FAV", destinations: string[] = [];
  // Navigation target fixture only; this does not claim actual saved-view SSR or authenticated D1 retrieval.
  await page.route(`**/v2/library/views/${id}**`, async (route) => {
    destinations.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>생성한 목록</title></head><body><main><h1>생성 응답 확인</h1></main></body></html>' });
  });
  context.onWrite(async (route) => {
    const body = route.request().postDataJSON() as { display: V2SavedViewDisplay };
    await route.fulfill({ status: 201, json: { view: { ...body, id, displayRevision: recordLocationTextHash(JSON.stringify(body.display)),
      viewKey: `view_${id.toLowerCase()}`, source: "user_created", pinned: false, pinOrder: null, createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z" } } });
  });
  await page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
  await dialog.getByLabel("목록 이름", { exact: true }).fill("  확인한 목록  ");
  await dialog.getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("table");
  await dialog.getByRole("checkbox", { name: "작성일", exact: true }).check();
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/v2/library/views/${id}$`));
  await expect(page.getByRole("heading", { name: "생성 응답 확인", exact: true })).toBeVisible();
  expect(destinations.length).toBeGreaterThan(0); expect(new Set(destinations)).toEqual(new Set([`/v2/library/views/${id}`]));
  expect(context.writes).toHaveLength(1);
  expect(context.writes[0]).toMatchObject({ name: "확인한 목록", description: null, iconKey: "type.collection", display: { layout: "table", visibleFields: ["@record.written_at"] } });
});
