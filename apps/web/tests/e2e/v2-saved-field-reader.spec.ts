import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const text = "가".repeat(4095) + "🧭" + "<script>literal only</script>\n" + "나".repeat(4200);
const jsonText = '{  "literal" : "<script>not code</script>",\n "note": "' + "다".repeat(8200) + '"  }';
const revision = "a".repeat(64), nextRevision = "b".repeat(64);
const scope = (page: Page) => page.getByRole("region", { name: "긴 메모 전체 값 읽기", exact: true });
const current = (page: Page) => page.getByRole("region", { name: "긴 메모 현재 구간", exact: true });
type Payload = ReturnType<typeof body>;
function body(url: URL, overrides: Record<string, unknown> = {}) {
  const parts = url.pathname.split("/"), recordId = parts[4], propertyId = parts[6], offset = Number(url.searchParams.get("offset")), full = url.searchParams.get("format") === "full", json = url.searchParams.get("fieldKey") === "long_json", content = json ? jsonText : text;
  let end = full ? content.length : Math.min(offset + 4096, content.length);
  if (end < content.length && /[\uD800-\uDBFF]/.test(content.charAt(end - 1)) && /[\uDC00-\uDFFF]/.test(content.charAt(end))) end--;
  return { contract: "saved-field-page.v1", recordId, propertyId, fieldKey: json ? "long_json" : "long_note", privacyLevel: "normal", revision, renderer: json ? "json" : "text", sourceLabel: "직접 입력", lockedByUser: true, unit: null,
    totalUtf16: content.length, offset, end, nextOffset: end === content.length ? null : end, text: content.slice(offset, end), totalStoredBytes: Buffer.byteLength(json ? content : JSON.stringify(content)), ...overrides };
}
async function harness(page: Page) {
  const reads: URL[] = [], unexpected: string[] = [];
  let responder: ((route: Route, url: URL) => Promise<void>) | null = null;
  await page.addInitScript(() => {
    Object.defineProperty(window, "__fieldCopies", { value: [], configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { (window as unknown as { __fieldCopies: string[] }).__fieldCopies.push(value); } }, configurable: true });
  });
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/**", async (route) => {
    const url = new URL(route.request().url());
    if (/^\/api\/v2\/records\/reader-record-\d+\/display-fields\/reader-property-\d+$/.test(url.pathname) && route.request().method() === "GET") {
      reads.push(url); return responder ? responder(route, url) : route.fulfill({ json: body(url) });
    }
    unexpected.push(`${route.request().method()} ${url.pathname}`); return route.fulfill({ status: 404, json: { error: { code: "unexpected" } } });
  });
  await page.goto("/v2-lab?surface=saved-field-reader");
  await expect(page.getByRole("heading", { name: "긴 필드 읽기 검증", exact: true })).toBeVisible();
  return { reads, unexpected, respond(handler: typeof responder) { responder = handler; } };
}
async function open(page: Page) { await page.getByRole("button", { name: "전체 값 열기", exact: true }).click(); await expect(current(page)).toBeVisible(); }
const copies = (page: Page) => page.evaluate(() => (window as unknown as { __fieldCopies: string[] }).__fieldCopies);

for (const layout of ["list", "cards", "timeline", "table"]) {
  test(`${layout} has explicit partial JSON preview, no automatic read, and private fields cannot open`, async ({ page }) => {
    const context = await harness(page); await page.getByRole("button", { name: `${layout} 보기`, exact: true }).click();
    await expect(page.getByText(/일부 미리보기 · 저장 JSON의 앞부분/)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "전체 값 열기", exact: true })).toHaveCount(1);
    await expect(page.getByText("민감·보호 필드 숨김", { exact: true })).toHaveCount(2);
    expect(context.reads).toHaveLength(0); expect(context.unexpected).toEqual([]);
    await open(page); expect(context.reads).toHaveLength(1); expect(context.reads[0].searchParams.get("revision")).toBeNull();
    await expect(current(page)).toHaveText(text.slice(0, 4095)); await expect(page.locator(".v2-saved-field-preview")).toHaveCount(0); await expect(scope(page)).toContainText("열 때 다시 확인한 현재 확정값"); expect(await copies(page)).toEqual([]);
  });
}

test("surrogate-safe next and previous pages revalidate the same revision without accumulating text", async ({ page }) => {
  const context = await harness(page); await open(page);
  await scope(page).getByRole("button", { name: "다음 구간", exact: true }).click();
  await expect(current(page)).toHaveText(text.slice(4095, 8191));
  expect(context.reads.at(-1)?.searchParams.get("offset")).toBe("4095"); expect(context.reads.at(-1)?.searchParams.get("revision")).toBe(revision);
  await expect(current(page).locator("script")).toHaveCount(0);
  await scope(page).getByRole("button", { name: "다음 구간", exact: true }).click(); await expect(current(page)).toHaveText(text.slice(8191));
  await expect(scope(page).getByRole("button", { name: "다음 구간", exact: true })).toBeDisabled();
  await scope(page).getByRole("button", { name: "이전 구간", exact: true }).click(); await expect(current(page)).toHaveText(text.slice(4095, 8191));
  await scope(page).getByRole("button", { name: "이전 구간", exact: true }).click(); await expect(current(page)).toHaveText(text.slice(0, 4095));
  await expect(scope(page).getByRole("button", { name: "이전 구간", exact: true })).toBeDisabled();
  expect(context.reads.map((url) => url.searchParams.get("offset"))).toEqual(["0", "4095", "8191", "4095", "0"]);
});

test("current and full copy each require a fresh GET and preserve exact text", async ({ page }) => {
  const context = await harness(page); await open(page);
  await scope(page).getByRole("button", { name: "현재 구간 복사", exact: true }).click(); await expect(scope(page).getByRole("status")).toHaveText("현재 구간을 복사했습니다.");
  expect(context.reads).toHaveLength(2); expect(context.reads[1].searchParams.get("revision")).toBe(revision); expect(await copies(page)).toEqual([text.slice(0, 4095)]);
  await scope(page).getByRole("button", { name: "전체 값 복사", exact: true }).click(); await expect(scope(page).getByRole("status")).toHaveText("전체 값을 복사했습니다.");
  expect(context.reads).toHaveLength(3); expect(context.reads[2].searchParams.get("format")).toBe("full"); expect(context.reads[2].searchParams.get("offset")).toBe("0"); expect(context.reads[2].searchParams.get("revision")).toBe(revision);
  expect(await copies(page)).toEqual([text.slice(0, 4095), text]); await expect(current(page)).toHaveText(text.slice(0, 4095));
});

test("409 hides old full text and preview, then requires an explicit current-value restart", async ({ page }) => {
  const context = await harness(page); await open(page); context.respond((route) => route.fulfill({ status: 409, json: { error: { code: "changed" } } }));
  await scope(page).getByRole("button", { name: "전체 값 복사", exact: true }).click();
  await expect(scope(page).getByRole("alert")).toContainText("필드가 바뀌었습니다"); await expect(current(page)).toHaveCount(0); await expect(page.locator(".v2-saved-field-preview")).toHaveCount(0);
  expect(await copies(page)).toEqual([]); expect(context.reads).toHaveLength(2);
  context.respond((route, url) => route.fulfill({ json: body(url, { revision: nextRevision }) }));
  await scope(page).getByRole("button", { name: "현재 값 처음부터 확인", exact: true }).click(); await expect(current(page)).toBeVisible();
  expect(context.reads[2].searchParams.get("revision")).toBeNull();
  await expect(page.locator(".v2-saved-field-preview")).toHaveCount(0);
});

test("JSON full copy preserves stored whitespace and never executes literal markup", async ({ page }) => {
  const context = await harness(page); await page.getByRole("button", { name: "필드 형식 교체", exact: true }).click(); await open(page);
  await expect(current(page)).toHaveText(jsonText.slice(0, 4096)); await expect(current(page).locator("script")).toHaveCount(0);
  await expect(scope(page)).toContainText("저장 JSON 그대로");
  await scope(page).getByRole("button", { name: "전체 값 복사", exact: true }).click(); await expect(scope(page).getByRole("status")).toHaveText("전체 값을 복사했습니다.");
  expect(await copies(page)).toEqual([jsonText]); expect(context.reads.at(-1)?.searchParams.get("fieldKey")).toBe("long_json");
});

for (const previouslyOpened of [false, true]) {
  test(`413 ${previouslyOpened ? "after reading" : "on first open"} closes old content without claiming a version conflict and preserves explicit restart`, async ({ page }) => {
    const context = await harness(page);
    if (previouslyOpened) await open(page);
    context.respond((route) => route.fulfill({ status: 413, json: { error: { code: "saved_field_too_large", message: "Untrusted server detail must not replace the fixed explanation" } } }));
    if (previouslyOpened) await scope(page).getByRole("button", { name: "전체 값 복사", exact: true }).click();
    else await page.getByRole("button", { name: "전체 값 열기", exact: true }).click();
    await expect(scope(page).getByRole("alert")).toContainText("단일 읽기 한도(2 MiB)");
    await expect(scope(page).getByRole("alert")).toContainText("원값은 그대로 보존됩니다");
    await expect(scope(page).getByRole("alert")).not.toContainText("필드가 바뀌었습니다");
    await expect(scope(page)).not.toContainText("Untrusted server detail");
    await expect(current(page)).toHaveCount(0); await expect(page.locator(".v2-saved-field-preview")).toHaveCount(0);
    await expect(scope(page).getByRole("button", { name: /복사$/ })).toHaveCount(0);
    expect(await copies(page)).toEqual([]); expect(context.reads).toHaveLength(previouslyOpened ? 2 : 1);
    await expect(page.getByRole("link", { name: "긴 필드 시험 기록 1", exact: true })).toBeVisible();
    context.respond((route, url) => route.fulfill({ json: body(url, { revision: nextRevision }) }));
    await scope(page).getByRole("button", { name: "현재 값 처음부터 확인", exact: true }).click(); await expect(current(page)).toHaveText(text.slice(0, 4095));
    expect(context.reads.at(-1)?.searchParams.get("revision")).toBeNull(); expect(context.reads.at(-1)?.searchParams.get("offset")).toBe("0");
    await expect(page.locator(".v2-saved-field-preview")).toHaveCount(0);
  });
}

for (const failure of [401, 403, 404, 423, "wrong-record", "sensitive", "restricted", "missing-privacy"] as const) {
  test(`${failure} closes the whole record and prevents stale copy`, async ({ page }) => {
    const context = await harness(page); await open(page);
    context.respond((route, url) => {
      if (typeof failure === "number") return route.fulfill({ status: failure, json: { error: { code: "denied" } } });
      const payload: Record<string, unknown> = body(url);
      if (failure === "wrong-record") payload.recordId = "some-other-record";
      else if (failure === "missing-privacy") delete payload.privacyLevel;
      else payload.privacyLevel = failure;
      return route.fulfill({ json: payload });
    });
    await scope(page).getByRole("button", { name: "현재 구간 복사", exact: true }).click();
    await expect(page.getByRole("link", { name: "기록 접근 다시 확인", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "긴 필드 시험 기록 1", exact: true })).toHaveCount(0);
    await expect(page.locator(".v2-saved-field-reader")).toHaveCount(0); expect(await copies(page)).toEqual([]);
  });
}

const malformed: { name: string; patch: (value: Payload) => Record<string, unknown> }[] = [
  { name: "property", patch: (value) => ({ ...value, propertyId: "other-property" }) },
  { name: "field", patch: (value) => ({ ...value, fieldKey: "other_field" }) },
  { name: "contract", patch: (value) => ({ ...value, contract: "unknown" }) },
  { name: "revision", patch: (value) => ({ ...value, revision: nextRevision }) },
  { name: "offset", patch: (value) => ({ ...value, offset: 1 }) },
  { name: "total", patch: (value) => ({ ...value, totalUtf16: value.totalUtf16 + 1 }) },
  { name: "end", patch: (value) => ({ ...value, end: value.end + 1 }) },
  { name: "next", patch: (value) => ({ ...value, nextOffset: null }) },
  { name: "page-budget", patch: (value) => ({ ...value, text: "X".repeat(4097), end: value.offset + 4097, nextOffset: value.offset + 4097 }) },
  { name: "payload-budget", patch: (value) => ({ ...value, extra: "X".repeat(33000) }) },
  { name: "stored-budget", patch: (value) => ({ ...value, totalStoredBytes: 2097153 }) },
];
for (const scenario of malformed) {
  test(`malformed ${scenario.name} response is never applied or copied`, async ({ page }) => {
    const context = await harness(page); await open(page); const original = await current(page).textContent();
    context.respond((route, url) => route.fulfill({ json: scenario.patch(body(url)) }));
    await scope(page).getByRole("button", { name: "현재 구간 복사", exact: true }).click();
    await expect(scope(page).getByRole("alert")).toBeVisible(); await expect(current(page)).toHaveText(original!); expect(await copies(page)).toEqual([]);
  });
}

test("late cancelled response cannot reopen text or copy, and another record never receives old state", async ({ page }) => {
  const context = await harness(page); let held: Route | undefined, heldUrl: URL | undefined;
  context.respond(async (route, url) => { held = route; heldUrl = url; });
  await page.getByRole("button", { name: "전체 값 열기", exact: true }).click(); await expect(scope(page).getByRole("button", { name: "불러오기 취소", exact: true })).toBeVisible();
  await expect.poll(() => !!held).toBe(true); await scope(page).getByRole("button", { name: "불러오기 취소", exact: true }).click();
  await held!.fulfill({ json: body(heldUrl!) }).catch(() => undefined); await expect(current(page)).toHaveCount(0); expect(await copies(page)).toEqual([]);
  held = undefined; await scope(page).getByRole("button", { name: "현재 값 처음부터 확인", exact: true }).click(); await expect.poll(() => !!held).toBe(true);
  await page.getByRole("button", { name: "기록 교체", exact: true }).click(); await held!.fulfill({ json: body(heldUrl!) }).catch(() => undefined);
  await expect(page.getByRole("link", { name: "긴 필드 시험 기록 2", exact: true })).toBeVisible(); await expect(current(page)).toHaveCount(0); await expect(page.getByRole("button", { name: "전체 값 열기", exact: true })).toBeVisible();
});

test("closing during a full copy discards late data and reopening starts at offset zero", async ({ page }) => {
  const context = await harness(page); await open(page); let held: Route | undefined, heldUrl: URL | undefined;
  context.respond(async (route, url) => { held = route; heldUrl = url; });
  await scope(page).getByRole("button", { name: "전체 값 복사", exact: true }).click(); await expect.poll(() => !!held).toBe(true);
  await page.getByRole("button", { name: "전체 값 접기", exact: true }).click(); await held!.fulfill({ json: body(heldUrl!) }).catch(() => undefined);
  await expect(current(page)).toHaveCount(0); expect(await copies(page)).toEqual([]); context.respond(null); await open(page);
  expect(context.reads.at(-1)?.searchParams.get("offset")).toBe("0"); expect(context.reads.at(-1)?.searchParams.get("revision")).toBeNull();
});

test("keyboard and 320px reader maintain bounded scrolling, literal text and accessibility", async ({ page }, testInfo) => {
  const context = await harness(page); await page.setViewportSize({ width: 320, height: 740 }); await open(page);
  await expect(current(page)).toBeFocused();
  const bounds = await current(page).evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight, width: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(bounds.height).toBeLessThanOrEqual(334); expect(bounds.scroll).toBeGreaterThan(bounds.height); expect(bounds.width).toBeLessThanOrEqual(bounds.viewport);
  const axe = await new AxeBuilder({ page }).include(".v2-saved-field-reader").analyze(); expect(axe.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("saved-field-reader-320.png"), fullPage: true });
  await current(page).press("Escape"); await expect(scope(page)).toHaveCount(0); await expect(page.getByRole("button", { name: "전체 값 열기", exact: true })).toBeFocused(); expect(context.unexpected).toEqual([]);
});
