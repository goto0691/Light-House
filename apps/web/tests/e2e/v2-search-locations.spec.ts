import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { recordLocationTextHash, serializeRecordLocation, type V2RecordLocationResult, type V2RecordLocationV1, type V2RetrievalMatch } from "../../src/lib/v2/retrieval/record-location-v1";
import type { V2RetrievalQueryPlanV1 } from "../../src/lib/v2/retrieval/query-plan-v1";

type Fixture = { locations: Record<string, V2RecordLocationV1>; texts: Record<string, string>; allMatches: V2RetrievalMatch[]; plan: V2RetrievalQueryPlanV1 };
type Read = { url: string; location: V2RecordLocationV1 };
const recordId = "search-location-fixture";
const panel = (page: Page) => page.getByRole("region", { name: "검색한 보관 위치", exact: true });
const targetText = (page: Page) => panel(page).getByLabel("검색한 보관 텍스트", { exact: true });
const fixtureHref = (location: V2RecordLocationV1) => `/v2-lab?${new URLSearchParams({ surface: "search-location", loc: serializeRecordLocation(location) })}`;

function responseFor(location: V2RecordLocationV1, fixture: Fixture): V2RecordLocationResult {
  const kind = location.kind === "ai_fragment" ? "ai" : location.kind === "manual_fragment" ? "manual" : location.kind === "curation" ? "curation" : "source";
  return {
    contract: "record-location-result.v1", recordId, location, text: fixture.texts[kind], textHash: location.textHash, range: location.range,
    origin: kind === "ai" ? "ai_interpretation" : kind === "manual" ? "manual_extract" : kind === "curation" ? "curation" : "external_source",
    label: kind === "ai" ? "AI 해석" : kind === "manual" ? "수동 발췌" : kind === "curation" ? "정리본 프롬프트" : "보관 원문",
    privacyLevel: "normal", accessExpiresAt: null, reviewStatus: kind === "ai" ? "proposed" : null, isHistorical: true,
    context: { documentRevisionId: "original-document-revision", snapshotId: "snapshotId" in location ? location.snapshotId : null,
      snapshotVersion: "snapshotId" in location && location.snapshotId ? 1 : null, runId: "runId" in location ? location.runId : null,
      groupKey: "groupKey" in location ? location.groupKey : null, curationRevisionId: location.kind === "curation" ? location.revisionId : null },
    evidence: [{ sourceItemId: "source-before-page-51", memberId: "member-before-page-51", label: "사용자가 보관한 원문", quote: fixture.texts.source, textStart: 0, textEnd: fixture.texts.source.length }],
    attachments: [], copy: { allowed: true, mode: kind === "curation" ? "standard" : "exact", reason: null, warnings: [] },
  };
}

/** Browser/HTTP-fixture evidence only; this does not exercise real D1 or providers. */
async function harness(page: Page) {
  let fixture: Fixture;
  const reads: Read[] = [], mutations: string[] = [], unexpected: string[] = [], matchReads: URL[] = [];
  let onRead: ((route: Route, read: Read, result: V2RecordLocationResult) => Promise<void>) | null = null;
  let onMatches: ((route: Route, url: URL) => Promise<void>) | null = null;
  await page.addInitScript(() => {
    const state = window as unknown as { copiedTexts: string[]; clipboardDenied: boolean };
    state.copiedTexts = []; state.clipboardDenied = false;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => {
      if (state.clipboardDenied) throw new Error("Synthetic clipboard denial"); state.copiedTexts.push(text);
    } } });
  });
  await page.route("**/*", (route) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") { mutations.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 500, json: { error: { code: "unexpected_mutation" } } }); }
    if (url.pathname === `/api/v2/records/${recordId}/search-location`) {
      const read = { url: request.url(), location: JSON.parse(url.searchParams.get("loc")!) as V2RecordLocationV1 }; reads.push(read);
      const result = responseFor(read.location, fixture);
      return onRead ? onRead(route, read, result) : route.fulfill({ json: result });
    }
    if (url.pathname.endsWith("/search-matches")) {
      matchReads.push(url);
      if (onMatches) return onMatches(route, url);
      const requestedPage = Number(url.searchParams.get("page"));
      return route.fulfill({ json: { contract: "retrieval-matches.v1", recordId, privacyLevel: "normal", plan: JSON.parse(url.searchParams.get("plan")!),
        matches: fixture.allMatches.slice((requestedPage - 1) * 50, requestedPage * 50), totalCount: 52, page: requestedPage, pageSize: 50, totalPages: 2 } });
    }
    if (url.pathname.startsWith("/api/v2/attachments/")) return route.fulfill({ status: 404, body: "Synthetic absent image" });
    unexpected.push(url.pathname); return route.fulfill({ status: 404, body: "Unexpected fixture API read" });
  });
  await page.goto("/v2-lab?surface=search-location");
  fixture = JSON.parse((await page.getByTestId("search-location-fixture-data").textContent())!) as Fixture;
  return { get fixture() { return fixture; }, reads, mutations, unexpected, matchReads,
    onRead(handler: typeof onRead) { onRead = handler; }, onMatches(handler: typeof onMatches) { onMatches = handler; },
    async open(kind: string) { await page.getByRole("button", { name: kind === "source" ? "이전 자료 검색 위치" : kind === "manual" ? "수동 발췌 검색 위치" : kind === "ai" ? "AI 해석 검색 위치" : "정리본 검색 위치", exact: true }).click(); },
  };
}

for (const kind of ["source", "manual", "ai"] as const) {
  test(`exact ${kind} outside first catalog/run page uses the locator without history scans and copies unchanged text`, async ({ page }) => {
    const context = await harness(page);
    await context.open(kind);
    await expect(targetText(page)).toHaveText(context.fixture.texts[kind]);
    await expect(panel(page).getByRole("heading", { name: "검색한 보관 위치", exact: true })).toBeFocused();
    expect(context.reads.at(-1)?.location).toEqual(context.fixture.locations[kind]);
    expect(new URL(context.reads.at(-1)!.url).searchParams.size).toBe(1);
    await expect(targetText(page).locator("mark")).toHaveText("window light");
    if (kind === "ai") { await expect(panel(page)).toContainText("run-before-page-27"); await expect(panel(page)).toContainText("AI 해석 · 저자의 원문 아님"); await expect(panel(page)).toContainText("확인되지 않은 제안"); }
    // StrictMode may abort/restart the initial effect. The explicit copy must
    // still perform exactly one additional exact read, never a history scan.
    const beforeCopy = context.reads.length;
    await panel(page).getByRole("button", { name: kind === "ai" ? "AI 해석만 복사" : "보관 텍스트 그대로 복사", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts)).toEqual([context.fixture.texts[kind]]);
    expect(context.reads).toHaveLength(beforeCopy + 1);
    expect(context.reads.every((read) => serializeRecordLocation(read.location) === serializeRecordLocation(context.fixture.locations[kind]))).toBe(true);
    expect(context.unexpected).toEqual([]); expect(context.mutations).toEqual([]);
  });
}

test("curation role and immutable revision have an explicit partial-copy action and source evidence", async ({ page }) => {
  const context = await harness(page);
  context.onRead(async (route, _read, result) => route.fulfill({ json: { ...result, copy: { allowed: true, mode: "available_only", reason: "partial", warnings: ["missing_parts"] }, attachments: [{ attachmentId: "archived-example", filename: "합성 예시.png", mimeType: "image/png", itemKey: "example-1", evidenceMethod: "unresolved" }] } }));
  await context.open("curation");
  await expect(targetText(page)).toHaveText(context.fixture.texts.curation);
  await expect(panel(page)).toContainText("curation-before-page-27");
  await expect(panel(page)).toContainText("일부만 확보한 자료");
  await expect(panel(page).getByRole("button", { name: "보관 텍스트 그대로 복사", exact: true })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "확보한 조각만 복사", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts)).toEqual([context.fixture.texts.curation]);
  await panel(page).getByText("정확한 출처 근거 1개", { exact: true }).click();
  await expect(panel(page)).toContainText("사용자가 보관한 원문");
  await expect(panel(page)).toContainText("보관 이미지 · 텍스트와의 대응 미확인");
  expect(context.reads[0].location).toMatchObject({ kind: "curation", groupKey: "group-before-page-51", revisionId: "curation-before-page-27", role: "prompt" });
  expect(context.mutations).toEqual([]);
});

test("ambiguous curation never offers assembled copying", async ({ page }) => {
  const context = await harness(page);
  context.onRead(async (route, _read, result) => route.fulfill({ json: { ...result, copy: { allowed: false, mode: null, reason: "alternatives", warnings: ["alternative_selection_required"] } } }));
  await context.open("curation");
  await expect(targetText(page)).toBeVisible();
  await expect(panel(page)).toContainText("합쳐 복사할 수 없습니다");
  await expect(panel(page).getByRole("button", { name: /복사/ })).toHaveCount(0);
  expect(context.mutations).toEqual([]);
});

test("rejected AI evidence stays explicitly historical and cannot be copied as an accepted original", async ({ page }) => {
  const context = await harness(page);
  context.onRead(async (route, _read, result) => route.fulfill({ json: { ...result, reviewStatus: "rejected", copy: { allowed: false, mode: null, reason: "거절되거나 대체된 조각입니다.", warnings: ["rejected"] } } }));
  await context.open("ai");
  await expect(targetText(page)).toHaveText(context.fixture.texts.ai);
  await expect(panel(page)).toContainText("거절된 제안 · 보관 근거로만 표시");
  await expect(panel(page)).toContainText("AI 해석 · 저자의 원문 아님");
  await expect(panel(page).getByRole("button", { name: /복사/ })).toHaveCount(0);
  expect(context.mutations).toEqual([]);
});

test("malformed and duplicate loc fail closed before any exact GET", async ({ page }) => {
  const context = await harness(page);
  await page.goto("/v2-lab?surface=search-location&loc=not-json");
  await expect(panel(page).getByRole("alert")).toContainText("최신 자료로 바꾸지 않았습니다");
  await expect(targetText(page)).toHaveCount(0);
  await page.goto(`${fixtureHref(context.fixture.locations.source)}&loc=${encodeURIComponent(serializeRecordLocation(context.fixture.locations.ai))}`);
  await expect(panel(page).getByRole("alert")).toBeVisible();
  expect(context.reads).toEqual([]); expect(context.mutations).toEqual([]);
});

for (const status of [404, 409, 503]) {
  test(`HTTP ${status} reports exact-location failure with no latest fallback and retries the same locator`, async ({ page }) => {
    const context = await harness(page);
    context.onRead(async (route) => route.fulfill({ status, json: { error: { code: status === 404 ? "record_location_not_found" : "record_location_conflict", message: "Synthetic failure" } } }));
    await context.open("manual");
    await expect(panel(page).getByRole("alert")).toContainText("바꾸지 않았습니다");
    await expect(targetText(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "현재 기록과 초안" })).toContainText("현재 기록 본문은 바꾸지 않습니다.");
    const beforeRetry = context.reads.length;
    context.onRead(null);
    await panel(page).getByRole("button", { name: "같은 보관 위치 다시 확인", exact: true }).click();
    await expect(targetText(page)).toHaveText(context.fixture.texts.manual);
    expect(context.reads).toHaveLength(beforeRetry + 1);
    expect(context.reads.every((read) => serializeRecordLocation(read.location) === serializeRecordLocation(context.fixture.locations.manual))).toBe(true);
    expect(context.unexpected).toEqual([]); expect(context.mutations).toEqual([]);
  });
}

for (const defect of ["record", "location", "hash", "context", "range", "origin", "copy"] as const) {
  test(`successful but mismatched ${defect} DTO never displays or copies a substituted location`, async ({ page }) => {
    const context = await harness(page);
    context.onRead(async (route, _read, result) => {
      const changed: Record<string, unknown> = structuredClone(result);
      if (defect === "record") changed.recordId = "another-record";
      if (defect === "location") changed.location = context.fixture.locations.source;
      if (defect === "hash") changed.text = "substituted latest source";
      if (defect === "context") changed.context = { ...result.context, runId: "latest-run" };
      if (defect === "range") changed.range = { start: 0, end: 1 };
      if (defect === "origin") changed.origin = "external_source";
      if (defect === "copy") changed.copy = { allowed: true, mode: "standard", reason: null, warnings: [] };
      await route.fulfill({ json: changed });
    });
    await context.open("ai");
    await expect(panel(page).getByRole("alert")).toBeVisible();
    await expect(targetText(page)).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /복사/ })).toHaveCount(0);
    expect(context.mutations).toEqual([]);
  });
}

for (const status of [401, 403, 423, 200]) {
  test(`copy-time ${status === 200 ? "redacted 200" : status} access denial removes the exact payload before clipboard use`, async ({ page }) => {
    const context = await harness(page);
    await context.open("source"); await expect(targetText(page)).toBeVisible();
    context.onRead(async (route) => route.fulfill({ status, json: status === 200 ? { capabilities: { reason: "restricted_record_locked" } } : { error: { code: "restricted_record_locked", message: "Synthetic denial" } } }));
    await panel(page).getByRole("button", { name: "보관 텍스트 그대로 복사", exact: true }).click();
    await expect(panel(page).getByRole("alert")).toContainText("권한");
    await expect(targetText(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts)).toEqual([]);
    expect(context.mutations).toEqual([]);
  });
}

test("restricted access expiry clears displayed text and copy controls without automatic AI or upload", async ({ page }) => {
  const context = await harness(page);
  context.onRead(async (route, _read, result) => route.fulfill({ json: { ...result, privacyLevel: "restricted", accessExpiresAt: new Date(Date.now() + 1_200).toISOString() } }));
  await context.open("source"); await expect(targetText(page)).toBeVisible();
  await expect(panel(page).getByRole("alert")).toContainText("권한", { timeout: 5_000 });
  await expect(targetText(page)).toHaveCount(0);
  expect(context.mutations).toEqual([]);
});

test("URL changes and back preserve the current draft; reload reopens the exact historical run", async ({ page }) => {
  const context = await harness(page);
  await page.getByLabel("현재 편집 초안", { exact: true }).fill("절대로 교체하지 않을 입력 👩‍💻");
  await context.open("source"); await expect(targetText(page)).toHaveText(context.fixture.texts.source);
  await context.open("ai"); await expect(targetText(page)).toHaveText(context.fixture.texts.ai);
  await expect(page.getByLabel("현재 편집 초안", { exact: true })).toHaveValue("절대로 교체하지 않을 입력 👩‍💻");
  await page.goBack(); await expect(targetText(page)).toHaveText(context.fixture.texts.source);
  await expect(page.getByLabel("현재 편집 초안", { exact: true })).toHaveValue("절대로 교체하지 않을 입력 👩‍💻");
  await page.goForward(); await expect(targetText(page)).toHaveText(context.fixture.texts.ai);
  await page.reload(); await expect(targetText(page)).toHaveText(context.fixture.texts.ai);
  expect(context.reads.at(-1)?.location).toEqual(context.fixture.locations.ai);
  expect(context.unexpected).toEqual([]); expect(context.mutations).toEqual([]);
});

test("closing and reopening the same locator retains the draft but never reuses the old read receipt", async ({ page }) => {
  const context = await harness(page);
  await page.getByLabel("현재 편집 초안", { exact: true }).fill("보기 전환에도 남기는 초안");
  await context.open("source"); await expect(targetText(page)).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "현재 기록만 보기", exact: true })).toHaveAttribute("href", `/v2/records/${recordId}`);
  await page.getByRole("button", { name: "현재 기록만 표시", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  context.onRead(async (route) => { await held; await route.fulfill({ status: 423, json: { error: { code: "restricted_record_locked" } } }); });
  const beforeReopen = context.reads.length;
  await context.open("source");
  await expect.poll(() => context.reads.slice(beforeReopen).some((read) => serializeRecordLocation(read.location) === serializeRecordLocation(context.fixture.locations.source))).toBe(true);
  await expect(targetText(page)).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toContainText("확인하고 있습니다");
  await expect(page.getByLabel("현재 편집 초안", { exact: true })).toHaveValue("보기 전환에도 남기는 초안");
  release(); await expect(panel(page).getByRole("alert")).toContainText("권한");
  expect(context.mutations).toEqual([]);
});

for (const kind of ["document_title", "document_body"] as const) {
  test(`exact ${kind} opens its named document revision separately from the current body`, async ({ page }) => {
    const context = await harness(page);
    const text = kind === "document_title" ? "과거에 붙인 제목" : "  과거 본문\r\n창가의 빛 👩‍💻  ";
    const location: V2RecordLocationV1 = { contract: "record-location.v1", kind, revisionId: "document-revision-before-page-51", documentVersion: 1, range: null, textHash: recordLocationTextHash(text) };
    context.onRead(async (route, _read, result) => route.fulfill({ json: { ...result, origin: kind, label: kind === "document_title" ? "기록 제목" : "내 글 · 보관한 본문 버전", text, context: { ...result.context, documentRevisionId: location.revisionId, snapshotId: null, snapshotVersion: null } } }));
    await page.goto(fixtureHref(location));
    await expect(targetText(page)).toHaveText(text);
    await expect(panel(page)).toContainText("document-revision-before-page-51");
    await expect(page.getByRole("region", { name: "현재 기록과 초안" })).toContainText("현재 기록 본문은 바꾸지 않습니다.");
    await panel(page).getByRole("button", { name: "보관 텍스트 그대로 복사", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts)).toEqual([text]);
    expect(context.reads.at(-1)?.location).toEqual(location);
    expect(context.mutations).toEqual([]);
  });
}

test("identical words at another UTF-16 range open the requested occurrence without text normalization", async ({ page }) => {
  const context = await harness(page);
  const text = "👩‍💻 window light\r\nwindow light  ";
  const start = text.lastIndexOf("window light");
  const location: V2RecordLocationV1 = { ...context.fixture.locations.source, textHash: recordLocationTextHash(text), range: { start, end: start + 12 } };
  context.onRead(async (route, _read, result) => route.fulfill({ json: { ...result, text } }));
  await page.goto(fixtureHref(location));
  await expect(targetText(page)).toHaveText(text);
  expect(await targetText(page).evaluate((node) => node.querySelector("mark")?.previousSibling?.textContent)).toBe(text.slice(0, start));
  await panel(page).getByRole("button", { name: "보관 텍스트 그대로 복사", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts)).toEqual([text]);
  expect(context.mutations).toEqual([]);
});

test("a held previous-location response cannot replace or refocus the newly requested target", async ({ page }) => {
  const context = await harness(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  context.onRead(async (route, read, result) => { if (read.location.kind === "source") await held; await route.fulfill({ json: result }).catch(() => undefined); });
  await context.open("source");
  await expect.poll(() => context.reads.some((read) => serializeRecordLocation(read.location) === serializeRecordLocation(context.fixture.locations.source))).toBe(true);
  await context.open("ai"); await expect(targetText(page)).toHaveText(context.fixture.texts.ai);
  await page.getByLabel("현재 편집 초안", { exact: true }).focus();
  release();
  await expect(targetText(page)).toHaveText(context.fixture.texts.ai);
  await expect(page.getByLabel("현재 편집 초안", { exact: true })).toBeFocused();
  expect(context.mutations).toEqual([]);
});

test("source-match catalog exposes 51+ exact targets with the full saved query plan and hides private snippets", async ({ page }) => {
  const context = await harness(page);
  const results = page.getByRole("region", { name: "검색 결과", exact: true });
  const normal = results.getByRole("article").filter({ has: page.getByRole("heading", { name: "합성 검색 위치 기록", exact: true }) });
  const sensitive = results.getByRole("article").filter({ has: page.getByRole("heading", { name: "민감 기록", exact: true }) });
  await expect(results.getByRole("article")).toHaveCount(2);
  await expect(normal.getByRole("list", { name: "출처별 검색 근거" }).getByRole("listitem")).toHaveCount(3);
  await expect(sensitive).not.toContainText("노출하면 안 되는");
  await normal.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
  await expect(normal.getByRole("list", { name: "출처별 검색 근거" }).getByRole("listitem")).toHaveCount(50);
  await normal.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
  await expect(normal.getByRole("list", { name: "출처별 검색 근거" }).getByRole("listitem")).toHaveCount(52);
  await expect(normal.getByRole("link", { name: "보관 원문 52 과거 보관 버전", exact: true })).toHaveAttribute("href", /source-match-52/);
  await expect(normal.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true })).toHaveCount(0);
  expect(context.matchReads.map((url) => JSON.parse(url.searchParams.get("plan")!))).toEqual([context.fixture.plan, context.fixture.plan]);
  expect(context.matchReads.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
  expect(context.mutations).toEqual([]);
});

test("search-match failure keeps only known matches and retries the same page; denial closes the catalog", async ({ page }) => {
  const context = await harness(page);
  const normal = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "합성 검색 위치 기록", exact: true }) });
  context.onMatches(async (route) => route.fulfill({ status: 503, json: { error: { code: "synthetic_failure" } } }));
  await normal.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
  await expect(normal.getByRole("alert")).toBeVisible();
  await expect(normal.getByRole("list", { name: "출처별 검색 근거" }).getByRole("listitem")).toHaveCount(3);
  context.onMatches(async (route) => route.fulfill({ status: 423, json: { error: { code: "restricted_record_locked" } } }));
  await normal.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
  await expect(page.getByRole("region", { name: "검색 결과", exact: true }).getByRole("alert")).toContainText("권한");
  await expect(page.getByRole("heading", { name: "합성 검색 위치 기록", exact: true })).toHaveCount(0);
  expect(context.matchReads.map((url) => url.searchParams.get("page"))).toEqual(["1", "1"]);
  expect(context.mutations).toEqual([]);
});

for (const privacy of ["sensitive", "restricted", "missing", "invalid"] as const) {
  test(`paging with ${privacy} privacy metadata closes all previously rendered record content`, async ({ page }) => {
    const context = await harness(page);
    const results = page.getByRole("region", { name: "검색 결과", exact: true });
    const card = results.getByRole("article").first();
    await card.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
    await expect(card.getByRole("list", { name: "출처별 검색 근거" }).getByRole("listitem")).toHaveCount(50);
    await expect(card).toContainText("합성 검색 위치 기록");
    await expect(card).toContainText("보관한 자료의 window light");
    context.onMatches(async (route, url) => {
      const body: Record<string, unknown> = { contract: "retrieval-matches.v1", recordId, privacyLevel: privacy === "invalid" ? "public" : privacy,
        plan: JSON.parse(url.searchParams.get("plan")!), matches: context.fixture.allMatches.slice(50).map((match) => ({ ...match, snippet: "표시하면 안 되는 새 민감 문맥" })), totalCount: 52, page: 2, pageSize: 50, totalPages: 2 };
      if (privacy === "missing") delete body.privacyLevel;
      await route.fulfill({ status: 200, json: body });
    });
    await card.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("권한");
    await expect(card.getByRole("heading")).toHaveCount(0);
    await expect(card.locator(".v2-search-result__snippet")).toHaveCount(0);
    await expect(card.getByRole("list")).toHaveCount(0);
    await expect(card.locator("time")).toHaveCount(0);
    await expect(card).not.toContainText("합성 검색 위치 기록");
    await expect(card).not.toContainText("보관한 자료의 window light");
    await expect(card).not.toContainText("합성 검색 문맥");
    await expect(card).not.toContainText("표시하면 안 되는 새 민감 문맥");
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(results.getByRole("article").nth(1).getByRole("heading", { name: "민감 기록", exact: true })).toBeVisible();
    expect(context.matchReads.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(context.mutations).toEqual([]);
  });
}

for (const denied of [{ status: 403, code: "forbidden", name: "owner access denial" }, { status: 423, code: "restricted_record_locked", name: "restricted grant loss" }, { status: 404, code: "record_not_found", name: "owner or record removal" }]) {
  test(`paging after ${denied.name} removes the title, snippet, and all earlier matches`, async ({ page }) => {
    const context = await harness(page);
    const card = page.getByRole("region", { name: "검색 결과", exact: true }).getByRole("article").first();
    await card.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
    await expect(card.getByRole("list", { name: "출처별 검색 근거" }).getByRole("listitem")).toHaveCount(50);
    context.onMatches(async (route) => route.fulfill({ status: denied.status, json: { error: { code: denied.code, message: "Synthetic permission change" } } }));
    await card.getByRole("button", { name: "이 기록의 검색 근거 더 보기", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("권한");
    await expect(card.getByRole("heading")).toHaveCount(0);
    await expect(card.locator(".v2-search-result__snippet")).toHaveCount(0);
    await expect(card.getByRole("list")).toHaveCount(0);
    await expect(card).not.toContainText("합성 검색 위치 기록");
    await expect(card).not.toContainText("보관한 자료의 window light");
    await expect(card).not.toContainText("합성 검색 문맥");
    await expect(card.getByRole("button")).toHaveCount(0);
    expect(context.matchReads.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(context.mutations).toEqual([]);
  });
}

test("clipboard denial provides keyboard selection; exact panel and matches fit 320px and pass scoped axe", async ({ page }, testInfo) => {
  const context = await harness(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { (window as unknown as { clipboardDenied: boolean }).clipboardDenied = true; });
  await context.open("source"); await expect(targetText(page)).toBeVisible();
  const copy = panel(page).getByRole("button", { name: "보관 텍스트 그대로 복사", exact: true });
  await copy.focus(); await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("status")).toContainText("자동 복사를 사용할 수 없습니다");
  await panel(page).getByRole("button", { name: "보관 텍스트 선택", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(targetText(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("window light");
  const selectedColors = await targetText(page).evaluate((element) => [element, element.querySelector("mark")!].map((node) => {
    const style = getComputedStyle(node, "::selection"); return { color: style.color, background: style.backgroundColor };
  }));
  expect(selectedColors).toEqual(Array(2).fill({ color: "rgb(255, 255, 255)", background: "rgb(40, 80, 58)" }));
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  expect((await new AxeBuilder({ page }).include(".v2-search-location").include(".v2-search-results").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("exact-search-location-320px.png"), fullPage: true });
  expect(context.mutations).toEqual([]);
});
