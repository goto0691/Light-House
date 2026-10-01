import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { recordLocationTextHash } from "../../src/lib/v2/retrieval/record-location-v1";
import type { V2RetrievalQueryPlanV1 } from "../../src/lib/v2/retrieval/query-plan-v1";
import type { V2SavedViewDisplay } from "../../src/lib/v2/retrieval/saved-view-contract";

type Fixture = { initial: V2SavedViewDisplay; revision: string; plan: V2RetrievalQueryPlanV1; recordIds: string[] };
type DisplayPatch = { action: "display"; display: V2SavedViewDisplay; expectedRevision: string };
type Create = { name: string; description: null; iconKey: string; queryPlan: V2RetrievalQueryPlanV1; display: V2SavedViewDisplay };
const results = (page: Page) => page.getByRole("region", { name: "검색 결과", exact: true });
const editor = (page: Page) => page.getByRole("region", { name: "목록 표시 설정", exact: true });
const management = (page: Page) => page.locator(".v2-saved-view-management");
const record = (page: Page, suffix: string) => results(page).locator(`[data-record-id="display-record-${suffix}"]`);
const layouts = { list: "목록 보기", cards: "카드 보기", timeline: "타임라인 보기", table: "표 보기" } as const;
const revisionOf = (display: V2SavedViewDisplay) => recordLocationTextHash(JSON.stringify(display));

/** Actual React components with bounded HTTP fixtures, not D1/provider evidence. */
async function harness(page: Page) {
  let fixture: Fixture, stored: V2SavedViewDisplay, revision: string;
  const writes: DisplayPatch[] = [], creates: Create[] = [], reads: string[] = [], catalogReads: URL[] = [], matchReads: URL[] = [], unexpected: string[] = [];
  let onPatch: ((route: Route, body: DisplayPatch) => Promise<void>) | null = null;
  let onGet: ((route: Route) => Promise<void>) | null = null;
  let onCreate: ((route: Route, body: Create) => Promise<void>) | null = null;
  let onMatches: ((route: Route) => Promise<void>) | null = null;
  const catalog = [{ key: "user_rating", label: "내 평점" }, { key: "metadata_json", label: "부가 데이터" }, { key: "captured_at", label: "사용자 보관 메모" },
    ...Array.from({ length: 22 }, (_, index) => ({ key: `field_${String(index).padStart(2, "0")}`, label: `추가 필드 ${String(index).padStart(2, "0")}` }))];
  const view = () => ({ id: "display-view", pinned: false, display: stored, displayRevision: revision });
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.pathname === "/api/v2/saved-views/display-view" && method === "GET") {
      reads.push(url.pathname); return onGet ? onGet(route) : route.fulfill({ json: { view: view() } });
    }
    if (url.pathname === "/api/v2/saved-views/display-view" && method === "PATCH") {
      const body = request.postDataJSON() as DisplayPatch;
      if (body.action !== "display") { unexpected.push(`${method} ${url.pathname}`); return route.fulfill({ status: 500, json: { error: { code: "unexpected_pin" } } }); }
      writes.push(body);
      if (onPatch) return onPatch(route, body);
      if (body.expectedRevision !== revision) return route.fulfill({ status: 409, json: { error: { code: "saved_view_display_conflict" } } });
      stored = body.display; revision = revisionOf(stored);
      return route.fulfill({ json: { view: view() } });
    }
    if (url.pathname === "/api/v2/saved-views" && method === "POST") {
      const body = request.postDataJSON() as Create; creates.push(body);
      return onCreate ? onCreate(route, body) : route.fulfill({ status: 503, json: { error: { code: "fixture_create_failure", message: "합성 저장 실패 · 입력 유지" } } });
    }
    if (url.pathname === "/api/v2/saved-view-fields" && method === "GET") {
      if (url.searchParams.has("key")) return route.fulfill({ json: { fields: url.searchParams.getAll("key").flatMap((key) => catalog.filter((field) => field.key === key)) } });
      catalogReads.push(url); const q = url.searchParams.get("q") ?? "", requestedPage = Number(url.searchParams.get("page"));
      const filtered = catalog.filter((field) => !q || field.key.includes(q) || field.label.includes(q));
      return route.fulfill({ json: { fields: filtered.slice((requestedPage - 1) * 20, requestedPage * 20), page: requestedPage, pageSize: 20, totalPages: Math.max(1, Math.ceil(filtered.length / 20)), totalCount: filtered.length } });
    }
    if (url.pathname === "/api/v2/records/display-record-c/search-matches" && method === "GET") {
      matchReads.push(url);
      return onMatches ? onMatches(route) : route.fulfill({ json: { contract: "retrieval-matches.v1", recordId: "display-record-c", privacyLevel: "normal", plan: fixture.plan, matches: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 1 } });
    }
    unexpected.push(`${method} ${url.pathname}`); return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_request" } } });
  });
  await page.goto("/v2-lab?surface=saved-view-display");
  fixture = JSON.parse((await page.getByTestId("saved-view-display-fixture-data").textContent())!) as Fixture;
  stored = fixture.initial; revision = fixture.revision;
  return { fixture, writes, creates, reads, catalogReads, matchReads, unexpected,
    get stored() { return stored; }, get revision() { return revision; },
    advance(display: V2SavedViewDisplay) { stored = display; revision = revisionOf(display); },
    onPatch(handler: typeof onPatch) { onPatch = handler; }, onGet(handler: typeof onGet) { onGet = handler; }, onCreate(handler: typeof onCreate) { onCreate = handler; }, onMatches(handler: typeof onMatches) { onMatches = handler; },
  };
}

async function openEditor(page: Page) { await page.getByRole("button", { name: "표시 설정", exact: true }).click(); await expect(editor(page)).toBeVisible(); }
async function clearFields(scope: Locator) {
  const remove = scope.getByRole("button", { name: / 표시에서 제거$/ });
  while (await remove.count()) await remove.first().click();
}
async function shownRecordIds(page: Page) { return results(page).locator("[data-record-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-record-id"))); }

for (const layout of Object.keys(layouts) as (keyof typeof layouts)[]) {
  test(`${layout} preserves the query page order, inclusion reasons and exact source links without writes`, async ({ page }, testInfo) => {
    const context = await harness(page);
    await page.getByRole("button", { name: layouts[layout], exact: true }).click();
    await expect(results(page)).toHaveClass(new RegExp(`v2-saved-results--${layout}`));
    expect(await shownRecordIds(page)).toEqual(context.fixture.recordIds);
    await expect(results(page).getByRole("list", { name: "포함 이유", exact: true })).toHaveCount(4);
    const href = await record(page, "c").getByRole("link", { name: /보관 원문/ }).getAttribute("href");
    const url = new URL(href!, "http://localhost:3100");
    expect(url.pathname).toBe("/v2/records/display-record-c");
    expect(JSON.parse(url.searchParams.get("loc")!)).toMatchObject({ kind: "source", sourceItemId: "display-source", snapshotId: null, range: { start: 0, end: 7 } });
    await expect(record(page, "c")).toContainText("4.5");
    await expect(record(page, "c")).toContainText("사용자 잠금");
    await expect(record(page, "a")).toContainText("값 충돌 · 하나로 정하지 않음");
    await expect(record(page, "b")).toContainText("값 없음");
    await expect(record(page, "b")).toContainText("보관 위치에서 정확한 자료를 확인하세요.");
    await expect(record(page, "b")).not.toContainText("민감·보호 기록");
    await expect(record(page, "sensitive")).toContainText("민감·보호 필드 숨김");
    await expect(record(page, "sensitive")).not.toContainText("4.5");
    await page.screenshot({ path: testInfo.outputPath(`saved-view-${layout}.png`), fullPage: true });
    expect(context.writes).toEqual([]); expect(context.creates).toEqual([]); expect(context.reads).toEqual([]); expect(context.unexpected).toEqual([]);
  });
}

test("explicit display save applies field order, distinct metadata/user keys and literal JSON text", async ({ page }) => {
  const context = await harness(page); await openEditor(page);
  await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("table");
  await editor(page).getByRole("combobox", { name: "화면 밀도", exact: true }).selectOption("compact");
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  await editor(page).getByRole("checkbox", { name: "사용자 보관 메모", exact: true }).check();
  await editor(page).getByRole("checkbox", { name: "부가 데이터", exact: true }).check();
  await editor(page).getByRole("button", { name: "부가 데이터 위로 이동", exact: true }).click();
  expect(context.writes).toEqual([]); await expect(page.getByTestId("saved-display-layout")).toContainText("list · comfortable");
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
  await expect(page.getByTestId("saved-display-layout")).toContainText("table · compact");
  expect(context.writes).toHaveLength(1);
  expect(context.writes[0]).toEqual({ action: "display", expectedRevision: context.fixture.revision, display: { layout: "table", density: "compact", groupBy: null, visibleFields: ["user_rating", "@record.captured_at", "legacy_custom", "metadata_json", "captured_at"] } });
  await expect(results(page).getByRole("columnheader")).toHaveText(["기록", "내 평점", "보관일", "legacy_custom", "부가 데이터", "사용자 보관 메모", "검색 문맥과 정확한 보관 위치"]);
  await expect(record(page, "c")).toContainText("2026-09-01");
  await expect(record(page, "c")).toContainText("직접 적은 사용자 필드");
  await expect(record(page, "c")).toContainText('{"literal":"<script>not executable</script>"}');
  await expect(results(page).locator("script")).toHaveCount(0);
  expect(await shownRecordIds(page)).toEqual(context.fixture.recordIds);
  expect(context.reads).toEqual([]); expect(context.unexpected).toEqual([]);
});

test("contiguous groups retain query order and timeline uses the selected stored date without fallback", async ({ page }) => {
  const context = await harness(page);
  await page.getByRole("button", { name: "타임라인 보기", exact: true }).click();
  await page.getByRole("combobox", { name: "검증용 묶음", exact: true }).selectOption("type");
  await expect(results(page).locator(".v2-view-group-heading")).toHaveText(["게임", "책", "게임", "민감·보호 기록"]);
  await expect(results(page)).toContainText("현재 페이지의 연속 구간만 묶습니다");
  expect(await shownRecordIds(page)).toEqual(context.fixture.recordIds);
  await page.getByRole("combobox", { name: "검증용 묶음", exact: true }).selectOption("written_month");
  await expect(record(page, "a").locator(".v2-search-result__copy > p")).toHaveText("작성일 · 미상");
  await expect(record(page, "c").locator(".v2-search-result__copy > p")).toHaveText("작성일 · 2026-08-01");
  await page.getByRole("combobox", { name: "검증용 묶음", exact: true }).selectOption("captured_month");
  await expect(record(page, "a").locator(".v2-search-result__copy > p")).toHaveText("보관일(저장 날짜) · 2026-09-01");
  await expect(record(page, "b").locator(".v2-search-result__copy > p")).toHaveText("보관일(저장 날짜) · 2026-10-01");
  await expect(results(page).locator(".v2-view-group-heading")).toHaveText(["2026년 09월", "2026년 10월", "민감·보호 기록"]);
  await page.getByRole("button", { name: "표 보기", exact: true }).click();
  expect(await shownRecordIds(page)).toEqual(context.fixture.recordIds);
  await expect(results(page).locator(".v2-view-table-group th")).toHaveText(["2026년 09월", "2026년 10월", "민감·보호 기록"]);
  expect(context.writes).toEqual([]);
});

test("CAS conflict preserves the draft through failed/latest reads and requires explicit reapplication", async ({ page }) => {
  const context = await harness(page); await openEditor(page);
  await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("cards");
  await editor(page).getByRole("combobox", { name: "묶어 보기", exact: true }).selectOption("type");
  const remote = { ...context.fixture.initial, layout: "timeline" as const, density: "compact" as const };
  context.advance(remote);
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
  await expect(management(page).getByRole("alert")).toContainText("다른 곳에서 표시 설정이 바뀌었습니다");
  await expect(editor(page).getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("cards");
  await expect(editor(page).getByRole("button", { name: "내 표시 설정 다시 적용", exact: true })).toBeDisabled();
  context.onGet(async (route) => route.fulfill({ status: 503, json: { error: { code: "fixture_unavailable" } } }));
  await editor(page).getByRole("button", { name: "최신 설정 다시 불러오기", exact: true }).click();
  await expect(management(page).getByRole("alert")).toContainText("최신 설정을 불러오지 못했습니다");
  await expect(editor(page).getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("cards");
  expect(context.writes).toHaveLength(1); expect(context.reads).toHaveLength(1);
  context.onGet(null);
  await editor(page).getByRole("button", { name: "최신 설정 다시 불러오기", exact: true }).click();
  await expect(editor(page).getByRole("button", { name: "내 표시 설정 다시 적용", exact: true })).toBeEnabled();
  await expect(editor(page).getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("cards");
  await expect(editor(page).getByRole("combobox", { name: "묶어 보기", exact: true })).toHaveValue("type");
  expect(context.writes).toHaveLength(1); expect(context.reads).toHaveLength(2);
  await editor(page).getByRole("button", { name: "내 표시 설정 다시 적용", exact: true }).click();
  await expect(page.getByTestId("saved-display-layout")).toContainText("cards · comfortable");
  expect(context.writes).toHaveLength(2); expect(context.writes[1].expectedRevision).toBe(revisionOf(remote));
  expect(context.writes[1].display).toEqual({ ...context.fixture.initial, layout: "cards", groupBy: "type" });
  expect(context.creates).toEqual([]); expect(context.unexpected).toEqual([]);
});

for (const defect of ["wrong view", "changed display"] as const) {
  test(`a successful ${defect} reply cannot replace the selected display`, async ({ page }) => {
    const context = await harness(page); await openEditor(page);
    await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("table");
    context.onPatch(async (route, body) => route.fulfill({ json: { view: { id: defect === "wrong view" ? "other-view" : "display-view", display: defect === "changed display" ? context.fixture.initial : body.display, displayRevision: context.fixture.revision } } }));
    await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
    await expect(management(page).getByRole("alert")).toContainText("입력은 유지됩니다");
    await expect(editor(page).getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("table");
    await expect(page.getByTestId("saved-display-layout")).toContainText("list · comfortable");
    expect(context.writes).toHaveLength(1); expect(context.reads).toEqual([]);
  });
}

test("display mutation permission loss closes the editor without applying its draft or automatic retries", async ({ page }) => {
  const context = await harness(page); await openEditor(page);
  await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("cards");
  context.onPatch(async (route) => route.fulfill({ status: 403, json: { error: { code: "saved_view_forbidden" } } }));
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(management(page).getByRole("alert")).toContainText("수정할 권한을 다시 확인");
  await expect(page.getByRole("button", { name: "표시 설정 접기", exact: true })).toBeDisabled();
  await expect(page.getByTestId("saved-display-layout")).toContainText("list · comfortable");
  expect(context.writes).toHaveLength(1); expect(context.reads).toEqual([]); expect(context.creates).toEqual([]);
});

test("field catalog pages beyond 20 preserve unknown selections and enforce the eight-field limit", async ({ page }) => {
  const context = await harness(page); await openEditor(page);
  const selected = editor(page).getByRole("list", { name: "선택한 표시 필드", exact: true });
  await expect(selected).toContainText("legacy_custom · 기존 필드");
  await expect(editor(page).getByLabel("추가 필드 검색", { exact: true })).toHaveAttribute("maxlength", "100");
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  await expect(editor(page).getByRole("status")).toHaveText("필드 25개 중 20개 표시");
  await editor(page).getByRole("button", { name: "표시 필드 더 보기", exact: true }).click();
  await expect(editor(page).getByRole("status")).toHaveText("필드 25개 중 25개 표시");
  await editor(page).getByRole("checkbox", { name: "추가 필드 21", exact: true }).check();
  for (const label of ["작성일", "수정일", "분류", "사용자 보관 메모"]) await editor(page).getByRole("checkbox", { name: label, exact: true }).check();
  await expect(selected.locator("li")).toHaveCount(8);
  await expect(editor(page).getByRole("checkbox", { name: "부가 데이터", exact: true })).toBeDisabled();
  await expect(editor(page).getByRole("checkbox", { name: "추가 필드 21", exact: true })).toBeEnabled();
  await editor(page).getByRole("button", { name: "legacy_custom 표시에서 제거", exact: true }).click();
  await expect(editor(page).getByRole("checkbox", { name: "부가 데이터", exact: true })).toBeEnabled();
  await editor(page).getByLabel("추가 필드 검색", { exact: true }).fill("metadata_json");
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  await expect(editor(page).getByRole("status")).toHaveText("필드 1개 중 1개 표시");
  await expect(selected).toContainText("추가 필드 21");
  expect(context.catalogReads.map((url) => [url.searchParams.get("q"), url.searchParams.get("page")])).toEqual([["", "1"], ["", "2"], ["metadata_json", "1"]]);
  expect(context.writes).toEqual([]); expect(context.creates).toEqual([]);
});

test("create dialog is modal, traps keyboard focus and returns it on Escape without auto-save", async ({ page }) => {
  const context = await harness(page);
  const trigger = page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true });
  await trigger.click(); const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
  await expect(dialog.getByLabel("목록 이름", { exact: true })).toBeFocused();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await dialog.getByLabel("목록 이름", { exact: true }).fill("내 리뷰 모음");
  await dialog.getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("cards");
  await dialog.getByRole("button", { name: "저장", exact: true }).focus();
  await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "내 목록 저장 닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(dialog.getByLabel("목록 이름", { exact: true })).toHaveValue("내 리뷰 모음");
  await expect(dialog.getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("cards");
  expect(context.creates).toEqual([]); expect(context.writes).toEqual([]); expect(context.catalogReads).toEqual([]);
});

test("create sends the selected display once and retains fields/name after a failed held save", async ({ page }) => {
  const context = await harness(page); let release: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  context.onCreate(async (route) => { await hold; await route.fulfill({ status: 503, json: { error: { message: "합성 저장 실패 · 입력 유지" } } }); });
  await page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
  await dialog.getByLabel("목록 이름", { exact: true }).fill("  다시 볼 자료  ");
  await dialog.getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("table");
  await dialog.getByRole("combobox", { name: "화면 밀도", exact: true }).selectOption("compact");
  await dialog.getByRole("combobox", { name: "묶어 보기", exact: true }).selectOption("written_month");
  await dialog.getByRole("checkbox", { name: "작성일", exact: true }).check();
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(() => context.creates.length).toBe(1);
  await expect(dialog.getByRole("button", { name: "내 목록 저장 닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "내 목록 저장 닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  expect(context.creates[0]).toEqual({ name: "다시 볼 자료", description: null, iconKey: "type.collection", queryPlan: context.fixture.plan,
    display: { layout: "table", density: "compact", groupBy: "written_month", visibleFields: ["@record.written_at"] } });
  release!();
  await expect(dialog.getByRole("alert")).toHaveText("합성 저장 실패 · 입력 유지");
  await expect(dialog.getByLabel("목록 이름", { exact: true })).toHaveValue("  다시 볼 자료  ");
  await expect(dialog.getByRole("combobox", { name: "레이아웃", exact: true })).toHaveValue("table");
  await expect(dialog.getByRole("checkbox", { name: "작성일", exact: true })).toBeChecked();
  expect(context.creates).toHaveLength(1); expect(context.writes).toEqual([]);
});

for (const policy of ["sensitive", "restricted", "missing privacy", "owner removed"] as const) {
  test(`table paging ${policy} removes title, field values, snippets and evidence across layout changes`, async ({ page }) => {
    const context = await harness(page);
    await page.getByRole("button", { name: "표 보기", exact: true }).click();
    context.onMatches(async (route) => route.fulfill(policy === "owner removed" ? { status: 404, json: { error: { code: "record_not_found" } } }
      : policy === "restricted" ? { status: 423, json: { error: { code: "restricted_record_locked" } } }
        : { json: { contract: "retrieval-matches.v1", recordId: "display-record-c", ...(policy === "sensitive" ? { privacyLevel: "sensitive" } : {}), plan: context.fixture.plan, matches: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 1 } }));
    await record(page, "c").getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
    await expect(results(page).getByRole("alert")).toContainText("권한을 다시 확인");
    for (const layout of ["table", "cards", "timeline", "list"] as const) {
      await page.getByRole("button", { name: layouts[layout], exact: true }).click();
      await expect(results(page).getByRole("link", { name: "기록 c", exact: true })).toHaveCount(0);
      await expect(results(page)).not.toContainText("보관 문맥 c");
      await expect(results(page)).not.toContainText("정확한 archive 근거");
      await expect(results(page)).not.toContainText("4.5");
      await expect(results(page).getByRole("link", { name: /보관 원문/ })).toHaveCount(0);
      await expect(results(page).getByRole("alert")).toContainText("권한을 다시 확인");
    }
    expect(context.matchReads).toHaveLength(1); expect(context.writes).toEqual([]); expect(context.creates).toEqual([]);
  });
}

test("320px eight-field layouts and controls stay inside the page; only the accessible table scrolls horizontally", async ({ page }, testInfo) => {
  const context = await harness(page); await page.setViewportSize({ width: 320, height: 900 });
  await openEditor(page); await clearFields(editor(page));
  await editor(page).getByRole("button", { name: "필드 검색", exact: true }).click();
  for (const label of ["보관일", "작성일", "수정일", "분류", "내 평점", "부가 데이터", "사용자 보관 메모", "추가 필드 00"]) await editor(page).getByRole("checkbox", { name: label, exact: true }).check();
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "표시 설정을 저장했습니다." })).toBeVisible();
  await page.getByRole("button", { name: "표시 설정 접기", exact: true }).click();
  for (const layout of Object.keys(layouts) as (keyof typeof layouts)[]) {
    await page.getByRole("button", { name: layouts[layout], exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  const scroller = page.getByRole("region", { name: "목록 표 가로 스크롤", exact: true });
  await expect(scroller).toBeVisible();
  await expect(scroller.getByRole("columnheader")).toHaveCount(10);
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("saved-view-320-table-eight-fields.png"), fullPage: true });
  await scroller.focus(); await expect(scroller).toBeFocused(); await page.keyboard.press("ArrowRight");
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const tableAxe = await new AxeBuilder({ page }).include('section[aria-label="검색 결과"]').analyze();
  expect(tableAxe.violations).toEqual([]);
  await openEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("saved-view-320-controls.png"), fullPage: true });
  const controlsAxe = await new AxeBuilder({ page }).include('section[aria-label="목록 표시 설정"]').analyze();
  expect(controlsAxe.violations).toEqual([]);
  await page.getByRole("button", { name: "현재 조건을 내 목록으로 저장", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "내 목록으로 저장", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("saved-view-320-create-dialog.png"), fullPage: true });
  const dialogAxe = await new AxeBuilder({ page }).include('dialog[aria-labelledby="save-view-heading"]').analyze();
  expect(dialogAxe.violations).toEqual([]);
  expect(context.writes).toHaveLength(1); expect(context.writes[0].display.visibleFields).toHaveLength(8); expect(context.creates).toEqual([]);
});

test("removing all selected fields retains titles and exact evidence but does not fabricate metadata", async ({ page }) => {
  const context = await harness(page); await openEditor(page); await clearFields(editor(page));
  await editor(page).getByRole("combobox", { name: "레이아웃", exact: true }).selectOption("table");
  await editor(page).getByRole("button", { name: "표시 설정 저장", exact: true }).click();
  await expect(results(page).getByRole("columnheader")).toHaveText(["기록", "검색 문맥과 정확한 보관 위치"]);
  await expect(record(page, "c").getByRole("link", { name: /보관 원문/ })).toBeVisible();
  expect(context.writes[0].display.visibleFields).toEqual([]); expect(context.writes).toHaveLength(1);
});
